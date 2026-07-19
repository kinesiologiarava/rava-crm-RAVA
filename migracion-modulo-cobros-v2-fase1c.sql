-- ============================================================
-- MÓDULO COBROS v2 — FASE 1c: resto del año OSDE (real, verificado por PDF)
-- Ejecutar en Supabase SQL Editor, DESPUÉS de fase 1a y 1b.
-- Agrega 2 trámites nuevos (enero, marzo) y CORRIGE los 2 que habían
-- quedado afuera por tener datos corruptos en la tabla vieja
-- (5805780144, 5805882536) — ahora con números reales de su Cabecera.
--
-- Fechas de período: OSDE no las imprime en la Cabecera. Se
-- encadenan de forma aproximada a partir del único período con
-- fechas confirmadas (5805582132). Ver nota en cada fila.
-- ============================================================

INSERT INTO crm_periodos_liquidacion (obra_social_id, fecha_desde, fecha_hasta, etiqueta, fecha_cobro_estimada, notas)
SELECT id, '2025-12-16'::date, '2026-01-14'::date, 'OSDE ~16/12–14/01 (trámite 5805488221)',
       '2026-02-09'::date, 'Fechas de período APROXIMADAS (OSDE no las imprime) — cabecera y factura confirmadas por PDF real'
FROM crm_obras_sociales WHERE nombre = 'OSDE'
UNION ALL
SELECT id, '2026-02-13'::date, '2026-03-14'::date, 'OSDE ~13/02–14/03 (trámite 5805677172)',
       '2026-04-09'::date, 'Fechas de período APROXIMADAS (OSDE no las imprime) — cabecera y factura confirmadas por PDF real'
FROM crm_obras_sociales WHERE nombre = 'OSDE'
UNION ALL
SELECT id, '2026-03-15'::date, '2026-04-19'::date, 'OSDE ~15/03–19/04 (trámite 5805780144)',
       '2026-05-09'::date, 'Fechas de período APROXIMADAS — CORRIGE datos corruptos de la migración vieja, ahora con Cabecera PDF real'
FROM crm_obras_sociales WHERE nombre = 'OSDE'
UNION ALL
SELECT id, '2026-04-20'::date, '2026-05-19'::date, 'OSDE ~20/04–19/05 (trámite 5805882536)',
       '2026-06-09'::date, 'Fechas de período APROXIMADAS — CORRIGE datos corruptos de la migración vieja, ahora con Cabecera PDF real'
FROM crm_obras_sociales WHERE nombre = 'OSDE'
ON CONFLICT (obra_social_id, fecha_desde, fecha_hasta) DO NOTHING;

-- ───────────────────────────────────────────────────────────
-- Documentos (cabecera + registro de que existe el detalle)
-- ───────────────────────────────────────────────────────────
INSERT INTO crm_documentos_liquidacion (periodo_id, tipo, datos_extraidos, notas)
SELECT p.id, 'cabecera',
  '{"tramite":"5805488221","importe_exento":6548677.44,"importe_gravado":3635793.18,"iva":381758.31,"total":10566228.93,"cant_prestaciones_presentadas":765}'::jsonb,
  'PDF real cargado'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2025-12-16'
UNION ALL
SELECT p.id, 'detalle_movimiento', '{"tramite":"5805488221","pendiente_carga_linea_por_linea":true}'::jsonb, 'PDF real cargado, sin parsear línea por línea todavía'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2025-12-16'
UNION ALL
SELECT p.id, 'cabecera',
  '{"tramite":"5805677172","importe_exento":7269641.14,"importe_gravado":5282591.06,"iva":554672.04,"total":13106904.24,"cant_prestaciones_presentadas":921}'::jsonb,
  'PDF real cargado'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2026-02-13'
UNION ALL
SELECT p.id, 'detalle_movimiento', '{"tramite":"5805677172","pendiente_carga_linea_por_linea":true}'::jsonb, 'PDF real cargado, sin parsear línea por línea todavía'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2026-02-13'
UNION ALL
SELECT p.id, 'cabecera',
  '{"tramite":"5805780144","importe_exento":8064977.17,"importe_gravado":6715828.78,"iva":705162.03,"total":15485967.98,"cant_prestaciones_presentadas":1055}'::jsonb,
  'PDF real cargado — reemplaza los datos corruptos de la migración anterior'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2026-03-15'
UNION ALL
SELECT p.id, 'detalle_movimiento', '{"tramite":"5805780144","pendiente_carga_linea_por_linea":true}'::jsonb, 'PDF real cargado, sin parsear línea por línea todavía'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2026-03-15'
UNION ALL
SELECT p.id, 'cabecera',
  '{"tramite":"5805882536","importe_exento":9465875.73,"importe_gravado":6860903.67,"iva":720394.89,"total":17047174.29,"cant_prestaciones_presentadas":1169}'::jsonb,
  'PDF real cargado — reemplaza los datos corruptos de la migración anterior'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2026-04-20'
UNION ALL
SELECT p.id, 'detalle_movimiento', '{"tramite":"5805882536","pendiente_carga_linea_por_linea":true}'::jsonb, 'PDF real cargado, sin parsear línea por línea todavía'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2026-04-20';

-- ───────────────────────────────────────────────────────────
-- Facturas — armadas directo con los números de la Cabecera
-- (número real y fecha de emisión: completar cuando se confirmen)
-- ───────────────────────────────────────────────────────────
INSERT INTO crm_facturas (periodo_id, numero, fecha_emision, importe_exento, importe_gravado, iva, importe_total, notas)
SELECT p.id, NULL::text, NULL::date, 6548677.44, 3635793.18, 381758.31, 10566228.93,
  'Importes tomados de la Cabecera (trámite 5805488221) — falta número de factura real y fecha de emisión'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2025-12-16'
UNION ALL
SELECT p.id, NULL::text, NULL::date, 7269641.14, 5282591.06, 554672.04, 13106904.24,
  'Importes tomados de la Cabecera (trámite 5805677172) — falta número de factura real y fecha de emisión'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2026-02-13'
UNION ALL
SELECT p.id, NULL::text, NULL::date, 8064977.17, 6715828.78, 705162.03, 15485967.98,
  'Importes tomados de la Cabecera (trámite 5805780144) — falta número de factura real y fecha de emisión'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2026-03-15'
UNION ALL
SELECT p.id, NULL::text, NULL::date, 9465875.73, 6860903.67, 720394.89, 17047174.29,
  'Importes tomados de la Cabecera (trámite 5805882536) — falta número de factura real y fecha de emisión'
FROM crm_periodos_liquidacion p JOIN crm_obras_sociales o ON o.id = p.obra_social_id
WHERE o.nombre = 'OSDE' AND p.fecha_desde = '2026-04-20';

-- ───────────────────────────────────────────────────────────
-- Verificación
-- ───────────────────────────────────────────────────────────
SELECT * FROM crm_periodos_estado ORDER BY fecha_desde;
