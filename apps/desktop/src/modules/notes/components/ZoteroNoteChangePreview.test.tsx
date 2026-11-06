// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ZoteroNoteChangePreview } from './ZoteroNoteChangePreview';

it('shows Zotero original, proposed content, line changes and formatting-only changes', () => {
  const view = render(<ZoteroNoteChangePreview beforeHtml="<p>Original note</p>" afterHtml="<p>Edited note</p>" />);
  expect(screen.getByRole('region', { name: 'Zotero 原笔记' }).textContent).toContain('Original note');
  expect(screen.getByRole('region', { name: '拟写入 Zotero 的内容' }).textContent).toContain('Edited note');
  expect(screen.getByRole('region', { name: '逐行变化' }).textContent).toContain('Original note');
  expect(screen.getByRole('region', { name: '逐行变化' }).textContent).toContain('Edited note');
  view.rerender(<ZoteroNoteChangePreview beforeHtml="<p><b>Same</b></p>" afterHtml="<p>Same</p>" />);
  expect(screen.getByText(/文字相同，但 HTML 排版/)).toBeTruthy();
  expect(screen.getByText('查看排版与链接的原始 HTML')).toBeTruthy();
});
