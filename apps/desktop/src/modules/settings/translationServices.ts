import type { TranslationServiceProvider } from '@/shared/ipc/selectionTranslationApi';

export const translationServices: Record<TranslationServiceProvider, { label: string; help: string; url: string }> = {
  niutrans: { label: '小牛翻译', help: '自动识别源语言，翻译为简体中文。填写小牛开放平台的 API Key 即可。', url: 'https://niutrans.com/documents/contents/trans_detection' },
  deepl: { label: 'DeepL API', help: '使用 DeepL API 密钥；Free 与 Pro 需选择对应请求地址。网页版订阅不能代替 API 密钥。', url: 'https://developers.deepl.com/docs/getting-started/auth' },
  azure: { label: 'Microsoft Azure Translator', help: '填写 Translator 资源的密钥与区域；全局资源按官方要求留空区域。', url: 'https://learn.microsoft.com/azure/ai-services/translator/text-translation/reference/authentication' },
  qwen_mt: { label: '通义 Qwen-MT', help: '填写百炼 API Key，模型和请求地址须与密钥所属地域一致。', url: 'https://help.aliyun.com/zh/model-studio/machine-translation' },
};
