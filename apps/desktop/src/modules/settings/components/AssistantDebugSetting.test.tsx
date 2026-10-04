// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ASSISTANT_DEBUG_STORAGE_KEY, setAssistantDebug } from '@/shared/lib/assistantDebug';
import { AssistantDebugSetting } from './AssistantDebugSetting';
import { searchSettings } from '../settingsCatalog';

afterEach(() => { cleanup(); setAssistantDebug(false); window.localStorage.clear(); });
it('offers one explicit local opt-in and is discoverable without exposing configuration values', () => {
  window.localStorage.clear();
  const ui = render(<AssistantDebugSetting />);
  const toggle = ui.getByRole('switch', { name: '助手调试信息' });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(toggle.closest('[data-setting-id]')?.getAttribute('data-setting-id')).toBe('tools-assistant-debug');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(window.localStorage.getItem(ASSISTANT_DEBUG_STORAGE_KEY)).toBe('true');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(searchSettings('调试')[0]?.id).toBe('tools-assistant-debug');
  expect(searchSettings('debug')[0]?.tab).toBe('external-tools');
});
