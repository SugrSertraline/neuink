// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGuideInteractionBoundary } from './useGuideInteractionBoundary';
import { GUIDE_STEPS } from './catalog';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { findSpotlightTarget } from './useSpotlight';
import { OBSERVE_GUIDE, type GuideInteractionPolicy } from './guideInteractionPolicy';

function Harness({ enabled = true, selector = '[data-test-target]', relatedSelector, highlighted = true, stepKey, interaction }: {
  enabled?:boolean; selector?:string; relatedSelector?:string; highlighted?:boolean; stepKey?:string;
  interaction?:GuideInteractionPolicy;
}) {
  const viewport = useRef<HTMLDivElement>(null); const panel = useRef<HTMLElement>(null);
  const rectangles = useGuideInteractionBoundary({ selector, viewport, panel, enabled, relatedSelector, highlighted, stepKey, interaction });
  return <div ref={viewport} data-guide-overlay><section ref={panel} tabIndex={-1}>
    <button>引导按钮</button><output>{JSON.stringify(rectangles)}</output>
  </section></div>;
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback:FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', window.clearTimeout.bind(window));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left:0, top:0, right:1000, bottom:800, width:1000, height:800 } as DOMRect);
});
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.querySelectorAll('[data-test-popup]').forEach(element => element.remove()); });

