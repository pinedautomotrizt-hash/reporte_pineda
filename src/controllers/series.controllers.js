import { query } from "../db.js";
import { parseFilters, localClause } from "../utils/expresiones.js";

const otDateExpr =
  "STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d')";
const otCloseDateExpr =
  "STR_TO_DATE(NULLIF(TRIM(fec_cierre), ''), '%Y-%m-%d')";
const otPriceExpr =
  "COALESCE(CAST(NULLIF(TRIM(precio_venta), '') AS DECIMAL(14,2)), 0)";
const otNetExpr =
  "COALESCE(CAST(NULLIF(TRIM(valor_venta), '') AS DECIMAL(14,2)), 0)";
const otCostExpr =
  "COALESCE(CAST(NULLIF(TRIM(costo), '') AS DECIMAL(14,2)), 0)";
const isRepuesto =
  "UPPER(TRIM(origen_codigo)) IN ('REPUESTO', 'REPUESTOS', 'RPTO')";
const isManoObra =
  "UPPER(TRIM(origen_codigo)) IN ('SERVICIO', 'SERVICIOS', 'MANO DE OBRA', 'MO')";
const saleDateExpr =
  "STR_TO_DATE(NULLIF(TRIM(fec_documento), ''), '%Y-%m-%d')";
const saleDecimal = (column) =>
  `COALESCE(CAST(NULLIF(REPLACE(TRIM(${column}), ',', ''), '') AS DECIMAL(14,2)), 0)`;
const isCreditNote =
  "UPPER(TRIM(tipo_documento)) IN ('NC', 'NOTA DE CREDITO', 'NOTA DE CRÉDITO')";
const saleAmountExpr = `
  ${saleDecimal("valor_gravado")}
  + ${saleDecimal("valor_exonerado")}
  + ${saleDecimal("valor_inafecto")}
`;
const accountingSaleAmount =
  `CASE WHEN ${isCreditNote} THEN -ABS(${saleAmountExpr}) ELSE ${saleAmountExpr} END`;
const validSaleDocument = `
  COALESCE(UPPER(TRIM(estado)), '') <> 'ANULADO'
  AND UPPER(TRIM(estado_sunat)) = 'APROBADO'
  AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR'
`;
// Un documento por fila (deduplicado), con su tipo, forma de pago y asesor, para armar los desgloses del mes.
const dedupedSales = (whereLocal) => `
  SELECT
    nro_documento,
    local_nombre,
    COALESCE(NULLIF(TRIM(tipo_documento), ''), 'Sin tipo') AS tipo_documento,
    COALESCE(NULLIF(TRIM(forma_pago), ''), 'Sin forma') AS forma_pago,
    COALESCE(NULLIF(TRIM(asesor_operacion), ''), 'Sin asesor') AS asesor,
    MAX(${accountingSaleAmount}) AS total
  FROM registro_venta
  WHERE ${saleDateExpr} >= :start
    AND ${saleDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
    AND ${validSaleDocument}
    ${whereLocal}
  GROUP BY
    nro_documento,
    local_nombre,
    COALESCE(NULLIF(TRIM(tipo_documento), ''), 'Sin tipo'),
    COALESCE(NULLIF(TRIM(forma_pago), ''), 'Sin forma'),
    COALESCE(NULLIF(TRIM(asesor_operacion), ''), 'Sin asesor')
`;

