// Reconstruye la hoja "Tabla Referencia" de cada Excel de Desktop\Almacen
// desde cero, con el set final de bloques:
//   FAMILIA, MARCA DEL VEHÍCULO, MODELO, TIPO, SISTEMA, SUB-SISTEMA,
//   MARCA DEL REPUESTO (fabricante, lista curada del mercado)
// Se quita el bloque PROVEEDOR (a pedido). Todos los bloques que salen de
// datos reales (Familia, Marca vehiculo, Modelo, Tipo, Sistema, Sub-Sistema)
// usan las filas completas del reporte (con y sin stock).
import ExcelJS from 'exceljs';
import { SISTEMAS, SUBSISTEMAS, clasificar } from './clasificacion_familia_sistema.mjs';
import { MARCA_REPUESTO } from './marcas_repuesto_mercado.mjs';
import { esRopaEpp } from './uniformes_epp.mjs';

const FILES = [
  { sede: 'Trujillo', hoja: 'Repuestos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Trujillo/RepMaterialesxLocal_02_RepuestosTrujillo.xlsx' },
];

function generarCodigo(valor, usados, maxLen = 4) {
  const palabras = valor.replace(/[^A-ZÁÉÍÓÚÑ0-9 ]/gi, ' ').trim().split(/\s+/).filter(Boolean);
  let base = palabras.map((p) => p[0]).join('').toUpperCase();
  if (!base) base = 'X';
  base = base.slice(0, maxLen);
  if (!usados.has(base)) { usados.add(base); return base; }
  for (let len = 2; len <= 6; len++) {
    const candidato = (palabras[0] || 'X').slice(0, len).toUpperCase();
    if (!usados.has(candidato)) { usados.add(candidato); return candidato; }
  }
  let n = 2;
  while (usados.has(`${base}${n}`)) n++;
  const candidato = `${base}${n}`;
  usados.add(candidato);
  return candidato;
}

