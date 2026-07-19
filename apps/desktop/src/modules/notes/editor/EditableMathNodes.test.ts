import { describe, expect, it } from 'vitest';

import { parseMathSource } from './EditableMathNodes';

describe('editable math Markdown source', () => {
  it('keeps block Markdown source and extracts its LaTeX', () => {
    expect(parseMathSource('$$\nE = mc^2\n$$', 'block')).toEqual({
      kind: 'block',
      latex: 'E = mc^2'
    });
  });

  it('allows a block formula to be downgraded by changing $$ to $', () => {
    expect(parseMathSource('$E = mc^2$', 'block')).toEqual({
      kind: 'inline',
      latex: 'E = mc^2'
    });
  });

  it('allows an inline formula to be upgraded by changing $ to $$', () => {
    expect(parseMathSource('$$x^2$$', 'inline')).toEqual({ kind: 'block', latex: 'x^2' });
  });
});
