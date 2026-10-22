// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SourceSegment } from '@/shared/types/domain';

import { useGuardedSegmentAction } from './useGuardedSegmentAction';

describe('useGuardedSegmentAction', () => {
  it('runs a segment action in the pointer event turn', () => {
    const action = vi.fn();
    const segment = { uid: 'segment-1' } as SourceSegment;
    const { result } = renderHook(() => useGuardedSegmentAction(action));

    act(() => result.current(segment));

    expect(action).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledWith(segment);
  });

  it('does not swallow a quick follow-up action for the same segment', () => {
    const action = vi.fn();
    const segment = { uid: 'segment-1' } as SourceSegment;
    const { result } = renderHook(() => useGuardedSegmentAction(action));

    act(() => {
      result.current(segment);
      result.current(segment);
    });

    expect(action).toHaveBeenCalledTimes(2);
  });
  it('forwards the hovered sentence index with the selected segment', () => {
    const action = vi.fn((_segment: SourceSegment, _sentenceIndex?: number) => undefined);
    const segment = { uid: 'segment-1' } as SourceSegment;
    const { result } = renderHook(() => useGuardedSegmentAction(action));
    act(() => result.current(segment, 2));
    expect(action).toHaveBeenCalledWith(segment, 2);
  });
});
