import { ExternalLink } from 'lucide-react';
import { WorkspaceRecoverySettings } from './WorkspaceRecoverySettings';
import { CloudAccountSettings } from './CloudAccountSettings';
import { Button } from '@/components/ui/button';
import { SettingsGroup, SettingsPage } from './SettingsPrimitives';
import { OnboardingSettings } from '@/modules/onboarding/OnboardingSettings';
import { ONBOARDING_GUIDE_VISIBLE } from '@/modules/onboarding/availability';
import type { SettingsNavigationTarget } from '../settingsCatalog';
import { ParserSettingsSection } from './ParserSettingsSection';
import { ZoteroSettingsSection } from './ZoteroSettingsSection';
import { MineruSettingsSection } from './MineruSettingsSection';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';

/** SettingsPage owns scrolling; this is read-only location information with one native button. */
export function DataSettingsSection({ props, navigationTarget }: {
  props: SettingsPanelLayoutProps;
  navigationTarget?: SettingsNavigationTarget | null;
}) {
  return <>
    <ParserSettingsSection props={props} navigationTarget={navigationTarget}>
      <ZoteroSettingsSection workspaceRoot={props.workspaceRoot ?? props.workspaceSettings?.root ?? null} active={props.activeSettingsTab === 'parser'} />
      <MineruSettingsSection active={props.activeSettingsTab === 'parser'} />
    </ParserSettingsSection>
    {ONBOARDING_GUIDE_VISIBLE && <SettingsPage tab="getting-started" title="入门与教程" description="按真实任务练习阅读、翻译与整理；可以随时继续或回放。">
      <OnboardingSettings />
    </SettingsPage>}
    <SettingsPage tab="account" title="账户" description="登录管理云端账户，也可以不登录，直接使用本地阅读。">
      <CloudAccountSettings navigationTarget={navigationTarget} active={props.activeSettingsTab === 'account'} />

      <SettingsGroup id="data-workspace" title="本机资料与存储"
        description="便携版和 Windows 安装版均使用程序文件夹内的 data，无需选择或配置路径。">
        <p className="break-all text-xs leading-5 text-muted-foreground">
          {props.workspaceSettings?.data_root || props.workspaceCurrentLabel || '正在读取数据位置…'}
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">论文、笔记、聊天、模型设置和阅读状态保存在这里。更换电脑时，退出 Neuink 后复制整个程序文件夹；升级时保留 data。</p>
        {props.workspaceSettings?.legacy_import_notice && <p role="status" className="mt-2 text-xs leading-5">{props.workspaceSettings.legacy_import_notice}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button disabled={props.workspaceBusy || !props.workspaceCurrentLabel}
          size="sm" type="button" variant="outline" onClick={props.onOpenCurrentWorkspace}>
          <ExternalLink />在资源管理器中显示资料库
        </Button>
        <WorkspaceRecoverySettings />
        </div>
      </SettingsGroup>
    </SettingsPage>
  </>;
}
