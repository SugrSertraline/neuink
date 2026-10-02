/** Local-only matching. Ranking never changes model IDs or infers capability metadata. */
export function catalogSearchScore(query: string, fields: string[]): number {
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
  const terms = query.trim().split(/\s+/).filter(Boolean).map(normalize).filter(Boolean);
  if (!terms.length) return 1;
  const values = fields.map(normalize);
  let score = 0;
  for (const term of terms) {
    let best = 0;
    for (const value of values) {
      if (value === term) best = Math.max(best, 100);
      else if (value.startsWith(term)) best = Math.max(best, 80);
      else if (value.includes(term)) best = Math.max(best, 60);
      else if (term.length >= 3) {
        let cursor = 0;
        for (const letter of value) if (letter === term[cursor]) cursor++;
        if (cursor === term.length) best = Math.max(best, 10);
      }
    }
    if (!best) return 0;
    score += best;
  }
  return score;
}

export function providerAliases(value: string): string {
  const aliases = [
    ['deepseek', '深度求索 ds'], ['moonshot kimi', '月之暗面 月暗 kimi'], ['dashscope alibaba qwen', '阿里 通义 千问 百炼'],
    ['zhipu zai glm', '智谱 清言'], ['volcengine doubao 火山', '字节 豆包 火山 方舟'],
    ['stepfun', '阶跃星辰 阶跃'], ['siliconflow', '硅基流动 硅基'], ['tencent hunyuan', '腾讯 混元'],
    ['google', '谷歌 gemini'], ['anthropic', 'claude 克劳德'], ['minimax', '稀宇 海螺'], ['openrouter', '模型聚合 路由'],
  ];
  return aliases.filter(([keys]) => keys.split(' ').some(key => value.toLowerCase().includes(key))).map(([, names]) => names).join(' ');
}
