const definitions=[
 ['seat','认座位',1,'点击一个座位；选择只改变描边和底色。'],
 ['multi','多选辨认牌',14,'候选牌保持同一网格；选中只抬起 10px。'],
 ['cardpick','单选辨认牌',3,'单选替换上次选择；确认前不改变证据区。'],
 ['numpick','数值 / 判断选项',5,'证据牌在上，固定高度选项在下。'],
 ['ladder','升级阶梯',1,'结果选项统一 44px 起；分数信息不随选择改变。'],
 ['winpick','选收墩玩家',8,'四家牌面和座位固定，未选 / 选中 / 反馈尺寸一致。'],
 ['teampick','选得分队伍',1,'一选同时高亮同队两家，不改变座位布局。'],
 ['trickpick','选一张出牌',24,'候选区独立于牌桌，选择不重建牌桌。'],
 ['playset','对子 / 拖拉机出牌',5,'多选计数，达到要求才可提交；同门相邻。'],
 ['discard','选牌扣底',3,'底牌槽和候选手牌预留固定空间。'],
 ['throwjudge','判断甩牌',1,'四家明牌排列成对照行，下方给出判断选项。'],
 ['forcedpick','甩牌失败后选牌',1,'沿用四家明牌对照，只允许选择自己的候选牌。'],
 ['mini','连续两墩练习',6,'手牌与底部操作区始终占位，等待时不收起。']
];
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
$('type').innerHTML=definitions.map(([id,name])=>`<option value="${id}">${name}</option>`).join('');
if(definitions.some(d=>d[0]===params.get('type')))$('type').value=params.get('type');
function variants(){const d=definitions.find(d=>d[0]===$('type').value);$('variant').innerHTML=Array.from({length:d[2]},(_,i)=>`<option value="${i}">样例 ${i+1} / ${d[2]}</option>`).join('');$('note').textContent=d[3];}
function render(){const url='learn.html?'+new URLSearchParams({template:$('type').value,variant:$('variant').value,state:$('state').value});$('preview').src=url;$('open').href=url;history.replaceState(null,'','?'+new URLSearchParams({type:$('type').value}));}
function size(){const dims={phone:[390,844],small:[320,568],landscape:[844,390],tablet:[1024,768]};const d=dims[$('size').value];$('preview').style.width=d?d[0]+'px':'100%';$('preview').style.height=d?d[1]+'px':'calc(100dvh - 48px)';}
$('type').onchange=()=>{variants();render();};$('variant').onchange=$('state').onchange=render;$('size').onchange=size;variants();size();render();
