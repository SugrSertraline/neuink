import { invoke } from '@tauri-apps/api/core';

export type TranslationKind = 'word' | 'selection' | 'segment' | 'paragraph' | 'document';
export type TranslationSource = { kind: 'default_model' } | { kind: 'profile'; profile_id: string } | { kind: 'selection_service' };
export type TranslationRouting = Record<TranslationKind, TranslationSource> & { local_dictionary_first: boolean };
export const DEFAULT_TRANSLATION_ROUTING: TranslationRouting = {
  word: { kind: 'selection_service' }, selection: { kind: 'selection_service' },
  segment: { kind: 'default_model' }, paragraph: { kind: 'default_model' }, document: { kind: 'default_model' },
  local_dictionary_first: true,
};
export const getTranslationRouting = () => invoke<TranslationRouting>('get_translation_routing');
export const saveTranslationRouting = (request: TranslationRouting) => invoke<TranslationRouting>('save_translation_routing', { request });
