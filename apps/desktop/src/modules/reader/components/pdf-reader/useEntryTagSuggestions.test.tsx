// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LlmSettingsState } from '@/shared/ipc/assistantApi';

const mocks = vi.hoisted(() => ({
  analyzeEntryTags: vi.fn(),
  getLlmSettings: vi.fn(),
  notify: vi.fn(),
  subscribeLlmSettings: vi.fn(() => () => undefined),
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

beforeEach(() => {
  window.localStorage.clear();
  mocks.analyzeEntryTags.mockReset();
  mocks.getLlmSettings.mockReset();
  mocks.notify.mockReset();
  mocks.subscribeLlmSettings.mockClear();
  mocks.analyzeEntryTags.mockResolvedValue({ recommendations: [], policy_version: '1' });
});

afterEach(cleanup);

describe('useEntryTagSuggestions', () => {
  it('does not run automatic tag analysis when no assistant model is configured', async () => {
    mocks.getLlmSettings.mockResolvedValue(settings(null));

    renderHook(() => useEntryTagSuggestions(options));

    await waitFor(() => expect(mocks.getLlmSettings).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.analyzeEntryTags).not.toHaveBeenCalled());
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('waits for an explicit generation action even when an assistant model is available', async () => {
    mocks.getLlmSettings.mockResolvedValue(settings('assistant-profile'));

    const { result } = renderHook(() => useEntryTagSuggestions(options));

    await waitFor(() => expect(result.current.disabledReason).toBeNull());
    expect(mocks.analyzeEntryTags).not.toHaveBeenCalled();
    await act(() => result.current.generate());

    await waitFor(() => expect(mocks.analyzeEntryTags).toHaveBeenCalledWith({
      entryId: 'entry-1',
      instruction: 'Suggest useful tags for this paper.',
      root: 'C:/workspace',
    }));
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
