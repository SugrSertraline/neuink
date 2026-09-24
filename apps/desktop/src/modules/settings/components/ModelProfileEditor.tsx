import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
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

export function ModelProfileEditor({ props, open, onOpenChange }: { props: SettingsPanelLayoutProps; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [saveError, setSaveError] = useState(false);
  useEffect(() => { if (open) setSaveError(false); }, [open]);
  const {
    apiKey,
    apiProtocol,
    baseUrl,
    busy,
    cachedModelCatalog,
    collapsedProviderCount,
    editingProfile,
    formatCacheTime,
    formatContextLength,
    maxContextLength,
    maxOutputTokens,
    model,
    modelPresets,
    modelRefreshBusy,
    name,
    onApiKeyChange,
    onApiProtocolChange,
    onBaseUrlChange,
    onCreateProfile,
    onMaxContextLengthChange,
    onMaxOutputTokensChange,
    onModelChange,
    onModelPresetSelect,
    onNameChange,
    onProviderPresetSelect,
    onRefreshModels,
    onSaveProfile,
    onTemperatureChange,
    onToggleProvidersExpanded,
    onTopPChange,
    providerLogo,
    providerPreset,
    providerPresets,
    providersExpanded,
    temperature,
    topP
  } = props;
  const selectedModelMetadata = modelPresets.find(preset => preset.id === model);
  return (
                <Dialog open={open} onOpenChange={open => { if (!busy) onOpenChange(open); }}>
                  <DialogContent className="grid settings-model-editor h-[min(760px,calc(100dvh-2rem))] w-[min(720px,calc(100vw-2rem))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0 sm:max-w-none">
                    <DialogHeader className="border-b px-4 py-3">
                      <DialogTitle className="min-w-0 break-words pr-6">{editingProfile ? `模型配置：${editingProfile.name}` : '新增模型配置'}</DialogTitle>
                      <DialogDescription>修改后点击保存。取消会放弃本次编辑。</DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 overflow-y-auto px-4 py-4"><fieldset disabled={busy} className="min-w-0">
                <div className="border-b pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">服务商预设</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        选择服务商快速填充，或点「自定义」填写任意接口地址并选择协议。
                      </p>
                    </div>
                    <Badge variant="outline">{providerPreset?.label ?? '自定义'}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button
                      className="border-dashed"
                      size="xs"
                      type="button"
                      variant="outline"
                      onClick={() => onProviderPresetSelect('__custom__')}
                    >
                      <Pencil />
                      自定义
                    </Button>
                    {providerPresets.map((preset) => (
                      <Button
                        key={preset.label}
                        size="xs"
                        type="button"
                        variant="outline"
                        onClick={() => onProviderPresetSelect(preset.label)}
                      >
                        {providerLogo(preset)}
                        {preset.label}
                      </Button>
                    ))}
                    {collapsedProviderCount > 0 ? (
                      <Button size="xs" type="button" variant="ghost" onClick={onToggleProvidersExpanded}>
                        {providersExpanded ? <ChevronUp /> : <ChevronDown />}
                        {providersExpanded ? '收起' : `展开 ${collapsedProviderCount} 个`}
                      </Button>
                    ) : null}
                  </div>
                </div>
    
                <div className="grid gap-4">
                  <div className="grid min-w-0 gap-4 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="llm-model-preset">从模型列表选择</Label>
                      <Button
                        disabled={modelRefreshBusy || !baseUrl}
                        size="xs"
                        type="button"
                        variant="outline"
                        onClick={onRefreshModels}
                      >
                        {modelRefreshBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        同步模型与参数
                      </Button>
                    </div>
                    {modelPresets.length > 0 ? (
                      <Select
                        value={modelPresets.some((preset) => preset.id === model) ? model : ''}
                        onValueChange={onModelPresetSelect}
                      >
                        <SelectTrigger id="llm-model-preset">
                          <SelectValue placeholder="选择已拉取或内置的模型" />
                        </SelectTrigger>
                        <SelectContent className="max-h-80">
                          {modelPresets.map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.label ?? preset.id} · 上下文 {formatContextLength(preset.maxContextLength)}
                              {preset.maxOutputTokens ? ` · 最大输出 ${formatContextLength(preset.maxOutputTokens)}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                        当前 Base URL 没有可用列表。可点击“同步模型与参数”从服务端 `/models` 拉取，或直接填写模型 ID。
                      </div>
                    )}
                    {cachedModelCatalog ? (
                      <div className="text-[11px] leading-5 text-muted-foreground">
                        当前使用缓存模型列表，共 {cachedModelCatalog.models.length} 个，更新于{' '}
                        {formatCacheTime(cachedModelCatalog.updatedAt)}；再次同步会刷新并回填当前模型参数。
                      </div>
                    ) : providerPreset ? (
                      <div className="text-[11px] leading-5 text-muted-foreground">
                        当前正在使用内置预设；点击同步后会切换为服务端与 OpenRouter 目录返回的实时参数。
                      </div>
                    ) : null}
    
                    <div className="settings-fields-grid grid gap-3">
                      <div className="grid gap-2">
                        <Label htmlFor="llm-name">名称</Label>
                        <Input id="llm-name" value={name} onChange={(event) => onNameChange(event.target.value)} />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="llm-model">模型 ID</Label>
                        <Input
                          id="llm-model"
                          placeholder="deepseek-v4-flash / qwen2.5:7b / gpt-4o-mini"
                          value={model}
                          onChange={(event) => onModelChange(event.target.value)}
                        />
                      </div>
                    </div>
    
                    <div className="settings-fields-grid grid gap-3">
                      <div className="grid gap-2">
                        <Label htmlFor="llm-base-url">Base URL</Label>
                        <Input
                          id="llm-base-url"
                          placeholder={apiProtocol === 'anthropic' ? 'https://api.anthropic.com/v1' : apiProtocol === 'google' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.deepseek.com'}
                          value={baseUrl}
                          onChange={(event) => onBaseUrlChange(event.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="llm-api-protocol">接口类型</Label>
                        <Select value={apiProtocol} onValueChange={onApiProtocolChange}>
                          <SelectTrigger id="llm-api-protocol">
                            <SelectValue placeholder="选择接口协议" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="openai_compatible">OpenAI 兼容（/chat/completions）</SelectItem>
                            <SelectItem value="anthropic">Anthropic（/v1/messages）</SelectItem>
                            <SelectItem value="google">Google Gemini（generateContent）</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] leading-5 text-muted-foreground">
                          决定请求格式与认证头：Bearer、x-api-key 或 x-goog-api-key。自定义服务地址可任选一种协议。
                        </p>
                      </div>
                    </div>
    
                    <div className="grid gap-2">
                      <Label htmlFor="llm-api-key">API Key</Label>
                      <Input
                        id="llm-api-key"
                        placeholder="本地 Ollama 可留空"
                        type="password"
                        value={apiKey}
                        onChange={(event) => onApiKeyChange(event.target.value)}
                      />
                    </div>
    
                    <details className="settings-advanced"><summary>高级参数</summary>
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

                    </details>
                    {selectedModelMetadata ? (
                      <div className="grid gap-1 rounded-md border border-info-border bg-info-surface px-3 py-2 text-[11px] leading-5 text-info">
                        <span>
                          元数据来源：{modelMetadataSourceLabel(selectedModelMetadata.metadataSource)}
                        </span>
                        <span>
                          当前采用上下文：{formatContextLength(selectedModelMetadata.maxContextLength)}
                          {selectedModelMetadata.modelContextLength &&
                          selectedModelMetadata.providerContextLength &&
                          selectedModelMetadata.modelContextLength !== selectedModelMetadata.providerContextLength
                            ? `（OpenRouter 主路由参考 ${formatContextLength(selectedModelMetadata.providerContextLength)}）`
                            : ''}
                          {selectedModelMetadata.maxOutputTokens
                            ? `；最大输出：${formatContextLength(selectedModelMetadata.maxOutputTokens)}`
                            : '；最大输出：目录未提供'}
                        </span>
                      </div>
                    ) : null}

                    <p className="text-[11px] leading-5 text-muted-foreground">
                      上下文窗口是输入与输出合计容量；最大输出只是单次回答上限，两者不是同一个数值。同步结果可继续手动覆盖。
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
                            disabled={busy || !baseUrl || !model}
                            size="sm"
                            type="button"
                            onClick={async () => { setSaveError(false); if (await onSaveProfile()) onOpenChange(false); else setSaveError(true); }}
                          >
                            <Save />
                            保存
                          </Button>
                        ) : (
                          <Button
                            disabled={busy || !baseUrl || !model}
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

function modelMetadataSourceLabel(source: SettingsPanelLayoutProps['modelPresets'][number]['metadataSource']) {
  if (source === 'provider') {
    return '当前 API 的 /models';
  }
  if (source === 'openrouter') {
    return 'OpenRouter 公共模型目录';
  }
  return '内置预设（建议同步）';
}

