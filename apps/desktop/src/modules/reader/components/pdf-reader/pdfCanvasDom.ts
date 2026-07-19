import type { ClipboardEvent as ReactClipboardEvent } from 'react';

export type PdfLayerSize = {
  height: number;
  width: number;
};

export function copyPdfTextSelection(
  event: ReactClipboardEvent<HTMLDivElement>,
  textLayerElement: HTMLDivElement | null
) {
  if (!hasPdfTextSelection(textLayerElement)) {
    return;
  }

  const text = window.getSelection()?.toString() ?? '';
  if (!text) {
    return;
  }

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

export function scheduleIdleWork(callback: () => void) {
  let completed = false;
  const finish = () => {
    if (completed) {
      return;
    }
    completed = true;
    callback();
  };

  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(finish, { timeout: 500 });
    return () => {
      window.cancelIdleCallback(handle);
      finish();
    };
  }

  const handle = window.setTimeout(finish, 80);
  return () => {
    window.clearTimeout(handle);
    finish();
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
