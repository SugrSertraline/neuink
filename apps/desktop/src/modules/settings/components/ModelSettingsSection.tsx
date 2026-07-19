import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2
} from 'lucide-react';
import { useState } from 'react';

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
import { TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';

export function ModelSettingsSection({ props }: { props: SettingsPanelLayoutProps }) {
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [deleteConfirmProfile, setDeleteConfirmProfile] =
    useState<SettingsPanelLayoutProps['editingProfile']>(null);
  const {
    apiKey,
    baseUrl,
    busy,
    cachedModelCatalog,
    collapsedProviderCount,
    editingId,
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
    onBaseUrlChange,
    onCreateProfile,
    onDeleteProfile,
    onMaxContextLengthChange,
    onMaxOutputTokensChange,
    onModelChange,
    onModelPresetSelect,
    onNameChange,
    onNewProfile,
    onProviderPresetSelect,
    onRefreshModels,
    onSaveProfile,
    onTemperatureChange,
    onTestProfile,
    onToggleProvidersExpanded,
    onTopPChange,
    profileTestStates,
    providerLogo,
    providerPreset,
    providerPresets,
    providersExpanded,
    settings,
    temperature,
    topP
  } = props;
  const settingsContentClassName =
    'm-0 min-h-0 overflow-auto bg-background px-5 py-4';
  const settingsContentInnerClassName = (className: string) =>
    cn('settings-panel-content-inner', className);
  const selectedModelMetadata = modelPresets.find((preset) => preset.id === model);

  return (
            <TabsContent forceMount value="models" className={settingsContentClassName}>
              <div className={settingsContentInnerClassName('grid gap-5')}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">大语言模型</h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      这里只维护可用模型列表；具体由哪个任务使用，请在“任务模型”中明确指定。
                    </p>
                  </div>
                  <Button size="sm" type="button" variant="outline" onClick={() => {
                    onNewProfile();
                    setProfileEditorOpen(true);
                  }}>
                    <Plus />
                    新增配置
                  </Button>
                </div>
    
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {settings.profiles.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/80 bg-muted/25 p-3 text-xs text-muted-foreground">
                      还没有模型配置，先从下方 provider 预设开始即可。
                    </div>
                  ) : null}
                  {settings.profiles.map((profile) => {
                    const testState = profileTestStates[profile.id];
                    return (
                    <div
                      className={`rounded-xl border px-3 py-3 text-left text-xs transition hover:border-primary/25 hover:bg-muted/30 ${
                        editingId === profile.id
                          ? 'border-primary/35 bg-primary/5'
                          : 'border-border bg-card'
                      }`}
                      key={profile.id}
                    >
                      <div className="w-full text-left">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{profile.name}</span>
                        <span className="flex shrink-0 gap-1">
                          {settings.assistant_profile_id === profile.id ? <Badge variant="outline">对话</Badge> : null}
                          {settings.translation_profile_id === profile.id ? <Badge variant="outline">翻译</Badge> : null}
                        </span>
                      </span>
                      <span className="mt-2 block truncate text-[11px] text-muted-foreground">
                        {profile.model}
                      </span>
                      <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                        {profile.base_url}
                      </span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        上下文 {formatContextLength(profile.max_context_length ?? undefined)}
                        {profile.max_output_tokens ? ` · 输出 ${profile.max_output_tokens}` : ''}
                      </span>
                      </div>
                      <div className="mt-3 flex gap-1.5">
                        <Button className="flex-1 bg-primary/10 text-primary hover:bg-primary/20" size="xs" type="button" variant="secondary" onClick={() => {
                          onProviderPresetSelect(`__profile__${profile.id}`);
                          setProfileEditorOpen(true);
                        }}>
                          <Pencil />
                          编辑
                        </Button>
                        <Button
                          className={cn('flex-1', profileTestButtonClassName(testState?.status))}
                          disabled={testState?.status === 'testing'}
                          size="xs"
                          title={testState?.message}
                          type="button"
                          variant="outline"
                          onClick={() => onTestProfile(profile)}
                        >
                          {testState?.status === 'testing' ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                          {profileTestButtonLabel(testState?.status)}
                        </Button>
                        <Button size="icon-xs" title="删除配置" type="button" variant="destructive" onClick={() => setDeleteConfirmProfile(profile)}>
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  );
                  })}
                </div>
    
                <Dialog open={profileEditorOpen} onOpenChange={setProfileEditorOpen}>
                  <DialogContent className="grid h-[min(860px,calc(100vh-4rem))] w-[min(1080px,calc(100vw-2rem))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0 sm:max-w-none">
                    <DialogHeader className="border-b px-6 py-4">
                      <DialogTitle>{editingProfile ? `模型配置：${editingProfile.name}` : '新增模型配置'}</DialogTitle>
                    </DialogHeader>
                    <div className="min-h-0 overflow-y-auto px-6 py-4">
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Provider 预设</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        先选 provider，再按需刷新远端模型列表。
                      </p>
                    </div>
                    <Badge variant="outline">{providerPreset?.label ?? '自定义'}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
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
                  <div className="grid gap-4 rounded-lg border bg-card p-4">
                    <div className="flex items-center justify-between gap-2">
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
    
                    <div className="grid gap-4 md:grid-cols-2">
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
    
                    <div className="grid gap-2">
                      <Label htmlFor="llm-base-url">Base URL</Label>
                      <Input id="llm-base-url" value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} />
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
    
                    <div className="grid gap-3 md:grid-cols-3">
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
                    </div>
                  <DialogFooter className="mx-0 mb-0 flex-row items-center justify-end rounded-none bg-muted/40 px-6 py-4 sm:justify-end">
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
                            onClick={() => {
                              setProfileEditorOpen(false);
                              void onSaveProfile();
                            }}
                          >
                            <Save />
                            保存
                          </Button>
                        ) : (
                          <Button
                            disabled={busy || !baseUrl || !model}
                            size="sm"
                            type="button"
                            onClick={() => {
                              setProfileEditorOpen(false);
                              void onCreateProfile();
                            }}
                          >
                            <Plus />
                            创建配置
                          </Button>
                        )}
                  </DialogFooter>
                  </DialogContent>
                </Dialog>
    
                <Dialog open={Boolean(deleteConfirmProfile)} onOpenChange={(open) => {
                  if (!open) {
                    setDeleteConfirmProfile(null);
                  }
                }}>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>删除模型配置</DialogTitle>
                      <DialogDescription>
                        确认删除“{deleteConfirmProfile?.name}”？如果它正用于对话或翻译，相应任务会自动改用列表中的下一个可用配置。
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="sm:justify-center">
                      <Button disabled={busy} size="sm" type="button" variant="outline" onClick={() => setDeleteConfirmProfile(null)}>
                        取消
                      </Button>
                      <Button
                        disabled={busy || !deleteConfirmProfile}
                        size="sm"
                        type="button"
                        variant="destructive"
                        onClick={() => {
                          const profileId = deleteConfirmProfile?.id;
                          if (!profileId) {
                            return;
                          }
                          void Promise.resolve(onDeleteProfile(profileId)).then(() => setDeleteConfirmProfile(null));
                        }}
                      >
                        <Trash2 />
                        删除
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </TabsContent>
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

function profileTestButtonLabel(status: 'error' | 'idle' | 'success' | 'testing' | undefined) {
  if (status === 'testing') {
    return '测试中';
  }
  if (status === 'success') {
    return '已连接';
  }
  if (status === 'error') {
    return '连接失败';
  }
  return '测试连接';
}

function profileTestButtonClassName(status: 'error' | 'idle' | 'success' | 'testing' | undefined) {
  if (status === 'success') {
    return 'border-success-border bg-success-surface text-success hover:bg-success-surface';
  }
  if (status === 'error') {
    return 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20';
  }
  if (status === 'testing') {
    return 'border-warning-border bg-warning-surface text-warning';
  }
  return 'border-info-border bg-info-surface text-info hover:bg-info-surface';
}
