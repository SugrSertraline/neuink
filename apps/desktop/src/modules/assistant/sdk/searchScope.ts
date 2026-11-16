import type { ScopeIntent, ScopeSnapshot } from '@/shared/ipc/assistantApi';
import type { ScopeKind } from './retrievalPlanning';

/**
 * Host-side scope resolution for the unified `search_library` tool.
 *
 * The frozen run scope carries an explicit intent. Entry lists alone cannot tell
 * "whole library" from "these papers", and an empty list must never mean "all".
 * The planner only guesses `scope_kind`; the host decides what may be searched.
 */

export type ScopeRequest =
  | { kind: 'unspecified' }
  | { kind: 'explicit_single' | 'explicit_multi'; entry_ids: string[] };

export type FrozenScope = {
  intent: ScopeIntent;
  entry_ids: string[];
  /** The frozen selection came from a Tag, so its results report `explicit_tag`. Absent means false. */
  tagged?: boolean;
};

export type LibraryEntryRef = { id: string; title: string };

export type ResolvedSearchScope =
  | { status: 'library' }
  | { status: 'resolved'; scope_kind: ScopeKind; entry_ids: string[] }
  | { status: 'empty'; scope_kind: ScopeKind }
  | { status: 'unresolved' }
  | { status: 'invalid'; message: string };

const SCOPE_INTENTS: ReadonlySet<string> = new Set(['library', 'selection', 'unresolved']);

function uniqueNonEmpty(ids: readonly string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function scopeKindFor(ids: string[]): 'explicit_single' | 'explicit_multi' {
  return ids.length === 1 ? 'explicit_single' : 'explicit_multi';
}

/**
 * Snapshots written before `scope_intent` existed: an empty list meant the full library,
 * a non-empty list meant the selected papers. Unknown intent strings fail closed.
 */
export function frozenScopeFromSnapshot(
  snapshot: Pick<ScopeSnapshot, 'entry_ids' | 'scope_intent'> & Partial<Pick<ScopeSnapshot, 'tag_ids'>>
): FrozenScope {
  const entryIds = uniqueNonEmpty(snapshot.entry_ids);
  const tagged = (snapshot.tag_ids ?? []).length > 0;
  if (snapshot.scope_intent === undefined || snapshot.scope_intent === null) {
    // A snapshot that named a Tag was a selection even when no entry survived, so its empty list stays empty.
    if (tagged) return { intent: 'selection', entry_ids: entryIds, tagged: true };
    return entryIds.length === 0
      ? { intent: 'library', entry_ids: [], tagged: false }
      : { intent: 'selection', entry_ids: entryIds, tagged: false };
  }
  const intent = SCOPE_INTENTS.has(snapshot.scope_intent) ? snapshot.scope_intent : 'unresolved';
  return { intent, entry_ids: entryIds, tagged: tagged && intent === 'selection' };
}

export function resolveSearchScope(
  request: ScopeRequest,
  frozen: FrozenScope,
  libraryEntries: readonly LibraryEntryRef[]
): ResolvedSearchScope {
  if (frozen.intent === 'unresolved') return { status: 'unresolved' };
  const libraryIds = new Set(libraryEntries.map((entry) => entry.id));
  const frozenIds = frozen.intent === 'selection' ? uniqueNonEmpty(frozen.entry_ids) : null;
  const frozenKind: ScopeKind = frozen.tagged ? 'explicit_tag' : 'explicit_multi';

  if (request.kind === 'unspecified') {
    if (!frozenIds) return { status: 'library' };
    if (frozenIds.length === 0) return { status: 'empty', scope_kind: frozenKind };
    if (frozenIds.some((id) => !libraryIds.has(id))) {
      return { status: 'invalid', message: '所选论文或标签中的部分条目已不在当前资料库中，未检索。请重新选择要检索的论文。' };
    }
    return { status: 'resolved', scope_kind: frozen.tagged ? 'explicit_tag' : scopeKindFor(frozenIds), entry_ids: frozenIds };
  }

  const requested = uniqueNonEmpty(request.entry_ids);
  if (requested.length === 0) {
    // Explicitly empty scope: report no results, never fall back to the library.
    return { status: 'empty', scope_kind: request.kind };
  }
  if (requested.some((id) => !libraryIds.has(id))) {
    return { status: 'invalid', message: '检索条目不在当前资料库中，未检索。' };
  }
  if (frozenIds && requested.some((id) => !frozenIds.includes(id))) {
    return { status: 'invalid', message: '检索条目超出冻结范围，不能自动扩大到其他论文。' };
  }
  return { status: 'resolved', scope_kind: scopeKindFor(requested), entry_ids: requested };
}

/** Map the raw `scope_entry_ids` tool argument to an explicit scope request. */
export function scopeRequestFromToolInput(scopeEntryIds: unknown): ScopeRequest {
  if (scopeEntryIds == null) return { kind: 'unspecified' };
  if (!Array.isArray(scopeEntryIds) || scopeEntryIds.some((id) => typeof id !== 'string')) {
    throw new Error('scope_entry_ids 必须是条目 ID 数组。');
  }
  const entryIds = uniqueNonEmpty(scopeEntryIds);
  return {
    kind: entryIds.length === 1 ? 'explicit_single' : 'explicit_multi',
    entry_ids: entryIds
  };
}
