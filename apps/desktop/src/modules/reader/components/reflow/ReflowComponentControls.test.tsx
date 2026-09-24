/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readStoredReaderPreferences } from '@/shared/lib/readerPreferences';

import { ReflowComponentControls } from './ReflowComponentControls';

describe('ReflowComponentControls', () => {
  afterEach(() => cleanup());

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
    fireEvent.click(screen.getByRole('button', { name: '图片显示解析后内容' }));
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
    expect(screen.getByRole('button', { name: '图片显示原图' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '图片显示解析后内容' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '表格显示解析后内容' }));
    expect(onChange).toHaveBeenCalledWith({ ...preferences, reflowComponents: { ...preferences.reflowComponents, content: { table: { parsed: true } } } });
  });
  it('offers image and parsed switches for text components as well as images', () => {
    const preferences = readStoredReaderPreferences();
    const onChange = vi.fn();
    render(<ReflowComponentControls preferences={preferences} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '重排组件设置' }));
    expect(screen.getByRole('button', { name: '正文显示原图' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: '正文显示解析后内容' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '正文显示原图' }));
    expect(onChange).toHaveBeenCalledWith({ ...preferences, reflowComponents: { ...preferences.reflowComponents, content: { paragraph: { image: true } } } });
  });
});
