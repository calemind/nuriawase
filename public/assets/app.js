/* ぬりあわせ / 共通スクリプト */

/* ---------- 小道具 ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
export const qs = (key) => new URLSearchParams(location.search).get(key);

export async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* noop */ }
  if (!res.ok) throw new Error(data?.error || '通信に失敗しました。時間をおいてもう一度お試しください。');
  return data;
}

const DOW = ['日', '月', '火', '水', '木', '金', '土'];
export const dowOf = (d) => new Date(d + 'T00:00:00').getDay();
export const fmtDate = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
export const fmtDow = (d) => DOW[dowOf(d)];
export const fmtTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** コマ番号 -> 時刻(分) */
export const slotMinAt = (ev, i) => ev.start_min + i * ev.slot_min;
/** 「8/12(火) 19:00–20:30」 */
export const fmtRange = (ev, date, s, e) =>
  `${fmtDate(date)}(${fmtDow(date)}) ${fmtTime(slotMinAt(ev, s))}–${fmtTime(slotMinAt(ev, e))}`;

export const blankSlots = (ev) =>
  Object.fromEntries(ev.dates.map((d) => [d, '0'.repeat(ev.slots_per_day)]));

/* ---------- グリッド ---------- */

const LABELS = { 0: 'なし', 1: '出席可能', 2: '未定' };
export const stateLabel = (v) => LABELS[v] ?? '不明';

/** 行をまたぐと判定するまでの余白(px)。指の縦ぶれを吸収する */
const ROW_GUARD = 11;
/** 履歴の上限 */
const HISTORY_MAX = 60;

/**
 * 塗れるシフト表。
 *   new PaintGrid(container, event, { readOnly, onChange, onHistory })
 */
export class PaintGrid {
  constructor(host, ev, opts = {}) {
    this.ev = ev;
    this.readOnly = !!opts.readOnly;
    this.onChange = opts.onChange || (() => {});
    this.onHistory = opts.onHistory || (() => {});
    this.onScroll = opts.onScroll || (() => {});
    this.tool = '1';
    this.zoom = 1;
    this.data = blankSlots(ev);
    this.cellsByDate = new Map();
    this.rowsMeta = [];

    host.innerHTML = '';
    this.box = el('div', 'gridbox' + (this.readOnly ? ' readonly' : ''));
    this.scroll = el('div', 'gridscroll');
    this.inner = el('div', 'gridinner');
    this.scroll.append(this.inner);
    this.box.append(this.scroll);
    host.append(this.box);

    this.#buildRuler();
    this.#buildRows();
    if (!this.readOnly) this.#bindPaint();

    this.history = [{ ...this.data }];
    this.hIndex = 0;

    this._onResize = () => this.fit();
    addEventListener('resize', this._onResize);
    this.scroll.addEventListener('scroll', () => this.onScroll(), { passive: true });
    requestAnimationFrame(() => this.fit());
  }

  /* --- 描画 --- */
  #buildRuler() {
    const ev = this.ev;
    const ruler = el('div', 'ruler');
    const corner = el('div', 'corner', '時刻 →');
    const ticks = el('div', 'ticks');
    this.ticks = ticks;

