import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Id, SemanticEvidenceType, SpaceSearchDocumentKind } from '@baocut/protocol';
import type { ChunkDraft, SentenceRow } from './chunks.ts';

/**
 * 语义索引的派生库（EmbeddingGemma 2 检索集成方案 v0.1 §8）：`<cache>/semantic-index/v1/index.db`，一个独立的 SQLite 库
 * （`node:sqlite`，WAL）。它是派生数据：删掉可以从视频重建，不是任何东西的真源，也不做授权（权限在查询时由 Space 的范围决定）。
 *
 * 表（§8.2 的实体，按首版只有文字通道收窄）：
 * - `meta`：键值（暂停状态）。格式版本记在 `PRAGMA user_version`。
 * - `sources`：每个视频一行：目录、项目、最近一次冻结的版本（`wanted_revision`）与当前发布的世代指针（`active_generation`）。
 * - `generations`：某视频某通道一次构建的世代（`building` 不出现在库里：只有完整验证过的结果才写入，直接是 `active`；
 *   被替换的标 `retired` 后删掉它的关系行）。
 * - `chunks`：稳定的内容片段（chunkId、原文、证据类别、句子身份），跨世代复用。
 * - `generation_chunks`：世代里的出现位置（时间、顺序、章节）与所用向量的 `embedding_key`（occurrence，§9.4：只移动位置不重算）。
 * - `generation_sentences`：世代里的句子行（邻句扩展、字面命中对回句子身份）。
 * - `embeddings`：按 `embedding_key`（encoderProfileId + 送进模型的输入摘要，§5.3）存 FP32 向量，跨世代、跨视频复用；
 *   每批编码完立刻提交（崩溃后已提交的不重算，§9.3）。
 * - 画面通道（检索规格 §6.2，格式 2 起）：`visual_sources` 是每个视频画面索引的版本与世代指针（与文字各自独立：没有讲话的素材
 *   也有画面）；世代同样写在 `generations`（`channel = 'visual'`）；`visual_frames` 是世代里的关键帧（素材、内容哈希、来源时间、
 *   所用向量的 `embedding_key`）。向量与文字共用 `embeddings`，按引用清理时两边的引用都算。
 *
 * 发布（§9.5）：一个事务里核对冻结时的版本仍是最新冻结的（`wanted_revision`）、世代指针没被别人换过，再写入全部关系并切换指针；
 * 核对不过就不发布（迟到的旧结果不覆盖新版本，§9.3），只留下内容寻址的向量缓存。
 *
 * 格式版本：格式 1（只有文字）原地补上画面的表升到 2，文字索引原样保留；更旧的、坏掉的库删掉重建；更新的（更新版本的 BaoCut
 * 写的）不动，语义检索在这个进程里不可用（§8.1）。目录名仍是 `v1`。
 */

/** 库的格式版本（`PRAGMA user_version`）。 */
export const SEMANTIC_STORE_VERSION = 2;
export const SEMANTIC_STORE_FILE = 'index.db';
/** 相对缓存目录的位置。 */
export const SEMANTIC_STORE_DIR = path.join('semantic-index', 'v1');

const BUSY_TIMEOUT_MS = 2_000;
/** 没有世代引用的向量多久之后才清掉：正在编码、还没发布的批次先写进来，不能被别的视频的发布顺手清掉。 */
const ORPHAN_GRACE_MS = 60 * 60 * 1000;

