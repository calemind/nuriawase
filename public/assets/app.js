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

/**
 * 塗れるシフト表。
 *   new PaintGrid(container, event, { readOnly })
 */
export class PaintGrid {
  constructor(host, ev, opts = {}) {
    this.ev = ev;
    this.readOnly = !!opts.readOnly;
    this.onChange = opts.onChange || (() => {});
    this.tool = '1';
    this.zoom = 1;
    this.data = blankSlots(ev);
    this.cellsByDate = new Map();

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

    this._onResize = () => this.fit();
    addEventListener('resize', this._onResize);
    requestAnimationFrame(() => this.fit());
  }

  /* --- 描画 --- */
  #buildRuler() {
    const ev = this.ev;
    const ruler = el('div', 'ruler');
    const corner = el('div', 'corner', '時刻 →');
    const ticks = el('div', 'ticks');
    this.ticks = ticks;

    const perHour = 60 / ev.slot_min;
    for (let i = 0; i < ev.slots_per_day; i++) {
      const m = slotMinAt(ev, i);
      if (m % 60 !== 0 && i !== 0) continue;
      const t = el('div', 'tick');
      t.dataset.i = i;
      t.append(el('b', null, `${Math.floor(m / 60)}`));
      ticks.append(t);
    }
    this.perHour = perHour;
    ruler.append(corner, ticks);
    this.inner.append(ruler);
  }

  #buildRows() {
    const ev = this.ev;
    const rows = el('div', 'rows');
    ev.dates.forEach((date, di) => {
      const dw = dowOf(date);
      const row = el('div', 'grow' + (dw === 0 ? ' sun weekend' : dw === 6 ? ' sat weekend' : ''));
      const label = el('div', 'rowlabel');
      label.append(el('span', null, fmtDate(date)), el('span', 'dow', fmtDow(date)));
      if (!this.readOnly) {
        label.title = 'クリックでこの日を一括で塗る / 戻す';
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
    this.box.style.setProperty('--cw', cw.toFixed(3) + 'px');
    this.ticks.style.width = (cw * this.ev.slots_per_day) + 'px';
    this.ticks.querySelectorAll('.tick').forEach((t) => {
      t.style.left = (Number(t.dataset.i) * cw) + 'px';
    });
  }

  /* --- 操作 --- */
  setTool(v) { this.tool = String(v); }

  #paintCell(node) {
    if (!node || !node.classList.contains('cell')) return;
    if (node.dataset.v === this.tool) return;
    node.dataset.v = this.tool;
    const date = node.dataset.date;
    const i = Number(node.dataset.i);
    const s = this.data[date];
    this.data[date] = s.slice(0, i) + this.tool + s.slice(i + 1);
    this._dirty = true;
  }

  #bindPaint() {
    const start = (e) => {
      const t = document.elementFromPoint(e.clientX, e.clientY);
      if (!t || !t.classList.contains('cell')) return;
      e.preventDefault();
      this.painting = true;
      this._dirty = false;
      this.rows.setPointerCapture?.(e.pointerId);
      this.#paintCell(t);
    };
    const move = (e) => {
      if (!this.painting) return;
      e.preventDefault();
      this.#paintCell(document.elementFromPoint(e.clientX, e.clientY));
    };
    const end = () => {
      if (!this.painting) return;
      this.painting = false;
      if (this._dirty) this.onChange();
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
    const cur = this.data[date];
    const all = this.tool.repeat(this.ev.slots_per_day);
    const next = cur === all ? '0'.repeat(this.ev.slots_per_day) : all;
    this.data[date] = next;
    this.cellsByDate.get(date).forEach((c, i) => { c.dataset.v = next[i]; });
    this.onChange();
  }

  clearAll() {
    this.setData(blankSlots(this.ev));
    this.onChange();
  }

  getData() { return { ...this.data }; }

  setData(obj) {
    for (const date of this.ev.dates) {
      const s = obj?.[date] || '0'.repeat(this.ev.slots_per_day);
      this.data[date] = s;
      this.cellsByDate.get(date).forEach((c, i) => { c.dataset.v = s[i]; });
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

  // 重なりの強い候補は1つに絞る
  const picked = [];
  for (const w of found) {
    if (picked.some((p) => p.date === w.date && w.start < p.end && p.start < w.end)) continue;
    picked.push(w);
    if (picked.length >= limit) break;
  }
  return picked;
}
