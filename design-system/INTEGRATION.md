# 六六设计系统在学牌页面的接入

来源：用户提供的 [六六八十分设计系统](https://claude.ai/artifact/KFHczkHuxpcFbeXruogzBX)，2026-10-10 版本。此目录保存了 tokens、字体、组件 CSS、无框架组件脚本和接口声明；原设计系统的完整说明见 [README.md](README.md)。

正式入口：[learn.html](../learn.html)；界面测试页 [80fen-learn-ui-test.html](../80fen-learn-ui-test.html) 由 `python3 learn/sync-ui-test.py` 从 learn.html 生成（只差存档前缀、标题和两处链接，别直接改测试页）。整手牌组件可单独在 [hand-sample.html](hand-sample.html) 体验。

## 加载关系（2026-10-18 起）

学牌页只加载三份样式：

1. `design-system/dist/fonts.css`：自托管字体（Fraunces 做数字，Noto Sans SC 900 做标题）。
2. `design-system/dist/liuliu-tokens.css`：全部颜色、圆角、投影、时长 token。
3. `learn/learn.css`：学牌页自己的样式，**这一份就是全部**。只用 token，不写死颜色。

六六的三格表情图（平常 / 开心 / 好奇）在 `learn/leo.webp`，原来在页面里内嵌了两份同样的 base64（113KB × 2）。

不再加载 `components/bundle.css`、`components/bundle.js`。学牌页的 DOM 是题型渲染函数直接写出来的，套 `ll-` 组件类反而要再写一层覆盖；需要的视觉规则（贴纸描边、实心投影、牌面左上角点数加花色、蜂蜜黄主按钮、绿毡反馈条）直接在 learn.css 里按设计系统写一遍。打牌测试页和 hand-sample 仍然用 bundle。

## 2026-10-18 重做表现层：为什么整个换掉

10-10 那一轮（PR #54–#56）的做法是：保留旧样式，在后面依次叠四层主题（theme / learn-theme / leo-theme / study-layout）和一份 `learn-adapter.css`，再在脚本末尾猴子补丁替换 `render`、`check`、`drawPlay`、`drawThrow`、`paintMini`、`sayFeedback`。从头测试下来，问题是系统性的：

- **样式**：53 个 `!important`，大量为打牌页写的 `#game` 规则也一起塞进了学牌页；改一处要猜哪一层生效。
- **文案**：座位名改成「你 / 下家 / 对家 / 上家」靠运行时正则 `relativeCopy` 改写课文，拼出了「下家家出」「你 · 庄家(你)」；扣底题的课文提示被整句换成了通用文字（「你是庄家，扣 3 张回底…」这句课文丢了）。
- **排版**：`fitTable` 被换成空函数，小屏牌桌被裁掉；残局明牌的别家手牌溢出牌桌和屏幕；甩牌题的证据牌被裁掉、还倒着摆；「主」字条横穿牌面、盖住花色；答完题剩下的手牌变成深绿色，看上去像「锁住」的牌背。
- **首页**：每张课程牌里塞一个按钮，扇面一叠就露出半截「已」「复」；第 5 课被当前课盖住看不见；两个单元都标「第一部」。
- **测试**：`learn/test/walk.mjs` 找不到入口（`data-go` 已经没了），整套走查跑不起来。

这次的处理：

- 课文里的东 / 南 / 西 / 北直接改成相对座位名（一百多处，含 4 处要改句子的，例如「东家的下家是北家」改成「下家再往下一家，是对家」），删掉 `relativeCopy`。
- 补丁层全部并回原函数，删掉 `decorateStudy` / `renderRecognition` / `renderKitty` / 包装函数。
- 新写 `learn/learn.css`；新增 `layoutHand`（手牌扇面）和 `fitBoard`（牌桌那把尺按剩余高度量出来，从大往小二分，直到整块放得下）。
- 首页重写：一个单元一手牌，课程牌只有序号、猫头和状态（✓ / 当前抬起 / 锁），点牌看课名，「开始 / 复习」只有一个按钮。
- 答题区按设计系统的 Feedback banner：答完整条换色（对 = 绿毡，错 = 砖红），「答对了 / 再想想」和按钮在同一行，高度不变；讲解仍在六六的气泡里。
- 气泡里的 ♠♥♦♣ 统一补 U+FE0E（防 iOS 画成彩色 emoji）并上色。
- 加回正式版那套 WebAudio 音效（点选、答对、答错、通关），首页右上角可关。

## 验证

- `node learn/test/walk.mjs`：390×844、375×667 两档，29 课逐题判「答对了」、小局结算文字逐条核对，无页面报错。
- `node learn/test/answers.mjs`：标答交给引擎复核，全部通过。
- 截图走查：390×844、375×667、320×568、844×390 四档，每类题型的出题 / 选中 / 反馈三个状态。

## 后续

1. 设计系统里的十一张表情 PNG 还没进仓库；现在只有平常 / 开心 / 好奇三张。
2. 打牌页若复用 `Liuliu.renderHand`，还要用真实规则状态测试拖拽出牌（合法性、成组拖、中途取消）。
