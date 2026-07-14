import { query } from "../db.js";
import { localClause, parseFilters } from "../utils/expresiones.js";

const saleDate =
  "STR_TO_DATE(NULLIF(TRIM(fec_documento), ''), '%Y-%m-%d')";
const amount = (column) =>
  `COALESCE(CAST(NULLIF(REPLACE(TRIM(${column}), ',', ''), '') AS DECIMAL(14,2)), 0)`;
const isCreditNote =
  "UPPER(TRIM(tipo_documento)) IN ('NC', 'NOTA DE CREDITO', 'NOTA DE CRÉDITO')";

// El avance contable se muestra sin IGV. Se suman los tres componentes de la
// base imponible porque una venta también puede ser exonerada o inafecta.
const netSaleAmount = `
  ${amount("valor_gravado")}
  + ${amount("valor_exonerado")}
  + ${amount("valor_inafecto")}
`;

// Algunas exportaciones ya traen las notas de crédito con signo negativo y
// otras pueden traerlas positivas. -ABS(...) garantiza que siempre descuenten
// exactamente una vez; los demás comprobantes conservan el valor exportado.
const accountingAmount = (expression) =>
  `CASE WHEN ${isCreditNote} THEN -ABS(${expression}) ELSE ${expression} END`;
// El archivo acumulado refleja el estado vigente del comprobante. Al excluir
// ANULADO, una anulación hecha días después también deja de sumar en la fecha
// original del documento cuando se vuelve a importar el reporte actualizado.
const validDocument =
  "COALESCE(UPPER(TRIM(estado)), '') <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO'";
// MOSTRADOR corresponde a venta directa de repuestos. No forma parte del
// avance diario de los asesores ni del total principal de facturación.
const advisorSalesOnly =
  "COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR'";

const dedupedDocuments = (period) => `
  SELECT
    nro_documento,
    local_nombre,
    COALESCE(NULLIF(TRIM(tipo_documento), ''), 'Sin tipo') AS tipo_documento,
    COALESCE(NULLIF(TRIM(forma_pago), ''), 'Sin forma') AS forma_pago,
    COALESCE(NULLIF(TRIM(asesor_operacion), ''), 'Sin asesor') AS asesor,
    COALESCE(NULLIF(UPPER(TRIM(moneda)), ''), 'SIN MONEDA') AS moneda,
    MAX(NULLIF(TRIM(cliente_documento), '')) AS cliente_documento,
    MAX(${saleDate}) AS fecha_documento,
    MAX(${accountingAmount(netSaleAmount)}) AS sin_igv,
    MAX(${accountingAmount(amount("impuesto"))}) AS impuesto,
    MAX(${accountingAmount(amount("precio_venta"))}) AS con_igv,
    MAX(${accountingAmount(amount("moneda_usd"))}) AS moneda_usd
  FROM registro_venta
  WHERE ${period}
    AND ${advisorSalesOnly}
  GROUP BY
    nro_documento,
    local_nombre,
    COALESCE(NULLIF(TRIM(tipo_documento), ''), 'Sin tipo'),
    COALESCE(NULLIF(TRIM(forma_pago), ''), 'Sin forma'),
    COALESCE(NULLIF(TRIM(asesor_operacion), ''), 'Sin asesor'),
    COALESCE(NULLIF(UPPER(TRIM(moneda)), ''), 'SIN MONEDA')
`;

