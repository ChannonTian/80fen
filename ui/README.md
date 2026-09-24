# 竖屏牌桌实验 01

入口：`ui/index.html`（跳转到 `dist/index.html`）。手机直接满屏，电脑显示可切换尺寸与局面的试验台。直接打开文件也可用；跨 iframe 局面切换建议通过 HTTP 预览。

所有改动限于 `ui/`。正式版、测试版、教学版保持原状。

## 可操作范围

- 固定局面：25 张跟对子、25 张领出拖拉机、33 张拿底扣底。
- 单张点选/取消、保留物理牌 ID、重选、合法性反馈、确认提交。
- 四门手牌独立横向浏览；展开全手牌后仍保留选择。
- 牌桌状态、累计分、收墩结果、当前墩回看、原型局面切换。
- 此版不是完整对局，不模拟对手后续出牌。暂不支持甩牌、亮主与升级流程。

`dist/engine.js` 来自主仓库 `ca7ffe56097fc63692fbc11120eeaed80e3e9ef2` 的 `index.html` 第一个 script 块，原文提取，仅添加浏览器导出。原型通过 `isLegalFollow`、`classify`、`resolveTrick` 验证演示动作，不另写游戏规则。更新主线时需重新提取。

## 文件

- `dist/table.html` / `table.css` / `table.js`：独立牌桌。
- `dist/index.html` / `lab.css`：桌面尺寸试验台，手机全屏容器。
- `dist/DESIGN.md`：设计假设、参考与验收边界。
- `.openai/hosting.json`：独立原型的私有预览配置。

本地运行：在 repo 根目录运行 `python3 -m http.server 8765`，打开 `http://localhost:8765/ui/`。
