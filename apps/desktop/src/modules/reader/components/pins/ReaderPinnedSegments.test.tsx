// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { SourceSegment } from '@/shared/types/domain';
import { SegmentActionMenu } from '../pdf-reader/SegmentActionMenu';
import { ReaderPinnedSegments } from './ReaderPinnedSegments';
import { useReaderPins } from './ReaderPinsContext';

vi.mock('../reflow/pdfSourceSnapshot', () => ({ readCachedPdfSegmentSnapshot: vi.fn().mockResolvedValue(null) }));
const paragraph: SourceSegment = { uid: 'paragraph', segment_type: 'paragraph', page_idx: 0, bbox: [100, 100, 900, 300],
  text: 'A pinned explanation remains available across pages.', markdown: null };
const formula: SourceSegment = { ...paragraph, uid: 'formula', segment_type: 'math', page_idx: 1, text: '$x^2+y^2$' };
const pdfDocument = {} as PDFDocumentProxy;
class Pointer extends MouseEvent {
  pointerId: number; isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 7; this.isPrimary = init.isPrimary ?? true; }
}
let width = 800, height = 600, scale = 1;
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
const observers: ResizeObserverCallback[] = [];
const flush = () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); });
beforeEach(() => {
  width = 800; height = 600; scale = 1; frames.clear(); observers.length = 0;
  vi.stubGlobal('PointerEvent', Pointer);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { observers.push(callback); } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width * scale, height * scale));
  Object.assign(HTMLElement.prototype, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); frames.clear(); });

