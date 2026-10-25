import type { ClipboardEvent as ReactClipboardEvent } from 'react';

export type PdfLayerSize = {
  height: number;
  width: number;
};

/** PDF coordinates exclude the decorative page border, including under CSS zoom. */
export function pdfPageContentRect(root: HTMLElement) {
  const surface = root.querySelector<HTMLElement>('[data-guide="pdf-page"]') ?? root.querySelector<HTMLElement>('.pdf-text-layer');
  const rect = surface?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? rect : root.getBoundingClientRect();
}

export function copyPdfTextSelection(
  event: ReactClipboardEvent<HTMLDivElement>,
  textLayerElement: HTMLDivElement | null
) {
  if (!hasPdfTextSelection(textLayerElement)) {
    return;
  }

  const rawText = window.getSelection()?.toString() ?? '';
  if (!rawText) {
    return;
  }

  const text = rawText.replace(/\n+/g, ' ');
  event.clipboardData.setData('text/plain', text);
  event.preventDefault();
}

export function hasPdfTextSelection(textLayerElement: HTMLElement | null) {
  const selection = window.getSelection();
  return Boolean(
    selection &&
      !selection.isCollapsed &&
      selection.toString().trim() &&
      textLayerElement &&
      selectionBelongsToTextLayer(selection, textLayerElement)
  );
}

export function scheduleIdleWork(callback: () => void, delayMs = 0) {
  let completed = false;
  let idleCancel: (() => void) | null = null;
  const finish = () => {
    if (completed) {
      return;
    }
    completed = true;
    callback();
  };

  const scheduleIdleCallback = () => {
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(finish, { timeout: 500 });
      idleCancel = () => window.cancelIdleCallback(handle);
      return;
    }

    const handle = window.setTimeout(finish, 80);
    idleCancel = () => window.clearTimeout(handle);
  };

  const delayHandle = window.setTimeout(scheduleIdleCallback, delayMs);
  return () => {
    completed = true;
    window.clearTimeout(delayHandle);
    idleCancel?.();
  };
}

export function applyPdfLayerSize(
  element: HTMLElement | null,
  size: PdfLayerSize
) {
  if (!element) {
    return;
  }

  element.style.width = `${size.width}px`;
  element.style.height = `${size.height}px`;
}

export function isPdfRenderCancellation(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'RenderingCancelledException' || error.name === 'AbortException')
  );
}

function selectionBelongsToTextLayer(
  selection: Selection,
  textLayerElement: HTMLElement
) {
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;

  return (
    Boolean(anchorNode && textLayerElement.contains(anchorNode)) &&
    Boolean(focusNode && textLayerElement.contains(focusNode))
  );
}
