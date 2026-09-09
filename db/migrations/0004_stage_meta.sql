-- Companion table holding a course's ownership, publish state, and
-- soft-delete (tombstone, not delete) status. Kept separate from
-- document_stages so that table's own DDL stays untouched by
-- ownership/access-control concerns.

CREATE TABLE IF NOT EXISTS stage_meta (
  stage_id TEXT PRIMARY KEY REFERENCES document_stages(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT false,
  published_at DOUBLE PRECISION,
  generation_complete BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS stage_meta_owner_idx ON stage_meta (owner_id, stage_id);

CREATE INDEX IF NOT EXISTS stage_meta_public_live_idx
  ON stage_meta (stage_id) WHERE is_public AND deleted_at IS NULL;
