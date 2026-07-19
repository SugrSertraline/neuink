# P0 回归清单

> 最后核对：2026-07-15

## Workspace 与 Entry

- [ ] 选择或打开 Workspace 后可以创建 Entry，并在重启后恢复。
- [ ] Entry 标题、Field 和 Tag 更新后重新读取一致。
- [ ] 删除进入回收站；恢复后 PDF、笔记和元数据完整。
- [ ] 彻底删除只影响明确选择的回收站 Entry。
- [ ] 左右 pane、tab、焦点和分隔比例不会串到错误 Entry。

## PDF、Parser 与 Reflow

- [ ] 导入 PDF 后状态按 queued、processing、succeeded/failed 更新并落盘。
- [ ] 解析失败可以复用原 PDF 重试，不生成第二个主 PDF。
- [ ] PDF 页面、Segment overlay、rail 和右侧内容定位一致。
- [ ] Reflow 的标题、段落、列表、公式、表格和视觉块顺序正确。
- [ ] 隐藏/恢复、列表项复制和 hover preview 不改变证据 Segment。
- [ ] 全文翻译支持暂停、继续、失败重试和导出。

## Markdown 与 Source Link

- [ ] 自动保存后重新打开正文一致。
- [ ] 表格增删行列、公式、图片和提示块可保存并恢复。
- [ ] 插入同一 Segment 时复用 Source Link，不产生重复 sidecar。
- [ ] Source Link 可展开、打开来源、复制引用和删除。
- [ ] 删除正文链接后，未引用 sidecar 记录被清理。
- [ ] 同 Entry 和跨 Entry 跳转都定位到正确 Segment。
- [ ] 导出 Markdown 生成可读 Sources 脚注。

## 搜索

- [ ] Entry、Tag、Field、Note、Page 和 Segment 结果能打开正确目标。
- [ ] Keyword、Semantic、Hybrid 返回模式和警告与实际执行一致。
- [ ] Embedding 模型缺失时明确不可用并安全回退。
- [ ] 重建索引后内存、磁盘状态和记录数量一致。
- [ ] 删除或修改 Entry 后旧结果不会长期残留。

## Assistant 与 Proposal

- [ ] `@` 读取对象、证据对象和编辑目标角色明确且不串位。
- [ ] 没有唯一写入目标时追问，不从久远 Pending Plan 猜测。
- [ ] TaskState 保存 taskId、目标、操作、授权和完成状态。
- [ ] 论文结论包含有效 Evidence；引用失败不能伪装成功。
- [ ] Verifier 阻断后不展示可 Apply 的正常 Proposal。
- [ ] Apply 只提交 taskId 和 proposalId。
- [ ] Apply 使用已验证的精确目标，不使用当前 UI 选择猜测。
- [ ] 基础正文变化时返回冲突，不覆盖用户新内容。
- [ ] 同一 Proposal 重复 Apply 不产生重复写入。
- [ ] Note 正文和 Source Link 写入中断后可以恢复或回滚。
- [ ] Apply/Reject/取消/新任务正确关闭旧 Task。
- [ ] Conversation、TaskState、AgentRun 和 Proposal 状态重启后可恢复。

## 构建

- [ ] `npm run check` 通过。
- [ ] `npm run test` 通过。
- [ ] `npm --workspace apps/desktop run test:frontend` 通过。
- [ ] `npm run desktop:build` 通过。
- [ ] 无 Embedding 模型的干净 checkout 仍可启动，Semantic 显示不可用。
