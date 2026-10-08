/*
 * 输入区的 @ 提及与 / 斜杠命令（原型 model-agent.js `mentionQuery` / `slashQuery` / `slashItems` / `applySlash`）。
 *
 * @ 提及的路径引号规则移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra）
 * packages/app/src/utils/file-mention-autocomplete.ts（`findActiveFileMention`、`formatQuotedFileMentionPath`），modified：
 * 查询改用原型的规则（@ 前面必须是开头或空白，查询里不能有空白与引号）；插入时保留 @ 前缀，只在路径带空白或引号时才加引号。
 */
import { defineMessages, type Id, type SpaceEntry } from '@baocut/protocol';
import { SLASH_COMMANDS, type SlashCommand } from '../copy.ts';
import type { ChapterSpan } from './chapters.ts';
import { zhHans } from './composer-completions.zh-Hans.ts';
import { zhHant } from './composer-completions.zh-Hant.ts';
import { ja } from './composer-completions.ja.ts';
import { ko } from './composer-completions.ko.ts';
import { es } from './composer-completions.es.ts';
import { fr } from './composer-completions.fr.ts';
import { de } from './composer-completions.de.ts';
import { nl } from './composer-completions.nl.ts';
import { ptBR } from './composer-completions.pt-BR.ts';
import { it } from './composer-completions.it.ts';
import { ru } from './composer-completions.ru.ts';
import { pl } from './composer-completions.pl.ts';
import { tr } from './composer-completions.tr.ts';
import { vi } from './composer-completions.vi.ts';
import { KIND_LABEL } from './space.ts';
import { timeStamp } from './transcript-text.ts';

/**
 * @ 候选的文案（英文是键与类型的来源，译文在 `composer-completions.zh-Hans.ts`）。插进正文的引用也随界面语言：
 * 它是用户这条消息的一部分。
 */
const en = {
  chapterN: (n: number) => `Chapter ${n}`,
  chapterRange: (range: string) => `Chapter · ${range}`,
  chapterInsert: (ordinal: string, name: string | null, range: string) => `@${ordinal}${name ? ` ${name}` : ''} (${range})`,
  speaker: 'Speaker',
  speakerInsert: (name: string) => `@Speaker “${name}”`,
};
export type ComposerCompletionsMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 光标前正在输入的那个补全：`raw` 是要被替换掉的原文（含 @ 或 /），`query` 是用来筛选的部分。 */
export interface ActiveCompletion {
  kind: 'slash' | 'mention';
  query: string;
  raw: string;
}

/**
 * 交给 PromptTokenField 的 `completionTrigger`：开头或空白后面的 @ 或 /。它从光标往回找最后一个匹配，
 * 那个位置到光标的文字就是 `filterValue`；真正算不算补全由 `activeCompletion` 决定。
 */
export const COMPLETION_TRIGGER = /(?<=^|\s)[@/]/;

/**
 * 光标前的正文里有没有正在输入的补全。
 * 斜杠命令只认正文**开头**、后面还没敲空格的 /token：它是整句的动词，放中间就成了路径。
 * @ 可以出现在任何位置，但前面得是开头或空白（`a@b.com` 不是提及）。
 */
