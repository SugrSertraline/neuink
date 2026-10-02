import {
  ExternalLink,
  FolderOpen,
  FolderPlus,
  Loader2,
  MoveRight,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import { SettingsPage } from './SettingsPrimitives';
import { OnboardingSettings } from '@/modules/onboarding/OnboardingSettings';
import type { SettingsNavigationTarget } from '../settingsCatalog';
import { ParserSettingsSection } from './ParserSettingsSection';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';

export function DataSettingsSection({ props, navigationTarget }: {
  props: SettingsPanelLayoutProps;
  navigationTarget?: SettingsNavigationTarget | null;
}) {
  const {
    onCreateWorkspace,
    onMigrateWorkspace,
    onOpenCurrentWorkspace,
    onOpenRecentWorkspace,
    onForgetRecentWorkspace,
    onOpenWorkspace,
    onResetWorkspaceRoot,
    workspaceBusy,
    workspaceCurrentLabel,
    workspaceDefaultLabel,
    workspaceRoot,
    workspaceSettings,
  } = props;
  return <>
    <ParserSettingsSection props={props} navigationTarget={navigationTarget} />
    <SettingsPage tab="data" title="资料库与数据" description="管理资料库的位置与打开记录。迁移前会处理未保存内容。">
      <OnboardingSettings />
                <div data-setting-id="data-workspace" tabIndex={-1} className="grid gap-4">
                  <div>
                    <h3 className="text-sm font-semibold">资料库</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      打开已有资料库不会复制文件；新建和迁移是独立操作。
                    </p>
                  </div>

                  <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <Label className="shrink-0">当前资料库</Label>
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
                      打开其他资料库
                    </Button>
                    <Button disabled={workspaceBusy} size="sm" type="button" variant="outline" onClick={onCreateWorkspace}>
                      <FolderPlus />
                      新建资料库
                    </Button>
                    <Button
                      disabled={workspaceBusy || !workspaceSettings?.custom_root}
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={onResetWorkspaceRoot}
                    >
                      打开默认资料库
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
                              <Button variant="ghost" size="sm"
                                className="min-w-0 flex-1 justify-start text-left text-xs"
                                disabled={workspaceBusy}
                                type="button"
                                onClick={() => onOpenRecentWorkspace(item.root)}
                              >
                                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                                <span className="truncate">{item.root}</span>
                              </Button>
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
                      迁移当前资料库…
                    </Button>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                      复制全部资料到空目录，验证后切换；原目录不会自动删除。默认位置：{workspaceDefaultLabel || '读取中'}
                    </p>
                  </div>
                </div>
    </SettingsPage>
  </>;
}
