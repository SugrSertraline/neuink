// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RerankSettingsSection } from './RerankSettingsSection';
import { getRerankSettings, saveRerankSettings } from '@/shared/ipc/workspaceApi';

vi.mock('@/shared/ipc/workspaceApi', () => ({
  getRerankSettings: vi.fn(),
  saveRerankSettings: vi.fn()
}));

const base = {
  mode: 'off' as const,
  model_dir: null,
  max_candidates: 20,
  fallback_heuristic: true,
  model_present: false
};

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(getRerankSettings).mockReset();
  vi.mocked(saveRerankSettings).mockReset();
});

describe('RerankSettingsSection', () => {
  it('loads only while the tab is active', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue(base);
    const { rerender } = render(<RerankSettingsSection active={false} />);
    expect(getRerankSettings).not.toHaveBeenCalled();
    rerender(<RerankSettingsSection active />);
    await waitFor(() => expect(getRerankSettings).toHaveBeenCalledTimes(1));
  });

  it('shows that no model is needed for the default mode', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue(base);
    render(<RerankSettingsSection active />);
    await waitFor(() =>
      expect(screen.getByTestId('rerank-model-status').textContent).toContain('当前不需要本地模型')
    );
  });

  it('warns when the cross-encoder is selected but no model is installed', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue({
      ...base,
      mode: 'cross_encoder',
      model_present: false
    });
    render(<RerankSettingsSection active />);
    await waitFor(() =>
      expect(screen.getByTestId('rerank-model-status').textContent).toContain('当前会退回字段覆盖排序')
    );
    // The model directory row only exists for the model-backed rung.
    expect(screen.getByRole('textbox', { name: '重排模型目录' })).toBeDefined();
  });

  it('saves the heuristic mode and reports a model that is actually present', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue({ ...base, model_present: true });
    vi.mocked(saveRerankSettings).mockImplementation(async (settings) => ({
      ...settings,
      model_present: true
    }));
    render(<RerankSettingsSection active />);
    await waitFor(() => expect(getRerankSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('switch', { name: '模型不可用时退回字段覆盖' }));
    await waitFor(() => expect(saveRerankSettings).toHaveBeenCalled());
    expect(vi.mocked(saveRerankSettings).mock.calls[0][0]).toMatchObject({
      mode: 'off',
      fallback_heuristic: false
    });
  });

  it('keeps the backend message when saving is rejected', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue(base);
    vi.mocked(saveRerankSettings).mockRejectedValue(new Error('重排候选上限必须在 1 到 200 之间'));
    render(<RerankSettingsSection active />);
    await waitFor(() => expect(getRerankSettings).toHaveBeenCalled());

    const candidates = screen.getByRole('spinbutton', { name: '重排候选上限' });
    fireEvent.change(candidates, { target: { value: '0' } });
    fireEvent.blur(candidates);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('重排候选上限必须在 1 到 200 之间')
    );
  });
});


