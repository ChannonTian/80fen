#!/usr/bin/env python3
"""Create an isolated teaching style preview from an explicit main-repo revision."""
import argparse
import re
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--ref', default='5a143095f1163be2be3302e342753abce6f8109e')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
sha = subprocess.check_output(['git', 'rev-parse', '--verify', args.ref + '^{commit}'], cwd=repo, text=True).strip()
source = subprocess.check_output(['git', 'show', sha + ':learn.html'], cwd=repo, text=True)
# Keep the UI mascot replacement reproducible without changing the course source.
source, cat_count = re.subn(
    r'function catSVG\(mood\)\{.*?\n\}(?=\nconst setCat=)',
    '''function catSVG(mood){
  const expression = mood==='good' ? 'good' : mood==='bad' ? 'bad' : 'idle';
  return `<span class="coach-cat coach-cat--${expression}" role="img" aria-label="六六（Leo-Leo）教练"></span>`;
}''',
    source, count=1, flags=re.S)
if cat_count != 1:
    raise SystemExit('Teaching cat source changed; review this adapter.')
nav = '<nav class="study-nav" aria-label="模式"><a class="study-brand" href="index.html">80<span>分</span></a><span class="study-current">学一手</span><a class="learn-link" href="index.html">去打牌 ↗</a></nav>'
replacements = [
    ('<title>80分教学 · 第一单元</title>', '<title>80分 · 学一手</title>'),
    ('</style>\n</head>', '</style>\n<link rel="stylesheet" href="theme.css">\n<link rel="stylesheet" href="learn-theme.css">\n<link rel="stylesheet" href="leo-theme.css">\n<link rel="stylesheet" href="study-layout.css">\n</head>'),
    ("const LS='80fenlearn-';", "const LS='80fen-ui-study-preview-';"),
    ("function drawMap(){\n  let html='';", "function drawMap(){\n  let html=" + repr(nav) + ';'),
    ('<div id="bar"><div id="barIn"></div></div>', '<span class="lesson-position" id="lessonPosition"></span><div id="bar"><div id="barIn"></div></div><span class="lesson-mode">学牌</span>'),
    ("function show(p){", "function show(p){\n  $('app').dataset.screen=p;"),
    ("$('barIn').style.width=(qi/L.qs.length*100)+'%';", "$('barIn').style.width=(qi/L.qs.length*100)+'%';\n  $('lessonPosition').textContent=(qi+1)+' / '+L.qs.length;"),
    ('<div id="coach"><span id="face"></span><div id="bub"></div></div>', '<div id="coach"><div class="coach-identity"><span id="face"></span><span>六六</span></div><div id="bub"></div></div>'),
    ('<button class="rnd" id="hintBtn" title="问教练">💡</button>', '<button class="rnd" id="hintBtn" title="问六六" aria-label="问六六，获得提示">提示</button>'),
    ('<div class="big">🐱</div>', '<div class="big leo-avatar happy" role="img" aria-label="六六开心地笑"></div>'),
]
for before, after in replacements:
    if source.count(before) != 1:
        raise SystemExit('Teaching source changed; review this adapter: ' + before[:70])
    source = source.replace(before, after)
source, map_count = re.subn(r'function drawMap\(\)\{.*?\n\}(?=\n\n/\* ---------- 出牌区)', lambda _: (repo/'ui/scripts/study-map.js').read_text().strip(), source, count=1, flags=re.S)
if map_count != 1:
    raise SystemExit('Teaching map source changed; review this adapter.')
