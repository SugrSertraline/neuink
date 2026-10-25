import { describe, expect, it, vi } from 'vitest';
import type { ConversationSourceLink, ReadEntryAssistantContextResponse } from '@/shared/ipc/assistantApi';
import { formatReadEntryOutput, modelInputSchema, normalizeToolInput, executeTool } from './toolSupport';
import { parsedEntryReadingNotice } from './entryContext';
import { invokeAssistantTool } from '@/shared/ipc/assistantApi';

vi.mock('@/shared/ipc/assistantApi', async original => ({ ...await original<typeof import('@/shared/ipc/assistantApi')>(), invokeAssistantTool: vi.fn() }));

const fixture = (markdown: string): ReadEntryAssistantContextResponse => ({
  entry_id: 'paper', entry_title: 'Paper', markdown, has_pdf: true, parsed_segment_count: 2,
  sources: [1, 2].map(index => ({ entry_id: 'paper', entry_title: 'Paper', segment_uid: `s${index}`, page_idx: index - 1, quote: `Evidence ${index}` })),
});

describe('parsed entry reading size', () => {
  it('does not return a whole long paper as one oversized MCP JSON line', () => {
    const result: ReadEntryAssistantContextResponse = {
      entry_id: 'paper', entry_title: 'Synthetic long paper', has_pdf: true, parsed_segment_count: 240,
      markdown: Array.from({ length: 240 }, (_, index) => `[S${index + 1}] segment_uid: s${index}\n${'Synthetic evidence. '.repeat(28)}\n`).join('\n'),
      sources: Array.from({ length: 240 }, (_, index) => ({ entry_id: 'paper', entry_title: 'Synthetic long paper',
        segment_uid: `s${index}`, page_idx: Math.floor(index / 15), quote: 'Synthetic evidence.' })),
    };
    const output = formatReadEntryOutput(result, () => 1, 360_000).modelOutput;
    expect(JSON.stringify(output).length).toBeLessThan(20_000);
    expect(output).toMatchObject({ more: true, offset: 0, next_offset: expect.any(Number) });
  });

  it('continues a long segment without losing text, splitting surrogate pairs or dropping its citation', () => {
    const original = `[S1] segment_uid: s1\n${'中文与😀公式 '.repeat(2300)}\n[S2] segment_uid: s2\nFinal evidence.\n`;
    const source = fixture(original);
    const observations: Array<{ output: unknown }> = [];
    let input = { offset: 0, limit: 301, revision: undefined as string | undefined };
    let reconstructed = '', steps = 0;
    for (;;) {
      const page = formatReadEntryOutput(source, value => 'segment_uid' in value && value.segment_uid === 's1' ? 7 : 8, 360_000, input).modelOutput;
      expect(page.chars_returned).toBeGreaterThan(0);
      expect(page.markdown).not.toMatch(/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/);
      const body = page.markdown.replace(/^\[S7] \(continued segment\)\n/, '').replace(/\[S7]/g, '[S1]').replace(/\[S8]/g, '[S2]');
      reconstructed += body;
      observations.push({ output: page });
      if (!page.more) break;
      expect(parsedEntryReadingNotice(observations)).toContain('尚未覆盖');
      expect(page.next_read!.offset).toBeGreaterThan(input.offset);
      input = page.next_read!;
      expect(++steps).toBeLessThan(100);
    }
    expect(reconstructed).toBe(original);
    expect(parsedEntryReadingNotice(observations)).toBe('');
    expect(parsedEntryReadingNotice(observations.slice(-1))).toContain('尚未覆盖');
  });

  it('registers only returned sources and rejects changed or missing continuation revisions', () => {
    const source = fixture(`[S1] segment_uid: s1\n${'A'.repeat(500)}\n[S2] segment_uid: s2\n${'B'.repeat(500)}`);
    const add = vi.fn((_source: ConversationSourceLink) => 9);
    const first = formatReadEntryOutput(source, add, 100, { limit: 100 }).modelOutput;
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0][0]).toMatchObject({ segment_uid: 's1' });
    expect(first.source_markers).toEqual(['[S9]']);
    expect(() => formatReadEntryOutput(source, add, 100, { offset: first.next_offset! })).toThrow('续读位置');
    expect(() => formatReadEntryOutput({ ...source, markdown: source.markdown + 'changed' }, add, 100, first.next_read!)).toThrow('正文已变化');
    expect(() => formatReadEntryOutput(source, add, 100, { offset: 999_999, revision: first.revision })).toThrow();
  });

  it('validates pagination, preserves host scope and keeps frontend pagination out of IPC arguments', async () => {
    const scope = { entry_ids: ['paper'], entry_titles: ['Paper'], tag_ids: [], tag_names: [] };
    const schema = modelInputSchema({ name: 'read_entry_assistant_context', description: '', parameters_schema: {
      type: 'object', required: ['root', 'entry_id'], properties: { root: { type: 'string' }, entry_id: { type: 'string' } }, additionalProperties: false,
    } });
    expect(schema.properties).toMatchObject({ offset: { type: 'integer' }, limit: { maximum: 12_000 }, revision: { type: 'string' } });
    for (const fields of [{ offset: -1 }, { offset: 0.5 }, { limit: 12001 }, { limit: '100' }, { revision: 'guess' }]) {
      expect(() => normalizeToolInput('read_entry_assistant_context', { entry_id: 'paper', ...fields }, { root: 'r', scope })).toThrow();
    }
    expect(() => normalizeToolInput('read_entry_assistant_context', { entry_id: 'other' }, { root: 'r', scope })).toThrow();
    vi.mocked(invokeAssistantTool).mockResolvedValue(fixture('[S1] segment_uid: s1\nEvidence'));
    const input = normalizeToolInput('read_entry_assistant_context', { entry_id: 'paper', root: 'wrong', limit: 100 }, { root: 'r', scope });
    await executeTool('read_entry_assistant_context', input, { addSource: () => 1, contextBudget: 8000 });
    expect(invokeAssistantTool).toHaveBeenCalledWith('read_entry_assistant_context', { root: 'r', entry_id: 'paper' });
  });

  it('audits the latest revision per entry without mixing old ranges or hiding another entry’s gaps', () => {
    const source = fixture('[S1] segment_uid: s1\n' + 'A'.repeat(150));
    const first = formatReadEntryOutput(source, () => 1, 100).modelOutput;
    const changed = { ...source, markdown: source.markdown + 'updated' };
    const newFirst = formatReadEntryOutput(changed, () => 1, 100).modelOutput;
    const newLast = formatReadEntryOutput(changed, () => 1, 100, newFirst.next_read!).modelOutput;
    expect(parsedEntryReadingNotice([{output:first},{output:newLast}])).toContain('尚未覆盖');
    const reread = [{output:first},{output:newFirst},{output:newLast}];
    expect(parsedEntryReadingNotice(reread)).toBe('');
    expect(parsedEntryReadingNotice([...reread,{output:{...first,entry_id:'other'}}])).toContain('尚未覆盖');
  });
});
