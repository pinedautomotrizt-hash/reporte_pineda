import XLSX from "xlsx";
import { HttpError } from "./httpError.js";

const text = (value) => String(value ?? "").trim();

// Normaliza fechas de Excel o texto a YYYY-MM-DD cuando la columna es fecha.
function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  const source = text(value);
  const iso = source.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const local = source.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (local) return `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
  return source || null;
}

// Lee reportes tabulares Excel usando el mismo orden de columnas que el CSV.
export function parseTabularExcel(filePath, config) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new HttpError(400, "El Excel no contiene hojas para importar.");
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const sourceRows = matrix.slice(config.skipLines || 0)
    .filter((row) => row.some((value) => value !== null && text(value) !== ""));
  if (!sourceRows.length) throw new HttpError(400, "No se encontraron datos desde la fila 6.");
  const rows = sourceRows.map((source, rowIndex) => {
    if (source.length < config.columns.length) {
      throw new HttpError(400, `La fila ${rowIndex + (config.skipLines || 0) + 1} tiene ${source.length} columnas; se esperaban ${config.columns.length}.`);
    }
    return config.columns.map((column, index) => column.startsWith("fec_") ? normalizeDate(source[index]) : source[index]);
  });
  const localIndex = config.columns.indexOf("local_nombre");
  const locals = localIndex >= 0 ? [...new Set(rows.map((row) => text(row[localIndex])).filter(Boolean))] : [];
  const dateColumn = config.columns.includes("fec_documento") ? "fec_documento" : "fec_apertura";
  const dateIndex = config.columns.indexOf(dateColumn);
  const dates = dateIndex >= 0 ? rows.map((row) => normalizeDate(row[dateIndex])).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort() : [];
  return { columns: config.columns, rows, local: locals.length === 1 ? locals[0] : null, desde: dates[0] || null, hasta: dates.at(-1) || null };
}
