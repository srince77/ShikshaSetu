/**
 * AI SDK Adapter for LangGraph
 *
 * Provides a LangChain-compatible `BaseChatModel` shim so LangGraph nodes can
 * call an LLM through the AI SDK, backed by this platform's trimmed,
 * Bedrock-only `callLLM` / `streamLLM` (lib/ai/llm.ts) rather than the
 * reference implementation's multi-provider layer.
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { ChatResult } from '@langchain/core/outputs';
import type { LanguageModel } from 'ai';

import { callLLM, streamLLM } from '@/lib/ai/llm';

/**
 * Stream chunk types for streaming generation
 */
export type StreamChunk =
  | { type: 'delta'; content: string }
  | { type: 'done'; content: string };

/**
 * Adapter to use a Bedrock `LanguageModel` instance (from `getModel()`) with
 * LangGraph.
 */
export class AISdkLangGraphAdapter extends BaseChatModel {
  private languageModel: LanguageModel;

  constructor(languageModel: LanguageModel) {
    super({});
    this.languageModel = languageModel;
  }

  _llmType(): string {
    return 'ai-sdk-bedrock';
  }

  _combineLLMOutput() {
    return {};
  }

  /**
   * Convert LangChain messages to AI SDK message format
   */
  private convertMessages(
    messages: BaseMessage[],
  ): { role: 'system' | 'user' | 'assistant'; content: string }[] {
    return messages.map((msg) => {
      if (msg instanceof HumanMessage) {
        return { role: 'user' as const, content: msg.content as string };
      } else if (msg instanceof AIMessage) {
        return { role: 'assistant' as const, content: msg.content as string };
      } else if (msg instanceof SystemMessage) {
        return { role: 'system' as const, content: msg.content as string };
      } else {
        return { role: 'user' as const, content: msg.content as string };
      }
    });
  }

  async _generate(
    messages: BaseMessage[],
    _options?: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const aiMessages = this.convertMessages(messages);

    const result = await callLLM(
      {
        model: this.languageModel,
        messages: aiMessages,
      },
      'chat-adapter',
    );

    const content = result.text || '';
    const aiMessage = new AIMessage({ content });

    return {
      generations: [
        {
          text: content,
          message: aiMessage,
        },
      ],
      llmOutput: {},
    };
  }

  /**
   * Stream generate with text deltas.
   *
   * Yields chunks of text as they arrive, then yields done with full content.
   * Uses streamLLM which goes through the AI SDK's streamText.
   */
  async *streamGenerate(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<StreamChunk> {
    const aiMessages = this.convertMessages(messages);

    const result = streamLLM(
      {
        model: this.languageModel,
        messages: aiMessages,
        abortSignal: options?.signal,
      },
      'chat-adapter-stream',
    );

    let fullContent = '';

    for await (const chunk of result.textStream) {
      if (chunk) {
        fullContent += chunk;
        yield { type: 'delta', content: chunk };
      }
    }

    yield { type: 'done', content: fullContent };
  }
}
