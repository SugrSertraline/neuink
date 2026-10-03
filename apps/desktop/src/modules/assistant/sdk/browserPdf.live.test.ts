// @vitest-environment node
// Opt-in: NEUINK_LIVE_BROWSER_PDF=1 NEUINK_LIVE_SETTINGS=<app settings.json>
// Optional NEUINK_LIVE_PDF_PATH must be the same URL's bytes captured by a prior Rust
// probe in an isolated temporary directory. It skips PDF download, not the real model.
// Real configured model + public PDF bytes + production tool/extractor/Agent.
// Tauri IPC and browser Worker transport are adapters: this does NOT test Rust HTTP,
// native tab capture/UI, or a browser's independent Worker. PDF.js uses its real Node
// same-thread worker implementation; no paper text or model response is mocked/saved.
import { readFile, stat } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import type { ToolSet } from 'ai';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import type { BrowserTabSnapshot } from '@/shared/ipc/browserApi';
import { Agent, RunBudget } from '../agent-core';
import { agentExecutors, createAgentDriver } from './agentDriver';
import { BROWSER_TAB_INSTRUCTIONS, createBrowserTabTool } from './browserTabTool';

const live = vi.hoisted(() => ({
  invoke: vi.fn(), pdfStarted: 0, pdfMs: 0,
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: live.invoke }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: globalThis.fetch }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({ default: class { terminate() {} } }));
vi.mock('pdfjs-dist', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return { ...pdfjs, PDFWorker: { create: () => pdfjs.PDFWorker.create({}) } };
});
vi.mock('@/modules/reader/components/pdf-reader/pdfDocumentOptions', async original => {
  const actual = await original<typeof import('@/modules/reader/components/pdf-reader/pdfDocumentOptions')>();
  const { createRequire } = await import('node:module');
  const { dirname, join } = await import('node:path');
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const assetDirectory = (name: string) => join(root, name).replace(/\\/g, '/') + '/';
  return { createPdfDocumentOptions: (bytes: Uint8Array) => {
    live.pdfStarted = performance.now();
    return { ...actual.createPdfDocumentOptions(bytes, 'https://example.invalid/'), useWorkerFetch: false,
      cMapUrl: assetDirectory('cmaps'), iccUrl: assetDirectory('iccs'),
      standardFontDataUrl: assetDirectory('standard_fonts'), wasmUrl: assetDirectory('wasm') };
  } };
});

const enabled = process.env.NEUINK_LIVE_BROWSER_PDF === '1';
const PDF_URL = 'https://arxiv.org/pdf/2309.10108';
const MAX_PDF_BYTES = 12 * 1024 * 1024;

