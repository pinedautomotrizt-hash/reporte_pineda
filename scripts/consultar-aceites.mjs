import mysql from 'mysql2/promise';

const [connectionUri] = process.argv.slice(2);
if (!connectionUri) throw new Error('Se requiere la URL de MySQL.');

const pool = mysql.createPool({ uri: connectionUri });
try {
  const [rows] = await pool.execute(`
    SELECT
      DATE_FORMAT(STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d'), '%Y-%m') AS mes,
      CASE
        WHEN UPPER(TRIM(actividad)) REGEXP '10W[ -]*30' THEN '10W-30'
        WHEN UPPER(TRIM(actividad)) REGEXP '5W[ -]*30' THEN '5W-30'
        WHEN UPPER(TRIM(actividad)) REGEXP '15W[ -]*40' THEN '15W-40'
      END AS tipo_aceite,
      SUM(COALESCE(CAST(NULLIF(TRIM(cantidad), '') AS DECIMAL(12,2)), 0)) AS cantidad,
      SUM(COALESCE(CAST(NULLIF(REPLACE(TRIM(costo), ',', ''), '') AS DECIMAL(14,2)), 0)) AS gasto_costo
    FROM orden_trabajo
    WHERE STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d') >= '2026-01-01'
      AND STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d') < '2027-01-01'
      AND UPPER(TRIM(actividad)) REGEXP '10W[ -]*30|5W[ -]*30|15W[ -]*40'
    GROUP BY mes, tipo_aceite
    ORDER BY mes, tipo_aceite
  `);
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await pool.end();
}
