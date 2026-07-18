import XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "fs";
import { pool, query } from "../src/db.js";

// Extrae el detalle de P&P Callao y conserva las NC aprobadas con signo negativo.
async function obtenerDetalle() {
  return query(`
    SELECT DISTINCT
      rv.fec_documento AS fecha,
      rv.local_nombre AS sede,
      rv.tipo_documento,
      rv.nro_documento,
      rv.operacion_relacionada AS documento_afectado,
      rv.cliente_documento,
      rv.cliente_nombre,
      rv.moneda,
      df.nro_ot,
      df.placa,
      df.grupo_servicio,
      df.clase_ot,
      df.tipo_ot,
      df.asesor AS asesor_ot,
      ROUND(
        CASE
          WHEN UPPER(TRIM(rv.tipo_documento)) IN ('NC', 'NOTA DE CREDITO', 'NOTA DE CRÉDITO')
          THEN -ABS(
            COALESCE(CAST(NULLIF(REPLACE(TRIM(rv.valor_gravado), ',', ''), '') AS DECIMAL(15,2)), 0)
            + COALESCE(CAST(NULLIF(REPLACE(TRIM(rv.valor_exonerado), ',', ''), '') AS DECIMAL(15,2)), 0)
            + COALESCE(CAST(NULLIF(REPLACE(TRIM(rv.valor_inafecto), ',', ''), '') AS DECIMAL(15,2)), 0)
          )
          ELSE
            COALESCE(CAST(NULLIF(REPLACE(TRIM(rv.valor_gravado), ',', ''), '') AS DECIMAL(15,2)), 0)
            + COALESCE(CAST(NULLIF(REPLACE(TRIM(rv.valor_exonerado), ',', ''), '') AS DECIMAL(15,2)), 0)
            + COALESCE(CAST(NULLIF(REPLACE(TRIM(rv.valor_inafecto), ',', ''), '') AS DECIMAL(15,2)), 0)
        END,
        2
      ) AS importe_contable_sin_igv,
      CASE
        WHEN UPPER(TRIM(rv.tipo_documento)) IN ('NC', 'NOTA DE CREDITO', 'NOTA DE CRÉDITO')
          THEN 'DESCUENTO POR NOTA DE CRÉDITO'
        ELSE 'VENTA'
      END AS movimiento,
      rv.estado,
      rv.estado_sunat
    FROM registro_venta rv
    LEFT JOIN detalle_factura_ot df
      ON df.local_nombre = rv.local_nombre
      AND (
        df.nro_documento = rv.nro_documento
        OR (
          UPPER(TRIM(rv.tipo_documento)) IN ('NC', 'NOTA DE CREDITO', 'NOTA DE CRÉDITO')
          AND df.nro_documento = rv.operacion_relacionada
        )
      )
    WHERE rv.local_nombre = 'Pineda Callao'
      AND COALESCE(UPPER(TRIM(rv.estado)), '') <> 'ANULADO'
      AND UPPER(TRIM(rv.estado_sunat)) = 'APROBADO'
      AND (
        UPPER(COALESCE(df.grupo_servicio, '')) LIKE '%CARROCER%'
        OR UPPER(COALESCE(df.grupo_servicio, '')) LIKE '%PINTURA%'
        OR UPPER(COALESCE(df.clase_ot, '')) LIKE '%CARROCER%'
        OR UPPER(COALESCE(df.clase_ot, '')) LIKE '%PINTURA%'
        OR UPPER(COALESCE(df.tipo_ot, '')) LIKE '%CARROCER%'
        OR UPPER(COALESCE(df.tipo_ot, '')) LIKE '%PINTURA%'
      )
      AND STR_TO_DATE(rv.fec_documento, '%Y-%m-%d') >= '2026-07-01'
      AND STR_TO_DATE(rv.fec_documento, '%Y-%m-%d') < '2026-08-01'
    ORDER BY STR_TO_DATE(rv.fec_documento, '%Y-%m-%d'), rv.nro_documento, df.nro_ot
  `);
}

// Genera una hoja gerencial y otra con todas las filas de la consulta.
async function exportar() {
  const detalle = await obtenerDetalle();
  const documentos = new Map();
  for (const row of detalle) {
    const key = `${row.sede}|${row.nro_documento}`;
    if (!documentos.has(key)) documentos.set(key, row);
  }
  const unicos = [...documentos.values()];
  const ventas = unicos.filter((row) => row.movimiento === "VENTA");
  const notas = unicos.filter((row) => row.movimiento !== "VENTA");
  const total = unicos.reduce((sum, row) => sum + Number(row.importe_contable_sin_igv || 0), 0);
  const resumen = [
    { Indicador: "Periodo", Valor: "Julio 2026" },
    { Indicador: "Sede", Valor: "Pineda Callao" },
    { Indicador: "Documentos únicos", Valor: unicos.length },
    { Indicador: "Ventas", Valor: ventas.length },
    { Indicador: "Notas de crédito", Valor: notas.length },
    { Indicador: "Filas de detalle OT", Valor: detalle.length },
    { Indicador: "Total contable sin IGV", Valor: Number(total.toFixed(2)) },
    { Indicador: "Criterio", Valor: "Carrocería o pintura en grupo, clase o tipo de OT" },
  ];

  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.json_to_sheet(resumen);
  summarySheet["!cols"] = [{ wch: 30 }, { wch: 58 }];
  const detailSheet = XLSX.utils.json_to_sheet(detalle.length ? detalle : [{ Mensaje: "No se encontraron documentos P&P para julio de 2026" }]);
  detailSheet["!autofilter"] = { ref: detailSheet["!ref"] };
  detailSheet["!cols"] = Object.keys(detalle[0] || { Mensaje: "" }).map((key) => ({ wch: Math.min(34, Math.max(14, key.length + 2)) }));
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumen");
  XLSX.utils.book_append_sheet(workbook, detailSheet, "Detalle P&P Callao");

  mkdirSync("reportes", { recursive: true });
  const output = "reportes/facturacion_pyp_callao_julio_2026.xlsx";
  writeFileSync(output, XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }));
  console.log(JSON.stringify({ output, documentos: unicos.length, filasDetalle: detalle.length, totalSinIgv: Number(total.toFixed(2)) }));
  await pool.end();
}

exportar().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
