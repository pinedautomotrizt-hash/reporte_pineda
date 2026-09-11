import mysql from 'mysql2/promise';
import XLSX from 'xlsx-js-style';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [connectionUri, outputFile] = process.argv.slice(2);

if (!connectionUri || !outputFile) {
  throw new Error('Uso: node exportar-rentaequipos-2026.mjs <url-mysql> <archivo-salida>');
}

const pool = mysql.createPool({ uri: connectionUri });
const months = [
  ['Enero', 1], ['Febrero', 2], ['Marzo', 3], ['Abril', 4],
  ['Mayo', 5], ['Junio', 6], ['Julio', 7], ['Agosto', 8],
  ['Septiembre', 9], ['Octubre', 10], ['Noviembre', 11], ['Diciembre', 12],
];

try {
  const [rows] = await pool.execute(`
    SELECT
      DATE(STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d')) AS fecha,
      COALESCE(NULLIF(TRIM(local_nombre), ''), 'Sin sede') AS sede,
      COUNT(DISTINCT NULLIF(TRIM(placa), '')) AS unidades_unicas
    FROM orden_trabajo
    WHERE UPPER(TRIM(cliente_nombre)) LIKE '%RENTAEQUIPOS%LEASING%PERU%'
      AND STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d') >= '2026-06-01'
      AND STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d') < '2026-09-01'
      AND NULLIF(TRIM(placa), '') IS NOT NULL
    GROUP BY
      DATE(STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d')),
      COALESCE(NULLIF(TRIM(local_nombre), ''), 'Sin sede')
    ORDER BY fecha, sede
  `);

  const reportRows = rows.map((row) => ({
    Fecha: new Date(row.fecha).toLocaleDateString('es-PE', { timeZone: 'UTC' }),
    Sede: row.sede,
    'Unidades únicas (placas)': Number(row.unidades_unicas),
  }));
  const totalsBySede = reportRows.reduce((totals, row) => {
    totals[row.Sede] = (totals[row.Sede] || 0) + row['Unidades únicas (placas)'];
    return totals;
  }, {});
  reportRows.push({
    Fecha: 'Total junio-agosto',
    Sede: 'Todas las sedes',
    'Unidades únicas (placas)': reportRows.reduce((sum, row) => sum + row['Unidades únicas (placas)'], 0),
  });

  const sheet = XLSX.utils.json_to_sheet(reportRows);
  sheet['!cols'] = [{ wch: 18 }, { wch: 24 }, { wch: 28 }];
  sheet['!autofilter'] = { ref: `A1:C${reportRows.length + 1}` };
  ['A1', 'B1', 'C1'].forEach((cell) => {
    sheet[cell].s = {
      fill: { fgColor: { rgb: '1E3A8A' } },
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'center' },
    };
  });
  const totalRow = reportRows.length + 1;
  ['A', 'B', 'C'].forEach((column) => {
    const cell = `${column}${totalRow}`;
    sheet[cell].s = { font: { bold: true }, fill: { fgColor: { rgb: 'DBEAFE' } } };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Unidades únicas 2026');
  await mkdir(dirname(resolve(outputFile)), { recursive: true });
  XLSX.writeFile(workbook, outputFile);
  console.log(`Archivo creado: ${outputFile}`);
  console.log(`Totales diarios por sede: ${JSON.stringify(totalsBySede)}`);
} finally {
  await pool.end();
}