// Para Marca/Modelo del vehiculo: los vacios no quedan como "(VACÍO)" sin
// codigo. Se reparten en dos valores explicitos segun el Tipo EFECTIVO
// (que ya incluye el override de Uniformes y EPP):
//   - Tipo efectivo = REPUESTOS  -> "UNIVERSAL" (repuesto real, sirve para
//     cualquier marca/modelo: arandelas, liquido de frenos, focos, etc.)
//   - cualquier otro Tipo efectivo (Insumo, Accesorio, Suministro,
//     Uniformes y EPP, Publicitario...) -> "NO APLICA" (no es pieza de
//     vehiculo, la pregunta de marca/modelo no tiene sentido)
function contarMarcaOModelo(rows, idxCampo, idxTipo, idxDesc) {
  const counts = new Map();
  for (const r of rows) {
    const raw = r[idxCampo];
    let v = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!v) {
      const tipoEfectivo = esRopaEpp(r[idxDesc])
        ? 'UNIFORMES Y EPP'
        : (r[idxTipo] === undefined || r[idxTipo] === null ? '' : String(r[idxTipo]).trim().toUpperCase());
      v = tipoEfectivo === 'REPUESTOS' ? 'UNIVERSAL' : 'NO APLICA';
    }
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
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

function contarPorClasificacion(rows, idxFamilia, idxDesc, tipo) {
  const counts = new Map();
  for (const r of rows) {
    let sistema;
    let sub;
    if (esRopaEpp(r[idxDesc])) {
      sistema = 'No aplica';
      sub = 'No aplica';
    } else {
      [sistema, sub] = clasificar(r[idxFamilia]);
    }
    const valor = tipo === 'sistema' ? sistema : sub || '(sin sub-sistema asignado)';
    counts.set(valor, (counts.get(valor) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// Tipo "real" del reporte, mas el override a "Uniformes y EPP" para lo que
// por su Descripcion es ropa/EPP mal cargado hoy como Insumo/Suministro/
// Repuesto/Accesorio.
function contarTipoEfectivo(rows, idxTipo, idxDesc) {
  const counts = new Map();
  for (const r of rows) {
    let valor;
    if (esRopaEpp(r[idxDesc])) {
      valor = 'UNIFORMES Y EPP';
    } else {
      const raw = r[idxTipo];
      valor = raw === undefined || raw === null || String(raw).trim() === '' ? '(VACÍO)' : String(raw).trim();
    }
    counts.set(valor, (counts.get(valor) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// codigos curados de marca de vehiculo (mercado real, no autogenerados)
const MARCA_VEHICULO_CODIGOS = {
  TOYOTA: 'TO', NISSAN: 'NI', HYUNDAI: 'HY', PEUGEOT: 'PE', CHEVROLET: 'CH', KIA: 'KI',
  MITSUBISHI: 'MI', HINO: 'HI', FORD: 'FO', SUZUKI: 'SZ', RAM: 'RA', JAC: 'JA',
  CITROEN: 'CI', VOLKSWAGEN: 'VW', MAZDA: 'MZ', 'GREAT WALL': 'GW', MAXUS: 'MX',
  RENAULT: 'RE', HONDA: 'HO', CHANGAN: 'CA', FIAT: 'FI', SHINERAY: 'SH', MG: 'MG',
  JEEP: 'JE', HAVAL: 'HA', SUBARU: 'SU', 'MERCEDES BENZ': 'MB', CHERY: 'CY', VOLVO: 'VO',
  DFSK: 'DF', BMW: 'BM', FOTON: 'FT', ISUZU: 'IS', BAIC: 'BA', DAIHATSU: 'DA', FUSO: 'FU',
  AUDI: 'AU', 'DONG FENG': 'DG', GEELY: 'GE', LEXUS: 'LX', MAHINDRA: 'MA', JETOUR: 'JT',
  SOUEAST: 'SE', CUPRA: 'CU', DODGE: 'DO', JAGUAR: 'JG', FORLAND: 'FL', CHANGHE: 'CG',
};

function escribirBloqueDatos(ws, col, titulo, entries, codigoMap) {
  ws.getCell(1, col).value = titulo;
  ws.getCell(1, col).font = { bold: true, size: 12, color: { argb: 'FFB91C1C' } };
  ws.getCell(2, col).value = 'Valor (real, del reporte)';
  ws.getCell(2, col + 1).value = 'Códigos con este valor';
  ws.getCell(2, col + 2).value = 'Código sugerido';
  for (let c = 0; c < 3; c++) {
    const cell = ws.getCell(2, col + c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
  }
  const usados = new Set();
  let r = 3;
  for (const [valor, cantidad] of entries) {
    ws.getCell(r, col).value = valor;
    ws.getCell(r, col + 1).value = cantidad;
    let codigo = '';
    if (valor !== '(VACÍO)' && valor !== '(sin sub-sistema asignado)') {
      codigo = (codigoMap && codigoMap.get(valor)) || generarCodigo(valor, usados);
    }
    ws.getCell(r, col + 2).value = codigo;
    r++;
  }
  ws.getColumn(col).width = 34;
  ws.getColumn(col + 1).width = 12;
  ws.getColumn(col + 2).width = 14;
}

function escribirBloqueCurado(ws, col) {
  ws.getCell(1, col).value = 'MARCA DEL REPUESTO (fabricante) — lista curada del mercado, no viene de tu reporte';
  ws.getCell(1, col).font = { bold: true, size: 12, color: { argb: 'FFB91C1C' } };
  ws.getCell(2, col).value = 'Marca';
  ws.getCell(2, col + 1).value = 'Código sugerido';
  ws.getCell(2, col + 2).value = 'Especialidad';
  for (let c = 0; c < 3; c++) {
    const cell = ws.getCell(2, col + c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
  }
  let r = 3;
  for (const [marca, codigo, especialidad] of MARCA_REPUESTO) {
    ws.getCell(r, col).value = marca;
    ws.getCell(r, col + 1).value = codigo;
    ws.getCell(r, col + 2).value = especialidad;
    r++;
  }
  ws.getColumn(col).width = 20;
  ws.getColumn(col + 1).width = 14;
  ws.getColumn(col + 2).width = 22;
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
  const idx = (nombre) => header.indexOf(nombre);
  const idxFamilia = idx('Familia');
  const idxMarca = idx('Marca');
  const idxModelo = idx('Modelo');
  const idxTipo = idx('Tipo');
  const idxDesc = idx('Descripción');

  // borra la hoja vieja (traia Proveedor y demas) y la vuelve a crear limpia
  const vieja = wb.getWorksheet('Tabla Referencia');
  if (vieja) wb.removeWorksheet(vieja.id);
  const wsRef = wb.addWorksheet('Tabla Referencia');

  const codigoUniversalNoAplica = new Map([['UNIVERSAL', 'UNI'], ['NO APLICA', 'NA']]);

  let col = 1;
  escribirBloqueDatos(wsRef, col, `FAMILIA (${contarDistintos(rows, idxFamilia).length} valores distintos)`, contarDistintos(rows, idxFamilia));
  col += 4;

  const marcaEntries = contarMarcaOModelo(rows, idxMarca, idxTipo, idxDesc);
  const codigoMarca = new Map([...Object.entries(MARCA_VEHICULO_CODIGOS), ...codigoUniversalNoAplica]);
  escribirBloqueDatos(wsRef, col, `MARCA DEL VEHÍCULO (${marcaEntries.length} valores, "vacío" repartido en UNIVERSAL/NO APLICA)`, marcaEntries, codigoMarca);
  col += 4;

  const modeloEntries = contarMarcaOModelo(rows, idxModelo, idxTipo, idxDesc);
  escribirBloqueDatos(wsRef, col, `MODELO (${modeloEntries.length} valores, "vacío" repartido en UNIVERSAL/NO APLICA)`, modeloEntries, codigoUniversalNoAplica);
  col += 4;
  const tipoEntries = contarTipoEfectivo(rows, idxTipo, idxDesc);
  const codigoTipo = new Map([['REPUESTOS', 'R'], ['INSUMOS', 'I'], ['ACCESORIOS', 'AC'], ['SUMINISTROS', 'SM'], ['PUBLICITARIO', 'PU'], ['NO DEFINIDO', 'ND'], ['UNIFORMES Y EPP', 'UN']]);
  escribirBloqueDatos(wsRef, col, `TIPO (${tipoEntries.length} valores, incluye "Uniformes y EPP")`, tipoEntries, codigoTipo);
  col += 4;

  const sistemaEntries = contarPorClasificacion(rows, idxFamilia, idxDesc, 'sistema');
  escribirBloqueDatos(wsRef, col, `SISTEMA (clasificado, ${sistemaEntries.length} valores)`, sistemaEntries, new Map(SISTEMAS));
  col += 4;
  const subEntries = contarPorClasificacion(rows, idxFamilia, idxDesc, 'sub');
  escribirBloqueDatos(wsRef, col, `SUB-SISTEMA (clasificado, ${subEntries.length} valores)`, subEntries, new Map(SUBSISTEMAS));
  col += 4;

  escribirBloqueCurado(wsRef, col);

  await wb.xlsx.writeFile(path);
  console.log(`✅ ${sede} - ${hoja}: Tabla Referencia reconstruida (sin Proveedor, con Marca de repuesto curada) en`, path);
}

for (const f of FILES) {
  await procesarArchivo(f);
}
