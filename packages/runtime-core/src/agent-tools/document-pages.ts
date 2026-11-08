/**
 * `documents_read` 的字节预算与分页（架构设计 §3.7「按范围读取」，Agent 面设计 §5.5）。
 *
 * 会话里的智能体与对外的 MCP 服务读文档时，结果不超过预算：一份 22 分钟的转写整份读出约 45 万字节，宿主（Codex 的
 * `exec` 默认 1 万 token、MCP 客户端的单次结果上限）会掐掉中间的大半，智能体只看到首尾、却不知道少了什么。超过预算
 * 时只给一页，标明覆盖范围（`coverage`）与接着读的游标（`nextCursor`），被截断的一页不能当成完整的文档。
 *
 * - **整份（`full`）**：放得下时原样返回，与没有预算时相同。转写按句分页：一页是连续的几句，正文的 `words` 只留这几句
 *   覆盖的那段词（句与句之间、首句之前与末句之后不在句子里的词并进相邻的一页，所有页拼起来不缺词）；读不出句子时按词分页。
 *   别的文档按正文里最大的那个数组分页（字幕的 `cues`、译文的 `units` ……），其余字段每页照给。
 * - **句子（`sentences`）**：只用于转写，不带正文，只给文档头、说话人、`sourceBasis` 与每句的 id、指纹、文本、说话人与
 *   起止秒。翻译、写速览、找句界要的就是这些，一页放得下的句子是整份的十倍左右。没有预算时一次给全部句子。
 * - **游标**：`<视图>.<版本>.<起点>`。游标钉住它读到的版本，接着读的每一页都是同一个版本；视图不能换。
 *
 * 纯函数：读文档、算句子与登记翻译进度由调用方做。
 */

/**
 * 会话与对外服务的单次结果预算（UTF-8 字节）。宿主大致按 4 字节一个 token 估算，结果又会被再转义一次（JSON 套 JSON，
 * 约多 17%）：24 KiB 约 7 千 token，在 Codex `exec` 默认的 1 万 token 之内仍有余量。
 */
export const DOCUMENT_READ_BUDGET_BYTES = 24 * 1024;

export type DocumentReadView = 'full' | 'sentences';

export interface DocumentReadCursor {
  view: DocumentReadView;
  revision: string;
  /** 这一页的第一项：转写是句子的下标（读不出句子时是词的下标），别的文档是分页数组的下标。 */
  from: number;
}

export interface DocumentReadCoverage {
  /** 分页的单位：`sentences`、`words`，或正文里被分页的数组（`body.cues`）。 */
  unit: string;
  /** 这一页是 [from, to)。 */
  from: number;
  to: number;
  total: number;
  /** 整份转写按句分页时，这一页的词是 `body.words` 的 [from, to)。 */
  words?: { from: number; to: number; total: number };
  /** 这一页不是整份。 */
  truncated: boolean;
}

/** 句子视图里的一句。 */
export interface CompactSentence {
  id: string;
  fingerprint: string;
  text: string;
  speaker?: string;
  start: number;
  end: number;
}

type Rec = Record<string, unknown>;

const VIEW_CODE: Record<DocumentReadView, string> = { full: 'f', sentences: 's' };

/** 除去分页的数组，结果里其余的部分之外，再给 `coverage`、`nextCursor` 与 `next` 留的字节。 */
const PAGING_OVERHEAD_BYTES = 1024;

export function encodeCursor(cursor: DocumentReadCursor): string {
  return `${VIEW_CODE[cursor.view]}.${cursor.revision}.${cursor.from}`;
}

/** 认不出时返回 null。 */
export function decodeCursor(text: string): DocumentReadCursor | null {
  const match = /^([fs])\.(\d+)\.(\d+)$/.exec(text);
  if (!match) return null;
  const from = Number(match[3]);
  if (!Number.isSafeInteger(from)) return null;
  return { view: match[1] === 's' ? 'sentences' : 'full', revision: match[2]!, from };
}

