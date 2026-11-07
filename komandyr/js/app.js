'use strict';
/* ===== Графік нарядів: дані зберігаються локально (localStorage), працює офлайн ===== */
var KEY = 'dutyApp.v1';
var DOW = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
var MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
var MONTHS_G = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
var REASONS = ['Відпустка', 'Лікування', 'Відрядження', 'Завдання', 'Інше'];

var MODE = window.APP_MODE === 'client' ? 'client' : 'cmd';
var S; // state
var ui = { tab: 'sched', month: null, filterMine: false, statsRange: 'month', warnings: [] };

/* ---------- утиліти дат ---------- */
function pad(n) { return (n < 10 ? '0' : '') + n; }
function ds(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function pd(s) { var a = s.split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }
function addDays(s, n) { var d = pd(s); d.setDate(d.getDate() + n); return ds(d); }
function today() { return ds(new Date()); }
function dow(s) { return pd(s).getDay(); }
function isWk(s) { var w = dow(s); return w === 0 || w === 6; }
function diffDays(a, b) { return Math.round((pd(b) - pd(a)) / 864e5); }
function fmtD(s) { var d = pd(s); return d.getDate() + ' ' + MONTHS_G[d.getMonth()]; }
function fmtShort(s) { var d = pd(s); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1); }
function monthStart(s) { return s.slice(0, 8) + '01'; }
function monthEnd(s) { var d = pd(monthStart(s)); d.setMonth(d.getMonth() + 1); d.setDate(0); return ds(d); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function $(id) { return document.getElementById(id); }

/* ---------- стан ---------- */
function defaults() {
  return {
    people: [],
    types: [
      { id: 't1', name: 'Черговий по підрозділу', perDay: 1, days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', hours: 24, rest: 3, weight: 1 },
      { id: 't2', name: 'Черговий (днювальний)', perDay: 2, days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', hours: 24, rest: 2, weight: 1, split: true }
    ],
    meta: { unit: '', ver: 0 },
    A: {}, // 'YYYY-MM-DD|typeId|slot' -> {p: personId, m: true якщо вручну}
    set: { me: '', remind: false, remindAll: false, hoursBefore: 2, evening: true, eveningTime: '20:00', wkWeight: 1.5, cliRem: [60, 10], webUrl: 'https://eatmybeard86-prog.github.io/naryady/' }
  };
}
function load() {
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
  if (!S || !S.types) S = defaults();
  var d = defaults();
  for (var k in d.set) if (S.set[k] === undefined) S.set[k] = d.set[k];
  S.meta = S.meta || { unit: '', ver: 0 };
  if (MODE === 'cmd') S.types.forEach(function (t) { if (t.split === undefined) t.split = t.perDay > 1; });
  if (MODE === 'cmd' && !S.meta.splitFix) {
    // разове виправлення: наряди на кількох осіб без поділу показували всім однаковий час
    S.types.forEach(function (t) { if (t.perDay > 1 && !t.split) { t.split = true; if (t.hours * t.perDay <= 48) t.hours = t.hours * t.perDay; } });
    S.meta.splitFix = 1;
  }
  S.people.forEach(function (p) { p.abs = p.abs || []; p.types = p.types || []; if (p.active === undefined) p.active = true; });
}
var remindTimer = null;
function save() {
  localStorage.setItem(KEY, JSON.stringify(S));
  clearTimeout(remindTimer);
  remindTimer = setTimeout(scheduleReminders, 1200);
}
function person(id) { for (var i = 0; i < S.people.length; i++) if (S.people[i].id === id) return S.people[i]; return null; }
function dtype(id) { for (var i = 0; i < S.types.length; i++) if (S.types[i].id === id) return S.types[i]; return null; }
function pname(p) { return p ? ((p.rank ? p.rank + ' ' : '') + p.name) : '—'; }
function shortName(p) { return p ? p.name : '—'; }
function absentOn(p, d) { for (var i = 0; i < p.abs.length; i++) { var a = p.abs[i]; if (a.from <= d && d <= a.to) return a; } return null; }
function canDo(p, t) { return !p.types.length || p.types.indexOf(t.id) >= 0; }
function typeActive(t, d) { return t.days.indexOf(dow(d)) >= 0; }
function isSplit(t) { return !!t.split && t.perDay > 1; }
function shiftLen(t) { return (+t.hours || 24) / (isSplit(t) ? t.perDay : 1); } // годин на одну особу
function slotTimes(t, d, slot) {
  // зміни: при поділі доба (тривалість наряду) ділиться порівну між особами по черзі
  var a = (t.start || '08:00').split(':'), st = pd(d); st.setHours(+a[0] || 0, +a[1] || 0, 0, 0);
  var len = shiftLen(t) * 36e5;
  if (isSplit(t)) st = new Date(st.getTime() + (slot || 0) * len);
  return { start: st, end: new Date(st.getTime() + len) };
}
function hm(x) { return pad(x.getHours()) + ':' + pad(x.getMinutes()); }
function span(t, d, slot) {
  // «з 08:00 по 12:00», а якщо закінчується/починається іншого дня — з датою
  var r = slotTimes(t, d, slot), sd = ds(r.start), ed = ds(r.end);
  return 'з ' + hm(r.start) + (sd !== d ? ' (' + fmtShort(sd) + ')' : '') + ' по ' + hm(r.end) + (ed !== sd ? ' (' + fmtShort(ed) + ')' : '');
}
function weightOf(t, d) { return shiftLen(t); } // навантаження = фактичні години на одну особу
function parseKey(k) { var a = k.split('|'); return { date: a[0], tid: a[1], slot: +a[2] }; }

/* індекс: людина -> список нарядів */
function buildIndex() {
  var ix = {};
  for (var k in S.A) {
    var a = S.A[k]; if (!a || !a.p) continue;
    var q = parseKey(k);
    (ix[a.p] = ix[a.p] || []).push({ date: q.date, tid: q.tid, key: k });
  }
  return ix;
}

/* ---------- автоматичний розподіл ---------- */
function evaluate(p, t, d, ix, winFrom, winTo, ignoreKey, slot) {
  // повертає {ok, level, why, score...}; level: 0 — ідеально, 1 — порушено відпочинок, 2 — сусідній день, 9 — неможливо
  var r = { p: p, level: 0, why: '' };
  if (!p.active) { r.level = 9; r.why = 'неактивний'; return r; }
  if (!canDo(p, t)) { r.level = 9; r.why = 'не допущений до цього наряду'; return r; }
  var ab = absentOn(p, d);
  if (ab) { r.level = 9; r.why = ab.reason + ' до ' + fmtShort(ab.to); return r; }
  var list = ix[p.id] || [];
  var load = 0, tcnt = 0, nearest = 9999, sameDay = false;
  if (slot === undefined && ignoreKey) slot = parseKey(ignoreKey).slot;
  var me = slotTimes(t, d, slot || 0);
  for (var i = 0; i < list.length; i++) {
    var e = list[i]; if (e.key === ignoreKey) continue;
    var gap = Math.abs(diffDays(e.date, d));
    if (gap === 0) {
      // кілька змін за добу дозволено, якщо вони не перетинаються в часі
      var et0 = dtype(e.tid), ot = et0 && slotTimes(et0, e.date, parseKey(e.key).slot);
      if (ot && ot.start < me.end && me.start < ot.end) { r.level = 9; r.why = 'перетин у часі з іншою зміною (' + hm(ot.start) + '–' + hm(ot.end) + ')'; }
      else sameDay = true;
    }
    if (gap < nearest) nearest = gap;
    if (e.date >= winFrom && e.date <= winTo) {
      var et = dtype(e.tid);
      if (et) { load += weightOf(et, e.date); if (e.tid === t.id) tcnt++; }
    }
  }
  if (r.level === 9) return r;
  if (sameDay) { r.level = 2; r.why = 'ще одна зміна цього дня'; }
  else if (nearest <= 1) { r.level = 2; r.why = 'наряд у сусідній день'; }
  else if (nearest <= (+t.rest || 0)) { r.level = 1; r.why = 'мало відпочинку (' + (nearest - 1) + ' дн.)'; }
  // кількість доступних днів у вікні (для справедливості щодо відпусток і новоприбулих)
  var start = p.since && p.since > winFrom ? p.since : winFrom;
  var avail = Math.max(1, diffDays(start, winTo) + 1);
  for (var j = 0; j < p.abs.length; j++) {
    var a = p.abs[j];
    var f = a.from > start ? a.from : start, to = a.to < winTo ? a.to : winTo;
    if (f <= to) avail -= diffDays(f, to) + 1;
  }
  avail = Math.max(avail, 7);
  r.load = load; r.avail = avail; r.rate = load / avail; r.tcnt = tcnt; r.nearest = nearest;
  return r;
}
function cmpCand(a, b) {
  if (a.level !== b.level) return a.level - b.level;
  if (Math.abs(a.rate - b.rate) > 1e-9) return a.rate - b.rate;
  if (a.tcnt !== b.tcnt) return a.tcnt - b.tcnt;
  if (a.nearest !== b.nearest) return b.nearest - a.nearest;
  return a.rnd - b.rnd;
}
function rankCandidates(t, d, ix, winFrom, winTo, ignoreKey, slot) {
  return S.people.map(function (p) { var r = evaluate(p, t, d, ix, winFrom, winTo, ignoreKey, slot); r.rnd = Math.random(); return r; })
    .sort(function (a, b) { if (a.level === 9 || b.level === 9) return a.level - b.level; return cmpCand(a, b); });
}
function generate(from, to, keepManual) {
  var warns = [];
  for (var k in S.A) {
    var q = parseKey(k);
    if (q.date >= from && q.date <= to && (!keepManual || !S.A[k].m)) delete S.A[k];
  }
  var ix = buildIndex();
  var winFrom = addDays(from, -60), winTo = to;
  for (var d = from; d <= to; d = addDays(d, 1)) {
    S.types.forEach(function (t) {
      if (!typeActive(t, d)) return;
      for (var s = 0; s < t.perDay; s++) {
        var key = d + '|' + t.id + '|' + s;
        if (S.A[key]) continue;
        var c = rankCandidates(t, d, ix, winFrom, winTo, undefined, s)[0];
        if (!c || c.level === 9) { warns.push(fmtShort(d) + ' · ' + t.name + ': немає вільних людей'); continue; }
        if (c.level > 0) warns.push(fmtShort(d) + ' · ' + t.name + ': ' + shortName(c.p) + ' — ' + c.why);
        S.A[key] = { p: c.p.id };
        (ix[c.p.id] = ix[c.p.id] || []).push({ date: d, tid: t.id, key: key });
      }
    });
  }
  rebalance(from, to, ix, winFrom, winTo);
  S.meta.unsent = true;
  save();
  return warns;
}
/* вирівнювання: передаємо наряд від найбільш завантаженого тому, хто менше відпрацював, якщо не порушується відпочинок */
function rebalance(from, to, ix, winFrom, winTo) {
  var keys = Object.keys(S.A).filter(function (k) { var q = parseKey(k); return q.date >= from && q.date <= to && !S.A[k].m; });
  for (var pass = 0; pass < 6; pass++) {
    var moved = 0;
    keys.forEach(function (k) {
      var q = parseKey(k), t = dtype(q.tid), cur = person(S.A[k].p); if (!t || !cur) return;
      var h = shiftLen(t), rp = evaluate(cur, t, q.date, ix, winFrom, winTo, k);
      var best = null, bestVal = rp.rate + h / rp.avail - 1e-6;
      S.people.forEach(function (p) {
        if (p.id === cur.id) return;
        var r = evaluate(p, t, q.date, ix, winFrom, winTo, k);
        if (r.level !== 0) return;
        var v = r.rate + h / r.avail;
        if (v < bestVal) { bestVal = v; best = p; }
      });
      if (!best) return;
      ix[cur.id] = (ix[cur.id] || []).filter(function (e) { return e.key !== k; });
      (ix[best.id] = ix[best.id] || []).push({ date: q.date, tid: q.tid, key: k });
      S.A[k] = { p: best.id }; moved++;
    });
    if (!moved) break;
  }
}

/* ---------- нагадування ---------- */
function notif() { return window.cordova && cordova.plugins && cordova.plugins.notification && cordova.plugins.notification.local; }
function ensurePermission(cb) {
  var n = notif(); if (!n) { cb(false); return; }
  n.hasPermission(function (g) { if (g) cb(true); else n.requestPermission(function (g2) { cb(!!g2); }); });
}
function at(d, hm) { var a = (hm || '08:00').split(':'); var x = pd(d); x.setHours(+a[0] || 0, +a[1] || 0, 0, 0); return x; }
function remOffsets() {
  var r = MODE === 'client' ? S.meta.rem : S.set.cliRem;
  return (r && r.length ? r : [60, 10]).filter(function (x) { return x > 0; });
}
function nItem(id, title, text, when) {
  return { id: id, title: title, text: text, trigger: { at: when }, foreground: true, smallIcon: 'res://ic_launcher',
    androidChannelId: 'duty_alarm', androidChannelName: 'Нагадування про наряди', androidChannelImportance: 4,
    androidChannelEnableVibration: true, androidAllowWhileIdle: true, androidWakeUpScreen: true, androidLockscreen: true };
}
function parseMins(str) {
  var r = String(str).split(/[^0-9]+/).map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x > 0 && x <= 2880; });
  r = r.filter(function (x, i) { return r.indexOf(x) === i; }).sort(function (a, b) { return b - a; }).slice(0, 5);
  return r;
}
function scheduleReminders() {
  var n = notif(); if (!n) return;
  n.cancelAll(function () {
    var cli = MODE === 'client';
    if (cli ? !S.set.me : !S.set.remind) return;
    var me = S.set.me, all = !cli && (S.set.remindAll || !me);
    var now = Date.now(), horizon = now + 45 * 864e5, items = [], id = 1;
    var groups = {}; // date|tid -> [names]
    Object.keys(S.A).sort().forEach(function (k) {
      var a = S.A[k], q = parseKey(k), t = dtype(q.tid), p = person(a.p);
      if (!t || !p) return;
      if (!all && a.p !== me) return;
      var g = q.date + '|' + q.tid + (isSplit(t) ? '|' + pad(q.slot) : '');
      (groups[g] = groups[g] || { d: q.date, t: t, slot: isSplit(t) ? q.slot : 0, names: [], mine: false }).names.push(pname(p));
      if (a.p === me) groups[g].mine = true;
    });
    Object.keys(groups).sort().forEach(function (g) {
      var G = groups[g], start = slotTimes(G.t, G.d, G.slot).start;
      var who = all ? G.names.join(', ') : 'Ви';
      var title = G.mine ? 'Ваш наряд: ' + G.t.name : 'Наряд: ' + G.t.name;
      if (cli) {
        remOffsets().forEach(function (mins) {
          var tt = new Date(start.getTime() - mins * 6e4);
          if (tt > now && tt < horizon) items.push(nItem(id++, '⏰ ' + (mins >= 60 && mins % 60 === 0 ? 'За ' + (mins / 60) + ' год' : 'За ' + mins + ' хв') + ' — наряд: ' + G.t.name, fmtD(G.d) + ', ' + span(G.t, G.d, G.slot), tt));
        });
        return;
      }
      var hb = +S.set.hoursBefore;
      if (hb > 0) {
        var t1 = new Date(start.getTime() - hb * 36e5);
        if (t1 > now && t1 < horizon) items.push(nItem(id++, title, who + ' — ' + fmtD(G.d) + ', ' + span(G.t, G.d, G.slot) + ' (через ' + hb + ' год)', t1));
      }
      if (S.set.evening) {
        var t2 = at(addDays(G.d, -1), S.set.eveningTime);
        if (t2 < start && t2 > now && t2 < horizon) items.push(nItem(id++, title, 'Завтра (' + fmtD(G.d) + ') ' + span(G.t, G.d, G.slot) + ': ' + who, t2));
      }
    });
    items = items.slice(0, 200);
    if (items.length) n.schedule(items);
  });
}

/* ---------- інтерфейс: загальне ---------- */
function toast(msg, ms) {
  var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, ms || 2200);
}
var modalStack = [];
function openModal(html, onMount) {
  var m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = '<div class="sheet">' + html + '</div>';
  m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
  document.body.appendChild(m); modalStack.push(m);
  if (onMount) onMount(m.firstChild);
  return m.firstChild;
}
function closeModal() { var m = modalStack.pop(); if (m) m.remove(); }
function copyText(txt) {
  function fb() { var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { } ta.remove(); }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).catch(fb); else fb();
  toast('Скопійовано в буфер обміну');
}
function buildNav() {
  var tabs = MODE === 'client'
    ? [['mine', '🪖', 'Мої наряди'], ['sched', '📅', 'Графік'], ['settings', '⚙️', 'Налашт.']]
    : [['sched', '📅', 'Графік'], ['people', '👥', 'Склад'], ['types', '🛡️', 'Наряди'], ['stats', '📊', 'Статистика'], ['settings', '⚙️', 'Налашт.']];
  $('nav').innerHTML = tabs.map(function (t) { return '<button data-t="' + t[0] + '"><span class="i">' + t[1] + '</span>' + t[2] + '</button>'; }).join('');
  Array.prototype.forEach.call(document.querySelectorAll('nav button'), function (b) { b.onclick = function () { setTab(b.dataset.t); }; });
}
function setTab(t) {
  ui.tab = t;
  Array.prototype.forEach.call(document.querySelectorAll('nav button'), function (b) { b.classList.toggle('on', b.dataset.t === t); });
  render(); window.scrollTo(0, 0);
}
function render() {
  var v = $('view');
  var titles = { mine: 'Мої наряди', sched: 'Графік нарядів', people: 'Особовий склад', types: 'Види нарядів', stats: 'Статистика', settings: 'Налаштування' };
  $('title').textContent = titles[ui.tab];
  if (MODE === 'client' && ui.tab !== 'settings' && !S.meta.ver) { renderWelcome(v); return; }
  ({ mine: renderMine, sched: renderSched, people: renderPeople, types: renderTypes, stats: renderStats, settings: renderSettings })[ui.tab](v);
}

