/* Geometry and gesture thresholds are pure so they can be checked without a browser. */
(function(root){
  function split(cards){
    if(cards.length<=16)return [cards,[]];
    let cut=Math.ceil(cards.length/2);
    // Keep a physical pair together if moving the cut leaves at most 17 cards in each fan.
    const same=(a,b)=>a&&b&&a.suit===b.suit&&a.rank===b.rank;
    if(same(cards[cut-1],cards[cut])){
      const candidates=[cut-1,cut+1].filter(n=>n<=17&&cards.length-n<=17&&!same(cards[n-1],cards[n]));
      if(candidates.length)cut=candidates[0];
    }
    return [cards.slice(0,cut),cards.slice(cut)];
  }
  function layout(cards,width,height,row){
    const cw=Math.max(66,Math.min(78,width*.185)),ch=cw*1.48,pad=18;
    const step=cards.length<2?0:Math.max(23,Math.min(31,(width-pad*2-cw)/(cards.length-1)));
    const contentWidth=Math.max(width,cw+step*Math.max(0,cards.length-1)+pad*2);
    const start=(contentWidth-(cw+step*Math.max(0,cards.length-1)))/2;
    const stride=Math.max(52,height-ch-44);
    return {width:contentWidth,cardWidth:cw,cardHeight:ch,cards:cards.map((c,i)=>{
      const t=cards.length<2?0:(i/(cards.length-1)*2-1);
      return{id:c.id,x:start+i*step,y:30+row*stride+12*t*t,angle:t*7,width:cw,height:ch};
    })};
  }
  function intent(dx,dy){return dy < -20&&-dy>Math.abs(dx)*.75?'drag':Math.abs(dx)>12?'scrub':'pending';}
  function contains(rect,x,y){return x>=rect.left+8&&x<=rect.right-8&&y>=rect.top+8&&y<=rect.bottom-8;}
  const api={split,layout,intent,contains};
  if(typeof module!=='undefined')module.exports=api;
  root.FanUI=api;
})(typeof window!=='undefined'?window:globalThis);
