import { query } from "../db.js";

// Misma expresión que empresas.controllers.js para leer la fecha de la OT.
const otDateExpr =
  "STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d')";

// Una "visita" es una OT con placa. No cuentan como visita los reprocesos,
// los reclamos/garantías ni el servicio interno: volver porque un trabajo
// quedó mal no es fidelidad del cliente.
const visitasValidas = `
  visitas AS (
    SELECT DISTINCT
      local_nombre,
      UPPER(TRIM(placa)) AS placa,
      nro_orden,
      ${otDateExpr} AS fecha,
      UPPER(TRIM(tipo_ot)) AS tipo_ot
    FROM orden_trabajo
    WHERE NULLIF(TRIM(placa), '') IS NOT NULL
      AND ${otDateExpr} IS NOT NULL
      AND UPPER(COALESCE(grupo_servicio, '')) NOT LIKE '%REPROCESO%'
      AND UPPER(COALESCE(tipo_ot, '')) NOT LIKE '%REPROCESO%'
      AND UPPER(COALESCE(grupo_servicio, '')) NOT LIKE '%RECLAMO%'
      AND UPPER(COALESCE(tipo_ot, '')) NOT LIKE '%RECLAMO%'
      AND UPPER(COALESCE(tipo_ot, '')) <> 'SERVICIO INTERNO'
  )`;

// Primer día del semestre calendario de la visita (1 de enero o 1 de julio).
const inicioSemestre =
  "DATE_ADD(MAKEDATE(YEAR(fecha), 1), INTERVAL IF(MONTH(fecha) <= 6, 0, 6) MONTH)";

// Placas del semestre que tuvieron otra visita en los 12 meses siguientes a
// que terminó el semestre, en la misma sede. Se reutiliza en ambas consultas
// de retención para que el criterio de "volvió" sea exactamente el mismo.
const retornos = `
  retornos AS (
    SELECT DISTINCT b.local_nombre, b.placa, b.inicio
    FROM base b
    JOIN visitas v
      ON v.local_nombre = b.local_nombre
      AND v.placa = b.placa
      AND v.fecha >= DATE_ADD(b.inicio, INTERVAL 6 MONTH)
      AND v.fecha < DATE_ADD(b.inicio, INTERVAL 18 MONTH)
  )`;

// Retención de clientes por placa para el módulo Facturación:
// - semestres: placas atendidas en cada semestre y cuántas volvieron dentro
//   de los 12 meses siguientes. "completo" indica si esos 12 meses ya pasaron;
//   si no, la retención es parcial y todavía puede subir.
// - porServicio: la misma retención separada por el tipo de servicio de la
//   primera visita del semestre (solo semestres con ventana completa).
// - nuevosRecurrentes: placas atendidas cada mes, separando las que vienen
//   por primera vez a esa sede de las que ya tenían una visita anterior.
export default async function getRetencionClientes(req, res, next) {
  try {
    const [semestres, porServicio, nuevosRecurrentes] = await Promise.all([
      query(`
        WITH ${visitasValidas},
        base AS (
          SELECT local_nombre, placa, ${inicioSemestre} AS inicio
          FROM visitas
          GROUP BY local_nombre, placa, inicio
        ),
        ${retornos}
        SELECT
          b.local_nombre,
          DATE_FORMAT(b.inicio, '%Y-%m-%d') AS inicio,
          COUNT(*) AS placas_base,
          COUNT(r.placa) AS volvieron,
          DATE_ADD(b.inicio, INTERVAL 18 MONTH) <= CURDATE() AS completo,
          LEAST(12, TIMESTAMPDIFF(MONTH, DATE_ADD(b.inicio, INTERVAL 6 MONTH), CURDATE())) AS meses_ventana
        FROM base b
        LEFT JOIN retornos r
          ON r.local_nombre = b.local_nombre
          AND r.placa = b.placa
          AND r.inicio = b.inicio
        WHERE DATE_ADD(b.inicio, INTERVAL 6 MONTH) <= CURDATE()
        GROUP BY b.local_nombre, b.inicio
        ORDER BY b.local_nombre, b.inicio
      `),
      query(`
        WITH ${visitasValidas},
        primera_visita AS (
          SELECT
            local_nombre,
            placa,
            tipo_ot,
            ${inicioSemestre} AS inicio,
            ROW_NUMBER() OVER (
              PARTITION BY local_nombre, placa, ${inicioSemestre}
              ORDER BY fecha, nro_orden
            ) AS orden
          FROM visitas
        ),
        base AS (
          SELECT
            local_nombre,
            placa,
            inicio,
            CASE
              WHEN tipo_ot LIKE 'MANTENIMIENTO%' THEN 'Mantenimiento'
              WHEN tipo_ot LIKE 'CORRECTIVO%' THEN 'Correctivo'
              WHEN tipo_ot LIKE '%CARROCERIA%' OR tipo_ot LIKE '%PINTURA%' THEN 'Carrocería y pintura'
              ELSE 'Otros'
            END AS servicio
          FROM primera_visita
          WHERE orden = 1
        ),
        ${retornos}
        SELECT
          b.local_nombre,
          DATE_FORMAT(b.inicio, '%Y-%m-%d') AS inicio,
          b.servicio,
          COUNT(*) AS placas_base,
          COUNT(r.placa) AS volvieron
        FROM base b
        LEFT JOIN retornos r
          ON r.local_nombre = b.local_nombre
          AND r.placa = b.placa
          AND r.inicio = b.inicio
        WHERE DATE_ADD(b.inicio, INTERVAL 18 MONTH) <= CURDATE()
        GROUP BY b.local_nombre, b.inicio, b.servicio
        ORDER BY b.local_nombre, b.inicio, placas_base DESC
      `),
      // La data empieza en enero 2025: en los primeros meses casi todas las
      // placas saldrían como "nuevas" por falta de historia, así que la serie
      // arranca 6 meses después de la primera visita registrada.
      query(`
        WITH ${visitasValidas},
        primera AS (
          SELECT local_nombre, placa, DATE_FORMAT(MIN(fecha), '%Y-%m') AS primer_mes
          FROM visitas
          GROUP BY local_nombre, placa
        ),
        mes_placa AS (
          SELECT DISTINCT local_nombre, placa, DATE_FORMAT(fecha, '%Y-%m') AS mes
          FROM visitas
        )
        SELECT
          m.local_nombre,
          m.mes,
          SUM(p.primer_mes = m.mes) AS nuevos,
          SUM(p.primer_mes < m.mes) AS recurrentes
        FROM mes_placa m
        JOIN primera p
          ON p.local_nombre = m.local_nombre
          AND p.placa = m.placa
        WHERE m.mes >= (
          SELECT DATE_FORMAT(DATE_ADD(MIN(fecha), INTERVAL 6 MONTH), '%Y-%m') FROM visitas
        )
        GROUP BY m.local_nombre, m.mes
        ORDER BY m.local_nombre, m.mes
      `),
    ]);

    res.json({ semestres, porServicio, nuevosRecurrentes });
  } catch (error) {
    next(error);
  }
}
