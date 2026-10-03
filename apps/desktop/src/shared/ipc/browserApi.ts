import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
/** CSS bounds in the host WebView plus its CSS-to-physical scale (UI zoom × monitor DPI). */
export type BrowserBounds = { x: number; y: number; width: number; height: number; pixel_ratio?: number };
/** Host CSS viewport rectangles, using the same pixel_ratio as bounds (not page-local coordinates). */
export type BrowserOcclusion = { x: number; y: number; width: number; height: number };
export type BrowserEvent = { id: string; url: string | null; title: string | null; loading: boolean | null; error: string | null; focused?: boolean; navigation_id?: string | null;
  zoom?: number;
  openTab?: { requestId: string; url?: string | null; error?: string | null } };
/** Host-captured identity. The model cannot supply or change this target. */
export type BrowserTabTarget = { id: string; url: string; title: string; navigationId?: string };
export type BrowserTabSnapshot = {
  title: string; url: string; text: string; selection: string;
  truncated: boolean; capturedAt: string; limitations: string[];
  contentType?: 'webpage' | 'pdf' | 'video_subtitles' | 'video_metadata';
  extractor?: string;
  navigationId?: string;
  /** Transport-only PDF data. Never pass this field to a model, trace or persistent conversation. */
  pdfBase64?: string;
  pageCount?: number;
  pagesRead?: number[];
};
export const nativeBrowserAvailable = () => isTauri();
export function browserCommand(id: string, action: 'create' | 'navigate' | 'reload' | 'stop' | 'back' | 'forward' | 'layout' | 'close' | 'zoom', data: { url?: string; bounds?: BrowserBounds; visible?: boolean; zoom?: number; occlusions?: BrowserOcclusion[] } = {}) {
  return invoke<void>('browser_command', { request: { id, action, ...data } });
}

const frozenRequest = (target: BrowserTabTarget) => ({ id: target.id, expected_url: target.url, expected_navigation_id: target.navigationId });
/** Revalidate after PDF.js completes; this command only checks identity and reads no content. */
export async function validateBrowserTab(target: BrowserTabTarget) {
  await invoke('read_browser_tab', { request: { ...frozenRequest(target), validate_only: true } });
}

/** One frozen target; public PDF/video adapters never receive cookies or model-selected URLs. */
export async function readBrowserTab(target: BrowserTabTarget, signal?: AbortSignal, mode: 'text' | 'selection' = 'text'): Promise<BrowserTabSnapshot> {
  signal?.throwIfAborted();
  if (!nativeBrowserAvailable()) throw new Error('读取当前网页仅在 NeuInk 桌面端可用。');
  const callId = crypto.randomUUID();
  const request = { ...frozenRequest(target), call_id: callId, selection_only: mode === 'selection' };
  return new Promise<BrowserTabSnapshot>((resolve, reject) => {
    const abort = () => {
      cleanup();
      void invoke('cancel_browser_read', { callId }).catch(() => {});
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
    // Native reads are independently bounded and release callbacks after close/navigation/timeout.
    // Cancelled callers neither observe nor retain a late result.
    void invoke<BrowserTabSnapshot>('read_browser_tab', { request }).then(value => {
      cleanup();
      if (signal?.aborted) { reject(signal.reason); return; }
      resolve(value);
    }, error => { cleanup(); reject(error); });
  });
}
export async function listenBrowser(callback: (event: BrowserEvent) => void) {
  const subscriptions: (() => void)[] = [];
  const cleanup = () => { subscriptions.splice(0).forEach(stop => stop()); };
  try {
    subscriptions.push(await listen<BrowserEvent>('neuink:browser-state', event => callback(event.payload)));
    subscriptions.push(await listen<string>('neuink:browser-focus', event => callback({ id: event.payload, focused: true, url: null, title: null, loading: null, error: null })));
    subscriptions.push(await listen<{ id: string; request_id: string; url?: string | null; error?: string | null }>(
      'neuink:browser-open-tab', event => callback({ id: event.payload.id, url: null, title: null, loading: null, error: null,
        openTab: { requestId: event.payload.request_id, url: event.payload.url, error: event.payload.error } })));
    subscriptions.push(await listen<{ id: string; zoom: number }>('neuink:browser-zoom', event => callback({
      id: event.payload.id, zoom: event.payload.zoom, url: null, title: null, loading: null, error: null
    })));
    return cleanup;
  } catch (error) { cleanup(); throw error; }
}
