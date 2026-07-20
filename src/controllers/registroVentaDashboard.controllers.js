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
// Tanto las ventas como las notas de crédito solo afectan el avance cuando
// SUNAT las aprobó. Una NC RECHAZADA no se descuenta del reporte contable.
const validDocument = `
  COALESCE(UPPER(TRIM(estado)), '') <> 'ANULADO'
  AND UPPER(TRIM(estado_sunat)) = 'APROBADO'
`;
// MOSTRADOR corresponde a venta directa de repuestos. No forma parte del
// avance diario de los asesores ni del total principal de facturación.
const advisorSalesOnly =
  "COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR'";
const counterSalesOnly =
  "COALESCE(UPPER(TRIM(clase_venta)), '') = 'MOSTRADOR'";

/*
 * REGLAS DEL REPORTE DE FACTURACIÓN (conciliadas con el avance contable):
 * 1. Cada comprobante se cuenta una sola vez, aunque el archivo sea reimportado.
 * 2. El avance sin IGV usa gravado + exonerado + inafecto.
 * 3. Las notas de crédito APROBADAS restan una sola vez; las RECHAZADAS no
 *    afectan el avance.
 * 4. Los comprobantes anulados no suman; al reimportar el acumulado actualizado,
 *    también se corrige su fecha original aunque la anulación sea posterior.
 * 5. Clase Venta = MOSTRADOR se excluye del avance y total principal porque es
 *    venta directa de repuestos, no producción de los asesores de servicio.
 *
 * Esta consulta base alimenta todos los bloques del dashboard, por lo que las
 * reglas se aplican igual al resumen, días, locales, asesores y comparativos.
 */
const dedupedDocuments = (period, salesScope = advisorSalesOnly) => `
  SELECT
    nro_documento,
    local_nombre,
    COALESCE(NULLIF(TRIM(tipo_documento), ''), 'Sin tipo') AS tipo_documento,
    COALESCE(NULLIF(TRIM(forma_pago), ''), 'Sin forma') AS forma_pago,
    COALESCE(NULLIF(TRIM(asesor_operacion), ''), 'Sin asesor') AS asesor,
    COALESCE(NULLIF(UPPER(TRIM(moneda)), ''), 'SIN MONEDA') AS moneda,
    MAX(NULLIF(TRIM(cliente_documento), '')) AS cliente_documento,
    MAX(NULLIF(TRIM(operacion_relacionada), '')) AS operacion_relacionada,
    MAX(${saleDate}) AS fecha_documento,
    MAX(${accountingAmount(netSaleAmount)}) AS sin_igv,
    MAX(${accountingAmount(amount("impuesto"))}) AS impuesto,
    MAX(${accountingAmount(amount("precio_venta"))}) AS con_igv,
    MAX(${accountingAmount(amount("moneda_usd"))}) AS moneda_usd
  FROM registro_venta
  WHERE ${period}
    AND ${salesScope}
  GROUP BY
    nro_documento,
    local_nombre,
    COALESCE(NULLIF(TRIM(tipo_documento), ''), 'Sin tipo'),
    COALESCE(NULLIF(TRIM(forma_pago), ''), 'Sin forma'),
    COALESCE(NULLIF(TRIM(asesor_operacion), ''), 'Sin asesor'),
    COALESCE(NULLIF(UPPER(TRIM(moneda)), ''), 'SIN MONEDA')
`;

/*
 * DISTRIBUCIÓN CONTABLE POR FACTURA Y OT Gerson ----------
 *
 * registro_venta continúa siendo la única fuente del importe oficial sin IGV.
 * detalle_factura_ot solamente aporta el peso de cada OT y su asesor. De esta
 * manera una factura con varias OT se reparte sin modificar el total contable.
 *
 * Si el comprobante es una nota de crédito, se busca el detalle de la factura
 * indicada en operacion_relacionada para descontar a las mismas áreas. Cuando
 * no existe detalle, se conserva asesor_operacion y el documento queda visible
 * como Sin asesor/Sin clasificar en vez de asignarlo arbitrariamente.
 */
