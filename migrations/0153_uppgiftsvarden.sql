-- Task #131: add-only, nullable för full legacykompatibilitet.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS uppgiftsvarden jsonb;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS uppgiftsvarden jsonb;

ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS frozen_quantity real;
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS frozen_time_minutes integer;
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS frozen_value_ore integer;
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS billable_quantity real;
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS billable_time_minutes integer;
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS billable_value_ore integer;
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS actual_quantity integer;
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS actual_time_minutes integer;
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS actual_value_ore integer;

-- Expand-contract: stoppa nya negativa antal utan att migrationen faller på
-- eventuell historisk legacydata. Validering kan göras separat efter sanering.
ALTER TABLE work_order_lines
  ADD CONSTRAINT work_order_lines_quantity_non_negative
  CHECK (quantity >= 0) NOT VALID;
ALTER TABLE assignment_articles
  ADD CONSTRAINT assignment_articles_quantity_non_negative
  CHECK (quantity >= 0) NOT VALID;