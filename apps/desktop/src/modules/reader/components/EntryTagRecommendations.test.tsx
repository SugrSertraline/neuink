// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeEntryTags, getLlmSettings, type TagRecommendation } from '@/shared/ipc/assistantApi';
import { ToastContext } from '@/shared/hooks/useToast';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { EntryTagRecommendations } from './EntryTagRecommendations';
import { readTagSuggestions, tagSuggestionKey } from './pdf-reader/entryTagSuggestionStore';
vi.mock('@/shared/ipc/assistantApi', () => ({ analyzeEntryTags: vi.fn(), getLlmSettings: vi.fn(), subscribeLlmSettings: () => () => undefined }));
afterEach(cleanup);
let root: string, sequence = 0;
beforeEach(() => {
  vi.clearAllMocks(); root = `suggestions-test-${++sequence}`;
  vi.mocked(getLlmSettings).mockResolvedValue({ profiles: [], assistant_profile_id: 'model', assistant_profile: null, translation_profile_id: null, translation_profile: null });
});
const entry: LibraryEntry = { id: 'suggested-entry', title: '论文', tags: ['现有标签'], tagIds: [], fields: {}, contents: [], pdfFileName: 'paper.pdf', status: 'Parsed', progress: 100, createdAt: '', updatedAt: '', parseMessage: null, parseEndpoint: null };
const recommendation = (path: string): TagRecommendation => ({ path, confidence: 0.9, reason: '论文内容相关', dimension: '研究主题', source: 'new' });
const response = (...paths: string[]) => ({ recommendations: paths.map(recommendation), policy_version: 'test' });
function page(props: Partial<React.ComponentProps<typeof EntryTagRecommendations>> = {}) {
  return <ToastContext.Provider value={{ notify: () => 'toast', dismiss: vi.fn() }}><EntryTagRecommendations entry={entry} workspaceRoot={root} onApplyEntryTagPaths={vi.fn()} {...props} /></ToastContext.Provider>;
}
async function generate(view: ReturnType<typeof render>) {
  const button = view.getByRole('button', { name: '生成推荐标签' }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false)); fireEvent.click(button);
  await waitFor(() => expect(view.queryByRole('button', { name: '正在生成…' })).toBeNull());
}