const allocatedAdvisorDocuments = (period) => `
  WITH documentos AS (
    ${dedupedDocuments(period)}
  ),
  documentos_referencia AS (
    SELECT
      d.*,
      CASE
        WHEN UPPER(d.tipo_documento) IN ('NC', 'NOTA DE CREDITO', 'NOTA DE CRÉDITO')
          THEN COALESCE(
            (
              SELECT MIN(ref.nro_documento)
              FROM detalle_factura_ot ref
              WHERE ref.local_nombre = d.local_nombre
                AND (
                  ref.nro_documento = d.operacion_relacionada
                  OR ref.nro_ot = REPLACE(UPPER(d.operacion_relacionada), 'OT-', '')
                )
            ),
            d.nro_documento
          )
        ELSE d.nro_documento
      END AS detalle_documento
    FROM documentos d
  ),
  detalle_por_asesor AS (
    SELECT
      local_nombre,
      nro_documento,
      COALESCE(NULLIF(TRIM(asesor), ''), 'Sin asesor') AS asesor,
      SUM(ABS(total_con_igv)) AS peso_asesor
    FROM detalle_factura_ot
    GROUP BY
      local_nombre,
      nro_documento,
      COALESCE(NULLIF(TRIM(asesor), ''), 'Sin asesor')
  ),
  detalle_total AS (
    SELECT
      local_nombre,
      nro_documento,
      SUM(ABS(total_con_igv)) AS peso_total
    FROM detalle_factura_ot
    GROUP BY local_nombre, nro_documento
  )
  SELECT
    d.nro_documento,
    d.local_nombre,
    d.fecha_documento,
    d.moneda,
    COALESCE(da.asesor, d.asesor) AS asesor,
    d.sin_igv *
      CASE
        WHEN COALESCE(dt.peso_total, 0) > 0
          THEN da.peso_asesor / dt.peso_total
        ELSE 1
      END AS sin_igv,
    d.con_igv *
      CASE
        WHEN COALESCE(dt.peso_total, 0) > 0
          THEN da.peso_asesor / dt.peso_total
        ELSE 1
      END AS con_igv,
    -- Una factura repartida entre varios asesores (varias OT) genera varias
    -- filas para el mismo nro_documento. El monto sí se prorratea entre todas,
    -- pero el comprobante como tal es 1 solo: se marca 1 sola fila (la del
    -- asesor con mayor peso) para que COUNT(DISTINCT nro_documento) aguas
    -- abajo no lo cuente una vez por cada asesor y cuadre con el resumen.
    ROW_NUMBER() OVER (
      PARTITION BY d.local_nombre, d.nro_documento
      ORDER BY COALESCE(da.peso_asesor, 0) DESC, COALESCE(da.asesor, d.asesor)
    ) = 1 AS es_comprobante_principal
  FROM documentos_referencia d
  LEFT JOIN detalle_total dt
    ON dt.local_nombre = d.local_nombre
    AND dt.nro_documento = d.detalle_documento
  LEFT JOIN detalle_por_asesor da
    ON da.local_nombre = dt.local_nombre
    AND da.nro_documento = dt.nro_documento
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

    const [porMoneda, porDia, porLocal, porDocumento, porPago, porAsesor, porMonedaAnterior, mostrador] =
      await Promise.all([
        // Totales del mes por moneda: base para el resumen principal y la comparativa mensual.
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
        // Avance diario del mes (por fecha y moneda), para la curva de facturacion.
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

        // Facturacion del mes por sede, con ticket promedio.
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

        // Facturacion del mes por tipo de documento (factura, boleta, nota de credito).
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

        // Facturacion del mes por forma de pago.
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
        // Facturacion del mes por asesor y sede, con el reparto de facturas/NC por OT ya aplicado.
        query(
          `
            SELECT
              asesor,
              local_nombre,
              moneda,
              SUM(sin_igv) AS sin_igv,
              SUM(con_igv) AS con_igv,
              COUNT(DISTINCT CASE WHEN es_comprobante_principal THEN nro_documento END) AS comprobantes
            FROM (${allocatedAdvisorDocuments(period)}) documentos
            GROUP BY asesor, local_nombre, moneda
            ORDER BY moneda, sin_igv DESC
          `,
          params,
        ),

        // Mismo total por moneda pero del mes anterior, para calcular la variacion porcentual.
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
        query(
          `
            /*
             * MOSTRADOR se consulta por separado: no participa en el avance,
             * meta ni ranking de asesores, pero se devuelve para mostrarlo en
             * una card informativa. sin_igv ya está expresado en soles incluso
             * cuando la moneda original del comprobante fue dólares.
             */
            SELECT
              COALESCE(SUM(sin_igv), 0) AS sin_igv,
              COALESCE(SUM(con_igv), 0) AS con_igv,
              COUNT(DISTINCT nro_documento) AS comprobantes
            FROM (${dedupedDocuments(period, counterSalesOnly)}) documentos
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

    // Las columnas de importes del Registro de Venta ya vienen expresadas en
    // soles. Por ello el total principal suma también los documentos cuya
    // moneda original fue dólares, sin sumar directamente el campo Moneda US$.
    const facturadoSoles = porMoneda.reduce(
      (sum, row) => sum + Number(row.sin_igv || 0),
      0,
    );
    const facturadoSolesConIgv = porMoneda.reduce(
      (sum, row) => sum + Number(row.con_igv || 0),
      0,
    );
    const impuestoSoles = porMoneda.reduce(
      (sum, row) => sum + Number(row.impuesto || 0),
      0,
    );
    const comprobantesSoles = porMoneda.reduce(
      (sum, row) => sum + Number(row.comprobantes || 0),
      0,
    );
    const clientesSoles = porMoneda.reduce(
      (sum, row) => sum + Number(row.clientes || 0),
      0,
    );
    const fechaCorte = porMoneda.reduce(
      (latest, row) => (
        row.fecha_corte && new Date(row.fecha_corte).getTime() > new Date(latest).getTime()
          ? row.fecha_corte
          : latest
      ),
      start,
    );
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
        facturadoSolesConIgv,
        impuestoSoles,
        comprobantesSoles,
        clientesSoles,
        avanceMeta: meta > 0 ? (facturadoSoles / meta) * 100 : 0,
        proyeccionSoles,
        brecha: facturadoSoles - meta,
        faltante: Math.max(meta - facturadoSoles, 0),
        ticket: comprobantesSoles
          ? facturadoSoles / comprobantesSoles
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
      mostrador: mostrador[0] || { sin_igv: 0, con_igv: 0, comprobantes: 0 },
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
    const [rows, mostrador] = await Promise.all([
      // Facturacion diaria por asesor, sede y moneda: alimenta la tabla "Avance diario" del resumen mensual.
      query(`
        SELECT
          DATE_FORMAT(fecha_documento, '%Y-%m-%d') AS fecha,
          asesor,
          local_nombre,
          moneda,
          SUM(sin_igv) AS sin_igv,
          SUM(con_igv) AS con_igv,
          COUNT(DISTINCT CASE WHEN es_comprobante_principal THEN nro_documento END) AS comprobantes
        FROM (${allocatedAdvisorDocuments(period)}) documentos
        GROUP BY fecha_documento, asesor, local_nombre, moneda
        ORDER BY fecha_documento, asesor, moneda
      `,
      params,
      ),
      query(
        `
          /* Venta directa de repuestos: visible como dato informativo, pero
             excluida de las columnas y del total principal de asesores. */
          SELECT
            DATE_FORMAT(fecha_documento, '%Y-%m-%d') AS fecha,
            SUM(sin_igv) AS sin_igv,
            COUNT(DISTINCT nro_documento) AS comprobantes
          FROM (${dedupedDocuments(period, counterSalesOnly)}) documentos
          GROUP BY fecha_documento
          ORDER BY fecha_documento
        `,
        params,
      ),
    ]);

    res.json({
      rows,
      mostrador: {
        rows: mostrador,
        sin_igv: mostrador.reduce((sum, row) => sum + Number(row.sin_igv || 0), 0),
        comprobantes: mostrador.reduce((sum, row) => sum + Number(row.comprobantes || 0), 0),
      },
    });
  } catch (error) {
    next(error);
  }
};

