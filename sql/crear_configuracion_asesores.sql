-- Configuración histórica de asesores y áreas del reporte.
-- Las fechas permiten conservar la clasificación de documentos antiguos
-- aunque el asesor cambie de sede, área o deje de trabajar en la empresa.
CREATE TABLE IF NOT EXISTS asesor (
    as_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    as_nombre_origen VARCHAR(180) NOT NULL,
    as_nombre_mostrar VARCHAR(100) NOT NULL,
    as_local_nombre VARCHAR(100) NOT NULL,
    as_area_codigo VARCHAR(60) NOT NULL,
    as_fecha_inicio DATE NOT NULL,
    as_fecha_fin DATE NULL,
    as_activo TINYINT(1) NOT NULL DEFAULT 1,
    as_creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    as_actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (as_id),
    UNIQUE KEY uq_asesor_periodo (as_nombre_origen, as_local_nombre, as_fecha_inicio),
    KEY ix_asesor_vigencia (as_local_nombre, as_activo, as_fecha_inicio, as_fecha_fin),
    KEY ix_asesor_area (as_area_codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Configuración inicial confirmada para la sede Pineda Callao (Lima).
-- ON DUPLICATE KEY permite ejecutar este archivo más de una vez sin duplicar.
INSERT INTO asesor
    (as_nombre_origen, as_nombre_mostrar, as_local_nombre, as_area_codigo, as_fecha_inicio, as_fecha_fin, as_activo)
VALUES
    ('DURAN MENDOZA KARLISMAR JULIET', 'Karlismar', 'Pineda Callao', 'P&P LIMA', '2026-01-01', NULL, 1),
    ('TEQUEN ACOSTA ALEXANDER', 'Alexander', 'Pineda Callao', 'P&P LIMA', '2026-01-01', NULL, 1),
    ('ORDAZ GONZALEZ GENESIS JOHANNA', 'Genesis', 'Pineda Callao', 'GENESIS', '2026-01-01', NULL, 1),
    ('LOPEZ JAUREGUI ROGEIRIS ISMARIS', 'Rogeiris', 'Pineda Callao', 'ROGEIRIS', '2026-01-01', NULL, 1),

    -- Trujillo: los bloqueados permanecen para clasificar facturas históricas.
    ('MUÑOZ DIAZ RENZO', 'Renzo Muñoz', 'Pineda Trujillo', 'MUÑOZ DIAZ RENZO', '2026-01-01', NULL, 0),
    ('ROJAS MORENO CARLOS EMILIO WALTER', 'Carlos Rojas', 'Pineda Trujillo', 'ROJAS MORENO CARLOS EMILIO WALTER', '2026-01-01', NULL, 1),
    ('CABREJOS VALDIVIEZO FIORELLA GERALDINE', 'Fiorella Cabrejos', 'Pineda Trujillo', 'CABREJOS VALDIVIEZO FIORELLA GERALDINE', '2026-01-01', NULL, 0),
    ('VALERIO SANDRA', 'Sandra Valerio', 'Pineda Trujillo', 'VALERIO SANDRA', '2026-01-01', NULL, 0),
    ('RODRIGUEZ GUZMAN LETICIA', 'Leticia Rodriguez', 'Pineda Trujillo', 'RODRIGUEZ GUZMAN LETICIA', '2026-01-01', NULL, 0),
    ('AGUILAR SAUCEDO VALENTINA', 'Valentina Aguilar', 'Pineda Trujillo', 'AGUILAR SAUCEDO VALENTINA', '2026-01-01', NULL, 0),
    ('PONCE VASQUEZ BIANCA FIORELLA', 'Bianca Ponce', 'Pineda Trujillo', 'PONCE VASQUEZ BIANCA FIORELLA', '2026-01-01', NULL, 0),
    ('AREVALO JARA DHARA', 'Dhara Arevalo', 'Pineda Trujillo', 'AREVALO JARA DHARA', '2026-01-01', NULL, 0),
    ('ROSAS CADEÑO KAREN GINEHT', 'Karen Rosas', 'Pineda Trujillo', 'ROSAS CADEÑO KAREN GINEHT', '2026-01-01', NULL, 1)
ON DUPLICATE KEY UPDATE
    as_nombre_mostrar = VALUES(as_nombre_mostrar),
    as_area_codigo = VALUES(as_area_codigo),
    as_fecha_fin = VALUES(as_fecha_fin),
    as_activo = VALUES(as_activo);
