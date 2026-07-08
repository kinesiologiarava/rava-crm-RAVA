-- ============================================================
-- MIGRACIÓN: crear tabla crm_cobros_medife
-- Ejecutar en Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_cobros_medife (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  fact_nro                TEXT NOT NULL,            -- "FC N° 86"
  fecha_emision           TEXT,                     -- "09/01/2026"
  periodo_desde           TEXT,                     -- "01/12/2025"
  periodo_hasta           TEXT,                     -- "31/12/2025"
  mes_impacto             TEXT NOT NULL,            -- "2026-01"
  pacientes_obligatorios  INTEGER DEFAULT 0,
  pacientes_directos      INTEGER DEFAULT 0,
  total_pacientes         INTEGER DEFAULT 0,
  precio_unitario         NUMERIC DEFAULT 0,
  importe_exento          NUMERIC DEFAULT 0,
  importe_gravado         NUMERIC DEFAULT 0,
  iva                     NUMERIC DEFAULT 0,
  total_con_iva           NUMERIC DEFAULT 0,
  notas                   TEXT DEFAULT '',
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Cargar el cobro inicial de diciembre 2025 (que estaba hardcodeado)
INSERT INTO crm_cobros_medife (
  id, fact_nro, fecha_emision, periodo_desde, periodo_hasta, mes_impacto,
  pacientes_obligatorios, pacientes_directos, total_pacientes,
  precio_unitario, importe_exento, importe_gravado, iva, total_con_iva, notas
) VALUES (
  'med1-migrado',
  'FC N° 85', '09/12/2025', '01/11/2025', '30/11/2025', '2025-12',
  9, 24, 33,
  8752, 78768, 210048, 22055.04, 310871.04,
  'Pacientes noviembre 2025 — facturado diciembre'
) ON CONFLICT (id) DO NOTHING;

-- Verificar
SELECT * FROM crm_cobros_medife ORDER BY mes_impacto DESC;
