// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  create: vi.fn(),
  setIcon: vi.fn(),
  close: vi.fn(),
  decode: vi.fn(),
  sources: [] as string[]
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: native.isTauri }));
vi.mock('@tauri-apps/api/image', () => ({ Image: { new: native.create } }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ setIcon: native.setIcon }) }));
import { useWindowIcon } from './useWindowIcon';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  native.sources.length = 0;
  native.isTauri.mockReturnValue(true);
  native.decode.mockResolvedValue(undefined);
  native.close.mockResolvedValue(undefined);
  native.setIcon.mockResolvedValue(undefined);
  native.create.mockImplementation(async () => ({ close: native.close }));
  vi.stubGlobal('Image', class {
    src = '';
    decode() { native.sources.push(this.src); return native.decode(); }
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray([25, 30, 40, 255]) })
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('native window icon follows the current appearance', () => {
  it('does not access native APIs in browser previews', async () => {
    native.isTauri.mockReturnValue(false);
    renderHook(() => useWindowIcon('/standard.svg'));
    await act(async () => {});
    expect(native.decode).not.toHaveBeenCalled();
    expect(native.setIcon).not.toHaveBeenCalled();
  });

  it('applies the chosen image and restores the standard image on exit', async () => {
    const hook = renderHook(({ src }) => useWindowIcon(src), { initialProps: { src: '/atelier.png' } });
    await waitFor(() => expect(native.close).toHaveBeenCalledTimes(1));
    hook.rerender({ src: '/standard.svg' });
    await waitFor(() => expect(native.close).toHaveBeenCalledTimes(2));
    expect(native.sources).toEqual(['/atelier.png', '/standard.svg']);
    expect(native.setIcon).toHaveBeenCalledTimes(2);
  });

  it('skips a stale image if the theme changes while it is decoding', async () => {
    const firstDecode = deferred<void>();
    native.decode.mockReturnValueOnce(firstDecode.promise);
    const hook = renderHook(({ src }) => useWindowIcon(src), { initialProps: { src: '/atelier.png' } });
    await waitFor(() => expect(native.decode).toHaveBeenCalledTimes(1));
    hook.rerender({ src: '/standard.svg' });
    await act(async () => { firstDecode.resolve(); });
    await waitFor(() => expect(native.close).toHaveBeenCalledTimes(1));
    expect(native.sources).toEqual(['/atelier.png', '/standard.svg']);
    expect(native.setIcon).toHaveBeenCalledTimes(1);
  });

  it('releases a newly created native image after unmount without applying it', async () => {
    const creation = deferred<{ close: typeof native.close }>();
    native.create.mockReturnValueOnce(creation.promise);
    const hook = renderHook(() => useWindowIcon('/atelier.png'));
    await waitFor(() => expect(native.create).toHaveBeenCalledTimes(1));
    hook.unmount();
    await act(async () => { creation.resolve({ close: native.close }); });
    await waitFor(() => expect(native.close).toHaveBeenCalledTimes(1));
    expect(native.setIcon).not.toHaveBeenCalled();
  });

  it('releases resources on native failure and allows the next update', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    native.setIcon.mockRejectedValueOnce(new Error('native failure'));
    const hook = renderHook(({ src }) => useWindowIcon(src), { initialProps: { src: '/atelier.png' } });
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(native.close).toHaveBeenCalledTimes(1);
    hook.rerender({ src: '/standard.svg' });
    await waitFor(() => expect(native.close).toHaveBeenCalledTimes(2));
    expect(native.setIcon).toHaveBeenCalledTimes(2);
  });
});
