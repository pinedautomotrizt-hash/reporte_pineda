-- Crea el usuario ADMIN de administracion@pinedautomotriz.com (Adriana Atoche).
-- Password: 654321 (hash bcrypt generado con la misma funcion hashPassword
-- que usa backend/scripts/crearUsuario.js, valido para el login de la app).
INSERT INTO usuario (us_nombre, us_email, us_password_hash, us_rol, us_activo)
VALUES (
  'Adriana Atoche',
  'administracion@pinedautomotriz.com',
  '$2b$10$z5BA/.EA4EorV1tIeXZ6bOgwRxKVvSnXjBE//5DUheywIf6RwO7b.',
  'ADMIN',
  1
)
ON DUPLICATE KEY UPDATE
  us_nombre = VALUES(us_nombre),
  us_password_hash = VALUES(us_password_hash),
  us_rol = VALUES(us_rol),
  us_activo = 1;
