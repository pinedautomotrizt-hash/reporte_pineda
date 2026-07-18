import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "dotenv/config";
import { mkdirSync } from "fs";
import generalRoutes from "./routes/general.routes.js";

const app = express();
const port = Number(process.env.PORT || 3001);

// Railway termina el HTTPS antes de reenviar la peticion a la app; sin esto,
// req.secure siempre daria false y las cookies de sesion nunca se marcarian
// como Secure/SameSite=None en produccion.
app.set("trust proxy", 1);

// multer necesita que la carpeta exista antes de recibir el primer archivo.
mkdirSync("uploads", { recursive: true });

// Solo estos orígenes pueden llamar la API con cookies. FRONTEND_URL permite
// sumar un dominio extra (ej. un dominio propio) sin tocar código, vía Railway.
const allowedOrigins = [
  "https://pinedadash.netlify.app",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  process.env.FRONTEND_URL,
].filter(Boolean);

// Middlewares globales: habilita CORS con cookies (solo desde los orígenes de arriba),
// y permite recibir JSON en las peticiones.
app.use(cors({
  origin(origin, callback) {
    // Sin Origin (health checks, curl, servidor a servidor) se deja pasar.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error("Origen no permitido por CORS."));
  },
  credentials: true,
  exposedHeaders: ["Content-Disposition"],
}));
app.use(cookieParser());
app.use(express.json());
app.use("/api", generalRoutes);



// Manejador central de errores: evita que la API se caiga. Los errores lanzados a
// proposito por los controladores (HttpError, con status) traen un mensaje pensado
// para el usuario y se reenvia tal cual. Cualquier otro error (fallo de SQL, bug,
// etc.) se registra completo en el servidor pero al cliente solo le llega un
// mensaje generico, para no filtrar detalles internos (nombres de tabla, columnas, etc).
app.use((error, _req, res, _next) => {
  if (error.status) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error(error);
  res.status(500).json({ message: "Ocurrió un error inesperado. Intenta de nuevo en unos minutos." });
});


// Arranca el servidor Express en el puerto configurado.
app.listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
});
