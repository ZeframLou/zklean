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
enum Table {
    Name,
    Level,
    Expr,
}
use Table::*;

pub struct Export {
    nodes: BTreeMap<(Table, u64), Value>,
    declarations: BTreeMap<String, (String, Value)>,
    /// Proposition-valued definitions and opaques are also proof terms.
    pub proof_names: BTreeSet<String>,
}

impl Export {
    pub fn parse(text: &str) -> Result<Self> {
        let mut out = Self {
            nodes: BTreeMap::new(),
            declarations: BTreeMap::new(),
            proof_names: BTreeSet::new(),
        };
        let mut declarations = Vec::new();
        for (line, text) in text.lines().enumerate() {
            let mut row: Value =
                serde_json::from_str(text).with_context(|| format!("export line {}", line + 1))?;
            validate_export_row(&row, line == 0)
                .with_context(|| format!("export line {}", line + 1))?;
            let obj = row.as_object_mut().context("expected object")?;
            if line == 0 {
                ensure!(
                    obj["meta"]["format"]["version"] == "3.1.0",
                    "unsupported export format"
                );
                continue;
            }
            let mut primitive = false;
            for (key, table) in [("in", Name), ("il", Level), ("ie", Expr)] {
                if let Some(index) = obj.remove(key) {
                    ensure!(
                        out.nodes
                            .insert((table, integer(&index)?), row.clone())
                            .is_none(),
                        "duplicate node"
                    );
                    primitive = true;
                    break;
                }
            }
            if !primitive {
                declarations.push(row);
            }
        }
        for row in declarations {
            let obj = row.as_object().context("declaration object")?;
            ensure!(obj.len() == 1, "invalid declaration");
            let (kind, data) = obj.iter().next().unwrap();
            ensure!(
                ["axiom", "def", "thm", "opaque", "quot", "inductive"].contains(&kind.as_str()),
                "unknown declaration kind"
            );
            let names: Vec<u64> = if kind == "inductive" {
                inductive_indices(data)?
            } else {
                vec![integer(&data["name"])?]
            };
            for index in names {
                let name = out.name(index)?;
                ensure!(
                    out.declarations
                        .insert(name, (kind.clone(), data.clone()))
                        .is_none(),
                    "duplicate declaration"
                );
            }
        }
        Ok(out)
    }

    pub fn kind(&self, name: &str) -> Result<&str> {
        Ok(&self
            .declarations
            .get(name)
            .context("unresolved declaration")?
            .0)
    }

    fn name(&self, index: u64) -> Result<String> {
        if index == 0 {
            return Ok(String::new());
        }
        let node = self.nodes.get(&(Name, index)).context("unresolved name")?;
        let (kind, body) = node
            .as_object()
            .context("name node")?
            .iter()
            .next()
            .context("empty name")?;
        let prefix = self.name(integer(&body["pre"])?)?;
        let part = match kind.as_str() {
            "str" => {
                let s = body["str"].as_str().context("name string")?;
                // Avoid ambiguous dotted names and Str/Num collisions in policy names.
                ensure!(
                    !s.is_empty() && !s.contains('.') && !s.chars().all(|c| c.is_ascii_digit()),
                    "ambiguous name component"
                );
                s.to_owned()
            }
            "num" => integer(&body["i"])?.to_string(),
            _ => bail!("unknown name node"),
        };
        Ok(if prefix.is_empty() {
            part
        } else {
            format!("{prefix}.{part}")
        })
    }

    fn closure(&self, claims: &BTreeSet<String>, public: bool) -> Result<BTreeSet<String>> {
        let mut pending: Vec<_> = claims.iter().cloned().collect();
        let mut seen = BTreeSet::new();
        let mut visited_nodes = BTreeSet::new();
        while let Some(name) = pending.pop() {
            if !seen.insert(name.clone()) {
                continue;
            }
            let (kind, original) = self
                .declarations
                .get(&name)
                .with_context(|| format!("unresolved constant {name}"))?;
            let (kind, mut data) = self.project(kind, original, public, &name);
            let mut refs = Vec::new();
            visit(&kind, &mut data, &mut |t, i| {
                refs.push((t, i));
                Ok(Value::from(i))
            })?;
            while let Some((table, index)) = refs.pop() {
                if !visited_nodes.insert((table, index)) {
                    continue;
                }
                if (table == Name || table == Level) && index == 0 {
                    continue;
                }
                let mut node = self
                    .nodes
                    .get(&(table, index))
                    .context("unresolved kernel node")?
                    .clone();
                if table == Expr {
                    if node.get("natVal").is_some() {
                        pending.push("Nat".into());
                    }
                    if node.get("strVal").is_some() {
                        pending.push("String".into());
                    }
                    if let Some(c) = node.get("const") {
                        pending.push(self.name(integer(&c["name"])?)?);
                    }
                    if let Some(p) = node.get("proj") {
                        pending.push(self.name(integer(&p["typeName"])?)?);
                    }
                }
                let obj = node.as_object_mut().unwrap();
                let (k, v) = obj.iter_mut().next().context("empty kernel node")?;
                visit(k, v, &mut |t, i| {
                    refs.push((t, i));
                    Ok(Value::from(i))
                })?;
            }
            // Mutual inductives are indivisible kernel declarations.
            if kind == "inductive" {
                for k in ["types", "ctors", "recs"] {
                    for d in original[k].as_array().context("inductive entries")? {
                        pending.push(self.name(integer(&d["name"])?)?);
                    }
                }
            }
        }
        Ok(seen)
    }

