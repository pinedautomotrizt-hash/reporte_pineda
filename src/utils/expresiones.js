function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Normaliza los filtros recibidos por query string para los endpoints del dashboard.
export function parseFilters(req) {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "")
    ? req.query.month
    : currentMonth();
  const local =
    req.query.local && req.query.local !== "Todos"
      ? String(req.query.local)
      : null;
  const meta = Number(req.query.meta || 2500000);
  const comision = Number(req.query.comision || 0);
  const tipoCambio = Number(req.query.tipoCambio || 3.75);
  const start = `${month}-01`;
  return {
    month,
    start,
    local,
    meta: Number.isFinite(meta) ? meta : 2500000,
    comision: Number.isFinite(comision) ? comision : 0,
    tipoCambio:
      Number.isFinite(tipoCambio) && tipoCambio > 0 ? tipoCambio : 3.75,
  };
}

// Devuelve una condicion SQL opcional para filtrar por local.
 export function localClause(local, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return local ? ` AND ${prefix}local_nombre = :local` : "";
}



// Expresion usada para calcular importes netos: las notas restan al total. pendiente ----------------
export const netExpr =
  "CASE WHEN tipo_documento LIKE 'Nota%' THEN -importe ELSE importe END";
