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
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

fn hash(domain: &str, value: &Value) -> Result<String> {
    let mut digest = Sha256::new();
    digest.update(domain.as_bytes());
    digest.update(crate::canonical(value)?);
    Ok(format!("{:x}", digest.finalize()))
}

/// Read a checked export. Declarations whose type is a proposition are
/// decided by the checker first. Nanoda checks each declaration against only
/// those before it, so the export is in dependency order and every identity is
/// computed in one forward pass, without recursing through dependencies.
pub fn read<'p, A>(
    file: &'p ExportFile<'p>,
    f: impl FnOnce(&mut Reader<'_, '_, 'p>) -> Result<A>,
) -> Result<A> {
    let mut props = HashSet::new();
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
            declars: HashMap::new(),
            props: &props,
            names: HashMap::new(),
            rendered: HashMap::new(),
            ids: HashMap::new(),
            groups: HashMap::new(),
            nodes: HashMap::new(),
            levels: HashMap::new(),
        };
        for (name, d) in &file.declars {
            let rendered = reader.render(*name)?;
            reader.names.insert(rendered, *name);
            reader.declars.insert(*name, d);
        }
        for name in file.declars.keys() {
            reader.identify(*name)?;
        }
        f(&mut reader)
    })
}

pub struct Reader<'r, 'c, 'p> {
    ctx: &'r mut TcCtx<'c, 'p>,
    declars: HashMap<NamePtr<'c>, &'r Declar<'c>>,
    props: &'r HashSet<NamePtr<'c>>,
    names: HashMap<String, NamePtr<'c>>,
    rendered: HashMap<NamePtr<'c>, String>,
    ids: HashMap<NamePtr<'c>, String>,
    groups: HashMap<NamePtr<'c>, String>,
    nodes: HashMap<(ExprPtr<'c>, Option<NamePtr<'c>>), String>,
    levels: HashMap<LevelPtr<'c>, String>,
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

    /// Every axiom the declarations depend on, through types, values and proofs.
    pub fn axioms(&mut self, roots: &BTreeSet<String>) -> Result<BTreeSet<String>> {
        let mut pending = roots
            .iter()
            .map(|n| Ok(self.lookup(n)?.0))
            .collect::<Result<Vec<_>>>()?;
        let (mut seen, mut exprs, mut axioms) = (HashSet::new(), HashSet::new(), BTreeSet::new());
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
        self.ids
            .get(&name)
            .cloned()
            .context("declaration used before it is declared")
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
                Declar::Theorem { val, .. } => ("thm", Some(*val)),
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

    /// A constant reference: its name and identity, or no identity inside the
    /// inductive group being hashed.
    fn reference(&mut self, name: NamePtr<'c>, group: Option<NamePtr<'c>>) -> Result<Value> {
        let inside = group.is_some() && self.group_of(name) == group;
        Ok(json!({
            "name": self.render(name)?,
            "id": if inside { Value::Null } else { Value::String(self.id(name)?) },
        }))
    }

    /// Nodes are hashed Merkle-style. Binder names, binder annotations and let
    /// hints do not affect meaning and are omitted.
    fn node(&mut self, e: ExprPtr<'c>, group: Option<NamePtr<'c>>) -> Result<String> {
        if let Some(h) = self.nodes.get(&(e, group)) {
            return Ok(h.clone());
        }
        let node = match self.ctx.read_expr(e) {
            Expr::Var { dbj_idx, .. } => json!({"bvar": dbj_idx}),
            Expr::Sort { level, .. } => json!({"sort": self.level(level)?}),
            Expr::Const { name, levels, .. } => {
                let mut r = self.reference(name, group)?;
                r["us"] = self.levels(levels)?;
                json!({ "const": r })
            }
            Expr::App { fun, arg, .. } => {
                json!({"app": {"fn": self.node(fun, group)?, "arg": self.node(arg, group)?}})
            }
            Expr::Pi {
                binder_type, body, ..
            } => json!({"forallE": {
                "type": self.node(binder_type, group)?, "body": self.node(body, group)?}}),
            Expr::Lambda {
                binder_type, body, ..
            } => json!({"lam": {
                "type": self.node(binder_type, group)?, "body": self.node(body, group)?}}),
            Expr::Let {
                binder_type,
                val,
                body,
                ..
            } => json!({"letE": {
                "type": self.node(binder_type, group)?,
                "value": self.node(val, group)?,
                "body": self.node(body, group)?}}),
            Expr::Proj {
                ty_name,
                idx,
                structure,
                ..
            } => {
                let mut r = self.reference(ty_name, group)?;
                r["idx"] = json!(idx);
                r["struct"] = Value::String(self.node(structure, group)?);
                json!({ "proj": r })
            }
            Expr::NatLit { ptr, .. } => {
                let value = self
                    .ctx
                    .read_bignum(ptr)
                    .context("natural literal")?
                    .to_string();
                json!({"natVal": {"value": value, "type": self.id(self.lookup("Nat")?.0)?}})
            }
            Expr::StringLit { ptr, .. } => {
                let value = self.ctx.read_string(ptr).to_string();
                json!({"strVal": {"value": value, "type": self.id(self.lookup("String")?.0)?}})
            }
            Expr::Local { .. } => bail!("free variable in export"),
        };
        let h = hash("zklean/node/1\0", &node)?;
        self.nodes.insert((e, group), h.clone());
        Ok(h)
    }

    fn level(&mut self, l: LevelPtr<'c>) -> Result<String> {
        if let Some(h) = self.levels.get(&l) {
            return Ok(h.clone());
        }
        let node = match self.ctx.read_level(l) {
            Level::Zero => json!({"zero": true}),
            Level::Succ(l, _) => json!({"succ": self.level(l)?}),
            Level::Max(a, b, _) => json!({"max": [self.level(a)?, self.level(b)?]}),
            Level::IMax(a, b, _) => json!({"imax": [self.level(a)?, self.level(b)?]}),
            Level::Param(n, _) => json!({"param": self.render(n)?}),
        };
        let h = hash("zklean/node/1\0", &node)?;
        self.levels.insert(l, h.clone());
        Ok(h)
    }

    fn levels(&mut self, ls: LevelsPtr<'c>) -> Result<Value> {
        let ls = self.ctx.read_levels(ls);
        Ok(Value::Array(
            ls.iter()
                .map(|l| Ok(Value::String(self.level(*l)?)))
                .collect::<Result<_>>()?,
        ))
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

    /// Dotted Lean name. Components that would make the rendering ambiguous
    /// (empty, containing a dot, or all digits like a numeric component) are
    /// rejected.
    fn render(&mut self, name: NamePtr<'c>) -> Result<String> {
        if let Some(r) = self.rendered.get(&name) {
            return Ok(r.clone());
        }
        let (prefix, part) = match self.ctx.read_name(name) {
            Name::Anon => return Ok(String::new()),
            Name::Str(pre, s, _) => {
                let s = self.ctx.read_string(s).to_string();
                ensure!(
                    !s.is_empty() && !s.contains('.') && !s.chars().all(|c| c.is_ascii_digit()),
                    "ambiguous name component"
                );
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
