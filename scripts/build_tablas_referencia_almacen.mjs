// Agrega, DIRECTAMENTE en cada Excel de Desktop\Almacen, una hoja nueva
// "Tabla Referencia" con las tablas de referencia (Familia, Marca, Modelo,
// Proveedor, Tipo) para codificacion, usando TODAS las filas del reporte
// (con y sin stock: un codigo en cero puede ser de alta rotacion en quiebre).
import ExcelJS from 'exceljs';

const FILES = [
  { sede: 'Trujillo', hoja: 'Repuestos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Trujillo/RepMaterialesxLocal_02_RepuestosTrujillo.xlsx' },
  { sede: 'Trujillo', hoja: 'Insumos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Trujillo/RepMaterialesxLocal_02_insumosTrujillo.xlsx' },
  { sede: 'Callao', hoja: 'Repuestos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Callao/RepMaterialesxLocal_02_RepuestosCallao.xlsx' },
  { sede: 'Callao', hoja: 'Insumos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Callao/RepMaterialesxLocal_02_InsumosCallao.xlsx' },
];

function generarCodigo(valor, usados, maxLen = 4) {
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
  for (let len = 2; len <= 6; len++) {
    const candidato = (palabras[0] || 'X').slice(0, len).toUpperCase();
    if (!usados.has(candidato)) {
      usados.add(candidato);
      return candidato;
    }
  }
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

async function procesarArchivo({ sede, hoja, path }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);

  // por si se corre 2 veces, no duplicar la hoja
  const existente = wb.getWorksheet('Tabla Referencia');
  if (existente) wb.removeWorksheet(existente.id);

  const wsDatos = wb.worksheets[0];
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
  const campos = [
    ['FAMILIA', idx('Familia')],
    ['MARCA DEL VEHÍCULO', idx('Marca')],
    ['MODELO', idx('Modelo')],
    ['PROVEEDOR', idx('Proveedor')],
    ['TIPO', idx('Tipo')],
  ];

  const wsRef = wb.addWorksheet('Tabla Referencia');
  let col = 1;

  for (const [titulo, i] of campos) {
    if (i < 0) continue; // esta columna no existe en este archivo
    const entries = contarDistintos(rows, i);
    const startCol = col;

    wsRef.getCell(1, startCol).value = `${titulo} (${entries.length} valores distintos)`;
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
      wsRef.getCell(r, startCol + 2).value = valor === '(VACÍO)' ? '' : generarCodigo(valor, usados);
      r++;
    }

    wsRef.getColumn(startCol).width = 34;
    wsRef.getColumn(startCol + 1).width = 12;
    wsRef.getColumn(startCol + 2).width = 14;

    col = startCol + 4;
  }

  await wb.xlsx.writeFile(path);
  console.log(`✅ ${sede} - ${hoja}: ${rows.length} filas -> hoja "Tabla Referencia" agregada en`, path);
}

for (const f of FILES) {
  await procesarArchivo(f);
}
