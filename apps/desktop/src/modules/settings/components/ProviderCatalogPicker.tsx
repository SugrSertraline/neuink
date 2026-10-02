import { useMemo } from 'react';
import type { CatalogModel } from '@/modules/assistant/sdk/modelCatalog';
import type { ProviderPreset } from './providerPresets';
import { catalogSearchScore, providerAliases } from '../catalogSearch';
import { providerOptions, type ProviderOption } from '../providerCatalog';
import { CatalogCombobox } from './CatalogCombobox';

export function ProviderCatalogPicker({ catalog, baseUrl, busy, onSelect, onCustom, onManualSelect, selectedLabel }: {
  catalog: CatalogModel[]; baseUrl: string; busy: boolean; onSelect: (preset: ProviderPreset) => void; onCustom: () => void;
  onManualSelect?: (provider: ProviderOption) => void; selectedLabel?: string;
}) {
  const providers = useMemo(() => providerOptions(catalog), [catalog]);
  const current = baseUrl.trim() ? providers.find(row => row.baseUrl.replace(/\/$/, '') === baseUrl.replace(/\/$/, '')) : undefined;
  return <CatalogCombobox resetKey={baseUrl} value={selectedLabel ?? current?.label ?? ''} label="搜索提供商" buttonLabel="搜索模型提供商"
    placeholder="输入提供商名称或地址，或选择自定义连接" busy={busy} options={query => {
      const rows = providers.map(row => ({ row, score: catalogSearchScore(query, [row.id, row.label, row.baseUrl, providerAliases(row.id + ' ' + row.label)]) }))
        .filter(item => item.score > 0).sort((a,b) => b.score - a.score || Number(b.row.builtIn) - Number(a.row.builtIn) || a.row.label.localeCompare(b.row.label));
      return [...rows.map(({ row }) => ({
        key: row.id,
        content: <div className="min-w-0 flex-1">
          <div className="truncate" title={row.label}>{row.label} · {row.count > 0 ? row.count + ' 个模型' : '模型目录待同步'}</div>
          <div className="truncate text-xs text-muted-foreground" title={row.baseUrl || row.id}>{row.baseUrl || row.id}</div>
          <div className="truncate text-xs text-muted-foreground">{row.preset ? '已提供连接参数' : '选择后补充连接参数'}</div>
        </div>,
        select: () => { if (row.preset) onSelect(row.preset); else if (onManualSelect) onManualSelect(row); else onCustom(); },
      })), { key: 'custom', content: <div>{!rows.length && <div className="text-xs text-muted-foreground">没有匹配的提供商</div>}自定义提供商（手动配置）</div>, select: onCustom }];
    }} />;
}
