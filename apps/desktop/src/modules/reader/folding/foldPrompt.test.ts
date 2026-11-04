import { describe, expect, it } from 'vitest';
import type { SourceSegment } from '@/shared/types/domain';
import { buildFoldContexts, buildFoldPrompt } from './foldPrompt';

const input = { segmentUid: 'a', pageIndex: 0, source: 'The adaptive method reduces waiting time. The baseline stays unchanged.',
  sentences: ['The adaptive method reduces waiting time.', 'The baseline stays unchanged.'] };

describe('TextFold paragraph prompt', () => {
  it('retains upstream English budgets, evidence numbering and source-language instructions', () => {
    const prompt = buildFoldPrompt([input], { title: 'Synthetic study', section: 'Results' });
    expect(prompt).toContain('at most 14 words');
    expect(prompt).toContain('at most 22 words');
    expect(prompt).toContain('at most 3 words');
    expect(prompt).toContain("in the text's own language");
    expect(prompt).toContain('copied VERBATIM from inside the takeaway');
    expect(prompt).toContain('3 only when the unit has 7 or more');
    expect(prompt).toContain('[U0] paragraph\n  0: The adaptive method reduces waiting time.\n  1: The baseline stays unchanged.');
    expect(prompt).toContain('This section: Results');
    expect(prompt).not.toContain('one takeaway for the whole section');
  });

  it('uses upstream CJK budgets and stand-alone claims even when the paper title is English', () => {
    const text = '模拟实验表明，自适应方法可以降低等待时间，但不能据此推断真实工厂的表现。';
    const prompt = buildFoldPrompt([{ ...input, source: text, sentences: [text] }], { title: 'English title' });
    expect(prompt).toContain('at most 40 characters');
    expect(prompt).toContain('at most 60 characters');
    expect(prompt).toContain('at most 8 characters');
    expect(prompt).toContain('do not open it with 该, 此, 其, 上述');
    expect(prompt).toContain("use the punctuation of the text's own language");
    expect(prompt).not.toContain('no em or en dashes');
  });

  it('bounds background metadata and does not treat other body paragraphs as generation units', () => {
    const segment = (uid: string, text: string, segment_type: SourceSegment['segment_type'] = 'paragraph'): SourceSegment =>
      ({ uid, text, segment_type, page_idx: 0, bbox: null, markdown: null });
    const contexts = buildFoldContexts('T'.repeat(2_000), [
      segment('h1', '摘 要', 'heading'), segment('abstract', '摘'.repeat(10_000)),
      segment('h2', 'Results', 'heading'), segment('a', input.source), segment('b', 'UNSELECTED_BODY')
    ]);
    const context = contexts.get('a')!;
    expect(context.title).toHaveLength(512);
    expect(context.abstract).toHaveLength(4_000);
    expect(context.section).toBe('Results');
    const prompt = buildFoldPrompt([input], context);
    expect(prompt).not.toContain('UNSELECTED_BODY');
    expect(prompt).not.toContain('[U1]');
  });
});