const getRegistroVentaResumenMensual = async (req, res, next) => {
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

    /* La tabla asesor resuelve sede, área y vigencia sin nombres fijos. */
    const area = `
      COALESCE(
        (
          SELECT configuracion.as_area_codigo
          FROM asesor configuracion
          WHERE UPPER(TRIM(configuracion.as_nombre_origen)) = UPPER(TRIM(asesor))
            AND UPPER(TRIM(configuracion.as_local_nombre)) = UPPER(TRIM(local_nombre))
            AND configuracion.as_fecha_inicio <= fecha_documento
            AND (configuracion.as_fecha_fin IS NULL OR configuracion.as_fecha_fin >= fecha_documento)
          ORDER BY configuracion.as_fecha_inicio DESC
          LIMIT 1
        ),
        'SIN CLASIFICAR'
      )
    `;

    const [rows, mostrador] = await Promise.all([
      // Facturacion diaria agrupada por area comercial (resuelta via la tabla asesor), para el resumen mensual por sede.
      query(
        `
          SELECT
            DATE_FORMAT(fecha_documento, '%Y-%m-%d') AS fecha,
            ${area} AS area,
            MAX(local_nombre) AS local_nombre,
            SUM(sin_igv) AS sin_igv,
            COUNT(DISTINCT CASE WHEN es_comprobante_principal THEN nro_documento END) AS comprobantes
          FROM (${allocatedAdvisorDocuments(period)}) documentos
          GROUP BY fecha_documento, ${area}
          ORDER BY fecha_documento, area
        `,
        params,
      ),
      // Venta diaria de Mostrador (repuestos), aparte porque no participa del resumen por area.
      query(
        `
          SELECT
            DATE_FORMAT(fecha_documento, '%Y-%m-%d') AS fecha,
            SUM(sin_igv) AS sin_igv,
            COUNT(DISTINCT nro_documento) AS comprobantes
          FROM (${dedupedDocuments(period, counterSalesOnly)}) documentos
          GROUP BY fecha_documento
          ORDER BY fecha_documento
        `,
        params,
      ),
    ]);

    res.json({
      rows,
      mostrador: {
        rows: mostrador,
        sin_igv: mostrador.reduce((sum, row) => sum + Number(row.sin_igv || 0), 0),
        comprobantes: mostrador.reduce((sum, row) => sum + Number(row.comprobantes || 0), 0),
      },
    });
  } catch (error) {
    next(error);
  }
};

export {
  getRegistroVentaDashboard,
  getRegistroVentaAsesores,
  getRegistroVentaResumenMensual,
};
