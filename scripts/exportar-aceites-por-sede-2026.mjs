import mysql from 'mysql2/promise';
import XLSX from 'xlsx-js-style';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [connectionUri, outputFile] = process.argv.slice(2);
if (!connectionUri || !outputFile) {
  throw new Error('Uso: node exportar-aceites-por-sede-2026.mjs <url-mysql> <archivo-salida>');
}

const pool = mysql.createPool({ uri: connectionUri });
const LITROS_POR_CILINDRO = 208;
const MESES_CERRADOS_PARA_PROMEDIO = 8;
try {
  const [rows] = await pool.execute(`
    SELECT
      DATE_FORMAT(STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d'), '%Y-%m') AS mes,
      COALESCE(NULLIF(TRIM(local_nombre), ''), 'Sin sede') AS sede,
      CASE
        WHEN UPPER(TRIM(actividad)) REGEXP '10W[ -]*30' THEN '10W-30'
        WHEN UPPER(TRIM(actividad)) REGEXP '5W[ -]*30' THEN '5W-30'
        WHEN UPPER(TRIM(actividad)) REGEXP '15W[ -]*40' THEN '15W-40'
      END AS tipo_aceite,
      SUM(COALESCE(CAST(NULLIF(TRIM(cantidad), '') AS DECIMAL(12,2)), 0)) AS cantidad_consumida,
      SUM(COALESCE(CAST(NULLIF(REPLACE(TRIM(costo), ',', ''), '') AS DECIMAL(14,2)), 0)) AS gasto_total,
      SUM(COALESCE(CAST(NULLIF(REPLACE(TRIM(valor_venta), ',', ''), '') AS DECIMAL(14,2)), 0)) AS venta_total,
      SUM(
        COALESCE(CAST(NULLIF(REPLACE(TRIM(valor_venta), ',', ''), '') AS DECIMAL(14,2)), 0)
        - COALESCE(CAST(NULLIF(REPLACE(TRIM(costo), ',', ''), '') AS DECIMAL(14,2)), 0)
      ) AS utilidad
    FROM orden_trabajo
    WHERE STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d') >= '2026-01-01'
      AND STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d') < '2027-01-01'
      AND UPPER(TRIM(actividad)) REGEXP '10W[ -]*30|5W[ -]*30|15W[ -]*40'
    GROUP BY mes, sede, tipo_aceite
    ORDER BY mes, sede, tipo_aceite
  `);

  const reportRows = rows.map((row) => ({
    Mes: row.mes,
    Sede: row.sede,
    Aceite: row.tipo_aceite,
    'Litros consumidos': Number(row.cantidad_consumida),
    'Cilindros equivalentes (208 L)': Number(row.cantidad_consumida) / LITROS_POR_CILINDRO,
    'Cilindros completos requeridos': Math.ceil(Number(row.cantidad_consumida) / LITROS_POR_CILINDRO),
    'Gasto total (S/)': Number(row.gasto_total),
    'Venta total (S/)': Number(row.venta_total),
    'Utilidad (S/)': Number(row.utilidad),
  }));
  const promedioPorSedeAceite = new Map();
  rows
    .filter((row) => String(row.mes) <= '2026-08')
    .forEach((row) => {
      const key = `${row.sede}|${row.tipo_aceite}`;
      promedioPorSedeAceite.set(key, {
        sede: row.sede,
        aceite: row.tipo_aceite,
        litros: (promedioPorSedeAceite.get(key)?.litros || 0) + Number(row.cantidad_consumida),
      });
    });
  const promedioRows = [...promedioPorSedeAceite.values()].map((row) => {
    const litrosPromedio = row.litros / MESES_CERRADOS_PARA_PROMEDIO;
    return {
      Periodo: 'Enero-agosto 2026',
      Sede: row.sede,
      Aceite: row.aceite,
      'Promedio mensual (litros)': litrosPromedio,
      'Promedio mensual (cilindros equivalentes)': litrosPromedio / LITROS_POR_CILINDRO,
      'Cilindros completos para planificar': Math.ceil(litrosPromedio / LITROS_POR_CILINDRO),
    };
  });
  const sheet = XLSX.utils.json_to_sheet(reportRows);
  sheet['!cols'] = [12, 24, 14, 18, 30, 32, 20, 20, 18].map((wch) => ({ wch }));
  sheet['!autofilter'] = { ref: `A1:I${reportRows.length + 1}` };
  ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1'].forEach((cell) => {
    sheet[cell].s = {
      fill: { fgColor: { rgb: '1E3A8A' } },
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'center' },
    };
  });
  reportRows.forEach((_, index) => {
    const excelRow = index + 2;
    ['G', 'H', 'I'].forEach((column) => { sheet[`${column}${excelRow}`].z = 'S/ #,##0.00'; });
    sheet[`D${excelRow}`].z = '#,##0.00';
    sheet[`E${excelRow}`].z = '0.00';
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Aceites por sede 2026');
  const summarySheet = XLSX.utils.json_to_sheet(promedioRows);
  summarySheet['!cols'] = [22, 24, 14, 28, 40, 35].map((wch) => ({ wch }));
  summarySheet['!autofilter'] = { ref: `A1:F${promedioRows.length + 1}` };
  ['A1', 'B1', 'C1', 'D1', 'E1', 'F1'].forEach((cell) => {
    summarySheet[cell].s = {
      fill: { fgColor: { rgb: '1E3A8A' } },
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'center' },
    };
  });
  promedioRows.forEach((_, index) => {
    const excelRow = index + 2;
    // Promedio de enero a agosto: incluye como cero los meses sin consumo.
    summarySheet[`D${excelRow}`] = {
      t: 'n',
      f: `SUMIFS('Aceites por sede 2026'!$D:$D,'Aceites por sede 2026'!$A:$A,\">=2026-01\",'Aceites por sede 2026'!$A:$A,\"<=2026-08\",'Aceites por sede 2026'!$B:$B,B${excelRow},'Aceites por sede 2026'!$C:$C,C${excelRow})/8`,
    };
    summarySheet[`E${excelRow}`] = { t: 'n', f: `D${excelRow}/${LITROS_POR_CILINDRO}` };
    summarySheet[`F${excelRow}`] = { t: 'n', f: `ROUNDUP(E${excelRow},0)` };
    summarySheet[`D${excelRow}`].z = '#,##0.00';
    summarySheet[`E${excelRow}`].z = '0.00';
  });
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Promedio mensual');
  workbook.Workbook = { CalcPr: { calcMode: 'auto', fullCalcOnLoad: true, forceFullCalc: true } };
  await mkdir(dirname(resolve(outputFile)), { recursive: true });
  XLSX.writeFile(workbook, outputFile);
  console.log(`Archivo creado: ${outputFile}`);
} finally {
  await pool.end();
}
