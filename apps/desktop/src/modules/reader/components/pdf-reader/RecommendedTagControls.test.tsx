// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RecommendedTagControls } from './RecommendedTagControls';

afterEach(cleanup);
const props = () => ({ appliedPaths: [], recommendedTags: [], selectedRecommendedTagPaths: [], busy: false, open: true,
  onOpenChange: vi.fn(), onApply: vi.fn(), onDismiss: vi.fn(), onToggleTag: vi.fn(), onGenerate: vi.fn() });

it('keeps loading and failure visible before there are any recommendations and offers explicit retry', () => {
  const callbacks = props();
  const view = render(<RecommendedTagControls {...callbacks} busy phase="generating" />);
  expect(view.getByRole('button', { name: '推荐标签，正在生成' })).toBeTruthy();
  expect(view.getByText('正在分析论文，生成推荐标签…')).toBeTruthy();
  const generating = view.getByRole('button', { name: '正在生成…' });
  expect(generating.hasAttribute('disabled')).toBe(true);
  fireEvent.click(generating);
  expect(callbacks.onGenerate).not.toHaveBeenCalled();
  view.rerender(<RecommendedTagControls {...callbacks} phase="idle" error="连接失败，请重试" />);
  expect(view.getByRole('alert').textContent).toBe('连接失败，请重试');
  fireEvent.click(view.getByRole('button', { name: '重试生成' }));
  expect(callbacks.onGenerate).toHaveBeenCalledOnce();
  expect(callbacks.onApply).not.toHaveBeenCalled();
});

it('does not repeat cached tags that are already applied, including normalized paths', () => {
  const callbacks = props();
  const view = render(<RecommendedTagControls {...callbacks} generatedAt="2026-10-26" appliedPaths={['研究/模型']}
    recommendedTags={[{ path: '研究 / 模型', reason: '相关', dimension: '主题', confidence: .9, source: 'existing' }]}
    selectedRecommendedTagPaths={['研究 / 模型']} />);
  expect(view.getByRole('button', { name: '推荐标签 0 项' })).toBeTruthy();
  expect(view.queryByRole('button', { name: '研究 / 模型' })).toBeNull();
  expect(view.queryByRole('button', { name: '确认添加' })).toBeNull();
  expect(view.getByText('暂无新的推荐标签。')).toBeTruthy();
  expect(view.queryByRole('button', { name: '重新生成' })).toBeNull();
  expect(view.getByText('之后可在条目详情中重新生成推荐标签。')).toBeTruthy();
});

it('explains an unavailable model without disabling access to cached suggestions', () => {
  const callbacks = props();
  const view = render(<RecommendedTagControls {...callbacks} disabledReason="请先在设置中配置助手模型。" generatedAt="2026-10-26"
    recommendedTags={[{ path: '待添加', reason: '相关', dimension: '主题', confidence: .9, source: 'new' }]}
    selectedRecommendedTagPaths={['待添加']} />);
  expect(view.getByText('请先在设置中配置助手模型。')).toBeTruthy();
  expect(view.queryByRole('button', { name: '重新生成' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: '确认添加' }));
  expect(callbacks.onApply).toHaveBeenCalledOnce();
});
