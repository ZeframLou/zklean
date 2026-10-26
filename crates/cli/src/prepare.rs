//! Prepare an export for proving. Lean library theorems become statements
//! without proofs, accepted by membership in the pinned library, and every
//! declaration and expression the claims cannot reach is dropped. Identities
//! are unchanged: a proposition's identity never includes its proof.
use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use zklean_core::library::{self, Entry, Membership};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    export: String,
    claims: Vec<String>,
    /// The pinned library table, one entry per line.
    library: String,
}

const DECLARATIONS: [&str; 6] = ["thm", "def", "opaque", "axiom", "quot", "inductive"];

fn expression_children(line: &Value) -> Vec<&str> {
    for (kind, fields) in [
        ("app", &["fn", "arg"][..]),
        ("lam", &["type", "body"]),
        ("forallE", &["type", "body"]),
        ("letE", &["type", "value", "body"]),
        ("proj", &["struct"]),
        ("mdata", &["expr"]),
    ] {
        if line.get(kind).is_some() {
            return fields.to_vec();
        }
    }
    Vec::new()
}

fn expression_kind(line: &Value) -> Option<&'static str> {
    ["app", "lam", "forallE", "letE", "proj", "mdata"]
        .into_iter()
        .find(|k| line.get(*k).is_some())
}

fn kind(line: &Value) -> Option<&'static str> {
    DECLARATIONS.into_iter().find(|k| line.get(*k).is_some())
}

/// Every expression field of a declaration, as JSON pointers into the line.
fn declaration_roots(line: &Value) -> Vec<String> {
    let k = kind(line).expect("a declaration");
    let mut out = vec![format!("/{k}/type")];
    match k {
        "thm" | "def" | "opaque" => out.push(format!("/{k}/value")),
        "inductive" => {
            out.clear();
            let i = &line["inductive"];
            for (list, extra) in [("types", false), ("ctors", false), ("recs", true)] {
                for (n, item) in i[list].as_array().into_iter().flatten().enumerate() {
                    out.push(format!("/inductive/{list}/{n}/type"));
                    if extra {
                        for (r, _) in item["rules"].as_array().into_iter().flatten().enumerate() {
                            out.push(format!("/inductive/{list}/{n}/rules/{r}/rhs"));
                        }
                    }
                }
            }
        }
        _ => {}
    }
    out
}

fn declared(line: &Value) -> Vec<u64> {
    let k = kind(line).expect("a declaration");
    if k != "inductive" {
        return vec![line[k]["name"].as_u64().unwrap_or_default()];
    }
    let i = &line["inductive"];
    ["types", "ctors", "recs"]
        .iter()
        .flat_map(|l| i[*l].as_array().into_iter().flatten())
        .filter_map(|x| x["name"].as_u64())
        .collect()
}

