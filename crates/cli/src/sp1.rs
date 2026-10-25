//! Production proving always uses the CPU client, never an environment-selected mock.
use anyhow::{ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sp1_sdk::{HashableKey, Prover, ProverClient, SP1Stdin};
use zklean_core::{commitment, ProveInput};

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
    if command == "prove" {
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| "warn,sp1_prover=info,sp1_sdk=info".into()),
            )
            .with_writer(std::io::stderr)
            .with_span_events(tracing_subscriber::fmt::format::FmtSpan::CLOSE)
            .with_ansi(false)
            .init();
    }
    // Installed archives keep the upstream proving data beside the bundled
    // tools. An explicit developer override still takes precedence.
    if std::env::var_os("SP1_GROTH16_CIRCUIT_PATH").is_none() {
        let installed = std::env::current_exe()?
            .parent()
            .context("executable directory required")?
            .join("../share/zklean/circuits/groth16");
        if installed.is_dir() {
            std::env::set_var("SP1_GROTH16_CIRCUIT_PATH", installed);
        }
    }
    // Groth16 wraps SP1's production recursion circuit.
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
            json!({"elfSha256": format!("{:x}", Sha256::digest(&elf)), "verifierKey": vk.bytes32()}),
        );
    }
    let request: Request = serde_json::from_str(input)?;
    let elf = std::fs::read(&request.elf_path).context("read pinned guest ELF")?;
    ensure!(
        format!("{:x}", Sha256::digest(&elf)) == request.elf_sha256,
        "guest ELF digest mismatch"
    );
    let client = ProverClient::builder().cpu().build();
    let (pk, vk) = client.setup(&elf);
    ensure!(
        vk.bytes32() == request.verifier_key,
        "guest verifier identity mismatch"
    );
    let input = request.input;
    let statement = zklean_core::check(&input)?;
    let mut stdin = SP1Stdin::new();
    stdin.write(&input);
    // Small shards and one batch at a time bound local CPU proving memory.
    let proof = client
        .prove(&pk, &stdin)
        .groth16()
        .shard_size(1 << 19)
        .shard_batch_size(1)
        .run()?;
    client.verify(&proof, &vk)?;
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