    fn project(&self, kind: &str, data: &Value, public: bool, name: &str) -> (String, Value) {
        if public && (kind == "thm" || self.proof_names.contains(name)) {
            return (
                "thm".into(),
                json!({"name": data["name"], "levelParams": data["levelParams"], "type": data["type"]}),
            );
        }
        let mut data = data.clone();
        // `all` is exporter dependency metadata, not a kernel declaration field.
        // Dependencies are derived from the checked expression graph instead.
        if kind != "inductive" {
            data.as_object_mut().unwrap().remove("all");
        }
        (kind.to_owned(), data)
    }

    pub fn axioms(&self, claims: &BTreeSet<String>) -> Result<BTreeSet<String>> {
        Ok(self
            .closure(claims, false)?
            .into_iter()
            .filter(|n| self.kind(n).unwrap() == "axiom")
            .collect())
    }

    pub fn public_model(&self, claims: &BTreeSet<String>) -> Result<PublicModel> {
        let mut model = PublicModel {
            format: "lean4/kernel/2".into(),
            declarations: BTreeMap::new(),
            nodes: BTreeMap::new(),
        };
        let mut cache = BTreeMap::new();
        for name in self.closure(claims, true)? {
            let (kind, data) = &self.declarations[&name];
            if kind == "inductive" {
                let mut members = inductive_indices(data)?
                    .into_iter()
                    .map(|index| self.name(index))
                    .collect::<Result<Vec<_>>>()?;
                members.sort();
                let group = members.first().context("empty inductive group")?;
                if &name != group {
                    model
                        .declarations
                        .insert(name, json!({"inductiveMember": {"group": group}}));
                    continue;
                }
            }
            let (kind, mut data) = self.project(kind, data, true, &name);
            visit(&kind, &mut data, &mut |t, i| {
                self.node(t, i, &mut cache, &mut model.nodes)
            })?;
            model.declarations.insert(name, json!({kind: data}));
        }
        Ok(model)
    }

    fn node(
        &self,
        table: Table,
        index: u64,
        cache: &mut BTreeMap<(Table, u64), Value>,
        nodes: &mut BTreeMap<String, Value>,
    ) -> Result<Value> {
        if let Some(v) = cache.get(&(table, index)) {
            return Ok(v.clone());
        }
        let mut row = if table == Name && index == 0 {
            json!({"anonymous": true})
        } else if table == Level && index == 0 {
            json!({"zero": true})
        } else {
            self.nodes
                .get(&(table, index))
                .context("unresolved node")?
                .clone()
        };
        let (kind, body) = row
            .as_object_mut()
            .unwrap()
            .iter_mut()
            .next()
            .context("empty node")?;
        visit(kind, body, &mut |t, i| self.node(t, i, cache, nodes))?;
        let hash = format!("{:x}", Sha256::digest(crate::canonical(&row)?));
        nodes.insert(hash.clone(), row);
        let value = Value::String(hash);
        cache.insert((table, index), value.clone());
        Ok(value)
    }
}

const U16_MAX: u64 = u16::MAX as u64;
const U32_MAX: u64 = u32::MAX as u64;
const JS_SAFE_MAX: u64 = 9_007_199_254_740_991;

fn exact_object<'a>(
    value: &'a Value,
    fields: &[&str],
) -> Result<&'a serde_json::Map<String, Value>> {
    let object = value.as_object().context("expected object")?;
    let mut actual: Vec<_> = object.keys().map(String::as_str).collect();
    let mut expected = fields.to_vec();
    actual.sort_unstable();
    expected.sort_unstable();
    ensure!(actual == expected, "unexpected fields");
    Ok(object)
}

