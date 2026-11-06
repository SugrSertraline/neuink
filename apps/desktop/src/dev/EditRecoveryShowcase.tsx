import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ToastProvider } from '@/shared/components/ToastProvider';
import { UnsavedWindowDialog, type UnsavedEditor } from '@/app/UnsavedWindowDialog';
import { useRecoveryCenter } from '@/app/useRecoveryCenter';
import { SegmentNoteEditor } from '@/modules/reader/components/pdf-reader/SegmentNoteEditor';
import { recoveryDraftKey } from '@/shared/lib/editRecovery';
import type { EditRecoveryDraft } from '@/shared/ipc/editRecoveryApi';
import type { SourceSegment } from '@/shared/types/domain';
import { TranslationServiceForm } from '@/modules/settings/components/TranslationServiceForm';
import { EditRecoveryRoot } from '@/shared/hooks/useFormRecovery';
import '../styles/globals.css';

// All native calls are isolated. Only synthetic content is stored in this preview's browser storage.
Object.defineProperty(window, 'isTauri', { value: true, configurable: true });
mockWindows('main');
const params = new URLSearchParams(location.search);
const storage = 'neuink.edit-recovery-showcase.v1';
const service = { provider: 'niutrans' as const, endpoint: 'https://api.niutrans.com/NiuTransServer/translation', model: '', region: '', has_key: false };
if (params.has('reset')) localStorage.removeItem(storage);
let records: EditRecoveryDraft[] = params.has('empty') ? [] : JSON.parse(localStorage.getItem(storage) ?? 'null') ?? [{
  key: recoveryDraftKey('segment-note', 'example', 's1'), kind: 'segment-note', label: '片段笔记 · 第 1 页', ownerId: 'example', targetId: 's1',
  scopeKey: 'segment-records:example', updatedAt: new Date().toISOString(), payload: { text: '这是上次未保存的阅读笔记。\n\n- 保留原文依据\n- 下一步复查实验结论' }
}];
if (params.has('settings')) records = [{ key: recoveryDraftKey('settings', 'settings', 'translation-service-niutrans'), kind: 'settings', label: '小牛翻译 · 翻译配置',
  ownerId: 'settings', targetId: 'translation-sources', scopeKey: 'settings', updatedAt: new Date().toISOString(), secretRef: 'synthetic', payload: { value: { draft: service } } }];
mockIPC(async (command, args) => {
  if (command === 'edit_recovery_secrets') { if (params.has('locked')) throw new Error('示例：凭据库不可用'); return { apiKey: 'synthetic-demo-key' }; }
  if (command === 'test_selection_translation_service') return '隔离演示：翻译验证通过';
  if (command === 'save_translation_service') return { ...service, has_key: true };
  if (command === 'edit_recovery') {
    const { action } = (args as { request: { action: { kind: string; draft: EditRecoveryDraft; key: string } } }).request;
    if (params.has('error') && action.kind !== 'list') throw new Error('示例：磁盘写入失败');
    if (action.kind === 'write') records = [...records.filter(item => item.key !== action.draft.key), action.draft];
    if (action.kind === 'remove') records = records.filter(item => item.key !== action.key);
    localStorage.setItem(storage, JSON.stringify(records));
    return { drafts: records, unreadable: 0 };
  }
  return null;
}, { shouldMockEvents: true });
const segment: SourceSegment = { uid: 's1', page_idx: 0, segment_type: 'paragraph', text: '原文片段示例', markdown: '原文片段示例', bbox: null, continuation_group_id: null };
const pending: UnsavedEditor[] = Array.from({ length: 7 }, (_, i) => ({ scopeKey: `note:${i}`, ownerId: String(i), handler: {
  label: () => i === 0 ? '文档笔记 · 针对复杂制造系统关键事件预测与产品质量研究的长标题示例' : i % 2 ? `片段笔记 · 第 ${i + 1} 页` : `批注 · 第 ${i + 1} 页`,
  save: async () => true, discard: () => {}
} }));
function Preview() {
  const [targets, setTargets] = useState<UnsavedEditor[] | null>(null);
  const [text, setText] = useState('已经正式保存的内容。'), [saved, setSaved] = useState(text);
  const [status, setStatus] = useState('隔离演示：不连接真实资料库');
  const recovery = useRecoveryCenter('recovery-showcase', () => setStatus('已打开：片段笔记 · 第 1 页'));
  return <main className="flex h-screen min-h-0 flex-col bg-background text-foreground" style={{ zoom: Number(params.get('scale') ?? 1) }}>
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2"><span className="min-w-0 flex-1 text-sm">{status}</span>{recovery.button}<Button size="sm" variant="outline" onClick={() => setTargets(pending)}>模拟退出提示</Button></header>
    {params.has('settings') ? <EditRecoveryRoot.Provider value="recovery-showcase"><div className="min-h-0 flex-1 overflow-auto p-4"><TranslationServiceForm initial={service} /></div></EditRecoveryRoot.Provider> :
      <SegmentNoteEditor annotationCount={0} busy={false} dirty={text !== saved} noteText={text} segment={segment} sourceEntryId="example" workspaceRoot="recovery-showcase"
        showCloseButton={false} onClose={() => {}} onModeChange={() => {}} onNoteTextChange={setText} onSave={() => { setSaved(text); return true; }} />}
    <UnsavedWindowDialog targets={targets} busy={false} error={params.has('error') ? '本地草稿备份失败，修改仍保留在编辑器中，请勿强制关闭。' : null}
      onEdit={target => { setStatus(`已定位：${target.handler?.label?.()}`); setTargets(null); }} onCancel={() => setTargets(null)}
      onKeep={() => { setStatus('示例：本地备份成功后退出'); setTargets(null); }} onSave={() => { setStatus('示例：正式保存完成后退出'); setTargets(null); }} />
    {recovery.dialog}
  </main>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<TooltipProvider><ToastProvider><Preview /></ToastProvider></TooltipProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
