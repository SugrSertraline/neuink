import { describe, expect, it } from 'vitest';
import {
  resolveAllowedEntryId,
  resolveAllowedEntryIds,
  resolveSearchScope,
  scopeRequestFromToolInput,
  type FrozenScope,
  type LibraryEntryRef
} from './searchScope';

const LIBRARY = [
  { id: 'a', title: 'Paper A' },
  { id: 'b', title: 'Paper B' },
  { id: 'c', title: 'Paper C' }
];
const library: FrozenScope = { intent: 'library', entry_ids: [] };
const selection = (...entryIds: string[]): FrozenScope => ({ intent: 'selection', entry_ids: entryIds });

describe('resolveSearchScope', () => {
  it('searches the whole library when nothing is requested and the scope is library intent', () => {
    expect(resolveSearchScope({ kind: 'unspecified' }, library, LIBRARY)).toEqual({ status: 'library' });
  });

  it('uses the frozen selection when nothing is requested', () => {
    expect(resolveSearchScope({ kind: 'unspecified' }, selection('a'), LIBRARY)).toEqual({
      status: 'resolved',
      scope_kind: 'explicit_single',
      entry_ids: ['a']
    });
    expect(resolveSearchScope({ kind: 'unspecified' }, selection('a', 'b'), LIBRARY)).toEqual({
      status: 'resolved',
      scope_kind: 'explicit_multi',
      entry_ids: ['a', 'b']
    });
  });

  it('treats an explicit empty selection as no results, never as the whole library', () => {
    expect(resolveSearchScope({ kind: 'unspecified' }, selection(), LIBRARY)).toEqual({
      status: 'empty',
      scope_kind: 'explicit_multi'
    });
  });

  it('narrows the library to an existing requested ID', () => {
    expect(resolveSearchScope({ kind: 'explicit_multi', entry_ids: ['a', 'b'] }, library, LIBRARY)).toEqual({
      status: 'resolved',
      scope_kind: 'explicit_multi',
      entry_ids: ['a', 'b']
    });
  });

  it('intersects a requested ID list with the frozen selection and rejects out-of-scope IDs without throwing', () => {
    expect(resolveSearchScope({ kind: 'explicit_multi', entry_ids: ['a'] }, selection('a', 'b'), LIBRARY)).toEqual({
      status: 'resolved',
      scope_kind: 'explicit_single',
      entry_ids: ['a']
    });
    expect(resolveSearchScope({ kind: 'explicit_multi', entry_ids: ['a', 'c'] }, selection('a', 'b'), LIBRARY)).toEqual({
      status: 'invalid',
      message: '检索条目超出冻结范围，不能自动扩大到其他论文。请使用 Current Scope 中的 entry_id，而非论文标题或文件名。'
    });
  });

  it('rejects a nonexistent ID even when the frozen scope is the whole library', () => {
    expect(resolveSearchScope({ kind: 'explicit_single', entry_ids: ['zzz'] }, library, LIBRARY)).toEqual({
      status: 'invalid',
      message: '检索条目不在当前资料库中，未检索。请使用 Current Scope 中的 entry_id，而非论文标题或文件名。'
    });
    expect(resolveSearchScope({ kind: 'explicit_single', entry_ids: ['a'] }, library, [])).toMatchObject({ status: 'invalid' });
  });

  it('treats an explicitly empty request as no results, not full library', () => {
    expect(resolveSearchScope({ kind: 'explicit_multi', entry_ids: [] }, library, LIBRARY)).toEqual({
      status: 'empty',
      scope_kind: 'explicit_multi'
    });
    expect(resolveSearchScope({ kind: 'explicit_single', entry_ids: [] }, selection('a'), LIBRARY)).toEqual({
      status: 'empty',
      scope_kind: 'explicit_single'
    });
  });

  it('reports unresolved scope so the caller asks for clarification', () => {
    expect(resolveSearchScope({ kind: 'unspecified' }, { intent: 'unresolved', entry_ids: ['a'] }, LIBRARY)).toEqual({
      status: 'unresolved'
    });
  });

  it('deduplicates and trims ids', () => {
    expect(resolveSearchScope({ kind: 'explicit_multi', entry_ids: [' a ', 'a', ''] }, library, LIBRARY)).toEqual({
      status: 'resolved',
      scope_kind: 'explicit_single',
      entry_ids: ['a']
    });
  });
});

