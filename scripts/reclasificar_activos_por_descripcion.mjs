// Re-clasifica Sistema/Sub-Sistema de los codigos "activos" (stock > 0 y
// movimiento de compra/venta en los ultimos 3 meses) usando palabras clave
// de la DESCRIPCION real, en vez de solo la Familia (que dejaba ~50% en
// "General/consumibles"). Si ninguna regla de descripcion aplica, cae de
// vuelta a la clasificacion por Familia que ya teniamos.
import ExcelJS from 'exceljs';
import { clasificar as clasificarPorFamilia } from './clasificacion_familia_sistema.mjs';

const FILES = [
  { sede: 'Trujillo', hoja: 'Repuestos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Trujillo/RepMaterialesxLocal_02_RepuestosTrujillo.xlsx' },
  { sede: 'Trujillo', hoja: 'Insumos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Trujillo/RepMaterialesxLocal_02_insumosTrujillo.xlsx' },
  { sede: 'Callao', hoja: 'Repuestos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Callao/RepMaterialesxLocal_02_RepuestosCallao.xlsx' },
  { sede: 'Callao', hoja: 'Insumos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Callao/RepMaterialesxLocal_02_InsumosCallao.xlsx' },
];

// orden importa: la primera regla que matchea gana
const REGLAS = [
  [/FILTRO.*AIRE ACOND|FILTRO.*A\/C/, 'Aire acondicionado', 'Filtros'],
  [/FILTRO.*AIRE/, 'Motor', 'Filtros'],
  [/FILTRO.*ACEITE/, 'Motor', 'Filtros'],
  [/FILTRO.*COMBUSTIBL/, 'Combustible', 'Filtros'],
  [/FILTRO/, 'Motor', 'Filtros'],
  [/LIQUIDO DE FRENO/, 'Frenos', null],
  [/PASTILLA/, 'Frenos', null],
  [/ZAPATA/, 'Frenos', null],
  [/TAMBOR.*FRENO/, 'Frenos', null],
  [/DISCO.*FRENO/, 'Frenos', null],
  [/CILINDRO.*FRENO|BOMBA.*FRENO/, 'Frenos', null],
  [/BUJIA/, 'Electricidad', 'Encendido'],
  [/BOBINA.*(ENCEND|IGNIC)/, 'Electricidad', 'Encendido'],
  [/CABLE.*BUJIA/, 'Electricidad', 'Encendido'],
  [/BATERIA/, 'Electricidad', 'Arranque y carga'],
  [/ALTERNADOR/, 'Electricidad', 'Arranque y carga'],
  [/ARRANCADOR|MOTOR DE ARRANQUE/, 'Electricidad', 'Arranque y carga'],
  [/FOCO|LAMPARA|FARO|LUZ|LUCES|NEBLINERO|DIRECCIONAL/, 'Electricidad', 'Luces'],
  [/AMORTIGUADOR/, 'Suspensión', 'Amortiguación'],
  [/ROTULA/, 'Suspensión', 'Componentes de suspensión'],
  [/TRAPECIO/, 'Suspensión', 'Componentes de suspensión'],
  [/BARRA ESTABILIZADORA/, 'Suspensión', 'Componentes de suspensión'],
  [/MUELLE|RESORTE.*SUSP/, 'Suspensión', 'Componentes de suspensión'],
  [/RADIADOR/, 'Refrigeración', null],
  [/TERMOSTATO/, 'Refrigeración', null],
  [/BOMBA.*AGUA/, 'Refrigeración', null],
  [/MANGUERA/, 'Refrigeración', null],
  [/VENTILADOR/, 'Refrigeración', null],
  [/ANTICONGELANTE|REFRIGERANTE/, 'Refrigeración', null],
  [/BOMBA.*GASOLINA|BOMBA.*COMBUSTIBLE/, 'Combustible', null],
  [/INYECTOR/, 'Combustible', null],
  [/TANQUE.*(COMBUSTIBLE|GASOLINA)/, 'Combustible', null],
  [/EMBRAGUE|CLUTCH|COLLARIN/, 'Embrague', null],
  [/CAJA.*(CAMBIO|MECANICA|AUTOMATICA)/, 'Transmisión', 'Caja de cambios'],
  [/DIFERENCIAL/, 'Transmisión', 'Caja diferencial'],
  [/CRUCETA|CARDAN/, 'Transmisión', null],
  [/CREMALLERA|TERMINAL.*DIRECC/, 'Dirección', 'Cremallera y terminales (dirección)'],
  [/VOLANTE/, 'Dirección', null],
  [/SERVO.*DIRECC|DIRECCION HIDRAULICA/, 'Dirección', 'Hidráulica'],
  [/PARACHOQUE|GUARDAFANGO|CAPOT|COMPUERTA|PUERTA|PANEL|TECHO|EMBLEMA|MOLDURA/, 'Carrocería', 'Carrocería (exterior)'],
  [/LUNA|PARABRISA|ESPEJO|MICA/, 'Carrocería', 'Vidrios y espejos'],
  [/AIRE ACONDICIONADO|CONDENSADOR|COMPRESOR.*A\/?C/, 'Aire acondicionado', null],
  [/ESCAPE|SILENCIADOR/, 'Escape', null],
  [/PISTON|ANILLO|CULATA|CARTER|VALVULA|CIGU|COJINETE|EMPAQUE.*MOTOR/, 'Motor', 'Motor interno'],
  [/PLUMILLA/, 'Accesorios', null],
  [/(TUERCA|ESPARRAGO|SEGURO).*(ARO|RUEDA)/, 'Suspensión', 'Componentes de suspensión'],
  [/ACEITE.*(ATF|TRANSMISION|DIFERENCIAL)|ATF/, 'Transmisión', 'Lubricación'],
  [/ACEITE/, 'Motor', 'Lubricación'],
];

