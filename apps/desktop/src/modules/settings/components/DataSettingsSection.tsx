import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsGroup, SettingsPage } from './SettingsPrimitives';
import { OnboardingSettings } from '@/modules/onboarding/OnboardingSettings';
import type { SettingsNavigationTarget } from '../settingsCatalog';
import { ParserSettingsSection } from './ParserSettingsSection';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';

/** SettingsPage owns scrolling; this is read-only location information with one native button. */
export function DataSettingsSection({ props, navigationTarget }: {
  props: SettingsPanelLayoutProps;
  navigationTarget?: SettingsNavigationTarget | null;
}) {
  return <>
    <ParserSettingsSection props={props} navigationTarget={navigationTarget} />
    <SettingsPage tab="getting-started" title="入门与教程" description="按真实任务练习阅读、翻译与整理；可以随时继续或回放。">
      <OnboardingSettings />
    </SettingsPage>
    <SettingsPage tab="data" title="资料与存储" description="查看本机资料的保存位置和迁移方式。">
      <SettingsGroup id="data-workspace" title="数据位置"
        description="便携版和 Windows 安装版均使用程序文件夹内的 data，无需选择或配置路径。">
        <p className="break-all text-xs leading-5 text-muted-foreground">
          {props.workspaceSettings?.data_root || props.workspaceCurrentLabel || '正在读取数据位置…'}
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">论文、笔记、聊天、模型设置和阅读状态保存在这里。更换电脑时，退出 Neuink 后复制整个程序文件夹；升级时保留 data。</p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">启动时自动检查程序目录旁和所在磁盘根目录的 neuink_data，补入旧资料；冲突保留当前内容。校验成功后，旧目录放入回收站。</p>
        {props.workspaceSettings?.legacy_import_notice && <p role="status" className="mt-2 text-xs leading-5">{props.workspaceSettings.legacy_import_notice}</p>}
        <Button className="mt-2" disabled={props.workspaceBusy || !props.workspaceCurrentLabel}
          size="sm" type="button" variant="outline" onClick={props.onOpenCurrentWorkspace}>
          <ExternalLink />在资源管理器中显示资料库
        </Button>
      </SettingsGroup>
    </SettingsPage>
  </>;
}
