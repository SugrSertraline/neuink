// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRelationHover } from './useRelationHover';

describe('relation hover ownership', () => {
  it('does not flicker when the canvas loses its ray target underneath a DOM label', () => {
    const { result } = renderHook(() => useRelationHover());
    act(() => result.current.setCanvas('a'));
    act(() => result.current.setLabel('a'));
    act(() => result.current.setCanvas(null));
    expect(result.current.hoveredId).toBe('a');
    act(() => result.current.setCanvas('b'));
    expect(result.current.hoveredId).toBe('a');
    act(() => result.current.setLabel(null));
    expect(result.current.hoveredId).toBeNull();
    act(() => result.current.setCanvas('b'));
    expect(result.current.hoveredId).toBe('b');
  });
  it('retains keyboard focus after pointer exit and clears all ownership when deactivated', () => {
    const { result } = renderHook(() => useRelationHover());
    act(() => result.current.setFocus('a'));
    act(() => result.current.setLabel('b'));
    expect(result.current.hoveredId).toBe('b');
    act(() => result.current.setLabel(null));
    expect(result.current.hoveredId).toBe('a');
    act(() => result.current.clear());
    expect(result.current.hoveredId).toBeNull();
    act(() => result.current.setCanvas('c'));
    act(() => result.current.setFocus(null));
    expect(result.current.hoveredId).toBe('c');
    act(() => window.dispatchEvent(new Event('blur')));
    expect(result.current.hoveredId).toBeNull();
  });
});
