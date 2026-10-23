use anyhow::{bail, Context, Result};
use std::io::{self, Read};
use zklean_core::ProveInput;

#[cfg(feature = "execute")]
mod execute;
#[cfg(feature = "sp1")]
mod sp1;
mod verify;

fn main() -> Result<()> {
    let command = std::env::args()
        .nth(1)
        .context("usage: zklean-native check|prove|verify < request.json")?;
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let result = match command.as_str() {
        "check" => {
            let request: ProveInput = serde_json::from_str(&input)?;
            serde_json::to_value(zklean_core::check(&request)?)?
        }
        "commitment" => {
            let statement: zklean_core::Statement = serde_json::from_str(&input)?;
            let digest = zklean_core::commitment(&statement)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            serde_json::json!({"commitment": digest})
        }
        "requirements" => {
            let request: ProveInput = serde_json::from_str(&input)?;
            serde_json::json!({"format": "httpv/requirements/1", "specs": zklean_core::requirements(&request)?})
        }
        #[cfg(feature = "sp1")]
        "prove" | "identity" => sp1::run(&command, &input)?,
        "verify" => verify::run(&input)?,
        #[cfg(feature = "execute")]
        "execute" => execute::run(&input)?,
        _ => bail!("unsupported command (prove/verify require cargo build --features sp1)"),
    };
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}
