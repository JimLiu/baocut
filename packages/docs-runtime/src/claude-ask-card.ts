/** claude-ask-card: restored from claudeAskCard-DidJwdgU.js. */
import type { Dynamic } from "./types";
import {
  Bt as isDocumentFocusedElsewhere,
  P as CLAUDE_WRITE_UNAVAILABLE_MESSAGE,
} from "./docs-app";
var CARD_SEND_WINDOW_MS: Dynamic = 5e3;
var CARD_WRITE_ANSWER_MAX_MS: Dynamic = 4e3;
var HANDOFF_SEND_CUTOFF_MS: Dynamic = 3e3;
var KEPT_FOR_UNDO_MS: Dynamic = 10 * 6e4;
var ASK_CARD_IN_MS: Dynamic = 150;
var ASK_CARD_OUT_MS: Dynamic = 300;
var ASK_CARD_WORDS: Dynamic = {
  unsent: `Claude couldn’t start writing. Press Enter in your request to try again.`,
  declined: `This request was declined. Your request is still here.`,
  write_only: `Claude can only write new text here.`,
  spot_gone: `That line changed while Claude was getting ready, so nothing was written. Your request is still here.`,
  late_handoff: `This one goes to Claude as a comment. Press Enter to send it.`,
  too_long: `This request is over the 4,000-character limit. Shorten it, then press Enter.`,
  no_spot: `Claude can’t write on this line. Your request is still here.`,
  run_live: `Claude is still writing another answer. Press Enter when it’s done.`,
  comment_instead: `Claude can’t write here. Press Enter to send this to Claude as a comment instead.`,
  closed: CLAUDE_WRITE_UNAVAILABLE_MESSAGE,
  no_answer: `No answer from Claude yet. Your request is still here.`,
  waiting_on_you: `Claude is waiting for your answer in your session. Your request is still here.`,
  signed_out: `Keep this page open and sign in to Claude again in another tab. Your request is still here.`,
  not_picked_up: `Claude didn’t pick this up in time. Your request is still here.`,
  turn_failed: `Claude didn’t finish. Part of an answer may be in the document, so check it before you ask again.`,
  unconfirmed: `This may still reach Claude, so asking again could send it twice. Your request is still here.`,
  not_accepted: `This request wasn’t accepted. Your request is still here.`,
  usage_limit: `Usage limit reached. Your request is still here.`,
};
var reasonCopyByWord: Dynamic = new (Map as Dynamic)([
  [`unavailable`, ASK_CARD_WORDS.unsent],
  [`signed_out`, ASK_CARD_WORDS.signed_out],
  [`reauth`, ASK_CARD_WORDS.signed_out],
  [`no_listener`, ASK_CARD_WORDS.not_picked_up],
  [`turn_failed`, ASK_CARD_WORDS.turn_failed],
  [`declined`, ASK_CARD_WORDS.declined],
  [`host_declined`, ASK_CARD_WORDS.declined],
  [`unconfirmed`, ASK_CARD_WORDS.unconfirmed],
  [`refused`, ASK_CARD_WORDS.not_accepted],
  [`usage_limit`, ASK_CARD_WORDS.usage_limit],
]);
var ASK_CARD_REASON_WORDS: Dynamic = [...reasonCopyByWord.keys()];
var askCardReasonLine: Dynamic = (
  reason?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  (typeof reason == `string` ? reasonCopyByWord.get(reason) : undefined) ??
  ASK_CARD_WORDS.unsent;
var askCardReasonOf: Dynamic = (
  status?: Dynamic,
  reason?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  status === `not_delivered` || status === `no_listener` || status === `sign_in`
    ? reason
    : undefined;
var lineAfterRunEnd: Dynamic = (
  line?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => (line === ASK_CARD_WORDS.run_live ? null : line);
var sentOnce: Dynamic = (
  card?: Dynamic,
  onTaken?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let settled: Dynamic = false;
  let takeOnce = (..._extraArguments: unknown[]): undefined => {
    if (!settled) {
      settled = true;
      onTaken(card);
    }
  };
  return {
    taken: takeOnce,
    refused: (..._extraArguments: unknown[]): undefined =>
      void (settled = true),
    settled: takeOnce,
  };
};
var askOfCardBody: Dynamic = (
  body?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => body.replace(/^\s*@(?:Claude|Agent)\u2060?\s*/i, ``).trim();
var ASK_UNSENT_TOAST: Dynamic = {
  title: `Your request to Claude wasn’t sent. Copy it to keep it.`,
  label: `Copy`,
};
var resetNotice: Dynamic = (
  state?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  if (
    typeof state != `object` ||
    !state ||
    state.docked !== false ||
    state.gone !== false ||
    state.own !== true ||
    state.mayFocus !== true ||
    state.onSheet !== false ||
    state.entered !== false ||
    typeof state.typed != `string`
  )
    return null;
  let request: Dynamic = askOfCardBody(state.typed);
  return request.replace(/[\s\u200b\u2060\ufeff]/g, ``) === ``
    ? null
    : {
        ...ASK_UNSENT_TOAST,
        text: request,
      };
};
var dockParkedNotice: Dynamic = (
  state?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  if (
    typeof state != `object` ||
    !state ||
    state.gone !== true ||
    typeof state.parked != `string`
  )
    return null;
  let request: Dynamic = askOfCardBody(state.parked);
  return request.replace(/[\s\u200b\u2060\ufeff]/g, ``) === ``
    ? null
    : {
        ...ASK_UNSENT_TOAST,
        text: request,
      };
};
var ASK_UNANSWERED_TOAST: Dynamic = {
  title: `Your request stopped before Claude answered. Copy it to keep it.`,
  label: `Copy`,
};
var resetUnansweredNotice: Dynamic = (
  state?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  if (
    typeof state != `object` ||
    !state ||
    state.docked !== false ||
    state.gone !== false ||
    state.own !== true ||
    state.onSheet !== false ||
    state.inHand !== true ||
    state.quickRoad !== true ||
    state.handoff !== false ||
    state.leaving !== false ||
    typeof state.words != `string`
  )
    return null;
  let request: Dynamic = askOfCardBody(state.words);
  return request.replace(/[\s\u200b\u2060\ufeff]/g, ``) === ``
    ? null
    : {
        ...ASK_UNANSWERED_TOAST,
        text: request,
      };
};
var cardHoldsSentWords: Dynamic = (
  body?: Dynamic,
  sentWords?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  if (typeof body != `string` || typeof sentWords != `string`) return false;
  let normalizeWords: Dynamic = (
    cardHoldsSentWords2?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => askOfCardBody(cardHoldsSentWords2).replace(/\s+/g, ``);
  let words: Dynamic = normalizeWords(body);
  return words !== `` && words === normalizeWords(sentWords);
};
function easeOutKeyboardAt(
  document?: Dynamic,
  card?: Dynamic,
  ..._extraArguments: unknown[]
) {
  if (isDocumentFocusedElsewhere(document)) return `elsewhere`;
  let activeElement: Dynamic = (document as Dynamic).activeElement;
  return activeElement === null || activeElement === (document as Dynamic).body
    ? `nothing`
    : activeElement instanceof (HTMLElement as Dynamic) &&
        activeElement.closest(`[data-inline-ask="${card}"]`) !== null
      ? `card`
      : `elsewhere`;
}
function easeOutTakesKeyboard(
  state?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return state.at !== `card` && state.at !== `nothing`
    ? false
    : state.how === `written` || state.how === `replied`
      ? true
      : state.how === `marked` && state.pageHasFocus === true;
}
function makeAskCardDesk(
  deps?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let sentCard: Dynamic = null;
  let inHandCard: Dynamic = null;
  let keptCards: Dynamic = new (Set as Dynamic)();
  let sentFor: Dynamic = (
    askCardDesk?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    sentCard !== null && sentCard.card === askCardDesk ? sentCard : null;
  let pendingKeyboard: Dynamic = null;
  let releasePendingKeyboard = (
    askCardDesk?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    let pendingKeyboard2: Dynamic = pendingKeyboard;
    if (
      !(
        pendingKeyboard2 === null ||
        (askCardDesk !== null && pendingKeyboard2.card !== askCardDesk)
      )
    ) {
      pendingKeyboard = null;
      pendingKeyboard2.settle.resolve(undefined);
    }
  };
  return {
    sent(
      request?: Dynamic,
      reason?: Dynamic,
      options?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined {
      releasePendingKeyboard(null);
      sentCard?.settle.reject(Error(`superseded`));
      sentCard = {
        card: request,
        words: reason,
        at: deps.now(),
        asked: false,
        taken: false,
        decided: null,
        decidedAt: 0,
        settle: options,
        road: null,
      };
    },
    tell(
      askCardDesk?: Dynamic,
      options?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined {
      let sentFor2: Dynamic = sentFor(askCardDesk);
      if (sentFor2 && !sentFor2.taken) {
        sentFor2.told = options;
      }
    },
    refusedStart(
      askCardDesk?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined {
      let sentFor2: Dynamic = sentFor(askCardDesk);
      if (sentFor2 && !sentFor2.taken) {
        sentFor2.told?.refused();
      }
    },
    verdictWords(
      askCardDesk?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic {
      let sentFor2: Dynamic = sentFor(askCardDesk);
      return !sentFor2 || sentFor2.asked
        ? null
        : ((sentFor2.asked = true), askOfCardBody(sentFor2.words.body));
    },
    decided(
      askCardDesk?: Dynamic,
      options?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined {
      let sentFor2: Dynamic = sentFor(askCardDesk);
      if (!(!sentFor2 || !sentFor2.asked || sentFor2.decided !== null)) {
        sentFor2.decided = options;
        sentFor2.decidedAt = deps.now();
      }
    },
    takeAsk(askCardDesk?: Dynamic, ..._extraArguments: unknown[]): Dynamic {
      let sentFor2: Dynamic = sentFor(askCardDesk);
      return !sentFor2 ||
        sentFor2.decided !== `write` ||
        sentFor2.taken ||
        deps.now() - sentFor2.decidedAt > 5e3
        ? null
        : ((sentFor2.taken = true),
          sentFor2.told?.taken(),
          askOfCardBody(sentFor2.words.body));
    },
    mayClose: (
      askCardDesk?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => {
      let sentFor2: Dynamic = sentFor(askCardDesk);
      return (
        sentFor2 !== null && sentFor2.decided === `write` && sentFor2.taken
      );
    },
    written(askCardDesk?: Dynamic, ..._extraArguments: unknown[]): undefined {
      releasePendingKeyboard(askCardDesk);
      let sentFor2: Dynamic = sentFor(askCardDesk);
      if (sentFor2) {
        inHandCard = {
          card: askCardDesk,
          words: sentFor2.words,
          at: deps.now(),
        };
        sentCard = null;
        sentFor2.settle.resolve(undefined);
      }
    },
    handoff(askCardDesk?: Dynamic, ..._extraArguments: unknown[]): Dynamic {
      let sentFor2: Dynamic = sentFor(askCardDesk);
      return !sentFor2 || sentFor2.decided !== `handoff`
        ? null
        : ((sentCard = null),
          deps.now() - sentFor2.at > 3e3
            ? (sentFor2.settle.reject(Error(`late_handoff`)),
              {
                kind: `late`,
              })
            : {
                kind: `send`,
                words: sentFor2.words,
                settle: sentFor2.settle,
              });
    },
    unsent(
      askCardDesk?: Dynamic,
      options?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic {
      let sentFor2: Dynamic = sentFor(askCardDesk);
      return sentFor2
        ? ((sentCard = null), sentFor2.settle.reject(Error(options)), true)
        : false;
    },
    handedOn(askCardDesk?: Dynamic, ..._extraArguments: unknown[]): Dynamic {
      let sentFor2: Dynamic = sentFor(askCardDesk);
      return sentFor2
        ? ((sentCard = null),
          releasePendingKeyboard(null),
          (pendingKeyboard = {
            card: askCardDesk,
            settle: sentFor2.settle,
          }),
          true)
        : false;
    },
    inHand: (..._extraArguments: unknown[]): Dynamic => sentCard?.card ?? null,
    wordsInHand: (
      askCardDesk?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => sentFor(askCardDesk)?.words.body ?? null,
    handoffInHand: (askCardDesk?: Dynamic, ..._extraArguments: unknown[]) =>
      sentFor(askCardDesk)?.decided === `handoff`,
    road(
      askCardDesk?: Dynamic,
      options?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined {
      let sentFor2: Dynamic = sentFor(askCardDesk);
      if (
        sentFor2 &&
        sentFor2.road === null &&
        (options === `quick` || options === `session`)
      ) {
        sentFor2.road = options;
      }
    },
    roadInHand: (
      askCardDesk?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => sentFor(askCardDesk)?.road ?? null,
    handedAway: (
      askCardDesk?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic =>
      pendingKeyboard !== null && pendingKeyboard.card === askCardDesk,
    answered: (askCardDesk?: Dynamic, ..._extraArguments: unknown[]) =>
      sentFor(askCardDesk)?.taken === true,
    takeKept(askCardDesk?: Dynamic, ..._extraArguments: unknown[]): Dynamic {
      let inHandCard2: Dynamic = inHandCard;
      inHandCard = null;
      return inHandCard2 === null || deps.now() - inHandCard2.at > 6e5
        ? null
        : (keptCards.add(askCardDesk), inHandCard2.words);
    },
    keeps: (..._extraArguments: unknown[]): Dynamic =>
      inHandCard !== null && deps.now() - inHandCard.at <= 6e5,
    mayFocus: (askCardDesk?: Dynamic, ..._extraArguments: unknown[]) =>
      !keptCards.has(askCardDesk),
    touched(askCardDesk?: Dynamic, ..._extraArguments: unknown[]): undefined {
      keptCards.delete(askCardDesk);
    },
    moved(
      askCardDesk?: Dynamic,
      options?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined {
      if (keptCards.delete(askCardDesk)) {
        keptCards.add(options);
      }
    },
    released(askCardDesk?: Dynamic, ..._extraArguments: unknown[]): undefined {
      keptCards.delete(askCardDesk);
    },
    forget(..._extraArguments: unknown[]): undefined {
      inHandCard = null;
      keptCards.clear();
      releasePendingKeyboard(null);
    },
  };
}
export {
  ASK_CARD_IN_MS,
  ASK_CARD_OUT_MS,
  ASK_CARD_REASON_WORDS,
  ASK_CARD_WORDS,
  ASK_UNANSWERED_TOAST,
  ASK_UNSENT_TOAST,
  CARD_SEND_WINDOW_MS,
  CARD_WRITE_ANSWER_MAX_MS,
  HANDOFF_SEND_CUTOFF_MS,
  KEPT_FOR_UNDO_MS,
  askCardReasonLine,
  askCardReasonOf,
  askOfCardBody,
  cardHoldsSentWords,
  dockParkedNotice,
  easeOutKeyboardAt,
  easeOutTakesKeyboard,
  lineAfterRunEnd,
  makeAskCardDesk,
  resetNotice,
  resetUnansweredNotice,
  sentOnce,
};