describe('guide interaction boundary', () => {
  it.each(GUIDE_STEPS.filter(step => !step.interaction || step.interaction.mode === 'observe'))
  ('prevents the automatic $id demonstration from scrolling or performing unrelated business actions', step => {
    const action = vi.fn(); const hover = vi.fn();
    render(<><div data-test-target onWheel={action} onPointerMove={hover}>
      <button onClick={action} onPointerDown={action} onContextMenu={action} onKeyDown={action}>演示中的真实按钮</button>
    </div><Harness interaction={step.interaction ?? OBSERVE_GUIDE} /></>);
    const target = screen.getByText('演示中的真实按钮');
    for (const type of ['pointerDown', 'click', 'contextMenu', 'dragStart', 'drop'] as const) expect(fireEvent[type](target)).toBe(false);
    expect(fireEvent.wheel(target, { deltaY:100 })).toBe(false);
    expect(fireEvent.keyDown(target, { key:'PageDown' })).toBe(false);
    expect(fireEvent.keyDown(target, { key:'Enter' })).toBe(false);
    fireEvent.pointerMove(target); expect(hover).toHaveBeenCalledOnce();
    expect(action).not.toHaveBeenCalled();
    expect(fireEvent.click(screen.getByText('引导按钮'))).toBe(true);
    expect(fireEvent.wheel(screen.getByText('引导按钮'))).toBe(true);
  });

  it('keeps MinerU screenshot scrolling and copying, but blocks changing tabs or clicking other actions', () => {
    const copy = vi.fn(); const navigate = vi.fn(); const readerWheel = vi.fn();
    const step = GUIDE_STEPS.find(step => step.id === 'parse-zip')!;
    render(<><div data-guide="reader-workspace" onWheel={readerWheel}>
      <button onClick={navigate}>其他标签</button>
      <div data-guide="mineru-tutorial"><p>图文截图教程</p><button data-guide="mineru-copy-link" onClick={copy}>复制链接</button>
        <button onClick={navigate}>误操作按钮</button></div>
    </div><Harness selector={step.target} interaction={step.interaction} /></>);
    expect(step.target).not.toContain('reader-workspace');
    expect(fireEvent.wheel(screen.getByText('图文截图教程'), { deltaY:120 })).toBe(true);
    expect(readerWheel).not.toHaveBeenCalled();
    expect(fireEvent.wheel(screen.getByText('图文截图教程'), { deltaY:120, ctrlKey:true })).toBe(false);
    expect(fireEvent.click(screen.getByText('其他标签'))).toBe(false);
    expect(fireEvent.click(screen.getByText('误操作按钮'))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByText('图文截图教程'))).toBe(true);
    expect(fireEvent.keyDown(screen.getByText('图文截图教程'), { key:'c', ctrlKey:true })).toBe(true);
    fireEvent.click(screen.getByText('复制链接')); expect(copy).toHaveBeenCalledOnce();
    expect(fireEvent.keyDown(screen.getByText('复制链接'), { key:'w', ctrlKey:true })).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('allows the deliberate settings-to-tutorial action without opening every settings control', () => {
    const open = vi.fn(); const step = GUIDE_STEPS.find(step => step.id === 'parse-choices')!;
    render(<><div data-test-target><section data-setting-id="parser-zip"><button onClick={open}>教程入口</button></section>
      <button onClick={open}>其他设置</button></div><Harness interaction={step.interaction} /></>);
    fireEvent.click(screen.getByText('教程入口')); expect(open).toHaveBeenCalledOnce();
    expect(fireEvent.keyDown(screen.getByText('教程入口'), { key:'PageDown' })).toBe(false);
    expect(fireEvent.click(screen.getByText('其他设置'))).toBe(false);
    expect(open).toHaveBeenCalledOnce();
  });

  it('allows only the active tab menu and its duplicate action during the split lesson', async () => {
    const popup = document.createElement('div'); popup.dataset.slot = 'context-menu-content'; popup.dataset.testPopup = '';
    const copy = document.createElement('button'); copy.dataset.guide = 'duplicate-reading-tab'; copy.textContent = '复制当前标签';
    const close = document.createElement('button'); close.textContent = '关闭当前标签'; popup.append(copy, close);
    const copied = vi.fn(); copy.addEventListener('click', copied);
    const step = GUIDE_STEPS.find(step => step.id === 'split')!;
    const switched = vi.fn();
    render(<><div data-guide="tabs"><div className="workspace-surface-tab is-active" onContextMenu={() => document.body.append(popup)}>
      <button onClick={switched}>当前 PDF</button></div><button onClick={switched}>其他 PDF</button></div>
      <Harness selector={step.target} interaction={step.interaction} /></>);
    expect(fireEvent.click(screen.getByText('当前 PDF'))).toBe(false);
    expect(fireEvent.pointerDown(screen.getByText('当前 PDF'))).toBe(false);
    expect(fireEvent.contextMenu(screen.getByText('其他 PDF'))).toBe(false);
    expect(fireEvent.wheel(screen.getByText('当前 PDF'))).toBe(false);
    fireEvent.contextMenu(screen.getByText('当前 PDF'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('viewportWidth'));
    expect(fireEvent.click(close)).toBe(false);
    expect(fireEvent.keyDown(close, { key:' ' })).toBe(false);
    fireEvent.click(copy); expect(copied).toHaveBeenCalledOnce();
    expect(switched).not.toHaveBeenCalled();
  });

  it('lets a hover demonstration preview scroll and select text without enabling its navigation buttons', async () => {
    const preview = document.createElement('div'); preview.dataset.slot = 'pointer-preview'; preview.dataset.testPopup = '';
    preview.setAttribute('aria-label', '片段悬停预览');
    const text = document.createElement('p'); text.textContent = '可阅读和复制的原文';
    const action = document.createElement('button'); action.textContent = '跳转真实页面'; preview.append(text, action);
    render(<><div data-test-target>自动悬停目标</div><Harness interaction={OBSERVE_GUIDE} /></>);
    fireEvent.pointerMove(screen.getByText('自动悬停目标')); document.body.append(preview);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('viewportWidth'));
    expect(fireEvent.wheel(text)).toBe(true);
    expect(fireEvent.mouseDown(text)).toBe(true);
    expect(fireEvent.keyDown(text, { key:'c', ctrlKey:true })).toBe(true);
    expect(fireEvent.click(action)).toBe(false);
    expect(fireEvent.wheel(screen.getByText('自动悬停目标'))).toBe(false);
  });

  it('blocks wheel bubbling from practice toolbars while still permitting the actual task button', () => {
    const open = vi.fn(); const wheel = vi.fn(); const step = GUIDE_STEPS.find(step => step.id === 'translation-task')!;
    render(<><div data-test-target onWheel={wheel}><button onClick={open}>翻译任务入口</button></div><Harness interaction={step.interaction} /></>);
    expect(fireEvent.wheel(screen.getByText('翻译任务入口'))).toBe(false);
    expect(wheel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('翻译任务入口')); expect(open).toHaveBeenCalledOnce();
  });

  it('preserves a real modal Radix tab menu and the original visible spotlight while copying', async () => {
    const copy = vi.fn(); const close = vi.fn(); const step = GUIDE_STEPS.find(step => step.id === 'split')!;
    render(<><div data-guide="tabs"><ContextMenu><ContextMenuTrigger asChild>
      <div className="workspace-surface-tab is-active">真实当前标签</div></ContextMenuTrigger>
      <ContextMenuContent><ContextMenuItem data-guide="duplicate-reading-tab" onSelect={copy}>真实复制标签</ContextMenuItem>
        <ContextMenuItem onSelect={close}>真实关闭标签</ContextMenuItem></ContextMenuContent>
    </ContextMenu></div><Harness selector={step.target} interaction={step.interaction} /></>);
    fireEvent.contextMenu(screen.getByText('真实当前标签'));
    await screen.findByText('真实复制标签');
    expect(findSpotlightTarget(step.target, document.querySelector('[data-guide-overlay]'))).toBeDefined();
    await waitFor(() => expect(screen.getByRole('status', { hidden:true }).textContent).toContain('viewportWidth'));
    expect(fireEvent.click(screen.getByText('真实关闭标签'))).toBe(false);
    fireEvent.click(screen.getByText('真实复制标签'));
    expect(copy).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  });

  it('blocks background hover and drag before React and document-level handlers, but preserves highlighted hover', () => {
    const outside = vi.fn(); const inside = vi.fn(); const documentHover = vi.fn();
    document.addEventListener('pointermove', documentHover, true);
    try {
      render(<><button onPointerEnter={outside} onPointerMove={outside} onMouseEnter={outside} onMouseMove={outside}
        onDragStart={outside} onDragOver={outside} onDrop={outside}>遮暗按钮</button>
        <div data-test-target><button onPointerEnter={inside} onPointerMove={inside} onMouseEnter={inside} onMouseMove={inside}>聚焦按钮</button></div><Harness /></>);
      const background = screen.getByText('遮暗按钮');
      fireEvent.pointerEnter(background); fireEvent.pointerMove(background);
      fireEvent.mouseEnter(background); fireEvent.mouseMove(background);
      fireEvent.dragStart(background); fireEvent.dragOver(background); fireEvent.drop(background);
      expect(outside).not.toHaveBeenCalled();
      expect(documentHover).not.toHaveBeenCalled();
      const target = screen.getByText('聚焦按钮');
      fireEvent.pointerEnter(target); fireEvent.pointerMove(target);
      fireEvent.mouseEnter(target); fireEvent.mouseMove(target);
      expect(inside).toHaveBeenCalledTimes(4);
      expect(documentHover).toHaveBeenCalledOnce();
    } finally { document.removeEventListener('pointermove', documentHover, true); }
  });

  it('does not authorize any PDF preview or selection toolbar without a highlighted source interaction', async () => {
    const preview = document.createElement('div'); preview.dataset.slot = 'pointer-preview'; preview.dataset.testPopup = '';
    preview.setAttribute('aria-label', '片段悬停预览');
    const toolbar = document.createElement('div'); toolbar.dataset.readingSelectionToolbar = ''; toolbar.dataset.testPopup = '';
    render(<><div data-guide="pdf-page">PDF 页面</div><button>黑色区域</button><Harness selector="[data-guide='pdf-page']" /></>);
    fireEvent.pointerMove(screen.getByText('黑色区域'));
    document.body.append(preview, toolbar);
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toBe('[]');
    expect(fireEvent.wheel(preview)).toBe(false);
    expect(fireEvent.click(toolbar)).toBe(false);
  });

  it('blocks an existing target until its visible spotlight is ready', () => {
    const click = vi.fn();
    const view = render(<><div data-test-target><button onClick={click}>尚未高亮</button></div><Harness highlighted={false} /></>);
    expect(fireEvent.click(screen.getByText('尚未高亮'))).toBe(false);
    expect(fireEvent.pointerMove(screen.getByText('尚未高亮'))).toBe(false);
    view.rerender(<><div data-test-target><button onClick={click}>尚未高亮</button></div><Harness highlighted /></>);
    fireEvent.click(screen.getByText('尚未高亮')); expect(click).toHaveBeenCalledOnce();
  });

  it('allows a toolbar after a long genuine selection only in the highlighted text', async () => {
    let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
    const toolbar = document.createElement('div'); toolbar.dataset.readingSelectionToolbar = ''; toolbar.dataset.testPopup = '';
    render(<><p data-test-target>高亮文本中的选区</p><p>背景文字</p><Harness /></>);
    const select = (text:string) => {
      const range = document.createRange(); range.selectNodeContents(screen.getByText(text));
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
      fireEvent(document, new Event('selectionchange'));
    };
    select('背景文字'); document.body.append(toolbar);
    await act(async () => {});
    expect(fireEvent.click(toolbar)).toBe(false);
    toolbar.remove();
    fireEvent.pointerDown(screen.getByText('高亮文本中的选区'));
    now = 5000; fireEvent.pointerMove(screen.getByText('高亮文本中的选区'));
    select('高亮文本中的选区'); document.body.append(toolbar);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('viewportWidth'));
    expect(fireEvent.click(toolbar)).toBe(true);
  });

  it('dismisses a previous hover card on step changes, even when both steps share the same target', async () => {
    class MousePointerEvent extends MouseEvent { readonly pointerType = 'mouse'; }
    vi.stubGlobal('PointerEvent', MousePointerEvent);
    const ui = (stepKey:string) => <><div data-test-target><HoverCard>
      <HoverCardTrigger asChild><button>高亮悬停入口</button></HoverCardTrigger>
      <HoverCardContent>真实预览内容<button>预览操作</button></HoverCardContent>
    </HoverCard></div><Harness stepKey={stepKey} /></>;
    const view = render(ui('first'));
    fireEvent.pointerMove(screen.getByText('高亮悬停入口'), { buttons:0 });
    await waitFor(() => expect(screen.queryByText('真实预览内容')).not.toBeNull());
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('viewportWidth'));
    expect(fireEvent.wheel(screen.getByText('真实预览内容'))).toBe(true);
    expect(fireEvent.click(screen.getByText('预览操作'))).toBe(true);
    view.rerender(ui('second'));
    expect(screen.queryByText('真实预览内容')).toBeNull();
    fireEvent.pointerMove(screen.getByText('高亮悬停入口'), { buttons:0 });
    await waitFor(() => expect(screen.queryByText('真实预览内容')).not.toBeNull());
  });

  it('allows the matching navigation entry and sidebar contents while masking unrelated entries', () => {
    const click = vi.fn();
    const step = GUIDE_STEPS.find(item => item.id === 'nav-library')!;
    const view = render(<><nav className="activitybar"><button aria-label="条目库" onClick={click}>条目库</button><button aria-label="搜索" onClick={click}>搜索</button></nav>
      <aside className="app-sidebar"><button onClick={click}>展开标签</button><input aria-label="面板输入" /></aside>
      <Harness selector={step.target} relatedSelector={step.relatedTarget} /></>);
    expect(fireEvent.click(screen.getByRole('button', { name:'条目库' }))).toBe(true);
    expect(fireEvent.click(screen.getByText('展开标签'))).toBe(true);
    expect(fireEvent.wheel(screen.getByLabelText('面板输入'))).toBe(true);
    act(() => screen.getByLabelText('面板输入').focus());
    expect(document.activeElement).toBe(screen.getByLabelText('面板输入'));
    expect(fireEvent.click(screen.getByRole('button', { name:'搜索' }))).toBe(false);
    expect(click).toHaveBeenCalledTimes(2);
    view.rerender(<><nav className="activitybar"><button aria-label="条目库" onClick={click}>条目库</button></nav>
      <aside className="app-sidebar"><button onClick={click}>展开标签</button></aside><Harness selector="[data-guide='pdf-page']" /></>);
    expect(fireEvent.click(screen.getByText('展开标签'))).toBe(false);
    expect(fireEvent.click(screen.getByRole('button', { name:'条目库' }))).toBe(false);
    expect(click).toHaveBeenCalledTimes(2);
  });
  it('blocks background pointer, click, touch, context menu and keyboard activation before business handlers', () => {
    const outside = vi.fn(); const inside = vi.fn();
    render(<><button onClick={outside} onPointerDown={outside} onContextMenu={outside} onDoubleClick={outside} onKeyDown={outside} onTouchStart={outside}>背景按钮</button>
      <div data-test-target><button onClick={inside}>高亮按钮</button></div><Harness /></>);
    const background = screen.getByText('背景按钮');
    expect(fireEvent.pointerDown(background)).toBe(false);
    expect(fireEvent.click(background)).toBe(false);
    expect(fireEvent.contextMenu(background)).toBe(false);
    expect(fireEvent.doubleClick(background)).toBe(false);
    expect(fireEvent.keyDown(background, { key:'Enter' })).toBe(false);
    expect(fireEvent.touchStart(background)).toBe(false);
    expect(outside).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('高亮按钮'));
    expect(inside).toHaveBeenCalledOnce();
    expect(fireEvent.click(screen.getByText('引导按钮'))).toBe(true);
  });
  it('redirects background focus, blocks wheel and keeps guide and target scrolling available', () => {
    render(<><input aria-label="背景输入" /><div data-test-target><input aria-label="高亮输入" /></div><Harness /></>);
    act(() => screen.getByLabelText('背景输入').focus());
    expect(document.activeElement).toBe(screen.getByText('引导按钮'));
    act(() => screen.getByLabelText('高亮输入').focus());
    expect(document.activeElement).toBe(screen.getByLabelText('高亮输入'));
    expect(fireEvent.wheel(screen.getByLabelText('背景输入'))).toBe(false);
    expect(fireEvent.wheel(screen.getByLabelText('高亮输入'))).toBe(true);
    expect(fireEvent.keyDown(window, { key:'Escape' })).toBe(true);
  });
  it('blocks all background interaction while the highlight target is loading and releases listeners when disabled or unmounted', () => {
    const click = vi.fn(); const hover = vi.fn();
    const view = render(<><button onClick={click} onMouseMove={hover}>背景</button><Harness selector="[data-not-loaded]" /></>);
    fireEvent.click(screen.getByText('背景')); expect(click).not.toHaveBeenCalled();
    fireEvent.mouseMove(screen.getByText('背景')); expect(hover).not.toHaveBeenCalled();
    view.rerender(<><button onClick={click} onMouseMove={hover}>背景</button><Harness enabled={false} /></>);
    fireEvent.click(screen.getByText('背景')); expect(click).toHaveBeenCalledOnce();
    fireEvent.mouseMove(screen.getByText('背景')); expect(hover).toHaveBeenCalledOnce();
    view.unmount();
    render(<button onClick={click}>背景</button>);
    fireEvent.click(screen.getByText('背景')); expect(click).toHaveBeenCalledTimes(2);
  });
  it('highlights and permits a controlled portal from the target, but not an unrelated pre-existing popup', async () => {
    const popup = document.createElement('div'); popup.dataset.slot = 'popover-content'; popup.dataset.testPopup = ''; popup.id = 'controlled-popup';
    const item = document.createElement('button'); item.textContent = '菜单项目'; popup.append(item);
    const action = vi.fn(); item.addEventListener('click', action);
    render(<><div data-test-target><button aria-controls="controlled-popup" onClick={() => document.body.append(popup)}>打开菜单</button></div>
      <div data-slot="popover-content"><button>无关菜单</button></div><Harness /></>);
    expect(fireEvent.click(screen.getByText('无关菜单'))).toBe(false);
    fireEvent.click(screen.getByText('打开菜单'));
    act(() => item.focus());
    expect(document.activeElement).toBe(item);
    fireEvent.click(item); expect(action).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('viewportWidth'));
    expect(fireEvent.click(screen.getByText('无关菜单'))).toBe(false);
    act(() => popup.remove());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('[]'));
  });
  it('allows the menu opened by right-clicking the target and resets its permissions on step changes', async () => {
    const popup = document.createElement('div'); popup.dataset.slot = 'context-menu-content'; popup.dataset.testPopup = '';
    const item = document.createElement('button'); item.textContent = '复制标签'; popup.append(item);
    const action = vi.fn(); item.addEventListener('click', action);
    const view = render(<><div data-test-target onContextMenu={() => document.body.append(popup)}>标签</div><Harness /></>);
    fireEvent.contextMenu(screen.getByText('标签'));
    fireEvent.click(item); expect(action).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('viewportWidth'));
    view.rerender(<><div data-test-target>标签</div><Harness selector="[data-next-step]" /></>);
    expect(fireEvent.click(item)).toBe(false);
    expect(action).toHaveBeenCalledOnce();
  });
  it('lets the PDF hover preview opened during the lesson receive scrolling and clicks', async () => {
    const preview = document.createElement('div');
    preview.dataset.slot = 'pointer-preview'; preview.dataset.testPopup = '';
    preview.setAttribute('aria-label', '片段悬停预览');
    const action = document.createElement('button'); action.textContent = '预览中的来源'; preview.append(action);
    const clicked = vi.fn(); action.addEventListener('click', clicked);
    render(<><div data-guide="pdf-page">PDF 正文</div><Harness selector="[data-guide='pdf-page']" /></>);
    fireEvent.pointerMove(screen.getByText('PDF 正文'));
    document.body.append(preview);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('viewportWidth'));
    expect(fireEvent.wheel(preview)).toBe(true);
    fireEvent.click(action);
    expect(clicked).toHaveBeenCalledOnce();
  });
  it('keeps the real text-selection toolbar interactive during the PDF lesson', async () => {
    const toolbar = document.createElement('div');
    toolbar.dataset.readingSelectionToolbar = ''; toolbar.dataset.testPopup = '';
    const action = document.createElement('button'); action.textContent = '选区提问'; toolbar.append(action);
    const clicked = vi.fn(); action.addEventListener('click', clicked);
    render(<><div data-guide="pdf-page">可选文字</div><Harness selector="[data-guide='pdf-page']" /></>);
    fireEvent.pointerDown(screen.getByText('可选文字'));
    document.body.append(toolbar);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('viewportWidth'));
    fireEvent.click(action); expect(clicked).toHaveBeenCalledOnce();
    expect(fireEvent.wheel(toolbar)).toBe(true);
  });
  it('allows right-clicking the segment layer beside the PDF canvas in note lessons', () => {
    const action = vi.fn();
    const selector = GUIDE_STEPS.find(step => step.id === 'segment-note')!.target;
    render(<><div data-pdf-page-surface><div data-guide="pdf-page"><canvas data-pdf-rendered="true" /></div>
      <div data-segment-uid="demo-segment" onContextMenu={action}>段落区域</div></div>
      <Harness selector={selector} /></>);
    expect(fireEvent.contextMenu(screen.getByText('段落区域'))).toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });
  it('keeps the segment editor opened from the highlighted PDF interactive while blocking unrelated panels', async () => {
    const editor = document.createElement('div'); editor.className = 'app-floating-segment-panel'; editor.dataset.testPopup = '';
    const save = document.createElement('button'); save.textContent = '保存片段笔记'; editor.append(save);
    const onSave = vi.fn(); save.addEventListener('click', onSave);
    const unrelated = document.createElement('div'); unrelated.className = 'app-floating-segment-panel'; unrelated.dataset.testPopup = '';
    const unrelatedButton = document.createElement('button'); unrelatedButton.textContent = '无关面板'; unrelated.append(unrelatedButton);
    const onUnrelated = vi.fn(); unrelatedButton.addEventListener('click', onUnrelated);
    const selector = GUIDE_STEPS.find(step => step.id === 'segment-note')!.target;
    render(<><div data-pdf-page-surface><div data-guide="pdf-page"><canvas data-pdf-rendered="true" /></div>
      <button data-segment-uid="demo-segment" onClick={() => document.body.append(editor)}>打开片段编辑器</button></div>
      <Harness selector={selector} /></>);
    document.body.append(unrelated);
    expect(fireEvent.click(unrelatedButton)).toBe(false);
    fireEvent.click(screen.getByText('打开片段编辑器'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('viewportWidth'));
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledOnce();
    expect(fireEvent.click(unrelatedButton)).toBe(false);
    expect(onUnrelated).not.toHaveBeenCalled();
  });
  it('discovers a floating editor only after its hidden class is removed by a highlighted action', async () => {
    const editor = document.createElement('div'); editor.className = 'app-floating-segment-panel is-hidden'; editor.dataset.testPopup = '';
    const save = document.createElement('button'); save.textContent = '保存批注'; editor.append(save);
    const onSave = vi.fn(); save.addEventListener('click', onSave);
    document.body.append(editor);
    render(<><div data-test-target><button onClick={() => editor.classList.remove('is-hidden')}>打开批注</button></div><Harness /></>);
    expect(fireEvent.click(save)).toBe(false);
    fireEvent.click(screen.getByText('打开批注'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('viewportWidth'));
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledOnce();
  });
  it('yields immediately to a real dialog and resumes blocking when it closes', () => {
    const action = vi.fn();
    const view = render(<><div data-test-target /><div data-slot="dialog-content"><button onClick={action}>弹窗确认</button></div><Harness /></>);
    fireEvent.click(screen.getByText('弹窗确认')); expect(action).toHaveBeenCalledOnce();
    view.rerender(<><div data-test-target /><button onClick={action}>弹窗确认</button><Harness /></>);
    fireEvent.click(screen.getByText('弹窗确认')); expect(action).toHaveBeenCalledOnce();
  });
  it('matches the spotlight instance in the viewport instead of a mounted off-screen reader', () => {
    const action = vi.fn();
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function(this:HTMLElement) {
      return this.dataset.offscreen !== undefined
        ? { left:0, top:1000, right:500, bottom:1400, width:500, height:400 } as DOMRect
        : { left:0, top:0, right:1000, bottom:800, width:1000, height:800 } as DOMRect;
    });
    render(<><div data-test-target data-offscreen><button onClick={action}>后台阅读器</button></div>
      <div data-test-target><button onClick={action}>可见阅读器</button></div><Harness /></>);
    fireEvent.click(screen.getByText('后台阅读器')); expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('可见阅读器')); expect(action).toHaveBeenCalledOnce();
  });
});
