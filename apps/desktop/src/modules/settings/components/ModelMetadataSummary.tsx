import { modelSourceLabel } from '@/modules/assistant/sdk/modelCatalog';
import type { ModelPreset } from './providerPresets';

export function ModelMetadataSummary({ model, context, output }: { model?: ModelPreset; context: string; output: string }) {
  if (!model) return <p className="text-xs text-muted-foreground">该模型暂无精确匹配的公开规格，可手动填写；不会按相似名称猜测。</p>;
  const support = (value?: boolean) => value == null ? '未知' : value ? '支持' : '不支持';
  return <div className="grid gap-1 border-t pt-2 text-xs leading-5">
    {model.providerName && <p>参考服务商：{model.providerName}（不改变当前接口）</p>}
    <p>公开参考：上下文 {model.maxContextLength?.toLocaleString() ?? '未知'}（{modelSourceLabel(model.contextSource ?? model.metadataSource)}）；最大输出 {model.maxOutputTokens?.toLocaleString() ?? '未知'}（{modelSourceLabel(model.outputSource ?? model.metadataSource)}）</p>
    <p>当前填写：上下文 {context || '未填写'}；最大输出 {output || '未填写'}。保存后才生效。</p>
    {model.maxInputTokens != null && <p>独立输入上限：{model.maxInputTokens.toLocaleString()}。输入上限、总上下文和输出上限不是同一个值。</p>}
    {model.modelContextLength != null && model.providerContextLength != null && model.modelContextLength !== model.providerContextLength && <p>模型标称上下文：{model.modelContextLength.toLocaleString()}；当前服务上限：{model.providerContextLength.toLocaleString()}，采用服务上限。</p>}
    <p className="text-muted-foreground">工具调用：{support(model.supportsTools)} · 推理：{support(model.supportsReasoning)} · 调节温度：{support(model.supportsTemperature)}</p>
    {model.inputModalities && <p className="text-muted-foreground">输入类型：{model.inputModalities.join(' / ')}；输出类型：{model.outputModalities?.join(' / ') ?? '未知'}</p>}
    {model.releaseDate && <p className="text-muted-foreground">发布日期：{model.releaseDate}{model.knowledge ? ` · 知识截止：${model.knowledge}` : ''}</p>}
    {model.status === 'deprecated' && <p className="text-warning">目录标记此模型已弃用，请确认服务商仍提供。</p>}
    {model.supportsTools === false && <p className="text-warning">目录标记不支持工具调用，不宜用于需要检索或修改资料的主助手。</p>}
    <p className="text-muted-foreground">公共规格仅作参考，不会自动启用模型能力或改变协议；实际限制以你的服务商为准。</p>
  </div>;
}
