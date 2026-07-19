export type ModelPreset = {
  id: string;
  label?: string;
  maxContextLength?: number;
  maxOutputTokens?: number;
  metadataSource?: 'built_in' | 'openrouter' | 'provider';
  modelContextLength?: number;
  providerContextLength?: number;
  temperature?: number;
};

export type ProviderPreset = {
  baseUrl: string;
  brand: {
    background: string;
    foreground: string;
    mark: string;
  };
  label: string;
  models: ModelPreset[];
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    baseUrl: 'https://api.deepseek.com',
    brand: { background: '#101828', foreground: '#ffffff', mark: 'DS' },
    label: 'DeepSeek',
    models: [
      {
        id: 'deepseek-v4-flash',
        maxContextLength: 1048576,
        maxOutputTokens: 393216,
        temperature: 0.2
      },
      {
        id: 'deepseek-v4-pro',
        maxContextLength: 1048576,
        maxOutputTokens: 393216,
        temperature: 0.2
      },
      {
        id: 'deepseek-chat',
        label: 'deepseek-chat（兼容名）',
        maxContextLength: 1048576,
        maxOutputTokens: 393216,
        temperature: 0.2
      },
      {
        id: 'deepseek-reasoner',
        label: 'deepseek-reasoner（兼容名）',
        maxContextLength: 1048576,
        maxOutputTokens: 393216,
        temperature: 0.2
      }
    ]
  },
  {
    baseUrl: 'http://localhost:11434/v1',
    brand: { background: '#f4f4f5', foreground: '#18181b', mark: 'OL' },
    label: 'Ollama',
    models: [
      {
        id: 'qwen2.5:7b',
        label: 'qwen2.5:7b（本地默认）',
        maxContextLength: 8192,
        temperature: 0.2
      },
      {
        id: 'qwen3:8b',
        label: 'qwen3:8b（本地默认）',
        maxContextLength: 8192,
        temperature: 0.2
      },
      {
        id: 'qwen3:14b',
        label: 'qwen3:14b（本地）',
        maxContextLength: 8192,
        temperature: 0.2
      },
      {
        id: 'qwen3:32b',
        label: 'qwen3:32b（本地）',
        maxContextLength: 8192,
        temperature: 0.2
      },
      {
        id: 'llama3.1:8b',
        label: 'llama3.1:8b（本地）',
        maxContextLength: 8192,
        temperature: 0.2
      },
      {
        id: 'llama3.1:70b',
        label: 'llama3.1:70b（本地）',
        maxContextLength: 8192,
        temperature: 0.2
      },
      {
        id: 'gemma3:12b',
        label: 'gemma3:12b（本地）',
        maxContextLength: 8192,
        temperature: 0.2
      },
      {
        id: 'gemma3:27b',
        label: 'gemma3:27b（本地）',
        maxContextLength: 8192,
        temperature: 0.2
      },
      {
        id: 'deepseek-r1:8b',
        label: 'deepseek-r1:8b（本地）',
        maxContextLength: 8192,
        temperature: 0.2
      }
    ]
  },
  {
    baseUrl: 'https://api.openai.com/v1',
    brand: { background: '#111827', foreground: '#ffffff', mark: 'AI' },
    label: 'OpenAI',
    models: [
      {
        id: 'gpt-5.5',
        maxContextLength: 1048576,
        maxOutputTokens: 128000,
        temperature: 0.2
      },
      {
        id: 'gpt-5.4-mini',
        maxContextLength: 1048576,
        maxOutputTokens: 128000,
        temperature: 0.2
      },
      {
        id: 'gpt-4o-mini',
        maxContextLength: 128000,
        maxOutputTokens: 16384,
        temperature: 0.2
      },
      {
        id: 'gpt-4o',
        maxContextLength: 128000,
        maxOutputTokens: 16384,
        temperature: 0.2
      },
      {
        id: 'gpt-4.1',
        maxContextLength: 1047576,
        maxOutputTokens: 32768,
        temperature: 0.2
      },
      {
        id: 'gpt-4.1-mini',
        maxContextLength: 1047576,
        maxOutputTokens: 32768,
        temperature: 0.2
      },
      {
        id: 'gpt-4.1-nano',
        maxContextLength: 1047576,
        maxOutputTokens: 32768,
        temperature: 0.2
      }
    ]
  },
  {
    baseUrl: 'https://openrouter.ai/api/v1',
    brand: { background: '#6d28d9', foreground: '#ffffff', mark: 'OR' },
    label: 'OpenRouter',
    models: [
      {
        id: 'deepseek/deepseek-chat',
        maxContextLength: 128000,
        maxOutputTokens: 16000,
        temperature: 0.2
      },
      {
        id: 'deepseek/deepseek-r1',
        maxContextLength: 64000,
        maxOutputTokens: 8192,
        temperature: 0.2
      },
      {
        id: 'deepseek/deepseek-v4-flash',
        maxContextLength: 1048576,
        temperature: 0.2
      },
      {
        id: 'deepseek/deepseek-v4-pro',
        maxContextLength: 1048576,
        maxOutputTokens: 384000,
        temperature: 0.2
      },
      {
        id: 'openai/gpt-4o-mini',
        maxContextLength: 128000,
        maxOutputTokens: 16384,
        temperature: 0.2
      },
      {
        id: 'openai/gpt-4.1',
        maxContextLength: 1047576,
        maxOutputTokens: 32768,
        temperature: 0.2
      },
      {
        id: 'openai/gpt-4.1-mini',
        maxContextLength: 1047576,
        maxOutputTokens: 32768,
        temperature: 0.2
      },
      {
        id: 'anthropic/claude-3.5-sonnet',
        maxContextLength: 200000,
        maxOutputTokens: 8192,
        temperature: 0.2
      },
      {
        id: 'anthropic/claude-sonnet-4',
        maxContextLength: 200000,
        maxOutputTokens: 8192,
        temperature: 0.2
      },
      {
        id: 'google/gemini-2.5-pro',
        maxContextLength: 1048576,
        maxOutputTokens: 65536,
        temperature: 0.2
      },
      {
        id: 'google/gemini-2.5-flash',
        maxContextLength: 1048576,
        maxOutputTokens: 65536,
        temperature: 0.2
      },
      {
        id: 'meta-llama/llama-3.1-405b-instruct',
        maxContextLength: 128000,
        maxOutputTokens: 4096,
        temperature: 0.2
      },
      {
        id: 'mistralai/mistral-large',
        maxContextLength: 128000,
        maxOutputTokens: 8192,
        temperature: 0.2
      }
    ]
  },
  {
    baseUrl: 'https://api.moonshot.ai/v1',
    brand: { background: '#111827', foreground: '#ffffff', mark: 'KM' },
    label: 'Kimi / Moonshot',
    models: [
      {
        id: 'kimi-k2.7-code',
        maxContextLength: 256000,
        temperature: 0.2
      },
      {
        id: 'kimi-k2.6',
        maxContextLength: 256000,
        temperature: 0.2
      },
      {
        id: 'kimi-k2-0905-preview',
        maxContextLength: 256000,
        temperature: 0.2
      },
      {
        id: 'moonshot-v1-128k',
        maxContextLength: 128000,
        temperature: 0.2
      },
      {
        id: 'moonshot-v1-32k',
        maxContextLength: 32000,
        temperature: 0.2
      },
      {
        id: 'moonshot-v1-8k',
        maxContextLength: 8000,
        temperature: 0.2
      }
    ]
  },
  {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    brand: { background: '#155eef', foreground: '#ffffff', mark: 'DB' },
    label: '豆包 / 火山方舟',
    models: [
      {
        id: 'doubao-seed-1-6',
        maxContextLength: 256000,
        temperature: 0.2
      },
      {
        id: 'doubao-seed-1-6-thinking',
        maxContextLength: 256000,
        temperature: 0.2
      },
      {
        id: 'doubao-1-5-pro-32k',
        maxContextLength: 32000,
        temperature: 0.2
      },
      {
        id: 'doubao-1-5-lite-32k',
        maxContextLength: 32000,
        temperature: 0.2
      }
    ]
  },
  {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    brand: { background: '#ff6a00', foreground: '#ffffff', mark: 'QW' },
    label: '通义千问 / DashScope',
    models: [
      {
        id: 'qwen-max',
        maxContextLength: 128000,
        temperature: 0.2
      },
      {
        id: 'qwen-plus',
        maxContextLength: 128000,
        temperature: 0.2
      },
      {
        id: 'qwen-turbo',
        maxContextLength: 1000000,
        temperature: 0.2
      },
      {
        id: 'qwen-long',
        maxContextLength: 10000000,
        temperature: 0.2
      },
      {
        id: 'qwen3-coder-plus',
        maxContextLength: 1000000,
        temperature: 0.2
      }
    ]
  },
  {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    brand: { background: '#0f766e', foreground: '#ffffff', mark: 'GL' },
    label: '智谱 GLM',
    models: [
      {
        id: 'glm-4.5',
        maxContextLength: 128000,
        temperature: 0.2
      },
      {
        id: 'glm-4.5-air',
        maxContextLength: 128000,
        temperature: 0.2
      },
      {
        id: 'glm-4.5-flash',
        maxContextLength: 128000,
        temperature: 0.2
      },
      {
        id: 'glm-4-plus',
        maxContextLength: 128000,
        temperature: 0.2
      }
    ]
  },
  {
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    brand: { background: '#2563eb', foreground: '#ffffff', mark: 'HY' },
    label: '腾讯混元',
    models: [
      {
        id: 'hunyuan-turbos-latest',
        maxContextLength: 256000,
        temperature: 0.2
      },
      {
        id: 'hunyuan-large',
        maxContextLength: 32000,
        temperature: 0.2
      },
      {
        id: 'hunyuan-standard',
        maxContextLength: 32000,
        temperature: 0.2
      }
    ]
  },
  {
    baseUrl: 'https://api.minimax.chat/v1',
    brand: { background: '#7c3aed', foreground: '#ffffff', mark: 'MM' },
    label: 'MiniMax',
    models: [
      {
        id: 'MiniMax-M1',
        maxContextLength: 1000000,
        temperature: 0.2
      },
      {
        id: 'abab6.5s-chat',
        maxContextLength: 245760,
        temperature: 0.2
      }
    ]
  }
];
