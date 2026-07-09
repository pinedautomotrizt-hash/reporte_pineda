import { query } from "../db.js";

const localesofFactura = async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT local_nombre
      FROM (
        SELECT NULLIF(TRIM(local_nombre), '') AS local_nombre
        FROM registro_venta
        UNION
        SELECT NULLIF(TRIM(local_nombre), '') AS local_nombre
        FROM orden_trabajo
      ) locales
      WHERE local_nombre IS NOT NULL AND local_nombre <> ''
      GROUP BY local_nombre
      ORDER BY local_nombre
    `);

    res.json(rows);
  } catch (error) {
    next(error);
  }
};

export default localesofFactura;
