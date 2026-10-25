Vendored from https://github.com/ammkrn/nanoda_lib at
998e0a84e4c1572ca279ff05007af6ec6639405a (Apache-2.0).

Local changes, both visibility only:

- `parser::parse_export_file` is public, so the SP1 guest can parse an
  in-memory export without filesystem or host stdin access.
- `InductiveData`'s `info`, `num_params`, `all_ind_names` and `all_ctor_names`
  are public, so declaration identities can be computed from the checked
  environment.

The checker and its configuration semantics are unchanged. Only serial
checking is enabled.
