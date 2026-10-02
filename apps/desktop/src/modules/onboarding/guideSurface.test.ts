import { describe, expect, it } from 'vitest';
import { surfaceKey, type WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import { GUIDE_STEPS } from './catalog';
import { guideSurfaceKey } from './guideSurface';

const step = (id: string) => GUIDE_STEPS.find(step => step.id === id)!;
const layout: WorkspaceSurfaceLayout = {
  focusedPane:'right', left:{ kind:'pdf', entryId:'user' }, right:{ kind:'pdf', entryId:'demo', viewId:'right-view' },
  leftTabs:[], rightTabs:[],
};

describe('teaching surface identity', () => {
  it('selects the bound visible view and preserves its view identity', () => {
    expect(guideSurfaceKey(step('annotation'), layout, 'demo', null)).toBe(surfaceKey(layout.right!));
    expect(guideSurfaceKey(step('annotation'), { ...layout, focusedPane:'left' }, 'demo', null)).toBe(surfaceKey(layout.right!));
  });
  it('does not use a different entry, kind, note, or a retained hidden tab', () => {
    expect(guideSurfaceKey(step('annotation'), layout, 'missing', null)).toBeNull();
    expect(guideSurfaceKey(step('reflow'), layout, 'demo', null)).toBeNull();
    expect(guideSurfaceKey(step('write-note'), { ...layout, right:{ kind:'note', entryId:'demo', noteId:'old' },
      rightTabs:[{ kind:'note', entryId:'demo', noteId:'current' }] }, 'demo', 'current')).toBeNull();
  });
  it('keeps the right-side translation lesson on the right duplicate even when the left is focused', () => {
    const split = { ...layout, focusedPane:'left' as const, left:{ kind:'pdf' as const, entryId:'demo' } };
    expect(guideSurfaceKey(step('split-translation'), split, 'demo', null)).toBe(surfaceKey(split.right!));
    expect(guideSurfaceKey(step('split-translation'), { ...split, right:layout.left }, 'demo', null)).toBeNull();
  });
  it('leaves navigation and shared sidebar lessons outside document scoping', () => {
    expect(guideSurfaceKey(step('welcome'), layout, 'demo', null)).toBeUndefined();
    expect(guideSurfaceKey(step('nav-details'), layout, 'demo', null)).toBeUndefined();
  });
});
