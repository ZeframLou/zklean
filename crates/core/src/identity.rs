//! Content identities of declarations in a checked Nanoda environment. An
//! identity hashes a declaration's meaning with its whole dependency closure,
//! so equal identities mean equal names, statements and definitions.
use anyhow::{bail, ensure, Context, Result};
use nanoda_lib::{
    env::Declar,
    expr::Expr,
    level::Level,
    name::Name,
    util::{ExportFile, ExprPtr, LevelPtr, LevelsPtr, NamePtr, TcCtx},
};
use rustc_hash::{FxHashMap, FxHashSet};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

fn hash(domain: &str, value: &Value) -> Result<String> {
    let mut digest = Sha256::new();
    digest.update(domain.as_bytes());
    digest.update(crate::canonical(value)?);
    Ok(format!("{:x}", digest.finalize()))
}

/// A node's identity from its canonical JSON.
fn digest(node: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"zklean/node/1\0");
    digest.update(node.as_bytes());
    format!("{:x}", digest.finalize())
}

/// A name with a component containing `«` or `»` cannot be rendered
/// unambiguously, so neither its declaration nor anything that refers to it has
/// an identity.
#[derive(Debug)]
struct Ambiguous(String);

impl std::fmt::Display for Ambiguous {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ambiguous name component: {:?}", self.0)
    }
}

impl std::error::Error for Ambiguous {}

/// A JSON string, escaped as canonical JSON escapes it.
fn quote(s: &str) -> String {
    serde_json::to_string(s).expect("strings serialize")
}

/// Read a checked export. Declarations whose type is a proposition are
/// decided by the checker first. Nanoda checks each declaration against only
/// those before it, so the export is in dependency order and every identity is
/// computed in one forward pass, without recursing through dependencies.
pub fn read<'p, A>(
    file: &'p ExportFile<'p>,
    f: impl FnOnce(&mut Reader<'_, '_, 'p>) -> Result<A>,
) -> Result<A> {
    let mut props = FxHashSet::default();
    for (name, d) in &file.declars {
        if matches!(
            d,
            Declar::Axiom { .. }
                | Declar::Theorem { .. }
                | Declar::Definition { .. }
                | Declar::Opaque { .. }
        ) {
            let info = *d.info();
            if file.with_tc_and_declar(info, |tc| tc.is_prop(info.ty).0) {
                props.insert(*name);
            }
        }
    }
    file.with_ctx(|ctx| {
        let mut reader = Reader {
            ctx,
            declars: FxHashMap::default(),
            props: &props,
            names: FxHashMap::default(),
            rendered: FxHashMap::default(),
            order: Vec::new(),
            ids: FxHashMap::default(),
            unidentified: FxHashSet::default(),
            groups: FxHashMap::default(),
            nodes: FxHashMap::default(),
            levels: FxHashMap::default(),
        };
        for (name, d) in &file.declars {
            reader.order.push(*name);
            reader.declars.insert(*name, d);
            match reader.render(*name) {
                Ok(rendered) => {
                    reader.names.insert(rendered, *name);
                }
                Err(e) if e.is::<Ambiguous>() => {}
                Err(e) => return Err(e),
            }
        }
        for name in file.declars.keys() {
            match reader.identify(*name) {
                Ok(()) => {}
                Err(e) if e.is::<Ambiguous>() => {
                    reader.unidentified.insert(*name);
                }
                Err(e) => return Err(e),
            }
        }
        f(&mut reader)
    })
}

pub struct Reader<'r, 'c, 'p> {
    ctx: &'r mut TcCtx<'c, 'p>,
    declars: FxHashMap<NamePtr<'c>, &'r Declar<'c>>,
    props: &'r FxHashSet<NamePtr<'c>>,
    names: FxHashMap<String, NamePtr<'c>>,
    rendered: FxHashMap<NamePtr<'c>, String>,
    /// Declarations in export order.
    order: Vec<NamePtr<'c>>,
    ids: FxHashMap<NamePtr<'c>, String>,
    /// Declarations that depend on an ambiguous name.
    unidentified: FxHashSet<NamePtr<'c>>,
    groups: FxHashMap<NamePtr<'c>, String>,
    nodes: FxHashMap<(ExprPtr<'c>, Option<NamePtr<'c>>), String>,
    levels: FxHashMap<LevelPtr<'c>, String>,
}

