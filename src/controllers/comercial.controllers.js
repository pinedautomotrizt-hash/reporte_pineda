import { query } from "../db.js";
import { localClause, parseFilters } from "../utils/expresiones.js";
import {
  otResumenSubquery,
  clienteCategoriaExpr,
  flotaNombreExpr,
  servicioCategoriaExpr,
} from "../utils/comercial.js";

const saleDate =
  "STR_TO_DATE(NULLIF(TRIM(fec_documento), ''), '%Y-%m-%d')";
const amount = (column) =>
  `COALESCE(CAST(NULLIF(REPLACE(TRIM(${column}), ',', ''), '') AS DECIMAL(14,2)), 0)`;
const sign =
  "CASE WHEN UPPER(TRIM(tipo_documento)) IN ('NC', 'NOTA DE CREDITO', 'NOTA DE CRÉDITO') THEN -1 ELSE 1 END";
const validDocument =
  "COALESCE(UPPER(TRIM(estado)), '') <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO'";

// Un documento por fila (dedup), enriquecido con la clasificacion de su OT.
// El monto siempre sale de registro_venta; orden_trabajo solo aporta categoria/placa.
const dedupedComercialDocuments = (period) => `
  SELECT
    documentos.nro_documento,
    documentos.local_nombre,
    documentos.moneda,
    documentos.fecha_documento,
    documentos.sin_igv,
    documentos.con_igv,
    ot.placa,
    ${servicioCategoriaExpr("ot")} AS servicio_categoria,
    ${clienteCategoriaExpr("documentos", "ot")} AS cliente_categoria,
    ${flotaNombreExpr("documentos")} AS flota_nombre
  FROM (
    SELECT
      nro_documento,
      local_nombre,
      COALESCE(NULLIF(UPPER(TRIM(moneda)), ''), 'SIN MONEDA') AS moneda,
      MAX(NULLIF(TRIM(cliente_documento), '')) AS cliente_documento,
      MAX(NULLIF(TRIM(operacion_relacionada), '')) AS operacion_relacionada,
      MAX(${saleDate}) AS fecha_documento,
      MAX(${sign} * ${amount("valor_gravado")}) AS sin_igv,
      MAX(${sign} * ${amount("precio_venta")}) AS con_igv
    FROM registro_venta
    WHERE ${period}
    GROUP BY nro_documento, local_nombre, COALESCE(NULLIF(UPPER(TRIM(moneda)), ''), 'SIN MONEDA')
  ) documentos
  LEFT JOIN (${otResumenSubquery}) ot
    ON ot.nro_orden = REPLACE(documentos.operacion_relacionada, 'OT-', '')
`;

const SERVICIO_CATEGORIAS = [
  "MANTENIMIENTO_PREVENTIVO",
  "MANTENIMIENTO_CORRECTIVO",
  "PLANCHADO_PINTURA",
  "OTROS",
  "SIN_CLASIFICAR",
];


const getComercialResumen = async (req, res, next) => {
  try {
    const { month, start, local } = parseFilters(req);
    const whereLocal = localClause(local);
    const params = { start, local };
    const period = `
      ${saleDate} >= :start
      AND ${saleDate} < DATE_ADD(:start, INTERVAL 1 MONTH)
      AND ${validDocument}
      ${whereLocal}
    `;
    const prevPeriod = `
      ${saleDate} >= DATE_SUB(:start, INTERVAL 1 MONTH)
      AND ${saleDate} < :start
      AND ${validDocument}
      ${whereLocal}
    `;

    const [porServicio, porCliente, porFlota, porServicioAnterior] =
      await Promise.all([
        query(
          `
            SELECT
              servicio_categoria AS categoria,
              moneda,
              COUNT(DISTINCT nro_documento) AS comprobantes,
              COUNT(DISTINCT placa) AS unidades,
              SUM(sin_igv) AS sin_igv,
              SUM(con_igv) AS con_igv
            FROM (${dedupedComercialDocuments(period)}) d
            GROUP BY servicio_categoria, moneda
            ORDER BY moneda, sin_igv DESC
          `,
          params,
        ),
        query(
          `
            SELECT
              cliente_categoria AS categoria,
              moneda,
              COUNT(DISTINCT nro_documento) AS comprobantes,
              COUNT(DISTINCT placa) AS unidades,
              SUM(sin_igv) AS sin_igv,
              SUM(con_igv) AS con_igv
            FROM (${dedupedComercialDocuments(period)}) d
            GROUP BY cliente_categoria, moneda
            ORDER BY moneda, sin_igv DESC
          `,
          params,
        ),
        query(
          `
            SELECT
              flota_nombre AS nombre,
              moneda,
              COUNT(DISTINCT nro_documento) AS comprobantes,
              COUNT(DISTINCT placa) AS unidades,
              SUM(sin_igv) AS sin_igv,
              SUM(con_igv) AS con_igv
            FROM (${dedupedComercialDocuments(period)}) d
            WHERE cliente_categoria = 'FLOTA'
            GROUP BY flota_nombre, moneda
            ORDER BY moneda, sin_igv DESC
          `,
          params,
        ),
        query(
          `
            SELECT
              servicio_categoria AS categoria,
              moneda,
              SUM(sin_igv) AS sin_igv,
              COUNT(DISTINCT nro_documento) AS comprobantes
            FROM (${dedupedComercialDocuments(prevPeriod)}) d
            GROUP BY servicio_categoria, moneda
          `,
          params,
        ),
      ]);

    const comparativoServicio = SERVICIO_CATEGORIAS.map((categoria) => {
      const actual = porServicio.find(
        (row) => row.categoria === categoria && row.moneda === "SOLES",
      ) || {};
      const anterior = porServicioAnterior.find(
        (row) => row.categoria === categoria && row.moneda === "SOLES",
      ) || {};
      const sinIgvActual = Number(actual.sin_igv || 0);
      const sinIgvAnterior = Number(anterior.sin_igv || 0);
      return {
        categoria,
        sinIgvActual,
        sinIgvAnterior,
        variacionPct:
          sinIgvAnterior > 0
            ? ((sinIgvActual - sinIgvAnterior) / sinIgvAnterior) * 100
            : null,
      };
    });

    res.json({
      month,
      local: local || "Todos",
      porServicio,
      porCliente,
      porFlota,
      comparativoServicio,
    });
  } catch (error) {
    next(error);
  }
};

const getComercialAnual = async (req, res, next) => {
  try {
    const { local } = parseFilters(req);
    const whereLocal = localClause(local);
    const year = /^\d{4}$/.test(req.query.year || "")
      ? Number(req.query.year)
      : new Date().getFullYear();
    const params = {
      start: `${year - 1}-01-01`,
      end: `${year + 1}-01-01`,
      local,
    };
    const period = `
      ${saleDate} >= :start
      AND ${saleDate} < :end
      AND ${validDocument}
      ${whereLocal}
    `;

    const porMes = await query(
      `
        SELECT
          YEAR(fecha_documento) AS anio,
          MONTH(fecha_documento) AS mes,
          servicio_categoria AS categoria,
          moneda,
          SUM(sin_igv) AS sin_igv,
          SUM(con_igv) AS con_igv,
          COUNT(DISTINCT nro_documento) AS comprobantes
        FROM (${dedupedComercialDocuments(period)}) d
        GROUP BY YEAR(fecha_documento), MONTH(fecha_documento), servicio_categoria, moneda
        ORDER BY anio, mes
      `,
      params,
    );

    res.json({ year, porMes });
  } catch (error) {
    next(error);
  }
};

export { getComercialResumen, getComercialAnual };
