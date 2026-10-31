import { z } from 'zod';
import { AGENT_MODES } from './access.ts';
import { BOT_LIMITS } from './bot.ts';
import { DRIVER_ID_PATTERN } from './domain.ts';

/** Bot 方法（docs/design/bot-mode 技术方案 §16.1）的入站校验，由 `schemas.ts` 并进方法表。 */

const id = z.string().min(1).max(200);
const empty = z.object({}).strict();
const driverId = z.string().regex(DRIVER_ID_PATTERN);
const agentMode = z.enum(AGENT_MODES);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const iso = z.string().min(10).max(40);
const money = z.object({ amount: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/), currency: z.string().regex(/^[A-Z]{3}$/) }).strict();
const lang = z.string().min(2).max(35).regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const resourceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('video'), projectId: id, videoId: id }).strict(),
  z.object({ kind: z.literal('file'), path: z.string().min(1).max(4096) }).strict(),
  z.object({ kind: z.literal('space'), entryId: id }).strict(),
  z.object({ kind: z.literal('doc'), id }).strict(),
  z.object({ kind: z.literal('slides'), id }).strict(),
  z.object({ kind: z.literal('design'), id }).strict(),
  z.object({ kind: z.literal('message'), conversationId: id, itemId: id }).strict(),
  z
    .object({
      kind: z.literal('video-range'),
      projectId: id,
      videoId: id,
      startMs: z.number().int().nonnegative(),
      endMs: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ kind: z.literal('work-item'), workItemId: id }).strict(),
]);

export const evidenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('export'), projectId: id, videoId: id, exportId: id }).strict(),
  z.object({ kind: z.literal('job'), jobId: id, attempt: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('video-version'), projectId: id, videoId: id, version: z.string().min(1).max(40) }).strict(),
  z.object({ kind: z.literal('past-date'), date: day }).strict(),
]);

const owner = z.enum(['agent', 'user']);

export const workItemTemplateSchema = z
  .object({
    title: z.string().trim().min(1).max(BOT_LIMITS.title),
    description: z.string().max(BOT_LIMITS.description),
    owner,
    prompt: z.string().max(BOT_LIMITS.brief),
    resources: z.array(resourceRefSchema).max(BOT_LIMITS.resources),
    accessMode: agentMode.nullable().optional(),
  })
  .strict();
const priority = z.enum(['high', 'medium', 'low']);

const userEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accept'), start: z.boolean(), owner: owner.optional(), title: z.string().min(1).max(BOT_LIMITS.title).optional() }).strict(),
  z.object({ type: z.literal('dismiss') }).strict(),
  z.object({ type: z.literal('schedule'), startAt: iso }).strict(),
  z.object({ type: z.literal('unschedule') }).strict(),
  z.object({ type: z.literal('start') }).strict(),
  z.object({ type: z.literal('resolve'), evidence: z.null(), confirmedBy: id.optional() }).strict(),
  z.object({ type: z.literal('reopen') }).strict(),
  z.object({ type: z.literal('set-owner'), owner }).strict(),
  z.object({ type: z.literal('unblocked'), cause: z.string().min(1).max(40) }).strict(),
]);

const overrides = z
  .object({
    accessMode: agentMode.nullable(),
    driverId: driverId.nullable(),
    model: z.string().max(200).nullable(),
    budget: money.nullable(),
    outputLanguage: lang.nullable(),
  })
  .strict();

const channelPatch = z
  .object({
    name: z.string().trim().min(1).max(BOT_LIMITS.channelName).optional(),
    purpose: z.string().max(BOT_LIMITS.channelPurpose).optional(),
    driverId: driverId.optional(),
    model: z.string().max(200).nullable().optional(),
    effort: z.string().max(100).nullable().optional(),
    defaultAccessMode: agentMode.nullable().optional(),
    maxAccessMode: agentMode.nullable().optional(),
    pinned: z.boolean().optional(),
    muted: z.boolean().optional(),
    private: z.boolean().optional(),
    outputLanguage: lang.nullable().optional(),
    stallMinutes: z.number().int().min(5).max(24 * 60).nullable().optional(),
    concurrentThreads: z.number().int().min(1).max(BOT_LIMITS.maxConcurrentThreads).optional(),
    dailyBudget: money.nullable().optional(),
    monthlyBudget: money.nullable().optional(),
    unwantedKinds: z.array(z.string().min(1).max(60)).max(50).optional(),
  })
  .strict();

const settingsPatch = z
  .object({
    timeZone: z.string().min(1).max(64).nullable().optional(),
    quietHours: z.object({ start: clock, end: clock, enabled: z.boolean() }).strict().optional(),
    stallMinutes: z.number().int().min(5).max(24 * 60).optional(),
    maxConcurrentThreads: z.number().int().min(1).max(20).optional(),
    background: z.boolean().optional(),
    openAtLogin: z.boolean().optional(),
    automationPaused: z.boolean().optional(),
  })
  .strict();

