use anyhow::{ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use bincode::Options;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use zklean_core::{commitment, ProveInput, Statement};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub elf_path: Option<String>,
    pub elf_sha256: Option<String>,
    /// Bincode-encoded [BabyBear; 8] guest key digest, as 0x-prefixed hex.
    pub verifier_key: String,
    #[cfg_attr(not(feature = "sp1"), allow(dead_code))]
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
        let elf = std::fs::read(self.elf_path.as_ref().context("proving requires elfPath")?)
            .context("read pinned guest ELF")?;
        ensure!(
            format!("{:x}", Sha256::digest(&elf))
                == *self
                    .elf_sha256
                    .as_ref()
                    .context("proving requires elfSha256")?,
            "guest ELF digest mismatch"
        );
        Ok(elf)
    }
}

/// The standalone compressed verifier pins SP1's real recursion VK root/set.
/// It requires no proving artifacts, proving SDK, or network access.
pub fn run(input: &str) -> Result<Value> {
    let request: Request = serde_json::from_str(input)?;
    if request.elf_path.is_some() || request.elf_sha256.is_some() {
        request.elf()?;
    }
    let key_bytes = hex::decode(
        request
            .verifier_key
            .strip_prefix("0x")
            .context("guest key encoding")?,
    )?;
    ensure!(
        key_bytes.len() == 32,
        "guest key must contain eight BabyBear field elements"
    );
    let key = bincode::deserialize(&key_bytes).context("guest key field encoding")?;
    let c = request.certificate.context("missing certificate")?;
    ensure!(c.format == "zklean/1", "unsupported certificate format");
    let Some(encoded) = c.proof.strip_prefix("base64:") else {
        return Ok(json!({"valid": false}));
    };
    if encoded.len() > 16 * 1024 * 1024 {
        return Ok(json!({"valid": false}));
    }
    let Ok(proof) = STANDARD.decode(encoded) else {
        return Ok(json!({"valid": false}));
    };
    let Ok(parsed): Result<sp1_stark::SP1Proof, _> = bincode::DefaultOptions::new()
        .with_fixint_encoding()
        .with_limit(16 * 1024 * 1024)
        .reject_trailing_bytes()
        .deserialize(&proof)
    else {
        return Ok(json!({"valid": false}));
    };
    let statement = Statement {
        format: c.format,
        specs: c.specs,
        axioms: c.axioms,
    };
    // Untrusted proof rejection must not unwind through the Bun process. The
    // child boundary and timeout also contain upstream deserialization panics.
    let valid = std::panic::catch_unwind(|| {
        sp1_verifier::compressed::internal::verify_sp1_proof(&parsed, &commitment(&statement), &key)
            .is_ok()
    })
    .unwrap_or(false);
    Ok(json!({"valid": valid}))
}
