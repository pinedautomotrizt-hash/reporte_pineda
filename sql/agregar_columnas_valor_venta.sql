-- Corrige el desfase de columnas al importar "Ordenes de Trabajo": el archivo
-- real trae "Val.Ven. Repuestos" y "Val.Ven. Servicios" entre Utilidad y
-- Tecnico de Actividad, que la tabla no tenia. Sin esto, el mapa de
-- departamentos y otros campos posteriores (provincia, distrito, etc.)
-- se leen corridos 2 columnas.
ALTER TABLE orden_trabajo
  ADD COLUMN valor_venta_repuestos VARCHAR(30) AFTER utilidad,
  ADD COLUMN valor_venta_servicios VARCHAR(30) AFTER valor_venta_repuestos;
