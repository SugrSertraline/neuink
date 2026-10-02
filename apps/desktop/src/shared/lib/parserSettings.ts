export const PARSER_AUTO_PARSE_STORAGE_KEY = 'neuink.parser.autoParseOnPdfImport';

export function readAutoParseOnPdfImport() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(PARSER_AUTO_PARSE_STORAGE_KEY) === '1';
}

export function persistAutoParseOnPdfImport(enabled: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PARSER_AUTO_PARSE_STORAGE_KEY, enabled ? '1' : '0');
}

export function getEffectiveParserEndpoint(parserEndpoint: string) {
  return parserEndpoint.trim();
}