fn unsigned(value: &Value, max: u64) -> Result<u64> {
    let value = value.as_u64().context("expected unsigned integer")?;
    ensure!(value <= max, "integer out of range");
    Ok(value)
}

fn unsigned_array(value: &Value, max: u64) -> Result<()> {
    for value in value.as_array().context("expected array")? {
        unsigned(value, max)?;
    }
    Ok(())
}

fn text(value: &Value) -> Result<&str> {
    value.as_str().context("expected string")
}

fn boolean(value: &Value) -> Result<bool> {
    value.as_bool().context("expected boolean")
}

/// Validate the exact lean4export 3.1.0 grammar before either consumer sees it.
/// This keeps Nanoda's checked declaration and the committed public projection
/// from assigning different meanings to permissive or future JSON fields.
fn validate_export_row(row: &Value, metadata: bool) -> Result<()> {
    if metadata {
        let row = exact_object(row, &["meta"])?;
        let meta = exact_object(&row["meta"], &["exporter", "format", "lean"])?;
        let exporter = exact_object(&meta["exporter"], &["name", "version"])?;
        text(&exporter["name"])?;
        text(&exporter["version"])?;
        let format = exact_object(&meta["format"], &["version"])?;
        ensure!(
            text(&format["version"])? == "3.1.0",
            "unsupported export format"
        );
        let lean = exact_object(&meta["lean"], &["githash", "version"])?;
        text(&lean["githash"])?;
        text(&lean["version"])?;
        return Ok(());
    }

    let object = row.as_object().context("expected object")?;
    let indices: Vec<_> = ["in", "il", "ie"]
        .into_iter()
        .filter(|key| object.contains_key(*key))
        .collect();
    ensure!(indices.len() <= 1, "multiple node indices");
    if let Some(index) = indices.first() {
        ensure!(
            object.len() == 2,
            "node must contain one variant and one index"
        );
        unsigned(&object[*index], U32_MAX)?;
        let (kind, data) = object
            .iter()
            .find(|(key, _)| key.as_str() != *index)
            .context("missing node variant")?;
        let allowed = match *index {
            "in" => &["str", "num"][..],
            "il" => &["succ", "max", "imax", "param"][..],
            "ie" => &[
                "bvar", "sort", "const", "app", "lam", "forallE", "letE", "proj", "natVal",
                "strVal",
            ][..],
            _ => unreachable!(),
        };
        ensure!(
            allowed.contains(&kind.as_str()),
            "node variant has wrong index type"
        );
        validate_node(kind, data)?;
        return Ok(());
    }

    ensure!(object.len() == 1, "declaration must contain one variant");
    let (kind, data) = object.iter().next().unwrap();
    validate_declaration(kind, data)
}

fn validate_node(kind: &str, data: &Value) -> Result<()> {
    match kind {
        "str" => {
            let data = exact_object(data, &["pre", "str"])?;
            unsigned(&data["pre"], U32_MAX)?;
            text(&data["str"])?;
        }
        "num" => {
            let data = exact_object(data, &["pre", "i"])?;
            unsigned(&data["pre"], U32_MAX)?;
            unsigned(&data["i"], U32_MAX)?;
        }
        "succ" | "param" | "sort" => {
            unsigned(data, U32_MAX)?;
        }
        "max" | "imax" => {
            let pair = data.as_array().context("expected level pair")?;
            ensure!(pair.len() == 2, "expected level pair");
            unsigned_array(data, U32_MAX)?;
        }
        "bvar" => {
            unsigned(data, U16_MAX)?;
        }
        "natVal" => {
            let value = text(data)?;
            ensure!(
                !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()),
                "invalid natural literal"
            );
        }
        "strVal" => {
            text(data)?;
        }
        "const" => {
            let data = exact_object(data, &["name", "us"])?;
            unsigned(&data["name"], U32_MAX)?;
            unsigned_array(&data["us"], U32_MAX)?;
        }
        "app" => {
            let data = exact_object(data, &["fn", "arg"])?;
            unsigned(&data["fn"], U32_MAX)?;
            unsigned(&data["arg"], U32_MAX)?;
        }
        "lam" | "forallE" => {
            let data = exact_object(data, &["name", "type", "body", "binderInfo"])?;
            for key in ["name", "type", "body"] {
                unsigned(&data[key], U32_MAX)?;
            }
            ensure!(
                ["default", "implicit", "strictImplicit", "instImplicit"]
                    .contains(&text(&data["binderInfo"])?),
                "invalid binderInfo"
            );
        }
        "letE" => {
            let data = exact_object(data, &["name", "type", "value", "body", "nondep"])?;
            for key in ["name", "type", "value", "body"] {
                unsigned(&data[key], U32_MAX)?;
            }
            boolean(&data["nondep"])?;
        }
        "proj" => {
            let data = exact_object(data, &["typeName", "idx", "struct"])?;
            unsigned(&data["typeName"], U32_MAX)?;
            unsigned(&data["idx"], JS_SAFE_MAX)?;
            unsigned(&data["struct"], U32_MAX)?;
        }
        _ => bail!("unsupported kernel node: {kind}"),
    }
    Ok(())
}

