// Expande las tablas "2. SISTEMA" y "3. SUB-SISTEMA" del generador de
// codigos con una clasificacion completa para empresa automotriz,
// informada por las 173 Familias reales que aparecen en los 4 reportes
// de almacen (Trujillo/Callao x Repuestos/Insumos). No toca Marca
// Vehiculo, Modelo, Tipo ni Marca del repuesto (quedan igual).
import ExcelJS from 'exceljs';

const PATH = 'C:/Users/Sistemas Pineda/Desktop/Generador_Codigo_Repuestos.xlsx';

// Origen se queda igual (filas 5-6). Sistema empieza en fila 9 (titulo) y
// Sub-Sistema empieza justo despues, sin fila en blanco fija (se calcula).
const SISTEMA = [
  ['Motor', 'M'],
  ['Chasis', 'C'],
  ['Electricidad', 'E'],
  ['Suspensión', 'S'],
  ['Transmisión', 'T'],
  ['Frenos', 'F'],
  ['Accesorios', 'A'],
  ['Dirección', 'D'],
  ['Carrocería', 'CR'],
  ['Refrigeración', 'RF'],
  ['Combustible', 'CB'],
  ['Embrague', 'EM'],
  ['Aire acondicionado', 'AC'],
  ['Escape', 'ES'],
];

const SUBSISTEMA = [
  ['Admisión', 'AD'],
  ['Carrocería (exterior)', 'CA'],
  ['Luces', 'LU'],
  ['Amortiguación', 'AM'],
  ['Caja diferencial', 'CD'],
  ['ABS, EBD, etc.', 'AB'],
  ['Hidráulica', 'HI'],
  ['EPS (dirección eléctrica)', 'EP'],
  ['Lubricación', 'LB'],
  ['Filtros', 'FL'],
  ['Encendido', 'EN'],
  ['Vidrios y espejos', 'VE'],
  ['Componentes de suspensión', 'CS'],
  ['Caja de cambios', 'CC'],
  ['Motor interno', 'MOI'],
  ['Arranque y carga', 'AR'],
  ['Cremallera y terminales (dirección)', 'CT'],
  ['General / consumibles', 'GC'],
];

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(PATH);
const wsListas = wb.getWorksheet('Listas');
const wsGen = wb.getWorksheet('Generador');

// --- desmerge cualquier celda combinada vieja en A:B dentro del rango que
// vamos a reescribir (si no, el valor que se escribe despues "gana" y pisa
// al anterior en toda la celda combinada) ---
for (const merge of [...wsListas.model.merges]) {
  const [ini] = merge.split(':');
  const match = ini.match(/^([A-Z]+)(\d+)$/);
  if (!match) continue;
  const [, colLetra, filaStr] = match;
  const filaNum = Number(filaStr);
  if ((colLetra === 'A' || colLetra === 'B') && filaNum >= 8 && filaNum <= 33) {
    wsListas.unMergeCells(merge);
  }
}

// --- limpiar filas 8 en adelante de columnas A y B (todo lo que hoy es
// "2. SISTEMA" y "3. SUB-SISTEMA"), sin tocar columnas D-H ---
const ULTIMA_FILA_VIEJA = 33;
for (let r = 8; r <= ULTIMA_FILA_VIEJA; r++) {
  wsListas.getCell(r, 1).value = null;
  wsListas.getCell(r, 2).value = null;
}

let fila = 9;
wsListas.mergeCells(fila, 1, fila, 2);
wsListas.getCell(fila, 1).value = '2. SISTEMA';
wsListas.getCell(fila, 1).font = { bold: true };
fila++;
const sistemaInicio = fila;
for (const [nombre, codigo] of SISTEMA) {
  wsListas.getCell(fila, 1).value = nombre;
  wsListas.getCell(fila, 2).value = codigo;
  fila++;
}
const sistemaFin = fila - 1;

fila++; // fila en blanco
wsListas.mergeCells(fila, 1, fila, 2);
wsListas.getCell(fila, 1).value = '3. SUB-SISTEMA';
wsListas.getCell(fila, 1).font = { bold: true };
fila++;
const subInicio = fila;
for (const [nombre, codigo] of SUBSISTEMA) {
  wsListas.getCell(fila, 1).value = nombre;
  wsListas.getCell(fila, 2).value = codigo;
  fila++;
}
const subFin = fila - 1;

wsListas.getColumn(1).width = 34;
wsListas.getColumn(2).width = 8;

console.log('Sistema: filas', sistemaInicio, '-', sistemaFin, `(${SISTEMA.length})`);
console.log('Sub-Sistema: filas', subInicio, '-', subFin, `(${SUBSISTEMA.length})`);

// --- actualizar Generador: dropdown + formula de Sistema (fila 6) y
// Sub-Sistema (fila 7) para que apunten a los nuevos rangos ---
wsGen.dataValidations.model['B6'] = {
  type: 'list',
  formulae: [`Listas!$A$${sistemaInicio}:$A$${sistemaFin}`],
  allowBlank: true,
  showErrorMessage: true,
  errorTitle: 'Valor no válido',
  error: 'Elige un valor de la lista',
};
wsGen.getCell('D6').value = {
  formula: `IFERROR(INDEX(Listas!$B$${sistemaInicio}:$B$${sistemaFin},MATCH(B6,Listas!$A$${sistemaInicio}:$A$${sistemaFin},0)),"")`,
};

wsGen.dataValidations.model['B7'] = {
  type: 'list',
  formulae: [`Listas!$A$${subInicio}:$A$${subFin}`],
  allowBlank: true,
  showErrorMessage: true,
  errorTitle: 'Valor no válido',
  error: 'Elige un valor de la lista',
};
wsGen.getCell('D7').value = {
  formula: `IFERROR(INDEX(Listas!$B$${subInicio}:$B$${subFin},MATCH(B7,Listas!$A$${subInicio}:$A$${subFin},0)),"")`,
};

await wb.xlsx.writeFile(PATH);
console.log('Guardado:', PATH);
