// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { PARSER_AUTO_PARSE_STORAGE_KEY, persistAutoParseOnPdfImport, readAutoParseOnPdfImport } from './parserSettings';

afterEach(() => window.localStorage.clear());

it('defaults the auto-parse preference off before the user opts in', () => {
  window.localStorage.clear();
  expect(readAutoParseOnPdfImport()).toBe(false);
});

it('preserves an explicit auto-parse choice', () => {
  persistAutoParseOnPdfImport(true);
  expect(window.localStorage.getItem(PARSER_AUTO_PARSE_STORAGE_KEY)).toBe('1');
  expect(readAutoParseOnPdfImport()).toBe(true);
  persistAutoParseOnPdfImport(false);
  expect(readAutoParseOnPdfImport()).toBe(false);
});
