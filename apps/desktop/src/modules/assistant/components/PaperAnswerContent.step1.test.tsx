// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { researchPapersFromResult } from '@/shared/ipc/researchApi';
import { PaperAnswerContent } from './PaperAnswerContent';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it.each([20, 100, 1000])('Step 1 complete records remain reachable through Step 4 pages: %i', async count => {
  const papers = researchPapersFromResult({ papers: Array.from({ length: count }, (_, index) => ({
    id: `arxiv:2401.${String(index + 1).padStart(5, '0')}v2`, title: `Fixture ${index + 1}`,
    url: `https://arxiv.org/abs/2401.${String(index + 1).padStart(5, '0')}v2`,
    authors: ['Author'], abstract_text: 'x'.repeat(6000), year: '2024', doi: '',
    pdf_url: null, provider: 'arxiv', evidence_level: 'abstract'
  })) });
  const before = process.memoryUsage();
  const started = performance.now();
  const message = { message_id: 'step1', role: 'assistant' as const, content: '', created_at: '', source_links: [],
    parts: [{ type: 'tool-result' as const, id: 'fixture', toolName: 'search_papers', summary: 'Fixture', researchPapers: papers }] };
  const view = render(<TooltipProvider><PaperAnswerContent message={message} content="" sources={[]} discovered={[]} streaming={false}
    renderMarkdown={text => text} onOpenSource={vi.fn()} /></TooltipProvider>);
  expect(view.container.querySelectorAll('article')).toHaveLength(0);
  fireEvent.click(view.getByText(`检索候选（${count}）`));
  await waitFor(() => expect(view.queryByLabelText('本页检索候选')).toBeTruthy());
  const ids: string[] = [];
  let maximumMounted = 0;
  for (let page = 0; page < Math.ceil(count / 20); page++) {
    const rows = within(view.getByLabelText('本页检索候选')).getAllByRole('article');
    maximumMounted = Math.max(maximumMounted, rows.length);
    ids.push(...rows.map(row => row.querySelector('a')?.getAttribute('href') ?? ''));
    if (page + 1 < Math.ceil(count / 20)) fireEvent.click(view.getByRole('button', { name: '下一页候选' }));
  }
  const after = process.memoryUsage();
  expect(ids).toEqual(papers.map(paper => paper.url));
  expect(maximumMounted).toBeLessThanOrEqual(20);
  expect(message.parts[0].researchPapers).toHaveLength(count);
  expect(invoke).not.toHaveBeenCalled();
  console.log('STEP4_JSON ' + JSON.stringify({ case_id: 'T-STEP4-ALL-CANDIDATES', actual: {
    count, reachable_count: ids.length, unique_urls: new Set(ids).size, max_dom_articles: maximumMounted,
    source_records: message.parts[0].researchPapers.length, order_equal: true, elapsed_ms: performance.now() - started,
    rss_before: before.rss, rss_after: after.rss, heap_delta_bytes: after.heapUsed - before.heapUsed,
    native_calls: 0, environment: 'jsdom paged mount/unmount; not native layout or capacity certification'
  } }));
}, 20000);
