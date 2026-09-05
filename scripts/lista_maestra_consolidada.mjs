// Lista maestra consolidada: junta los 4 archivos de Desktop\Almacen,
// deja UN solo codigo por repuesto real (sin duplicar entre sedes), lo
// clasifica una sola vez (Sistema/Sub-Sistema por Descripcion, Tipo
// efectivo con Uniformes y EPP, Marca/Modelo con UNIVERSAL/NO APLICA) y
// arma el codigo nuevo propuesto al lado del codigo actual, listo para
// que el jefe de almacen lo revise antes de aprobarlo.
import ExcelJS from 'exceljs';
import XLSX from 'xlsx';
import { clasificar as clasificarPorFamilia } from './clasificacion_familia_sistema.mjs';
import { esRopaEpp } from './uniformes_epp.mjs';
import { MARCA_REPUESTO } from './marcas_repuesto_mercado.mjs';

const FILES = [
  { sedeAlmacen: 'Trujillo - Repuestos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Trujillo/RepMaterialesxLocal_02_RepuestosTrujillo.xlsx' },
  { sedeAlmacen: 'Trujillo - Insumos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Trujillo/RepMaterialesxLocal_02_insumosTrujillo.xlsx' },
  { sedeAlmacen: 'Callao - Repuestos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Callao/RepMaterialesxLocal_02_RepuestosCallao.xlsx' },
  { sedeAlmacen: 'Callao - Insumos', path: 'C:/Users/Sistemas Pineda/Desktop/Almacen/Callao/RepMaterialesxLocal_02_InsumosCallao.xlsx' },
];

