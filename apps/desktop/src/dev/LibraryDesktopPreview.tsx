import { useState, type ReactNode } from 'react';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { ListFilter, MessageSquare, PanelLeft, Search, Settings } from 'lucide-react';
import { WorkspaceTabsBar } from '@/app/WorkspaceTabsBar';
import { initialWorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import { AssistantPanel } from '@/modules/assistant/components/AssistantPanel';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { TagMeta } from '@/shared/types/domain';

const noop = () => undefined;
const asyncNoop = async () => undefined;
const context = { items: [] };
const surface = { capturedAt: '', entryId: null, kind: 'library' as const, noteId: null, pane: 'left' as const, segmentUid: null, surfaceKey: 'library' };

// DEV entry point only. Full-window material checks must not touch a workspace or an LLM.
mockWindows('main');
mockIPC(async command => {
  if (command === 'plugin:window|is_maximized') return false;
  if (command === 'get_llm_settings') return { profiles: [], assistant_profile_id: null, assistant_profile: null, translation_profile_id: null, translation_profile: null };
  if (command === 'list_conversations' || command === 'list_agent_runs') return [];
}, { shouldMockEvents: true });

/** The real sidebar, tabs and library retain their own scroll/focus owners; no fake glass samples. */
export function LibraryDesktopPreview({ enabled, children, entries, tags, onOpenSearch }: {
  enabled: boolean; children: ReactNode; entries: LibraryEntry[]; tags: TagMeta[]; onOpenSearch: () => void;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  if (!enabled) return <>{children}</>;
  return <div className={`app-shell ${sidebarOpen ? '' : 'is-sidebar-collapsed'}`}>
    <WorkspaceTabsBar entries={entries} layout={initialWorkspaceSurfaceLayout}
      onClose={noop} onCloseOthers={noop} onClosePane={noop} onMove={noop} onSelect={noop} onSwap={noop} />
    <nav className="activitybar" aria-label="主导航">
      <button aria-label="切换侧栏" onClick={() => setSidebarOpen(value => !value)}><PanelLeft size={18} /></button>
      <button aria-label="搜索" onClick={onOpenSearch}><Search size={18} /></button>
      <button aria-label="助手" className={sidebarOpen ? 'active' : ''} onClick={() => setSidebarOpen(value => !value)}><MessageSquare size={18} /></button>
      <button aria-label="标签阅读" disabled><ListFilter size={18} /></button>
      <div className="spacer" />
      <button aria-label="设置（预览）" disabled><Settings size={18} /></button>
    </nav>
    {sidebarOpen && <AssistantPanel root="library-desktop-preview" status="ready" activeEntry={null} activeTag={null} activeNote={null} activeSegment={null}
      assistantContext={context} activeSurface={surface} composerDraft={null} draftQuestion={null} entries={entries} tags={tags}
      onClearAssistantContext={noop} onComposerDraftChange={noop} onCreateAssistantEntry={async () => entries[0]}
      onApplyNoteProposal={async proposal => proposal} onApplyEntryMetaProposal={asyncNoop} onApplyTagProposal={asyncNoop}
      onAddAssistantContext={noop} onDraftQuestionConsumed={noop} onExportConversation={asyncNoop} onOpenSettings={noop} onOpenSource={noop}
      onAddSciverseSource={async () => { throw new Error('预览不导入论文'); }} onReplaceAssistantContext={noop} onRemoveAssistantContextItem={noop} />}
    <div className="app-editor">{children}</div>
  </div>;
}
