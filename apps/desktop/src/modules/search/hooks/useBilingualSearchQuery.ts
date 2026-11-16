import { generateText } from 'ai';
import { useEffect, useState } from 'react';

import { getLlmSettings, subscribeLlmSettings, type LlmProfile } from '@/shared/ipc/assistantApi';

import { createNeuinkModel, generationSettings } from '../../assistant/sdk/provider';

function containsCjk(value: string) {
  return /[\u3400-\u4dbf\u4e00-\u9fff]/u.test(value);
}

export async function rewriteAcademicSearchQuery(
  query: string,
  profile: LlmProfile,
  signal?: AbortSignal
) {
  const result = await generateText({
    ...generationSettings(profile),
    model: createNeuinkModel(profile),
    system: [
      'Rewrite a Chinese research query into concise English academic search terms for an English paper.',
      'Preserve named entities, acronyms, numbers, methods, datasets, and evaluation metrics.',
      'Return only one English query. Do not explain, translate literally, or add punctuation.'
    ].join('\n'),
    prompt: query.trim(),
    abortSignal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    maxRetries: 0
  });
  const rewritten = result.text.trim().replace(/^['"`]|['"`]$/g, '').replace(/\s+/g, ' ');
  return rewritten || null;
}

export function useBilingualSearchQuery(query: string, enabled: boolean) {
  const [profile, setProfile] = useState<LlmProfile | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [englishQuery, setEnglishQuery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const applySettings = (settings: Awaited<ReturnType<typeof getLlmSettings>>) => {
      const nextProfile = settings.assistant_profile;
      const usable = Boolean(nextProfile?.base_url.trim() && nextProfile?.model.trim());
      if (!cancelled) {
        setProfile(usable ? nextProfile : null);
        setAvailable(usable);
      }
    };
    void getLlmSettings().then((settings) => {
      applySettings(settings);
    }).catch(() => {
      if (!cancelled) setAvailable(false);
    });
    const unsubscribe = subscribeLlmSettings(applySettings);
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  useEffect(() => {
    // Never let a previous rewrite race with a newly typed query.
    setEnglishQuery(null);
    if (!enabled || !profile || !containsCjk(query) || query.trim().length < 2) {
      setBusy(false);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setBusy(true);
      void rewriteAcademicSearchQuery(query, profile, controller.signal)
        .then(setEnglishQuery)
        .catch(() => setEnglishQuery(null))
        .finally(() => setBusy(false));
    }, 450);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [enabled, profile, query]);

  return { available, busy, englishQuery };
}
