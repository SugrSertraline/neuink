# 游戏界面设计 v2

设计稿，不是已实现界面。保留 seal-character.png 作为主角身份参考。

- dorm-ui-v2.png：宿舍首页，上床下桌。主操作“去逛逛”，次操作“选择目的地”。常驻返回阅读、设置、来信、相册、手记。
- travel-letter-ui-v2.png：游戏内来信浮层，背景变暗；照片、短笺、纪念物、收进相册、上一封/下一封及关闭。图中仅演示下一封；正式界面首尾禁用对应翻页。

## 交互规则

旅行中主角离开书桌，出发入口变为状态，不可重复出发。来信标记未读；关闭不丢失。照片自动保存到旅行记录，“收进相册”是收藏动作，重复点击不重复新增。无来信时显示纸笺空状态；保存失败时明确提示并保留内容可重试，不显示虚假成功。阅读器关闭后旅行仍可按存档时间结算。

弹层在游戏视口内打开，Esc 关闭并回到触发按钮，背景不响应点击。正文区域单独滚动，关闭与主操作始终可达。窄屏改为照片在上、文字在下，不将全场景等比缩小导致按钮无法阅读。减少动态效果设置下不持续摇摆主角。

正式文字和按钮由代码渲染，概念图不可直接充当完整交互界面。生成画面中的校园建筑与照片未经实景校准；信件“等你读完这一页”只表达陪伴，不意味着监视阅读或读完才能返程。正式版本宜改为“我带着新照片，晚些时候回来”。

## 生成

使用 imagegen skill 与内置 image_gen 工具。提示词见下，图片仅用于设计评审。

### 首页

Use case: ui-mockup. Create a refined production-intent HOME SCREEN for a cozy Northeastern University campus travel game, wide landscape 16:10. Reference is CHARACTER IDENTITY ONLY, not layout. Preserve exactly the ivory seal robot, amber eyes on black face screen, sage paddle flippers, twin tail, no legs, no fur. One game viewport, not poster or collage. Warm tactile illustrated skeuomorphic dorm interior, upper bed lower desk loft bed, full visible protective rail and mattress upper left, ladder left, desk below, window center back with softly illustrated modern campus, door right. Small friendly seal robot on lower desk foreground left reading notebook, large enough face readable, neutral happy expression. Restrained painterly game environment, simplified details, warm wood cream sage palette, not photographic room. Beautiful soft afternoon light. Avoid words on books and walls except tiny pennant '东北大学', no fake school logo. Deliberate UI hierarchy: top left compact wood return button '返回阅读' next to small '宿舍' label. Top right single gear button. Bottom centered narrow wooden dock containing only three icon buttons '来信' (envelope with badge 1), '相册' (photo book), '手记' (notebook), comfortably sized, not gigantic. Right near door single distinct moss green stitched button '去逛逛', secondary small underlined text below '选择目的地'. No inventory open, no modal. Small status above robot '在家 · 读书中'. Desk includes tiny rounded charging pad and travel camera, shelves and plant, clean silhouettes. All UI wholly inside game viewport with warm paper labels, subtle tactile relief, no web app panels. Hide any decorative huge headlines. Room remains main focus and protagonist not obscured. Playable game SCREEN design, polished calm balanced. No paw print icons (robot has flippers), no game currency, no task checklist, no explanatory text. Ensure button Chinese accurate. Architectural view is concept only, not claim of actual campus fidelity.

### 来信

Use case: ui-mockup / precise-object-edit. Reference is the home screen of our ivory SEAL ROBOT university travel companion game. Preserve its warm wood, cream paper, sage cloth, upper-bunk lower-desk dorm, and the exact seal robot identity (ivory pear body, black face screen amber eyes, grey flippers, twin tail). Create the SAME GAME with its TRAVEL LETTER modal open. Single landscape 16:10 screenshot, not poster or collage. Dorm remains visible dimmed in background, desk currently empty because companion traveling; remove the home character from background. Center a beautiful tactile horizontal open letter folder occupying 72% screen width and 70% height, cream paper in thin wood/cloth surround, subtle shadows, strong readability. Left half: ONE large instant-camera print showing the seal robot waving at the shore of a northern Chinese university lake, willow tree, conceptual red-brick campus behind; caption '小南湖 · 午后'. This is clearly a stylized game souvenir photograph, not real documentary photography. Right half short readable letter with title exactly '来自小南湖的信', body exactly '今天在湖边晒了太阳。\n等你读完这一页，\n我就带着新照片回来。' Under text a small leaf-shaped souvenir marked '湖边拾叶'. Main green stitched button bottom right '收进相册', secondary plain button '下一封'. Small page indicator '1 / 3'. Small tactile X close button upper right of folder. A small paper tab at upper left '校园来信'. No other modal, no dashboard, no large presentation title. Behind modal keep bottom home dock visibly dim, but do not repeat text unnecessarily. No money, no timers, no inventory shop, no giant UI. UI is clean functional game interface with deliberate spacing and touch targets, well-integrated restrained skeuomorphic tactile materials rather than decorative clutter. All Chinese exact and clear. Matching protagonist from reference but only in travel photo. No paws, human arms or robot legs.
