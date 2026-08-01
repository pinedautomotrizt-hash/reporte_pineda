-- Crea el usuario ADMIN de carlos.rojas@pinedautomotriz.com (Carlos Rojas).
-- Password: 678901 (hash bcrypt generado con la misma funcion hashPassword
-- que usa backend/scripts/crearUsuario.js, valido para el login de la app).
INSERT INTO usuario (us_nombre, us_email, us_password_hash, us_rol, us_activo)
VALUES (
  'Carlos Rojas',
  'carlos.rojas@pinedautomotriz.com',
  '$2b$10$JSiuqQzE32vWo05xy828gOuH0qNapgacanUJVCWJiU/V9s17E3pT6',
  'ADMIN',
  1
)
ON DUPLICATE KEY UPDATE
  us_nombre = VALUES(us_nombre),
  us_password_hash = VALUES(us_password_hash),
  us_rol = VALUES(us_rol),
  us_activo = 1;
