-- Add a JSONB settings column to projects for UI state persistence
-- (e.g. synoptic view node positions, user preferences per project).
ALTER TABLE projects ADD COLUMN settings JSONB NOT NULL DEFAULT '{}'::jsonb;
