-- ============================================================
-- Agrega la columna "pasada_osde" a crm_registros
-- Ejecutar en Supabase SQL Editor
--
-- Sesiones que Susana pasa a mano a OSDE (código llegado después,
-- diferidas, etc.) — OSDE las cobra igual que una sesión normal,
-- pero el consultorio NO le paga honorario al profesional por ellas
-- (a diferencia de "regalo", que sí se paga a tarifa reducida).
--
-- La carga real de estos valores va a venir sincronizada desde
-- Fichas (cuando Susana las marca ahí) — este script solo prepara
-- la columna para recibirlas. No rompe nada existente.
-- ============================================================

ALTER TABLE crm_registros ADD COLUMN IF NOT EXISTS pasada_osde INTEGER DEFAULT 0;

-- Verificación
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'crm_registros'
ORDER BY ordinal_position;
