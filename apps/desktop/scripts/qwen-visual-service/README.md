# Qwen3-VL-Embedding-2B 视觉编码服务

桌面端不加载视觉模型，也不做 PDF 光栅化。这个本地服务同时负责两件事：

1. 把原生 PDF 的页面与四个几何区域渲染并编码；
2. 把 MinerU 解析出的图表资产字节编码。

两者输出到同一个向量空间，产品侧只保存"资产字节"和"服务返回的向量快照"。

## 启动

```powershell
# 假向量（不加载模型，用于整链测试）
python service.py --stub --port 8765

# 真实模型（需要 transformers / torch / qwen_vl_utils / PyMuPDF）
$env:NEUINK_QWEN_VL_MODEL = 'D:\models\Qwen3-VL-Embedding-2B-...'
python service.py --port 8765
```

| 环境变量 | 含义 |
|---|---|
| `NEUINK_QWEN_VL_MODEL` | 模型目录，需含 `scripts/qwen3_vl_embedding.py` |
| `NEUINK_EMBED_DIM` | 输出维度，默认 2048 |
| `NEUINK_PDF_DPI` | 页面渲染 DPI，默认 110 |

## 协议

```text
GET  /health        -> {"ready":true,"model":"…","dimensions":2048,"identity":"…"}
POST /embed         <- {"texts":["…"],"images":["<base64>"]}
                    -> {"vectors":[[float,…],…]}          # 文本在前，图像在后
POST /embed_pages   <- {"pdf_path":"…","pages":[0,1],"regions":true}
                    -> {"vectors":[{"page":0,"region":null,"vector":[…]},
                                   {"page":0,"region":0,"vector":[…]}, …]}
```

`identity` 由模型文件内容派生，进入索引 namespace；换模型即换索引，不会复用旧向量。

## 与产品的关系

- 产品设置里选 `qwen_local` 并填 `http://127.0.0.1:8765`，`prepare_visual_search_index` 才会调到本服务；
- 服务未启动时产品稳定报 `model_unavailable`，检索退回文本通道，不影响原有使用；
- `qwen_api` 走远程同协议服务，但**没有页面源**（远程读不到本地 PDF），其快照只含 MinerU 资产。

## 依赖

真实模式需要：`torch`、`transformers`、`qwen_vl_utils`、`pillow`、`pymupdf`（`pip install pymupdf`）。`--stub` 模式只依赖标准库，可在没有任何模型的环境里验证整条产品链。
