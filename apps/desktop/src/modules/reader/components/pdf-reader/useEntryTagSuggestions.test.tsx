// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { ReadingViewSession } from '../navigation/ReadingViewSession';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LlmSettingsState } from '@/shared/ipc/assistantApi';

const mocks = vi.hoisted(() => ({
  analyzeEntryTags: vi.fn(),
  getLlmSettings: vi.fn(),
  notify: vi.fn(),
  subscribeLlmSettings: vi.fn((_listener: (settings: LlmSettingsState) => void) => () => undefined),
}));

vi.mock('@/shared/ipc/assistantApi', () => ({
  analyzeEntryTags: mocks.analyzeEntryTags,
  getLlmSettings: mocks.getLlmSettings,
  subscribeLlmSettings: mocks.subscribeLlmSettings,
}));

vi.mock('@/shared/hooks/useToast', () => ({
  useToast: () => ({ notify: mocks.notify }),
}));

import { useEntryTagSuggestions } from './useEntryTagSuggestions';
import { readTagSuggestions, tagSuggestionKey } from './entryTagSuggestionStore';

let sequence = 0;
beforeEach(() => {
  options.workspaceRoot = `C:/workspace-${++sequence}`;
  options.onApplyEntryTagPaths.mockReset();
  window.localStorage.clear();
  mocks.analyzeEntryTags.mockReset();
  mocks.getLlmSettings.mockReset();
  mocks.notify.mockReset();
  mocks.subscribeLlmSettings.mockReset().mockImplementation(() => () => undefined);
  mocks.analyzeEntryTags.mockResolvedValue({ recommendations: [], policy_version: '1' });
});

afterEach(cleanup);

