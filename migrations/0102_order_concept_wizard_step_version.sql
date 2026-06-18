-- Task #995: lägg till wizard_step_version på order_concepts.
-- Markerar vilken stegnumrering ett utkast sparades med så att befintliga utkast
-- (version 1 = gamla ordningen: Namn&Kund först, Inpekning på plats 4) kan remappas
-- till den nya ordningen (Inpekning först, Kund eget steg) vid laddning i wizarden.
-- Default 1 => alla befintliga rader behandlas som legacy och remappas; nya/sparade
-- koncept stämplas explicit med aktuell version i klienten.
ALTER TABLE order_concepts
  ADD COLUMN IF NOT EXISTS wizard_step_version INTEGER DEFAULT 1;
