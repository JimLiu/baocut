/** claude-session-run: restored from claudeSessionRun-Cac6Hcdt.js. */
import type {
  RowWhose,
  EnvelopeRelation,
  SessionEnd,
  UntiedReason,
  GoneRoad,
  DiffEnvelope,
  SessionRun,
  DetachedRun,
  SessionDependencies,
  SessionRuns,
} from "./type-models/session";
import type { UnknownRecord } from "./type-models/common";
import { _ as askIsEmpty, j as envelopeWritesNothing } from "./docs-app";
var SESSION_RUN_MAX_MS = 6e5;
var SESSION_REPLY_GRACE_MS = 5e3;
var SESSION_OTHERS_GRACE_MS = 8e3;
var SESSION_OVER_GRACE_MS = 1e4;
var EMPTY_LINE_HASH = `e3b0c442`;
var SESSION_ROUTE_FENCE = `Replace that line only with ifHash e3b0c442, never with force; if refused, write below it.`;
var SESSION_ROUTE_ORDER = `If empty, replace that line.`;
var SESSION_ROUTE_PIN = `If empty, replace that line. Replace that line only with ifHash e3b0c442, never with force; if refused, write below it.`;
var SESSION_CARRIER_INSTRUCTION = `If the marked line is no longer empty, leave what is on it exactly as it is and write directly below it. If empty, replace that line. Replace that line only with ifHash e3b0c442, never with force; if refused, write below it. Write your answer directly in the document at the marked empty line, for a request to write or change something and for a question alike, and do not reply in this thread:`;
function carrierBodyOf(body: string): string {
  let mention = /^\s*@(?:Claude|Agent)\u2060?\s*/i.exec(body);
  let prefix = mention ? mention[0].trimEnd() : ``;
  let request = (mention ? body.slice(mention[0].length) : body).trim();
  return `${prefix === `` ? `` : prefix + ` `}${SESSION_CARRIER_INSTRUCTION}\n\n${request}`;
}
function carrierPostOf<
  Post extends {
    body: string;
  },
>(
  post: Post,
): Post & {
  quiet: true;
  summonText: string;
} {
  return {
    ...post,
    quiet: true,
    summonText: carrierBodyOf(post.body),
  };
}
var askWordsOf = (body: string): string =>
  body.replace(/^\s*@(?:Claude|Agent)\u2060?\s*/i, ``).trim();
var SESSION_ROUTE_INSTRUCTION = `Write your answer directly in the document at the marked line (the block this page names in blockId), whether the request asks you to write or change something or asks a question: a question's answer is written into the document at that line too, never in a comment thread and never only as a chat reply. If empty, replace that line. Replace that line only with ifHash e3b0c442, never with force; if refused, write below it.`;
function envelopeNamesBlock(
  envelope: unknown,
  bid: string,
  isOtherId: (id: string) => boolean,
): EnvelopeRelation {
  let visited = 0;
  let hasOtherId = false;
  let visit: (value: unknown, depth: number) => boolean = (
    envelopeNamesBlock2,
    options,
  ) => {
    if (options > 14 || (visited += 1) > 2e4) return false;
    if (typeof envelopeNamesBlock2 == `string`)
      return envelopeNamesBlock2 === bid
        ? true
        : (isOtherId(envelopeNamesBlock2) && (hasOtherId = true), false);
    if (Array.isArray(envelopeNamesBlock2))
      return envelopeNamesBlock2.some((askIsEmpty2) =>
        visit(askIsEmpty2, options + 1),
      );
    if (typeof envelopeNamesBlock2 == `object` && envelopeNamesBlock2) {
      for (let [
        envelopeNamesBlockResult,
        envelopeNamesBlockResult2,
      ] of Object.entries(envelopeNamesBlock2))
        if (
          !(
            envelopeNamesBlockResult === `actor` ||
            envelopeNamesBlockResult === `address`
          ) &&
          (envelopeNamesBlockResult === bid ||
            visit(envelopeNamesBlockResult2, options + 1))
        )
          return true;
    }
    return false;
  };
  return visit(envelope, 0) ? `named` : hasOtherId ? `others` : `none`;
}
var ROW_WHOSE: readonly RowWhose[] = [`m`, `o`, `u`];
var GONE_ROAD: readonly GoneRoad[] = [`q`, `d`];
var SESSION_GONE_NEAR_MS = 1e4;
var isKnownRowWhose = (whose: unknown): whose is RowWhose =>
  whose === `m` || whose === `o` || whose === `u`;
