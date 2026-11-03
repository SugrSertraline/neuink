import type { LlmProfile } from '@/shared/ipc/assistantApi';

import { generationSettings } from '../../assistant/sdk/provider';

// Match the native translation request policy. Chat keeps its own settings;
// arbitrary compatible gateways must not receive undocumented vendor fields.
export function translationModelSettings(profile: LlmProfile) {
  // Structure is requested in prompts and validated locally. Never guess a
  // model's JSON/reasoning capabilities from its name or service hostname.
  return generationSettings(profile);
}
