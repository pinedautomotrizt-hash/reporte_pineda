import mysql from 'mysql2/promise';

const [connectionUri] = process.argv.slice(2);
if (!connectionUri) throw new Error('Se requiere la URL de MySQL.');
const pool = mysql.createPool({ uri: connectionUri });
try {
  const [rows] = await pool.execute(`
    SELECT
      UPPER(TRIM(estado)) AS estado,
      UPPER(TRIM(tipo_ot)) AS tipo_ot,
      COUNT(DISTINCT nro_orden) AS ots
    FROM orden_trabajo
    WHERE UPPER(TRIM(tipo_ot)) LIKE '%REPROCESO%'
    GROUP BY UPPER(TRIM(estado)), UPPER(TRIM(tipo_ot))
    ORDER BY tipo_ot, estado
  `);
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await pool.end();
}
