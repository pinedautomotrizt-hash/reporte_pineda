import { query, pool } from "./src/db.js";

console.log("=== OT de Karen (Trujillo) abiertas/cerradas 09 al 13 de agosto ===");
const ots = await query(`
  SELECT DISTINCT nro_orden, fec_apertura, fec_cierre, estado, cliente_nombre, placa
  FROM orden_trabajo
  WHERE UPPER(TRIM(local_nombre)) LIKE '%TRUJILLO%'
    AND UPPER(TRIM(asesor)) = 'ROSAS CADEÑO KAREN GINEHT'
    AND (
      (fec_apertura BETWEEN '2026-08-09' AND '2026-08-13')
      OR (fec_cierre BETWEEN '2026-08-09' AND '2026-08-13')
    )
  ORDER BY fec_apertura
`);
console.log("Total OT:", ots.length);

let sinDetalle = [];
for (const ot of ots) {
  const detalles = await query(`
    SELECT DISTINCT nro_documento, fec_emision
    FROM detalle_factura_ot
    WHERE UPPER(TRIM(local_nombre)) LIKE '%TRUJILLO%' AND nro_ot = :nroOrden
  `, { nroOrden: ot.nro_orden });
  if (detalles.length === 0) {
    sinDetalle.push(ot);
    console.log(`OT ${ot.nro_orden} (apertura ${ot.fec_apertura}, cierre ${ot.fec_cierre}, estado ${ot.estado}, cliente ${ot.cliente_nombre}) -> SIN detalle_factura_ot`);
  }
}
console.log("Total OT sin detalle:", sinDetalle.length);

console.log("\n=== Clases de venta distintas de SERVICIOS en Trujillo, agosto (Pago Especial, Pagos Varios, etc.) ===");
const especiales = await query(`
  SELECT nro_documento, fec_documento, clase_venta, valor_gravado, asesor_operacion, operacion_relacionada
  FROM registro_venta
  WHERE UPPER(TRIM(local_nombre)) LIKE '%TRUJILLO%'
    AND UPPER(TRIM(clase_venta)) NOT IN ('SERVICIOS', 'MOSTRADOR')
    AND fec_documento LIKE '2026-08%'
  ORDER BY fec_documento
`);
console.log(JSON.stringify(especiales, null, 2));

console.log("\n=== Buscando 708.82 exacto en cualquier parte de agosto (registro_venta) ===");
const buscar = await query(`
  SELECT nro_documento, local_nombre, fec_documento, valor_gravado, asesor_operacion, clase_venta, estado, estado_sunat
  FROM registro_venta
  WHERE fec_documento LIKE '2026-08%'
    AND REPLACE(TRIM(valor_gravado), ',', '') = '708.82'
`);
console.log(JSON.stringify(buscar, null, 2));

await pool.end();
process.exit(0);
