// Da de alta (o actualiza la contraseña de) un usuario de login.
// Uso: node scripts/crearUsuario.js <email> <password> <"Nombre completo"> <ADMIN|ASESOR>
import "dotenv/config";
import { pool, query } from "../src/db.js";
import { hashPassword } from "../src/utils/auth.js";

async function main() {
  const [email, password, nombre, rol] = process.argv.slice(2);

  if (!email || !password || !nombre || !rol) {
    console.error('Uso: node scripts/crearUsuario.js <email> <password> "<Nombre completo>" <ADMIN|ASESOR>');
    process.exit(1);
  }
  if (!["ADMIN", "ASESOR"].includes(rol)) {
    console.error('El rol debe ser "ADMIN" o "ASESOR".');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("La contraseña debe tener al menos 6 caracteres.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  await query(
    `
      INSERT INTO usuario (us_nombre, us_email, us_password_hash, us_rol, us_activo)
      VALUES (:nombre, :email, :passwordHash, :rol, 1)
      ON DUPLICATE KEY UPDATE
        us_nombre = VALUES(us_nombre),
        us_password_hash = VALUES(us_password_hash),
        us_rol = VALUES(us_rol),
        us_activo = 1
    `,
    { nombre, email: email.trim().toLowerCase(), passwordHash, rol },
  );

  console.log(`Usuario "${email}" (${rol}) guardado correctamente.`);
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
