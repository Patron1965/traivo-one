-- Task #956: Metadata-editor ("Metadata Lämnare") — publika insamlingsformulär.
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS så re-körning är säker.

CREATE TABLE IF NOT EXISTS metadata_editors (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  name varchar(150) NOT NULL,
  description text,
  type text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  reporter_config jsonb NOT NULL,
  nearby_radius_m integer NOT NULL DEFAULT 300,
  created_at timestamp NOT NULL DEFAULT now(),
  created_by varchar REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_metadata_editors_tenant ON metadata_editors (tenant_id);

CREATE TABLE IF NOT EXISTS metadata_editor_fields (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  editor_id varchar NOT NULL REFERENCES metadata_editors(id) ON DELETE CASCADE,
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  sort_order integer NOT NULL DEFAULT 0,
  kind text NOT NULL,
  label varchar(200) NOT NULL,
  help_text text,
  required boolean NOT NULL DEFAULT false,
  metadata_katalog_id varchar REFERENCES metadata_katalog(id) ON DELETE SET NULL,
  field_config jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_metadata_editor_fields_editor ON metadata_editor_fields (editor_id);
CREATE INDEX IF NOT EXISTS idx_metadata_editor_fields_tenant ON metadata_editor_fields (tenant_id);

CREATE TABLE IF NOT EXISTS metadata_editor_submissions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  editor_id varchar NOT NULL REFERENCES metadata_editors(id) ON DELETE CASCADE,
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  object_id varchar REFERENCES objects(id),
  status text NOT NULL DEFAULT 'pending',
  reporter_name text,
  reporter_title text,
  reporter_organization text,
  reporter_email text,
  reporter_phone text,
  latitude real,
  longitude real,
  ip_address text,
  user_agent text,
  created_interim_object boolean NOT NULL DEFAULT false,
  submitted_at timestamp NOT NULL DEFAULT now(),
  reviewed_by varchar REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamp,
  review_notes text
);
CREATE INDEX IF NOT EXISTS idx_metadata_editor_submissions_tenant_status ON metadata_editor_submissions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_metadata_editor_submissions_editor ON metadata_editor_submissions (editor_id);
CREATE INDEX IF NOT EXISTS idx_metadata_editor_submissions_object ON metadata_editor_submissions (object_id);

CREATE TABLE IF NOT EXISTS metadata_editor_submission_values (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id varchar NOT NULL REFERENCES metadata_editor_submissions(id) ON DELETE CASCADE,
  field_id varchar REFERENCES metadata_editor_fields(id) ON DELETE SET NULL,
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  metadata_katalog_id varchar,
  value_json jsonb,
  photo_paths text[],
  written_metadata_value_id varchar,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_metadata_editor_submission_values_submission ON metadata_editor_submission_values (submission_id);
CREATE INDEX IF NOT EXISTS idx_metadata_editor_submission_values_tenant ON metadata_editor_submission_values (tenant_id);
