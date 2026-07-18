import { parseFilters } from "../utils/expresiones.js";
import { generarReporteFacturacion } from "../services/reportesFacturacion.service.js";

// Valida filtros, genera el libro y lo entrega como descarga de Excel.
export default async function exportarReporteFacturacion(req, res, next) {
  try {
    const filtros = parseFilters(req);
    const reporte = await generarReporteFacturacion(filtros);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${reporte.filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(reporte.buffer);
  } catch (error) {
    next(error);
  }
}
