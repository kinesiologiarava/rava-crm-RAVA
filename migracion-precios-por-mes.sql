-- ============================================================
-- MIGRACIÓN: crm_precios — agregar columna mes
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Agregar columna mes (si no existe)
ALTER TABLE crm_precios
  ADD COLUMN IF NOT EXISTS mes TEXT NOT NULL DEFAULT '2026-04';

-- 2. Poblar mes con el mes actual en registros existentes
UPDATE crm_precios SET mes = '2026-04' WHERE mes = '2026-04';

-- 3. Eliminar el índice único anterior (solo en clave) si existe
--    Supabase suele llamarlo crm_precios_clave_key
ALTER TABLE crm_precios DROP CONSTRAINT IF EXISTS crm_precios_clave_key;

-- 4. Crear índice único compuesto en (mes, clave)
ALTER TABLE crm_precios
  ADD CONSTRAINT crm_precios_mes_clave_key UNIQUE (mes, clave);

-- 5. Verificar resultado
SELECT mes, clave, valor, descripcion FROM crm_precios ORDER BY mes, clave;