export function activeCompletion(beforeCaret: string): ActiveCompletion | null {
  const slash = /^\/([^\s/]*)$/.exec(beforeCaret);
  if (slash) return { kind: 'slash', query: slash[1]!, raw: beforeCaret };
  const mention = /(?:^|\s)(@([^\s@"']*))$/.exec(beforeCaret);
  if (mention) return { kind: 'mention', query: mention[2]!, raw: mention[1]! };
  return null;
}

export function slashMatches(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((c) => !q || c.cmd.slice(1).toLowerCase().startsWith(q) || c.label.includes(query));
}

/** 「+」菜单里选斜杠命令：替换正文开头已有的 /token，其余原样接在后面，正文里只多一个 `/xxx `。 */
export function applySlash(text: string, cmd: string): string {
  return `${cmd} ${text.replace(/^\/[^\s/]*\s?/, '')}`;
}

/** 「+」菜单里的「引用」：在末尾放一个 @ 打开候选；前面不是空白就先补一个空格。 */
export function appendMentionAnchor(text: string): string {
  return text && !/\s$/.test(text) ? `${text} @` : `${text}@`;
}

/** 引用插进正文的样子：`@相对路径`；路径带空白或引号时整体加引号，里面的 `"` 转义。 */
export function mentionText(path: string): string {
  return /[\s"']/.test(path) ? `@"${path.replace(/"/g, '\\"')}"` : `@${path}`;
}

export interface MentionCandidate {
  id: Id;
  label: string;
  description: string;
  insert: string;
}

/** 候选的范围：会话所在的项目；不属于项目的会话用它自己的工作目录。都没有（新会话还没选项目）就没有候选。 */
export interface MentionScope {
  projectId: Id | null;
  conversationId: Id | null;
}

/**
 * @ 的候选：Space 目录快照里这个项目（或会话工作目录）下的视频与文件，回收站里的不算。
 * 只引入只读参考，写入目标仍是会话绑定的目录。视频在前，其余按最近活动。眼前打开的视频的章节与说话人见 `videoMentionCandidates`。
 */
export function mentionCandidates(entries: readonly SpaceEntry[], scope: MentionScope, query: string, limit = 20): MentionCandidate[] {
  if (!scope.projectId && !scope.conversationId) return [];
  const q = query.toLowerCase();
  return entries
    .filter((e) => e.user.trashedAt === null)
    .filter((e) => (scope.projectId ? e.source.projectId === scope.projectId : e.source.conversationId === scope.conversationId))
    .filter((e) => !q || e.name.toLowerCase().includes(q) || e.relPath.toLowerCase().includes(q))
    .sort((a, b) => Number(b.kind === 'video') - Number(a.kind === 'video') || b.lastActivityAt.localeCompare(a.lastActivityAt))
    .slice(0, limit)
    .map((e) => ({ id: e.id, label: e.name, description: `${KIND_LABEL[e.kind]} · ${e.relPath}`, insert: mentionText(e.relPath) }));
}

/** 眼前打开的视频里可以 @ 的东西：章节（按起点排）与说话人（转写里出现过的，名字去重）。 */
export interface VideoMentions {
  chapters: readonly Pick<ChapterSpan, 'id' | 'index' | 'label' | 'title' | 'start' | 'end'>[];
  speakers: readonly { id: string; name: string }[];
}

/**
 * @ 候选里「这个视频」那一组（设计稿 model-agent.js `mentionItems` 的章节与说话人）：发给智能体的编辑器上下文里没有章节、
 * 说话人字段，所以插进正文的是一段文字引用——章节带序号、名字与起止时间（`@第 2 章 开场（00:12–01:30）`），智能体凭时间
 * 定位；说话人写成 `@说话人「名字」`。查询匹配名字，也认「章节」「说话人」与「第 N 章」。
 */
export function videoMentionCandidates(mentions: VideoMentions, query: string, limit = 20): MentionCandidate[] {
  const q = query.toLowerCase();
  const hit = (...keys: string[]) => !q || keys.some((key) => key.toLowerCase().includes(q));
  const out: MentionCandidate[] = [];
  for (const chapter of mentions.chapters) {
    const n = chapter.index + 1;
    const ordinal = M.chapterN(n);
    const name = chapter.label.trim();
    // i18n-ignore: 检索关键词，中英两种说法都收，与界面语言无关
    if (!hit(chapter.title, ordinal, `第 ${n} 章`, `第${n}章`, `chapter ${n}`, '章节', 'chapter')) continue;
    const range = `${timeStamp(chapter.start)}–${timeStamp(chapter.end)}`;
    out.push({
      id: `chapter:${chapter.id}`,
      label: chapter.title,
      description: M.chapterRange(range),
      insert: M.chapterInsert(ordinal, name && name !== ordinal ? name : null, range),
    });
  }
  for (const speaker of mentions.speakers) {
    // i18n-ignore: 检索关键词，中英两种说法都收，与界面语言无关
    if (!hit(speaker.name, '说话人', 'speaker')) continue;
    out.push({ id: `speaker:${speaker.id}`, label: speaker.name, description: M.speaker, insert: M.speakerInsert(speaker.name) });
  }
  return out.slice(0, limit);
}
