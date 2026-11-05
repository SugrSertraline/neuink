// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateEntryRequest } from '@/shared/hooks/useWorkspace';

import { CreateEntryPanel } from './CreateEntryPanel';

const mocks = vi.hoisted(() => ({
  dismiss: vi.fn(),
  notify: vi.fn(() => 'toast-id'),
  open: vi.fn(),
  onDragDropEvent: vi.fn(() => Promise.resolve(() => undefined))
}));

type DragDropHandler = (event: { payload: unknown }) => void;

/** The most recent native drag-drop listener the panel registered. */
function latestDragDropHandler(): DragDropHandler {
  const calls = mocks.onDragDropEvent.mock.calls as unknown as [DragDropHandler][];
  const handler = calls[calls.length - 1]?.[0];
  if (!handler) throw new Error('CreateEntryPanel did not register a drag-drop listener');
  return handler;
}

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: mocks.onDragDropEvent })
}));
vi.mock('@/shared/hooks/useToast', () => ({
  useToast: () => ({ dismiss: mocks.dismiss, notify: mocks.notify })
}));

describe('CreateEntryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('keeps actions outside the scrolling content and adds tags without submitting the form', async () => {
    const onCreateEntry = vi.fn(async () => undefined);
    const view = render(
      <CreateEntryPanel
        parserEndpoint="https://parser.example.com"
        tags={[]}
        onCreateEntry={onCreateEntry}
        onCreateEntryFinished={vi.fn()}
        onOpenMineruClientGuide={vi.fn()}
      />
    );

    const actions = view.getByLabelText('创建操作');
    expect(actions.className).toContain('shrink-0');
    expect(actions.previousElementSibling?.className).toContain('overflow-y-auto');

    fireEvent.change(view.getByLabelText(/标题/), { target: { value: '交互设计论文' } });
    const tagInput = view.getByLabelText('标签');
    fireEvent.change(tagInput, { target: { value: '研究/HCI' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    expect(onCreateEntry).not.toHaveBeenCalled();
    expect(view.getByText('研究/HCI')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: '创建条目' }));
    await waitFor(() => {
      expect(onCreateEntry).toHaveBeenCalledWith(expect.objectContaining({
        tagPaths: ['研究/HCI'],
        title: '交互设计论文'
      }));
    });
  });

  it('submits only the source belonging to the visible creation mode', async () => {
    mocks.open
      .mockResolvedValueOnce('C:\\exports\\mineru-result.zip')
      .mockResolvedValueOnce('C:\\papers\\paper.pdf');
    const onCreateEntry = vi.fn(async () => undefined);
    const view = render(
      <CreateEntryPanel
        parserEndpoint="https://parser.example.com"
        tags={[]}
        onCreateEntry={onCreateEntry}
        onCreateEntryFinished={vi.fn()}
        onOpenMineruClientGuide={vi.fn()}
      />
    );

    fireEvent.click(view.getByRole('tab', { name: '导入 MinerU 结果' }));
    fireEvent.click(view.getByRole('button', { name: '选择 ZIP/RAR' }));
    await waitFor(() => expect(view.getByText('mineru-result.zip')).toBeTruthy());

    fireEvent.click(view.getByRole('tab', { name: '上传 PDF' }));
    fireEvent.click(view.getByRole('button', { name: '选择 PDF' }));
    await waitFor(() => expect(view.getByText('paper.pdf')).toBeTruthy());
    fireEvent.click(view.getByRole('button', { name: '创建并添加 PDF' }));

    await waitFor(() => {
      expect(onCreateEntry).toHaveBeenCalledWith(expect.objectContaining({
        mineruZipPath: undefined,
        pdfPath: 'C:\\papers\\paper.pdf',
        title: 'mineru-result'
      }));
    });
  });

  it('imports a ZIP alone without sending a PDF path', async () => {
    mocks.open.mockResolvedValueOnce('C:\\exports\\zip-only.zip');
    const onCreateEntry = vi.fn(async (_request: CreateEntryRequest) => undefined);
    const view = render(
      <CreateEntryPanel
        parserEndpoint="https://parser.example.com"
        tags={[]}
        onCreateEntry={onCreateEntry}
        onCreateEntryFinished={vi.fn()}
        onOpenMineruClientGuide={vi.fn()}
      />
    );

    fireEvent.click(view.getByRole('tab', { name: '导入 MinerU 结果' }));
    fireEvent.click(view.getByRole('button', { name: '选择 ZIP/RAR' }));
    await waitFor(() => expect(view.getByText('zip-only.zip')).toBeTruthy());
    expect(view.queryByRole('button', { name: '移除原始 PDF' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '导入并创建' }));

    await waitFor(() => expect(onCreateEntry).toHaveBeenCalledOnce());
    const request = onCreateEntry.mock.calls[0][0];
    expect(request.mineruZipPath).toBe('C:\\exports\\zip-only.zip');
    expect(request.pdfPath).toBeUndefined();
  });

  it('sends the ZIP and the companion PDF together when both are chosen', async () => {
    mocks.open
      .mockResolvedValueOnce('C:\\exports\\mineru-result.zip')
      .mockResolvedValueOnce('C:\\papers\\original.pdf');
    const onCreateEntry = vi.fn(async (_request: CreateEntryRequest) => undefined);
    const view = render(
      <CreateEntryPanel
        parserEndpoint="https://parser.example.com"
        tags={[]}
        onCreateEntry={onCreateEntry}
        onCreateEntryFinished={vi.fn()}
        onOpenMineruClientGuide={vi.fn()}
      />
    );

    fireEvent.click(view.getByRole('tab', { name: '导入 MinerU 结果' }));
    fireEvent.click(view.getByRole('button', { name: '选择 ZIP/RAR' }));
    await waitFor(() => expect(view.getByText('mineru-result.zip')).toBeTruthy());
    fireEvent.click(view.getByRole('button', { name: '选择原始 PDF' }));
    await waitFor(() => expect(view.getByText('original.pdf')).toBeTruthy());
    expect(view.getByText(/MinerU · mineru-result\.zip \+ original\.pdf/)).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: '导入并创建' }));

    await waitFor(() => expect(onCreateEntry).toHaveBeenCalledOnce());
    const request = onCreateEntry.mock.calls[0][0];
    expect(request.mineruZipPath).toBe('C:\\exports\\mineru-result.zip');
    expect(request.pdfPath).toBe('C:\\papers\\original.pdf');
    expect(request.title).toBe('mineru-result');
  });

  it('keeps both the ZIP and the PDF when they are dropped together', async () => {
    const onCreateEntry = vi.fn(async (_request: CreateEntryRequest) => undefined);
    const view = render(
      <CreateEntryPanel
        parserEndpoint="https://parser.example.com"
        tags={[]}
        onCreateEntry={onCreateEntry}
        onCreateEntryFinished={vi.fn()}
        onOpenMineruClientGuide={vi.fn()}
      />
    );

    fireEvent.click(view.getByRole('tab', { name: '导入 MinerU 结果' }));
    await waitFor(() => expect(mocks.onDragDropEvent).toHaveBeenCalled());

    act(() => {
      latestDragDropHandler()({
        payload: {
          type: 'drop',
          position: { x: 0, y: 0 },
          paths: ['D:\\drop\\dropped-result.zip', 'D:\\drop\\dropped-origin.pdf']
        }
      });
    });

    await waitFor(() => expect(view.getByText('dropped-result.zip')).toBeTruthy());
    expect(view.getByText('dropped-origin.pdf')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: '导入并创建' }));
    await waitFor(() => expect(onCreateEntry).toHaveBeenCalledOnce());
    const request = onCreateEntry.mock.calls[0][0];
    expect(request.mineruZipPath).toBe('D:\\drop\\dropped-result.zip');
    expect(request.pdfPath).toBe('D:\\drop\\dropped-origin.pdf');
  });

  it.each(['D:\\drop\\result.rar', 'D:\\drop\\paper\\auto'])(
    'pairs the original PDF with dropped MinerU source %s', async (source) => {
      const onCreateEntry = vi.fn(async (_request: CreateEntryRequest) => undefined);
      const view = render(
        <CreateEntryPanel parserEndpoint="" tags={[]} onCreateEntry={onCreateEntry}
          onCreateEntryFinished={vi.fn()} onOpenMineruClientGuide={vi.fn()} />
      );
      fireEvent.click(view.getByRole('tab', { name: '导入 MinerU 结果' }));
      await waitFor(() => expect(mocks.onDragDropEvent).toHaveBeenCalled());
      act(() => latestDragDropHandler()({ payload: {
        type: 'drop', position: { x: 0, y: 0 }, paths: ['D:\\drop\\original.pdf', source]
      } }));
      expect(view.getByText('original.pdf')).toBeTruthy();
      fireEvent.click(view.getByRole('button', { name: '导入并创建' }));
      await waitFor(() => expect(onCreateEntry).toHaveBeenCalledWith(expect.objectContaining({
        mineruZipPath: source, pdfPath: 'D:\\drop\\original.pdf'
      })));
    }
  );

  it('accepts a companion PDF dropped after choosing a result directory', async () => {
    mocks.open.mockResolvedValueOnce('D:\\drop\\paper\\auto');
    const onCreateEntry = vi.fn(async (_request: CreateEntryRequest) => undefined);
    const view = render(
      <CreateEntryPanel parserEndpoint="" tags={[]} onCreateEntry={onCreateEntry}
        onCreateEntryFinished={vi.fn()} onOpenMineruClientGuide={vi.fn()} />
    );
    fireEvent.click(view.getByRole('tab', { name: '导入 MinerU 结果' }));
    fireEvent.click(view.getByRole('button', { name: '选择结果目录' }));
    await waitFor(() => expect(view.getByText('auto')).toBeTruthy());
    expect(mocks.open).toHaveBeenCalledWith({ multiple: false, directory: true });
    act(() => latestDragDropHandler()({ payload: {
      type: 'drop', position: { x: 0, y: 0 }, paths: ['D:\\drop\\original.pdf']
    } }));
    fireEvent.click(view.getByRole('button', { name: '导入并创建' }));
    await waitFor(() => expect(onCreateEntry).toHaveBeenCalledWith(expect.objectContaining({
      mineruZipPath: 'D:\\drop\\paper\\auto', pdfPath: 'D:\\drop\\original.pdf', title: 'paper'
    })));
  });

  it('explains a PDF-only drop without a MinerU source and clears the companion with its source', async () => {
    const view = render(
      <CreateEntryPanel parserEndpoint="" tags={[]} onCreateEntry={vi.fn(async () => undefined)}
        onCreateEntryFinished={vi.fn()} onOpenMineruClientGuide={vi.fn()} />
    );
    fireEvent.click(view.getByRole('tab', { name: '导入 MinerU 结果' }));
    await waitFor(() => expect(mocks.onDragDropEvent).toHaveBeenCalled());
    act(() => latestDragDropHandler()({ payload: {
      type: 'drop', position: { x: 0, y: 0 }, paths: ['original.pdf']
    } }));
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: '请先选择 MinerU 结果' }));
    act(() => latestDragDropHandler()({ payload: {
      type: 'drop', position: { x: 0, y: 0 }, paths: ['result.rar', 'original.pdf']
    } }));
    expect(view.getByText('original.pdf')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /^移除$/ }));
    expect(view.queryByText('original.pdf')).toBeNull();
    expect(view.queryByRole('button', { name: '移除原始 PDF' })).toBeNull();
  });

  it('creates a readable PDF entry when no parser endpoint is configured', async () => {
    mocks.open.mockResolvedValueOnce('C:\\papers\\offline-paper.pdf');
    const onCreateEntry = vi.fn(async () => ({
      createdWithPdf: true,
      entryId: 'entry-offline',
      parseSubmissionFailed: false,
      parseMessage: null
    }));
    const onCreateEntryFinished = vi.fn();
    const view = render(
      <CreateEntryPanel
        parserEndpoint=""
        tags={[]}
        onCreateEntry={onCreateEntry}
        onCreateEntryFinished={onCreateEntryFinished}
        onOpenMineruClientGuide={vi.fn()}
      />
    );

    fireEvent.click(view.getByRole('button', { name: '选择 PDF' }));
    await waitFor(() => expect(view.getByText('offline-paper.pdf')).toBeTruthy());
    expect(view.getByText(/仍可创建并直接阅读原 PDF/)).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: '创建并添加 PDF' }));

    await waitFor(() => {
      expect(onCreateEntry).toHaveBeenCalledWith(expect.objectContaining({
        pdfPath: 'C:\\papers\\offline-paper.pdf',
        title: 'offline-paper'
      }));
      expect(onCreateEntryFinished).toHaveBeenCalledOnce();
    });
    expect(mocks.notify).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: '解析服务未配置', tone: 'danger' })
    );
  });

  it('prefills the MinerU form when a result folder is dropped into the window', async () => {
    const view = render(
      <CreateEntryPanel
        parserEndpoint=""
        tags={[]}
        onCreateEntry={vi.fn(async () => undefined)}
        onCreateEntryFinished={vi.fn()}
        onOpenMineruClientGuide={vi.fn()}
        mineruDrop={{ path: 'C:\\results\\My Paper\\auto', nonce: 1 }}
      />
    );
    await waitFor(() => expect(view.getByRole('tab', { name: '导入 MinerU 结果' }).getAttribute('aria-selected')).toBe('true'));
    expect((view.getByLabelText(/标题/) as HTMLInputElement).value).toBe('My Paper');
    expect(view.getByText('auto')).toBeTruthy();
  });
});
