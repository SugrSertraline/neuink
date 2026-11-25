import katex from 'katex';

/** Repair an OCR seam like $\mathcal{G} =$$(\nu,\mathcal{E}) without consuming prose. */
export function repairSplitEquationDelimiters(value: string): string {
  return value.replace(/(^|[^\\$])\$([^$\n]*\\[A-Za-z]+[^$\n]*=\s*)\$\$[ \t]*(\([^\n$]*)(\$(?!\$))?(?=\n|\$|$)/g,
    (whole, prefix: string, left: string, tail: string, closing: string | undefined) => {
      let depth = 0;
      let end = -1;
      for (let i = 0; i < tail.length; i += 1) {
        if (tail[i] === '(' && tail[i - 1] !== '\\') depth += 1;
        if (tail[i] === ')' && tail[i - 1] !== '\\' && --depth === 0) { end = i + 1; break; }
      }
      if (end < 0) return whole;
      const expression = `${left.trim()} ${tail.slice(0, end)}`;
      try { katex.renderToString(expression, { throwOnError: true, trust: false, strict: 'ignore' }); }
      catch { return whole; }
      return `${prefix}$${expression}$${tail.slice(end)}${closing && tail.slice(end).trim() ? closing : ''}`;
    });
}