    for (let i = 0; i < ev.slots_per_day; i++) {
      const m = slotMinAt(ev, i);
      if (m % 60 !== 0 && i !== 0) continue;
      const t = el('div', 'tick');
      t.dataset.i = i;
      t.append(el('b', null, `${Math.floor(m / 60)}`));
      ticks.append(t);
    }
    ruler.append(corner, ticks);
    this.inner.append(ruler);
  }

  #buildRows() {
    const ev = this.ev;
    const rows = el('div', 'rows');
    ev.dates.forEach((date) => {
      const dw = dowOf(date);
      const row = el('div', 'grow' + (dw === 0 ? ' sun weekend' : dw === 6 ? ' sat weekend' : ''));
      const label = el('div', 'rowlabel');
      label.append(el('span', null, fmtDate(date)), el('span', 'dow', fmtDow(date)));
      if (!this.readOnly) {
        label.title = 'タップでこの日をまとめて塗る / 戻す';
        label.addEventListener('click', () => this.toggleDay(date));
      }
      const cells = el('div', 'cells');
      cells.dataset.date = date;
      const list = [];
      for (let i = 0; i < ev.slots_per_day; i++) {
        const m = slotMinAt(ev, i + 1);
        const c = el('div', 'cell' + (m % 60 === 0 ? ' h' : m % 30 === 0 ? ' hh' : ''));
        c.dataset.v = '0';
        c.dataset.i = i;
        c.dataset.date = date;
        cells.append(c);
        list.push(c);
      }
      this.cellsByDate.set(date, list);
      this.rowsMeta.push({ date, rowEl: row, cellsEl: cells });
      row.append(label, cells);
      rows.append(row);
    });
    this.rows = rows;
    this.inner.append(rows);
  }

  /** 横幅にあわせてコマ幅を決める */
  fit(zoom = this.zoom) {
    this.zoom = zoom;
    const labelW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--label')) || 92;
    const avail = this.scroll.clientWidth - labelW - 2;
    const base = Math.max(6, avail / this.ev.slots_per_day);
    const cw = base * zoom;
    this.cw = cw;
    this.box.style.setProperty('--cw', cw.toFixed(3) + 'px');
    this.ticks.style.width = (cw * this.ev.slots_per_day) + 'px';
    this.ticks.querySelectorAll('.tick').forEach((t) => {
      t.style.left = (Number(t.dataset.i) * cw) + 'px';
    });
    this.onScroll();
  }

  /* --- 横スクロール --- */

  /** あと何pxスクロールできるか */
  #scrollRoom() {
    return Math.max(0, this.scroll.scrollWidth - this.scroll.clientWidth);
  }

  /** n時間ぶん左右に動かす（負の数で左へ） */
  scrollHours(n) {
    const perHour = (this.cw || 8) * (60 / this.ev.slot_min);
    this.scroll.scrollBy({ left: perHour * n, behavior: 'smooth' });
  }

  canScrollLeft() { return this.scroll.scrollLeft > 1; }
  canScrollRight() { return this.scroll.scrollLeft < this.#scrollRoom() - 1; }

  /* --- 操作 --- */
  setTool(v) { this.tool = String(v); }

  /** 1マスだけ塗る。塗り替えが起きたら true */
  #setCell(date, i, v) {
    const s = this.data[date];
    if (!s || s[i] === v) return false;
    this.data[date] = s.slice(0, i) + v + s.slice(i + 1);
    this.cellsByDate.get(date)[i].dataset.v = v;
    return true;
  }

  /** 同じ行の from〜to を塗りつぶす（順不同でよい） */
  #paintSpan(date, from, to) {
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    let hit = false;
    for (let i = a; i <= b; i++) {
      if (this.#setCell(date, i, this.tool)) hit = true;
    }
    if (hit) this._dirty = true;
  }

  /** 行と列の位置をあらかじめ測っておく（なぞっている間の再計測を避ける） */
  #measure() {
    const rows = this.rowsMeta.map((r) => {
      const rect = r.rowEl.getBoundingClientRect();
      return { date: r.date, top: rect.top, bottom: rect.bottom };
    });
    const first = this.rowsMeta[0].cellsEl.getBoundingClientRect();
    return { rows, left: first.left, width: first.width };
  }

  /** 画面上の座標を「何日目の何コマ目か」に変換する */
  #locate(x, y, lockDate) {
    const m = this._m;
    if (!m) return null;

    let date = lockDate;
    const cand = m.rows.find((r) => y >= r.top && y < r.bottom);
    if (!date) {
      if (!cand) return null;
      date = cand.date;
    } else if (cand && cand.date !== date) {
      // はっきり別の行に入ったときだけ乗り換える
      if (y >= cand.top + ROW_GUARD && y <= cand.bottom - ROW_GUARD) date = cand.date;
    }

    const n = this.ev.slots_per_day;
    const cw = m.width / n;
    let i = Math.floor((x - m.left) / cw);
    if (i < 0) i = 0;
    if (i >= n) i = n - 1;
    return { date, index: i };
  }

  #bindPaint() {
    const start = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (!target || !target.classList.contains('cell')) return;
      e.preventDefault();

      this._m = this.#measure();
      const hit = this.#locate(e.clientX, e.clientY, null);
      if (!hit) { this._m = null; return; }

      this.painting = true;
      this._dirty = false;
      this._lockDate = hit.date;
      this._lastIndex = hit.index;
      this.rows.setPointerCapture?.(e.pointerId);
      this.#paintSpan(hit.date, hit.index, hit.index);
    };

    const move = (e) => {
      if (!this.painting) return;
      e.preventDefault();
      const hit = this.#locate(e.clientX, e.clientY, this._lockDate);
      if (!hit) return;
      if (hit.date === this._lockDate) {
        // 通知が飛んでも間が抜けないよう、前回位置からまとめて塗る
        this.#paintSpan(hit.date, this._lastIndex, hit.index);
      } else {
        this._lockDate = hit.date;
        this.#paintSpan(hit.date, hit.index, hit.index);
      }
      this._lastIndex = hit.index;
    };

    const end = () => {
      if (!this.painting) return;
      this.painting = false;
      this._m = null;
      if (this._dirty) this.#commit();
    };

    this.rows.addEventListener('pointerdown', start);
    this.rows.addEventListener('pointermove', move);
    this.rows.addEventListener('pointerup', end);
    this.rows.addEventListener('pointercancel', end);
    this.rows.addEventListener('lostpointercapture', end);
    this.rows.addEventListener('contextmenu', (e) => { if (this.painting) e.preventDefault(); });
  }

  /** 1日まるごと 塗る/戻す */
  toggleDay(date) {
    const n = this.ev.slots_per_day;
    const all = this.tool.repeat(n);
    const next = this.data[date] === all ? '0'.repeat(n) : all;
    if (this.data[date] === next) return;
    this.data[date] = next;
    this.cellsByDate.get(date).forEach((c, i) => { c.dataset.v = next[i]; });
    this.#commit();
  }

  clearAll() {
    const blank = blankSlots(this.ev);
    let changed = false;
    for (const d of this.ev.dates) if (this.data[d] !== blank[d]) changed = true;
    if (!changed) return;
    this.#apply(blank);
    this.#commit();
  }

  /* --- 履歴 --- */
  #apply(snap) {
    for (const date of this.ev.dates) {
      const s = snap[date] || '0'.repeat(this.ev.slots_per_day);
      if (this.data[date] === s) continue;
      this.data[date] = s;
      this.cellsByDate.get(date).forEach((c, i) => { c.dataset.v = s[i]; });
    }
  }

  #commit() {
    this.history = this.history.slice(0, this.hIndex + 1);
    this.history.push({ ...this.data });
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.hIndex = this.history.length - 1;
    this.onChange();
    this.onHistory();
  }

  canUndo() { return this.hIndex > 0; }
  canRedo() { return this.hIndex < this.history.length - 1; }

  undo() {
    if (!this.canUndo()) return;
    this.hIndex -= 1;
    this.#apply(this.history[this.hIndex]);
    this.onChange();
    this.onHistory();
  }

  redo() {
    if (!this.canRedo()) return;
    this.hIndex += 1;
    this.#apply(this.history[this.hIndex]);
    this.onChange();
    this.onHistory();
  }

  getData() { return { ...this.data }; }

  /** 読み込み直後など、ここを履歴の起点にしたいときは keepHistory を渡さない */
  setData(obj, keepHistory = false) {
    const next = {};
    for (const date of this.ev.dates) {
      next[date] = obj?.[date] || '0'.repeat(this.ev.slots_per_day);
    }
    this.#apply(next);
    if (!keepHistory) {
      this.history = [{ ...this.data }];
      this.hIndex = 0;
      this.onHistory();
    }
  }

  /** 塗ったコマ数 */
  countBy(v) {
    let n = 0;
    for (const d of this.ev.dates) for (const ch of this.data[d]) if (ch === v) n++;
    return n;
  }

  destroy() { removeEventListener('resize', this._onResize); }
}

