import { useEffect, useState } from 'react';
import {
  getTextModelSettings,
  listTextModels,
  rebuildSearchIndex,
  saveTextModelSettings,
  type TextModelChoice,
  type TextModelSettingsState
} from '@/shared/ipc/workspaceApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsGroup, SettingRow, SettingSelect } from './SettingsPrimitives';

/** Model pages and the local service guide; the only place these links appear. */
const LINKS: ReadonlyArray<{ label: string; note: string; href: string }> = [
  { label: 'BAAI/bge-m3', note: '1024 维，CLS 池化，568 MB int8', href: 'https://huggingface.co/BAAI/bge-m3' },
  {
    label: 'intfloat/multilingual-e5-small',
    note: '384 维，Mean 池化，448 MB fp32 ONNX',
    href: 'https://huggingface.co/intfloat/multilingual-e5-small'
  },
  {
    label: 'Qwen3-VL-Embedding-2B',
    note: '视觉通道，2048 维，本地服务',
    href: 'https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B'
  },
  {
    label: 'BAAI/bge-reranker-base',
    note: '重排，279 MB int8',
    href: 'https://huggingface.co/BAAI/bge-reranker-base'
  },
  {
    label: 'BAAI/bge-reranker-v2-m3',
    note: '重排，570 MB int8，质量档',
    href: 'https://huggingface.co/BAAI/bge-reranker-v2-m3'
  }
];

/**
 * Model choice and access points: which text encoder runs, which directories exist, and
 * where the optional models come from. Switching the encoder invalidates the text index,
 * so the screen offers the rebuild instead of pretending nothing changed.
 */
export function ModelAccessSettings({ active, root }: { active: boolean; root: string }) {
  const [choices, setChoices] = useState<TextModelChoice[]>([]);
  const [state, setState] = useState<TextModelSettingsState | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rebuildNote, setRebuildNote] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void Promise.all([listTextModels(), getTextModelSettings()])
      .then(([models, current]) => {
        if (cancelled) return;
        setChoices(models);
        setState(current);
        setSelected(current.model_dir ?? models.find((model) => model.bundled)?.path ?? '');
        setCustom(current.model_dir ?? '');
      })
      .catch(() => {
        if (!cancelled) setError('未能读取文本嵌入模型设置。');
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    setRebuildNote(null);
    try {
      const saved = await saveTextModelSettings({ model_dir: selected || null });
      setState(saved);
      setRebuildNote('模型已切换：现有文本索引属于上一个模型，请重建后再检索。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能保存文本嵌入模型设置。');
    } finally {
      setBusy(false);
    }
  };

  const rebuild = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await rebuildSearchIndex(root, { segmentsOnly: true });
      setRebuildNote(`索引已重建：${response.rebuilt_vector_count} 个向量。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能重建检索索引。');
    } finally {
      setBusy(false);
    }
  };

  const options = choices.map((choice) => ({
    value: choice.path,
    label: `${choice.bundled ? '内置：' : ''}${choice.model_name ?? choice.id}${
      choice.dimensions ? `（${choice.dimensions} 维）` : ''
    }`
  }));

  return (
    <SettingsGroup
      id="tools-model-access"
      title="模型与接入"
      description="搜索用哪个文本嵌入模型、从哪里加载，以及可选模型与本地视觉服务的入口。"
    >
      {error && <p role="alert" className="mt-2 text-xs leading-5 text-destructive">{error}</p>}
      <SettingSelect
        id="tools-text-model"
        label="文本嵌入模型"
        description="切换后需重建索引；维度与池化由模型目录内的 neuink-embedding.json 声明。"
        disabled={!state || busy || options.length === 0}
        value={selected}
        options={options}
        placeholder="选择模型目录"
        onValueChange={(value) => {
          setSelected(value);
          setCustom(value);
        }}
      />
      <SettingRow
        id="tools-text-model-custom"
        label="自定义模型目录"
        description="目录内需有 neuink-embedding.json 与 onnx/model.onnx 或 onnx/model_int8.onnx。"
      >
        <Input
          aria-label="文本嵌入模型目录"
          className="w-full min-w-0"
          disabled={busy}
          value={custom}
          onChange={(event) => {
            setCustom(event.target.value);
            setSelected(event.target.value);
          }}
        />
      </SettingRow>
      {state && (
        <p className="text-xs leading-5 text-muted-foreground" data-testid="text-model-status">
          {state.available
            ? `当前加载：${state.model_name ?? '未知模型'}${state.dimensions ? `，${state.dimensions} 维` : ''}（${state.resolved_dir}）`
            : `模型不可用：${state.message ?? '未检测到可用权重'}`}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !state} onClick={() => void apply()}>
          应用模型
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !root} onClick={() => void rebuild()}>
          重建检索索引
        </Button>
      </div>
      {rebuildNote && (
        <p className="mt-1 text-xs leading-5 text-muted-foreground" data-testid="text-model-note">
          {rebuildNote}
        </p>
      )}
      <div className="mt-3 border-t border-border pt-2">
        <p className="text-xs font-medium text-muted-foreground">模型来源与本地服务</p>
        <ul className="mt-1 space-y-1">
          {LINKS.map((link) => (
            <li key={link.href} className="text-xs leading-5 text-muted-foreground">
              <a className="underline" href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
              <span className="ml-2">{link.note}</span>
            </li>
          ))}
          <li className="text-xs leading-5 text-muted-foreground">
            <span className="font-medium">本地视觉服务</span>
            <span className="ml-2">apps/desktop/scripts/qwen-visual-service/README.md（启动、协议与依赖）</span>
          </li>
        </ul>
      </div>
    </SettingsGroup>
  );
}
