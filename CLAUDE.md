# 给 Claude 的工作约定

- **AI 线接手先读 [`docs/notes/ai-progress.md`](docs/notes/ai-progress.md)**(进度、产品方定下的原则、做法、下一步)。
- **每完成一个阶段、每次停下来之前,更新 `ai-progress.md`**(现在在哪 / 下一步 / 新的上下文),和代码一起提交推送。
  会话会被压缩上下文,没写进文档的都会丢。结论和数字另写进 `docs/CHANGELOG.md`,推演写进 `docs/DESIGN.md`,否掉的写进 `docs/notes/negative-results.md`。
- **分工:** 这条线主做 AI(智能);功能与界面由另一条线做。两边都改 `80fen-test.html` 与 `docs/CHANGELOG.md`。
- **开 PR 之前:** `git fetch`,看 main 上最新的测试版号、其他分支有没有占用下一个号;先把 main 合进来,再 `node test/check-sync.js --full`。
- **真人牌谱:** 测试版自动收集到产品方的 Google 表格(v0.7.38 起),现状、拉数据、验收、坑都在 [`docs/upload/README.md`](docs/upload/README.md)。
  改了 `docs/upload/apps-script.gs` 要请产品方粘进 Apps Script 并发「新版本」,否则线上还是旧脚本。
- 正式版 `index.html` 没有产品方同意不动。AI 改动一律走 `AIP` 开关(0 = 旧行为),先做零点对照。
