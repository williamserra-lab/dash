-- db/migrations/20260121_0002_add_specialty_to_attendants.sql
-- Add specialty/title (função) to attendants (ex.: manicure, cabeleireiro, esteticista).
-- Idempotent via IF NOT EXISTS.

ALTER TABLE nextia_attendants
  ADD COLUMN IF NOT EXISTS specialty TEXT NULL;
