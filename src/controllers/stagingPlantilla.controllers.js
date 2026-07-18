import { pool } from "../db.js";
import { stagingImports } from "../config/stagingImports.js";
import { bulkInsert } from "../utils/dbBulk.js";
import { parseSemicolonCsv } from "../utils/csv.js";
import { parseDetalleFacturaOtExcel, parseDetalleFacturaOtCsv } from "../utils/detalleFacturaOtExcel.js";
import { parseTabularExcel } from "../utils/tabularExcel.js";
import { HttpError } from "../utils/httpError.js";
import { readFile, unlink } from "fs/promises";

// Convierte las fechas recibidas por CSV al formato común utilizado en la base.
function normalizeImportDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const local = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (local) return `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
  return raw;
}

// Calcula un rango independiente por sede para archivos individuales o combinados.
function replacementScopes(parsed, periodColumn) {
  if (parsed.local && parsed.desde && parsed.hasta) {
    return [{ local: parsed.local, desde: parsed.desde, hasta: parsed.hasta }];
  }
  const localIndex = parsed.columns.indexOf("local_nombre");
  const dateIndex = parsed.columns.indexOf(periodColumn);
  if (localIndex < 0 || dateIndex < 0) return [];

  const byLocal = new Map();
  parsed.rows.forEach((row) => {
    const local = String(row[localIndex] || "").trim();
    const date = normalizeImportDate(row[dateIndex]);
    if (!local || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return;
    const scope = byLocal.get(local) || { local, desde: date, hasta: date };
    if (date < scope.desde) scope.desde = date;
    if (date > scope.hasta) scope.hasta = date;
    byLocal.set(local, scope);
  });
  return [...byLocal.values()];
}

// Lee CSV de los reportes tabulares y valida que ninguna fila esté incompleta.
async function parseCsv(filePath, config) {
  const csvText = await readFile(filePath, "latin1");
  const sourceRows = parseSemicolonCsv(csvText, config.skipLines)
    .filter((row) => row.some((value) => String(value ?? "").trim() !== ""));
  const incompleteIndex = sourceRows.findIndex((row) => row.length < config.columns.length);
  if (incompleteIndex >= 0) {
    throw new HttpError(400, `La fila ${incompleteIndex + (config.skipLines || 0) + 1} tiene menos columnas de las esperadas.`);
  }
  const rows = sourceRows.map((source) => config.columns.map((column, index) => (
    column.startsWith("fec_") ? normalizeImportDate(source[index]) : source[index] ?? null
  )));
  return { columns: config.columns, rows };
}

// Importa cualquiera de los tres reportes dentro de una única transacción.
const createPlantillaStaging = async (req, res, next) => {
  const file = req.file;
  try {
    const importType = String(req.body.import_type || "").trim();
    // hasOwnProperty evita que un import_type malicioso ("__proto__", "constructor")
    // devuelva Object.prototype en vez de undefined al indexar el objeto.
    const config = Object.prototype.hasOwnProperty.call(stagingImports, importType)
      ? stagingImports[importType]
      : undefined;
    if (!file) return res.status(400).json({ message: "Debes seleccionar un archivo para importar." });
    if (!config) return res.status(400).json({ message: "Tipo de importación no válido." });

    const extension = file.originalname.toLowerCase().split(".").pop();
    let parsed;
    if (extension === "xlsx") {
      parsed = config.parser === "detalle_factura_ot"
        ? parseDetalleFacturaOtExcel(file.path)
        : parseTabularExcel(file.path, config);
    } else if (extension === "csv" && config.parser === "detalle_factura_ot") {
      const csvText = await readFile(file.path, "latin1");
      parsed = parseDetalleFacturaOtCsv(csvText);
    } else if (extension === "csv" && config.format !== "xlsx") {
      parsed = await parseCsv(file.path, config);
    } else {
      const expected = config.format === "xlsx" ? "un archivo .xlsx" : "un archivo .xlsx o .csv";
      return res.status(400).json({ message: `Formato no permitido. Selecciona ${expected}.` });
    }

    const { columns, rows } = parsed;
    if (!rows.length) return res.status(400).json({ message: "No se encontraron filas válidas en el archivo." });

    let scopes = [];
    if (config.replacePeriod) {
      const periodColumn = config.replacePeriodColumn;
      if (!periodColumn || !columns.includes(periodColumn)) {
        throw new HttpError(400, "La importación no tiene configurada una fecha válida para reemplazar el periodo.");
      }
      scopes = replacementScopes(parsed, periodColumn);
      if (!scopes.length) {
        throw new HttpError(400, "No se pudo detectar la sede y el periodo en las filas importadas.");
      }
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const scope of scopes) {
        await connection.execute(
          `DELETE FROM \`${config.table}\` WHERE local_nombre = ? AND \`${config.replacePeriodColumn}\` BETWEEN ? AND ?`,
          [scope.local, scope.desde, scope.hasta],
        );
      }
      await bulkInsert(config.table, columns, rows, connection, { upsert: Boolean(config.upsert) });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const desde = scopes.length ? scopes.map((scope) => scope.desde).sort()[0] : parsed.desde || null;
    const hasta = scopes.length ? scopes.map((scope) => scope.hasta).sort().at(-1) : parsed.hasta || null;
    const locales = scopes.length ? scopes.map((scope) => scope.local) : parsed.local ? [parsed.local] : [];
    return res.json({
      message: `${config.label} importado correctamente.`,
      tabla: config.table,
      filas_importadas: rows.length,
      local: locales.join(", ") || null,
      locales,
      desde,
      hasta,
    });
  } catch (error) {
    return next(error);
  } finally {
    if (file?.path) await unlink(file.path).catch(() => {});
  }
};

export default createPlantillaStaging;
