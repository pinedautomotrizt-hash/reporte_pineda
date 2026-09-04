import { Router } from "express";
import multer from "multer";
import getEstado from "../controllers/estado.controllers.js";
import getLocalesFactura from "../controllers/localesfact.controllers.js";
import getStagingStatus from "../controllers/staging.controllers.js";
import createPlantillaStaging from "../controllers/stagingPlantilla.controllers.js";
import getImportacionHistorial from "../controllers/importacionHistorial.controllers.js";
import getDashboardResumen from "../controllers/resumen.controllers.js";
import getDashboardSeries, { getModelosPorMarca, getPendientesAperturados } from "../controllers/series.controllers.js";
import getEmpresasResumen, { getEmpresaDetalle } from "../controllers/empresas.controllers.js";
import exportarReporteFacturacion from "../controllers/reportesFacturacion.controllers.js";
import { login, refresh, me, logout } from "../controllers/auth.controllers.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import {
  getRegistroVentaAsesores,
  getRegistroVentaDashboard,
  getRegistroVentaResumenMensual,
  getAsesorPersonalDashboard,
  getProyeccionAnual,
} from "../controllers/registroVentaDashboard.controllers.js";
import {
  getAsesoresConfiguracion,
  upsertAsesorConfiguracion,
} from "../controllers/asesorConfiguracion.controllers.js";

// 50MB cubre con margen los reportes mas grandes que se han subido hasta ahora (~13.5MB).
const upload = multer({ dest: "uploads/", limits: { fileSize: 50 * 1024 * 1024 } });
const router = Router();

// Publicas: no requieren sesion. refresh/logout/me leen su propia cookie, por eso
// van antes de requireAuth (el access token puede estar vencido y aun asi
// necesitan poder renovarlo, cerrar la sesion, o decir "no hay sesion" sin dar 401).
router.get("/health", getEstado);
router.post("/auth/login", login);
router.post("/auth/refresh", refresh);
router.post("/auth/logout", logout);
router.get("/auth/me", me);

// De aqui en adelante, toda ruta exige un access token valido.
router.use(requireAuth);

// El rol EMPRESAS (clientes con acceso restringido) solo puede pedir datos
// del modulo Empresas y el catalogo de sedes que alimenta su selector de
// filtros. Esto es lo que de verdad protege el resto de la data: el sidebar
// deshabilita los demas modulos en el frontend, pero sin este chequeo alguien
// con este rol podria seguir pidiendo /dashboard/resumen etc. directo por API.
// Mismo criterio para el rol ASESOR_INDIVIDUAL (cada asesora ve solo su
// propia facturacion en /dashboard/asesor-personal). Distinto del rol ASESOR
// existente, que sigue con acceso amplio.
router.use((req, res, next) => {
  if (req.user?.rol === "EMPRESAS") {
    const permitido = req.path.startsWith("/dashboard/empresas") || req.path === "/dashboard/locales";
    if (!permitido) {
      return res.status(403).json({ message: "Tu usuario solo tiene acceso al módulo Empresas." });
    }
  }
  if (req.user?.rol === "ASESOR_INDIVIDUAL") {
    const permitido = req.path === "/dashboard/asesor-personal" || req.path === "/dashboard/locales";
    if (!permitido) {
      return res.status(403).json({ message: "Tu usuario solo tiene acceso al módulo Asesor." });
    }
  }
  next();
});

router.get("/dashboard/locales", getLocalesFactura);

// Importaciones: solo ADMIN puede ver el estado y subir archivos.
router.get("/import/status", requireRole("ADMIN"), getStagingStatus);
router.get("/import/historial", requireRole("ADMIN"), getImportacionHistorial);
router.post("/import/staging", requireRole("ADMIN"), upload.single("file"), createPlantillaStaging);

router.get("/dashboard/resumen", getDashboardResumen);

router.get("/dashboard/series", getDashboardSeries);
router.get("/dashboard/modelos-marca", getModelosPorMarca);
router.get("/dashboard/pendientes-aperturados", getPendientesAperturados);
router.get("/dashboard/facturacion", getRegistroVentaDashboard);
router.get("/dashboard/asesores", getRegistroVentaAsesores);
router.get("/dashboard/resumen-mensual", getRegistroVentaResumenMensual);
router.get("/dashboard/proyeccion-anual", getProyeccionAnual);
router.get("/dashboard/asesor-personal", getAsesorPersonalDashboard);
router.get("/dashboard/empresas", getEmpresasResumen);
router.get("/dashboard/empresas/:empresa", getEmpresaDetalle);

// Catálogo histórico utilizado para clasificar asesores sin reglas fijas en React.
// La lectura la necesita cualquier usuario autenticado (alimenta el resumen mensual);
// dar de alta/editar un asesor sigue siendo exclusivo de ADMIN.
router.get("/configuracion/asesores", getAsesoresConfiguracion);
router.post("/configuracion/asesores", requireRole("ADMIN"), upsertAsesorConfiguracion);

// Exportación independiente: no agrega lógica de archivos al dashboard general.
router.get("/reportes/facturacion/excel", exportarReporteFacturacion);

export default router;
