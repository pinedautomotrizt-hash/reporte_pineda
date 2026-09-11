import mysql from 'mysql2/promise';
import XLSX from 'xlsx-js-style';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [connectionUri, outputFile] = process.argv.slice(2);
if (!connectionUri || !outputFile) throw new Error('Se requiere URL MySQL y archivo de salida.');

const pool = mysql.createPool({ uri: connectionUri });
try {
  const [rows] = await pool.execute(`
    SELECT
      DATE_FORMAT(STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d'), '%Y-%m') AS mes,
      COALESCE(NULLIF(TRIM(local_nombre), ''), 'Sin sede') AS sede,
      CASE
        WHEN UPPER(TRIM(actividad)) LIKE 'REFRIGERANTE%' OR UPPER(TRIM(actividad)) LIKE 'COOLANT%' THEN 'Refrigerante'
        WHEN UPPER(TRIM(actividad)) LIKE 'ACEITE ATF%' OR UPPER(TRIM(actividad)) LIKE 'ATF%' OR UPPER(TRIM(actividad)) LIKE 'ACEITE DE CAJA%' THEN 'Aceite para caja'
        WHEN UPPER(TRIM(actividad)) LIKE 'GRASA%' THEN 'Grasas'
      END AS insumo,
      SUM(COALESCE(CAST(NULLIF(TRIM(cantidad), '') AS DECIMAL(12,2)), 0)) AS cantidad,
      SUM(COALESCE(CAST(NULLIF(REPLACE(TRIM(costo), ',', ''), '') AS DECIMAL(14,2)), 0)) AS gasto_total
    FROM orden_trabajo
    WHERE STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d') >= '2026-01-01'
      AND STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d') < '2027-01-01'
      AND UPPER(TRIM(origen_codigo)) IN ('REPUESTO', 'REPUESTOS', 'RPTO')
      AND (
        UPPER(TRIM(actividad)) LIKE 'REFRIGERANTE%'
        OR UPPER(TRIM(actividad)) LIKE 'COOLANT%'
        OR UPPER(TRIM(actividad)) LIKE 'ACEITE ATF%'
        OR UPPER(TRIM(actividad)) LIKE 'ATF%'
        OR UPPER(TRIM(actividad)) LIKE 'ACEITE DE CAJA%'
        OR UPPER(TRIM(actividad)) LIKE 'GRASA%'
      )
    GROUP BY mes, sede, insumo
    ORDER BY mes, sede, insumo
  `);

  const detailRows = rows.map((row) => ({
    Mes: row.mes,
    Sede: row.sede,
    Insumo: row.insumo,
    'Cantidad registrada': Number(row.cantidad),
    'Gasto total (S/)': Number(row.gasto_total),
  }));
  const details = XLSX.utils.json_to_sheet(detailRows);
  details['!cols'] = [12, 24, 22, 22, 20].map((wch) => ({ wch }));
  details['!autofilter'] = { ref: `A1:E${detailRows.length + 1}` };

  const groups = new Map();
  rows.filter((row) => String(row.mes) <= '2026-08').forEach((row) => {
    const key = `${row.sede}|${row.insumo}`;
    groups.set(key, { sede: row.sede, insumo: row.insumo });
  });
  const summaryRows = [...groups.values()].map((row) => ({
    Periodo: 'Enero-agosto 2026', Sede: row.sede, Insumo: row.insumo,
    'Promedio mensual cantidad': null, 'Promedio mensual gasto (S/)': null,
  }));
  const summary = XLSX.utils.json_to_sheet(summaryRows);
  summary['!cols'] = [22, 24, 22, 30, 30].map((wch) => ({ wch }));
  summary['!autofilter'] = { ref: `A1:E${summaryRows.length + 1}` };

  [details, summary].forEach((sheet, sheetIndex) => {
    const endColumn = sheetIndex ? 'E' : 'E';
    for (let col = 'A'.charCodeAt(0); col <= endColumn.charCodeAt(0); col += 1) {
      const cell = `${String.fromCharCode(col)}1`;
      sheet[cell].s = { fill: { fgColor: { rgb: '1E3A8A' } }, font: { bold: true, color: { rgb: 'FFFFFF' } } };
    }
  });
  detailRows.forEach((_, index) => {
    const row = index + 2;
    details[`D${row}`].z = '#,##0.00';
    details[`E${row}`].z = 'S/ #,##0.00';
  });
  summaryRows.forEach((_, index) => {
    const row = index + 2;
    summary[`D${row}`] = { t: 'n', f: `SUMIFS('Detalle mensual'!$D:$D,'Detalle mensual'!$A:$A,\">=2026-01\",'Detalle mensual'!$A:$A,\"<=2026-08\",'Detalle mensual'!$B:$B,B${row},'Detalle mensual'!$C:$C,C${row})/8`, z: '#,##0.00' };
    summary[`E${row}`] = { t: 'n', f: `SUMIFS('Detalle mensual'!$E:$E,'Detalle mensual'!$A:$A,\">=2026-01\",'Detalle mensual'!$A:$A,\"<=2026-08\",'Detalle mensual'!$B:$B,B${row},'Detalle mensual'!$C:$C,C${row})/8`, z: 'S/ #,##0.00' };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, details, 'Detalle mensual');
  XLSX.utils.book_append_sheet(workbook, summary, 'Promedio mensual');
  workbook.Workbook = { CalcPr: { calcMode: 'auto', fullCalcOnLoad: true, forceFullCalc: true } };
  await mkdir(dirname(resolve(outputFile)), { recursive: true });
  XLSX.writeFile(workbook, outputFile);
  console.log(`Archivo creado: ${outputFile}`);
} finally {
  await pool.end();
}
