-- 0006_pgvector.sql sized `material_embeddings.embedding` for a 1536-dim
-- model (OpenAI's text-embedding-3-small convention). This project's
-- primary LLM provider is AWS Bedrock, and the Bedrock embedding models
-- actually enabled on this account/region (verified live) are
-- `amazon.titan-embed-text-v2:0` and the `cohere.embed-*-v3` family, which
-- all produce 1024-dim vectors — `amazon.titan-embed-text-v1` (the one
-- Bedrock model that natively outputs 1536) is not available here.
--
-- The table was still empty (migration 0006 landed as schema scaffolding
-- ahead of the embeddings helper), so this narrows the column in place
-- rather than carrying a permanent dimension mismatch forward.

ALTER TABLE material_embeddings
  ALTER COLUMN embedding TYPE VECTOR(1024);
