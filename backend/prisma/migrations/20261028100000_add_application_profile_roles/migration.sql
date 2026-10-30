ALTER TABLE application_profile
  ADD COLUMN roles "ApplicationRole"[] NOT NULL DEFAULT ARRAY['CUSTOMER']::"ApplicationRole"[];

UPDATE application_profile
SET roles = ARRAY[role];
