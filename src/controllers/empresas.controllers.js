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

// Algunos clientes empresa vienen mal etiquetados como grupo_cliente=NINGUNO
// en el reporte origen de OT (ej. ALD Automotive). Se reclasifican por razon
// social (S.A., S.A.C., E.I.R.L., etc.) en vez de tratarlos como particulares.
const esRazonSocialEmpresa = `(
  CONCAT(' ', REPLACE(REPLACE(UPPER(TRIM(cliente_nombre)), '.', ''), '-', ' '), ' ')
    REGEXP ' (SAC|SAA|SRL|SCRL|SCS|EIRL|SA) '
  OR UPPER(cliente_nombre) LIKE '%SOCIEDAD ANONIMA%'
  OR UPPER(cliente_nombre) LIKE '%EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA%'
)`;
// grupo_cliente "efectivo": respeta la categoria del origen (FLOTAS, COMPAÑIAS
// DE SEGUROS, etc.) y solo reclasifica los NINGUNO que en realidad son
// personas juridicas, agrupandolos aparte para no mezclarlos con FLOTAS.
const grupoClienteEfectivo = `CASE
  WHEN UPPER(TRIM(grupo_cliente)) <> 'NINGUNO' THEN COALESCE(NULLIF(UPPER(TRIM(grupo_cliente)), ''), 'SIN DATO')
  WHEN ${esRazonSocialEmpresa} THEN 'OTRAS EMPRESAS'
  ELSE 'NINGUNO'
END`;

// Mismas reglas contables que resumen.controllers.js / series.controllers.js:
// un documento por fila, notas de credito aprobadas restan, ANULADO y no
// aprobado por SUNAT no cuentan, MOSTRADOR queda fuera del avance oficial.
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

// Un documento por fila (deduplicado), agrupado tambien por cliente y moneda
// para poder sumar el monto facturado por empresa sin mezclar soles y dolares.
const dedupedSalesByClient = (whereLocal) => `
  SELECT
    nro_documento,
    COALESCE(NULLIF(TRIM(cliente_nombre), ''), 'Sin cliente') AS cliente_nombre,
    COALESCE(NULLIF(UPPER(TRIM(moneda)), ''), 'SOLES') AS moneda,
    MAX(${accountingSaleAmount}) AS total
  FROM registro_venta
  WHERE ${saleDateExpr} >= :start
    AND ${saleDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
    AND ${validSaleDocument}
    ${whereLocal}
  GROUP BY
    nro_documento,
    COALESCE(NULLIF(TRIM(cliente_nombre), ''), 'Sin cliente'),
    COALESCE(NULLIF(UPPER(TRIM(moneda)), ''), 'SOLES')
`;

function moneyByCurrencyKey(rows) {
  // Convierte [{ moneda, total }] en { soles, dolares }.
  return rows.reduce(
    (acc, row) => {
      if (String(row.moneda).toUpperCase() === "DOLARES") {
        acc.dolares += Number(row.total || 0);
      } else {
        acc.soles += Number(row.total || 0);
      }
      return acc;
    },
    { soles: 0, dolares: 0 },
  );
}

export default async function getEmpresasResumen(req, res, next) {
  try {
    const { start, local } = parseFilters(req);
    const whereLocal = localClause(local);
    const params = { start, local };

    const [
      porTipoCliente,
      porEmpresa,
      totalGeneralRows,
      facturacionPorCliente,
      facturacionGeneralRows,
    ] = await Promise.all([
      query(
        `
          SELECT
            ${grupoClienteEfectivo} AS grupo_cliente,
            COUNT(DISTINCT nro_orden) AS unidades,
            COUNT(DISTINCT CASE WHEN ${isReprocesoOt} THEN nro_orden END) AS reprocesos
          FROM orden_trabajo
          WHERE ${otDateExpr} >= :start
            AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            ${whereLocal}
          GROUP BY ${grupoClienteEfectivo}
          ORDER BY unidades DESC
        `,
        params,
      ),
      query(
        `
          SELECT
            TRIM(cliente_nombre) AS empresa,
            ${grupoClienteEfectivo} AS grupo_cliente,
            COUNT(DISTINCT nro_orden) AS unidades,
            COUNT(DISTINCT CASE WHEN ${isReprocesoOt} THEN nro_orden END) AS reprocesos
          FROM orden_trabajo
          WHERE ${otDateExpr} >= :start
            AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            AND ${grupoClienteEfectivo} <> 'NINGUNO'
            ${whereLocal}
          GROUP BY TRIM(cliente_nombre), ${grupoClienteEfectivo}
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
      // Monto facturado oficial (registro_venta) por cliente y moneda, sin convertir.
      query(
        `
          SELECT cliente_nombre, moneda, SUM(total) AS total, COUNT(*) AS comprobantes
          FROM (${dedupedSalesByClient(whereLocal)}) ventas
          GROUP BY cliente_nombre, moneda
        `,
        params,
      ),
      // Mismo total pero sin agrupar por cliente, para la fila de total general.
      query(
        `
          SELECT moneda, SUM(total) AS total
          FROM (${dedupedSalesByClient(whereLocal)}) ventas
          GROUP BY moneda
        `,
        params,
      ),
    ]);

    const facturacionPorClienteMap = new Map();
    facturacionPorCliente.forEach((row) => {
      const key = row.cliente_nombre;
      const current = facturacionPorClienteMap.get(key) || { soles: 0, dolares: 0, comprobantes: 0 };
      if (String(row.moneda).toUpperCase() === "DOLARES") {
        current.dolares += Number(row.total || 0);
      } else {
        current.soles += Number(row.total || 0);
      }
      current.comprobantes += Number(row.comprobantes || 0);
      facturacionPorClienteMap.set(key, current);
    });

    const porEmpresaConFacturacion = porEmpresa.map((row) => {
      const facturado = facturacionPorClienteMap.get(row.empresa) || { soles: 0, dolares: 0, comprobantes: 0 };
      return {
        ...row,
        monto_facturado_soles: facturado.soles,
        monto_facturado_dolares: facturado.dolares,
        comprobantes_facturados: facturado.comprobantes,
      };
    });

    const facturacionGeneral = moneyByCurrencyKey(facturacionGeneralRows);

    res.json({
      porTipoCliente,
      porEmpresa: porEmpresaConFacturacion,
      totalGeneral: {
        ...(totalGeneralRows[0] || { unidades: 0, reprocesos: 0 }),
        monto_facturado_soles: facturacionGeneral.soles,
        monto_facturado_dolares: facturacionGeneral.dolares,
      },
    });
  } catch (error) {
    next(error);
  }
}
