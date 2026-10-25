//! Strict lean4export parsing and content identities of kernel declarations.
//! An identity hashes a declaration's meaning together with its whole public
//! dependency closure, so equal identities mean equal statements and definitions.
use anyhow::{bail, ensure, Context, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Table {
    Name,
    Level,
    Expr,
}
use Table::*;

pub struct Export {
    nodes: BTreeMap<(Table, u64), Value>,
    declarations: BTreeMap<String, (String, Arc<Value>)>,
    /// Declarations whose type is a proposition, as decided by the checker.
    pub props: BTreeSet<String>,
}

impl Export {
    pub fn parse(text: &str) -> Result<Self> {
        let mut out = Self {
            nodes: BTreeMap::new(),
            declarations: BTreeMap::new(),
            props: BTreeSet::new(),
        };
        let mut declarations = Vec::new();
        for (line, text) in text.lines().enumerate() {
            let mut row: Value =
                crate::json::parse(text).with_context(|| format!("export line {}", line + 1))?;
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
            let data = Arc::new(data.clone());
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

    pub fn closure(&self, claims: &BTreeSet<String>, public: bool) -> Result<BTreeSet<String>> {
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
        if public && (kind == "thm" || self.props.contains(name)) {
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
        if kind == "quot" {
            data.as_object_mut().unwrap().remove("kind");
        }
        if kind == "inductive" {
            for value in data["types"].as_array_mut().unwrap() {
                value.as_object_mut().unwrap().remove("isReflexive");
            }
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
}

fn hash(domain: &str, value: &Value) -> Result<String> {
    let mut digest = Sha256::new();
    digest.update(domain.as_bytes());
    digest.update(crate::canonical(value)?);
    Ok(format!("{:x}", digest.finalize()))
}

/// Memoized identities over one parsed export. Expression nodes are hashed
/// Merkle-style, so shared subterms are hashed once.
pub struct Identities<'e> {
    export: &'e Export,
    declarations: BTreeMap<String, String>,
    groups: BTreeMap<String, String>,
    nodes: BTreeMap<(Table, u64, Option<String>), Value>,
    active: BTreeSet<String>,
}

impl<'e> Identities<'e> {
    pub fn new(export: &'e Export) -> Self {
        Self {
            export,
            declarations: BTreeMap::new(),
            groups: BTreeMap::new(),
            nodes: BTreeMap::new(),
            active: BTreeSet::new(),
        }
    }

    pub fn all(&mut self, names: &BTreeSet<String>) -> Result<BTreeMap<String, String>> {
        names.iter().map(|n| Ok((n.clone(), self.of(n)?))).collect()
    }

    /// Propositions hash only their statement, whatever their declaration
    /// kind: proofs are irrelevant, and a published `axiom` matches the theorem.
    pub fn of(&mut self, name: &str) -> Result<String> {
        if let Some(id) = self.declarations.get(name) {
            return Ok(id.clone());
        }
        ensure!(
            self.active.insert(name.to_owned()),
            "cyclic declaration identity: {name}"
        );
        let (kind, data) = self
            .export
            .declarations
            .get(name)
            .with_context(|| format!("unresolved constant {name}"))?;
        let id = if kind == "inductive" {
            let group = self.group(data)?;
            hash(
                "zklean/declaration/1\0",
                &json!({"member": {"group": group, "name": name}}),
            )?
        } else {
            let (kind, mut data) = self.export.project(kind, data, true, name);
            self.rewrite(&kind, &mut data, None)?;
            let kind = if kind == "thm" {
                "prop".to_owned()
            } else {
                kind
            };
            hash("zklean/declaration/1\0", &json!({ kind: data }))?
        };
        self.active.remove(name);
        self.declarations.insert(name.to_owned(), id.clone());
        Ok(id)
    }

    /// Mutual inductive types, constructors and recursors form one unit.
    /// References inside the unit carry no identity, which breaks the cycle.
    fn group(&mut self, data: &Value) -> Result<String> {
        let members = inductive_indices(data)?
            .into_iter()
            .map(|index| self.export.name(index))
            .collect::<Result<BTreeSet<_>>>()?;
        let key = members.first().context("empty inductive group")?.clone();
        if let Some(id) = self.groups.get(&key) {
            return Ok(id.clone());
        }
        let (_, mut data) = self.export.project("inductive", data, true, &key);
        for kind in ["types", "ctors", "recs"] {
            for entry in data[kind].as_array_mut().context("inductive entries")? {
                entry.as_object_mut().unwrap().remove("all");
            }
        }
        self.rewrite("inductive", &mut data, Some(&key))?;
        let id = hash("zklean/declaration/1\0", &json!({ "inductive": data }))?;
        self.groups.insert(key, id.clone());
        Ok(id)
    }

    /// Names become strings and child nodes become their hashes.
    fn rewrite(&mut self, kind: &str, data: &mut Value, group: Option<&str>) -> Result<()> {
        visit(kind, data, &mut |table, index| match table {
            Name => Ok(Value::String(self.export.name(index)?)),
            _ => self.node(table, index, group),
        })
    }

    fn node(&mut self, table: Table, index: u64, group: Option<&str>) -> Result<Value> {
        let key = (table, index, group.map(str::to_owned));
        if let Some(h) = self.nodes.get(&key) {
            return Ok(h.clone());
        }
        let mut row = if table == Level && index == 0 {
            json!({"zero": true})
        } else {
            self.export
                .nodes
                .get(&(table, index))
                .context("unresolved kernel node")?
                .clone()
        };
        let (kind, body) = row
            .as_object_mut()
            .unwrap()
            .iter_mut()
            .next()
            .context("empty kernel node")?;
        let kind = kind.clone();
        let node = match kind.as_str() {
            "natVal" => json!({"natVal": {"value": body, "type": self.of("Nat")?}}),
            "strVal" => json!({"strVal": {"value": body, "type": self.of("String")?}}),
            _ => {
                let reference = match kind.as_str() {
                    "const" => Some("name"),
                    "proj" => Some("typeName"),
                    _ => None,
                };
                let target = match reference {
                    Some(field) => Some(self.export.name(integer(&body[field])?)?),
                    None => None,
                };
                self.rewrite(&kind, body, group)?;
                // Binder names, binder annotations and let hints do not affect meaning.
                if ["lam", "forallE", "letE"].contains(&kind.as_str()) {
                    let body = body.as_object_mut().unwrap();
                    for field in ["name", "binderInfo", "nondep"] {
                        body.remove(field);
                    }
                }
                if let Some(target) = target {
                    let inside = match group {
                        Some(g) => self.group_of(&target)?.as_deref() == Some(g),
                        None => false,
                    };
                    body["id"] = if inside {
                        Value::Null
                    } else {
                        Value::String(self.of(&target)?)
                    };
                }
                row
            }
        };
        let h = Value::String(hash("zklean/node/1\0", &node)?);
        self.nodes.insert(key, h.clone());
        Ok(h)
    }

    /// The first member name of the inductive group declaring `name`, if any.
    fn group_of(&self, name: &str) -> Result<Option<String>> {
        let Some((kind, data)) = self.export.declarations.get(name) else {
            return Ok(None);
        };
        if kind != "inductive" {
            return Ok(None);
        }
        let members = inductive_indices(data)?
            .into_iter()
            .map(|index| self.export.name(index))
            .collect::<Result<BTreeSet<_>>>()?;
        Ok(members.first().cloned())
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
