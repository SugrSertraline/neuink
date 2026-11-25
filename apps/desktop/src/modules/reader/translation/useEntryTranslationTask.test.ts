import { describe, expect, it } from 'vitest';

import { normalizeTranslationJobMessage } from './useEntryTranslationTask';

describe('normalizeTranslationJobMessage', () => {
  it('keeps running action stable and preserves the latest received count', () => {
    expect(normalizeTranslationJobMessage('processing', '第 2/8 批翻译中')).toBe('正在翻译');
    expect(normalizeTranslationJobMessage('processing', '正在翻译 · 已接收 120 字')).toBe(
      '正在翻译 · 已接收 120 字'
    );
    expect(
      normalizeTranslationJobMessage('processing', '第 1/8 批翻译中', '正在翻译 · 已接收 120 字')
    ).toBe('正在翻译 · 已接收 120 字');
    expect(
      normalizeTranslationJobMessage('processing', '正在翻译 · 已接收 80 字', '正在翻译 · 已接收 120 字')
    ).toBe('正在翻译 · 已接收 120 字');
    expect(
      normalizeTranslationJobMessage('processing', '正在翻译 · 已接收 160 字', '正在翻译 · 已接收 120 字')
    ).toBe('正在翻译 · 已接收 160 字');
  });

  it('keeps terminal messages unchanged', () => {
    expect(normalizeTranslationJobMessage('succeeded', '翻译完成')).toBe('翻译完成');
  });

  it('shows context preparation separately from direct translation and does not claim zero received text', () => {
    expect(normalizeTranslationJobMessage('processing', '正在生成论文背景（这一步较长，请耐心等待） · 已接收 0 字'))
      .toBe('正在整理论文背景 · 等待模型正文');
    expect(normalizeTranslationJobMessage('processing', '正在生成论文背景 · 已接收 35 字'))
      .toBe('正在整理论文背景 · 已接收 35 字');
    expect(normalizeTranslationJobMessage('processing', '正在翻译 · 已接收 8 字', '正在整理论文背景 · 已接收 35 字'))
      .toBe('正在翻译 · 已接收 8 字');
  });
});
