-- Å6: DB-nivå skydd mot cirkulär objekthierarki (defense-in-depth).
-- App-vakten finns redan (server/storage createObject/moveObject), men en trigger
-- garanterar invarianten även för raw SQL, importer och framtida kodvägar.
-- Vaktar legacy primärkedjan objects.parent_id (speglar primär förälder i
-- object_parents). Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION traivo_check_object_cycle() RETURNS trigger AS $$
DECLARE
  cur varchar;
  steps int := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Cirkulär objekthierarki: objekt % kan inte vara sin egen förälder', NEW.id;
  END IF;
  cur := NEW.parent_id;
  WHILE cur IS NOT NULL LOOP
    steps := steps + 1;
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'Cirkulär objekthierarki upptäckt: objekt % skulle bli sin egen förfader', NEW.id;
    END IF;
    IF steps > 10000 THEN
      RAISE EXCEPTION 'Objekthierarki för djup eller cyklisk (objekt %)', NEW.id;
    END IF;
    SELECT parent_id INTO cur FROM objects WHERE id = cur;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_object_cycle_guard ON objects;
CREATE TRIGGER trg_object_cycle_guard
  BEFORE INSERT OR UPDATE OF parent_id ON objects
  FOR EACH ROW EXECUTE FUNCTION traivo_check_object_cycle();