export function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? '');
}

/**
 * 从 `from` 起贪心地取项，累计字节不超过 `room`；至少取一项（一项就超过预算时照样给，不让读的人卡住）。返回终点（不含）。
 */
export function pageEnd(sizes: readonly number[], from: number, room: number): number {
  let used = 0;
  let to = from;
  while (to < sizes.length) {
    const next = used + sizes[to]! + 1;
    if (to > from && next > room) break;
    used = next;
    to += 1;
  }
  return to;
}

export interface PageInput {
  /** 整份的读取结果：`{ videoId, document, revision, body, translationBasis? }`。 */
  result: Rec;
  view: DocumentReadView;
  /** 起点（游标的 `from`，没有游标时 0）。 */
  from: number;
  /** 字节预算；null 是不限。 */
  budget: number | null;
  /** 句子 ID → 首词的说话人（`sourceSentences` 的 `speaker`）。只用于句子视图。 */
  speakers?: ReadonlyMap<string, string | undefined>;
}

/**
 * 整份放得下、又不是从游标接着读时返回 null（调用方原样给整份）。别的情况返回这一页。
 */
export function pageDocument(input: PageInput): Rec | null {
  if (input.view === 'sentences') return sentencesPage(input);
  if (input.from === 0 && (input.budget === null || byteLength(input.result) <= input.budget)) return null;
  const body = input.result.body;
  const words = isRecord(body) && Array.isArray(body.words) ? body.words : null;
  const basis = isRecord(input.result.translationBasis) ? input.result.translationBasis : null;
  const sentences = basis && Array.isArray(basis.sentences) ? (basis.sentences as Rec[]) : null;
  if (words && sentences && sentences.length > 0) return speechPage(input, words, basis!, sentences);
  return arrayPage(input);
}

/** 整份转写按句分页：每句连同它覆盖的那段词是一项。 */
function speechPage(input: PageInput, words: unknown[], basis: Rec, sentences: Rec[]): Rec {
  const index = new Map<string, number>();
  words.forEach((word, i) => {
    if (isRecord(word) && typeof word.id === 'string') index.set(word.id, i);
  });
  // 第 i 句的词是 (上一句的末词, 这一句的末词]；最后一句一直到最后一个词。
  const ends: number[] = [];
  let prev = -1;
  sentences.forEach((sentence, i) => {
    const ids = Array.isArray(sentence.wordIds) ? (sentence.wordIds as unknown[]) : [];
    let last = prev;
    for (const id of ids) {
      const at = typeof id === 'string' ? index.get(id) : undefined;
      if (at !== undefined && at > last) last = at;
    }
    if (i === sentences.length - 1) last = words.length - 1;
    ends.push(last);
    prev = last;
  });
  const startOf = (i: number) => (i === 0 ? 0 : ends[i - 1]! + 1);
  const sizes = sentences.map((sentence, i) => {
    let size = byteLength(sentence);
    for (let w = startOf(i); w <= ends[i]!; w += 1) size += byteLength(words[w]) + 1;
    return size;
  });
  const shell = { ...input.result, body: { ...(input.result.body as Rec), words: [] }, translationBasis: { ...basis, sentences: [] } };
  const from = Math.min(input.from, sentences.length);
  const to = pageEnd(sizes, from, room(input.budget, shell));
  const wordFrom = from < sentences.length ? startOf(from) : words.length;
  const wordTo = to > from ? ends[to - 1]! + 1 : wordFrom;
  const coverage: DocumentReadCoverage = {
    unit: 'sentences',
    from,
    to,
    total: sentences.length,
    words: { from: wordFrom, to: wordTo, total: words.length },
    truncated: !(from === 0 && to === sentences.length),
  };
  return withPaging(
    {
      ...input.result,
      body: { ...(input.result.body as Rec), words: words.slice(wordFrom, wordTo) },
      translationBasis: { ...basis, sentences: sentences.slice(from, to) },
    },
    input,
    coverage,
  );
}