it.skipIf(!enabled)('live main agent uses default PDF page bounds and summarizes the returned truncated text (Node boundary)', async () => {
  const report = console.log.bind(console);
  // Provider/worker diagnostics can contain request details; only allow our numeric report.
  const quiet = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
  quiet.forEach(spy => spy.mockImplementation(() => {}));
  const started = performance.now();
  let phase = 'settings';
  let downloadMs = 0; let bytesCount = 0; let reads = 0; let validations = 0; let turns = 0;
  let fileReadMs = 0; let pdfDownloads = 0; let usedCapturedPdfFile = false;
  let toolStarted = 0; let toolMs = 0; let passed = false;
  let observed: Record<string, unknown> | undefined;
  let readInput: unknown;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error('Live test deadline exceeded (details redacted).')), 150_000);
  try {
    const settingsPath = process.env.NEUINK_LIVE_SETTINGS;
    // File access is only reached inside the explicitly enabled test, never during collection.
    const capturedPdfPath = process.env.NEUINK_LIVE_PDF_PATH;
    if (!settingsPath) throw new Error('Live settings path required.');
    const saved = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      llm_profiles?: LlmProfile[]; assistant_llm_profile_id?: string;
    };
    const profile = saved.llm_profiles?.find(item => item.id === saved.assistant_llm_profile_id);
    if (!profile?.model || !profile.base_url) throw new Error('Configured main profile required.');
    // Only the in-memory run is output-bounded; user settings and credentials are never changed.
    const settings = { ...profile, max_output_tokens: Math.min(profile.max_output_tokens ?? 2048, 2048) };
    const target = { id: 'live-public-pdf', navigationId: 'live-public-pdf-navigation', title: 'arXiv PDF', url: PDF_URL };
    live.invoke.mockImplementation(async (command: string, args: { request?: Record<string, unknown> }) => {
      if (command === 'cancel_browser_read') return;
      if (command !== 'read_browser_tab') throw new Error('Unexpected IPC at the read-only test boundary.');
      const request = args.request;
      if (request?.id !== target.id || request.expected_url !== PDF_URL || request.expected_navigation_id !== target.navigationId) {
        throw new Error('Frozen target identity mismatch.');
      }
      if (request.validate_only) {
        validations++; live.pdfMs = performance.now() - live.pdfStarted; return;
      }
      if (request.selection_only) throw new Error('This test requires PDF text mode.');
      reads++;
      if (reads !== 1) throw new Error('Only one PDF read is permitted in this live test.');
      let bytes: Buffer;
      if (capturedPdfPath) {
        usedCapturedPdfFile = true; phase = 'rust-probe-pdf-file';
        const fileStarted = performance.now();
        try {
          const info = await stat(capturedPdfPath);
          if (!info.isFile() || info.size > MAX_PDF_BYTES) throw new Error('Invalid captured PDF file.');
          bytes = await readFile(capturedPdfPath, { signal: controller.signal });
          bytesCount = bytes.byteLength;
        } finally { fileReadMs = performance.now() - fileStarted; }
      } else {
        pdfDownloads++; phase = 'public-pdf-download';
        const downloadStarted = performance.now();
        const downloadSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
        try {
          const response = await fetch(PDF_URL, { redirect: 'error', credentials: 'omit', signal: downloadSignal });
          if (!response.ok || !response.body) throw new Error('Public PDF transport failed.');
          const chunks: Uint8Array[] = [];
          const reader = response.body.getReader();
          try {
            for (;;) {
              const item = await reader.read();
              if (item.done) break;
              bytesCount += item.value.byteLength;
              if (bytesCount > MAX_PDF_BYTES) { await reader.cancel(); throw new Error('PDF size limit exceeded.'); }
              chunks.push(item.value);
            }
          } finally { reader.releaseLock(); }
          bytes = Buffer.concat(chunks);
        } catch (error) {
          if (downloadSignal.aborted && !controller.signal.aborted) phase = 'public-pdf-download-timeout';
          throw error;
        } finally { downloadMs = performance.now() - downloadStarted; }
      }
      if (bytesCount > MAX_PDF_BYTES || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Invalid PDF input.');
      phase = 'pdfjs-text-extraction';
      return { title: target.title, url: PDF_URL, navigationId: target.navigationId,
        text: '', selection: '', contentType: 'pdf', extractor: 'native-public-pdf-adapter',
        capturedAt: new Date().toISOString(), truncated: false,
        limitations: [capturedPdfPath
          ? 'Node test uses public PDF bytes captured by an earlier Rust probe. No new PDF download, OCR or image understanding.'
          : 'Node test downloaded the public PDF without cookies. No OCR or image understanding.'],
        pdfBase64: bytes.toString('base64') } satisfies BrowserTabSnapshot;
    });
    const tools: ToolSet = { read_browser_tab: createBrowserTabTool({ target, contextBudget: 80_000,
      abortSignal: controller.signal,
      emit: event => { if (event.status === 'running') { toolStarted = performance.now(); readInput = event.input; }
        if (event.status === 'done') { toolMs = performance.now() - toolStarted; phase = 'model-summary'; } },
      observe: output => { observed = output as Record<string, unknown>; },
    }) };
    const budget = new RunBudget(3, 1);
    phase = 'model-tool-selection';
    const agent = new Agent({
      driver: createAgentDriver({ settings, tools, budget, onTurn: () => { turns++; },
        system: `${BROWSER_TAB_INSTRUCTIONS}\nFor this read-only test, call read_browser_tab exactly once with only {"mode":"text"}. Do not supply start_page or page_count: exercise the production default page window. Then summarize the returned paper text in Chinese in three concise substantive points. Cite its exact returned URL. State the actual pagesRead range, total page count, that the remaining pages were not read, and whether the returned text was truncated. No other tools or local source markers are available.` }),
      tools: agentExecutors(tools), budget, signal: controller.signal, maxTurns: 3,
      messages: [{ role: 'user', content: `请读取当前网页中的这篇论文 ${PDF_URL}，使用默认读取范围，总结研究问题、方法和主要发现，并注明实际阅读范围、其余未读页和正文截断情况。不要导入论文或创建笔记。` }],
      verify: () => observed?.status === 'read' ? undefined : 'Read the actual PDF with read_browser_tab before summarizing.',
    });
    const answer = await agent.run();
    phase = 'assertions';
    expect(agent.status).toBe('completed');
    expect(reads).toBe(1); expect(validations).toBe(1); expect(budget.toolCalls).toBe(1);
    expect(pdfDownloads).toBe(capturedPdfPath ? 0 : 1);
    expect(readInput).toEqual({ mode: 'text' });
    expect(turns).toBeGreaterThanOrEqual(2); expect(turns).toBeLessThanOrEqual(3);
    expect(observed?.status === 'read' && observed.contentType === 'pdf' && observed.extractor === 'pdfjs').toBe(true);
    expect(Number(observed?.pageCount)).toBe(22);
    expect(observed?.pagesRead).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(observed?.truncated).toBe(true);
    expect(typeof observed?.text === 'string' && observed.text.length > 1000).toBe(true);
    expect(observed && !('pdfBase64' in observed)).toBe(true);
    expect(answer.length > 100 && answer.includes(PDF_URL) && !/\[S\d+\]/.test(answer)).toBe(true);
    expect(/1\s*[-–—~至到]\s*8/.test(answer)).toBe(true);
    expect(/(?:其余|剩余|后续)[\s\S]{0,30}(?:未|没有)|(?:未|没有)[\s\S]{0,20}(?:全篇|全文|全部)|并非全文/.test(answer)).toBe(true);
    expect(answer.includes('截断')).toBe(true);
    passed = true;
  } catch {
    // No cause: SDK exceptions/assertion diffs may contain keys, prompts or response text.
    throw new Error(`Live browser PDF verification failed at ${phase} (details redacted).`);
  } finally {
    clearTimeout(deadline); controller.abort(); live.invoke.mockReset();
    quiet.forEach(spy => spy.mockRestore());
    report('[browser-pdf-live]', JSON.stringify({ phase, passed,
      totalMs: Math.round(performance.now() - started), downloadMs: Math.round(downloadMs),
      fileReadMs: Math.round(fileReadMs), pdfDownloads, usedCapturedPdfFile,
      pdfjsMs: Math.round(live.pdfMs), toolMs: Math.round(toolMs), bytes: bytesCount,
      pageCount: observed?.pageCount ?? 0, pagesRead: Array.isArray(observed?.pagesRead) ? observed.pagesRead.length : 0,
      characters: typeof observed?.text === 'string' ? observed.text.length : 0,
      truncated: observed?.truncated === true,
      modelTurns: turns, readCalls: reads, identityValidations: validations }));
  }
}, 170_000);
