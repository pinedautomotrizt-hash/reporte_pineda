SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS registro_venta (
    fec_documento VARCHAR(30),
    tipo_documento VARCHAR(30),
    nro_documento VARCHAR(60),
    cliente_documento VARCHAR(30),
    cliente_nombre VARCHAR(180),
    moneda VARCHAR(20),
    moneda_usd VARCHAR(30),
    valor_gravado VARCHAR(30),
    valor_exonerado VARCHAR(30),
    valor_inafecto VARCHAR(30),
    impuesto VARCHAR(30),
    precio_venta VARCHAR(30),
    clase_venta VARCHAR(80),
    asesor VARCHAR(150),
    estado VARCHAR(50),
    operacion_relacionada VARCHAR(80),
    asesor_operacion VARCHAR(150),
    forma_pago VARCHAR(50),
    flujo_caja VARCHAR(80),
    saldo_cancelar VARCHAR(30),
    estado_sunat VARCHAR(50),
    fec_registro_documento VARCHAR(30),
    local_nombre VARCHAR(100),
    contenido_documento VARCHAR(150),
    KEY ix_registro_venta_fecha (fec_documento),
    KEY ix_registro_venta_local (local_nombre),
    KEY ix_registro_venta_asesor_operacion (asesor_operacion),
    KEY ix_registro_venta_documento (nro_documento)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

SELECT COUNT(*) AS filas FROM registro_venta;
