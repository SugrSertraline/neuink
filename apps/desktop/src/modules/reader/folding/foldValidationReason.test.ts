import { expect, it } from 'vitest';
import { validateFoldBatch } from './foldResult';
const input = { segmentUid: 'p', pageIndex: 0, source: 'First. Second.', sentences: ['First.', 'Second.'] };
it.each([
  [{ segments: [] }, '模型未返回对应段落'],
  [{ segments: [{ segment_uid: 'p', evidence: [2], key: 'Finding.', takeaway: 'Finding.', topic: 'Finding' }] }, '证据句编号无效'],
  [{ segments: [{ segment_uid: 'p', evidence: [0], key: 'Finding.', takeaway: 'Finding.', topic: 'Other' }] }, '主题不是结论中的原文'],
])('explains the exact validation problem without exposing model output', (output, reason) => {
  expect(validateFoldBatch([input], output).failureReasons?.p).toContain(reason);
});
