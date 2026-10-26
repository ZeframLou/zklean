//! Lean's own library, pinned by a Merkle root. A proof may state library
//! theorems as axioms instead of carrying their proofs. The checker accepts
//! each one by its membership in the pinned table, which Lean's kernel checked,
//! and reports the axioms the library proof uses in its place.
//!
//! The tree is RFC 9162's Merkle tree over the entries in name order, with
//! domain-separated leaf and node hashes.
use crate::{canonical, Identified};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// One library theorem: its identity and every axiom its proof uses.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub name: String,
    pub id: String,
    pub axioms: Identified,
}

/// An entry with the path that proves its membership in the pinned table.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Membership {
    pub entry: Entry,
    pub index: u64,
    pub path: Vec<String>,
}

/// The pinned table: its Lean version, size and root.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pin {
    pub lean: String,
    pub size: u64,
    pub root: String,
}

pub fn pinned() -> Result<Pin> {
    Ok(serde_json::from_str(include_str!("library.json"))?)
}

pub fn leaf(entry: &Entry) -> Result<[u8; 32]> {
    let mut hash = Sha256::new();
    hash.update(b"zklean/library/1\0");
    hash.update(canonical(entry)?);
    Ok(hash.finalize().into())
}

fn node(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"zklean/library-node/1\0");
    hash.update(left);
    hash.update(right);
    hash.finalize().into()
}

/// The largest power of two smaller than `n`, for `n > 1`.
fn split(n: usize) -> usize {
    1 << (usize::BITS - 1 - (n - 1).leading_zeros())
}

/// The root of a non-empty list of leaves.
pub fn root(leaves: &[[u8; 32]]) -> [u8; 32] {
    match leaves.len() {
        1 => leaves[0],
        n => {
            let k = split(n);
            node(&root(&leaves[..k]), &root(&leaves[k..]))
        }
    }
}

/// The audit path of leaf `index`, from the leaf upward.
pub fn path(leaves: &[[u8; 32]], index: usize) -> Vec<[u8; 32]> {
    if leaves.len() == 1 {
        return Vec::new();
    }
    let k = split(leaves.len());
    let (mut path, sibling) = if index < k {
        (path(&leaves[..k], index), root(&leaves[k..]))
    } else {
        (path(&leaves[k..], index - k), root(&leaves[..k]))
    };
    path.push(sibling);
    path
}

/// RFC 9162 section 2.1.3.2: whether `path` proves `leaf` is leaf `index` of
/// a tree of `size` leaves with root `root`.
fn included(index: u64, size: u64, leaf: [u8; 32], path: &[[u8; 32]], root: &[u8; 32]) -> bool {
    if index >= size {
        return false;
    }
    let (mut f, mut s, mut r) = (index, size - 1, leaf);
    for p in path {
        if s == 0 {
            return false;
        }
        if f & 1 == 1 || f == s {
            r = node(p, &r);
            while f & 1 == 0 && f != 0 {
                f >>= 1;
                s >>= 1;
            }
        } else {
            r = node(&r, p);
        }
        f >>= 1;
        s >>= 1;
    }
    s == 0 && &r == root
}

/// Check a membership against the pinned table and return its entry.
pub fn verify(membership: &Membership) -> Result<&Entry> {
    let pin = pinned()?;
    let decode = |hex: &str| -> Result<[u8; 32]> {
        ensure!(hex.len() == 64, "expected a 32-byte hash");
        let mut out = [0u8; 32];
        for (i, byte) in out.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).context("expected hex")?;
        }
        Ok(out)
    };
    let path = membership
        .path
        .iter()
        .map(|h| decode(h))
        .collect::<Result<Vec<_>>>()?;
    ensure!(
        included(
            membership.index,
            pin.size,
            leaf(&membership.entry)?,
            &path,
            &decode(&pin.root)?
        ),
        "{} is not in Lean {}'s library",
        membership.entry.name,
        pin.lean
    );
    Ok(&membership.entry)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_leaf_is_included_and_nothing_else() {
        for size in 1..40usize {
            let leaves: Vec<[u8; 32]> = (0..size).map(|i| [i as u8; 32]).collect();
            let r = root(&leaves);
            for i in 0..size {
                let p = path(&leaves, i);
                assert!(included(i as u64, size as u64, leaves[i], &p, &r));
                assert!(!included(i as u64, size as u64, [255; 32], &p, &r));
                if size > 1 {
                    let other = (i + 1) % size;
                    assert!(!included(other as u64, size as u64, leaves[i], &p, &r));
                }
            }
        }
    }
}
