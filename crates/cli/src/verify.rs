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
    /// Fingerprint of the trusted guest key; never selected by a certificate.
    pub verifier_key: String,
    /// The SDK's serialized SP1VerifyingKey, from trusted local configuration.
    pub verification_key: Option<String>,
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

pub fn run(input: &str) -> Result<Value> {
    use sp1_sdk::{
        HashableKey, Prover, ProverClient, SP1Proof, SP1ProofWithPublicValues, SP1PublicValues,
        SP1VerifyingKey, SP1_CIRCUIT_VERSION,
    };
    let request: Request = serde_json::from_str(input)?;
    if request.elf_path.is_some() || request.elf_sha256.is_some() {
        request.elf()?;
    }
    let c = request
        .certificate
        .as_ref()
        .context("missing certificate")?;
    ensure!(c.format == "zklean/1", "unsupported certificate format");
    let Some(encoded) = c.proof.strip_prefix("base64:") else {
        return Ok(json!({"valid": false}));
    };
    if encoded.len() > 16 * 1024 * 1024 {
        return Ok(json!({"valid": false}));
    }
    let Ok(bytes) = STANDARD.decode(encoded) else {
        return Ok(json!({"valid": false}));
    };
    let Ok(proof): Result<SP1Proof, _> = bincode::DefaultOptions::new()
        .with_fixint_encoding()
        .with_limit(16 * 1024 * 1024)
        .reject_trailing_bytes()
        .deserialize(&bytes)
    else {
        return Ok(json!({"valid": false}));
    };
    if !matches!(proof, SP1Proof::Compressed(_)) {
        return Ok(json!({"valid": false}));
    }

    // Use upstream SDK verification without modifying SP1. Program caches are
    // needed for proving, not verification; production VK checks stay enabled.
    std::env::set_var("VERIFY_VK", "true");
    std::env::set_var("SP1_DISABLE_PROGRAM_CACHE", "true");
    let client = ProverClient::builder().cpu().build();
    let vk: SP1VerifyingKey = if let Some(encoded) = request.verification_key.as_ref() {
        let bytes = STANDARD.decode(
            encoded
                .strip_prefix("base64:")
                .context("trusted key encoding")?,
        )?;
        bincode::deserialize(&bytes).context("trusted key format")?
    } else {
        client.setup(&request.elf()?).1
    };
    ensure!(
        format!(
            "0x{}",
            hex::encode(bincode::serialize(&vk.hash_babybear())?)
        ) == request.verifier_key,
        "guest verifier identity mismatch"
    );
    let statement = Statement {
        format: c.format.clone(),
        specs: c.specs.clone(),
        axioms: c.axioms.clone(),
    };
    let bundle = SP1ProofWithPublicValues {
        proof,
        public_values: SP1PublicValues::from(&commitment(&statement)),
        sp1_version: SP1_CIRCUIT_VERSION.to_owned(),
        tee_proof: None,
    };
    let valid = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.verify(&bundle, &vk).is_ok()
    }))
    .unwrap_or(false);
    Ok(json!({"valid": valid}))
}
