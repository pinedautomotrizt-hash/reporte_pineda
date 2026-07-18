import crypto from "node:crypto";
import XLSX from "xlsx";
import { parseSemicolonCsv } from "./csv.js";
import { HttpError } from "./httpError.js";

export const detalleFacturaOtColumns = [
  "local_nombre", "fec_emision", "nro_documento", "nro_ot", "fec_apertura",
  "placa", "marca", "modelo", "version", "grupo_servicio", "clase_ot",
  "tipo_ot", "origen", "codigo", "descripcion", "tipo_danio", "nro_panos",
  "horas_hombre", "cantidad", "total_con_igv", "asesor", "tecnico_asignado",
  "departamento", "provincia", "distrito", "huella_detalle", "ocurrencia",
];

const text = (value) => String(value ?? "").trim();

function detectLocal(value) {
  const normalized = text(value).toUpperCase();
  if (normalized.includes("CALLAO")) return "Pineda Callao";
  if (normalized.includes("TRUJILLO")) return "Pineda Trujillo";
  throw new HttpError(400, `No se pudo reconocer el local: ${text(value) || "encabezado vacio"}.`);
}

function isoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  const match = text(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : null;
}

function decimal(value) {
  const parsed = Number(String(value ?? "0").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

// Compartido por el parser de Excel y el de CSV: ambos formatos exportan el
// mismo reporte con el mismo layout (fila 2 = local, fila 3 = periodo, datos
// desde la fila 6), solo cambia como se obtiene la matriz de celdas.
function buildDetalleFacturaOtFromMatrix(matrix) {
  const local = detectLocal(matrix[1]?.[2]);
  const sourceRows = matrix.slice(5).filter((row) => text(row[1]) && text(row[2]));
  if (!sourceRows.length) throw new HttpError(400, "No se encontraron detalles desde la fila 6.");

  const headerDates = [...text(matrix[2]?.[2]).matchAll(/\d{4}-\d{2}-\d{2}/g)].map((item) => item[0]);
  const rowDates = sourceRows.map((row) => isoDate(row[0])).filter(Boolean).sort();
  const desde = headerDates[0] || rowDates[0];
  const hasta = headerDates[1] || rowDates.at(-1);
  if (!desde || !hasta) throw new HttpError(400, "No se pudo determinar el periodo del reporte.");

  const occurrences = new Map();
  const rows = sourceRows.map((row, index) => {
    const emissionDate = isoDate(row[0]);
    if (!emissionDate) throw new HttpError(400, `Fecha invalida en la fila ${index + 6}.`);
    const detail = [
      local, emissionDate, text(row[1]), text(row[2]), isoDate(row[3]), text(row[4]),
      text(row[5]), text(row[6]), text(row[7]), text(row[8]), text(row[9]), text(row[10]),
      text(row[11]).toUpperCase() || "OTRO", text(row[12]), text(row[13]), text(row[14]),
      decimal(row[15]), decimal(row[16]), decimal(row[17]), decimal(row[18]), text(row[19]),
      text(row[20]), text(row[21]), text(row[22]), text(row[23]),
    ];
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify(detail)).digest("hex");
    const key = `${local}|${detail[2]}|${detail[3]}|${fingerprint}`;
    const occurrence = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, occurrence);
    return [...detail, fingerprint, occurrence];
  });
  return { columns: detalleFacturaOtColumns, rows, local, desde, hasta };
}

export function parseDetalleFacturaOtExcel(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new HttpError(400, "El Excel no contiene hojas para importar.");
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  return buildDetalleFacturaOtFromMatrix(matrix);
}

// Mismo reporte que parseDetalleFacturaOtExcel, exportado como CSV en vez de
// Excel (usa el mismo separador ';' que Registro de Venta y Ordenes de Trabajo).
export function parseDetalleFacturaOtCsv(csvText) {
  const matrix = parseSemicolonCsv(csvText, 0);
  if (!matrix.length) throw new HttpError(400, "El CSV no contiene filas para importar.");
  return buildDetalleFacturaOtFromMatrix(matrix);
}
