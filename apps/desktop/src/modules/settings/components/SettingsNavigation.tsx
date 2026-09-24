import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SETTINGS_CATALOG, SETTINGS_CATEGORIES, searchSettings, settingsCategory, type SettingDefinition, type SettingsNavigationTarget, type SettingsTab } from '../settingsCatalog';

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  appearance: '外观与界面', reader: '阅读与批注', translation: '翻译', parser: '导入与解析', data: '资料库与数据',
  models: '模型连接与对话', 'main-agent': '主助手', subagents: '子助手', 'external-tools': '外部检索'
};

export function useSettingsNavigation(activeTab: SettingsTab, onChange: (tab: SettingsTab) => void, target?: SettingsNavigationTarget) {
  const rootRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<SettingsNavigationTarget | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const navigate = (item: SettingDefinition) => {
    setQuery('');
    onChangeRef.current(item.tab);
    setPending({ id: item.id, nonce: Date.now() });
  };
  useEffect(() => {
    const item = SETTINGS_CATALOG.find(item => item.id === target?.id);
    if (item) navigate(item);
  }, [target?.id, target?.nonce]);
  useEffect(() => {
    if (!pending || query) return;
    const item = SETTINGS_CATALOG.find(item => item.id === pending.id);
    if (item?.tab !== activeTab) return;
    let element: HTMLElement | null = null;
    const frame = requestAnimationFrame(() => {
      element = rootRef.current?.querySelector<HTMLElement>(`[data-setting-id="${pending.id}"]`) ?? null;
      if (!element) return;
      if (element instanceof HTMLDetailsElement) element.open = true;
      let parent = element.parentElement;
      while (parent && parent !== rootRef.current) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      element.dataset.settingHighlight = 'true';
      const viewport = rootRef.current?.querySelector<HTMLElement>('.settings-viewport');
      if (viewport) {
        const rect = viewport.getBoundingClientRect();
        const scale = viewport.clientHeight ? rect.height / viewport.clientHeight : 1;
        viewport.scrollTop += (element.getBoundingClientRect().top - rect.top) / (scale || 1) - 12;
      }
      const focus = element.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled),select:not(:disabled),summary') ?? element;
      focus.focus({ preventScroll: true });
    });
    const timer = window.setTimeout(() => { if (element) delete element.dataset.settingHighlight; }, 3000);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); if (element) delete element.dataset.settingHighlight; };
  }, [pending, activeTab, query]);
  return { rootRef, query, setQuery, navigate, results: searchSettings(query) };
}

export function SettingsCategoryNavigation({ activeTab, onChange }: { activeTab: SettingsTab; onChange: (tab: SettingsTab) => void }) {
  const category = settingsCategory(activeTab);
  return <>
    <nav className="settings-category-nav" data-material="sidebar-canvas" aria-label="设置分类">{SETTINGS_CATEGORIES.map(item =>
      <Button key={item.id} size="sm" variant="ghost" aria-current={category.id === item.id ? 'page' : undefined}
        className="w-full justify-start text-xs" onClick={() => onChange(item.tabs[0])}>{item.title}</Button>)}</nav>
    <div className="settings-category-select"><Select value={category.id} onValueChange={value => onChange(value as SettingsTab)}>
      <SelectTrigger aria-label="设置分类" size="sm" className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{SETTINGS_CATEGORIES.map(item => <SelectItem value={item.id} key={item.id}>{item.title}</SelectItem>)}</SelectContent>
    </Select></div>
  </>;
}

export function SettingsSearch({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  return <SearchInput label="搜索设置" placeholder="搜索设置、功能或关键词" value={query} onValueChange={onChange} />;
}

export function SettingsSearchResults({ results, onSelect }: { results: SettingDefinition[]; onSelect: (item: SettingDefinition) => void }) {
  return <div className="settings-search-results p-4">
    <p role="status" className="mb-2 text-xs text-muted-foreground">{results.length ? `${results.length} 项设置` : '没有找到匹配设置，可尝试“翻译”“缩放”或“密钥”。'}</p>
    {results.map(item => <Button key={item.id} variant="ghost" onClick={() => onSelect(item)} className="h-auto w-full justify-start whitespace-normal rounded-none border-b px-2 py-3 text-left">
      <span className="min-w-0"><span className="block text-[13px]">{item.title}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">设置 › {settingsCategory(item.tab).title} · {item.description}</span></span>
    </Button>)}
  </div>;
}
