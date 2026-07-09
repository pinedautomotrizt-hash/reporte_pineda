SET NAMES utf8mb4;

-- Evita que volver a subir un CSV que se solapa con uno anterior duplique
-- filas: si el documento/linea ya existe, el importador ahora actualiza en
-- vez de insertar de nuevo (ON DUPLICATE KEY UPDATE), gracias a estas keys.

ALTER TABLE registro_venta
  ADD UNIQUE KEY ux_registro_venta_documento (nro_documento, local_nombre);

ALTER TABLE orden_trabajo
  ADD UNIQUE KEY ux_orden_trabajo_linea (nro_orden, codigo_actividad, actividad);
