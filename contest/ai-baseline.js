/* 参赛提交的样板:导出一个工厂,裁判把**你自己那份** {E, AI} 传进来。
 *   E  —— 引擎(稳定契约,见 docs/contest-ops.md)
 *   AI —— 这份 build 里 AI 的全部内部函数(不保证跨版本稳定,用了就绑在这一版上)
 *   version —— 这份 build 的版本号,从它自己的 #versionTag 上读出来的
 *
 * 名字里的版本号**跟着 build 走**,不写死:陪练包的是哪一份 build 的 AI 由
 * --build 决定(联赛跑的是正式版 index.html),写死过一次,于是它在正式版上
 * 自称测试版的版本号。
 */
const {makeBaseline}=require('./baseline.js');
module.exports = ({E, AI, version}) => makeBaseline(AI, '基线 '+(version||'未知版本'));
