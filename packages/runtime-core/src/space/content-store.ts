import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Id, SpaceSearchDocumentKind } from '@baocut/protocol';
import type { ContentSegment, VideoFacts } from './content-extract.ts';
import { normalizeText } from './content-search.ts';

/**
 * 内容索引的存储（架构设计 §5.11）：`<cache>/content-index/index.db`，一个 SQLite 库（Node 内置的 `node:sqlite`）。
 * 派生缓存：整个文件可以删掉重建；格式版本记在 `user_version`，对不上就删库重建，不迁移。
 *
 * - `videos`：每个视频一行（目录的真实路径为主键），记下索引时的版本、修改时间与视频事实（JSON）。
 * - `segment_rows`：可检索的段落（原文、规范化之后的正文与时间、种类、说话人），按目录建索引，换掉一个视频的段落不扫全表。
 * - `segments`：`segment_rows.body` 上的 FTS5 外部内容表（trigram 分词），由触发器同步。三个字符以上的词走 MATCH，
 *   更短的词（常见的两字中文）trigram 用不上，退回 `instr` 子串过滤。候选段落最后都由 `matchTerms` 再核对一遍。
 *
 * `DatabaseSync` 是同步的：事务里只做写库，读视频与抽取段落都在事务之外。
 */

/** 库的格式版本（`PRAGMA user_version`）。 */
export const STORE_VERSION = 1;

export const STORE_FILE = 'index.db';

export interface StoredVideo {
  dir: string;
  videoId: Id;
  name: string;
  revision: string;
  mtimeMs: number;
  indexedAt: string;
  facts: VideoFacts;
  problems: { documentId: Id; detail: string }[];
}

export interface SegmentRow extends ContentSegment {
  /** 写入顺序：同一个视频里时间与种类都相同的段落按它排。 */
  id: number;
  dir: string;
}

export interface CandidateFilter {
  terms: readonly string[];
  kinds: readonly SpaceSearchDocumentKind[] | null;
  /** 规范化之后的说话人片段。 */
  speaker: string | null;
}

/** trigram 的 MATCH 要求每个词至少三个字符（按码点计）。 */
const TRIGRAM_MIN = 3;

const SCHEMA = `
  CREATE TABLE videos (
    dir TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    name TEXT NOT NULL,
    revision TEXT NOT NULL,
    mtime_ms REAL NOT NULL,
    indexed_at TEXT NOT NULL,
    facts TEXT NOT NULL,
    problems TEXT NOT NULL
  );
  CREATE TABLE segment_rows (
    id INTEGER PRIMARY KEY,
    dir TEXT NOT NULL,
    kind TEXT NOT NULL,
    document_id TEXT,
    language TEXT,
    clock TEXT NOT NULL,
    start REAL NOT NULL,
    "end" REAL NOT NULL,
    text TEXT NOT NULL,
    body TEXT NOT NULL,
    speaker TEXT,
    speaker_key TEXT
  );
  CREATE INDEX segment_rows_dir ON segment_rows(dir);
  CREATE VIRTUAL TABLE segments USING fts5(body, content='segment_rows', content_rowid='id', tokenize='trigram');
  CREATE TRIGGER segment_rows_ai AFTER INSERT ON segment_rows BEGIN
    INSERT INTO segments(rowid, body) VALUES (new.id, new.body);
  END;
  CREATE TRIGGER segment_rows_ad AFTER DELETE ON segment_rows BEGIN
    INSERT INTO segments(segments, rowid, body) VALUES ('delete', old.id, old.body);
  END;
`;

/**
 * 词变成 SQL 条件：三个码点以上的合成一个 MATCH 表达式（每个词一个带引号的短语，AND），更短的各用一个 `instr`。
 * 正文与词都已规范化（NFKC、小写），`instr` 就是精确的子串匹配。
 */
export function termClauses(terms: readonly string[]): { match: string | null; short: string[] } {
  const long: string[] = [];
  const short: string[] = [];
  for (const term of terms) {
    if ([...term].length >= TRIGRAM_MIN) long.push(`"${term.replaceAll('"', '""')}"`);
    else short.push(term);
  }
  return { match: long.length > 0 ? long.join(' AND ') : null, short };
}

export class ContentStore {
  readonly #file: string;
  #db: DatabaseSync;
  #statements = new Map<string, StatementSync>();

