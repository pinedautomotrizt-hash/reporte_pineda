import mysql from 'mysql2/promise';

const [connectionUri] = process.argv.slice(2);
if (!connectionUri) throw new Error('Se requiere la URL de MySQL.');

const pool = mysql.createPool({ uri: connectionUri });
try {
  const [rows] = await pool.execute(`
    SELECT TRIM(actividad) AS actividad, COUNT(*) AS lineas
    FROM orden_trabajo
    WHERE UPPER(TRIM(actividad)) REGEXP 'REFRIG|COOLANT|ANTICONG|ACEITE.*CAJA|CAJA.*ACEITE|ATF|GRASA'
    GROUP BY TRIM(actividad)
    ORDER BY lineas DESC
    LIMIT 80
  `);
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await pool.end();
}
