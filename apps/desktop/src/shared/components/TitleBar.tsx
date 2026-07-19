import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, Search, Square, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Kbd } from '@/components/ui/kbd';

type WindowAction = 'minimize' | 'toggleMaximize' | 'close';

export function TitleBar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const [isMaximized, setIsMaximized] = useState(false);

  const syncMaximized = useCallback(async () => {
    try {
      setIsMaximized(await getCurrentWindow().isMaximized());
    } catch (error) {
      console.error('Failed to read window maximize state', error);
    }
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void syncMaximized();
    void getCurrentWindow()
      .onResized(syncMaximized)
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch((error) => {
        console.error('Failed to listen for window resize events', error);
      });

    return () => {
      unlisten?.();
    };
  }, [syncMaximized]);

  const runWindowAction = async (action: WindowAction) => {
    const appWindow = getCurrentWindow();
    try {
      if (action === 'minimize') {
        await appWindow.minimize();
        return;
      }
      if (action === 'toggleMaximize') {
        await appWindow.toggleMaximize();
        await syncMaximized();
        return;
      }
      await appWindow.close();
    } catch (error) {
      console.error(`Failed to ${action} window`, error);
    }
  };

  return (
    <header className="titlebar">
      <div className="brand" data-tauri-drag-region>
        <img className="logo" src="/neuink-logo.svg" alt="Neuink" />
        <div className="app-identity" data-tauri-drag-region>
          <div className="app-title">Neuink</div>
          <div className="app-subtitle">文献阅读 · 知识工作台</div>
        </div>
      </div>
      <div className="drag-region" data-tauri-drag-region />
      <button className="title-search" type="button" onClick={onOpenSearch}>
        <Search size={14} aria-hidden="true" />
        <span className="label">搜索条目、标签、笔记、原文片段</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <div className="drag-region" data-tauri-drag-region />
      <div className="window-controls">
        <button
          className="win-btn"
          title="最小化 / Minimize"
          type="button"
          onClick={() => void runWindowAction('minimize')}
        >
          <Minus size={15} aria-hidden="true" />
        </button>
        <button
          className="win-btn"
          title={isMaximized ? '还原 / Restore' : '最大化 / Maximize'}
          type="button"
          onClick={() => void runWindowAction('toggleMaximize')}
        >
          {isMaximized ? <Copy size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
        </button>
        <button
          className="win-btn close"
          title="关闭 / Close"
          type="button"
          onClick={() => void runWindowAction('close')}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