function clasificarPorDescripcion(desc, familiaFallback) {
  const d = (desc || '').toString().toUpperCase();
  for (const [regex, sistema, sub] of REGLAS) {
    if (regex.test(d)) return [sistema, sub];
  }
  return clasificarPorFamilia(familiaFallback);
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

const hoy = new Date();
const cutoff = new Date(hoy);
cutoff.setMonth(cutoff.getMonth() - 3);

let granTotal = 0;
let cambioDeGeneral = 0;
const resumenPorSistema = new Map();
const filasActivas = [];

for (const { sede, hoja, path } of FILES) {
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
  const idx = (n) => header.indexOf(n);
  const idxStock = idx('Stock Disponible');
  const idxCompra = idx('Fec Ult Compra');
  const idxVenta = idx('Fec Ult Venta');
  const idxFamilia = idx('Familia');
  const idxDesc = idx('Descripción');
  const idxCodigo = 0;

  for (let r = headerRowIdx + 1; r <= wsDatos.rowCount; r++) {
    const row = wsDatos.getRow(r);
    const codigo = row.getCell(1).value;
    if (codigo === undefined || codigo === null || String(codigo).trim() === '') continue;
    const vals = row.values.slice(1);
    const stock = parseFloat(vals[idxStock] || 0);
    if (!(stock > 0)) continue;
    const fc = parseDate(vals[idxCompra]);
    const fv = parseDate(vals[idxVenta]);
    const activo = (fc && fc >= cutoff) || (fv && fv >= cutoff);
    if (!activo) continue;

    granTotal++;
    const familia = vals[idxFamilia];
    const desc = vals[idxDesc];
    const [sistemaViejo] = clasificarPorFamilia(familia);
    const [sistemaNuevo, subNuevo] = clasificarPorDescripcion(desc, familia);
    if (sistemaViejo === 'General' && sistemaNuevo !== 'General') cambioDeGeneral++;

    resumenPorSistema.set(sistemaNuevo, (resumenPorSistema.get(sistemaNuevo) || 0) + 1);
    filasActivas.push({ sede, hoja, codigo: vals[idxCodigo], desc, familia, sistemaViejo, sistemaNuevo, subNuevo });
  }
}

console.log('Total activos (stock>0 y mov. últimos 3 meses):', granTotal);
console.log('Cutoff usado:', cutoff.toISOString().slice(0, 10));
console.log('Rescatados de "General" gracias a la Descripción:', cambioDeGeneral);
console.log();
console.log('--- Sistema (nuevo, por Descripción) ---');
[...resumenPorSistema.entries()].sort((a, b) => b[1] - a[1]).forEach(([s, c]) => console.log(s, '->', c));

// exportar detalle a JSON para el siguiente paso (armar el Excel)
import { writeFileSync } from 'fs';
writeFileSync('reclasificacion_activos.json', JSON.stringify(filasActivas, null, 2), 'utf-8');
console.log();
console.log('Detalle guardado en reclasificacion_activos.json (' + filasActivas.length + ' filas)');
