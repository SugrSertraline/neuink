// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NewTabPage } from './NewTabPage';

afterEach(cleanup);

it('offers direct choices for creating, importing and opening pages', () => {
  const onChoose = vi.fn();
  const view = render(<NewTabPage onChoose={onChoose} />);
  for (const [label, destination] of [
    ['论文条目', 'create-entry'], ['网页标签', 'browser'],
    ['Zotero 文献', 'zotero'], ['MinerU 解析结果', 'mineru'],
    ['条目库', 'library'], ['每日看板', 'daily-dashboard'],
  ]) {
    fireEvent.click(view.getByRole('button', { name: new RegExp(label) }));
    expect(onChoose).toHaveBeenLastCalledWith(destination);
  }
  expect(onChoose).toHaveBeenCalledTimes(6);
});
