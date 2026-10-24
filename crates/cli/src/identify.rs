//! Identities of arbitrary declarations in a checked environment, for matching
//! fetched sources against a certificate. Mirrors the core's proposition scan;
//! it lives here so the proving guest stays unchanged.
use anyhow::{anyhow, Result};
use nanoda_lib::{env::Declar, name::Name, parser::parse_export_file, util::Config};
use serde::Deserialize;
use serde_json::Value;
use std::io::Cursor;
use zklean_core::{Export, Identified, Identities};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    export: String,
    names: Vec<String>,
}

pub fn run(input: &str) -> Result<Value> {
    let request: Request = serde_json::from_str(input)?;
    let mut export = Export::parse(&request.export)?;
    let config: Config = serde_json::from_value(serde_json::json!({
        "permitted_axioms": [],
        "unpermitted_axiom_hard_error": false,
        "num_threads": 1, "nat_extension": true, "string_extension": true,
        "print_axioms": false
    }))?;
    let (checked, _) = parse_export_file(Cursor::new(request.export.as_bytes()), config)
        .map_err(|e| anyhow!(e.to_string()))?;
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
                .insert(checked.with_ctx(|ctx| render(ctx, info.name)));
        }
    }
    let mut ids = Identities::new(&export);
    let identified = request
        .names
        .iter()
        .map(|name| Ok((name.clone(), ids.of(name)?)))
        .collect::<Result<Identified>>()?;
    Ok(serde_json::to_value(identified)?)
}

fn render<'t, 'p>(
    ctx: &nanoda_lib::util::TcCtx<'t, 'p>,
    name: nanoda_lib::util::NamePtr<'t>,
) -> String {
    let (prefix, part) = match ctx.read_name(name) {
        Name::Anon => return String::new(),
        Name::Str(pre, s, _) => (render(ctx, pre), ctx.read_string(s).to_string()),
        Name::Num(pre, n, _) => (render(ctx, pre), n.to_string()),
    };
    if prefix.is_empty() {
        part
    } else {
        format!("{prefix}.{part}")
    }
}
