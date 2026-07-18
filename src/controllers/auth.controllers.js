import { query } from "../db.js";
import {
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyToken,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
} from "../utils/auth.js";

function toUsuarioPublico(row) {
  return { id: row.us_id, nombre: row.us_nombre, email: row.us_email, rol: row.us_rol };
}

function setSessionCookies(req, res, usuario) {
  res.cookie("access_token", signAccessToken(usuario), accessTokenCookieOptions(req));
  res.cookie("refresh_token", signRefreshToken(usuario), refreshTokenCookieOptions(req));
}

// Valida un refresh token y trae el usuario vigente desde la BD (no confia solo en el payload,
// por si lo desactivaron despues de emitirlo). Devuelve null si el refresh token no sirve.
async function usuarioDesdeRefreshToken(token) {
  if (!token) return null;
  let payload;
  try {
    payload = verifyToken(token);
    if (payload.type !== "refresh") return null;
  } catch {
    return null;
  }
  const [fila] = await query(
    "SELECT us_id, us_nombre, us_email, us_rol, us_activo FROM usuario WHERE us_id = :id",
    { id: payload.id },
  );
  return fila && fila.us_activo ? toUsuarioPublico(fila) : null;
}

// Verifica email + contraseña y abre sesion dejando el access/refresh token en cookies httpOnly.
async function login(req, res, next) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ message: "Email y contraseña son obligatorios." });
    }

    const [fila] = await query(
      "SELECT us_id, us_nombre, us_email, us_password_hash, us_rol, us_activo FROM usuario WHERE us_email = :email",
      { email },
    );

    // Mismo mensaje para email inexistente y contraseña incorrecta, para no revelar cuáles emails existen.
    if (!fila || !fila.us_activo) {
      return res.status(401).json({ message: "Credenciales incorrectas." });
    }
    if (!(await verifyPassword(password, fila.us_password_hash))) {
      return res.status(401).json({ message: "Credenciales incorrectas." });
    }

    const usuario = toUsuarioPublico(fila);
    setSessionCookies(req, res, usuario);
    res.json({ usuario });
  } catch (error) {
    next(error);
  }
}

// Cambia el access token vencido por uno nuevo usando el refresh token, mientras siga vigente.
async function refresh(req, res, next) {
  try {
    const usuario = await usuarioDesdeRefreshToken(req.cookies?.refresh_token);
    if (!usuario) {
      return res.status(401).json({ message: "Sesion vencida, inicia sesion de nuevo." });
    }
    res.cookie("access_token", signAccessToken(usuario), accessTokenCookieOptions(req));
    res.json({ usuario });
  } catch (error) {
    next(error);
  }
}

// Dice si hay sesion activa (para que el frontend sepa que mostrar al cargar la app).
// A proposito NO usa requireAuth ni responde 401: "no hay sesion" es un resultado
// normal y esperado aca (primera visita, sesion cerrada), no un error de la peticion.
// Si el access token vencio pero el refresh token sigue vivo, la restaura sola.
async function me(req, res, next) {
  try {
    const accessToken = req.cookies?.access_token;
    if (accessToken) {
      try {
        const payload = verifyToken(accessToken);
        if (payload.type === "access") {
          return res.json({ usuario: { id: payload.id, nombre: payload.nombre, email: payload.email, rol: payload.rol } });
        }
      } catch {
        // access token vencido o invalido: seguimos abajo e intentamos con el refresh token.
      }
    }

    const usuario = await usuarioDesdeRefreshToken(req.cookies?.refresh_token);
    if (!usuario) {
      return res.json({ usuario: null });
    }
    res.cookie("access_token", signAccessToken(usuario), accessTokenCookieOptions(req));
    res.json({ usuario });
  } catch (error) {
    next(error);
  }
}

function logout(req, res) {
  res.clearCookie("access_token", { path: "/" });
  res.clearCookie("refresh_token", { path: "/" });
  res.json({ message: "Sesion cerrada." });
}

export { login, refresh, me, logout };