// --- mismas reglas de clasificacion por Descripcion que ya validamos con los 702 activos ---
const REGLAS_SISTEMA = [
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

function clasificarSistema(desc, familiaFallback) {
  const d = (desc || '').toString().toUpperCase();
  for (const [regex, sistema, sub] of REGLAS_SISTEMA) {
    if (regex.test(d)) return [sistema, sub];
  }
  return clasificarPorFamilia(familiaFallback);
}

const SISTEMA_CODIGOS = {
  Motor: 'M', Chasis: 'C', Electricidad: 'E', 'Suspensión': 'S', 'Transmisión': 'T',
  Frenos: 'F', Accesorios: 'A', 'Dirección': 'D', 'Carrocería': 'CR', 'Refrigeración': 'RF',
  Combustible: 'CB', Embrague: 'EM', 'Aire acondicionado': 'AC', Escape: 'ES', General: 'GN',
  'No aplica': 'NA',
};
const SUBSISTEMA_CODIGOS = {
  'Admisión': 'AD', 'Carrocería (exterior)': 'CA', Luces: 'LU', 'Amortiguación': 'AM',
  'Caja diferencial': 'CD', 'ABS, EBD, etc.': 'AB', 'Hidráulica': 'HI', 'EPS (dirección eléctrica)': 'EP',
  'Lubricación': 'LB', Filtros: 'FL', Encendido: 'EN', 'Vidrios y espejos': 'VE',
  'Componentes de suspensión': 'CS', 'Caja de cambios': 'CC', 'Motor interno': 'MOI',
  'Arranque y carga': 'AR', 'Cremallera y terminales (dirección)': 'CT', 'General / consumibles': 'GC',
  'No aplica': 'NA',
};
const MARCA_VEHICULO_CODIGOS = {
  TOYOTA: 'TO', NISSAN: 'NI', HYUNDAI: 'HY', PEUGEOT: 'PE', CHEVROLET: 'CH', KIA: 'KI',
  MITSUBISHI: 'MI', HINO: 'HI', FORD: 'FO', SUZUKI: 'SZ', RAM: 'RA', JAC: 'JA',
  CITROEN: 'CI', VOLKSWAGEN: 'VW', MAZDA: 'MZ', 'GREAT WALL': 'GW', MAXUS: 'MX',
  RENAULT: 'RE', HONDA: 'HO', CHANGAN: 'CA', FIAT: 'FI', SHINERAY: 'SH', MG: 'MG',
  JEEP: 'JE', HAVAL: 'HA', SUBARU: 'SU', 'MERCEDES BENZ': 'MB', CHERY: 'CY', VOLVO: 'VO',
  DFSK: 'DF', BMW: 'BM', FOTON: 'FT', ISUZU: 'IS', BAIC: 'BA', DAIHATSU: 'DA', FUSO: 'FU',
  AUDI: 'AU', 'DONG FENG': 'DG', GEELY: 'GE', LEXUS: 'LX', MAHINDRA: 'MA', JETOUR: 'JT',
  SOUEAST: 'SE', CUPRA: 'CU', DODGE: 'DO', JAGUAR: 'JG', FORLAND: 'FL', CHANGHE: 'CG',
  UNIVERSAL: 'UNI', 'NO APLICA': 'NA',
};
const TIPO_CODIGOS = {
  REPUESTOS: 'R', INSUMOS: 'I', ACCESORIOS: 'AC', SUMINISTROS: 'SM',
  PUBLICITARIO: 'PU', 'NO DEFINIDO': 'ND', 'UNIFORMES Y EPP': 'UN',
};
const ORIGEN_CODIGOS = { Original: 'O', Alternativo: 'A' };

// El campo "GRUPO" del reporte "Stock por Almacén" (ORIGINALES/
// ALTERNATIVOS/NO DEFINIDO) es la fuente REAL de Origen — se probo que
// adivinarlo por el sufijo "-ALT" del codigo acierta menos de la mitad de
// las veces, asi que ya no se usa esa heuristica. Si el codigo no aparece
// en ninguno de los 4 reportes de Stock por Almacen, o el propio sistema
// lo tiene como "NO DEFINIDO", se deja como "No definido" (igual que lo
// tiene el ERP) en vez de adivinar.
const ARCHIVOS_STOCK_POR_ALMACEN = [
  'C:/Users/Sistemas Pineda/Downloads/StockTotal_04092026101417232_RepuestosTrujillo.xlsx',
  'C:/Users/Sistemas Pineda/Downloads/StockTotal_04092026101440420_InsumosTrujillo.xlsx',
  'C:/Users/Sistemas Pineda/Downloads/StockTotal_04_RepuestosCallao.xlsx',
  'C:/Users/Sistemas Pineda/Downloads/StockTotal_04_Insumos_Callao.xlsx',
];

// estos 4 archivos vienen exportados directo del ERP con un core.xml que
// ExcelJS no puede parsear (ya nos paso antes) — se leen con la libreria
// xlsx (SheetJS) en su lugar, solo para sacar el mapa Codigo->Origen.
function cargarMapaOrigenReal() {
  const mapa = new Map();
  for (const path of ARCHIVOS_STOCK_POR_ALMACEN) {
    const wb = XLSX.readFile(path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const headerIdx = raw.findIndex((r) => Array.isArray(r) && r[0] === 'CODIGO');
    const header = raw[headerIdx];
    const idxGrupo = header.indexOf('GRUPO');
    const data = raw.slice(headerIdx + 1).filter((r) => Array.isArray(r) && r.length && r[0]);
    for (const r of data) {
      const codigo = String(r[0]).trim();
      const grupo = (r[idxGrupo] || '').toString().trim();
      if (grupo === 'ORIGINALES') mapa.set(codigo, 'Original');
      else if (grupo === 'ALTERNATIVOS') mapa.set(codigo, 'Alternativo');
      // "NO DEFINIDO" no se guarda: se deja el default de "No definido"
    }
  }
  return mapa;
}

const mapaOrigenReal = cargarMapaOrigenReal();
console.log('Códigos con Origen real confirmado (Stock por Almacén):', mapaOrigenReal.size);

// Ya no se deja "No definido": si el ERP no tiene el GRUPO real cargado,
// se busca la palabra "ALT"/"ALTERNATIVO" en el codigo o la descripcion
// (asi lo escribe el propio negocio para marcar un alternativo); y si
// tampoco hay esa pista, por defecto se asume Alternativo (mas seguro
// que afirmar "Original" sin poder probarlo).
const RE_ALT = /\bALT\b|\bALTERNATIVO\b/i;

function clasificarOrigen(codigoActual, descripcion) {
  if (mapaOrigenReal.has(codigoActual)) return mapaOrigenReal.get(codigoActual);
  if (RE_ALT.test(codigoActual) || RE_ALT.test(descripcion || '')) return 'Alternativo';
  return 'Alternativo'; // default conservador: sin evidencia, no se afirma "Original"
}

function codigoModeloGenerator() {
  const usados = new Set(['UNI', 'NA']);
  const mapa = new Map([['UNIVERSAL', 'UNI'], ['NO APLICA', 'NA']]);
  const fn = function obtenerCodigoModelo(modelo) {
    if (mapa.has(modelo)) return mapa.get(modelo);
    const palabras = modelo.replace(/[^A-ZÁÉÍÓÚÑ0-9 ]/gi, ' ').trim().split(/\s+/).filter(Boolean);
    let base = palabras.map((p) => p[0]).join('').toUpperCase().slice(0, 3) || 'X';
    let candidato = base;
    let n = 2;
    while (usados.has(candidato)) { candidato = base + n; n++; }
    usados.add(candidato);
    mapa.set(modelo, candidato);
    return candidato;
  };
  fn.mapa = mapa; // para poder exportar todos los pares Modelo->Codigo despues
  return fn;
}
const obtenerCodigoModelo = codigoModeloGenerator();

// nombre "bonito" (Title Case) para mostrar en la descripcion propuesta,
// en vez del MAYUSCULAS crudo del reporte
function tituloCase(texto) {
  return (texto || '')
    .toString()
    .toLowerCase()
    .replace(/(^|\s|\/)([a-záéíóúñ])/g, (m, sep, letra) => sep + letra.toUpperCase());
}

// --- 1) leer los 4 archivos y consolidar por Codigo ---
const porCodigo = new Map();

for (const { sedeAlmacen, path } of FILES) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  let headerRowIdx = null;
  let header = [];
  ws.eachRow((row, rowNumber) => {
    if (headerRowIdx) return;
    if (row.getCell(1).value === 'Codigo') {
      headerRowIdx = rowNumber;
      header = row.values.slice(1).map((v) => (v === undefined || v === null ? '' : String(v)));
    }
  });
  const idx = (n) => header.indexOf(n);
  const idxDesc = idx('Descripción');
  const idxFamilia = idx('Familia');
  const idxMarca = idx('Marca');
  const idxModelo = idx('Modelo');
  const idxTipo = idx('Tipo');
  const idxStock = idx('Stock Disponible');
  const idxValorVenta = idx('Valor Venta');
  const idxCosReposicion = idx('Cos.Reposición');
  const idxCosPromedio = idx('Cos.Promedio');
  const idxCostoTaller = idx('Costo Taller');
  const idxCostoPromDolar = idx('Cost.Prom.Dolar');
  const idxProveedor = idx('Proveedor');
  const idxUbicacion = idx('Ubicación');
  const idxFechaCompra = idx('Fec Ult Compra');
  const idxFechaVenta = idx('Fec Ult Venta');
  const idxValorDisponible = idx('Valor disponible');
  const idxStockCalidad = idx('Stock Calidad');
  const idxStockReserva = idx('Stock Reserva');
  const idxStockBloqueado = idx('Stock Bloqueado');
  const idxStockTransito = idx('Stock  Transito');
  const idxStockComprometido = idx('Stock Comprometido');
  const idxValorCalidad = idx('Valor Calidad');
  const idxValorReserva = idx('Valor Reserva');
  const idxValorBloqueado = idx('Valor Bloqueado');
  const idxValorTransito = idx('Valor Transito');
  const idxValorComprometido = idx('Valor Comprometido');
  const idxMAD = idx('MAD');
  const idxICC = idx('ICC');
  const idxCampana = idx('Campaña');
  const idxValorAux1 = idx('Valor Aux 1');
  const idxValorAux2 = idx('Valor Aux 2');

  for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const codigoRaw = row.getCell(1).value;
    if (codigoRaw === undefined || codigoRaw === null || String(codigoRaw).trim() === '') continue;
    const codigo = String(codigoRaw).trim();
    const vals = row.values.slice(1);

    if (!porCodigo.has(codigo)) {
      porCodigo.set(codigo, {
        codigo,
        descripcion: vals[idxDesc] || '',
        familia: vals[idxFamilia] || '',
        marca: (vals[idxMarca] || '').toString().trim(),
        modelo: (vals[idxModelo] || '').toString().trim(),
        tipoOriginal: (vals[idxTipo] || '').toString().trim().toUpperCase(),
        stockTotal: 0,
        sedesAlmacenes: new Set(),
        precioVenta: null,
        costoReposicion: null,
        costoPromedio: null,
        costoTaller: null,
        costoPromedioDolar: null,
        proveedor: '',
        ubicacion: '',
        fechaUltCompra: null,
        fechaUltVenta: null,
        valorStockTotal: 0,
        stockCalidad: 0,
        stockReserva: 0,
        stockBloqueado: 0,
        stockTransito: 0,
        stockComprometido: 0,
        valorCalidad: 0,
        valorReserva: 0,
        valorBloqueado: 0,
        valorTransito: 0,
        valorComprometido: 0,
        mad: null,
        icc: '',
        campana: '',
        valorAux1: null,
        valorAux2: null,
      });
    }
    const item = porCodigo.get(codigo);
    item.sedesAlmacenes.add(sedeAlmacen);
    item.stockTotal += parseFloat(vals[idxStock] || 0);
    item.valorStockTotal += parseFloat(vals[idxValorDisponible] || 0);
    item.stockCalidad += parseFloat(vals[idxStockCalidad] || 0);
    item.stockReserva += parseFloat(vals[idxStockReserva] || 0);
    item.stockBloqueado += parseFloat(vals[idxStockBloqueado] || 0);
    item.stockTransito += parseFloat(vals[idxStockTransito] || 0);
    item.stockComprometido += parseFloat(vals[idxStockComprometido] || 0);
    item.valorCalidad += parseFloat(vals[idxValorCalidad] || 0);
    item.valorReserva += parseFloat(vals[idxValorReserva] || 0);
    item.valorBloqueado += parseFloat(vals[idxValorBloqueado] || 0);
    item.valorTransito += parseFloat(vals[idxValorTransito] || 0);
    item.valorComprometido += parseFloat(vals[idxValorComprometido] || 0);
    if (item.mad === null && vals[idxMAD] !== undefined && vals[idxMAD] !== '') item.mad = parseFloat(vals[idxMAD]) || 0;
    if (!item.icc && vals[idxICC]) item.icc = String(vals[idxICC]).trim();
    if (!item.campana && vals[idxCampana]) item.campana = String(vals[idxCampana]).trim();
    if (item.valorAux1 === null && vals[idxValorAux1] !== undefined && vals[idxValorAux1] !== '') item.valorAux1 = vals[idxValorAux1];
    if (item.valorAux2 === null && vals[idxValorAux2] !== undefined && vals[idxValorAux2] !== '') item.valorAux2 = vals[idxValorAux2];
    // completa datos si en la primera aparicion venian vacios
    if (!item.marca && vals[idxMarca]) item.marca = String(vals[idxMarca]).trim();
    if (!item.modelo && vals[idxModelo]) item.modelo = String(vals[idxModelo]).trim();
    // precios/costos: se toma el primer valor real que aparezca (no se suma,
    // es un valor por unidad, no una cantidad)
    if (item.precioVenta === null && vals[idxValorVenta] !== undefined && vals[idxValorVenta] !== '') item.precioVenta = parseFloat(vals[idxValorVenta]) || 0;
    if (item.costoReposicion === null && vals[idxCosReposicion] !== undefined && vals[idxCosReposicion] !== '') item.costoReposicion = parseFloat(vals[idxCosReposicion]) || 0;
    if (item.costoPromedio === null && vals[idxCosPromedio] !== undefined && vals[idxCosPromedio] !== '') item.costoPromedio = parseFloat(vals[idxCosPromedio]) || 0;
    if (item.costoTaller === null && vals[idxCostoTaller] !== undefined && vals[idxCostoTaller] !== '') item.costoTaller = parseFloat(vals[idxCostoTaller]) || 0;
    if (item.costoPromedioDolar === null && vals[idxCostoPromDolar] !== undefined && vals[idxCostoPromDolar] !== '') item.costoPromedioDolar = parseFloat(vals[idxCostoPromDolar]) || 0;
    if (!item.proveedor && vals[idxProveedor]) item.proveedor = String(vals[idxProveedor]).trim();
    if (!item.ubicacion && vals[idxUbicacion]) item.ubicacion = String(vals[idxUbicacion]).trim();
    // fechas: nos quedamos con la mas reciente entre todas las sedes
    const fc = vals[idxFechaCompra];
    const fv = vals[idxFechaVenta];
    if (fc && (!item.fechaUltCompra || String(fc) > item.fechaUltCompra)) item.fechaUltCompra = String(fc);
    if (fv && (!item.fechaUltVenta || String(fv) > item.fechaUltVenta)) item.fechaUltVenta = String(fv);
  }
}

