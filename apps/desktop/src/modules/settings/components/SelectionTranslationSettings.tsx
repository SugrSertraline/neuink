import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { getTranslationServices, type SelectionTranslationSettings as Settings } from '@/shared/ipc/selectionTranslationApi';
import { SettingsGroup } from './SettingsPrimitives';
import { TranslationServiceForm } from './TranslationServiceForm';

/** Each mounted service form retains its own unsaved draft; settings viewport owns scrolling. */
export function SelectionTranslationSettings({ active, modelConnections }: { active: boolean; modelConnections?: ReactNode }) {
  const [services, setServices] = useState<Settings[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active || services) return;
    let cancelled = false;
    setLoading(true); setError('');
    void getTranslationServices().then(values => { if (!cancelled) setServices(values); })
      .catch(() => { if (!cancelled) setError('读取翻译服务配置失败，请重试。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, services, attempt]);
  return <SettingsGroup id="translation-service" title="翻译模型与服务" description="展开一项填写配置，可同时配置多个来源。保存后，在下方为每种翻译行为选择使用的模型或服务。">
      {!services && (loading ? <p role="status" className="text-xs">正在读取翻译服务…</p> : <>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <Button size="sm" variant="outline" onClick={() => setAttempt(n => n + 1)}>重新读取配置</Button>
      </>)}
    {(services || modelConnections) && <div className="overflow-hidden rounded-md border border-border bg-card">
      {services?.map(service => <TranslationServiceForm key={service.provider} initial={service} />)}
      {services?.length === 0 && <div className="p-3 text-xs text-muted-foreground"><p>暂无翻译服务配置。</p>
        <Button size="xs" variant="outline" className="mt-2" onClick={() => { setServices(null); setAttempt(n => n + 1); }}>重新读取配置</Button></div>}
      {modelConnections}
    </div>}
    <p className="mt-3 text-xs leading-5 text-muted-foreground">当前翻译目标为简体中文；服务按各自账户额度计费。收起配置不会丢失未保存的修改。</p>
  </SettingsGroup>;
}
