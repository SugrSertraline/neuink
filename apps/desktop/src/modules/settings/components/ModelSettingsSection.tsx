import { CheckCircle2, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { TaskModelSetting } from './TaskModelSetting';
import { ModelProfileEditor } from './ModelProfileEditor';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';

export function ModelSettingsSection({ props }: { props: SettingsPanelLayoutProps }) {
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [deleteConfirmProfile, setDeleteConfirmProfile] =
    useState<SettingsPanelLayoutProps['editingProfile']>(null);
  const { busy, settings, profileTestStates, formatContextLength, onNewProfile,
    onProviderPresetSelect, onTestProfile, onDeleteProfile } = props;
  const settingsContentClassName =
    'settings-content';
  const settingsContentInnerClassName = (className: string) =>
    cn('settings-panel-content-inner', className);

  return (
            <TabsContent forceMount value="models" className={settingsContentClassName}>
              <div className={settingsContentInnerClassName('grid gap-5')}>
                <div data-setting-id="models-connections" tabIndex={-1} className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">模型连接</h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      应用配置 · 维护连接与凭据；在下方指定对话模型，翻译模型位于“翻译”。
                    </p>
                  </div>
                  <Button disabled={props.modelsUnavailable || taskBusy(props)} size="sm" type="button" variant="outline" onClick={() => {
                    onNewProfile();
                    setProfileEditorOpen(true);
                  }}>
                    <Plus />
                    新增配置
                  </Button>
                </div>
    
                <div className="settings-model-list" role="list" aria-label="模型连接列表">
                  {!props.modelsUnavailable && settings.profiles.length === 0 && <p className="py-6 text-sm text-muted-foreground">还没有模型连接，点击“新增配置”开始。</p>}
                  {settings.profiles.map(profile => {
                    const testState = profileTestStates[profile.id];
                    return <div className="settings-model-row" role="listitem" key={profile.id}>
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="min-w-0 truncate text-[13px] font-semibold" title={profile.name}>{profile.name}</span>
                          <span className="flex flex-wrap gap-1">
                            {settings.assistant_profile_id === profile.id && <Badge variant="secondary">对话</Badge>}
                            {settings.translation_profile_id === profile.id && <Badge variant="secondary">翻译</Badge>}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs" title={profile.model}>{profile.model}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground" title={profile.base_url}>{profile.base_url}</p>
                      </div>
                      <div className="settings-model-meta text-xs text-muted-foreground">
                        <span>{profile.api_protocol === 'anthropic' ? 'Anthropic' : profile.api_protocol === 'google' ? 'Gemini' : 'OpenAI 兼容'}</span>
                        <span>上下文 {formatContextLength(profile.max_context_length ?? undefined).replace(/\s*ctx$/, '')}{profile.max_output_tokens ? ` · 输出 ${formatContextLength(profile.max_output_tokens).replace(/\s*ctx$/, '')}` : ''}</span>
                      </div>
                      <div className="settings-model-actions">
                        <Button disabled={props.modelsUnavailable || taskBusy(props)} size="sm" variant="outline" title={`编辑 ${profile.name}`} onClick={() => {
                          onProviderPresetSelect(`__profile__${profile.id}`); setProfileEditorOpen(true);
                        }}><Pencil />编辑</Button>
                        <Button className={profileTestButtonClassName(testState?.status)} disabled={props.modelsUnavailable || taskBusy(props) || testState?.status === 'testing'}
                          size="sm" variant="outline" title={testState?.message ?? `测试 ${profile.name}`} onClick={() => onTestProfile(profile)}>
                          {testState?.status === 'testing' ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}{profileTestButtonLabel(testState?.status)}
                        </Button>
                        <Button disabled={props.modelsUnavailable || taskBusy(props)} size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive"
                          aria-label={`删除模型配置 ${profile.name}`} title="删除配置" onClick={() => setDeleteConfirmProfile(profile)}><Trash2 /></Button>
                      </div>
                      {testState?.status === 'error' && testState.message && <p role="status" className="settings-model-error text-xs text-destructive">{testState.message}</p>}
                    </div>;
                  })}
                </div>

                <TaskModelSetting props={props} task="assistant" />
                <details data-setting-id="models-advanced" tabIndex={-1} className="settings-advanced"><summary>模型高级参数</summary>
                  <p className="text-xs leading-5 text-muted-foreground">点击需要调整的模型的“编辑”，展开“高级参数”可设置上下文窗口、最大输出、Temperature 与 Top P。</p>
                </details>
                <ModelProfileEditor props={props} open={profileEditorOpen} onOpenChange={setProfileEditorOpen} />
    
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
  return '';
}

function taskBusy(props: SettingsPanelLayoutProps) { return props.busy || props.modelMutationBusy; }
