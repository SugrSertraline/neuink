import { generateText } from 'ai';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { createNeuinkModel } from '../../assistant/sdk/provider';
import { translationModelSettings } from './translationModelSettings';
import { logTranslationFailure } from '@/shared/ipc/translationLogApi';

export async function translateSelectionWithProfile(profile: LlmProfile, input: {
  sourceText: string; word?: string | null; context?: string | null; entryTitle: string;
}, options?: { signal?: AbortSignal; maxRetries?: number }) {
  const { sourceText, word, context, entryTitle } = input;
  const started = performance.now();
  try {
    const result = await generateText({
      ...translationModelSettings(profile), model: createNeuinkModel(profile),
      abortSignal: options?.signal, maxRetries: options?.maxRetries,
      system: word
        ? 'Translate the single English word into concise Simplified Chinese dictionary meanings. Return the meanings only.'
        : ['You are an academic paper translator.', 'Translate the selected text into Simplified Chinese.',
          'Preserve formulas, citations, numbers, abbreviations, code, and technical symbols.',
          'Return the translation only. Do not return JSON, explanations, labels, or markdown fences.'].join('\n'),
      prompt: word ? word : [`Paper title: ${entryTitle}`, context?.trim() ? `Paragraph context:\n${context}` : null,
        `Selected text:\n${sourceText}`].filter(Boolean).join('\n\n')
    });
    if (result.finishReason === 'length') throw new Error('LLM_TRANSLATION_OUTPUT_LIMIT');
    if (result.finishReason === 'content-filter') throw new Error('LLM_TRANSLATION_CONTENT_FILTERED');
    const translatedText = result.text.trim();
    if (!translatedText) {
      if (result.reasoningText?.trim()) throw new Error('LLM_TRANSLATION_REASONING_ONLY');
      throw new Error('翻译模型没有返回可用译文。');
    }
    return translatedText;
  } catch (error) {
    if (!options?.signal?.aborted) await logTranslationFailure(profile, 'selection', error, {
      elapsed_ms: Math.round(performance.now() - started), input_chars: sourceText.length
    });
    throw error;
  }
}