var USER_ROW_ID_PATTERN = /^u_[A-Za-z0-9_-]{1,120}$/;
function whoseRow(attribution: unknown): RowWhose {
  if (typeof attribution !== "object" || !attribution) return "u";
  const value = attribution as UnknownRecord;
  if (
    value.via !== "mcp" ||
    typeof value.writer !== "string" ||
    typeof value.viewer !== "string" ||
    !USER_ROW_ID_PATTERN.test(value.writer) ||
    !USER_ROW_ID_PATTERN.test(value.viewer)
  )
    return "u";
  return value.writer === value.viewer ? "m" : "o";
}
function envelopeCommentsOutside(
  envelope: DiffEnvelope | null | undefined,
  nodeId: string | null,
): boolean {
  let diff = envelope?.diff;
  return nodeId === null || nodeId === `` || !Array.isArray(diff)
    ? false
    : diff.some((SESSIONRUNMAXMS) => {
        let SESSIONRUNMAXMS2 = SESSIONRUNMAXMS;
        let ref = SESSIONRUNMAXMS2?.address?.ref;
        let after = SESSIONRUNMAXMS2?.after;
        return ref?.object !== `utterance` ||
          typeof ref.id != `string` ||
          ref.id === nodeId ||
          typeof after != `object` ||
          !after ||
          typeof after.body != `string` ||
          after.body === `` ||
          (after.kind !== undefined && after.kind !== `message`)
          ? false
          : !(
              after.parent?.object === `utterance` && after.parent.id === nodeId
            );
      });
}
function envelopeOnOtherNode(
  envelope: DiffEnvelope | null | undefined,
  nodeId: string,
): boolean {
  let diff = envelope?.diff;
  return nodeId === `` || !Array.isArray(diff)
    ? false
    : diff.some((SESSIONRUNMAXMS) => {
        let ref = SESSIONRUNMAXMS?.address?.ref;
        return (
          ref?.object === `node` &&
          typeof ref.id == `string` &&
          ref.id !== nodeId
        );
      });
}
function makeSessionRuns<Card, Handle, Kind = string>(
  deps: SessionDependencies<Card, Handle, Kind>,
): SessionRuns<Card, Kind> {
  let currentRun: SessionRun<Card, Handle, Kind> | null = null;
  let detachedRun: DetachedRun<Card, Kind> | null = null;
  let lastRun: number | null = null;
  let goneRoad: (run: SessionRun<Card, Handle, Kind>) => GoneRoad | null = (
    sessionRuns,
  ) =>
    sessionRuns.emptiedAt !== null && deps.now() - sessionRuns.emptiedAt <= 1e4
      ? `d`
      : sessionRuns.untied === `queued_row`
        ? `q`
        : null;
  let finishRun: (
    run: SessionRun<Card, Handle, Kind>,
    reason: SessionEnd,
  ) => void = (ask, options) => {
    if (currentRun !== ask) return;
    currentRun = null;
    deps.clearTimeout(ask.maxTimer);
    deps.clearTimeout(ask.graceTimer);
    deps.clearTimeout(ask.overTimer);
    deps.clearTimeout(ask.othersTimer);
    let untied =
      (options === `ended` || options === `timeout`) &&
      ask.delivered &&
      ask.untied !== null
        ? ask.untied
        : undefined;
    detachedRun =
      options === `stopped` ||
      ((options === `timeout` || options === `failed` || options === `ended`) &&
        ask.threadId !== null)
        ? {
            card: ask.card,
            bid: ask.bid,
            kind: ask.kind,
            threadId: ask.threadId,
            carrierP: ask.carrierP,
            how: options,
            delivered: ask.delivered,
            takenBack: ask.takenBack && ask.repliedAt === null,
            startedAt: ask.startedAt,
            lateSaid: false,
            untiedSaid: untied !== undefined,
            why: ask.why,
          }
        : null;
    try {
      let goneRoad2 = options === `gone` ? goneRoad(ask) : null;
      deps.said?.(
        options,
        ask.threadId,
        deps.now() - ask.startedAt,
        ask.kind,
        untied,
        ...(options === `written` && ask.whose !== null
          ? [ask.whose]
          : goneRoad2 === null
            ? []
            : [goneRoad2]),
      );
    } catch {}
    deps.ended(
      ask.card,
      options,
      ask.threadId,
      ask.delivered,
      options !== `written` || ask.sure,
    );
  };
  let createRun: (
    card: Card,
    bid: string | null,
    kind: Kind | null,
    threadId: string | null,
    carrier: Promise<string>,
    delivered: boolean,
  ) => SessionRun<Card, Handle, Kind> = (
    sessionRuns,
    options,
    context,
    dependencies,
    argument,
    argument2,
  ) => {
    let ask: SessionRun<Card, Handle, Kind> = {
      whose: null,
      emptiedAt: null,
      card: sessionRuns,
      bid: options,
      kind: context,
      threadId: dependencies,
      startedAt: deps.now(),
      repliedAt: null,
      overAt: null,
      othersAt: null,
      othersTimer: undefined,
      sure: true,
      delivered: argument2,
      takenBack: false,
      untied: null,
      why: undefined,
      maxTimer: undefined,
      graceTimer: undefined,
      overTimer: undefined,
      carrierP: argument,
    };
    currentRun = ask;
    ask.maxTimer = deps.setTimeout(
      () => finishRun(ask, `timeout`),
      SESSION_RUN_MAX_MS,
    );
    watchCarrier(ask);
    return ask;
  };
  let kindOfThread: (card: Card) => Kind | null = (sessionRuns) => {
    try {
      return deps.kindOf?.(sessionRuns) ?? null;
    } catch {
      return null;
    }
  };
  let threadIsQueued: (threadId: string | null) => boolean = (sessionRuns) => {
    if (sessionRuns === null) return false;
    try {
      return deps.queued?.(sessionRuns) === true;
    } catch {
      return false;
    }
  };
  let runIsQueued: (run: SessionRun<Card, Handle, Kind>) => boolean = (ask) =>
    threadIsQueued(ask.threadId);
  let watchCarrier: (run: SessionRun<Card, Handle, Kind>) => void = (ask) => {
    ask.carrierP.then(
      (result) => {
        if (
          currentRun !== ask &&
          detachedRun !== null &&
          detachedRun.carrierP === ask.carrierP &&
          detachedRun.threadId === null &&
          result !== ``
        ) {
          detachedRun = {
            ...detachedRun,
            threadId: result,
          };
        }
        if (currentRun === ask) {
          if (result === ``) return finishRun(ask, `failed`);
          ask.threadId = result;
        }
      },
      () => finishRun(ask, `failed`),
    );
  };
  return {
    live: () => currentRun?.card ?? null,
    threadOf: (sessionRuns) =>
      currentRun !== null && currentRun.card === sessionRuns
        ? currentRun.threadId
        : null,
    start(sessionRuns, options) {
      return currentRun !== null && currentRun.card === sessionRuns
        ? `joined`
        : (currentRun !== null && finishRun(currentRun, `reset`),
          (detachedRun = null),
          createRun(
            sessionRuns,
            options,
            kindOfThread(sessionRuns),
            null,
            deps.carrier(sessionRuns),
            false,
          ),
          `started`);
    },
    resume(sessionRuns) {
      let detachedRun2 = detachedRun;
      return detachedRun2 === null ||
        detachedRun2.card !== sessionRuns ||
        currentRun !== null ||
        detachedRun2.how === `failed` ||
        detachedRun2.how === `ended` ||
        (detachedRun2.how === `timeout` && !detachedRun2.delivered) ||
        detachedRun2.takenBack
        ? false
        : ((detachedRun = null),
          createRun(
            sessionRuns,
            detachedRun2.bid,
            detachedRun2.kind,
            detachedRun2.threadId,
            detachedRun2.carrierP,
            detachedRun2.delivered,
          ),
          true);
    },
    join(sessionRuns, options, context) {
      return currentRun === null
        ? ((detachedRun = null),
          createRun(
            sessionRuns,
            options,
            kindOfThread(sessionRuns),
            null,
            context,
            false,
          ),
          true)
        : false;
    },
    lateAccepted(sessionRuns, options, context) {
      return currentRun === null
        ? ((detachedRun = {
            card: sessionRuns,
            bid: options,
            kind: kindOfThread(sessionRuns),
            threadId: context,
            carrierP: Promise.resolve(context),
            how: `timeout`,
            delivered: true,
            takenBack: false,
            startedAt: deps.now(),
            lateSaid: false,
            untiedSaid: false,
          }),
          true)
        : false;
    },
    unfail(sessionRuns, options) {
      let detachedRun2 = detachedRun;
      return detachedRun2 === null ||
        detachedRun2.card !== sessionRuns ||
        detachedRun2.threadId !== options ||
        detachedRun2.how !== `failed` ||
        currentRun !== null
        ? false
        : ((detachedRun = {
            ...detachedRun2,
            how: `timeout`,
            delivered: true,
            takenBack: false,
          }),
          true);
    },
    retryable(sessionRuns) {
      let detachedRun2 = detachedRun;
      return (
        detachedRun2 !== null &&
        detachedRun2.card === sessionRuns &&
        currentRun === null &&
        detachedRun2.threadId !== null &&
        (detachedRun2.takenBack ||
          ((detachedRun2.how === `failed` || detachedRun2.how === `timeout`) &&
            !detachedRun2.delivered) ||
          detachedRun2.how === `ended`)
      );
    },
    retry(sessionRuns) {
      let detachedRun2 = detachedRun;
      return detachedRun2 === null ||
        detachedRun2.threadId === null ||
        !this.retryable(sessionRuns)
        ? false
        : ((detachedRun = null),
          createRun(
            sessionRuns,
            detachedRun2.bid,
            detachedRun2.kind,
            detachedRun2.threadId,
            detachedRun2.carrierP,
            false,
          ),
          deps.resummon(sessionRuns, detachedRun2.threadId),
          true);
    },
    lineIs(sessionRuns, options) {
      if (
        currentRun !== null &&
        currentRun.card === sessionRuns &&
        currentRun.bid === null
      ) {
        currentRun.bid = options;
      }
    },
    agentWrote(sessionRuns = `named`, options) {
      let currentRun2 = currentRun;
      if (currentRun2 === null) return;
      let options2 = isKnownRowWhose(options) ? options : null;
      if (runIsQueued(currentRun2))
        return void (currentRun2.untied = `queued_row`);
      currentRun2.delivered = true;
      if (sessionRuns !== `others` || currentRun2.bid === null)
        return void ((currentRun2.whose = options2),
        finishRun(currentRun2, `written`));
      if (currentRun2.othersAt === null) {
        currentRun2.whose = options2;
        currentRun2.othersAt = deps.now();
        deps.clearTimeout(currentRun2.overTimer);
        currentRun2.othersTimer = deps.setTimeout(() => {
          if (runIsQueued(currentRun2)) {
            currentRun2.untied = `queued_row`;
            currentRun2.othersAt = null;
            currentRun2.whose = null;
            currentRun2.othersTimer = undefined;
            if (currentRun2.overAt !== null && currentRun2.repliedAt === null) {
              currentRun2.overTimer = deps.setTimeout(
                () => finishRun(currentRun2, `ended`),
                SESSION_OVER_GRACE_MS,
              );
            }
            return;
          }
          currentRun2.sure = false;
          finishRun(currentRun2, `written`);
        }, SESSION_OTHERS_GRACE_MS);
      }
    },
    agentWroteElsewhere() {
      if (
        currentRun !== null &&
        (currentRun.untied === null || currentRun.untied === `comment_row`)
      ) {
        currentRun.untied = runIsQueued(currentRun)
          ? `queued_row`
          : `elsewhere`;
      }
    },
    agentEmptiedLine(sessionRuns) {
      if (typeof sessionRuns == `number` && Number.isFinite(sessionRuns)) {
        if (lastRun !== null && sessionRuns <= lastRun) return;
        lastRun = sessionRuns;
      }
      if (currentRun !== null) {
        currentRun.emptiedAt = deps.now();
      }
    },
    agentCommentedElsewhere() {
      if (currentRun !== null) {
        currentRun.untied ??= `comment_row`;
      }
    },
    lateHeard(sessionRuns) {
      let detachedRun2 = detachedRun;
      if (
        !(
          detachedRun2 === null ||
          detachedRun2.card !== sessionRuns ||
          (detachedRun2.how !== `ended` && detachedRun2.how !== `timeout`) ||
          detachedRun2.lateSaid ||
          detachedRun2.untiedSaid
        )
      ) {
        detachedRun = {
          ...detachedRun2,
          lateSaid: true,
        };
        try {
          deps.saidLate?.(
            detachedRun2.threadId,
            deps.now() - detachedRun2.startedAt,
            detachedRun2.kind,
          );
        } catch {}
      }
    },
    heardAfterStop(sessionRuns, options) {
      let detachedRun2 = detachedRun;
      return detachedRun2 === null || detachedRun2.card !== sessionRuns
        ? true
        : threadIsQueued(detachedRun2.threadId)
          ? false
          : (detachedRun2.takenBack &&
              detachedRun2.how === `stopped` &&
              (detachedRun = {
                ...detachedRun2,
                takenBack: false,
              }),
            true);
    },
    delivered(sessionRuns) {
      let currentRun2 = currentRun;
      if (!(currentRun2 === null || currentRun2.threadId !== sessionRuns)) {
        currentRun2.delivered = true;
        if (currentRun2.overAt !== null) {
          deps.clearTimeout(currentRun2.overTimer);
          currentRun2.overTimer = undefined;
          currentRun2.overAt = null;
          currentRun2.takenBack = true;
        }
      }
    },
    lineOf: () => currentRun?.bid ?? null,
    spotGone(sessionRuns) {
      let currentRun2 = currentRun;
      if (currentRun2 === null || currentRun2.card !== sessionRuns) return;
      let matchesOthersAt =
        currentRun2.othersAt !== null && !runIsQueued(currentRun2);
      if (matchesOthersAt) {
        currentRun2.sure = false;
      }
      finishRun(currentRun2, matchesOthersAt ? `written` : `gone`);
    },
    threadSaid(requestId, word, details) {
      let currentRun2 = currentRun;
      if (!(currentRun2 === null || currentRun2.threadId !== requestId)) {
        if (word === `refused`) {
          currentRun2.delivered = false;
          currentRun2.why = typeof details == `string` ? details : undefined;
          return finishRun(currentRun2, `failed`);
        }
        currentRun2.delivered = true;
        if (word === `over`) {
          if (
            currentRun2.overAt !== null ||
            currentRun2.repliedAt !== null ||
            ((currentRun2.overAt = deps.now()), currentRun2.othersAt !== null)
          )
            return;
          currentRun2.overTimer = deps.setTimeout(
            () => finishRun(currentRun2, `ended`),
            SESSION_OVER_GRACE_MS,
          );
          return;
        }
        if (currentRun2.repliedAt === null) {
          currentRun2.repliedAt = deps.now();
          deps.clearTimeout(currentRun2.overTimer);
          deps.clearTimeout(currentRun2.othersTimer);
          currentRun2.graceTimer = deps.setTimeout(
            () => finishRun(currentRun2, `replied`),
            SESSION_REPLY_GRACE_MS,
          );
        }
      }
    },
    failedWhy: (sessionRuns, options) =>
      detachedRun !== null &&
      detachedRun.card === sessionRuns &&
      detachedRun.threadId === options &&
      detachedRun.how === `failed`
        ? detachedRun.why
        : undefined,
    forget(sessionRuns) {
      if (detachedRun !== null && detachedRun.card === sessionRuns) {
        detachedRun = null;
      }
    },
    stop(sessionRuns) {
      if (currentRun !== null && currentRun.card === sessionRuns) {
        finishRun(currentRun, `stopped`);
      }
    },
    mark(sessionRuns) {
      let currentRun2 = currentRun;
      if (
        currentRun2 === null ||
        currentRun2.card !== sessionRuns ||
        currentRun2.threadId === null ||
        currentRun2.threadId.startsWith(`route:`) ||
        currentRun2.bid === null ||
        currentRun2.repliedAt !== null ||
        currentRun2.overAt !== null ||
        currentRun2.othersAt !== null
      )
        return null;
      let ask = {
        card: currentRun2.card,
        bid: currentRun2.bid,
        kind: currentRun2.kind,
        threadId: currentRun2.threadId,
        startedAt: currentRun2.startedAt,
      };
      finishRun(currentRun2, `marked`);
      return ask;
    },
    reset() {
      if (currentRun !== null) {
        finishRun(currentRun, `reset`);
      }
    },
  };
}
export {
  EMPTY_LINE_HASH,
  GONE_ROAD,
  ROW_WHOSE,
  SESSION_CARRIER_INSTRUCTION,
  SESSION_GONE_NEAR_MS,
  SESSION_OTHERS_GRACE_MS,
  SESSION_OVER_GRACE_MS,
  SESSION_REPLY_GRACE_MS,
  SESSION_ROUTE_FENCE,
  SESSION_ROUTE_INSTRUCTION,
  SESSION_ROUTE_ORDER,
  SESSION_ROUTE_PIN,
  SESSION_RUN_MAX_MS,
  askIsEmpty,
  askWordsOf,
  carrierBodyOf,
  carrierPostOf,
  envelopeCommentsOutside,
  envelopeNamesBlock,
  envelopeOnOtherNode,
  envelopeWritesNothing,
  makeSessionRuns,
  whoseRow,
};
