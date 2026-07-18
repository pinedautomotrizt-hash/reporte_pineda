import { verifyToken } from "../utils/auth.js";


// Exige un access token valido en la cookie httpOnly y adjunta el usuario decodificado a req.user.
// Si el access token vencio, responde 401 para que el frontend intente /auth/refresh y reintente.
export function requireAuth(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) {
    return res.status(401).json({ message: "Debes iniciar sesion." });
  }
  try {
    const payload = verifyToken(token);
    if (payload.type !== "access") throw new Error("Tipo de token invalido.");
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Sesion invalida o vencida." });
  }
}

// Exige que req.user (ya autenticado por requireAuth) tenga uno de los roles indicados.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).json({ message: "No tienes permiso para esta accion." });
    }
    next();
  };
}
