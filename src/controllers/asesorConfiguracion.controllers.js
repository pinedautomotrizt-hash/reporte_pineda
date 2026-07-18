import { query } from "../db.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;




// Lista configuraciones y, opcionalmente, las filtra por sede y fecha efectiva. Gerson 
async function getAsesoresConfiguracion(req, res, next) {
  try {
    const local = String(req.query.local || "").trim();
    const fecha = String(req.query.fecha || "").trim();
    const incluirInactivos = req.query.incluir_inactivos === "1" ? 1 : 0;

    if (fecha && !ISO_DATE.test(fecha)) {
      return res.status(400).json({ message: "La fecha debe usar el formato YYYY-MM-DD." });
    }

    const rows = await query(
      `
        SELECT
          as_id AS id,
          as_nombre_origen AS nombre_origen,
          as_nombre_mostrar AS nombre_mostrar,
          as_local_nombre AS local_nombre,
          as_area_codigo AS area_codigo,
          DATE_FORMAT(as_fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
          DATE_FORMAT(as_fecha_fin, '%Y-%m-%d') AS fecha_fin,
          as_activo AS activo
        FROM asesor
        WHERE (:local = '' OR as_local_nombre = :local)
          -- Al consultar una fecha histórica se consideran también asesores
          -- bloqueados; as_activo solo controla el catálogo vigente sin fecha.
          AND (:fecha <> '' OR :incluirInactivos = 1 OR as_activo = 1)
          AND (
            :fecha = ''
            OR (
              as_fecha_inicio <= :fecha
              AND (as_fecha_fin IS NULL OR as_fecha_fin >= :fecha)
            )
          )
        ORDER BY as_local_nombre, as_area_codigo, as_nombre_mostrar
      `,
      { local, fecha, incluirInactivos },
    );

    res.json({ total: rows.length, asesores: rows });
  } catch (error) {
    next(error);
  }
}

// Inserta una vigencia nueva o actualiza la misma combinación asesor/sede/inicio.
async function upsertAsesorConfiguracion(req, res, next) {
  try {
    const nombreOrigen = String(req.body.nombre_origen || "").trim().toUpperCase();
    const nombreMostrar = String(req.body.nombre_mostrar || "").trim();
    const localNombre = String(req.body.local_nombre || "").trim();
    const areaCodigo = String(req.body.area_codigo || "").trim().toUpperCase();
    const fechaInicio = String(req.body.fecha_inicio || "").trim();
    const fechaFin = req.body.fecha_fin ? String(req.body.fecha_fin).trim() : null;
    const activo = req.body.activo === false || Number(req.body.activo) === 0 ? 0 : 1;

    if (!nombreOrigen || !nombreMostrar || !localNombre || !areaCodigo) {
      return res.status(400).json({ message: "Nombre, etiqueta, sede y area son obligatorios." });
    }
    if (!ISO_DATE.test(fechaInicio) || (fechaFin && !ISO_DATE.test(fechaFin))) {
      return res.status(400).json({ message: "Las fechas deben usar el formato YYYY-MM-DD." });
    }
    if (fechaFin && fechaFin < fechaInicio) {
      return res.status(400).json({ message: "La fecha final no puede ser anterior a la inicial." });
    }

    await query(
      `
        INSERT INTO asesor
          (as_nombre_origen, as_nombre_mostrar, as_local_nombre, as_area_codigo, as_fecha_inicio, as_fecha_fin, as_activo)
        VALUES
          (:nombreOrigen, :nombreMostrar, :localNombre, :areaCodigo, :fechaInicio, :fechaFin, :activo)
        ON DUPLICATE KEY UPDATE
          as_nombre_mostrar = VALUES(as_nombre_mostrar),
          as_area_codigo = VALUES(as_area_codigo),
          as_fecha_fin = VALUES(as_fecha_fin),
          as_activo = VALUES(as_activo)
      `,
      { nombreOrigen, nombreMostrar, localNombre, areaCodigo, fechaInicio, fechaFin, activo },
    );

    res.status(201).json({ message: "Configuracion del asesor guardada correctamente." });
  } catch (error) {
    next(error);
  }
}

export { getAsesoresConfiguracion, upsertAsesorConfiguracion };