export const BOT_PARAM_SCHEMAS = {
  'channels.list': empty,
  'channels.ensureMain': empty,
  'channels.create': z
    .object({
      name: z.string().trim().min(1).max(BOT_LIMITS.channelName),
      purpose: z.string().max(BOT_LIMITS.channelPurpose).optional(),
      templateId: z.string().max(200).nullable().optional(),
      driverId: driverId.optional(),
      model: z.string().max(200).nullable().optional(),
      effort: z.string().max(100).nullable().optional(),
      defaultAccessMode: agentMode.nullable().optional(),
      outputLanguage: lang.nullable().optional(),
      commandId: id.optional(),
    })
    .strict(),
  'channels.update': z.object({ id, patch: channelPatch }).strict(),
  'channels.archive': z.object({ id }).strict(),
  'channels.unarchive': z.object({ id }).strict(),
  'channels.delete': z
    .object({ id, confirm: z.object({ threads: z.number().int().nonnegative(), schedules: z.number().int().nonnegative() }).strict() })
    .strict(),
  'channels.readMemory': z.object({ id }).strict(),
  'channels.writeMemory': z
    .object({ id, content: z.string().max(BOT_LIMITS.channelMemoryBytes * 2), ifVersion: z.number().int().nonnegative() })
    .strict(),
  'channels.markSeen': z.object({ id, itemId: id.nullable() }).strict(),
  'channels.export': z.object({ id, dir: z.string().min(1).max(4096) }).strict(),
  'bot.readUserMemory': empty,
  'bot.writeUserMemory': z.object({ content: z.string().max(BOT_LIMITS.userMemoryBytes * 2), ifVersion: z.number().int().nonnegative() }).strict(),
  'bot.settings': z.object({ patch: settingsPatch.optional() }).strict(),
  'workItems.list': z.object({ channelId: id, status: z.enum(['suggested', 'upNext', 'scheduled', 'active', 'resolved']).optional() }).strict(),
  'workItems.get': z.object({ id }).strict(),
  'workItems.create': z
    .object({
      channelId: id,
      title: z.string().trim().min(1).max(BOT_LIMITS.title),
      owner,
      description: z.string().max(BOT_LIMITS.description).optional(),
      priority: priority.optional(),
      dueOn: day.nullable().optional(),
      start: z.boolean().optional(),
      commandId: id.optional(),
    })
    .strict(),
  'workItems.update': z
    .object({
      id,
      patch: z
        .object({
          title: z.string().trim().min(1).max(BOT_LIMITS.title).optional(),
          description: z.string().max(BOT_LIMITS.description).optional(),
          priority: priority.optional(),
          dueOn: day.nullable().optional(),
          eventOn: day.nullable().optional(),
          resources: z.array(resourceRefSchema).max(BOT_LIMITS.resources).optional(),
          dependsOn: z.array(id).max(20).optional(),
          overrides: overrides.nullable().optional(),
        })
        .strict(),
    })
    .strict(),
  'workItems.transition': z.object({ id, event: userEvent }).strict(),
  'workItems.stop': z.object({ id }).strict(),
  'workItems.redirect': z.object({ id, text: z.string().trim().min(1).max(20_000), oldWork: z.enum(['stop', 'keep']) }).strict(),
  'workItems.refresh': z.object({ id }).strict(),
  'workItems.move': z.object({ id, toChannelId: id }).strict(),
  'workItems.revertAll': z.object({ id, dryRun: z.boolean().optional(), keepUserEdits: z.boolean().optional() }).strict(),
  'workItems.deleteRecord': z
    .object({ id, dryRun: z.boolean().optional(), confirm: z.object({ files: z.array(z.string().max(4096)).max(10_000) }).strict().optional() })
    .strict(),
  'bot.proposals.respond': z
    .object({
      conversationId: id,
      itemId: id,
      accept: z.boolean(),
      edits: z
        .object({ name: z.string().trim().min(1).max(BOT_LIMITS.channelName).optional(), purpose: z.string().max(BOT_LIMITS.channelPurpose).optional() })
        .strict()
        .optional(),
    })
    .strict(),
  'bot.make.run': z.object({ channelId: id }).strict(),
  'bot.react': z.object({ conversationId: id, itemId: id, emoji: z.string().min(1).max(16) }).strict(),
  'bot.status': empty,
  'bot.awaySummary': z.object({ channelId: id }).strict(),
  'bot.inbox': empty,
  'bot.pauseAutomation': z.object({ paused: z.boolean() }).strict(),
  'conversations.editMessage': z.object({ conversationId: id, itemId: id, text: z.string().min(1).max(100_000) }).strict(),
};
