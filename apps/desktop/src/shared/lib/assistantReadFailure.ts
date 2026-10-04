/** Fixed host copy only. Never render a backend exception, URL, path or response body. */
export const ASSISTANT_READ_FAILURES = {
  loading: '目标网页仍在加载，尚未取得正文。请等待加载完成后重新发送读取请求。',
  changed: '目标网页已切换、重新加载或关闭，本次未取得有效正文。请重新选中要读的页面后发送请求。',
  timeout: '读取请求超时，未取得可用正文。请稍后重试；读取 PDF 时可减少一次读取的页数。',
  pdfDownloadTimeout: 'PDF 下载超时，尚未开始提取正文。请检查网络后重试；减少读取页数不会缩短整份文件的下载。',
  pdfDownloadNetwork: 'PDF 下载连接失败，尚未取得文件。请检查网络后重试，或将 PDF 下载到本地后添加到资料库读取。',
  pdfExtractTimeout: 'PDF 已取得，但文字提取超时。请减少一次读取的页数后重试；当前不能声称已读到正文。',
  noText: '所请求的 PDF 页面没有可读取的文字层。请提供带文字层的 PDF，或先完成 OCR／解析；当前不能据此总结正文。',
  tooLarge: '资源超过本次读取的大小或页数限制。请提供较小文件或缩小读取范围；当前不能声称已读完整内容。',
  pageRange: '请求的 PDF 页码超出文件范围。请根据实际总页数选择有效页码后重试。',
  invalidPdf: '目标未返回有效 PDF，可能需要登录、下载确认或链接已失效。请检查页面并提供可公开读取的 PDF；不会绕过访问限制。',
  pdfDecode: 'PDF 文字提取失败，文件可能加密、损坏或字体不受支持。请检查原文件，或提供已解析的正文。',
  denied: '当前来源拒绝读取，尚未取得正文。请检查访问权限或提供有权分享的内容；不会绕过登录或访问限制。',
  network: '读取时未能连接到内容来源。请检查网络并稍后重试，或提供有权分享的正文。',
  unavailable: '当前版本的读取组件不可用。请使用包含读取组件的桌面版本，或直接提供有权分享的正文。',
  unknown: '未能取得可用正文。请检查目标页面是否正常打开，或直接提供有权分享的正文；当前不能声称已读到内容。',
  citation: '回答未满足来源核实要求，引用无法对应实际取得的材料，本次未确认完成。请重试并要求使用已取得的原始来源链接，或补充可引用材料。',
  contract: '回答未满足所需的工具、引用或输出要求，本次未确认完成。请明确要读的材料和希望得到的结果后重试。',
} as const;

function errorText(error: unknown): string {
  try {
    if (typeof error === 'string') return error.slice(0, 8192);
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
      return error.message.slice(0, 8192);
    }
  } catch { /* Never stringify arbitrary objects or expose throwing accessors. */ }
  return '';
}

/** Only exact host templates survive subsequent trace sanitization and historical rendering. */
export function safeAssistantReadFailure(error: unknown): string | undefined {
  const text = errorText(error);
  if (text === 'Agent 未满足工具、溯源或输出合同，任务已停止。') return ASSISTANT_READ_FAILURES.contract;
  return Object.values(ASSISTANT_READ_FAILURES).find(message => message === text);
}

/** Classification chooses fixed guidance; even matching remote text is never copied. */
export function describeAssistantReadFailure(error: unknown): string {
  const text = errorText(error);
  const existing = safeAssistantReadFailure(text);
  if (existing) return existing;
  const patterns: Array<[RegExp, keyof typeof ASSISTANT_READ_FAILURES]> = [
    [/网页仍在加载|page (?:is )?still loading/i, 'loading'],
    [/网页已切换|重新加载或关闭|navigation.*changed|tab.*closed/i, 'changed'],
    [/公开 PDF (?:下载|读取)超时/, 'pdfDownloadTimeout'],
    [/公开 PDF 下载连接失败/, 'pdfDownloadNetwork'],
    [/PDF 文字提取超时/, 'pdfExtractTimeout'],
    [/没有可读取的文字层|no.extractable.text|no text layer/i, 'noText'],
    [/页码超出范围|page.*out of range/i, 'pageRange'],
    [/未返回有效 PDF|invalid PDF/i, 'invalidPdf'],
    [/PDF 文字读取失败|PDF.*(?:encrypted|corrupt)|扫描件/i, 'pdfDecode'],
    [/超过.*(?:大小|页|MiB|限制)|超过基础读取|响应超过大小|too large|size limit/i, 'tooLarge'],
    [/读取组件|字幕组件|仅在 NeuInk 桌面端可用/i, 'unavailable'],
    [/timeout|timed? out|超时/i, 'timeout'],
    [/HTTP\s+(?:401|403)|unauthori[sz]ed|forbidden|未授权|非公开网络|仅允许.*公开|访问限制/i, 'denied'],
    [/network|fetch failed|connection|网络|连接|无法解析服务地址|读取远程内容失败/i, 'network'],
  ];
  const kind = patterns.find(([pattern]) => pattern.test(text))?.[1];
  if (kind) return ASSISTANT_READ_FAILURES[kind];
  return ASSISTANT_READ_FAILURES.unknown;
}
