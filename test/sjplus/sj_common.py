"""ShengJi+ 适配层 —— Python 端公共部分。

只放我们自己写的代码。ShengJi+ 的仓库(无许可证)克隆在本仓库外面,按路径 import;
它的代码、权重都不进我们的仓库。

提供:
  setup_repo(repo)        把 ShengJi+ 仓库挂到 sys.path(并垫掉它两处与本任务无关的环境依赖)
  load_state(path)        torch.load(weights_only=True) 读一个 .pt(下载物当不可信数据,不反序列化任意对象)
  load_main_model(...)    读打牌主网络;use_oracle 从 fc1 的输入宽度推出来(不读 state.pkl,那是 pickle)
  build_obs(msg)          Node 发来的一条局面(我们的规则、我们的牌名) → 它的 Observation
  check_msg(msg, obs)     逐项断言:牌张守恒、座位、得分、底牌、候选
  encode(obs, cands, ...) Observation + 候选 → 它主网络吃的两个张量(和它 MainModule.prepare_batch_inputs 逐位相同,
                          由 selfcheck_tensor.py 对拍)

牌名:Node 端发 花色字母 + 点数('S14' = 黑桃 A,'X15' 小王,'X16' 大王);它用 'A♠' / 'XJ' / 'DJ'。
座位:我们 0..3,下家 = +1;它 N→W→S→E 是出牌顺序,所以 0,1,2,3 ↔ N,W,S,E。
"""
import os
import sys
import types

import torch

SUIT_SYM = {'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣'}
POS_NAMES = ['N', 'W', 'S', 'E']

_R = {}  # 延迟 import 的 ShengJi+ 符号


def setup_repo(repo):
    """把 ShengJi+ 仓库挂上。两处垫片都不改它的文件:
    · networks/Models.py 顶上有一句没用到的 `from turtle import forward`,没装 tkinter 的机器 import 会挂 → 塞一个空的 turtle 模块;
    · 它到处写死 .cuda() → 没有 CUDA 的机器上把 .cuda() 变成原样返回(只在本进程里)。"""
    repo = os.path.abspath(repo)
    if not os.path.isfile(os.path.join(repo, 'env', 'Observation.py')):
        raise SystemExit(f'找不到 ShengJi+ 仓库:{repo}(要的是含 env/Observation.py 的那一层)')
    if 'turtle' not in sys.modules:
        stub = types.ModuleType('turtle')
        stub.forward = None
        sys.modules['turtle'] = stub
    if not torch.cuda.is_available():
        torch.Tensor.cuda = lambda self, *a, **k: self
        torch.nn.Module.cuda = lambda self, *a, **k: self
    if repo not in sys.path:
        sys.path.insert(0, repo)
    from env.CardSet import CardSet, MoveType
    from env.Observation import Observation
    from env.utils import (LETTER_RANK, AbsolutePosition, Declaration, RelativePosition, Stage, TrumpSuit)
    import networks.Models as Models
    _R.update(CardSet=CardSet, MoveType=MoveType, Observation=Observation, LETTER_RANK=LETTER_RANK,
              AbsolutePosition=AbsolutePosition, Declaration=Declaration, RelativePosition=RelativePosition,
              Stage=Stage, TrumpSuit=TrumpSuit, Models=Models)
    return _R


def load_state(path):
    """读一个 state_dict。weights_only=True:只还原张量,不执行 pickle 里的任意对象。"""
    return torch.load(path, map_location='cpu', weights_only=True)


MAIN_IN_PLAIN = 1197 - 3 * 108 + 256   # 不带 oracle
MAIN_IN_ORACLE = 1197 + 256            # 带 oracle(评测时那 324 维填 0)


def load_main_model(ckpt_dir, device='cpu'):
    sd = load_state(os.path.join(ckpt_dir, 'main.pt'))
    in_f = sd['fc1.weight'].shape[1]
    if in_f not in (MAIN_IN_PLAIN, MAIN_IN_ORACLE):
        raise SystemExit(f'main.pt 的 fc1 输入宽度是 {in_f},既不是 {MAIN_IN_PLAIN} 也不是 {MAIN_IN_ORACLE} —— '
                         f'权重和仓库里的 networks/Models.py 对不上,先停下来查')
    use_oracle = in_f == MAIN_IN_ORACLE
    model = _R['Models'].MainModel(use_oracle=use_oracle)
    model.load_state_dict(sd, strict=True)
    model.eval().to(device)
    return model, use_oracle


def card_name(code):
    """'S14' → 'A♠';'X15' → 'XJ'(小王);'X16' → 'DJ'(大王)。"""
    s, r = code[0], int(code[1:])
    if s == 'X':
        assert r in (15, 16), code
        return 'XJ' if r == 15 else 'DJ'
    assert s in SUIT_SYM and 2 <= r <= 14, code
    return _R['LETTER_RANK'][r] + SUIT_SYM[s]


