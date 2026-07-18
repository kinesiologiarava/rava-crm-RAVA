-- ============================================================
-- PAGOS REALES A PROFESIONALES
-- Ejecutar en Supabase SQL Editor
-- Tabla nueva, no toca nada existente.
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_pagos_profesionales (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  mes               TEXT NOT NULL,          -- "2026-06" — mes que se está liquidando
  profesional       TEXT NOT NULL,
  importe_calculado NUMERIC NOT NULL,       -- foto del cálculo (sesiones x precio) al cerrar la liquidación
  ajuste            NUMERIC DEFAULT 0,      -- +/- , ej: -100000 por un préstamo descontado
  motivo_ajuste     TEXT DEFAULT '',
  importe_pagado    NUMERIC,                -- null = calculado pero todavía no transferido
  fecha_pago        DATE,
  notas             TEXT DEFAULT '',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (mes, profesional)
);

-- Estado calculado, no elegido a mano (mismo criterio que crm_periodos_estado)
CREATE OR REPLACE VIEW crm_pagos_profesionales_estado AS
SELECT *,
  (importe_calculado + COALESCE(ajuste,0)) AS importe_a_pagar,
  CASE WHEN importe_pagado IS NULL THEN 'pendiente' ELSE 'pagado' END AS estado
FROM crm_pagos_profesionales;

-- ───────────────────────────────────────────────────────────
-- Datos reales de junio 2026, ya conciliados contra los
-- comprobantes de transferencia de Banco Ciudad
-- ───────────────────────────────────────────────────────────
INSERT INTO crm_pagos_profesionales (mes, profesional, importe_calculado, ajuste, motivo_ajuste, importe_pagado, fecha_pago, notas) VALUES
  ('2026-06', 'ISOLINA',    1656152, -100000, 'Préstamo descontado (venía de meses anteriores)', 1556152, '2026-07-09', 'Comprobante Banco Ciudad op. 00919800'),
  ('2026-06', 'JUAN CRUZ',  1153192, 0, '', 1153192, '2026-07-08', 'Comprobante Banco Ciudad op. 0V1JXON1R760773GNZ64EL'),
  ('2026-06', 'PAULA',      1765800, 0, '', 1765800, '2026-07-08', 'Comprobante Banco Ciudad op. 00918713'),
  ('2026-06', 'FRANCISCO',  1273704, 0, '', 1273704, '2026-07-08', 'Comprobante Banco Ciudad op. Z0KV87947K6DVL4J9PEYDX'),
  ('2026-06', 'MILAGROS',    997624, 0, '', 997624,  '2026-07-08', 'Comprobante Banco Ciudad op. D4RO172VP15MMWGD2KJ3QE')
ON CONFLICT (mes, profesional) DO NOTHING;

-- Verificación
SELECT profesional, importe_calculado, ajuste, importe_a_pagar, importe_pagado, estado
FROM crm_pagos_profesionales_estado
WHERE mes = '2026-06'
ORDER BY profesional;
