import type { SettingsNavigationTarget } from '../settingsCatalog';
import { CloudAdminPasswordReset } from './CloudAdminPasswordReset';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cloudAccount, type CloudAccount, type CloudDevice } from '@/shared/ipc/cloudAccountApi';
import { SettingsGroup } from './SettingsPrimitives';
import { CloudServerSettings } from './CloudServerSettings';
import { CloudPasswordSettings } from './CloudPasswordSettings';
import { CloudProfileSettings } from './CloudProfileSettings';
import { CloudSyncControls } from './CloudSyncControls';
import { cloudServerAddress } from './cloudServerAddress';

/** This component owns form state; the existing settings page owns scrolling and focus. */
export function CloudAccountSettings({ active, navigationTarget }: { active: boolean; navigationTarget?: SettingsNavigationTarget | null }) {
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [connected, setConnected] = useState(false);
  const [editingServer, setEditingServer] = useState(false);
  const [httpConfirmed, setHttpConfirmed] = useState(false);
  const isHttp = /^http:\/\//i.test(endpoint.trim());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [devices, setDevices] = useState<CloudDevice[]>([]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function reload() {
    const value = await cloudAccount<CloudAccount>({ action: 'status' });
    if (mounted.current) { setAccount(value); setEndpoint(value.endpoint); }
  }
  useEffect(() => {
    if (!active) return;
    setConnected(false);
    setBusy(false);
    let valid = true;
    void cloudAccount<CloudAccount>({ action: 'status' }).then(async value => {
      if (!valid) return;
      setAccount(value); setEndpoint(value.endpoint); setUsername(value.username ?? '');
      if (!value.endpoint || !value.server_id) { setEditingServer(true); return; }
      setEditingServer(false);
      if (value.account_id) return;
      setBusy(true);
      try {
        await cloudAccount({ action: 'connect', endpoint: value.endpoint });
        if (valid) { setConnected(true); setFailed(false); setMessage(''); }
      } catch { if (valid) { setFailed(true); setMessage('无法连接已保存的服务器，请重试或更改地址。'); } }
      finally { if (valid) setBusy(false); }
    }).catch(() => { if (valid) { setFailed(true); setMessage('账号配置暂时无法读取，请重新进入设置。'); } });
    return () => { valid = false; };
  }, [active]);
  async function run(task: () => Promise<void>, success: string) {
    if (busy) return;
    setBusy(true); setFailed(false); setMessage('');
    try { await task(); if (mounted.current) setMessage(success); }
    catch (error) { if (mounted.current) { setFailed(true); setMessage(typeof error === 'string' ? error : '操作未完成，请检查网络后重试。'); } }
    finally { if (mounted.current) setBusy(false); }
  }
  const connect = () => void run(async () => {
    if (editingServer && isHttp && !httpConfirmed) return;
    setConnected(false);
    const address = cloudServerAddress(endpoint);
    await cloudAccount({ action: 'connect', endpoint: address });
    await reload();
    if (mounted.current) { setConnected(true); setEditingServer(false); }
  }, '');
  const submitAccount = () => { if (!connected) return; void run(async () => {
              await cloudAccount({ action: 'login', username, password, device_name: 'NeuInk 桌面端' }); await reload();
              // Retain an explicitly configured self-hosted service.
              if (!window.localStorage.getItem('neuink.parserEndpoint')) {
                try {
                  const capability = await cloudAccount<{available: boolean}>({ action: 'parse_availability' });
                  if (capability.available) {
                    window.localStorage.setItem('neuink.parserEndpoint', 'neuink-account');
                    window.dispatchEvent(new Event('neuink-parser-source-changed'));
                  }
                } catch { /* Login succeeded; unavailable parsing must not undo it. */ }
              }
            setPassword('');
          }, ''); };
  return <SettingsGroup id="data-cloud-account" title={account?.account_id ? undefined : !connected ? '连接云端服务器' : '登录账户'}>
    <CloudAdminPasswordReset navigationTarget={navigationTarget} account={account} onChanged={reload} />
    <div className="max-w-3xl space-y-3">
      {account?.account_id ? <div className="space-y-4">
        <CloudProfileSettings key={account.server_id + account.account_id} account={account} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
            const value = await cloudAccount<CloudDevice[]>({ action: 'devices' }); setDevices(value);
          }, '设备列表已更新。')}>登录设备</Button>
          <CloudPasswordSettings loggedIn endpoint={endpoint} onChanged={reload} />
          <CloudServerSettings endpoint={endpoint} loggedIn disabled={busy} onChanged={reload} />
          <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void run(async () => {
            await cloudAccount({ action: 'logout' }); setConnected(false); setPassword(''); setDevices([]); await reload();
          }, '已退出，本机资料保留。')}>退出账号</Button>
        </div>
        {devices.map(device => <div key={device.id} className="flex items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate">{device.name || '未命名设备'}{device.current ? '（当前设备）' : ''}</span>
          {!device.current && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
            await cloudAccount({ action: 'revoke', id: device.id }); setDevices(current => current.filter(item => item.id !== device.id));
          }, '已撤销该设备的登录。')}>撤销登录</Button>}
        </div>)}
      </div> : <div className="space-y-3">
        {editingServer ? <form className="max-w-md space-y-2" onSubmit={event => { event.preventDefault(); if (!busy && account && endpoint.trim() && (!isHttp || httpConfirmed)) connect(); }}>
          <label className="block space-y-2 text-xs">服务器 IP 或地址<Input autoComplete="off" placeholder="IP 或 IP:端口" value={endpoint} disabled={busy || !account} onChange={event => { setEndpoint(event.target.value); setHttpConfirmed(false); setConnected(false); setPassword(''); setMessage(''); }} /></label>
          {isHttp && <label className="flex items-start gap-2 text-xs text-muted-foreground"><Checkbox checked={httpConfirmed} disabled={busy} onCheckedChange={value => setHttpConfirmed(value === true)} /><span>HTTP 连接不会加密账号密码和论文内容，我已了解并仍要连接。</span></label>}
          <p className="text-xs text-muted-foreground">仅填写 IP 时使用 HTTPS 和端口 18793；其他端口请填写 IP:端口，也可填写完整 HTTPS 地址。</p>
          <div className="flex flex-wrap items-center gap-2"><Button type="submit" size="sm" variant="outline" disabled={busy || !account || !endpoint.trim() || (isHttp && !httpConfirmed)}>{busy && !connected ? '正在连接…' : '连接服务器'}</Button>
          {account?.server_id && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setEndpoint(account.endpoint); setEditingServer(false); setPassword(''); setMessage(''); }}>取消</Button>}</div>
        </form> : <div className="flex flex-wrap items-center gap-2 text-xs"><span className="min-w-0 break-all text-muted-foreground">服务器：{account?.endpoint || '正在读取…'}</span><CloudServerSettings endpoint={account?.endpoint || ''} loggedIn={false} disabled={busy || !account} triggerLabel="更改" onChanged={async () => { await reload(); setConnected(true); setPassword(''); setFailed(false); setMessage(''); }} />{!connected && <Button type="button" size="sm" variant="outline" disabled={busy || !account} onClick={connect}>{busy ? '正在连接…' : '重试连接'}</Button>}</div>}
        {connected && <>
        <div className="max-w-sm space-y-4" onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !busy && username.trim() && password) { event.preventDefault(); submitAccount(); } }}>
          <label className="block space-y-2 text-xs">用户名<Input autoComplete="username" value={username} disabled={busy} onChange={e => setUsername(e.target.value)} /></label>
          <label className="block space-y-2 text-xs">密码<Input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy || !endpoint.trim() || !username.trim() || !password} onClick={submitAccount}>{busy ? '正在处理…' : '登录'}</Button>
          <TooltipProvider><Tooltip><TooltipTrigger asChild><span tabIndex={0} aria-label="注册新账户不可用，请联系管理员" className="inline-flex"><Button type="button" variant="outline" size="sm" disabled>注册新账户</Button></span></TooltipTrigger><TooltipContent>暂不开放注册，请联系管理员。</TooltipContent></Tooltip></TooltipProvider>
        </div>
        </>}
      </div>}
      <div data-setting-id="data-cloud-sync" tabIndex={-1}>
        {account?.account_id ? <CloudSyncControls key={account.account_id} active={active} /> : <p className="text-xs text-muted-foreground">{connected ? '登录后可查看云端同步与待处理内容。' : '请先连接服务器，再登录账户。'}</p>}
      </div>
      {message && <p role={failed ? 'alert' : 'status'} className={`text-xs leading-5 ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>{message}</p>}
    </div>
  </SettingsGroup>;
}
