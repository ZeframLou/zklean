//! Shared checked computation. The SP1 guest and native diagnostics run this code.
mod json;
mod model;
pub use model::{Export, Identities};

use anyhow::{ensure, Result};
use nanoda_lib::{env::Declar, parser::parse_export_file, util::Config};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Cursor,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProveInput {
    pub export: String,
    pub claims: Vec<String>,
}

/// Lean names mapped to declaration identities.
pub type Identified = BTreeMap<String, String>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Statement {
    pub format: String,
    pub claims: Identified,
    pub axioms: Identified,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Requirements {
    pub format: String,
    pub claims: Identified,
}

/// Nanoda panics on malformed proofs. In the guest that aborts execution and no
/// proof can be produced. Native callers should execute this in a child process.
pub fn check(input: &ProveInput) -> Result<Statement> {
    let export = checked(&input.export)?;
    let claims = names(&input.claims)?;
    for name in &claims {
        ensure!(
            export.kind(name)? == "thm",
            "claim must name a theorem: {name}"
        );
        ensure!(
            export.props.contains(name),
            "claim is not a proposition: {name}"
        );
    }
    let axioms = export.axioms(&claims)?;
    let mut ids = Identities::new(&export);
    Ok(Statement {
        format: "zklean/1".into(),
        claims: ids.all(&claims)?,
        axioms: ids.all(&axioms)?,
    })
}

/// Identify locally trusted requirements without asserting their derivability:
/// each claim is a proposition, proved or assumed.
pub fn requirements(input: &ProveInput) -> Result<Requirements> {
    let export = checked(&input.export)?;
    let claims = names(&input.claims)?;
    for name in &claims {
        export.kind(name)?;
        ensure!(
            export.props.contains(name),
            "claim is not a proposition: {name}"
        );
    }
    Ok(Requirements {
        format: "zklean/requirements/1".into(),
        claims: Identities::new(&export).all(&claims)?,
    })
}

/// Identities of any declarations, for matching a source export to a certificate.
pub fn identify(export: &str, names: &[String]) -> Result<Identified> {
    let export = checked(export)?;
    Identities::new(&export).all(&names.iter().cloned().collect())
}

fn names(list: &[String]) -> Result<BTreeSet<String>> {
    let names: BTreeSet<_> = list.iter().cloned().collect();
    ensure!(!names.is_empty(), "at least one claim is required");
    ensure!(names.len() == list.len(), "duplicate claims");
    Ok(names)
}

/// Check the entire supplied environment, so no unauthenticated external state
/// enters, and record which declarations are proofs: their type is a Prop.
fn checked(text: &str) -> Result<Export> {
    let mut export = Export::parse(text)?;
    // Admit every axiom: the statement reports each one the proofs use, with
    // its identity, and recipients decide which to accept.
    let config: Config = serde_json::from_value(serde_json::json!({
        "unsafe_permit_all_axioms": true,
        "unpermitted_axiom_hard_error": true,
        "num_threads": 1, "nat_extension": true, "string_extension": true,
        "print_axioms": false
    }))?;
    let (checked, _) = parse_export_file(Cursor::new(text.as_bytes()), config)
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
    Ok(export)
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
