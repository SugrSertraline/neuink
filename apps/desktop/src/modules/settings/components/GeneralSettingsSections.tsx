import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { ReaderPreferences } from '@/shared/lib/readerPreferences';
import { normalizeUiScale, UI_SCALE_OPTIONS } from '@/shared/lib/uiScale';

import { AgentSettingsSection } from './AgentSettingsSection';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';

export function GeneralSettingsSections({ props }: { props: SettingsPanelLayoutProps }) {
  const {
    busy,
    draftAssistantProfileId,
    draftTranslationProfileId,
    model,
    name,
    onSetTaskProfile,
    settings,
    onReaderPreferencesChange,
    onThemePresetChange,
    onUiScaleChange,
    readerPreferences,
    themePreset,
    themePresets,
    uiScale,
    onAddAgent,
    onAddSkillPackage,
    onImportSkillPackage,
    onOpenSkillPackageFolder,
    onRemoveAgent,
    onRemoveSkillPackage,
    onSelectAgent,
    onSelectSkillPackage,
    onUpdateAgent,
    onUpdateRuntimeSettings,
    onUpdateSkillPackage,
    runtimeSettings,
    selectedAgentId,
    selectedSkillPackageId
  } = props;
  const settingsContentClassName =
    'm-0 min-h-0 overflow-auto bg-background px-5 py-4';
  const settingsContentInnerClassName = (className: string) =>
    cn('settings-panel-content-inner', className);

  return (
    <>
              <TabsContent forceMount value="tasks" className={settingsContentClassName}>
                <div className={settingsContentInnerClassName('grid gap-4')}>
                  <div>
                    <h2 className="text-base font-semibold">任务模型</h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      每类任务都明确使用这里指定的模型，不再存在隐藏的“默认模型”兜底。
                    </p>
                  </div>
      
                  {settings.profiles.length > 0 ? (
                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="grid gap-2 rounded-lg border bg-card p-4">
                        <Label className="text-sm" htmlFor="assistant-profile">
                          助手对话模型
                        </Label>
                        <Select
                          disabled={busy}
                          value={draftAssistantProfileId ?? settings.assistant_profile_id ?? ''}
                          onValueChange={(value) => onSetTaskProfile('assistant', value)}
                        >
                          <SelectTrigger id="assistant-profile" className="h-10 text-xs">
                            <SelectValue placeholder="选择模型" />
                          </SelectTrigger>
                          <SelectContent>
                            {settings.profiles.map((profile) => (
                              <SelectItem key={profile.id} value={profile.id}>
                                {profile.name} · {profile.model}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] leading-5 text-muted-foreground">
                          用于阅读助手对话、文献问答、笔记与元数据草拟，以及标签分析。
                        </p>
                        <TaskProfileSummary
                          formatContextLength={props.formatContextLength}
                          profile={settings.profiles.find(
                            (profile) => profile.id === (draftAssistantProfileId ?? settings.assistant_profile_id)
                          )}
                        />
                      </div>
      
                      <div className="grid gap-2 rounded-lg border bg-card p-4">
                        <Label className="text-sm" htmlFor="translation-profile">
                          阅读翻译模型
                        </Label>
                        <Select
                          disabled={busy}
                          value={draftTranslationProfileId ?? settings.translation_profile_id ?? ''}
                          onValueChange={(value) => onSetTaskProfile('translation', value)}
                        >
                          <SelectTrigger id="translation-profile" className="h-10 text-xs">
                            <SelectValue placeholder="选择模型" />
                          </SelectTrigger>
                          <SelectContent>
                            {settings.profiles.map((profile) => (
                              <SelectItem key={profile.id} value={profile.id}>
                                {profile.name} · {profile.model}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] leading-5 text-muted-foreground">
                          用于整篇翻译、自动翻译、单个片段翻译和选中文字快速翻译。
                        </p>
                        <TaskProfileSummary
                          formatContextLength={props.formatContextLength}
                          profile={settings.profiles.find(
                            (profile) => profile.id === (draftTranslationProfileId ?? settings.translation_profile_id)
                          )}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed bg-muted/25 p-4 text-xs text-muted-foreground">
                      请先在“大模型”页签新增至少一个模型配置。
                    </div>
                  )}
      
                </div>
              </TabsContent>
      
              <TabsContent forceMount value="appearance" className={settingsContentClassName}>
                <div className={settingsContentInnerClassName('grid gap-5')}>
                  <div>
                    <h2 className="text-base font-semibold">外观主题</h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      选择一组 shadcn/ui 风格的语义色，应用会立即更新。
                    </p>
                  </div>
      
                  <div className="grid gap-3 rounded-lg border bg-card p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">颜色预设</h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          当前预设：{themePresets.find((preset) => preset.id === themePreset)?.label ?? themePreset}
                        </p>
                      </div>
                      <Badge variant="outline">即时生效</Badge>
                    </div>
      
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {themePresets.map((preset) => (
                        <button
                          aria-pressed={themePreset === preset.id}
                          className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${
                            themePreset === preset.id
                              ? 'border-primary/45 bg-primary/7'
                              : 'border-border/70 bg-background hover:border-primary/25 hover:bg-muted/25'
                          }`}
                          key={preset.id}
                          type="button"
                          onClick={() => onThemePresetChange(preset.id)}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span
                              aria-hidden="true"
                              className="size-5 rounded-full border border-foreground/10 shadow-sm"
                              style={{ backgroundColor: preset.swatch }}
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold">{preset.label}</span>
                              <span className="block font-mono text-[11px] text-muted-foreground">{preset.swatch}</span>
                            </span>
                          </span>
                          {themePreset === preset.id ? <Badge>已选</Badge> : null}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-lg border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">界面缩放</h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          整体缩放标题栏、侧栏、阅读区、弹窗和设置页面，适合高 DPI 或低分辨率屏幕。
                        </p>
                      </div>
                      <Badge variant="outline">{Math.round(uiScale * 100)}%</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Label htmlFor="ui-scale">缩放比例</Label>
                      <Select
                        value={String(uiScale)}
                        onValueChange={(value) => onUiScaleChange(normalizeUiScale(value))}
                      >
                        <SelectTrigger id="ui-scale" className="w-36" size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {UI_SCALE_OPTIONS.map((scale) => (
                            <SelectItem key={scale} value={String(scale)}>
                              {Math.round(scale * 100)}%{scale === 1 ? '（默认）' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-[11px] leading-5 text-muted-foreground">
                      快捷键：Ctrl/Cmd + 减号缩小，Ctrl/Cmd + 加号放大，Ctrl/Cmd + 0 恢复 100%。
                    </p>
                  </div>
      
                  <div className="hidden">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">阅读设置</h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          控制 PDF 阅读器的默认交互方式。
                        </p>
                      </div>
                      <Badge variant="outline">保存后生效</Badge>
                    </div>
      
                    <div className="grid gap-3">
                      <ReaderSettingRow
                        checked={readerPreferences.hoverPreviewEnabled}
                        description="鼠标悬停在 PDF 区域上时，显示片段预览卡片。"
                        label="悬停预览"
                        onCheckedChange={(checked) =>
                          onReaderPreferencesChange({
                            ...readerPreferences,
                            hoverPreviewEnabled: checked
                          })
                        }
                      />
                      <ReaderSettingRow
                        checked={readerPreferences.hoverPreviewShowRegion}
                        description="悬停时高亮 PDF 中对应的片段区域。"
                        disabled={!readerPreferences.hoverPreviewEnabled}
                        inset
                        label="区域"
                        onCheckedChange={(checked) =>
                          onReaderPreferencesChange({
                            ...readerPreferences,
                            hoverPreviewShowRegion: checked
                          })
                        }
                      />
                      <ReaderSettingRow
                        checked={readerPreferences.hoverPreviewShowOriginal}
                        description="在悬停预览卡片里显示 MinerU 解析后的原文内容。"
                        disabled={!readerPreferences.hoverPreviewEnabled && !readerPreferences.reflowHoverSourceEnabled}
                        inset
                        label="解析后原文"
                        onCheckedChange={(checked) =>
                          onReaderPreferencesChange({
                            ...readerPreferences,
                            hoverPreviewShowOriginal: checked
                          })
                        }
                      />
                      <ReaderSettingRow
                        checked={readerPreferences.hoverPreviewShowTranslation}
                        description="在悬停预览卡片里显示全文翻译结果；仅在该片段已有译文时出现。"
                        disabled={!readerPreferences.hoverPreviewEnabled && !readerPreferences.reflowHoverSourceEnabled}
                        inset
                        label="译文"
                        onCheckedChange={(checked) =>
                          onReaderPreferencesChange({
                            ...readerPreferences,
                            hoverPreviewShowTranslation: checked
                          })
                        }
                      />
                      <ReaderSettingRow
                        checked={readerPreferences.hoverPreviewShowNote}
                        description="在悬停预览卡片里显示当前片段已保存的笔记。"
                        disabled={!readerPreferences.hoverPreviewEnabled && !readerPreferences.reflowHoverSourceEnabled}
                        inset
                        label="片段笔记"
                        onCheckedChange={(checked) =>
                          onReaderPreferencesChange({
                            ...readerPreferences,
                            hoverPreviewShowNote: checked
                          })
                        }
                      />
                      <ReaderSettingRow
                        checked={readerPreferences.hoverPreviewShowAnnotation}
                        description="在悬停预览卡片里显示当前片段的已有批注。"
                        disabled={!readerPreferences.hoverPreviewEnabled && !readerPreferences.reflowHoverSourceEnabled}
                        inset
                        label="批注"
                        onCheckedChange={(checked) =>
                          onReaderPreferencesChange({
                            ...readerPreferences,
                            hoverPreviewShowAnnotation: checked
                          })
                        }
                      />
                      <ReaderSettingRow
                        checked={readerPreferences.showRegions}
                        description="默认显示 PDF 上的分段区域框。"
                        label="显示区域"
                        onCheckedChange={(checked) =>
                          onReaderPreferencesChange({
                            ...readerPreferences,
                            showRegions: checked
                          })
                        }
                      />
                      <div className="flex items-center justify-between gap-4 border-t pt-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">打开片段笔记</div>
                          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">选择单击或双击片段后打开笔记；PDF 与重排分屏时单击始终只用于定位。</div>
                        </div>
                        <Select
                          value={readerPreferences.segmentNoteOpenGesture}
                          onValueChange={(value) =>
                            onReaderPreferencesChange({
                              ...readerPreferences,
                              leftClickOpensNotePane: value === 'single',
                              segmentNoteOpenGesture: value as ReaderPreferences['segmentNoteOpenGesture']
                            })
                          }
                        >
                          <SelectTrigger className="w-28" size="sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="button">选中后操作</SelectItem>
                            <SelectItem value="single">单击</SelectItem>
                            <SelectItem value="modifier">Alt + 单击</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <ReaderSettingRow
                        checked={readerPreferences.closeSegmentOverlayOnBlankClick}
                        description="片段笔记或批注打开后，点击 PDF 正文空白区域会关闭面板。"
                        label="空白处关闭片段面板"
                        onCheckedChange={(checked) =>
                          onReaderPreferencesChange({
                            ...readerPreferences,
                            closeSegmentOverlayOnBlankClick: checked
                          })
                        }
                      />
                      <ReaderSettingRow
                        checked={readerPreferences.closeSegmentOverlayOnSameSegmentClick}
                        description="片段笔记或批注打开后，再次点击同一个片段会关闭面板。"
                        label="再次点击片段关闭"
                        onCheckedChange={(checked) =>
                          onReaderPreferencesChange({
                            ...readerPreferences,
                            closeSegmentOverlayOnSameSegmentClick: checked
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              </TabsContent>
      
              <TabsContent forceMount value="reader" className={settingsContentClassName}>
                <div className={settingsContentInnerClassName('grid gap-4')}>
                  <div>
                    <h2 className="text-base font-semibold">阅读</h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">控制 PDF 阅读器的默认交互方式，修改会自动保存。</p>
                  </div>
                  <div className="grid gap-3 rounded-md border border-border/70 bg-white p-3">
                    <ReaderSettingRow
                      checked={readerPreferences.autoTranslateTextSelection}
                      label="选中文字后自动翻译"
                      description="完成文字选择后立即打开选区菜单并调用阅读翻译模型；关闭后仍可手动点击“翻译”。"
                      onCheckedChange={(checked) =>
                        onReaderPreferencesChange({
                          ...readerPreferences,
                          autoTranslateTextSelection: checked
                        })
                      }
                    />
                    <ReaderSettingRow checked={readerPreferences.hoverPreviewEnabled} label="悬停预览" description="鼠标悬停在 PDF 区域上时显示片段预览。" onCheckedChange={(checked) => onReaderPreferencesChange({ ...readerPreferences, hoverPreviewEnabled: checked })} />
                    <ReaderSettingRow checked={readerPreferences.hoverPreviewShowRegion} disabled={!readerPreferences.hoverPreviewEnabled} inset label="区域" description="悬停时高亮 PDF 中对应的片段区域。" onCheckedChange={(checked) => onReaderPreferencesChange({ ...readerPreferences, hoverPreviewShowRegion: checked })} />
                    <ReaderSettingRow checked={readerPreferences.hoverPreviewShowOriginal} disabled={!readerPreferences.hoverPreviewEnabled && !readerPreferences.reflowHoverSourceEnabled} inset label="解析后原文" description="在悬停预览中显示 MinerU 解析后的内容。" onCheckedChange={(checked) => onReaderPreferencesChange({ ...readerPreferences, hoverPreviewShowOriginal: checked })} />
                    <ReaderSettingRow checked={readerPreferences.hoverPreviewShowTranslation} disabled={!readerPreferences.hoverPreviewEnabled && !readerPreferences.reflowHoverSourceEnabled} inset label="译文" description="在悬停预览中显示可用译文。" onCheckedChange={(checked) => onReaderPreferencesChange({ ...readerPreferences, hoverPreviewShowTranslation: checked })} />
                    <ReaderSettingRow checked={readerPreferences.hoverPreviewShowNote} disabled={!readerPreferences.hoverPreviewEnabled && !readerPreferences.reflowHoverSourceEnabled} inset label="片段笔记" description="在悬停预览中显示当前片段已保存的笔记。" onCheckedChange={(checked) => onReaderPreferencesChange({ ...readerPreferences, hoverPreviewShowNote: checked })} />
                    <ReaderSettingRow checked={readerPreferences.hoverPreviewShowAnnotation} disabled={!readerPreferences.hoverPreviewEnabled && !readerPreferences.reflowHoverSourceEnabled} inset label="批注" description="在悬停预览中显示当前片段的已有批注。" onCheckedChange={(checked) => onReaderPreferencesChange({ ...readerPreferences, hoverPreviewShowAnnotation: checked })} />
                    <ReaderSettingRow checked={readerPreferences.reflowHoverSourceEnabled} label="重排悬停预览" description="鼠标悬停在重排 Block 上时显示所选的原文、译文、笔记和批注。" onCheckedChange={(checked) => onReaderPreferencesChange({ ...readerPreferences, reflowHoverSourceEnabled: checked })} />
                    <div className="flex items-center justify-between gap-4 border-t pt-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">重排翻译显示</div>
                        <div className="mt-0.5 text-xs leading-5 text-muted-foreground">设置重排视图默认显示原文、译文或双语对照。</div>
                      </div>
                      <Select value={readerPreferences.reflowTranslationMode} onValueChange={(value) => onReaderPreferencesChange({ ...readerPreferences, reflowTranslationMode: value as ReaderPreferences['reflowTranslationMode'] })}>
                        <SelectTrigger className="w-28" size="sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="source">原文</SelectItem>
                          <SelectItem value="translation">译文</SelectItem>
                          <SelectItem value="bilingual">双语对照</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <ReaderSettingRow checked={readerPreferences.showRegions} label="默认显示区域" description="默认显示 PDF 上的分段区域框。" onCheckedChange={(checked) => onReaderPreferencesChange({ ...readerPreferences, showRegions: checked })} />
                    <div className="flex items-center justify-between gap-4 border-t pt-3">
                      <div className="min-w-0"><div className="text-sm font-medium">打开片段笔记</div><div className="mt-0.5 text-xs leading-5 text-muted-foreground">分屏 PDF/重排时单击始终只定位对侧，不打开笔记。</div></div>
                      <Select value={readerPreferences.segmentNoteOpenGesture} onValueChange={(value) => onReaderPreferencesChange({ ...readerPreferences, leftClickOpensNotePane: value === 'single', segmentNoteOpenGesture: value as ReaderPreferences['segmentNoteOpenGesture'] })}>
                        <SelectTrigger className="w-28" size="sm"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="button">选中后操作</SelectItem><SelectItem value="single">单击</SelectItem><SelectItem value="modifier">Alt + 单击</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <ReaderSettingRow checked={readerPreferences.closeSegmentOverlayOnBlankClick} label="空白处关闭片段浮层" description="在 PDF 或重排视图点击空白区域时关闭笔记或批注浮层。" onCheckedChange={(checked) => onReaderPreferencesChange({ ...readerPreferences, closeSegmentOverlayOnBlankClick: checked })} />
                    <ReaderSettingRow checked={readerPreferences.closeSegmentOverlayOnSameSegmentClick} label="再次点击片段关闭" description="在 PDF 或重排视图再次点击已打开的片段时关闭浮层。" onCheckedChange={(checked) => onReaderPreferencesChange({ ...readerPreferences, closeSegmentOverlayOnSameSegmentClick: checked })} />
                  </div>
                </div>
              </TabsContent>
      
              <TabsContent forceMount value="main-agent" className={settingsContentClassName}>
                <div className={settingsContentInnerClassName('grid gap-4')}>
                  <AgentSettingsSection
                    llmProfiles={settings.profiles}
                    onAddAgent={onAddAgent}
                    onAddSkillPackage={onAddSkillPackage}
                    onImportSkillPackage={onImportSkillPackage}
                    onRemoveAgent={onRemoveAgent}
                    onRemoveSkillPackage={onRemoveSkillPackage}
                    onOpenSkillPackageFolder={onOpenSkillPackageFolder}
                    onSelectAgent={onSelectAgent}
                    onSelectSkillPackage={onSelectSkillPackage}
                    onUpdateAgent={onUpdateAgent}
                    onUpdateRuntimeSettings={onUpdateRuntimeSettings}
                    onUpdateSkillPackage={onUpdateSkillPackage}
                    runtimeSettings={runtimeSettings}
                    selectedAgentId={selectedAgentId}
                    selectedSkillPackageId={selectedSkillPackageId}
                    view="main-agent"
                  />
                </div>
              </TabsContent>
      
              <TabsContent forceMount value="subagents" className={settingsContentClassName}>
                <div className={settingsContentInnerClassName('grid gap-4')}>
                  <AgentSettingsSection
                    llmProfiles={settings.profiles}
                    onAddAgent={onAddAgent}
                    onAddSkillPackage={onAddSkillPackage}
                    onImportSkillPackage={onImportSkillPackage}
                    onRemoveAgent={onRemoveAgent}
                    onRemoveSkillPackage={onRemoveSkillPackage}
                    onOpenSkillPackageFolder={onOpenSkillPackageFolder}
                    onSelectAgent={onSelectAgent}
                    onSelectSkillPackage={onSelectSkillPackage}
                    onUpdateAgent={onUpdateAgent}
                    onUpdateRuntimeSettings={onUpdateRuntimeSettings}
                    onUpdateSkillPackage={onUpdateSkillPackage}
                    runtimeSettings={runtimeSettings}
                    selectedAgentId={selectedAgentId}
                    selectedSkillPackageId={selectedSkillPackageId}
                    view="subagents"
                  />
                </div>
              </TabsContent>
      
              <TabsContent forceMount value="skills" className={settingsContentClassName}>
                <div className={settingsContentInnerClassName('grid gap-4')}>
                  <AgentSettingsSection
                    llmProfiles={settings.profiles}
                    onAddAgent={onAddAgent}
                    onAddSkillPackage={onAddSkillPackage}
                    onImportSkillPackage={onImportSkillPackage}
                    onRemoveAgent={onRemoveAgent}
                    onRemoveSkillPackage={onRemoveSkillPackage}
                    onOpenSkillPackageFolder={onOpenSkillPackageFolder}
                    onSelectAgent={onSelectAgent}
                    onSelectSkillPackage={onSelectSkillPackage}
                    onUpdateAgent={onUpdateAgent}
                    onUpdateRuntimeSettings={onUpdateRuntimeSettings}
                    onUpdateSkillPackage={onUpdateSkillPackage}
                    runtimeSettings={runtimeSettings}
                    selectedAgentId={selectedAgentId}
                    selectedSkillPackageId={selectedSkillPackageId}
                    view="skills"
                  />
                </div>
              </TabsContent>
    </>
  );
}

function TaskProfileSummary({
  formatContextLength,
  profile
}: {
  formatContextLength: (value?: number) => string;
  profile?: SettingsPanelLayoutProps['settings']['profiles'][number];
}) {
  if (!profile) {
    return <p className="text-[11px] text-destructive">尚未指定模型，此任务将不可用。</p>;
  }
  return (
    <p className="text-[11px] leading-5 text-muted-foreground">
      {profile.model} · 上下文 {formatContextLength(profile.max_context_length ?? undefined)}
      {profile.max_output_tokens ? ` · 输出 ${profile.max_output_tokens}` : ''}
    </p>
  );
}

function ReaderSettingRow({
  checked,
  description,
  disabled = false,
  inset = false,
  label,
  onCheckedChange
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  inset?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-background/80 px-3 py-3 transition ${
        disabled ? 'cursor-not-allowed opacity-55' : ''
      } ${inset ? 'ml-4' : ''}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </label>
  );
}
