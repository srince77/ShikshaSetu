/**
 * pgvector-backed retrieval over uploaded study material.
 *
 * New in this platform (no reference-repo precedent): chunk uploaded
 * material, embed each chunk with a Bedrock embedding model, and store it in
 * the `material_embeddings` table (db/migrations/0006_pgvector.sql,
 * narrowed to 1024 dimensions by 0008_pgvector_1024.sql), then retrieve the
 * chunks most relevant to a generation prompt by cosine similarity.
 *
 * Embedding model: this platform's primary LLM provider is Bedrock, so
 * embeddings stay on Bedrock too rather than adding a second AI provider.
 * `amazon.titan-embed-text-v1` (Bedrock's one 1536-dim model) is not
 * enabled on the account this was built against (verified live — it 404s
 * as an invalid model identifier); `amazon.titan-embed-text-v2:0` is, and
 * produces 1024-dim vectors, which is what the table is now sized for.
 */

import { embed, embedMany } from 'ai';
import { nanoid } from 'nanoid';
import { getEmbeddingModel } from '@/lib/ai/providers';
import { getPool } from '@/db/client';

export const EMBEDDING_DIMENSIONS = 1024;

const DEFAULT_CHUNK_CHARS = 1200;
const DEFAULT_CHUNK_OVERLAP_CHARS = 150;

/**
 * Split text into overlapping chunks, breaking on paragraph boundaries where
 * possible so a chunk doesn't cut a sentence in half more often than
 * necessary. Simple and dependency-free — good enough for lesson material
 * (a few pages of text), not tuned for book-length documents.
 */
export function chunkText(
  text: string,
  options: { chunkChars?: number; overlapChars?: number } = {},
): string[] {
  const chunkChars = options.chunkChars ?? DEFAULT_CHUNK_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_CHUNK_OVERLAP_CHARS;

  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (normalized.length <= chunkChars) return [normalized];

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length + 2 <= chunkChars) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }

    if (paragraph.length > chunkChars) {
      // A single paragraph longer than the chunk size: hard-split it, still
      // carrying the running overlap tail forward.
      flush();
      for (let i = 0; i < paragraph.length; i += chunkChars - overlapChars) {
        chunks.push(paragraph.slice(i, i + chunkChars));
      }
      continue;
    }

    flush();
    const overlapTail = current.slice(-overlapChars);
    current = overlapTail ? `${overlapTail}\n\n${paragraph}` : paragraph;
  }
  flush();

  return chunks;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export interface IngestMaterialInput {
  ownerId: string;
  stageId?: string;
  sourceName: string;
  text: string;
}

export interface IngestMaterialResult {
  chunksInserted: number;
}

/** Chunk, embed, and store one uploaded document's text for later retrieval. */
export async function ingestMaterial(input: IngestMaterialInput): Promise<IngestMaterialResult> {
  const chunks = chunkText(input.text);
  if (chunks.length === 0) return { chunksInserted: 0 };

  const model = getEmbeddingModel();
  const { embeddings } = await embedMany({ model, values: chunks });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        `INSERT INTO material_embeddings (id, owner_id, stage_id, source_name, chunk_index, chunk_text, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
        [
          nanoid(),
          input.ownerId,
          input.stageId ?? null,
          input.sourceName,
          i,
          chunks[i],
          toVectorLiteral(embeddings[i]),
        ],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { chunksInserted: chunks.length };
}

export interface RetrievedChunk {
  sourceName: string | null;
  chunkIndex: number;
  chunkText: string;
  similarity: number;
}

export interface RetrieveRelevantChunksInput {
  ownerId: string;
  /** Scope retrieval to one stage's uploaded material; omit to search everything the owner has ingested. */
  stageId?: string;
  query: string;
  limit?: number;
}

/**
 * Embed `query` and return the most similar stored chunks (cosine
 * similarity, pgvector's `<=>` cosine-distance operator), scoped to the
 * owner and optionally one stage.
 */
export async function retrieveRelevantChunks(
  input: RetrieveRelevantChunksInput,
): Promise<RetrievedChunk[]> {
  const limit = input.limit ?? 5;
  const model = getEmbeddingModel();
  const { embedding } = await embed({ model, value: input.query });
  const vectorLiteral = toVectorLiteral(embedding);

  const pool = getPool();
  const result = input.stageId
    ? await pool.query(
        `SELECT source_name, chunk_index, chunk_text, 1 - (embedding <=> $1::vector) AS similarity
         FROM material_embeddings
         WHERE owner_id = $2 AND stage_id = $3
         ORDER BY embedding <=> $1::vector
         LIMIT $4`,
        [vectorLiteral, input.ownerId, input.stageId, limit],
      )
    : await pool.query(
        `SELECT source_name, chunk_index, chunk_text, 1 - (embedding <=> $1::vector) AS similarity
         FROM material_embeddings
         WHERE owner_id = $2
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
        [vectorLiteral, input.ownerId, limit],
      );

  return result.rows.map((row) => ({
    sourceName: row.source_name,
    chunkIndex: row.chunk_index,
    chunkText: row.chunk_text,
    similarity: Number(row.similarity),
  }));
}

/** Delete all stored chunks for one stage (e.g. when its source material is replaced). */
export async function deleteMaterialForStage(stageId: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM material_embeddings WHERE stage_id = $1', [stageId]);
}
