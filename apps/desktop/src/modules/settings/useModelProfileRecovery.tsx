import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useSurfaceCloseGuard } from '@/app/useSurfaceCloseGuard';
import { EditRecoveryRoot, useFormRecovery } from '@/shared/hooks/useFormRecovery';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import type { SettingsPanelLayoutProps } from './components/SettingsPanelLayout';

/** Model form state stays in SettingsPanel; this owns only its modal and recovery lifecycle. */
export function useModelProfileRecovery(props: SettingsPanelLayoutProps) {
  const root = useContext(EditRecoveryRoot), owner = useId(), scope = 'settings/model-profile';
  const [open, setOpen] = useState(false);
  const [baseline, setBaseline] = useState<string | null>(null);
  const value = { editingId: props.editingId, name: props.name, baseUrl: props.baseUrl, apiProtocol: props.apiProtocol,
    model: props.model, apiKey: props.apiKey, maxContextLength: props.maxContextLength, maxOutputTokens: props.maxOutputTokens,
    temperature: props.temperature, topP: props.topP };
  const serialized = JSON.stringify(value);
  useLayoutEffect(() => { setBaseline(open ? serialized : null); }, [open]);
  const dirty = open && baseline !== null && baseline !== serialized;
  const recovery = useFormRecovery({ id: 'model-profile', label: '模型连接配置', scope, targetId: 'models-connections',
    value, secretFields: ['apiKey'], dirty, ready: !props.modelsUnavailable,
    restore: next => {
      if (next.editingId && !props.settings.profiles.some(profile => profile.id === next.editingId)) throw new Error('原模型已删除');
      props.onProviderPresetSelect(next.editingId ? `__profile__${next.editingId}` : '__custom__');
      props.onNameChange(next.name); props.onBaseUrlChange(next.baseUrl); props.onApiProtocolChange(next.apiProtocol);
      props.onModelMetadataSelect({ id: next.model });
      props.onMaxContextLengthChange(next.maxContextLength); props.onMaxOutputTokensChange(next.maxOutputTokens);
      props.onTemperatureChange(next.temperature); props.onTopPChange(next.topP); props.onApiKeyChange(next.apiKey);
      setOpen(true);
    }, reveal: () => { setOpen(true); requestAnimationFrame(() => document.getElementById('llm-name')?.focus()); } });
  useEffect(() => { if (recovery.pending && props.activeSettingsTab === 'models') setOpen(true); }, [recovery.pending?.key, props.activeSettingsTab]);
  const latest = useRef({ props, recovery, dirty }); latest.current = { props, recovery, dirty };
  const close = () => { latest.current.recovery.discard(); setOpen(false); setBaseline(null); };
  const save = async () => {
    const { props: p, recovery: r } = latest.current;
    if (r.blocked || p.busy) return false;
    const ok = await (p.editingProfile ? p.onSaveProfile() : p.onCreateProfile());
    if (ok) { latest.current.dirty = false; close(); }
    return ok;
  };
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    const off = registerSegmentEditorCloseHandler(scope, owner, { ...recovery.handlers, settingsTargetId: 'models-connections',
      save: () => saveRef.current(), discard: close, isDirty: () => latest.current.dirty,
      isBusy: () => latest.current.props.busy });
    return () => { off(); setSegmentEditorDirty(scope, owner, false); };
  }, [owner]);
  useEffect(() => setSegmentEditorDirty(scope, owner, dirty || open && props.busy), [owner, dirty, open, props.busy]);
  const guard = useSurfaceCloseGuard({ root, onClose: () => undefined });
  return { open, setOpen, recovery, dialog: guard.dialog,
    saved: close,
    onOpenChange: (next: boolean) => {
      if (next) { setOpen(true); return; }
      if (props.busy) return;
      if (!dirty) { setOpen(false); return; }
      guard.requestClose([{ pane: 'left', surface: { kind: 'settings' }, scopeKey: scope }], close);
    } };
}