function Source() {
  const [menu, setMenu] = useState(false);
  const pins = useReaderPins()!;
  return <>
    <button onContextMenu={event => { event.preventDefault(); setMenu(true); }}>原文片段</button>
    <button onClick={() => pins.pin(paragraph)}>固定段落</button>
    <button onClick={() => pins.pin(formula)}>固定公式</button>
    {menu && <SegmentActionMenu canAddSourceLink={false} canCopyContent={false} canCopySourceLink={false}
      segment={paragraph} position={{ x: 20, y: 20 }} sourceBacklinks={[]} onClose={() => setMenu(false)}
      onOpenSegmentNote={vi.fn()} onOpenSegmentAnnotation={vi.fn()} onOpenSourceBacklink={vi.fn()} />}
  </>;
}
function Harness({ entryId = 'paper', root = 'library', source = true, document = pdfDocument, onLocate = () => true }: {
  entryId?: string; root?: string; source?: boolean; document?: PDFDocumentProxy; onLocate?: (segment: SourceSegment) => boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return <ReaderPinnedSegments entryId={entryId} workspaceRoot={root} pdfDocument={document} scrollRef={scrollRef} onLocate={onLocate}>
    <div data-testid="pdf-scroll" ref={scrollRef} tabIndex={0}>{source && <Source />}</div>
  </ReaderPinnedSegments>;
}
function setup() {
  const ui = render(<Harness />);
  fireEvent.click(ui.getByText('固定段落'));
  const panel = ui.getByRole('region', { name: '固钉：段落 · 第 1 页' });
  const handle = within(panel).getByRole('button', { name: /^移动固钉/ });
  const resize = within(panel).getByRole('button', { name: '调整固钉大小' });
  const down = (target = handle, extra: PointerEventInit = {}) => fireEvent.pointerDown(target, { button: 0, pointerId: 7, clientX: 600, clientY: 100, ...extra });
  const move = (target = handle, extra: PointerEventInit = {}) => fireEvent.pointerMove(target, { pointerId: 7, clientX: 500, clientY: 180, ...extra });
  const up = (target = handle, extra: PointerEventInit = {}) => fireEvent.pointerUp(target, { pointerId: 7, clientX: 500, clientY: 180, ...extra });
  return { ...ui, panel, handle, resize, down, move, up };
}

it('pins from the real context menu, keeps content when its source page leaves, and reopens instead of duplicating', () => {
  const ui = render(<Harness />);
  fireEvent.contextMenu(ui.getByText('原文片段'));
  fireEvent.click(ui.getByRole('menuitem', { name: '固定' }));
  expect(ui.queryByRole('menu')).toBeNull();
  const panel = ui.getByRole('region', { name: /^固钉：/ });
  expect(panel.textContent).toContain(paragraph.text);
  const scroll = ui.getByTestId('pdf-scroll');
  expect(scroll.contains(panel)).toBe(false);
  scroll.scrollTop = 2400;
  fireEvent.scroll(scroll);
  fireEvent.pointerDown(scroll);
  expect(ui.getByRole('region', { name: /^固钉：/ })).toBe(panel);
  fireEvent.contextMenu(ui.getByText('原文片段'));
  fireEvent.click(ui.getByRole('menuitem', { name: '查看固钉' }));
  expect(ui.getAllByRole('region', { name: /^固钉：/ })).toHaveLength(1);
  expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^移动固钉/);
  ui.rerender(<Harness source={false} />);
  expect(ui.getByText(paragraph.text)).toBeTruthy();
});
it('keeps multiple pins independent, locates the correct source, and restores focus after unpinning', () => {
  const locate = vi.fn(() => true);
  const ui = render(<Harness onLocate={locate} />);
  fireEvent.click(ui.getByText('固定段落'));
  fireEvent.click(ui.getByText('固定公式'));
  const panels = ui.getAllByRole('region', { name: /^固钉：/ });
  expect(panels).toHaveLength(2);
  fireEvent.click(within(panels[0]).getByRole('button', { name: '回到原文' }));
  expect(locate).toHaveBeenCalledExactlyOnceWith(paragraph);
  expect(document.activeElement).toBe(ui.getByTestId('pdf-scroll'));
  within(panels[1]).getByRole('button', { name: '取消固定' }).focus();
  fireEvent.click(within(panels[1]).getByRole('button', { name: '取消固定' }));
  expect(ui.getAllByRole('region', { name: /^固钉：/ })).toHaveLength(1);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(ui.queryByRole('region', { name: /^固钉：/ })).toBeNull();
  expect(document.activeElement).toBe(ui.getByTestId('pdf-scroll'));
});
it.each([{ entryId: 'other' }, { root: 'another-library' }, { document: {} as PDFDocumentProxy }])('clears pins when their source changes: %j', next => {
  const ui = setup();
  ui.rerender(<Harness {...next} />);
  expect(ui.queryByRole('region', { name: /^固钉：/ })).toBeNull();
});
it('moves once per animation frame in scaled coordinates, commits the latest point, and does not auto-scroll', () => {
  scale = 1.25;
  const ui = setup();
  const before = parseFloat(ui.panel.style.left);
  ui.down(); ui.move(undefined, { clientX: 475, clientY: 225 });
  ui.move(undefined, { clientX: 450, clientY: 225 });
  expect(frames.size).toBe(1);
  flush();
  expect(parseFloat(ui.panel.style.left)).toBe(before - 120);
  expect(parseFloat(ui.panel.style.top)).toBe(108);
  expect(frames.size).toBe(0);
  ui.up(undefined, { clientX: 425, clientY: 225 });
  expect(parseFloat(ui.panel.style.left)).toBe(before - 140);
  expect(document.body.style.userSelect).toBe('');
  expect(document.body.style.cursor).toBe('');
});
it('resizes without moving the opposite corner and supports keyboard movement and size changes', () => {
  const ui = setup();
  const left = ui.panel.style.left;
  const initialWidth = parseFloat(ui.panel.style.width);
  ui.down(ui.resize); ui.move(ui.resize, { clientX: 550, clientY: 130 }); ui.up(ui.resize, { clientX: 550, clientY: 130 });
  expect(ui.panel.style.left).toBe(left);
  expect(parseFloat(ui.panel.style.width)).toBe(initialWidth - 50);
  fireEvent.keyDown(ui.resize, { key: 'ArrowRight', shiftKey: true });
  expect(parseFloat(ui.panel.style.width)).toBe(initialWidth - 30);
  fireEvent.keyDown(ui.handle, { key: 'ArrowLeft' });
  expect(parseFloat(ui.panel.style.left)).toBe(parseFloat(left) - 5);
});
it.each(['Escape', 'pointercancel', 'lostpointercapture', 'blur', 'surface', 'resize', 'unmount'])('cancels a gesture and cleans up on %s', reason => {
  const ui = setup();
  const before = ui.panel.style.left;
  ui.down(); ui.move(); flush();
  expect(ui.panel.style.left).not.toBe(before);
  if (reason === 'Escape') fireEvent.keyDown(ui.handle, { key: 'Escape' });
  else if (reason === 'pointercancel') fireEvent.pointerCancel(ui.handle, { pointerId: 7 });
  else if (reason === 'lostpointercapture') fireEvent.lostPointerCapture(ui.handle, { pointerId: 7 });
  else if (reason === 'blur') fireEvent(window, new Event('blur'));
  else if (reason === 'surface') fireEvent(window, new Event('neuink:reader-surface-change'));
  else if (reason === 'resize') { height = 590; act(() => observers.forEach(callback => callback([], {} as ResizeObserver))); }
  else ui.unmount();
  flush();
  expect(document.body.style.userSelect).toBe('');
  expect(document.body.style.cursor).toBe('');
  if (reason !== 'unmount') { expect(ui.panel.style.left).toBe(before); expect(ui.panel.isConnected).toBe(true); }
});
it('ignores small movements and other pointers, clamps to a shrinking viewport, and contains wheel events', () => {
  const ui = setup();
  const before = ui.panel.style.left;
  ui.down(); ui.move(undefined, { clientX: 602, clientY: 102 }); ui.up(undefined, { clientX: 602, clientY: 102 });
  expect(ui.panel.style.left).toBe(before);
  ui.down(undefined, { button: 2 }); ui.move(); ui.up();
  expect(ui.panel.style.left).toBe(before);
  ui.down(); ui.move(undefined, { pointerId: 9 }); ui.up(undefined, { pointerId: 9 });
  expect(ui.panel.style.left).toBe(before);
  fireEvent.pointerCancel(ui.handle, { pointerId: 7 });
  width = 250; height = 190;
  act(() => observers.forEach(callback => callback([], {} as ResizeObserver)));
  expect(parseFloat(ui.panel.style.left) + parseFloat(ui.panel.style.width)).toBeLessThanOrEqual(242);
  expect(parseFloat(ui.panel.style.top) + parseFloat(ui.panel.style.height)).toBeLessThanOrEqual(182);
  const wheel = vi.fn(); window.addEventListener('wheel', wheel);
  expect(fireEvent.wheel(ui.panel, { ctrlKey: true, deltaY: 100 })).toBe(false);
  expect(fireEvent.wheel(within(ui.panel).getByLabelText('固钉内容'), { deltaY: 100 })).toBe(true);
  expect(wheel).not.toHaveBeenCalled(); window.removeEventListener('wheel', wheel);
});
