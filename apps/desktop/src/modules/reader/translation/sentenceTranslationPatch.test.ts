import { expect, it } from 'vitest';
import { prepareSentenceTranslationPatch, type SentenceTranslationSnapshot } from './sentenceTranslationPatch';

const snapshot: SentenceTranslationSnapshot = { source: 'Model 1 works. Model 2 fails.', sentenceIndex: 0,
  sentence: 'Model 1 works.', paragraphTranslation: '模型1有效。\n\n模型2失败。' };
it('updates only the uniquely matched sentence and preserves surrounding text', () => {
  expect(prepareSentenceTranslationPatch(snapshot, snapshot.source, snapshot.paragraphTranslation, '模型1表现良好。'))
    .toBe('模型1表现良好。\n\n模型2失败。');
});
it('rejects stale source, stale translation and empty output', () => {
  expect(prepareSentenceTranslationPatch(snapshot, snapshot.source + ' Changed.', snapshot.paragraphTranslation, '新译文')).toBeNull();
  expect(prepareSentenceTranslationPatch(snapshot, snapshot.source, snapshot.paragraphTranslation + '修改', '新译文')).toBeNull();
  expect(prepareSentenceTranslationPatch(snapshot, snapshot.source, snapshot.paragraphTranslation, ' ')).toBeNull();
});
it('does not replace a whole paragraph when sentence alignment is unavailable', () => {
  const value = { ...snapshot, paragraphTranslation: '无法确定句子对应的整段译文。' };
  expect(prepareSentenceTranslationPatch(value, value.source, value.paragraphTranslation, '新译文')).toBeNull();
});
it('rejects a stale sentence index', () => {
  expect(prepareSentenceTranslationPatch({ ...snapshot, sentenceIndex: 1 }, snapshot.source, snapshot.paragraphTranslation, '新译文')).toBeNull();
});
