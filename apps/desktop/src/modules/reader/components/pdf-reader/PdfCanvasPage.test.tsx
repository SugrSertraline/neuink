// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

const textLayerRender = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('pdfjs-dist', () => ({
  TextLayer: class TextLayerMock {
    render() {
      return textLayerRender();
    }

    cancel() {}
  }
}));

import { PdfCanvasPage, PdfTextSelectionHighlightLayer } from './PdfCanvasPage';

afterEach(() => {
  cleanup();
  textLayerRender.mockReset();
  textLayerRender.mockResolvedValue(undefined);
  vi.restoreAllMocks();
});

describe('PdfCanvasPage', () => {
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
          { color: 'yellow', id: 'annotation:0', rect: [100, 200, 300, 240] }
        ]} />
      </div>
    );

    const highlight = view.container.querySelector('[data-pdf-text-highlight="true"]');
    const textLayer = view.container.querySelector('.pdf-text-layer');

    expect(highlight).not.toBeNull();
    expect((highlight as HTMLElement).style.left).toBe('10%');
    expect((highlight as HTMLElement).style.top).toBe('20%');
    expect((highlight as HTMLElement).style.mixBlendMode).toBe('multiply');
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
