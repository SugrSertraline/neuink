// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PdfLayoutAnchor } from './PdfLayoutAnchor';
import { usePdfReaderZoom } from './usePdfReaderZoom';

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function Harness({ columns, bookMode }: { columns: number; bookMode: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { zoom, pageWidth, updateZoom, handleCtrlWheelZoom } = usePdfReaderZoom({
    entryId: 'stability', viewportWidth: 640, pageDisplayMode: columns === 2 ? 'dual' : 'single', onInteractionStart: () => {},
  });
  return <>
    <button onClick={() => updateZoom(() => 1)}>Reset</button>
    <PdfLayoutAnchor scrollRef={ref} zoom={zoom} pageWidth={pageWidth} bookMode={bookMode} leftInset={48}>
      <div ref={ref} data-testid="viewport" onWheel={event => handleCtrlWheelZoom({
        deltaY: event.deltaY, deltaMode: event.deltaMode, timeStamp: Date.now(), viewportHeight: 480,
      })}>
        {Array.from({ length: columns * 3 }, (_, index) => <section key={index} data-pdf-page-index={index}>
          <div data-guide="pdf-page" style={{ width: pageWidth, height: pageWidth * 1.4 }} />
        </section>)}
      </div>
    </PdfLayoutAnchor>
  </>;
}

function geometry(container: HTMLDivElement, columns: number, scale: number) {
  const papers = [...container.querySelectorAll<HTMLElement>('[data-guide="pdf-page"]')];
  Object.defineProperties(container, { clientWidth: { value: 640 }, clientHeight: { value: 480 }, offsetWidth: { value: 650 } });
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 50, 650 * scale, 480 * scale));
  papers.forEach((paper, index) => vi.spyOn(paper, 'getBoundingClientRect').mockImplementation(() => {
    const width = parseFloat(paper.style.width), height = parseFloat(paper.style.height);
    const rowWidth = columns * (width + 2) + (columns - 1) * 16;
    // Fixed rail, padding, caption, border and inter-page gaps must not scale.
    const rowLeft = 60 + Math.max(0, (640 - 72 - rowWidth) / 2);
    return new DOMRect(30 + (rowLeft + 1 + (index % columns) * (width + 18) - container.scrollLeft) * scale,
      50 + (39 + Math.floor(index / columns) * (height + 34) - container.scrollTop) * scale,
      width * scale, height * scale);
  }));
  Object.defineProperty(container, 'scrollTo', { value: vi.fn(({ left, top }: ScrollToOptions) => {
    const width = parseFloat(papers[0].style.width), height = parseFloat(papers[0].style.height);
    // Chromium/WebView2 rounds scroll offsets to physical pixels.
    container.scrollLeft = Math.floor(Math.max(0, Math.min(columns * (width + 2) + (columns - 1) * 16 + 72 - 640, left!)) * 1.5) / 1.5;
    container.scrollTop = Math.floor(Math.max(0, Math.min(3 * (height + 34) - 480, top!)) * 1.5) / 1.5;
  }) });
  return papers;
}

const cases = [1, 1.25].flatMap(scale => [1, 2].flatMap(columns => [false, true].map(bookMode => ({ scale, columns, bookMode }))));
it.each(cases)('keeps the center through rapid wheel reversals and manual pans: %j', ({ scale, columns, bookMode }) => {
  localStorage.setItem('neuink.reader.pdfZoom.stability', '2');
  const ui = render(<Harness columns={columns} bookMode={bookMode} />);
  const container = ui.getByTestId('viewport') as HTMLDivElement;
  const papers = geometry(container, columns, scale);
  const paper = papers[columns];
  container.scrollTop = parseFloat(paper.style.height) + 240;
  container.scrollLeft = 120;
  const center = { x: 30 + 344 * scale, y: 50 + 240 * scale };
  const capture = () => {
    const rect = paper.getBoundingClientRect();
    return { x: (center.x - rect.left) / rect.width, y: (center.y - rect.top) / rect.height };
  };
  const check = (point: ReturnType<typeof capture>) => {
    const rect = paper.getBoundingClientRect();
    expect(Math.abs(rect.left + point.x * rect.width - center.x)).toBeLessThan(scale);
    expect(Math.abs(rect.top + point.y * rect.height - center.y)).toBeLessThan(scale);
  };
  const wheel = (deltaY: number, count: number) => {
    for (let i = 0; i < count; i++) {
      fireEvent.wheel(container, { ctrlKey: true, deltaY: Math.sign(deltaY) * 20, clientX: i % 2 ? 40 : 600, clientY: 80 });
      act(() => vi.advanceTimersByTime(220));
    }
  };
  const original = capture();
  wheel(-100, 45); check(original);
  wheel(100, 65); check(original);
  // Panning after zoom must establish a new center, including after old timers
  // would have fired. No delayed scroll writes may override that gesture.
  container.scrollTop += 50; container.scrollLeft += 35;
  const panned = capture(), before = [container.scrollLeft, container.scrollTop];
  act(() => vi.advanceTimersByTime(500));
  expect([container.scrollLeft, container.scrollTop]).toEqual(before);
  wheel(-100, 20); check(panned);
  act(() => vi.advanceTimersByTime(500)); check(panned);
  // Fast wheel bursts coalesce into one larger zoom; reversing the wheel must
  // keep the same paper point even with physical-pixel scroll rounding.
  const widthBeforeBurst = parseFloat(paper.style.width);
  for (const direction of [-1, 1, -1, 1]) {
    for (let i = 0; i < 3; i++) fireEvent.wheel(container, { ctrlKey: true, deltaY: direction * 100 });
    act(() => vi.advanceTimersByTime(20));
    check(panned);
    if (direction < 0) expect(parseFloat(paper.style.width)).toBeGreaterThan(widthBeforeBurst * 1.1);
  }
});

it.each([1, 2])('keeps centered paper/spread aligned when crossing horizontal overflow (%s columns)', columns => {
  const ui = render(<Harness columns={columns} bookMode={false} />);
  const container = ui.getByTestId('viewport') as HTMLDivElement;
  const papers = geometry(container, columns, 1);
  const spreadCenter = () => (papers[0].getBoundingClientRect().left + papers[columns - 1].getBoundingClientRect().right) / 2;
  const original = spreadCenter();
  for (let i = 0; i < 10; i++) {
    fireEvent.wheel(container, { ctrlKey: true, deltaY: -100, clientX: 40, clientY: 90 });
    act(() => vi.advanceTimersByTime(220));
  }
  expect(Math.abs(spreadCenter() - original)).toBeLessThan(1);
  fireEvent.click(ui.getByText('Reset'));
  expect(Math.abs(spreadCenter() - original)).toBeLessThan(1);
  expect(container.scrollLeft).toBe(0);
});
