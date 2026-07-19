import { Bot, Link2, MessageSquare, MoreHorizontal, Pin, Save } from 'lucide-react';

import type { LibraryEntry } from '../../library/components/LibrarySidebar';

type NotesPaneProps = {
  entry: LibraryEntry | null;
};

export function NotesPane({ entry }: NotesPaneProps) {
  return (
    <aside className="aux">
      <div className="aux-head">
        <span>Neuink 助手</span>
        <button className="btn icon small" title="更多" type="button">
          <MoreHorizontal size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="aux-tabs">
        <button className="active" type="button">
          上下文
        </button>
        <button type="button">来源</button>
        <button type="button">笔记</button>
        <button type="button">任务</button>
      </div>
      <div className="aux-body">
        <div className="scope-box">
          <div className="scope-label">
            上下文模式
            <span className="chip blue">跟随当前标签页</span>
          </div>
          <div className="pill-row">
            <span className="pill">{entry?.title ?? '条目库'}</span>
            <span className="pill">{entry ? statusLabel(entry.status) : '未选择条目'}</span>
          </div>
        </div>

        <div className="scope-box">
          <div className="scope-label">
            写入目标
            <span className={`chip ${entry ? 'green' : 'orange'}`}>{entry ? '可写' : '只读'}</span>
          </div>
          <div className="pill-row">
            <span className={entry ? 'pill write' : 'pill'}>{entry ? '工作笔记' : '请选择条目'}</span>
          </div>
        </div>

        <div className="message ai">
          <Bot size={15} aria-hidden="true" />
          <div>
            <b>来源策略已设为严格。</b>
            <p>解析结果会先成为来源片段，之后笔记、链接或助手回答才能引用它。</p>
          </div>
        </div>

        <div className="source-card">
          <b>{entry?.title ?? '未选择条目'}</b>
          <p>{entry ? `${fieldSummary(entry.fields)} / ${statusLabel(entry.status)}` : '选择条目后查看上下文。'}</p>
        </div>

        <div className="source-link-block">
          <div className="sl-header">
            <span>
              <Link2 size={13} aria-hidden="true" />
              来源链接
            </span>
            <span>预览</span>
          </div>
          <div className="sl-content">当前条目在 MinerU 解析成功后会提供来源片段。</div>
          <div className="sl-note">工作笔记会保留与来源锚点的关联。</div>
        </div>
      </div>
      <div className="composer">
        <textarea placeholder="基于当前条目上下文提问" />
        <div className="compose-actions">
          <button className="btn small" type="button">
            <Pin size={13} aria-hidden="true" />
            自动
          </button>
          <button className="btn small" type="button">
            <Save size={13} aria-hidden="true" />
            建议
          </button>
          <div className="grow" />
          <button className="btn primary small" type="button">
            <MessageSquare size={13} aria-hidden="true" />
            发送
          </button>
        </div>
      </div>
    </aside>
  );
}

function fieldSummary(fields: Record<string, string>) {
  const pairs = Object.entries(fields);
  if (pairs.length === 0) {
    return '无字段';
  }
  return pairs
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' / ');
}

function statusLabel(status: string) {
  if (status === 'Parsed') {
    return '已解析';
  }
  if (status === 'Failed') {
    return '失败';
  }
  if (status === 'Canceled') {
    return '已取消';
  }
  if (status === 'No PDF') {
    return '无 PDF';
  }
  if (status === 'Queued') {
    return '排队中';
  }
  if (status === 'Uploading') {
    return '上传中';
  }
  return '解析中';
}
