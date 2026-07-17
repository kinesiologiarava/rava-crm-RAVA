-- ============================================================
-- MÓDULO COBROS v2 — FASE 1a: tablas nuevas (sin migrar datos todavía)
-- Ejecutar en Supabase SQL Editor
-- No toca crm_registros salvo agregar una columna nueva (aditivo).
-- No toca crm_tramites_osde ni crm_cobros_medife (quedan como respaldo).
-- ============================================================

-- ───────────────────────────────────────────────────────────
-- 1. Configuración por obra social — cómo liquida cada una
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_obras_sociales (
  id                        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nombre                    TEXT NOT NULL UNIQUE,        -- "OSDE", "MEDIFE", "PARTICULAR"
  tipo_ciclo                TEXT NOT NULL,                -- 'corte_personalizado' | 'mes_calendario' | 'directo'
  dia_corte                 INTEGER,                      -- 15 para OSDE; null si no aplica
  dias_demora_cobro_est     INTEGER,                      -- ~45 OSDE, ~40 MEDIFE, 0 particular
  espera_cabecera_y_detalle BOOLEAN DEFAULT false,         -- true solo en OSDE (dos documentos distintos)
  activa                    BOOLEAN DEFAULT true,
  notas                     TEXT DEFAULT ''
);

INSERT INTO crm_obras_sociales (nombre, tipo_ciclo, dia_corte, dias_demora_cobro_est, espera_cabecera_y_detalle, notas) VALUES
  ('OSDE',       'corte_personalizado', 15,   45, true,  'Período de 15 a 15. Cabecera (fiscal) + Detalle (control) son documentos distintos.'),
  ('MEDIFE',     'mes_calendario',      NULL, 40, false, 'Factura del mes completo, se presenta el mes siguiente, cobro ~40 días después.'),
  ('PARTICULAR', 'directo',             NULL, 0,  false, 'Sin período de liquidación — cobro directo por atención. A integrar con Agenda Rava.')
ON CONFLICT (nombre) DO NOTHING;

-- ───────────────────────────────────────────────────────────
-- 2. Período de liquidación — la entidad central
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_periodos_liquidacion (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  obra_social_id        TEXT NOT NULL REFERENCES crm_obras_sociales(id),
  fecha_desde           DATE NOT NULL,
  fecha_hasta           DATE NOT NULL,
  etiqueta              TEXT,                   -- "OSDE 15/05-15/06", autogenerable en la UI
  fecha_cobro_estimada  DATE,                   -- fecha_hasta + dias_demora_cobro_est de la obra social
  notas                 TEXT DEFAULT '',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (obra_social_id, fecha_desde, fecha_hasta)
);

-- ───────────────────────────────────────────────────────────
-- 3. Documentos cargados — evidencia tipada, siempre atada a un período
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_documentos_liquidacion (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  periodo_id      TEXT NOT NULL REFERENCES crm_periodos_liquidacion(id),
  tipo            TEXT NOT NULL,     -- 'cabecera' | 'detalle_movimiento' | 'factura' | 'nota_credito' | 'comprobante_cobro' | 'otro'
  archivo_nombre  TEXT,
  archivo_url     TEXT,
  datos_extraidos JSONB DEFAULT '{}',
  fecha_carga     TIMESTAMPTZ DEFAULT NOW(),
  notas           TEXT DEFAULT ''
);

-- ───────────────────────────────────────────────────────────
-- 4. Detalle línea por línea del Detalle/Movimiento de OSDE
--    (para comparar contra crm_registros)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_prestaciones_liquidadas (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  periodo_id       TEXT NOT NULL REFERENCES crm_periodos_liquidacion(id),
  documento_id     TEXT REFERENCES crm_documentos_liquidacion(id),
  fecha_prestacion DATE,
  paciente_nombre  TEXT,       -- solo a fines de auditoría humana, no hay match automático por paciente
  profesional      TEXT,
  tipo_prestacion  TEXT,       -- FKT/RPG/DRENAJE/etc
  importe          NUMERIC DEFAULT 0,
  debitada         BOOLEAN DEFAULT false,
  motivo_debito    TEXT
);

