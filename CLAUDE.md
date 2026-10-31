# 给 Claude 的工作约定

- **AI 线接手先读 [`docs/notes/ai-progress.md`](docs/notes/ai-progress.md)**(进度、产品方定下的原则、做法、下一步)。
- **每完成一个阶段、每次停下来之前,更新 `ai-progress.md`**(现在在哪 / 下一步 / 新的上下文),和代码一起提交推送。
  会话会被压缩上下文,没写进文档的都会丢。结论和数字另写进 `docs/CHANGELOG.md`,推演写进 `docs/DESIGN.md`,否掉的写进 `docs/notes/negative-results.md`。
- **分工:** 这条线主做 AI(智能);功能与界面由另一条线做。两边都改 `80fen-test.html` 与 `docs/CHANGELOG.md`。
- **开 PR 之前:** `git fetch`,看 main 上最新的测试版号、其他分支有没有占用下一个号;先把 main 合进来,再 `node test/check-sync.js --full`。
- **真人牌谱:** 测试版自动收集到产品方的 Google 表格(v0.7.38 起),现状、拉数据、验收、坑都在 [`docs/upload/README.md`](docs/upload/README.md)。
  改了 `docs/upload/apps-script.gs` 要请产品方粘进 Apps Script 并发「新版本」,否则线上还是旧脚本。
- 正式版 `index.html` 没有产品方同意不动。AI 改动一律走 `AIP` 开关(0 = 旧行为),先做零点对照。
- **整局对照用两把尺子:** `test/ai-h2h.js`(新旧同桌)+ `test/ai-pool.js`(对 6 个历史版本,避开「只会对付自己」的偏差)。
  自对弈量出来的结论和产品方实战判断相反时,以产品方为准,先查续打的 AI 像不像人。
- **真人牌谱:** `test/records-fetch.sh` 用环境变量 `RECORDS_READ_KEY` 一次拉全(默认这条);Google Sheets 连接器也能读表「80fen-牌谱」。
  牌谱来自几位试玩玩家,**不要默认是产品方本人打的**。
- **打牌界面**:测试版 `80fen-test.html`(v0.7.43 起)和打牌 UI 测试页 `80fen-play-ui-test.html` 用同一套界面。改完跑 `node test/play-ui-e2e.js --page=80fen-test.html`(不带 `--page` 测 UI 测试页;22 个设备尺寸(含 4 个带刘海让位的 iPhone)走完整局,查出屏、挤不下、遮挡、多张拖牌),体检记录在 [`docs/notes/play-ui-audit.md`](docs/notes/play-ui-audit.md)。
- 回复产品方用中文。
