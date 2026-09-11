import mysql from "mysql2/promise";
import dotenv from "dotenv";
import xlsx from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de entorno desde backend/.env
dotenv.config({ path: path.join(__dirname, "../.env") });

const excelPath = process.env.EXCEL_LISTA_MAESTRA_PATH || "C:\\Users\\Sistemas Pineda\\Downloads\\Lista_Maestra_Codificacion_Almacen_General.xlsx";

function parseNum(val) {
  if (val === null || val === undefined || val === "") return 0;
  const num = Number(val);
  return isNaN(num) ? 0 : num;
}

function parseStr(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  return str === "" ? null : str;
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  const str = String(val).trim();
  if (!str || str.toLowerCase() === "null" || str.toLowerCase() === "nan") return null;
  
  // Si viene como número de días Excel (ej. 45123)
  if (!isNaN(Number(str))) {
    const d = xlsx.SSF.parse_date_code(Number(str));
    if (d) {
      const yyyy = String(d.y).padStart(4, "0");
      const mm = String(d.m).padStart(2, "0");
      const dd = String(d.d).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  // Intentar parsear cadenas estándar YYYY-MM-DD o DD/MM/YYYY
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  const parts = str.split(/[\/\-]/);
  if (parts.length === 3) {
    if (parts[2].length === 4) {
      return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
    }
  }
  return null;
}

async function runImport() {
  console.log("=== INICIANDO IMPORTACIÓN DE LISTA MAESTRA DE ALMACÉN EN MYSQL ===");
  console.log("Ruta de archivo Excel:", excelPath);

  if (!fs.existsSync(excelPath)) {
    console.error("ERROR: No se encontró el archivo Excel en:", excelPath);
    process.exit(1);
  }

  // 1. Conectar a MySQL
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "pineda_dash",
    multipleStatements: true,
  });

  console.log("Conectado con éxito a MySQL DB:", process.env.DB_NAME || "pineda_dash");

  // 2. Crear tabla si no existe
  const ddlPath = path.join(__dirname, "../sql/crear_lista_maestra_almacen.sql");
  if (fs.existsSync(ddlPath)) {
    const ddl = fs.readFileSync(ddlPath, "utf8");
    await connection.query(ddl);
    console.log("Tabla `lista_maestra_almacen` lista y verificada.");
  }

  // 3. Leer Excel
  console.log("Leyendo archivo Excel (Hoja: Lista maestra)...");
  const workbook = xlsx.readFile(excelPath, { cellDates: true });
  const sheetName = workbook.SheetNames.includes("Lista maestra") ? "Lista maestra" : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

  console.log(`Total de registros leídos en el Excel: ${rows.length}`);

  if (rows.length === 0) {
    console.log("No hay registros para importar.");
    await connection.end();
    return;
  }

  // Detectar nombres exactos de columnas
  const sample = rows[0];
  const keys = Object.keys(sample);

  const getCol = (possibleNames) => {
    for (const name of possibleNames) {
      const match = keys.find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, "").includes(name.toLowerCase().replace(/[^a-z0-9]/g, "")));
      if (match) return match;
    }
    return null;
  };

  const colCodigoActual = getCol(["Código actual", "Codigo actual", "codigo_actual"]);
  const colCodigoNuevo = getCol(["Código nuevo propuesto", "Codigo nuevo propuesto", "codigo_nuevo"]);
  const colDescProp = getCol(["Descripción del código propuesto", "Descripcion del codigo propuesto"]);
  const colDescERP = getCol(["Descripción (original ERP)", "Descripcion (original ERP)", "ERP"]);
  const colSedes = getCol(["Sede(s) / Almacén(es)", "Sedes"]);
  const colStockDisp = getCol(["Stock Disponible", "Stock Disponible (total, todas las sedes)"]);
  const colOrigen = getCol(["Origen"]);
  const colSistema = getCol(["Sistema"]);
  const colSubSistema = getCol(["Sub-Sistema", "SubSistema"]);
  const colMarcaVeh = getCol(["Marca del vehículo", "Marca del vehiculo"]);
  const colModelo = getCol(["Modelo"]);
  const colDescripcion = getCol(["Descripcion", "Descripción"]);
  const colFamiliaERP = getCol(["Familia (original ERP)", "Familia"]);
  const colPrecioVenta = getCol(["Precio de venta"]);
  const colCostoRepo = getCol(["Costo de reposición", "Costo de reposicion"]);
  const colCostoPromSoles = getCol(["Costo promedio (S/)"]);
  const colCostoPromUSD = getCol(["Costo promedio (US$)"]);
  const colCostoTaller = getCol(["Costo taller"]);
  const colValorStock = getCol(["Valor total en stock"]);
  const colProveedor = getCol(["Proveedor"]);
  const colBin = getCol(["Ubicación (bin)", "Ubicacion"]);
  const colFechaCompra = getCol(["Fecha últ. compra", "Fecha ult. compra"]);
  const colFechaVenta = getCol(["Fecha últ. venta", "Fecha ult. venta"]);
  const colStockCalidad = getCol(["Stock en calidad"]);
  const colStockReserva = getCol(["Stock en reserva"]);
  const colStockBloqueado = getCol(["Stock bloqueado"]);
  const colStockTransito = getCol(["Stock en tránsito", "Stock en transito"]);
  const colStockComp = getCol(["Stock comprometido"]);
  const colValorCalidad = getCol(["Valor en calidad"]);
  const colValorReserva = getCol(["Valor en reserva"]);
  const colValorBloqueado = getCol(["Valor bloqueado"]);
  const colValorTransito = getCol(["Valor en tránsito", "Valor en transito"]);
  const colValorComp = getCol(["Valor comprometido"]);
  const colMAD = getCol(["MAD"]);
  const colICC = getCol(["ICC"]);
  const colCampana = getCol(["Campaña", "Campana"]);
  const colAux1 = getCol(["Valor Aux 1"]);
  const colAux2 = getCol(["Valor Aux 2"]);

  const sqlInsert = `
    INSERT INTO lista_maestra_almacen (
      codigo_actual, codigo_nuevo_propuesto, descripcion_codigo_propuesto, descripcion_original_erp,
      sedes_almacenes, stock_disponible, origen, sistema, sub_sistema, marca_vehiculo, modelo,
      descripcion, familia_original_erp, precio_venta, costo_reposicion, costo_promedio_soles,
      costo_promedio_dolares, costo_taller, valor_total_stock, proveedor, ubicacion_bin,
      fecha_ult_compra, fecha_ult_venta, stock_calidad, stock_reserva, stock_bloqueado,
      stock_transito, stock_comprometido, valor_calidad, valor_reserva, valor_bloqueado,
      valor_transito, valor_comprometido, mad, icc, campana, valor_aux_1, valor_aux_2
    ) VALUES ?
    ON DUPLICATE KEY UPDATE
      codigo_nuevo_propuesto = VALUES(codigo_nuevo_propuesto),
      descripcion_codigo_propuesto = VALUES(descripcion_codigo_propuesto),
      descripcion_original_erp = VALUES(descripcion_original_erp),
      sedes_almacenes = VALUES(sedes_almacenes),
      stock_disponible = VALUES(stock_disponible),
      origen = VALUES(origen),
      sistema = VALUES(sistema),
      sub_sistema = VALUES(sub_sistema),
      marca_vehiculo = VALUES(marca_vehiculo),
      modelo = VALUES(modelo),
      descripcion = VALUES(descripcion),
      familia_original_erp = VALUES(familia_original_erp),
      precio_venta = VALUES(precio_venta),
      costo_reposicion = VALUES(costo_reposicion),
      costo_promedio_soles = VALUES(costo_promedio_soles),
      costo_promedio_dolares = VALUES(costo_promedio_dolares),
      costo_taller = VALUES(costo_taller),
      valor_total_stock = VALUES(valor_total_stock),
      proveedor = VALUES(proveedor),
      ubicacion_bin = VALUES(ubicacion_bin),
      fecha_ult_compra = VALUES(fecha_ult_compra),
      fecha_ult_venta = VALUES(fecha_ult_venta),
      stock_calidad = VALUES(stock_calidad),
      stock_reserva = VALUES(stock_reserva),
      stock_bloqueado = VALUES(stock_bloqueado),
      stock_transito = VALUES(stock_transito),
      stock_comprometido = VALUES(stock_comprometido),
      valor_calidad = VALUES(valor_calidad),
      valor_reserva = VALUES(valor_reserva),
      valor_bloqueado = VALUES(valor_bloqueado),
      valor_transito = VALUES(valor_transito),
      valor_comprometido = VALUES(valor_comprometido),
      mad = VALUES(mad),
      icc = VALUES(icc),
      campana = VALUES(campana),
      valor_aux_1 = VALUES(valor_aux_1),
      valor_aux_2 = VALUES(valor_aux_2)
  `;

  // Preparar lotes
  const batchSize = 500;
  let batch = [];
  let totalProcessed = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const codigoActual = parseStr(r[colCodigoActual]);
    if (!codigoActual) continue;

    const rowValues = [
      codigoActual,
      parseStr(r[colCodigoNuevo]),
      parseStr(r[colDescProp]),
      parseStr(r[colDescERP]),
      parseStr(r[colSedes]),
      parseNum(r[colStockDisp]),
      parseStr(r[colOrigen]),
      parseStr(r[colSistema]),
      parseStr(r[colSubSistema]),
      parseStr(r[colMarcaVeh]),
      parseStr(r[colModelo]),
      parseStr(r[colDescripcion]),
      parseStr(r[colFamiliaERP]),
      parseNum(r[colPrecioVenta]),
      parseNum(r[colCostoRepo]),
      parseNum(r[colCostoPromSoles]),
      parseNum(r[colCostoPromUSD]),
      parseNum(r[colCostoTaller]),
      parseNum(r[colValorStock]),
      parseStr(r[colProveedor]),
      parseStr(r[colBin]),
      parseDate(r[colFechaCompra]),
      parseDate(r[colFechaVenta]),
      parseNum(r[colStockCalidad]),
      parseNum(r[colStockReserva]),
      parseNum(r[colStockBloqueado]),
      parseNum(r[colStockTransito]),
      parseNum(r[colStockComp]),
      parseNum(r[colValorCalidad]),
      parseNum(r[colValorReserva]),
      parseNum(r[colValorBloqueado]),
      parseNum(r[colValorTransito]),
      parseNum(r[colValorComp]),
      parseNum(r[colMAD]),
      parseStr(r[colICC]),
      parseStr(r[colCampana]),
      parseStr(r[colAux1]),
      parseStr(r[colAux2]),
    ];

    batch.push(rowValues);

    if (batch.length >= batchSize || i === rows.length - 1) {
      await connection.query(sqlInsert, [batch]);
      totalProcessed += batch.length;
      console.log(`Progreso: ${totalProcessed} / ${rows.length} registros procesados...`);
      batch = [];
    }
  }

  console.log(`\n✅ IMPORTACIÓN FINALIZADA CON ÉXITO.`);
  console.log(`Se importaron/actualizaron ${totalProcessed} registros en la tabla \`lista_maestra_almacen\`.`);

  await connection.end();
}

runImport().catch((err) => {
  console.error("❌ ERROR DURANTE LA IMPORTACIÓN:", err);
  process.exit(1);
});
