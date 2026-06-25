-- V14: Drop legacy tables, consolidate into ontology objects/links layer.
-- Fresh start — no data migration needed.

-- Add properties column to objects (stores address, attributes, specs per object type)
ALTER TABLE objects ADD COLUMN IF NOT EXISTS properties JSONB NOT NULL DEFAULT '{}';

-- Redirect site_assignments FK from sites to objects
ALTER TABLE site_assignments DROP CONSTRAINT IF EXISTS site_assignments_site_id_fkey;
ALTER TABLE site_assignments ADD CONSTRAINT site_assignments_site_id_fkey
  FOREIGN KEY (site_id) REFERENCES objects(id);

-- Copy project_sites into project_objects (safety net for existing dev data)
INSERT INTO project_objects (project_id, object_id, added_at)
SELECT ps.project_id, ps.site_id, ps.added_at FROM project_sites ps
WHERE NOT EXISTS (
  SELECT 1 FROM project_objects po
  WHERE po.project_id = ps.project_id AND po.object_id = ps.site_id
);

-- Drop legacy tables (reverse dependency order)
DROP TABLE IF EXISTS project_sites CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS assets CASCADE;
DROP TABLE IF EXISTS spaces CASCADE;
DROP TABLE IF EXISTS sites CASCADE;
