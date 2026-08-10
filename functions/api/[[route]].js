/**
 * ぬりあわせ API
 *
 * POST   /api/events                     イベント作成
 * GET    /api/e/:publicToken             回答用のイベント情報
 * POST   /api/e/:publicToken/responses   回答を提出
 * GET    /api/r/:editToken               自分の回答を読み込む(修正用)
 * PUT    /api/r/:editToken               自分の回答を修正(差分ログを残す)
 * GET    /api/a/:adminToken              作成者用: 全回答 + 変更ログ
 */
 
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
 
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
 
const fail = (message, status = 400) => json({ error: message }, status);
 
function token(len = 18) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
 
const nowIso = () => new Date().toISOString();
 
/* ---------- 日付・コマのユーティリティ ---------- */
 
function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}
 
function dateList(startDate, endDate) {
  const out = [];
  let t = Date.parse(startDate + 'T00:00:00Z');
  const end = Date.parse(endDate + 'T00:00:00Z');
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
    if (out.length > 120) break; // 安全弁
  }
  return out;
}
 
const slotsPerDay = (ev) => Math.round((ev.end_min - ev.start_min) / ev.slot_min);
 
/** 受け取ったslotsを検証して正規化する。不正なら null */
function normalizeSlots(raw, dates, n) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const blank = '0'.repeat(n);
  const out = {};
  for (const d of dates) {
    const v = raw[d];
    if (v === undefined || v === null) {
      out[d] = blank;
      continue;
    }
    if (typeof v !== 'string' || v.length !== n || /[^012]/.test(v)) return null;
    out[d] = v;
  }
  return out;
}
 
/** 旧→新の差分を、連続する区間にまとめて返す */
function diffSlots(before, after, dates, n) {
  const blank = '0'.repeat(n);
  const out = [];
  for (const d of dates) {
    const a = before[d] || blank;
    const b = after[d] || blank;
    let i = 0;
    while (i < n) {
      if (a[i] === b[i]) { i++; continue; }
      const from = a[i], to = b[i];
      let j = i;
      while (j < n && a[j] === from && b[j] === to) j++;
      out.push({ date: d, start: i, end: j, from, to });
      i = j;
    }
  }
  return out;
}
 
function clean(s, max) {
  return String(s ?? '').replace(/\s+$/g, '').slice(0, max);
}
 
/* ---------- ハンドラ ---------- */
 
