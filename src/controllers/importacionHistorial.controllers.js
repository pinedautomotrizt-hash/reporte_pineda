import { query } from "../db.js";

// Ultimas importaciones realizadas, mas reciente primero. Se limita a 50 para
// no cargar un historial completo de meses en una sola pantalla.
async function getImportacionHistorial(req, res, next) {
  try {
    const rows = await query(
      `
        SELECT
          ih_id AS id,
          ih_reporte AS reporte,
          ih_filas_importadas AS filas_importadas,
          ih_locales AS locales,
          DATE_FORMAT(ih_periodo_desde, '%Y-%m-%d') AS periodo_desde,
          DATE_FORMAT(ih_periodo_hasta, '%Y-%m-%d') AS periodo_hasta,
          ih_usuario_nombre AS usuario_nombre,
          ih_usuario_email AS usuario_email,
          ih_creado_en AS creado_en
        FROM importacion_historial
        ORDER BY ih_creado_en DESC
        LIMIT 50
      `,
    );
    res.json({ historial: rows });
  } catch (error) {
    next(error);
  }
}

export default getImportacionHistorial;
