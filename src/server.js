import express from "express";
import cors from "cors";
import "dotenv/config";
import { mkdirSync } from "fs";
import generalRoutes from "./routes/general.routes.js";

const app = express();
const port = Number(process.env.PORT || 3001);

// multer necesita que la carpeta exista antes de recibir el primer archivo.
mkdirSync("uploads", { recursive: true });

// Middlewares globales: habilita CORS y permite recibir JSON en las peticiones.
app.use(cors({ origin: true }));
app.use(express.json());
app.use("/api", generalRoutes);

// Manejador central de errores: evita que la API se caiga y responde con detalle basico.
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: "Error en la API", detail: error.message });
});

// Arranca el servidor Express en el puerto configurado.
app.listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
});
