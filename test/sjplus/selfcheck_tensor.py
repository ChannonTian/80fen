"""自检 A:同一个局面,在 ShengJi+ **自己的环境**里编码出来的张量,和经适配层编码出来的,逐位相同。

  node test/sjplus/match.js --sj 80fen-test.html --opp engines/v0.5.7.js --n 20 --dump /tmp/dec.jsonl
  python -I test/sjplus/selfcheck_tensor.py --repo <shengji_plus 仓库> --dump /tmp/dec.jsonl

做法:match.js --dump 把我们引擎下每一手的局面(发给 sj_server 的那条消息,四个座位都记)和实际出的牌写下来;
这里把同一副牌在它的 env/Game.py 里**重打一遍**(手牌、底牌、主、庄直接摆好,然后一手一手 run_action),
每一手取它的 get_observation → 它的 MainModule.prepare_batch_inputs,和 sj_common.encode(消息) 比。
两条路互不相通:它那边的未出牌、得分、每墩历史都是它的引擎自己记的。

顺带量规则差异(不算失败,只报数):
  · 候选集合两边不一样的决策(我们合法它不合法 / 反过来)
  · 「这手出了是不是暂时最大」判得不一样的候选
  · 一墩的赢家两边判得不一样(之后把它那边的状态对回我们的,继续比)
  · 甩牌成不成立两边判得不一样
  · 末墩抠底后的总分两边不一样
不需要权重。张量有任何一位不同 → 退出码 1。
"""
import argparse
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import torch

import sj_common as sj

FIELDS = [('手牌', 108), ('庄家位置', 4), ('主/级', 20), ('亮主者位置', 4), ('炒地次数', 4), ('得分', 80),
          ('未见牌', 108), ('当前墩', 328), ('底牌', 108), ('是否最大', 1), ('动作', 108)]


