export function sanitizePastedNoteHtml(html: string) {
  if (typeof document === 'undefined') {
    return html;
  }

  const template = document.createElement('template');
  template.innerHTML = html;

  template.content.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    const color = element.style.color;
    if (isTransparentColor(color)) {
      element.style.removeProperty('color');
    }
    element.style.removeProperty('caret-color');

    if (!element.getAttribute('style')?.trim()) {
      element.removeAttribute('style');
    }
  });

  return template.innerHTML;
}

function isTransparentColor(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  return (
    normalized === 'transparent' ||
    normalized === '#0000' ||
    normalized === '#00000000' ||
    /,(0|0\.0+)\)$/.test(normalized) ||
    normalized.endsWith(',0%)')
  );
}
