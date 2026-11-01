/* 真人牌谱里混进来的自动测试局(play-ui-e2e 等用浏览器打完整局、每手都「照提示出」)。
   10-25~10-31 传上去 108 局(v0.7.44~v0.7.49,每次 16 个设备尺寸各一局)——人那一座其实是 AI,做真人统计要剔掉。
   规则:人那一座自己出的手(by=h)≥3 手、七成以上照提示出(测试里偶尔手动拖一手;真人玩家照提示出的比例都是 0%)。 */
function isTestGame(r){
  const hs=[]; for(const t of r.tricks||[]) for(const p of t.plays||[]) if(p.seat===(r.human??0)&&(p.by||'h')==='h') hs.push(p);
  return hs.length>=3&&hs.filter(p=>p.hint).length>=0.7*hs.length;
}
module.exports={isTestGame};
