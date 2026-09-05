// Excel aparte: intenta sacar la Marca del repuesto (fabricante, ej.
// Bosch/NGK/SKF) leyendo el texto real de Codigo y Descripcion de cada
// REPUESTO (no Insumos) de la Lista maestra. Es lo unico que se puede
// hacer, porque el campo "MARCA MATERIAL" del ERP viene vacio (0% cargado,
// ya lo confirmamos con Stock por Almacen).
import ExcelJS from 'exceljs';
import XLSX from 'xlsx';

const MARCAS_CONOCIDAS = [
  'BOSCH', 'NGK', 'DENSO', 'BREMBO', 'ATE', 'TRW', 'WAGNER', 'MONROE', 'KYB', 'GABRIEL', 'MOOG', 'SACHS',
  'LUK', 'EXEDY', 'VALEO', 'MANN', 'FRAM', 'WIX', 'PUROLATOR', 'GATES', 'DAYCO', 'CONTINENTAL', 'SKF',
  'TIMKEN', 'NSK', 'FAG', 'NTN', 'KOYO', 'FILCAR', 'SAKURA', 'WILLYBOSCH', 'WURTH', 'REFAX', 'NIBK', 'CAM2',
  'MOTUL', 'CASTROL', 'SHELL', 'MOBIL', 'TOTAL', 'VALVOLINE', 'REPSOL', 'PRIMAX', 'VARTA', 'WILLARD', 'LTH',
  'ETNA', 'CHAMPION', 'FEBI', 'HELLA', 'OSRAM', 'PHILIPS', 'AKEBONO', 'RAYBESTOS', 'FERODO', 'TEXTAR', 'JURID',
  'AISIN', 'BILSTEIN', 'TOKICO', 'KOITO', 'STANLEY',
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const REGEXES = MARCAS_CONOCIDAS.map((m) => [m, new RegExp(`\\b${escapeRegex(m)}\\b`, 'i')]);

function detectarMarca(descripcion, codigo) {
  const texto = `${descripcion || ''} ${codigo || ''}`;
  for (const [marca, rx] of REGEXES) {
    if (rx.test(texto)) return marca;
  }
  return '';
}

const wb = XLSX.readFile('C:/Users/Sistemas Pineda/Desktop/Proyectos/reporte_facturacion/backend/reportes/Lista_Maestra_Codificacion_Almacen.xlsx');
const todas = XLSX.utils.sheet_to_json(wb.Sheets['Lista maestra']);
const repuestos = todas.filter((r) => r['Tipo efectivo'] === 'REPUESTOS');

const filas = repuestos.map((r) => ({
  codigoActual: r['Código actual'],
  descripcion: r['Descripción (original ERP)'],
  marcaDetectada: detectarMarca(r['Descripción (original ERP)'], r['Código actual']),
  proveedor: r['Proveedor'],
  sistema: r['Sistema'],
  subSistema: r['Sub-Sistema'],
  marcaVehiculo: r['Marca del vehículo'],
  modelo: r['Modelo'],
  origen: r['Origen'],
  codigoNuevo: r['Código nuevo propuesto'],
}));

const conMarca = filas.filter((f) => f.marcaDetectada);
const sinMarca = filas.filter((f) => !f.marcaDetectada);

const wbOut = new ExcelJS.Workbook();

// --- Resumen ---
const wsResumen = wbOut.addWorksheet('Resumen');
wsResumen.getCell('A1').value = 'ANÁLISIS: MARCA DEL REPUESTO (fabricante) — solo Tipo = Repuestos';
wsResumen.getCell('A1').font = { bold: true, size: 13 };
wsResumen.mergeCells('A1:C1');
const resumenFilas = [
  ['Total de Repuestos analizados', repuestos.length],
  ['Con marca de fabricante detectada en el texto', conMarca.length],
  ['Sin marca detectable', sinMarca.length],
  ['% con marca detectada', `${((100 * conMarca.length) / repuestos.length).toFixed(1)}%`],
];
let rr = 3;
for (const [k, v] of resumenFilas) {
  wsResumen.getCell(rr, 1).value = k;
  wsResumen.getCell(rr, 2).value = v;
  rr++;
}
wsResumen.getCell(rr + 1, 1).value =
  'Cómo se hizo: no existe un campo confiable de "Marca del repuesto" en tu ERP (el campo MARCA MATERIAL de "Stock por Almacén" está vacío en el 100% de los casos). ' +
  'Esto se armó buscando, dentro del texto de la Descripción y del Código actual, mención literal de una marca conocida del mercado (ej. "BATERIA BOSCH", "(NIBK)", "OSRAM"). ' +
  'Por eso la cobertura es baja (~1%): la mayoría de tus repuestos simplemente nunca tuvo la marca escrita en ningún lado.';
wsResumen.getCell(rr + 1, 1).alignment = { wrapText: true };
wsResumen.mergeCells(`A${rr + 1}:E${rr + 5}`);
wsResumen.getColumn(1).width = 40;
wsResumen.getColumn(2).width = 16;

function crearHojaDetalle(nombre, datos) {
  const ws = wbOut.addWorksheet(nombre);
  ws.columns = [
    { header: 'Código actual', key: 'codigoActual', width: 18 },
    { header: 'Descripción', key: 'descripcion', width: 42 },
    { header: 'Marca detectada', key: 'marcaDetectada', width: 16 },
    { header: 'Proveedor', key: 'proveedor', width: 30 },
    { header: 'Sistema', key: 'sistema', width: 16 },
    { header: 'Sub-Sistema', key: 'subSistema', width: 22 },
    { header: 'Marca del vehículo', key: 'marcaVehiculo', width: 16 },
    { header: 'Modelo', key: 'modelo', width: 14 },
    { header: 'Origen', key: 'origen', width: 12 },
    { header: 'Código nuevo propuesto', key: 'codigoNuevo', width: 24 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
  ws.addRows(datos);
  ws.autoFilter = { from: 'A1', to: 'J1' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

crearHojaDetalle('Con marca detectada', conMarca);
crearHojaDetalle('Todos los Repuestos', filas); // para que filtren/revisen ellos mismos con su propio criterio

const OUT = 'C:/Users/Sistemas Pineda/Desktop/Proyectos/reporte_facturacion/backend/reportes/Analisis_Marca_Repuesto.xlsx';
await wbOut.xlsx.writeFile(OUT);
console.log('Guardado en:', OUT);
console.log('Total repuestos:', repuestos.length, '| con marca:', conMarca.length, '| sin marca:', sinMarca.length);