/* ---------- Графік ---------- */
function renderSched(v) {
  var m = ui.month, from = monthStart(m), to = monthEnd(m), td = today(), me = S.set.me;
  var h = '<div class="card"><div class="row"><button class="btn s" id="mPrev">◀</button><div class="grow" style="text-align:center;font-weight:600">' +
    MONTHS[pd(m).getMonth()] + ' ' + pd(m).getFullYear() + '</div><button class="btn s" id="mNext">▶</button></div>' +
    (MODE === 'cmd'
      ? '<div class="row" style="margin-top:10px"><button class="btn p grow" id="gen">⚙️ Розподілити</button><button class="btn p grow" id="send">📤 Надіслати бійцям</button><button class="btn" id="share" title="Копіювати текстом">📋</button></div>'
      : '<div class="row" style="margin-top:10px"><div class="grow mut">Оновлено: ' + fmtStamp(S.meta.ver) + '</div><button class="btn" id="upd">📥 Оновити</button><button class="btn" id="share" title="Копіювати текстом">📋</button></div>');
  if (me) h += '<div class="seg" style="margin-top:10px"><button id="fAll" class="' + (ui.filterMine ? '' : 'on') + '">Усі наряди</button><button id="fMine" class="' + (ui.filterMine ? 'on' : '') + '">Мої наряди</button></div>';
  h += '</div>';
  if (MODE === 'cmd' && S.meta.unsent) h += '<div class="warnbox" style="display:flex;gap:8px;align-items:center;position:sticky;top:58px;z-index:4"><div class="grow">Графік змінено — бійці ще не отримали оновлення.</div><button class="btn p s" id="sendNow">📤 Надіслати</button></div>';
  if (MODE === 'cmd' && !S.people.length) h += '<div class="warnbox">Спочатку додайте особовий склад на вкладці «Склад».</div>';
  if (ui.warnings.length) h += '<div class="warnbox"><b>Зауваження до розподілу (' + ui.warnings.length + '):</b><br>' + ui.warnings.slice(0, 12).map(esc).join('<br>') + (ui.warnings.length > 12 ? '<br>…' : '') + ' <br><a href="#" id="hideW" style="color:#f3d79a">Сховати</a></div>';
  var any = false;
  for (var d = from; d <= to; d = addDays(d, 1)) {
    var rows = '';
    S.types.forEach(function (t) {
      if (!typeActive(t, d)) return;
      var chips = '', mine = false;
      for (var s = 0; s < t.perDay; s++) {
        var key = d + '|' + t.id + '|' + s, a = S.A[key], p = a && person(a.p);
        if (p && p.id === me) mine = true;
        chips += '<span class="chip' + (p ? '' : ' e') + (a && a.m ? ' m' : '') + (p && p.id === me ? ' me' : '') + '" data-k="' + key + '">' + (p ? esc(pname(p)) + '<span class="tm">' + esc(span(t, d, s)) + '</span>' : (MODE === 'cmd' ? '+ призначити' : '—')) + '</span>';
      }
      if (ui.filterMine && !mine) return;
      rows += '<div class="slot"><div class="t">' + esc(t.name) + '</div><div class="chips">' + chips + '</div></div>';
    });
    if (!rows) continue;
    any = true;
    h += '<div class="day' + (isWk(d) ? ' wk' : '') + (d === td ? ' today' : '') + (d < td ? ' past' : '') + '" id="d' + d + '"><div class="dh"><span>' + fmtD(d) + '</span><span class="mut">' + DOW[dow(d)] + (d === td ? ' · сьогодні' : '') + (MODE === 'cmd' ? ' <button class="btn s tplb" data-d="' + d + '" title="Повторювати цей день (щодня, через день, цикл з кількох днів)">⧉ повторити</button>' : '') + '</span></div>' + rows + '</div>';
  }
  if (!any) h += '<div class="empty">' + (ui.filterMine ? 'У цьому місяці у вас нарядів немає.' : 'Немає активних видів нарядів.') + '</div>';
  if (MODE === 'cmd') h += '<p class="mut" style="text-align:center">Утримайте ім’я і перетягніть на інше — люди поміняються місцями (або на «+ призначити» — перенесеться). Натисніть на ім’я, щоб вибрати заміну зі списку. Зелена рамка — змінено вручну, автопідбір її не чіпає.</p>';
  v.innerHTML = h;
  $('mPrev').onclick = function () { var x = pd(m); x.setMonth(x.getMonth() - 1); ui.month = ds(x); render(); };
  $('mNext').onclick = function () { var x = pd(m); x.setMonth(x.getMonth() + 1); ui.month = ds(x); render(); };
  if (MODE === 'cmd') { $('gen').onclick = genDialog; $('send').onclick = sendDialog; if ($('sendNow')) $('sendNow').onclick = sendDialog; } else $('upd').onclick = importDialog;
  $('share').onclick = function () { copyText(exportText(from, to)); };
  if (me) { $('fAll').onclick = function () { ui.filterMine = false; render(); }; $('fMine').onclick = function () { ui.filterMine = true; render(); }; }
  if ($('hideW')) $('hideW').onclick = function (e) { e.preventDefault(); ui.warnings = []; render(); };
  Array.prototype.forEach.call(v.querySelectorAll('.chip'), function (c) { if (MODE === 'cmd') c.onclick = function () { if (drag.justDropped) return; slotDialog(c.dataset.k); }; });
  if (MODE === 'cmd') { enableDrag(v); Array.prototype.forEach.call(v.querySelectorAll('.tplb'), function (b) { b.onclick = function () { templateDialog(b.dataset.d); }; }); }
  if (m === monthStart(td) && $('d' + td) && !ui.scrolled) { ui.scrolled = true; setTimeout(function () { var el = $('d' + td); if (el) window.scrollTo(0, el.offsetTop - 70); }, 50); }
}
/* ---------- перетягування: утримайте ім'я і перетягніть на інше — люди поміняються місцями ---------- */
var drag = { justDropped: false };
function enableDrag(root) {
  Array.prototype.forEach.call(root.querySelectorAll('.chip[data-k]'), function (c) {
    if (!S.A[c.dataset.k]) return; // тягнути можна лише призначену людину
    c.addEventListener('touchstart', function (e) { pressStart(c, e.touches[0].clientX, e.touches[0].clientY, true); }, { passive: true });
    c.addEventListener('mousedown', function (e) { if (e.button === 0) pressStart(c, e.clientX, e.clientY, false); });
  });
}
function pressStart(chip, x, y, touch) {
  cancelDrag();
  drag.src = chip; drag.x0 = x; drag.y0 = y; drag.touch = touch; drag.active = false;
  drag.timer = setTimeout(function () { beginDrag(x, y); }, touch ? 350 : 200);
  drag.onMove = function (e) {
    var p = touch ? e.touches[0] : e; if (!p) return;
    if (!drag.active) { if (Math.abs(p.clientX - drag.x0) > 10 || Math.abs(p.clientY - drag.y0) > 10) { if (touch) cancelDrag(); else beginDrag(p.clientX, p.clientY); } return; }
    if (e.cancelable) e.preventDefault();
    moveDrag(p.clientX, p.clientY);
  };
  drag.onEnd = function (e) {
    var p = touch ? (e.changedTouches && e.changedTouches[0]) : e;
    if (drag.active && p) endDrag(p.clientX, p.clientY); else cancelDrag();
  };
  document.addEventListener(touch ? 'touchmove' : 'mousemove', drag.onMove, { passive: false });
  document.addEventListener(touch ? 'touchend' : 'mouseup', drag.onEnd);
  if (touch) document.addEventListener('touchcancel', cancelDrag);
}
function beginDrag(x, y) {
  if (!drag.src) return;
  clearTimeout(drag.timer); drag.active = true;
  if (navigator.vibrate) try { navigator.vibrate(25); } catch (e) { }
  var g = drag.src.cloneNode(true); g.className = 'chip ghost'; document.body.appendChild(g); drag.ghost = g;
  drag.src.classList.add('dragsrc'); document.body.classList.add('dragging');
  moveDrag(x, y);
}
function chipAt(x, y) {
  if (drag.ghost) drag.ghost.style.display = 'none';
  var el = document.elementFromPoint(x, y);
  if (drag.ghost) drag.ghost.style.display = '';
  while (el && !(el.classList && el.classList.contains('chip') && el.dataset.k)) el = el.parentNode;
  return el && el !== drag.src ? el : null;
}
function moveDrag(x, y) {
  var g = drag.ghost; if (!g) return;
  g.style.left = (x - g.offsetWidth / 2) + 'px'; g.style.top = (y - g.offsetHeight - 18) + 'px';
  var t = chipAt(x, y);
  if (drag.over && drag.over !== t) drag.over.classList.remove('dropto');
  if (t) t.classList.add('dropto'); drag.over = t;
  // автопрокрутка біля країв екрана
  clearInterval(drag.scroll);
  var edge = 70, h = window.innerHeight, dy = y < edge + 50 ? -12 : y > h - edge - 60 ? 12 : 0;
  if (dy) drag.scroll = setInterval(function () { window.scrollBy(0, dy); }, 16);
}
function endDrag(x, y) {
  var t = chipAt(x, y), a = drag.src.dataset.k;
  cancelDrag();
  drag.justDropped = true; setTimeout(function () { drag.justDropped = false; }, 400);
  if (t) swapSlots(a, t.dataset.k);
}
function cancelDrag() {
  clearTimeout(drag.timer); clearInterval(drag.scroll);
  if (drag.onMove) { document.removeEventListener('touchmove', drag.onMove); document.removeEventListener('mousemove', drag.onMove); }
  if (drag.onEnd) { document.removeEventListener('touchend', drag.onEnd); document.removeEventListener('mouseup', drag.onEnd); }
  document.removeEventListener('touchcancel', cancelDrag);
  if (drag.ghost) drag.ghost.remove();
  if (drag.over) drag.over.classList.remove('dropto');
  if (drag.src) drag.src.classList.remove('dragsrc');
  document.body.classList.remove('dragging');
  drag.ghost = drag.over = drag.src = drag.onMove = drag.onEnd = null; drag.active = false;
}
function swapSlots(ka, kb) {
  if (ka === kb) return;
  var A = S.A[ka], B = S.A[kb]; if (!A) return;
  var pa = person(A.p), pb = B && person(B.p), qa = parseKey(ka), qb = parseKey(kb);
  // перевірка після обміну
  var probs = [], ix = buildIndex();
  [[pa, kb, ka], [pb, ka, kb]].forEach(function (x) {
    if (!x[0]) return;
    var q = parseKey(x[1]), t = dtype(q.tid);
    var list = (ix[x[0].id] || []).filter(function (e) { return e.key !== x[2]; });
    var ix2 = {}; ix2[x[0].id] = list;
    var r = evaluate(x[0], t, q.date, ix2, addDays(q.date, -60), addDays(q.date, 30), x[1]);
    if (r.level === 9) probs.push(pname(x[0]) + ' ' + fmtShort(q.date) + ': ' + r.why);
  });
  if (probs.length && !confirm('Увага:\n' + probs.join('\n') + '\n\nВсе одно поміняти?')) return;
  if (pb) S.A[ka] = { p: pb.id, m: true }; else delete S.A[ka];
  S.A[kb] = { p: pa.id, m: true };
  S.meta.unsent = true; save(); render();
  toast(pb ? 'Поміняли: ' + shortName(pa) + ' ⇄ ' + shortName(pb) : shortName(pa) + ' → ' + fmtShort(qb.date));
}
/* ---------- шаблони днів: цикл із кількох денних графіків (А, Б, В, А, Б, В…) ---------- */
function dayFilled(d) { var n = 0; S.types.forEach(function (t) { for (var s = 0; s < t.perDay; s++) if (S.A[d + '|' + t.id + '|' + s]) n++; }); return n; }
function dayLabel(d) {
  var names = [];
  S.types.forEach(function (t) { for (var s = 0; s < t.perDay; s++) { var a = S.A[d + '|' + t.id + '|' + s]; if (a && person(a.p)) names.push(person(a.p).name); } });
  return fmtShort(d) + ' ' + DOW[dow(d)] + ' — ' + names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '');
}
function templateDialog(src) {
  if (!dayFilled(src)) { toast('Цей день порожній — спочатку заповніть його'); return; }
  var cands = [];
  for (var d = addDays(monthStart(ui.month), -7); d <= addDays(monthEnd(ui.month), 7); d = addDays(d, 1)) if (dayFilled(d)) cands.push(d);
  if (cands.indexOf(src) < 0) cands.push(src);
  var L = 'ABCDEFGHIJKLMN'.split('').map(function (x, i) { return 'АБВГДЕЖЗИКЛМНО'[i]; });
  function rowsHtml(n, keep) {
    var h = '';
    for (var i = 0; i < n; i++) {
      var def = keep[i] !== undefined ? keep[i] : (i === 0 ? src : (dayFilled(addDays(src, i)) ? addDays(src, i) : ''));
      h += '<div class="row" style="margin-top:6px"><span style="width:62px" class="mut">' + (i + 1) + '-й день</span><select class="tpS grow">' +
        '<option value="">Автоматично (по черзі)</option>' +
        cands.map(function (c) { return '<option value="' + c + '"' + (c === def ? ' selected' : '') + '>' + esc(dayLabel(c)) + '</option>'; }).join('') + '</select></div>';
    }
    return h;
  }
  var to = monthEnd(ui.month); if (to <= src) to = addDays(src, 30);
  var sh = openModal('<h3>Повторення графіка</h3><p class="mut">Задайте цикл: який денний графік ставити в 1-й, 2-й, 3-й… день. Цикл повторюватиметься весь період. Напр. «через день» — цикл 2 дні: 1-й — потрібний день, 2-й — інший графік або «Автоматично».</p>' +
    '<label class="f">Довжина циклу, днів</label><div class="row"><button class="btn s" id="tpM">−</button><input type="number" id="tpN" min="1" max="14" value="1" style="width:70px;text-align:center"><button class="btn s" id="tpP">+</button><span class="mut grow" id="tpH"></span></div>' +
    '<div id="tpR">' + rowsHtml(1, []) + '</div>' +
    '<div class="row"><div class="grow"><label class="f">Почати з дати (1-й день циклу)</label><input type="date" id="tpF" value="' + addDays(src, 1) + '"></div><div class="grow"><label class="f">По дату</label><input type="date" id="tpT" value="' + to + '"></div></div>' +
    '<p class="mut">Якщо хтось відсутній — його зміну в цей день буде заповнено автоматично, а вас попереджено.</p>' +
    '<button class="btn p w" id="tpGo">Застосувати</button>');
  function sel() { return Array.prototype.map.call(sh.querySelectorAll('.tpS'), function (s) { return s.value; }); }
  function setN(n) {
    n = Math.max(1, Math.min(14, n | 0)); var keep = sel();
    sh.querySelector('#tpN').value = n; sh.querySelector('#tpR').innerHTML = rowsHtml(n, keep); hint();
    Array.prototype.forEach.call(sh.querySelectorAll('.tpS'), function (s) { s.onchange = hint; });
  }
  function hint() {
    var v = sel(), map = {}, k = 0;
    var seq = v.map(function (x) { if (!x) return '·'; if (!map[x]) map[x] = L[k++] || '?'; return map[x]; });
    sh.querySelector('#tpH').textContent = 'Цикл: ' + seq.concat(seq).concat(seq).slice(0, Math.max(6, seq.length * 2)).join(' ') + ' …' + (v.indexOf('') >= 0 ? '  (· — авто)' : '');
  }
  sh.querySelector('#tpM').onclick = function () { setN(+sh.querySelector('#tpN').value - 1); };
  sh.querySelector('#tpP').onclick = function () { setN(+sh.querySelector('#tpN').value + 1); };
  sh.querySelector('#tpN').onchange = function () { setN(+this.value); };
  setN(1);
  sh.querySelector('#tpGo').onclick = function () {
    var f = sh.querySelector('#tpF').value, t = sh.querySelector('#tpT').value, cyc = sel();
    if (!f || !t || f > t) { toast('Невірний період'); return; }
    if (diffDays(f, t) > 366) { toast('Максимум — рік'); return; }
    if (!cyc.some(Boolean)) { toast('Оберіть хоча б один денний графік'); return; }
    ui.warnings = applyCycle(cyc, f, t);
    S.meta.unsent = true; save(); closeModal(); render();
    toast(ui.warnings.length ? 'Готово, є зауваження: ' + ui.warnings.length : 'Графік за циклом застосовано ✔', 3000);
  };
}
function applyCycle(cyc, from, to) {
  // знімок шаблонів до очищення періоду (шаблонні дні можуть бути всередині періоду)
  var snap = {};
  cyc.forEach(function (d) {
    if (!d || snap[d]) return; snap[d] = {};
    S.types.forEach(function (t) { for (var s = 0; s < t.perDay; s++) { var a = S.A[d + '|' + t.id + '|' + s]; if (a) snap[d][t.id + '|' + s] = a.p; } });
  });
  for (var k in S.A) { var q = parseKey(k); if (q.date >= from && q.date <= to) delete S.A[k]; }
  var warns = [], ix = buildIndex(), anyAuto = false;
  for (var d = from, i = 0; d <= to; d = addDays(d, 1), i++) {
    var src = cyc[i % cyc.length];
    if (!src) { anyAuto = true; continue; }
    var busy = {};
    S.types.forEach(function (t) {
      if (!typeActive(t, d)) return;
      for (var s = 0; s < t.perDay; s++) {
        var pid = snap[src][t.id + '|' + s], p = pid && person(pid), key = d + '|' + t.id + '|' + s;
        if (!pid) { anyAuto = true; continue; }
        if (p && p.active && canDo(p, t) && !absentOn(p, d)) { S.A[key] = { p: p.id, m: true }; busy[p.id] = 1; (ix[p.id] = ix[p.id] || []).push({ date: d, tid: t.id, key: key }); continue; }
        var used = {}; for (var k2 in S.A) if (parseKey(k2).date === d) used[S.A[k2].p] = 1;
        // заміна: вільний у цей день і без шаблонної зміни сьогодні
        var c = rankCandidates(t, d, ix, addDays(d, -30), d, undefined, s).filter(function (r) { return r.level < 9 && !used[r.p.id] && !inTemplateDay(snap[src], r.p.id); })[0]
             || rankCandidates(t, d, ix, addDays(d, -30), d, undefined, s).filter(function (r) { return r.level < 9 && !used[r.p.id]; })[0];
        if (c) { S.A[key] = { p: c.p.id, m: true }; busy[c.p.id] = 1; (ix[c.p.id] = ix[c.p.id] || []).push({ date: d, tid: t.id, key: key }); }
        var ab = p && absentOn(p, d);
        warns.push(fmtShort(d) + ' · ' + t.name + ' ' + hm(slotTimes(t, d, s).start) + ': ' + shortName(p) + ' ' + (ab ? ab.reason.toLowerCase() : 'недоступний') + ' → ' + (c ? shortName(c.p) : 'немає заміни'));
      }
    });
  }
  if (anyAuto) warns = warns.concat(generate(from, to, true));
  return warns;
}
function inTemplateDay(map, pid) { for (var k in map) if (map[k] === pid) return true; return false; }
function genDialog() {
  if (!S.people.length) { toast('Спочатку додайте особовий склад'); return; }
  var from = monthStart(ui.month), to = monthEnd(ui.month), td = today();
  if (from < td && td <= to) from = td;
  var sh = openModal('<h3>Автоматичний розподіл</h3><p class="mut">Наряди розподіляються рівномірно за фактичними годинами з урахуванням відпусток, відпочинку між нарядами та попередніх нарядів.</p>' +
    '<div class="row"><div class="grow"><label class="f">З дати</label><input type="date" id="gFrom" value="' + from + '"></div><div class="grow"><label class="f">По дату</label><input type="date" id="gTo" value="' + to + '"></div></div>' +
    '<label class="row" style="margin:12px 0"><input type="checkbox" id="gKeep" checked> Зберегти призначення, зроблені вручну</label>' +
    '<div class="row"><button class="btn grow" id="gClr">Очистити період</button><button class="btn p grow" id="gGo">Розподілити</button></div>');
  sh.querySelector('#gGo').onclick = function () {
    var f = sh.querySelector('#gFrom').value, t = sh.querySelector('#gTo').value;
    if (!f || !t || f > t) { toast('Невірний період'); return; }
    if (diffDays(f, t) > 366) { toast('Максимум — рік'); return; }
    ui.warnings = generate(f, t, sh.querySelector('#gKeep').checked);
    closeModal(); render();
    toast(ui.warnings.length ? 'Готово, є зауваження: ' + ui.warnings.length : 'Графік складено ✔');
  };
  sh.querySelector('#gClr').onclick = function () {
    var f = sh.querySelector('#gFrom').value, t = sh.querySelector('#gTo').value, keep = sh.querySelector('#gKeep').checked;
    if (!confirm('Видалити ' + (keep ? 'автоматичні ' : 'всі ') + 'призначення з ' + fmtShort(f) + ' по ' + fmtShort(t) + '?')) return;
    for (var k in S.A) { var q = parseKey(k); if (q.date >= f && q.date <= t && (!keep || !S.A[k].m)) delete S.A[k]; }
    save(); ui.warnings = []; closeModal(); render();
  };
}
function slotDialog(key) {
  var q = parseKey(key), t = dtype(q.tid), a = S.A[key], cur = a && person(a.p);
  var ix = buildIndex();
  var c = rankCandidates(t, q.date, ix, addDays(q.date, -60), addDays(q.date, 30), key);
  var h = '<h3>' + esc(t.name) + '</h3><div class="mut">' + fmtD(q.date) + ', ' + DOW[dow(q.date)] + ', ' + esc(span(t, q.date, q.slot)) + '</div>' +
    '<p>Зараз: <b>' + (cur ? esc(pname(cur)) : '— не призначено') + '</b>' + (a && a.m ? ' <span class="tag">вручну</span>' : '') + '</p>' +
    '<div class="row" style="margin-bottom:8px">' + (a ? '<button class="btn s d" id="sClr">Звільнити</button>' : '') + (a && a.m ? '<button class="btn s" id="sAuto">Дозволити автопідбір</button>' : '') + '</div>' +
    '<div class="mut" style="margin:6px 0">Оберіть заміну (зверху — найкращі кандидати):</div>';
  c.forEach(function (r, i) {
    if (cur && r.p.id === cur.id) return;
    var info = r.level === 9 ? r.why : (r.level ? '⚠ ' + r.why + ' · ' : '') + +(r.load || 0).toFixed(1) + ' год' + (r.nearest < 9999 ? ' · ост. ' + r.nearest + ' дн.' : '');
    h += '<div class="cand' + (r.level === 9 ? ' no' : '') + '" data-p="' + r.p.id + '"><span>' + esc(pname(r.p)) + '</span><span class="mut" style="text-align:right">' + esc(info) + '</span></div>';
  });
  var sh = openModal(h);
  Array.prototype.forEach.call(sh.querySelectorAll('.cand'), function (el) {
    el.onclick = function () {
      if (el.classList.contains('no') && !confirm('Ця людина недоступна (' + el.lastChild.textContent + '). Все одно призначити?')) return;
      S.A[key] = { p: el.dataset.p, m: true }; S.meta.unsent = true; save(); closeModal(); render();
    };
  });
  if (sh.querySelector('#sClr')) sh.querySelector('#sClr').onclick = function () { delete S.A[key]; S.meta.unsent = true; save(); closeModal(); render(); };
  if (sh.querySelector('#sAuto')) sh.querySelector('#sAuto').onclick = function () { delete S.A[key].m; save(); closeModal(); render(); };
}
function exportText(from, to) {
  var out = 'ГРАФІК НАРЯДІВ ' + fmtShort(from) + ' – ' + fmtShort(to) + '.' + pd(to).getFullYear() + '\n';
  for (var d = from; d <= to; d = addDays(d, 1)) {
    var lines = [];
    S.types.forEach(function (t) {
      if (!typeActive(t, d)) return;
      var names = [];
      if (isSplit(t)) {
        lines.push('  ' + t.name + ':');
        for (var s2 = 0; s2 < t.perDay; s2++) { var a2 = S.A[d + '|' + t.id + '|' + s2]; lines.push('    ' + span(t, d, s2) + ' — ' + (a2 ? pname(person(a2.p)) : '—')); }
        return;
      }
      for (var s = 0; s < t.perDay; s++) { var a = S.A[d + '|' + t.id + '|' + s]; names.push(a ? pname(person(a.p)) : '—'); }
      lines.push('  ' + t.name + ' (' + span(t, d, 0) + '): ' + names.join(', '));
    });
    if (lines.length) out += '\n' + fmtShort(d) + ' (' + DOW[dow(d)] + ')\n' + lines.join('\n');
  }
  return out;
}

