import {
  Cloud,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  Loader2,
  LockKeyhole,
  MoveRight,
  Server,
  X
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';

export function DataSettingsSection({ props }: { props: SettingsPanelLayoutProps }) {
  const {
    cloudUnlocked,
    customParserApiKey,
    customParserEndpoint,
    effectiveParserEndpointLabel,
    onCreateWorkspace,
    onMigrateWorkspace,
    onOpenCurrentWorkspace,
    onOpenRecentWorkspace,
    onForgetRecentWorkspace,
    onOpenWorkspace,
    onParserApiKeyChange,
    onParserEndpointChange,
    onPopoEnhancementEnabledChange,
    onPopoEnhancementEndpointChange,
    onResetWorkspaceRoot,
    onSelectParserSourceMode,
    onSetUnlockSecret,
    onTranslationAutomationChange,
    onUnlockCloudParser,
    parserSourceIntent,
    parserSourceMode,
    popoEnhancementEnabled,
    popoEnhancementEndpoint,
    unlockBusy,
    unlockSecret,
    workspaceBusy,
    workspaceCurrentLabel,
    workspaceDefaultLabel,
    workspaceRoot,
    workspaceSettings,
    translationAutomation
  } = props;
  const settingsContentClassName =
    'm-0 min-h-0 overflow-auto bg-background px-5 py-4';
  const settingsContentInnerClassName = (className: string) =>
    cn('settings-panel-content-inner', className);

  return (
            <TabsContent forceMount value="data" className={settingsContentClassName}>
              <div className={settingsContentInnerClassName('grid gap-5')}>
                <div className="grid gap-4 rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">MinerU 解析来源</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        云端解析只需要输入秘钥解锁；自定义 URL 才需要配置服务地址和 API Key。
                      </p>
                    </div>
                    <Badge variant={parserSourceMode === 'cloud' ? 'default' : 'secondary'}>
                      {parserSourceMode === 'cloud' ? '云端' : '自定义 URL'}
                    </Badge>
                  </div>
    
                  <div className="grid gap-3 xl:grid-cols-2">
                    <button
                      className={`rounded-lg border px-4 py-4 text-left transition-colors ${
                        parserSourceIntent === 'cloud'
                          ? 'border-primary/35 bg-primary/6'
                          : 'border-border/70 bg-background hover:border-primary/20 hover:bg-muted/25'
                      }`}
                      type="button"
                      onClick={() => onSelectParserSourceMode('cloud')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <span className="rounded-xl bg-primary/10 p-2 text-primary">
                            <Cloud size={16} />
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">云端 MinerU</span>
                              {!cloudUnlocked ? (
                                <Badge className="bg-warning-surface text-warning hover:bg-warning-surface">未解锁</Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              使用内置 MinerU 云端解析，不需要填写自定义 URL 或 API Key。
                            </p>
                          </div>
                        </div>
                        {cloudUnlocked ? (
                          <Badge variant={parserSourceMode === 'cloud' ? 'default' : 'outline'}>
                            {parserSourceMode === 'cloud' ? '已启用' : '可用'}
                          </Badge>
                        ) : (
                          <LockKeyhole size={15} className="text-muted-foreground" />
                        )}
                      </div>
                    </button>
    
                    <button
                      className={`rounded-lg border px-4 py-4 text-left transition-colors ${
                        parserSourceIntent === 'custom'
                          ? 'border-primary/35 bg-primary/6'
                          : 'border-border/70 bg-background hover:border-primary/20 hover:bg-muted/25'
                      }`}
                      type="button"
                      onClick={() => onSelectParserSourceMode('custom')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <span className="rounded-md bg-muted p-2 text-muted-foreground">
                            <Server size={16} />
                          </span>
                          <div>
                            <div className="text-sm font-semibold">自定义 MinerU URL</div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              使用你部署的 MinerU 解析服务。API Key 会由软件保存并随请求发送。
                            </p>
                          </div>
                        </div>
                        <Badge variant={parserSourceMode === 'custom' ? 'default' : 'outline'}>
                          {parserSourceMode === 'custom' ? '已启用' : '可切换'}
                        </Badge>
                      </div>
                    </button>
                  </div>
    
                  {!cloudUnlocked && parserSourceIntent === 'cloud' ? (
                    <div className="grid gap-3 rounded-md border border-warning/35 bg-warning-surface/40 p-3">
                      <div>
                        <h4 className="text-sm font-medium">输入秘钥后才会启用云端解析</h4>
                        <p className="mt-1 text-xs text-muted-foreground">未解锁前不会启用云端解析。</p>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          disabled={unlockBusy}
                          placeholder="输入云端解析秘钥"
                          type="password"
                          value={unlockSecret}
                          onChange={(event) => onSetUnlockSecret(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              onUnlockCloudParser();
                            }
                          }}
                        />
                        <Button
                          disabled={unlockBusy || !unlockSecret.trim()}
                          type="button"
                          variant="outline"
                          onClick={onUnlockCloudParser}
                        >
                          {unlockBusy ? <Loader2 className="animate-spin" /> : null}
                          解锁并启用
                        </Button>
                      </div>
                    </div>
                  ) : null}
    
                  {parserSourceIntent === 'custom' ? (
                    <>
                      <div className="grid gap-2">
                        <Label htmlFor="parser-endpoint">自定义 MinerU URL</Label>
                        <Input
                          id="parser-endpoint"
                          placeholder="http://127.0.0.1:18000"
                          value={customParserEndpoint}
                          onChange={(event) => onParserEndpointChange(event.target.value)}
                        />
                      </div>
    
                      <div className="grid gap-2">
                        <Label htmlFor="parser-api-key">自定义服务 API Key</Label>
                        <Input
                          id="parser-api-key"
                          placeholder="可选"
                          type="password"
                          value={customParserApiKey}
                          onChange={(event) => onParserApiKeyChange(event.target.value)}
                        />
                      </div>
                    </>
                  ) : null}
    
                  <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
                    {
                      parserSourceIntent === 'cloud' && !cloudUnlocked ? (
                        <>
                          <span className="block">你已点选云端 MinerU；保存前请先输入云端解析秘钥。</span>
                          <span className="mt-1 block">云端解析不需要填写自定义 URL 或 API Key。</span>
                        </>
                      ) : (
                        <>
                          <span className="block">
                            保存后解析请求将发送到
                            <span className="ml-1 font-mono text-[11px]">
                              {effectiveParserEndpointLabel}
                            </span>
                          </span>
                          {parserSourceIntent === 'cloud' ? (
                            <span className="mt-1 block">云端解析不使用自定义 URL 或 API Key。</span>
                          ) : null}
                          <span className="mt-1 block">
                            请在东北大学校园网环境下使用，不能使用 NEU-Mobile 网络。
                          </span>
                        </>
                      )
                    }
                  </div>
                </div>
    
                <div className="grid gap-4 rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Popo 增强</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        主展示仍以 MinerU 结果为准；启用后可在后续增强流程中把 MinerU 产物提交给 Popo。
                      </p>
                    </div>
                    <Switch
                      checked={popoEnhancementEnabled}
                      onCheckedChange={onPopoEnhancementEnabledChange}
                    />
                  </div>
    
                  <div className="grid gap-2">
                    <Label htmlFor="popo-endpoint">Popo URL</Label>
                    <Input
                      id="popo-endpoint"
                      disabled={!popoEnhancementEnabled}
                      placeholder=""
                      value={popoEnhancementEndpoint}
                      onChange={(event) => onPopoEnhancementEndpointChange(event.target.value)}
                    />
                  </div>
                </div>
    
                <div className="grid gap-4 rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">PDF 自动翻译</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        PDF 解析成功后自动启动英译中。可选择默认参与翻译的内容类型；关闭时不会调用翻译模型。
                      </p>
                    </div>
                    <Switch
                      checked={translationAutomation.auto_translate_pdf}
                      onCheckedChange={(autoTranslatePdf) => onTranslationAutomationChange({
                        ...translationAutomation,
                        auto_translate_pdf: autoTranslatePdf
                      })}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {TRANSLATION_TYPES.map((item) => {
                      const selected = translationAutomation.segment_types.includes(item.value);
                      return (
                        <Button
                          aria-pressed={selected}
                          key={item.value}
                          size="xs"
                          type="button"
                          variant={selected ? 'secondary' : 'outline'}
                          onClick={() => onTranslationAutomationChange({
                            ...translationAutomation,
                            segment_types: selected
                              ? translationAutomation.segment_types.filter((value) => value !== item.value)
                              : [...translationAutomation.segment_types, item.value]
                          })}
                        >
                          {item.label}
                        </Button>
                      );
                    })}
                  </div>
                  {!translationAutomation.segment_types.length ? (
                    <p className="text-xs text-warning">请至少选择一种内容类型，否则解析后不会启动翻译任务。</p>
                  ) : null}
                </div>

                <div className="grid gap-4 rounded-lg border bg-card p-4">
                  <div>
                    <h3 className="text-sm font-semibold">工作区</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      打开已有工作区不会复制文件；新建和迁移是独立操作。
                    </p>
                  </div>

                  <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label>当前工作区</Label>
                      <Button disabled={workspaceBusy || !workspaceCurrentLabel} size="sm" type="button" variant="ghost" onClick={onOpenCurrentWorkspace}>
                        <ExternalLink />
                        在资源管理器中显示
                      </Button>
                    </div>
                    <div className="break-all text-xs leading-5 text-muted-foreground">
                      {workspaceCurrentLabel || '未打开'}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button disabled={workspaceBusy} size="sm" type="button" onClick={onOpenWorkspace}>
                      {workspaceBusy ? <Loader2 className="animate-spin" /> : <FolderOpen />}
                      打开其他工作区
                    </Button>
                    <Button disabled={workspaceBusy} size="sm" type="button" variant="outline" onClick={onCreateWorkspace}>
                      <FolderPlus />
                      新建工作区
                    </Button>
                    <Button
                      disabled={workspaceBusy || !workspaceSettings?.custom_root}
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={onResetWorkspaceRoot}
                    >
                      打开默认工作区
                    </Button>
                  </div>

                  {(workspaceSettings?.recent_workspaces ?? []).filter(
                    (item) => item.root !== (workspaceRoot ?? workspaceSettings?.root ?? '')
                  ).length ? (
                    <div className="grid gap-2">
                      <Label>最近使用</Label>
                      <div className="grid gap-1">
                        {(workspaceSettings?.recent_workspaces ?? [])
                          .filter((item) => item.root !== (workspaceRoot ?? workspaceSettings?.root ?? ''))
                          .slice(0, 5)
                          .map((item) => (
                            <div key={item.root} className="flex min-w-0 items-center gap-1 rounded-md hover:bg-muted">
                              <button
                                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-xs"
                                disabled={workspaceBusy}
                                type="button"
                                onClick={() => onOpenRecentWorkspace(item.root)}
                              >
                                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                                <span className="truncate">{item.root}</span>
                              </button>
                              <Button
                                aria-label={`从最近使用中移除 ${item.root}`}
                                disabled={workspaceBusy}
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                                onClick={() => onForgetRecentWorkspace(item.root)}
                              >
                                <X />
                              </Button>
                            </div>
                          ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="border-t pt-3">
                    <Button disabled={workspaceBusy} size="sm" type="button" variant="ghost" onClick={onMigrateWorkspace}>
                      <MoveRight />
                      迁移当前工作区…
                    </Button>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                      复制全部资料到空目录，验证后切换；原目录不会自动删除。默认位置：{workspaceDefaultLabel || '读取中'}
                    </p>
                  </div>
                </div>
    
              </div>
            </TabsContent>
  );
}

const TRANSLATION_TYPES = [
  { value: 'paragraph', label: '段落' },
  { value: 'heading', label: '标题' },
  { value: 'table', label: '表格' },
  { value: 'math', label: '公式' },
  { value: 'figure', label: '图片' },
  { value: 'code', label: '代码' },
  { value: 'list', label: '列表' },
  { value: 'page_header', label: '页眉' },
  { value: 'page_footer', label: '页脚' },
  { value: 'page_number', label: '页码' },
  { value: 'aside_text', label: '侧栏文字' },
  { value: 'page_footnote', label: '脚注' }
] as const;