  /** 打开（必要时新建）`<dir>/index.db`；坏掉的、版本不对的库删掉重建。 */
  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.#file = path.join(dir, STORE_FILE);
    this.#db = this.#open();
  }

  #open(): DatabaseSync {
    try {
      const db = new DatabaseSync(this.#file);
      try {
        const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
        const empty = (db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n === 0;
        if (version === STORE_VERSION || empty) {
          db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
          if (empty) db.exec(`BEGIN; ${SCHEMA} PRAGMA user_version = ${STORE_VERSION}; COMMIT;`);
          return db;
        }
      } catch {
        // 不是 SQLite 库、库损坏：删掉重建。
      }
      db.close();
    } catch {
      // 打不开：删掉重建。
    }
    removeStore(this.#file);
    const db = new DatabaseSync(this.#file);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    db.exec(`BEGIN; ${SCHEMA} PRAGMA user_version = ${STORE_VERSION}; COMMIT;`);
    return db;
  }

  #prepare(sql: string): StatementSync {
    let statement = this.#statements.get(sql);
    if (!statement) {
      statement = this.#db.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return statement;
  }

  /** 全部视频的记录；事实或问题的 JSON 读不回的行当作没有（会被重读覆盖）。 */
  videos(): StoredVideo[] {
    const rows = this.#prepare('SELECT * FROM videos').all() as {
      dir: string;
      video_id: string;
      name: string;
      revision: string;
      mtime_ms: number;
      indexed_at: string;
      facts: string;
      problems: string;
    }[];
    const videos: StoredVideo[] = [];
    for (const row of rows) {
      try {
        videos.push({
          dir: row.dir,
          videoId: row.video_id,
          name: row.name,
          revision: row.revision,
          mtimeMs: row.mtime_ms,
          indexedAt: row.indexed_at,
          facts: JSON.parse(row.facts) as VideoFacts,
          problems: JSON.parse(row.problems) as StoredVideo['problems'],
        });
      } catch {
        // 格式不对：重读时覆盖。
      }
    }
    return videos;
  }

  /** 换掉一个视频的记录与全部段落（一个事务）。 */
  replace(video: StoredVideo, segments: readonly ContentSegment[]): void {
    const rows = segments.map((segment) => ({
      segment,
      body: normalizeText(segment.text),
      speakerKey: segment.speaker === null ? null : normalizeText(segment.speaker),
    }));
    const insert = this.#prepare(
      `INSERT INTO segment_rows (dir, kind, document_id, language, clock, start, "end", text, body, speaker, speaker_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.#transaction(() => {
      this.#prepare('DELETE FROM segment_rows WHERE dir = ?').run(video.dir);
      for (const { segment, body, speakerKey } of rows) {
        insert.run(
          video.dir,
          segment.kind,
          segment.documentId,
          segment.language,
          segment.clock,
          segment.start,
          segment.end,
          segment.text,
          body,
          segment.speaker,
          speakerKey,
        );
      }
      this.#prepare(
        `INSERT OR REPLACE INTO videos (dir, video_id, name, revision, mtime_ms, indexed_at, facts, problems)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        video.dir,
        video.videoId,
        video.name,
        video.revision,
        video.mtimeMs,
        video.indexedAt,
        JSON.stringify(video.facts),
        JSON.stringify(video.problems),
      );
    });
  }

  /** 版本没变：只记下新的修改时间与名字。 */
  touch(dir: string, mtimeMs: number, name: string): void {
    this.#prepare('UPDATE videos SET mtime_ms = ?, name = ? WHERE dir = ?').run(mtimeMs, name, dir);
  }

  /** 删掉这些视频的记录与段落（一个事务）。 */
  remove(dirs: readonly string[]): void {
    if (dirs.length === 0) return;
    this.#transaction(() => {
      for (const dir of dirs) {
        this.#prepare('DELETE FROM segment_rows WHERE dir = ?').run(dir);
        this.#prepare('DELETE FROM videos WHERE dir = ?').run(dir);
      }
    });
  }

  /**
   * 可能命中的段落：词经 FTS（三个字符以上）或 `instr`（更短的）过滤，再按种类与说话人过滤。结果还要由调用方用
   * `matchTerms` 核对（trigram 的大小写折叠与 JS 的小写不完全相同，这里只负责缩小范围）。
   */
  candidates(filter: CandidateFilter): SegmentRow[] {
    const { match, short } = termClauses(filter.terms);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (match !== null) {
      where.push('r.id IN (SELECT rowid FROM segments WHERE segments MATCH ?)');
      params.push(match);
    }
    for (const term of short) {
      where.push('instr(r.body, ?) > 0');
      params.push(term);
    }
    if (filter.kinds) {
      where.push(`r.kind IN (${filter.kinds.map(() => '?').join(', ')})`);
      params.push(...filter.kinds);
    }
    if (filter.speaker !== null) {
      where.push('r.speaker_key IS NOT NULL AND instr(r.speaker_key, ?) > 0');
      params.push(filter.speaker);
    }
    const sql = `SELECT r.id, r.dir, r.kind, r.document_id, r.language, r.clock, r.start, r."end", r.text, r.speaker
      FROM segment_rows r ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`;
    const rows = this.#prepare(sql).all(...params) as {
      id: number;
      dir: string;
      kind: SpaceSearchDocumentKind;
      document_id: string | null;
      language: string | null;
      clock: 'sequence' | 'source';
      start: number;
      end: number;
      text: string;
      speaker: string | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      dir: row.dir,
      kind: row.kind,
      documentId: row.document_id,
      language: row.language,
      clock: row.clock,
      start: row.start,
      end: row.end,
      text: row.text,
      speaker: row.speaker,
    }));
  }

  close(): void {
    this.#statements.clear();
    if (this.#db.isOpen) this.#db.close();
  }

  #transaction(work: () => void): void {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      work();
      this.#db.exec('COMMIT');
    } catch (error) {
      if (this.#db.isTransaction) this.#db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** 删掉库文件与 WAL 旁文件（连接要先关上）。 */
export function removeStore(file: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(`${file}${suffix}`, { force: true });
}
