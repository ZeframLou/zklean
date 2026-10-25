//! The same unmodified upstream Groth16 verifier serves native and npm clients.
use sp1_verifier::{Groth16Verifier, GROTH16_VK_BYTES};

/// SP1 6's Groth16 encoding: a 4-byte circuit-key selector, the exit code,
/// verifier-key root and proof nonce (32 bytes each), and the 256-byte proof.
pub const PROOF_BYTES: usize = 356;

pub fn verify(proof: &[u8], commitment: &[u8; 32], guest_key: &str) -> bool {
    proof.len() == PROOF_BYTES
        && Groth16Verifier::verify(proof, commitment, guest_key, &GROTH16_VK_BYTES).is_ok()
}

// A fixed-size ABI avoids allocators, bindgen, and a second implementation of
// curve arithmetic in JavaScript.
#[cfg(target_arch = "wasm32")]
mod wasm {
    const INPUT_BYTES: usize = super::PROOF_BYTES + 32 + 32;
    static mut INPUT: [u8; INPUT_BYTES] = [0; INPUT_BYTES];

    #[no_mangle]
    pub extern "C" fn input_buffer() -> *mut u8 {
        core::ptr::addr_of_mut!(INPUT).cast()
    }

    #[no_mangle]
    pub extern "C" fn verify() -> u32 {
        // The host fills this buffer before calling verify. WASM has no threads
        // or imported callbacks, so it cannot change during the check.
        let input = unsafe { *core::ptr::addr_of!(INPUT) };
        let (proof, rest) = input.split_at(super::PROOF_BYTES);
        let (commitment, key) = rest.split_at(32);
        let guest_key = format!("0x{}", hex::encode(key));
        super::verify(proof, commitment.try_into().unwrap(), &guest_key) as u32
    }
}
