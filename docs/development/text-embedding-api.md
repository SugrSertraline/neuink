# 文本嵌入：本地 ONNX 与远程 API 双通道

状态：已实现并验证（`feat/visual-sidecar-qwen` 工作区改动，2026-11-16）。

## 1. 目标与边界

文本嵌入此前只有本地 ONNX 一条路，权重必须放在磁盘上。本改动让 **编码方式** 成为设置项：

| 方式 | 传输 | 说明 |
|---|---|---|
| `local_onnx`（默认） | 进程内 ONNX Runtime | 目录内 `neuink-embedding.json` + 任一权重文件（`onnx/model.onnx`、`onnx/model_int8.onnx`、`onnx/model_quantized.onnx`、`model.onnx`） |
| `api` | OpenAI 兼容 `POST {endpoint}/embeddings` | 服务端返回 `{"data":[{"embedding":[...],"index":0}]}`；厂商、模型、维度都由设置决定，不写死任何模型 |

两种方式共用 `EmbeddingProvider` trait，因此索引、检索、重排、助手工具都不需要分支；切换方式只影响“向量从哪里来”。

不是这次范围的内容：非 OpenAI 兼容协议（如各家私有签名接口）、服务端重试/限流退避、把密钥存入系统钥匙串。

## 2. 配置

`AppSettings.text_model`：

```json
{
  "provider": "api",
  "model_dir": null,
  "endpoint": "https://api.example.com/v1",
  "api_key": "（只写；状态接口只报告 has_api_key）",
  "model": "text-embedding-3-small",
  "dimensions": 1024,
  "timeout_ms": 60000
}
```

校验规则（保存时执行，失败即拒绝）：

- `api` 必须有 endpoint、model、1–8192 的 dimensions；endpoint 必须以 `http://`/`https://` 开头；
- 只有回环地址（`127.0.0.1`、`localhost`、`::1`）允许 `http://`，其他主机必须 `https://`；
- `timeout_ms` 限定 1–600000；
- 前端密钥是只写字段：保存时省略 `api_key` 表示保留已存值，后端合并不清空；
- `local_onnx` 的目录校验与原来一致（目录必须能被加载器识别）。

## 3. 实现位置

| 层 | 文件 | 作用 |
|---|---|---|
| 配置 | `crates/neuink-config/src/lib.rs` | `TextEmbeddingProviderKind`、字段与 `validate()`、回环判断 |
| Provider | `crates/neuink-search/src/remote_embedding_provider.rs` | OpenAI 兼容客户端；32 条/请求分批；按 `index` 还原顺序；维度/数量/有限值校验；`cache_identity` = 模型名 + 维度 |
| 工厂 | `crates/neuink-ipc/src/commands/search.rs` | `cached_text_provider`（按 transport 缓存 ONNX 会话或 HTTP client）、`text_provider_for_app` |
| IPC | `crates/neuink-ipc/src/commands/search.rs` | 设置读写扩展为双通道；新增 `test_text_embedding_connection`（真实发一次嵌入） |
| 状态 | `crates/neuink-ipc/src/commands/embedding.rs` | `get_embedding_status` 走工厂，不再直接构造本地 provider |
| 设置页 | `apps/desktop/src/modules/settings/components/ModelAccessSettings.tsx` | 编码方式切换；API 字段 + 测试连接；本地模式下才显示模型目录与推荐安装 |

索引身份：本地是权重/tokenizer 内容哈希；API 是 `model + dimensions` 的哈希。因此换模型会换索引命名空间并需要重建，换网关但模型相同则复用向量。

## 4. 使用

设置 → 检索与工具 → 模型与接入 → 文本嵌入模型：

1. 编码方式选“远程 API（OpenAI 兼容）”；
2. 填服务地址（基址，或已以 `/embeddings` 结尾的完整 URL）、密钥（可选，留空保留）、模型名、向量维度、超时；
3. 点“测试连接”，应显示 `连接正常：<provider> · <model> · <维度> 维 · <耗时> ms`；
4. 点“应用模型”保存；
5. 点“重建检索索引”。切换编码或模型后必须重建，状态行会提示。

回退：把编码方式切回“本地 ONNX 模型”并应用即可；API 字段会保留，密钥不回显。

## 5. 验证

已执行：

- `cargo test -p neuink-config --lib`：16 通过（含 API 校验、回环 http、旧设置反序列化）
- `cargo test -p neuink-search --lib`：141 通过（含 5 个远程 provider 用例：真实本地 HTTP 桩、维度/数量/状态码拒绝、URL 归一化）
- `cargo test -p neuink-ipc --lib commands::search`：51 通过
- `npm --workspace apps/desktop exec tsc -- --noEmit`：0 错误
- `npm --workspace apps/desktop run test:frontend -- --run .../ModelAccessSettings.test.tsx`：8 通过（含 API 保存载荷与测试连接）

界面端到端（dev 应用 + 本地 OpenAI 兼容桩服务，8 维）：

1. 切到 API，填 `http://127.0.0.1:8899/v1` / `stub-model` / 8，测试连接返回 `openai-compatible · stub-model`，桩服务记录 `served 2 input(s) as stub-model`；
2. 应用模型后状态行：`当前加载：stub-model，8 维（http://127.0.0.1:8899/v1）`；
3. 切回本地并应用：状态行恢复 `Xenova/multilingual-e5-small，384 维`。

未验证：公网真实厂商端点、限流与超时行为、非 OpenAI 兼容协议。
