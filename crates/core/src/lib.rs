//! Shared checked computation. The SP1 guest and native diagnostics run this code.
mod json;
mod model;
pub use model::{Export, Identities};

use anyhow::{bail, ensure, Result};
use nanoda_lib::{env::Declar, parser::parse_export_file, util::Config};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Cursor,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProveInput {
    pub export: String,
    pub claims: Vec<String>,
    /// Non-proof declarations to identify, such as an API operation.
    #[serde(default)]
    pub definitions: Vec<String>,
    /// The prover's own guard against accidental axioms. Recipients enforce
    /// their policy separately, against the committed identities.
    pub allowed_axioms: Vec<String>,
}

/// Lean names mapped to declaration identities.
pub type Identified = BTreeMap<String, String>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Statement {
    pub format: String,
    pub claims: Identified,
    pub definitions: Identified,
    pub axioms: Identified,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Requirements {
    pub format: String,
    pub claims: Identified,
    pub definitions: Identified,
}

/// Nanoda panics on malformed proofs. In the guest that aborts execution and no
/// proof can be produced. Native callers should execute this in a child process.
pub fn check(input: &ProveInput) -> Result<Statement> {
    process(input, true)
}

/// Identify locally trusted requirements without asserting their derivability.
pub fn requirements(input: &ProveInput) -> Result<Requirements> {
    let statement = process(input, false)?;
    Ok(Requirements {
        format: "zklean/requirements/1".into(),
        claims: statement.claims,
        definitions: statement.definitions,
    })
}

fn process(input: &ProveInput, require_proofs: bool) -> Result<Statement> {
    ensure!(!input.claims.is_empty(), "at least one claim is required");
    let mut export = Export::parse(&input.export)?;
    let claims: BTreeSet<_> = input.claims.iter().cloned().collect();
    ensure!(claims.len() == input.claims.len(), "duplicate claims");
    let definitions: BTreeSet<_> = input.definitions.iter().cloned().collect();
    ensure!(
        definitions.len() == input.definitions.len() && claims.is_disjoint(&definitions),
        "duplicate names"
    );
    for name in &claims {
        ensure!(
            !require_proofs || export.kind(name)? == "thm",
            "claim must name a theorem: {name}"
        );
    }
    // Check the entire supplied environment: no unauthenticated external state.
    let mut permitted = input.allowed_axioms.clone();
    if !require_proofs {
        permitted.extend(input.claims.clone());
    }
    let config: Config = serde_json::from_value(serde_json::json!({
        "permitted_axioms": permitted,
        "unpermitted_axiom_hard_error": false,
        "num_threads": 1, "nat_extension": true, "string_extension": true,
        "print_axioms": false
    }))?;
    let (checked, _) = parse_export_file(Cursor::new(input.export.as_bytes()), config)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    checked.check_all_declars();
    for d in checked.declars.values() {
        let info = *d.info();
        if matches!(
            d,
            Declar::Axiom { .. }
                | Declar::Theorem { .. }
                | Declar::Definition { .. }
                | Declar::Opaque { .. }
        ) && checked.with_tc_and_declar(info, |tc| tc.is_prop(info.ty).0)
        {
            export
                .props
                .insert(checked.with_ctx(|ctx| render_name(ctx, info.name)));
        }
    }
    // Claims must be proofs: their type has type Prop.
    for name in &claims {
        export.kind(name)?;
        ensure!(
            export.props.contains(name),
            "claim is not a proposition: {name}"
        );
    }
    // Requirements are assumed, so only certified proofs report their axioms.
    let axioms = if require_proofs {
        export.axioms(&claims)?
    } else {
        BTreeSet::new()
    };
    if let Some(name) = axioms.iter().find(|n| !permitted.contains(n)) {
        bail!("forbidden axiom: {name}");
    }
    // Identified definitions must be part of what the claims state, not
    // helpers reached only through proofs, and must not be proofs themselves.
    let public = export.closure(&claims, true)?;
    for name in &definitions {
        ensure!(
            public.contains(name) && !export.props.contains(name),
            "definition is not in the claims' statements: {name}"
        );
    }
    ensure!(axioms.is_disjoint(&definitions), "duplicate names");
    let mut ids = Identities::new(&export);
    let mut identify = |names: &BTreeSet<String>| -> Result<Identified> {
        names.iter().map(|n| Ok((n.clone(), ids.of(n)?))).collect()
    };
    Ok(Statement {
        format: "zklean/1".into(),
        claims: identify(&claims)?,
        definitions: identify(&definitions)?,
        axioms: identify(&axioms)?,
    })
}

/// Sort recursively instead of relying on serde_json's optional map backend.
/// Cargo feature unification must never change authenticated bytes.
pub fn canonical<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    fn write(value: &serde_json::Value, out: &mut Vec<u8>) -> Result<()> {
        use serde_json::Value;
        match value {
            Value::Object(map) => {
                out.push(b'{');
                let mut keys: Vec<_> = map.keys().collect();
                keys.sort();
                for (i, key) in keys.into_iter().enumerate() {
                    if i != 0 {
                        out.push(b',');
                    }
                    serde_json::to_writer(&mut *out, key)?;
                    out.push(b':');
                    write(&map[key], out)?;
                }
                out.push(b'}');
            }
            Value::Array(values) => {
                out.push(b'[');
                for (i, value) in values.iter().enumerate() {
                    if i != 0 {
                        out.push(b',');
                    }
                    write(value, out)?;
                }
                out.push(b']');
            }
            _ => serde_json::to_writer(out, value)?,
        }
        Ok(())
    }
    let mut out = Vec::new();
    write(&serde_json::to_value(value)?, &mut out)?;
    Ok(out)
}

pub fn commitment(statement: &Statement) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"zklean/statement/1\0");
    hash.update(canonical(statement).expect("serializable statement"));
    hash.finalize().into()
}

fn render_name<'t, 'p>(
    ctx: &nanoda_lib::util::TcCtx<'t, 'p>,
    name: nanoda_lib::util::NamePtr<'t>,
) -> String {
    use nanoda_lib::name::Name;
    match ctx.read_name(name) {
        Name::Anon => String::new(),
        Name::Str(pre, s, _) => {
            let prefix = render_name(ctx, pre);
            let part = ctx.read_string(s);
            if prefix.is_empty() {
                part.to_string()
            } else {
                format!("{prefix}.{part}")
            }
        }
        Name::Num(pre, n, _) => {
            let prefix = render_name(ctx, pre);
            if prefix.is_empty() {
                n.to_string()
            } else {
                format!("{prefix}.{n}")
            }
        }
    }
}