def cardset(codes):
    cs = _R['CardSet']()
    for c in codes:
        cs.add_card(card_name(c))
    assert all(v <= 2 for v in cs._cards.values()), f'同一张牌超过两张:{codes}'
    return cs


def pos(seat):
    return _R['AbsolutePosition'](POS_NAMES[seat])


def declaration(decl):
    """decl = None(没人亮主 → 无主,它那边 declaration=None)
           | {seat, suit:'S'|'H'|'D'|'C'|'XJ'|'DJ', level:0 单张 / 1 一对 / 2 小王对 / 3 大王对}"""
    if decl is None:
        return None
    TrumpSuit = _R['TrumpSuit']
    s = decl['suit']
    suit = TrumpSuit(SUIT_SYM[s]) if s in SUIT_SYM else TrumpSuit(s)
    assert suit.is_NT == (decl['level'] >= 2), decl
    return _R['Declaration'](suit, decl['level'], pos(decl['seat']))


def build_obs(msg):
    """msg 的字段(都由 Node 端 match.js 按我们引擎的状态填):
      level   级牌点数 2..14
      trump   主花色 'S'|'H'|'D'|'C',无主是 None
      decl    见 declaration()
      dealer  庄家座位(拿底、首攻)
      me      轮到谁
      hand    手牌
      kitty   底牌 8 张(只有庄家看得到;别人是 None)
      att     闲家(抓分方)已得分,不含抠底
      tricks  [{leader, plays:[[牌...],...], w?, shown?}],按时间顺序;最后一项是当前这一墩(自己领出时 plays 为空)。
              打完的墩带 w = 我们引擎判的赢家座位;shown = 这一墩领出者甩牌失败时亮出又收回的牌。
    """
    CardSet = _R['CardSet']
    me = pos(msg['me'])
    decl = declaration(msg['decl'])
    unplayed = CardSet.new_deck()[0]
    history = []
    # 「别家明牌」:亮主亮出来的牌、甩牌失败亮出来的牌,打出去就划掉 —— 照它 Game.run_action 的记法。
    # 只有带 oracle 练出来的权重才吃这一段(评测时那 324 维填的就是它);不带 oracle 的权重用不到。
    public = [CardSet() for _ in range(4)]
    if decl is not None:
        public[msg['decl']['seat']].add_card(*decl.get_card(msg['level']))
    for t in msg['tricks']:
        plays = [cardset(p) for p in t['plays']]
        for k, p in enumerate(plays):
            unplayed.remove_cardset(p)          # 它的 remove_card 自带断言:同一张不会被打出第三次
            seat = (t['leader'] + k) % 4
            if k == 0 and t.get('shown'):
                for card, count in cardset(t['shown']).count_iterator():
                    if public[seat]._cards[card] < count:
                        public[seat]._cards[card] = count
            else:
                for card in p.card_list():
                    if public[seat].has_card(card):
                        public[seat].remove_card(card)
        history.append((pos(t['leader']).relative_to(me), plays))
    obs = _R['Observation'](
        hand=cardset(msg['hand']),
        position=me,
        actions=[],
        stage=_R['Stage'].main_stage,
        dominant_rank=msg['level'],
        declaration=decl.relative_to(me) if decl else None,
        next_declaration_turn=None,
        dealer_position=pos(msg['dealer']).relative_to(me),
        # 它的 Game.get_observation 把两个字段都填成闲家得分(原仓库如此),网络就是这么练的,照做
        defender_points=msg['att'],
        opponent_points=msg['att'],
        round_history=history,
        unplayed_cards=unplayed,
        leads_current_trick=len(msg['tricks'][-1]['plays']) == 0,
        chaodi_times=[0, 0, 0, 0],              # 我们的规则没有炒地
        kitty=cardset(msg['kitty']) if msg.get('kitty') else None,
        perceived_right=public[(msg['me'] + 1) % 4],
        perceived_opposite=public[(msg['me'] + 2) % 4],
        perceived_left=public[(msg['me'] + 3) % 4],
    )
    return obs


