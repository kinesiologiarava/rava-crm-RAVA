-- ═══════════════════════════════════════════════════════════
-- CRM KINESIOLOGÍA RAVA — Esquema de tablas
-- Ejecutar en: supabase.com → tu proyecto → SQL Editor
-- ═══════════════════════════════════════════════════════════

-- 1. REGISTROS DE ATENCIÓN
-- Carga diaria de pacientes por profesional y prestación
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_registros (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  mes           TEXT NOT NULL,          -- "2026-03"
  dia           TEXT,                   -- "06/03"
  prof          TEXT NOT NULL,          -- "ISOLINA"
  prestacion    TEXT NOT NULL,          -- "FKT" | "RPG" | "DRENAJE" | etc
  osde          INTEGER DEFAULT 0,
  medife        INTEGER DEFAULT 0,
  particular    INTEGER DEFAULT 0,
  regalo        INTEGER DEFAULT 0,
  notas         TEXT DEFAULT '',
  importado     BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. GASTOS FIJOS
-- Expensas, luz, insumos, sueldo Susana, etc.
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_gastos (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  mes           TEXT NOT NULL,          -- "2026-03"
  categoria     TEXT NOT NULL,          -- "Sueldo Susana" | "Luz" | etc
  monto         BIGINT DEFAULT 0,
  notas         TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TRÁMITES OSDE
-- Cada liquidación que envía OSDE con su número de trámite
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_tramites_osde (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tramite_nro         TEXT NOT NULL,        -- "5805582132"
  fecha_emision       TEXT,                 -- "23/02/2026"
  periodo_desde       TEXT,                 -- "15/01/2026"
  periodo_hasta       TEXT,                 -- "12/02/2026"
  mes_impacto         TEXT NOT NULL,        -- "2026-03"
  -- Desglose por prestación (guardado como JSON)
  prestaciones        JSONB DEFAULT '{}',
  -- Totales cabecera
  importe_gravado     NUMERIC DEFAULT 0,
  importe_exento      NUMERIC DEFAULT 0,
  iva                 NUMERIC DEFAULT 0,
  total_sin_iva       NUMERIC DEFAULT 0,
  total_con_iva       NUMERIC DEFAULT 0,
  cant_prestaciones   INTEGER DEFAULT 0,
  notas               TEXT DEFAULT '',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 4. MOVIMIENTOS DE CAJA
-- Ingresos, gastos, retiros, giros
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_caja (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  fecha         TEXT NOT NULL,          -- "2026-03-06"
  dia           TEXT,                   -- "06/03"
  hora          TEXT,                   -- "13:35"
  tipo          TEXT NOT NULL,          -- "INGRESO" | "GASTO" | "RETIRO" | "GIRO" | "INVERSIÓN"
  concepto      TEXT NOT NULL,
  detalle       TEXT DEFAULT '',
  monto         BIGINT DEFAULT 0,
  cuenta        TEXT DEFAULT 'Efectivo',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ───────────────────────────────────────────────────────────
-- DATOS INICIALES — Febrero 2026 (del Excel v2)
-- ───────────────────────────────────────────────────────────
INSERT INTO crm_registros (mes, prof, prestacion, osde, medife, particular, regalo, notas) VALUES
  ('2026-02', 'ISOLINA',   'FKT', 420, 6,  42, 12, 'Febrero — total mes'),
  ('2026-02', 'DAVID',     'FKT', 126, 14, 3,  5,  'Febrero — total mes'),
  ('2026-02', 'JUAN CRUZ', 'FKT', 173, 9,  2,  4,  'Febrero — total mes'),
  ('2026-02', 'PAULA',     'RPG', 102, 0,  0,  3,  'Febrero — total mes')
ON CONFLICT (id) DO NOTHING;

-- Datos de marzo 2026 (días cargados)
INSERT INTO crm_registros (mes, dia, prof, prestacion, osde, medife, particular, regalo) VALUES
  ('2026-03', '03/03', 'DANIELA',   'DRENAJE',    5,  0, 0, 0),
  ('2026-03', '04/03', 'DANIELA',   'DRENAJE',    2,  0, 0, 0),
  ('2026-03', '04/03', 'DANIELA',   'RPG',        1,  0, 1, 0),
  ('2026-03', '04/03', 'DANIELA',   'OSTEOPATIA', 0,  0, 1, 0),
  ('2026-03', '05/03', 'DANIELA',   'DRENAJE',    3,  0, 0, 0),
  ('2026-03', '05/03', 'DANIELA',   'OSTEOPATIA', 0,  0, 1, 0),
  ('2026-03', '06/03', 'DANIELA',   'DRENAJE',    3,  0, 0, 0),
  ('2026-03', '06/03', 'DANIELA',   'OSTEOPATIA', 0,  0, 1, 0),
  ('2026-03', '02/03', 'ISOLINA',   'FKT',        22, 0, 3, 0),
  ('2026-03', '03/03', 'ISOLINA',   'FKT',        26, 0, 5, 0),
  ('2026-03', '04/03', 'ISOLINA',   'FKT',        22, 1, 3, 0),
  ('2026-03', '05/03', 'ISOLINA',   'FKT',        22, 0, 2, 0),
  ('2026-03', '06/03', 'ISOLINA',   'FKT',        26, 0, 4, 0),
  ('2026-03', '02/03', 'JUAN CRUZ', 'FKT',        20, 3, 2, 0),
  ('2026-03', '04/03', 'JUAN CRUZ', 'FKT',        19, 3, 0, 0),
  ('2026-03', '03/03', 'PAULA',     'RPG',        6,  0, 0, 0),
  ('2026-03', '04/03', 'PAULA',     'RPG',        7,  0, 0, 0),
  ('2026-03', '05/03', 'PAULA',     'RPG',        7,  0, 0, 0),
  ('2026-03', '03/03', 'FRANCISCO', 'FKT',        11, 0, 2, 0),
  ('2026-03', '05/03', 'FRANCISCO', 'FKT',        9,  1, 2, 0)
ON CONFLICT (id) DO NOTHING;

-- Sueldo Susana febrero
INSERT INTO crm_gastos (mes, categoria, monto, notas) VALUES
  ('2026-02', 'Sueldo Susana', 800000, 'Pago en marzo')
ON CONFLICT (id) DO NOTHING;

-- Trámite OSDE cargado del PDF
INSERT INTO crm_tramites_osde (
  tramite_nro, fecha_emision, periodo_desde, periodo_hasta, mes_impacto,
  prestaciones, importe_gravado, importe_exento, iva, total_sin_iva, total_con_iva, cant_prestaciones, notas
) VALUES (
  '5805582132', '23/02/2026', '15/01/2026', '12/02/2026', '2026-03',
  '{"FKT":{"visitas":817,"liquidado":9555729.19},"RPG":{"visitas":121,"liquidado":2847538.00},"DRENAJE":{"visitas":50,"liquidado":1016364.81}}',
  5945294.00, 7474338.02, 624255.86, 13419632.17, 14043887.88, 1005,
  'Cargado desde PDF OSDE — pago marzo 2026'
) ON CONFLICT (id) DO NOTHING;

-- ───────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY (RLS) — acceso solo autenticado
-- Activar si usás Supabase Auth. Por ahora desactivado para
-- acceso directo con anon key desde la app.
-- ───────────────────────────────────────────────────────────
-- ALTER TABLE crm_registros    ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE crm_gastos       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE crm_tramites_osde ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE crm_caja         ENABLE ROW LEVEL SECURITY;
