# 海豹机器人 · 校园旅行设计 v1

日期：2026-09-27。状态：视觉设计，尚未接入游戏。主角选自候选 C；名称暂未确定。

## 交付

- seal-character.png：主角三视图与读书、出发、招手、休息动作概念。不是动画帧或可直接切割的精灵图。
- dorm-home.png：上床下桌宿舍的默认游戏界面概念。建筑、照片、便签为生成示意，不代表真实东北大学建筑或活动。

## 主角规范

奶油白圆润海豹外壳、灰绿双鳍、双瓣尾巴、黑色屏幕与琥珀眼睛。细青色充电缝线，小型旅行相机。禁止增加人形手脚、复杂铠甲、常驻服装。旅行小包可拆卸。科研感通过读书、记录、好奇观察体现。

动画方向：待机轻摆、眨眼、鳍部拍动前行、招手、看书、休眠。降低动态效果设置下保留静态状态；无需要持续后台渲染的设定。

## 默认场景与玩法提案

1. 从阅读器的乐园入口进入宿舍，不强制跳转或中断阅读。
2. 默认主角在下方书桌读书/休息，上床用于睡眠氛围。默认不弹出背包。
3. 点击“去逛逛”即可开始一次校园旅行；目的地可默认随机，也可自选。不要把配装备变为每次必经步骤。
4. 旅行状态变为“出门中”，出发入口不可重复提交。允许继续阅读、关闭场景；旅行按持久化时间计算，不靠持续动画计时。
5. 途中产生来信，回来留下照片、短文字和可选纪念品；进入相册查看。照片优先用经确认的校园底图/实景资料加主角合成，明确为游戏旅行照片，不冒充实时拍摄。
6. 首批目的地建议：小南湖、图书馆、食堂、社团活动、体育场。真实地点名称与建筑外观需核实；不能从本稿推断实景。
7. 核心状态：在家 → 出门中 → 来信/归来 → 在家。出发、收件去重且持久化，失败可重试；关闭应用后重新打开结算错过的事件，不依赖后台模型持续运行。
8. 首版无需大模型运行也可旅行：预设地点、事件和照片素材。个性化信件可后续选择性接入，不阻塞基本玩法。阅读奖励仅为可选装饰/纪念，不设强制打卡或不读书惩罚。

## 落地边界

目前只确定视觉与交互意图，没有替换旧游戏实现。图片是整体概念，不作为整屏背景假装可交互成品。开发前需要拆分干净宿舍背景、主角透明图/动画与无文字 UI 素材，所有按钮文字由界面真实渲染。正式素材清理生成图中的伪文字、爪印及未经核验的校园图像；保持海豹角色符号一致。

## 生成记录

使用 imagegen skill 与内置 image_gen 工具；未使用 CLI/API key。

### 主角提示词

Use case: identity-preserve / stylized-concept. Reference image is a four-candidate robot sheet; select ONLY candidate C the cream SEAL ROBOT from bottom left. Discard all other candidates. Create a refined consistent production CHARACTER DESIGN SHEET of this single original protagonist for a Northeastern University campus travel game. Preserve C's plump cream pear/teardrop seal body, small charcoal face screen with two amber eyes, TWO short grey-sage paddle flippers, small twin-lobed tail, two tiny cheek sensor dots. NO frog, NO beetle, no clothes, no humanoid limbs, no complex armor. Give it a subtle teal charging seam low on flank and tiny recessed camera lens at flipper joint to take travel pictures; very economical construction. Smooth matte ivory polymer, soft satin sage flippers, charcoal screen, warm gentle eyes. Cute by silhouette and gesture not shiny detail. Landscape clean warm ivory sheet, large hero three-quarter pose on left occupying 40 percent, three smaller consistent front/side/back views across upper right, four expressive action poses lower right: reading a propped-up notebook with flipper resting on edge; waddling with small removable sage travel pouch; raising flipper to wave on a trip; tucked sleeping with eyes as closed arcs. Every pose SAME character proportions, recognizable seal tail, no legs. Simple soft dimensional game illustration compatible with tactile cozy dorm UI, no gritty texture, no photorealism. Small title only '校园旅行伙伴', labels '正面' '侧面' '背面' and '读书' '出发' '招手' '休息'. No marketing poster, no scene, no interface surrounding sheet. Consistency and animation-friendly simple volumes are critical.

### 宿舍提示词

Use case: ui-mockup. Reference is the approved SEAL ROBOT character sheet. Preserve that EXACT single original character identity: matte ivory plump teardrop seal body, charcoal face display with amber oval eyes, two short sage-grey paddle flippers with small recessed camera lens, twin-lobed seal tail, subtle teal charging seam. No legs, no humanoid arms, no frog. Make ONE finished actual GAME DEFAULT HOME SCREEN, landscape 16:10, for a Northeastern University campus travel-companion game. NOT a poster, NO collage, NO character sheet, NO sidebars, no floating giant backpack or open modal. The entire viewport is a warm tactile skeuomorphic game scene: a Chinese university dorm with clear upper bunk and lower desk (上床下桌), left side ladder, visible top mattress quilt and bed rail, desk and shelving underneath with enough headroom. The little seal robot sits comfortably on the lower desk left-center reading a propped open research notebook beside a lamp and charging mat; human-scale room and small companion. Full character visible, face readable. Contemporary red-brick campus visible through back window; conceptual architecture, no invented official logo, simple pennant text '东北大学'. Warm wood and cream, muted sage textiles, hand-painted dimensional cozy game rendering, clean readable object silhouettes and restrained detail, not photorealistic. Lower right room door serves as travel interaction target with a tiny travel pouch on hook, and a clear tactile moss-green button immediately near it labeled exactly '去逛逛'. This is ONE primary action. Along bottom a compact integrated wooden shelf toolbar with only three generous icon buttons: envelope '来信' with badge '1', photograph book '相册', little notebook '手记'. Top-left small wood plaque '宿舍', small gear button top-right, no meaningless currency counter. A short subtle status bubble above robot '在家读书'. On a small corkboard near window pin a modest campus lake postcard and canteen lunch snapshot as collected memories (small room objects, not competing panels). Room should feel relaxing and playable, balanced negative space; no giant headline, no presentation frame, no progress dashboard, no task grid. Materials like wood borders and paper labels unify scene and buttons. Consistent warm diffuse afternoon light. Show actual UI intent: click to travel, return to letters/photos, but no arrows or explanatory notes. Keep robot exactly matching reference, do not turn into white furry animal.