/* ---------- Особовий склад ---------- */
function renderPeople(v) {
  var td = today(), ix = buildIndex();
  var ppl = S.people.slice().sort(function (a, b) { return (b.active - a.active) || a.name.localeCompare(b.name, 'uk'); });
  var h = '<div class="card"><h3>Додати особовий склад</h3><div class="mut">По одному на рядок: «звання Прізвище І.П.» або просто прізвище.</div>' +
    '<textarea id="bulk" rows="3" placeholder="солдат Петренко П.П.&#10;ст. солдат Іваненко І.І." style="margin-top:6px"></textarea>' +
    '<button class="btn p w" id="addB" style="margin-top:8px">Додати</button></div>';
  if (!ppl.length) h += '<div class="empty">Список порожній</div>';
  else {
    h += '<div class="card"><div class="mut">Усього: ' + ppl.length + ', доступні сьогодні: ' + ppl.filter(function (p) { return p.active && !absentOn(p, td); }).length + '</div>';
    ppl.forEach(function (p) {
      var ab = absentOn(p, td), next = (ix[p.id] || []).filter(function (e) { return e.date >= td; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0];
      h += '<div class="li" data-p="' + p.id + '" style="cursor:pointer' + (p.active ? '' : ';opacity:.5') + '"><div class="grow"><div>' + esc(pname(p)) + (p.id === S.set.me ? ' <span class="tag a">я</span>' : '') + '</div><div class="mut">' +
        (p.note ? esc(p.note) + ' · ' : '') + (next ? 'наступний: ' + fmtShort(next.date) : 'нарядів не заплановано') + '</div></div>' +
        (!p.active ? '<span class="tag">неактивний</span>' : ab ? '<span class="tag a">' + esc(ab.reason) + ' до ' + fmtShort(ab.to) + '</span>' : '') + '</div>';
    });
    h += '</div>';
  }
  v.innerHTML = h;
  $('addB').onclick = function () {
    var lines = $('bulk').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean), n = 0;
    lines.forEach(function (l) {
      var rank = '', name = l;
      var m = l.match(/^(.*?)\s+([А-ЯІЇЄҐA-Z][^\s]*(?:\s+[А-ЯІЇЄҐA-Z][^\s]*)*)$/);
      if (m && /^(солдат|ст\.|старший|молодший|мол\.|сержант|штаб|головний|гол\.|майстер|лейтенант|капітан|майор|підполковник|полковник|рядовий|матрос|старшина|прапорщик|єфрейтор)/i.test(m[1])) { rank = m[1]; name = m[2]; }
      S.people.push({ id: uid(), name: name, rank: rank, note: '', active: true, types: [], abs: [], since: today() });
      n++;
    });
    if (n) { save(); toast('Додано: ' + n); render(); }
  };
  Array.prototype.forEach.call(v.querySelectorAll('.li[data-p]'), function (el) { el.onclick = function () { personDialog(el.dataset.p); }; });
}
function personDialog(id) {
  var p = person(id);
  function absHtml() {
    return p.abs.length ? p.abs.slice().sort(function (a, b) { return a.from < b.from ? 1 : -1; }).map(function (a) {
      return '<div class="li"><div class="grow">' + esc(a.reason) + '</div><span class="mut">' + fmtShort(a.from) + ' – ' + fmtShort(a.to) + '</span><button class="btn s d" data-del="' + a.id + '">✕</button></div>';
    }).join('') : '<div class="mut">Немає</div>';
  }
  var h = '<h3>Військовослужбовець</h3>' +
    '<label class="f">Звання</label><input id="pRank" value="' + esc(p.rank) + '">' +
    '<label class="f">Прізвище, ініціали</label><input id="pName" value="' + esc(p.name) + '">' +
    '<label class="f">Посада / примітка</label><input id="pNote" value="' + esc(p.note) + '">' +
    '<label class="row" style="margin:12px 0"><input type="checkbox" id="pAct"' + (p.active ? ' checked' : '') + '> Залучати до нарядів</label>' +
    '<label class="f">Допущений до нарядів (нічого не вибрано — до всіх)</label>' +
    S.types.map(function (t) { return '<label class="row" style="margin:6px 0"><input type="checkbox" class="pT" value="' + t.id + '"' + (p.types.indexOf(t.id) >= 0 ? ' checked' : '') + '> ' + esc(t.name) + '</label>'; }).join('') +
    '<h3 style="margin-top:14px">Відсутність (відпустка, лікування…)</h3><div id="absL">' + absHtml() + '</div>' +
    '<div class="row" style="margin-top:8px"><select id="aR" class="grow" style="flex-basis:100%">' + REASONS.map(function (r) { return '<option>' + r + '</option>'; }).join('') + '</select>' +
    '<input type="date" id="aF" class="grow" value="' + today() + '"><input type="date" id="aT" class="grow" value="' + addDays(today(), 9) + '"><button class="btn s" id="aAdd">Додати</button></div>' +
    '<div class="row" style="margin-top:16px"><button class="btn d" id="pDel">Видалити</button><button class="btn" id="pMe">' + (S.set.me === p.id ? 'Це не я' : 'Це я') + '</button><button class="btn p grow" id="pSave">Зберегти</button></div>';
  var sh = openModal(h);
  function bindAbs() {
    Array.prototype.forEach.call(sh.querySelectorAll('[data-del]'), function (b) {
      b.onclick = function () { p.abs = p.abs.filter(function (a) { return a.id !== b.dataset.del; }); sh.querySelector('#absL').innerHTML = absHtml(); bindAbs(); };
    });
  }
  bindAbs();
  sh.querySelector('#aAdd').onclick = function () {
    var f = sh.querySelector('#aF').value, t = sh.querySelector('#aT').value;
    if (!f || !t || f > t) { toast('Невірні дати'); return; }
    p.abs.push({ id: uid(), reason: sh.querySelector('#aR').value, from: f, to: t });
    sh.querySelector('#absL').innerHTML = absHtml(); bindAbs();
    var cnt = Object.keys(S.A).filter(function (k) { var q = parseKey(k); return S.A[k].p === p.id && q.date >= f && q.date <= t; }).length;
    if (cnt) toast('Увага: ' + cnt + ' наряд(ів) у цей період — після збереження їх буде знято, перерозподіліть графік', 4000);
  };
  sh.querySelector('#pSave').onclick = function () {
    p.rank = sh.querySelector('#pRank').value.trim(); p.name = sh.querySelector('#pName').value.trim() || p.name;
    p.note = sh.querySelector('#pNote').value.trim(); p.active = sh.querySelector('#pAct').checked;
    p.types = Array.prototype.filter.call(sh.querySelectorAll('.pT'), function (c) { return c.checked; }).map(function (c) { return c.value; });
    var removed = 0, td = today();
    for (var k in S.A) {
      if (S.A[k].p !== p.id) continue; var q = parseKey(k);
      if (q.date >= td && (absentOn(p, q.date) || !p.active)) { delete S.A[k]; removed++; }
    }
    save(); closeModal(); render();
    if (removed) toast('Знято з нарядів: ' + removed + '. Натисніть «Розподілити», щоб заповнити місця.', 4000);
  };
  sh.querySelector('#pMe').onclick = function () { S.set.me = S.set.me === p.id ? '' : p.id; save(); closeModal(); render(); toast(S.set.me ? 'Нагадування налаштовуються у «Налаштуваннях»' : 'Готово'); };
  sh.querySelector('#pDel').onclick = function () {
    if (!confirm('Видалити ' + pname(p) + '? Майбутні наряди цієї людини буде знято.')) return;
    var td = today();
    for (var k in S.A) if (S.A[k].p === p.id && parseKey(k).date >= td) delete S.A[k];
    S.people = S.people.filter(function (x) { return x.id !== p.id; });
    if (S.set.me === p.id) S.set.me = '';
    save(); closeModal(); render();
  };
}

