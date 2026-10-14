/* @ds-bundle: {"format":4,"namespace":"Liuliu","components":[{"name":"Card"},{"name":"Hand"},{"name":"LeoAvatar"}]} */
/* 六六八十分 · Leo-Leo's 80s — vanilla helpers, no framework. window.Liuliu = { card, handPlan, renderHand, leoIdle }.
   Hand geometry follows the 80fen prototype (ui/dist/fan.js): split on an effective-suit boundary, 23–31px steps,
   one layer on short landscape, horizontal browsing ("拨牌") when a row is wider than the viewport. */
(function (root) {
  'use strict';
  var SUIT = { S: '♠', H: '♥', C: '♣', D: '♦' };
  var NAME_ZH = { S: '黑桃', H: '红桃', C: '梅花', D: '方块' };
  var NAME_EN = { S: 'spades', H: 'hearts', C: 'clubs', D: 'diamonds' };
  var RATIO = 1.43;

  /* card({rank:'K', suit:'H'} | {joker:'big'|'small'}, {width, pts, lang}) -> HTMLElement */
  function card(spec, opt) {
    opt = opt || {};
    var w = opt.width || 46, lang = opt.lang || 'zh';
    var el = document.createElement('span');
    el.className = 'll-card';
    el.style.fontSize = (w / 10) + 'px';
    el.setAttribute('role', 'img');
    var face = document.createElement('span');
    face.className = 'll-card__face';
    if (spec.joker) {
      el.classList.add(spec.joker === 'big' ? 'll-card--h' : 'll-card--s');
      var j = document.createElement('span');
      if (lang === 'en') { j.className = 'll-card__joker-en'; j.textContent = 'JOKER'; }
      else { j.className = 'll-card__joker'; j.innerHTML = (spec.joker === 'big' ? '大' : '小') + '<br>王'; }
      face.appendChild(j);
      el.setAttribute('aria-label', lang === 'en' ? (spec.joker === 'big' ? 'Big joker' : 'Small joker') : (spec.joker === 'big' ? '大王' : '小王'));
    } else {
      el.classList.add('ll-card--' + spec.suit.toLowerCase());
      var r = document.createElement('span'); r.className = 'll-card__rank' + (spec.rank.length > 1 ? ' ll-card__rank--two' : ''); r.textContent = spec.rank;
      var s = document.createElement('span'); s.className = 'll-card__suit'; s.textContent = SUIT[spec.suit] + '︎';
      face.appendChild(r); face.appendChild(s);
      el.setAttribute('aria-label', lang === 'en' ? spec.rank + ' of ' + NAME_EN[spec.suit] : NAME_ZH[spec.suit] + ' ' + spec.rank);
    }
    el.appendChild(face);
    if (opt.pts) { var p = document.createElement('span'); p.className = 'll-card__pts'; p.textContent = '+' + opt.pts; el.appendChild(p); }
    return el;
  }

  /* Split a sorted hand into two rows at the effective-suit boundary nearest the middle. */
  function split(cards, groupKey) {
    if (cards.length <= 16) return [cards, []];
    var cuts = [];
    for (var i = 1; i < cards.length; i++) if (groupKey(cards[i - 1]) !== groupKey(cards[i])) cuts.push(i);
    if (!cuts.length) return [cards, []];
    cuts.sort(function (a, b) { return Math.abs(cards.length - 2 * a) - Math.abs(cards.length - 2 * b); });
    return [cards.slice(0, cuts[0]), cards.slice(cuts[0])];
  }

  /* handPlan(cards, {width, height, viewportHeight, groupKey, wide}) -> {rows:[{cards:[{x,y,angle,w,h,card}], width}], cardWidth, cardHeight, twoRows} */
  function handPlan(cards, o) {
    var width = o.width, height = o.height, vh = o.viewportHeight || height * 3, gk = o.groupKey || function (c) { return c.group || c.suit; };
    var wide = o.wide != null ? o.wide : (width >= 700 || (width >= 560 && width > vh * 1.2));
    var cw, pad, minStep, maxStep, curve, tilt, top, rows, stride;
    if (!wide) {
      cw = Math.max(66, Math.min(78, width * 0.185, (height - 84) / RATIO));
      pad = 18; minStep = 23; maxStep = 31; curve = 8; tilt = 7; top = 24;
      rows = split(cards, gk);
      stride = rows[1].length ? Math.max(52, height - cw * RATIO - 36) : 0;
    } else {
      var compact = vh <= 720, short = vh <= 360;
      cw = compact ? (short ? 66 : 74) : (width >= 1100 ? 98 : 88);
      pad = compact ? 20 : 26; minStep = compact ? 24 : (width >= 1100 ? 28 : 26); maxStep = compact ? 32 : 46;
      curve = compact ? (short ? 8 : 12) : 20; tilt = compact ? 5 : 7; top = compact ? 26 : 32;
      var need = cw + Math.max(0, cards.length - 1) * minStep + pad * 2;
      rows = compact || need <= width ? [cards, []] : split(cards, gk);
      stride = rows[1].length ? Math.round(cw * RATIO * 0.83) : 0;
    }
    var ch = cw * RATIO;
    var out = rows.filter(function (r) { return r.length; }).map(function (rc, row) {
      var step = rc.length < 2 ? 0 : Math.max(minStep, Math.min(maxStep, (width - pad * 2 - cw) / (rc.length - 1)));
      var span = cw + step * Math.max(0, rc.length - 1);
      var cwidth = Math.max(width, span + pad * 2), start = (cwidth - span) / 2;
      return { width: cwidth, cards: rc.map(function (c, i) {
        var t = rc.length < 2 ? 0 : i / (rc.length - 1) * 2 - 1;
        return { card: c, x: start + i * step, y: top + row * stride + curve * t * t, angle: t * tilt, w: cw, h: ch };
      }) };
    });
    return { rows: out, cardWidth: cw, cardHeight: ch, twoRows: out.length > 1, overflow: out.some(function (r) { return r.width > width; }) };
  }

  /* renderHand(areaEl, cards, {groupKey, lang, onPlay(selected), onChange(selected)}) — fills .ll-hand-area and an optional .ll-hand-wheel sibling. */
  function renderHand(area, cards, o) {
    o = o || {};
    var vp = area.querySelector('.ll-hand-viewport') || area.appendChild(Object.assign(document.createElement('div'), { className: 'll-hand-viewport' }));
    var wheel = o.wheel || (area.parentNode && area.parentNode.querySelector('.ll-hand-wheel input'));
    var selected = new Set(), pos = 0, plan;
    function draw() {
      var w = vp.clientWidth, h = vp.clientHeight;
      plan = handPlan(cards, { width: w, height: h, viewportHeight: o.viewportHeight || window.innerHeight, groupKey: o.groupKey, wide: o.wide });
      vp.innerHTML = '';
      plan.rows.forEach(function (row, ri) {
        var r = document.createElement('div'); r.className = 'll-hand-row'; r.style.width = row.width + 'px'; r.dataset.max = row.width - w;
        row.cards.forEach(function (p, i) {
          var el = card(p.card, { width: p.w, lang: o.lang });
          el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; el.style.setProperty('--ang', p.angle + 'deg');
          el.style.zIndex = ri * 100 + i; el.dataset.id = p.card.id;
          if (selected.has(p.card.id)) el.classList.add('is-selected');
          r.appendChild(el);
        });
        vp.appendChild(r);
      });
      if (wheel) { wheel.disabled = !plan.overflow; wheel.closest('.ll-hand-wheel').classList.toggle('is-off', !plan.overflow); }
      scrollTo(pos);
    }
    function scrollTo(p) {
      pos = Math.max(0, Math.min(1, p));
      vp.querySelectorAll('.ll-hand-row').forEach(function (r) { r.style.transform = 'translateX(' + (-pos * Math.max(0, +r.dataset.max)) + 'px)'; });
      if (wheel) wheel.value = Math.round(pos * 1000);
    }
    if (wheel) { wheel.min = 0; wheel.max = 1000; wheel.addEventListener('input', function () { scrollTo(wheel.value / 1000); }); }
    var start = null;
    vp.addEventListener('pointerdown', function (e) {
      start = { x: e.clientX, y: e.clientY, pos: pos, target: e.target.closest('.ll-card'), mode: 'pending', pointerId: e.pointerId };
      if (vp.setPointerCapture) vp.setPointerCapture(e.pointerId);
    });
    vp.addEventListener('pointermove', function (e) {
      if (!start || e.pointerId !== start.pointerId) return;
      var dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (start.mode === 'pending') start.mode = dy < -20 && -dy > Math.abs(dx) * 0.35 ? 'drag' : Math.abs(dx) > 12 ? 'scrub' : 'pending';
      else if (start.mode === 'scrub' && dy < -24 && -dy > Math.abs(dx) * 0.65) start.mode = 'drag';
      if (start.mode === 'scrub' && plan.overflow) { var m = Math.max.apply(null, [].map.call(vp.querySelectorAll('.ll-hand-row'), function (r) { return +r.dataset.max; })); scrollTo(start.pos - dx / Math.max(1, m)); }
    });
    vp.addEventListener('pointerup', function (e) {
      if (!start || e.pointerId !== start.pointerId) return;
      if (start.mode === 'pending' && start.target) {
        var id = start.target.dataset.id;
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        start.target.classList.toggle('is-selected');
        o.onChange && o.onChange(Array.from(selected));
      } else if (start.mode === 'drag' && o.onPlay) {
        var id = start.target && start.target.dataset.id;
        var toPlay = id && !selected.has(id) ? [id] : Array.from(selected);
        if (toPlay.length) o.onPlay(toPlay);
      }
      start = null;
    });
    vp.addEventListener('pointercancel', function (e) {
      if (start && e.pointerId === start.pointerId) start = null;
    });
    if (root.ResizeObserver) new ResizeObserver(draw).observe(vp); else root.addEventListener('resize', draw);
    draw();
    return { redraw: draw, scrollTo: scrollTo, selected: function () { return Array.from(selected); }, select: function (ids) { ids.forEach(function (i) { selected.add(i); }); draw(); }, clear: function () { selected.clear(); draw(); } };
  }

  /* leoIdle(imgEl, srcByExpression) — the idle ladder: 30s groom, 60s yawn→content, 120s sleep; any input wakes to attentive. */
  function leoIdle(img, src, o) {
    o = o || {};
    var timers = [], wrap = img.closest('.ll-leo');
    function show(k) { img.src = src[k]; img.dataset.expr = k; }
    function clear() { timers.forEach(clearTimeout); timers = []; }
    function arm() {
      clear();
      timers.push(setTimeout(function () { show('groom'); timers.push(setTimeout(function () { show('attentive'); }, 4000)); }, o.groomAt || 30000));
      timers.push(setTimeout(function () { show('yawn'); timers.push(setTimeout(function () { show('content'); }, 1500)); }, o.yawnAt || 60000));
      timers.push(setTimeout(function () { show('sleep'); }, o.sleepAt || 120000));
    }
    function wake() {
      var was = img.dataset.expr; show('attentive'); arm();
      if (was && was !== 'attentive' && wrap && !matchMedia('(prefers-reduced-motion: reduce)').matches) { wrap.classList.remove('is-pop'); void wrap.offsetWidth; wrap.classList.add('is-pop'); }
    }
    ['pointerdown', 'keydown'].forEach(function (t) { document.addEventListener(t, wake, { passive: true }); });
    show('attentive'); arm();
    return { show: show, wake: wake, stop: clear };
  }

  root.Liuliu = { card: card, split: split, handPlan: handPlan, renderHand: renderHand, leoIdle: leoIdle };
})(window);
