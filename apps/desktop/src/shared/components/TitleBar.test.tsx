// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const windowApi = vi.hoisted(() => {
  let maximized = false;
  return {
    close: vi.fn(async () => undefined),
    isMaximized: vi.fn(async () => maximized),
    minimize: vi.fn(async () => undefined),
    onResized: vi.fn(async () => () => undefined),
    reset: () => {
      maximized = false;
    },
    toggleMaximize: vi.fn(async () => {
      maximized = !maximized;
    })
  };
});

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => windowApi
}));

import { TitleBar } from './TitleBar';

describe('TitleBar native window controls', () => {
  beforeEach(() => {
    windowApi.reset();
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('delegates minimize and maximize directly to the Tauri window', async () => {
    render(<TitleBar onOpenSearch={vi.fn()} />);
    await waitFor(() => expect(windowApi.isMaximized).toHaveBeenCalled());

    fireEvent.click(screen.getByTitle('最小化 / Minimize'));
    await waitFor(() => expect(windowApi.minimize).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTitle('最大化 / Maximize'));
    await waitFor(() => expect(windowApi.toggleMaximize).toHaveBeenCalledTimes(1));
    expect(await screen.findByTitle('还原 / Restore')).toBeTruthy();
  });
});
