import { Router } from "express";
import multer from "multer";
import getEstado from "../controllers/estado.controllers.js";
import getLocalesFactura from "../controllers/localesfact.controllers.js";
import getStagingStatus from "../controllers/staging.controllers.js";
import createPlantillaStaging from "../controllers/stagingPlantilla.controllers.js";
import getDashboardResumen from "../controllers/resumen.controllers.js";
import getDashboardSeries from "../controllers/series.controllers.js";
import {
  getRegistroVentaAsesores,
  getRegistroVentaDashboard,
} from "../controllers/registroVentaDashboard.controllers.js";
import {
  getComercialResumen,
  getComercialAnual,
} from "../controllers/comercial.controllers.js";
import {
  getCuotas,
  upsertCuota,
  deleteCuota,
} from "../controllers/cuotaComercial.controllers.js";

const upload = multer({ dest: "uploads/" });
const router = Router();

router.get("/health", getEstado);

router.get("/dashboard/locales", getLocalesFactura);

router.get("/import/status", getStagingStatus);

router.post("/import/staging", upload.single("file"), createPlantillaStaging);

router.get("/dashboard/resumen", getDashboardResumen);



router.get("/dashboard/series", getDashboardSeries);
router.get("/dashboard/facturacion", getRegistroVentaDashboard);
router.get("/dashboard/asesores", getRegistroVentaAsesores);

router.get("/dashboard/comercial", getComercialResumen);
router.get("/dashboard/comercial/anual", getComercialAnual);

router.get("/dashboard/cuotas", getCuotas);
router.post("/dashboard/cuotas", upsertCuota);
router.delete("/dashboard/cuotas/:id", deleteCuota);

export default router;
