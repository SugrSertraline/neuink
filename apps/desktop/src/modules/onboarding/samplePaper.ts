import type { EntryMeta } from '@/shared/types/domain';

/** Exact identity only; no fuzzy matching against unrelated paper titles. */
export function isOnboardingPaper(entry: EntryMeta): boolean {
  const arxiv = entry.fields?.arxiv_id?.trim().replace(/^arxiv:/i, '');
  const source = entry.fields?.tutorial_source;
  const normalized = (value:string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = entry.pdf?.file_name?.replace(/\.pdf$/i, '') ?? '';
  return entry.fields?.tutorial_demo === 'attention-v1' || source === 'https://arxiv.org/abs/1706.03762v7'
    || Boolean(arxiv && /^1706\.03762(?:v\d+)?$/i.test(arxiv))
    || normalized(entry.title) === 'attentionisallyouneed'
    || normalized(name) === 'attentionisallyouneed'
    || /^1706\.03762(?:v\d+)?$/i.test(name);
}

export function findLocalOnboardingPaper(entries: EntryMeta[]) {
  return entries.find(entry => entry.pdf && entry.fields?.tutorial_demo === 'attention-v1');
}
