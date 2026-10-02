import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview, type DragDropEvent } from '@tauri-apps/api/webview';
import {
  Archive,
  ChevronDown,
  FileText,
  Loader2,
  Plus,
  Tags,
  Upload,
  X
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
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
  onOpenMineruClientGuide: () => void;
};

export function CreateEntryPanel({
  parserEndpoint,
  tags,
  onCreateEntry,
  onCreateEntryFinished,
  onOpenMineruClientGuide
}: CreateEntryPanelProps) {
  const [pdfPath, setPdfPath] = useState('');
  const [mineruZipPath, setMineruZipPath] = useState('');
  const [creationMode, setCreationMode] = useState<'pdf' | 'mineru'>('pdf');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<EntryFieldDraft[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [selectedTagPaths, setSelectedTagPaths] = useState<string[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(true);
  const [createState, setCreateState] = useState<'idle' | 'ready' | 'creating' | 'failed'>(
    'idle'
  );
  const [pdfDragActive, setPdfDragActive] = useState(false);
  const pdfDropZoneRef = useRef<HTMLElement | null>(null);
  const { dismiss, notify } = useToast();
  const effectiveSelectedTagPaths = useMemo(
    () => normalizeSelectedTagPaths([...selectedTagPaths, ...parseTagInput(tagDraft)]),
    [selectedTagPaths, tagDraft]
  );

  const titleRequired = title.trim().length === 0;
  const pdfName = fileNameFromPath(pdfPath);
  const mineruZipName = fileNameFromPath(mineruZipPath);
  const effectiveParserEndpoint = getEffectiveParserEndpoint(parserEndpoint);
  const activePdfPath = creationMode === 'pdf' ? pdfPath : '';
  const activeMineruZipPath = creationMode === 'mineru' ? mineruZipPath : '';

  const usePdfPath = (nextPdfPath: string) => {
    setPdfPath(nextPdfPath);
    setTitle((current) => current || titleFromFileName(fileNameFromPath(nextPdfPath)));
    setCreateState('ready');
  };

  const handleDroppedPaths = (paths: string[]) => {
    const zip = paths.find((path) => /\.zip$/i.test(path));
    if (zip) {
      setMineruZipPath(zip);
      setPdfPath('');
      setTitle((current) => current || titleFromFileName(fileNameFromPath(zip)));
      setCreateState('ready');
      return;
    }
    if (paths.some((path) => /\.pdf$/i.test(path))) return;
    notify({ title: '无法导入文件', description: '请拖入 MinerU 客户端导出的 ZIP 压缩包。', tone: 'danger' });
  };

  useEffect(() => {
    // PDF drops belong to the app-wide automatic import; only the ZIP source
    // keeps a local drop target that populates this form.
    if (creationMode !== 'mineru') return;
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
  }, [createState, creationMode, notify]);

  const choosePdf = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });

    if (typeof selected === 'string') {
      usePdfPath(selected);
    }
  };

  const chooseMineruZip = async () => {
    const selected = await open({ multiple: false, filters: [{ name: 'MinerU 客户端结果', extensions: ['zip'] }] });
    if (typeof selected === 'string') {
      setMineruZipPath(selected);
      setPdfPath('');
      setTitle((current) => current || titleFromFileName(fileNameFromPath(selected)));
      setCreateState('ready');
    }
  };

  const toggleTagPath = (path: string) => {
    setSelectedTagPaths((selected) => {
      if (selected.includes(path)) {
        return selected.filter((tagPath) => tagPath !== path);
      }

      if (isSiblingTagBlocked(path, selected)) {
        return selected;
      }

      return normalizeSelectedTagPaths([...selected, path]);
    });
  };

  const addTagDraft = () => {
    const nextPaths = parseTagInput(tagDraft);
    if (nextPaths.length === 0) {
      return;
    }
    setSelectedTagPaths((selected) => normalizeSelectedTagPaths([...selected, ...nextPaths]));
    setTagDraft('');
  };

  const resetForm = () => {
    setPdfPath('');
    setMineruZipPath('');
    setTitle('');
    setDescription('');
    setFields([]);
    setTagDraft('');
    setSelectedTagPaths([]);
    setTagPickerOpen(true);
    setCreationMode('pdf');
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
    let pendingToastId: string | null = null;
    try {
      setCreateState('creating');
      pendingToastId = notify({
        title: activeMineruZipPath ? '正在导入 MinerU 客户端结果' : '正在创建条目',
        description: activeMineruZipPath ? '将从压缩包读取 PDF、解析结果和图片资源。' : activePdfPath ? '将根据自动解析设置处理 PDF。' : undefined,
        durationMs: (activePdfPath || activeMineruZipPath) ? Infinity : undefined
      });
      const result = await onCreateEntry({
        pdfPath: activePdfPath || undefined,
        mineruZipPath: activeMineruZipPath || undefined,
        title,
        fields: {
          ...fieldsToRecord(fields),
          ...(description.trim() ? { description: description.trim() } : {})
        },
        tagPaths: effectiveSelectedTagPaths
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
            title: activeMineruZipPath ? '已从 MinerU 客户端创建条目' : result.createdWithPdf ? '条目已创建' : '空条目已创建',
            description: activeMineruZipPath
              ? 'PDF、解析结果和图片资源已保存到本地。'
              : result.createdWithPdf
                ? effectiveParserEndpoint
                  ? '原 PDF 已保存，可直接阅读；解析将按当前设置处理。'
                  : '原 PDF 已保存，可直接阅读；配置解析服务后可再生成结构化内容。'
                : '已添加到全部条目。',
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

  const sourceSummary = activeMineruZipPath
    ? `MinerU · ${mineruZipName}`
    : activePdfPath
      ? `PDF · ${pdfName}`
      : '无附件';
  const submitLabel = activeMineruZipPath
    ? '导入并创建'
    : activePdfPath
      ? '创建并添加 PDF'
      : '创建条目';

  return (
    <div data-guide="create-entry" className="mx-auto h-full w-full max-w-4xl p-3">
      <Card className="h-full min-h-0 gap-0 overflow-hidden py-0">
        <CardHeader className="shrink-0 border-b py-4">
          <CardTitle>创建条目</CardTitle>
          <CardDescription>添加来源、整理标签，然后创建到当前工作区。</CardDescription>
          <CardAction>
            <CreationStateBadge state={createState} />
          </CardAction>
        </CardHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submitEntry(event)}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CardContent className="grid gap-6 py-5">
              <section className="grid content-start gap-5" aria-labelledby="entry-basic-heading">
                <div>
                  <h2 id="entry-basic-heading" className="font-medium">基本信息</h2>
                  <p className="mt-1 text-xs text-muted-foreground">标题为必填，其余内容可以稍后补充。</p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="entry-title">标题 <span className="text-destructive">*</span></Label>
                  <Input
                    id="entry-title"
                    autoFocus
                    disabled={createState === 'creating'}
                    placeholder="输入条目标题"
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setCreateState(event.target.value.trim() ? 'ready' : 'idle');
                    }}
                  />
                </div>

                <div className="grid gap-2">
                  <Label>内容来源</Label>
                  <div aria-label="创建方式" className="grid grid-cols-2 rounded-lg bg-muted p-1" role="tablist">
                    <Button aria-selected={creationMode === 'pdf'} role="tab" size="sm" type="button" variant={creationMode === 'pdf' ? 'secondary' : 'ghost'} onClick={() => setCreationMode('pdf')}>上传 PDF</Button>
                    <Button aria-selected={creationMode === 'mineru'} role="tab" size="sm" type="button" variant={creationMode === 'mineru' ? 'secondary' : 'ghost'} onClick={() => setCreationMode('mineru')}>导入 MinerU 结果</Button>
                  </div>
                </div>

                {creationMode === 'pdf' ? (
                  <div className="grid gap-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch gap-2">
                      <button
                        ref={(node) => { pdfDropZoneRef.current = node; }}
                        aria-label="选择 PDF"
                        className={cn(
                          'flex min-h-24 min-w-0 items-center gap-3 rounded-lg border border-dashed px-4 text-left transition-colors',
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
                        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-background text-primary ring-1 ring-border">
                          {pdfPath ? <FileText size={18} aria-hidden="true" /> : <Upload size={18} aria-hidden="true" />}
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {pdfPath ? pdfName : '选择 PDF'}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {pdfPath
                              ? '点击可重新选择；创建后可直接阅读，解析是可选增强。'
                              : 'PDF 可选；也可直接拖入窗口，按文件名自动创建条目。'}
                          </span>
                        </span>
                      </button>
                      {pdfPath ? (
                        <Button aria-label="移除已选择的 PDF" disabled={createState === 'creating'} size="icon" type="button" variant="outline" onClick={() => setPdfPath('')}>
                          <X size={15} aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                    {pdfPath && !effectiveParserEndpoint ? (
                      <p className="rounded-md border border-info-border bg-info-surface px-3 py-2 text-xs text-info">
                        尚未配置解析服务；仍可创建并直接阅读原 PDF，之后再配置解析。
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div
                    ref={(node) => { pdfDropZoneRef.current = node; }}
                    data-native-file-drop-zone
                    className={cn(
                      'grid gap-3 rounded-lg border border-dashed p-4 text-left transition-colors',
                      pdfDragActive ? 'border-primary bg-primary/10 ring-2 ring-primary/20' : 'bg-muted/20'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-background text-primary ring-1 ring-border">
                        <Archive size={18} aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{mineruZipPath || pdfDragActive ? (pdfDragActive ? '松开后导入 ZIP' : mineruZipName) : 'MinerU 客户端完整结果 ZIP'}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">直接读取 PDF、解析结果和图片，不会重复解析。</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={createState === 'creating'} size="sm" type="button" variant="outline" onClick={() => void chooseMineruZip()}>
                        <Archive size={14} aria-hidden="true" />选择 ZIP
                      </Button>
                      {mineruZipPath ? (
                        <Button disabled={createState === 'creating'} size="sm" type="button" variant="ghost" onClick={() => setMineruZipPath('')}>
                          <X size={14} aria-hidden="true" />移除
                        </Button>
                      ) : null}
                      <Button disabled={createState === 'creating'} size="sm" type="button" variant="ghost" onClick={onOpenMineruClientGuide}>
                        查看教程
                      </Button>
                    </div>
                  </div>
                )}

                <div className="grid gap-2">
                  <Label htmlFor="entry-description">描述</Label>
                  <Textarea
                    id="entry-description"
                    className="min-h-24 resize-y leading-6"
                    disabled={createState === 'creating'}
                    placeholder="记录主题、来源或接下来要做的事情"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </div>
              </section>

              <section className="grid content-start gap-5 border-t pt-5" aria-labelledby="entry-organize-heading">
                <div>
                  <h2 id="entry-organize-heading" className="font-medium">整理信息</h2>
                  <p className="mt-1 text-xs text-muted-foreground">标签和自定义字段都可以在创建后继续编辑。</p>
                </div>

                <div className="grid gap-3 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Tags size={15} className="text-primary" aria-hidden="true" />
                    <Label htmlFor="entry-tags">标签</Label>
                    {effectiveSelectedTagPaths.length > 0 ? (
                      <Badge className="ml-auto" variant="secondary">{effectiveSelectedTagPaths.length}</Badge>
                    ) : null}
                  </div>

                  {selectedTagPaths.length > 0 ? (
                    <div aria-label="已选标签" className="flex flex-wrap gap-1.5">
                      {selectedTagPaths.map((path) => (
                        <Badge className="max-w-full gap-1 py-1 pl-2 pr-1" key={path} variant="secondary">
                          <span className="truncate">{path}</span>
                          <button
                            aria-label={`移除标签 ${path}`}
                            className="grid size-4 shrink-0 place-items-center rounded-full hover:bg-foreground/10"
                            disabled={createState === 'creating'}
                            type="button"
                            onClick={() => setSelectedTagPaths((selected) => selected.filter((item) => item !== path))}
                          >
                            <X size={11} aria-hidden="true" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">尚未添加标签。可以新建路径，也可以从工作区已有标签中选择。</p>
                  )}

                  <div className="flex gap-2">
                    <Input
                      id="entry-tags"
                      disabled={createState === 'creating'}
                      placeholder="例如：研究/HCI"
                      value={tagDraft}
                      onChange={(event) => setTagDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          addTagDraft();
                        }
                      }}
                    />
                    <Button aria-label="添加标签" disabled={createState === 'creating' || parseTagInput(tagDraft).length === 0} size="icon" type="button" variant="outline" onClick={addTagDraft}>
                      <Plus size={15} aria-hidden="true" />
                    </Button>
                  </div>
                  <p className="text-[11px] leading-4 text-muted-foreground">按 Enter 添加；用“/”创建层级，逗号可一次输入多个标签。</p>

                  {tags.length > 0 ? (
                    <div className="grid gap-2 border-t pt-2">
                      <button
                        aria-expanded={tagPickerOpen}
                        className="flex items-center justify-between rounded-md px-1 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        type="button"
                        onClick={() => setTagPickerOpen((open) => !open)}
                      >
                        <span>从已有标签中选择</span>
                        <span className="flex items-center gap-1">{tags.length}<ChevronDown className={cn('transition-transform', tagPickerOpen && 'rotate-180')} size={13} aria-hidden="true" /></span>
                      </button>
                      {tagPickerOpen ? (
                        <div className="grid gap-2">
                          <p className="text-[11px] text-muted-foreground">沿引导线查看父子层级，点击名称即可选择。</p>
                          <TagQuickPicker
                            disabled={createState === 'creating'}
                            selectedPaths={selectedTagPaths}
                            tags={tags}
                            onTogglePath={toggleTagPath}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="border-t pt-5">
                  <EntryFieldsEditor
                    disabled={createState === 'creating'}
                    fields={fields}
                    onFieldsChange={setFields}
                  />
                </div>
              </section>
            </CardContent>
          </div>

          <CardFooter aria-label="创建操作" className="shrink-0 justify-between gap-3 bg-card/95 py-3 shadow-[0_-8px_24px_-20px_rgba(15,23,42,0.65)] backdrop-blur">
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-xs font-medium">{sourceSummary}</p>
              <p className="text-[11px] text-muted-foreground">{effectiveSelectedTagPaths.length > 0 ? `${effectiveSelectedTagPaths.length} 个标签` : '未添加标签'}</p>
            </div>
            <div className="ml-auto flex gap-2">
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
                {submitLabel}
              </Button>
            </div>
          </CardFooter>
        </form>
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
  return fileName.replace(/\.(pdf|zip)$/i, '').trim();
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
