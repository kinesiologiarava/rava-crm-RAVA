-- ============================================================
-- Agrega obra_social_id a crm_cobros (para poder taggear cobros
-- que no tienen período, como Particular) y carga los dos meses
-- de Tuturno ya confirmados (julio y junio 2026).
-- Ejecutar en Supabase SQL Editor
-- ============================================================

ALTER TABLE crm_cobros ADD COLUMN IF NOT EXISTS obra_social_id TEXT REFERENCES crm_obras_sociales(id);

INSERT INTO crm_cobros (periodo_id, obra_social_id, fecha, importe, origen, notas)
SELECT NULL, id, '2026-07-31'::date, 1857500,
  'tuturno', 'Informe de caja Tuturno — Ingresos de julio 2026 (Cobro por turnos). Sin desglose por medio de pago todavía.'
FROM crm_obras_sociales WHERE nombre = 'PARTICULAR'
UNION ALL
SELECT NULL, id, '2026-06-30'::date, 3695000,
  'tuturno', 'Informe de caja Tuturno — Ingresos de junio 2026 (Cobro por turnos + no asistieron $17.500). Sin desglose por medio de pago todavía.'
FROM crm_obras_sociales WHERE nombre = 'PARTICULAR';

-- Verificación
SELECT c.fecha, c.importe, c.origen, o.nombre AS obra_social, c.notas
FROM crm_cobros c JOIN crm_obras_sociales o ON o.id = c.obra_social_id
ORDER BY c.fecha;
