import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// En local, si no hay JWT_SECRET configurado, se usa un valor fijo para no
// romper el flujo de desarrollo. En Railway (produccion) SIEMPRE debe
// configurarse JWT_SECRET como variable de entorno propia.
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-cambiar-en-produccion";

// El access token es corto: si se filtra, la ventana de riesgo es chica.
// El refresh token es el que sostiene la sesion mientras el usuario sigue activo.
export const ACCESS_TOKEN_TTL = "30m";
export const ACCESS_TOKEN_MAX_AGE_MS = 30 * 60 * 1000;
export const REFRESH_TOKEN_TTL = "7d";
export const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// type distingue un access token de un refresh token para que uno no sirva en lugar del otro.
export function signAccessToken(usuario) {
  return jwt.sign(
    { type: "access", id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL },
  );
}

export function signRefreshToken(usuario) {
  return jwt.sign({ type: "refresh", id: usuario.id }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_TTL });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Local (http, mismo "site" localhost:puerto) usa Lax sin Secure porque el navegador
// rechaza SameSite=None sin Secure. Produccion (https, dominios distintos) usa
// None+Secure para que la cookie viaje entre el front y el backend en Railway.
// server.js activa "trust proxy" para que req.secure refleje bien el HTTPS real
// aunque Railway termine el TLS antes de reenviar la peticion.
function baseCookieOptions(req) {
  const isHttps = req.secure;
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? "none" : "lax",
    path: "/",
  };
}

export function accessTokenCookieOptions(req) {
  return { ...baseCookieOptions(req), maxAge: ACCESS_TOKEN_MAX_AGE_MS };
}

export function refreshTokenCookieOptions(req) {
  return { ...baseCookieOptions(req), maxAge: REFRESH_TOKEN_MAX_AGE_MS };
}
