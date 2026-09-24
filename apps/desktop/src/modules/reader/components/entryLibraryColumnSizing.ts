/** Automatic expansion is presentation only; stored widths remain the column weights. */
export function fitColumnWidth(width: number, otherWidths: number, viewportWidth: number | null) {
  const total = width + otherWidths;
  return total > 0 && viewportWidth && viewportWidth > total ? width * viewportWidth / total : width;
}

/** Invert proportional expansion so a dragged edge follows the pointer in layout pixels. */
export function unfitColumnWidth(width: number, otherWidths: number, viewportWidth: number | null) {
  return otherWidths > 0 && viewportWidth && viewportWidth > width + otherWidths
    ? width * otherWidths / (viewportWidth - width)
    : width;
}

export function readElementLayoutWidth(element: Element | null) {
  if (!(element instanceof HTMLElement)) return 0;
  return Math.max(0, Math.round(element.clientWidth || element.offsetWidth || element.getBoundingClientRect().width));
}

export function readTableViewportWidth(shell: HTMLElement | null) {
  return readElementLayoutWidth(shell?.querySelector('[data-slot="table-container"]') ?? null)
    || readElementLayoutWidth(shell);
}
