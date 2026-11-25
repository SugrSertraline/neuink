import type { FoldRecord } from '@/shared/ipc/foldingApi';
import { buildFoldTokenViews } from './foldAlignment';
import { sourceSentences } from './foldInput';

/** Only construct animated views when the saved evidence still matches the source. */
export function foldViewsForSource(record: FoldRecord, source: string) {
  const canonical = source.trim();
  if (record.source !== canonical || !Array.isArray(record.evidence) || !Array.isArray(record.brief)
      || typeof record.key !== 'string' || typeof record.takeaway !== 'string' || typeof record.topic !== 'string') return null;
  return buildFoldTokenViews({ source: canonical, sentences: sourceSentences(canonical) }, record);
}
