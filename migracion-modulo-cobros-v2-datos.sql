-- ============================================================
-- MÓDULO COBROS v2 — FASE 1b: refinamientos de esquema + datos reales
-- Ejecutar en Supabase SQL Editor, DESPUÉS de migracion-modulo-cobros-v2-tablas.sql
-- Migra únicamente los trámites con datos confirmados por PDF real:
--   5805582132 (feb), 5805998423 (16/05-15/06), 5806107471 (16/06-15/07)
-- 5805780144 y 5805882536 (los corruptos) quedan afuera hasta tener sus PDF.
-- ============================================================

-- ───────────────────────────────────────────────────────────
-- 1. Campos nuevos en crm_prestaciones_liquidadas, según lo que
--    trae el Detalle de Liquidación real de OSDE
-- ───────────────────────────────────────────────────────────
ALTER TABLE crm_prestaciones_liquidadas
  ADD COLUMN IF NOT EXISTS valor_a_cargo_socio NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS diferencia_os NUMERIC DEFAULT 0,        -- "Diferencia" que ya calcula OSDE (facturado vs liquidado)
  ADD COLUMN IF NOT EXISTS estado_os TEXT,                          -- "APROBADO", etc.
  ADD COLUMN IF NOT EXISTS tramite_original TEXT,                   -- si la línea viene arrastrada de un trámite anterior
  ADD COLUMN IF NOT EXISTS codigo_os TEXT;                          -- código de nomenclador de la obra social (ej "1250181")

-- ───────────────────────────────────────────────────────────
-- 2. Mapeo de códigos de nomenclador → tipo de prestación del CRM
--    (se completa de a poco, a medida que aparecen códigos nuevos)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_mapeo_prestaciones (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  obra_social_id  TEXT NOT NULL REFERENCES crm_obras_sociales(id),
  codigo          TEXT NOT NULL,
  descripcion     TEXT,
  tipo_prestacion TEXT NOT NULL,  -- FKT/RPG/DRENAJE/ATM
  UNIQUE (obra_social_id, codigo)
);

INSERT INTO crm_mapeo_prestaciones (obra_social_id, codigo, descripcion, tipo_prestacion)
SELECT id, '1250181', 'MOD.TRAT.KINESIOLOGICO', 'FKT' FROM crm_obras_sociales WHERE nombre = 'OSDE'
UNION ALL
SELECT id, '255012', 'TRATAMIENTO COMPLETO (FKT + LASER Y/O MAGNETO)', 'FKT' FROM crm_obras_sociales WHERE nombre = 'MEDIFE'
ON CONFLICT (obra_social_id, codigo) DO NOTHING;

-- ───────────────────────────────────────────────────────────
-- 3. Períodos OSDE con datos confirmados
-- ───────────────────────────────────────────────────────────
INSERT INTO crm_periodos_liquidacion (obra_social_id, fecha_desde, fecha_hasta, etiqueta, fecha_cobro_estimada, notas)
SELECT id, '2026-01-15'::date, '2026-02-12'::date, 'OSDE 15/01–12/02 (trámite 5805582132)',
       '2026-03-09'::date, 'Migrado desde crm_tramites_osde original'
FROM crm_obras_sociales WHERE nombre = 'OSDE'
UNION ALL
SELECT id, '2026-05-16'::date, '2026-06-15'::date, 'OSDE 16/05–15/06 (trámite 5805998423)',
       '2026-07-09'::date, 'Cabecera + Factura confirmadas por PDF real'
FROM crm_obras_sociales WHERE nombre = 'OSDE'
UNION ALL
SELECT id, '2026-06-16'::date, '2026-07-15'::date, 'OSDE 16/06–15/07 (trámite 5806107471)',
       '2026-08-09'::date, 'Cabecera confirmada por PDF — factura AÚN NO emitida'
FROM crm_obras_sociales WHERE nombre = 'OSDE'
ON CONFLICT (obra_social_id, fecha_desde, fecha_hasta) DO NOTHING;

-- ───────────────────────────────────────────────────────────
-- 4. Período MEDIFE junio
-- ───────────────────────────────────────────────────────────
INSERT INTO crm_periodos_liquidacion (obra_social_id, fecha_desde, fecha_hasta, etiqueta, fecha_cobro_estimada, notas)
SELECT id, '2026-06-01'::date, '2026-06-30'::date, 'MEDIFE Junio 2026', '2026-08-14'::date, 'Factura 0003-00000093'
FROM crm_obras_sociales WHERE nombre = 'MEDIFE'
ON CONFLICT (obra_social_id, fecha_desde, fecha_hasta) DO NOTHING;

-- ───────────────────────────────────────────────────────────
-- 5. Documentos — Cabeceras + Detalles (sin línea por línea todavía)
-- ───────────────────────────────────────────────────────────
INSERT INTO crm_documentos_liquidacion (periodo_id, tipo, datos_extraidos, notas)
SELECT p.id, 'cabecera',
  '{"tramite":"5805998423","importe_exento":10280693.17,"importe_gravado":6169998.12,"iva":647849.79,"total":17098541.08,"cant_prestaciones_presentadas":1138}'::jsonb,
  'PDF real cargado 18/07/2026'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2026-05-16'
UNION ALL
SELECT p.id, 'detalle_movimiento',
  '{"tramite":"5805998423","cant_lineas":1138,"pendiente_carga_linea_por_linea":true}'::jsonb,
  'PDF real de 142 páginas — detalle línea por línea pendiente del parser automático'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2026-05-16'
UNION ALL
SELECT p.id, 'cabecera',
  '{"tramite":"5806107471","importe_exento":10049030.43,"importe_gravado":5731442.08,"iva":601801.43,"total":16382273.94,"cant_prestaciones_presentadas":1075}'::jsonb,
  'PDF real cargado 18/07/2026'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2026-06-16'
UNION ALL
SELECT p.id, 'detalle_movimiento',
  '{"tramite":"5806107471","cant_lineas":1075,"pendiente_carga_linea_por_linea":true}'::jsonb,
  'PDF real de 142 páginas — detalle línea por línea pendiente del parser automático'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2026-06-16';

-- ───────────────────────────────────────────────────────────
-- 6. Facturas emitidas
-- ───────────────────────────────────────────────────────────
INSERT INTO crm_facturas (periodo_id, numero, fecha_emision, importe_exento, importe_gravado, iva, importe_total, detalle, notas)
SELECT p.id, '0003-00000075', '2026-07-02'::date, 10280693.17, 6169998.12, 647849.80, 17098541.09,
  '{"afiliados_obligatorios_exento":10280693.17,"afiliados_directos_gravado":6169998.12}'::jsonb,
  'Trámite 5805998423 — emitida un mes después de lo que hubiera correspondido, corrimiento de IVA de un mes'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2026-05-16'
UNION ALL
SELECT p.id, '0003-00000093', '2026-07-05'::date, 283475.00, 195500.00, 20527.50, 499502.50,
  '{"pacientes_obligatorios":29,"pacientes_directos":20,"precio_unitario":9775}'::jsonb,
  'Período 01/06 al 30/06/2026'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'MEDIFE' AND p.fecha_desde = '2026-06-01';

-- Nota: el trámite 5805582132 (feb) y su factura ya migrada en Fase 1a original
-- no se repiten acá para no duplicar — si hace falta cargar su factura real
-- (no distinguida en su momento de la cabecera), se agrega en una pasada aparte.

-- ───────────────────────────────────────────────────────────
-- Verificación
-- ───────────────────────────────────────────────────────────
SELECT * FROM crm_periodos_estado ORDER BY fecha_desde;