describe('persistent manual tag recommendations', () => {
  it('generates for tagged entries, retains applied results on reopen and replaces only on regeneration', async () => {
    vi.mocked(analyzeEntryTags).mockResolvedValueOnce(response('现有标签', '新标签')).mockResolvedValueOnce(response('另一标签'));
    const onApplyEntryTagPaths = vi.fn().mockResolvedValue(undefined);
    let view = render(page({ onApplyEntryTagPaths }));
    expect(analyzeEntryTags).not.toHaveBeenCalled(); await generate(view);
    expect((view.getByRole('button', { name: '现有标签，已添加' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole('button', { name: '添加所选标签' }));
    await waitFor(() => expect(onApplyEntryTagPaths).toHaveBeenCalledWith(entry.id, ['新标签']));
    const updated = { ...entry, tags: [...entry.tags, '新标签'] };
    view.rerender(page({ entry: updated, onApplyEntryTagPaths }));
    expect(view.getByRole('button', { name: '新标签，已添加' })).toBeTruthy();
    view.unmount(); view = render(page({ entry: updated }));
    expect(view.getByRole('button', { name: '新标签，已添加' })).toBeTruthy();
    await waitFor(() => expect((view.getByRole('button', { name: '重新生成' }) as HTMLButtonElement).disabled).toBe(false));
    expect(analyzeEntryTags).toHaveBeenCalledOnce(); fireEvent.click(view.getByRole('button', { name: '重新生成' }));
    await waitFor(() => expect(view.getByRole('button', { name: '另一标签' })).toBeTruthy());
    expect(view.queryByRole('button', { name: '新标签，已添加' })).toBeNull();
    expect(JSON.parse(localStorage.getItem(`neuink.entryTagRecommendations.v1:${tagSuggestionKey(root, entry.id)}`)!).recommendations[0].path).toBe('另一标签');
  });

  it('retains old results on failed regeneration and failed application, allowing retry', async () => {
    vi.mocked(analyzeEntryTags).mockResolvedValueOnce(response('保留的推荐')).mockRejectedValueOnce(new Error('模型连接失败'));
    const onApplyEntryTagPaths = vi.fn().mockRejectedValueOnce(new Error('写入失败')).mockResolvedValueOnce(undefined);
    const view = render(page({ onApplyEntryTagPaths })); await generate(view);
    fireEvent.click(view.getByRole('button', { name: '重新生成' }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('模型连接失败'));
    expect(view.getByRole('button', { name: '保留的推荐' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '添加所选标签' }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('写入失败'));
    fireEvent.click(view.getByRole('button', { name: '添加所选标签' }));
    await waitFor(() => expect(onApplyEntryTagPaths).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.queryByRole('alert')).toBeNull());
  });

  it('keeps delayed generation bound to the original workspace and survives unmount', async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    vi.mocked(analyzeEntryTags).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    let view = render(page());
    await waitFor(() => expect((view.getByRole('button', { name: '生成推荐标签' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(view.getByRole('button', { name: '生成推荐标签' }));
    expect((view.getByRole('button', { name: '正在生成…' }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount(); view = render(page({ workspaceRoot: `${root}-other` }));
    await act(async () => { finish(response('来自旧资料库')); });
    expect(view.queryByRole('button', { name: '来自旧资料库' })).toBeNull();
    view.unmount(); view = render(page());
    expect(view.getByRole('button', { name: '来自旧资料库' })).toBeTruthy(); expect(analyzeEntryTags).toHaveBeenCalledOnce();
  });

  it('treats an empty result as generated and does not generate automatically after remount', async () => {
    vi.mocked(analyzeEntryTags).mockResolvedValue(response());
    let view = render(page()); await generate(view); view.unmount(); view = render(page());
    expect(view.getByText('本次分析没有生成推荐标签，可以重新生成。')).toBeTruthy();
    expect(view.getByRole('button', { name: '重新生成' })).toBeTruthy(); expect(analyzeEntryTags).toHaveBeenCalledOnce();
  });

  it('shows why generation is unavailable when unparsed or unconfigured', async () => {
    const view = render(page({ entry: { ...entry, status: 'Parsing' } }));
    expect((view.getByRole('button', { name: '生成推荐标签' }) as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByText('PDF 解析完成后可以生成推荐标签。')).toBeTruthy(); view.unmount();
    vi.mocked(getLlmSettings).mockResolvedValue({ profiles: [], assistant_profile_id: null, assistant_profile: null, translation_profile_id: null, translation_profile: null });
    const noModel = render(page()); await waitFor(() => expect(noModel.getByText('请先在设置中配置助手模型。')).toBeTruthy());
    expect(analyzeEntryTags).not.toHaveBeenCalled();
  });

  it('reads a valid persisted cache without a request and safely ignores a corrupt one', () => {
    const key = tagSuggestionKey(root, entry.id);
    localStorage.setItem(`neuink.entryTagRecommendations.v1:${key}`, JSON.stringify({ generatedAt: '2026-09-16', recommendations: [recommendation('本地结果')], selectedPaths: ['本地结果', '不存在的标签'] }));
    const view = render(page()); expect(view.getByRole('button', { name: '本地结果' })).toBeTruthy();
    expect(readTagSuggestions(key).selectedPaths).toEqual(['本地结果']); expect(analyzeEntryTags).not.toHaveBeenCalled();
    const corrupt = tagSuggestionKey(root, 'corrupt'); localStorage.setItem(`neuink.entryTagRecommendations.v1:${corrupt}`, '{broken');
    expect(readTagSuggestions(corrupt).generatedAt).toBeNull();
  });
});
