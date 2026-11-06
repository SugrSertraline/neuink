import { describe, expect, it } from 'vitest';
import { splitPaperCardChunks } from './paperCardChunks';
import { cardTemplateText, structuredCardBody } from './cardTemplates';
import { parseResearchPlan, researchInput, researchPlanMarkdown } from './researchPlan';

import { board, state, plan } from './researchPlan.fixtures';

describe('research evidence and paper coverage', () => {
  it('retains every character and real marker of an oversized segment', () => {
    const marker = '[S1] segment_uid: seg-1\n', body = ('Sentence. 中文😀。\n').repeat(200);
    const chunks = splitPaperCardChunks(marker + body, 512);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(c => c.startsWith(marker) && c.length <= 512)).toBe(true);
    expect(chunks.map(c => c.slice(marker.length)).join('')).toBe(body);
    expect(() => splitPaperCardChunks(body, 100)).toThrow('上下文');
  });
  it('keeps headings and separate source blocks', () => {
    const chunks = splitPaperCardChunks('标题\n[S1] segment_uid: one\n第一段\n[S2] segment_uid: two\n第二段', 512);
    expect(chunks.join('')).toContain('标题'); expect(chunks.join('')).toContain('[S2] segment_uid: two');
  });
  it('uses typed fields and leaves unsupported claims absent', () => {
    expect(cardTemplateText('result')).toContain('对比基线');
    const body = structuredCardBody('result', { '指标与结果': '提升 2%', '臆测': '不应该出现' }, 'fallback');
    expect(body).toContain('提升 2%'); expect(body).toContain('原文未说明'); expect(body).not.toContain('不应该出现');
    expect(structuredCardBody('method', undefined, '旧卡内容')).toBe('旧卡内容');
  });
  it('uses board overrides and selected links while excluding unrelated boards', () => {
    const input = researchInput(board, state, new Set(['n1', 'n2']), '目标');
    expect(input.cards[0]).toMatchObject({ body: '本画布的改写', edited: true });
    expect(input.cards[1].personal).toBe(true); expect(input.links).toHaveLength(1);
    expect(researchInput(board, state, new Set(['n1']), '目标').links).toEqual([]);
    const moved = { ...state, placements: state.placements.map(p => ({ ...p, x: 500 })) };
    expect(researchInput(board, moved, new Set(['n1', 'n2']), '目标')).toEqual(input);
    expect(researchInput({ ...board, id: 'another' }, state, new Set(['n1']), '目标').cards).toEqual([]);
  });
  it('rejects invented card references and incomplete plans', () => {
    const input = researchInput(board, state, new Set(['n1', 'n2']), '目标');
    expect(parseResearchPlan(plan, input).verdict).toBe('conditional');
    expect(() => parseResearchPlan({ ...plan, risks: [{ title: 'x', detail: 'y', card_refs: ['C99'] }] }, input)).toThrow('未选择');
    expect(() => parseResearchPlan({ ...plan, steps: [] }, input)).toThrow('不完整');
    const saved = researchPlanMarkdown(parseResearchPlan(plan, input), input, '模型');
    expect(saved).toContain('本画布的改写'); expect(saved).toContain('seg-1'); expect(saved).toContain('未进行联网');
  });
});

it('separates reusable mechanisms from concrete paper examples in method cards', () => {
  const body = structuredCardBody('method', { '抽象方法': '用替代信号恢复缺失输入', '原文实例': '论文通过跨变量信息补全交通序列' }, '摘要');
  expect(body.indexOf('抽象方法')).toBeLessThan(body.indexOf('原文实例'));
  expect(body).toContain('跨变量信息'); expect(body).toContain('适用条件与边界');
});
