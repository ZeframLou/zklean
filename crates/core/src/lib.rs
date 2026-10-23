//! Shared checked computation. The SP1 guest and native diagnostics run this code.
mod model;
pub use model::{Export, PublicModel};

use anyhow::{bail, ensure, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use nanoda_lib::{env::Declar, parser::parse_export_file, util::Config};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, io::Cursor};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProveInput {
    pub export: String,
    pub claims: Vec<String>,
    pub allowed_axioms: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Specs {
    pub declarations: String,
    pub claims: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Statement {
    pub format: String,
    pub specs: Specs,
    pub axioms: Vec<String>,
}

/// Nanoda panics on malformed proofs. In the guest that aborts execution and no
/// proof can be produced. Native callers should execute this in a child process.
pub fn check(input: &ProveInput) -> Result<Statement> {
    ensure!(!input.claims.is_empty(), "at least one claim is required");
    let mut export = Export::parse(&input.export)?;
    let claims: BTreeSet<_> = input.claims.iter().cloned().collect();
    ensure!(claims.len() == input.claims.len(), "duplicate claims");
    for name in &claims {
        ensure!(export.kind(name)? == "thm", "claim must name a theorem: {name}");
    }
    // Check the entire supplied environment: no unauthenticated external state.
    let config: Config = serde_json::from_value(serde_json::json!({
        "permitted_axioms": input.allowed_axioms,
        "unpermitted_axiom_hard_error": false,
        "num_threads": 1, "nat_extension": true, "string_extension": true,
        "print_axioms": false
    }))?;
    let (checked, _) = parse_export_file(Cursor::new(input.export.as_bytes()), config)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    checked.check_all_declars();
    // Theorems must certify propositions, rather than arbitrary data values.
    for name in &claims {
        let mut found = false;
        for d in checked.declars.values() {
            if let Declar::Theorem { info, .. } = d {
                let rendered = checked.with_ctx(|ctx| render_name(ctx, info.name));
                if &rendered == name {
                    ensure!(checked.with_tc_and_declar(*info, |tc| tc.is_prop(info.ty).0),
                        "claim is not a proposition");
                    found = true;
                }
            }
        }
        ensure!(found, "claim missing from checked environment");
    }
    for d in checked.declars.values() {
        let info = *d.info();
        if checked.with_tc_and_declar(info, |tc| tc.is_prop(info.ty).0) {
            export.proof_names.insert(checked.with_ctx(|ctx| render_name(ctx, info.name)));
        }
    }
    let axioms = export.axioms(&claims)?;
    if let Some(name) = axioms.iter().find(|n| !input.allowed_axioms.contains(n)) {
        bail!("forbidden axiom: {name}");
    }
    let model = export.public_model(&claims)?;
    Ok(Statement {
        format: "zklean/1".into(),
        specs: Specs {
            declarations: format!("base64:{}", STANDARD.encode(canonical(&model)?)),
            claims: claims.into_iter().collect(),
        },
        axioms: axioms.into_iter().collect(),
    })
}

/// Fixed ASCII object keys and BTreeMap ordering make this encoding portable.
pub fn canonical<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&serde_json::to_value(value)?)?)
}

pub fn commitment(statement: &Statement) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"zklean/statement/1\0");
    hash.update(canonical(statement).expect("serializable statement"));
    hash.finalize().into()
}

fn render_name(ctx: &nanoda_lib::util::TcCtx<'_, '_>, name: nanoda_lib::util::NamePtr<'_>) -> String {
    use nanoda_lib::name::Name;
    match ctx.read_name(name) {
        Name::Anon => String::new(),
        Name::Str(pre, s, _) => {
            let prefix = render_name(ctx, pre);
            let part = ctx.read_string(s);
            if prefix.is_empty() { part.to_string() } else { format!("{prefix}.{part}") }
        },
        Name::Num(pre, n, _) => {
            let prefix = render_name(ctx, pre);
            if prefix.is_empty() { n.to_string() } else { format!("{prefix}.{n}") }
        }
    }
}
