/* 基线,但**从不**低分造反 —— 用来量比赛的判别力。
 * 它和基线只差 onRebel 一个布尔值,是能构造出来的最小的真实差异之一。
 * 如果连这个都测不出来,赛制的样本量就不够用。
 */
const {makeBaseline}=require('./baseline.js');
module.exports = ({E, AI}) => Object.assign(makeBaseline(AI, '基线-从不造反'),
                                            {onRebel(){ return false; }});
