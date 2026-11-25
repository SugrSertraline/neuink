import { useCallback, useEffect, useRef, useState } from 'react';
import { displayWorkspacePath } from '@/shared/lib/workspacePath';
import { CloudRebaseline } from './CloudRebaseline';
import { CloudContents } from './CloudContents';
import { CloudSyncConflicts } from './CloudSyncConflicts';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cloudAccount, type CloudBindingPreview, type CloudLibrary, type CloudSyncPreview, type CloudSyncState } from '@/shared/ipc/cloudAccountApi';

export function CloudSyncControls({ active }: { active: boolean }) {
  const [state, setState] = useState<CloudSyncState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [maintenance, setMaintenance] = useState(false);
  const [selected, setSelected] = useState('');
  const [cloudPreview, setCloudPreview] = useState<CloudBindingPreview | null>(null);
  const [preview, setPreview] = useState<CloudSyncPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const generation = useRef(0);
  const currentRoot = useRef<string | null>(null);
  const acceptState = useCallback((value: CloudSyncState) => {
    if (currentRoot.current && currentRoot.current !== value.root) {
      generation.current++;
      setConfirming(false);
      setMaintenance(false);
      setPreview(null);
      setCloudPreview(null);
      setSelected('');
      setBusy(false);
      setControlBusy(false);
      setError('');
    }
    currentRoot.current = value.root;
    setState(value);
  }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);

  async function refresh() {
    const value = await cloudAccount<CloudSyncState>({ action: 'sync_status' });
    if (alive.current) acceptState(value);
    return value;
  }
  useEffect(() => {
    if (!active) return;
    let valid = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await cloudAccount<CloudSyncState>({ action: 'sync_status' });
        if (valid) acceptState(value);
      } catch (reason) {
        if (valid) setError(typeof reason === 'string' ? reason : '无法读取同步状态');
      }
      if (valid) timer = setTimeout(() => void poll(), 1500);
    }
    void poll();
    return () => { valid = false; clearTimeout(timer); };
  }, [active, acceptState]);

  async function run(operation: () => Promise<void>) {
    if (busy) return;
    const owner = generation.current;
    setBusy(true); setError('');
    try { await operation(); }
    catch (reason) { if (reason instanceof DOMException && reason.name === 'AbortError') return; if (alive.current && owner === generation.current) setError(typeof reason === 'string' ? reason : '同步操作未完成，请重试'); }
    finally { if (alive.current && owner === generation.current) setBusy(false); }
  }

  const result = state?.task.result;
  const conflictCount = state?.conflict_count ?? result?.conflicts ?? 0;
  const needsRetry = !!(state?.task.error || state?.schedule?.blocked || result?.failures.length || result?.uploads_blocked);
  return <div id="data-cloud-sync" className="space-y-3 pt-3">
    <p className="text-sm font-medium">当前资料库同步</p>
    {!state ? <p className="text-xs text-muted-foreground">正在读取同步状态…</p> : <>
      <p className="break-all text-xs text-muted-foreground">{displayWorkspacePath(state.root)}</p>
      {!state.binding ? <>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
          setConfirming(true); setPreview(null); setCloudPreview(null);
          const current = await refresh();
          const revision = generation.current;
          const [items, inventory] = await Promise.all([
            cloudAccount<CloudLibrary>({ action: 'default_library' }),
            cloudAccount<CloudSyncPreview>({ action: 'sync_preview', root: current.root }),
          ]);
          const latest = await refresh();
          if (current.root !== latest.root || revision !== generation.current) throw '资料库已切换，请重新预览';
          if (alive.current) { setPreview(inventory); setSelected(items.id); }
          const value = await cloudAccount<CloudBindingPreview>({ action: 'sync_cloud_preview', root: current.root, library_id: items.id });
          if (alive.current && revision === generation.current && currentRoot.current === current.root) setCloudPreview(value);
        })}>开启同步</Button>
        <Dialog open={confirming} onOpenChange={value => { if (!busy) { setConfirming(value); if (!value) { setPreview(null); setCloudPreview(null); } } }}>
          <DialogContent layout="bounded" className="h-auto max-h-[calc(100%-2rem)]"><DialogHeader><DialogTitle>确认开启云端同步</DialogTitle><DialogDescription>请在东北大学校园网环境下开启和使用云端同步。核对当前资料库的同步内容和空间占用，确认后才开启自动同步。</DialogDescription></DialogHeader><DialogBody className="space-y-3">
          {busy && !cloudPreview && <p role="status" className="text-xs">正在核对同步范围与云端空间…</p>}
        {preview && <>
          <p className="text-xs">云端资料库：我的资料库（默认，不可改名）</p>
          <p className="text-xs leading-5">Zotero 等来源缓存不参与论文同步，只有明确导入的本地副本才参与。同步当前资料库中已支持的本地论文、阅读快照、笔记、批注、标签、译文、阅读详略和已确认构思。云端已有内容将下载到本机，同名论文保留各自标识；同时修改的内容可能产生冲突。确认绑定后开启自动同步，可随时暂停。</p>
          <p className="text-xs leading-5">本地已验证 {preview.validated_entities} 个对象，已验证附件去重后 {(preview.validated_attachment_bytes / 1048576).toFixed(1)} MB。该值为本地估算，实际新增占用由服务器去重及历史内容决定。</p>
          {preview.entries.filter(entry => entry.issue).map(entry => <p key={entry.entry_id} className="break-words text-xs text-destructive">{entry.entry_id}：{entry.issue}</p>)}
          {cloudPreview && <div className="space-y-2 text-xs">
            <p>{cloudPreview.entities} 个可同步对象；新增附件 {(cloudPreview.new_attachment_bytes / 1048576).toFixed(2)} MB，云端已有附件 {(cloudPreview.existing_attachment_bytes / 1048576).toFixed(2)} MB。</p>
            <p>正文清单估算 {(cloudPreview.metadata_estimate_bytes / 1048576).toFixed(2)} MB；剩余可用 {(cloudPreview.available_bytes / 1048576).toFixed(2)} MB。正文最终按服务端格式计量，历史版本另计。</p>
            <p>云端有 {cloudPreview.overlapping_objects} 个相同标识的对象，需要比较版本；同名不同标识的论文不会合并。</p>
            {cloudPreview.omitted_scope.map(reason => <p key={reason} className="text-muted-foreground">{reason}</p>)}
            {!!cloudPreview.issues.length && <div className="space-y-1"><p className="font-medium">{cloudPreview.issues.length} 项未就绪内容</p><ul className="space-y-1">{cloudPreview.issues.map(([id, reason]) => <li key={id} className="break-words">{id}：{reason}</li>)}</ul></div>}
          </div>}
          <Button size="sm" disabled={busy || !selected || !cloudPreview} onClick={() => void run(async () => {
            if (!cloudPreview) return;
            await cloudAccount({ action: 'sync_bind', root: state.root, library_id: selected, token: cloudPreview.token });
            setConfirming(false); setPreview(null);
            await refresh();
          })}>确认并开启同步</Button>
        </>}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          </DialogBody></DialogContent>
        </Dialog>
      </> : <>
        <p className="break-all text-xs">已绑定默认云端资料库：我的资料库</p>
        <div className="flex flex-wrap items-center gap-2">
          <CloudContents key={state.root + ':contents'} root={state.root} />
          <Button size="sm" disabled={busy || state.task.running || state.control?.paused} onClick={() => void run(async () => {
            try {
              const task = await cloudAccount<CloudSyncState['task']>({ action: 'sync_run', root: state.root });
              if (task.cancelled) throw new DOMException('已取消本次同步', 'AbortError');
              if (task.error) throw task.error;
              if (!task.result) throw '同步结果缺失，请核对后重试';
              if (task.result.uploads_blocked || task.result.failures.length || task.result.conflicts) throw '同步尚未全部完成，具体原因见下方同步问题。';
            } finally {
              await refresh();
            }
          })}>{state.task.running ? '正在同步…' : needsRetry ? '重试同步' : '立即同步'}</Button>
          <label className="ml-1 flex items-center gap-2 text-xs">
          <Switch aria-label="自动同步" checked={!state.control?.paused} disabled={controlBusy} onCheckedChange={enabled => {
            const owner = generation.current;
            setControlBusy(true);
            setError('');
            void cloudAccount({ action: 'sync_pause', root: state.root, paused: !enabled })
              .then(() => refresh()).catch(reason => { if (alive.current && owner === generation.current) setError(typeof reason === 'string' ? reason : '暂停设置未保存'); })
              .finally(() => { if (alive.current && owner === generation.current) setControlBusy(false); });
          }} />自动同步</label>
          {state.task.running && <Button size="sm" variant="outline" onClick={() => {
            void cloudAccount({ action: 'sync_cancel', root: state.root })
              .catch(reason => setError(typeof reason === 'string' ? reason : '取消未完成'));
          }}>取消本次</Button>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs leading-5 text-muted-foreground">本地变更合并后自动同步，每分钟检查云端。关闭开关会暂停同步并停止本次任务，已完成内容和队列保留。</p>
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setMaintenance(true)}>同步维护</Button>
        </div>
        <Dialog open={maintenance} onOpenChange={setMaintenance}>
          <DialogContent layout="bounded" className="h-auto max-h-[calc(100%-2rem)]">
            <DialogHeader><DialogTitle>同步维护</DialogTitle><DialogDescription>恢复服务器备份或设备长期离线后，可在这里重新核对。日常同步无需使用。</DialogDescription></DialogHeader>
            <DialogBody className="space-y-3 text-sm">
              <p>重新核对会先比较本地与云端，确认后才更新同步基线；不会直接覆盖尚未确认的冲突。</p>
              <CloudRebaseline key={state.root + ':rebaseline'} root={state.root} disabled={state.task.running} onChanged={() => { void refresh().catch(() => setError('状态刷新失败，请重试')); }} />
              {state.task.running && <p className="text-xs text-muted-foreground">请等待当前同步完成，或先取消本次同步。</p>}
            </DialogBody>
          </DialogContent>
        </Dialog>
      </>}
      {state.control?.paused && <p role="status" className="text-xs">自动同步已暂停，重启后仍保持暂停。</p>}
      {state.schedule?.blocked && <p role="status" className="text-xs">自动同步等待处理，请核对账号、配额或错误后重试。</p>}
      {state.schedule?.retry_at && <p role="status" className="text-xs">网络暂不可用，将自动重试。</p>}
      {state.task.cancelled && <p role="status" className="text-xs">本次同步已取消，可以再次同步。</p>}
      {state.task.error && <p role="alert" className="text-xs text-destructive">{state.task.error}</p>}
      {conflictCount > 0 && <p className="text-xs text-destructive">当前有 {conflictCount} 项同步冲突待处理，本地与云端版本均已保留。</p>}
      {state.conflict_error && <p role="alert" className="text-xs text-destructive">冲突状态读取失败：{state.conflict_error}</p>}
      {state.binding && <CloudSyncConflicts key={state.root} root={state.root} showTrigger={conflictCount > 0 || !!state.conflict_error} disabled={state.task.running} onResolved={() => { void refresh().catch(() => setError('状态刷新失败，请重试')); }} />}
      {result && <div role="status" className="space-y-1 text-xs">
        {(result.failures.length > 0 || conflictCount > 0 || result.uploads_blocked) && <h4 className="font-medium">同步问题</h4>}
        {result.failures.some(([, reason]) => reason.includes('依赖尚未就绪')) && <p>依赖未就绪不属于版本冲突。请先确认相关来源条目、解析结果及标签可用，再点击“重试同步”；待同步内容已保留。</p>}
        {!!result.pending && <p>仍有 {result.pending} 项等待后续同步；删除前快照确认后才发布删除。</p>}
        {result.uploads_blocked && <p>配额不足，自动上传已暂停，云端下载继续。释放空间或增加配额后自动恢复，也可点击“重试同步”；本地内容和队列已保留。</p>}
        <p>上次结果 · 已发布 {result.published}，已接收 {result.received}，已落盘 {result.applied}，冲突 {result.conflicts}，失败 {result.failures.length}。</p>
        {result.failures.map(([id, message]) => <p key={id + message} className="break-all text-destructive">{id} · {message}</p>)}
      </div>}
    </>}
    {!confirming && error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
