-- Retrieval over uploaded study material, for the generation pipeline's RAG
-- step. Neon supports pgvector natively.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS material_embeddings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  stage_id TEXT REFERENCES document_stages(id) ON DELETE CASCADE,
  source_name TEXT,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS material_embeddings_owner_idx ON material_embeddings (owner_id);
CREATE INDEX IF NOT EXISTS material_embeddings_stage_idx ON material_embeddings (stage_id);