/* ---------- Види нарядів ---------- */
function renderTypes(v) {
  var h = '';
  S.types.forEach(function (t) {
    var days = t.days.length === 7 ? 'щодня' : [1, 2, 3, 4, 5, 6, 0].filter(function (x) { return t.days.indexOf(x) >= 0; }).map(function (x) { return DOW[x]; }).join(', ');
    h += '<div class="card" data-t="' + t.id + '" style="cursor:pointer"><h3>' + esc(t.name) + '</h3><div class="mut">' + t.perDay + ' особ. · ' + days + ' · з ' + esc(t.start) + ' на ' + t.hours + ' год' + (isSplit(t) ? ' · зміни по ' + +shiftLen(t).toFixed(2) + ' год' : '') + ' · відпочинок ≥ ' + t.rest + ' дн.</div></div>';
  });
  h += '<button class="btn p w" id="addT">+ Додати вид наряду</button>';
  h += '<p class="mut">Наряди розподіляються рівномірно за фактичними годинами: зміна 4 год — це 4 год, 1 год — 1 год.</p>';
  v.innerHTML = h;
  $('addT').onclick = function () { typeDialog(null); };
  Array.prototype.forEach.call(v.querySelectorAll('[data-t]'), function (el) { el.onclick = function () { typeDialog(el.dataset.t); }; });
}
function typeDialog(id) {
  var t = id ? dtype(id) : { id: uid(), name: '', perDay: 1, days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', hours: 24, rest: 2, weight: 1, split: true };
  var days = t.days.slice();
  var h = '<h3>' + (id ? 'Вид наряду' : 'Новий вид наряду') + '</h3>' +
    '<label class="f">Назва</label><input id="tN" value="' + esc(t.name) + '" placeholder="напр. Вартовий КПП">' +
    '<div class="row"><div class="grow"><label class="f">Осіб на добу</label><input type="number" min="1" max="20" id="tP" value="' + t.perDay + '"></div>' +
    '<div class="grow"><label class="f">Заступання</label><input type="time" id="tS" value="' + esc(t.start) + '"></div>' +
    '<div class="grow"><label class="f" id="tHL">Тривалість, год</label><input type="number" min="0.5" max="72" step="0.5" id="tH" value="' + (isSplit(t) ? +(t.hours / t.perDay).toFixed(2) : t.hours) + '"></div></div>' +
    '<label class="row" style="margin:10px 0"><input type="checkbox" id="tSp"' + (t.split ? ' checked' : '') + '> Ділити на зміни по черзі (кожен чергує свою частину)</label>' +
    '<div class="mut" id="tSpH"></div>' +
    '<label class="f">Мін. днів між нарядами</label><input type="number" min="0" max="30" id="tR" value="' + t.rest + '">' +
    '<label class="f">Дні тижня</label><div class="dows" id="tD">' + [1, 2, 3, 4, 5, 6, 0].map(function (x) { return '<span data-d="' + x + '" class="' + (days.indexOf(x) >= 0 ? 'on' : '') + '">' + DOW[x] + '</span>'; }).join('') + '</div>' +
    '<div class="row" style="margin-top:16px">' + (id ? '<button class="btn d" id="tDel">Видалити</button>' : '') + '<button class="btn p grow" id="tSave">Зберегти</button></div>';
  var sh = openModal(h);
  var splitOn = isSplit(t);
  function curN() { return parseInt(sh.querySelector('#tP').value, 10) || 1; }
  function totalH() { var v = +String(sh.querySelector('#tH').value).replace(',', '.') || 0, n = curN(); return sh.querySelector('#tSp').checked && n > 1 ? v * n : v; }
  sh.querySelector('#tSp').addEventListener('change', function () {
    // перемикаємо зміст поля: «на одну особу» ↔ «увесь наряд», не змінюючи загальну тривалість
    var v = +sh.querySelector('#tH').value || 0, n = curN(), on = this.checked && n > 1;
    if (on !== splitOn && n > 1) sh.querySelector('#tH').value = +(on ? v / n : v * n).toFixed(2);
    splitOn = on;
  });
  sh.querySelector('#tP').addEventListener('change', function () { var on = sh.querySelector('#tSp').checked && curN() > 1; if (on !== splitOn) { var v = +sh.querySelector('#tH').value || 0, n = curN(); sh.querySelector('#tH').value = +(on ? v / n : v * n).toFixed(2); splitOn = on; } });
  function spHint() {
    var n = curN(), hh = totalH() || 24, st = sh.querySelector('#tS').value || '08:00';
    var el = sh.querySelector('#tSpH');
    sh.querySelector('#tHL').textContent = sh.querySelector('#tSp').checked && n > 1 ? 'Годин на кожного' : 'Тривалість, год';
    if (!sh.querySelector('#tSp').checked || n < 2) { el.innerHTML = n > 1 ? '⚠ Усі ' + n + ' особи стоятимуть <b>одночасно</b> в один і той самий час. Щоб кожен мав свою зміну — поставте галочку вище.' : ''; return; }
    var tt = { start: st, hours: hh, perDay: n, split: true }, d = today(), parts = [];
    for (var i = 0; i < n; i++) { var r = slotTimes(tt, d, i); parts.push((i + 1) + '-й ' + hm(r.start) + '–' + hm(r.end)); }
    var last = slotTimes(tt, d, n - 1).end;
    el.innerHTML = 'Кожен чергує свою зміну по ' + +(hh / n).toFixed(2) + ' год, разом ' + +hh.toFixed(2) + ' год (з ' + esc(st) + ' до ' + hm(last) + '):<br>' + parts.map(esc).join('<br>');
  }
  ['#tP', '#tH', '#tS', '#tSp'].forEach(function (q) { sh.querySelector(q).addEventListener('input', spHint); sh.querySelector(q).addEventListener('change', spHint); });
  spHint();
  Array.prototype.forEach.call(sh.querySelectorAll('#tD span'), function (s) {
    s.onclick = function () { var d = +s.dataset.d, i = days.indexOf(d); if (i >= 0) days.splice(i, 1); else days.push(d); s.classList.toggle('on'); };
  });
  sh.querySelector('#tSave').onclick = function () {
    var name = sh.querySelector('#tN').value.trim(); if (!name) { toast('Вкажіть назву'); return; }
    if (!days.length) { toast('Оберіть хоча б один день'); return; }
    var oldPer = t.perDay;
    t.name = name; t.perDay = Math.max(1, Math.min(20, parseInt(sh.querySelector('#tP').value, 10) || 1));
    t.start = sh.querySelector('#tS').value || '08:00'; t.hours = Math.max(0.5, Math.min(240, totalH() || 24));
    t.split = sh.querySelector('#tSp').checked; t.rest = Math.max(0, parseInt(sh.querySelector('#tR').value, 10) || 0);
    t.days = days.sort();
    if (oldPer > t.perDay) for (var k in S.A) { var q = parseKey(k); if (q.tid === t.id && q.slot >= t.perDay) delete S.A[k]; }
    if (!id) S.types.push(t);
    save(); closeModal(); render();
  };
  if (id) sh.querySelector('#tDel').onclick = function () {
    if (!confirm('Видалити вид наряду «' + t.name + '» разом з усіма його призначеннями?')) return;
    for (var k in S.A) if (parseKey(k).tid === t.id) delete S.A[k];
    S.types = S.types.filter(function (x) { return x.id !== t.id; });
    S.people.forEach(function (p) { p.types = p.types.filter(function (x) { return x !== t.id; }); });
    save(); closeModal(); render();
  };
}

/* ---------- Статистика ---------- */
function renderStats(v) {
  var td = today(), r = ui.statsRange, from, to;
  if (r === 'month') { from = monthStart(ui.month); to = monthEnd(ui.month); }
  else if (r === '90') { from = addDays(td, -90); to = td; }
  else { from = '0000-00-00'; to = '9999-12-31'; }
  var st = {};
  S.people.forEach(function (p) { st[p.id] = { p: p, n: 0, wk: 0, load: 0, last: '', by: {} }; });
  for (var k in S.A) {
    var q = parseKey(k), a = S.A[k], t = dtype(q.tid), x = st[a.p];
    if (!x || !t || q.date < from || q.date > to) continue;
    x.n++; if (isWk(q.date)) x.wk++; x.load += weightOf(t, q.date); x.by[t.id] = (x.by[t.id] || 0) + 1;
    if (q.date <= td && q.date > x.last) x.last = q.date;
  }
  var rows = Object.keys(st).map(function (k) { return st[k]; }).filter(function (x) { return x.p.active || x.n; }).sort(function (a, b) { return b.load - a.load || a.p.name.localeCompare(b.p.name, 'uk'); });
  var loads = rows.map(function (x) { return x.load; }), mx = Math.max.apply(null, loads.concat([0])), mn = Math.min.apply(null, loads.concat([mx]));
  var h = '<div class="seg" style="margin-bottom:10px"><button data-r="month" class="' + (r === 'month' ? 'on' : '') + '">' + MONTHS[pd(ui.month).getMonth()] + '</button><button data-r="90" class="' + (r === '90' ? 'on' : '') + '">90 днів</button><button data-r="all" class="' + (r === 'all' ? 'on' : '') + '">Увесь час</button></div>';
  h += '<div class="card"><div class="mut" style="margin-bottom:6px">Різниця між найбільш і найменш завантаженими: <b>' + +(mx - mn).toFixed(1) + ' год</b></div><table><tr><th>Військовослужбовець</th><th class="n">Нарядів</th><th class="n">Вихідні</th><th class="n">Годин</th></tr>';
  rows.forEach(function (x) {
    var by = S.types.filter(function (t) { return x.by[t.id]; }).map(function (t) { return t.name + ': ' + x.by[t.id]; }).join(', ');
    h += '<tr><td>' + esc(pname(x.p)) + '<div class="mut" style="font-size:11px">' + esc(by) + (x.last ? (by ? ' · ' : '') + 'ост. ' + fmtShort(x.last) : '') + '</div></td><td class="n">' + x.n + '</td><td class="n">' + x.wk + '</td><td class="n">' + +x.load.toFixed(1) + '</td></tr>';
  });
  if (!rows.length) h += '<tr><td colspan="4" class="empty">Немає даних</td></tr>';
  h += '</table></div><p class="mut">Годин — сумарний фактичний час у нарядах.</p>';
  v.innerHTML = h;
  Array.prototype.forEach.call(v.querySelectorAll('[data-r]'), function (b) { b.onclick = function () { ui.statsRange = b.dataset.r; render(); }; });
}

/* ---------- Налаштування ---------- */
function renderSettings(v) {
  var s = S.set, hasN = !!notif();
  var h = MODE === 'client' ? clientRemCard() : '<div class="card"><h3>🔔 Мої нагадування (командира)</h3>' +
    (hasN ? '' : '<div class="warnbox">Сповіщення доступні лише у встановленому застосунку.</div>') +
    '<label class="row" style="margin:8px 0"><input type="checkbox" id="sRem"' + (s.remind ? ' checked' : '') + '> Увімкнути нагадування</label>' +
    '<label class="f">Хто я (для «моїх» нарядів)</label><select id="sMe"><option value="">— не вибрано —</option>' +
    S.people.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'uk'); }).map(function (p) { return '<option value="' + p.id + '"' + (s.me === p.id ? ' selected' : '') + '>' + esc(pname(p)) + '</option>'; }).join('') + '</select>' +
    '<label class="row" style="margin:10px 0"><input type="checkbox" id="sAll"' + (s.remindAll || !s.me ? ' checked' : '') + '> Нагадувати про наряди всього підрозділу (для чергового/командира)</label>' +
    '<div class="row"><div class="grow"><label class="f">За скільки годин до заступання</label><input type="number" min="0" max="48" id="sHB" value="' + s.hoursBefore + '"></div>' +
    '<div class="grow"><label class="f">Напередодні о</label><input type="time" id="sET" value="' + esc(s.eveningTime) + '"></div></div>' +
    '<label class="row" style="margin:10px 0"><input type="checkbox" id="sEv"' + (s.evening ? ' checked' : '') + '> Нагадування напередодні ввечері</label>' +
    '<div class="row"><button class="btn p grow" id="sSaveR">Зберегти</button><button class="btn" id="sTest">Тест</button></div></div>';
  if (MODE === 'cmd') h += '<div class="card"><h3>🔔 Нагадування для бійців</h3><label class="f">За скільки хвилин до заступання (через кому)</label><input id="sCli" inputmode="numeric" value="' + remOffsets().join(', ') + '">' +
    '<div class="mut" style="margin-top:4px">Передається разом із графіком. Боєць не може змінити чи вимкнути ці нагадування у застосунку. Після зміни надішліть графік знову.</div></div>';
  if (MODE === 'client') h += '<div class="card"><h3>📥 Графік від командира</h3><div class="mut">Оновлено: ' + fmtStamp(S.meta.ver) + (S.meta.unit ? ' · ' + esc(S.meta.unit) : '') + '</div><div class="row" style="margin-top:8px"><button class="btn p grow" id="cUpd">Оновити графік</button></div></div>';
  else h += '<div class="card"><h3>🌐 Графік у браузері (iPhone)</h3><label class="f">Адреса сторінки перегляду</label><input id="sWeb" inputmode="url" value="' + esc(S.set.webUrl || '') + '">' +
    '<div class="mut" style="margin-top:4px">У повідомлення додається посилання, за яким графік відкривається в будь-якому браузері. Дані графіка йдуть у самому посиланні (після «#») і не потрапляють на сервер. Порожнє поле — без посилання.</div></div>' +
    '<div class="card"><h3>🏷️ Підрозділ</h3><label class="f">Назва (показується бійцям)</label><input id="sUnit" value="' + esc(S.meta.unit) + '" placeholder="напр. 2 взвод 1 роти"></div>';
  if (MODE === 'cmd') h += '<div class="card"><h3>💾 Резервна копія</h3><div class="mut">' + (window.cordova ? '' : '<b>Веб-версія: дані зберігаються лише в цьому браузері.</b> Очищення історії/даних сайту їх видалить — регулярно зберігайте копію. ') + 'Скопіюйте дані й надішліть собі (наприклад, у месенджер), щоб перенести на інший телефон чи в застосунок.</div>' +
    (window.cordova ? '' : '<button class="btn w" id="bFile" style="margin-top:8px">⬇️ Зберегти копію файлом</button>') +
    '<div class="row" style="margin-top:8px"><button class="btn grow" id="bExp">Копіювати дані</button><button class="btn grow" id="bImp">Відновити з копії</button></div>' +
    '<button class="btn d w" id="bReset" style="margin-top:8px">Скинути всі дані</button></div>';
  h += '<p class="mut" style="text-align:center">Графік нарядів v1.8.0 (' + (MODE === 'cmd' ? 'командир' : 'боєць') + ') · працює без інтернету, дані зберігаються лише на цьому пристрої.</p>';
  v.innerHTML = h;
  if (MODE === 'client') { $('cUpd').onclick = importDialog; bindClientRem(); return; }
  else {
    $('sCli').onchange = function () { var r = parseMins(this.value); if (!r.length) r = [60, 10]; s.cliRem = r; this.value = r.join(', '); save(); toast('Збережено. Надішліть графік бійцям, щоб застосувати.', 3000); };
    $('sWeb').onchange = function () { var u = this.value.trim(); if (u && !/^https:\/\//.test(u)) { toast('Адреса має починатися з https://'); return; } if (u && !/\/$/.test(u) && !/\.html?$/.test(u)) u += '/'; s.webUrl = u; this.value = u; save(); toast('Збережено'); };
    $('sUnit').onchange = function () { S.meta.unit = this.value.trim(); save(); toast('Збережено'); };
    $('bExp').onclick = function () { copyText(JSON.stringify(S)); };
    $('bImp').onclick = backupImport;
    if ($('bFile')) $('bFile').onclick = function () { downloadText('naryady-kopiya-' + today() + '.json', JSON.stringify(S)); };
  }
  $('bReset').onclick = function () {
    if (!confirm(MODE === 'cmd' ? 'Видалити весь особовий склад, наряди та графік?' : 'Видалити отриманий графік?')) return;
    S = defaults(); if (MODE === 'client') S.types = []; save(); render(); toast('Дані скинуто');
  };
  $('sSaveR').onclick = function () {
    s.me = $('sMe').value; s.remindAll = $('sAll').checked; s.hoursBefore = Math.max(0, +$('sHB').value || 0);
    s.eveningTime = $('sET').value || '20:00'; s.evening = $('sEv').checked;
    var want = $('sRem').checked;
    if (want && hasN) {
      ensurePermission(function (ok) {
        s.remind = ok; save(); render();
        if (ok) { checkExact(); toast('Нагадування увімкнено'); } else toast('Дозвіл на сповіщення не надано', 3500);
      });
    } else { s.remind = want; save(); render(); toast('Збережено'); }
  };
  $('sTest').onclick = function () {
    var n = notif(); if (!n) { toast('Доступно лише в застосунку'); return; }
    ensurePermission(function (ok) {
      if (!ok) { toast('Дозвіл на сповіщення не надано'); return; }
      n.schedule({ id: 99999, title: 'Графік нарядів', text: 'Тестове нагадування працює ✔', trigger: { at: new Date(Date.now() + 5000) }, foreground: true, smallIcon: 'res://ic_launcher' });
      toast('Сповіщення прийде через 5 секунд');
    });
  };
}
function backupImport() {
  {
    var sh = openModal('<h3>Відновлення</h3><textarea id="impT" rows="8" placeholder="Вставте скопійовані дані"></textarea><div class="row" style="margin-top:8px">' + (window.cordova ? '' : '<button class="btn grow" id="impF">📂 З файлу</button>') + '<button class="btn p grow" id="impGo">Відновити</button></div>');
    if (!window.cordova) sh.querySelector('#impF').onclick = function () {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,.txt,application/json,text/plain';
      inp.onchange = function () { var f = inp.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { sh.querySelector('#impT').value = r.result; }; r.readAsText(f); };
      inp.click();
    };
    sh.querySelector('#impGo').onclick = function () {
      try {
        var d = JSON.parse(sh.querySelector('#impT').value);
        if (!d || !d.types || !d.people || !d.A) throw 0;
        if (!confirm('Замінити поточні дані?')) return;
        localStorage.setItem(KEY, JSON.stringify(d)); load(); save(); closeModal(); render(); toast('Дані відновлено');
      } catch (e) { toast('Невірний формат даних'); }
    };
  };
}
function remLabel() { return remOffsets().map(function (m) { return m >= 60 && m % 60 === 0 ? (m / 60) + ' год' : m + ' хв'; }).join(' і за '); }
function clientRemCard() {
  var p = person(S.set.me);
  return '<div class="card"><h3>🔔 Нагадування</h3><div>Нагадування про кожен ваш наряд за <b>' + remLabel() + '</b> до заступання.</div>' +
    '<div class="mut" style="margin-top:4px">Встановлює командир, у застосунку їх змінити чи вимкнути не можна.</div>' +
    '<div style="margin-top:8px">Ви: <b>' + (p ? esc(pname(p)) : '— не вибрано') + '</b></div>' +
    '<div id="permBox" style="margin-top:8px"></div><button class="btn w" id="sTest" style="margin-top:8px">Перевірити сповіщення</button></div>';
}
function bindClientRem() {
  checkPermBanner($('permBox'));
  $('sTest').onclick = function () {
    var n = notif(); if (!n) { toast('Доступно лише в застосунку'); return; }
    ensurePermission(function (ok) {
      if (!ok) { toast('Сповіщення заборонені в налаштуваннях телефону', 3500); return; }
      n.schedule(nItem(99999, 'Графік нарядів', 'Тестове нагадування працює ✔', new Date(Date.now() + 5000)));
      toast('Сповіщення прийде через 5 секунд');
    });
  };
}
function checkPermBanner(box) {
  var n = notif(); if (!n || !box) return;
  n.hasPermission(function (g) {
    if (g) { box.innerHTML = '<span class="mut">✅ Сповіщення дозволені</span>'; return; }
    box.innerHTML = '<div class="warnbox" style="margin:0;background:#3a1612;border-color:var(--bad);color:#f5b4aa"><b>Сповіщення вимкнені!</b> Ви не отримаєте нагадувань про наряди.<button class="btn p w" id="permFix" style="margin-top:8px">Увімкнути сповіщення</button></div>';
    box.querySelector('#permFix').onclick = function () { ensurePermission(function (ok) { if (ok) { scheduleReminders(); checkExact(); } checkPermBanner(box); }); };
  });
}
function checkExact() {
  var n = notif();
  if (n && typeof n.canScheduleExactAlarms === 'function') {
    n.canScheduleExactAlarms(function (ok) {
      if (!ok && typeof n.openAlarmSettings === 'function' && confirm('Щоб нагадування приходили точно в час, дозвольте «Будильники й нагадування» для застосунку. Відкрити налаштування?')) n.openAlarmSettings();
    });
  }
}

/* ---------- передача графіка командир -> бійці ---------- */
var CODE_RE = /NARYAD([12])([zj]):([A-Za-z0-9_\-]+)/;
var B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function fmtStamp(ms) { if (!ms) return 'ще не отримано'; var d = new Date(ms); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function b64u(bytes) { var bin = ''; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(str) { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; var bin = atob(str), b = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
function streamBytes(bytes, ctor) { return new Response(new Blob([bytes]).stream().pipeThrough(ctor)).arrayBuffer().then(function (ab) { return new Uint8Array(ab); }); }
/* компактний формат v2: люди і наряди — один раз, графік — рядок символів (індекс людини на кожне місце кожного дня) */
function hid(id) { // короткий стабільний ідентифікатор для передачі (5 символів)
  var h = 5381; for (var i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  var r = ''; for (var j = 0; j < 5; j++) { r += B62[h % 62]; h = Math.floor(h / 62) + (j * 7919 + id.length); } return r;
}
function buildPayload() {
  var from = addDays(today(), -1), to = from;
  for (var k in S.A) { var d0 = parseKey(k).date; if (d0 > to) to = d0; }
  if (to > addDays(from, 120)) to = addDays(from, 120);
  var used = {};
  for (var k2 in S.A) { var q0 = parseKey(k2); if (q0.date >= from && q0.date <= to) used[S.A[k2].p] = 1; }
  var P = S.people.filter(function (p) { return used[p.id]; });
  var pix = {}; P.forEach(function (p, i) { pix[p.id] = i; });
  var w = P.length < 62 ? 1 : 2, n = diffDays(from, to) + 1;
  function enc(i) { return w === 1 ? B62[i] : B62[Math.floor(i / 62)] + B62[i % 62]; }
  var G = S.types.map(function (t) {
    var str = '';
    for (var d = from; d <= to; d = addDays(d, 1)) for (var s = 0; s < t.perDay; s++) {
      var a = S.A[d + '|' + t.id + '|' + s];
      str += a && pix[a.p] !== undefined ? enc(pix[a.p]) : (w === 1 ? '.' : '..');
    }
    return str;
  });
  return { v: 2, s: Date.now(), u: S.meta.unit || '', R: remOffsets(), b: from, n: n, w: w,
    T: S.types.map(function (t) { return [t.id, t.name, t.start, t.hours, t.perDay, t.days, isSplit(t) ? 1 : 0]; }),
    P: P.map(function (p) { return [p.id, p.rank, p.name]; }), G: G };
}
function expandV2(o) {
  var D = {};
  o.T.forEach(function (t, ti) {
    var str = o.G[ti] || '', pos = 0, w = o.w || 1;
    for (var di = 0; di < o.n; di++) {
      var d = addDays(o.b, di);
      for (var s = 0; s < t[4]; s++) {
        var c = str.substr(pos, w); pos += w;
        if (!c || c.charAt(0) === '.') continue;
        var idx = w === 1 ? B62.indexOf(c) : B62.indexOf(c[0]) * 62 + B62.indexOf(c[1]);
        if (o.P[idx]) (D[d] = D[d] || []).push(t[0] + '.' + s + '.' + o.P[idx][0]);
      }
    }
  });
  o.D = D; return o;
}
function encodePayload(obj) {
  var bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (window.CompressionStream) return streamBytes(bytes, new CompressionStream('deflate-raw')).then(function (z) { return 'NARYAD2z:' + b64u(z); }).catch(function () { return 'NARYAD2j:' + b64u(bytes); });
  return Promise.resolve('NARYAD2j:' + b64u(bytes));
}
function decodePayload(text) {
  var m = CODE_RE.exec(text || '');
  if (!m) return Promise.reject(new Error('Код графіка не знайдено'));
  var bytes = unb64u(m[3]);
  var p = m[2] === 'z' ? (window.DecompressionStream ? streamBytes(bytes, new DecompressionStream('deflate-raw')) : Promise.reject(new Error('Оновіть Android System WebView'))) : Promise.resolve(bytes);
  return p.then(function (b) {
    var o = JSON.parse(new TextDecoder().decode(b));
    if (o && o.v === 2 && o.G) o = expandV2(o);
    if (!o || !o.T || !o.P || !o.D) throw new Error('Невірний код');
    return o;
  });
}
function applyPayload(o, silent) {
  if (S.meta.ver && o.s < S.meta.ver && (silent || !confirm('Цей графік старіший за той, що вже є (' + fmtStamp(o.s) + ' < ' + fmtStamp(S.meta.ver) + '). Все одно застосувати?'))) return false;
  S.types = o.T.map(function (t) { return { id: t[0], name: t[1], start: t[2], hours: t[3], perDay: t[4], days: t[5], split: !!t[6], rest: 0, weight: 1 }; });
  S.people = o.P.map(function (p) { return { id: p[0], rank: p[1], name: p[2], note: '', active: true, types: [], abs: [] }; });
  S.A = {};
  Object.keys(o.D).forEach(function (d) { o.D[d].forEach(function (e) { var x = e.split('.'); S.A[d + '|' + x[0] + '|' + x[1]] = { p: x.slice(2).join('.') }; }); });
  S.meta = { unit: o.u || '', ver: o.s, rem: o.R || [60, 10] };
  if (S.set.me && !person(S.set.me)) S.set.me = '';
  save();
  return true;
}
function utf8b64(str) { var b = new TextEncoder().encode(str), bin = ''; for (var i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]); return btoa(bin); }
function shareWhatsApp(caption, fileText) {
  var sp = window.plugins && window.plugins.socialsharing;
  if (!sp) { downloadText('grafik-naryadiv.txt', fileText); return; }
  var file = 'df:grafik-naryadiv.txt;data:text/plain;base64,' + utf8b64(fileText);
  sp.shareViaWhatsApp(caption, file, null, function () { }, function () {
    sp.shareWithOptions({ message: caption, files: [file], chooserTitle: 'Надіслати графік' }, function () { }, function () { toast('Не вдалося надіслати', 3000); });
  });
}
function shareWhatsAppText(text) {
  var sp = window.plugins && window.plugins.socialsharing;
  if (!sp) { window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank'); return; }
  sp.shareViaWhatsApp(text, null, null, function () { }, function () { shareText(text); });
}
function downloadText(name, text) {
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 1000);
}
function shareText(text) {
  if (!window.cordova && navigator.share) { navigator.share({ text: text }).catch(function () { }); return; }
  var sp = window.plugins && window.plugins.socialsharing;
  if (sp) sp.shareWithOptions({ message: text, chooserTitle: 'Надіслати графік' }, function () { }, function () { copyText(text); });
  else copyText(text);
}
function sendDialog() {
  var cnt = 0, td = today(); for (var k in S.A) if (parseKey(k).date >= td) cnt++;
  if (!cnt) { toast('Немає майбутніх нарядів — спочатку розподіліть'); return; }
  encodePayload(buildPayload()).then(function (code) {
    var head = '📅 Графік нарядів' + (S.meta.unit ? ' «' + S.meta.unit + '»' : '') + ' оновлено ' + fmtStamp(Date.now());
    var web = (S.set.webUrl || '').trim(), link = web ? web + '#' + code : '';
    var caption = head + '.\nAndroid: натисніть на файл → відкрити в «Наряди · Боєць».';
    var full = link ? head + '.\nНатисніть посилання, щоб відкрити графік (на Android — кнопка «Відкрити в застосунку»):\n' + link
                    : head + '. Скопіюйте це повідомлення і відкрийте «Наряди · Боєць».\n' + code;
    var sh = openModal('<h3>Надіслати графік бійцям</h3><p class="mut">У WhatsApp піде повідомлення з посиланням. Боєць натискає посилання: графік відкривається в браузері (iPhone теж), а на Android кнопка «Відкрити в застосунку» одразу оновлює графік і нагадування в «Наряди · Боєць».</p>' +
      '<p class="mut">Нарядів: ' + cnt + ' майбутніх · код: ' + code.length + ' симв.</p>' +
      '<button class="btn p w" id="sWa" style="background:#1f8f4e;border-color:#1f8f4e">💬 Надіслати в WhatsApp</button>' +
      '<div class="row" style="margin-top:8px"><button class="btn grow" id="sCopy">📋 Копіювати</button><button class="btn grow" id="sFile">📎 Файлом</button><button class="btn grow" id="sShare">📤 Інше</button></div>' +
      '<p class="mut" style="margin-top:8px">«Файлом» — запасний варіант: боєць натискає на файл → «Відкрити за допомогою» → «Наряди · Боєць».</p>');
    function sent() { if (S.meta.unsent) { S.meta.unsent = false; save(); setTimeout(render, 300); } }
    sh.querySelector('#sWa').onclick = function () { shareWhatsAppText(full); sent(); };
    sh.querySelector('#sFile').onclick = function () { shareWhatsApp(caption, full); sent(); };
    sh.querySelector('#sCopy').onclick = function () { copyText(full); sent(); };
    sh.querySelector('#sShare').onclick = function () { shareText(full); sent(); };
  });
}
/* автоматичний прийом: файл/текст, відкритий у застосунку, або код у буфері обміну */
function receiveText(t, fromUser) {
  if (!t || !CODE_RE.test(t)) return Promise.resolve(false);
  return decodePayload(t).then(function (o) {
    if (!fromUser && S.meta.ver && o.s <= S.meta.ver) return false; // вже маємо цей або новіший
    if (!applyPayload(o, !fromUser)) return false;
    closeAll(); toast('Графік оновлено ✔ (' + fmtStamp(o.s) + ')', 3000);
    if (!S.set.me) ui.tab = 'mine';
    buildNav(); setTab(ui.tab); scheduleReminders();
    return true;
  }).catch(function (e) { if (fromUser) toast(e.message || 'Помилка коду', 3000); return false; });
}
function nativeIntent() { return window.cordova && cordova.plugins && cordova.plugins.naryadIntent; }
function checkIncoming() {
  var ni = nativeIntent(); if (!ni || MODE !== 'client') return;
  ni.getIncoming(function (t) {
    if (t) { receiveText(t, true); return; }
    setTimeout(function () { ni.getClipboard(function (c) { receiveText(c, false); }, function () { }); }, 400);
  }, function () { });
}
function importDialog() {
  function manual() {
    var sh = openModal('<h3>Оновити графік</h3><p class="mut">Найпростіше: у WhatsApp натисніть на файл графіка → «Відкрити за допомогою» → «Наряди · Боєць». Або скопіюйте повідомлення з кодом і вставте сюди:</p><textarea id="cT" rows="5" placeholder="NARYAD…"></textarea><button class="btn p w" id="cGo" style="margin-top:8px">Застосувати</button>');
    sh.querySelector('#cGo').onclick = function () { receiveText(sh.querySelector('#cT').value, true).then(function (ok) { if (!ok && !CODE_RE.test(sh.querySelector('#cT').value)) toast('Код графіка не знайдено', 3000); }); };
  }
  var ni = nativeIntent();
  if (ni) ni.getClipboard(function (c) { receiveText(c, true).then(function (ok) { if (!ok) manual(); }); }, manual);
  else if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(function (t) { return receiveText(t, true); }).then(function (ok) { if (!ok) manual(); }).catch(manual);
  else manual();
}
function closeAll() { while (modalStack.length) closeModal(); }
function renderWelcome(v) {
  v.innerHTML = '<div class="card" style="text-align:center;padding:24px 14px"><div style="font-size:46px">🪖</div><h3 style="font-size:18px">Наряди · Боєць</h3>' +
    '<p class="mut">Тут відображаються ваші наряди і приходять нагадування. Графік складає командир у застосунку «Наряди · Командир» і надсилає в чат підрозділу.</p>' +
    '<p class="mut">У WhatsApp натисніть на файл графіка → «Відкрити за допомогою» → «Наряди · Боєць».<br>Або скопіюйте повідомлення з кодом і відкрийте застосунок.</p>' +
    '<button class="btn p w" id="wImp">📥 Вставити графік вручну</button></div>';
  $('wImp').onclick = importDialog;
}
function myDuties(pid) {
  var r = [];
  for (var k in S.A) { if (S.A[k].p !== pid) continue; var q = parseKey(k), t = dtype(q.tid); if (t) r.push({ date: q.date, t: t, key: k, slot: q.slot, st: slotTimes(t, q.date, q.slot) }); }
  return r.sort(function (a, b) { return a.st.start - b.st.start; });
}
function partners(n, pid) {
  // для змін: від кого приймаєте і кому здаєте; інакше — хто в наряді разом
  var t = n.t, d = n.date;
  function who(sl) { var a = S.A[d + '|' + t.id + '|' + sl]; return a ? pname(person(a.p)) : '—'; }
  if (isSplit(t)) {
    var r = [];
    if (n.slot > 0) r.push('Приймаєте зміну від: ' + who(n.slot - 1));
    if (n.slot < t.perDay - 1) r.push('Здаєте зміну: ' + who(n.slot + 1));
    return r;
  }
  var o = []; for (var s2 = 0; s2 < t.perDay; s2++) { var a = S.A[d + '|' + t.id + '|' + s2]; if (a && a.p !== pid) o.push(pname(person(a.p))); }
  return o.length ? ['Разом з: ' + o.join(', ')] : [];
}
function renderMine(v) {
  var me = S.set.me, p = me && person(me);
  if (!p) {
    var h = '<div class="card"><h3>Хто ви?</h3><div class="mut">Оберіть себе у списку — нагадування приходитимуть про ваші наряди.</div></div><div class="card">';
    S.people.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'uk'); }).forEach(function (x) { h += '<div class="cand" data-p="' + x.id + '"><span>' + esc(pname(x)) + '</span><span class="mut">›</span></div>'; });
    v.innerHTML = h + '</div>';
    Array.prototype.forEach.call(v.querySelectorAll('.cand'), function (el) {
      el.onclick = function () {
        if (!confirm('Ви — ' + pname(person(el.dataset.p)) + '? Змінити вибір потім не можна.')) return;
        S.set.me = el.dataset.p; S.set.remindAll = false; save();
        ensurePermission(function (ok) { if (ok) { S.set.remind = true; save(); checkExact(); toast('Нагадування увімкнено 🔔'); } render(); });
        render();
      };
    });
    return;
  }
  var td = today(), nowD = new Date(), list = myDuties(me), fut = list.filter(function (x) { return x.st.end > nowD; }), past = list.filter(function (x) { return x.st.end <= nowD; }).slice(-3).reverse();
  var h = '<div class="card"><div class="row"><div class="grow"><b>' + esc(pname(p)) + '</b><div class="mut">' + (S.meta.unit ? esc(S.meta.unit) + ' · ' : '') + 'графік від ' + fmtStamp(S.meta.ver) + '</div></div><button class="btn s" id="mUpd">📥 Оновити</button></div></div>';
  if (fut.length) {
    var n = fut[0], days = diffDays(td, n.date), when = days === 0 ? 'Сьогодні' : days === 1 ? 'Завтра' : 'Через ' + days + ' дн.';
    var pr = partners(n, me);
    h += '<div class="card" style="border-color:var(--acc)"><div class="mut">Найближчий наряд</div><div style="font-size:22px;font-weight:700;margin:4px 0">' + when + ', ' + fmtD(n.date) + '</div>' +
      '<div>' + esc(n.t.name) + ' · ' + DOW[dow(n.date)] + '</div><div style="font-size:17px;font-weight:600;margin-top:4px">🕗 ' + esc(span(n.t, n.date, n.slot)) + '</div>' +
      (pr.length ? '<div class="mut" style="margin-top:6px">' + pr.map(esc).join('<br>') + '</div>' : '') + '</div>';
    if (fut.length > 1) {
      h += '<div class="card"><h3>Далі</h3>';
      fut.slice(1, 15).forEach(function (x) { h += '<div class="li"><div class="grow">' + fmtD(x.date) + ' <span class="mut">' + DOW[dow(x.date)] + '<div class="mut">' + esc(x.t.name) + '</div></div><span class="mut" style="text-align:right">' + esc(span(x.t, x.date, x.slot)) + '</span></div>'; });
      h += '</div>';
    }
  } else h += '<div class="card"><div class="empty">Запланованих нарядів немає 👍</div></div>';
  if (past.length) { h += '<div class="card"><h3>Останні</h3>'; past.forEach(function (x) { h += '<div class="li mut"><div class="grow">' + fmtD(x.date) + '</div><span>' + esc(x.t.name) + '</span></div>'; }); h += '</div>'; }
  h += '<div id="permBox"></div><div class="mut" style="text-align:center;margin-top:6px">🔔 Нагадування за ' + remLabel() + ' до кожного наряду</div>';
  v.innerHTML = h;
  checkPermBanner($('permBox'));
  $('mUpd').onclick = importDialog;
}

/* ---------- старт ---------- */
function init() {
  load();
  ui.month = monthStart(today());
  if (MODE === 'client' && !localStorage.getItem(KEY)) S.types = [];
  buildNav();
  setTab(MODE === 'client' ? 'mine' : 'sched');
  if (MODE === 'cmd' && !S.people.length && !localStorage.getItem(KEY + '.seen')) { localStorage.setItem(KEY + '.seen', '1'); setTab('people'); }
  scheduleReminders();
  checkIncoming();
  var ni = nativeIntent(); if (ni && MODE === 'client') ni.listen(function (t) { receiveText(t, true); });
}
document.addEventListener('resume', function () { if (S) { render(); scheduleReminders(); checkIncoming(); } }, false);
document.addEventListener('backbutton', function () {
  if (modalStack.length) closeModal();
  else if (ui.tab !== (MODE === 'client' ? 'mine' : 'sched')) setTab(MODE === 'client' ? 'mine' : 'sched');
  else if (navigator.app) navigator.app.exitApp();
}, false);
if (window.cordova) document.addEventListener('deviceready', init, false); else document.addEventListener('DOMContentLoaded', init);
