// Inserta muchas filas por bloques para no enviar un INSERT demasiado grande a MySQL. Gerson
export async function bulkInsert(table, columns, rows, connection) {
  const escapedColumns = columns.map((column) => `\`${column}\``).join(", ");
  const sql = `INSERT INTO \`${table}\` (${escapedColumns}) VALUES ?`;
  for (let i = 0; i < rows.length; i += 500) {
    await connection.query(sql, [rows.slice(i, i + 500)]);
  }
}
