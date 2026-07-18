import XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "fs";
import { pool, query } from "../src/db.js";

// Convierte los tres componentes contables en el importe oficial sin IGV.
function montoSinIgv(row) {
  return ["valor_gravado", "valor_exonerado", "valor_inafecto"].reduce(
    (total, key) => total + (Number(String(row[key] || 0).replaceAll(",", "")) || 0),
    0,
  );
}

// Extrae PAGO ESPECIAL y genera un libro listo para revisión gerencial.
async function exportar() {
  const rows = await query(`
    SELECT *
    FROM registro_venta
    WHERE UPPER(TRIM(clase_venta)) = 'PAGO ESPECIAL'
    ORDER BY
      STR_TO_DATE(NULLIF(TRIM(fec_documento), ''), '%Y-%m-%d'),
      local_nombre,
      nro_documento
  `);
  const vigentes = rows.filter(
    (row) => String(row.estado || "").trim().toUpperCase() !== "ANULADO"
      && String(row.estado_sunat || "").trim().toUpperCase() === "APROBADO",
  );
  const resumen = [
    { Indicador: "Total de registros", Valor: rows.length },
    { Indicador: "Documentos aprobados y vigentes", Valor: vigentes.length },
    { Indicador: "Documentos observados o anulados", Valor: rows.length - vigentes.length },
    { Indicador: "Monto vigente sin IGV", Valor: vigentes.reduce((sum, row) => sum + montoSinIgv(row), 0) },
  ];
  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.json_to_sheet(resumen);
  summarySheet["!cols"] = [{ wch: 36 }, { wch: 22 }];
  const detailSheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Mensaje: "No se encontraron pagos especiales" }]);
  detailSheet["!autofilter"] = { ref: detailSheet["!ref"] };
  detailSheet["!cols"] = Object.keys(rows[0] || { Mensaje: "" }).map((key) => ({
    wch: Math.min(38, Math.max(14, key.length + 2)),
  }));
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumen");
  XLSX.utils.book_append_sheet(workbook, detailSheet, "Pagos especiales");
  mkdirSync("reportes", { recursive: true });
  const output = "reportes/pagos_especiales_registro_venta.xlsx";
  writeFileSync(output, XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }));
  console.log(JSON.stringify({ output, registros: rows.length, vigentes: vigentes.length, montoSinIgv: vigentes.reduce((sum, row) => sum + montoSinIgv(row), 0) }));
  await pool.end();
}

exportar().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
