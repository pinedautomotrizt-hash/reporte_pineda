import { query } from "../db.js";

const stagingStatus = async (req, res, next) => {
  try {
    const safeCount = async (table) => {
      try {
        const [row] = await query(`SELECT COUNT(*) AS filas FROM ${table}`);
        return row;
      } catch {
        return { filas: 0 };
      }
    };

    const stagingTables = await Promise.all([
      safeCount("stg_clientes_csv"),
      safeCount("stg_clientes_servicio_csv"),
      safeCount("orden_trabajo"),
      safeCount("registro_venta"),
    ]);

    const [staging] = await query(`
      SELECT
        COUNT(*) AS filas,
        COUNT(DISTINCT nro_documento) AS documentos,
        SUM(local_nombre = 'Pineda Callao') AS callao,
        SUM(local_nombre = 'Pineda Trujillo') AS trujillo
      FROM registro_venta
    `);

    const [fact] = await query(`
      SELECT
        COUNT(*) AS comprobantes,
        COUNT(DISTINCT nro_documento) AS documentos,
        MIN(STR_TO_DATE(NULLIF(TRIM(fec_documento), ''), '%Y-%m-%d')) AS desde,
        MAX(STR_TO_DATE(NULLIF(TRIM(fec_documento), ''), '%Y-%m-%d')) AS hasta,
        SUM(COALESCE(CAST(NULLIF(REPLACE(TRIM(valor_gravado), ',', ''), '') AS DECIMAL(14,2)), 0)) AS importe_total
      FROM registro_venta
    `);

    // Los dashboards solo cuentan documentos con estado <> ANULADO y estado_sunat = APROBADO.
    // Este desglose expone los valores reales para detectar si esa condicion esta descartando todo silenciosamente.
    const estadoBreakdown = await query(`
      SELECT
        COALESCE(NULLIF(UPPER(TRIM(estado)), ''), 'SIN ESTADO') AS estado,
        COALESCE(NULLIF(UPPER(TRIM(estado_sunat)), ''), 'SIN ESTADO SUNAT') AS estado_sunat,
        COUNT(*) AS filas
      FROM registro_venta
      GROUP BY estado, estado_sunat
      ORDER BY filas DESC
      LIMIT 20
    `);

    res.json({
      staging,
      fact,
      estadoBreakdown,
      tables: {
        clientes: stagingTables[0][0],
        clientes_servicio: stagingTables[1][0],
        ordenes_trabajo: stagingTables[2][0],
        registro_venta: stagingTables[3][0],
      },
    });
  } catch (error) {
    next(error);
  }
};


export default stagingStatus
