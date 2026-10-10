**六六八十分**（英文名 **Leo-Leo's 80s**）是 80 分（上海规则）游戏化教学的视觉系统：暖纸面、素绿牌桌、蜂蜜黄强调、砖红牌背，一切物件都是带粗墨描边和实心下投影的「贴纸」，和教练六六的插画轮廓是同一支笔。手机竖屏优先，一题十几秒。产品中英双语：英文规范见「English」一节，术语对照见「术语表 Glossary」。

## 落地

- 生产页面按顺序引入四个文件：`dist/fonts.css`（自托管字体）、`dist/liuliu-tokens.css`（全部 token 变量，由 `tokens.json` 生成）、`components/bundle.css`（`ll-` 前缀组件样式）、`components/bundle.js`（`window.Liuliu`：牌面、手牌布局、六六待机）。根元素加 `class="ll"` 和 `lang`（`zh-CN` 或 `en`）。
- 设计系统页面自带的 `tokens.css` 与 `dist/liuliu-tokens.css` 内容相同；仓库里请用 `dist/` 这份，它是文件、可以直接拷走。
- **语言切换只改 `lang`**：bundle.css 用 `:lang(en)` 把标题、正文、六六声音三种字体换成英文字族，组件结构不变。同一页混排时给英文片段单独加 `lang="en"`。
- 组件是纯 HTML + CSS，无框架依赖，可直接放进仓库现有的 `learn.html`。
- **字体自托管**：`fonts/` 里是 Fraunces 800/900、Figtree 400–800（拉丁子集）和 Noto Sans SC 900（102 个 unicode-range 分片，只下载用到的字），均为 OFL，授权文本在 `fonts/LICENSE-*`。`dist/fonts.css` 是唯一的字体入口；不引用 Google Fonts 等第三方字体 CDN。中文正文 400/700 用系统字体（PingFang SC / Microsoft YaHei / Noto CJK），不另下载。
- 花色字符一律跟 `&#xFE0E;`，防止 iOS 渲染成 emoji。

## 产品名

- 中文「六六八十分」，英文 "Leo-Leo's 80s"，并列时中文在前：六六八十分 · Leo-Leo's 80s。
- 中文名不拆写成「六六 80 分」；英文名保留连字符和撇号，不写成 "LeoLeo" 或 "Leo Leo's 80's"。
- 教练名：中文「六六」，英文 "Leo-Leo"（她 / she）。

## 语气

- 六六说话：口语、短句、称「你」。先结论后理由：「队友赢定了，把 ♥5 的 5 分贴给他。」
- 称呼固定：你 / 对家 / 上家 / 下家；术语用原词并在首次出现时解释（墩、贴分、毙、扣底、拖拉机）。
- 反馈评的是这一手的决策，从不说「这局赢了/输了」。答错先说为什么，再说怎么做。
- 不用 emoji 装饰；一句最多一个感叹号。

## 颜色

- 底：题内 `paper`；首页与结尾卡 `cream`；深色场景 `felt-deep`。文字 `ink` / `ink-soft`；`ink-faint` 只给禁用与 ✕。
- 强调 `honey`＝你 / 当前 / 下一步：主按钮、当前课程牌、你的座位、分数徽章；放在 paper 上必须带 `ink` 描边。
- 语义（同时配文字或符号）：选中 `teal` + `teal-tint`；正确 `felt` + `ok-tint` + ✓；错误 `brick-deep` + `err-tint` + ✗。
- `brick` 四个用途：红桃/方块、牌背、答错、对手。不用砖红做主按钮。
- 牌桌 `felt-table`，桌上文字 `cream`。

## 字体

- 中文：标题 `heading`（Noto Sans SC 900），正文 `sans`（PingFang 优先）。六六的气泡也用正文字体。
- 英文：标题 `heading-en`（Fraunces 800–900），正文 `sans-en`（Figtree）。
- 数字 `num`（Fraunces 900）：牌点、分数、课程编号、80，两种语言共用。
- 题目 ≤20px，正文 16px，最小 12px（仅标签与课程牌名）；反馈横幅里不低于 16px。

## 形状、描边、投影

- 描边 `stroke-hair` / `stroke-ui` / `stroke-bold`，永远 `ink`。投影只用 `shadow-*`：实心、零模糊、向下；按下 `translateY(3px)` + `shadow-press`。
- 圆角：按钮与标签 `radius-pill`，选项与气泡 `radius-md`，牌桌与横幅 `radius-lg`，牌 `radius-card`（em）。
- 不用渐变、材质纹理、光泽、模糊阴影。

## 牌

- 牌点与花色同在左上角，不放中央花色；尺寸只改 `font-size`。
- 一把牌展开是**中间高、两边低**的弧：`--a`（-1…1）驱动下沉 `fan-drop` 与旋转 `fan-tilt`。课程牌扇面同理。
- 牌背：砖红 + 奶油框 + 斜格纹 + 猫头圆章（见 CardBack）。宽 < 40px 用 `is-small`。
- 猫头花色只出现在课程牌和牌背圆章上，真实牌面用标准四花色。

## 六六

- 教练不占座位：题内在题目左侧（54px），打牌页在底栏「问六六」。
- 十一种原画表情，各对应一个教学时刻或待机状态（见 LeoAvatar 与「六六表情」）。待机用 `ll-leo--alive` 呼吸，久未操作按 舔爪 → 哈欠 → 睡觉 渐进。
- 鼻头深棕、向中心微微泛红；眼睛金黄到橄榄黄；不画身体与道具。
- 头像与进度环同心：使用本系统重新居中的资源。

## 布局

- 两个骨架：**有牌桌**（情境练习）与**无牌桌**（纯文字/数字、扣底）。
- 手机顺序：进度 → 六六与题目 → 牌桌/专注区 → 手牌 → 操作区；左右边距 ≥ `space-4`；点击目标 ≥ `size-tap`。
- 答案状态变化不改尺寸；操作区始终保留。英文文案平均长 1.4–1.8 倍：容器按英文长度留余量，不靠缩字号。

## 动效

- 弹出 `dur-pop` + `ease-back`；大字盖章 `dur-stamp`；切题与牌飞入 `dur-slide`；六六呼吸 `dur-breathe`、眨眼 `dur-blink`。
- 答对彩纸 ≤80 片，1.5s 内落完。`prefers-reduced-motion` 下关闭位移、弹跳、呼吸与眨眼。

## 资源

- `assets/Leo-Leo/`：十一种表情 PNG，512×512 透明底，头部轮廓居中。
- `assets/Glyphs/leo-mark.svg`：六六标记（从原画轮廓描出的扁平头像），用于牌背圆章、图标、分享图。`cat-suit.svg` / `cat-suit-ink.svg`：课程牌上的猫头花色。
- `assets/Cards/card-back.svg`：牌背。`assets/Glyphs/`：猫头花色、锁。