console.log('Total codigos unicos consolidados:', porCodigo.size);

// --- 2) clasificar y armar codigo nuevo ---
const correlativos = new Map(); // clave clasificacion -> siguiente numero
const filas = [];

for (const item of porCodigo.values()) {
  const tipoEfectivo = esRopaEpp(item.descripcion) ? 'UNIFORMES Y EPP' : (item.tipoOriginal || 'NO DEFINIDO');
  const [sistema, sub] = esRopaEpp(item.descripcion)
    ? ['No aplica', 'No aplica']
    : clasificarSistema(item.descripcion, item.familia);

  let marca = item.marca;
  let modelo = item.modelo;
  if (!marca) marca = tipoEfectivo === 'REPUESTOS' ? 'UNIVERSAL' : 'NO APLICA';
  if (!modelo) modelo = tipoEfectivo === 'REPUESTOS' ? 'UNIVERSAL' : 'NO APLICA';

  const origen = clasificarOrigen(item.codigo, item.descripcion);
  const codOrigen = ORIGEN_CODIGOS[origen];
  const codSistema = SISTEMA_CODIGOS[sistema] || 'GN';
  const codSub = SUBSISTEMA_CODIGOS[sub] || SUBSISTEMA_CODIGOS['General / consumibles'];
  const codMarca = MARCA_VEHICULO_CODIGOS[marca.toUpperCase()] || marca.slice(0, 3).toUpperCase();
  const codModelo = obtenerCodigoModelo(modelo.toUpperCase());
  const codTipo = TIPO_CODIGOS[tipoEfectivo] || 'ND';

  const clave = `${codOrigen}-${codSistema}-${codSub}-${codMarca}-${codModelo}-${codTipo}`;
  const siguiente = (correlativos.get(clave) || 0) + 1;
  correlativos.set(clave, siguiente);
  const correlativo = String(siguiente).padStart(4, '0');
  const codigoNuevo = `${clave}-${correlativo}`;

  // descripcion legible del codigo propuesto, ej.:
  // "Original — Motor / Filtros — Toyota Hilux — Repuesto"
  const subTexto = sub ? tituloCase(sub) : 'Sin sub-sistema';
  const marcaModeloTexto =
    marca === 'UNIVERSAL' ? 'Universal (cualquier marca/modelo)'
    : marca === 'NO APLICA' ? 'No aplica (no es pieza de vehículo)'
    : `${tituloCase(marca)} ${tituloCase(modelo)}`;
  const tipoTexto = tituloCase(tipoEfectivo === 'UNIFORMES Y EPP' ? 'Uniformes y EPP' : tipoEfectivo);
  const descripcionPropuesta = `${origen} — ${tituloCase(sistema)} / ${subTexto} — ${marcaModeloTexto} — ${tipoTexto}`;

  filas.push({
    codigoActual: item.codigo,
    descripcion: item.descripcion,
    sedesAlmacenes: [...item.sedesAlmacenes].sort().join(' + '),
    stockTotal: item.stockTotal,
    familiaOriginal: item.familia,
    tipoOriginal: item.tipoOriginal,
    tipoEfectivo,
    origen,
    sistema,
    subSistema: sub || '(sin sub-sistema)',
    marca,
    modelo,
    codigoNuevo,
    descripcionPropuesta,
    precioVenta: item.precioVenta || 0,
    costoReposicion: item.costoReposicion || 0,
    costoPromedio: item.costoPromedio || 0,
    costoTaller: item.costoTaller || 0,
    costoPromedioDolar: item.costoPromedioDolar || 0,
    valorStockTotal: item.valorStockTotal,
    proveedor: item.proveedor,
    ubicacion: item.ubicacion,
    fechaUltCompra: item.fechaUltCompra || '',
    fechaUltVenta: item.fechaUltVenta || '',
    stockCalidad: item.stockCalidad,
    stockReserva: item.stockReserva,
    stockBloqueado: item.stockBloqueado,
    stockTransito: item.stockTransito,
    stockComprometido: item.stockComprometido,
    valorCalidad: item.valorCalidad,
    valorReserva: item.valorReserva,
    valorBloqueado: item.valorBloqueado,
    valorTransito: item.valorTransito,
    valorComprometido: item.valorComprometido,
    mad: item.mad || 0,
    icc: item.icc,
    campana: item.campana,
    valorAux1: item.valorAux1 ?? '',
    valorAux2: item.valorAux2 ?? '',
  });
}

