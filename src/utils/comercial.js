// Reglas de clasificacion comercial compartidas por los controladores de Informe Comercial.
// registro_venta sigue siendo la unica fuente de montos; orden_trabajo solo aporta
// clasificacion (tipo de servicio, placa) via JOIN por operacion_relacionada <-> nro_orden.

export const FLOTA_RUCS = {
  20509959766: "ARVAL",
  20524546206: "MAREAUTOS",
  20509031500: "RENTING",
  20601129826: "ALD",
  20601020719: "ANC",
};

const flotaRucList = Object.keys(FLOTA_RUCS)
  .map((ruc) => `'${ruc}'`)
  .join(", ");

// Una fila por OT: tipo_ot/clase_ot/grupo_cliente/placa son consistentes dentro
// de cada nro_orden, asi que agregarlos antes del JOIN no duplica documentos.
export const otResumenSubquery = `
  SELECT
    nro_orden,
    MAX(tipo_ot) AS tipo_ot,
    MAX(clase_ot) AS clase_ot,
    MAX(grupo_cliente) AS grupo_cliente,
    MAX(NULLIF(TRIM(placa), '')) AS placa
  FROM orden_trabajo
  GROUP BY nro_orden
`;

// Prioridad: RUC de flota conocido > grupo_cliente de la OT > longitud de documento.
// ALD y ANC vienen con grupo_cliente = 'NINGUNO' en el sistema de origen, por eso
// el RUC conocido tiene que ganar sobre ese campo.
export const clienteCategoriaExpr = (docAlias = "documentos", otAlias = "ot") => `
  CASE
    WHEN TRIM(${docAlias}.cliente_documento) IN (${flotaRucList}) THEN 'FLOTA'
    WHEN UPPER(TRIM(${otAlias}.grupo_cliente)) = 'FLOTAS' THEN 'FLOTA'
    WHEN LENGTH(TRIM(${docAlias}.cliente_documento)) = 11 THEN 'CORPORATIVO'
    WHEN LENGTH(TRIM(${docAlias}.cliente_documento)) = 8 THEN 'CLIENTE_FINAL'
    ELSE 'SIN_CLASIFICAR'
  END
`;

export const flotaNombreExpr = (docAlias = "documentos") => `
  CASE TRIM(${docAlias}.cliente_documento)
    ${Object.entries(FLOTA_RUCS)
      .map(([ruc, nombre]) => `WHEN '${ruc}' THEN '${nombre}'`)
      .join("\n    ")}
    ELSE 'OTRAS_FLOTAS'
  END
`;

export const servicioCategoriaExpr = (otAlias = "ot") => `
  CASE
    WHEN UPPER(TRIM(${otAlias}.tipo_ot)) = 'MANTENIMIENTO PERIODICO' THEN 'MANTENIMIENTO_PREVENTIVO'
    WHEN UPPER(TRIM(${otAlias}.tipo_ot)) = 'CORRECTIVO Y REPARACIONES GENERALES' THEN 'MANTENIMIENTO_CORRECTIVO'
    WHEN UPPER(TRIM(${otAlias}.clase_ot)) = 'CARROCERIA Y PINTURA' THEN 'PLANCHADO_PINTURA'
    WHEN ${otAlias}.tipo_ot IS NOT NULL THEN 'OTROS'
    ELSE 'SIN_CLASIFICAR'
  END
`;
