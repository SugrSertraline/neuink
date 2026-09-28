import {
  Loader2,
  Plus,
  RefreshCw,
  Save,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';
import { usePublicModelCatalog } from '../usePublicModelCatalog';
import { enrichModelFacts, findModelMetadata, mergeModelMetadata } from '@/modules/assistant/sdk/modelCatalog';
import type { ModelPreset } from './providerPresets';
import { ModelCatalogPicker } from './ModelCatalogPicker';
import { ModelMetadataSummary } from './ModelMetadataSummary';
import { ProviderCatalogPicker } from './ProviderCatalogPicker';
import { useModelAutoSync } from '../useModelAutoSync';
import type { ProviderOption } from '../providerCatalog';

export function ModelProfileEditor({ props, open, onOpenChange }: { props: SettingsPanelLayoutProps; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [saveError, setSaveError] = useState(false);
  const publicCatalog = usePublicModelCatalog(open);
  const [chosen, setChosen] = useState<ModelPreset>();
  const [manualProvider, setManualProvider] = useState<ProviderOption>();
  const [protocolPending, setProtocolPending] = useState(false);
  useEffect(() => { setChosen(undefined); }, [open, props.baseUrl]);
  useEffect(() => { setManualProvider(undefined); setProtocolPending(false); }, [open]);
  useEffect(() => { if (open) setSaveError(false); }, [open]);
  const {
    apiKey,
    apiProtocol,
    baseUrl,
    busy,
    cachedModelCatalog,
    editingProfile,
    formatCacheTime,
    maxContextLength,
    maxOutputTokens,
    model,
    modelPresets,
    name,
    onApiKeyChange,
    onApiProtocolChange,
    onBaseUrlChange,
    onCreateProfile,
    onMaxContextLengthChange,
    onMaxOutputTokensChange,
    onNameChange,
    onProviderPresetSelect,
    onRefreshModels,
    onSaveProfile,
    onTemperatureChange,
    onTopPChange,
    temperature,
    topP
  } = props;
  const modelSync = useModelAutoSync({ open: open && !busy && !protocolPending, baseUrl, apiKey, apiProtocol, sync: onRefreshModels });
  const catalogModels = publicCatalog.catalog?.models ?? [];
  const localPreset = modelPresets.find(preset => preset.id === model);
  const chosenMetadata = chosen?.id === model && chosen.metadataSource
    ? mergeModelMetadata(chosen.metadataSource === 'provider' ? localPreset ?? chosen : chosen,
      catalogModels.find(m => m.providerId === chosen.providerId && m.id === chosen.id)) : undefined;
  const selectedModelMetadata = chosenMetadata ?? (localPreset
    ? enrichModelFacts(localPreset, baseUrl, catalogModels) : findModelMetadata(catalogModels, baseUrl, model));
  const selectModel = (preset: ModelPreset) => { setChosen(preset); props.onModelMetadataSelect(preset); };
  return (
                <Dialog open={open} onOpenChange={open => { if (!busy) onOpenChange(open); }}>
                  <DialogContent onOpenAutoFocus={event => {
                    event.preventDefault();
                    // Keep modal keyboard focus without opening the first editable combobox.
                    if (event.target instanceof HTMLElement) event.target.focus({ preventScroll: true });
                  }} className="grid settings-model-editor h-[min(760px,calc(100dvh-2rem))] w-[min(720px,calc(100vw-2rem))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0 sm:max-w-none">
                    <DialogHeader className="border-b px-4 py-3">
                      <DialogTitle className="min-w-0 break-words pr-6">{editingProfile ? `模型配置：${editingProfile.name}` : '新增模型配置'}</DialogTitle>
                      <DialogDescription>修改后点击保存。取消会放弃本次编辑。</DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 overflow-y-auto px-4 py-4"><fieldset disabled={busy} className="min-w-0">
                <div className="border-b pb-4">
                  <h3 className="mb-2 text-sm font-semibold">模型提供商</h3>
                  <ProviderCatalogPicker catalog={catalogModels} baseUrl={baseUrl} busy={busy} selectedLabel={manualProvider?.label}
                    onSelect={preset => { setManualProvider(undefined); setProtocolPending(false); setChosen(undefined); if (props.onProviderMetadataSelect) props.onProviderMetadataSelect(preset); else onProviderPresetSelect(preset.label); }}
                    onManualSelect={provider => {
                      onProviderPresetSelect('__custom__');
                      onNameChange(provider.label); onBaseUrlChange(provider.baseUrl);
                      setManualProvider(provider); setProtocolPending(true); setChosen(undefined);
                    }}
                    onCustom={() => { setManualProvider(undefined); setProtocolPending(false); onProviderPresetSelect('__custom__'); }} />
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">支持名称、中文别名、缩写和地址模糊搜索。内置预设离线可用；更多提供商来自公开目录。</p>
                  {manualProvider && protocolPending && <p role="status" className="mt-1 text-xs leading-5 text-muted-foreground">已选择 {manualProvider.label}，可以先浏览其模型。{manualProvider.reason}确认前不会请求接口或保存配置。</p>}
                </div>
    
                <div className="grid gap-4">
                  <div className="grid min-w-0 gap-4 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="llm-model">模型 ID</Label>
                    </div>
                    <ModelCatalogPicker baseUrl={baseUrl} providerId={manualProvider?.id} model={model} presets={modelPresets} catalog={catalogModels} busy={busy} onSelect={selectModel}
                      onCustomChange={id => {
                        const preset = modelPresets.find(p => p.id === id.trim());
                        selectModel(preset ? enrichModelFacts(preset, baseUrl, catalogModels) : findModelMetadata(catalogModels, baseUrl, id) ?? { id });
                      }} />
                    <div className="flex flex-wrap items-center gap-2 text-xs" role="status">
                      {modelSync.status === 'loading' && <Loader2 aria-hidden className="size-3 animate-spin text-muted-foreground" />}
                      <span className={modelSync.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>{modelSync.message}</span>
                      {modelSync.status === 'error' && <Button size="xs" type="button" variant="outline" onClick={modelSync.retry}>重试同步</Button>}
                    </div>
                    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">公开目录与同步说明</summary><div className="mt-2 grid gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Button size="xs" variant="outline" type="button" disabled={publicCatalog.busy || busy} onClick={publicCatalog.refresh}>
                        <RefreshCw />{publicCatalog.busy ? '正在更新公开目录…' : '更新公开模型目录'}
                      </Button>
                      {publicCatalog.catalog && <span>{new Set(catalogModels.map(m => m.providerId)).size} 个服务商 / {catalogModels.length} 条记录 · 最近同步 {formatCacheTime(publicCatalog.catalog.updatedAt)}</span>}
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">公开目录来自 models.dev / OpenRouter，无需额外密钥；不发送你的 API Key、接口地址或搜索词。选择模型自动填入参数，更新目录不会覆盖已填写的值。</p>
                    {cachedModelCatalog && <p className="text-xs text-muted-foreground">当前接口列表缓存：{cachedModelCatalog.models.length} 项，{formatCacheTime(cachedModelCatalog.updatedAt)}。接口列表与公开目录独立更新。</p>}
                    {publicCatalog.error && <p role="alert" className="text-xs text-destructive">{publicCatalog.error}</p>}
                    {publicCatalog.catalog?.warnings.map(warning => <p key={warning} role="status" className="text-xs text-muted-foreground">{warning}</p>)}
                    </div></details>
    
                    <div className="settings-fields-grid grid gap-3">
                      <div className="grid gap-2">
                        <Label htmlFor="llm-name">名称</Label>
                        <Input id="llm-name" value={name} onChange={(event) => onNameChange(event.target.value)} />
                      </div>
                    </div>
    
                    <div className="settings-fields-grid grid items-start gap-3" data-ui="model-connection-fields">
                      <div className="grid content-start gap-2">
                        <Label htmlFor="llm-base-url">Base URL</Label>
                        <Input
                          id="llm-base-url"
                          placeholder={apiProtocol === 'anthropic' ? 'https://api.anthropic.com/v1' : apiProtocol === 'google' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.deepseek.com'}
                          value={baseUrl}
                          onChange={(event) => onBaseUrlChange(event.target.value)}
                        />
                      </div>
                      <div className="grid content-start gap-2">
                        <Label htmlFor="llm-api-protocol">接口类型</Label>
                        <Select value={protocolPending ? '' : apiProtocol} onValueChange={value => { onApiProtocolChange(value as typeof apiProtocol); setProtocolPending(false); }}>
                          <SelectTrigger id="llm-api-protocol" className="w-full" aria-describedby="model-protocol-help" aria-invalid={protocolPending || undefined}>
                            <SelectValue placeholder="请选择此服务的接口类型" />
                          </SelectTrigger>
                          <SelectContent viewportAligned>
                            <SelectItem value="openai_compatible">OpenAI 兼容</SelectItem>
                            <SelectItem value="anthropic">Anthropic / Claude</SelectItem>
                            <SelectItem value="google">Google / Gemini</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <p id="model-protocol-help" className="text-xs leading-5 text-muted-foreground">
                      {protocolPending ? '请选择服务商实际支持的接口类型；不确定时查看服务商的接入说明。' : '接口类型决定请求格式，请按服务商的接入说明选择，不要仅按模型名称判断。'}
                    </p>
    
                    <div className="grid gap-2">
                      <Label htmlFor="llm-api-key">API Key</Label>
                      <Input
                        id="llm-api-key"
                        placeholder="本地 Ollama 可留空"
                        type="password"
                        value={apiKey}
                        onChange={(event) => onApiKeyChange(event.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">输入暂停后自动向此接口获取模型列表，不发起对话。更换地址会清空旧密钥。</p>
                    </div>
    
                    <section className="grid gap-3 border-t pt-3" aria-labelledby="model-parameters-title">
                    <h3 id="model-parameters-title" className="text-sm font-medium">高级参数</h3>
                    <div className="settings-fields-grid grid gap-3">
                      <div className="grid gap-2">
                        <Label htmlFor="llm-context">上下文窗口（Token）</Label>
                        <Input
                          id="llm-context"
                          inputMode="numeric"
                          min={1}
                          type="number"
                          value={maxContextLength}
                          onChange={(event) => onMaxContextLengthChange(event.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="llm-temperature">Temperature</Label>
                        <Input
                          id="llm-temperature"
                          inputMode="decimal"
                          placeholder="0.2"
                          value={temperature}
                          onChange={(event) => onTemperatureChange(event.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="llm-top-p">Top P</Label>
                        <Input
                          id="llm-top-p"
                          inputMode="decimal"
                          placeholder="留空"
                          value={topP}
                          onChange={(event) => onTopPChange(event.target.value)}
                        />
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="llm-max-output">最大输出（Token）</Label>
                      <Input
                        id="llm-max-output"
                        inputMode="numeric"
                        min={1}
                        placeholder="留空"
                        type="number"
                        value={maxOutputTokens}
                        onChange={(event) => onMaxOutputTokensChange(event.target.value)}
                      />
                    </div>

                    </section>
                    <ModelMetadataSummary model={selectedModelMetadata} context={maxContextLength} output={maxOutputTokens} />
                    {selectedModelMetadata && <Button type="button" size="xs" variant="outline" onClick={() => selectModel(selectedModelMetadata)}>使用以上参考参数</Button>}

                    <p className="text-[11px] leading-5 text-muted-foreground">
                      上下文窗口是输入与输出合计容量；最大输出只是单次回答上限，两者不是同一个数值。可在高级参数中手动覆盖。
                    </p>
                  </div>
    
                </div>
                    </fieldset></div>
                  <DialogFooter className="mx-0 mb-0 flex-wrap items-center justify-end rounded-none bg-muted px-4 py-3 sm:justify-end">
                        {saveError && <p role="alert" className="w-full text-xs text-destructive">保存失败，修改已保留。请检查配置后重试。</p>}
                        <DialogClose asChild>
                          <Button disabled={busy} size="sm" type="button" variant="outline">
                            取消
                          </Button>
                        </DialogClose>
                        {editingProfile ? (
                          <Button
                            disabled={busy || protocolPending || !baseUrl || !model}
                            size="sm"
                            type="button"
                            onClick={async () => { setSaveError(false); if (await onSaveProfile()) onOpenChange(false); else setSaveError(true); }}
                          >
                            <Save />
                            保存
                          </Button>
                        ) : (
                          <Button
                            disabled={busy || protocolPending || !baseUrl || !model}
                            size="sm"
                            type="button"
                            onClick={async () => { setSaveError(false); if (await onCreateProfile()) onOpenChange(false); else setSaveError(true); }}
                          >
                            <Plus />
                            创建配置
                          </Button>
                        )}
                  </DialogFooter>
                  </DialogContent>
                </Dialog>
  );
}

