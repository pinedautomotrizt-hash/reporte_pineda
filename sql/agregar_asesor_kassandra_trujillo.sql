-- Agrega a CHOMBA GALVEZ KASSANDRA a la configuracion de asesores de Pineda
-- Trujillo. Sin esto, sus ventas caen en "Sin clasificar" en el Resumen
-- Mensual en vez de tener su propia columna (detectado 2026-07-20; ella
-- factura en Trujillo desde 2025-09-25, nunca estuvo en esta tabla).
-- Ya aplicado en la base local; falta correrlo en Railway (produccion).
INSERT INTO asesor
  (as_nombre_origen, as_nombre_mostrar, as_local_nombre, as_area_codigo, as_fecha_inicio, as_fecha_fin, as_activo)
VALUES
  ('CHOMBA GALVEZ KASSANDRA', 'CHOMBA GALVEZ KASSANDRA', 'Pineda Trujillo', 'CHOMBA GALVEZ KASSANDRA', '2026-01-01', NULL, 1)
ON DUPLICATE KEY UPDATE
  as_nombre_mostrar = VALUES(as_nombre_mostrar),
  as_area_codigo = VALUES(as_area_codigo),
  as_fecha_fin = VALUES(as_fecha_fin),
  as_activo = VALUES(as_activo);
