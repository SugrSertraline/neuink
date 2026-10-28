import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { useAssistantContextState } from '@/app/useAssistantContextState';
import { AssistantComposerEditor, type AssistantComposerDraft } from '@/modules/assistant/components/AssistantComposerEditor';
import { ActivityNavigation } from '@/app/ActivityNavigation';
import type { SidePanel } from '@/app/activityBarState';
import type { WorkspaceSurface } from '@/app/workspaceSurface';
import { AppearanceProvider } from '@/shared/components/AppearanceProvider';
import { ToastProvider } from '@/shared/components/ToastProvider';
import { WorkspaceNotesProvider } from '@/modules/notes/WorkspaceNotesContext';
import { DailyProvider } from '@/modules/daily/DailyContext';
import { DailySidebar } from '@/modules/daily/DailySidebar';
import { DailyDashboardView } from '@/modules/daily/DailyDashboard';
import { ResearchPaperActionsProvider } from '@/modules/assistant/components/ResearchPaperActions';
import { AssistantPanel } from '@/modules/assistant/components/AssistantPanel';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { fixture, installDailyFixture } from './dailyFixture';
import '../styles/globals.css';

installDailyFixture();
const entries = [{id:'example',title:'示例论文 · Diffusion Models for Time Series',tagIds:[],tags:[],contents:[],fields:{}}] as unknown as LibraryEntry[];
const profiles = [{id:'example',name:'已配置模型',model:'OpenAI compatible',api_protocol:'openai_compatible'}] as LlmProfile[];
function ResearchPreview() {
  const { assistantContext, replaceAssistantContext } = useAssistantContextState();
  const [draft, setDraft] = useState<AssistantComposerDraft | null>(null);
  return <AssistantPanel root="fixture-only" researchOpenRequest={1} activeEntry={null} activeTag={null}
    assistantContext={assistantContext} composerDraft={draft} activeNote={null} activeSegment={null}
    activeSurface={{ kind: 'library', entryId: null, noteId: null, pane: 'left', segmentUid: null, surfaceKey: 'library', capturedAt: new Date().toISOString() }} draftQuestion={null} entries={entries} tags={[]} status="ready"
    onClearAssistantContext={() => replaceAssistantContext([])} onComposerDraftChange={setDraft}
    onCreateAssistantEntry={async () => entries[0]} onApplyNoteProposal={async p => p} onApplyEntryMetaProposal={async () => {}}
    onApplyTagProposal={async () => {}} onAddAssistantContext={() => {}} onDraftQuestionConsumed={() => {}}
    onExportConversation={async () => {}} onOpenSettings={() => {}} onOpenSource={() => {}}
    onAddSciverseSource={async () => { throw new Error('隔离展示不执行导入'); }}
    onReplaceAssistantContext={replaceAssistantContext} onRemoveAssistantContextItem={() => {}} />;
}
function Showcase() {
  const [research,setResearch]=useState(false),[narrow,setNarrow]=useState(false),[failed,setFailed]=useState(false),[notice,setNotice]=useState('');
  const [page, setPage] = useState<WorkspaceSurface['kind']>('daily-dashboard'), [panel, setPanel] = useState<SidePanel | null>('daily-dashboard');
  const { assistantContext, replaceAssistantContext } = useAssistantContextState();
  const [draft, setDraft] = useState<AssistantComposerDraft | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const openPage = (next: 'daily-dashboard' | 'library' | 'settings') => { setPage(next); if (next !== 'settings') setPanel(next); };
  return <AppearanceProvider><ToastProvider><TooltipProvider><ResearchPaperActionsProvider root="fixture-only"><WorkspaceNotesProvider root="fixture-only" refreshKey="fixture"><DailyProvider root="fixture-only" openNote={target=>setNotice(`完整笔记入口：${JSON.stringify(target.owner)}（此检查页只验证组件）`)}>
    <div className="flex h-screen flex-col bg-background text-foreground"><div className="flex shrink-0 flex-wrap gap-2 border-b p-2"><span className="mr-auto text-xs">隔离示例 · 不读写真实资料</span><Button size="sm" variant="outline" onClick={()=>setResearch(v=>!v)}>{research?'返回每日推荐':'Research 界面'}</Button><Button size="sm" variant="outline" onClick={()=>setModelReady(v=>!v)}>切换模型就绪</Button><Button size="sm" variant="outline" onClick={()=>setQuestion('检查隐藏输入框的草稿同步')}>恢复对话草稿</Button><Button size="sm" variant="outline" onClick={()=>setNarrow(v=>!v)}>切换窄宽度</Button><Button size="sm" variant="outline" onClick={()=>{fixture.fail=!failed;setFailed(!failed);}}>{failed?'恢复读写':'模拟失败'}</Button><Button size="sm" variant="outline" onClick={()=>{document.documentElement.style.zoom=document.documentElement.style.zoom==='1.25'?'1':'1.25';}}>125% 缩放</Button></div>
      {notice?<p role="status" className="border-b p-2 text-xs">{notice}</p>:null}
      <div className="flex min-h-0 flex-1"><ActivityNavigation focusedKind={page} activePanel={panel} noteDetails={false} onOpenPage={openPage} onOpenRight={openPage} onSelectTool={setPanel} /><div className="flex min-h-0 shrink-0 flex-col border-r bg-card" style={{width:narrow?260:330}}>{research?<ResearchPreview />:<><div className={panel === 'daily-dashboard' ? 'contents' : 'hidden'}><DailySidebar active={panel === 'daily-dashboard'} entries={entries} onOpenEntry={()=>setNotice('打开真实论文入口（隔离页）')} onOpenRecommendations={()=>document.getElementById('daily-recommendations')?.scrollIntoView()} onReflect={()=>setPanel('assistant')} onSettings={()=>setNotice('助手模型设置入口')} /></div><div className={panel === 'assistant' ? 'flex min-h-0 flex-1 flex-col gap-3 p-3' : 'hidden'}>
        <h2 className="text-sm font-semibold">助手</h2><p className="text-xs text-muted-foreground">真实对话输入框 · 不发送请求</p>
        <AssistantComposerEditor composerDraft={draft} contextItems={assistantContext.items} disabled={!modelReady}
          draftQuestion={question} entries={entries} tags={[]} resetKey={0} onSubmit={()=>{}}
          onDraftQuestionConsumed={()=>setQuestion(null)} onChange={(snapshot, items, document)=>{
            setDraft({snapshot, document}); replaceAssistantContext(items);
          }} />
      </div>{panel !== 'daily-dashboard' && panel !== 'assistant' ? <p className="p-3 text-xs">导航检查占位 · {panel}</p> : null}</>}</div><div className="min-h-0 min-w-0 flex-1"><DailyDashboardView entries={entries} states={{}} loading={false} error={null} onRetry={()=>{}} onOpenLibrary={()=>setNotice('条目库入口')} onOpenEntry={()=>{}}/></div></div>
    </div>
  </DailyProvider></WorkspaceNotesProvider></ResearchPaperActionsProvider></TooltipProvider></ToastProvider></AppearanceProvider>;
}
createRoot(document.getElementById('root')!).render(<Showcase/>);
