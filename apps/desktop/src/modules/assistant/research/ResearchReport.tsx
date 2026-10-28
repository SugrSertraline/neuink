import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ChatMessage } from '../components/ChatMessage';
import { NoteRenderedContent } from '../review/NoteDiffLines';
import { useAssistantReading } from '../components/AssistantReplyActionsContext';
import { WorkspaceWebLink } from '@/shared/components/WorkspaceWebLink';
import { ResearchPaperAction } from '../components/ResearchPaperActions';
import { deepResearchCommand, type ResearchTask } from '@/shared/ipc/deepResearchApi';
import type { ConversationMessage } from '@/shared/ipc/assistantApi';
import type { AssistantNoteProposal } from '@/shared/types/assistant';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { ResearchPaper } from '@/shared/ipc/researchApi';

export const engineLabel = (task: ResearchTask) => task.engine === 'deerflow' ? 'DeerFlow' : 'GPT Researcher';
export const evidenceLabel = (level: string) => ({ abstract: '摘要', parsed_text: '已解析正文', selected_text: '选定片段', user_note: '用户笔记' }[level] ?? level);
export function reportMessage(task: ResearchTask): ConversationMessage {
  return { message_id: `research-${task.id}`, role: 'assistant', content: `# ${task.query}\n\n${task.status !== 'completed' ? '> 本次研究尚未完成，以下为已保存的部分内容。\n\n' : ''}${task.report}\n\n---\n\n${engineLabel(task)} ${task.engine_version} · ${task.created_at}\n\n来源链接为上游返回，报告内容尚未逐句人工核验。${task.retriever === 'arxiv' ? '自动 arXiv 检索采用摘要证据。' : ''}\n\n${task.documents.map((d,i) => `- Local ${i+1}：${d.title}（${evidenceLabel(d.evidence_level)}）`).join('\n')}\n\n${task.source_urls.map((url,i) => `- [检索来源 ${i+1}](${url})`).join('\n')}`, source_links: [], created_at: task.created_at };
}
export function ResearchReport({ root, task, entries, onApply }: { root: string; task: ResearchTask; entries: LibraryEntry[]; onApply: (proposal: AssistantNoteProposal) => Promise<AssistantNoteProposal> }) {
  const reading = useAssistantReading();
  const [target, setTarget] = useState(''), [proposal, setProposal] = useState<AssistantNoteProposal | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [papers, setPapers] = useState<ResearchPaper[] | null>(null);
  useEffect(() => { setTarget(''); setProposal(null); setError(null); setPapers(null); }, [task.id, root]);
  const preview = async () => { setBusy(true); setError(null); try { setProposal(await deepResearchCommand(root, { kind: 'preview_note', id: task.id, entry_id: target })); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  const apply = async () => { if (!proposal) return; setBusy(true); setError(null); try { setProposal(await onApply(proposal)); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  const loadPapers = async () => { setBusy(true); setError(null); try { setPapers(await deepResearchCommand(root, { kind: 'papers', id: task.id })); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  return <section className="min-w-0 space-y-3 border-t py-3 text-xs" aria-label="研究报告">
    <div className="flex flex-wrap items-center gap-2"><strong className="mr-auto">{task.stage}</strong>{task.report ? <Button size="xs" variant="outline" onClick={() => reading?.openReply(reportMessage(task))}>在标签页阅读报告</Button> : null}</div>
    <p className="break-words">{task.query}</p><p className="text-muted-foreground">{task.model} · {engineLabel(task)} {task.engine_version} · 上限 {task.timeout_seconds / 60} 分钟 · 费用由模型服务计费，金额未知</p>
    {task.error ? <p role="alert" className="text-destructive">{task.error}</p> : null}
    <details><summary>本次资料范围（已冻结）</summary><ul className="my-2 space-y-1">{task.documents.map((d,i) => <li key={d.id}>Local {i+1} · {d.title} · {evidenceLabel(d.evidence_level)}</li>)}</ul>{!task.documents.length ? <p className="py-2 text-muted-foreground">仅公开检索，没有发送本地资料。</p> : null}</details>
    {task.source_urls.length ? <details><summary>检索来源 {task.source_urls.length} 条</summary><ul className="space-y-2 py-2">{task.source_urls.map((url,i) => <li key={url}><WorkspaceWebLink href={url}>来源 {i+1} · {new URL(url).hostname}</WorkspaceWebLink></li>)}</ul></details> : null}
    {task.report ? <>
      <p className="text-muted-foreground">报告尚未逐句人工核验。{task.retriever === 'arxiv' ? '自动 arXiv 检索使用论文摘要；本地资料的证据级别见上方。' : '请结合引用原文核对关键结论。'}</p>
      <details><summary>预览报告</summary><ChatMessage message={reportMessage(task)} reading streaming={false} onOpenSource={source => reading?.openSource(source)} /></details>
      <div className="flex flex-wrap gap-2"><Select value={target} onValueChange={setTarget}><SelectTrigger aria-label="报告笔记所属条目" className="min-w-0 flex-1"><SelectValue placeholder="选择保存笔记的条目" /></SelectTrigger><SelectContent>{entries.map(e => <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}</SelectContent></Select><Button size="sm" variant="outline" disabled={!target || busy || task.status !== 'completed'} onClick={() => void preview()}>预览保存</Button></div>
      {!entries.length ? <p className="text-muted-foreground">先创建一个条目，即可把报告保存为其笔记。</p> : null}
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => void loadPapers()}>显示可导入的 arXiv 论文</Button>
      {papers?.map(paper => <ResearchPaperAction key={paper.id} paper={paper}><p className="text-muted-foreground">来自报告引用，导入前请核对论文。</p></ResearchPaperAction>)}
      {papers && !papers.length ? <p className="text-muted-foreground">该报告没有可识别的 arXiv 论文链接。</p> : null}
    </> : task.status === 'running' ? <p role="status">研究正在后台运行，切换面板不会重新启动。</p> : null}
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    <Dialog open={Boolean(proposal)} onOpenChange={open => { if (!open && !busy) setProposal(null); }}><DialogContent className="flex max-h-[85vh] max-w-3xl flex-col"><DialogHeader><DialogTitle>{proposal?.status === 'applied' ? '已保存为笔记' : '确认新建报告笔记'}</DialogTitle></DialogHeader><p className="text-xs">所属条目：{proposal?.entryTitle}</p><div className="min-h-0 flex-1 overflow-auto">{proposal ? <NoteRenderedContent text={proposal.markdown} entryId={proposal.entryId} /> : null}</div>{error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}<DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setProposal(null)}>关闭</Button><Button disabled={busy || proposal?.status === 'applied'} onClick={() => void apply()}>{proposal?.status === 'applied' ? '已保存' : busy ? '正在保存…' : '确认保存为新笔记'}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
