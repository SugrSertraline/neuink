import { describe, expect, it } from 'vitest';

import { resolveAssistantRunStatus } from './AssistantRunStatus';

describe('resolveAssistantRunStatus', () => {
  it('shows the active tool phase', () => {
    expect(resolveAssistantRunStatus({
      busy: true,
      error: null,
      queued: false,
      streaming: false,
      toolEvents: [{ id: '1', status: 'running', toolName: 'search_segments' }]
    }).label).toBe('正在检索');
  });

  it('shows answering while content is streaming', () => {
    expect(resolveAssistantRunStatus({
      busy: true,
      error: null,
      queued: false,
      streaming: true,
      toolEvents: []
    }).label).toBe('正在回答');
  });
});
