// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveReadingSplitRatio, useReadingSplit } from './ReadingSplitDivider';

afterEach(cleanup);
function Harness({ onChange, enabled = true }: { onChange: (ratio: number) => Promise<boolean>; enabled?: boolean }) {
  const split = useReadingSplit(0.5, onChange, enabled, 800);
  return <div>{split.divider}</div>;
}
it('keeps both readers at least 360 CSS pixels and accounts for its own divider width', () => {
  expect(resolveReadingSplitRatio(0.2, 800) * 800).toBe(360);
  expect(resolveReadingSplitRatio(0.8, 800) * 800).toBeCloseTo(436);
  expect(resolveReadingSplitRatio(0.5, 1000)).toBe(0.5);
});
it('uses effective visible bounds for keyboard control and ignores disabled changes', async () => {
  const save = vi.fn().mockResolvedValue(true);
  const view = render(<Harness onChange={save} />);
  const divider = screen.getByRole('separator');
  expect(divider.getAttribute('aria-valuemin')).toBe('45');
  await act(async () => fireEvent.keyDown(divider, { key: 'Home' }));
  expect(save).toHaveBeenLastCalledWith(0.45);
  await act(async () => fireEvent.keyDown(divider, { key: 'End' }));
  expect(save).toHaveBeenLastCalledWith(436 / 800);
  view.rerender(<Harness onChange={save} enabled={false} />);
  fireEvent.keyDown(divider, { key: 'ArrowLeft' });
  expect(save).toHaveBeenCalledTimes(2);
});