const TITLED: LibraryEntryRef[] = [
  { id: 'Kk7-HVa15guV-M2X', title: '3830397.3841887.pdf-1933de06-bc45-4c67-960b-c28664d93a10' },
  { id: 'MeZ6gjESjMdVABhs', title: '2026.acl-long.818.pdf' },
  { id: 'c6RD33rP-Jg3kGQA', title: '2026.acl-long.818' }
];

describe('resolveAllowedEntryId', () => {
  it('accepts an exact entry id before any title', () => {
    expect(resolveAllowedEntryId(' MeZ6gjESjMdVABhs ', TITLED)).toBe('MeZ6gjESjMdVABhs');
    expect(resolveAllowedEntryIds(['Kk7-HVa15guV-M2X', 'Kk7-HVa15guV-M2X'], TITLED)).toEqual(['Kk7-HVa15guV-M2X']);
  });

  it('maps a unique exact title, including a long filename, to its entry id', () => {
    expect(resolveAllowedEntryId('3830397.3841887.pdf-1933de06-bc45-4c67-960b-c28664d93a10', TITLED))
      .toBe('Kk7-HVa15guV-M2X');
    expect(resolveSearchScope(
      { kind: 'explicit_single', entry_ids: ['3830397.3841887.pdf-1933de06-bc45-4c67-960b-c28664d93a10'] },
      library,
      TITLED
    )).toEqual({
      status: 'resolved',
      scope_kind: 'explicit_single',
      entry_ids: ['Kk7-HVa15guV-M2X']
    });
  });

  it('keeps a .pdf suffix as part of the title and does not merge the two ACL entries', () => {
    expect(resolveAllowedEntryId('2026.acl-long.818.pdf', TITLED)).toBe('MeZ6gjESjMdVABhs');
    expect(resolveAllowedEntryId('2026.acl-long.818', TITLED)).toBe('c6RD33rP-Jg3kGQA');
    expect(resolveAllowedEntryId('2026.ACL-LONG.818.PDF', TITLED)).toBe('MeZ6gjESjMdVABhs');
  });

  it('fails closed on an ambiguous title, a partial title, or a title outside the allowed set', () => {
    const ambiguous = [
      ...TITLED,
      { id: 'other', title: '2026.acl-long.818.pdf' }
    ];
    expect(resolveAllowedEntryId('2026.acl-long.818.pdf', ambiguous)).toBeNull();
    expect(resolveAllowedEntryId('2026.acl-long', TITLED)).toBeNull();
    expect(resolveAllowedEntryId('not-in-scope.pdf', TITLED)).toBeNull();
    expect(resolveAllowedEntryIds(['2026.acl-long.818.pdf', 'missing'], TITLED)).toBeNull();
    const outside = resolveSearchScope(
      { kind: 'explicit_single', entry_ids: ['2026.acl-long.818.pdf'] },
      selection('Kk7-HVa15guV-M2X'),
      TITLED
    );
    expect(outside).toMatchObject({ status: 'invalid' });
    if (outside.status === 'invalid') expect(outside.message).toContain('超出冻结范围');
    const tied = resolveSearchScope(
      { kind: 'explicit_multi', entry_ids: ['2026.acl-long.818.pdf'] },
      library,
      ambiguous
    );
    expect(tied).toMatchObject({ status: 'invalid' });
    if (tied.status === 'invalid') expect(tied.message).toContain('entry_id');
  });
});

describe('scopeRequestFromToolInput', () => {
  it('maps absent input to unspecified', () => {
    expect(scopeRequestFromToolInput(undefined)).toEqual({ kind: 'unspecified' });
    expect(scopeRequestFromToolInput(null)).toEqual({ kind: 'unspecified' });
  });

  it('maps a single id to explicit_single and many ids to explicit_multi', () => {
    expect(scopeRequestFromToolInput(['a'])).toEqual({ kind: 'explicit_single', entry_ids: ['a'] });
    expect(scopeRequestFromToolInput(['a', 'b'])).toEqual({ kind: 'explicit_multi', entry_ids: ['a', 'b'] });
  });

  it('maps an empty array to an explicit empty scope', () => {
    expect(scopeRequestFromToolInput([])).toEqual({ kind: 'explicit_multi', entry_ids: [] });
  });

  it('rejects non-array input and non-string items', () => {
    expect(() => scopeRequestFromToolInput('a')).toThrow('必须是条目 ID 数组');
    expect(() => scopeRequestFromToolInput(['a', 3])).toThrow('必须是条目 ID 数组');
  });
});
