-- V7: Project Objects — associate standalone objects directly with projects (ADR-012)
-- Objects created in the IDE build page are linked to their project via this junction.
-- Objects can belong to multiple projects. Cascade-deletes when project or object is removed.
-- Date: 2026-02-18

CREATE TABLE IF NOT EXISTS project_objects (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    object_id  UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    added_at   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (project_id, object_id)
);

CREATE INDEX IF NOT EXISTS idx_project_objects_object ON project_objects(object_id);
