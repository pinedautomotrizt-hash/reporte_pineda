import XLSX from "xlsx";
import { HttpError } from "./httpError.js";
import { fixSheetRange } from "./xlsxRange.js";

const text = (value) => String(value ?? "").trim();

function capitalizarSede(valor) {
  return valor
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((palabra) => palabra.charAt(0).toUpperCase() + palabra.slice(1))
    .join(" ");
}

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
  fixSheetRange(sheet);
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  // Hay reportes que no repiten la sede en cada fila sino que la declaran una
  // sola vez en la cabecera (ej. "LOCAL | PINEDA TRUJILLO" en la fila 2).
  // localFromHeader: [fila, columna] en coordenadas de la matriz (base 0).
  // El ERP escribe la sede en mayusculas ("PINEDA TRUJILLO") pero el resto de
  // tablas la guarda capitalizada ("Pineda Trujillo"); si no se normaliza, los
  // cruces por local_nombre no encuentran nada.
  const localCabecera = config.localFromHeader
    ? capitalizarSede(text(matrix[config.localFromHeader[0]]?.[config.localFromHeader[1]]))
    : null;
  if (config.localFromHeader && !localCabecera) {
    throw new HttpError(400, "No se pudo leer la sede en la cabecera del reporte.");
  }

  // Columnas que sí vienen en las filas de datos. Si la sede sale de la
  // cabecera, no ocupa posición en el archivo.
  const columnasEnArchivo = localCabecera
    ? config.columns.filter((column) => column !== "local_nombre")
    : config.columns;

  const sourceRows = matrix.slice(config.skipLines || 0)
    .filter((row) => row.some((value) => value !== null && text(value) !== ""));
  if (!sourceRows.length) throw new HttpError(400, "No se encontraron datos desde la fila 6.");
  const rows = sourceRows.map((source, rowIndex) => {
    if (source.length < columnasEnArchivo.length) {
      throw new HttpError(400, `La fila ${rowIndex + (config.skipLines || 0) + 1} tiene ${source.length} columnas; se esperaban ${columnasEnArchivo.length}.`);
    }
    return config.columns.map((column) => {
      if (localCabecera && column === "local_nombre") return localCabecera;
      const index = columnasEnArchivo.indexOf(column);
      if (column.startsWith("fec_")) return normalizeDate(source[index]);
      const valor = source[index];
      // emptyAsNull: una celda vacia no es lo mismo que un dato en blanco. En
      // el seguimiento, estado vacio significa "pendiente" y debe poder
      // consultarse con IS NULL, no comparando contra cadena vacia.
      if (config.emptyAsNull && text(valor) === "") return null;
      return valor;
    });
  });
  const localIndex = config.columns.indexOf("local_nombre");
  const locals = localIndex >= 0 ? [...new Set(rows.map((row) => text(row[localIndex])).filter(Boolean))] : [];
  const dateColumn = config.dateColumn
    || (config.columns.includes("fec_documento") ? "fec_documento" : "fec_apertura");
  const dateIndex = config.columns.indexOf(dateColumn);
  const dates = dateIndex >= 0 ? rows.map((row) => normalizeDate(row[dateIndex])).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort() : [];
  return { columns: config.columns, rows, local: locals.length === 1 ? locals[0] : null, desde: dates[0] || null, hasta: dates.at(-1) || null };
}