const SCHEMA = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE sources (
    video_id TEXT PRIMARY KEY,
    dir TEXT NOT NULL,
    project_id TEXT,
    wanted_revision TEXT,
    active_generation INTEGER,
    state TEXT NOT NULL,
    error TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE generations (
    id INTEGER PRIMARY KEY,
    video_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    revision TEXT NOT NULL,
    encoder_profile_id TEXT NOT NULL,
    embedding_space_id TEXT NOT NULL,
    dims INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX generations_video ON generations(video_id);
  CREATE TABLE chunks (
    chunk_id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    document_id TEXT,
    document_kind TEXT NOT NULL,
    evidence_type TEXT NOT NULL,
    sentence_ids TEXT NOT NULL,
    text TEXT NOT NULL,
    speaker TEXT,
    language TEXT
  );
  CREATE TABLE generation_chunks (
    generation_id INTEGER NOT NULL,
    chunk_id TEXT NOT NULL,
    ord INTEGER NOT NULL,
    clock TEXT NOT NULL,
    start REAL NOT NULL,
    "end" REAL NOT NULL,
    chapter_id TEXT,
    chapter_title TEXT,
    embedding_key TEXT NOT NULL,
    PRIMARY KEY (generation_id, chunk_id)
  );
  CREATE INDEX generation_chunks_key ON generation_chunks(embedding_key);
  CREATE INDEX generation_chunks_chunk ON generation_chunks(chunk_id);
  CREATE TABLE generation_sentences (
    generation_id INTEGER NOT NULL,
    document_id TEXT,
    document_kind TEXT NOT NULL,
    ord INTEGER NOT NULL,
    sentence_ids TEXT NOT NULL,
    text TEXT NOT NULL,
    clock TEXT NOT NULL,
    start REAL NOT NULL,
    "end" REAL NOT NULL,
    speaker TEXT
  );
  CREATE INDEX generation_sentences_gen ON generation_sentences(generation_id);
  CREATE TABLE embeddings (
    embedding_key TEXT PRIMARY KEY,
    encoder_profile_id TEXT NOT NULL,
    dims INTEGER NOT NULL,
    vector BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

/** 格式 2 加的画面表：新建的库与格式 1 升上来的库都执行它（只建不存在的）。 */
const VISUAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS visual_sources (
    video_id TEXT PRIMARY KEY,
    wanted_revision TEXT,
    active_generation INTEGER,
    state TEXT NOT NULL,
    error TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS visual_frames (
    generation_id INTEGER NOT NULL,
    ord INTEGER NOT NULL,
    asset_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    source_sec REAL NOT NULL,
    sequence_sec REAL,
    embedding_key TEXT NOT NULL,
    PRIMARY KEY (generation_id, ord)
  );
  CREATE INDEX IF NOT EXISTS visual_frames_key ON visual_frames(embedding_key);
`;

export type SourceState = 'pending' | 'indexed' | 'empty' | 'failed';

export interface SourceRow {
  videoId: Id;
  dir: string;
  projectId: Id | null;
  /** 最近一次冻结（排进来）的版本。 */
  wantedRevision: string | null;
  activeGeneration: number | null;
  state: SourceState;
  error: string | null;
}

export interface GenerationRow {
  id: number;
  videoId: Id;
  channel: 'text' | 'visual';
  revision: string;
  encoderProfileId: string;
  embeddingSpaceId: string;
  dims: number;
  chunkCount: number;
}

/** 一个世代里的 chunk 与它的出现位置。 */
export interface StoredChunk {
  chunkId: string;
  generationId: number;
  videoId: Id;
  documentId: Id | null;
  documentKind: SpaceSearchDocumentKind;
  evidenceType: SemanticEvidenceType;
  sentenceIds: string[];
  text: string;
  speaker: string | null;
  language: string | null;
  ord: number;
  clock: 'sequence' | 'source';
  start: number;
  end: number;
  chapter: { id: string; title: string } | null;
  embeddingKey: string;
}

/** 一个世代的向量分区：连续的 Float32Array（`chunks.length × dims`）与对应的 chunk。 */
export interface VectorPartition {
  generation: GenerationRow;
  chunks: StoredChunk[];
  vectors: Float32Array;
}

export interface PublishInput {
  videoId: Id;
  /** 冻结时的版本。 */
  revision: string;
  /** 冻结时看到的世代指针：发布时还得是它（CAS）。 */
  expectedGeneration: number | null;
  encoderProfileId: string;
  embeddingSpaceId: string;
  dims: number;
  chunks: readonly (ChunkDraft & { embeddingKey: string })[];
  sentences: readonly SentenceRow[];
}

export type PublishResult = { published: true; generationId: number } | { published: false; reason: 'stale' | 'missing-vectors' | 'gone' };

/** 一个视频的画面索引：最近一次冻结的版本（视频里各素材内容版本的摘要）与当前发布的世代。 */
export interface VisualSourceRow {
  videoId: Id;
  wantedRevision: string | null;
  activeGeneration: number | null;
  state: SourceState;
  error: string | null;
}

/** 画面世代里的一帧：素材、它的内容版本、来源时间（秒）与向量。 */
export interface StoredFrame {
  generationId: number;
  ord: number;
  assetId: Id;
  contentHash: string;
  sourceSec: number;
  /** 这一版时间线上的位置（根序列秒）；素材的这一刻不在时间线上时 null。 */
  sequenceSec: number | null;
  embeddingKey: string;
}

export interface VisualPartition {
  generation: GenerationRow;
  frames: StoredFrame[];
  vectors: Float32Array;
}

export interface PublishVisualInput {
  videoId: Id;
  revision: string;
  expectedGeneration: number | null;
  encoderProfileId: string;
  embeddingSpaceId: string;
  dims: number;
  frames: readonly Omit<StoredFrame, 'generationId' | 'ord'>[];
}

export class SemanticStoreTooNew extends Error {
  constructor(version: number) {
    super(`semantic index format ${version} is newer than this build (${SEMANTIC_STORE_VERSION})`);
    this.name = 'SemanticStoreTooNew';
  }
}

export class SemanticStore {
  readonly file: string;
  #db: DatabaseSync;
  readonly #statements = new Map<string, StatementSync>();

  /** 打开（必要时新建）`<dir>/index.db`。更新版本写的库抛 `SemanticStoreTooNew`，不删。 */
  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, SEMANTIC_STORE_FILE);
    this.#db = this.#open();
  }

  #open(): DatabaseSync {
    try {
      const db = new DatabaseSync(this.file, { timeout: BUSY_TIMEOUT_MS });
      let version: number | null = null;
      try {
        version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
        const empty = (db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n === 0;
        if (version === SEMANTIC_STORE_VERSION || version === 1 || empty) {
          db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
          if (empty) db.exec(`BEGIN; ${SCHEMA} ${VISUAL_SCHEMA} PRAGMA user_version = ${SEMANTIC_STORE_VERSION}; COMMIT;`);
          // 格式 1 → 2：只加画面的表，文字索引不动。
          else if (version === 1) db.exec(`BEGIN; ${VISUAL_SCHEMA} PRAGMA user_version = ${SEMANTIC_STORE_VERSION}; COMMIT;`);
          return db;
        }
      } catch {
        version = null;
      }
      db.close();
      if (version !== null && version > SEMANTIC_STORE_VERSION) throw new SemanticStoreTooNew(version);
    } catch (error) {
      if (error instanceof SemanticStoreTooNew) throw error;
      // 打不开：删掉重建。
    }
    removeSemanticStore(this.file);
    const db = new DatabaseSync(this.file, { timeout: BUSY_TIMEOUT_MS });
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    db.exec(`BEGIN; ${SCHEMA} ${VISUAL_SCHEMA} PRAGMA user_version = ${SEMANTIC_STORE_VERSION}; COMMIT;`);
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

  #transaction<T>(work: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.#db.isTransaction) this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  // ---- meta ----

  getMeta(key: string): string | null {
    const row = this.#prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string | null): void {
    if (value === null) this.#prepare('DELETE FROM meta WHERE key = ?').run(key);
    else this.#prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
  }

  // ---- sources ----

  sources(): SourceRow[] {
    return (this.#prepare('SELECT * FROM sources').all() as unknown as RawSource[]).map(sourceOf);
  }

  source(videoId: Id): SourceRow | null {
    const row = this.#prepare('SELECT * FROM sources WHERE video_id = ?').get(videoId) as unknown as RawSource | undefined;
    return row ? sourceOf(row) : null;
  }

  /**
   * 冻结（§9.2 freeze）：记下这次要建的版本，返回此刻的世代指针（发布时的 CAS 依据）。之后再冻结一个更新的版本，
   * 这一次的发布就会被拒绝。
   */
  freeze(videoId: Id, dir: string, projectId: Id | null, revision: string): { expectedGeneration: number | null } {
    return this.#transaction(() => {
      const existing = this.source(videoId);
      if (existing) {
        this.#prepare(
          `UPDATE sources SET dir = ?, project_id = ?, wanted_revision = ?, state = CASE WHEN state = 'failed' THEN 'pending' ELSE state END,
             error = NULL, updated_at = ? WHERE video_id = ?`,
        ).run(dir, projectId, revision, new Date().toISOString(), videoId);
        return { expectedGeneration: existing.activeGeneration };
      }
      this.#prepare(
        `INSERT INTO sources (video_id, dir, project_id, wanted_revision, active_generation, state, error, updated_at)
         VALUES (?, ?, ?, ?, NULL, 'pending', NULL, ?)`,
      ).run(videoId, dir, projectId, revision, new Date().toISOString());
      return { expectedGeneration: null };
    });
  }

  /** 这次构建失败：只在它仍是最新冻结的版本时记下。 */
  markFailed(videoId: Id, revision: string, error: string): void {
    this.#prepare(`UPDATE sources SET state = 'failed', error = ?, updated_at = ? WHERE video_id = ? AND wanted_revision = ?`).run(
      error,
      new Date().toISOString(),
      videoId,
      revision,
    );
  }

  /** 视频不在 Space 里了：立即不可检索（撤销两个通道的世代与关系行），向量按引用清理。 */
  removeVideos(videoIds: readonly Id[]): void {
    if (videoIds.length === 0) return;
    this.#transaction(() => {
      for (const videoId of videoIds) {
        for (const { id } of this.#prepare('SELECT id FROM generations WHERE video_id = ?').all(videoId) as { id: number }[]) {
          this.#dropGeneration(id);
        }
        this.#prepare('DELETE FROM sources WHERE video_id = ?').run(videoId);
        this.#prepare('DELETE FROM visual_sources WHERE video_id = ?').run(videoId);
        this.#prepare('DELETE FROM chunks WHERE video_id = ?').run(videoId);
      }
    });
  }

  // ---- 画面 ----

  visualSources(): VisualSourceRow[] {
    return (this.#prepare('SELECT * FROM visual_sources').all() as unknown as RawVisualSource[]).map(visualSourceOf);
  }

  visualSource(videoId: Id): VisualSourceRow | null {
    const row = this.#prepare('SELECT * FROM visual_sources WHERE video_id = ?').get(videoId) as unknown as RawVisualSource | undefined;
    return row ? visualSourceOf(row) : null;
  }

  /** 画面的冻结（同 `freeze`）：记下要建的版本，返回此刻的画面世代指针。 */
  freezeVisual(videoId: Id, revision: string): { expectedGeneration: number | null } {
    return this.#transaction(() => {
      const existing = this.visualSource(videoId);
      const now = new Date().toISOString();
      if (existing) {
        this.#prepare(
          `UPDATE visual_sources SET wanted_revision = ?, state = CASE WHEN state = 'failed' THEN 'pending' ELSE state END, error = NULL,
             updated_at = ? WHERE video_id = ?`,
        ).run(revision, now, videoId);
        return { expectedGeneration: existing.activeGeneration };
      }
      this.#prepare(
        `INSERT INTO visual_sources (video_id, wanted_revision, active_generation, state, error, updated_at) VALUES (?, ?, NULL, 'pending', NULL, ?)`,
      ).run(videoId, revision, now);
      return { expectedGeneration: null };
    });
  }

  markVisualFailed(videoId: Id, revision: string, error: string): void {
    this.#prepare(`UPDATE visual_sources SET state = 'failed', error = ?, updated_at = ? WHERE video_id = ? AND wanted_revision = ?`).run(
      error,
      new Date().toISOString(),
      videoId,
      revision,
    );
  }

  /** 画面世代的发布（同 `publish`：核对版本与世代指针，向量齐了才切换）。 */
  publishVisual(input: PublishVisualInput): PublishResult {
    return this.#transaction((): PublishResult => {
      const source = this.visualSource(input.videoId);
      if (!source) return { published: false, reason: 'gone' };
      if (source.wantedRevision !== input.revision || source.activeGeneration !== input.expectedGeneration) {
        return { published: false, reason: 'stale' };
      }
      const keys = [...new Set(input.frames.map((f) => f.embeddingKey))];
      if (this.embeddings(keys, input.encoderProfileId, input.dims).size !== keys.length) return { published: false, reason: 'missing-vectors' };
      const created = new Date().toISOString();
      const generationId = Number(
        this.#prepare(
          `INSERT INTO generations (video_id, channel, revision, encoder_profile_id, embedding_space_id, dims, chunk_count, state, created_at)
           VALUES (?, 'visual', ?, ?, ?, ?, ?, 'active', ?)`,
        ).run(input.videoId, input.revision, input.encoderProfileId, input.embeddingSpaceId, input.dims, input.frames.length, created)
          .lastInsertRowid,
      );
      const frame = this.#prepare(
        `INSERT INTO visual_frames (generation_id, ord, asset_id, content_hash, source_sec, sequence_sec, embedding_key) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      input.frames.forEach((f, ord) => frame.run(generationId, ord, f.assetId, f.contentHash, f.sourceSec, f.sequenceSec, f.embeddingKey));
      this.#prepare(`UPDATE visual_sources SET active_generation = ?, state = ?, error = NULL, updated_at = ? WHERE video_id = ?`).run(
        generationId,
        input.frames.length > 0 ? 'indexed' : 'empty',
        created,
        input.videoId,
      );
      if (source.activeGeneration !== null) this.#dropGeneration(source.activeGeneration);
      this.#gc();
      return { published: true, generationId };
    });
  }

  /** 这些视频当前发布的画面世代。 */
  activeVisualGenerations(videoIds: readonly Id[]): Map<Id, GenerationRow> {
    const result = new Map<Id, GenerationRow>();
    const statement = this.#prepare(
      `SELECT g.* FROM visual_sources s JOIN generations g ON g.id = s.active_generation WHERE s.video_id = ? AND g.state = 'active'`,
    );
    for (const videoId of videoIds) {
      const row = statement.get(videoId) as unknown as RawGeneration | undefined;
      if (row) result.set(videoId, generationOf(row));
    }
    return result;
  }

  /** 一个画面世代的帧与向量（精确扫描用；向量缺了的帧不出现）。 */
  visualPartition(generationId: number): VisualPartition | null {
    const generation = this.generation(generationId);
    if (!generation || generation.channel !== 'visual') return null;
    const rows = this.#prepare('SELECT * FROM visual_frames WHERE generation_id = ? ORDER BY ord').all(generationId) as unknown as RawFrame[];
    const statement = this.#prepare('SELECT vector FROM embeddings WHERE embedding_key = ?');
    const vectors = new Float32Array(rows.length * generation.dims);
    const frames: StoredFrame[] = [];
    for (const row of rows) {
      const stored = statement.get(row.embedding_key) as { vector: Uint8Array } | undefined;
      if (!stored) continue;
      const vector = toFloat32(stored.vector);
      if (vector.length !== generation.dims) continue;
      vectors.set(vector, frames.length * generation.dims);
      frames.push({
        generationId,
        ord: row.ord,
        assetId: row.asset_id,
        contentHash: row.content_hash,
        sourceSec: row.source_sec,
        sequenceSec: row.sequence_sec,
        embeddingKey: row.embedding_key,
      });
    }
    return { generation, frames, vectors: frames.length === rows.length ? vectors : vectors.slice(0, frames.length * generation.dims) };
  }

  // ---- 向量缓存 ----

  /** 已有的向量（按 embedding_key）。维度或 profile 对不上的不算。 */
  embeddings(keys: readonly string[], encoderProfileId: string, dims: number): Map<string, Float32Array> {
    const found = new Map<string, Float32Array>();
    const statement = this.#prepare('SELECT vector, encoder_profile_id, dims FROM embeddings WHERE embedding_key = ?');
    for (const key of keys) {
      const row = statement.get(key) as { vector: Uint8Array; encoder_profile_id: string; dims: number } | undefined;
      if (!row || row.encoder_profile_id !== encoderProfileId || row.dims !== dims) continue;
      found.set(key, toFloat32(row.vector));
    }
    return found;
  }

  /** 一批验证过的向量（内容寻址，可以在发布之前提交：崩溃后复用）。 */
  putEmbeddings(rows: readonly { key: string; encoderProfileId: string; vector: Float32Array }[]): void {
    if (rows.length === 0) return;
    const insert = this.#prepare(
      'INSERT OR REPLACE INTO embeddings (embedding_key, encoder_profile_id, dims, vector, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    const now = Date.now();
    this.#transaction(() => {
      for (const row of rows) insert.run(row.key, row.encoderProfileId, row.vector.length, toBytes(row.vector), now);
    });
  }

  // ---- 发布 ----

  publish(input: PublishInput): PublishResult {
    return this.#transaction((): PublishResult => {
      const source = this.source(input.videoId);
      if (!source) return { published: false, reason: 'gone' };
      if (source.wantedRevision !== input.revision || source.activeGeneration !== input.expectedGeneration) {
        return { published: false, reason: 'stale' };
      }
      const keys = [...new Set(input.chunks.map((c) => c.embeddingKey))];
      if (this.embeddings(keys, input.encoderProfileId, input.dims).size !== keys.length) return { published: false, reason: 'missing-vectors' };
      const created = new Date().toISOString();
      const generationId = Number(
        this.#prepare(
          `INSERT INTO generations (video_id, channel, revision, encoder_profile_id, embedding_space_id, dims, chunk_count, state, created_at)
           VALUES (?, 'text', ?, ?, ?, ?, ?, 'active', ?)`,
        ).run(input.videoId, input.revision, input.encoderProfileId, input.embeddingSpaceId, input.dims, input.chunks.length, created)
          .lastInsertRowid,
      );
      const chunk = this.#prepare(
        `INSERT OR IGNORE INTO chunks (chunk_id, video_id, document_id, document_kind, evidence_type, sentence_ids, text, speaker, language)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const occurrence = this.#prepare(
        `INSERT OR REPLACE INTO generation_chunks (generation_id, chunk_id, ord, clock, start, "end", chapter_id, chapter_title, embedding_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const c of input.chunks) {
        chunk.run(c.chunkId, c.videoId, c.documentId, c.documentKind, c.evidenceType, JSON.stringify(c.sentenceIds), c.text, c.speaker, c.language);
        occurrence.run(generationId, c.chunkId, c.ord, c.clock, c.start, c.end, c.chapter?.id ?? null, c.chapter?.title ?? null, c.embeddingKey);
      }
      const sentence = this.#prepare(
        `INSERT INTO generation_sentences (generation_id, document_id, document_kind, ord, sentence_ids, text, clock, start, "end", speaker)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const s of input.sentences) {
        sentence.run(generationId, s.documentId, s.documentKind, s.ord, JSON.stringify(s.sentenceIds), s.text, s.clock, s.start, s.end, s.speaker);
      }
      this.#prepare(`UPDATE sources SET active_generation = ?, state = ?, error = NULL, updated_at = ? WHERE video_id = ?`).run(
        generationId,
        input.chunks.length > 0 ? 'indexed' : 'empty',
        created,
        input.videoId,
      );
      if (source.activeGeneration !== null) this.#dropGeneration(source.activeGeneration);
      this.#gc();
      return { published: true, generationId };
    });
  }

  /** 撤下一个世代：标 `retired`，删它的关系行。 */
  #dropGeneration(id: number): void {
    this.#prepare(`UPDATE generations SET state = 'retired' WHERE id = ?`).run(id);
    this.#prepare('DELETE FROM generation_chunks WHERE generation_id = ?').run(id);
    this.#prepare('DELETE FROM generation_sentences WHERE generation_id = ?').run(id);
    this.#prepare('DELETE FROM visual_frames WHERE generation_id = ?').run(id);
    this.#prepare(`DELETE FROM generations WHERE id = ? AND state = 'retired'`).run(id);
  }

  /** 没有世代引用的 chunk 删掉；文字与画面都没有引用、过了宽限期的向量删掉。 */
  #gc(): void {
    this.#prepare('DELETE FROM chunks WHERE chunk_id NOT IN (SELECT chunk_id FROM generation_chunks)').run();
    this.#prepare(
      `DELETE FROM embeddings WHERE created_at < ? AND embedding_key NOT IN (SELECT embedding_key FROM generation_chunks)
         AND embedding_key NOT IN (SELECT embedding_key FROM visual_frames)`,
    ).run(Date.now() - ORPHAN_GRACE_MS);
  }

  // ---- 查询 ----

  generation(id: number): GenerationRow | null {
    const row = this.#prepare(`SELECT * FROM generations WHERE id = ? AND state = 'active'`).get(id) as unknown as RawGeneration | undefined;
    return row ? generationOf(row) : null;
  }

  /** 这些视频当前发布的世代。 */
  activeGenerations(videoIds: readonly Id[]): Map<Id, GenerationRow> {
    const result = new Map<Id, GenerationRow>();
    const statement = this.#prepare(
      `SELECT g.* FROM sources s JOIN generations g ON g.id = s.active_generation WHERE s.video_id = ? AND g.state = 'active'`,
    );
    for (const videoId of videoIds) {
      const row = statement.get(videoId) as unknown as RawGeneration | undefined;
      if (row) result.set(videoId, generationOf(row));
    }
    return result;
  }

  /** 一个世代的全部 chunk（按文档、顺序）。 */
  generationChunks(generationId: number): StoredChunk[] {
    const rows = this.#prepare(
      `SELECT gc.*, c.video_id, c.document_id, c.document_kind, c.evidence_type, c.sentence_ids, c.text, c.speaker, c.language
       FROM generation_chunks gc JOIN chunks c ON c.chunk_id = gc.chunk_id WHERE gc.generation_id = ?
       ORDER BY c.document_kind, c.document_id, gc.ord`,
    ).all(generationId) as unknown as RawChunk[];
    return rows.map(chunkOf);
  }

  /** 一个世代的向量分区（精确扫描用）。 */
  partition(generationId: number): VectorPartition | null {
    const generation = this.generation(generationId);
    if (!generation) return null;
    const chunks = this.generationChunks(generationId);
    const vectors = new Float32Array(chunks.length * generation.dims);
    const statement = this.#prepare('SELECT vector FROM embeddings WHERE embedding_key = ?');
    const kept: StoredChunk[] = [];
    for (const chunk of chunks) {
      const row = statement.get(chunk.embeddingKey) as { vector: Uint8Array } | undefined;
      if (!row) continue;
      const vector = toFloat32(row.vector);
      if (vector.length !== generation.dims) continue;
      vectors.set(vector, kept.length * generation.dims);
      kept.push(chunk);
    }
    return { generation, chunks: kept, vectors: kept.length === chunks.length ? vectors : vectors.slice(0, kept.length * generation.dims) };
  }

  sentences(generationId: number): SentenceRow[] {
    const rows = this.#prepare(
      `SELECT * FROM generation_sentences WHERE generation_id = ? ORDER BY document_kind, document_id, ord`,
    ).all(generationId) as unknown as RawSentence[];
    return rows.map((r) => ({
      documentId: r.document_id,
      documentKind: r.document_kind,
      ord: r.ord,
      sentenceIds: JSON.parse(r.sentence_ids) as string[],
      text: r.text,
      clock: r.clock,
      start: r.start,
      end: r.end,
      speaker: r.speaker,
    }));
  }

  /** 按 chunkId 读（当前发布的世代里的出现）。看不到的视频由调用方先筛掉。 */
  chunksById(chunkIds: readonly string[]): StoredChunk[] {
    const statement = this.#prepare(
      `SELECT gc.*, c.video_id, c.document_id, c.document_kind, c.evidence_type, c.sentence_ids, c.text, c.speaker, c.language
       FROM generation_chunks gc JOIN chunks c ON c.chunk_id = gc.chunk_id
       JOIN sources s ON s.active_generation = gc.generation_id WHERE gc.chunk_id = ?`,
    );
    const out: StoredChunk[] = [];
    for (const id of chunkIds) {
      const row = statement.get(id) as unknown as RawChunk | undefined;
      if (row) out.push(chunkOf(row));
    }
    return out;
  }

  /** 库文件（含 WAL）在磁盘上的大小。 */
  sizeBytes(): number {
    let total = 0;
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        total += fs.statSync(`${this.file}${suffix}`).size;
      } catch {
        // 没有这个旁文件。
      }
    }
    return total;
  }

  /** 清掉全部索引与向量（设置里的「清理」）；暂停状态保留。 */
  clear(): void {
    this.#transaction(() => {
      for (const table of [
        'generation_chunks',
        'generation_sentences',
        'visual_frames',
        'generations',
        'chunks',
        'embeddings',
        'sources',
        'visual_sources',
      ]) {
        this.#db.exec(`DELETE FROM ${table}`);
      }
    });
    // 删行不缩文件：整理一遍并截掉 WAL，「清除」说释放的空间才真的还给磁盘。
    this.#db.exec('VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
  }

  close(): void {
    this.#statements.clear();
    if (this.#db.isOpen) this.#db.close();
  }
}

interface RawSource {
  video_id: string;
  dir: string;
  project_id: string | null;
  wanted_revision: string | null;
  active_generation: number | null;
  state: SourceState;
  error: string | null;
}

interface RawVisualSource {
  video_id: string;
  wanted_revision: string | null;
  active_generation: number | null;
  state: SourceState;
  error: string | null;
}

interface RawFrame {
  generation_id: number;
  ord: number;
  asset_id: string;
  content_hash: string;
  source_sec: number;
  sequence_sec: number | null;
  embedding_key: string;
}

interface RawGeneration {
  id: number;
  video_id: string;
  channel: string;
  revision: string;
  encoder_profile_id: string;
  embedding_space_id: string;
  dims: number;
  chunk_count: number;
}

interface RawChunk {
  generation_id: number;
  chunk_id: string;
  ord: number;
  clock: 'sequence' | 'source';
  start: number;
  end: number;
  chapter_id: string | null;
  chapter_title: string | null;
  embedding_key: string;
  video_id: string;
  document_id: string | null;
  document_kind: SpaceSearchDocumentKind;
  evidence_type: SemanticEvidenceType;
  sentence_ids: string;
  text: string;
  speaker: string | null;
  language: string | null;
}

interface RawSentence {
  document_id: string | null;
  document_kind: SpaceSearchDocumentKind;
  ord: number;
  sentence_ids: string;
  text: string;
  clock: 'sequence' | 'source';
  start: number;
  end: number;
  speaker: string | null;
}

function sourceOf(row: RawSource): SourceRow {
  return {
    videoId: row.video_id,
    dir: row.dir,
    projectId: row.project_id,
    wantedRevision: row.wanted_revision,
    activeGeneration: row.active_generation,
    state: row.state,
    error: row.error,
  };
}

function visualSourceOf(row: RawVisualSource): VisualSourceRow {
  return {
    videoId: row.video_id,
    wantedRevision: row.wanted_revision,
    activeGeneration: row.active_generation,
    state: row.state,
    error: row.error,
  };
}

function generationOf(row: RawGeneration): GenerationRow {
  return {
    id: row.id,
    videoId: row.video_id,
    channel: row.channel === 'visual' ? 'visual' : 'text',
    revision: row.revision,
    encoderProfileId: row.encoder_profile_id,
    embeddingSpaceId: row.embedding_space_id,
    dims: row.dims,
    chunkCount: row.chunk_count,
  };
}

function chunkOf(row: RawChunk): StoredChunk {
  return {
    chunkId: row.chunk_id,
    generationId: row.generation_id,
    videoId: row.video_id,
    documentId: row.document_id,
    documentKind: row.document_kind,
    evidenceType: row.evidence_type,
    sentenceIds: JSON.parse(row.sentence_ids) as string[],
    text: row.text,
    speaker: row.speaker,
    language: row.language,
    ord: row.ord,
    clock: row.clock,
    start: row.start,
    end: row.end,
    chapter: row.chapter_id !== null ? { id: row.chapter_id, title: row.chapter_title ?? '' } : null,
    embeddingKey: row.embedding_key,
  };
}

function toBytes(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

function toFloat32(bytes: Uint8Array): Float32Array {
  // 复制一份：SQLite 给的缓冲区不保证 4 字节对齐。
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}

/** 删掉库文件与 WAL 旁文件（连接要先关上）。 */
export function removeSemanticStore(file: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(`${file}${suffix}`, { force: true });
}
