import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  saveLlmSettings,
  subscribeLlmSettings,
  type LlmSettingsState
} from './assistantApi';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

const settingsState: LlmSettingsState = {
  assistant_profile: {
    api_key: null,
    base_url: 'https://example.com/v1',
    id: 'profile-1',
    max_context_length: 128000,
    max_output_tokens: 4096,
    model: 'updated-model',
    name: 'Current model',
    temperature: 0.2,
    top_p: null
  },
  assistant_profile_id: 'profile-1',
  profiles: [],
  translation_profile: null,
  translation_profile_id: null
};

describe('LLM settings subscriptions', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('publishes the updated profile returned by saveLlmSettings', async () => {
    vi.mocked(invoke).mockResolvedValue(settingsState);
    const listener = vi.fn();
    const unsubscribe = subscribeLlmSettings(listener);

    await saveLlmSettings({
      baseUrl: 'https://example.com/v1',
      model: 'updated-model',
      name: 'Current model',
      profileId: 'profile-1'
    });

    expect(listener).toHaveBeenCalledWith(settingsState);
    unsubscribe();
  });
});
