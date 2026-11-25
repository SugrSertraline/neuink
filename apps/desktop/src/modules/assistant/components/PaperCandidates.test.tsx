// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ConversationMessage, ConversationSourceLink } from '@/shared/ipc/assistantApi';
import type { ResearchPaper } from '@/shared/ipc/researchApi';
import { PaperAnswerContent } from './PaperAnswerContent';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function papers(count: number): ResearchPaper[] {
  return Array.from({ length: count }, (_, i) => ({ id: `arxiv:2401.${String(i + 1).padStart(5, '0')}v2`, title: `Paper ${i + 1}`,
    url: `https://arxiv.org/abs/2401.${String(i + 1).padStart(5, '0')}v2`, authors: ['Author'],
    abstract_text: 'Summary', year: '2024', doi: '', pdf_url: null, provider: 'arxiv', evidence_level: 'abstract' }));
}
function message(count: number, content = ''): ConversationMessage {
  return { message_id: 'page-test', conversation_id: 'chat', role: 'assistant', content, created_at: '', source_links: [],
    parts: [{ type: 'tool-result', id: 'search', toolName: 'search_papers', summary: '', researchPapers: papers(count) }] };
}
function ui(value: ConversationMessage, streaming = false, onOpenSource = vi.fn(), discovered: ConversationSourceLink[] = []) {
  return <TooltipProvider><PaperAnswerContent message={value} content={value.content} sources={value.source_links} discovered={discovered}
    streaming={streaming} onOpenSource={onOpenSource} renderMarkdown={text => <p>{text}</p>} /></TooltipProvider>;
}
async function expand(view: ReturnType<typeof render>) {
  fireEvent.click(view.container.querySelector('summary')!);
  await waitFor(() => expect(view.queryByLabelText('本页检索候选')).toBeTruthy());
}
function observe(case_id: string, actual: unknown) { console.log('STEP4_JSON ' + JSON.stringify({ case_id, actual })); }

it.each([0, 1, 20, 21, 47, 100])('keeps %i source records intact and only mounts one candidate page', async count => {
  const data = message(count), before = JSON.stringify(data);
  const view = render(ui(data));
  expect(view.container.querySelectorAll('article')).toHaveLength(0);
  if (count === 0) expect(view.container.querySelector('summary')).toBeNull();
  else {
    await expand(view);
    expect(view.container.querySelectorAll('article')).toHaveLength(Math.min(count, 20));
    expect(view.queryByRole('navigation', { name: '候选分页' }) !== null).toBe(count > 20);
    if (count > 20) expect(view.getByRole('button', { name: '上一页候选' })).toHaveProperty('disabled', true);
  }
  expect(JSON.stringify(data)).toBe(before);
  expect(invoke).not.toHaveBeenCalled();
  observe('T-STEP4-COUNTS', { input: count, collapsed_rows: 0, expanded_rows: Math.min(count, 20), pager: count > 20, native_calls: 0, input_unchanged: true });
});

it('excludes recommendations, preserves order and makes the exact version on the last page actionable', async () => {
  const refs = papers(47).slice(0, 2).map(p => ({ ref: `research:${p.id}`, reason: 'Reason' }));
  const data = message(47, '```neuink-papers\n' + JSON.stringify({ items: refs }) + '\n```');
  const view = render(ui(data));
  expect(within(view.getByRole('region', { name: '推荐论文' })).getAllByRole('article')).toHaveLength(2);
  expect(view.getByText('其他检索结果（45）')).toBeTruthy();
  await expand(view);
  const urls: string[] = [];
  for (let page = 0; page < 3; page++) {
    urls.push(...within(view.getByLabelText('本页检索候选')).getAllByRole('article').map(row => row.querySelector('a')!.href));
    if (page < 2) fireEvent.click(view.getByRole('button', { name: '下一页候选' }));
  }
  expect(urls).toEqual(papers(47).slice(2).map(p => p.url));
  expect(view.getByRole('button', { name: '下一页候选' })).toHaveProperty('disabled', true);
  expect(view.getByRole('status', { name: '候选页码' }).textContent?.trim()).toBe('3 / 3');
  expect(invoke).not.toHaveBeenCalled();
  observe('T-STEP4-RECOMMENDATIONS', { source_count: 47, recommended: 2, candidates: 45, unique_urls: new Set(urls).size,
    first: urls[0], last: urls[urls.length - 1], order_equal: true, last_page_rows: 5, next_disabled: true });
});

it('clamps a shrinking list without resurrecting the old page when results grow again', async () => {
  const view = render(ui(message(47))); await expand(view);
  fireEvent.click(view.getByRole('button', { name: '下一页候选' }));
  fireEvent.click(view.getByRole('button', { name: '下一页候选' }));
  view.rerender(ui(message(21)));
  expect(view.getByRole('status', { name: '候选页码' }).textContent?.trim()).toBe('2 / 2');
  expect(within(view.getByLabelText('本页检索候选')).getAllByRole('article')).toHaveLength(1);
  await act(async () => {});
  view.rerender(ui(message(47)));
  expect(view.getByRole('status', { name: '候选页码' }).textContent?.trim()).toBe('2 / 3');
  view.rerender(ui(message(0)));
  expect(view.queryByLabelText('本页检索候选')).toBeNull();
  view.rerender(ui(message(47)));
  expect(view.container.querySelectorAll('article')).toHaveLength(0);
  await expand(view);
  expect(view.getByRole('status', { name: '候选页码' }).textContent?.trim()).toBe('1 / 3');
  observe('T-STEP4-CLAMP', { pages: ['3/3', '2/2', '2/3'], zero_then_restore: 'collapsed, then 1/3' });
});

