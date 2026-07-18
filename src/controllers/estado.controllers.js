import { query } from "../db.js";

const getEstado = async (req, res, next) => {
  try {
    // Ping trivial para confirmar que hay conexion viva a la base de datos.
    const rows = await query("SELECT 1 AS ok");
    res.json({ ok: rows[0]?.ok === 1 });
  } catch (error) {
    next(error);
  }
};

export default getEstado;
