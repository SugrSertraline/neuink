import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview, type DragDropEvent } from '@tauri-apps/api/webview';
import { Loader2, Upload, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useToast } from '@/shared/hooks/useToast';
import type { CreateEntryRequest, CreateEntryResult } from '@/shared/hooks/useWorkspace';
import { getEffectiveParserEndpoint } from '@/shared/lib/parserSettings';
import type { TagMeta } from '@/shared/types/domain';

import {
  EntryFieldsEditor,
  type EntryFieldDraft
} from '../../library/components/EntryFieldsEditor';
import { TagQuickPicker } from '../../library/components/TagQuickPicker';
import {
  isSiblingTagBlocked,
  normalizeSelectedTagPaths,
  parseTagInput
} from '../../library/utils/tagSelection';

type CreateEntryPanelProps = {
  parserEndpoint: string;
  tags: TagMeta[];
  onCreateEntry: (request: CreateEntryRequest) => Promise<CreateEntryResult | undefined>;
  onCreateEntryFinished: (result: CreateEntryResult) => void;
};

export function CreateEntryPanel({
  parserEndpoint,
  tags,
  onCreateEntry,
  onCreateEntryFinished
}: CreateEntryPanelProps) {
  const [pdfPath, setPdfPath] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<EntryFieldDraft[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [createState, setCreateState] = useState<'idle' | 'ready' | 'creating' | 'failed'>(
    'idle'
  );
  const [pdfDragActive, setPdfDragActive] = useState(false);
  const pdfDropZoneRef = useRef<HTMLButtonElement | null>(null);
  const { dismiss, notify } = useToast();
  const selectedTagPaths = useMemo(
    () => normalizeSelectedTagPaths(parseTagInput(tagInput)),
    [tagInput]
  );

  const titleRequired = title.trim().length === 0;
  const pdfName = fileNameFromPath(pdfPath);
  const effectiveParserEndpoint = getEffectiveParserEndpoint(parserEndpoint);

  const usePdfPath = (nextPdfPath: string) => {
    setPdfPath(nextPdfPath);
    setTitle((current) => current || titleFromFileName(fileNameFromPath(nextPdfPath)));
    setCreateState('ready');
  };

  const handleDroppedPaths = (paths: string[]) => {
    const pdf = paths.find((path) => /\.pdf$/i.test(path));
    if (!pdf) {
      notify({
        title: '无法添加文件',
        description: '请拖入 PDF 文件。',
        tone: 'danger'
      });
      return;
    }
    usePdfPath(pdf);
  };

  useEffect(() => {
    let cancelled = false;
    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (cancelled || createState === 'creating') {
        return;
      }

      const payload = event.payload;
      if (payload.type === 'leave') {
        setPdfDragActive(false);
        return;
      }

      if (payload.type === 'enter' || payload.type === 'over') {
        setPdfDragActive(isDragPositionInsideDropZone(payload.position, pdfDropZoneRef.current));
        return;
      }

      if (payload.type === 'drop') {
        const inside = isDragPositionInsideDropZone(payload.position, pdfDropZoneRef.current);
        setPdfDragActive(false);
        if (inside) {
          handleDroppedPaths(payload.paths);
        }
      }
    });

    return () => {
      cancelled = true;
      setPdfDragActive(false);
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [createState, notify]);

  const choosePdf = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });

    if (typeof selected === 'string') {
      usePdfPath(selected);
    }
  };

  const toggleTagPath = (path: string) => {
    const selected = normalizeSelectedTagPaths(parseTagInput(tagInput));

    if (selected.includes(path)) {
      setTagInput(selected.filter((tagPath) => tagPath !== path).join(', '));
      return;
    }

    if (isSiblingTagBlocked(path, selected)) {
      return;
    }

    setTagInput(normalizeSelectedTagPaths([...selected, path]).join(', '));
  };

  const resetForm = () => {
    setPdfPath('');
    setTitle('');
    setDescription('');
    setFields([]);
    setTagInput('');
    setCreateState('idle');
  };

  const submitEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createState === 'creating') {
      return;
    }
    if (titleRequired) {
      setCreateState('failed');
      notify({
        title: '创建条目失败',
        description: '标题不能为空。',
        tone: 'danger',
        durationMs: Infinity
      });
      return;
    }
    if (pdfPath && !effectiveParserEndpoint) {
      setCreateState('failed');
      notify({
        title: '解析服务未配置',
        description: '请先到全局设置填写 URL 和 API Key。',
        tone: 'danger',
        durationMs: Infinity
      });
      return;
    }

    let pendingToastId: string | null = null;
    try {
      setCreateState('creating');
      pendingToastId = notify({
        title: pdfPath ? '正在提交解析任务' : '正在创建条目',
        description: pdfPath ? '条目创建后会提交到解析服务。' : undefined,
        durationMs: pdfPath ? Infinity : undefined
      });
      const result = await onCreateEntry({
        pdfPath: pdfPath || undefined,
        title,
        fields: {
          ...fieldsToRecord(fields),
          ...(description.trim() ? { description: description.trim() } : {})
        },
        tagPaths: selectedTagPaths
      });
      if (result) {
        if (pendingToastId) {
          dismiss(pendingToastId);
          pendingToastId = null;
        }
        if (result.parseSubmissionFailed && result.parseMessage) {
          setCreateState('failed');
          notify({
            title: '解析任务提交失败',
            description: result.parseMessage,
            tone: 'danger',
            durationMs: Infinity
          });
        } else {
          setCreateState('ready');
          notify({
            title: result.createdWithPdf ? '条目已创建' : '空条目已创建',
            description: result.createdWithPdf ? '解析任务已提交。' : '已添加到全部条目。',
            tone: 'success'
          });
        }
        onCreateEntryFinished(result);
      }
    } catch (caught) {
      if (pendingToastId) {
        dismiss(pendingToastId);
      }
      setCreateState('failed');
      notify({
        title: '创建条目失败',
        description: caught instanceof Error ? caught.message : String(caught),
        tone: 'danger',
        durationMs: Infinity
      });
    }
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-3 px-3 py-3 pb-6">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>创建条目</CardTitle>
          <CardAction>
            <CreationStateBadge state={createState} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5" onSubmit={(event) => void submitEntry(event)}>
            <div className="grid gap-2">
              <Label htmlFor="entry-title">标题</Label>
              <Input
                id="entry-title"
                disabled={createState === 'creating'}
                placeholder="条目标题"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setCreateState(event.target.value.trim() ? 'ready' : 'idle');
                }}
              />
            </div>

            <div className="grid gap-2">
              <Label>PDF 文件</Label>
              <button
                ref={pdfDropZoneRef}
                className={cn(
                  'flex min-h-20 items-center gap-3 rounded-lg border border-dashed px-4 text-left transition-colors',
                  pdfDragActive
                    ? 'border-primary bg-primary/10 text-foreground ring-2 ring-primary/20'
                    : pdfPath
                    ? 'border-primary/35 bg-accent text-accent-foreground'
                    : 'bg-muted/40 hover:bg-accent'
                )}
                disabled={createState === 'creating'}
                type="button"
                onClick={() => void choosePdf()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => event.preventDefault()}
              >
                <div className="grid size-10 place-items-center rounded-lg bg-white text-primary ring-1 ring-border">
                  <Upload size={18} aria-hidden="true" />
                </div>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {pdfPath ? pdfName : '选择 PDF 文件'}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {pdfDragActive
                      ? '松开后添加这个 PDF。'
                      : pdfPath
                      ? '创建后会自动开始解析。'
                      : '可选；点击选择，或从外部拖入 PDF。'}
                  </span>
                </span>
              </button>
              {pdfPath ? (
                <Button
                  className="w-fit"
                  disabled={createState === 'creating'}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => setPdfPath('')}
                >
                  <X size={14} aria-hidden="true" />
                  移除 PDF
                </Button>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="entry-description">描述</Label>
              <Textarea
                id="entry-description"
                className="min-h-20 resize-y leading-6"
                disabled={createState === 'creating'}
                placeholder="记录这个条目的主题、来源或用途"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <EntryFieldsEditor
              disabled={createState === 'creating'}
              fields={fields}
              onFieldsChange={setFields}
            />

            <div className="grid gap-2">
              <Label htmlFor="entry-tags">标签</Label>
              <Input
                id="entry-tags"
                disabled={createState === 'creating'}
                placeholder="研究/计算机视觉, 会议/CVPR2026"
                value={tagInput}
                onChange={(event) =>
                  setTagInput(
                    normalizeSelectedTagPaths(parseTagInput(event.target.value)).join(', ')
                  )
                }
              />
              <TagQuickPicker
                disabled={createState === 'creating'}
                selectedPaths={selectedTagPaths}
                tags={tags}
                onTogglePath={toggleTagPath}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                disabled={createState === 'creating'}
                type="button"
                variant="outline"
                onClick={resetForm}
              >
                清空
              </Button>
              <Button disabled={titleRequired || createState === 'creating'} type="submit">
                {createState === 'creating' ? (
                  <Loader2 className="animate-spin" size={15} />
                ) : null}
                {pdfPath ? '创建并解析' : '创建条目'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function CreationStateBadge({
  state
}: {
  state: 'idle' | 'ready' | 'creating' | 'failed';
}) {
  if (state === 'creating') {
    return <Badge className="bg-blue-100 text-blue-700 ring-1 ring-blue-200">创建中</Badge>;
  }
  if (state === 'failed') {
    return <Badge variant="destructive">失败</Badge>;
  }
  if (state === 'ready') {
    return <Badge variant="secondary">可创建</Badge>;
  }
  return <Badge variant="outline">未创建</Badge>;
}

export function fieldsToRecord(fields: EntryFieldDraft[]) {
  return Object.fromEntries(
    fields
      .map((field) => [field.key.trim(), field.value.trim()])
      .filter(
        ([key, value]) =>
          key.length > 0 &&
          value.length > 0 &&
          !['title', 'description'].includes(key.toLowerCase())
      )
  );
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).pop() ?? '';
}

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.pdf$/i, '').trim();
}

function isDragPositionInsideDropZone(
  position: { x: number; y: number },
  element: HTMLElement | null
) {
  if (!element) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const x = position.x / scale;
  const y = position.y / scale;

  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
