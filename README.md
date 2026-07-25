# 80分(上海规则)v0.2.0

网页版 80分(升级/拖拉机,上海打法):启发式 AI 队友与对手、发牌抢亮、无主/造反、多局连打升级、教练模式(提示/失误反馈/复盘/记牌训练)、沪语术语切换。

纯静态、零依赖、无构建:一个 `index.html` + 一个 `terms-shanghai.js`。

## 文件

`index.html` 游戏本体(引擎+AI+界面,单文件);`terms-shanghai.js` 沪语术语表(可独立改词);`RULES.md` 规则决定书;`AI-DESIGN.md` AI 设计笔记;`CHANGELOG.md` 更新日志。`80fen.html` 与 `index.html` 内容相同(开发用名,每次改动需手动同步)。

## 本地运行

双击 `index.html` 即可(需与 `terms-shanghai.js` 同目录)。打开 `index.html#test` 可查看引擎自测(101 项)。

## 部署到 GitHub Pages

1. 新建仓库(如 `80fen`),把 `index.html`、`terms-shanghai.js` 推上去:
   ```bash
   git init && git add index.html terms-shanghai.js RULES.md AI-DESIGN.md README.md
   git commit -m "80fen v0.1.0"
   git remote add origin git@github.com:<你的用户名>/80fen.git
   git push -u origin main
   ```
2. 仓库 Settings → Pages → Source 选 `Deploy from a branch`,Branch 选 `main` / `(root)`,保存。
3. 一两分钟后访问 `https://<你的用户名>.github.io/80fen/`。

之后每次 `git push` 自动更新。无主域名、HTTPS、免费,对这个纯前端项目正合适。注意:笔记与设置存在浏览器 localStorage,换设备不同步。

## 开发备忘

三层结构(引擎纯函数 → AI → 界面)都在 `index.html` 的三个 `<script>` 块里;规则可调参数集中在 `RULES` 对象;测试可用 node 无头运行(提取 script 块 eval 后调 `runTests`)。
