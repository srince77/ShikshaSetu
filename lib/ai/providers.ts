/**
 * AWS Bedrock provider setup.
 *
 * ShikshaSetu's generation pipeline talks to exactly one LLM backend for the
 * MVP: Amazon Bedrock, via the Vercel AI SDK's Bedrock provider. Credentials
 * are resolved through the standard AWS credential chain (env vars, shared
 * config, container/instance roles, ...), not hardcoded.
 */

import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import type { EmbeddingModel, LanguageModel } from 'ai';

function resolveBedrockRegion(): string {
  return (
    process.env.BEDROCK_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    'us-east-1'
  );
}

interface BedrockCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

type BedrockCredentialProvider = () => Promise<BedrockCredentials>;

let bedrockCredentialProviderPromise: Promise<BedrockCredentialProvider> | undefined;

function getBedrockCredentialProvider(): Promise<BedrockCredentialProvider> {
  bedrockCredentialProviderPromise ??= import('@aws-sdk/credential-providers').then(
    ({ fromNodeProviderChain }) => fromNodeProviderChain(),
  );
  return bedrockCredentialProviderPromise;
}

function createBedrockCredentialProvider(): BedrockCredentialProvider {
  return async () => {
    const credentialProvider = await getBedrockCredentialProvider();
    const credentials = await credentialProvider();
    return {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
      expiration: credentials.expiration,
    };
  };
}

let bedrockProvider: ReturnType<typeof createAmazonBedrock> | undefined;

function getBedrockProvider() {
  bedrockProvider ??= createAmazonBedrock({
    region: resolveBedrockRegion(),
    credentialProvider: createBedrockCredentialProvider(),
  });
  return bedrockProvider;
}

/** Resolves the model id to call: explicit arg wins, else BEDROCK_MODEL_ID. */
export function resolveBedrockModelId(modelId?: string): string {
  const id = modelId?.trim() || process.env.BEDROCK_MODEL_ID?.trim();
  if (!id) {
    throw new Error(
      'No Bedrock model id: pass one explicitly or set the BEDROCK_MODEL_ID environment variable',
    );
  }
  return id;
}

/** Resolves a Bedrock LanguageModel instance for use with `ai`'s generateText/streamText. */
export function getModel(modelId?: string): LanguageModel {
  return getBedrockProvider()(resolveBedrockModelId(modelId));
}

/**
 * Resolves a Bedrock embedding model for use with `ai`'s embed/embedMany.
 * Defaults to `amazon.titan-embed-text-v2:0` (1024-dim, matching
 * db/migrations/0008_pgvector_1024.sql) — see lib/generation/rag/embeddings.ts.
 */
export function getEmbeddingModel(modelId: string = 'amazon.titan-embed-text-v2:0'): EmbeddingModel {
  return getBedrockProvider().embedding(modelId);
}
