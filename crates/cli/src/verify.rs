use anyhow::{ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(feature = "prover")]
use zklean_core::ProveInput;
use zklean_core::{commitment, Statement};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub elf_path: Option<String>,
    pub elf_sha256: Option<String>,
    /// Fingerprint of the trusted guest key; never selected by a certificate.
    pub verifier_key: String,
    #[cfg(feature = "prover")]
    pub input: Option<ProveInput>,
    pub certificate: Option<Certificate>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Certificate {
    #[serde(flatten)]
    pub statement: Statement,
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

pub fn run(input: &str) -> Result<Value> {
    let request: Request = serde_json::from_str(input)?;
    if request.elf_path.is_some() || request.elf_sha256.is_some() {
        request.elf()?;
    }
    let c = request
        .certificate
        .as_ref()
        .context("missing certificate")?;
    ensure!(
        c.statement.format == "zklean/1",
        "unsupported certificate format"
    );
    let Some(encoded) = c.proof.strip_prefix("base64:") else {
        return Ok(json!({"valid": false}));
    };
    // One wire profile: the 4-byte circuit selector and 256-byte Groth16 proof.
    if encoded.len() != 348 {
        return Ok(json!({"valid": false}));
    }
    let Ok(bytes) = STANDARD.decode(encoded) else {
        return Ok(json!({"valid": false}));
    };
    let valid = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        zklean_verifier::verify(&bytes, &commitment(&c.statement), &request.verifier_key)
    }))
    .unwrap_or(false);
    Ok(json!({"valid": valid}))
}
