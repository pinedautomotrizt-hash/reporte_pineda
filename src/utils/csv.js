
// Lee archivos CSV separados por punto y coma, elimina lineas vacias y salta cabeceras.
export function parseSemicolonCsv(text, skipLines = 5) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(skipLines)
    .map((line) => line.split(";"));
}