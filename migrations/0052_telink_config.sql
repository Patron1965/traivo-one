-- Task #582: Telink-integrationskonfiguration (per tenant).
-- Separat tabell istället för tenant.settings JSON — så apiKey aldrig
-- exponeras via bredare settings-läsningar, loggar eller debug-utskrifter.
CREATE TABLE IF NOT EXISTS telink_config (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL UNIQUE REFERENCES tenants(id),
  enabled boolean NOT NULL DEFAULT false,
  base_url text NOT NULL DEFAULT '',
  api_key text NOT NULL DEFAULT '',
  contact_name_field_key varchar(100) NOT NULL DEFAULT 'kontakt_namn',
  contact_phone_field_key varchar(100) NOT NULL DEFAULT 'kontakt_telefon',
  last_sync_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
