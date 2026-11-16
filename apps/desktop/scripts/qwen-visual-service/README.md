# Qwen3-VL-Embedding-2B 视觉编码服务

桌面端使用 PDFium 渲染 PDF 页面及几何区域，并将图片与 MinerU 图表资产发送给编码服务。服务只负责文本和图片编码，向量写入视觉索引。

## 启动

```powershell
# 假向量（不加载模型，用于整链测试）
python service.py --stub --port 8765

# 真实模型（需要 transformers / torch / qwen_vl_utils / pillow）
$env:NEUINK_QWEN_VL_MODEL = 'D:\models\Qwen3-VL-Embedding-2B-...'
python service.py --port 8765
```

| 环境变量 | 含义 |
|---|---|
| `NEUINK_QWEN_VL_MODEL` | 模型目录，需含 `scripts/qwen3_vl_embedding.py` |
| `NEUINK_EMBED_DIM` | 输出维度，默认 2048 |

## 协议

```text
GET  /health        -> {"ready":true,"model":"…","dimensions":2048,"identity":"…"}
POST /embed         <- {"texts":["…"],"images":["<base64>"]}
                    -> {"vectors":[[float,…],…]}          # 文本在前，图像在后
POST /embed_pages   -> 已废弃，返回错误；页面由桌面端渲染
```

`identity` 由模型文件内容派生，进入索引 namespace；换模型即换索引，不会复用旧向量。

## 与产品的关系

- 产品设置里选 `qwen_local` 并填 `http://127.0.0.1:8765`，`prepare_visual_search_index` 才会调到本服务；
- 服务未启动时产品稳定报 `model_unavailable`，检索退回文本通道，不影响原有使用；
- `qwen_api` 可接收桌面端渲染的页面图片及 MinerU 资产，不需要访问本地 PDF 路径。

## 依赖

真实模式需要：`torch`、`transformers`、`qwen_vl_utils`、`pillow`。**不再需要 PyMuPDF**：页面与区域由桌面应用用 PDFium 渲染后以图片发送（`POST /embed`），服务只负责编码。`--stub` 模式只依赖标准库。

