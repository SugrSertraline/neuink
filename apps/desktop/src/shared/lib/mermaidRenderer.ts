let queue: Promise<unknown> = Promise.resolve();

// Mermaid owns global configuration. Serialize preview and export renders so they cannot change each other's settings.
export function renderMermaidSvg(id: string, code: string, forExport = false): Promise<string> {
  const task = queue.then(async () => {
    if (forExport && (code.length > 100_000 || /^\s*---|%%\s*\{|@import|url\s*\(|<(?:img|image)\b|\b(?:img|image)\s*:/im.test(code))) {
      throw new Error('流程图过大或含自定义配置 / 外部资源，请选择原图或 Mermaid 源码');
    }
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize({
      securityLevel: 'strict', startOnLoad: false, theme: 'neutral',
      ...(forExport ? { htmlLabels: false, fontFamily: 'Arial, Microsoft YaHei, sans-serif', maxTextSize: 100_000 } : {})
    });
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-100000px;top:0;width:1200px;visibility:hidden;pointer-events:none';
    container.setAttribute('aria-hidden', 'true');
    document.body.appendChild(container);
    try {
      await document.fonts?.ready;
      const { svg } = await mermaid.render(`neuink-mermaid-${id}`, code, container);
      return svg;
    } finally { container.remove(); }
  });
  queue = task.catch(() => undefined);
  return task;
}
