import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useEffect, useRef, useState } from 'react';

import type { CreateEntryRequest, CreateEntryResult } from '@/shared/hooks/useWorkspace';
import type { ToastContextValue } from '@/shared/hooks/useToast';

type NativeDropPosition = { x: number; y: number };

type PdfDropImportOptions = Pick<ToastContextValue, 'notify' | 'dismiss'> & {
  workspaceRoot: string | null;
  workspaceReady: boolean;
  parserEndpoint: string;
  parserApiKey: string;
  createEntry: (
    request: CreateEntryRequest,
    endpoint: string,
    apiKey: string
  ) => Promise<CreateEntryResult | undefined>;
};

type ImportProgress = { id: string; root: string; startedAt: number; completed: number; total: number };

export function droppedPdfFiles(paths: string[]) {
  const files: { path: string; title: string }[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const path of paths) {
    const fileName = path.split(/[\\/]/).pop() ?? '';
    const title = fileName.replace(/\.pdf$/i, '').trim();
    const normalizedPath = path.toLowerCase();
    if (!/\.pdf$/i.test(fileName) || !title || seen.has(normalizedPath)) {
      skipped += 1;
      continue;
    }
    seen.add(normalizedPath);
    files.push({ path, title });
  }
  return { files, skipped };
}

function insideCreateEntryDropZone(position: NativeDropPosition) {
  const scale = window.devicePixelRatio || 1;
  const x = position.x / scale;
  const y = position.y / scale;
  return Array.from(document.querySelectorAll<HTMLElement>('[data-native-file-drop-zone]'))
    .some((element) => {
      const rect = element.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    });
}

export function usePdfDropImport(options: PdfDropImportOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const importingRef = useRef(false);
  const pendingToastIdRef = useRef<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let closed = false;
    const clearDrag = () => setDragActive(false);
    window.addEventListener('blur', clearDrag);

    const importPaths = async (paths: string[]) => {
      const current = optionsRef.current;
      if (importingRef.current) {
        current.notify({ title: 'PDF 正在导入', description: '请等待本批文件完成后再拖入。' });
        return;
      }
      const { files, skipped } = droppedPdfFiles(paths);
      if (files.length === 0) {
        current.notify({ title: '没有可导入的 PDF', description: '请拖入一个或多个 PDF 文件。', tone: 'danger' });
        return;
      }
      if (!current.workspaceReady || !current.workspaceRoot) {
        current.notify({ title: '无法导入 PDF', description: '请先打开资料库。', tone: 'danger' });
        return;
      }

      importingRef.current = true;
      const initialRoot = current.workspaceRoot;
      const identity = { id: crypto.randomUUID(), root: initialRoot, startedAt: Date.now() };
      let completed = 0;
      let succeeded = 0;
      const failed: string[] = [];
      setProgress({ ...identity, completed, total: files.length });
      const toastId = current.notify({
        title: `正在导入 ${files.length} 个 PDF`,
        description: '将按文件名创建条目，并按当前设置加入解析队列。',
        durationMs: Infinity
      });
      pendingToastIdRef.current = toastId;

      try {
        for (const file of files) {
          if (closed || optionsRef.current.workspaceRoot !== initialRoot) break;
          try {
            const result = await optionsRef.current.createEntry(
              { title: file.title, pdfPath: file.path },
              current.parserEndpoint,
              current.parserApiKey
            );
            if (!result?.createdWithPdf) throw new Error('PDF 未附加到条目');
            succeeded += 1;
          } catch {
            // The create API can leave an empty entry if attaching the PDF fails.
            // Report this explicitly instead of silently retrying and duplicating it.
            failed.push(file.title);
          }
          completed += 1;
          if (!closed) setProgress({ ...identity, completed, total: files.length });
        }
      } finally {
        importingRef.current = false;
        if (pendingToastIdRef.current === toastId) {
          current.dismiss(toastId);
          pendingToastIdRef.current = null;
        }
        if (!closed) {
          setProgress(null);
          const interrupted = completed < files.length;
          const summary = [`成功 ${succeeded} 个`];
          if (failed.length) summary.push(`失败 ${failed.length} 个：${failed.slice(0, 3).join('、')}${failed.length > 3 ? '等' : ''}`);
          if (skipped) summary.push(`跳过 ${skipped} 个非 PDF 或重复文件`);
          if (interrupted) summary.push('资料库已切换，剩余文件未导入');
          if (failed.length) summary.push('失败项可能留下空条目，请在条目库核对');
          current.notify({
            title: interrupted ? 'PDF 导入已中断' : failed.length ? 'PDF 导入部分失败' : 'PDF 导入完成',
            description: summary.join('；'),
            tone: failed.length || interrupted ? 'danger' : 'success',
            durationMs: failed.length || interrupted ? Infinity : undefined
          });
        }
      }
    };

    const listener = getCurrentWebview().onDragDropEvent((event) => {
      if (closed) return;
      const payload = event.payload;
      if (payload.type === 'leave') {
        setDragActive(false);
      } else if (payload.type === 'enter' || payload.type === 'over') {
        setDragActive(!insideCreateEntryDropZone(payload.position) && !importingRef.current);
      } else if (payload.type === 'drop') {
        setDragActive(false);
        const zipDrop = insideCreateEntryDropZone(payload.position) &&
          payload.paths.some((path) => /\.zip$/i.test(path));
        if (!zipDrop) void importPaths(payload.paths);
      }
    });
    void listener.catch(() => {
      if (!closed) optionsRef.current.notify({ title: 'PDF 拖放不可用', description: '请通过“创建条目”选择 PDF。', tone: 'danger' });
    });

    return () => {
      closed = true;
      window.removeEventListener('blur', clearDrag);
      if (pendingToastIdRef.current) {
        optionsRef.current.dismiss(pendingToastIdRef.current);
        pendingToastIdRef.current = null;
      }
      void listener.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, []);

  return { dragActive, progress };
}