describe('useEntryTagSuggestions', () => {
  it('hides the reader entry after confirming only some tags, while details can regenerate without restoring it', async () => {
    mocks.getLlmSettings.mockResolvedValue(settings('model'));
    mocks.analyzeEntryTags.mockResolvedValue({ recommendations: ['first', 'second'].map(path => ({ path, confidence: .9, reason: '相关', dimension: '主题', source: 'new' })), policy_version: '1' });
    const hook = renderHook(() => useEntryTagSuggestions(options));
    await waitFor(() => expect(hook.result.current.recommendations).toHaveLength(2));
    act(() => { hook.result.current.setOpen(true); });
    act(() => { hook.result.current.setOpen(false); });
    expect(hook.result.current.showInReader).toBe(true);
    act(() => hook.result.current.toggleRecommendation(hook.result.current.recommendations[1]));
    await act(() => hook.result.current.apply());
    expect(options.onApplyEntryTagPaths).toHaveBeenCalledWith('entry-1', ['first']);
    expect(hook.result.current.recommendations.map(tag => tag.path)).toEqual(['second']);
    expect(hook.result.current.showInReader).toBe(false);
    await act(() => hook.result.current.generate());
    expect(hook.result.current.showInReader).toBe(false);
    expect(hook.result.current.recommendations).toHaveLength(2);
  });

  it('keeps failed saves visible, then persists rejection without applying or regenerating', async () => {
    mocks.getLlmSettings.mockResolvedValue(settings('model'));
    mocks.analyzeEntryTags.mockResolvedValue({ recommendations: [{ path: 'pending', confidence: .9, reason: '相关', dimension: '主题', source: 'new' }], policy_version: '1' });
    options.onApplyEntryTagPaths.mockRejectedValue(new Error('写入失败'));
    let hook = renderHook(() => useEntryTagSuggestions(options));
    await waitFor(() => expect(hook.result.current.recommendations).toHaveLength(1));
    await act(() => hook.result.current.apply());
    expect(hook.result.current.showInReader).toBe(true);
    expect(hook.result.current.error).toContain('写入失败');
    act(() => hook.result.current.discard());
    expect(hook.result.current.showInReader).toBe(false);
    const saved = JSON.parse(localStorage.getItem(`neuink.entryTagRecommendations.v1:${tagSuggestionKey(options.workspaceRoot, options.entry.id)}`)!);
    expect(saved.decision).toBe('dismissed');
    hook.unmount(); hook = renderHook(() => useEntryTagSuggestions(options));
    await waitFor(() => expect(hook.result.current.disabledReason).toBeNull());
    expect(hook.result.current.showInReader).toBe(false);
    expect(mocks.analyzeEntryTags).toHaveBeenCalledOnce();
  });
  it('does not run automatic tag analysis when no assistant model is configured', async () => {
    mocks.getLlmSettings.mockResolvedValue(settings(null));

    renderHook(() => useEntryTagSuggestions(options));

    await waitFor(() => expect(mocks.getLlmSettings).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.analyzeEntryTags).not.toHaveBeenCalled());
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('generates once automatically across StrictMode and split readers without applying tags', async () => {
    mocks.getLlmSettings.mockResolvedValue(settings('assistant-profile'));

    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useEntryTagSuggestions(options), { wrapper });
    const other = renderHook(() => useEntryTagSuggestions(options), { wrapper });
    await waitFor(() => expect(result.current.generatedAt).toBeTruthy());
    expect(other.result.current.generatedAt).toBe(result.current.generatedAt);
    expect(mocks.analyzeEntryTags).toHaveBeenCalledExactlyOnceWith({
      entryId: 'entry-1',
      instruction: 'Suggest useful tags for this paper.',
      root: options.workspaceRoot,
    });
    expect(options.onApplyEntryTagPaths).not.toHaveBeenCalled();
  });

  it('shares pending recommendations between entry detail and PDF reading without auto-saving', async () => {
    mocks.getLlmSettings.mockResolvedValue(settings('assistant-profile'));
    const paths = ['a', 'b', 'c', 'd'];
    const entry = { ...options.entry, tags: paths };
    const workspaceRoot = 'C:/shared-suggestions-test';
    const onApplyEntryTagPaths = vi.fn().mockResolvedValue(undefined);
    mocks.analyzeEntryTags.mockResolvedValue({ recommendations: ['c', 'd', 'e'].map(path => ({ path, confidence: 0.9, reason: '相关', dimension: '主题', source: 'existing' })), policy_version: '1' });
    const detail = renderHook(() => useEntryTagSuggestions({ entry, workspaceRoot, onApplyEntryTagPaths }));
    const reader = renderHook(() => useEntryTagSuggestions({ entry, workspaceRoot, onApplyEntryTagPaths }));
    await waitFor(() => expect(detail.result.current.generatedAt).toBeTruthy());
    expect(reader.result.current.recommendations.map(tag => tag.path)).toEqual(['e']);
    expect(reader.result.current.selectedPaths.has('e')).toBe(true);
    expect(onApplyEntryTagPaths).not.toHaveBeenCalled();
    await act(() => reader.result.current.apply());
    expect(onApplyEntryTagPaths).toHaveBeenCalledWith(entry.id, ['e']);
    expect(detail.result.current.recommendations).toEqual([]);
    expect(readTagSuggestions(tagSuggestionKey(workspaceRoot, entry.id)).generatedAt).toBeTruthy();
    expect(mocks.analyzeEntryTags).toHaveBeenCalledOnce();
  });

  it('waits for parsing and reacts to newly configured models without stale settings overwriting them', async () => {
    let changed!: (value: LlmSettingsState) => void, finish!: (value: LlmSettingsState) => void;
    mocks.subscribeLlmSettings.mockImplementation(listener => { changed = listener; return () => undefined; });
    mocks.getLlmSettings.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const hook = renderHook(({ parsed }) => useEntryTagSuggestions({ ...options,
      entry: { ...options.entry, status: parsed ? 'Parsed' : 'Parsing' } }), { initialProps: { parsed: false } });
    act(() => changed(settings('model')));
    expect(mocks.analyzeEntryTags).not.toHaveBeenCalled();
    hook.rerender({ parsed: true });
    await waitFor(() => expect(hook.result.current.generatedAt).toBeTruthy());
    await act(async () => finish(settings(null)));
    expect(hook.result.current.disabledReason).toBeNull();
    expect(mocks.analyzeEntryTags).toHaveBeenCalledOnce();
  });

  it('waits until a restored PDF tab becomes active', async () => {
    mocks.getLlmSettings.mockResolvedValue(settings('model'));
    let active = false;
    const wrapper = ({ children }: { children: ReactNode }) => <ReadingViewSession workspaceRoot={options.workspaceRoot}
      surface={{ kind: 'pdf', entryId: options.entry.id }} active={active}>{children}</ReadingViewSession>;
    const hook = renderHook(() => useEntryTagSuggestions(options), { wrapper });
    await waitFor(() => expect(hook.result.current.disabledReason).toBeNull());
    expect(mocks.analyzeEntryTags).not.toHaveBeenCalled();
    active = true; hook.rerender();
    await waitFor(() => expect(hook.result.current.generatedAt).toBeTruthy());
    expect(mocks.analyzeEntryTags).toHaveBeenCalledOnce();
  });

  it('does not retry a failed automatic request on rerender or remount, but allows manual retry', async () => {
    mocks.getLlmSettings.mockResolvedValue(settings('model'));
    mocks.analyzeEntryTags.mockRejectedValueOnce(new Error('连接失败')).mockResolvedValueOnce({ recommendations: [], policy_version: '1' });
    let hook = renderHook(() => useEntryTagSuggestions(options));
    await waitFor(() => expect(hook.result.current.error).toContain('连接失败'));
    hook.rerender(); hook.unmount(); hook = renderHook(() => useEntryTagSuggestions(options));
    await waitFor(() => expect(hook.result.current.disabledReason).toBeNull());
    expect(mocks.analyzeEntryTags).toHaveBeenCalledOnce();
    await act(() => hook.result.current.generate());
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.generatedAt).toBeTruthy();
  });

  it('does not generate for a stale profile id or apply through a missing write callback', async () => {
    mocks.getLlmSettings.mockResolvedValue({ ...settings(null), assistant_profile_id: 'missing' });
    const hook = renderHook(() => useEntryTagSuggestions({ ...options, onApplyEntryTagPaths: undefined }));
    await waitFor(() => expect(hook.result.current.disabledReason).toContain('配置助手模型'));
    expect(mocks.analyzeEntryTags).not.toHaveBeenCalled();
    expect(hook.result.current.canApply).toBe(false);
    await act(() => hook.result.current.apply());
    expect(mocks.notify).not.toHaveBeenCalled();
    hook.unmount();
    mocks.getLlmSettings.mockResolvedValue(settings('model'));
    mocks.analyzeEntryTags.mockResolvedValue({ recommendations: [{ path: '待添加', confidence: .9, reason: '相关', dimension: '主题', source: 'new' }], policy_version: '1' });
    const readOnly = renderHook(() => useEntryTagSuggestions({ ...options, onApplyEntryTagPaths: undefined }));
    await waitFor(() => expect(readOnly.result.current.recommendations).toHaveLength(1));
    expect(readOnly.result.current.canApply).toBe(false);
    await act(() => readOnly.result.current.apply());
    expect(readOnly.result.current.recommendations).toHaveLength(1);
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});

const options = {
  entry: {
    id: 'entry-1',
    title: 'Paper',
    tags: [],
    tagIds: [], contents: [], fields: {}, createdAt: '', updatedAt: '',
    pdfFileName: 'paper.pdf', parseMessage: null, parseEndpoint: null, progress: 100,
    status: 'Parsed' as const,
  } satisfies Parameters<typeof useEntryTagSuggestions>[0]['entry'],
  onApplyEntryTagPaths: vi.fn(),
  workspaceRoot: 'C:/workspace',
};

function settings(assistantProfileId: string | null): LlmSettingsState {
  const profile = assistantProfileId
    ? {
        api_key: null,
        api_protocol: 'openai_compatible' as const,
        base_url: 'https://example.test/v1',
        id: assistantProfileId,
        max_context_length: null,
        max_output_tokens: null,
        model: 'model',
        name: 'Assistant',
        temperature: null,
        top_p: null,
      }
    : null;
  return {
    assistant_profile: profile,
    assistant_profile_id: assistantProfileId,
    profiles: profile ? [profile] : [],
    translation_profile: null,
    translation_profile_id: null,
  };
}
