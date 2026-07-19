const CLOUD_PARSER_UNLOCK_HASH =
  'ff4e524a90f69d1b9f715dde5a440d3c0f262395af5f849781519afc9f0e6e9b';

export const CLOUD_PARSER_ENDPOINT = 'mineru-cloud';
export const CLOUD_PARSER_UNLOCK_STORAGE_KEY = 'neuink.cloudParserUnlocked';
const CLOUD_PARSER_ENDPOINT_ALIASES = new Set([
  CLOUD_PARSER_ENDPOINT,
  'mineru-qiniu',
  'qiniu-mineru'
]);

export type ParserSourceMode = 'cloud' | 'custom';

export function readStoredCloudUnlockState() {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.localStorage.getItem(CLOUD_PARSER_UNLOCK_STORAGE_KEY) === '1';
}

export function persistCloudUnlockState(unlocked: boolean) {
  if (typeof window === 'undefined') {
    return;
  }
  if (unlocked) {
    window.localStorage.setItem(CLOUD_PARSER_UNLOCK_STORAGE_KEY, '1');
    return;
  }
  window.localStorage.removeItem(CLOUD_PARSER_UNLOCK_STORAGE_KEY);
}

export function isCloudParserEndpoint(parserEndpoint: string) {
  return CLOUD_PARSER_ENDPOINT_ALIASES.has(parserEndpoint.trim().toLowerCase());
}

export function readInitialParserSourceMode(parserEndpoint: string): ParserSourceMode {
  return isCloudParserEndpoint(parserEndpoint) ? 'cloud' : 'custom';
}

export function getEffectiveParserEndpoint(parserEndpoint: string) {
  const trimmed = parserEndpoint.trim();
  return isCloudParserEndpoint(trimmed) ? CLOUD_PARSER_ENDPOINT : trimmed;
}

export async function verifyCloudParserSecret(secret: string) {
  const nextHash = await sha256Hex(secret.trim());
  return nextHash === CLOUD_PARSER_UNLOCK_HASH;
}

async function sha256Hex(value: string) {
  const buffer = await window.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(buffer)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
}
