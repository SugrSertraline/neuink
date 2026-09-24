import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';
import { Button } from '@/components/ui/button';
import { UserInputPanel } from '@/modules/assistant/components/UserInputPanel';
import { ChatMessage } from '@/modules/assistant/components/ChatMessage';
import { requestUserInput } from '@/modules/assistant/runtime/userInput';
import type { ConversationMessage } from '@/shared/ipc/assistantApi';

// Isolated fixtures. No model calls, workspace reads or document writes.
function Showcase() {
  const [width, setWidth] = useState(320), [scale, setScale] = useState(1), [status, setStatus] = useState('未提交');
  useEffect(() => {
    const abort = new AbortController();
    void requestUserInput('fixture', 'chat')({ title: '阅读笔记的范围与结构', toolCallId: 'demo', sources: [],
      previewMarkdown: '# WireWay 阅读笔记（结构预览）\n\n## 研究问题\n\n整理论文要解决的问题。\n\n## 方法与系统\n\n- 系统设计\n- 实验方法\n\n## 局限与个人思考\n\n此处仅为结构示例，尚未创建笔记。',
      questions: [{ id: 'scope', title: '这次整理哪些论文？', multiple: true, options: [
        { id: 'wireway', label: '2603.05085v1（WireWay）', description: '只读当前论文，保留来源引用。' },
        { id: 'other', label: '2404.08743v2 和 Automatic Generation of Logical Specifications…' }
      ] }, { id: 'output', title: '希望怎样输出？', multiple: false, options: [
        { id: 'note', label: '先生成可审阅的 Markdown 笔记' }, { id: 'chat', label: '仅在对话中整理' }
      ] }] }, abort.signal).then(() => setStatus('已提交测试选择；没有调用模型或写入笔记。')).catch(() => setStatus('已取消'));
    return () => abort.abort();
  }, []);
  useEffect(() => { document.documentElement.style.zoom = String(scale); return () => { document.documentElement.style.zoom = ''; }; }, [scale]);
  return <main className="min-h-screen bg-background p-4 text-foreground">
    <div className="mb-4 flex gap-2">{[220, 320, 440].map(value => <Button key={value} size="sm" onClick={() => setWidth(value)}>{value}px</Button>)}
      <Button size="sm" onClick={() => setScale(scale === 1 ? 1.25 : 1)}>{scale === 1 ? '125%' : '100%'}</Button></div>
    <div className="min-w-0" style={{ width }}>
      <ChatMessage message={{ message_id: 'demo', role: 'assistant', content: '**请问**：\n\n1. 这篇 WireWay 是否是要整理的论文？\n2. 上面的结构是否合适？', source_links: [], created_at: '' } as ConversationMessage}
        streaming={false} onOpenSource={() => {}} />
      <UserInputPanel root="fixture" conversationId="chat" onOpen={() => {}} onOpenSource={() => {}} />
    </div><p role="status">{status}</p>
  </main>;
}
const root = createRoot(document.getElementById('root')!); root.render(<Showcase />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
