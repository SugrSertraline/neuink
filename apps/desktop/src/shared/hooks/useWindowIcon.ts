import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { Image as NativeImage } from '@tauri-apps/api/image';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Serialize native updates so a slow earlier theme cannot overwrite a newer one.
let iconUpdates: Promise<void> = Promise.resolve();

/** Optional OS decoration; no workspace, scroll or input state is owned here. */
export function useWindowIcon(src: string) {
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    iconUpdates = iconUpdates.then(async () => {
      if (disposed) return;
      const source = new window.Image();
      source.src = src;
      await source.decode();
      if (disposed) return;

      // WebView decodes both local SVG and PNG, avoiding extra native image codecs.
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Window icon canvas is unavailable');
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const icon = await NativeImage.new(new Uint8Array(rgba), canvas.width, canvas.height);
      try {
        if (!disposed) await getCurrentWindow().setIcon(icon);
      } finally {
        await icon.close();
      }
    }).catch(error => {
      if (!disposed) console.warn('Failed to update window icon', error);
    });
    return () => { disposed = true; };
  }, [src]);
}