fn declaration_header(data: &Value, fields: &[&str]) -> Result<()> {
    let data = exact_object(data, fields)?;
    unsigned(&data["name"], U32_MAX)?;
    unsigned_array(&data["levelParams"], U32_MAX)?;
    unsigned(&data["type"], U32_MAX)?;
    Ok(())
}

fn validate_declaration(kind: &str, data: &Value) -> Result<()> {
    match kind {
        "axiom" => {
            declaration_header(data, &["name", "levelParams", "type", "isUnsafe"])?;
            boolean(&data["isUnsafe"])?;
        }
        "thm" => {
            declaration_header(data, &["name", "levelParams", "type", "value", "all"])?;
            unsigned(&data["value"], U32_MAX)?;
            unsigned_array(&data["all"], U32_MAX)?;
        }
        "opaque" => {
            declaration_header(
                data,
                &["name", "levelParams", "type", "value", "isUnsafe", "all"],
            )?;
            unsigned(&data["value"], U32_MAX)?;
            boolean(&data["isUnsafe"])?;
            unsigned_array(&data["all"], U32_MAX)?;
        }
        "def" => {
            declaration_header(
                data,
                &[
                    "name",
                    "levelParams",
                    "type",
                    "value",
                    "hints",
                    "safety",
                    "all",
                ],
            )?;
            unsigned(&data["value"], U32_MAX)?;
            unsigned_array(&data["all"], U32_MAX)?;
            ensure!(
                ["safe", "unsafe", "partial"].contains(&text(&data["safety"])?),
                "invalid definition safety"
            );
            match &data["hints"] {
                Value::String(value) => ensure!(
                    ["opaque", "abbrev"].contains(&value.as_str()),
                    "invalid reducibility hint"
                ),
                value => {
                    let value = exact_object(value, &["regular"])?;
                    unsigned(&value["regular"], JS_SAFE_MAX)?;
                }
            }
        }
        "quot" => {
            declaration_header(data, &["name", "levelParams", "type", "kind"])?;
            ensure!(
                ["type", "ctor", "lift", "ind"].contains(&text(&data["kind"])?),
                "invalid quotient kind"
            );
        }
        "inductive" => validate_inductive(data)?,
        _ => bail!("unknown declaration kind"),
    }
    Ok(())
}

fn validate_inductive(data: &Value) -> Result<()> {
    let data = exact_object(data, &["types", "ctors", "recs"])?;
    for value in data["types"].as_array().context("inductive types")? {
        declaration_header(
            value,
            &[
                "name",
                "levelParams",
                "type",
                "numParams",
                "numIndices",
                "all",
                "ctors",
                "numNested",
                "isRec",
                "isUnsafe",
                "isReflexive",
            ],
        )?;
        for key in ["numParams", "numIndices", "numNested"] {
            unsigned(&value[key], U16_MAX)?;
        }
        unsigned_array(&value["all"], U32_MAX)?;
        unsigned_array(&value["ctors"], U32_MAX)?;
        for key in ["isRec", "isUnsafe", "isReflexive"] {
            boolean(&value[key])?;
        }
    }
    for value in data["ctors"].as_array().context("constructors")? {
        declaration_header(
            value,
            &[
                "name",
                "levelParams",
                "type",
                "induct",
                "cidx",
                "numParams",
                "numFields",
                "isUnsafe",
            ],
        )?;
        unsigned(&value["induct"], U32_MAX)?;
        for key in ["cidx", "numParams", "numFields"] {
            unsigned(&value[key], U16_MAX)?;
        }
        boolean(&value["isUnsafe"])?;
    }
    for value in data["recs"].as_array().context("recursors")? {
        declaration_header(
            value,
            &[
                "name",
                "levelParams",
                "type",
                "all",
                "numParams",
                "numIndices",
                "numMotives",
                "numMinors",
                "rules",
                "k",
                "isUnsafe",
            ],
        )?;
        unsigned_array(&value["all"], U32_MAX)?;
        for key in ["numParams", "numIndices", "numMotives", "numMinors"] {
            unsigned(&value[key], U16_MAX)?;
        }
        for rule in value["rules"].as_array().context("recursor rules")? {
            let rule = exact_object(rule, &["ctor", "nfields", "rhs"])?;
            unsigned(&rule["ctor"], U32_MAX)?;
            unsigned(&rule["nfields"], U16_MAX)?;
            unsigned(&rule["rhs"], U32_MAX)?;
        }
        boolean(&value["k"])?;
        boolean(&value["isUnsafe"])?;
    }
    Ok(())
}

