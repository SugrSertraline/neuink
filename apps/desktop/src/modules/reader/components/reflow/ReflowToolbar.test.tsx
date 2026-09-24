/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReflowToolbar } from './ReflowToolbar';

describe('ReflowToolbar', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it('collapses actions by pane width and restores direct access after widening', () => {
    let resize: (entries: unknown[]) => void = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: typeof resize) {}
      observe(target: Element) { if (target.classList.contains('reflow-toolbar')) resize = this.callback; }
      unobserve() {}
      disconnect = disconnect;
    });
    const exportPaper = vi.fn();
    const { unmount } = render(<ReflowToolbar compact={false} busy={false} entryTitle="长论文标题"
      appearance={<button>阅读外观</button>} translationMode={<button>双语对照</button>}>
      <button onClick={exportPaper}>导出论文内容</button><button disabled>暂停翻译</button>
    </ReflowToolbar>);
    act(() => resize([{ contentRect: { width: 320 } }]));
    expect(screen.queryByRole('button', { name: '导出论文内容' })).toBeNull();
    expect(screen.getByRole('button', { name: '阅读外观' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '双语对照' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重排阅读工具菜单' }));
    fireEvent.click(screen.getByRole('button', { name: '导出论文内容' }));
    expect(exportPaper).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '暂停翻译' }).hasAttribute('disabled')).toBe(true);
    act(() => resize([{ contentRect: { width: 1000 } }]));
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
});
