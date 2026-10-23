#![no_main]
sp1_zkvm::entrypoint!(main);

/// Only this checked computation determines the authenticated public values.
pub fn main() {
    let input: zklean_core::ProveInput = sp1_zkvm::io::read();
    let statement = zklean_core::check(&input).expect("invalid Lean derivation");
    sp1_zkvm::io::commit_slice(&zklean_core::commitment(&statement));
}
