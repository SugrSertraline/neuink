import { invoke } from '@tauri-apps/api/core';
import type { EntryMeta } from '../types/domain';

/** Prepare the independent offline demo, including saved parsing and example notes. */
export const importOnboardingPaper = (root: string) =>
  invoke<EntryMeta>('import_onboarding_paper', { request: { root } });
