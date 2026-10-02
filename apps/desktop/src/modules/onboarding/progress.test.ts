// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { GUIDE_STEPS, GUIDE_TASKS } from './catalog';
import { freshProgress, GUIDE_STORAGE_KEY, readProgress, resolveStep } from './progress';

describe('tutorial progress', () => {
  beforeEach(() => localStorage.clear());
  it('has unique steps and discoverable task groups', () => {
    expect(new Set(GUIDE_STEPS.map(step => step.id)).size).toBe(GUIDE_STEPS.length);
    expect(GUIDE_TASKS.length).toBe(9);
    expect(GUIDE_STEPS.every(step => step.instructions.length >= 3)).toBe(true);
  });
  it('recovers from corrupt and unsupported storage', () => {
    for (const value of ['broken', JSON.stringify({ version:7 })]) {
      localStorage.setItem(GUIDE_STORAGE_KEY, value);
      expect(readProgress()).toEqual(freshProgress());
    }
  });
  it('sanitizes unknown ids, duplicates, and completed/skipped conflicts', () => {
    localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify({ version:1, current:'wrong', completed:['welcome','welcome','unknown'], skipped:['welcome','import',42], seen:true }));
    expect(readProgress()).toMatchObject({ current:'welcome', completed:['welcome'], skipped:[], seen:true });
  });
  it('does not pretend a skipped step is complete and allows revisiting it', () => {
    const skipped = resolveStep(freshProgress(), true);
    expect(skipped.completed).toEqual([]);
    expect(skipped.skipped).toEqual(['welcome']);
    const revised = resolveStep({ ...skipped, current:'welcome' }, false);
    expect(revised.completed).toEqual(['welcome']);
    expect(revised.skipped).toEqual([]);
    expect(revised.current).toBe('open-pdf');
  });
  it('clamps at the last step without duplication', () => {
    const last = { ...freshProgress(), current:GUIDE_STEPS[GUIDE_STEPS.length - 1].id };
    const done = resolveStep(resolveStep(last, false), false);
    expect(done.current).toBe(last.current);
    expect(done.completed).toEqual([last.current]);
  });
  it('removes the transient import step from the catalog and restores old progress to PDF', () => {
    expect(GUIDE_STEPS[1].id).toBe('open-pdf');
    expect(GUIDE_STEPS.some(step => step.id === 'import')).toBe(false);
    localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify({ ...freshProgress(), current:'import' }));
    expect(readProgress().current).toBe('open-pdf');
  });
});
