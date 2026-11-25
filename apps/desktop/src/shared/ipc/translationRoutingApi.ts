import { invoke } from '@tauri-apps/api/core';
import type { TranslationServiceProvider } from './selectionTranslationApi';

export type TranslationKind = 'word' | 'selection' | 'segment' | 'paragraph' | 'document';
export type TranslationSource = { kind: 'default_model' } | { kind: 'profile'; profile_id: string } | { kind: 'selection_service' } | { kind: 'service'; provider: TranslationServiceProvider };
export type TranslationRouting = Record<TranslationKind, TranslationSource> & { default_source?: TranslationSource; local_dictionary_first: boolean };
export const DEFAULT_TRANSLATION_ROUTING: TranslationRouting = {
  word: { kind: 'selection_service' }, selection: { kind: 'selection_service' },
  segment: { kind: 'default_model' }, paragraph: { kind: 'default_model' }, document: { kind: 'default_model' },
  local_dictionary_first: true,
};
export const getTranslationRouting = () => invoke<TranslationRouting>('get_translation_routing');
export const saveTranslationRouting = (request: TranslationRouting) => invoke<TranslationRouting>('save_translation_routing', { request });

/** Old saved settings keep the legacy model until a default source is chosen. */
export function resolvedTranslationSource(routing: TranslationRouting, kind: TranslationKind): TranslationSource {
  const source = routing[kind];
  return source.kind === "default_model" ? routing.default_source ?? source : source;
}