/** 句子视图：只给句子，不带正文。 */
function sentencesPage(input: PageInput): Rec {
  const { body, translationBasis, ...header } = input.result;
  const basis = translationBasis as Rec;
  const all = (basis.sentences as Rec[]).map((s): CompactSentence => {
    const speaker = input.speakers?.get(s.id as string);
    return {
      id: s.id as string,
      fingerprint: s.fingerprint as string,
      text: s.text as string,
      ...(speaker ? { speaker } : {}),
      start: s.start as number,
      end: s.end as number,
    };
  });
  const speakers = isRecord(body) && Array.isArray(body.speakers) ? body.speakers : [];
  const shell = { ...header, speakers, translationBasis: { sourceBasis: basis.sourceBasis, sentences: [] } };
  const from = Math.min(input.from, all.length);
  const to = pageEnd(
    all.map((s) => byteLength(s)),
    from,
    room(input.budget, shell),
  );
  const coverage: DocumentReadCoverage = { unit: 'sentences', from, to, total: all.length, truncated: !(from === 0 && to === all.length) };
  return withPaging({ ...shell, translationBasis: { sourceBasis: basis.sourceBasis, sentences: all.slice(from, to) } }, input, coverage);
}

/** 别的文档（以及读不出句子的转写）：按正文里最大的那个数组分页，其余字段照给。没有数组时整份给。 */
function arrayPage(input: PageInput): Rec | null {
  const body = input.result.body;
  let key: string | null = null;
  let largest = -1;
  if (isRecord(body)) {
    for (const [k, value] of Object.entries(body)) {
      if (!Array.isArray(value)) continue;
      const size = byteLength(value);
      if (size > largest) {
        largest = size;
        key = k;
      }
    }
  }
  if (key === null) return input.from === 0 ? null : withPaging(input.result, input, { unit: 'body', from: 0, to: 1, total: 1, truncated: false });
  const items = (body as Rec)[key] as unknown[];
  const shell = { ...input.result, body: { ...(body as Rec), [key]: [] } };
  const from = Math.min(input.from, items.length);
  const to = pageEnd(
    items.map((item) => byteLength(item)),
    from,
    room(input.budget, shell),
  );
  const coverage: DocumentReadCoverage = {
    unit: key === 'words' ? 'words' : `body.${key}`,
    from,
    to,
    total: items.length,
    truncated: !(from === 0 && to === items.length),
  };
  return withPaging({ ...input.result, body: { ...(body as Rec), [key]: items.slice(from, to) } }, input, coverage);
}

function room(budget: number | null, shell: unknown): number {
  if (budget === null) return Number.POSITIVE_INFINITY;
  return budget - byteLength(shell) - PAGING_OVERHEAD_BYTES;
}

function withPaging(page: Rec, input: PageInput, coverage: DocumentReadCoverage): Rec {
  const more = coverage.to < coverage.total;
  const revision = String(input.result.revision);
  const nextCursor = more ? encodeCursor({ view: input.view, revision, from: coverage.to }) : null;
  return { ...page, coverage, ...(nextCursor ? { nextCursor, next: nextOf(input, coverage, nextCursor) } : {}) };
}

/** 给模型的下一步（不翻译）。 */
function nextOf(input: PageInput, coverage: DocumentReadCoverage, cursor: string): string {
  const range = `${coverage.unit} ${coverage.from + 1}-${coverage.to} of ${coverage.total}`;
  const head = `Partial read (revision ${String(input.result.revision)}): this page has ${range}. Call documents_read again with the same documentId and cursor "${cursor}" for the rest, page by page until nextCursor is absent; do not treat this page as the whole document.`;
  const speech = isRecord(input.result.document) && input.result.document.kind === 'speech';
  if (speech && input.view === 'full') {
    return `${head} To translate, summarize, name speakers or find sentence bounds, read with view "sentences" instead: it lists only the sentences and fits about ten times more per page. Read the full view page by page only for word-level work such as polishing.`;
  }
  return head;
}

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
