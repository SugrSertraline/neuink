import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { OnboardingGuide } from '@/modules/onboarding/OnboardingGuide';
import { OnboardingSettings } from '@/modules/onboarding/OnboardingSettings';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ToastProvider } from '@/shared/components/ToastProvider';
import { MineruClientImportGuide } from '@/modules/reader/components/MineruClientImportGuide';
import type { GuideRoute } from '@/modules/onboarding/catalog';
import type { EntryMeta } from '@/shared/types/domain';
import { surfaceKey, type WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import '../styles/globals.css';

// Visual fixture only: guide is real; paper, parsing and model calls remain in memory.
function Showcase() {
  const [route, setRoute] = useState<GuideRoute>('library');
  const [entries, setEntries] = useState<EntryMeta[]>([]);
  const [translated, setTranslated] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [layout, setLayout] = useState<WorkspaceSurfaceLayout>({ left:{ kind:'library' }, right:null, focusedPane:'left', leftTabs:[{ kind:'library' }], rightTabs:[] });
  const change = (next:GuideRoute) => {
    setRoute(next);
    if (next === 'pdf' || next === 'assistant') setLayout(value => ({ ...value, left:{ kind:'pdf', entryId:'sample' } }));
  };
  return <div className="h-screen bg-background text-foreground text-[13px]">
    <div data-guide="tabs" className="flex h-10 items-center gap-2 border-b px-3">
      <span>引导检查 · 所有数据仅在本页内存</span>
      <span data-workspace-surface-key="pdf:sample" data-workspace-surface-active="true" className="workspace-surface-tab is-active rounded border px-2 py-1">Attention Is All You Need · PDF</span>
      <Button size="sm" variant="outline" onClick={() => setLayout(value => ({ ...value, right:{ kind:'pdf', entryId:'sample', viewId:'copy' } }))}>复制到另一分栏</Button>
    </div>
    <div className="flex h-[calc(100%-40px)]">
      <nav className="activitybar flex w-24 shrink-0 flex-col gap-2 border-r p-2">{(['library','details','search','assistant','tag-reading','settings'] as GuideRoute[]).map(item => { const label = ({ library:'条目库', details:'条目详情', search:'搜索', assistant:'助手', 'tag-reading':'标签阅读', settings:'设置' } as Record<string,string>)[item]; return <Button key={item} aria-label={label} variant="ghost" size="sm" onClick={() => change(item)}>{label}</Button>; })}</nav>
      <aside className="app-sidebar shrink-0 border-r p-3" style={{ display:'block', width:256 }}>
        <p className="mb-3">{entries[0]?.title ?? '尚未导入论文'}</p>
        <Button size="sm" variant="outline" onClick={() => change('pdf')}>打开 PDF</Button>
        <div className="mt-5"><OnboardingSettings storageKey="neuink.onboarding.showcase.v1" /></div>
      </aside>
      <main data-guide="reader-workspace" data-workspace-surface-key={surfaceKey(layout.left)} data-workspace-surface-active="true" className="min-w-0 flex-1 overflow-auto p-4">
        {route === 'mineru-guide' ? <div data-guide="mineru-tutorial" role="region" aria-label="MinerU 客户端导入教程" tabIndex={0}
          className="h-full overflow-y-auto overscroll-contain"><MineruClientImportGuide /></div> : <>
        <h1 className="mb-4 text-base">当前检查区域：{route}</h1>
        {route === 'create' ? <div data-guide="create-entry" className="border p-4">创建条目 · 引导自动准备内存示例，演示不会下载真实文件。</div> : null}
        <div className="settings-viewport" data-setting-id="parser-service"><p data-setting-id="parser-zip">解析与模型配置区域 · 演示无真实请求</p></div>
        <div data-guide="pdf-tools" className="my-4 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setEntries(value => value.map(entry => ({ ...entry, pdf:{ ...entry.pdf!, parse:{ ...entry.pdf!.parse, status:'succeeded' } } })))}>模拟解析完成</Button>
          <Button size="sm" variant="outline" aria-label="翻译任务" onClick={() => setDialog(true)}>翻译任务</Button>
          <Button size="sm" variant="outline" data-guide="translated-mode" aria-pressed={translated} onClick={() => setTranslated(!translated)}>{translated ? '译文' : '原文'}</Button>
        </div>
        <div data-pdf-page-surface data-guide="pdf-page" className="relative min-h-[900px] border bg-white p-8 text-foreground">
          <div><h2 className="text-base">Attention Is All You Need</h2>
            <p className="pdf-text-layer mt-6" style={{ lineHeight:1.75 }}><span style={{ position:'static', color:'var(--foreground)', fontSize:13, whiteSpace:'normal' }}>在这里拖选文字，检查教程的选区示意与操作穿透。此页仅验证遮罩定位和进度，不代替真实论文阅读。</span></p>
          </div>
          <div data-segment-uid="sample-p1" title="段落 · 第 1 页" className="pointer-events-none absolute top-16 right-8 left-8 h-16" />
        </div>
        <div data-assistant-context-dropzone className="mt-4 border p-3"><Button data-guide="context-picker" size="sm" variant="outline">选择元素</Button><Button data-guide="assistant-send" size="sm">发送（仅演示）</Button></div>
        </>}
      </main>
    </div>
    <OnboardingGuide storageKey="neuink.onboarding.showcase.v1" root="showcase" ready entries={entries} selectedEntryId={entries[0]?.id ?? null} layout={layout} onRoute={change}
      onImportSample={async () => { const timestamp = '2026-10-01T00:00:00Z'; setEntries(value => value.length ? value : [{ id:'sample', title:'Attention Is All You Need（演示版）', fields:{ tutorial_demo:'attention-v1' }, tags:[], contents:[], created_at:timestamp, updated_at:timestamp,
        pdf:{ file_name:'paper.pdf', content_hash:'fixture-hash', imported_at:timestamp, parse:{ status:'succeeded', updated_at:timestamp, message:null, task_id:null, endpoint:null } } }]); return 'sample'; }} />
    <Dialog open={dialog} onOpenChange={setDialog}><DialogContent data-guide="translation-task"><DialogTitle>翻译任务检查</DialogTitle><p>关闭此面板后，教程应恢复，并检测到本步操作。</p><Button onClick={() => setDialog(false)}>关闭面板</Button></DialogContent></Dialog>
  </div>;
}
const showcaseRoot = createRoot(document.getElementById('root')!);
showcaseRoot.render(<ToastProvider><Showcase /></ToastProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => showcaseRoot.unmount());
