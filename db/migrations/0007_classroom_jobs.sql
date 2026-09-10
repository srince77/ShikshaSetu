-- Async classroom-generation jobs: submit + poll, since a full topic-to-
-- course generation run (outline + every scene's content + actions) can
-- exceed a single Vercel serverless function's request/response window.
-- POST /api/generate-classroom creates a row and returns its id immediately;
-- GET /api/generate-classroom/[jobId] polls this row for progress/result.

CREATE TABLE IF NOT EXISTS classroom_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  stage_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  step TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  scenes_generated INTEGER NOT NULL DEFAULT 0,
  total_scenes INTEGER,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT classroom_jobs_status_known
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS classroom_jobs_owner_idx ON classroom_jobs (owner_id, created_at);
