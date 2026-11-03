/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReflowToolbar } from './ReflowToolbar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

function measuredToolbar(initialWidth: number, widths = [120, 80]) {
  let width = initialWidth;
  let notify = () => {};
  const disconnect = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('reflow-toolbar-controls') ? width : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-reflow-toolbar-item')) return this.childElementCount ? widths[Number(this.dataset.reflowToolbarItem)] ?? 100 : 0;
    if (this.hasAttribute('data-reflow-primary-tools')) return this.childElementCount ? 200 : 0;
    if (this.hasAttribute('data-reflow-language-tools')) return this.childElementCount ? 200 : 0;
    return this.classList.contains('reflow-toolbar-menu') ? 80 : 0;
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) {}
    observe(target: Element) { if (target.classList.contains('reflow-toolbar-controls')) notify = this.callback; }
    unobserve() {}
    disconnect = disconnect;
  });
  return { resize: (next: number) => act(() => { width = next; notify(); }), disconnect };
}

describe('ReflowToolbar', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('collapses actions by pane width and restores direct access after widening', () => {
    const { resize, disconnect } = measuredToolbar(260);
    const exportPaper = vi.fn();
    const { unmount } = render(<ReflowToolbar compact={false} busy={false} entryTitle="长论文标题"
      appearance={<button>阅读外观</button>} translationMode={<button>双语对照</button>}>
      <button onClick={exportPaper}>导出论文内容</button><button disabled>暂停翻译</button>
    </ReflowToolbar>);
    expect(screen.queryByRole('button', { name: '导出论文内容' })).toBeNull();
    expect(screen.getByRole('button', { name: '阅读外观' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '双语对照' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重排阅读工具菜单' }));
    fireEvent.click(screen.getByRole('button', { name: '导出论文内容' }));
    expect(exportPaper).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '暂停翻译' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '重排阅读工具菜单' }));
    resize(1000);
    expect(screen.queryByRole('button', { name: '重排阅读工具菜单' })).toBeNull();
    expect(screen.getAllByRole('button', { name: '导出论文内容' })).toHaveLength(1);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
  it('removes repeated titles while preserving appearance, translation mode and secondary tools', () => {
    const exportPaper = vi.fn();
    const { container } = render(<ReflowToolbar compact entryTitle="论文 A" busy={false}
      appearance={<button>字号与背景</button>} translationMode={<button>原文与译文</button>}>
      <button onClick={exportPaper}>导出论文内容</button><button>内容显示</button>
    </ReflowToolbar>);
    expect(container.querySelector('.entry-content-header')).toBeNull();
    expect(screen.queryByText('论文 A')).toBeNull();
    expect(screen.getByRole('button', { name: '字号与背景' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '原文与译文' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '导出论文内容' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重排阅读工具菜单' }));
    fireEvent.click(screen.getByRole('button', { name: '导出论文内容' }));
    expect(exportPaper).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '内容显示' })).toBeTruthy();
  });
  it('shows translation activity without opening the menu', () => {
    render(<ReflowToolbar compact entryTitle="论文 A" busy appearance={null} translationMode={null}><button>暂停翻译</button></ReflowToolbar>);
    expect(screen.getByRole('button', { name: '重排阅读工具菜单' }).textContent).toBe('翻译中');
    fireEvent.click(screen.getByRole('button', { name: '重排阅读工具菜单' }));
    expect(screen.getByRole('button', { name: '暂停翻译' })).toBeTruthy();
  });
  it('preserves the standalone reader header and direct actions', () => {
    render(<ReflowToolbar compact={false} entryTitle="论文 A" busy={false} appearance={null} translationMode={null}><button>导出论文内容</button></ReflowToolbar>);
    expect(screen.getByText('论文 A')).toBeTruthy();
    expect(screen.getByText('重排视图')).toBeTruthy();
    expect(screen.getByRole('button', { name: '导出论文内容' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重排阅读工具菜单' })).toBeNull();
  });
  it('shows the complete entry title on keyboard focus', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const title = 'A long paper title whose full text can be viewed in the tooltip';
    render(<ReflowToolbar compact={false} entryTitle={title} busy={false} appearance={null} translationMode={null}><button>导出</button></ReflowToolbar>);
    const trigger = screen.getByText(title);
    expect(trigger.getAttribute('tabindex')).toBe('0');
    fireEvent.focus(trigger);
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe(title));
  });
  it('shows the complete entry title on pointer hover', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerType = 'mouse'; });
    const title = 'Full paper title for the hover preview';
    render(<ReflowToolbar compact={false} entryTitle={title} busy={false} appearance={null} translationMode={null}><button>导出</button></ReflowToolbar>);
    const trigger = screen.getByText(title);
    fireEvent.pointerEnter(trigger); fireEvent.pointerMove(trigger);
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe(title));
  });
  it('separates the title row from full-width tools and keeps primary tools visible at intermediate widths', () => {
    const { resize } = measuredToolbar(1200);
    const { container } = render(<ReflowToolbar compact={false} entryTitle="很长的论文标题" busy={false}
      navigation={<button>导航</button>} appearance={<button>外观</button>} primaryTools={<button>阅读详略</button>} translationMode={<button>原文翻译</button>}>
      <button>导出</button>
    </ReflowToolbar>);
    const header = container.querySelector('.entry-content-header')!;
    const controls = container.querySelector('.reflow-toolbar-controls')!;
    expect(header.contains(screen.getByRole('button', { name: '导航' }))).toBe(true);
    expect(header.contains(screen.getByRole('button', { name: '外观' }))).toBe(true);
    expect(controls.contains(screen.getByRole('button', { name: '阅读详略' }))).toBe(true);
    expect(controls.contains(screen.getByRole('button', { name: '原文翻译' }))).toBe(true);
    expect(header.contains(screen.getByRole('button', { name: '导出' }))).toBe(false);
    resize(900);
    expect(screen.getByRole('button', { name: '阅读详略' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '原文翻译' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '导出' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重排阅读工具菜单' })).toBeNull();
    resize(350);
    expect(screen.queryByRole('button', { name: '阅读详略' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重排阅读工具菜单' }));
    expect(screen.getByRole('button', { name: '导出' })).toBeTruthy();
  });

  it('fills spare width one action at a time and keeps only the overflow in a stable menu', async () => {
    const { resize } = measuredToolbar(650, [100, 100, 100]);
    const action = vi.fn();
    render(<ReflowToolbar compact={false} busy={false} entryTitle="论文" appearance={null}
      primaryTools={<button>阅读详略</button>} translationMode={<button>原文翻译</button>}>
      <button>组件</button><button>悬停配置</button><button onClick={action}>导出</button>
    </ReflowToolbar>);
    expect(screen.getByRole('button', { name: '组件' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '悬停配置' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重排阅读工具菜单' }));
    expect(screen.getAllByRole('button', { name: '组件' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '导出' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(action).toHaveBeenCalledOnce();
    resize(1000);
    expect(screen.getByRole('button', { name: '重排阅读工具菜单' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: '导出' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: '重排阅读工具菜单' })).toBeNull());
    expect(screen.getAllByRole('button', { name: '悬停配置' })).toHaveLength(1);
    act(() => screen.getByRole('button', { name: '导出' }).focus());
    resize(650);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '重排阅读工具菜单' }));
  });

  it('keeps an open inline settings popup anchored until it closes, then applies the new width', async () => {
    const { resize } = measuredToolbar(900, [100]);
    render(<ReflowToolbar compact={false} busy={false} entryTitle="论文" appearance={null}
      primaryTools={<button>阅读详略</button>} translationMode={<button>原文翻译</button>}>
      <Popover><PopoverTrigger asChild><button>组件</button></PopoverTrigger><PopoverContent><button>正文设置</button></PopoverContent></Popover>
    </ReflowToolbar>);
    fireEvent.click(screen.getByRole('button', { name: '组件' }));
    resize(350);
    expect(screen.getByRole('button', { name: '组件' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: '正文设置' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: '组件' })).toBeNull());
    expect(screen.getByRole('button', { name: '重排阅读工具菜单' })).toBeTruthy();
  });

  it('accounts for fractional button widths before a control would wrap onto another row', () => {
    const { resize } = measuredToolbar(320, [120]);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return { width: this.hasAttribute('data-reflow-toolbar-item') ? 120.6 : 0 } as DOMRect;
    });
    render(<ReflowToolbar compact={false} busy={false} entryTitle="论文" appearance={null} translationMode={<button>原文翻译</button>}>
      <button>导出</button>
    </ReflowToolbar>);
    expect(screen.queryByRole('button', { name: '导出' })).toBeNull();
    resize(322);
    expect(screen.getByRole('button', { name: '导出' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重排阅读工具菜单' })).toBeNull();
  });
});
