import { useMemo } from 'react';
import { CatalogCombobox } from './CatalogCombobox';
import { mergeModelMetadata, modelMetadataIndex, providersForEndpoint, type CatalogModel } from '@/modules/assistant/sdk/modelCatalog';
import type { ModelPreset } from './providerPresets';
import { catalogSearchScore, providerAliases } from '../catalogSearch';

type Props = { baseUrl: string; providerId?: string; model: string; presets: ModelPreset[]; catalog: CatalogModel[]; busy: boolean; onSelect: (model: ModelPreset) => void; onCustomChange?: (id: string) => void };
/** Provider comes from the connection form; only query/open state live here. The shared combobox owns input and list scrolling. */
export function ModelCatalogPicker({ baseUrl, providerId, model, presets, catalog, busy, onSelect, onCustomChange }: Props) {
  const candidates = useMemo(() => {
    const current = new Set(providerId ? [providerId] : providersForEndpoint(catalog, baseUrl));
    const index = modelMetadataIndex(catalog, baseUrl);
    const relevant = catalog.filter(m => current.has(m.providerId));
    const local = presets.map(p => ({ ...mergeModelMetadata(p, index.get(p.id)), providerId: index.get(p.id)?.providerId ?? 'current', providerName: index.get(p.id)?.providerName ?? '当前连接' }));
    const localIds = new Set(local.map(m => `${m.providerId}:${m.id}`));
    return [...local, ...relevant.filter(m => !localIds.has(`${m.providerId}:${m.id}`))];
  }, [baseUrl, providerId, presets, catalog]);
  return <CatalogCombobox resetKey={baseUrl + ':' + (providerId ?? '')} inputId="llm-model" value={model} label="模型 ID"
    buttonLabel="从模型列表选择" placeholder="输入模型 ID，或选择候选模型" busy={busy} onInput={onCustomChange}
    empty="未找到匹配模型，可直接填写模型 ID，或检查上方提供商与接口配置。" options={query => {
      const rows = candidates.map(m => ({ m, score: catalogSearchScore(query, [m.id, m.label ?? '', m.providerName, providerAliases(m.providerId + ' ' + m.providerName)]) }))
        .filter(row => row.score > 0).sort((a,b) => b.score - a.score || Number(a.m.status === 'deprecated') - Number(b.m.status === 'deprecated') || Number(b.m.id === model) - Number(a.m.id === model));
      return [...rows.map(({ m }) => ({
        key: m.providerId + ':' + m.id,
        content: <div className="min-w-0 flex-1">
          <div className="truncate" title={m.label ?? m.id}>{m.label ?? m.id}{m.status === 'deprecated' ? '（已弃用）' : ''}</div>
          {m.label && m.label !== m.id && <div className="truncate text-xs text-muted-foreground" title={m.id}>{m.id}</div>}
          <div className="truncate text-xs text-muted-foreground">{m.providerName}{m.maxContextLength ? ' · 上下文 ' + m.maxContextLength.toLocaleString() : ''}{m.maxOutputTokens ? ' · 输出 ' + m.maxOutputTokens.toLocaleString() : ''}</div>
        </div>, select: () => onSelect(m),
      })), ...(onCustomChange && query.trim() && !candidates.some(m => m.id === query.trim())
        ? [{ key: 'custom', content: <span className="truncate">使用自定义 ID：{query.trim()}</span>, select: () => onCustomChange(query.trim()) }] : [])];
    }} />;
}
