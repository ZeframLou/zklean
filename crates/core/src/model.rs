//! Lossless kernel serialization with content-addressed Name/Level/Expr nodes.
//! Proof-only nodes disappear when projecting the public dependency closure.
use anyhow::{bail, ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicModel {
    pub format: String,
    pub declarations: BTreeMap<String, Value>,
    pub nodes: BTreeMap<String, Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Table { Name, Level, Expr }
use Table::*;

pub struct Export {
    nodes: BTreeMap<(Table, u64), Value>,
    declarations: BTreeMap<String, (String, Value)>,
    /// Proposition-valued definitions and opaques are also proof terms.
    pub proof_names: BTreeSet<String>,
}

impl Export {
    pub fn parse(text: &str) -> Result<Self> {
        let mut out = Self { nodes: BTreeMap::new(), declarations: BTreeMap::new(), proof_names: BTreeSet::new() };
        let mut declarations = Vec::new();
        for (line, text) in text.lines().enumerate() {
            let mut row: Value = serde_json::from_str(text).with_context(|| format!("export line {}", line + 1))?;
            let obj = row.as_object_mut().context("expected object")?;
            if line == 0 {
                ensure!(obj["meta"]["format"]["version"] == "3.1.0", "unsupported export format");
                continue;
            }
            let mut primitive = false;
            for (key, table) in [("in", Name), ("il", Level), ("ie", Expr)] {
                if let Some(index) = obj.remove(key) {
                    ensure!(out.nodes.insert((table, integer(&index)?), row.clone()).is_none(), "duplicate node");
                    primitive = true;
                    break;
                }
            }
            if !primitive { declarations.push(row); }
        }
        for row in declarations {
            let obj = row.as_object().context("declaration object")?;
            ensure!(obj.len() == 1, "invalid declaration");
            let (kind, data) = obj.iter().next().unwrap();
            ensure!(["axiom", "def", "thm", "opaque", "quot", "inductive"].contains(&kind.as_str()), "unknown declaration kind");
            let names: Vec<u64> = if kind == "inductive" {
                ["types", "ctors", "recs"].iter().map(|k| {
                    data[*k].as_array().context("inductive entries")?.iter()
                        .map(|d| integer(&d["name"])).collect::<Result<Vec<_>>>()
                }).collect::<Result<Vec<_>>>()?.into_iter().flatten().collect()
            } else { vec![integer(&data["name"])?] };
            for index in names {
                let name = out.name(index)?;
                ensure!(out.declarations.insert(name, (kind.clone(), data.clone())).is_none(), "duplicate declaration");
            }
        }
        Ok(out)
    }

    pub fn kind(&self, name: &str) -> Result<&str> {
        Ok(&self.declarations.get(name).context("unresolved declaration")?.0)
    }

    fn name(&self, index: u64) -> Result<String> {
        if index == 0 { return Ok(String::new()); }
        let node = self.nodes.get(&(Name, index)).context("unresolved name")?;
        let (kind, body) = node.as_object().context("name node")?.iter().next().context("empty name")?;
        let prefix = self.name(integer(&body["pre"])?)?;
        let part = match kind.as_str() {
            "str" => {
                let s = body["str"].as_str().context("name string")?;
                // Avoid ambiguous dotted names and Str/Num collisions in policy names.
                ensure!(!s.is_empty() && !s.contains('.') && !s.chars().all(|c| c.is_ascii_digit()), "ambiguous name component");
                s.to_owned()
            }
            "num" => integer(&body["i"])?.to_string(),
            _ => bail!("unknown name node"),
        };
        Ok(if prefix.is_empty() { part } else { format!("{prefix}.{part}") })
    }

    fn closure(&self, claims: &BTreeSet<String>, public: bool) -> Result<BTreeSet<String>> {
        let mut pending: Vec<_> = claims.iter().cloned().collect();
        let mut seen = BTreeSet::new();
        let mut visited_nodes = BTreeSet::new();
        while let Some(name) = pending.pop() {
            if !seen.insert(name.clone()) { continue; }
            let (kind, original) = self.declarations.get(&name).with_context(|| format!("unresolved constant {name}"))?;
            let (kind, mut data) = self.project(kind, original, public, &name);
            let mut refs = Vec::new();
            visit(&kind, &mut data, &mut |t, i| { refs.push((t, i)); Ok(Value::from(i)) })?;
            while let Some((table, index)) = refs.pop() {
                if !visited_nodes.insert((table, index)) { continue; }
                if (table == Name || table == Level) && index == 0 { continue; }
                let mut node = self.nodes.get(&(table, index)).context("unresolved kernel node")?.clone();
                if table == Expr {
                    if let Some(c) = node.get("const") { pending.push(self.name(integer(&c["name"])?)?); }
                    if let Some(p) = node.get("proj") { pending.push(self.name(integer(&p["typeName"])?)?); }
                }
                let obj = node.as_object_mut().unwrap();
                let (k, v) = obj.iter_mut().next().context("empty kernel node")?;
                visit(k, v, &mut |t, i| { refs.push((t, i)); Ok(Value::from(i)) })?;
            }
            // Mutual inductives are indivisible kernel declarations.
            if kind == "inductive" {
                for k in ["types", "ctors", "recs"] {
                    for d in original[k].as_array().context("inductive entries")? {
                        pending.push(self.name(integer(&d["name"])?)?);
                    }
                }
            }
            if let Some(all) = data.get("all").and_then(Value::as_array) {
                for n in all { pending.push(self.name(integer(n)?)?); }
            }
        }
        Ok(seen)
    }

    fn project(&self, kind: &str, data: &Value, public: bool, name: &str) -> (String, Value) {
        if public && (kind == "thm" || self.proof_names.contains(name)) {
            return ("thm".into(), json!({"name": data["name"], "levelParams": data["levelParams"], "type": data["type"]}));
        }
        (kind.to_owned(), data.clone())
    }

    pub fn axioms(&self, claims: &BTreeSet<String>) -> Result<BTreeSet<String>> {
        Ok(self.closure(claims, false)?.into_iter().filter(|n| self.kind(n).unwrap() == "axiom").collect())
    }

    pub fn public_model(&self, claims: &BTreeSet<String>) -> Result<PublicModel> {
        let mut model = PublicModel { format: "lean4/kernel/1".into(), declarations: BTreeMap::new(), nodes: BTreeMap::new() };
        let mut cache = BTreeMap::new();
        for name in self.closure(claims, true)? {
            let (kind, data) = &self.declarations[&name];
            let (kind, mut data) = self.project(kind, data, true, &name);
            visit(&kind, &mut data, &mut |t, i| self.node(t, i, &mut cache, &mut model.nodes))?;
            model.declarations.insert(name, json!({kind: data}));
        }
        Ok(model)
    }

    fn node(&self, table: Table, index: u64, cache: &mut BTreeMap<(Table, u64), Value>, nodes: &mut BTreeMap<String, Value>) -> Result<Value> {
        if let Some(v) = cache.get(&(table, index)) { return Ok(v.clone()); }
        let mut row = if table == Name && index == 0 { json!({"anonymous": true}) }
            else if table == Level && index == 0 { json!({"zero": true}) }
            else { self.nodes.get(&(table, index)).context("unresolved node")?.clone() };
        let (kind, body) = row.as_object_mut().unwrap().iter_mut().next().context("empty node")?;
        visit(kind, body, &mut |t, i| self.node(t, i, cache, nodes))?;
        let hash = format!("{:x}", Sha256::digest(crate::canonical(&row)?));
        nodes.insert(hash.clone(), row);
        let value = Value::String(hash);
        cache.insert((table, index), value.clone());
        Ok(value)
    }
}

fn integer(v: &Value) -> Result<u64> { v.as_u64().context("expected unsigned index") }
fn field(data: &mut Value, key: &str, table: Table, f: &mut impl FnMut(Table, u64) -> Result<Value>) -> Result<()> {
    let v = data.get_mut(key).with_context(|| format!("missing {key}"))?;
    *v = f(table, integer(v)?)?;
    Ok(())
}
fn array(data: &mut Value, key: &str, table: Table, f: &mut impl FnMut(Table, u64) -> Result<Value>) -> Result<()> {
    if let Some(values) = data.get_mut(key) {
        for value in values.as_array_mut().context("expected array")? { *value = f(table, integer(value)?)?; }
    }
    Ok(())
}

/// Every integer kernel reference is translated explicitly. Numeric literals,
/// binder indices, flags, and constructor indices are preserved as data.
fn visit(kind: &str, data: &mut Value, f: &mut impl FnMut(Table, u64) -> Result<Value>) -> Result<()> {
    match kind {
        "anonymous" | "zero" | "bvar" | "natVal" | "strVal" => {},
        "str" | "num" => field(data, "pre", Name, f)?,
        "succ" | "sort" | "param" => { *data = f(if kind == "param" { Name } else { Level }, integer(data)?)?; },
        "max" | "imax" => for v in data.as_array_mut().context("level pair")? { *v = f(Level, integer(v)?)?; },
        "const" => { field(data, "name", Name, f)?; array(data, "us", Level, f)?; },
        "app" => { field(data, "fn", Expr, f)?; field(data, "arg", Expr, f)?; },
        "lam" | "forallE" | "letE" => {
            field(data, "name", Name, f)?; field(data, "type", Expr, f)?; field(data, "body", Expr, f)?;
            if kind == "letE" { field(data, "value", Expr, f)?; }
        },
        "proj" => { field(data, "typeName", Name, f)?; field(data, "struct", Expr, f)?; },
        "mdata" => bail!("metadata exports are unsupported; export without --export-mdata"),
        "axiom" | "def" | "thm" | "opaque" | "quot" | "ind-val" | "ctor-val" | "rec-val" => {
            field(data, "name", Name, f)?; array(data, "levelParams", Name, f)?; field(data, "type", Expr, f)?;
            if data.get("value").is_some() { field(data, "value", Expr, f)?; }
            array(data, "all", Name, f)?;
            if kind == "ind-val" { array(data, "ctors", Name, f)?; }
            if kind == "ctor-val" { field(data, "induct", Name, f)?; }
            if kind == "rec-val" {
                for r in data["rules"].as_array_mut().context("recursor rules")? {
                    field(r, "ctor", Name, f)?; field(r, "rhs", Expr, f)?;
                }
            }
        },
        "inductive" => for (key, kind) in [("types", "ind-val"), ("ctors", "ctor-val"), ("recs", "rec-val")] {
            for d in data[key].as_array_mut().context("inductive entries")? { visit(kind, d, f)?; }
        },
        _ => bail!("unsupported kernel node: {kind}"),
    }
    Ok(())
}