const getRegistroVentaDashboard = async (req, res, next) => {
  try {
    const { month, start, local, meta } = parseFilters(req);
    const params = { start, local };
    const whereLocal = localClause(local);
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

    const [porMoneda, porDia, porLocal, porDocumento, porPago, porAsesor, porMonedaAnterior] =
      await Promise.all([
        query(
          `
            SELECT
              moneda,
              SUM(sin_igv) AS sin_igv,
              SUM(impuesto) AS impuesto,
              SUM(con_igv) AS con_igv,
              SUM(moneda_usd) AS moneda_usd,
              COUNT(DISTINCT nro_documento) AS comprobantes,
              COUNT(DISTINCT cliente_documento) AS clientes,
              MAX(fecha_documento) AS fecha_corte
            FROM (${dedupedDocuments(period)}) documentos
            GROUP BY moneda
            ORDER BY moneda
          `,
          params,
        ),
        
        query(
          `
            SELECT
              DATE_FORMAT(fecha_documento, '%Y-%m-%d') AS fecha,
              moneda,
              SUM(sin_igv) AS sin_igv,
              SUM(con_igv) AS con_igv
            FROM (${dedupedDocuments(period)}) documentos
            GROUP BY fecha_documento, moneda
            ORDER BY fecha_documento, moneda
          `,
          params,
        ),

        
        query(
          `
            SELECT
              local_nombre AS nombre,
              moneda,
              COUNT(DISTINCT nro_documento) AS comprobantes,
              COUNT(DISTINCT cliente_documento) AS clientes,
              SUM(sin_igv) AS sin_igv,
              SUM(impuesto) AS impuesto,
              SUM(con_igv) AS con_igv,
              SUM(sin_igv) / NULLIF(COUNT(DISTINCT nro_documento), 0) AS ticket_promedio
            FROM (${dedupedDocuments(period)}) documentos
            GROUP BY local_nombre, moneda
            ORDER BY moneda, sin_igv DESC
          `,
          params,
        ),

        query(
          `
            SELECT
              tipo_documento AS nombre,
              moneda,
              COUNT(DISTINCT nro_documento) AS comprobantes,
              SUM(sin_igv) AS sin_igv
            FROM (${dedupedDocuments(period)}) documentos
            GROUP BY tipo_documento, moneda
            ORDER BY moneda, sin_igv DESC
          `,
          params,
        ),


        query(
          `
            SELECT
              forma_pago AS nombre,
              moneda,
              SUM(sin_igv) AS sin_igv
            FROM (${dedupedDocuments(period)}) documentos
            GROUP BY forma_pago, moneda
            ORDER BY moneda, sin_igv DESC
          `,
          params,
        ),
        query(
          `
            SELECT
              asesor,
              local_nombre,
              moneda,
              SUM(sin_igv) AS sin_igv,
              SUM(con_igv) AS con_igv,
              COUNT(DISTINCT nro_documento) AS comprobantes
            FROM (${dedupedDocuments(period)}) documentos
            GROUP BY asesor, local_nombre, moneda
            ORDER BY moneda, sin_igv DESC
          `,
          params,
        ),

        query(
          `
            SELECT
              moneda,
              SUM(sin_igv) AS sin_igv,
              SUM(con_igv) AS con_igv,
              COUNT(DISTINCT nro_documento) AS comprobantes
            FROM (${dedupedDocuments(prevPeriod)}) documentos
            GROUP BY moneda
          `,
          params,
        ),
      ]);

    const buildComparativo = (moneda) => {
      const actual = porMoneda.find((row) => row.moneda === moneda) || {};
      const anterior = porMonedaAnterior.find((row) => row.moneda === moneda) || {};
      const sinIgvActual = Number(actual.sin_igv || 0);
      const sinIgvAnterior = Number(anterior.sin_igv || 0);
      return {
        moneda,
        sinIgvActual,
        sinIgvAnterior,
        comprobantesActual: Number(actual.comprobantes || 0),
        comprobantesAnterior: Number(anterior.comprobantes || 0),
        variacionPct:
          sinIgvAnterior > 0
            ? ((sinIgvActual - sinIgvAnterior) / sinIgvAnterior) * 100
            : null,
      };
    };
    const comparativoMesAnterior = [buildComparativo("SOLES"), buildComparativo("DOLARES")];

    const soles = porMoneda.find((row) => row.moneda === "SOLES") || {};
    const facturadoSoles = Number(soles.sin_igv || 0);
    const fechaCorte = soles.fecha_corte || start;
    const day = Math.max(1, new Date(fechaCorte).getUTCDate());
    const daysInMonth = new Date(
      Number(month.slice(0, 4)),
      Number(month.slice(5, 7)),
      0,
    ).getDate();
    const proyeccionSoles = (facturadoSoles / day) * daysInMonth;

    res.json({
      resumen: {
        month,
        local: local || "Todos",
        meta,
        facturadoSoles,
        facturadoSolesConIgv: Number(soles.con_igv || 0),
        impuestoSoles: Number(soles.impuesto || 0),
        comprobantesSoles: Number(soles.comprobantes || 0),
        clientesSoles: Number(soles.clientes || 0),
        avanceMeta: meta > 0 ? (facturadoSoles / meta) * 100 : 0,
        proyeccionSoles,
        brecha: facturadoSoles - meta,
        faltante: Math.max(meta - facturadoSoles, 0),
        ticket: Number(soles.comprobantes || 0)
          ? facturadoSoles / Number(soles.comprobantes)
          : 0,
        fechaCorte,
        diasTranscurridos: day,
        diasMes: daysInMonth,
      },
      porMoneda,
      porDia,
      porLocal,
      porDocumento,
      porPago,
      porAsesor,
      comparativoMesAnterior,
    });
  } catch (error) {
    next(error);
  }
};

const getRegistroVentaAsesores = async (req, res, next) => {
  try {
    const { start, local } = parseFilters(req);
    const params = { start, local };
    const whereLocal = localClause(local);
    const period = `
      ${saleDate} >= :start
      AND ${saleDate} < DATE_ADD(:start, INTERVAL 1 MONTH)
      AND ${validDocument}
      ${whereLocal}
    `;
    const rows = await query(
      `
        SELECT
          DATE_FORMAT(fecha_documento, '%Y-%m-%d') AS fecha,
          asesor,
          local_nombre,
          moneda,
          SUM(sin_igv) AS sin_igv,
          SUM(con_igv) AS con_igv,
          COUNT(DISTINCT nro_documento) AS comprobantes
        FROM (${dedupedDocuments(period)}) documentos
        GROUP BY fecha_documento, asesor, local_nombre, moneda
        ORDER BY fecha_documento, asesor, moneda
      `,
      params,
    );

    res.json({ rows });
  } catch (error) {
    next(error);
  }
};

export { getRegistroVentaDashboard, getRegistroVentaAsesores };
