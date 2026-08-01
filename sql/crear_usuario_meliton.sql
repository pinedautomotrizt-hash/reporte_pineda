-- Crea el usuario ADMIN de meliton.rojas@pinedautomotriz.com (Melitón Rojas).
-- Password: 123456 (hash bcrypt generado con la misma funcion hashPassword
-- que usa backend/scripts/crearUsuario.js, valido para el login de la app).
INSERT INTO usuario (us_nombre, us_email, us_password_hash, us_rol, us_activo)
VALUES (
  'Melitón Rojas',
  'meliton.rojas@pinedautomotriz.com',
  '$2b$10$cGgjc4em0AYV84CK95leBO6Wg9a2xlQ6BxU3AqWck67OmM4PWieEC',
  'ADMIN',
  1
)
ON DUPLICATE KEY UPDATE
  us_nombre = VALUES(us_nombre),
  us_password_hash = VALUES(us_password_hash),
  us_rol = VALUES(us_rol),
  us_activo = 1;
