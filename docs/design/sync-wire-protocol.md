# 同步与文件协议 v1

实现入口 `apps/server`，客户端 `crates/neuink-sync`。发现接口 `GET /.well-known/neuink-sync` 返回 server_id、epoch、protocol_version=1、max_chunk_bytes=4194304。客户端通过局域网 HTTPS 连接，不依赖 SSH。私有请求携带 Authorization: Bearer，账号由会话确定。

## 对象与版本

GET/POST /v1/libraries 列出/创建个人库。POST /v1/libraries/{id}/operations：

```json
{"epoch":"服务器代际","operation":{"operation_id":"重试保持不变","object_id":"本地稳定标识","kind":"note","base_revision":null,"mutation":{"action":"put","content":{"text":"正文","_files":[]}}}}
```

kind 支持 entry/note/annotation/tag/segment_note/card/board/translation/fold/parse_snapshot。创建 base_revision=null；修改、删除、恢复带已知版本。Put/Restore 内容不能为 JSON null；删除 mutation 为 {"action":"delete"}。规范化操作上限 2 MiB。

事务锁定资料库，比较版本，保存对象、历史、库版本和幂等结果。同操作 ID+同请求返回原结果，不同内容复用 ID 被拒绝。版本不匹配返回 409，不覆盖已有内容；删除保留墓碑，恢复必须显式 restore。

GET /v1/libraries/{id}/changes?epoch=...&revision=0 每次最多 4 条（控制最大响应在客户端 16 MiB 上限内），返回 changes/revision/epoch/has_more。内容或冲突可靠保存后才推进游标。GET /v1/libraries/{id}/objects/{object}/versions?before=... 返回最多 4 条倒序历史。epoch 不一致必须重新核对基线。

客户端保存基线、本地、远端；冲突确认带版本令牌，期间任一方改变会拒绝旧确认。目前不自动合并正文，也不提供实时多人编辑。

## 文件传输

标识是 BLAKE3-256 的 64 位小写十六进制，不是路径。单文件上限 2 GiB、单块 4 MiB、默认账号配额 2 GiB（2,147,483,648 字节）。去重及访问限于同账号；未过期上传预留配额。

1. POST /v1/uploads 提交 hash/size。已存在返回 complete=true，否则返回 id/offset/complete=false。先持久保存上传票据。
2. GET /v1/uploads/{id} 查询已提交偏移；PUT /v1/uploads/{id}?offset=... 发送 application/octet-stream。文件 fsync 后提交偏移；响应丢失先查偏移，不能盲目重复发块。
3. POST /v1/uploads/{id}/complete 校验长度与 hash，再登记不可变文件。有效票据可重复完成，有效期 24 小时。
4. DELETE /v1/uploads/{id} 取消并释放预留，先失效再清文件。清理失败返回 503，可重试取消；不存在返回 404。不删除已发布 blob。
5. GET /v1/blobs/{hash} 配 x-neuink-offset，最多返回 4 MiB，x-neuink-size 为总长度。也支持单段 Range: bytes=start-end，最多 4 MiB，返回 206/Content-Range；不支持多段及后缀 Range。客户端下载至暂存文件，完整 hash 校验后才发布。

content 可含保留字段 `_files: [{"hash":"...","size":123}]`，最多 4096 项。每项必须已归当前账号且上传完成，否则 409 attachment_not_ready，防止发布缺失引用。纯文本可省略；业务适配器必须主动声明依赖，服务端不猜测正文路径。上传完成本身不创建条目。

磁盘布局为 storage/uploads/{upload_id} 和 storage/blobs/{account_id}/{hash}，数据库只存清单。字节接口不开放静态目录。已发布 blob 按下述历史保留及候选等待流程回收；过期上传暂存另行定时批量清理。

## 账号与错误

公开 POST /v1/auth/register、login、refresh、reset；私有 GET /v1/me、GET /v1/devices、DELETE /v1/devices/{id}、POST /v1/auth/logout、password。管理员 POST /v1/admin/invites、/v1/admin/reset/{account_id}。

密码为 Argon2id 摘要，至少 12 个字符，不强制字符组合。访问令牌 15 分钟，刷新窗口 30 天、绝对寿命 90 天，轮换使旧令牌失效。客户端先安全保存刷新 request_id，响应丢失后同请求可在 120 秒内重放；超出可恢复范围可能需重新登录，不能清除本地队列。令牌不写正文、同步配置和日志。

错误 JSON 为 {"error":"稳定错误代码"}。400 参数；401 登录；403 权限；404 不存在或无权；409 版本/代际/偏移/附件未就绪，需按代码处理；413 超大小；416 Range；429 限流；507 配额；5xx 暂时失败。网络重试保持 operation_id，传输失败不删除本地编辑。

## Workspace 实体契约 v1（alpha）

`neuink-workspace::sync_export::export_entry` 只读生成 `ExportBundle`。可序列化部分只有 `manifest()`：`schema_version`、原 `entry_id`、`documents`、附件大小、通知和 `required_entities`。文件源位置不参与序列化；读取附件通过内容哈希及最多 4 MiB 的 `attachment_chunk`，发布前必须重新执行 `verify_unchanged`。分块读取本身不代替接收端的完整哈希校验。

