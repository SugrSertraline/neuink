import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
export type BrowserBounds = { x: number; y: number; width: number; height: number };
export type BrowserEvent = { id: string; url: string | null; title: string | null; loading: boolean | null; error: string | null; focused?: boolean };
export const nativeBrowserAvailable = () => isTauri();
export function browserCommand(id: string, action: 'create' | 'navigate' | 'reload' | 'stop' | 'back' | 'forward' | 'layout' | 'close', data: { url?: string; bounds?: BrowserBounds; visible?: boolean } = {}) {
  return invoke<void>('browser_command', { request: { id, action, ...data } });
}
export async function listenBrowser(callback: (event: BrowserEvent) => void) {
  const stopState = await listen<BrowserEvent>('neuink:browser-state', event => callback(event.payload));
  try {
    const stopFocus = await listen<string>('neuink:browser-focus', event => callback({ id: event.payload, focused: true, url: null, title: null, loading: null, error: null }));
    return () => { stopState(); stopFocus(); };
  } catch (error) { stopState(); throw error; }
}
