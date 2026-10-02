// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuidePdfDemonstration, type PdfDemoMode } from './GuidePdfDemonstration';
import { hoverInteractionBlocked } from '@/components/ui/hover-interactions';

const box = (left:number, top:number, width:number, height:number) =>
  ({ left, top, right:left + width, bottom:top + height, width, height } as DOMRect);

function Fixture({ mode }: { mode: PdfDemoMode }) {
  const viewport = useRef<HTMLDivElement>(null);
  return <>
    <div data-pdf-page-surface>
      <div data-guide="pdf-page">
        <canvas data-pdf-rendered="true" width={100} height={100} />
        <div className="pdf-text-layer"><span>Attention is all you need</span></div>
      </div>
      <div data-segment-uid="sample-paragraph" title="段落 · 第 1 页" />
    </div>
    <div ref={viewport} data-test-viewport>
      <GuidePdfDemonstration mode={mode} viewport={viewport} />
    </div>
  </>;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback:FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', window.clearTimeout.bind(window));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this:HTMLElement) {
    if (this.dataset.segmentUid) return box(200, 220, 380, 80);
    if (this.tagName === 'SPAN') return box(220, 235, 210, 22);
    if (this.hasAttribute('data-guide-selection-toolbar')) return box(0, 0, 368, 168);
    if (this.dataset.guide === 'pdf-page') return box(160, 100, 650, 600);
    return box(0, 0, 1200, 800);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('PDF onboarding demonstration', () => {
  it('outlines a visible real parsed region without modifying document state', async () => {
    render(<Fixture mode="blocks" />);
    const demo = await waitFor(() => screen.getByText('解析块 · 段落 · 第 1 页'));
    expect(demo.closest('[data-guide-pdf-demo]')?.getAttribute('data-guide-pdf-demo')).toBe('blocks');
    expect((demo.previousElementSibling as HTMLElement).style.left).toBe('200px');
    expect((demo.previousElementSibling as HTMLElement).style.width).toBe('380px');
  });

  it('illustrates selection only after a selectable text span exists', async () => {
    render(<Fixture mode="selection-translation" />);
    expect(await screen.findByText('自动演示 · 选中文字')).toBeTruthy();
    const popup = screen.getByRole('region', { name:'选区操作演示（不执行操作）' });
    expect(within(popup).getByText('“Attention is all you need”')).toBeTruthy();
    for (const name of ['翻译', '提问', '解释', '仅高亮', '高亮并批注', '复制选中文字']) {
      const button = within(popup).getByRole('button', { name });
      expect(button.hasAttribute('disabled')).toBe(true);
      expect(button.querySelector('svg')).toBeTruthy();
    }
    expect(popup.style.top).toBe('265px');
    expect(window.getSelection()?.rangeCount).toBe(0);
    expect(document.querySelector('.guide-demo-selection')).toBeTruthy();
  });

  it('suppresses hover over the demonstration and releases priority when leaving the lesson', async () => {
    const ui = render(<Fixture mode="selection-translation" />);
    await screen.findByRole('region', { name:'选区操作演示（不执行操作）' });
    expect(hoverInteractionBlocked()).toBe(true);
    ui.rerender(<Fixture mode="blocks" />);
    await screen.findByText('解析块 · 段落 · 第 1 页');
    expect(screen.queryByRole('region', { name:'选区操作演示（不执行操作）' })).toBeNull();
    expect(hoverInteractionBlocked()).toBe(false);
    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  it('does not show a selection popup before the PDF text layer is available', async () => {
    const viewport = { current:document.createElement('div') };
    const ui = render(<><div data-pdf-page-surface><div data-guide="pdf-page"><canvas data-pdf-rendered="true" /></div></div>
      <GuidePdfDemonstration mode="selection-translation" viewport={viewport} /></>);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(document.querySelector('[data-guide-selection-toolbar]')).toBeNull();
    const textLayer = document.createElement('div'); textLayer.className = 'pdf-text-layer';
    const text = document.createElement('span'); text.textContent = 'Selectable text is now ready'; textLayer.append(text);
    act(() => document.querySelector('[data-guide="pdf-page"]')!.append(textLayer));
    expect(await screen.findByRole('region', { name:'选区操作演示（不执行操作）' })).toBeTruthy();
    ui.unmount();
    expect(hoverInteractionBlocked()).toBe(false);
  });

  it('keeps the same real block anchored when another region becomes visible', async () => {
    render(<Fixture mode="blocks" />);
    await screen.findByText('解析块 · 段落 · 第 1 页');
    const other = document.createElement('div'); other.dataset.segmentUid = 'earlier-region'; other.title = '段落 · 另一个块';
    act(() => document.querySelector('[data-pdf-page-surface]')!.prepend(other));
    fireEvent.scroll(document);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(screen.queryByText('解析块 · 段落 · 另一个块')).toBeNull();
    expect(screen.getByText('解析块 · 段落 · 第 1 页')).toBeTruthy();
  });

  it('clips a demonstrated block to the reader pane, not to unrelated UI below it', async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function(this:HTMLElement) {
      if (this.dataset.clip !== undefined) return box(150, 180, 660, 80);
      if (this.dataset.segmentUid) return box(200, 220, 380, 80);
      if (this.dataset.guide === 'pdf-page') return box(160, 100, 650, 600);
      return box(0, 0, 1200, 800);
    });
    const viewport = { current:document.createElement('div') };
    const view = render(<><div data-clip style={{ overflow:'hidden' }}><div data-pdf-page-surface>
      <div data-guide="pdf-page"><canvas data-pdf-rendered="true" /></div>
      <div data-segment-uid="clipped" title="段落 · 裁切后的块" /></div></div>
      <GuidePdfDemonstration mode="blocks" viewport={viewport} /></>);
    const label = await screen.findByText('解析块 · 段落 · 裁切后的块');
    const outline = label.previousElementSibling as HTMLElement;
    expect(outline.style.top).toBe('220px');
    expect(outline.style.height).toBe('40px');
    view.unmount();
  });
});
