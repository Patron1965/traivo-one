-- Prioritets-override per personlig uppgift (finplaneringens överlapp). NULL = härled från
-- tidskod-registret via timeCategory. Sätts explicit för att höja en egentid (t.ex. läkarbesök)
-- till prio 1 så den beter sig som ett jobb. Idempotent och säker att replaya.
-- Se shared/schema.ts personalTasks.priority.

ALTER TABLE personal_tasks ADD COLUMN IF NOT EXISTS priority integer;
