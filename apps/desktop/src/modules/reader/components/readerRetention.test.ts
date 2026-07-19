import { describe, expect, it } from 'vitest';

import type { WorkspaceSurface } from '@/app/workspaceSurface';

import {
  hasHeavyReaderIdleExpired,
  HEAVY_READER_IDLE_UNMOUNT_MS,
  isHeavyReaderSurface
} from './readerRetention';

describe('reader retention', () => {
  it('expires a hidden heavy reader after five minutes', () => {
    expect(hasHeavyReaderIdleExpired(1_000, 1_000 + HEAVY_READER_IDLE_UNMOUNT_MS - 1)).toBe(false);
    expect(hasHeavyReaderIdleExpired(1_000, 1_000 + HEAVY_READER_IDLE_UNMOUNT_MS)).toBe(true);
  });

  it('only treats PDF and reflow surfaces as heavy readers', () => {
    expect(isHeavyReaderSurface({ kind: 'pdf', entryId: 'entry-a' })).toBe(true);
    expect(isHeavyReaderSurface({ kind: 'reflow', entryId: 'entry-a' })).toBe(true);
    expect(isHeavyReaderSurface({ kind: 'library' } as WorkspaceSurface)).toBe(false);
  });
});