impl<'r, 'c> Reader<'r, 'c, '_> {
    fn lookup(&self, name: &str) -> Result<(NamePtr<'c>, &'r Declar<'c>)> {
        let ptr = *self
            .names
            .get(name)
            .with_context(|| format!("unresolved declaration {name}"))?;
        Ok((ptr, self.declars[&ptr]))
    }

    /// Which of `names` the export declares.
    pub fn present(&self, names: &[&str]) -> BTreeSet<String> {
        names
            .iter()
            .filter(|n| self.names.contains_key(**n))
            .map(|n| n.to_string())
            .collect()
    }

    /// A theorem whose type is a proposition.
    pub fn is_theorem(&self, name: &str) -> Result<bool> {
        let (ptr, d) = self.lookup(name)?;
        Ok(matches!(d, Declar::Theorem { .. }) && self.props.contains(&ptr))
    }

    /// Any declaration whose type is a proposition, proved or assumed.
    pub fn is_proposition(&self, name: &str) -> Result<bool> {
        Ok(self.props.contains(&self.lookup(name)?.0))
    }

    pub fn identities(&mut self, names: &BTreeSet<String>) -> Result<BTreeMap<String, String>> {
        names
            .iter()
            .map(|n| Ok((n.clone(), self.id(self.lookup(n)?.0)?)))
            .collect()
    }

    /// Every identified theorem of a proposition, with its identity and the
    /// axioms it depends on, exactly as `axioms` reports them. One pass over
    /// the export in order reuses each declaration's result; it repeats only
    /// for references inside inductive blocks, which may point forward.
    pub fn theorems(&mut self) -> Result<Vec<(String, String, BTreeSet<String>)>> {
        let order = self.order.clone();
        let mut direct: FxHashMap<NamePtr<'c>, Vec<NamePtr<'c>>> = FxHashMap::default();
        for &name in &order {
            let refs = self.references(name)?;
            direct.insert(name, refs);
        }
        let mut sets: FxHashMap<NamePtr<'c>, FxHashSet<NamePtr<'c>>> = FxHashMap::default();
        loop {
            let mut changed = false;
            for &name in &order {
                let mut set = sets.get(&name).cloned().unwrap_or_default();
                let before = set.len();
                if matches!(self.declars[&name], Declar::Axiom { .. }) {
                    set.insert(name);
                }
                for r in &direct[&name] {
                    if let Some(s) = sets.get(r) {
                        set.extend(s.iter().copied());
                    }
                }
                if set.len() != before || !sets.contains_key(&name) {
                    changed |= set.len() != before;
                    sets.insert(name, set);
                }
            }
            if !changed {
                break;
            }
        }
        let mut out = Vec::new();
        for &name in &order {
            let theorem =
                matches!(self.declars[&name], Declar::Theorem { .. }) && self.props.contains(&name);
            let Some(id) = self.ids.get(&name).cloned() else {
                continue;
            };
            if theorem {
                let axioms = sets[&name]
                    .iter()
                    .map(|a| self.render(*a))
                    .collect::<Result<_>>()?;
                out.push((self.render(name)?, id, axioms));
            }
        }
        Ok(out)
    }

    /// The declarations one declaration refers to directly, as `axioms`
    /// follows them.
    fn references(&mut self, name: NamePtr<'c>) -> Result<Vec<NamePtr<'c>>> {
        let d = self.declars[&name];
        let mut out = Vec::new();
        let mut roots = vec![d.info().ty];
        match d {
            Declar::Axiom { .. } | Declar::Quot { .. } => {}
            Declar::Theorem { val, .. }
            | Declar::Definition { val, .. }
            | Declar::Opaque { val, .. } => roots.push(*val),
            Declar::Inductive(i) => {
                out.extend(i.all_ind_names.iter().chain(i.all_ctor_names.iter()))
            }
            Declar::Constructor(c) => out.push(c.inductive_name),
            Declar::Recursor(r) => {
                out.extend(r.all_inductives.iter());
                roots.extend(r.rec_rules.iter().map(|rule| rule.val));
            }
        }
        let mut seen = FxHashSet::default();
        while let Some(e) = roots.pop() {
            if !seen.insert(e) {
                continue;
            }
            match self.ctx.read_expr(e) {
                Expr::Const { name, .. } => out.push(name),
                Expr::Proj {
                    ty_name, structure, ..
                } => {
                    out.push(ty_name);
                    roots.push(structure);
                }
                Expr::NatLit { .. } => out.push(self.lookup("Nat")?.0),
                Expr::StringLit { .. } => {
                    for n in ["String", "String.ofList", "Char.ofNat", "List"] {
                        out.push(self.lookup(n)?.0);
                    }
                }
                Expr::App { fun, arg, .. } => roots.extend([fun, arg]),
                Expr::Pi {
                    binder_type, body, ..
                }
                | Expr::Lambda {
                    binder_type, body, ..
                } => roots.extend([binder_type, body]),
                Expr::Let {
                    binder_type,
                    val,
                    body,
                    ..
                } => roots.extend([binder_type, val, body]),
                Expr::Var { .. } | Expr::Sort { .. } => {}
                Expr::Local { .. } => bail!("free variable in export"),
            }
        }
        Ok(out)
    }

    /// Every axiom the declarations depend on, through types, values and proofs.
    pub fn axioms(&mut self, roots: &BTreeSet<String>) -> Result<BTreeSet<String>> {
        let mut pending = roots
            .iter()
            .map(|n| Ok(self.lookup(n)?.0))
            .collect::<Result<Vec<_>>>()?;
        let (mut seen, mut exprs, mut axioms) =
            (FxHashSet::default(), FxHashSet::default(), BTreeSet::new());
        while let Some(name) = pending.pop() {
            if !seen.insert(name) {
                continue;
            }
            let d = self.declars[&name];
            let mut roots = vec![d.info().ty];
            match d {
                Declar::Axiom { .. } => {
                    axioms.insert(self.render(name)?);
                }
                Declar::Theorem { val, .. }
                | Declar::Definition { val, .. }
                | Declar::Opaque { val, .. } => roots.push(*val),
                Declar::Inductive(i) => {
                    pending.extend(i.all_ind_names.iter().chain(i.all_ctor_names.iter()))
                }
                Declar::Constructor(c) => pending.push(c.inductive_name),
                Declar::Recursor(r) => {
                    pending.extend(r.all_inductives.iter());
                    roots.extend(r.rec_rules.iter().map(|rule| rule.val));
                }
                Declar::Quot { .. } => {}
            }
            while let Some(e) = roots.pop() {
                if !exprs.insert(e) {
                    continue;
                }
                match self.ctx.read_expr(e) {
                    Expr::Const { name, .. } => pending.push(name),
                    Expr::Proj {
                        ty_name, structure, ..
                    } => {
                        pending.push(ty_name);
                        roots.push(structure);
                    }
                    Expr::NatLit { .. } => pending.push(self.lookup("Nat")?.0),
                    // A string literal stands for `String.ofList [Char.ofNat n, …]`.
                    Expr::StringLit { .. } => {
                        for name in ["String", "String.ofList", "Char.ofNat", "List"] {
                            pending.push(self.lookup(name)?.0);
                        }
                    }
                    Expr::App { fun, arg, .. } => roots.extend([fun, arg]),
                    Expr::Pi {
                        binder_type, body, ..
                    }
                    | Expr::Lambda {
                        binder_type, body, ..
                    } => roots.extend([binder_type, body]),
                    Expr::Let {
                        binder_type,
                        val,
                        body,
                        ..
                    } => roots.extend([binder_type, val, body]),
                    Expr::Var { .. } | Expr::Sort { .. } => {}
                    Expr::Local { .. } => bail!("free variable in export"),
                }
            }
        }
        Ok(axioms)
    }

    /// The identity of a declaration already passed in export order.
    fn id(&self, name: NamePtr<'c>) -> Result<String> {
        if let Some(id) = self.ids.get(&name) {
            return Ok(id.clone());
        }
        if self.unidentified.contains(&name) {
            return Err(Ambiguous(format!("{name:?}")).into());
        }
        bail!("declaration used before it is declared")
    }

    fn identify(&mut self, name: NamePtr<'c>) -> Result<()> {
        let d = self.declars[&name];
        let id = if let Some(first) = self.group_of(name) {
            let group = self.group(first)?;
            hash(
                "zklean/declaration/1\0",
                &json!({"member": {"group": group, "name": self.render(name)?}}),
            )?
        } else {
            let info = *d.info();
            let mut fields = json!({
                "name": self.render(name)?,
                "levelParams": self.params(info.uparams)?,
                "type": self.node(info.ty, None)?,
            });
            // A proof is irrelevant: a proposition is identified by its statement.
            let (kind, value) = match d {
                _ if self.props.contains(&name) => ("prop", None),
                Declar::Definition { val, .. } => ("def", Some(*val)),
                Declar::Opaque { val, .. } => ("opaque", Some(*val)),
                Declar::Axiom { .. } => ("axiom", None),
                Declar::Quot { .. } => ("quot", None),
                _ => bail!("unexpected declaration kind"),
            };
            if let Some(val) = value {
                fields["value"] = Value::String(self.node(val, None)?);
            }
            hash("zklean/declaration/1\0", &json!({ kind: fields }))?
        };
        self.ids.insert(name, id);
        Ok(())
    }

    /// The kernel's input for a mutual inductive block: its universe
    /// parameters, parameter count, and types with their constructors.
    /// Recursors are derived from these, and references inside the block
    /// carry no identity, which breaks the cycle.
    fn group(&mut self, first: NamePtr<'c>) -> Result<String> {
        if let Some(id) = self.groups.get(&first) {
            return Ok(id.clone());
        }
        let Declar::Inductive(head) = self.declars[&first] else {
            bail!("inductive group without an inductive type");
        };
        let mut types = Vec::new();
        for ty in head.all_ind_names.iter() {
            let Declar::Inductive(i) = self.declars[ty] else {
                bail!("inductive group member is not an inductive type");
            };
            // Members are found through their own lists, which must agree.
            ensure!(
                i.all_ind_names == head.all_ind_names,
                "inductive block members list the block differently"
            );
            let mut ctors = Vec::new();
            for ctor in i.all_ctor_names.iter() {
                let ty = self.declars[ctor].info().ty;
                ctors.push(
                    json!({"name": self.render(*ctor)?, "type": self.node(ty, Some(first))?}),
                );
            }
            types.push(json!({
                "name": self.render(*ty)?,
                "type": self.node(i.info.ty, Some(first))?,
                "ctors": ctors,
            }));
        }
        let id = hash(
            "zklean/declaration/1\0",
            &json!({"inductive": {
                "levelParams": self.params(head.info.uparams)?,
                "numParams": head.num_params,
                "types": types,
            }}),
        )?;
        self.groups.insert(first, id.clone());
        Ok(id)
    }

    /// The first type of the inductive block declaring `name`, if any.
    fn group_of(&self, name: NamePtr<'c>) -> Option<NamePtr<'c>> {
        match self.declars.get(&name)? {
            Declar::Inductive(i) => Some(i.all_ind_names[0]),
            Declar::Constructor(c) => self.group_of(c.inductive_name),
            Declar::Recursor(r) => self.group_of(r.all_inductives[0]),
            _ => None,
        }
    }

    /// A constant reference as canonical JSON values: its identity, or `null`
    /// inside the inductive group being hashed, and its name.
    fn reference(
        &mut self,
        name: NamePtr<'c>,
        group: Option<NamePtr<'c>>,
    ) -> Result<(String, String)> {
        let inside = group.is_some() && self.group_of(name) == group;
        let id = if inside {
            "null".to_owned()
        } else {
            format!(r#""{}""#, self.id(name)?)
        };
        Ok((id, quote(&self.render(name)?)))
    }

    /// Nodes are hashed Merkle-style, children first. An explicit work stack
    /// keeps deep expressions from exhausting the stack.
    fn node(&mut self, root: ExprPtr<'c>, group: Option<NamePtr<'c>>) -> Result<String> {
        let mut work = vec![root];
        while let Some(&e) = work.last() {
            if self.nodes.contains_key(&(e, group)) {
                work.pop();
                continue;
            }
            let pending: Vec<_> = self
                .children(e)
                .into_iter()
                .filter(|c| !self.nodes.contains_key(&(*c, group)))
                .collect();
            if pending.is_empty() {
                work.pop();
                let h = self.hash_node(e, group)?;
                self.nodes.insert((e, group), h);
            } else {
                work.extend(pending);
            }
        }
        Ok(self.nodes[&(root, group)].clone())
    }

    fn children(&self, e: ExprPtr<'c>) -> Vec<ExprPtr<'c>> {
        match self.ctx.read_expr(e) {
            Expr::App { fun, arg, .. } => vec![fun, arg],
            Expr::Pi {
                binder_type, body, ..
            }
            | Expr::Lambda {
                binder_type, body, ..
            } => vec![binder_type, body],
            Expr::Let {
                binder_type,
                val,
                body,
                ..
            } => vec![binder_type, val, body],
            Expr::Proj { structure, .. } => vec![structure],
            _ => vec![],
        }
    }

    /// One node, its children already hashed. Binder names, binder annotations
    /// and let hints do not affect meaning and are omitted. Node shapes are
    /// fixed, so their canonical JSON is written directly, keys in byte order.
    fn hash_node(&mut self, e: ExprPtr<'c>, group: Option<NamePtr<'c>>) -> Result<String> {
        let h = |this: &Self, c: ExprPtr<'c>| this.nodes[&(c, group)].clone();
        let node = match self.ctx.read_expr(e) {
            Expr::Var { dbj_idx, .. } => format!(r#"{{"bvar":{dbj_idx}}}"#),
            Expr::Sort { level, .. } => format!(r#"{{"sort":"{}"}}"#, self.level(level)?),
            Expr::Const { name, levels, .. } => {
                let (id, name) = self.reference(name, group)?;
                let us = self.levels(levels)?;
                format!(r#"{{"const":{{"id":{id},"name":{name},"us":{us}}}}}"#)
            }
            Expr::App { fun, arg, .. } => format!(
                r#"{{"app":{{"arg":"{}","fn":"{}"}}}}"#,
                h(self, arg),
                h(self, fun)
            ),
            Expr::Pi {
                binder_type, body, ..
            } => format!(
                r#"{{"forallE":{{"body":"{}","type":"{}"}}}}"#,
                h(self, body),
                h(self, binder_type)
            ),
            Expr::Lambda {
                binder_type, body, ..
            } => format!(
                r#"{{"lam":{{"body":"{}","type":"{}"}}}}"#,
                h(self, body),
                h(self, binder_type)
            ),
            Expr::Let {
                binder_type,
                val,
                body,
                ..
            } => format!(
                r#"{{"letE":{{"body":"{}","type":"{}","value":"{}"}}}}"#,
                h(self, body),
                h(self, binder_type),
                h(self, val)
            ),
            Expr::Proj {
                ty_name,
                idx,
                structure,
                ..
            } => {
                let (id, name) = self.reference(ty_name, group)?;
                format!(
                    r#"{{"proj":{{"id":{id},"idx":{idx},"name":{name},"struct":"{}"}}}}"#,
                    h(self, structure)
                )
            }
            Expr::NatLit { ptr, .. } => {
                let value = self.ctx.read_bignum(ptr).context("natural literal")?;
                let ty = self.id(self.lookup("Nat")?.0)?;
                format!(r#"{{"natVal":{{"type":"{ty}","value":"{value}"}}}}"#)
            }
            Expr::StringLit { ptr, .. } => {
                let value = serde_json::to_string(self.ctx.read_string(ptr).as_ref())?;
                let ty = self.id(self.lookup("String")?.0)?;
                format!(r#"{{"strVal":{{"type":"{ty}","value":{value}}}}}"#)
            }
            Expr::Local { .. } => bail!("free variable in export"),
        };
        Ok(digest(&node))
    }

    fn level(&mut self, l: LevelPtr<'c>) -> Result<String> {
        if let Some(h) = self.levels.get(&l) {
            return Ok(h.clone());
        }
        let node = match self.ctx.read_level(l) {
            Level::Zero => r#"{"zero":true}"#.to_owned(),
            Level::Succ(l, _) => format!(r#"{{"succ":"{}"}}"#, self.level(l)?),
            Level::Max(a, b, _) => {
                format!(r#"{{"max":["{}","{}"]}}"#, self.level(a)?, self.level(b)?)
            }
            Level::IMax(a, b, _) => {
                format!(r#"{{"imax":["{}","{}"]}}"#, self.level(a)?, self.level(b)?)
            }
            Level::Param(n, _) => format!(r#"{{"param":{}}}"#, quote(&self.render(n)?)),
        };
        let h = digest(&node);
        self.levels.insert(l, h.clone());
        Ok(h)
    }

    /// Canonical JSON of the level hashes, as a string for embedding.
    fn levels(&mut self, ls: LevelsPtr<'c>) -> Result<String> {
        let ls = self.ctx.read_levels(ls);
        let hashes = ls
            .iter()
            .map(|l| Ok(format!(r#""{}""#, self.level(*l)?)))
            .collect::<Result<Vec<_>>>()?;
        Ok(format!("[{}]", hashes.join(",")))
    }

    fn params(&mut self, ls: LevelsPtr<'c>) -> Result<Value> {
        let ls = self.ctx.read_levels(ls);
        let mut names = Vec::new();
        for l in ls.iter() {
            let Level::Param(n, _) = self.ctx.read_level(*l) else {
                bail!("universe parameter is not a name");
            };
            names.push(Value::String(self.render(n)?));
        }
        Ok(Value::Array(names))
    }

    /// Dotted Lean name, quoting components as Lean does so that distinct
    /// names never render alike. A component containing `«` or `»` cannot be
    /// rendered.
    fn render(&mut self, name: NamePtr<'c>) -> Result<String> {
        if let Some(r) = self.rendered.get(&name) {
            return Ok(r.clone());
        }
        let (prefix, part) = match self.ctx.read_name(name) {
            Name::Anon => return Ok(String::new()),
            Name::Str(pre, s, _) => {
                let s = self.ctx.read_string(s).to_string();
                if s.contains('«') || s.contains('»') {
                    return Err(Ambiguous(s).into());
                }
                // Lean's own quoting keeps the rendering unambiguous: a
                // component that is empty, contains a dot, or is all digits
                // like a numeric component is written `«…»`.
                let s = if s.is_empty() || s.contains('.') || s.chars().all(|c| c.is_ascii_digit())
                {
                    format!("«{s}»")
                } else {
                    s
                };
                (self.render(pre)?, s)
            }
            Name::Num(pre, n, _) => (self.render(pre)?, n.to_string()),
        };
        let rendered = if prefix.is_empty() {
            part
        } else {
            format!("{prefix}.{part}")
        };
        self.rendered.insert(name, rendered.clone());
        Ok(rendered)
    }
}
