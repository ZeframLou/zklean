//! Shared checked computation. The SP1 guest and native diagnostics run this code.
mod identity;

use anyhow::{ensure, Result};
use identity::Reader;
use nanoda_lib::{parser::parse_export_file, util::Config};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Cursor,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProveInput {
    pub export: String,
    pub claims: Vec<String>,
}

/// Lean names mapped to declaration identities.
pub type Identified = BTreeMap<String, String>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Statement {
    pub format: String,
    pub claims: Identified,
    pub axioms: Identified,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Requirements {
    pub format: String,
    pub claims: Identified,
}

/// Nanoda panics on malformed proofs. In the guest that aborts execution and no
/// proof can be produced. Native callers should execute this in a child process.
pub fn check(input: &ProveInput) -> Result<Statement> {
    let claims = names(&input.claims)?;
    checked(&input.export, |env| {
        for name in &claims {
            ensure!(
                env.is_theorem(name)?,
                "claim must be a theorem of a proposition: {name}"
            );
        }
        let axioms = env.axioms(&claims)?;
        Ok(Statement {
            format: "zklean/1".into(),
            claims: env.identities(&claims)?,
            axioms: env.identities(&axioms)?,
        })
    })
}

/// Identify locally trusted requirements without asserting their derivability:
/// each claim is a proposition, proved or assumed.
pub fn requirements(input: &ProveInput) -> Result<Requirements> {
    let claims = names(&input.claims)?;
    checked(&input.export, |env| {
        for name in &claims {
            ensure!(
                env.is_proposition(name)?,
                "claim is not a proposition: {name}"
            );
        }
        Ok(Requirements {
            format: "zklean/requirements/1".into(),
            claims: env.identities(&claims)?,
        })
    })
}

/// Identities of any declarations, for matching a source export to a certificate.
pub fn identify(export: &str, names: &[String]) -> Result<Identified> {
    let names = names.iter().cloned().collect();
    checked(export, |env| env.identities(&names))
}

/// The checker computes with these constants by name, trusting that they are
/// Lean's own (natural number and string literals, `Quot`, `eagerReduce`).
/// An export may define them only as Lean does, or it could prove `False`.
pub const KERNEL: [&str; 31] = [
    "eagerReduce",
    "Quot",
    "Quot.mk",
    "Quot.lift",
    "Quot.ind",
    "String",
    "String.ofList",
    "Nat",
    "Nat.zero",
    "Nat.succ",
    "Nat.add",
    "Nat.sub",
    "Nat.mul",
    "Nat.pow",
    "Nat.mod",
    "Nat.div",
    "Nat.beq",
    "Nat.ble",
    "Nat.gcd",
    "Nat.xor",
    "Nat.land",
    "Nat.lor",
    "Nat.shiftLeft",
    "Nat.shiftRight",
    "Bool.true",
    "Bool.false",
    "Char",
    "Char.ofNat",
    "List",
    "List.nil",
    "List.cons",
];

/// Identities of the `KERNEL` constants an export defines, unpinned: the
/// source of `kernel.json`.
pub fn kernel_identities(export: &str) -> Result<Identified> {
    check_export(export, |env| {
        let present = env.present(&KERNEL);
        env.identities(&present)
    })
}

fn names(list: &[String]) -> Result<BTreeSet<String>> {
    let names: BTreeSet<_> = list.iter().cloned().collect();
    ensure!(!names.is_empty(), "at least one claim is required");
    ensure!(names.len() == list.len(), "duplicate claims");
    Ok(names)
}

/// Check an export and require Lean's own definitions of the `KERNEL`
/// constants it contains, then read it.
fn checked<A>(text: &str, f: impl FnOnce(&mut Reader<'_, '_, '_>) -> Result<A>) -> Result<A> {
    let pinned: Identified = serde_json::from_str(include_str!("kernel.json"))?;
    check_export(text, |env| {
        let present = env.present(&KERNEL);
        for (name, id) in env.identities(&present)? {
            ensure!(
                pinned.get(&name) == Some(&id),
                "{name} differs from Lean's definition"
            );
        }
        f(env)
    })
}

/// Check the entire export, so no unauthenticated external state enters, then
/// read it. Every axiom is admitted: statements report each one the proofs
/// use, with its identity, and recipients decide which to accept.
fn check_export<A>(text: &str, f: impl FnOnce(&mut Reader<'_, '_, '_>) -> Result<A>) -> Result<A> {
    let config: Config = serde_json::from_value(serde_json::json!({
        "unsafe_permit_all_axioms": true,
        "unpermitted_axiom_hard_error": false,
        "num_threads": 1, "nat_extension": true, "string_extension": true,
        "print_axioms": false
    }))?;
    let (file, _) = parse_export_file(Cursor::new(text.as_bytes()), config)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    file.check_all_declars();
    identity::read(&file, f)
}

/// Sort recursively instead of relying on serde_json's optional map backend.
/// Cargo feature unification must never change authenticated bytes.
pub fn canonical<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    fn write(value: &serde_json::Value, out: &mut Vec<u8>) -> Result<()> {
        use serde_json::Value;
        match value {
            Value::Object(map) => {
                out.push(b'{');
                let mut keys: Vec<_> = map.keys().collect();
                keys.sort();
                for (i, key) in keys.into_iter().enumerate() {
                    if i != 0 {
                        out.push(b',');
                    }
                    serde_json::to_writer(&mut *out, key)?;
                    out.push(b':');
                    write(&map[key], out)?;
                }
                out.push(b'}');
            }
            Value::Array(values) => {
                out.push(b'[');
                for (i, value) in values.iter().enumerate() {
                    if i != 0 {
                        out.push(b',');
                    }
                    write(value, out)?;
                }
                out.push(b']');
            }
            _ => serde_json::to_writer(out, value)?,
        }
        Ok(())
    }
    let mut out = Vec::new();
    write(&serde_json::to_value(value)?, &mut out)?;
    Ok(out)
}

pub fn commitment(statement: &Statement) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"zklean/statement/1\0");
    hash.update(canonical(statement).expect("serializable statement"));
    hash.finalize().into()
}
