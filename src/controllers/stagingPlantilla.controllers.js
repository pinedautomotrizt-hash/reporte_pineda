import { pool } from "../db.js";
import { stagingImports } from "../config/stagingImports.js";
import { bulkInsert } from "../utils/dbBulk.js";
import { parseSemicolonCsv } from "../utils/csv.js";
import { readFile, unlink } from "fs/promises";

const createPlantillaStaging = async (req, res, next) => {
  const file = req.file;
  try {
    const importType = String(req.body.import_type || "").trim();
    const config = stagingImports[importType];
    if (!file) {
      return res
        .status(400)
        .json({ message: "Debes seleccionar un archivo CSV." });
    }
    if (!config) {
      return res
        .status(400)
        .json({ message: "Tipo de importacion no valido." });
    }

    // Los reportes que exporta el sistema de origen vienen en Windows-1252/
    // ISO-8859-1 (asi los guarda Excel en español), no en UTF-8. Leerlos como
    // UTF-8 corrompe las tildes y la Ñ.
    const text = await readFile(file.path, "latin1");
    const rows = parseSemicolonCsv(text, config.skipLines)
      .map((cols) => config.columns.map((_, index) => cols[index] ?? null))
      .filter((cols) =>
        cols.some((value) => value !== null && String(value).trim() !== ""),
      );

    if (rows.length === 0) {
      return res
        .status(400)
        .json({ message: "No se encontraron filas validas en el CSV." });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await bulkInsert(config.table, config.columns, rows, connection, {
        upsert: Boolean(config.upsert),
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    res.json({
      message: `${config.label} importado correctamente a staging.`,
      tabla: config.table,
      filas_importadas: rows.length,
    });
  } catch (error) {
    next(error);
  } finally {
    if (file?.path) {
      await unlink(file.path).catch(() => {});
    }
  }
};

export default createPlantillaStaging;
