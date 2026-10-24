//! Diagnostic execution of the real guest. This produces no certificate.
use anyhow::{ensure, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use sp1_core_executor::{Executor, Program};
use sp1_stark::SP1CoreOpts;
use zklean_core::{commitment, ProveInput};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    elf_path: String,
    input: ProveInput,
}

pub fn run(input: &str) -> Result<Value> {
    let request: Request = serde_json::from_str(input)?;
    let program =
        Program::from_elf(&request.elf_path).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let mut executor = Executor::new(program, SP1CoreOpts::default());
    executor.max_cycles = Some(1_000_000_000);
    executor
        .state
        .input_stream
        .push_back(bincode::serialize(&request.input)?);
    executor.run_fast().context("guest execution failed")?;
    let statement = zklean_core::check(&request.input)?;
    ensure!(
        executor.state.public_values_stream == commitment(&statement),
        "guest/native commitment mismatch"
    );
    Ok(json!({"statement": statement, "cycles": executor.state.global_clk}))
}