def check_msg(msg, obs):
    """逐项断言。任何一条不过都说明适配层(或 Node 端的记账)有错,直接抛。"""
    TrumpSuit = _R['TrumpSuit']
    me, dealer = msg['me'], msg['dealer']
    tricks = msg['tricks']
    assert 2 <= msg['level'] <= 14, '级牌'
    # 主花色:我们的 trump.suit 和它的 dominant_suit 要说同一件事
    if msg['trump'] is None:
        assert obs.dominant_suit.is_NT, '我们无主,它那边不是'
    else:
        assert obs.dominant_suit == TrumpSuit(SUIT_SYM[msg['trump']]), '主花色对不上'
    if msg['decl'] is not None:
        assert msg['decl']['seat'] == dealer, '按 ai-h2h 的做法,亮主者就是庄家'
    # 墩的结构、出牌顺序、轮到谁
    assert tricks and tricks[0]['leader'] == dealer, '首攻应是庄家'
    played_by = [0, 0, 0, 0]
    att = 0
    for i, t in enumerate(tricks):
        last = i == len(tricks) - 1
        n = len(t['plays'])
        assert (n < 4) if last else (n == 4), f'第 {i + 1} 墩张数结构不对'
        if n:
            size = len(t['plays'][0])
            assert all(len(p) == size for p in t['plays']), f'第 {i + 1} 墩每家张数不等'
        for k, p in enumerate(t['plays']):
            played_by[(t['leader'] + k) % 4] += len(p)
        if not last:
            w = t['w']
            assert tricks[i + 1]['leader'] == w, f'第 {i + 2} 墩的领出者不是上一墩赢家'
            if w % 2 != dealer % 2:
                att += sum(c.total_points() for c in obs.round_history[i][1])
    cur = tricks[-1]
    assert (cur['leader'] + len(cur['plays'])) % 4 == me, '没轮到这个座位'
    # 得分:用它的 total_points() 按我们给的赢家重算一遍
    assert msg['att'] == att, f"闲家得分对不上:Node 给 {msg['att']},按墩重算 {att}"
    # 牌张守恒
    assert obs.hand.size + played_by[me] == 25, f'手牌 {obs.hand.size} + 已出 {played_by[me]} ≠ 25'
    assert obs.unplayed_cards.size == 108 - sum(played_by), '未出牌张数'
    assert obs.unplayed_cards.contains(obs.hand), '手牌里有已经打出去的牌'
    if me == dealer:
        assert obs.kitty is not None and obs.kitty.size == 8, '庄家应看得到 8 张底牌'
        rest = obs.unplayed_cards.copy()
        rest.remove_cardset(obs.hand)
        assert rest.contains(obs.kitty), '底牌和手牌 / 已出牌重了'
    else:
        assert obs.kitty is None, '只有庄家看得到底牌'
    # 候选
    cands = msg['cands']
    assert cands, '没有候选'
    need = len(cur['plays'][0]) if cur['plays'] else None
    seen = set()
    for c in cands:
        cs = cardset(c)
        assert obs.hand.contains(cs), f'候选不在手牌里:{c}'
        assert need is None or cs.size == need, f'跟牌张数不对:{c}'
        key = str(cs)
        assert key not in seen, f'候选重复:{c}'
        seen.add(key)


STATE_DIM = 108 + 4 + 20 + 4 + 4 + 80 + 108 + 328 + 108   # = 764,后面接 1 位「这手出了是不是暂时最大」+ 108 位动作
X_DIM = STATE_DIM + 1 + 108                                # = 873 = 1089 − 2×108


def encode(obs, cand_sets, use_oracle, wins=None):
    """→ (x[n, 873 或 1197], history[n, 15, 436], 两边「是否最大」不一致的候选数)。
    和 agents/DMCAgent.py 的 MainModule.act 走的那条路(prepare_batch_inputs,dynamic_encoding=True)同一个拼法,
    区别只是把局面部分算一次、所有候选一批出。带 oracle 的权重:它 act 时前 324 维填的是「别家明牌」
    (oracle_value=0 时 oracle_cardsets 退化成 perceived_cardsets),不是全 0,这里照做。

    wins:Node 端按**我们的**裁判算的「这手出了是不是暂时最大」。给了就用它(牌局是按我们的规则打的),
    同时数一下和它自己的 round_winner 判得不一样的有几个;不给就用它自己的(对拍时用)。"""
    suit, rank = obs.dominant_suit, obs.dominant_rank
    hist, cur = obs.historical_moves_dynamic_tensor
    state = torch.cat([
        obs.dynamic_hand_tensor,             # 108
        obs.dealer_position_tensor,          # 4
        obs.trump_tensor,                    # 20
        obs.declarer_position_tensor,        # 4
        obs.chaodi_times_tensor,             # 4
        obs.points_tensor,                   # 80
        obs.unplayed_cards_dynamic_tensor,   # 108
        cur,                                 # 328
        obs.kitty_dynamic_tensor,            # 108
    ])
    assert state.shape[0] == STATE_DIM
    n = len(cand_sets)
    x = torch.zeros((n, X_DIM))
    x[:, :STATE_DIM] = state
    mismatch = 0
    for i, cs in enumerate(cand_sets):
        try:
            theirs = int(obs.dominates_all_tensor(cs).item())
        except Exception:
            theirs = None                    # 它的比大小在少数甩牌结构上会抛异常
        if wins is not None:
            dom = int(wins[i])
            if theirs is None or theirs != dom:
                mismatch += 1
        else:
            if theirs is None:
                raise RuntimeError('它的 round_winner 在这个局面上抛了异常,而又没给我们的判定')
            dom = theirs
        x[i, STATE_DIM] = dom
        x[i, STATE_DIM + 1:] = cs.get_dynamic_tensor(suit, rank)
    if use_oracle:
        x = torch.cat([obs.perceived_cardsets.unsqueeze(0).expand(n, -1), x], dim=1)
    return x, hist.unsqueeze(0).expand(n, -1, -1).contiguous(), mismatch
