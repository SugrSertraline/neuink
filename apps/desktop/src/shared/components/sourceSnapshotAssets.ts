import { convertFileSrc } from '@tauri-apps/api/core';
import { isMineruImagePath } from './sourceSnapshotMath';

export function resolveSourceSnapshotAssetUrl(
  value: string,
  workspaceRoot?: string | null,
  sourceEntryId?: string | null
) {
  const normalized = value.trim().replace(/^<|>$/g, '');
  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }
  if (/^(?:data:|blob:|file:)/i.test(normalized)) {
    return normalized;
  }
  if (isAbsoluteLocalPath(normalized)) {
    try {
      return convertFileSrc(normalized);
    } catch {
      return null;
    }
  }
  if (!workspaceRoot || !sourceEntryId) {
    return null;
  }

  if (!isMineruImagePath(normalized) && !looksLikeLocalRelativePath(normalized)) {
    return null;
  }

  const relative = normalized
    .replace(/^[./\\]+/, '')
    .replace(/\//g, '\\');
  const root = `${workspaceRoot}\\entries\\${sourceEntryId}`;

  if (isNoteAssetPath(relative)) {
    try {
      return convertFileSrc(`${root}\\notes\\${relative}`);
    } catch {
      return null;
    }
  }

  const mineruRelative = relative.replace(/^mineru-output[\\/]/i, '');
  try {
    return convertFileSrc(`${root}\\mineru-output\\${mineruRelative}`);
  } catch {
    return null;
  }
}

export function resolveMineruAssetUrl(
  value: string,
  workspaceRoot?: string | null,
  sourceEntryId?: string | null
) {
  return resolveSourceSnapshotAssetUrl(value, workspaceRoot, sourceEntryId);
}


function looksLikeLocalRelativePath(value: string) {
  return /^(?:\.{1,2}[\\/]|[A-Za-z0-9._-]+[\\/])/.test(value.trim());
}

function isNoteAssetPath(value: string) {
  return /^[^\\/]+\.assets[\\/]/i.test(value.trim());
}

function isAbsoluteLocalPath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value.trim()) || value.trim().startsWith('\\\\') || value.trim().startsWith('/');
}
