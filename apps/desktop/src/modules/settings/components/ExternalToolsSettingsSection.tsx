import { TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { SciverseSettingsSection } from '@/modules/sciverse/components/SciverseSettingsSection';

import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';

export function ExternalToolsSettingsSection({
  props
}: {
  props: SettingsPanelLayoutProps;
}) {
  const active = props.activeSettingsTab === 'external-tools';

  return (
    <TabsContent
      forceMount
      value="external-tools"
      className="m-0 min-h-0 overflow-auto bg-background px-5 py-4"
    >
      <div className={cn('settings-panel-content-inner', 'grid gap-4')}>
        <div>
          <h2 className="text-base font-semibold">外部工具</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            管理 Neuink 可以调用的外部检索与数据服务。凭据保存在系统凭据库中。
          </p>
        </div>

        <SciverseSettingsSection active={active} />
      </div>
    </TabsContent>
  );
}
