import { query, pool } from "./src/db.js";

const saleDate = "STR_TO_DATE(NULLIF(TRIM(fec_documento), ''), '%Y-%m-%d')";

console.log("=== 11-Ago, Callao (Genesis) ===");
const [dia11] = await query(`
  SELECT COUNT(*) AS docs, COALESCE(SUM(
    CAST(NULLIF(REPLACE(TRIM(valor_gravado), ',', ''), '') AS DECIMAL(14,2))
    + CAST(NULLIF(REPLACE(TRIM(valor_exonerado), ',', ''), '') AS DECIMAL(14,2))
    + CAST(NULLIF(REPLACE(TRIM(valor_inafecto), ',', ''), '') AS DECIMAL(14,2))
  ), 0) AS total
  FROM registro_venta
  WHERE UPPER(TRIM(local_nombre)) LIKE '%CALLAO%' AND ${saleDate} = '2026-08-11'
    AND COALESCE(UPPER(TRIM(estado)), '') <> 'ANULADO'
`);
console.log("Documentos:", dia11.docs, " Total:", dia11.total, " (contadora: 11,594.99)");

console.log("\n=== 12-Ago, Trujillo (Karen) ===");
const dia12 = await query(`
  SELECT nro_documento, valor_gravado
  FROM registro_venta
  WHERE UPPER(TRIM(local_nombre)) LIKE '%TRUJILLO%' AND ${saleDate} = '2026-08-12'
    AND UPPER(TRIM(asesor_operacion)) = 'ROSAS CADEÑO KAREN GINEHT'
`);
const totalKaren12 = dia12.reduce((s, r) => s + Number(String(r.valor_gravado).replace(/,/g,'')), 0);
console.log("Documentos de Karen:", dia12.length, " Total:", totalKaren12.toFixed(2), " (contadora: 3,897.55)");

console.log("\n=== 08-Ago, Callao: documento PAGOS VARIOS ===");
const pagosVarios = await query(`
  SELECT nro_documento, clase_venta, valor_gravado
  FROM registro_venta
  WHERE UPPER(TRIM(local_nombre)) LIKE '%CALLAO%' AND ${saleDate} = '2026-08-08'
    AND UPPER(TRIM(clase_venta)) = 'PAGOS VARIOS'
`);
console.log(JSON.stringify(pagosVarios, null, 2));

await pool.end();
process.exit(0);
