//! Production proving always uses the CPU client, never an environment-selected mock.
use crate::verify::Request;
use anyhow::{ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sp1_sdk::{HashableKey, Prover, ProverClient, SP1Stdin};
use zklean_core::commitment;

pub fn run(command: &str, input: &str) -> Result<Value> {
    // These settings are required for SP1's pinned compressed recursion verifier.
    // Never honor inherited development settings that disable VK verification.
    std::env::set_var("VERIFY_VK", "true");
    std::env::set_var("FIX_CORE_SHAPES", "true");
    std::env::set_var("FIX_RECURSION_SHAPES", "true");
    if command == "identity" {
        let request: Value = serde_json::from_str(input)?;
        let elf = std::fs::read(request["elfPath"].as_str().context("elfPath required")?)?;
        let client = ProverClient::builder().cpu().build();
        let (_, vk) = client.setup(&elf);
        return Ok(
            json!({"elfSha256": format!("{:x}", Sha256::digest(&elf)), "verifierKey": format!("0x{}", hex::encode(bincode::serialize(&vk.hash_babybear())?))}),
        );
    }
    let request: Request = serde_json::from_str(input)?;
    let elf = request.elf()?;
    let client = ProverClient::builder().cpu().build();
    let (pk, vk) = client.setup(&elf);
    let key = bincode::serialize(&vk.hash_babybear())?;
    ensure!(
        format!("0x{}", hex::encode(&key)) == request.verifier_key,
        "guest verifier identity mismatch"
    );
    let input = request.input.context("missing prove input")?;
    let statement = zklean_core::check(&input)?;
    let mut stdin = SP1Stdin::new();
    stdin.write(&input);
    // Multi-shard compression is required by SP1's standalone verifier. A small
    // shard size also keeps local proving memory use bounded on developer hosts.
    let proof = client
        .prove(&pk, &stdin)
        .compressed()
        .shard_size(1 << 18)
        .shard_batch_size(1)
        .run()?;
    client.verify(&proof, &vk)?;
    ensure!(
        proof.public_values.as_slice() == commitment(&statement),
        "guest/native public values differ"
    );
    let bytes = bincode::serialize(&proof.proof)?;
    sp1_verifier::CompressedVerifier::verify_sp1_proof(&bytes, &commitment(&statement), &key)
        .map_err(|e| {
            anyhow::anyhow!("proof does not use the pinned production recursion circuit: {e:?}")
        })?;
    let mut value = serde_json::to_value(statement)?;
    value["proof"] = json!(format!("base64:{}", STANDARD.encode(bytes)));
    Ok(value)
}