每个 `EntityDocument` 含 `schema_version=1`、`entity_id`、`kind`、`payload`、`resources[{name,hash,size}]`、`references`。逻辑实体键为 `entry:<原ID>`、`note:<原ID>`、`annotation:<原ID>` 、`parse:<条目ID>` 和 `tag:<原ID>`；不会重新生成领域 ID。外部标签或其他条目引用列入 `required_entities`，单篇检查通过不表示依赖已经齐全。

- Entry 正文包含清除解析任务、服务地址和消息后的条目元数据，PDF 使用 `paper.pdf` 逻辑资源名；保留原始文件内容并重新计算 BLAKE3。
- ParseSnapshot 的 `segments.json` 附件包含 `schema_version=1`、`format=neuink.source-segments` 及原有片段 ID、类型、坐标、分组和图片引用。导出复用阅读器的内容列表补充逻辑和现有 middle 归一化逻辑，将图片、空白区域、图注坐标与列表子项位置固化后再移除非阅读扩展字段。原始服务响应、配置和路径不直接传输。接收端保存仅含版本与片段文件哈希的 `paper.reading-snapshot.json`，避免遗留原始文件再次改变已固化的快照；用户重新解析会使标记失效。原包继续保留，不自动删除或宣称已经覆盖再次解析等所有原包用途。
- Tag 通过 `export_tags` 只读导出：原 ID、名称、说明、父 ID 与时间；父级为显式引用。接收端按 ID 比较基线，并核对父级存在、无循环、同级名称无冲突；不会按名字合并或自动恢复已归档标签。保留其他本地标签和归档。
- Note 的 `note.json` 同时保存正文、标题、原笔记 ID 和来源链接，是一个逻辑修改与冲突单元。大正文通过附件传输，避免挤占 2 MiB 操作上限。
- Annotation 按原批注 ID 独立导出，保留快照、页码、文字选区和位置。笔记图片及解析图片使用工作区内的相对逻辑资源名，内容哈希相同的附件只计一次。

导出与本机保存共用读写互斥，发现待恢复 journal 时只报告，不执行恢复或写盘。观察到的文件内容（包括原先不存在的 sidecar）在导出结束和发布前核验；缺失附件、坏 JSON、错误归属、重复 ID、不安全路径阻止该篇导出。图片仍为原始字节；外部图片不后台下载，明确显示离线限制。

此模块目前覆盖 Entry、ParseSnapshot、Note、Annotation、Tag 及其跨条目引用。其他约定实体、原解析包的完整恢复用途、大型资源清单及桌面操作入口尚未完成。不得把本地候选清单当作可直接发送的同步操作，也不得以契约测试代替原生客户端验收。

## Workspace 传输与落盘桥接

`neuink-sync::workspace_sync::synchronize_workspace` 为已经明确绑定的 Workspace 提供单次同步；不隐式绑定账号，也不由扫描或登录自动触发。传输前验证 server/account/library/epoch。每份资料库最多一个任务，不同资料库可并行；附件池最多同时传输 3 项。持久暂停、取消、退避及自动调度已接入。

- 操作正文固定为 `{document: EntityDocument, _files: [{hash,size}]}`，附件按哈希去重、排序；接收端校验 `_files` 与实体引用完全相符。超过 4096 个独立附件或操作大小限制的实体会明确失败，不截断清单。
- 本地导出先校验并暂存到资料库内 `.neuink-sync/blobs/<hash>`，再交给持久 SQLite 队列。扫描前取得的保存事件，仅在该次扫描成功覆盖全部相关实体且附件可靠暂存后确认交接；新产生的事件与失败条目的事件保留。交接不表示已经上传成功。
- 所有附件完成上传后才发布引用它们的实体；同账号同内容复用已有附件及活动上传。分块上传只接受服务端明确确认的偏移；重试时重新查询已提交偏移。
- 下载先保存持久入站投影，再校验附件。有效分块保留以续传；完整但哈希错误的缓存隔离后重新下载。网络模块不直接覆盖用户文件。
- `Workspace::apply_sync_entry` 持有元数据锁，按实体比较已知基线与当前本地内容；使用临时目录重建并重新导出，验证规范与引用完整性后，通过 `sync-apply.journal.json` 发布。条目目录元数据最后发布。重开或后续保存前重放恢复记录；已经完成的文件不会重复覆盖。
- 发生本地修改时保留双方和恢复记录，拒绝陈旧覆盖。SQLite 投影只在文件可靠发布后确认；写完文件但尚未确认时崩溃，重试仍幂等。冲突实体不会阻塞独立可应用的实体。
- 删除与恢复通过明确生命周期事件传播；扫描缺失不视为删除。本地回收站中的条目不由普通下载隐式恢复；整组冲突须明确选择。上传前对当前整库清单反复核对依赖，缺失来源、解析或标签的整篇暂停；完整的循环来源引用允许同步。入站先应用标签，再将互相引用的条目作为一组，由 `Workspace::apply_sync_entries` 校验后共用恢复日志发布。已有本地依赖只参与核对，不被无故覆盖。