fn inductive_indices(data: &Value) -> Result<Vec<u64>> {
    ["types", "ctors", "recs"]
        .iter()
        .map(|key| {
            data[*key]
                .as_array()
                .context("inductive entries")?
                .iter()
                .map(|declaration| integer(&declaration["name"]))
                .collect::<Result<Vec<_>>>()
        })
        .collect::<Result<Vec<_>>>()
        .map(|groups| groups.into_iter().flatten().collect())
}

fn integer(v: &Value) -> Result<u64> {
    v.as_u64().context("expected unsigned index")
}
fn field(
    data: &mut Value,
    key: &str,
    table: Table,
    f: &mut impl FnMut(Table, u64) -> Result<Value>,
) -> Result<()> {
    let v = data
        .get_mut(key)
        .with_context(|| format!("missing {key}"))?;
    *v = f(table, integer(v)?)?;
    Ok(())
}
fn array(
    data: &mut Value,
    key: &str,
    table: Table,
    f: &mut impl FnMut(Table, u64) -> Result<Value>,
) -> Result<()> {
    if let Some(values) = data.get_mut(key) {
        for value in values.as_array_mut().context("expected array")? {
            *value = f(table, integer(value)?)?;
        }
    }
    Ok(())
}

/// Every integer kernel reference is translated explicitly. Numeric literals,
/// binder indices, flags, and constructor indices are preserved as data.
fn visit(
    kind: &str,
    data: &mut Value,
    f: &mut impl FnMut(Table, u64) -> Result<Value>,
) -> Result<()> {
    match kind {
        "anonymous" | "zero" | "bvar" | "natVal" | "strVal" => {}
        "str" | "num" => field(data, "pre", Name, f)?,
        "succ" | "sort" | "param" => {
            *data = f(if kind == "param" { Name } else { Level }, integer(data)?)?;
        }
        "max" | "imax" => {
            for v in data.as_array_mut().context("level pair")? {
                *v = f(Level, integer(v)?)?;
            }
        }
        "const" => {
            field(data, "name", Name, f)?;
            array(data, "us", Level, f)?;
        }
        "app" => {
            field(data, "fn", Expr, f)?;
            field(data, "arg", Expr, f)?;
        }
        "lam" | "forallE" | "letE" => {
            field(data, "name", Name, f)?;
            field(data, "type", Expr, f)?;
            field(data, "body", Expr, f)?;
            if kind == "letE" {
                field(data, "value", Expr, f)?;
            }
        }
        "proj" => {
            field(data, "typeName", Name, f)?;
            field(data, "struct", Expr, f)?;
        }
        "mdata" => bail!("metadata exports are unsupported; export without --export-mdata"),
        "axiom" | "def" | "thm" | "opaque" | "quot" | "ind-val" | "ctor-val" | "rec-val" => {
            field(data, "name", Name, f)?;
            array(data, "levelParams", Name, f)?;
            field(data, "type", Expr, f)?;
            if data.get("value").is_some() {
                field(data, "value", Expr, f)?;
            }
            array(data, "all", Name, f)?;
            if kind == "ind-val" {
                array(data, "ctors", Name, f)?;
            }
            if kind == "ctor-val" {
                field(data, "induct", Name, f)?;
            }
            if kind == "rec-val" {
                for r in data["rules"].as_array_mut().context("recursor rules")? {
                    field(r, "ctor", Name, f)?;
                    field(r, "rhs", Expr, f)?;
                }
            }
        }
        "inductive" => {
            for (key, kind) in [
                ("types", "ind-val"),
                ("ctors", "ctor-val"),
                ("recs", "rec-val"),
            ] {
                for d in data[key].as_array_mut().context("inductive entries")? {
                    visit(kind, d, f)?;
                }
            }
        }
        _ => bail!("unsupported kernel node: {kind}"),
    }
    Ok(())
}
