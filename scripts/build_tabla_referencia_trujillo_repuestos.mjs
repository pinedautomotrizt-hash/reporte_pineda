// Construye la "Tabla Referencia" (para codificación) a partir del reporte
// real RepMaterialesxLocal de Repuestos Trujillo. Usa TODAS las filas (con
// y sin stock), porque un código en cero puede ser de alta rotación que
// simplemente está en quiebre en este momento.
import ExcelJS from 'exceljs';

const SRC = 'C:/Users/Sistemas Pineda/Desktop/Almacen/Trujillo/RepMaterialesxLocal_02_RepuestosTrujillo.xlsx';
const OUT = 'C:/Users/Sistemas Pineda/Desktop/Proyectos/reporte_facturacion/backend/reportes/RepMaterialesxLocal_02_RepuestosTrujillo_con_Referencia.xlsx';

function generarCodigo(valor, usados, maxLen = 4) {
  // Genera un codigo corto a partir de las iniciales de cada palabra;
  // si colisiona, va agregando letras hasta que sea unico.
  const palabras = valor
    .replace(/[^A-ZÁÉÍÓÚÑ0-9 ]/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let base = palabras.map((p) => p[0]).join('').toUpperCase();
  if (!base) base = 'X';
  base = base.slice(0, maxLen);

  if (!usados.has(base)) {
    usados.add(base);
    return base;
  }
  // intenta extender con mas letras de la primera palabra
  for (let len = 2; len <= 6; len++) {
    const candidato = (palabras[0] || 'X').slice(0, len).toUpperCase();
    if (!usados.has(candidato)) {
      usados.add(candidato);
      return candidato;
    }
  }
  // ultimo recurso: numerar
  let n = 2;
  while (usados.has(`${base}${n}`)) n++;
  const candidato = `${base}${n}`;
  usados.add(candidato);
  return candidato;
}

function contarDistintos(rows, idx) {
  const counts = new Map();
  for (const r of rows) {
    const raw = r[idx];
    const v = raw === undefined || raw === null || String(raw).trim() === '' ? '(VACÍO)' : String(raw).trim();
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(SRC);

const wsDatos = wb.worksheets[0];
// localizar la fila de encabezado real ("Codigo") y armar filas de datos
let headerRowIdx = null;
let header = [];
wsDatos.eachRow((row, rowNumber) => {
  if (headerRowIdx) return;
  const first = row.getCell(1).value;
  if (first === 'Codigo') {
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

const idx = (nombre) => header.indexOf(nombre);
const idxFamilia = idx('Familia');
const idxMarca = idx('Marca');
const idxModelo = idx('Modelo');
const idxProveedor = idx('Proveedor');
const idxTipo = idx('Tipo');

console.log('Total filas de datos:', rows.length);
console.log('Encabezado real en fila', headerRowIdx);

// ---- hoja nueva: Tabla Referencia ----
const wsRef = wb.addWorksheet('Tabla Referencia');
wsRef.views = [{ state: 'frozen', ySplit: 0 }];

let col = 1;

function escribirBloque(titulo, entries, { numerarPorGrupo = false } = {}) {
  const startCol = col;
  wsRef.getCell(1, startCol).value = titulo;
  wsRef.getCell(1, startCol).font = { bold: true, size: 12, color: { argb: 'FFB91C1C' } };

  wsRef.getCell(2, startCol).value = 'Valor (real, del reporte)';
  wsRef.getCell(2, startCol + 1).value = 'Códigos con este valor';
  wsRef.getCell(2, startCol + 2).value = 'Código sugerido';
  for (let c = 0; c < 3; c++) {
    const cell = wsRef.getCell(2, startCol + c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
  }

  const usados = new Set();
  let r = 3;
  for (const [valor, cantidad] of entries) {
    wsRef.getCell(r, startCol).value = valor;
    wsRef.getCell(r, startCol + 1).value = cantidad;
    wsRef.getCell(r, startCol + 2).value =
      valor === '(VACÍO)' ? '' : generarCodigo(valor, usados);
    r++;
  }

  wsRef.getColumn(startCol).width = 34;
  wsRef.getColumn(startCol + 1).width = 12;
  wsRef.getColumn(startCol + 2).width = 14;

  col = startCol + 4; // deja una columna en blanco de separacion
}

escribirBloque('FAMILIA (' + contarDistintos(rows, idxFamilia).length + ' valores distintos)', contarDistintos(rows, idxFamilia));
escribirBloque('MARCA DEL VEHÍCULO (' + contarDistintos(rows, idxMarca).length + ' valores distintos)', contarDistintos(rows, idxMarca));
escribirBloque('MODELO (' + contarDistintos(rows, idxModelo).length + ' valores distintos)', contarDistintos(rows, idxModelo));
escribirBloque('PROVEEDOR (' + contarDistintos(rows, idxProveedor).length + ' valores distintos)', contarDistintos(rows, idxProveedor));
escribirBloque('TIPO (' + contarDistintos(rows, idxTipo).length + ' valores distintos)', contarDistintos(rows, idxTipo));

// nota superior
wsRef.getCell(4, col).value = null; // noop, deja limpio

await wb.xlsx.writeFile(OUT);
console.log('Guardado en:', OUT);
