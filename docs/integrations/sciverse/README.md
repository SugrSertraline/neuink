# Sciverse integration notes

本目录保存 Sciverse 官网文档快照和 Neuink 接入前的边界说明。

## Source snapshot

抓取时间：2026-07-20（Asia/Shanghai）

来源：

- [Sciverse docs overview](https://sciverse.space/docs#overview)
- [agentic-search](https://sciverse.space/docs/sciverse/api/agentic-search)
- [content](https://sciverse.space/docs/sciverse/api/content)
- [resource](https://sciverse.space/docs/sciverse/api/resource)
- [meta-catalog](https://sciverse.space/docs/sciverse/api/meta-catalog)
- [meta-paper-relations](https://sciverse.space/docs/sciverse/api/meta-paper-relations)
- [meta-search](https://sciverse.space/docs/sciverse/api/meta-search)
- [paper-schema](https://sciverse.space/docs/sciverse/api/paper-schema)

原始 HTML 快照位于 [`source/`](./source/)；这些文件保留官网当时的页面内容，使用时仍应以官网和账号权限为准。

## API capabilities

| API | 作用 | 关键标识/返回 |
| --- | --- | --- |
| `agentic-search` | 自然语言语义检索，返回可引用的文献片段 | `chunk_id`, `chunk`, `doc_id`, `offset`, `page_no`, metadata |
| `content` | 按 `doc_id` 读取全文或上下文片段 | `text`, `chars_returned`, `next_offset`, `more` |
| `resource` | 按相对 `file_name` 下载论文图片、表格等二进制资源 | `doc_id`, `file_name` |
| `meta-search` | 按结构化条件筛选、排序和导出论文元数据 | `unique_id`, `doc_id`, fields, page/cursor |
| `meta-catalog` | 运行期返回 `meta-search` 的字段、算子和样例值 | field capabilities, operators, default fields |
| `meta-paper-relations` | 分页读取引用、被引和相关工作关系 | `unique_id`, relation, items, total pages |
| `paper-schema` | 查看论文元数据字段定义/结构 | schema and field definitions |

共同约束：HTTP Bearer API Token；字段和能力可能按账号权限裁剪；调用方要处理 `401`、`429`、`502/503` 等错误，不能把 API 返回直接当作最终答案。

## Important identifier boundary

- `doc_id` 用于 `content` 读取全文，也出现在 `agentic-search` / `meta-search` 结果中。
- `chunk_id` 标识一次语义检索命中的证据片段。
- `unique_id` 用于 `meta-paper-relations`，不能用 `doc_id` 替代。
- `offset` / `next_offset` 按 Unicode 字符计数，不是字节；长文应按段读取。

Neuink 现有本地 `SourceLink` 面向本地条目、笔记和片段标识。Sciverse 来源应先使用独立的外部证据模型，至少保存 `provider`, `doc_id`, `chunk_id`, `unique_id`, `offset`, `page_no`, `title`, `doi` 和原始请求信息；确认导入本地工作区后，才建立本地条目或笔记链接。

## Implemented Phase 1

当前代码已完成第一阶段只读接入：

- 独立 Rust crate `neuink-sciverse` 封装 Bearer 鉴权、超时、5xx 重试、`agentic-search`、`content` 和连接探测。
- 设置页“外部服务”可启用 Sciverse、保存 Token、测试连接。Token 写入操作系统凭据库；配置文件只保存凭据引用。
- 也可在启动 Neuink 的进程环境中设置 `SCIVERSE_API_TOKEN`，该值优先于系统凭据库。
- 助手启用两个显式工具：`search_sciverse_evidence` 和 `read_sciverse_content`。远程引用持久化为 `provider: sciverse`，不会伪造本地 `entry_id` 或 `segment_uid`。
- 远程证据可以用于问答引用，但暂不转换为本地笔记来源链接，也不会自动导入条目、PDF 或附件。

使用步骤：打开“设置 -> 外部服务”，输入 Token，启用 Sciverse，保存并测试连接。连接成功后，新一轮助手任务会按需看到 Sciverse 工具。真实联网验收需要账号具有相应 API 权限。

## Candidate features for Neuink

### Phase 1: external evidence search

1. 在助手面板增加 Sciverse 检索源开关。自然语言问题调用 `agentic-search`，结果以证据卡片展示，并保留标题、片段、页码/offset、`doc_id` 和 `chunk_id`。
2. 证据卡片提供“读取上下文”。使用 `content` 按 `offset` 分段加载前后文，支持 `more/next_offset` 继续读取；不一次性假设长文可完整返回。
3. 将外部证据作为可移除的助手上下文项，沿用现有 assistant context 的选择/引用流程，但不伪造为本地 `SourceLink`。

### Phase 2: paper discovery and import

1. 增加 Sciverse 论文检索页，使用 `meta-catalog` 动态生成年份、期刊、语言、作者、引用数等筛选器，再调用 `meta-search`。
2. 支持结果分页、字段选择和导出；深分页使用 cursor，并区分 `query` 相关性搜索与字段硬排序。
3. 对选中的论文执行“导入为条目”：保存元数据、`doc_id`、`unique_id` 和 DOI，必要时再读取正文或附件。导入应是显式动作，不能因为助手搜索就自动写入工作区。

### Phase 3: full text and resources

1. 在论文详情/阅读面板按段读取 `content`，保留来源范围，支持从证据片段跳转到上下文。
2. 对正文中的图片/表格路径调用 `resource`，缓存到条目资源目录，并在阅读器或笔记中展示。
3. 将外部正文转成 Neuink 可管理的快照时，保留原始 `doc_id`、抓取时间和 API 来源，避免把远端内容误当成本地解析 PDF。

### Phase 4: relation exploration

使用 `meta-paper-relations` 构建引用/被引/相关工作面板。关系入口必须基于 `unique_id`，并与语义证据检索分开；关系列表中的论文仍需通过 `meta-search` 或 `agentic-search` 补齐可展示的元数据和证据片段。

## Integration decisions to settle before coding

- API Token 放在桌面端安全设置中，不能进入仓库、前端构建产物或普通日志。
- 远端调用放在统一 provider/client 层，UI 不直接拼接 URL；请求超时、限流、重试和权限错误要统一映射。
- 外部证据、已导入论文和本地条目分别建模；不能用一个 `entry_id` 字段覆盖三者。
- 先实现 Phase 1 的只读检索和上下文读取，再决定是否导入、缓存和资源下载。
- 账号权限、配额、全文可用性和字段裁剪都属于运行期事实，客户端必须允许字段缺失。
