//! Identities of arbitrary declarations, for matching a source export.
use anyhow::Result;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    export: String,
    names: Vec<String>,
}

pub fn run(input: &str) -> Result<Value> {
    let request: Request = serde_json::from_str(input)?;
    Ok(serde_json::to_value(zklean_core::identify(
        &request.export,
        &request.names,
    )?)?)
}
