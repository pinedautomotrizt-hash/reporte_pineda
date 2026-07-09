SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS cuota_comercial (
    id INT AUTO_INCREMENT PRIMARY KEY,
    anio INT NOT NULL,
    mes TINYINT NOT NULL DEFAULT 0,        -- 0 = cuota anual, 1-12 = mensual
    categoria VARCHAR(40) NOT NULL,
    local_nombre VARCHAR(100) NOT NULL DEFAULT '',  -- '' = todos los locales
    monto DECIMAL(14,2) NOT NULL DEFAULT 0,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY ux_cuota_periodo (anio, mes, categoria, local_nombre)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- orden_trabajo no tiene ningun indice; el JOIN por nro_orden y los
-- filtros por fecha/placa del Informe Comercial lo necesitan antes de que
-- llegue mas data (CSV 2025).
ALTER TABLE orden_trabajo
  ADD KEY ix_orden_trabajo_nro_orden (nro_orden),
  ADD KEY ix_orden_trabajo_fecha (fec_apertura),
  ADD KEY ix_orden_trabajo_placa (placa);

ALTER TABLE registro_venta
  ADD KEY ix_registro_venta_cliente_documento (cliente_documento);

SELECT COUNT(*) AS filas FROM cuota_comercial;
