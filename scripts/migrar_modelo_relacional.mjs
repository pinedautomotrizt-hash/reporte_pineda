import mysql from "mysql2/promise";
import dotenv from "dotenv";
import xlsx from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

const excelPath = "C:\\Users\\Sistemas Pineda\\Downloads\\Lista_Maestra_Codificacion_Almacen_General_02.xlsx";

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
  
  if (!isNaN(Number(str))) {
    const d = xlsx.SSF.parse_date_code(Number(str));
    if (d) {
      const yyyy = String(d.y).padStart(4, "0");
      const mm = String(d.m).padStart(2, "0");
      const dd = String(d.d).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  const parts = str.split(/[\/\-]/);
  if (parts.length === 3 && parts[2].length === 4) {
    return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }
  return null;
}

async function runRelationalMigration() {
  console.log("=== INICIANDO MIGRACIÓN AL MODELO RELACIONAL NORMALIZADO ===");
  console.log("Archivo fuente:", excelPath);

  if (!fs.existsSync(excelPath)) {
    console.error("ERROR: No se encontró el archivo Excel 02 en:", excelPath);
    process.exit(1);
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "pineda_dash",
    multipleStatements: true,
  });

  console.log("Conectado a MySQL DB:", process.env.DB_NAME || "pineda_dash");

  // 1. Ejecutar DDL Relacional
  console.log("Creando tablas catálogo y estructura relacional...");
  await connection.query("SET FOREIGN_KEY_CHECKS = 0;");
  await connection.query("DROP TABLE IF EXISTS `lista_maestra_almacen`;");
  await connection.query("SET FOREIGN_KEY_CHECKS = 1;");

  const ddlSql = fs.readFileSync(path.join(__dirname, "../sql/crear_modelo_relacional_almacen.sql"), "utf8");
  await connection.query(ddlSql);
  console.log("Estructura relacional de tablas verificada con éxito.");

  // Helper para obtener o insertar en tabla catálogo
  const catalogCache = {
    cat_sede: new Map(),
    cat_tipo: new Map(),
    cat_origen: new Map(),
    cat_sistema: new Map(),
    cat_subsistema: new Map(),
    cat_marca_vehiculo: new Map(),
    cat_modelo: new Map(),
    cat_familia: new Map(),
  };

  async function getOrInsertCatalogId(tableName, nameVal, codeVal = null) {
    if (!nameVal || nameVal.trim() === "") return null;
    const cleanName = nameVal.trim();
    const cache = catalogCache[tableName];

    if (cache.has(cleanName)) {
      return cache.get(cleanName);
    }

    // Buscar en BD
    const [existing] = await connection.query(`SELECT id FROM ${tableName} WHERE nombre = ?`, [cleanName]);
    if (existing.length > 0) {
      const id = existing[0].id;
      cache.set(cleanName, id);
      return id;
    }

    // Insertar nuevo
    const hasCode = ["cat_tipo", "cat_origen", "cat_sistema", "cat_subsistema", "cat_marca_vehiculo", "cat_modelo"].includes(tableName);
    let res;
    if (hasCode) {
      [res] = await connection.query(`INSERT INTO ${tableName} (nombre, codigo) VALUES (?, ?)`, [cleanName, codeVal]);
    } else {
      [res] = await connection.query(`INSERT INTO ${tableName} (nombre) VALUES (?)`, [cleanName]);
    }

    const newId = res.insertId;
    cache.set(cleanName, newId);
    return newId;
  }

  // 2. Leer Excel
  console.log("Leyendo datos del Excel 02...");
  const workbook = xlsx.readFile(excelPath, { cellDates: true });

  // 3. Poblar catálogos desde sheet 'Tablas de referencia' si existe
  if (workbook.SheetNames.includes("Tablas de referencia")) {
    console.log("Poblando códigos desde 'Tablas de referencia'...");
    const refSheet = workbook.Sheets["Tablas de referencia"];
    const refData = xlsx.utils.sheet_to_json(refSheet, { header: 1 });

    if (refData.length > 2) {
      // Recorrer filas de referencia para Origen, Sistema, Sub-sistema, Marca, Modelo, Tipo
      for (let r = 2; r < refData.length; r++) {
        const row = refData[r];
        if (!row) continue;

        // Origen (col 0, 1)
        if (row[0] && String(row[0]).toLowerCase() !== "valor") {
          await getOrInsertCatalogId("cat_origen", String(row[0]), parseStr(row[1]));
        }
        // Sistema (col 3, 4)
        if (row[3] && String(row[3]).toLowerCase() !== "valor") {
          await getOrInsertCatalogId("cat_sistema", String(row[3]), parseStr(row[4]));
        }
        // Sub-sistema (col 6, 7)
        if (row[6] && String(row[6]).toLowerCase() !== "valor") {
          await getOrInsertCatalogId("cat_subsistema", String(row[6]), parseStr(row[7]));
        }
        // Marca vehiculo (col 9, 10)
        if (row[9] && String(row[9]).toLowerCase() !== "valor") {
          await getOrInsertCatalogId("cat_marca_vehiculo", String(row[9]), parseStr(row[10]));
        }
        // Modelo (col 12, 13)
        if (row[12] && String(row[12]).toLowerCase() !== "valor") {
          await getOrInsertCatalogId("cat_modelo", String(row[12]), parseStr(row[13]));
        }
        // Tipo (col 15, 16)
        if (row[15] && String(row[15]).toLowerCase() !== "valor") {
          await getOrInsertCatalogId("cat_tipo", String(row[15]), parseStr(row[16]));
        }
      }
    }
  }

  // 4. Leer sheet 'Lista maestra' e insertar repuestos
  const sheetName = workbook.SheetNames.includes("Lista maestra") ? "Lista maestra" : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

  console.log(`Poblando ${rows.length} registros en la tabla relacional...`);

  const keys = Object.keys(rows[0]);
  const getCol = (names) => {
    for (const name of names) {
      const match = keys.find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, "").includes(name.toLowerCase().replace(/[^a-z0-9]/g, "")));
      if (match) return match;
    }
    return null;
  };

  const colCodigoActual = getCol(["Código actual", "codigo_actual"]);
  const colCodigoNuevo = getCol(["Código nuevo propuesto", "codigo_nuevo"]);
  const colDescProp = getCol(["Descripción del código propuesto"]);
  const colDescERP = getCol(["Descripción (original ERP)", "ERP"]);
  const colSedes = getCol(["Sede(s) / Almacén(es)", "Sedes"]);
  const colStockDisp = getCol(["Stock Disponible"]);
  const colOrigen = getCol(["Origen"]);
  const colSistema = getCol(["Sistema"]);
  const colSubSistema = getCol(["Sub-Sistema", "SubSistema"]);
  const colMarcaVeh = getCol(["Marca del vehículo"]);
  const colModelo = getCol(["Modelo"]);
  const colDescripcion = getCol(["Descripcion"]);
  const colFamiliaERP = getCol(["Familia (original ERP)"]);
  const colPrecioVenta = getCol(["Precio de venta"]);
  const colCostoRepo = getCol(["Costo de reposición"]);
  const colCostoPromSoles = getCol(["Costo promedio (S/)"]);
  const colCostoPromUSD = getCol(["Costo promedio (US$)"]);
  const colCostoTaller = getCol(["Costo taller"]);
  const colValorStock = getCol(["Valor total en stock"]);
  const colProveedor = getCol(["Proveedor"]);
  const colBin = getCol(["Ubicación (bin)"]);
  const colFechaCompra = getCol(["Fecha últ. compra"]);
  const colFechaVenta = getCol(["Fecha últ. venta"]);
  const colStockCalidad = getCol(["Stock en calidad"]);
  const colStockReserva = getCol(["Stock en reserva"]);
  const colStockBloqueado = getCol(["Stock bloqueado"]);
  const colStockTransito = getCol(["Stock en tránsito"]);
  const colStockComp = getCol(["Stock comprometido"]);
  const colValorCalidad = getCol(["Valor en calidad"]);
  const colValorReserva = getCol(["Valor en reserva"]);
  const colValorBloqueado = getCol(["Valor bloqueado"]);
  const colValorTransito = getCol(["Valor en tránsito"]);
  const colValorComp = getCol(["Valor comprometido"]);
  const colMAD = getCol(["MAD"]);
  const colICC = getCol(["ICC"]);
  const colCampana = getCol(["Campaña"]);
  const colAux1 = getCol(["Valor Aux 1"]);
  const colAux2 = getCol(["Valor Aux 2"]);

  const sqlInsert = `
    INSERT INTO lista_maestra_almacen (
      codigo_actual, codigo_nuevo_propuesto, descripcion_codigo_propuesto, descripcion_original_erp,
      id_sede, id_tipo, id_origen, id_sistema, id_subsistema, id_marca_vehiculo, id_modelo, id_familia,
      descripcion, stock_disponible, precio_venta, costo_reposicion, costo_promedio_soles,
      costo_promedio_dolares, costo_taller, valor_total_stock, proveedor, ubicacion_bin,
      fecha_ult_compra, fecha_ult_venta, stock_calidad, stock_reserva, stock_bloqueado,
      stock_transito, stock_comprometido, valor_calidad, valor_reserva, valor_bloqueado,
      valor_transito, valor_comprometido, mad, icc, campana, valor_aux_1, valor_aux_2
    ) VALUES ?
  `;

  const batchSize = 500;
  let batch = [];
  let totalProcessed = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const codigoActual = parseStr(r[colCodigoActual]);
    if (!codigoActual) continue;

    // Resolver Llaves Foráneas
    const idSede = await getOrInsertCatalogId("cat_sede", parseStr(r[colSedes]));
    const idOrigen = await getOrInsertCatalogId("cat_origen", parseStr(r[colOrigen]));
    const idSistema = await getOrInsertCatalogId("cat_sistema", parseStr(r[colSistema]));
    const idSubSistema = await getOrInsertCatalogId("cat_subsistema", parseStr(r[colSubSistema]));
    const idMarca = await getOrInsertCatalogId("cat_marca_vehiculo", parseStr(r[colMarcaVeh]));
    const idModelo = await getOrInsertCatalogId("cat_modelo", parseStr(r[colModelo]));
    const idFamilia = await getOrInsertCatalogId("cat_familia", parseStr(r[colFamiliaERP]));
    
    // Tipo: derivado del código propuesto (ej. R si contiene -R-) o default REPUESTOS
    let tipoStr = "REPUESTOS";
    const codProp = parseStr(r[colCodigoNuevo]);
    if (codProp) {
      if (codProp.includes("-R-")) tipoStr = "REPUESTOS";
      else if (codProp.includes("-I-")) tipoStr = "INSUMOS";
      else if (codProp.includes("-AC-")) tipoStr = "ACCESORIOS";
      else if (codProp.includes("-SM-")) tipoStr = "SUMINISTROS";
    }
    const idTipo = await getOrInsertCatalogId("cat_tipo", tipoStr);

    const rowValues = [
      codigoActual,
      codProp,
      parseStr(r[colDescProp]),
      parseStr(r[colDescERP]),
      idSede,
      idTipo,
      idOrigen,
      idSistema,
      idSubSistema,
      idMarca,
      idModelo,
      idFamilia,
      parseStr(r[colDescripcion]),
      parseNum(r[colStockDisp]),
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
      console.log(`Progreso: ${totalProcessed} / ${rows.length} registros insertados...`);
      batch = [];
    }
  }

  console.log(`\n🎉 MIGRACIÓN COMPLETA FINALIZADA.`);
  console.log(`Se migraron relacionalmente ${totalProcessed} repuestos y se popularon todos los catálogos.`);

  await connection.end();
}

runRelationalMigration().catch((err) => {
  console.error("❌ ERROR EN MIGRACIÓN RELACIONAL:", err);
  process.exit(1);
});
