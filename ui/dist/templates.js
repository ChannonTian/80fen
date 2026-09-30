const definitions=[
 ['course','课程首页 · 完成状态',1,'展示已完成牌面、当前课程与待解锁牌背；不改变实际进度。'],
 ['seat','认座位',1,'点击一个座位；选择只改变描边和底色。'],
 ['multi','多选辨认牌',14,'从手牌选到桌心；点桌上牌可收回。牌面不透明，桌面尺寸不变。'],
 ['cardpick','单选辨认牌',3,'选中的牌移到桌心，可换选或收回，背景证据保持不变。'],
 ['numpick','数值 / 判断选项',5,'有牌时在学习牌桌中央作答；无牌时使用专注选择布局。'],
 ['ladder','升级阶梯',1,'结果选项统一 44px 起；分数信息不随选择改变。'],
 ['winpick','选收墩玩家',8,'四家牌面和座位固定，未选 / 选中 / 反馈尺寸一致。'],
 ['teampick','选得分队伍',1,'一选同时高亮同队两家，不改变座位布局。'],
 ['trickpick','选一张出牌',24,'候选区独立于牌桌，选择不重建牌桌。'],
 ['playset','对子 / 拖拉机出牌',5,'多选计数，达到要求才可提交；同门相邻。'],
 ['discard','选牌扣底',3,'固定八格底牌；已扣部分锁定，剩余空槽由手牌补齐。'],
 ['throwjudge','判断甩牌',1,'三家手牌半埋桌边、牌顶朝心；相关明牌与补齐牌背并列。'],
 ['forcedpick','甩牌失败后选牌',1,'直接点桌上已经甩出的牌，选择被迫出牌；下方不重复手牌。'],
 ['mini','连续两墩练习',6,'手牌与底部操作区始终占位，等待时不收起。']
];
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
const families=[['课程首页',['course']],['有牌桌 · 情境练习',['seat','multi','cardpick','winpick','teampick','trickpick','playset','throwjudge','forcedpick','mini']],['无牌桌 · 专注练习',['ladder','discard']],['按内容切换布局',['numpick']]];
$('type').innerHTML=families.map(([label,ids])=>`<optgroup label="${label}">${ids.map(id=>{const d=definitions.find(x=>x[0]===id);return `<option value="${id}">${d[1]}</option>`;}).join('')}</optgroup>`).join('');
if(definitions.some(d=>d[0]===params.get('type')))$('type').value=params.get('type');
function variants(){const d=definitions.find(d=>d[0]===$('type').value);$('variant').innerHTML=Array.from({length:d[2]},(_,i)=>`<option value="${i}">样例 ${i+1} / ${d[2]}</option>`).join('');$('note').textContent=d[3];}
function render(){$('state').disabled=$('type').value==='course';$('variant').disabled=$('type').value==='course';const url=$('type').value==='course'?'learn.html?course-preview=1':'learn.html?'+new URLSearchParams({template:$('type').value,variant:$('variant').value,state:$('state').value});$('preview').src=url;$('open').href=url;history.replaceState(null,'','?'+new URLSearchParams({type:$('type').value}));}
function size(){const dims={phone:[390,844],small:[320,568],landscape:[844,390],tablet:[1024,768]};const d=dims[$('size').value];$('preview').style.width=d?d[0]+'px':'100%';$('preview').style.height=d?d[1]+'px':'calc(100dvh - 48px)';}
$('type').onchange=()=>{variants();render();};$('variant').onchange=$('state').onchange=render;$('size').onchange=size;variants();size();render();
