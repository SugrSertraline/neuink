/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readStoredReaderPreferences, persistReaderPreferences, reflowTextSizeScale } from '@/shared/lib/readerPreferences';

import { ReflowComponentControls } from './ReflowComponentControls';

describe('ReflowComponentControls', () => {
  it('stores continuous text and image sizes without snapping to the old presets', () => {
    const preferences = readStoredReaderPreferences();
    const onChange = vi.fn();
    const view = render(<ReflowComponentControls preferences={preferences} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '重排组件设置' }));
    fireEvent.change(screen.getByRole('slider', { name: '正文文字大小' }), { target: { value: '113' } });
    const next = onChange.mock.calls[0][0];
    expect(next.reflowComponents.paragraph.size).toBe(1.13);
    expect(reflowTextSizeScale(next.reflowComponents.paragraph.size)).toBe(1.13);
    view.rerender(<ReflowComponentControls preferences={next} onChange={onChange} />);
    fireEvent.change(screen.getByRole('slider', { name: '图片展示大小' }), { target: { value: '147' } });
    persistReaderPreferences(onChange.mock.calls[1][0]);
    expect(readStoredReaderPreferences().reflowComponents.figure.size).toBe(1.47);
    expect(readStoredReaderPreferences().reflowComponents.paragraph.size).toBe(1.13);
    view.rerender(<ReflowComponentControls preferences={onChange.mock.calls[1][0]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '正文文字大小恢复100%' }));
    expect(onChange.mock.calls[2][0].reflowComponents.paragraph.size).toBe(1);
    expect(onChange.mock.calls[2][0].reflowComponents.figure.size).toBe(1.47);
    persistReaderPreferences(preferences);
  });

  afterEach(() => cleanup());

  it('notifies the reader when switching both into and out of sentence layout', () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const onChange = vi.fn(), onView = vi.fn();
    const preferences = readStoredReaderPreferences();
    const view = render(<ReflowComponentControls preferences={preferences} onChange={onChange} onTranslationViewChange={onView} />);
    fireEvent.click(screen.getByRole('button', { name: '重排组件设置' }));
    fireEvent.click(screen.getByRole('switch', { name: '正文逐句对照' }));
    expect(onView).toHaveBeenLastCalledWith('sentences');
    view.rerender(<ReflowComponentControls preferences={onChange.mock.calls[0][0]} onChange={onChange} onTranslationViewChange={onView} />);
    fireEvent.click(screen.getByRole('switch', { name: '正文逐句对照' }));
    expect(onView).toHaveBeenLastCalledWith('paragraph');
  });

  it('updates one component without replacing the other component settings', () => {
    const preferences = readStoredReaderPreferences();
    const onChange = vi.fn();
    render(<ReflowComponentControls preferences={preferences} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '重排组件设置' }));
    fireEvent.click(screen.getByRole('switch', { name: '显示解析图表' }));

    expect(onChange).toHaveBeenCalledWith({
      ...preferences,
      reflowComponents: {
        ...preferences.reflowComponents,
        chart: { ...preferences.reflowComponents.chart, visible: false }
      }
    });
  });

  it('controls parsed content and image detail opening independently', () => {
    const preferences = readStoredReaderPreferences();
    const onChange = vi.fn();
    render(<ReflowComponentControls preferences={preferences} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '重排组件设置' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '图片显示解析后内容' }));
    fireEvent.click(screen.getByRole('switch', { name: '点击图片查看详情' }));

    expect(onChange).toHaveBeenNthCalledWith(1, {
      ...preferences,
      reflowComponents: { ...preferences.reflowComponents, content: { figure: { parsed: true } } }
    });
    expect(onChange).toHaveBeenNthCalledWith(2, {
      ...preferences,
      reflowComponents: { ...preferences.reflowComponents, imageClickToOpen: false }
    });
  });

  it('enables parsed tables independently from original images and other types', () => {
    const preferences = readStoredReaderPreferences();
    const onChange = vi.fn();
    render(<ReflowComponentControls preferences={preferences} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '重排组件设置' }));
    expect(screen.getByRole('checkbox', { name: '图片显示原图' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: '图片显示解析后内容' }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('checkbox', { name: '表格显示解析后内容' }));
    expect(onChange).toHaveBeenCalledWith({ ...preferences, reflowComponents: { ...preferences.reflowComponents, content: { table: { parsed: true } } } });
  });
  it('offers image and parsed switches for text components as well as images', () => {
    const preferences = readStoredReaderPreferences();
    const onChange = vi.fn();
    render(<ReflowComponentControls preferences={preferences} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '重排组件设置' }));
    expect(screen.getByRole('checkbox', { name: '正文显示原图' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('checkbox', { name: '正文显示解析后内容' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('checkbox', { name: '正文显示原图' }));
    expect(onChange).toHaveBeenCalledWith({ ...preferences, reflowComponents: { ...preferences.reflowComponents, content: { paragraph: { image: true } } } });
  });
});
