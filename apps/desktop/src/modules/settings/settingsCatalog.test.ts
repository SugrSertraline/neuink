// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SETTINGS_CATALOG, SETTINGS_CATEGORIES, readSettingsTab, searchSettings, settingsCategory } from './settingsCatalog';

describe('settings discovery', () => {
  it('hides advanced assistant configuration from navigation and all settings searches', () => {
    expect(SETTINGS_CATEGORIES.find(item => item.id === 'models')?.tabs).toEqual(['models']);
    expect(SETTINGS_CATEGORIES.find(item => item.id === 'external-tools')?.tabs).toEqual(['external-tools']);
    for (const query of ['主助手', '子助手', 'MCP', 'Skills']) expect(searchSettings(query)).toEqual([]);
    expect(searchSettings('sciverse').map(item => item.id)).toEqual(['tools-services']);
  });
  it.each([['main-agent', 'models'], ['subagents', 'models'], ['skills', 'external-tools']])('redirects the saved hidden page %s to %s', (saved, expected) => {
    window.localStorage.setItem('neuink.settings.lastTab', saved);
    expect(readSettingsTab()).toBe(expected);
    window.localStorage.clear();
  });
  it('finds user phrases and old names without indexing values', () => {
    expect(searchSettings('字体太小')[0].id).toBe('appearance-scale');
    expect(searchSettings('默认显示区域')[0].id).toBe('reader-regions');
    expect(searchSettings('默认打开PDF')[0].id).toBe('reader-open-pdf');
    expect(searchSettings('打开条目 PDF')[0].id).toBe('reader-open-pdf');
    expect(searchSettings(' API KEY ').map(item => item.id)).toContain('models-connections');
    expect(searchSettings('任务模型').map(item => item.id)).toContain('translation-model');
    expect(searchSettings('不存在的密钥值')).toEqual([]);
    expect(searchSettings('')).toEqual([]);
  });
  it('gives each target a unique identity within the seven categories', () => {
    expect(SETTINGS_CATEGORIES).toHaveLength(7);
    expect(new Set(SETTINGS_CATALOG.map(item => item.id)).size).toBe(SETTINGS_CATALOG.length);
    for (const item of SETTINGS_CATALOG) expect(settingsCategory(item.tab)).toBeTruthy();
  });
});
