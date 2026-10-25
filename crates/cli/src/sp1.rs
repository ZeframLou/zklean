//! Production proving always uses the CPU client, never an environment-selected mock.
use anyhow::{ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sp1_sdk::blocking::{ProveRequest, Prover, ProverClient};
use sp1_sdk::{HashableKey, ProvingKey, SP1Stdin};
use zklean_core::{commitment, ProveInput};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Identity {
    elf_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    elf_path: String,
    elf_sha256: String,
    /// Fingerprint of the trusted guest key; never selected by a certificate.
    verifier_key: String,
    input: ProveInput,
}

pub fn run(command: &str, input: &str) -> Result<Value> {
    let client = ProverClient::builder().cpu().build();
    if command == "identity" {
        let request: Identity = serde_json::from_str(input)?;
        let elf = std::fs::read(&request.elf_path).context("read guest ELF")?;
        let digest = format!("{:x}", Sha256::digest(&elf));
        let pk = client.setup(elf.into())?;
        return Ok(json!({"elfSha256": digest, "verifierKey": pk.verifying_key().bytes32()}));
    }
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "warn,sp1_prover=info,sp1_sdk=info".into()),
        )
        .with_writer(std::io::stderr)
        .with_span_events(tracing_subscriber::fmt::format::FmtSpan::CLOSE)
        .with_ansi(false)
        .init();
    let request: Request = serde_json::from_str(input)?;
    let elf = std::fs::read(&request.elf_path).context("read pinned guest ELF")?;
    ensure!(
        format!("{:x}", Sha256::digest(&elf)) == request.elf_sha256,
        "guest ELF digest mismatch"
    );
    let pk = client.setup(elf.into())?;
    let vk = pk.verifying_key().clone();
    ensure!(
        vk.bytes32() == request.verifier_key,
        "guest verifier identity mismatch"
    );
    let input = request.input;
    let statement = {
        let input = input.clone();
        crate::guest_stack(move || zklean_core::check(&input))?
    };
    let mut stdin = SP1Stdin::new();
    stdin.write(&input);
    let proof = client.prove(&pk, stdin).groth16().run()?;
    client.verify(&proof, &vk, None)?;
    ensure!(
        proof.public_values.as_slice() == commitment(&statement),
        "guest/native public values differ"
    );
    let bytes = proof.bytes();
    ensure!(
        bytes.len() == zklean_verifier::PROOF_BYTES,
        "unexpected Groth16 proof size"
    );
    ensure!(
        zklean_verifier::verify(&bytes, &commitment(&statement), &vk.bytes32()),
        "upstream lightweight verifier rejected the generated proof"
    );
    let mut value = serde_json::to_value(statement)?;
    value["proof"] = json!(format!("base64:{}", STANDARD.encode(bytes)));
    Ok(value)
}
