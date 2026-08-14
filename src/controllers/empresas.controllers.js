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

// Cada linea de OT trae su origen (REPUESTO vs SERVICIO/mano de obra) en
// origen_codigo; "actividad" es la descripcion del repuesto en esas lineas.
const isRepuestoLinea =
  "UPPER(TRIM(origen_codigo)) IN ('REPUESTO', 'REPUESTOS', 'RPTO')";

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
  AND COALESCE(UPPER(TRIM(clase_venta)), '') NOT IN ('MOSTRADOR', 'PAGOS VARIOS')
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

// Reporte operativo de una sola empresa (sin montos): resumen, evolucion
// mensual, tiempo en taller, estado, composicion del trabajo, flota y sede.
export async function getEmpresaDetalle(req, res, next) {
  try {
    const empresa = String(req.params.empresa || "").trim();
    const { start, month, local } = parseFilters(req);
    const whereLocal = localClause(local);
    const yearStart = `${month.slice(0, 4)}-01-01`;
    const params = { start, local, empresa, yearStart };
    const whereEmpresa = "TRIM(cliente_nombre) = :empresa";
    // Cada OT colapsada a una fila (placa, fechas, estado y dias entre
    // apertura y cierre). Es la base unica que reusan el promedio/min/max, el
    // histograma, el detalle de las ultimas OT y las de "mas rapida/mas lenta" —
    // todas ven exactamente la misma poblacion, no cada una un recorte distinto.
    const otResumenSubquery = `
      SELECT
        nro_orden,
        MAX(NULLIF(TRIM(placa), '')) AS placa,
        DATE_FORMAT(MIN(${otDateExpr}), '%Y-%m-%d') AS fecha_apertura,
        DATE_FORMAT(MAX(STR_TO_DATE(NULLIF(TRIM(fec_cierre), ''), '%Y-%m-%d')), '%Y-%m-%d') AS fecha_cierre,
        MAX(UPPER(TRIM(estado))) AS estado,
        DATEDIFF(
          MAX(STR_TO_DATE(NULLIF(TRIM(fec_cierre), ''), '%Y-%m-%d')),
          MIN(${otDateExpr})
        ) AS dias
      FROM orden_trabajo
      WHERE ${whereEmpresa}
        AND ${otDateExpr} >= :start AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
        ${whereLocal}
      GROUP BY nro_orden
    `;
    // Mismo subquery pero solo con las que ya cerraron (dias no es NULL), para
    // los calculos que no tiene sentido que arrastren las OT todavia abiertas.
    const otCerradasSubquery = `SELECT * FROM (${otResumenSubquery}) t WHERE dias IS NOT NULL`;

    const [
      resumenRows,
      evolucionMensualRows,
      tiempoPromedioRows,
      tiempoDistribucionRows,
      tiempoDetalle,
      tiempoMasRapidas,
      tiempoMasLentas,
      reprocesosDetalle,
      porEstado,
      porServicio,
      porTipoOt,
      porVehiculo,
      porSede,
      repuestosMasUsados,
    ] = await Promise.all([
      query(
        `
          SELECT
            MAX(${grupoClienteEfectivo}) AS grupo_cliente,
            COUNT(DISTINCT nro_orden) AS unidades_ot,
            COUNT(DISTINCT NULLIF(TRIM(placa), '')) AS unidades_vehiculos,
            COUNT(DISTINCT CASE WHEN ${isReprocesoOt} THEN nro_orden END) AS reprocesos
          FROM orden_trabajo
          WHERE ${whereEmpresa}
            AND ${otDateExpr} >= :start AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            ${whereLocal}
        `,
        params,
      ),
      query(
        `
          SELECT
            MONTH(${otDateExpr}) AS mes,
            COUNT(DISTINCT nro_orden) AS unidades,
            COUNT(DISTINCT CASE WHEN ${isReprocesoOt} THEN nro_orden END) AS reprocesos
          FROM orden_trabajo
          WHERE ${whereEmpresa}
            AND ${otDateExpr} >= :yearStart AND ${otDateExpr} < DATE_ADD(:yearStart, INTERVAL 1 YEAR)
            ${whereLocal}
          GROUP BY MONTH(${otDateExpr})
        `,
        params,
      ),
      query(
        `
          SELECT
            ROUND(AVG(dias), 1) AS promedio_dias,
            MIN(dias) AS min_dias,
            MAX(dias) AS max_dias,
            COUNT(*) AS ot_con_cierre
          FROM (${otCerradasSubquery}) t
        `,
        params,
      ),
      // Histograma: en cuantos "cubos" de dias cae cada OT cerrada, para ver
      // que tan pareja (o dispersa) es la atencion, no solo el promedio.
      query(
        `
          SELECT
            CASE
              WHEN dias <= 3 THEN CAST(dias AS CHAR)
              WHEN dias BETWEEN 4 AND 7 THEN '4-7'
              ELSE '8+'
            END AS rango,
            COUNT(*) AS cantidad
          FROM (${otCerradasSubquery}) t
          GROUP BY rango
        `,
        params,
      ),
      query(
        `
          SELECT nro_orden, placa, fecha_apertura, fecha_cierre, estado, dias
          FROM (${otResumenSubquery}) t
          ORDER BY fecha_apertura DESC
          LIMIT 15
        `,
        params,
      ),
      // OT empatadas en el minimo de dias (puede ser mas de una).
      query(
        `
          SELECT nro_orden, placa, fecha_apertura, fecha_cierre, estado, dias
          FROM (${otCerradasSubquery}) t
          WHERE dias = (SELECT MIN(dias) FROM (${otCerradasSubquery}) m)
          ORDER BY fecha_apertura DESC
        `,
        params,
      ),
      // OT empatadas en el maximo de dias (puede ser mas de una).
      query(
        `
          SELECT nro_orden, placa, fecha_apertura, fecha_cierre, estado, dias
          FROM (${otCerradasSubquery}) t
          WHERE dias = (SELECT MAX(dias) FROM (${otCerradasSubquery}) m)
          ORDER BY fecha_apertura DESC
        `,
        params,
      ),
      // Detalle de cada OT marcada como reproceso/reclamo de garantia, para el
      // modal de "Reprocesos / garantias" del resumen.
      query(
        `
          SELECT
            nro_orden,
            MAX(NULLIF(TRIM(placa), '')) AS placa,
            DATE_FORMAT(MIN(${otDateExpr}), '%Y-%m-%d') AS fecha_apertura,
            MAX(UPPER(TRIM(estado))) AS estado,
            MAX(NULLIF(TRIM(tipo_ot), '')) AS tipo_ot
          FROM orden_trabajo
          WHERE ${whereEmpresa}
            AND ${otDateExpr} >= :start AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            AND ${isReprocesoOt}
            ${whereLocal}
          GROUP BY nro_orden
          ORDER BY fecha_apertura DESC
        `,
        params,
      ),
      query(
        `
          SELECT UPPER(TRIM(estado)) AS estado, COUNT(DISTINCT nro_orden) AS unidades
          FROM orden_trabajo
          WHERE ${whereEmpresa}
            AND ${otDateExpr} >= :start AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            ${whereLocal}
          GROUP BY UPPER(TRIM(estado))
          ORDER BY unidades DESC
        `,
        params,
      ),
      query(
        `
          SELECT
            COALESCE(NULLIF(TRIM(grupo_servicio), ''), 'Sin clasificar') AS grupo_servicio,
            COUNT(DISTINCT nro_orden) AS unidades
          FROM orden_trabajo
          WHERE ${whereEmpresa}
            AND ${otDateExpr} >= :start AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            ${whereLocal}
          GROUP BY COALESCE(NULLIF(TRIM(grupo_servicio), ''), 'Sin clasificar')
          ORDER BY unidades DESC
        `,
        params,
      ),
      // Correctivo vs Mantenimiento Periodico (y demas tipo_ot): clasificacion
      // mas gruesa que grupo_servicio, para ver de un vistazo cuanto es
      // preventivo vs reactivo. Se excluye RECLAMOS AL CONCESIONARIO a
      // proposito: es contenido interno/sensible, no se le muestra al cliente.
      query(
        `
          SELECT
            COALESCE(NULLIF(TRIM(tipo_ot), ''), 'Sin clasificar') AS tipo_ot,
            COUNT(DISTINCT nro_orden) AS unidades
          FROM orden_trabajo
          WHERE ${whereEmpresa}
            AND ${otDateExpr} >= :start AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            AND UPPER(TRIM(tipo_ot)) <> 'RECLAMOS AL CONCESIONARIO'
            ${whereLocal}
          GROUP BY COALESCE(NULLIF(TRIM(tipo_ot), ''), 'Sin clasificar')
          ORDER BY unidades DESC
        `,
        params,
      ),
      query(
        `
          SELECT
            COALESCE(NULLIF(TRIM(marca), ''), 'Sin marca') AS marca,
            COALESCE(NULLIF(TRIM(modelo), ''), 'Sin modelo') AS modelo,
            COUNT(DISTINCT NULLIF(TRIM(placa), '')) AS vehiculos,
            COUNT(DISTINCT nro_orden) AS unidades
          FROM orden_trabajo
          WHERE ${whereEmpresa}
            AND ${otDateExpr} >= :start AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            ${whereLocal}
          GROUP BY
            COALESCE(NULLIF(TRIM(marca), ''), 'Sin marca'),
            COALESCE(NULLIF(TRIM(modelo), ''), 'Sin modelo')
          ORDER BY vehiculos DESC
          LIMIT 15
        `,
        params,
      ),
      // A proposito sin filtro de sede: sirve justo para ver el reparto entre sedes.
      query(
        `
          SELECT local_nombre, COUNT(DISTINCT nro_orden) AS unidades
          FROM orden_trabajo
          WHERE ${whereEmpresa}
            AND ${otDateExpr} >= :start AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
          GROUP BY local_nombre
          ORDER BY unidades DESC
        `,
        params,
      ),
      // Top 10 repuestos por cantidad real consumida (no por filas: una linea
      // de aceite puede sumar varios litros, cuenta mas que un repuesto unico).
      query(
        `
          SELECT
            TRIM(actividad) AS repuesto,
            SUM(COALESCE(CAST(NULLIF(TRIM(cantidad), '') AS DECIMAL(10,2)), 0)) AS cantidad,
            COUNT(*) AS veces
          FROM orden_trabajo
          WHERE ${whereEmpresa}
            AND ${otDateExpr} >= :start AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
            AND ${isRepuestoLinea}
            AND NULLIF(TRIM(actividad), '') IS NOT NULL
            ${whereLocal}
          GROUP BY TRIM(actividad)
          ORDER BY cantidad DESC
          LIMIT 10
        `,
        params,
      ),
    ]);

    // porVehiculo ya viene ordenado desc por vehiculos: el primero es "el
    // modelo que mas viene". Se pide aparte (no en el Promise.all de arriba)
    // porque depende de saber primero cual es ese modelo.
    const modeloTop = porVehiculo[0] || null;
    const serviciosModeloTop = modeloTop
      ? await query(
          `
            SELECT
              COALESCE(NULLIF(TRIM(grupo_servicio), ''), 'Sin clasificar') AS grupo_servicio,
              COUNT(DISTINCT nro_orden) AS unidades
            FROM orden_trabajo
            WHERE ${whereEmpresa}
              AND ${otDateExpr} >= :start AND ${otDateExpr} < DATE_ADD(:start, INTERVAL 1 MONTH)
              AND TRIM(marca) = :marcaTop
              AND TRIM(modelo) = :modeloTop
              ${whereLocal}
            GROUP BY COALESCE(NULLIF(TRIM(grupo_servicio), ''), 'Sin clasificar')
            ORDER BY unidades DESC
          `,
          { ...params, marcaTop: modeloTop.marca, modeloTop: modeloTop.modelo },
        )
      : [];

    const evolucionPorMes = new Map(
      evolucionMensualRows.map((row) => [Number(row.mes), row]),
    );
    const evolucionMensual = Array.from({ length: 12 }, (_, index) => {
      const fila = evolucionPorMes.get(index + 1);
      return {
        mes: index + 1,
        unidades: Number(fila?.unidades || 0),
        reprocesos: Number(fila?.reprocesos || 0),
      };
    });

    // Orden fijo de los cubos del histograma (la BD los devuelve sin orden util).
    const ordenRangos = ["0", "1", "2", "3", "4-7", "8+"];
    const distribucionPorRango = new Map(
      tiempoDistribucionRows.map((row) => [row.rango, Number(row.cantidad || 0)]),
    );
    const distribucion = ordenRangos.map((rango) => ({
      rango,
      cantidad: distribucionPorRango.get(rango) || 0,
    }));

    res.json({
      resumen: resumenRows[0] || {
        grupo_cliente: null,
        unidades_ot: 0,
        unidades_vehiculos: 0,
        reprocesos: 0,
      },
      evolucionMensual,
      tiempoTaller: {
        promedioDias: tiempoPromedioRows[0]?.promedio_dias ?? null,
        minDias: tiempoPromedioRows[0]?.min_dias ?? null,
        maxDias: tiempoPromedioRows[0]?.max_dias ?? null,
        otConCierre: Number(tiempoPromedioRows[0]?.ot_con_cierre || 0),
        distribucion,
        detalle: tiempoDetalle,
        masRapidas: tiempoMasRapidas,
        masLentas: tiempoMasLentas,
      },
      reprocesosDetalle,
      porEstado,
      porServicio,
      porTipoOt,
      porVehiculo,
      porSede,
      repuestosMasUsados,
      serviciosModeloTop,
    });
  } catch (error) {
    next(error);
  }
}
