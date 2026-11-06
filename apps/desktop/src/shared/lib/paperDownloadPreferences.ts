import { useSyncExternalStore } from 'react';

export const PAPER_DOWNLOAD_CONFIRMATION_KEY = 'neuink.paper-download.confirmation';
const CHANGE_EVENT = 'neuink:paper-download-confirmation-change';

/** Local UI preference only. Model-initiated imports keep their separate approval contract. */
export function readPaperDownloadConfirmation(): boolean {
  try {
    return typeof window === 'undefined' || window.localStorage.getItem(PAPER_DOWNLOAD_CONFIRMATION_KEY) !== 'false';
  } catch { return true; }
}

export function setPaperDownloadConfirmation(required: boolean): boolean {
  if (typeof window === 'undefined') return false;
  try { window.localStorage.setItem(PAPER_DOWNLOAD_CONFIRMATION_KEY, String(required)); }
  catch { return false; }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PAPER_DOWNLOAD_CONFIRMATION_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function usePaperDownloadConfirmation(): boolean {
  return useSyncExternalStore(subscribe, readPaperDownloadConfirmation, () => true);
}
