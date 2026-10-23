//! Production proving always uses the CPU client, never an environment-selected mock.
use anyhow::{ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sp1_sdk::{HashableKey, ProverClient, SP1Stdin};
use zklean_core::commitment;
use crate::verify::Request;

pub fn run(command: &str, input: &str) -> Result<Value> {
    if command == "identity" {
        let request: Value = serde_json::from_str(input)?;
        let elf = std::fs::read(request["elfPath"].as_str().context("elfPath required")?)?;
        let client = ProverClient::builder().cpu().build();
        let (_, vk) = client.setup(&elf);
        return Ok(json!({"elfSha256": format!("{:x}", Sha256::digest(&elf)), "verifierKey": vk.bytes32()}));
    }
    let request: Request = serde_json::from_str(input)?;
    let elf = request.elf()?;
    let client = ProverClient::builder().cpu().build();
    let (pk, vk) = client.setup(&elf);
    ensure!(vk.bytes32() == request.verifier_key, "guest verifier identity mismatch");
    let input = request.input.context("missing prove input")?;
    let statement = zklean_core::check(&input)?;
    let mut stdin = SP1Stdin::new();
    stdin.write(&input);
    let proof = client.prove(&pk, &stdin).groth16().run()?;
    client.verify(&proof, &vk)?;
    ensure!(proof.public_values.as_slice() == commitment(&statement), "guest/native public values differ");
    let mut value = serde_json::to_value(statement)?;
    value["proof"] = json!(format!("base64:{}", STANDARD.encode(proof.bytes())));
    Ok(value)
}