# UI lifecycle and checkpoint adapter; course definitions and grading stay untouched.
ui_replacements = [
    ("const QUI=['top','ask','board','hand','foot'];", (repo/'ui/scripts/study-session.js').read_text()+"\nconst QUI=['top','ask','board','hand','foot'];"),
    ("const doneCount=k=>+(localStorage.getItem(LS+k)||0);", "const doneCount=k=>{if(new URLSearchParams(location.search).has('course-preview'))return k===UNITS[0].key?3:0;const n=Number(studyStore.get(k));return Number.isInteger(n)&&n>=0?n:0;};"),
    ("function render(){\n  const q=L.qs[qi];", "function render(){\n  saveCheckpoint();\n  const q=L.qs[qi];\n  $('app').dataset.type=q.type;\n  $('app').dataset.evidence=String(!!(q.rows&&q.rows.length));\n  $('app').dataset.dense=String(!!(q.hand&&q.hand.length>5));"),
    ("qi=0;wrong=0;t0=Date.now();show('q');render();", "const saved=readCheckpoint();\n  const resume=saved&&saved.ui===u&&saved.li===i;\n  qi=resume?saved.qi:0;wrong=resume?saved.wrong:0;t0=Date.now()-(resume?saved.elapsed:0);show('q');render();"),
    ("if(m.turn!==0) line=`${m.goal}。<b>${nameOf(m.turn)}</b> 在出牌…`;", "if(m.turn!==0) line=`目前已抓 <b>${m.start+m.score[0]} 分</b>。<b>${nameOf(m.turn)}</b> 在出牌…`;"),
    ('<button class="btn" id="doneBtn" style="max-width:300px">继续</button>', '<button class="btn" id="doneBtn" style="max-width:300px">继续</button><button class="done-map" id="doneMap">返回课程</button>'),
    ("$('doneBtn').onclick=()=>show('map');", "$('doneBtn').onclick=()=>{const U=UNITS[ui];if(U.lessons[li+1])start(ui,li+1);else if(UNITS[ui+1])start(ui+1,0);else show('map');};\n$('doneMap').onclick=()=>show('map');"),
    ("$('barIn').style.width='100%';show('done');drawMap();", "$('doneBtn').textContent=nxt?'下一课 · '+nxt.name:nu?'开始下一单元':'回到课程';\n  $('barIn').style.width='100%';show('done');drawMap();"),
    ("'整个第一部都打完了'", "'所有课程都练过了，去牌桌试试吧'"),
    ("function start(u,i){", "function start(u,i){\n  if(new URLSearchParams(location.search).has('course-preview')){location.assign('learn.html?template='+UNITS[u].lessons[i].qs[0].type);return;}"),
    ("function finish(){", "function finish(){\n  studyStore.remove('checkpoint');\n  if(mini)mini.gen++;"),
    ("localStorage.setItem(LS+U.key,String(li+1))", "studyStore.set(U.key,String(li+1))"),
    ("$('quit').onclick=()=>{ if(confirm('退出这一课?这次的进度不保存。'))show('map'); };", "$('quit').setAttribute('aria-label','保存进度，返回课程');\n$('quit').onclick=()=>{pauseLesson();drawMap();show('map');};"),
    ("function flyToWinner(win,cb){", "function flyToWinner(win,cb){\n  const generation=mini&&mini.gen;"),
    ("setTimeout(cb,PACE.fly+60);", "setTimeout(()=>{if(mini&&mini.gen===generation&&$('app').dataset.screen==='q')cb();},PACE.fly+60);"),

]
for before, after in ui_replacements:
    if source.count(before)!=1:
        raise SystemExit('Teaching lifecycle changed; review adapter: '+before[:80])
    source=source.replace(before,after)
# Card size is a CSS layout token, never a transient inline measurement.
source,fit_count=re.subn(r'function fitTable\(\)\{.*?\n\}(?=\n\n/\* ---------- 起止)', 'function fitTable(){}',source,count=1,flags=re.S)
if fit_count!=1: raise SystemExit('Review fitTable adapter')
source=source.replace('drawPlay(q,multi);','drawPlay(q,q.type!=="discard");')
source=source.replace("(picked.length? (n>1?`出这 ${n} 张`:'出牌') : '出牌')", "(n>1?(picked.length===n?`出这 ${n} 张`:`已选 ${picked.length} / ${n} 张`):'出牌')")
source=source.replace("setCat('idle');drawMap();show('map');", (repo/'ui/scripts/study-templates.js').read_text())
source = source.replace('<!doctype html>', '<!doctype html>\n<!-- Teaching style preview; source: ' + sha + '. Course and grading logic preserved. -->', 1)
(repo/'ui/dist/learn.html').write_text(source)
(repo/'ui/dist/learn-source.txt').write_text('Source: ChannonTian/80fen learn.html\nCommit: ' + sha + '\nGenerated by ui/scripts/refresh-learn-preview.py\nLocal changes: shared Leo-Leo theme, Chinese font stack, fan course map, fixed question layouts, 13 design templates, navigation, isolated progress key and coach avatar.\nCourse definitions and grading preserved; checkpoint, keyboard controls and animation lifecycle adapted locally.\n')
print('Teaching style preview updated from ' + sha)

subprocess.run(['python3', str(repo/'ui/scripts/version-assets.py')], check=True)
