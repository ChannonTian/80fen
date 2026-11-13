/* 把权重文件注册进某个引擎(vm 里的 80fen-test.html 导出对象)。
 *   require('./register.js').register(E,'ai2/weights/vnet-v1.json')
 * 注册后还要 E.AIP.vnet=1 才生效(ai-h2h / ai-pool 里用 OVN='{"vnet":1}')。 */
'use strict';
const fs=require('fs'),path=require('path');
const V=require('./vnet.js'), F=require('./featurize.js');
function register(E,file){
  const m=V.load(JSON.parse(fs.readFileSync(path.resolve(file),'utf8')));
  const out=new Float32Array(m.nbins);
  E.setVnet({ probs:sv=>V.predictRaw(m,F.rawFromState(sv),out) });
  return m;
}
module.exports={register};
