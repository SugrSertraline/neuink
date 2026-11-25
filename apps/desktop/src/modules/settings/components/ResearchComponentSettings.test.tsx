// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ResearchComponentControls } from './ResearchComponentSettings';
import type { ResearchModel } from '@/modules/assistant/research/useResearchTasks';
afterEach(cleanup);
const state = (status: any, extra = {}) => ({ status, busy: false, error: null, command: vi.fn(), refresh: vi.fn(), ...extra }) as unknown as ResearchModel;
it('installs only after an explicit click and shows ready state', () => {
  const model = state({ ready: false, active: null });
  const view = render(<ResearchComponentControls model={model} hasWorkspace />);
  expect(model.command).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '安装并启用' }));
  expect(model.command).toHaveBeenCalledWith({ kind: 'install' });
  view.rerender(<ResearchComponentControls model={state({ ready: true, active: null })} hasWorkspace />);
  expect(screen.getByRole('status').textContent).toContain('已安装');
  expect(screen.queryByRole('button', { name: '安装并启用' })).toBeNull();
});
it('uses measured progress, allows cancellation and does not invent verification progress', () => {
  const model = state({ ready: false, active: { id: 'one', installation: true, stage: '正在安装研究组件', progress: 42 } });
  const view = render(<ResearchComponentControls model={model} hasWorkspace />);
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('42');
  fireEvent.click(screen.getByRole('button', { name: '取消安装' }));
  expect(model.command).toHaveBeenCalledWith({ kind: 'cancel' });
  view.rerender(<ResearchComponentControls model={state({ ready: false, active: { id: 'one', installation: true, stage: '正在验证研究组件', progress: null } })} hasWorkspace />);
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('正在验证');
});
it('leaving the page never cancels installation', () => {
  const model = state({ ready: false, active: { id: 'one', installation: true, stage: '安装中' } });
  const view = render(<ResearchComponentControls model={model} hasWorkspace />);
  view.unmount(); expect(model.command).not.toHaveBeenCalled();
});
it('supports failed reads, failed installs and missing workspace', () => {
  const model = state(null, { error: '状态读取失败' });
  const view = render(<ResearchComponentControls model={model} hasWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '重新读取状态' }));
  expect(model.refresh).toHaveBeenCalledOnce();
  expect(screen.getByRole('alert').textContent).toContain('状态读取失败');
  view.rerender(<ResearchComponentControls model={state({ ready: false, active: null, error: '空间不足' })} hasWorkspace />);
  expect(screen.getByRole('button', { name: '重试安装' })).toBeTruthy();
  view.rerender(<ResearchComponentControls model={state(null)} hasWorkspace={false} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText(/打开资料库/)).toBeTruthy();
});
it('prevents concurrent installation and cancellation owned by another workspace', () => {
  const view = render(<ResearchComponentControls model={state({ ready: true, active: { installation: false, id: 'research' } })} hasWorkspace />);
  expect((screen.getByRole('button', { name: '检查组件' }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<ResearchComponentControls model={state({ ready: false, active: { installation: true, id: null, stage: '安装中' } })} hasWorkspace />);
  expect((screen.getByRole('button', { name: '取消安装' }) as HTMLButtonElement).disabled).toBe(true);
});
