
// Separa una linea respetando comillas CSV: un ';' dentro de "..." es texto,
// no un separador, y "" dentro de comillas representa una comilla literal.
function splitCsvLine(line, delimiter = ";") {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"' && current === "") {
      inQuotes = true;
    } else if (char === delimiter) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// Lee archivos CSV separados por punto y coma, elimina lineas vacias y salta cabeceras.
export function parseSemicolonCsv(text, skipLines = 5) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(skipLines)
    .map((line) => splitCsvLine(line));
}