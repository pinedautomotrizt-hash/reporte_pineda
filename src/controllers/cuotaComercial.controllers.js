import { query } from "../db.js";

const CATEGORIAS = [
  "GENERAL",
  "MANTENIMIENTO_PREVENTIVO",
  "MANTENIMIENTO_CORRECTIVO",
  "PLANCHADO_PINTURA",
  "CLIENTE_FINAL",
  "CORPORATIVO",
  "FLOTA",
  "ARVAL",
  "RENTING",
  "MAREAUTOS",
  "ALD",
  "ANC",
  "OTRAS_FLOTAS",
];

const getCuotas = async (req, res, next) => {
  try {
    const anio = /^\d{4}$/.test(req.query.anio || "")
      ? Number(req.query.anio)
      : new Date().getFullYear();
    const rows = await query(
      `
        SELECT id, anio, mes, categoria, local_nombre, monto
        FROM cuota_comercial
        WHERE anio = :anio
        ORDER BY categoria, mes
      `,
      { anio },
    );
    res.json({ anio, cuotas: rows });
  } catch (error) {
    next(error);
  }
};

const upsertCuota = async (req, res, next) => {
  try {
    const anio = Number(req.body.anio);
    const mes = req.body.mes === undefined || req.body.mes === null || req.body.mes === ""
      ? 0
      : Number(req.body.mes);
    const categoria = String(req.body.categoria || "").trim().toUpperCase();
    const localNombre = String(req.body.local_nombre || "").trim();
    const monto = Number(req.body.monto);

    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
      return res.status(400).json({ message: "Anio invalido." });
    }
    if (!Number.isInteger(mes) || mes < 0 || mes > 12) {
      return res
        .status(400)
        .json({ message: "Mes invalido (0 a 12; 0 = cuota anual)." });
    }
    if (!CATEGORIAS.includes(categoria)) {
      return res.status(400).json({ message: "Categoria no reconocida." });
    }
    if (!Number.isFinite(monto) || monto < 0) {
      return res.status(400).json({ message: "Monto invalido." });
    }

    await query(
      `
        INSERT INTO cuota_comercial (anio, mes, categoria, local_nombre, monto)
        VALUES (:anio, :mes, :categoria, :localNombre, :monto)
        ON DUPLICATE KEY UPDATE monto = VALUES(monto)
      `,
      { anio, mes, categoria, localNombre, monto },
    );

    res.json({ message: "Cuota guardada correctamente." });
  } catch (error) {
    next(error);
  }
};

const deleteCuota = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id invalido." });
    }
    await query("DELETE FROM cuota_comercial WHERE id = :id", { id });
    res.json({ message: "Cuota eliminada." });
  } catch (error) {
    next(error);
  }
};

export { getCuotas, upsertCuota, deleteCuota, CATEGORIAS };
