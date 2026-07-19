// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { hasPdfTextSelection } from './pdfCanvasDom';

describe('hasPdfTextSelection', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
  });

  it('recognizes a non-empty selection that belongs to the PDF text layer', () => {
    const textLayer = document.createElement('div');
    textLayer.className = 'pdf-text-layer';
    textLayer.textContent = 'Selectable PDF text';
    document.body.append(textLayer);

    selectText(textLayer.firstChild!);

    expect(hasPdfTextSelection(textLayer)).toBe(true);
  });

  it('ignores selections outside the current PDF text layer', () => {
    const textLayer = document.createElement('div');
    const other = document.createElement('div');
    textLayer.className = 'pdf-text-layer';
    textLayer.textContent = 'PDF text';
    other.textContent = 'Other text';
    document.body.append(textLayer, other);

    selectText(other.firstChild!);

    expect(hasPdfTextSelection(textLayer)).toBe(false);
  });

  it('ignores a selection that crosses into another page layer', () => {
    const textLayer = document.createElement('div');
    const other = document.createElement('div');
    textLayer.className = 'pdf-text-layer';
    textLayer.textContent = 'First page';
    other.textContent = 'Second page';
    document.body.append(textLayer, other);

    const range = document.createRange();
    range.setStart(textLayer.firstChild!, 0);
    range.setEnd(other.firstChild!, other.textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(hasPdfTextSelection(textLayer)).toBe(false);
  });
});

function selectText(node: Node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}