`crates/neuink-sync/tests/workspace_contract.rs` 使用两份独立临时 Workspace 和新云端库，走实际 Java/PostgreSQL HTTPS 服务。显式配置 `NEUINK_CONTRACT_URL`、测试账号的 `NEUINK_CONTRACT_USERNAME/PASSWORD` 后执行 `cargo test -p neuink-sync --test workspace_contract -- --ignored`；私有证书可通过 `NEUINK_CONTRACT_CA` 提供可信证书文件，仍验证 TLS 和主机名。测试只生成合成 PDF、图片、笔记和批注，绝不读取 portable/data。默认测试忽略此联网用例；需要部署测试服务后显式执行。测试账号应独立，创建的云端测试库留作核查，尚未实现自动安全回收。

跨论文与标签的真实联网测试为 `dependencies_contract`：两篇同名但不同 ID 的合成论文、相互引用的笔记及图片、父子标签完成初次重建与 B → A 更新。快照与依赖专项测试覆盖稳定哈希、原始配置不上传、补充文件变化使预览失效、缺失依赖不部分发布、标签环和陈旧修改拒绝。


## 2026-11-10 增量保留、重建及整组删除

- `POST /v1/libraries/{id}/operations/delete-group` 接收 `{epoch, operations:[Operation...]}`；仅接受 delete，最多 4096 个不同对象、请求最多 2 MiB。同一事务检查全部版本并写入墓碑与幂等回执；任一冲突回滚整组。返回与输入顺序一致的 `revisions:[{operation_id, revision}]`。客户端按所属条目组成删除批次，无关条目分别提交；不支持该接口的旧服务不能回退为逐项删除。
- 非当前历史从被替换或删除时起保留 30 天，当前对象和墓碑标识不自动过期。库的 `minimum_revision` 是删除历史后的安全游标下限；旧游标返回 `409 cursor_expired`。客户端在上传附件和对象前检查游标，失败保留队列。
- `GET /v1/libraries/{id}/snapshot?epoch=...&revision=-1&after=` 开始完整快照；随后带返回的 revision/after，最多每页 4 项。任何分页之间的库版本变化返回 `409 snapshot_changed`。返回 objects/revision/epoch/after/has_more/minimum_revision，含墓碑。
- 重新核对先观察本地已保存内容，再比较旧基线、本地与完整快照；预览令牌涵盖本地、远端和代际。确认重读并核对令牌后，原队列与基线归档；不因云端缺失删除本地内容。有效协议 epoch 独立持久化，新的幂等标识使用新 epoch，旧 Workspace 事件绑定保留用于安全交接。
- `POST /v1/libraries/{id}/preview` 接收 files（hash/size）和 ids，每组最多 4096 项。仅同账号已完成附件参与去重，返回新增附件、重复附件与重叠对象数量；正文大小由客户端估算，不是空间预留。
- `GET /v1/storage/cleanup` 预览可提前清理的非当前历史，`POST` 携带 token 确认。期间变更返回 `409 cleanup_preview_changed`；当前正文不删除。清理产生审计与游标下限更新。
- 附件检查当前对象、保留历史、未过期上传的引用。无引用候选等待 7 天后重新检查；重新引用取消候选。数据库先记录 deleting 并撤销发布资格，再移除文件；中断后重试，重新上传的同哈希附件不会被旧任务误删。提前清理正文不跳过附件等待期。

原始解析 ZIP/中间 JSON 仍留在本地；同步的阅读快照及图片不承诺恢复整个原始解析工程。界面明确显示这一范围，不删除原材料、不上传未经审计的原始扩展字段。

### 构思来源关联（2026-11-11）
board:ideation 保持现有实体格式和 references 列表，卡片/关系的 entry_id 仍保留来源身份。已确认构思自带正文、摘录与画布结构；这些条目引用表达来源追溯，不构成预览、上传或接收的硬依赖。来源删除、清空或尚未到达另一设备，不阻断构思快照同步；其他实体的结构依赖检查不变。接收端继续核验 payload 与 references 一致、标识合法、版本及并发修改，未确认 AI 草稿仍禁止同步。无需重写本地构思文件或服务端迁移；旧客户端仍可能按旧规则报未就绪，应升级参与同步的桌面端。

### 数值精度与同步阶段（2026-11-11）

客户端 JSON 读取必须保留浮点数往返精度。批注选区等坐标参与实体内容及确认基线比较，不能在读取时改变最低有效位，也不应通过舍入、容差比较或丢弃队列规避差异。Rust 工作区启用 serde_json 的 float_roundtrip；不改变实体 schema 或坐标格式。旧客户端仍可能制造精度差异，参与同步的客户端应采用相同精确读取规则。

进度事件新增 scanned/scan_total（前端按可选字段兼容旧事件）；字节只统计当前上传或下载方向，核对阶段独立报告条目数。已确认且内容一致的完整条目可跳过附件暂存，但导出仍校验当前本地文件；待发布内容仍必须完整暂存和验证。无入站应用时复用应用前扫描的失败结果，不再做第三次全库扫描；有入站写入时仍重查依赖与本地变化。