it('preserves the page across collapse but resets on message or conversation changes', async () => {
  const view = render(ui(message(47))); await expand(view);
  fireEvent.click(view.getByRole('button', { name: '下一页候选' }));
  fireEvent.click(view.container.querySelector('summary')!);
  await waitFor(() => expect(view.queryByLabelText('本页检索候选')).toBeNull());
  await expand(view);
  expect(view.getByRole('status', { name: '候选页码' }).textContent?.trim()).toBe('2 / 3');
  for (const identity of [{ message_id: 'new-message' }, { conversation_id: 'other-chat' }]) {
    view.rerender(ui({ ...message(47), ...identity }));
    expect(view.container.querySelectorAll('article')).toHaveLength(0);
    await expand(view);
    expect(view.getByRole('status', { name: '候选页码' }).textContent?.trim()).toBe('1 / 3');
  }
  observe('T-STEP4-IDENTITY', { collapse_preserved_page: 2, new_message_page: 1, new_conversation_page: 1 });
});

it('preserves a valid page for metadata changes and appended results', async () => {
  const view = render(ui(message(47))); await expand(view);
  fireEvent.click(view.getByRole('button', { name: '下一页候选' }));
  const updated = message(60);
  if (updated.parts?.[0].type === 'tool-result') updated.parts[0].researchPapers![20].title = 'Updated exact paper';
  view.rerender(ui(updated));
  expect(view.getByRole('status', { name: '候选页码' }).textContent?.trim()).toBe('2 / 3');
  expect(within(view.getByLabelText('本页检索候选')).getByRole('link', { name: 'Updated exact paper' }).getAttribute('href')).toBe(papers(60)[20].url);
});

it('never passes candidate array indexes into the recommendation reason renderer', async () => {
  const data = message(21, 'Intro');
  const markdown = vi.fn((text: string) => <p>{text}</p>);
  const view = render(<TooltipProvider><PaperAnswerContent message={data} content={data.content} sources={[]} discovered={[]}
    streaming={false} onOpenSource={() => {}} renderMarkdown={markdown} /></TooltipProvider>);
  await expand(view);
  const actual = { markdown_inputs: markdown.mock.calls.map(([text]) => text),
    unexpected_numeric_text: within(view.getByLabelText('本页检索候选')).queryAllByText(/^\d+$/).map(node => node.textContent) };
  observe('T-STEP4-NO-ROW-INDEX', actual);
  expect(actual.markdown_inputs).toEqual(['Intro']);
  expect(actual.unexpected_numeric_text).toEqual([]);
});

it('shows no candidates during streaming and keeps invalid recommendation errors explicit', async () => {
  const incomplete = message(21, '```neuink-papers\n{"items":');
  const view = render(ui(incomplete, true));
  expect(view.getByRole('status').textContent).toContain('正在整理');
  expect(view.container.querySelector('summary')).toBeNull();
  view.rerender(ui(incomplete));
  expect(view.getByRole('alert').textContent).toContain('格式不完整');
  await expand(view);
  expect(view.container.querySelectorAll('article')).toHaveLength(20);
  view.rerender(ui(message(21), true));
  expect(view.container.querySelector('summary')).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
  observe('T-STEP4-STREAMING', { streaming_candidates: 0, incomplete_finished_alert: true, candidate_first_page: 20, native_calls: 0 });
});

it('paginates mixed providers with deduplication and opens the selected Sciverse record', async () => {
  const sources: ConversationSourceLink[] = [1, 2, 3].map(n => ({ provider: 'sciverse', doc_id: `remote-${n}`, title: `Remote ${n}`, quote: 'Evidence' }));
  const data = { ...message(19), source_links: sources };
  const onOpen = vi.fn(), view = render(ui(data, false, onOpen, sources));
  await expand(view);
  expect(view.getByText('检索候选（22）')).toBeTruthy();
  expect(view.container.querySelectorAll('article')).toHaveLength(20);
  fireEvent.click(view.getByRole('button', { name: '下一页候选' }));
  const last = within(view.getByLabelText('本页检索候选')).getAllByRole('article');
  expect(last).toHaveLength(2);
  fireEvent.click(within(last[1]).getByRole('button', { name: '查看' }));
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(sources[2]);
  expect(invoke).not.toHaveBeenCalled();
  observe('T-STEP4-MIXED', { research: 19, sciverse: 3, deduplicated_total: 22, pages: [20, 2], viewed_doc_id: 'remote-3', native_calls: 0 });
});

it('reveals the candidate heading and starts keyboard browsing on the new page without stealing pointer focus', async () => {
  const view = render(ui(message(47))); await expand(view);
  const summary = view.container.querySelector('summary')!;
  const scroll = vi.fn(); summary.scrollIntoView = scroll;
  fireEvent.click(view.getByRole('button', { name: '下一页候选' }), { detail: 0 });
  expect(document.activeElement?.getAttribute('href')).toBe(papers(47)[20].url);
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'start', inline: 'nearest', behavior: 'instant' });
  const next = view.getByRole('button', { name: '下一页候选' }); next.focus();
  fireEvent.click(next, { detail: 1 });
  expect(document.activeElement?.getAttribute('href')).not.toBe(papers(47)[40].url);
  expect(scroll).toHaveBeenCalledTimes(2);
  observe('T-STEP4-FOCUS', { keyboard_first_url: papers(47)[20].url, pointer_did_not_focus_row: true, candidate_reveals: 2 });
});
