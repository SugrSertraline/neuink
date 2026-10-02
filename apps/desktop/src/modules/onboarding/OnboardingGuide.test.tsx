// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntryMeta } from '@/shared/types/domain';
import type { WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import { OnboardingGuide } from './OnboardingGuide';
import { GUIDE_STEPS } from './catalog';
import { OnboardingSettings } from './OnboardingSettings';
import { freshProgress, GUIDE_MINERU_TUTORIAL_EVENT, GUIDE_STORAGE_KEY, openOnboarding } from './progress';
import type { ToastInput } from '@/shared/hooks/useToast';
import * as spotlight from './useSpotlight';
const { notify, dismiss } = vi.hoisted(() => ({ notify:vi.fn((_message:ToastInput) => 'toast'), dismiss:vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ useToast:() => ({ notify, dismiss }) }));

const layout = { left:{ kind:'library' }, right:null, focusedPane:'left' } as WorkspaceSurfaceLayout;
const timestamp = '2026-10-01T00:00:00Z';
const entry:EntryMeta = { id:'sample', title:'Attention Is All You Need（演示版）', fields:{ tutorial_demo:'attention-v1' },
  tags:[], contents:[], created_at:timestamp, updated_at:timestamp,
  pdf:{ file_name:'paper.pdf', content_hash:'sample-hash', imported_at:timestamp,
    parse:{ status:'not_started', updated_at:timestamp, message:null, task_id:null, endpoint:null } } };
const defaults = () => ({ root:'C:/tutorial', ready:true, entries:[] as EntryMeta[], selectedEntryId:null as string | null,
  layout, onRoute:vi.fn(), onImportSample:vi.fn(async () => 'sample') });
const stored = (current:string, extra = {}) => localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify({ ...freshProgress(), current, seen:true, ...extra }));
const prepared = () => waitFor(() => expect(screen.queryByText('正在准备本地演示资料…')).toBeNull());
beforeEach(() => {
  // Interaction tests isolate routing from browser geometry; the geometry integration below uses the real hook.
  vi.spyOn(spotlight, 'useSpotlight').mockReturnValue({ x:316, y:76, width:588, height:648, viewportWidth:1200, viewportHeight:800 });
  notify.mockClear(); dismiss.mockClear();
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback:FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', window.clearTimeout.bind(window));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('onboarding interaction', () => {
  it.each(['parsed', 'blocks', 'selection-translation', 'nav-library'])
  ('keeps the $0 observation stationary and restores normal operations after pausing', async id => {
    stored(id, { entryId:'sample', root:'C:/tutorial' });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left:0, top:0, right:1200, bottom:800, width:1200, height:800 } as DOMRect);
    const change = vi.fn();
    const sample = { ...entry, pdf:{ ...entry.pdf!, parse:{ ...entry.pdf!.parse, status:'succeeded' as const } } };
    render(<><nav className="activitybar"><button aria-label="条目库" onClick={change}>导航入口</button></nav>
      <aside className="app-sidebar" onWheel={change}><button onClick={change}>侧栏真实操作</button></aside>
      <div data-guide="pdf-page" onWheel={change}><div className="pdf-text-layer"><span>演示 PDF 正文</span></div>
        <button onClick={change}>PDF 真实操作</button></div><OnboardingGuide {...defaults()} entries={[sample]} /></>);
    act(() => openOnboarding()); await prepared();
    const target = screen.getByText(id === 'nav-library' ? '侧栏真实操作' : 'PDF 真实操作');
    expect(fireEvent.wheel(target, { deltaY:160 })).toBe(false);
    expect(fireEvent.click(target)).toBe(false);
    expect(fireEvent.click(screen.getByText('导航入口'))).toBe(false);
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name:'暂停引导' }));
    expect(fireEvent.click(target)).toBe(true);
    expect(fireEvent.wheel(target, { deltaY:160 })).toBe(true);
    expect(change).toHaveBeenCalledTimes(2);
  });

  it('binds MinerU permissions to the tutorial scroll viewport rather than the workspace', async () => {
    stored('parse-zip', { entryId:'sample', root:'C:/tutorial' });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left:0, top:0, right:1200, bottom:800, width:1200, height:800 } as DOMRect);
    const copy = vi.fn(); const navigate = vi.fn();
    render(<><div data-guide="reader-workspace"><button onClick={navigate}>其他阅读标签</button>
      <div data-guide="mineru-tutorial"><button data-guide="mineru-copy-link" onClick={copy}>复制教程链接</button><p>解析截图</p></div>
      </div><OnboardingGuide {...defaults()} entries={[entry]} /></>);
    act(() => openOnboarding()); await prepared();
    expect(fireEvent.click(screen.getByText('其他阅读标签'))).toBe(false);
    expect(fireEvent.wheel(screen.getByText('解析截图'))).toBe(true);
    fireEvent.click(screen.getByText('复制教程链接')); expect(copy).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(spotlight.useSpotlight).toHaveBeenCalledWith('[data-guide="mineru-tutorial"]', expect.anything(), true, expect.any(String), undefined);
  });

  it.each(GUIDE_STEPS)('allows step $id to advance with the prepared offline paper, without a forced live action', async step => {
    stored(step.id, { entryId:'sample', root:'C:/tutorial' });
    const sample:EntryMeta = { ...entry, contents:[{ kind:'note', note_id:'guide-note', title:'演示笔记' }],
      pdf:{ ...entry.pdf!, parse:{ ...entry.pdf!.parse, status:'succeeded' } } };
    const pdfLayout:WorkspaceSurfaceLayout = { ...layout, left:{ kind:'pdf', entryId:'sample' }, leftTabs:[{ kind:'pdf', entryId:'sample' }], rightTabs:[] };
    render(<OnboardingGuide {...defaults()} entries={[sample]} layout={pdfLayout} />);
    act(() => openOnboarding()); await prepared();
    const next = screen.getByRole('button', { name:step.id === 'finish' ? '结束引导' : step.signal ? '完成并继续' : '已了解，继续' }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
  });
  it('advances to the illustrated client tutorial when its settings link is opened', async () => {
    stored('parse-choices', { entryId:'sample', root:'C:/tutorial' });
    const props = defaults();
    render(<OnboardingGuide {...props} entries={[entry]} />);
    act(() => openOnboarding());
    await prepared();
    expect(screen.getByRole('heading', { name:/推荐：从 MinerU 客户端导入/ })).toBeTruthy();
    expect(props.onRoute).toHaveBeenLastCalledWith('parser-zip', 'sample');
    act(() => window.dispatchEvent(new Event(GUIDE_MINERU_TUTORIAL_EVENT)));
    expect(screen.getByRole('heading', { name:/跟随截图导入 MinerU 客户端结果/ })).toBeTruthy();
    expect(props.onRoute).toHaveBeenLastCalledWith('mineru-guide', 'sample');
  });
  it('shows only a stationary loading notice until the new step target is ready', async () => {
    const readyRect = { x:316, y:76, width:588, height:648, viewportWidth:1200, viewportHeight:800 };
    let pdfReady = false;
    vi.mocked(spotlight.useSpotlight).mockImplementation(selector => selector.includes('pdf-page') && !pdfReady ? null : readyRect);
    const props = defaults();
    const view = render(<OnboardingGuide {...props} entries={[entry]} />);
    act(() => openOnboarding()); await prepared();
    fireEvent.click(screen.getByText('已了解，继续'));
    expect(screen.queryByRole('heading', { name:/2\. 打开 PDF/ })).toBeNull();
    expect(screen.getByText('正在加载本步页面，准备好后显示引导…')).toBeTruthy();
    expect(screen.getByRole('button', { name:'暂停引导' })).toBeTruthy();
    expect(document.querySelector('[data-guide-spotlight-window]')).toBeNull();
    expect(document.querySelector('[data-guide-target-cue]')).toBeNull();
    pdfReady = true;
    view.rerender(<OnboardingGuide {...props} entries={[entry]} />);
    expect(screen.getByRole('heading', { name:/2\. 打开 PDF/ })).toBeTruthy();
    const panel = screen.getByRole('dialog') as HTMLElement;
    expect(panel.style.left).toBe('12px');
    expect(panel.style.width).toBe('292px');
  });
  it('keeps a clipped explanation in the lower dark band instead of oscillating into the side', async () => {
    stored('open-pdf', { entryId:'sample', root:'C:/tutorial' });
    // The PDF's cue occupies the middle of the left strip. A natural 607px panel
    // fits only below the PDF; its clipped 260px height must not select that strip again.
    vi.mocked(spotlight.useSpotlight).mockReturnValue({ x:364, y:171.5, width:904, height:264, viewportWidth:1280, viewportHeight:720 });
    let resizePanel!: () => void;
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback:() => void) {}
      observe(element:HTMLElement) { if (element.getAttribute('aria-labelledby') === 'guide-title') resizePanel = this.callback; }
      unobserve() {} disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(260);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(547);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
    render(<OnboardingGuide {...defaults()} entries={[entry]} />);
    act(() => openOnboarding()); await prepared();
    const panel = screen.getByRole('dialog') as HTMLElement;
    expect(panel.style.top).toBe('447.5px');
    const position = panel.getAttribute('style');
    act(() => resizePanel());
    expect(panel.getAttribute('style')).toBe(position);
    fireEvent.click(screen.getByRole('button', { name:'暂停引导' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keeps step two on PDF until the user explicitly continues, without an import flash', async () => {
    const props = defaults();
    const view = render(<OnboardingGuide {...props} />);
    await prepared();
    view.rerender(<OnboardingGuide {...props} entries={[entry]} layout={{ ...layout, left:{ kind:'pdf', entryId:'sample' } }} />);
    fireEvent.click(screen.getByText('已了解，继续'));
    expect(screen.getByRole('heading', { name:/2\. 打开 PDF/ })).toBeTruthy();
    expect(props.onRoute).toHaveBeenLastCalledWith('pdf', 'sample');
    await act(async () => {});
    expect(screen.getByRole('heading', { name:/2\. 打开 PDF/ })).toBeTruthy();
    expect(props.onImportSample).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(GUIDE_STORAGE_KEY)!).current).toBe('open-pdf');
    fireEvent.click(screen.getByText('完成并继续'));
    expect(screen.getByRole('heading', { name:/3\. 条目库/ })).toBeTruthy();
  });
  it('does not trap the user on the hover lesson when PDF regions do not receive pointer events', async () => {
    stored('hover', { entryId:'sample', root:'C:/tutorial' });
    const parsed = { ...entry, pdf:{ ...entry.pdf!, parse:{ ...entry.pdf!.parse, status:'succeeded' as const } } };
    render(<OnboardingGuide {...defaults()} entries={[parsed]} />);
    act(() => openOnboarding()); await prepared();
    const next = screen.getByRole('button', { name:'已了解，继续' }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(screen.getByRole('heading', { name:/重排视图与原 PDF/ })).toBeTruthy();
  });
  it('does not route or change steps while the offline demo is being prepared', async () => {
    stored('welcome');
    let finish!: (id:string) => void;
    const props = defaults(); props.onImportSample.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<OnboardingGuide {...props} />);
    act(() => openOnboarding());
    expect(props.onRoute).not.toHaveBeenCalled();
    expect((screen.getByText('已了解，继续') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('heading', { name:/1\. 认识左侧导航/ })).toBeTruthy();
    await act(async () => finish('sample'));
    expect(screen.getByRole('heading', { name:/1\. 认识左侧导航/ })).toBeTruthy();
    expect((screen.getByText('已了解，继续') as HTMLButtonElement).disabled).toBe(false);
  });
  it('introduces the five navigation entries in order without tutorial implementation copy', () => {
    render(<OnboardingGuide {...defaults()} />);
    const items = [...screen.getByRole('dialog').querySelectorAll('ol > li')];
    expect(items.map(item => item.textContent?.split('：')[0].replace(/^\d/, ''))).toEqual(['条目库', '条目详情', '搜索', '助手', '标签阅读']);
    expect(screen.queryByText(/只有介绍导航/)).toBeNull();
    expect(screen.queryByText(/教学对象：/)).toBeNull();
  });
  it('lets keyboard focus choose the matching navigation explanation', async () => {
    render(<><nav className="activitybar"><button aria-label="搜索">搜索</button></nav><OnboardingGuide {...defaults()} /></>);
    await prepared();
    const item = screen.getByText('搜索：查找资料库中的论文、笔记和正文，打开结果或定位原文。').closest('button')!;
    fireEvent.focus(item);
    expect(item.getAttribute('aria-current')).toBe('true');
  });
  it('keeps the navigation explanation panel stationary as the matching icon changes', async () => {
    render(<OnboardingGuide {...defaults()} />);
    await prepared();
    const panel = screen.getByRole('dialog') as HTMLElement;
    const initialLeft = panel.style.left;
    fireEvent.focus(screen.getByText('助手：围绕论文提问、解释内容、整理笔记，并预览和确认修改。').closest('button')!);
    expect(panel.style.left).toBe(initialLeft);
    expect(document.querySelector('[data-guide-target-cue]')?.textContent).toBe('4助手');
    fireEvent.focus(screen.getByText('标签阅读：按标签汇集多篇论文和相关笔记，方便对照阅读与整理。').closest('button')!);
    expect(panel.style.left).toBe(initialLeft);
  });
  it('maps all three note concepts to their own real sidebar locations', async () => {
    stored('note-types', { entryId:'sample', root:'C:/tutorial' });
    render(<OnboardingGuide {...defaults()} entries={[entry]} />);
    act(() => openOnboarding()); await prepared();
    const items = [...document.querySelectorAll<HTMLButtonElement>('ol[aria-label="本步界面说明"] button')];
    expect(items).toHaveLength(3);
    fireEvent.mouseEnter(items[1]);
    expect(document.querySelector('[data-guide-target-cue]')?.textContent).toBe('2批注也在片段记录');
    fireEvent.focus(items[2]);
    expect(document.querySelector('[data-guide-target-cue]')?.textContent).toBe('3文档笔记');
    expect(screen.getByText(/这一步：依次悬停本步三条说明/)).toBeTruthy();
  });
  it('labels exact controls in later lessons without changing the larger interactive spotlight', async () => {
    stored('assistant-context', { entryId:'sample', root:'C:/tutorial' });
    render(<OnboardingGuide {...defaults()} entries={[entry]} />);
    act(() => openOnboarding()); await prepared();
    const cue = document.querySelector<HTMLElement>('[data-guide-target-cue]');
    expect(cue?.textContent).toBe('选择元素');
    expect(cue?.className).toContain('pointer-events-none');
    expect(document.querySelector('[data-guide-spotlight-window]')?.getAttribute('width')).toBe('588');
  });
  it('does not offer or bind an unrelated currently selected PDF as the tutorial paper', async () => {
    stored('open-pdf');
    const props = defaults();
    render(<OnboardingGuide {...props} entries={[{ ...entry, id:'other', title:'Other paper', fields:{} }]} selectedEntryId="other" />);
    act(() => openOnboarding());
    await prepared();
    expect(screen.queryByRole('button', { name:'使用当前 PDF 作为教学对象' })).toBeNull();
    expect(screen.queryByText(/教学对象：/)).toBeNull();
    expect(props.onRoute).toHaveBeenLastCalledWith('pdf', null);
  });
  it('opens for a new empty library but not an existing user', () => {
    const view = render(<OnboardingGuide {...defaults()} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByText('暂停引导'));
    expect(screen.queryByRole('dialog')).toBeNull();
    view.unmount();
    localStorage.clear();
    render(<OnboardingGuide {...defaults()} entries={[entry]} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('prepares once per opening and supports skip, pause, resume and replay', async () => {
    const props = defaults();
    render(<><OnboardingGuide {...props} /><OnboardingSettings /></>);
    await prepared();
    fireEvent.click(screen.getByText('跳过本步'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(GUIDE_STORAGE_KEY)!).current).toBe('open-pdf'));
    expect(JSON.parse(localStorage.getItem(GUIDE_STORAGE_KEY)!).skipped).toEqual(['welcome']);
    fireEvent.click(screen.getByText('暂停引导'));
    fireEvent.click(screen.getByText('继续新手引导'));
    await prepared();
    expect(screen.getByRole('heading', { name:/打开 PDF/ })).toBeTruthy();
    fireEvent.keyDown(window, { key:'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByText('从头回放'));
    await prepared();
    expect(screen.getByRole('heading', { name:/认识左侧导航/ })).toBeTruthy();
    expect(props.onImportSample).toHaveBeenCalledTimes(3);
  });
  it('prepares immediately on opening, exposes errors and only retries explicitly', async () => {
    const props = defaults(); props.onImportSample.mockRejectedValueOnce(new Error('本地示例不可用'));
    render(<OnboardingGuide {...props} />);
    expect(props.onImportSample).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('本地示例不可用'));
    expect(props.onImportSample).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('重试准备示例'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(GUIDE_STORAGE_KEY)!).entryId).toBe('sample'));
    expect(JSON.parse(localStorage.getItem(GUIDE_STORAGE_KEY)!).current).toBe('welcome');
  });
  it('does not credit unavailable parsed steps; skipping stays available', async () => {
    stored('blocks', { entryId:'sample', root:'C:/tutorial' });
    render(<OnboardingGuide {...defaults()} entries={[entry]} selectedEntryId="sample" />);
    act(() => openOnboarding());
    await prepared();
    expect((screen.getByText('已了解，继续') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('跳过本步') as HTMLButtonElement).disabled).toBe(false);
  });
  it('prepares the PDF and an existing note for the source-link lesson, or explains what is missing', async () => {
    stored('source-note', { entryId:'sample', root:'C:/tutorial' });
    const parsed = { ...entry, pdf:{ ...entry.pdf!, parse:{ ...entry.pdf!.parse, status:'succeeded' as const } } };
    const props = defaults();
    const view = render(<OnboardingGuide {...props} entries={[parsed]} />);
    act(() => openOnboarding()); await prepared();
    expect(screen.getByText(/需要先有一篇文档笔记/)).toBeTruthy();
    expect((screen.getByText('已了解，继续') as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<OnboardingGuide {...props} entries={[{ ...parsed, contents:[{ kind:'note', note_id:'note-one', title:'阅读笔记' }] }]} />);
    expect(props.onRoute).toHaveBeenLastCalledWith('pdf-note', 'sample');
    expect(screen.queryByText(/需要先有一篇文档笔记/)).toBeNull();
  });
  it('does not substitute another paper when the tutorial paper was deleted', () => {
    stored('open-pdf', { entryId:'deleted', root:'C:/tutorial' });
    render(<OnboardingGuide {...defaults()} entries={[entry]} selectedEntryId="sample" />);
    act(() => openOnboarding());
    expect(screen.getByText(/需要先导入一篇 PDF/)).toBeTruthy();
  });
  it('detects duplicate PDF views and releases overlay on unmount', async () => {
    stored('split', { entryId:'sample', root:'C:/tutorial' });
    const split = { ...layout, left:{ kind:'pdf', entryId:'sample' }, right:{ kind:'pdf', entryId:'sample', viewId:'copy' } } as WorkspaceSurfaceLayout;
    const view = render(<OnboardingGuide {...defaults()} entries={[entry]} layout={split} />);
    act(() => openOnboarding());
    await prepared();
    expect((screen.getByText('完成并继续') as HTMLButtonElement).disabled).toBe(false);
    view.unmount();
    expect(document.querySelector('[data-guide-overlay]')).toBeNull();
  });
  it('prepares the two follow-up lessons independently when their preceding practice was skipped', async () => {
    stored('split-translation', { entryId:'sample', root:'C:/tutorial' });
    const parsed:EntryMeta = { ...entry, contents:[{ kind:'note', note_id:'guide-note', title:'演示笔记' }],
      pdf:{ ...entry.pdf!, parse:{ ...entry.pdf!.parse, status:'succeeded' } } };
    const props = defaults();
    const view = render(<OnboardingGuide {...props} entries={[parsed]} />);
    act(() => openOnboarding()); await prepared();
    expect(props.onRoute).toHaveBeenLastCalledWith('split-pdf', 'sample');
    fireEvent.click(screen.getByText('任务目录'));
    fireEvent.click(screen.getByRole('button', { name:/输入、保存，并核对状态/ }));
    expect(props.onRoute).toHaveBeenLastCalledWith('note', 'sample');
    expect((screen.getByRole('button', { name:'完成并继续' }) as HTMLButtonElement).disabled).toBe(false);
    view.unmount();
  });
  it('does not credit a hidden floating editor as an opened segment-note editor', async () => {
    stored('segment-note', { entryId:'sample', root:'C:/tutorial' });
    const parsed = { ...entry, pdf:{ ...entry.pdf!, parse:{ ...entry.pdf!.parse, status:'succeeded' as const } } };
    const editor = document.createElement('div'); editor.className = 'app-floating-segment-panel is-hidden';
    const marker = document.createElement('div'); marker.dataset.guide = 'segment-editor'; editor.append(marker);
    editor.getBoundingClientRect = () => ({ width:100, height:100 } as DOMRect);
    marker.getBoundingClientRect = () => ({ width:100, height:100 } as DOMRect);
    document.body.append(editor);
    render(<OnboardingGuide {...defaults()} entries={[parsed]} />);
    act(() => openOnboarding()); await prepared();
    expect(screen.getByText(/本步练习可选/)).toBeTruthy();
    act(() => editor.classList.remove('is-hidden'));
    await waitFor(() => expect(screen.getByText(/已体验本步交互/)).toBeTruthy());
    editor.remove();
  });
  it('reports note editing only after the note returns to a saved state', async () => {
    stored('write-note', { entryId:'sample', root:'C:/tutorial' });
    const withNote = { ...entry, contents:[{ kind:'note' as const, note_id:'guide-note', title:'演示笔记' }] };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left:0, top:0, right:1200, bottom:800, width:1200, height:800 } as DOMRect);
    render(<OnboardingGuide {...defaults()} entries={[withNote]} layout={{ ...layout, left:{ kind:'note', entryId:'sample', noteId:'guide-note' } }} />);
    act(() => openOnboarding()); await prepared();
    const editor = document.createElement('div'); editor.className = 'markdown-note-editor';
    editor.dataset.workspaceSurfaceKey = 'note:sample:guide-note'; editor.dataset.workspaceSurfaceActive = 'true';
    editor.dataset.guideNoteSaveState = 'saved';
    const scroll = document.createElement('div'); scroll.className = 'markdown-note-scroll';
    const body = document.createElement('div'); body.className = 'tiptap'; scroll.append(body); editor.append(scroll);
    document.body.append(editor);
    fireEvent.input(body);
    expect(screen.getByText(/本步练习可选/)).toBeTruthy();
    await act(async () => { editor.dataset.guideNoteSaveState = 'dirty'; });
    expect(screen.getByText(/本步练习可选/)).toBeTruthy();
    await act(async () => { editor.dataset.guideNoteSaveState = 'saving'; });
    await act(async () => { editor.dataset.guideNoteSaveState = 'saved'; });
    await waitFor(() => expect(screen.getByText(/已体验本步交互/)).toBeTruthy());
    editor.remove();
  });
  it('ignores a late sample result after switching libraries', async () => {
    stored('import');
    let finish!: (id:string) => void;
    const props = defaults(); props.onImportSample.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<OnboardingGuide {...props} />);
    act(() => openOnboarding());
    view.rerender(<OnboardingGuide {...props} root={null} />);
    await act(async () => finish('old-paper'));
    expect(JSON.parse(localStorage.getItem(GUIDE_STORAGE_KEY)!).entryId).toBeNull();
  });
  it('keeps showcase progress separate from the real tutorial', async () => {
    render(<OnboardingGuide {...defaults()} storageKey="fixture-only" />);
    await prepared();
    fireEvent.click(screen.getByText('跳过本步'));
    expect(localStorage.getItem(GUIDE_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem('fixture-only')!).skipped).toEqual(['welcome']);
  });
  it('yields to a real modal and resumes with the recorded operation', async () => {
    stored('translation-task');
    const parsed = { ...entry, pdf:{ ...entry.pdf!, parse:{ ...entry.pdf!.parse, status:'succeeded' as const } } };
    render(<OnboardingGuide {...defaults()} entries={[parsed]} selectedEntryId="sample" />);
    act(() => openOnboarding());
    const modal = document.createElement('div'); modal.dataset.slot = 'dialog-content'; modal.dataset.guide = 'translation-task';
    modal.getBoundingClientRect = () => ({ width:100, height:100 } as DOMRect);
    act(() => document.body.append(modal));
    await waitFor(() => expect((document.querySelector('[data-guide-overlay]') as HTMLElement).style.display).toBe('none'));
    expect(modal.querySelector('[data-guide-modal-reminder]')?.textContent).toContain('仍在进行');
    fireEvent.keyDown(modal, { key:'Escape' });
    expect(document.querySelector('[data-guide-overlay]')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(GUIDE_STORAGE_KEY)!).current).toBe('translation-task');
    act(() => modal.remove());
    await waitFor(() => expect((document.querySelector('[data-guide-overlay]') as HTMLElement).style.display).toBe(''));
    expect((screen.getByText('完成并继续') as HTMLButtonElement).disabled).toBe(false);
  });
  it('lets the optional translation-task lesson complete without opening a dialog or calling a model', async () => {
    stored('translation-task', { entryId:'sample', root:'C:/tutorial' });
    const parsed = { ...entry, pdf:{ ...entry.pdf!, parse:{ ...entry.pdf!.parse, status:'succeeded' as const } } };
    render(<OnboardingGuide {...defaults()} entries={[parsed]} />);
    act(() => openOnboarding()); await prepared();
    const next = screen.getByRole('button', { name:'完成并继续' }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    expect(screen.getByText(/本步练习可选/)).toBeTruthy();
    fireEvent.click(next);
    expect(screen.getByRole('heading', { name:/切换原文与译文显示/ })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(GUIDE_STORAGE_KEY)!).completed).toContain('translation-task');
  });
  it('uses Escape to close an open menu without pausing the tutorial', async () => {
    stored('translation-task', { entryId:'sample', root:'C:/tutorial' });
    const parsed = { ...entry, pdf:{ ...entry.pdf!, parse:{ ...entry.pdf!.parse, status:'succeeded' as const } } };
    render(<OnboardingGuide {...defaults()} entries={[parsed]} />);
    act(() => openOnboarding()); await prepared();
    const menu = document.createElement('div'); menu.dataset.slot = 'dropdown-menu-content';
    menu.getBoundingClientRect = () => ({ width:100, height:100 } as DOMRect);
    act(() => document.body.append(menu));
    fireEvent.keyDown(menu, { key:'Escape' });
    expect(screen.getByRole('dialog', { name:/选择范围/ })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(GUIDE_STORAGE_KEY)!).current).toBe('translation-task');
    act(() => menu.remove());
  });
  it('prepares the demo without advancing any tutorial step', async () => {
    stored('welcome');
    const props = defaults();
    render(<OnboardingGuide {...props} entries={[entry]} selectedEntryId="sample" />);
    act(() => openOnboarding());
    await prepared();
    expect(JSON.parse(localStorage.getItem(GUIDE_STORAGE_KEY)!)).toMatchObject({ current:'welcome', completed:[], skipped:[], entryId:'sample' });
    expect(notify).not.toHaveBeenCalled();
  });
  it('shows the exact resume location on pause and offers a settings shortcut', () => {
    const props = defaults(); render(<OnboardingGuide {...props} />);
    fireEvent.click(screen.getByText('暂停引导'));
    const message = notify.mock.calls[0][0] as unknown as { title:string; description:string; action:React.ReactElement };
    expect(message.description).toContain('设置 → 资料库与数据 → 新手引导 → 继续新手引导');
    render(message.action);
    fireEvent.click(screen.getByText('前往设置'));
    expect(props.onRoute).toHaveBeenCalledWith('onboarding-settings', null);
  });
  it('gives the task directory its own navigation and current-step status', () => {
    render(<OnboardingGuide {...defaults()} />);
    fireEvent.click(screen.getByText('任务目录'));
    const navigation = screen.getByRole('navigation', { name:'新手引导任务目录' });
    expect(navigation.querySelector('[aria-current="step"]')?.textContent).toContain('认识左侧导航');
  });
  it('automatically routes next, previous and task selection without an extra action button', async () => {
    stored('nav-library', { entryId:'sample', root:'C:/tutorial' });
    const props = defaults();
    const view = render(<OnboardingGuide {...props} entries={[entry]} />);
    act(() => openOnboarding());
    await prepared();
    expect(props.onRoute).toHaveBeenLastCalledWith('library-sidebar', 'sample');
    expect(screen.queryByText('前往操作区域')).toBeNull();
    fireEvent.click(screen.getByText('已了解，继续'));
    expect(props.onRoute).toHaveBeenLastCalledWith('details', 'sample');
    const count = props.onRoute.mock.calls.length;
    view.rerender(<OnboardingGuide {...props} entries={[entry]} onRoute={props.onRoute} />);
    expect(props.onRoute).toHaveBeenCalledTimes(count);
    fireEvent.click(screen.getByText('上一步'));
    expect(props.onRoute).toHaveBeenLastCalledWith('library-sidebar', 'sample');
    fireEvent.click(screen.getByText('任务目录'));
    fireEvent.click(screen.getByRole('button', { name:/助手：围绕论文进行问答/ }));
    expect(props.onRoute).toHaveBeenLastCalledWith('assistant', 'sample');
  });
  it('keeps routing pinned to the tutorial paper, not the currently selected unrelated entry', async () => {
    stored('open-pdf', { entryId:'sample', root:'C:/tutorial' });
    const props = defaults();
    render(<OnboardingGuide {...props} entries={[entry, { ...entry, id:'other', title:'Other' }]} selectedEntryId="other" />);
    act(() => openOnboarding());
    await prepared();
    expect(props.onRoute).toHaveBeenLastCalledWith('pdf', 'sample');
  });
  it('does not navigate on a delayed preparation result while paused', async () => {
    stored('import');
    let finish!: (id:string) => void;
    const props = defaults(); props.onImportSample.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<OnboardingGuide {...props} />);
    act(() => openOnboarding());
    fireEvent.keyDown(window, { key:'Escape' });
    await act(async () => finish('sample'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(props.onRoute).not.toHaveBeenCalled();
    props.onImportSample.mockImplementation(async () => 'sample');
    act(() => openOnboarding());
    await prepared();
    expect(props.onRoute).toHaveBeenLastCalledWith('pdf', null);
  });
  it('reveals the matching navigation entry with its sidebar content and restores masking on other steps', async () => {
    vi.mocked(spotlight.useSpotlight).mockRestore();
    stored('nav-library', { entryId:'sample', root:'C:/tutorial' });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this:HTMLElement) {
      return (this.classList.contains('activitybar')
        ? { left:0, top:40, right:48, bottom:760, width:48, height:720 }
        : this.classList.contains('app-sidebar') ? { left:48, top:40, right:312, bottom:760, width:264, height:720 }
        : this.dataset.guide === 'pdf-page' ? { left:320, top:80, right:900, bottom:720, width:580, height:640 }
        : this.tagName === 'BUTTON' && this.closest('.activitybar') ? (() => {
          const position = ['条目库', '条目详情', '搜索', '助手', '标签阅读'].indexOf(this.getAttribute('aria-label') ?? '');
          const top = 48 + Math.max(0, position) * 44;
          return { left:8, top, right:40, bottom:top + 32, width:32, height:32 };
        })()
        : { left:0, top:0, right:1200, bottom:800, width:1200, height:800 }) as DOMRect;
    });
    const view = render(<><nav className="activitybar">{['条目库', '条目详情', '搜索', '助手', '标签阅读'].map(label => <button key={label} aria-label={label}>{label}</button>)}</nav><aside className="app-sidebar">侧栏内容</aside><div data-workspace-surface-key="pdf:sample" data-workspace-surface-active="true"><div data-guide="pdf-page" /></div><OnboardingGuide {...defaults()} entries={[entry]} layout={{ ...layout, left:{ kind:'pdf', entryId:'sample' } }} /></>);
    act(() => openOnboarding());
    await waitFor(() => expect(document.querySelector('[data-guide-spotlight-window]')?.getAttribute('x')).toBe('44'));
    expect(document.querySelector('[data-guide-spotlight-window]')?.getAttribute('height')).toBe('728');
    expect(document.querySelector('[data-guide-spotlight-window]')?.getAttribute('width')).toBe('272');
    expect(document.querySelector('[data-guide-related-window]')?.getAttribute('x')).toBe('4');
    expect(document.querySelector('[data-guide-related-window]')?.getAttribute('height')).toBe('40');
    expect(document.querySelectorAll('mask rect[fill="black"]').length).toBe(2);
    expect(parseFloat((screen.getByRole('dialog') as HTMLElement).style.left)).toBeGreaterThanOrEqual(328);
    expect(document.querySelector('[data-guide-navigation-window]')).toBeNull();
    fireEvent.click(screen.getByText('任务目录'));
    fireEvent.click(screen.getByRole('button', { name:/打开 PDF，理解条目与标签页/ }));
    await waitFor(() => expect(document.querySelector('[data-guide-spotlight-window]')?.getAttribute('x')).toBe('316'));
    expect(document.querySelectorAll('mask rect[fill="black"]').length).toBe(1);
    expect(document.querySelector('[data-guide-related-window]')).toBeNull();
    fireEvent.click(screen.getByText('任务目录'));
    fireEvent.click(screen.getByRole('button', { name:/认识左侧导航/ }));
    await waitFor(() => expect(document.querySelector('[data-guide-spotlight-window]')?.getAttribute('x')).toBe('0'));
    expect(document.querySelector('[data-guide-spotlight-window]')?.getAttribute('height')).toBe('728');
    await waitFor(() => expect(document.querySelector('[data-guide-target-cue]')?.textContent).toBe('1条目库'));
    expect(document.querySelector('[data-guide-cue-outline]')?.getAttribute('y')).toBe('44');
    fireEvent.mouseEnter(screen.getByText('助手：围绕论文提问、解释内容、整理笔记，并预览和确认修改。'));
    await waitFor(() => expect(document.querySelector('[data-guide-target-cue]')?.textContent).toBe('4助手'));
    expect(document.querySelector('[data-guide-cue-outline]')?.getAttribute('y')).toBe('176');
    expect(document.querySelector('[data-guide-spotlight-window]')?.getAttribute('height')).toBe('728');
    fireEvent.mouseOver(screen.getByRole('button', { name:'搜索' }));
    await waitFor(() => expect(document.querySelector('[data-guide-target-cue]')?.textContent).toBe('3搜索'));
    expect(document.querySelector('[data-guide-cue-outline]')?.getAttribute('y')).toBe('132');
    view.unmount();
    expect(document.querySelector('[data-guide-spotlight-window]')).toBeNull();
    vi.restoreAllMocks();
  });
});
