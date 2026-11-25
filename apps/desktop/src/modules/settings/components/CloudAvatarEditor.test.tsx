// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudAvatarEditor } from './CloudAvatarEditor';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('previews a crop and only applies it explicitly', async () => {
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn(), drawImage: draw } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,test');
  vi.stubGlobal('Image', class { naturalWidth = 400; naturalHeight = 200; src = ''; decode() { return Promise.resolve(); } });
  const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:test'); URL.revokeObjectURL = vi.fn();
  try {
    const changed = vi.fn(); render(<CloudAvatarEditor value="" disabled={false} onChange={changed} />);
    fireEvent.change(screen.getByLabelText('选择头像图片'), { target: { files: [new File(['test'], 'avatar.png', { type: 'image/png' })] } });
    await screen.findByLabelText('头像裁剪预览');
    await waitFor(() => expect(draw).toHaveBeenCalledWith(expect.anything(), 100, 0, 200, 200, 0, 0, 256, 256));
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('缩放'), { target: { value: '2' } });
    await waitFor(() => expect(draw).toHaveBeenLastCalledWith(expect.anything(), 150, 50, 100, 100, 0, 0, 256, 256));
    fireEvent.click(screen.getByRole('button', { name: '使用此头像' }));
    expect(changed).toHaveBeenCalledWith('data:image/png;base64,test');
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});
it('rejects unsupported images without replacing the current avatar', async () => {
  const changed = vi.fn(); render(<CloudAvatarEditor value="data:image/png;base64,test" disabled={false} onChange={changed} />);
  fireEvent.change(screen.getByLabelText('选择头像图片'), { target: { files: [new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' })] } });
  expect((await screen.findByRole('alert')).textContent).toContain('PNG、JPEG 或 WebP');
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '恢复默认头像' }));
  expect(changed).toHaveBeenCalledWith('');
});
