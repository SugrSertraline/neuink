const messages = {
  configuration: '请先在模型设置中配置助手模型。',
  read: '无法读取已有详略，请检查资料库是否可访问后重试。',
  save: '详略已生成，但保存失败。请检查资料库写入权限和磁盘空间后重试；已有结果保留。',
  timeout: '模型请求超时，请检查模型服务或网络后重试；已有结果保留。',
  truncated: '模型输出达到长度上限，详略结果不完整。请提高助手模型的最大输出 Token 后重试。',
  context: '段落与背景信息预计超过助手模型设置的上下文长度，请检查模型上下文配置后重试；已有结果保留。',
  empty: '模型未返回可用正文，请重试或更换助手模型；已有结果保留。',
  format: '模型返回的详略不是有效 JSON，请重试或更换支持 JSON 输出的助手模型。',
  validation: '部分详略的证据句或主题未通过原文校验，请重试失败段落；已保存的结果保留。',
  filtered: '模型服务过滤了本次输出，请调整模型后重试；已有结果保留。',
  auth: '助手模型认证失败，请检查密钥和模型访问权限。',
  quota: '助手模型服务余额或额度不足，请补充额度后重试。',
  rate: '助手模型服务请求过于频繁，请稍后重试。',
  network: '无法连接助手模型服务，请检查服务地址、网络或代理后重试。',
  request: '助手模型拒绝了请求，请检查模型名称、接口协议及 JSON 输出支持。',
  service: '助手模型服务暂时不可用，请稍后重试；已有结果保留。',
  unknown: '详略生成失败，请重试；已有结果保留。',
};
export class FoldGenerationError extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); this.name = 'FoldGenerationError'; }
}

/** Never display provider bodies, credentials, URLs or arbitrary IPC messages. */
export type FoldErrorCode = keyof typeof messages;

export function foldErrorCode(error: unknown): FoldErrorCode {
  if (error instanceof FoldGenerationError) return error.code;
  let text = '', status: number | undefined;
  try {
    if (error instanceof Error) text = `${error.name} ${error.message}`.slice(0, 8192);
    else if (typeof error === 'string') text = error.slice(0, 8192);
    const candidate = error as { statusCode?: unknown; cause?: { statusCode?: unknown } } | null;
    const code = candidate?.statusCode ?? candidate?.cause?.statusCode;
    if (typeof code === 'number') status = code;
  } catch { /* Unknown exceptions may have throwing accessors. */ }
  const code: keyof typeof messages = status === 401 || status === 403 ? 'auth' : status === 402 ? 'quota' : status === 429 ? 'rate'
    : status === 400 || status === 404 || status === 422 ? 'request' : status && status >= 500 ? 'service'
    : /timeout|timed? out|超时/i.test(text) ? 'timeout'
    : /长度上限|finish.?reason.?length/i.test(text) ? 'truncated'
    : /ModelContextLimitError|超过.*上下文长度/i.test(text) ? 'context'
    : /NoOutputGenerated|未返回可用|没有返回可用/i.test(text) ? 'empty'
    : /NoObjectGenerated|JSON|可解析/i.test(text) ? 'format'
    : /内容过滤/i.test(text) ? 'filtered'
    : /校验/.test(text) ? 'validation'
    : /network|fetch failed|connection|连接|网络/i.test(text) ? 'network' : 'unknown';
  return code;
}

export function foldErrorMessage(error: unknown): string { return messages[foldErrorCode(error)]; }
