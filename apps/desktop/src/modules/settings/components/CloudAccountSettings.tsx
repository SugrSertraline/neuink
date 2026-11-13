import type { SettingsNavigationTarget } from '../settingsCatalog';
import { CloudAdminPasswordReset } from './CloudAdminPasswordReset';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [register, setRegister] = useState(false);
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
    let valid = true;
    void cloudAccount<CloudAccount>({ action: 'status' }).then(value => {
      if (valid) { setAccount(value); setEndpoint(value.endpoint); }
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
    setConnected(false);
    const address = cloudServerAddress(endpoint);
    await cloudAccount({ action: 'connect', endpoint: address });
    await reload();
    if (mounted.current) setConnected(true);
  }, '');
  const submitAccount = () => { if (!connected) return; void run(async () => {
            if (register) { await cloudAccount({ action: 'register', username, password, invite }); setRegister(false); setInvite(''); }
            else { await cloudAccount({ action: 'login', username, password, device_name: 'NeuInk 桌面端' }); await reload(); }
            setPassword('');
          }, register ? '注册成功，请登录。' : ''); };
  return <SettingsGroup id="data-cloud-account" title={account?.account_id ? undefined : !connected ? '连接云端服务器' : register ? "创建账户" : "登录账户"}>
    <CloudAdminPasswordReset navigationTarget={navigationTarget} account={account} onChanged={reload} />
    <div className="max-w-3xl space-y-5 py-3">
      <p className="text-xs leading-5 text-muted-foreground">云端同步请在东北大学校园网环境下开启和使用。请先填写服务器 IP 并验证连接，连接成功后才能登录。未登录也可以阅读和整理本地资料。</p>
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
        <form className="max-w-md space-y-2" onSubmit={event => { event.preventDefault(); if (!busy && account && endpoint.trim()) connect(); }}>
          <label className="block space-y-2 text-xs">服务器 IP 或地址<Input autoComplete="off" placeholder="IP 或 IP:端口" value={endpoint} disabled={busy || !account} onChange={event => { setEndpoint(event.target.value); setConnected(false); setPassword(''); setMessage(''); }} /></label>
          <p className="text-xs text-muted-foreground">仅填写 IP 时使用 HTTPS 和端口 18793；其他端口请填写 IP:端口，也可填写完整 HTTPS 地址。</p>
          <div className="flex flex-wrap items-center gap-2"><Button type="submit" size="sm" variant="outline" disabled={busy || !account || !endpoint.trim()}>{busy && !connected ? '正在连接…' : '连接服务器'}</Button>
          {connected && <p role="status" className="text-xs text-muted-foreground">服务器连接成功，可以登录或注册。</p>}</div>
        </form>
        {connected && <>
        <div className="max-w-sm space-y-4" onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !busy && username.trim() && password) { event.preventDefault(); submitAccount(); } }}>
          <label className="block space-y-2 text-xs">用户名<Input autoComplete="username" value={username} disabled={busy} onChange={e => setUsername(e.target.value)} /></label>
          <label className="block space-y-2 text-xs">密码<Input type="password" autoComplete={register ? 'new-password' : 'current-password'} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
        </div>
        {register && <label className="block space-y-1 text-xs">邀请码（如服务器要求）<Input value={invite} disabled={busy} onChange={e => setInvite(e.target.value)} /><span className="text-muted-foreground">当前内测服务器可留空；其他服务器如要求邀请，请填写管理员提供的邀请码。密码至少 12 个字符，不强制大小写、数字或特殊符号组合；建议使用容易记住的长密码。</span></label>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy || !endpoint.trim() || !username.trim() || !password} onClick={submitAccount}>{busy ? '正在处理…' : register ? '注册账户' : '登录'}</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setRegister(value => !value); setPassword(''); setMessage(''); }}>{register ? '返回登录' : '注册新账户'}</Button>
        </div>
        </>}
      </div>}
      <div data-setting-id="data-cloud-sync" tabIndex={-1}>
        {account?.account_id ? <CloudSyncControls key={account.account_id} active={active} /> : <p className="text-xs text-muted-foreground">{connected ? '登录后可查看云端同步与待处理内容。' : '请先连接服务器，再登录或注册账户。'}</p>}
      </div>
      {message && <p role={failed ? 'alert' : 'status'} className={`text-xs leading-5 ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>{message}</p>}
    </div>
  </SettingsGroup>;
}