async function createEvent(request, db) {
  let body;
  try { body = await request.json(); } catch { return fail('リクエストの形式が正しくありません。'); }
 
  const title = clean(body.title, 80);
  const memo = clean(body.memo, 500);
  const { start_date: sd, end_date: ed } = body;
  const startMin = Number(body.start_min);
  const endMin = Number(body.end_min);
  const slotMin = Number(body.slot_min ?? 15);
 
  if (!title) return fail('イベント名を入力してください。');
  if (!isDate(sd) || !isDate(ed)) return fail('日付の形式が正しくありません。');
  if (sd > ed) return fail('終了日は開始日より後にしてください。');
  if (dateList(sd, ed).length > 62) return fail('期間は62日までにしてください。');
  if (![5, 10, 15, 20, 30, 60].includes(slotMin)) return fail('1コマの長さが不正です。');
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0 || endMin > 1440 || endMin <= startMin) {
    return fail('時間帯の指定が正しくありません。');
  }
  if ((endMin - startMin) % slotMin !== 0) return fail('時間帯が1コマの長さで割り切れません。');
  if ((endMin - startMin) / slotMin > 200) return fail('1日のコマ数が多すぎます。');
 
  const id = crypto.randomUUID();
  const publicToken = token();
  const adminToken = token(22);
 
  await db
    .prepare(
      `INSERT INTO events (id,title,memo,start_date,end_date,start_min,end_min,slot_min,public_token,admin_token,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(id, title, memo, sd, ed, startMin, endMin, slotMin, publicToken, adminToken, nowIso())
    .run();
 
  return json({ public_token: publicToken, admin_token: adminToken }, 201);
}
 
function publicEvent(ev) {
  return {
    title: ev.title,
    memo: ev.memo,
    start_date: ev.start_date,
    end_date: ev.end_date,
    start_min: ev.start_min,
    end_min: ev.end_min,
    slot_min: ev.slot_min,
    image_url: ev.image_key ? '/api/img/' + ev.image_key : null,
    dates: dateList(ev.start_date, ev.end_date),
    slots_per_day: slotsPerDay(ev),
  };
}
 
/* ---------- ロゴ画像 ---------- */
 
const IMAGE_TYPES = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};
/** 縮小後の上限。ロゴ用途なら十分な大きさ */
const IMAGE_MAX_BYTES = 512 * 1024;
 
async function putImage(request, env, db, adminToken) {
  if (!env.BUCKET) return fail('画像の保存先が設定されていません。R2のバインディング(BUCKET)を確認してください。', 500);
 
  const ev = await db.prepare('SELECT * FROM events WHERE admin_token = ?').bind(adminToken).first();
  if (!ev) return fail('この日程調整は見つかりませんでした。', 404);
 
  const type = (request.headers.get('content-type') || '').split(';')[0].trim();
  const ext = IMAGE_TYPES[type];
  if (!ext) return fail('PNG・JPEG・WebPの画像を選んでください。');
 
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return fail('画像を読み取れませんでした。');
  if (body.byteLength > IMAGE_MAX_BYTES) return fail('画像が大きすぎます。もう少し小さいものを選んでください。');
 
  const key = `${token(14)}.${ext}`;
  await env.BUCKET.put(key, body, { httpMetadata: { contentType: type } });
 
  const old = ev.image_key;
  await db.prepare('UPDATE events SET image_key = ? WHERE id = ?').bind(key, ev.id).run();
  if (old) {
    try { await env.BUCKET.delete(old); } catch { /* 消せなくても支障はない */ }
  }
 
  return json({ image_url: '/api/img/' + key }, 201);
}
 
async function getImage(env, key) {
  if (!env.BUCKET) return fail('画像の保存先が設定されていません。', 500);
  if (!/^[a-z0-9]+\.(webp|png|jpg)$/.test(key)) return fail('画像が見つかりません。', 404);
 
  const obj = await env.BUCKET.get(key);
  if (!obj) return fail('画像が見つかりません。', 404);
 
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
      'etag': obj.httpEtag,
    },
  });
}
 
async function getEventForVote(db, publicToken) {
  const ev = await db.prepare('SELECT * FROM events WHERE public_token = ?').bind(publicToken).first();
  if (!ev) return fail('この日程調整は見つかりませんでした。URLをご確認ください。', 404);
  const cnt = await db.prepare('SELECT COUNT(*) AS c FROM responses WHERE event_id = ?').bind(ev.id).first();
  return json({ event: publicEvent(ev), response_count: cnt.c });
}
 
async function submitResponse(request, db, publicToken) {
  const ev = await db.prepare('SELECT * FROM events WHERE public_token = ?').bind(publicToken).first();
  if (!ev) return fail('この日程調整は見つかりませんでした。', 404);
 
  let body;
  try { body = await request.json(); } catch { return fail('リクエストの形式が正しくありません。'); }
 
  const name = clean(body.name, 40);
  const note = clean(body.note, 500);
  if (!name) return fail('お名前を入力してください。');
 
  const dates = dateList(ev.start_date, ev.end_date);
  const n = slotsPerDay(ev);
  const slots = normalizeSlots(body.slots, dates, n);
  if (!slots) return fail('入力内容を読み取れませんでした。ページを再読み込みして、もう一度お試しください。');
 
  const id = crypto.randomUUID();
  const editToken = token(22);
  const ts = nowIso();
 
  await db
    .prepare(
      `INSERT INTO responses (id,event_id,name,note,slots,edit_token,revision,created_at,updated_at)
       VALUES (?,?,?,?,?,?,1,?,?)`
    )
    .bind(id, ev.id, name, note, JSON.stringify(slots), editToken, ts, ts)
    .run();
 
  return json({ edit_token: editToken }, 201);
}
 
async function getOwnResponse(db, editToken) {
  const r = await db.prepare('SELECT * FROM responses WHERE edit_token = ?').bind(editToken).first();
  if (!r) return fail('この回答は見つかりませんでした。URLをご確認ください。', 404);
  const ev = await db.prepare('SELECT * FROM events WHERE id = ?').bind(r.event_id).first();
  return json({
    event: publicEvent(ev),
    response: { name: r.name, note: r.note, slots: JSON.parse(r.slots), revision: r.revision, updated_at: r.updated_at },
  });
}
 
async function updateResponse(request, db, editToken) {
  const r = await db.prepare('SELECT * FROM responses WHERE edit_token = ?').bind(editToken).first();
  if (!r) return fail('この回答は見つかりませんでした。', 404);
  const ev = await db.prepare('SELECT * FROM events WHERE id = ?').bind(r.event_id).first();
 
  let body;
  try { body = await request.json(); } catch { return fail('リクエストの形式が正しくありません。'); }
 
  const name = clean(body.name, 40);
  const note = clean(body.note, 500);
  if (!name) return fail('お名前を入力してください。');
 
  const dates = dateList(ev.start_date, ev.end_date);
  const n = slotsPerDay(ev);
  const after = normalizeSlots(body.slots, dates, n);
  if (!after) return fail('入力内容を読み取れませんでした。ページを再読み込みして、もう一度お試しください。');
 
  const before = JSON.parse(r.slots);
  const diff = diffSlots(before, after, dates, n);
  const nameChanged = name !== r.name;
  const noteChanged = note !== r.note;
 
  if (diff.length === 0 && !nameChanged && !noteChanged) {
    return json({ revision: r.revision, changed: 0 });
  }
 
  const rev = r.revision + 1;
  const ts = nowIso();
 
  await db.batch([
    db.prepare('UPDATE responses SET name=?, note=?, slots=?, revision=?, updated_at=? WHERE id=?')
      .bind(name, note, JSON.stringify(after), rev, ts, r.id),
    db.prepare(
      `INSERT INTO change_logs (event_id,response_id,revision,changed_at,name_before,name_after,note_before,note_after,diff)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      ev.id, r.id, rev, ts,
      nameChanged ? r.name : null, nameChanged ? name : null,
      noteChanged ? r.note : null, noteChanged ? note : null,
      JSON.stringify(diff)
    ),
  ]);
 
  return json({ revision: rev, changed: diff.length });
}
 