pub fn run(input: &str) -> Result<Value> {
    let request: Request = serde_json::from_str(input)?;
    let entries: Vec<Entry> = request
        .library
        .lines()
        .filter(|l| !l.is_empty())
        .map(serde_json::from_str)
        .collect::<Result<_, _>>()
        .context("read the library table")?;
    let mut lines: Vec<Value> = request
        .export
        .lines()
        .filter(|l| !l.is_empty())
        .map(serde_json::from_str)
        .collect::<Result<_, _>>()
        .context("read the export")?;

    // Names, rendered as dotted strings.
    let mut names: HashMap<u64, String> = HashMap::from([(0, String::new())]);
    for line in &lines {
        let Some(id) = line.get("in").and_then(Value::as_u64) else {
            continue;
        };
        let (pre, part) = if let Some(s) = line.get("str") {
            // Quoted exactly as the checker renders names.
            let part = s["str"].as_str().unwrap_or_default();
            let quoted =
                part.is_empty() || part.contains('.') || part.chars().all(|c| c.is_ascii_digit());
            let part = if quoted && !part.contains(['«', '»']) {
                format!("«{part}»")
            } else {
                part.to_string()
            };
            (s["pre"].as_u64(), part)
        } else {
            (line["num"]["pre"].as_u64(), line["num"]["i"].to_string())
        };
        let prefix = names[&pre.unwrap_or_default()].clone();
        names.insert(
            id,
            if prefix.is_empty() {
                part
            } else {
                format!("{prefix}.{part}")
            },
        );
    }
    let library: HashMap<&str, usize> = entries
        .iter()
        .enumerate()
        .map(|(i, e)| (e.name.as_str(), i))
        .collect();

    // Library theorems keep their statements only; a claim stays proved.
    let claims: HashSet<&str> = request.claims.iter().map(String::as_str).collect();
    let mut stated = HashSet::new();
    for line in &mut lines {
        let Some(t) = line.get("thm") else { continue };
        let name = t["name"].as_u64().unwrap_or_default();
        let rendered = names[&name].as_str();
        if library.contains_key(rendered) && !claims.contains(rendered) {
            *line = json!({"axiom": {"isUnsafe": false, "levelParams": t["levelParams"],
                "name": name, "type": t["type"]}});
            stated.insert(name);
        }
    }

    // Declarations reachable from the claims.
    let expressions: HashMap<u64, usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, l)| l.get("ie").and_then(Value::as_u64).map(|e| (e, i)))
        .collect();
    let by_name: HashMap<&str, u64> = names.iter().map(|(id, n)| (n.as_str(), *id)).collect();
    let mut owner: HashMap<u64, usize> = HashMap::new();
    for (i, line) in lines.iter().enumerate() {
        if kind(line).is_some() {
            for n in declared(line) {
                owner.insert(n, i);
            }
        }
    }
    let literal = |names: &[&str]| -> Vec<u64> {
        names
            .iter()
            .filter_map(|n| by_name.get(n).copied())
            .collect()
    };
    let mut keep_declarations = HashSet::new();
    let mut pending: Vec<usize> = request
        .claims
        .iter()
        .filter_map(|c| by_name.get(c.as_str()).and_then(|n| owner.get(n)).copied())
        .collect();
    while let Some(i) = pending.pop() {
        if !keep_declarations.insert(i) {
            continue;
        }
        let mut seen = HashSet::new();
        let mut stack: Vec<u64> = declaration_roots(&lines[i])
            .iter()
            .filter_map(|p| lines[i].pointer(p).and_then(Value::as_u64))
            .collect();
        while let Some(e) = stack.pop() {
            if !seen.insert(e) {
                continue;
            }
            let line = &lines[*expressions.get(&e).context("missing expression")?];
            let mut refs = Vec::new();
            if let Some(c) = line.get("const") {
                refs.extend(c["name"].as_u64());
            }
            if let Some(p) = line.get("proj") {
                refs.extend(p["typeName"].as_u64());
            }
            if line.get("natVal").is_some() {
                refs.extend(literal(&["Nat"]));
            }
            if line.get("strVal").is_some() {
                refs.extend(literal(&["String", "String.ofList", "Char.ofNat", "List"]));
            }
            pending.extend(refs.iter().filter_map(|n| owner.get(n)));
            if let Some(k) = expression_kind(line) {
                for f in expression_children(line) {
                    stack.extend(line[k][f].as_u64());
                }
            }
        }
    }

    // Expressions the kept declarations reach, renumbered in order.
    let mut keep_expressions = HashSet::new();
    let mut stack: Vec<u64> = keep_declarations
        .iter()
        .flat_map(|i| {
            declaration_roots(&lines[*i])
                .into_iter()
                .filter_map(|p| lines[*i].pointer(&p).and_then(Value::as_u64))
                .collect::<Vec<_>>()
        })
        .collect();
    while let Some(e) = stack.pop() {
        if !keep_expressions.insert(e) {
            continue;
        }
        let line = &lines[expressions[&e]];
        if let Some(k) = expression_kind(line) {
            for f in expression_children(line) {
                stack.extend(line[k][f].as_u64());
            }
        }
    }
    let mut order: Vec<u64> = keep_expressions.iter().copied().collect();
    order.sort_unstable();
    let renumber: HashMap<u64, u64> = order
        .iter()
        .enumerate()
        .map(|(n, e)| (*e, n as u64))
        .collect();

    let mut out = String::new();
    let mut kept_stated = Vec::new();
    for (i, mut line) in lines.into_iter().enumerate() {
        if let Some(e) = line.get("ie").and_then(Value::as_u64) {
            if !keep_expressions.contains(&e) {
                continue;
            }
            line["ie"] = json!(renumber[&e]);
            if let Some(k) = expression_kind(&line) {
                for f in expression_children(&line.clone()) {
                    let old = line[k][f].as_u64().context("expression reference")?;
                    line[k][f] = json!(renumber[&old]);
                }
            }
        } else if kind(&line).is_some() {
            if !keep_declarations.contains(&i) {
                continue;
            }
            for p in declaration_roots(&line) {
                let slot = line.pointer_mut(&p).context("expression reference")?;
                let old = slot.as_u64().context("expression reference")?;
                *slot = json!(renumber[&old]);
            }
            if let Some(a) = line.get("axiom") {
                let name = a["name"].as_u64().unwrap_or_default();
                if stated.contains(&name) {
                    kept_stated.push(name);
                }
            }
        }
        out.push_str(&serde_json::to_string(&line)?);
        out.push('\n');
    }

    let leaves = entries
        .iter()
        .map(library::leaf)
        .collect::<Result<Vec<_>>>()?;
    let hex = |h: &[u8; 32]| h.iter().map(|b| format!("{b:02x}")).collect::<String>();
    let memberships: Vec<Membership> = kept_stated
        .iter()
        .map(|n| {
            let index = library[names[n].as_str()];
            Membership {
                entry: entries[index].clone(),
                index: index as u64,
                path: library::path(&leaves, index).iter().map(hex).collect(),
            }
        })
        .collect();
    Ok(json!({"export": out, "library": memberships}))
}
