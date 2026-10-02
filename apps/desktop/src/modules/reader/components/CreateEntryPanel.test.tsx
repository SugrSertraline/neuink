// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateEntryPanel } from './CreateEntryPanel';

const mocks = vi.hoisted(() => ({
  dismiss: vi.fn(),
  notify: vi.fn(() => 'toast-id'),
  open: vi.fn(),
  onDragDropEvent: vi.fn(() => Promise.resolve(() => undefined))
}));

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
    fireEvent.click(view.getByRole('button', { name: '选择 ZIP' }));
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
});