const getDashboardSeries = async (req, res, next) => {
  try {
    const { start, local } = parseFilters(req);
    const params = { start, local };
    const whereLocal = localClause(local);

    const [
      porDia,
      otPorDepartamento,
      porLocal,
      porTipo,
      topClientes,
      ticketClientes,
      ticketPorTipoOt,
      otPorEstado,
      otPendientesDetalle,
      modelosFrecuentes,
      asesoresPorSede,
      porFormaPago,
      porRegistrador,
    ] = await Promise.all([
      // Venta de OT facturadas del mes, por dia de apertura, para la curva del avance diario.
      query(
        `
          SELECT
            DATE_FORMAT(${otDateExpr}, '%Y-%m-%d') AS fecha,
            SUM(${otPriceExpr}) AS total,
            COUNT(DISTINCT nro_orden) AS comprobantes
          FROM orden_trabajo
          WHERE ${otDateExpr} >= :start
            AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            AND UPPER(TRIM(estado)) = 'FACTURADO'
            ${whereLocal}
          GROUP BY ${otDateExpr}
          ORDER BY ${otDateExpr}
        `,
        params,
      ),
      query(
        `
          /* Distribución geográfica operativa. Se cuentan OT únicas para no
             multiplicarlas por cada línea de repuesto o servicio. */
          SELECT
            COALESCE(NULLIF(UPPER(TRIM(departamento)), ''), 'SIN DEPARTAMENTO') AS departamento,
            COUNT(DISTINCT nro_orden) AS ots,
            COUNT(DISTINCT NULLIF(TRIM(placa), '')) AS vehiculos,
            COALESCE(SUM(${otPriceExpr}), 0) AS valor_operativo
          FROM orden_trabajo
          WHERE ${otDateExpr} >= :start
            AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            ${whereLocal}
          GROUP BY COALESCE(NULLIF(UPPER(TRIM(departamento)), ''), 'SIN DEPARTAMENTO')
          ORDER BY ots DESC, valor_operativo DESC
        `,
        params,
      ),
      // Venta de OT facturadas del mes agrupada por sede.
      query(
        `
          SELECT
            local_nombre AS nombre,
            SUM(${otPriceExpr}) AS total,
            COUNT(DISTINCT nro_orden) AS comprobantes
          FROM orden_trabajo
          WHERE ${otDateExpr} >= :start
            AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            AND UPPER(TRIM(estado)) = 'FACTURADO'
            ${whereLocal}
          GROUP BY local_nombre
          ORDER BY total DESC
        `,
        params,
      ),
      // Ventas del mes agrupadas por tipo de documento (factura, boleta, nota de credito).
      query(
        `
          SELECT tipo_documento AS nombre, SUM(total) AS total, COUNT(*) AS comprobantes
          FROM (${dedupedSales(whereLocal)}) ventas
          GROUP BY tipo_documento
          ORDER BY total DESC
        `,
        params,
      ),
      // Top 10 clientes del mes por venta de OT.
      query(
        `
          SELECT
            COALESCE(NULLIF(TRIM(cliente_nombre), ''), 'Sin cliente') AS nombre,
            SUM(${otPriceExpr}) AS total,
            COUNT(DISTINCT nro_orden) AS comprobantes
          FROM orden_trabajo
          WHERE ${otDateExpr} >= :start
            AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            ${whereLocal}
          GROUP BY COALESCE(NULLIF(TRIM(cliente_nombre), ''), 'Sin cliente')
          ORDER BY total DESC
          LIMIT 10
        `,
        params,
      ),
      // Top 10 clientes RECURRENTES (3+ OT en el mes) por ticket promedio (venta / OT).
      // El minimo de 3 evita que un cliente de una sola OT grande (caso aislado, no
      // representativo) desplace a clientes de flota que sí compran seguido pero
      // en tickets mas chicos por visita.
      query(
        `
          SELECT
            COALESCE(NULLIF(TRIM(cliente_nombre), ''), 'Sin cliente') AS nombre,
            SUM(${otPriceExpr}) AS total,
            COUNT(DISTINCT nro_orden) AS comprobantes,
            SUM(${otPriceExpr}) / NULLIF(COUNT(DISTINCT nro_orden), 0) AS ticket_promedio
          FROM orden_trabajo
          WHERE ${otDateExpr} >= :start
            AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            ${whereLocal}
          GROUP BY COALESCE(NULLIF(TRIM(cliente_nombre), ''), 'Sin cliente')
          HAVING comprobantes >= 3
          ORDER BY ticket_promedio DESC
          LIMIT 10
        `,
        params,
      ),
      // Venta y ticket promedio del mes agrupados por tipo de OT.
      query(
        `
          SELECT
            COALESCE(NULLIF(TRIM(tipo_ot), ''), 'Sin tipo') AS nombre,
            COUNT(DISTINCT nro_orden) AS ots,
            SUM(${otPriceExpr}) AS venta,
            SUM(${otPriceExpr}) / NULLIF(COUNT(DISTINCT nro_orden), 0) AS ticket_promedio
          FROM orden_trabajo
          WHERE ${otDateExpr} >= :start
            AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            ${whereLocal}
          GROUP BY COALESCE(NULLIF(TRIM(tipo_ot), ''), 'Sin tipo')
          ORDER BY venta DESC
        `,
        params,
      ),
      // OT del mes agrupadas por estado (Facturado, Cerrado, Aperturado, etc), en el orden del flujo de trabajo.
      query(
        `
          SELECT
            COALESCE(NULLIF(TRIM(estado), ''), 'Sin estado') AS nombre,
            COUNT(DISTINCT nro_orden) AS ots,
            SUM(${otPriceExpr}) AS venta,
            SUM(${otPriceExpr}) / NULLIF(COUNT(DISTINCT nro_orden), 0) AS ticket_promedio
          FROM orden_trabajo
          WHERE ${otDateExpr} >= :start
            AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            ${whereLocal}
          GROUP BY COALESCE(NULLIF(TRIM(estado), ''), 'Sin estado')
          ORDER BY FIELD(nombre, 'FACTURADO', 'CERRADO', 'APERTURADO', 'LIQUIDADO', 'FACTURADO INT'), venta DESC
        `,
        params,
      ),
      // Detalle de las 50 OT de mayor venta que siguen abiertas (no facturadas), para seguimiento de pendientes.
      query(
        `
          SELECT
            nro_orden,
            estado,
            ${otDateExpr} AS fecha_apertura,
            MAX(${otCloseDateExpr}) AS fecha_cierre,
            MAX(asesor) AS asesor,
            MAX(tipo_ot) AS tipo_ot,
            SUM(${otPriceExpr}) AS venta
          FROM orden_trabajo
          WHERE ${otDateExpr} >= :start
            AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            AND UPPER(TRIM(estado)) <> 'FACTURADO'
            ${whereLocal}
          GROUP BY nro_orden, estado, ${otDateExpr}
          ORDER BY venta DESC
          LIMIT 50
        `,
        params,
      ),
      // Top 10 combinaciones marca/modelo más atendidas del mes, por cantidad de OT.
      query(
        `
          SELECT
            COALESCE(NULLIF(TRIM(marca), ''), 'Sin marca') AS marca,
            COALESCE(NULLIF(TRIM(modelo), ''), 'Sin modelo') AS modelo,
            COUNT(DISTINCT nro_orden) AS ots,
            SUM(${otPriceExpr}) AS venta
          FROM orden_trabajo
          WHERE ${otDateExpr} >= :start
            AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            ${whereLocal}
          GROUP BY
            COALESCE(NULLIF(TRIM(marca), ''), 'Sin marca'),
            COALESCE(NULLIF(TRIM(modelo), ''), 'Sin modelo')
          ORDER BY ots DESC, venta DESC
          LIMIT 10
        `,
        params,
      ),
      // Rendimiento del mes por asesor y sede: venta, repuestos vs mano de obra, costo y margen de repuestos.
      query(
        `
          SELECT
            local_nombre,
            COALESCE(NULLIF(TRIM(asesor), ''), 'Sin asesor') AS asesor,
            COALESCE(NULLIF(UPPER(TRIM(moneda)), ''), 'SIN MONEDA') AS moneda,
            COUNT(DISTINCT nro_orden) AS ots,
            SUM(${otPriceExpr}) AS total_con_igv,
            SUM(${otNetExpr}) AS total_sin_igv,
            SUM(CASE WHEN ${isRepuesto} THEN ${otPriceExpr} ELSE 0 END) AS repuestos_con_igv,
            SUM(CASE WHEN ${isRepuesto} THEN ${otNetExpr} ELSE 0 END) AS repuestos_sin_igv,
            SUM(CASE WHEN ${isManoObra} THEN ${otPriceExpr} ELSE 0 END) AS mano_obra_con_igv,
            SUM(CASE WHEN ${isManoObra} THEN ${otNetExpr} ELSE 0 END) AS mano_obra_sin_igv,
            SUM(CASE WHEN ${isRepuesto} THEN ${otCostExpr} ELSE 0 END) AS costo_repuestos,
            SUM(
              CASE WHEN ${isRepuesto}
                THEN ${otNetExpr} - ${otCostExpr}
                ELSE 0
              END
            ) AS utilidad_repuestos,
            SUM(${otPriceExpr}) / NULLIF(COUNT(DISTINCT nro_orden), 0) AS ticket_promedio,
            100 * SUM(
              CASE WHEN ${isRepuesto}
                THEN ${otNetExpr} - ${otCostExpr}
                ELSE 0
              END
            ) / NULLIF(
              SUM(CASE WHEN ${isRepuesto} THEN ${otNetExpr} ELSE 0 END),
              0
            ) AS margen_repuestos_pct
          FROM orden_trabajo
          WHERE ${otDateExpr} >= :start
            AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            AND UPPER(TRIM(estado)) = 'FACTURADO'
            ${whereLocal}
          GROUP BY
            local_nombre,
            COALESCE(NULLIF(TRIM(asesor), ''), 'Sin asesor'),
            COALESCE(NULLIF(UPPER(TRIM(moneda)), ''), 'SIN MONEDA')
          ORDER BY local_nombre, moneda, total_con_igv DESC
        `,
        params,
      ),
      // Ventas del mes agrupadas por forma de pago (efectivo, tarjeta, transferencia, etc).
      query(
        `
          SELECT forma_pago AS nombre, SUM(total) AS total, COUNT(*) AS comprobantes
          FROM (${dedupedSales(whereLocal)}) ventas
          GROUP BY forma_pago
          ORDER BY total DESC
        `,
        params,
      ),
      // Top 8 asesores del mes por venta registrada en Registro de Venta (distinto del reparto por OT de arriba).
      query(
        `
          SELECT asesor AS nombre, SUM(total) AS total, COUNT(*) AS comprobantes
          FROM (${dedupedSales(whereLocal)}) ventas
          GROUP BY asesor
          ORDER BY total DESC
          LIMIT 8
        `,
        params,
      ),
    ]);

    res.json({
      porDia,
      porLocal,
      porTipo,
      topClientes,
      ticketClientes,
      ticketPorTipoOt,
      otPorEstado,
      otPendientesDetalle,
      modelosFrecuentes,
      otPorDepartamento,
      asesoresPorSede,
      porFormaPago,
      porRegistrador,
    });
  } catch (error) {
    next(error);
  }
};

export default getDashboardSeries;
