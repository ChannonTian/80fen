/* 参赛提交的样板:导出一个工厂,裁判把**你自己那份** {E, AI} 传进来。
 *   E  —— 引擎(稳定契约,见 docs/contest-ops.md)
 *   AI —— 基线 v0.7.13 的全部内部函数(不保证跨版本稳定,用了就绑在这一版上)
 */
const {makeBaseline}=require('./baseline.js');
module.exports = ({E, AI}) => makeBaseline(AI, '基线 v0.7.13');
