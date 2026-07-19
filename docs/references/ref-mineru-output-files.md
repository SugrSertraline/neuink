# MinerU 输出与 Neuink 接入约定

> 本文只记录 Neuink 当前消费的 MinerU 产物。完整上游格式应查对应 MinerU 版本文档，不在仓库复制维护。

## 1. 输入优先级

Neuink 从 Parser JSON 响应或结果 zip 中按以下顺序归一化：

1. 已符合 Neuink document/segments 结构的结果；
2. `content_list_v2`；
3. `content_list`；
4. 顶层数组形式的上述内容。

Zip 内接受：

```text
*_content_list_v2.json
content_list_v2.json
*_content_list.json
content_list.json
*_middle.json
images/**
```

`content_list_v2` 优先于旧 `content_list`。`middle.json` 用于补充 bbox、阅读顺序、块角色、视觉组合和空视觉区域，不作为正文的唯一来源。

相关实现：

- `crates/neuink-parser/src/normalizer.rs`
- `crates/neuink-parser/src/mineru_middle.rs`
- `crates/neuink-parser/src/cloud_mineru.rs`
- `crates/neuink-parser/src/custom_endpoint.rs`

## 2. Workspace 中保留的产物

解析产物保存在：

```text
entries/<entry-id>/mineru-output/
```

Neuink 会把找到的文件提升为稳定名称：

```text
paper_content_list_v2.json
paper_content_list.json
paper_middle.json
paper_model.json
full.zip
```

并把归一化后的证据层写为：

```text
entries/<entry-id>/paper.segments.json
```

运行时阅读、搜索、引用和翻译主要使用 `paper.segments.json`；原始 MinerU 文件用于资产解析、补充信息和排错。

## 3. Neuink 使用的通用字段

不同 MinerU 后端字段会变化，归一化器重点读取以下语义：

| 语义 | 常见字段 |
|---|---|
| 块类型 | `type`、`block_type`、`sub_type` |
| 页码 | `page_idx`、页面数组索引 |
| 坐标 | `bbox`、`poly` 等可归一化区域 |
| 正文 | `text`、`content`、块类型专用 payload |
| Markdown | 公式、代码、表格、列表的结构化内容 |
| 图片资产 | `img_path`、`image_path`、`image_source.path` |
| 标题/说明 | caption、footnote 等块内结构 |
| 阅读结构 | `block_role`、列表/视觉组合和 continuation 信息 |

未知字段可以保留为 `mineru_metadata`，但业务逻辑不能依赖未测试的上游偶然字段。

## 4. Segment 类型

归一化结果使用当前领域枚举：

```text
paragraph
heading
table
math
figure
code
list
page_header
page_footer
page_number
aside_text
page_footnote
```

每个 Segment 至少要有稳定 uid、类型、页码和可用于阅读或定位的内容。bbox、Markdown、asset path 和 MinerU metadata 可以为空。

视觉块即使没有正文，只要有有效图片路径或区域，也应保留为 figure/table 等 Segment，避免 Reflow 丢图。

## 5. 图片与路径

- zip 中的 `images/**` 随 MinerU 输出解压保存；
- 资产引用必须解析到当前 Entry 的 `mineru-output` 内；
- 禁止接受路径穿越或把绝对外部路径当作可信资产；
- Source Link 保存的是 Segment 和快照，不直接把上游临时 URL 当作长期证据。

## 6. Middle JSON

`paper_middle.json` 当前用于：

- 匹配页面与块区域；
- 补充或修正 bbox；
- 恢复列表、caption、footnote 和视觉块关系；
- 重建缺失的空视觉区域；
- 清理与新 middle 结果冲突的旧派生区域。

Middle enrich 必须是可重复的：同一输入重复执行不能持续制造重复 Segment。

## 7. 接入新 MinerU 版本

升级前至少验证：

- content list 顶层是数组、分页数组还是包装对象；
- 页码从 0 还是 1 开始；
- bbox 坐标系和页面尺寸；
- 表格、公式、代码、列表、图片、caption 和 footnote；
- 只有图片没有文本的视觉块；
- `middle.json` 页面匹配；
- zip 文件命名和嵌套目录；
- 旧格式回归用例仍通过。

不要仅更新本文。必须同步增加 `normalizer.rs` 或 `mineru_middle_regression_tests.rs` 的测试样本。
