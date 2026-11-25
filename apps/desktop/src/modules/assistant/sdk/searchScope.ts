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

const ENTRY_ID_HINT = '请使用 Current Scope 中的 entry_id，而非论文标题或文件名。';
const NOT_IN_LIBRARY = `检索条目不在当前资料库中，未检索。${ENTRY_ID_HINT}`;
const OUTSIDE_FROZEN = `检索条目超出冻结范围，不能自动扩大到其他论文。${ENTRY_ID_HINT}`;

/**
 * Map a model-supplied token to one allowed entry. An exact id wins. A title
 * matches only when it is unique inside `allowedEntries`. Nothing outside that
 * list is considered, `.pdf` is not stripped, and any tie returns null.
 */
export function resolveAllowedEntryId(raw: string, allowedEntries: readonly LibraryEntryRef[]): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (allowedEntries.some((entry) => entry.id === trimmed)) return trimmed;
  const exact = allowedEntries.filter((entry) => entry.title.trim() === trimmed);
  if (exact.length === 1) return exact[0]?.id ?? null;
  if (exact.length > 1) return null;
  const folded = allowedEntries.filter((entry) => entry.title.trim().toLowerCase() === trimmed.toLowerCase());
  return folded.length === 1 ? folded[0]?.id ?? null : null;
}

/** Resolve every token, or return null when any token is missing or ambiguous. */
export function resolveAllowedEntryIds(
  rawIds: readonly string[],
  allowedEntries: readonly LibraryEntryRef[]
): string[] | null {
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawIds) {
    const id = resolveAllowedEntryId(raw, allowedEntries);
    if (!id) return null;
    if (!seen.has(id)) {
      seen.add(id);
      resolved.push(id);
    }
  }
  return resolved;
}

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
  const allowedEntries = frozenIds
    ? libraryEntries.filter((entry) => frozenIds.includes(entry.id))
    : libraryEntries;
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const raw of requested) {
    const id = resolveAllowedEntryId(raw, allowedEntries);
    if (id) {
      if (!seen.has(id)) {
        seen.add(id);
        resolved.push(id);
      }
      continue;
    }
    const libraryHit = resolveAllowedEntryId(raw, libraryEntries);
    if (frozenIds && libraryHit && !frozenIds.includes(libraryHit)) {
      return { status: 'invalid', message: OUTSIDE_FROZEN };
    }
    return { status: 'invalid', message: NOT_IN_LIBRARY };
  }
  return { status: 'resolved', scope_kind: scopeKindFor(resolved), entry_ids: resolved };
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
