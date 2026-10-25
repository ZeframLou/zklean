//! Diagnostic execution of the real guest. This produces no certificate.
use anyhow::{ensure, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use sp1_sdk::blocking::{Prover, ProverClient};
use sp1_sdk::SP1Stdin;
use zklean_core::{commitment, ProveInput};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    elf_path: String,
    input: ProveInput,
}

pub fn run(input: &str) -> Result<Value> {
    let request: Request = serde_json::from_str(input)?;
    let elf = std::fs::read(&request.elf_path).context("read guest ELF")?;
    let mut stdin = SP1Stdin::new();
    stdin.write(&request.input);
    let (public_values, report) = ProverClient::builder()
        .cpu()
        .build()
        .execute(elf.into(), stdin)
        .run()
        .context("guest execution failed")?;
    let statement = zklean_core::check(&request.input)?;
    ensure!(
        public_values.as_slice() == commitment(&statement),
        "guest/native commitment mismatch"
    );
    Ok(json!({"statement": statement, "cycles": report.total_instruction_count()}))
}
