-- Crea el usuario ADMIN de jessica.pineda@pinedautomotriz.com (Jessica Pineda).
-- Password: 654321 (hash bcrypt generado con la misma funcion hashPassword
-- que usa backend/scripts/crearUsuario.js, valido para el login de la app).
INSERT INTO usuario (us_nombre, us_email, us_password_hash, us_rol, us_activo)
VALUES (
  'Jessica Pineda',
  'jessica.pineda@pinedautomotriz.com',
  '$2b$10$Y0ZjTsmFUn62LAUworHBIuFU9RYd9FoAGxOGyR1U4OGYqlW7dCPa6',
  'ADMIN',
  1
)
ON DUPLICATE KEY UPDATE
  us_nombre = VALUES(us_nombre),
  us_password_hash = VALUES(us_password_hash),
  us_rol = VALUES(us_rol),
  us_activo = 1;
