import { query } from "../db.js";
import { parseFilters, localClause } from "../utils/expresiones.js";

const otDateExpr =
  "STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d')";

// Categorias de tipo_ot que representan un reproceso o reclamo de garantia
// sobre un trabajo ya realizado (confirmado con el negocio, ver orden_trabajo.tipo_ot).
const isReprocesoOt = `UPPER(TRIM(tipo_ot)) IN (
  'REPROCESO TALLER MECÁNICA',
  'REPROCESO TALLER B&P',
  'RECLAMOS AL CONCESIONARIO',
  'RECLAMOS DE GARANTIA'
)`;

export default async function getEmpresasResumen(req, res, next) {
  try {
    const { start, local } = parseFilters(req);
    const whereLocal = localClause(local);
    const params = { start, local };

    const [porTipoCliente, porEmpresa, totalGeneralRows] = await Promise.all([
      query(
        `
          SELECT
            COALESCE(NULLIF(UPPER(TRIM(grupo_cliente)), ''), 'SIN DATO') AS grupo_cliente,
            COUNT(DISTINCT nro_orden) AS unidades,
            COUNT(DISTINCT CASE WHEN ${isReprocesoOt} THEN nro_orden END) AS reprocesos
          FROM orden_trabajo
          WHERE ${otDateExpr} >= :start
            AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            ${whereLocal}
          GROUP BY grupo_cliente
          ORDER BY unidades DESC
        `,
        params,
      ),
      query(
        `
          SELECT
            TRIM(cliente_nombre) AS empresa,
            UPPER(TRIM(grupo_cliente)) AS grupo_cliente,
            COUNT(DISTINCT nro_orden) AS unidades,
            COUNT(DISTINCT CASE WHEN ${isReprocesoOt} THEN nro_orden END) AS reprocesos
          FROM orden_trabajo
          WHERE ${otDateExpr} >= :start
            AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            AND UPPER(TRIM(grupo_cliente)) <> 'NINGUNO'
            ${whereLocal}
          GROUP BY TRIM(cliente_nombre), UPPER(TRIM(grupo_cliente))
          ORDER BY unidades DESC
        `,
        params,
      ),
      query(
        `
          SELECT
            COUNT(DISTINCT nro_orden) AS unidades,
            COUNT(DISTINCT CASE WHEN ${isReprocesoOt} THEN nro_orden END) AS reprocesos
          FROM orden_trabajo
          WHERE ${otDateExpr} >= :start
            AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            ${whereLocal}
        `,
        params,
      ),
    ]);

    res.json({
      porTipoCliente,
      porEmpresa,
      totalGeneral: totalGeneralRows[0] || { unidades: 0, reprocesos: 0 },
    });
  } catch (error) {
    next(error);
  }
}
