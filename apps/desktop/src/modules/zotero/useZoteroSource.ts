import { open } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import { discoverZotero, getZoteroSettings, onZoteroSettingsChanged, saveZoteroSettings, type ZoteroSettings } from '@/shared/ipc/zoteroApi';

export function useZoteroSource(active: boolean, onSaved?: () => void) {
  const [settings, setSettings] = useState<ZoteroSettings | null>(null);
  const [candidates, setCandidates] = useState<ZoteroSettings[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const pending = useRef(false);
  const latestSettings = useRef<ZoteroSettings | null>(null);
  const saved = useRef(onSaved); saved.current = onSaved;
  const run = useCallback(async (action: (current: () => boolean) => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    const id = ++generation.current;
    const current = () => id === generation.current;
    setBusy(true); setError(''); setNotice('');
    try { await action(current); }
    catch (e) { if (current()) setError(typeof e === 'string' ? e : 'Zotero 目录操作失败，请重试。'); }
    finally { if (current()) { setBusy(false); pending.current = false; } }
  }, []);
  const reload = useCallback(() => run(async current => {
    let value = await getZoteroSettings();
    if (!value.data_directory) {
      const found = await discoverZotero();
      if (!current()) return;
      if (found.length === 1) value = await saveZoteroSettings(found[0]);
      else {
        setCandidates(found);
        setNotice(found.length ? '发现多个资料库，请选择要导入的目录。' : '未找到本机 Zotero 资料库，请手动选择数据目录。');
      }
    }
    if (current()) {
      const changed = latestSettings.current !== null && JSON.stringify(latestSettings.current) !== JSON.stringify(value);
      latestSettings.current = value; setSettings(value);
      if (changed) saved.current?.();
    }
  }), [run]);
  useEffect(() => {
    if (active) void reload();
    return () => { generation.current += 1; pending.current = false; };
  }, [active, reload]);
  useEffect(() => active ? onZoteroSettingsChanged(() => { void reload(); }) : undefined, [active, reload]);
  const save = async (next: ZoteroSettings, current: () => boolean) => {
    const value = await saveZoteroSettings(next);
    if (current()) {
      const changed = JSON.stringify(latestSettings.current) !== JSON.stringify(value);
      latestSettings.current = value; setSettings(value); setCandidates([]); setNotice('目录已保存');
      if (changed) saved.current?.();
    }
  };
  return {
    settings, candidates, busy, error, notice, reload,
    choose: (linked = false) => run(async current => {
      const path = await open({ directory: true, multiple: false, title: linked ? '选择链接附件基础目录' : '选择 Zotero 数据目录（包含 zotero.sqlite）' });
      if (typeof path !== 'string' || !current()) return;
      await save(linked ? { data_directory: settings?.data_directory ?? null, linked_attachment_directory: path }
        : { data_directory: path, linked_attachment_directory: null }, current);
    }),
    detect: () => run(async current => {
      const found = await discoverZotero();
      if (!current()) return;
      if (found.length === 1) await save(found[0], current);
      else { setCandidates(found); setNotice(found.length ? '发现多个资料库，请选择要导入的目录。' : '未找到资料库，请手动选择包含 zotero.sqlite 的文件夹。'); }
    }),
    selectCandidate: (directory: string) => run(async current => {
      const found = candidates.find(c => c.data_directory === directory);
      if (found) await save(found, current);
    }),
  };
}
