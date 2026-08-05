# 80分 (Shanghai Rules) — Architecture Plan

Single-file web game (`index.html`, vanilla JS). Human + rule-based AI teammate vs. two rule-based AI opponents. Two modes: Normal Play and Learn-with-Coach.

## 1. Core principle: engine ≠ UI

Even in one file, keep three strictly separated layers. This is what makes the coach mode cheap to add and the rules testable.

```
┌─────────────────────────────────────────────┐
│  UI layer (DOM render + input)              │
│  render(state), card click handlers,        │
│  animations, coach panel                    │
├─────────────────────────────────────────────┤
│  Game engine (pure functions, no DOM)       │
│  state → legalMoves(state, player)          │
│  state' = applyMove(state, move)            │
│  trick/round resolution, scoring            │
├─────────────────────────────────────────────┤
│  AI layer (pure functions over engine API)  │
│  chooseMove(state, player) using            │
│  legalMoves + heuristics + card memory      │
└─────────────────────────────────────────────┘
```

Rule of thumb: the engine never touches `document`; the UI never decides legality; the AI only calls the same public engine functions the UI does.

## 2. Data model

```js
// Card: {suit: 'S'|'H'|'D'|'C'|'JOKER', rank: 2..14|'sj'|'bj', id} — id unique across 2 decks
// GameState:
{
  phase: 'deal' | 'bid' | 'kitty' | 'play' | 'roundEnd',
  players: [{hand: Card[], seat: 0..3, team: 0|1}],   // seat 0 = human; 0&2 vs 1&3
  trump: {suit, rank},          // rank = current level of declaring team
  levels: [2, 2],               // per-team level progression 2→A
  declarer: seatIndex,          // 庄家
  kitty: Card[],                // 底牌 (8 cards)
  trick: {leader, plays: [{seat, cards: Card[]}]},
  points: 0,                    // defender points captured this round (5/10/K)
  history: Trick[],             // completed tricks (feeds AI card memory + coach)
}
```

Key engine functions (all pure):
- `dealRound(state, rng)` — 2 decks (108 cards), 25 each, 8 kitty; trump declaration during deal
- `classifyPlay(cards, trump)` → single | pair | tractor(拖拉机) | throw(甩牌) — the hardest function; write it first and test it hard
- `legalMoves(state, seat)` — follow-suit enforcement, tractor-matching, throw validation/penalty
- `resolveTrick(trick, trump)` — winner + points
- `scoreRound(state)` — 80-point threshold, kitty multiplier if last trick won by defenders, level advancement

## 3. Rule-based AI

One AI module, parameterized by role (teammate vs. opponent behaves identically — good play is good play; the "teammate" just shares your team state).

Layered decision:
1. **Card memory** — track all cards seen (`history`), derive remaining counts per suit/rank. Cheap and makes the AI feel smart.
2. **Legal move generation** — from the engine, never reimplemented.
3. **Heuristic ranking** — priority rules, e.g.:
   - Leading: cash sure winners; lead trump to drain when strong; lead teammate's void
   - Following, partner winning: dump points (5/10/K) to partner
   - Following, opponent winning: win cheaply if points on table; else discard lowest
   - Trump management: count trumps out; save tractor structures
4. **Difficulty knobs** — probability of playing the top-ranked move vs. 2nd/3rd; memory accuracy. Gives Easy/Normal/Hard for free.

Keep each heuristic a named function returning `(move, score, reason)` — the `reason` string is reused by the coach.

## 4. Coach mode

Because the AI already produces `(move, score, reason)`, coach mode is mostly UI:
- **Hint**: run the AI on the human's seat, highlight its top move, show `reason`.
- **Mistake feedback**: after the human plays, compare their move's score vs. best; if gap > threshold, show "Better: ⟨move⟩ because ⟨reason⟩" (non-blocking toast, or blocking in "strict" mode).
- **Explain trick**: after each trick, one-line summary (who won, points captured, what mattered).
- **Guided tutorial**: scripted deals (seeded RNG) teaching bidding → following → tractors → point management, one concept per scenario.
- **Glossary panel**: 主/副牌, 拖拉机, 甩牌, 底牌, 抠底 with examples.

## 5. Build order (milestones)

Each milestone is playable/testable before moving on:

1. **M1 — Engine core**: cards, deal, trump, `classifyPlay`, `legalMoves`, trick resolution. In-file test harness (a `runTests()` with assert cases for tricky plays: tractors across trump, throws, jokers). *This is >50% of total difficulty.*
2. **M2 — Playable game, dumb AI**: full round loop with random-legal AI, minimal UI (text/cards as styled divs). You can now actually verify rules by playing.
3. **M3 — Real AI**: card memory + heuristics + reasons. Play until the teammate stops making you angry.
4. **M4 — Scoring & progression**: 80-point logic, kitty bonus, level advancement across rounds, round-end summary screen.
5. **M5 — Coach mode**: hint / feedback / explain, difficulty settings.
6. **M6 — Polish**: card graphics (unicode/SVG suits), animations, mobile layout, sounds.

## 6. Risks & mitigations

- **Rule ambiguity (biggest risk)**: Shanghai 80分 has house-rule variants (throw penalties, kitty multiplier ×2 vs. 2^n, trump declaration overrides). Mitigation: write a `RULES.md` companion doc as decisions come up; make variant points config flags in one `RULES` object.
- **`classifyPlay`/throw logic bugs**: mitigate with the M1 test harness; add every bug found during play as a test case.
- **Single file growing unwieldy**: acceptable to ~3–5k lines; use clear section banners. If it hurts, split into `engine.js`/`ai.js`/`ui.js` later — the layer separation makes this a 10-minute change.

## 7. First concrete step

Build M1: the engine with a visible test-runner page (no game UI yet). It forces every rules question to the surface early, while it's cheap to answer.
