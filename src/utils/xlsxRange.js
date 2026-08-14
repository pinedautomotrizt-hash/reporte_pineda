import XLSX from "xlsx";

// Algunos exportadores dejan la etiqueta interna "!ref" (el rango declarado
// de la hoja) mas chica que los datos reales que escribieron despues -
// sheet_to_json() confia en esa etiqueta y corta ahi, descartando filas
// reales sin avisar (visto en un Registro de Venta que declaraba A1:T1812
// pero seguia teniendo datos hasta la fila 4468). Esto recalcula el rango
// real recorriendo las celdas que existen de verdad, y solo lo corrige si
// el declarado se queda corto (nunca lo achica, por si el declarado es
// mayor que las celdas con datos, algo tambien valido en Excel).
export function fixSheetRange(sheet) {
  let maxRow = 0;
  let maxCol = 0;
  let hasCells = false;
  Object.keys(sheet).forEach((key) => {
    if (key.startsWith("!")) return;
    hasCells = true;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (r > maxRow) maxRow = r;
    if (c > maxCol) maxCol = c;
  });
  if (!hasCells) return;

  const declared = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
  if (declared && declared.e.r >= maxRow && declared.e.c >= maxCol) return;

  const fixed = {
    s: { r: 0, c: 0 },
    e: { r: Math.max(maxRow, declared?.e.r || 0), c: Math.max(maxCol, declared?.e.c || 0) },
  };
  sheet["!ref"] = XLSX.utils.encode_range(fixed);
}