def where(diff_idx, offset=0):
    out, lo = [], offset
    for name, n in FIELDS:
        k = sum(1 for i in diff_idx if lo <= i < lo + n)
        if k:
            out.append(f'{name}×{k}')
        lo += n
    return ' '.join(out) or '(前缀)'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    ap.add_argument('--dump', required=True)
    ap.add_argument('--verbose', action='store_true', help='把赢家判得不同的墩打出来')
    ap.add_argument('--max-lead', type=int, default=4, help='领出张数超过它就不在它的环境里枚举跟法(它的枚举是组合爆炸的),该手跳过')
    args = ap.parse_args()
    R = sj.setup_repo(args.repo)
    from env.Game import Game
    from env.Actions import FollowAction
    from agents.DMCAgent import MainModule
    CardSet, MoveType, Stage = R['CardSet'], R['MoveType'], R['Stage']

    def their_module(use_oracle):
        m = MainModule.__new__(MainModule)       # 绕开 __init__(里面写死了 .cuda() 和优化器,这里只要它的拼张量函数)
        m.use_oracle, m.dynamic_encoding = use_oracle, True   # 下面按它 act 的调法调 prepare_batch_inputs(不传 training)
        m._model = torch.nn.Linear(1, 1)
        return m
    mod, mod_oracle = their_module(False), their_module(True)

    C = Counter()
    bad_examples = []
    g = None
    hdr = None
    synced = True
    for line in open(args.dump, encoding='utf8'):
        rec = json.loads(line)
        t = rec['t']
        if t == 'game':
            hdr = rec
            g = Game(dominant_rank=rec['level'], dealer_position=sj.pos(rec['dealer']), enable_chaodi=False, enable_combos=False)
            for s in range(4):
                g.hands[sj.pos(s)] = sj.cardset(rec['hands'][s])
            g.kitty = sj.cardset(rec['kitty'])
            d = sj.declaration(rec['decl'])
            g.declarations = [d] if d else []
            if d:
                g.public_cards[d.absolute_position].add_card(*d.get_card(rec['level']))   # 亮主亮出来的牌(它 DeclareAction 里的那一句)
            g.stage = Stage.main_stage
            g.kitty_owner = sj.pos(rec['dealer'])
            g.round_history = [(sj.pos(rec['dealer']), [])]
            assert sum(h.size for h in g.hands.values()) == 100 and g.kitty.size == 8
            C['副'] += 1
            synced = True
            continue
        if t == 'trick':
            # 这一墩打完:它那边记的闲家得分、下一墩谁领,和我们的比
            if not g.game_ended:
                same = g.opponent_points == rec['att'] and g.round_history[-1][0] == sj.pos(rec['w'])
                C['墩'] += 1
                if not same:
                    ldr, plays = g.round_history[-2]
                    n_comp = len(plays[0].decompose(g.dominant_suit, g.dominant_rank))
                    C['墩赢家两边不同'] += 1
                    C['墩赢家两边不同:其中领出是甩牌' if n_comp > 1 else '墩赢家两边不同:其中领出是单一牌型'] += 1
                    if args.verbose:
                        print(f"  [赢家不同] 第 {C['副']} 副 主 {hdr['trump']} 级 {hdr['level']}:{ldr.value} 领 {plays} → 它判 {g.round_history[-1][0].value},我们判 {sj.POS_NAMES[rec['w']]}")
                    g.opponent_points = rec['att']
                    g.round_history[-1] = (sj.pos(rec['w']), [])
            else:
                C['墩'] += 1
                g._our_last = rec
            continue
        if t == 'end':
            C['打完的副'] += 1
            if g.game_ended and g.opponent_points != rec['total']:
                C['终局总分两边不同(末墩赢家或抠底倍数)'] += 1
            continue
        # ---- 一手决策 ----
        msg = rec['msg']
        me = sj.pos(msg['me'])
        cur = msg['tricks'][-1]
        lead_size = len(cur['plays'][0]) if cur['plays'] else 0
        C['决策'] += 1
        # 它那边现在的状态必须和消息说的是同一个局面(手牌一致),否则后面比的不是同一件事
        assert g.hands[me] == sj.cardset(msg['hand']), f"第 {C['副']} 副:重打到这里两边手牌不一致"
        obs_o = sj.build_obs(msg)
        sj.check_msg(msg, obs_o)
        cands = [sj.cardset(c) for c in msg['cands']]
        ours_idx = {str(c): i for i, c in enumerate(cands)}
        skip = lead_size > args.max_lead
        obs_t = None
        if not skip:
            try:
                obs_t = g.get_observation(me)
            except Exception as e:  # noqa: BLE001
                C['它的环境枚举跟法时抛异常'] += 1
        if obs_t is None:
            C['跳过(领出张数多 / 它那边抛异常)'] += 1
        else:
            x_o, h_o, _ = sj.encode(obs_o, cands, use_oracle=False, wins=None)
            theirs = {}
            for a in obs_t.actions:
                theirs[str(a.cardset)] = a
            common = [k for k in theirs if k in ours_idx]
            kind = '跟牌' if lead_size else '领出'
            C[f'{kind}决策'] += 1
            if set(theirs) != set(ours_idx):
                C[f'{kind}候选集合两边不同的决策'] += 1
                C[f'{kind}候选:只有我们有'] += len(set(ours_idx) - set(theirs))
                C[f'{kind}候选:只有它有'] += len(set(theirs) - set(ours_idx))
            for k in common:
                x_t, h_t, *_ = mod.prepare_batch_inputs([(obs_t, theirs[k], 0, None)])
                i = ours_idx[k]
                C['比过的(局面,候选)'] += 1
                if torch.equal(x_t[0], x_o[i]) and torch.equal(h_t[0], h_o[i]):
                    C['逐位相同'] += 1
                else:
                    C['不同'] += 1
                    if len(bad_examples) < 5:
                        dx = (x_t[0] != x_o[i]).nonzero().flatten().tolist()
                        dh = int((h_t[0] != h_o[i]).sum())
                        bad_examples.append(f"第 {C['副']} 副 座位 {msg['me']} 候选 {k}:x 不同 {where(dx)};历史不同 {dh} 位")
                if int(x_t[0, sj.STATE_DIM]) != msg['wins'][i]:
                    C['「是否暂时最大」两套裁判不同的候选'] += 1
            if common and C['决策'] % 7 == 0:            # 带 oracle 的拼法也抽查(前 324 位 = 别家明牌)
                k = common[0]
                x_t, h_t, *_ = mod_oracle.prepare_batch_inputs([(obs_t, theirs[k], 0, None)])
                x_oo, h_oo, _ = sj.encode(obs_o, [cands[ours_idx[k]]], use_oracle=True, wins=None)
                C['带 oracle 拼法抽查'] += 1
                if not (torch.equal(x_t[0], x_oo[0]) and torch.equal(h_t[0], h_oo[0])):
                    C['不同'] += 1
            if str(sj.cardset(rec['played'])) not in theirs:
                C[f'{kind}:我们实际出的牌不在它的合法动作里'] += 1
        # ---- 把实际出的牌在它那边落下去 ----
        played = sj.cardset(rec['played'])
        suit, rank = g.dominant_suit, g.dominant_rank
        if lead_size == 0:
            chosen = sj.cardset(rec['chosen'])
            if len(chosen.decompose(suit, rank)) > 1:        # 甩牌:它判成不成立、罚出哪一组
                C['甩牌'] += 1
                others = [g.hands[p] for p in (me.next_position, me.next_position.next_position, me.last_position)]
                try:
                    legal, penalty = CardSet.is_legal_combo(MoveType.Combo(chosen.copy()), others, suit, rank)
                    ours_ok = rec['chosen'] == rec['played'] or sorted(rec['chosen']) == sorted(rec['played'])
                    if legal != ours_ok or (not legal and penalty != played):
                        C['甩牌成立与否 / 罚出哪组 两边不同'] += 1
                except Exception:  # noqa: BLE001
                    C['甩牌:它的判定抛异常'] += 1
            g.round_history[-1][1].append(played)            # 领出直接落子(照它 EndLeadAction 的两个分支记明牌)
            g.hands[me].remove_cardset(played)
            g.unplayed_cards.remove_cardset(played)
            if rec['chosen'] != rec['played'] and sorted(rec['chosen']) != sorted(rec['played']):
                failed = chosen.copy()
                failed.remove_cardset(played)
                for card, count in failed.count_iterator():
                    if g.public_cards[me]._cards[card] < count:
                        g.public_cards[me]._cards[card] = count
            else:
                for card in played.card_list():
                    if g.public_cards[me].has_card(card):
                        g.public_cards[me].remove_card(card)
        else:
            try:
                g.run_action(FollowAction(played), me)
            except Exception as e:  # noqa: BLE001 —— 它的比大小在个别甩牌结构上会抛;那就没法在它那边续打这一副
                raise SystemExit(f"第 {C['副']} 副:它的引擎在落子时抛异常 {type(e).__name__}: {e};把这一副从 dump 里去掉再跑")

    print('自检 A:张量对拍(它自己的环境 vs 适配层)')
    order = ['副', '打完的副', '墩', '决策', '跳过(领出张数多 / 它那边抛异常)', '领出决策', '跟牌决策', '比过的(局面,候选)', '逐位相同', '不同', '带 oracle 拼法抽查']
    for k in order:
        print(f'  {k}: {C[k]}')
    print('  —— 规则差异(只报数)——')
    for k in sorted(C):
        if k not in order:
            print(f'  {k}: {C[k]}')
    for b in bad_examples:
        print('  !!', b)
    ok = C['不同'] == 0 and C['比过的(局面,候选)'] > 0
    print('结论:' + ('通过 —— 比过的张量全部逐位相同' if ok else '不通过'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
