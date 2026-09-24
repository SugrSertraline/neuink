// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListHoverPreview } from './ListHoverPreview';
import type { ListItemRegion } from './listItemRegions';
afterEach(cleanup);
const left: ListItemRegion = { text: '[1] Left source', bbox: [60, 200, 430, 280] };
const right: ListItemRegion = { text: '[12] Right source', bbox: [560, 200, 930, 280] };
describe('bibliography list hover geometry', () => {
  it('highlights the matching printed number even when region order differs from text order', () => {
    const hover = vi.fn();
    render(<ListHoverPreview text={'[1] Left source\n[12] Right source'} regions={[right, left]} onItemHover={hover} />);
    fireEvent.pointerEnter(screen.getByText('Right source').closest('li')!);
    expect(hover).toHaveBeenLastCalledWith(right.bbox);
    fireEvent.pointerLeave(screen.getByText('Right source').closest('li')!);
    expect(hover).toHaveBeenLastCalledWith(null);
    fireEvent.pointerEnter(screen.getByText('Left source').closest('li')!);
    expect(hover).toHaveBeenLastCalledWith(left.bbox);
  });
  it('matches unnumbered regions by content and refuses ambiguous or missing ones', () => {
    const hover = vi.fn();
    render(<ListHoverPreview text={'[1] Left source\n[12] Right source\n[13] Missing source'} regions={[
      { ...right, text: 'Right source' }, { ...left, text: 'Left source' }, { ...right, text: 'Left source' }
    ]} onItemHover={hover} />);
    fireEvent.pointerEnter(screen.getByText('Right source').closest('li')!);
    expect(hover).toHaveBeenLastCalledWith(right.bbox);
    fireEvent.pointerEnter(screen.getByText('Left source').closest('li')!);
    expect(hover).toHaveBeenLastCalledWith(null);
    fireEvent.pointerEnter(screen.getByText('Missing source').closest('li')!);
    expect(hover).toHaveBeenLastCalledWith(null);
  });
});
