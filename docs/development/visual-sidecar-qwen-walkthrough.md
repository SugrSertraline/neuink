# visual-sidecar-qwen 合入记录

多向量召回池、远程重排指令、第一阶段 RRF 融合和单次 Listwise 已接进 `feat/visual-sidecar-qwen`。四项默认关闭。缺 `colbert_linear.bin`、缺 `sparse_linear.bin`、模型不是本地 BGE-M3，或 Listwise 解析不足 10 条时，搜索保持上一步排序并写下固定原因码。

`scope_rerank` v6 文件仍在。配置校验拒绝同时打开 scope refine 和 Listwise。

未完成原生 Tauri 视觉验收。设置页的开关、互斥和保存失败由 Vitest 覆盖。需要目视时，先关闭便携版 `D:\NeuInk\Neuink.exe`，再在本目录运行 `npm --workspace apps/desktop run dev:d-data`。
