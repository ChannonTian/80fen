      rows.push([new Date(), r.id, r.pid, txt_(r.nick), txt_(r.version), txt_(r.t), num_(r.dur),
                 txt_(r.no), num_(r.human), num_(r.declSeat), trump_(r.trump), num_(r.defPoints),
                 r.replay ? '是' : '', r.partial ? `${txt_(r.stage)} · ${num_(r.tricksDone)} 墩` : '', num_(r.autoTricks), num_(r.undos), humanPlays, json]);
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
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let sh;
  try { sh = sheet_(); } finally { lock.releaseLock(); }   // sheet_ 可能要挪旧表,别和上传同时写
  const last = sh.getLastRow();
  const from = Math.max(2, +p.from || 2);
  if (last < from) return ContentService.createTextOutput('');
  // 按内容找牌谱那一格,不按列号:列的位置变过一次(加了「残局」),不能再让下载跟着列号出错
  const vals = sh.getRange(from, 1, last - from + 1, sh.getLastColumn()).getValues();
  const json = vals.map(row => row.find(v => typeof v === 'string' && v.startsWith('{"fmt"')) || '').filter(Boolean);
  return ContentService.createTextOutput(json.join('\n') + (json.length ? '\n' : ''));
}

// ---------- 校验:只挡格式明显不对的;合不合规则由 AI 线的 test/records-check.js 逐手重放 ----------
const CARD = /^(?:[SHDC](?:[2-9]|1[0-4])|X1[56])$/;
function check_(r) {
  if (!r || typeof r !== 'object') return 'type';
  if (r.fmt !== '80fen-record-2') return 'fmt';
  if (!str_(r.id, 64) || !str_(r.pid, 64)) return 'id';
  if (r.nick != null && !str_(r.nick, 20)) return 'nick';
  const cards = a => Array.isArray(a) && a.every(c => typeof c === 'string' && CARD.test(c));
  // 残局(partial):开打之前离开的没有 initialHands / buried,tricks 只有已经收掉的墩
  const part = r.partial === true;
  if (!(part && r.initialHands == null)) {
    if (!Array.isArray(r.initialHands) || r.initialHands.length !== 4 || !r.initialHands.every(cards)) return 'hands';
    if (r.initialHands.reduce((a, h) => a + h.length, 0) !== 100) return 'hands';
    if (!cards(r.buried) || r.buried.length !== 8) return 'buried';
  }
  if (!Array.isArray(r.tricks) || r.tricks.length > 30) return 'tricks';
  if (part && r.initialHands == null && r.tricks.length) return 'tricks';
  let n = 0;
  for (const t of r.tricks) {
    if (!t || !Array.isArray(t.plays) || t.plays.length !== 4) return 'tricks';
    for (const p of t.plays) {
      if (!p || !(p.seat >= 0 && p.seat <= 3) || !cards(p.cards)) return 'tricks';
      n += p.cards.length;
    }
  }
  if (part ? n >= 100 : n !== 100) return 'tricks';
  return '';
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEAD);
    sh.setFrozenRows(1);
  } else if (sh.getRange(1, 1, 1, HEAD.length).getValues()[0].join('|') !== HEAD.join('|')) {
    migrate_(sh);
  }
  return sh;
}
/* 表头和脚本对不上 = 旧版脚本建的表(没有「残局」列,牌谱 JSON 在第 16 列)。
 * 逐行挪:JSON 还在旧位置的行在「重打」后面补一个空的「残局」格;已经是新排法的行不动。再换上新表头。 */
function migrate_(sh) {
  const last = sh.getLastRow();
  if (last >= 2) {
    const width = Math.max(sh.getLastColumn(), HEAD.length);
    const rows = sh.getRange(2, 1, last - 1, width).getValues().map(row => {
      const j = row.findIndex(v => typeof v === 'string' && v.startsWith('{"fmt"'));
      if (j === HEAD.length - 2) row = row.slice(0, 13).concat([''], row.slice(13, j + 1));   // 旧排法:第 14 列起右移一格
      row = row.slice(0, HEAD.length);
      while (row.length < HEAD.length) row.push('');
      return row;
    });
    sh.getRange(2, 1, rows.length, HEAD.length).setValues(rows);
    if (width > HEAD.length) sh.getRange(2, HEAD.length + 1, rows.length, width - HEAD.length).clearContent();
  }
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
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
