Vendored from https://github.com/ammkrn/nanoda_lib at
998e0a84e4c1572ca279ff05007af6ec6639405a (Apache-2.0).

Local change: expose `parser::parse_export_file` publicly so the SP1 guest can
parse an in-memory export without filesystem or host stdin access. The checker
and its configuration semantics are unchanged. Only serial checking is enabled.
