import { describe, expect, it } from 'vitest';
import { resolveSearchScope, scopeRequestFromToolInput, type FrozenScope } from './searchScope';

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
      message: '检索条目超出冻结范围，不能自动扩大到其他论文。'
    });
  });

  it('rejects a nonexistent ID even when the frozen scope is the whole library', () => {
    expect(resolveSearchScope({ kind: 'explicit_single', entry_ids: ['zzz'] }, library, LIBRARY)).toEqual({
      status: 'invalid',
      message: '检索条目不在当前资料库中，未检索。'
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
