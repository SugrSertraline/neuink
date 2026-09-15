// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

const textLayerRender = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const textLayerContainers = vi.hoisted(() => [] as HTMLElement[]);

vi.mock('pdfjs-dist', () => ({
  TextLayer: class TextLayerMock {
    private readonly container: HTMLElement;

    constructor({ container }: { container: HTMLElement }) {
      this.container = container;
      textLayerContainers.push(container);
    }

    render() {
      this.container.append(document.createElement('span'));
      return textLayerRender();
    }

    cancel() {}
  }
}));

import {
  applyPdfTextSearchHighlights,
  PdfCanvasPage,
  PdfTextSelectionHighlightLayer
} from './PdfCanvasPage';

afterEach(() => {
  cleanup();
  textLayerRender.mockReset();
  textLayerRender.mockResolvedValue(undefined);
  textLayerContainers.length = 0;
  vi.restoreAllMocks();
});

describe('PdfCanvasPage', () => {
  it('resizes offscreen placeholders without loading or rasterizing PDF pages', () => {
    const fixture = createPdfFixture(Promise.resolve());
    const page = (pageWidth: number) => (
      <PdfCanvasPage
        pageIdx={5}
        pageWidth={pageWidth}
        pdfDocument={fixture.document}
        renderEnabled={false}
        renderPriority="preload"
      />
    );
    const view = render(page(800));
    const placeholder = view.container.querySelector('canvas')!.parentElement!;
    const aspectRatio = parseFloat(placeholder.style.height) / 800;

    for (const width of [440, 300, 560, 800]) {
      view.rerender(page(width));
      expect(placeholder.style.width).toBe(`${width}px`);
      expect(parseFloat(placeholder.style.height)).toBeCloseTo(width * aspectRatio);
    }
    expect(fixture.document.getPage).not.toHaveBeenCalled();
    expect(fixture.render).not.toHaveBeenCalled();
  });

  it('keeps the loading state until the PDF canvas has been copied', async () => {
    const pendingRender = deferred<void>();
    const fixture = createPdfFixture(pendingRender.promise);
    mockCanvasContexts(fixture.drawImage);
    const view = renderPage(fixture.document);

    await waitFor(() => expect(fixture.render).toHaveBeenCalledOnce());
    expect(view.container.querySelector('.animate-spin')).not.toBeNull();
    expect(fixture.drawImage).not.toHaveBeenCalled();

    await act(async () => pendingRender.resolve());

    await waitFor(() => {
      expect(fixture.drawImage).toHaveBeenCalledOnce();
      expect(view.container.querySelector('.animate-spin')).toBeNull();
    });
  });

  it('keeps a rendered canvas visible when the text layer fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    textLayerRender.mockRejectedValueOnce(new Error('text layer failed'));
    const fixture = createPdfFixture(Promise.resolve());
    mockCanvasContexts(fixture.drawImage);
    const view = renderPage(fixture.document);

    await waitFor(() => expect(warning).toHaveBeenCalledOnce());

    expect(fixture.drawImage).toHaveBeenCalledOnce();
    expect(view.container.querySelector('.animate-spin')).toBeNull();
    expect(view.queryByText(/text layer failed/i, { exact: false })).toBeNull();
  });

  it('places persisted highlights between the canvas and selectable text', () => {
    const view = render(
      <div className="relative">
        <PdfCanvasPage
          pageIdx={0}
          pageWidth={600}
          pdfDocument={{} as PDFDocumentProxy}
          renderEnabled={false}
          renderPriority="visible"
        />
        <PdfTextSelectionHighlightLayer highlights={[
          { active: true, color: 'yellow', id: 'annotation:0', rect: [100, 200, 300, 240] }
        ]} />
      </div>
    );

    const highlight = view.container.querySelector('[data-pdf-text-highlight="true"]');
    const textLayer = view.container.querySelector('.pdf-text-layer');

    expect(highlight).not.toBeNull();
    expect((highlight as HTMLElement).style.left).toBe('10%');
    expect((highlight as HTMLElement).style.top).toBe('20%');
    expect((highlight as HTMLElement).style.mixBlendMode).toBe('multiply');
    expect(highlight?.getAttribute('data-pdf-annotation-active')).toBe('true');
    expect(highlight?.classList.contains('pdf-annotation-highlight-active')).toBe(true);
    expect(textLayer?.classList.contains('z-[2]')).toBe(true);
  });

  it('does not rerender the PDF page when only the highlight overlay changes', () => {
    const pdfDocument = {} as PDFDocumentProxy;
    const view = render(
      <div className="relative">
        <PdfCanvasPage
          pageIdx={0}
          pageWidth={600}
          pdfDocument={pdfDocument}
          renderEnabled={false}
          renderPriority="visible"
        />
        <PdfTextSelectionHighlightLayer highlights={[]} />
      </div>
    );
    const canvas = view.container.querySelector('canvas');
    const textLayer = view.container.querySelector('.pdf-text-layer');

    view.rerender(
      <div className="relative">
        <PdfCanvasPage
          pageIdx={0}
          pageWidth={600}
          pdfDocument={pdfDocument}
          renderEnabled={false}
          renderPriority="visible"
        />
        <PdfTextSelectionHighlightLayer highlights={[
          { color: 'blue', id: 'annotation:0', rect: [100, 200, 300, 240] }
        ]} />
      </div>
    );

    expect(view.container.querySelector('canvas')).toBe(canvas);
    expect(view.container.querySelector('.pdf-text-layer')).toBe(textLayer);
    expect(view.container.querySelector('[data-pdf-text-highlight="true"]')).not.toBeNull();
  });

  it('adds the text layer without rasterizing a preloaded page again', async () => {
    const fixture = createPdfFixture(Promise.resolve());
    mockCanvasContexts(fixture.drawImage);
    const view = render(
      <PdfCanvasPage
        pageIdx={0}
        pageWidth={600}
        pdfDocument={fixture.document}
        renderEnabled
        renderPriority="preload"
      />
    );

    await waitFor(() => expect(fixture.drawImage).toHaveBeenCalledOnce());
    expect(fixture.render).toHaveBeenCalledOnce();

    view.rerender(
      <PdfCanvasPage
        pageIdx={0}
        pageWidth={600}
        pdfDocument={fixture.document}
        renderEnabled
        renderPriority="visible"
      />
    );

    await waitFor(() => expect(textLayerRender).toHaveBeenCalledOnce());
    expect(fixture.render).toHaveBeenCalledOnce();
  });

  it('builds the text layer off-DOM and commits it only after completion', async () => {
    const pendingTextLayer = deferred<void>();
    textLayerRender.mockImplementationOnce(() => pendingTextLayer.promise);
    const fixture = createPdfFixture(Promise.resolve());
    mockCanvasContexts(fixture.drawImage);
    const view = renderPage(fixture.document);

    await waitFor(() => expect(textLayerRender).toHaveBeenCalledOnce());
    const visibleTextLayer = view.container.querySelector('.pdf-text-layer');
    expect(visibleTextLayer?.childElementCount).toBe(0);
    expect(textLayerContainers[0]).not.toBe(visibleTextLayer);
    expect(textLayerContainers[0]?.isConnected).toBe(false);

    await act(async () => pendingTextLayer.resolve());
    await waitFor(() => expect(visibleTextLayer?.childElementCount).toBe(1));
  });

  it('releases the canvas bitmap and text layer when rendering is disabled', async () => {
    const fixture = createPdfFixture(Promise.resolve());
    mockCanvasContexts(fixture.drawImage);
    const view = renderPage(fixture.document);

    await waitFor(() => expect(fixture.drawImage).toHaveBeenCalledOnce());
    const canvas = view.container.querySelector('canvas');
    const textLayer = view.container.querySelector('.pdf-text-layer');
    textLayer?.append(document.createElement('span'));
    expect(canvas?.width).toBeGreaterThan(0);

    view.rerender(
      <PdfCanvasPage
        pageIdx={0}
        pageWidth={600}
        pdfDocument={fixture.document}
        renderEnabled={false}
        renderPriority="visible"
      />
    );

    await waitFor(() => expect(canvas?.width).toBe(0));
    expect(canvas?.height).toBe(0);
    expect(textLayer?.childElementCount).toBe(0);
  });

  it('renders again after a page leaves and re-enters the render window', async () => {
    const fixture = createPdfFixture(Promise.resolve());
    mockCanvasContexts(fixture.drawImage);
    const view = renderPage(fixture.document);

    await waitFor(() => expect(fixture.drawImage).toHaveBeenCalledOnce());
    view.rerender(
      <PdfCanvasPage
        pageIdx={0}
        pageWidth={600}
        pdfDocument={fixture.document}
        renderEnabled={false}
        renderPriority="preload"
      />
    );
    view.rerender(
      <PdfCanvasPage
        pageIdx={0}
        pageWidth={600}
        pdfDocument={fixture.document}
        renderEnabled
        renderPriority="visible"
      />
    );

    await waitFor(() => expect(fixture.drawImage).toHaveBeenCalledTimes(2));
    expect(fixture.render).toHaveBeenCalledTimes(2);
  });

  it('retries a page after a raster load failure', async () => {
    const fixture = createPdfFixture(Promise.resolve());
    const page = await fixture.document.getPage(1);
    const getPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('page unavailable'))
      .mockResolvedValue(page);
    const document = { getPage } as unknown as PDFDocumentProxy;
    mockCanvasContexts(fixture.drawImage);
    const view = renderPage(document);

    await waitFor(() => expect(view.getByText('page unavailable')).toBeTruthy());
    fireEvent.click(view.getByRole('button', { name: '重试此页' }));

    await waitFor(() => expect(fixture.drawImage).toHaveBeenCalledOnce());
    expect(getPage).toHaveBeenCalledTimes(2);
  });

  it('marks matching text-layer spans and one active result', () => {
    const layer = document.createElement('div');
    const first = document.createElement('span');
    const second = document.createElement('span');
    first.textContent = 'Alpha result';
    second.textContent = 'Another ALPHA result';
    layer.append(first, second);

    applyPdfTextSearchHighlights(layer, ' alpha ', true);

    expect(first.classList.contains('pdf-search-match-active')).toBe(true);
    expect(second.classList.contains('pdf-search-match')).toBe(true);
    applyPdfTextSearchHighlights(layer, '', false);
    expect(layer.querySelector('.pdf-search-match')).toBeNull();
  });

  it('updates the page layout width before a replacement raster finishes', async () => {
    const fixture = createPdfFixture(Promise.resolve());
    mockCanvasContexts(fixture.drawImage);
    const view = renderPage(fixture.document);

    await waitFor(() => expect(fixture.drawImage).toHaveBeenCalledOnce());
    const pendingRender = deferred<void>();
    fixture.render.mockImplementationOnce(() => ({
      promise: pendingRender.promise,
      cancel: vi.fn(),
      onContinue: null
    }) as unknown as RenderTask);

    view.rerender(
      <PdfCanvasPage
        pageIdx={0}
        pageWidth={300}
        pdfDocument={fixture.document}
        renderEnabled
        renderPriority="visible"
      />
    );

    const page = view.container.querySelector('canvas')?.parentElement;
    expect(page?.style.width).toBe('300px');
    expect(page?.style.height).toBe('450px');
  });
});

function renderPage(pdfDocument: PDFDocumentProxy) {
  return render(
    <PdfCanvasPage
      pageIdx={0}
      pageWidth={600}
      pdfDocument={pdfDocument}
      renderEnabled
      renderPriority="visible"
    />
  );
}

function createPdfFixture(renderPromise: Promise<void>) {
  const drawImage = vi.fn();
  const renderTask = {
    promise: renderPromise,
    cancel: vi.fn(),
    onContinue: null
  } as unknown as RenderTask;
  const render = vi.fn(() => renderTask);
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      height: 900 * scale,
      width: 600 * scale
    }),
    render,
    streamTextContent: vi.fn(() => ({}))
  } as unknown as PDFPageProxy;
  const document = {
    getPage: vi.fn(async () => page)
  } as unknown as PDFDocumentProxy;

  return { document, drawImage, render };
}

function mockCanvasContexts(drawImage: ReturnType<typeof vi.fn>) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ clearRect: vi.fn(), drawImage }) as unknown as CanvasRenderingContext2D
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
