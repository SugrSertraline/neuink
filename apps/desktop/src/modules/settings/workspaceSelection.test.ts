import { describe, expect, it } from 'vitest';

import type { WorkspacePathInspection } from '@/shared/ipc/workspaceApi';
import { resolveWorkspaceSelection } from './workspaceSelection';

function inspection(kind: WorkspacePathInspection['kind']): WorkspacePathInspection {
  return {
    root: 'D:\\Library',
    kind,
    entry_count: 2,
    trashed_entry_count: 0,
    message: `status:${kind}`
  };
}

describe('resolveWorkspaceSelection', () => {
  it('opens a valid workspace without turning it into a migration', () => {
    expect(resolveWorkspaceSelection('switch', inspection('valid_workspace'))).toEqual({
      intent: 'switch'
    });
  });

  it('offers creation when opening an empty directory', () => {
    expect(resolveWorkspaceSelection('switch', inspection('empty_directory'))).toEqual({
      intent: 'create'
    });
  });

  it('does not initialize a non-empty ordinary directory', () => {
    expect(resolveWorkspaceSelection('switch', inspection('not_workspace'))).toEqual({
      message: 'status:not_workspace'
    });
  });

  it('only allows migration to an empty directory', () => {
    expect(resolveWorkspaceSelection('migrate', inspection('empty_directory'))).toEqual({
      intent: 'migrate'
    });
    expect(resolveWorkspaceSelection('migrate', inspection('valid_workspace'))).toEqual({
      message: 'status:valid_workspace'
    });
  });
});
