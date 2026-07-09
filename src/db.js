import mysql from 'mysql2/promise';
import 'dotenv/config';

// Railway (y otros PaaS) exponen la base MySQL como una URL de conexion.
// En local seguimos usando las variables DB_* de siempre.
const connectionUri = process.env.MYSQL_URL || process.env.DATABASE_URL;

export const pool = connectionUri
  ? mysql.createPool({
      uri: connectionUri,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
    })
  : mysql.createPool({
      host: process.env.DB_HOST || process.env.MYSQLHOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
      user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
      password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
      database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'pineda_dash',
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
    });

// Algunos proveedores (Railway) activan ONLY_FULL_GROUP_BY por defecto en MySQL 8.
// Las consultas del dashboard agrupan por expresiones de fecha (STR_TO_DATE(...))
// en vez de columnas simples, algo que ese modo estricto rechaza aunque el
// resultado sea correcto. Se desactiva por conexion para igualar el comportamiento
// del MySQL local en el que se probaron estas consultas.
pool.on('connection', (connection) => {
  connection.query(
    "SET SESSION sql_mode = (SELECT REPLACE(@@sql_mode, 'ONLY_FULL_GROUP_BY', ''))",
  );
});

export async function query(sql, params = {}) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}
