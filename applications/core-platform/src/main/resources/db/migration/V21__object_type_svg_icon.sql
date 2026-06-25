-- Add svg_icon_url column to object_types for storing GCS-hosted SVG icons
-- Used by the synoptic view to render custom P&ID-style node graphics
ALTER TABLE object_types ADD COLUMN IF NOT EXISTS svg_icon_url TEXT;

COMMENT ON COLUMN object_types.svg_icon_url IS 'GCS URL of AI-generated SVG icon for synoptic/SCADA view';
