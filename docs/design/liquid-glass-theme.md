# 玻璃：调研结论与实现方案

研究日期：2026-09-15，2026-09-16 核对 Apple 当前系统设计并修订材质。范围：NeuInk Windows / Tauri WebView2 的独立外观扩展。

## 调研依据

- [Apple HIG · Materials](https://developer.apple.com/design/human-interface-guidelines/materials)：Liquid Glass 用于导航和控件，与内容层区分。文字较多的侧栏、菜单使用 Regular；Clear 适合媒体背景。避免过量使用与玻璃叠玻璃。
- [Apple WWDC25 · Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)：边缘反光、光学分层与交互变化共同表达材质；强调环境适应、滚动边缘的可读性及辅助功能。
- [Apple · macOS 27 更新说明](https://support.apple.com/en-us/127257)（2026-09-14）：继续改善玻璃可读性，统一工具栏与延伸至窗口边缘的侧栏，支持更清透至着色的材质调节。
- [Apple WWDC26 · Modernize your AppKit app](https://developer.apple.com/videos/play/wwdc2026/289/)：侧栏内容仍从材质下流过，强调容器和内部控件的轮廓协调；交互弹性应克制使用。当前 WebView 实现保留现有控件几何，不模拟整组位移。
- [Apple · Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)：自定义界面需要验证减少透明度、减少动态效果等设置，不能假定自定义组件会自动获得系统行为。
- [MDN · backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter)：透过半透明背景处理后方像素；父级形成 backdrop root 时会影响取样范围。
- [MDN · 减少透明度](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency)、[减少动态效果](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)：按浏览器可获得的用户偏好调整呈现。

## 对本产品的取舍

根据整窗截图反馈，玻璃采用中性背景、半透明导航和实色阅读内容的分层。外壳只绘制一次中性光场；条目库、设置和阅读区域使用中性底色，不重复铺蓝紫渐变。正文、次要文字和分隔线不染蓝，强调色只用于主操作、选中状态和链接。保留左右分屏、行高和密度，取消白色面渐变、四面凸边与按钮投影；细反射边和后方实际内容表达材质，悬浮阴影仅用于外壳和浮层。

普通按钮使用 35% 白底、悬停 60%、输入 22%，在浅色工作区仍保留清楚轮廓；主按钮使用 90% 蓝底及白字，以区分主次操作。导航覆盖率 26%，浮层 44%，阅读栏滚动后 50%、滚动中 58%。导航、独立控件和浮层分别使用 14px、3px、16px 背景模糊，饱和度统一为 110%，避免重复放大底色。浮层透出表格标签、选中行或阅读内容的色彩，同时保持自身文字清晰。

侧栏标题和分组共用一层材质，以细分隔线维持拖动和层级提示。工具栏和浮层内的按钮直接透出该层，不重复模糊或创建独立折射；分段选择器同样共用底色。悬停只强化局部反光，点击即时改变底色，命中区域不位移。开关选中轨道保留明确强调色。降低透明度关闭模糊与折射，主按钮恢复实色。

## 开源复刻核对

- [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react/tree/ac48eab18d1f7f444ae30002d240cae29c863a21)，MIT。核对 src/index.tsx、src/shader-utils.ts：背景层与内容层分离；鼠标位置驱动反光；SVG 位移图制造折射。整套组件带独立包装、弹性位移和尺寸逻辑，不直接替换本项目的 Radix/Button，以免改变密集布局和拖动坐标。
- [shuding/liquid-glass](https://github.com/shuding/liquid-glass/tree/a2d2e847f793430e3409a52927af815a23f4d372)，MIT。核对 liquid-glass.js：程序生成位移贴图，通过 SVG feDisplacementMap 处理 backdrop。借鉴技术路线，在本项目独立实现圆角边缘法线位移曲线与生命周期；未运行或嵌入其控制台脚本。
- [LeonardSEO/liquid-glass-react](https://github.com/LeonardSEO/liquid-glass-react)：README 对中性中心／边缘位移的说明与上述路线一致，作为对照；未引入其代码或依赖。

选择 SVG + CSS，而不是引入 WebGL/三维场景库：所需效果是现有控件背后的像素取样、边缘反光和指针高光，不需要复制页面内容或建立整页持续渲染循环。开源演示站在本环境访问超时，结论依据仓库源码与本地组件验证，不声称已完成远端演示操作验证。

| 区域 | 呈现 |
| --- | --- |
| 标题栏、活动栏、侧栏、页签栏 | 统一的半透明导航层，侧栏带圆润轮廓，活动入口和页签为玻璃胶囊 |
| 搜索、对话、标签阅读 | 同一套外壳、工具条、输入和选中规则 |
| 侧栏分组、内部工具条 | 融入外层玻璃，以细线分组；保留折叠与拖动分隔条 |
| 按钮、页签、开关、输入框 | 半透明表面，局部高光随鼠标变化，反射边改变方向；沿用现有尺寸，按钮采用胶囊轮廓 |
| 菜单、搜索弹窗、HoverCard | 背景模糊与边缘折射叠加；内容文字保持清晰，保留焦点环和键盘操作 |
| 条目概览 | 完整标题、描述与阅读入口合并，统计收成紧凑行；摘要半透明，标签、属性和文件信息用细分隔线组织，减少重复底板 |
| 概览与 PDF 操作栏 | 共用悬浮框架，距边缘留小间隔；背景模糊、边缘折射与指针反光，内容滚动经过后方，工具栏始终可用 |
| PDF 选中文字浮层、笔记格式工具条 | 复用原交互及共享 Button，浮层使用背景折射与细反射边，格式状态和键盘焦点保持可见 |
| 论文表格、固定列／表头、PDF、笔记 | 不透明阅读表面；不模糊文字、批注与选区 |
| Logo 与图标 | 沿用本地书页／笔尖 Logo 和 Lucide；书房物件图标仅在书房显示 |

## 进入、切换与退出

在全局搜索或搜索侧栏输入完整 `theme`（忽略首尾空格和大小写），显示“标准 / 拟物 / 玻璃”三项。点击或方向键选择后按 Enter 才切换；输入本身不触发，输入法确认不触发。当前风格带明确标记。也可以在“设置 → 外观与界面”中切换，两处共用相同外观状态。

玻璃模式下，同一菜单提供“降低透明度”；开启后明确标记实色状态，并提供“恢复通透效果”。它只改变材质，可连续调整；状态栏“退出玻璃”恢复原配色。外观和降低透明度分别持久化，旧书房偏好兼容；存储受限时先本次生效并提示保存失败。

## 工程边界

- 复用 AppearanceProvider、AppearanceCommand、现有共享控件及 `data-material` 标记。新增 `data-appearance="liquid-glass"`，所有颜色集中于 theme.css，外壳与浮层在 liquid-glass.css，共享控件在 liquid-glass-controls.css。
- AppearanceProvider 只拥有外观偏好，不拥有条目、编辑器或搜索数据；切换时不替换子树。书架偏好独立，玻璃恢复原列表。
- 搜索状态与键盘选择由 SearchPanel／SearchDialog 和 Command 管理，CommandList 滚动；对话消息滚动由 AssistantPanel 管理；侧栏比例与拖动仍由 SidebarPanelGroup 管理。useGlassMaterial 只拥有瞬时视觉变量；一组被动指针监听不阻止事件，不设置 pointer capture，不接管滚动或拖动手势。
- 指针事件只更新最新采样，合并到下一帧后写入当前控件及最近工具条／弹层的 CSS 变量，不触发 React 逐帧渲染。按下、拖动、滚动、失焦、离开窗口及退出主题清理光影；释放后恢复悬停。
- glassOptics 在 Chromium/WebView2 上对浮层与当前独立悬停控件生成 SVG 背景折射；已在材质容器内的控件只更新光影，不叠加滤镜。图像只包含几何位移，不读取论文/笔记像素；中心中性、边缘弯折、文字不参与滤镜。ResizeObserver 仅在尺寸变化时更新，最长边 384px，缓存最多 24 张，最多 12 个同时活动滤镜。其他引擎保留 CSS 材质。
- 不引入三维或动画依赖，不设持续渲染循环。它不等同于 Apple 原生渲染，不包含内容亮度自动反转或控件弹性形变。列表不逐行创建滤镜。
- ReaderSurfaceFrame 只拥有工具栏尺寸和瞬时滚动材质，各阅读器仍拥有数据与唯一正文滚动区。仅在玻璃模式以叠放网格悬浮操作栏；ResizeObserver 测量实际高度，为首屏、片段导航和内嵌笔记留出位置。PDF 页码／证据定位采用可见内容区域，处理 CSS 缩放，不改变原来的键盘、文字选择、批注和拖动处理。
- 滚动事件只监听本阅读器标记的正文，合并到下一帧更新状态；滚动期间提高表面覆盖率与反射边强度，停止 160ms 后恢复，不隐藏或移动操作栏。分屏各自独立，切换主题不重新挂载编辑器；退出及卸载取消监听、计时和测量。降低透明度后概览和操作栏均回退实色。
- 浏览器不支持 backdrop-filter 时使用实色底；用户降低透明度及可识别的系统透明度／对比度偏好优先。减少动态效果关闭材质动画和动态光学资源；高对比度交由系统色处理。侧栏宽度拖动期间暂停外壳模糊。

## 验收范围

三种风格互相切换、退出、重启偏好、输入法确认、键盘选择、存储失败、草稿保留；条目列表和标签范围、搜索、对话、三段侧栏、浮层、窄栏、缩放、错误／禁用／只读、滚动与拖动。使用 `/library-showcase.html?desktop` 检查真实标题栏、助手侧栏、页签与条目表格的完整组合，并打开覆盖正文的浮层检查透色，不能只看孤立控件。此入口仅使用模拟 IPC 和示例条目。浏览器检查与原生 Tauri 视觉验收分别记录于开发计划。
