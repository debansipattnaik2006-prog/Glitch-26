CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), student_name TEXT NOT NULL,
  roll_number TEXT NOT NULL UNIQUE, academic_year TEXT NOT NULL CHECK (academic_year IN ('1st Year','2nd Year','3rd Year')),
  department TEXT NOT NULL DEFAULT 'ITM', contact_number TEXT,
  pass_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  registration_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entry_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (entry_status IN ('PENDING','USED')),
  verified_at TIMESTAMPTZ, verified_by UUID REFERENCES admins(id)
);
CREATE INDEX IF NOT EXISTS registrations_name_idx ON registrations (LOWER(student_name));
CREATE INDEX IF NOT EXISTS registrations_year_idx ON registrations (academic_year);