async function getAdmin(db, adminToken) {
  const ev = await db.prepare('SELECT * FROM events WHERE admin_token = ?').bind(adminToken).first();
  if (!ev) return fail('この集計ページは見つかりませんでした。URLをご確認ください。', 404);
 
  const rs = await db
    .prepare('SELECT id,name,note,slots,revision,created_at,updated_at FROM responses WHERE event_id=? ORDER BY created_at')
    .bind(ev.id).all();
 
  const logs = await db
    .prepare('SELECT * FROM change_logs WHERE event_id=? ORDER BY id DESC LIMIT 300')
    .bind(ev.id).all();
 
  const nameById = new Map(rs.results.map((r) => [r.id, r.name]));
 
  return json({
    event: { ...publicEvent(ev), public_token: ev.public_token },
    responses: rs.results.map((r) => ({
      id: r.id, name: r.name, note: r.note, slots: JSON.parse(r.slots),
      revision: r.revision, created_at: r.created_at, updated_at: r.updated_at,
    })),
    logs: logs.results.map((l) => ({
      id: l.id,
      who: nameById.get(l.response_id) || '(削除済み)',
      revision: l.revision,
      changed_at: l.changed_at,
      name_before: l.name_before, name_after: l.name_after,
      note_before: l.note_before, note_after: l.note_after,
      diff: JSON.parse(l.diff),
    })),
  });
}
 
/* ---------- ルーティング ---------- */
 
export async function onRequest(context) {
  const { request, env, params } = context;
  const db = env.DB;
  if (!db) return fail('データベースに接続できません。D1のバインディング(DB)を確認してください。', 500);
 
  const seg = Array.isArray(params.route) ? params.route : [params.route].filter(Boolean);
  const m = request.method;
 
  try {
    if (m === 'POST' && seg.length === 1 && seg[0] === 'events') return await createEvent(request, db);
    if (m === 'GET' && seg.length === 2 && seg[0] === 'e') return await getEventForVote(db, seg[1]);
    if (m === 'POST' && seg.length === 3 && seg[0] === 'e' && seg[2] === 'responses') return await submitResponse(request, db, seg[1]);
    if (m === 'GET' && seg.length === 2 && seg[0] === 'r') return await getOwnResponse(db, seg[1]);
    if (m === 'PUT' && seg.length === 2 && seg[0] === 'r') return await updateResponse(request, db, seg[1]);
    if (m === 'GET' && seg.length === 2 && seg[0] === 'a') return await getAdmin(db, seg[1]);
    if (m === 'PUT' && seg.length === 3 && seg[0] === 'a' && seg[2] === 'image') return await putImage(request, env, db, seg[1]);
    if (m === 'GET' && seg.length === 2 && seg[0] === 'img') return await getImage(env, seg[1]);
    return fail('そのURLは存在しません。', 404);
  } catch (err) {
    return fail('サーバー側で処理できませんでした: ' + (err?.message || String(err)), 500);
  }
}
