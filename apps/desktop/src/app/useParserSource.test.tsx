// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { readParserSource, useParserSource } from './useParserSource';

afterEach(() => { cleanup(); window.localStorage.clear(); });
it('restores the selected account service after restart', () => {
  window.localStorage.setItem('neuink.parserEndpoint', 'neuink-account');
  expect(readParserSource()).toBe('neuink-account');
  expect(renderHook(() => useParserSource()).result.current[0]).toBe('neuink-account');
});
it('updates an already mounted application when login selects account parsing', () => {
  const { result } = renderHook(() => useParserSource());
  expect(result.current[0]).toBe('');
  act(() => {
    window.localStorage.setItem('neuink.parserEndpoint', 'neuink-account');
    window.dispatchEvent(new Event('neuink-parser-source-changed'));
  });
  expect(result.current[0]).toBe('neuink-account');
});
