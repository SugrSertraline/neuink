import { useEffect, useState } from 'react';
import { DEFAULT_MINERU_ENDPOINT, LEGACY_MINERU_ENDPOINTS, PARSER_ENDPOINT_STORAGE_KEY } from './appSupport';

export function readParserSource() {
  if (typeof window === 'undefined') return DEFAULT_MINERU_ENDPOINT;
  const saved = window.localStorage.getItem(PARSER_ENDPOINT_STORAGE_KEY)?.trim();
  if (!saved || LEGACY_MINERU_ENDPOINTS.has(saved)) return DEFAULT_MINERU_ENDPOINT;
  if (saved === 'neuink-account') return saved;
  try {
    const url = new URL(saved);
    return url.protocol === 'http:' || url.protocol === 'https:' ? saved : DEFAULT_MINERU_ENDPOINT;
  } catch { return DEFAULT_MINERU_ENDPOINT; }
}

export function useParserSource() {
  const [source, setSource] = useState(readParserSource);
  useEffect(() => {
    const update = () => { if (readParserSource() === 'neuink-account') setSource('neuink-account'); };
    window.addEventListener('neuink-parser-source-changed', update);
    return () => window.removeEventListener('neuink-parser-source-changed', update);
  }, []);
  return [source, setSource] as const;
}
