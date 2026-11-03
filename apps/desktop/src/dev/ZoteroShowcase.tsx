import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { Button } from '@/components/ui/button';
import { ZoteroSettingsSection } from '@/modules/settings/components/ZoteroSettingsSection';
import { ZoteroImportDialog } from '@/modules/zotero/ZoteroImportDialog';
import type { ZoteroSettings, ZoteroSnapshot } from '@/shared/ipc/zoteroApi';
import '../styles/globals.css';

// Development-only fixture. The real components run against in-memory IPC;
// this page never opens Zotero, saves preferences, or writes to a workspace.
let settings: ZoteroSettings = { data_directory: 'D:\\研究资料\\Zotero', linked_attachment_directory: null };
let failNext = false;
const snapshot: ZoteroSnapshot = {
  snapshot_id: 'preview', existing: { '0': 'already-local' },
  library: { source_id: 'preview', data_directory: settings.data_directory!, collections: [
    { id: 'diffusion', name: '扩散模型', path: '我的文库 / 机器学习 / 扩散模型', parent_id: null },
  ], papers: Array.from({ length: 58 }, (_, i) => ({
    id: String(i), key: `PAPER${i}`, library_id: 1, library_name: '我的文库',
    title: ['Denoising Diffusion Probabilistic Models', '时间序列预测与因果发现：多模态条件扩散方法的实验比较', 'Digital twin-driven key events and product quality prediction for time-varying manufacturing system'][i % 3] + (i > 2 ? ` (${i + 1})` : ''),
    authors: 'Jonathan Ho; Ajay Jain; Pieter Abbeel', year: '2026', fields: { doi: `10.0000/preview-${i}` },
    tags: ['扩散模型', '时间序列预测'], collection_ids: ['diffusion'],
    attachments: i % 4 === 1 ? [{ key: `PDF${i}`, file_name: '尚未下载的论文.pdf', available: false, reason: '附件未下载或文件已移动' }]
      : [{ key: `PDF${i}`, file_name: '论文原文.pdf', available: true, reason: null }, ...(i === 2 ? [{ key: 'SECOND', file_name: '另一版正文.pdf', available: true, reason: null }] : [])],
  })) },
};

mockIPC(async (command, payload) => {
  if (command === 'plugin:dialog|open') return 'D:\\研究资料\\Zotero';
  if (command !== 'zotero') return null;
  const request = (payload as { request: Record<string, unknown> }).request;
  if (request.action === 'settings') return settings;
  if (request.action === 'discover') return [settings];
  if (request.action === 'save_settings') {
    settings = { data_directory: request.data_directory as string, linked_attachment_directory: request.linked_attachment_directory as string | null };
    await emit('zotero-settings-changed');
    return settings;
  }
  if (request.action === 'scan') {
    if (failNext) { failNext = false; throw '资料库忙碌，请稍后重试。'; }
    return structuredClone(snapshot);
  }
  if (request.action === 'import') {
    await new Promise(resolve => setTimeout(resolve, 600));
    snapshot.existing[String(request.paper_id)] = `local-${request.paper_id}`;
    return { entry_id: `local-${request.paper_id}`, title: '示例论文', status: 'imported', has_pdf: Boolean(request.attachment_key) };
  }
  return null;
}, { shouldMockEvents: true });

function ZoteroShowcase() {
  const [open, setOpen] = useState(false);
  return <main className="h-screen overflow-auto bg-background p-6 text-foreground">
    <div className="mx-auto max-w-4xl space-y-4">
      <p className="text-sm text-muted-foreground">Zotero 开发检查 · 示例资料</p>
      <div className="flex gap-2">
        <Button onClick={() => setOpen(true)}>打开导入窗口</Button>
        <Button variant="outline" onClick={() => { failNext = true; }}>下次读取模拟错误</Button>
      </div>
      <ZoteroSettingsSection workspaceRoot="preview-only" active />
    </div>
    {open && <ZoteroImportDialog root="preview-only" onClose={() => setOpen(false)} onOpenEntry={() => setOpen(false)} />}
  </main>;
}

createRoot(document.getElementById('root')!).render(<ZoteroShowcase />);
