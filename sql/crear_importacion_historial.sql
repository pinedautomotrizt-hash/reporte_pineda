-- Historial de importaciones: para que el usuario pueda ver que reporte
-- importo, cuando, quien y que sede/periodo cubrio, sin tener que confiar en
-- la memoria o en el popup de exito que ya desaparecio.
CREATE TABLE IF NOT EXISTS importacion_historial (
  ih_id INT AUTO_INCREMENT PRIMARY KEY,
  ih_reporte VARCHAR(120) NOT NULL,
  ih_tabla VARCHAR(60) NOT NULL,
  ih_filas_importadas INT NOT NULL,
  ih_locales VARCHAR(255) NULL,
  ih_periodo_desde DATE NULL,
  ih_periodo_hasta DATE NULL,
  ih_usuario_nombre VARCHAR(150) NULL,
  ih_usuario_email VARCHAR(150) NULL,
  ih_creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_importacion_historial_creado_en (ih_creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