-- ───────────────────────────────────────────────────────────
-- 5. Facturas emitidas (y notas de crédito/débito futuras)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_facturas (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  periodo_id          TEXT NOT NULL REFERENCES crm_periodos_liquidacion(id),
  tipo                TEXT NOT NULL DEFAULT 'factura',  -- 'factura' | 'nota_credito' | 'nota_debito'
  numero              TEXT,
  fecha_emision       DATE,
  importe_gravado     NUMERIC DEFAULT 0,
  importe_exento      NUMERIC DEFAULT 0,
  iva                 NUMERIC DEFAULT 0,
  importe_total       NUMERIC DEFAULT 0,
  retencion_ganancias NUMERIC DEFAULT 0,  -- hoy siempre 0 (certificado de no retención vigente hasta 31/03/2027)
  detalle             JSONB DEFAULT '{}', -- forma libre: OSDE {FKT:{cant,imp},...}; MEDIFE {obligatorios,directos,precio_unitario}
  notas               TEXT DEFAULT ''
);

-- ───────────────────────────────────────────────────────────
-- 6. Cobros reales (soporta pagos parciales/múltiples)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_cobros (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  periodo_id  TEXT REFERENCES crm_periodos_liquidacion(id),  -- nullable: Particular no siempre tendrá período
  fecha       DATE NOT NULL,
  importe     NUMERIC NOT NULL,
  medio       TEXT,                    -- transferencia/efectivo/MP/tarjeta
  origen      TEXT DEFAULT 'manual',    -- 'manual' | 'agenda_rava' (a futuro)
  notas       TEXT DEFAULT ''
);

-- ───────────────────────────────────────────────────────────
-- 7. Estado del período — calculado, nunca elegido a mano
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW crm_periodos_estado AS
SELECT
  p.id, p.obra_social_id, p.fecha_desde, p.fecha_hasta, p.fecha_cobro_estimada, p.etiqueta,
  f.numero AS numero_factura,
  f.importe_total AS importe_facturado,
  COALESCE(SUM(c.importe), 0) AS importe_cobrado,
  CASE
    WHEN f.id IS NULL THEN 'esperando_liquidacion'
    WHEN COALESCE(SUM(c.importe), 0) = 0 THEN 'facturado_pendiente'
    WHEN COALESCE(SUM(c.importe), 0) < f.importe_total THEN 'cobrado_parcial'
    ELSE 'cobrado_total'
  END AS estado
FROM crm_periodos_liquidacion p
LEFT JOIN crm_facturas f ON f.periodo_id = p.id AND f.tipo = 'factura'
LEFT JOIN crm_cobros c ON c.periodo_id = p.id
GROUP BY p.id, f.id;

-- ───────────────────────────────────────────────────────────
-- 8. Columna de fecha real en crm_registros (aditivo, no rompe nada)
--    Necesaria para poder filtrar por rango de fechas cuando un
--    período de OSDE cruza dos meses (15/05 al 15/06, por ejemplo).
-- ───────────────────────────────────────────────────────────
ALTER TABLE crm_registros ADD COLUMN IF NOT EXISTS fecha DATE;

UPDATE crm_registros
SET fecha = TO_DATE(
  LEFT(mes, 4) || '-' || SPLIT_PART(dia, '/', 2) || '-' || SPLIT_PART(dia, '/', 1),
  'YYYY-MM-DD'
)
WHERE fecha IS NULL
  AND dia ~ '^\d{1,2}/\d{1,2}$'
  AND mes ~ '^\d{4}-\d{2}$';

-- Verificación rápida
SELECT 'crm_obras_sociales' AS tabla, count(*) FROM crm_obras_sociales
UNION ALL SELECT 'crm_periodos_liquidacion', count(*) FROM crm_periodos_liquidacion
UNION ALL SELECT 'crm_facturas', count(*) FROM crm_facturas
UNION ALL SELECT 'crm_registros con fecha', count(*) FROM crm_registros WHERE fecha IS NOT NULL
UNION ALL SELECT 'crm_registros sin fecha (revisar)', count(*) FROM crm_registros WHERE fecha IS NULL;
