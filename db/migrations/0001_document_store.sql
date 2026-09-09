-- Course documents: folders, stages (courses), scenes, outlines.

CREATE TABLE IF NOT EXISTS document_folders (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  folder_order DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at DOUBLE PRECISION NOT NULL,
  updated_at DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS document_folders_owner_order_idx
  ON document_folders (owner_id, folder_order, id);

CREATE TABLE IF NOT EXISTS document_stages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  interactive_mode BOOLEAN,
  task_engine_mode BOOLEAN,
  created_at DOUBLE PRECISION NOT NULL,
  updated_at DOUBLE PRECISION NOT NULL,
  owner_id TEXT,
  folder_id TEXT,
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS document_stages_owner_idx
  ON document_stages (owner_id, id) WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS document_stages_owner_folder_idx
  ON document_stages (owner_id, folder_id, id)
  WHERE owner_id IS NOT NULL AND folder_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS document_scenes (
  stage_id TEXT NOT NULL REFERENCES document_stages(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  scene_order DOUBLE PRECISION NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (stage_id, id)
);

CREATE INDEX IF NOT EXISTS document_scenes_stage_order_idx
  ON document_scenes (stage_id, scene_order, id);

CREATE TABLE IF NOT EXISTS document_outlines (
  stage_id TEXT PRIMARY KEY REFERENCES document_stages(id) ON DELETE CASCADE,
  data JSONB NOT NULL
);

-- Per-scene monotonic revision counters, maintained at the DB layer via
-- triggers rather than application code, so every write path (HTTP routes,
-- background jobs, agent tools, manual SQL) keeps them correct with no
-- shared app-level signal required. A client polls/subscribes on these to
-- know which scenes changed without refetching the whole document.
--
-- Lock order: the scene trigger bumps document_stage_revision BEFORE
-- document_scene_revision, matching write order elsewhere. Keep that order
-- in any future code touching both tables, or concurrent writers can
-- deadlock (Postgres error 40P01).
--
-- Batch writers that want to skip the notify (but still bump the revision)
-- run `SET LOCAL suppress_stage_notify = 'on'` inside their transaction.

CREATE TABLE IF NOT EXISTS document_stage_revision (
  stage_id TEXT PRIMARY KEY NOT NULL,
  rev BIGINT DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS document_scene_revision (
  stage_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  rev BIGINT DEFAULT 0 NOT NULL,
  CONSTRAINT document_scene_revision_pkey PRIMARY KEY (stage_id, scene_id)
);

CREATE OR REPLACE FUNCTION bump_scene_revision() RETURNS trigger AS $$
DECLARE
  v_stage_id text;
  v_scene_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_stage_id := OLD.stage_id;
    v_scene_id := OLD.id;
  ELSE
    v_stage_id := NEW.stage_id;
    v_scene_id := NEW.id;
  END IF;
  INSERT INTO document_stage_revision (stage_id, rev)
  VALUES (v_stage_id, 1)
  ON CONFLICT (stage_id) DO UPDATE SET rev = document_stage_revision.rev + 1;
  INSERT INTO document_scene_revision (stage_id, scene_id, rev)
  VALUES (v_stage_id, v_scene_id, 1)
  ON CONFLICT (stage_id, scene_id) DO UPDATE SET rev = document_scene_revision.rev + 1;
  IF coalesce(current_setting('suppress_stage_notify', true), '') <> 'on' THEN
    PERFORM pg_notify('agent_event_wakeup', json_build_object('kind', 'stage', 'stageId', v_stage_id)::text);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bump_stage_revision() RETURNS trigger AS $$
DECLARE
  v_stage_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_stage_id := OLD.id;
  ELSE
    v_stage_id := NEW.id;
  END IF;
  INSERT INTO document_stage_revision (stage_id, rev)
  VALUES (v_stage_id, 1)
  ON CONFLICT (stage_id) DO UPDATE SET rev = document_stage_revision.rev + 1;
  IF coalesce(current_setting('suppress_stage_notify', true), '') <> 'on' THEN
    PERFORM pg_notify('agent_event_wakeup', json_build_object('kind', 'stage', 'stageId', v_stage_id)::text);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scene_revision_trigger ON document_scenes;

CREATE TRIGGER scene_revision_trigger
AFTER INSERT OR UPDATE OR DELETE ON document_scenes
FOR EACH ROW EXECUTE FUNCTION bump_scene_revision();

DROP TRIGGER IF EXISTS stage_revision_trigger ON document_stages;

CREATE TRIGGER stage_revision_trigger
AFTER INSERT OR UPDATE OR DELETE ON document_stages
FOR EACH ROW EXECUTE FUNCTION bump_stage_revision();
