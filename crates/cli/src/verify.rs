use anyhow::{ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sp1_verifier::{Groth16Verifier, GROTH16_VK_BYTES};
use zklean_core::{commitment, ProveInput, Statement};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub elf_path: String,
    pub elf_sha256: String,
    pub verifier_key: String,
    pub input: Option<ProveInput>,
    pub certificate: Option<Certificate>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Certificate {
    pub format: String,
    pub specs: zklean_core::Specs,
    pub axioms: Vec<String>,
    pub proof: String,
}
impl Request {
    pub fn elf(&self) -> Result<Vec<u8>> {
        let elf = std::fs::read(&self.elf_path).context("read pinned guest ELF")?;
        ensure!(format!("{:x}", Sha256::digest(&elf)) == self.elf_sha256, "guest ELF digest mismatch");
        Ok(elf)
    }
}

/// Verification is pure Rust with a bundled SP1 circuit key: it needs neither
/// the proving SDK nor network access. Guest identity comes from local config.
pub fn run(input: &str) -> Result<Value> {
    let request: Request = serde_json::from_str(input)?;
    request.elf()?;
    let c = request.certificate.context("missing certificate")?;
    ensure!(c.format == "zklean/1", "unsupported certificate format");
    let proof = STANDARD.decode(c.proof.strip_prefix("base64:").context("proof encoding")?)?;
    ensure!(proof.len() == 260, "expected SP1 Groth16 proof (260 bytes)");
    let statement = Statement { format: c.format, specs: c.specs, axioms: c.axioms };
    Groth16Verifier::verify(&proof, &commitment(&statement), &request.verifier_key, &GROTH16_VK_BYTES)
        .map_err(|e| anyhow::anyhow!("invalid Groth16 proof: {e:?}"))?;
    Ok(json!({"valid": true}))
}
