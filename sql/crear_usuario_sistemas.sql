-- Crea el usuario ADMIN de sistemas@pinedautomotriz.com (Gerson Flores).
-- Password: 123456 (hash bcrypt generado con la misma funcion hashPassword
-- que usa backend/scripts/crearUsuario.js, valido para el login de la app).
INSERT INTO usuario (us_nombre, us_email, us_password_hash, us_rol, us_activo)
VALUES (
  'Gerson Flores',
  'sistemas@pinedautomotriz.com',
  '$2b$10$i68pnXpKXAHWKlIElITTvu/A.Kyh9ZWwpwoQVxL8yTApvPie1QY4a',
  'ADMIN',
  1
)
ON DUPLICATE KEY UPDATE
  us_nombre = VALUES(us_nombre),
  us_password_hash = VALUES(us_password_hash),
  us_rol = VALUES(us_rol),
  us_activo = 1;