filas.sort((a, b) => a.codigoNuevo.localeCompare(b.codigoNuevo));

// --- 3) exportar a Excel ---
const wbOut = new ExcelJS.Workbook();
const wsOut = wbOut.addWorksheet('Lista maestra');
wsOut.columns = [
  { header: 'Código actual', key: 'codigoActual', width: 18 },
  { header: 'Código nuevo propuesto', key: 'codigoNuevo', width: 26 },
  { header: 'Descripción del código propuesto', key: 'descripcionPropuesta', width: 46 },
  { header: 'Descripción (original ERP)', key: 'descripcion', width: 42 },
  { header: 'Sede(s) / Almacén(es)', key: 'sedesAlmacenes', width: 28 },
  { header: 'Stock Disponible (total, todas las sedes)', key: 'stockTotal', width: 16 },
  { header: 'Tipo (original ERP)', key: 'tipoOriginal', width: 16 },
  { header: 'Tipo efectivo', key: 'tipoEfectivo', width: 18 },
  { header: 'Origen', key: 'origen', width: 14 },
  { header: 'Sistema', key: 'sistema', width: 18 },
  { header: 'Sub-Sistema', key: 'subSistema', width: 24 },
  { header: 'Marca del vehículo', key: 'marca', width: 18 },
  { header: 'Modelo', key: 'modelo', width: 16 },
  { header: 'Familia (original ERP)', key: 'familiaOriginal', width: 26 },
  { header: 'Precio de venta (S/)', key: 'precioVenta', width: 16 },
  { header: 'Costo de reposición (S/)', key: 'costoReposicion', width: 18 },
  { header: 'Costo promedio (S/)', key: 'costoPromedio', width: 16 },
  { header: 'Costo promedio (US$)', key: 'costoPromedioDolar', width: 16 },
  { header: 'Costo taller (S/)', key: 'costoTaller', width: 14 },
  { header: 'Valor total en stock (S/, todas las sedes)', key: 'valorStockTotal', width: 20 },
  { header: 'Proveedor', key: 'proveedor', width: 30 },
  { header: 'Ubicación (bin)', key: 'ubicacion', width: 16 },
  { header: 'Fecha últ. compra', key: 'fechaUltCompra', width: 14 },
  { header: 'Fecha últ. venta', key: 'fechaUltVenta', width: 14 },
  { header: 'Stock en calidad', key: 'stockCalidad', width: 12 },
  { header: 'Stock en reserva', key: 'stockReserva', width: 12 },
  { header: 'Stock bloqueado', key: 'stockBloqueado', width: 12 },
  { header: 'Stock en tránsito', key: 'stockTransito', width: 12 },
  { header: 'Stock comprometido', key: 'stockComprometido', width: 14 },
  { header: 'Valor en calidad (S/)', key: 'valorCalidad', width: 14 },
  { header: 'Valor en reserva (S/)', key: 'valorReserva', width: 14 },
  { header: 'Valor bloqueado (S/)', key: 'valorBloqueado', width: 14 },
  { header: 'Valor en tránsito (S/)', key: 'valorTransito', width: 14 },
  { header: 'Valor comprometido (S/)', key: 'valorComprometido', width: 16 },
  { header: 'MAD', key: 'mad', width: 10 },
  { header: 'ICC', key: 'icc', width: 10 },
  { header: 'Campaña', key: 'campana', width: 16 },
  { header: 'Valor Aux 1', key: 'valorAux1', width: 14 },
  { header: 'Valor Aux 2', key: 'valorAux2', width: 14 },
];
wsOut.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
wsOut.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
wsOut.addRows(filas);
wsOut.autoFilter = { from: 'A1', to: 'AM1' };
wsOut.views = [{ state: 'frozen', ySplit: 1 }];

