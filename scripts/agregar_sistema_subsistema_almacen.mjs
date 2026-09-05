// Agrega, a la hoja "Tabla Referencia" que ya existe en cada Excel de
// Desktop\Almacen, los bloques que faltaban: SISTEMA, SUB-SISTEMA (clasificados
// a partir de la Familia real de cada codigo) y una nota sobre MARCA DEL
// REPUESTO (fabricante), que no existe como columna en este reporte.
import ExcelJS from 'exceljs';
import { SISTEMAS, SUBSISTEMAS, clasificar } from './clasificacion_familia_sistema.mjs';

const FILES = [
  { sede: 'Trujillo', hoja: 'Repuestos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Trujillo/RepMaterialesxLocal_02_RepuestosTrujillo.xlsx' },
  { sede: 'Trujillo', hoja: 'Insumos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Trujillo/RepMaterialesxLocal_02_insumosTrujillo.xlsx' },
  { sede: 'Callao', hoja: 'Repuestos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Callao/RepMaterialesxLocal_02_RepuestosCallao.xlsx' },
  { sede: 'Callao', hoja: 'Insumos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Callao/RepMaterialesxLocal_02_InsumosCallao.xlsx' },
];

const CODIGO_POR_NOMBRE_SISTEMA = new Map(SISTEMAS);
const CODIGO_POR_NOMBRE_SUB = new Map(SUBSISTEMAS);

function contarPorClasificacion(rows, idxFamilia, tipo) {
  const counts = new Map();
  for (const r of rows) {
    const [sistema, sub] = clasificar(r[idxFamilia]);
    const valor = tipo === 'sistema' ? sistema : sub || '(sin sub-sistema asignado)';
    counts.set(valor, (counts.get(valor) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function escribirBloque(ws, col, titulo, entries, codigoMap) {
  ws.getCell(1, col).value = titulo;
  ws.getCell(1, col).font = { bold: true, size: 12, color: { argb: 'FFB91C1C' } };

  ws.getCell(2, col).value = 'Valor (clasificado desde Familia)';
  ws.getCell(2, col + 1).value = 'Códigos con este valor';
  ws.getCell(2, col + 2).value = 'Código sugerido';
  for (let c = 0; c < 3; c++) {
    const cell = ws.getCell(2, col + c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
  }

  let r = 3;
  for (const [valor, cantidad] of entries) {
    ws.getCell(r, col).value = valor;
    ws.getCell(r, col + 1).value = cantidad;
    ws.getCell(r, col + 2).value = codigoMap.get(valor) || '';
    r++;
  }

  ws.getColumn(col).width = 34;
  ws.getColumn(col + 1).width = 12;
  ws.getColumn(col + 2).width = 14;
  return r;
}

async function procesarArchivo({ sede, hoja, path }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);

  const wsDatos = wb.worksheets[0];
  let headerRowIdx = null;
  let header = [];
  wsDatos.eachRow((row, rowNumber) => {
    if (headerRowIdx) return;
    if (row.getCell(1).value === 'Codigo') {
      headerRowIdx = rowNumber;
      header = row.values.slice(1).map((v) => (v === undefined || v === null ? '' : String(v)));
    }
  });

  const rows = [];
  for (let r = headerRowIdx + 1; r <= wsDatos.rowCount; r++) {
    const row = wsDatos.getRow(r);
    const codigo = row.getCell(1).value;
    if (codigo === undefined || codigo === null || String(codigo).trim() === '') continue;
    rows.push(row.values.slice(1));
  }
  const idxFamilia = header.indexOf('Familia');

  const wsRef = wb.getWorksheet('Tabla Referencia');
  if (!wsRef) throw new Error(`No existe la hoja "Tabla Referencia" en ${path}`);

  // encontrar la primera columna libre (despues del ultimo bloque ya escrito)
  let maxCol = 0;
  wsRef.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
    maxCol = Math.max(maxCol, cell.col);
  });
  const colSistemaInicio = maxCol + 2; // deja 1 columna de separacion extra antes de los bloques nuevos
  const colSubInicio = colSistemaInicio + 4;

  const sistemaEntries = contarPorClasificacion(rows, idxFamilia, 'sistema');
  escribirBloque(
    wsRef, colSistemaInicio,
    `SISTEMA (clasificado, ${sistemaEntries.length} valores)`,
    sistemaEntries, CODIGO_POR_NOMBRE_SISTEMA,
  );
  escribirBloque(
    wsRef, colSubInicio,
    `SUB-SISTEMA (clasificado, ${SUBSISTEMAS.length} posibles)`,
    contarPorClasificacion(rows, idxFamilia, 'sub'), CODIGO_POR_NOMBRE_SUB,
  );

  // Marca del repuesto (fabricante): no existe como columna en este reporte.
  let colFabricante = colSubInicio + 4;
  wsRef.getCell(1, colFabricante).value = 'MARCA DEL REPUESTO (fabricante) — NO DISPONIBLE EN ESTE REPORTE';
  wsRef.getCell(1, colFabricante).font = { bold: true, size: 12, color: { argb: 'FFB91C1C' } };
  wsRef.getCell(2, colFabricante).value =
    'El reporte trae "Proveedor" (a quién le compras: distribuidor/mayorista), no la marca que fabrica la pieza (ej. Bosch, Sakura). Son cosas distintas. Si necesitas esta tabla, hay que pedirla a otro reporte o cargarla a mano.';
  wsRef.getCell(2, colFabricante).alignment = { wrapText: true, vertical: 'top' };
  wsRef.mergeCells(2, colFabricante, 6, colFabricante + 2);
  wsRef.getColumn(colFabricante).width = 34;

  await wb.xlsx.writeFile(path);
  console.log(`✅ ${sede} - ${hoja}: Sistema/Sub-Sistema agregados en`, path);
}

for (const f of FILES) {
  await procesarArchivo(f);
}
