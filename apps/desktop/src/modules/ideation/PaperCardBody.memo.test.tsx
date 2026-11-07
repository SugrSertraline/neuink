// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PaperCardBody } from './PaperCardBody';
const renderMarkdown = vi.hoisted(() => vi.fn());
vi.mock('@/shared/components/SourceSnapshotPreview', () => ({ SourceSnapshotPreview: (props: unknown) => { renderMarkdown(props); return null; } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('does not reparse unchanged content on canvas updates, but reflects edits', () => {
  const view = render(<PaperCardBody card={{ kind: 'idea', body: '方法内容' }} />);
  view.rerender(<PaperCardBody card={{ kind: 'idea', body: '方法内容' }} />);
  expect(renderMarkdown).toHaveBeenCalledTimes(1);
  view.rerender(<PaperCardBody card={{ kind: 'idea', body: '新的方法内容' }} />);
  expect(renderMarkdown).toHaveBeenCalledTimes(2);
});
