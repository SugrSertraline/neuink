# Zotero 本地优先同步架构研究

核验日期：2026-11-08。用途：为 NeuInk 自研同步提供架构依据；这是外部参考研究，不表示 NeuInk 已实现下述能力。只核验官方文档、官方仓库及 Zotero 团队发言，未运行 Zotero 双端同步或自部署服务器。

## 1. 本地使用、数据同步、附件同步是不同层次

Zotero 默认在本机保存资料，联网同步是附加能力。条目、笔记、标签等结构化数据通过 Zotero 数据服务同步；PDF 等附件字节另走 Zotero Storage 或 WebDAV。可以只开数据同步。WebDAV 只支持个人库附件，不能承载群组库附件，也不提供 Zotero 网页端的附件访问能力。因此，“配置 WebDAV”不等于“整个资料库不经过 Zotero 服务”。[官方同步说明](https://www.zotero.org/support/sync)

本地 `zotero.sqlite` 存主要业务数据，`storage` 存导入的附件；同步协议不等于搬运整个数据库文件。官方也明确区分同步与备份：服务端保存当前库状态，误操作可能传播，应另有历史备份。[数据目录与备份](https://www.zotero.org/support/zotero_data)

附件可以在同步时全部下载，也可以打开时再下载。因此数据已同步不代表附件已在本机可离线使用。另外，“同步全文”可把从 PDF 等文件抽取的文本传到数据服务；附件放在自有 WebDAV 并不自动阻止这类文本同步。[同步设置](https://www.zotero.org/support/preferences/sync)

## 2. 版本、冲突与删除

官方同步方案的关键机制：

- 客户端保存库版本、对象版本和 `synced`；普通本地修改置脏，不自行递增服务端对象版本。
- 服务端版本单调递增，允许跳号；客户端通过 `since` 获取变化及删除记录。
- 保留已同步对象的原始 JSON，比较基线、本地和远端；互不冲突的修改可合并，条目的同字段冲突交给用户；其他对象有自动恢复规则。文档声明冲突算法未完整描述。
- 本地删除写入删除日志，远端确认后清除；“删除与修改并发”需要冲突处理，不能把远端缺项一概当删除。
- 下载期间若库版本变化，重试；下载失败时不能仅推进游标而永久漏掉对象，需停止或保留显式重试清单。

上述是官方推荐流程，不能仅据此宣称实现了全部客户端行为。[Web API 同步规范](https://www.zotero.org/support/dev/web_api/v3/syncing)

修改已有对象的写接口要求版本前置条件：使用 `If-Unmodified-Since-Version` 或对象 JSON 的 `version`。批量返回区分成功、未变化和失败对象，客户端必须逐项处理；删除接口也有前置条件。实现时应采用条件写与明确的重试结果，而非时间戳较新者无条件覆盖。[Web API 写请求](https://www.zotero.org/support/dev/web_api/v3/write_requests)

WebSocket 只通知“库发生变化”，不传完整更新；收到通知后仍走正常同步流程，连接建立后也要补拉一次。推送属于降低延迟的手段，不能替代可恢复的增量同步。[Streaming API](https://www.zotero.org/support/dev/web_api/v3/streaming_api)

## 3. 附件传输也需要并发保护

Zotero Storage 的完整上传分为授权、传文件、登记上传。修改现有文件使用旧文件 hash 的 `If-Match`；远端已变更会返回 `412`，冲突由客户端解决。上传登记才更新附件元数据。个人 WebDAV 模式允许直接更新附件条目的 `md5` / `mtime`，其协议边界与 Zotero Storage 不同。[附件上传协议](https://www.zotero.org/support/dev/web_api/v3/file_upload)

**对 NeuInk 的推论：**仅支持 WebDAV 的 PUT/GET 不足以完成资料库同步；还需自行定义对象身份、版本、删除、冲突、文件提交完成标记和失败恢复。若使用内容 hash，应独立选定算法与用途，不因参考 Zotero 就照搬 MD5 作为新的安全设计。

## 4. 源码、许可证与自部署现实

| 事项 | 已核验证据与边界 |
| --- | --- |
| 服务端源码 | 官方公开 [zotero/dataserver](https://github.com/zotero/dataserver)。源码可获取不等于存在受支持的一键私有部署产品。 |
| 服务端许可证 | `COPYING` 明示 AGPLv3；网络运行修改版涉及第 13 条的对应源码提供要求。直接复用代码时须按具体组合、修改与发布方式核对义务。[服务端许可证原文](https://raw.githubusercontent.com/zotero/dataserver/master/COPYING) |
| 客户端许可证 | 当前客户端 `COPYING` 同样明示 AGPLv3，不应将客户端同步实现当作宽松许可证工具库直接拷贝。[客户端许可证原文](https://raw.githubusercontent.com/zotero/zotero/main/COPYING) |
| 部署维护成本 | Zotero 团队在 2020 年解释：托管系统关联大量基础设施，自部署版还需要持续处理数据库升级、依赖、运维及客户端兼容。这是持续工程工作。[团队解释，Issue #105](https://github.com/zotero/dataserver/issues/105#issuecomment-701854388) |
| 支持状态的证据时点 | 团队在 2022-11 明确称技术上可自建，但困难、无部署文档支持，也不支持接入外部服务器的客户端问题；当时可用隐藏的 `extensions.zotero.api.url` 配置地址。这是带日期的团队声明，不是本研究实测的当前全部平台兼容保证。[官方团队答复](https://forums.zotero.org/discussion/101115/understanding-synchronisation-options) |

当前官方服务端依赖清单包含 AWS SDK、Elasticsearch 客户端等，可以作为维护评估入口；清单本身不能推出“每个部署都必须具备相同规模的 AWS 环境”。[服务端依赖清单](https://raw.githubusercontent.com/zotero/dataserver/master/composer.json)

## 5. 对 NeuInk 的建议与未验证项

以下为本研究的设计判断，不是 Zotero 对 NeuInk 的兼容承诺：

1. 优先借鉴“本地完整可用、结构化对象与附件分流、版本条件写、删除日志、三方冲突处理、可恢复游标”的机制，为 NeuInk 自身领域模型设计协议。
2. 将“使用同一 WebDAV 服务”“读写 Zotero 数据”“兼容 Zotero 同步协议”“自部署 Zotero 服务端”列为四种不同目标，分别估算和验收；共享存储位置不能证明数据互通。
3. 第一阶段可只覆盖个人多设备同步，把共同编辑和复杂群组权限留作独立范围。无论是否推送，都先验证断网修改、双端同改、删除对修改、附件传输中断、部分失败、旧客户端与恢复备份后的行为。
4. 若决定直接复用 dataserver 或客户端代码，先完成目标客户端/服务端版本的互通试验、许可证核对及升级恢复演练，再决定是否成为产品底座。

尚未验证：实际 WebDAV 服务商的条件请求与失败行为、Zotero 各桌面/移动版本对私有端点的支持、dataserver 当前部署步骤及其与 NeuInk 领域模型的适配成本。本研究不提供“即插即用”“完全兼容”或“零运维”的结论。
