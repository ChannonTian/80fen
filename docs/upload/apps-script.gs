/**
 * @OnlyCurrentDoc
 * ↑ 授权范围只限这一张表:部署时 Google 只会请求「查看和管理这一份表格」,
 *   而不是「你所有的 Google 表格」。网页应用设成「任何人可访问、以我的身份执行」也碰不到你别的文件。
 */
/* 80分牌谱收集表 —— 接收测试版上传的牌谱(80fen-record-2),一局一行写进这张 Google 表格。
 * 部署步骤、字段说明见同目录 README.md。
 *
 * 网页端(80fen-test.html 的 flushUploads)一次 POST 最多 8 局,body 是 JSON 数组,Content-Type text/plain
 * (简单请求,不发预检)。这里回 {ok, saved:[id], dup:[id], bad:[{id,why}]}:
 *   saved / dup 网页端标成已上传;bad 里 why 不是 'rate' 的也标掉(不再重传),'rate' 的下次再试。
 * 同一个 id 只收一次(网页端传失败会重传)。
 *
 * 可选:项目设置 → 脚本属性 加 READ_KEY = 一串随机字符,之后
 *   GET …/exec?key=<READ_KEY>[&from=行号]   以一行一局(JSONL)下载全部牌谱(给 AI 线跑脚本用)。
 * 没设 READ_KEY 时 GET 只回 ok,不给数据。 */

const SHEET_NAME = '牌谱';
const HEAD = ['收到时间', 'id', '玩家', '昵称', '版本', '打完时间', '用时(秒)', '局号', '人坐', '庄家',
              '主', '闲家得分', '重打', '托管墩数', '悔牌次数', '真人出牌手数', 'JSON'];
const COL_JSON = HEAD.length;          // JSON 在最后一列
const MAX_BODY = 400000;               // 一次请求的上限(8 局 × 约 5KB 绰绰有余)
const MAX_REC = 45000;                 // 单元格上限 50000 字符
const MAX_PER_HOUR = 120;              // 每个匿名玩家每小时最多收多少局,防刷
const MAX_ALL_HOUR = 2000;             // 全部玩家加起来每小时最多收多少局 —— 匿名编号是网页自报的,
                                       // 换编号就能绕过上一条,这条兜底防有人灌满表格

function doPost(e) {
  const body = (e && e.postData && e.postData.contents) || '';
  if (!body || body.length > MAX_BODY) return out_({ ok: false, err: 'size' });
  let recs;
  try { recs = JSON.parse(body); } catch (x) { return out_({ ok: false, err: 'json' }); }
  if (!Array.isArray(recs)) recs = [recs];
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const cache = CacheService.getScriptCache();
    const saved = [], dup = [], bad = [], rows = [];
    for (const r of recs.slice(0, 20)) {
      const why = check_(r);
      if (why) { bad.push({ id: r && typeof r.id === 'string' ? r.id : null, why }); continue; }
      if (rows.some(x => x[1] === r.id) || seen_(sh, r.id)) { dup.push(r.id); continue; }
      const json = JSON.stringify(r);
      if (json.length > MAX_REC) { bad.push({ id: r.id, why: 'big' }); continue; }
      const k = 'n:' + r.pid, n = +(cache.get(k) || 0), all = +(cache.get('n:*') || 0);
      if (n >= MAX_PER_HOUR || all >= MAX_ALL_HOUR) { bad.push({ id: r.id, why: 'rate' }); continue; }
      cache.put(k, String(n + 1), 3600);
      cache.put('n:*', String(all + 1), 3600);
      const humanPlays = r.tricks.reduce((a, t) =>
        a + t.plays.filter(p => p.seat === r.human && (!p.by || p.by === 'h')).length, 0);
      rows.push([new Date(), r.id, r.pid, txt_(r.nick), txt_(r.version), txt_(r.t), num_(r.dur),
                 txt_(r.no), num_(r.human), num_(r.declSeat), trump_(r.trump), num_(r.defPoints),
                 r.replay ? '是' : '', num_(r.autoTricks), num_(r.undos), humanPlays, json]);
      saved.push(r.id);
    }
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEAD.length).setValues(rows);
    return out_({ ok: true, saved, dup, bad });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const key = PropertiesService.getScriptProperties().getProperty('READ_KEY');
  const p = (e && e.parameter) || {};
  if (!key || p.key !== key) return ContentService.createTextOutput('ok');
  const sh = sheet_(), last = sh.getLastRow();
  const from = Math.max(2, +p.from || 2);
  if (last < from) return ContentService.createTextOutput('');
  const vals = sh.getRange(from, COL_JSON, last - from + 1, 1).getValues();
  return ContentService.createTextOutput(vals.map(v => v[0]).filter(Boolean).join('\n') + '\n');
}

// ---------- 校验:只挡格式明显不对的;合不合规则由 AI 线的 test/records-check.js 逐手重放 ----------
const CARD = /^(?:[SHDC](?:[2-9]|1[0-4])|X1[56])$/;
function check_(r) {
  if (!r || typeof r !== 'object') return 'type';
  if (r.fmt !== '80fen-record-2') return 'fmt';
  if (!str_(r.id, 64) || !str_(r.pid, 64)) return 'id';
  if (r.nick != null && !str_(r.nick, 20)) return 'nick';
  const cards = a => Array.isArray(a) && a.every(c => typeof c === 'string' && CARD.test(c));
  if (!Array.isArray(r.initialHands) || r.initialHands.length !== 4 || !r.initialHands.every(cards)) return 'hands';
  if (r.initialHands.reduce((a, h) => a + h.length, 0) !== 100) return 'hands';
  if (!cards(r.buried) || r.buried.length !== 8) return 'buried';
  if (!Array.isArray(r.tricks) || r.tricks.length > 30) return 'tricks';
  let n = 0;
  for (const t of r.tricks) {
    if (!t || !Array.isArray(t.plays) || t.plays.length !== 4) return 'tricks';
    for (const p of t.plays) {
      if (!p || !(p.seat >= 0 && p.seat <= 3) || !cards(p.cards)) return 'tricks';
      n += p.cards.length;
    }
  }
  if (n !== 100) return 'tricks';
  return '';
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEAD);
    sh.setFrozenRows(1);
  }
  return sh;
}
function seen_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return false;
  return !!sh.getRange(2, 2, last - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function str_(s, max) { return typeof s === 'string' && s.length > 0 && s.length <= max; }
function num_(x) { return typeof x === 'number' && isFinite(x) ? x : ''; }
// 玩家填的文字以 = + - @ 开头会被表格当成公式,前面垫一个 '
function txt_(s) { s = s == null ? '' : String(s).slice(0, 100); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function trump_(t) {
  if (!t) return '';
  const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const R = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  return (t.suit ? SYM[t.suit] || '' : '无主') + ' 打' + (R[t.rank] || t.rank);
}