/* ---------- 集計 ---------- */

/** 各日・各コマの人数を数える */
export function tally(ev, responses) {
  const out = {};
  for (const d of ev.dates) {
    const yes = new Array(ev.slots_per_day).fill(0);
    const maybe = new Array(ev.slots_per_day).fill(0);
    for (const r of responses) {
      const s = r.slots[d];
      if (!s) continue;
      for (let i = 0; i < ev.slots_per_day; i++) {
        if (s[i] === '1') yes[i]++;
        else if (s[i] === '2') maybe[i]++;
      }
    }
    out[d] = { yes, maybe };
  }
  return out;
}

/**
 * 指定した長さ(コマ数)ぶん通して参加できる人が多い時間帯を探す。
 * 返り値: [{date, start, end, yes:[名前], maybe:[名前]}]
 */
export function bestWindows(ev, responses, lenSlots, limit = 6) {
  const found = [];
  for (const d of ev.dates) {
    for (let s = 0; s + lenSlots <= ev.slots_per_day; s++) {
      const yes = [], maybe = [];
      for (const r of responses) {
        const str = r.slots[d] || '';
        let allYes = true, allOk = true;
        for (let i = s; i < s + lenSlots; i++) {
          const c = str[i] || '0';
          if (c !== '1') allYes = false;
          if (c === '0') { allOk = false; break; }
        }
        if (allYes) yes.push(r.name);
        else if (allOk) maybe.push(r.name);
      }
      if (yes.length + maybe.length === 0) continue;
      found.push({ date: d, start: s, end: s + lenSlots, yes, maybe, score: yes.length + maybe.length * 0.5 });
    }
  }
  found.sort((a, b) => b.score - a.score || b.yes.length - a.yes.length || (a.date < b.date ? -1 : 1) || a.start - b.start);

  const picked = [];
  for (const w of found) {
    if (picked.some((p) => p.date === w.date && w.start < p.end && p.start < w.end)) continue;
    picked.push(w);
    if (picked.length >= limit) break;
  }
  return picked;
}
