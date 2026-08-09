-- ぬりあわせ / スキーマ
DROP TABLE IF EXISTS change_logs;
DROP TABLE IF EXISTS responses;
DROP TABLE IF EXISTS events;

CREATE TABLE events (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  memo          TEXT NOT NULL DEFAULT '',
  start_date    TEXT NOT NULL,          -- YYYY-MM-DD
  end_date      TEXT NOT NULL,          -- YYYY-MM-DD
  start_min     INTEGER NOT NULL,       -- 1日の開始 (分), 例 600 = 10:00
  end_min       INTEGER NOT NULL,       -- 1日の終了 (分), 例 1380 = 23:00
  slot_min      INTEGER NOT NULL,       -- 1コマの長さ (分), 例 15
  public_token  TEXT NOT NULL UNIQUE,   -- 回答者に配るURLのキー
  admin_token   TEXT NOT NULL UNIQUE,   -- 作成者だけが持つ集計URLのキー
  created_at    TEXT NOT NULL
);

CREATE TABLE responses (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id),
  name        TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',  -- 備考
  slots       TEXT NOT NULL,             -- JSON { "YYYY-MM-DD": "0120021..." } 0=なし 1=可能 2=未定
  edit_token  TEXT NOT NULL UNIQUE,      -- 本人が修正するためのキー
  revision    INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_responses_event ON responses(event_id);

CREATE TABLE change_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     TEXT NOT NULL,
  response_id  TEXT NOT NULL,
  revision     INTEGER NOT NULL,       -- 修正後のリビジョン
  changed_at   TEXT NOT NULL,
  name_before  TEXT,
  name_after   TEXT,
  note_before  TEXT,
  note_after   TEXT,
  diff         TEXT NOT NULL           -- JSON [{date,start,end,from,to}]
);
CREATE INDEX idx_logs_event ON change_logs(event_id, id);
