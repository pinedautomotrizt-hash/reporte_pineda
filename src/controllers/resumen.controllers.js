import { query } from "../db.js";
import { parseFilters, localClause } from "../utils/expresiones.js";

const otDateExpr =
  "STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d')";
const otPriceExpr =
  "CAST(NULLIF(TRIM(precio_venta), '') AS DECIMAL(14,2))";
const saleDateExpr =
  "STR_TO_DATE(NULLIF(TRIM(fec_documento), ''), '%Y-%m-%d')";
const saleAmountExpr =
  "COALESCE(CAST(NULLIF(REPLACE(TRIM(valor_gravado), ',', ''), '') AS DECIMAL(14,2)), 0)";
const saleSignExpr =
  "CASE WHEN UPPER(TRIM(tipo_documento)) IN ('NC', 'NOTA DE CREDITO', 'NOTA DE CRÉDITO') THEN -1 ELSE 1 END";
const validSaleDocument =
  "COALESCE(UPPER(TRIM(estado)), '') <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO'";

const getDashboardResumen = async (req, res, next) => {
  try {
    const { month, start, local, meta, comision, tipoCambio } = parseFilters(req);
    const params = { start, local, tipoCambio };
    const whereLocal = localClause(local);

    const [summary] = await query(
      `
        SELECT
          COALESCE(SUM(total_documento), 0) AS facturado,
          COALESCE(SUM(
            CASE WHEN moneda = 'DOLARES'
              THEN total_documento * :tipoCambio
              ELSE total_documento
            END
          ), 0) AS facturado_convertido,
          COALESCE(SUM(CASE WHEN moneda = 'SOLES' THEN total_documento ELSE 0 END), 0) AS facturado_soles,
          COALESCE(SUM(CASE WHEN moneda = 'DOLARES' THEN total_documento ELSE 0 END), 0) AS facturado_dolares,
          COUNT(*) AS comprobantes,
          COUNT(DISTINCT cliente_documento) AS clientes,
          MAX(fecha_documento) AS fecha_corte
        FROM (
          SELECT
            nro_documento,
            local_nombre,
            COALESCE(NULLIF(UPPER(TRIM(moneda)), ''), 'SIN MONEDA') AS moneda,
            MAX(NULLIF(TRIM(cliente_documento), '')) AS cliente_documento,
            MAX(${saleDateExpr}) AS fecha_documento,
            MAX(${saleSignExpr} * ${saleAmountExpr}) AS total_documento
          FROM registro_venta
          WHERE ${saleDateExpr} >= :start
            AND ${saleDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            AND ${validSaleDocument}
            ${whereLocal}
          GROUP BY
            nro_documento,
            local_nombre,
            COALESCE(NULLIF(UPPER(TRIM(moneda)), ''), 'SIN MONEDA')
        ) documentos
      `,
      params,
    );

    const [otSummary] = await query(
      `
        SELECT
          COUNT(DISTINCT nro_orden) AS ots,
          COUNT(DISTINCT placa) AS placas,
          COALESCE(SUM(${otPriceExpr}), 0) AS venta_ot
        FROM orden_trabajo
        WHERE ${otDateExpr} >= :start
          AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
          ${whereLocal}
      `,
      params,
    );

    const [otFacturadoSummary] = await query(
      `
        SELECT
          COUNT(DISTINCT nro_orden) AS ots_facturadas,
          COALESCE(SUM(
            CASE
              WHEN UPPER(TRIM(moneda)) = 'DOLARES'
                THEN ${otPriceExpr} * :tipoCambio
              ELSE ${otPriceExpr}
            END
          ), 0) AS monto_facturado_ot,
          COALESCE(SUM(
            CASE WHEN UPPER(TRIM(moneda)) = 'SOLES'
              THEN ${otPriceExpr}
              ELSE 0
            END
          ), 0) AS monto_facturado_soles,
          COALESCE(SUM(
            CASE WHEN UPPER(TRIM(moneda)) = 'DOLARES'
              THEN ${otPriceExpr}
              ELSE 0
            END
          ), 0) AS monto_facturado_dolares,
          MAX(${otDateExpr}) AS fecha_corte
        FROM orden_trabajo
        WHERE ${otDateExpr} >= :start
          AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
          AND UPPER(TRIM(estado)) = 'FACTURADO'
          ${whereLocal}
      `,
      params,
    );

    const facturado = Number(summary.facturado || 0);
    const comprobantes = Number(summary.comprobantes || 0);
    const ots = Number(otSummary.ots || 0);
    const otsFacturadas = Number(otFacturadoSummary.ots_facturadas || 0);
    const fechaCorte =
      otFacturadoSummary.fecha_corte || summary.fecha_corte || start;
    const day = Math.max(1, new Date(fechaCorte).getUTCDate());
    const daysInMonth = new Date(
      Number(month.slice(0, 4)),
      Number(month.slice(5, 7)),
      0,
    ).getDate();
    const ticketPromedio = comprobantes > 0 ? facturado / comprobantes : 0;
    const ticketPorComprobante =
      comprobantes > 0 ? facturado / comprobantes : 0;
    const avanceMeta = meta > 0 ? (facturado / meta) * 100 : 0;
    const proyeccion = (facturado / day) * daysInMonth;
    const faltanteMeta = Math.max(meta - facturado, 0);

    res.json({
      month,
      local: local || "Todos",
      meta,
      facturado,
      comprobantes,
      placas: Number(otSummary.placas || 0),
      clientes: Number(summary.clientes || 0),
      ots,
      otsFacturadas,
      ventaOt: Number(otSummary.venta_ot || 0),
      ticketPromedio,
      ticketPorComprobante,
      avanceMeta,
      proyeccion,
      brecha: facturado - meta,
      faltanteMeta,
      metaSugeridaSiguienteMes: meta + faltanteMeta,
      comisionPorcentaje: comision,
      comisionEstimada: facturado * (comision / 100),
      tipoCambio,
      facturadoSoles: Number(summary.facturado_soles || 0),
      facturadoDolares: Number(summary.facturado_dolares || 0),
      facturadoConvertido: Number(summary.facturado_convertido || 0),
      facturadoOt: Number(otFacturadoSummary.monto_facturado_ot || 0),
      facturadoOtSoles: Number(otFacturadoSummary.monto_facturado_soles || 0),
      facturadoOtDolares: Number(otFacturadoSummary.monto_facturado_dolares || 0),
      fechaCorte,
      diasTranscurridos: day,
      diasMes: daysInMonth,
    });
  } catch (error) {
    next(error);
  }
};

export default getDashboardResumen;
