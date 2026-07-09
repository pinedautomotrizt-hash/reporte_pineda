// Inserta muchas filas por bloques para no enviar un INSERT demasiado grande a MySQL. Gerson
// upsert=true actualiza la fila si ya existe (segun la UNIQUE KEY de la tabla) en vez de
// duplicarla; asi volver a cargar un CSV que se solapa con uno anterior no crea copias.
export async function bulkInsert(table, columns, rows, connection, { upsert = false } = {}) {
  const escapedColumns = columns.map((column) => `\`${column}\``).join(", ");
  let sql = `INSERT INTO \`${table}\` (${escapedColumns}) VALUES ?`;
  if (upsert) {
    const updates = columns
      .map((column) => `\`${column}\` = VALUES(\`${column}\`)`)
      .join(", ");
    sql += ` ON DUPLICATE KEY UPDATE ${updates}`;
  }
  for (let i = 0; i < rows.length; i += 500) {
    await connection.query(sql, [rows.slice(i, i + 500)]);
  }
}
