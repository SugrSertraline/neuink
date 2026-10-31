import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getTranslationRouting, saveTranslationRouting, DEFAULT_TRANSLATION_ROUTING, type TranslationRouting, type TranslationKind, type TranslationSource } from '@/shared/ipc/translationRoutingApi';
import { useSettingsAutosave } from '../useSettingsAutosave';
import { SettingsGroup, SettingSelect, SettingSwitch } from './SettingsPrimitives';

const kinds: { id: TranslationKind; label: string; description: string }[] = [
  { id: 'word', label: '单词释义来源', description: '单个英文词；开启本地词库优先时，仅未收录的词使用此来源。' },
  { id: 'selection', label: '选中文字来源', description: '拖选的句子或一段文字；手动与自动选区翻译共用。' },
  { id: 'segment', label: '单个片段来源', description: '右键翻译一个解析片段，包括标题、表格、图片说明等。' },
  { id: 'paragraph', label: '段落逐句对照来源', description: '段落译文与句子对齐共同使用此模型。' },
  { id: 'document', label: '整篇与批量来源', description: '整篇、勾选多个片段及解析后自动翻译共用。' },
];
const valueOf = (source: TranslationSource) => source.kind === 'profile' ? `profile:${source.profile_id}` : source.kind;
const sourceOf = (value: string): TranslationSource => value.startsWith('profile:')
  ? { kind: 'profile', profile_id: value.slice(8) } : value === 'selection_service' ? { kind: value } : { kind: 'default_model' };
const equal = (a: TranslationRouting, b: TranslationRouting) => JSON.stringify(a) === JSON.stringify(b);

/** Draft and failed saves stay here; the settings viewport owns scrolling and shared controls own keyboard input. */
export function TranslationSourcesSettings({ active, profiles, defaultProfileId, unavailable }: {
  active: boolean; profiles: { id: string; name: string; model: string }[]; defaultProfileId: string | null; unavailable?: boolean;
}) {
  const [saved, setSaved] = useState<TranslationRouting | null>(null);
  const [draft, setDraft] = useState(DEFAULT_TRANSLATION_ROUTING);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active || saved) return;
    let canceled = false;
    setLoading(true); setError('');
    void getTranslationRouting().then(value => { if (!canceled) { setSaved(value); setDraft(value); } })
      .catch(() => { if (!canceled) setError('读取翻译来源失败，请重试。'); })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [active, saved, attempt]);
  const save = useSettingsAutosave({ value: draft, savedValue: saved ?? DEFAULT_TRANSLATION_ROUTING, equal,
    enabled: Boolean(saved), closeScope: 'settings', save: saveTranslationRouting, onSaved: setSaved });
  const defaultProfile = profiles.find(p => p.id === defaultProfileId);
  return <SettingsGroup id="translation-sources" title="按翻译类型选择来源" description="每类可独立指定模型或沿用统一默认模型。单词与选中文字还可选择下方的选区专用服务；其他三类需要支持结构化输出的模型。">
    {!saved ? <div className="text-xs">{loading ? <p role="status">正在读取翻译来源…</p> : <><p role="alert" className="text-destructive">{error}</p><Button size="sm" variant="outline" onClick={() => setAttempt(n => n + 1)}>重新读取翻译来源</Button></>}</div> : <>
      <SettingSwitch label="单词优先使用本地词库" checked={draft.local_dictionary_first}
        description="本地命中不联网；关闭后，所有单词都使用下方指定的来源。"
        onCheckedChange={local_dictionary_first => setDraft(value => ({ ...value, local_dictionary_first }))} />
      {kinds.map(({ id, label, description }) => {
        const source = draft[id];
        const missing = source.kind === 'profile' && !profiles.some(p => p.id === source.profile_id);
        return <div key={id}>
          <SettingSelect label={label} value={valueOf(source)} disabled={unavailable}
            description={description} options={[
              { value: 'default_model', label: `统一默认模型${defaultProfile ? ` · ${defaultProfile.name}` : '（尚未指定）'}` },
              ...(['word', 'selection'].includes(id) ? [{ value: 'selection_service', label: '选区专用服务／沿用模型（见下方）' }] : []),
              ...profiles.map(p => ({ value: `profile:${p.id}`, label: `${p.name} · ${p.model}` })),
              ...(missing ? [{ value: valueOf(source), label: '原模型已删除，请重新选择' }] : []),
            ]} onValueChange={value => setDraft(previous => ({ ...previous, [id]: sourceOf(value) }))} />
          {missing && <p role="alert" className="text-xs text-destructive">此来源已不可用，不会自动改用其他模型。</p>}
        </div>;
      })}
      <p className="mt-2 text-xs text-muted-foreground">更改后用于新发起的翻译；已有译文不会自动重译，暂停任务继续使用原模型。悬停预览与双语显示读取已保存译文。</p>
      {(save.dirty || save.saving || save.error) && <div className="mt-2 flex items-center gap-2 text-xs" role={save.error ? 'alert' : 'status'}>
        <span className={save.error ? 'text-destructive' : 'text-muted-foreground'}>{save.error ? '保存失败，修改已保留。' : save.saving ? '正在保存翻译来源…' : '翻译来源尚未保存。'}</span>
        {save.error && <Button size="xs" variant="outline" onClick={save.retry}>重试保存翻译来源</Button>}
      </div>}
    </>}
  </SettingsGroup>;
}
