// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useStoredCollapseState } from './useStoredCollapseState';

describe('useStoredCollapseState', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults source and translation previews to collapsed', () => {
    const source = renderHook(() => useStoredCollapseState('sourceCollapsed'));
    const translation = renderHook(() =>
      useStoredCollapseState('translationCollapsed')
    );

    expect(source.result.current.collapsed).toBe(true);
    expect(translation.result.current.collapsed).toBe(true);
  });

  it('restores the last toggle state from local storage', () => {
    const first = renderHook(() =>
      useStoredCollapseState('translationCollapsed')
    );

    act(() => first.result.current.toggleCollapsed());
    first.unmount();

    const restored = renderHook(() =>
      useStoredCollapseState('translationCollapsed')
    );
    expect(restored.result.current.collapsed).toBe(false);
  });
});