// ============================================================
// Hoja 2: "Tablas de referencia" — el "diccionario" para leer/armar
// cualquier codigo (Sistema, Sub-Sistema, Marca vehiculo, Modelo, Tipo,
// Marca del repuesto), consolidado a nivel global (no repetido por sede
// como en los 4 archivos de Almacen).
// ============================================================
const wsRef = wbOut.addWorksheet('Tablas de referencia');

function escribirTabla(ws, colInicio, titulo, pares) {
  ws.getCell(1, colInicio).value = titulo;
  ws.getCell(1, colInicio).font = { bold: true, size: 12, color: { argb: 'FFB91C1C' } };
  ws.getCell(2, colInicio).value = 'Valor';
  ws.getCell(2, colInicio + 1).value = 'Código';
  for (let c = 0; c < 2; c++) {
    const cell = ws.getCell(2, colInicio + c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
  }
  let r = 3;
  for (const [valor, codigo] of pares) {
    ws.getCell(r, colInicio).value = valor;
    ws.getCell(r, colInicio + 1).value = codigo;
    r++;
  }
  ws.getColumn(colInicio).width = 30;
  ws.getColumn(colInicio + 1).width = 10;
  return r - 1; // ultima fila escrita, para las validaciones del Generador
}

const filaFinOrigen = escribirTabla(wsRef, 1, 'ORIGEN', Object.entries(ORIGEN_CODIGOS));
const filaFinSistema = escribirTabla(wsRef, 4, 'SISTEMA', Object.entries(SISTEMA_CODIGOS));
const filaFinSub = escribirTabla(wsRef, 7, 'SUB-SISTEMA', Object.entries(SUBSISTEMA_CODIGOS));
const filaFinMarca = escribirTabla(wsRef, 10, 'MARCA DEL VEHÍCULO', Object.entries(MARCA_VEHICULO_CODIGOS));
const filaFinModelo = escribirTabla(wsRef, 13, 'MODELO (según lo que ya existe en tu inventario)', [...obtenerCodigoModelo.mapa.entries()]);
const filaFinTipo = escribirTabla(wsRef, 16, 'TIPO', Object.entries(TIPO_CODIGOS));
const filaFinFabricante = escribirTabla(
  wsRef, 19, 'MARCA DEL REPUESTO (fabricante) — lista curada del mercado',
  MARCA_REPUESTO.map(([marca, codigo]) => [marca, codigo]),
);

// ============================================================
// Hoja 3: "Generador" — para codificar a mano un item NUEVO que todavia
// no esta en la lista maestra (mismo mecanismo del generador que ya
// tenias: desplegables + formulas INDEX/MATCH armando codigo y
// descripcion automaticamente).
// ============================================================
const wsGen = wbOut.addWorksheet('Generador');
wsGen.getCell('A1').value = 'GENERADOR — para un código NUEVO que todavía no está en "Lista maestra"';
wsGen.getCell('A1').font = { bold: true, size: 13 };
wsGen.getCell('A2').value = 'Elige cada campo del desplegable (columna B); el código y la descripción se arman solos abajo.';
wsGen.mergeCells('A1:D1');
wsGen.mergeCells('A2:D2');

const campos = [
  ['Origen', `'Tablas de referencia'!$A$3:$A$${filaFinOrigen}`, `'Tablas de referencia'!$B$3:$B$${filaFinOrigen}`],
  ['Sistema', `'Tablas de referencia'!$D$3:$D$${filaFinSistema}`, `'Tablas de referencia'!$E$3:$E$${filaFinSistema}`],
  ['Sub-Sistema', `'Tablas de referencia'!$G$3:$G$${filaFinSub}`, `'Tablas de referencia'!$H$3:$H$${filaFinSub}`],
  ['Marca del vehículo', `'Tablas de referencia'!$J$3:$J$${filaFinMarca}`, `'Tablas de referencia'!$K$3:$K$${filaFinMarca}`],
  ['Modelo', `'Tablas de referencia'!$M$3:$M$${filaFinModelo}`, `'Tablas de referencia'!$N$3:$N$${filaFinModelo}`],
  ['Tipo', `'Tablas de referencia'!$P$3:$P$${filaFinTipo}`, `'Tablas de referencia'!$Q$3:$Q$${filaFinTipo}`],
];

wsGen.getCell('A4').value = 'Campo';
wsGen.getCell('B4').value = 'Selecciona aquí';
wsGen.getCell('D4').value = 'Código';
wsGen.getRow(4).font = { bold: true };

campos.forEach(([nombre, rangoValores, rangoCodigos], i) => {
  const fila = 5 + i;
  wsGen.getCell(`A${fila}`).value = nombre;
  wsGen.dataValidations.add(`B${fila}`, {
    type: 'list',
    formulae: [rangoValores],
    allowBlank: true,
    showErrorMessage: true,
    errorTitle: 'Valor no válido',
    error: 'Elige un valor de la lista',
  });
  wsGen.getCell(`D${fila}`).value = {
    formula: `IFERROR(INDEX(${rangoCodigos},MATCH(B${fila},${rangoValores},0)),"")`,
  };
});
// filas 5-10 = Origen, Sistema, Sub-Sistema, Marca, Modelo, Tipo

wsGen.getCell('A12').value = 'Correlativo (tú lo asignas, revisando que no choque con uno ya usado)';
wsGen.mergeCells('A12:C12');
wsGen.getCell('D12').value = '0001';
wsGen.getCell('D12').numFmt = '0000';

wsGen.getCell('A14').value = 'CÓDIGO GENERADO:';
wsGen.getCell('A14').font = { bold: true };
// OJO: TEXTJOIN es una funcion "moderna" (Excel 2016+); cuando se escribe
// por programa hay que anteponerle "_xlfn." o Excel la muestra como
// #¿NOMBRE?/#NAME? aunque la formula este bien escrita. Al abrirla en
// Excel se ve normal, sin el prefijo.
wsGen.getCell('D14').value = { formula: '_xlfn.TEXTJOIN("-",TRUE,D5:D10,TEXT(D12,"0000"))' };
wsGen.getCell('D14').font = { bold: true, color: { argb: 'FF166534' } };

wsGen.getCell('A16').value = 'DESCRIPCIÓN PROPUESTA:';
wsGen.getCell('A16').font = { bold: true };
wsGen.getCell('D16').value = {
  formula: 'IF(OR(B5="",B6="",B7="",B8="",B9="",B10=""),"","" & B5 & " — " & B6 & " / " & B7 & " — " & B8 & " " & B9 & " — " & B10)',
};
wsGen.getCell('D16').font = { bold: true, color: { argb: 'FF166534' } };

// Validacion automatica: avisa si el codigo generado ya existe en la
// Lista maestra (evita que alguien reuse sin querer un codigo/correlativo
// que ya esta tomado).
wsGen.getCell('A18').value = '¿YA EXISTE ESE CÓDIGO?';
wsGen.getCell('A18').font = { bold: true };
wsGen.getCell('D18').value = {
  formula: 'IF(D14="","",IF(COUNTIF(\'Lista maestra\'!$B:$B,D14)>0,"⚠ Ya existe — cambia el correlativo (celda D12) y vuelve a intentar","✓ Libre, no está usado todavía"))',
};
wsGen.getCell('D18').font = { bold: true };
wsGen.getCell('D18').alignment = { wrapText: true };
wsGen.getRow(18).height = 30;

wsGen.getCell('A20').value = 'Cómo funciona:';
wsGen.getCell('A20').font = { bold: true };
wsGen.getCell('A21').value = '1. Elige Origen, Sistema, Sub-Sistema, Marca, Modelo y Tipo en los desplegables (columna B, filas 5-10).';
wsGen.getCell('A22').value = '2. Escribe un correlativo (D12) — cualquier número de 4 dígitos que se te ocurra para empezar, ej. 0001.';
wsGen.getCell('A23').value = '3. Revisa "¿YA EXISTE ESE CÓDIGO?" (D18): si dice "Ya existe", sube el correlativo (0002, 0003...) hasta que diga "Libre".';
wsGen.getCell('A24').value = '4. Copia el Código generado (D14) y la Descripción propuesta (D16) a la hoja "Lista maestra", como una fila nueva.';
wsGen.mergeCells('A21:D21');
wsGen.mergeCells('A22:D22');
wsGen.mergeCells('A23:D23');
wsGen.mergeCells('A24:D24');

wsGen.getColumn(1).width = 22;
wsGen.getColumn(2).width = 30;
wsGen.getColumn(3).width = 4;
wsGen.getColumn(4).width = 46;

const OUT = 'C:/Users/Sistemas Pineda/Desktop/Proyectos/reporte_facturacion/backend/reportes/Lista_Maestra_Codificacion_Almacen.xlsx';
await wbOut.xlsx.writeFile(OUT);
console.log('Guardado en:', OUT);
console.log('Filas:', filas.length);
console.log('Modelos distintos en la tabla de referencia:', obtenerCodigoModelo.mapa.size);
