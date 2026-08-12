// Da de alta (o actualiza la contraseña de) un usuario de login.
// Uso: node scripts/crearUsuario.js <email> <password> <"Nombre completo"> <ADMIN|ASESOR|EMPRESAS|ASESOR_INDIVIDUAL> ["Nombre asesor"]
// El 5º argumento (nombre del asesor tal cual aparece en registro_venta/detalle_factura_ot)
// es obligatorio solo para el rol ASESOR_INDIVIDUAL: es lo que filtra sus propios datos.
import "dotenv/config";
import { pool, query } from "../src/db.js";
import { hashPassword } from "../src/utils/auth.js";

const ROLES_VALIDOS = ["ADMIN", "ASESOR", "EMPRESAS", "ASESOR_INDIVIDUAL"];

async function main() {
  const [email, password, nombre, rol, asesorNombre] = process.argv.slice(2);

  if (!email || !password || !nombre || !rol) {
    console.error(
      'Uso: node scripts/crearUsuario.js <email> <password> "<Nombre completo>" <ADMIN|ASESOR|EMPRESAS|ASESOR_INDIVIDUAL> ["Nombre asesor"]',
    );
    process.exit(1);
  }
  if (!ROLES_VALIDOS.includes(rol)) {
    console.error(`El rol debe ser uno de: ${ROLES_VALIDOS.join(", ")}.`);
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("La contraseña debe tener al menos 6 caracteres.");
    process.exit(1);
  }
  if (rol === "ASESOR_INDIVIDUAL" && !asesorNombre) {
    console.error('El rol ASESOR_INDIVIDUAL requiere el 5º argumento "Nombre asesor".');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  await query(
    `
      INSERT INTO usuario (us_nombre, us_email, us_password_hash, us_rol, us_asesor_nombre, us_activo)
      VALUES (:nombre, :email, :passwordHash, :rol, :asesorNombre, 1)
      ON DUPLICATE KEY UPDATE
        us_nombre = VALUES(us_nombre),
        us_password_hash = VALUES(us_password_hash),
        us_rol = VALUES(us_rol),
        us_asesor_nombre = VALUES(us_asesor_nombre),
        us_activo = 1
    `,
    { nombre, email: email.trim().toLowerCase(), passwordHash, rol, asesorNombre: asesorNombre || null },
  );

  console.log(`Usuario "${email}" (${rol}) guardado correctamente.`);
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
