/** platform-lazy: restored from app-lazy-CIsA5Djd.js. */
import type { Dynamic } from "../interop/legacy-dynamic";
import type * as ReactComponentTypes from "react";

/* Subsystem: unavailable-pages */
export const UnavailablePage: ReactComponentTypes.FC<unknown | undefined> = (
  unavailablePage,
) => {
  return <FrameUnavailable what={`This page`} />;
};

export const SpreadsheetUnavailablePage: ReactComponentTypes.FC<unknown | undefined> = (
  spreadsheetUnavailablePage,
) => {
  return <FrameUnavailable what={`A spreadsheet`} />;
};

/* Subsystem: version-xml */
const mapPreloadDependencies: Dynamic = (
  ..._extraArguments: unknown[]
): Dynamic => [];
import {
  createLiveModuleNamespace,
  toModuleNamespace,
} from "../boot/module-runtime";
import {
  ackOf,
  api,
  closeHistory,
  collectPlatformApiAndAuthJoin,
  collectPlatformApiAndAuthVerb,
  CommentsStoreBigQuery,
  CommentsStoreHealth,
  create,
  Decoration,
  DecorationSet,
  EditorAnchorsAndMentionsLfileTypeahead,
  EditorChipsAndNodeViewsCode,
  EditorExtensionsAskClaude,
  EditorExtensionsBlue2,
  EditorExtensionsFrameSendError,
  EditorHostMermaid,
  EditorHostMessage10,
  EditorHostSans,
  EditorHostState,
  EditorHostState2,
  EditorHostStyles13,
  EditorSelectionAndTablesMaster167,
  Extension,
  filterDataContentAndReferencesFilter,
  filterEditorExtensionsFilter,
  frameBlobBytesResult,
  frameEnumRows,
  FrameUnavailable,
  getDataOperationControlKeys,
  isEditorExtensionsFrom5,
  liveDoor,
  loadJsxRuntime,
  loadPlatformApiAndAuthMethod2,
  loadPlatformApiAndAuthRoomsEnabled,
  loadPlatformLiveDocumentAndHistoryRef,
  loadPlatformSessionAndSourcesAckOf,
  loadPlatformSessionAndSourcesFrameVersionTable,
  loadReact,
  PlatformApiAndAuthState7,
  PlatformLiveDocumentAndHistoryCurrent,
  PlatformLiveDocumentAndHistoryDENIED,
  PlatformLiveDocumentAndHistoryDETAILSUNAVAILABLE,
  PlatformLiveDocumentAndHistoryMALFORMED,
  PlatformLiveDocumentAndHistoryTIMEOUT,
  platformSessionAndSourcesPattern9,
  Plugin,
  PluginKey,
  QUICK_EMOJI,
  rawReq,
  resolveCommentsStoreCharCodeAt,
  resolveCommentsStoreTrim2,
  resolveDataModelSchemasFrame,
  resolveDataModelSchemasReplace,
  resolveDataOperationControlDetail,
  resolveDataOperationControlLevel2,
  resolveDataOperationEngineKind2,
  resolveDataOperationEngineTrim,
  resolveEditorAnchorsAndMentionsEmail,
  resolveEditorAnchorsAndMentionsEscape,
  resolveEditorAnchorsAndMentionsGrid2,
  resolveEditorAnchorsAndMentionsKind,
  resolveEditorAnchorsAndMentionsSplit,
  resolveEditorAnchorsAndMentionsStyle,
  resolveEditorAnchorsAndMentionsValue3,
  resolveEditorExtensionsAnchor2,
  resolveEditorExtensionsDelete,
  resolveEditorExtensionsEntries,
  resolveEditorExtensionsNoun,
  resolveEditorExtensionsNoun2,
  resolveEditorExtensionsSome3,
  resolveEditorExtensionsValue25,
  resolveEditorExtensionsValue6,
  resolveEditorExtensionsValue8,
  resolveEditorExtensionsValue9,
  resolveEditorExtensionsYellow3,
  resolveEditorHostDocumentElement,
  resolveEditorHostDocumentElement2,
  resolveEditorHostGetPropertyValue,
  resolveEditorHostIsInteger,
  resolveEditorHostValue,
  resolveEditorSelectionAndTablesValue11,
  resolvePlatformAnnouncementsValue,
  resolvePlatformApiAndAuthHuman,
  resolvePlatformApiAndAuthValue,
  resolvePlatformApiAndAuthXBongoUniverse,
  resolvePlatformKeyboardAndSaveStatusFind,
  resolvePlatformLiveDocumentAndHistoryAllow,
  resolvePlatformLiveDocumentAndHistoryLocal,
  resolvePlatformLiveDocumentAndHistoryNode4,
  resolvePlatformLiveDocumentAndHistoryNode5,
  resolvePlatformLiveDocumentAndHistoryParams,
  resolvePlatformLiveDocumentAndHistoryParams2,
  resolvePlatformLiveDocumentAndHistoryRev,
  resolvePlatformLiveDocumentAndHistorySchedule,
  resolvePlatformLiveDocumentAndHistoryValue32,
  resolvePlatformLiveDocumentAndHistoryValue33,
  resolvePlatformSessionAndSourcesAbandoned,
  resolvePlatformSessionAndSourcesData,
  resolvePlatformSessionAndSourcesFrozen,
  resolvePlatformSessionAndSourcesFrozen2,
  resolvePlatformSessionAndSourcesName,
  resolvePlatformSessionAndSourcesNode,
  resolvePlatformSessionAndSourcesUnavailable,
  resolvePlatformSessionAndSourcesVerb,
  resolvePlatformSessionAndSourcesVerb2,
  resolvePlatformSessionAndSourcesVerb3,
  resolvePlatformSyncAndRoutingIsFinite3,
  resolvePlatformSyncAndRoutingPath3,
  Selection,
  subscribeProjectFeed,
  TextSelection,
  updateCommentsStoreUser,
  updatePlatformLiveDocumentAndHistoryFinally,
  updatePlatformSyncAndRoutingDirectory,
  updatePlatformSyncAndRoutingPreparing,
  updatePlatformSyncAndRoutingStats,
  useContainerStore,
  usePlatformFeatureFlagsUseSyncExternalStore,
  useWorkbookStore,
} from "./index";
import { isFrameArtifact } from "../boot/environment";
import { preloadModule } from "../boot/preload";
var React: Dynamic = toModuleNamespace(loadReact(), 1);
var useVersionHistoryPanelStore: Dynamic = create(
  (
    versionHistoryPanelStore?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => ({
    openOn: null,
    fromFunctions: false,
    open: (
      versionHistoryPanelStore2?: Dynamic,
      options?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic =>
      versionHistoryPanelStore({
        openOn: versionHistoryPanelStore2 ?? ``,
        fromFunctions: !!options?.fromFunctions,
      }),
  }),
);
var isHistoryResponseObject: Dynamic = (
  historyResponseObject?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  typeof historyResponseObject == `object` &&
  !!historyResponseObject &&
  !Array.isArray(historyResponseObject);
var FrameHistoryStaleView: Dynamic = class extends Error {
  [key: string]: Dynamic;
  code: Dynamic = `STALE_VIEW`;
  asked: Dynamic;
  got: Dynamic;
  constructor(
    frameHistoryStaleView?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ) {
    super(
      `version history: the answer is not the version asked for (asked ${frameHistoryStaleView}, got ${options ?? `none`})`,
    );
    this.name = `FrameHistoryStaleView`;
    this.asked = frameHistoryStaleView;
    this.got = options;
  }
};
var FrameHistorySuperseded: Dynamic = class extends Error {
  [key: string]: Dynamic;
  code: Dynamic = `SUPERSEDED`;
  constructor(frameHistorySuperseded?: Dynamic, ..._extraArguments: unknown[]) {
    super(`version history: no longer wanted (view@${frameHistorySuperseded})`);
    this.name = `FrameHistorySuperseded`;
  }
};
var HISTORY_RETRY_DELAY_MS: number = 1e3;
var isHistoryRequestWanted: Dynamic = (
  historyRequestWanted?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  historyRequestWanted.wanted === undefined || historyRequestWanted.wanted();
var combineHistoryRequestObservers: Dynamic = (
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => ({
  wanted: (..._extraArguments: unknown[]): Dynamic =>
    items.length === 0 || items.some(isHistoryRequestWanted),
  slow: (..._extraArguments: unknown[]): undefined => {
    for (let combineHistoryRequestObserversResult of items as Dynamic)
      combineHistoryRequestObserversResult.slow?.();
  },
});
var isRetryableHistoryRead: Dynamic = (
  error?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  error instanceof (PlatformLiveDocumentAndHistoryTIMEOUT as Dynamic) ||
  (error instanceof (EditorExtensionsFrameSendError as Dynamic) &&
    (error.code === `TIMEOUT` || error.code === `RESET_STORM`));
var DECIMAL_PATTERN: Dynamic = /^\d+$/;
var findViewNode: Dynamic = (
  node?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  for (let node2 of node.children as Dynamic) {
    if (typeof node2 == `string`) continue;
    if (node2.attrs.id === options) return node2;
    let findViewNode2: Dynamic = node2.children.length
      ? findViewNode(node2, options)
      : null;
    if (findViewNode2) return findViewNode2;
  }
  return null;
};
async function readHistoryViewWithRetry(
  scheduler?: Dynamic,
  options?: Dynamic,
  payload?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let readHistoryViewWithRetryHandler: Dynamic = async (
    ..._extraArguments: unknown[]
  ): Promise<Dynamic> =>
    resolvePlatformLiveDocumentAndHistoryAllow(
      `view`,
      await resolvePlatformLiveDocumentAndHistorySchedule(
        scheduler,
        dependencies,
        scheduler.door.call(`read`, {
          ref: resolvePlatformLiveDocumentAndHistoryNode4(options),
          payload: payload,
        }),
      ),
    );
  try {
    return await readHistoryViewWithRetryHandler();
  } catch (readHistoryViewWithRetryResult: Dynamic) {
    if (!isRetryableHistoryRead(readHistoryViewWithRetryResult))
      throw readHistoryViewWithRetryResult;
    argument.slow();
    await new (Promise as Dynamic)(
      (resolve?: Dynamic, ..._extraArguments: unknown[]): undefined => {
        scheduler.schedule(resolve, HISTORY_RETRY_DELAY_MS);
      },
    );
    if (!argument.wanted())
      throw new (FrameHistorySuperseded as Dynamic)(
        typeof payload.atRev == `number` ? payload.atRev : `head`,
      );
    return readHistoryViewWithRetryHandler();
  }
}
function parseHistoryView(
  historyView?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let parseHistoryViewHandler = (
    historyView2?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (context === `head`) return;
    let historyView3: Dynamic = historyView2.find(
      (item?: Dynamic, ..._extraArguments: unknown[]) => item !== context,
    );
    if (historyView3 !== undefined)
      throw new (FrameHistoryStaleView as Dynamic)(
        context,
        typeof historyView3 == `number` ? historyView3 : undefined,
      );
  };
  let filteredOptions: Dynamic = options.filter(
    (option?: Dynamic, ..._extraArguments: unknown[]) => option !== undefined,
  );
  parseHistoryViewHandler(filteredOptions);
  if (historyView === undefined || typeof historyView.doc != `string`)
    throw new (PlatformLiveDocumentAndHistoryMALFORMED as Dynamic)(`view doc`);
  let tree: Dynamic;
  try {
    tree = filterEditorExtensionsFilter(historyView.doc);
  } catch {
    throw new (PlatformLiveDocumentAndHistoryMALFORMED as Dynamic)(`view doc`);
  }
  let rev: Dynamic = tree.attrs.rev;
  let items: Dynamic =
    rev === undefined ? [] : [DECIMAL_PATTERN.test(rev) ? Number(rev) : rev];
  parseHistoryViewHandler(items);
  let rev2: Dynamic;
  if (context === `head`) {
    let items2: Dynamic = [...filteredOptions, ...items];
    let itemItem: Dynamic = items2[0];
    if (
      typeof itemItem != `number` ||
      items2.some(
        (item?: Dynamic, ..._extraArguments: unknown[]) => item !== itemItem,
      )
    )
      throw new (PlatformLiveDocumentAndHistoryMALFORMED as Dynamic)(
        `head rev`,
      );
    rev2 = itemItem;
  } else {
    if (filteredOptions.length === 0 && items.length === 0)
      throw new (FrameHistoryStaleView as Dynamic)(context, undefined);
    rev2 = context;
  }
  let next: Dynamic =
    isHistoryResponseObject(historyView.next) &&
    typeof historyView.next.from == `string` &&
    historyView.next.from
      ? historyView.next
      : undefined;
  return {
    tree: tree,
    rev: rev2,
    ...(next
      ? {
          next: next,
        }
      : {}),
  };
}
async function readHistoryViewPage(
  historyViewPage?: Dynamic,
  options?: Dynamic,
  atRev?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let historyViewWithRetry: Dynamic = await readHistoryViewWithRetry(
    historyViewPage,
    options,
    atRev === `head`
      ? {
          ...dependencies,
          kind: `view`,
        }
      : {
          ...dependencies,
          kind: `view`,
          atRev: atRev,
        },
    `view@${atRev}`,
    argument,
  );
  let data: Dynamic = isHistoryResponseObject(historyViewWithRetry.data)
    ? historyViewWithRetry.data
    : undefined;
  return parseHistoryView(data, [historyViewWithRetry.rev, data?.rev], atRev);
}
async function readRemainingHistoryViewPages(
  remainingHistoryViewPages?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let tree: Dynamic = context.tree;
  let rev: Dynamic = context.rev;
  let next: Dynamic = context.next;
  for (let index: number = 0; next !== undefined; index++) {
    if (index >= 64)
      throw new (PlatformLiveDocumentAndHistoryMALFORMED as Dynamic)(
        `view pages`,
      );
    if (!dependencies.wanted())
      throw new (FrameHistorySuperseded as Dynamic)(rev);
    let from: Dynamic = next.from;
    let parentId: Dynamic =
      typeof next.parentId == `string` && next.parentId ? next.parentId : null;
    let children: Dynamic = (
      parentId === null ? tree : findViewNode(tree, parentId)
    )?.children.find(
      (
        remainingHistoryViewPages2?: Dynamic,
        ..._extraArguments: unknown[]
      ): boolean =>
        typeof remainingHistoryViewPages2 != `string` &&
        remainingHistoryViewPages2.name === `gap` &&
        remainingHistoryViewPages2.attrs.cap !== undefined,
    );
    if (children === undefined)
      throw new (PlatformLiveDocumentAndHistoryMALFORMED as Dynamic)(
        `view cursor`,
      );
    children.attrs.from = from;
    let historyViewPage: Dynamic = await readHistoryViewPage(
      remainingHistoryViewPages,
      options,
      rev,
      next,
      dependencies,
    );
    if (
      !isEditorExtensionsFrom5(
        tree,
        {
          from: from,
          parentId: parentId,
          blocks: null,
        },
        historyViewPage.tree,
      )
    )
      throw new (PlatformLiveDocumentAndHistoryMALFORMED as Dynamic)(
        `view page`,
      );
    next = historyViewPage.next;
  }
  if (resolveEditorExtensionsSome3(tree))
    throw new (PlatformLiveDocumentAndHistoryMALFORMED as Dynamic)(
      `view incomplete`,
    );
  if (tree.attrs.complete !== undefined) {
    tree.attrs.complete = `1`;
  }
  return {
    xml: resolveEditorExtensionsEntries(tree),
    rev: rev,
  };
}
async function readCompleteHistoryView(
  completeHistoryView?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  return readRemainingHistoryViewPages(
    completeHistoryView,
    options,
    await readHistoryViewPage(
      completeHistoryView,
      options,
      context,
      undefined,
      dependencies,
    ),
    dependencies,
  );
}
var historyXmlCache: Dynamic = new (Map as Dynamic)();
var historyXmlCacheScope: string = ``;
var historyXmlCacheLane: Dynamic;
var historyXmlScopeKey = (
  page?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) => `${page.pid}/${page.fileId}/${options}`;
var isHistoryXmlScopeCurrent: Dynamic = (
  historyXmlScopeCurrent?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  historyXmlCacheScope ===
    historyXmlScopeKey(historyXmlScopeCurrent, options) &&
  historyXmlCacheLane === historyXmlScopeCurrent.lane;
function ensureHistoryXmlCacheScope(
  ensureHistoryXmlCacheScope2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (!isHistoryXmlScopeCurrent(ensureHistoryXmlCacheScope2, options)) {
    historyXmlCache.clear();
    historyXmlCacheScope = historyXmlScopeKey(
      ensureHistoryXmlCacheScope2,
      options,
    );
    historyXmlCacheLane = ensureHistoryXmlCacheScope2.lane;
  }
  return historyXmlCache;
}
function touchHistoryXmlCache(
  touchHistoryXmlCache2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  historyXmlCache.delete(touchHistoryXmlCache2);
  historyXmlCache.set(touchHistoryXmlCache2, options);
  for (let touchHistoryXmlCacheResult of historyXmlCache.keys() as Dynamic) {
    if (historyXmlCache.size <= 6) break;
    historyXmlCache.delete(touchHistoryXmlCacheResult);
  }
}
function cacheHistoryXmlRequest(
  cacheHistoryXmlRequest2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let record: Dynamic = {
    xml: Promise.resolve(``),
    settled: false,
    asks: [options],
  };
  record.xml = context(combineHistoryRequestObservers(record.asks)).then(
    (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic => (
      (record.settled = true),
      (record.asks = []),
      result
    ),
    (result?: Dynamic, ..._extraArguments: unknown[]): undefined => {
      throw (
        historyXmlCache.get(cacheHistoryXmlRequest2) === record &&
          historyXmlCache.delete(cacheHistoryXmlRequest2),
        result
      );
    },
  );
  touchHistoryXmlCache(cacheHistoryXmlRequest2, record);
  return record;
}
function fetchHistoryXmlAtRevision(
  fetchHistoryXml?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  let ensureHistoryXmlCacheScopeEntry: Dynamic = ensureHistoryXmlCacheScope(
    fetchHistoryXml,
    options,
  ).get(context);
  return ensureHistoryXmlCacheScopeEntry === undefined
    ? cacheHistoryXmlRequest(
        context,
        dependencies,
        async (
          fetchHistoryXml2?: Dynamic,
          ..._extraArguments: unknown[]
        ): Promise<Dynamic> =>
          (
            await readCompleteHistoryView(
              fetchHistoryXml,
              options,
              context,
              fetchHistoryXml2,
            )
          ).xml,
      ).xml
    : (ensureHistoryXmlCacheScopeEntry.settled ||
        ensureHistoryXmlCacheScopeEntry.asks.push(dependencies),
      touchHistoryXmlCache(context, ensureHistoryXmlCacheScopeEntry),
      ensureHistoryXmlCacheScopeEntry.xml);
}
function fetchHistoryXmlPair(
  fetchHistoryXmlPair2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return Promise.all([
    fetchHistoryXmlAtRevision(fetchHistoryXmlPair2, options, context, argument),
    fetchHistoryXmlAtRevision(
      fetchHistoryXmlPair2,
      options,
      dependencies,
      argument,
    ),
  ]);
}
function readLaneHeadRevision(
  laneHeadRevision?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): number | undefined {
  let record: Dynamic = laneHeadRevision.lane?.read({
    object: `node`,
    id: options,
  });
  if (!isHistoryResponseObject(record)) return;
  let view: Dynamic = isHistoryResponseObject(record.view)
    ? record.view
    : undefined;
  return [record.rev, view?.rev].find(
    (item?: Dynamic, ..._extraArguments: unknown[]) => typeof item == `number`,
  );
}
async function fetchHistoryHeadXml(
  fetchHistoryHeadXml2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let ensureHistoryXmlCacheScope2: Dynamic = ensureHistoryXmlCacheScope(
    fetchHistoryHeadXml2,
    options,
  );
  let rev: Dynamic = readLaneHeadRevision(fetchHistoryHeadXml2, options);
  let ensureHistoryXmlCacheScopeEntry: Dynamic =
    rev === undefined ? undefined : ensureHistoryXmlCacheScope2.get(rev);
  if (rev !== undefined && ensureHistoryXmlCacheScopeEntry !== undefined) {
    if (!ensureHistoryXmlCacheScopeEntry.settled) {
      ensureHistoryXmlCacheScopeEntry.asks.push(context);
    }
    touchHistoryXmlCache(rev, ensureHistoryXmlCacheScopeEntry);
    return {
      xml: await ensureHistoryXmlCacheScopeEntry.xml,
      rev: rev,
    };
  }
  let completeHistoryView: Dynamic = await readCompleteHistoryView(
    fetchHistoryHeadXml2,
    options,
    `head`,
    combineHistoryRequestObservers([context]),
  );
  if (
    isHistoryXmlScopeCurrent(fetchHistoryHeadXml2, options) &&
    !historyXmlCache.has(completeHistoryView.rev)
  ) {
    touchHistoryXmlCache(completeHistoryView.rev, {
      xml: Promise.resolve(completeHistoryView.xml),
      settled: true,
      asks: [],
    });
  }
  return completeHistoryView;
}
async function fetchHistoryRevisionDocuments(
  fetchHistoryRevisionDocuments2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  resolvePlatformLiveDocumentAndHistoryLocal(
    fetchHistoryRevisionDocuments2,
    `view`,
  );
  let fetchHistoryRevisionDocumentsResult: Dynamic =
    await loadPlatformLiveDocumentAndHistoryRef(fetchHistoryRevisionDocuments2);
  if (options.prevRev === undefined)
    return {
      xml: await fetchHistoryXmlAtRevision(
        fetchHistoryRevisionDocuments2,
        fetchHistoryRevisionDocumentsResult,
        options.rev,
        options,
      ),
      prevXml: null,
    };
  let [xml, prevXml]: Dynamic = await fetchHistoryXmlPair(
    fetchHistoryRevisionDocuments2,
    fetchHistoryRevisionDocumentsResult,
    options.rev,
    options.prevRev,
    options,
  );
  return {
    xml: xml,
    prevXml: prevXml,
  };
}
async function fetchHistoryHeadDocument(
  fetchHistoryHeadDocument2?: Dynamic,
  options: Dynamic = {},
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  resolvePlatformLiveDocumentAndHistoryLocal(fetchHistoryHeadDocument2, `view`);
  return fetchHistoryHeadXml(
    fetchHistoryHeadDocument2,
    await loadPlatformLiveDocumentAndHistoryRef(fetchHistoryHeadDocument2),
    options,
  );
}
async function fetchHistoryComparisonDocuments(
  fetchHistoryComparisonDocuments2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  resolvePlatformLiveDocumentAndHistoryLocal(
    fetchHistoryComparisonDocuments2,
    `view`,
  );
  let fetchHistoryComparisonDocumentsResult: Dynamic =
    await loadPlatformLiveDocumentAndHistoryRef(
      fetchHistoryComparisonDocuments2,
    );
  let fetchHistoryHeadXml2: Dynamic = await fetchHistoryHeadXml(
    fetchHistoryComparisonDocuments2,
    fetchHistoryComparisonDocumentsResult,
    options,
  );
  let prevXml: Dynamic = await fetchHistoryXmlAtRevision(
    fetchHistoryComparisonDocuments2,
    fetchHistoryComparisonDocumentsResult,
    options.rev,
    options,
  );
  return {
    xml: fetchHistoryHeadXml2.xml,
    prevXml: prevXml,
    head: fetchHistoryHeadXml2.rev,
  };
}
async function prewarmHistoryRevisionDocuments(
  prewarmHistoryRevisionDocuments2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<undefined> {
  resolvePlatformLiveDocumentAndHistoryLocal(
    prewarmHistoryRevisionDocuments2,
    `view`,
  );
  let prewarmHistoryRevisionDocumentsResult: Dynamic =
    await loadPlatformLiveDocumentAndHistoryRef(
      prewarmHistoryRevisionDocuments2,
    );
  let laneHeadRevision: Dynamic = readLaneHeadRevision(
    prewarmHistoryRevisionDocuments2,
    prewarmHistoryRevisionDocumentsResult,
  );
  let option: Dynamic = options.find(
    (option2?: Dynamic, ..._extraArguments: unknown[]) =>
      option2.rev !== laneHeadRevision,
  );
  if (option === undefined) return;
  let ensureHistoryXmlCacheScope2: Dynamic = ensureHistoryXmlCacheScope(
    prewarmHistoryRevisionDocuments2,
    prewarmHistoryRevisionDocumentsResult,
  );
  for (let prewarmHistoryRevisionDocumentsResult2 of (option.prevRev ===
  undefined
    ? [option.rev]
    : [option.rev, option.prevRev]) as Dynamic)
    if (
      !ensureHistoryXmlCacheScope2.has(prewarmHistoryRevisionDocumentsResult2)
    )
      try {
        await fetchHistoryXmlAtRevision(
          prewarmHistoryRevisionDocuments2,
          prewarmHistoryRevisionDocumentsResult,
          prewarmHistoryRevisionDocumentsResult2,
          {},
        );
      } catch {
        return;
      }
}
var versionXmlModule: Dynamic = createLiveModuleNamespace({
  fetchHeadXml: (..._extraArguments: unknown[]): Dynamic => fetchHeadXml,
  fetchVersionPreviewDocs: (..._extraArguments: unknown[]): Dynamic =>
    fetchVersionPreviewDocs,
  fetchVersionXml: (..._extraArguments: unknown[]): Dynamic => fetchVersionXml,
  fetchVersionXmlAtRev: (..._extraArguments: unknown[]): Dynamic =>
    fetchVersionXmlAtRev,
  isCurrentRow: (..._extraArguments: unknown[]): Dynamic => isCurrentRow,
  prewarmNewestVersion: (..._extraArguments: unknown[]): Dynamic =>
    prewarmNewestVersion,
  sideOf: (..._extraArguments: unknown[]): Dynamic => sideOf,
});
function sideOf(side?: Dynamic, ..._extraArguments: unknown[]): Dynamic {
  if (typeof side != `string`)
    return {
      doc: side.doc,
      runs: side.runs ?? [],
    };
  let sideOfResult: Dynamic = resolveEditorExtensionsValue25(side);
  return {
    doc: sideOfResult.docJson,
    runs: sideOfResult.blocks,
  };
}
var versionPreviewRequests: Dynamic = new (Map as Dynamic)();
async function fetchVersionPreviewDocs(
  pid?: Dynamic,
  fileId?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument: Dynamic = `previous`,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  if (!isFrameArtifact())
    throw Error(
      `version history: the structured preview is served inside a Frame only`,
    );
  let { rev: rev, prevRev: prevRev }: Dynamic =
    dependencies ??
    resolvePlatformLiveDocumentAndHistoryRev(pid, fileId, context);
  if (rev === undefined)
    throw new (PlatformLiveDocumentAndHistoryDETAILSUNAVAILABLE as Dynamic)(
      `shown`,
    );
  let label: string = `viewxml ${argument} ${pid}/${fileId} ${rev} ${prevRev ?? ``}`;
  let label2: string = `${pid}/${fileId}`;
  versionPreviewRequests.set(label2, label);
  updatePlatformSyncAndRoutingPreparing(false);
  let wanted = (..._extraArguments: unknown[]) =>
    versionPreviewRequests.get(label2) === label;
  let slow = (..._extraArguments: unknown[]): undefined => {
    if (wanted()) {
      updatePlatformSyncAndRoutingPreparing(true);
    }
  };
  try {
    let {
      xml: fetchVersionPreviewDocsResult,
      prevXml: fetchVersionPreviewDocsResult2,
    }: Dynamic = await updatePlatformLiveDocumentAndHistoryFinally(
      label,
      (..._extraArguments: unknown[]): Dynamic =>
        argument === `current`
          ? fetchHistoryComparisonDocuments(
              resolvePlatformLiveDocumentAndHistoryValue33({
                pid: pid,
                fileId: fileId,
              }),
              {
                rev: rev,
                wanted: wanted,
                slow: slow,
              },
            )
          : fetchHistoryRevisionDocuments(
              resolvePlatformLiveDocumentAndHistoryValue33({
                pid: pid,
                fileId: fileId,
              }),
              {
                rev: rev,
                prevRev: prevRev,
                wanted: wanted,
                slow: slow,
              },
            ),
    );
    let sideOf2: Dynamic = sideOf(fetchVersionPreviewDocsResult);
    let sideOf3: Dynamic =
      fetchVersionPreviewDocsResult2 === null
        ? null
        : sideOf(fetchVersionPreviewDocsResult2);
    return {
      doc: sideOf2.doc,
      prevDoc: sideOf3 === null ? null : sideOf3.doc,
      runs: sideOf2.runs,
      prevRuns: sideOf3 === null ? null : sideOf3.runs,
    };
  } finally {
    if (wanted()) {
      updatePlatformSyncAndRoutingPreparing(false);
    }
  }
}
async function fetchVersionXml(
  fetchVersionXml2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  if (!isFrameArtifact())
    throw Error(
      `version history: a version's document is served inside a Frame only`,
    );
  if (isCurrentRow(fetchVersionXml2, options, context))
    return fetchHeadXml(fetchVersionXml2, options);
  let rev: Dynamic =
    dependencies?.rev ??
    resolvePlatformLiveDocumentAndHistoryRev(fetchVersionXml2, options, context)
      .rev;
  if (rev === undefined)
    throw new (PlatformLiveDocumentAndHistoryDETAILSUNAVAILABLE as Dynamic)(
      `copied`,
    );
  return fetchVersionXmlAtRev(fetchVersionXml2, options, rev);
}
function isCurrentRow(
  currentRow?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return resolvePlatformLiveDocumentAndHistoryValue32(currentRow, options).some(
    (item?: Dynamic, ..._extraArguments: unknown[]): boolean =>
      item.params.upto === context &&
      resolvePlatformLiveDocumentAndHistoryParams(item) === `current`,
  );
}
async function fetchHeadXml(
  pid?: Dynamic,
  fileId?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  if (!isFrameArtifact())
    throw Error(
      `version history: a version's document is served inside a Frame only`,
    );
  let fetchHeadXmlResult: Dynamic =
    resolvePlatformLiveDocumentAndHistoryValue33({
      pid: pid,
      fileId: fileId,
    });
  let fetchHeadXmlHandler: Dynamic = (
    fetchHeadXml2?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    updatePlatformLiveDocumentAndHistoryFinally(
      `viewxml head ${pid}/${fileId} @${fetchHeadXml2 ?? `?`}`,
      (..._extraArguments: unknown[]): Dynamic =>
        fetchHistoryHeadDocument(fetchHeadXmlResult),
    );
  let fetchHeadXmlHandler2: Dynamic = await fetchHeadXmlHandler(
    resolvePlatformLiveDocumentAndHistoryNode5(fetchHeadXmlResult),
  );
  let fetchHeadXmlResult2: Dynamic =
    resolvePlatformLiveDocumentAndHistoryNode5(fetchHeadXmlResult);
  return fetchHeadXmlResult2 !== undefined &&
    fetchHeadXmlHandler2.rev < fetchHeadXmlResult2
    ? (await fetchHeadXmlHandler(fetchHeadXmlResult2)).xml
    : fetchHeadXmlHandler2.xml;
}
async function fetchVersionXmlAtRev(
  pid?: Dynamic,
  fileId?: Dynamic,
  rev?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  if (!isFrameArtifact())
    throw Error(
      `version history: a version's document is served inside a Frame only`,
    );
  let { xml: fetchVersionXmlAtRevResult }: Dynamic =
    await updatePlatformLiveDocumentAndHistoryFinally(
      `viewxml copy ${pid}/${fileId} ${rev}`,
      (..._extraArguments: unknown[]): Dynamic =>
        fetchHistoryRevisionDocuments(
          resolvePlatformLiveDocumentAndHistoryValue33({
            pid: pid,
            fileId: fileId,
          }),
          {
            rev: rev,
          },
        ),
    );
  return fetchVersionXmlAtRevResult;
}
var prewarmedVersionPages: Dynamic = new (Set as Dynamic)();
function prewarmNewestVersion(
  pid?: Dynamic,
  fileId?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  let label: string = `${pid}/${fileId}`;
  if (!isFrameArtifact() || prewarmedVersionPages.has(label)) return;
  let filteredMappedToSorted: Dynamic = [
    ...new (Set as Dynamic)(
      resolvePlatformLiveDocumentAndHistoryValue32(pid, fileId)
        .filter(
          (item?: Dynamic, ..._extraArguments: unknown[]) =>
            resolvePlatformLiveDocumentAndHistoryParams(item) !==
            PlatformLiveDocumentAndHistoryCurrent,
        )
        .map(
          (filteredItem?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
            filteredItem.params.upto,
        )
        .filter(
          (mappedFilteredItem?: Dynamic, ..._extraArguments: unknown[]) =>
            typeof mappedFilteredItem == `number`,
        ),
    ),
  ]
    .toSorted(
      (
        item?: Dynamic,
        item2?: Dynamic,
        ..._extraArguments: unknown[]
      ): number => item2 - item,
    )
    .map(
      (toSorted?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        resolvePlatformLiveDocumentAndHistoryRev(pid, fileId, toSorted),
    )
    .filter(
      (mappedToSorted?: Dynamic, ..._extraArguments: unknown[]) =>
        mappedToSorted.rev !== undefined,
    );
  if (filteredMappedToSorted.length !== 0) {
    prewarmedVersionPages.add(label);
    prewarmHistoryRevisionDocuments(
      resolvePlatformLiveDocumentAndHistoryValue33({
        pid: pid,
        fileId: fileId,
      }),
      filteredMappedToSorted,
    ).catch((..._extraArguments: unknown[]): undefined => undefined);
  }
}
function useFileSnapshot(
  fileSnapshot?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let [raw, setRaw]: Dynamic = (0, React.useState)();
  let [draft, setDraft]: Dynamic = (0, React.useState)();
  let [editing, setEditing]: Dynamic = (0, React.useState)(false);
  let [error, setError]: Dynamic = (0, React.useState)();
  let [mime, setMime]: Dynamic = (0, React.useState)();
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      setRaw(undefined);
      setDraft(undefined);
      setEditing(false);
      setError(undefined);
      setMime(undefined);
      loadPlatformApiAndAuthRoomsEnabled(fileSnapshot)
        .then(
          (
            { buf: buf, mime: mime2 }: Dynamic,
            ..._extraArguments: unknown[]
          ): undefined => {
            let decode: Dynamic = new (TextDecoder as Dynamic)().decode(buf);
            setRaw(decode);
            setDraft(decode);
            setMime(mime2);
          },
        )
        .catch(
          (error2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
            setError(String(error2)),
        );
    },
    [fileSnapshot],
  );
  return {
    raw: raw,
    setRaw: setRaw,
    draft: draft,
    setDraft: setDraft,
    editing: editing,
    setEditing: setEditing,
    error: error,
    mime: mime,
  };
}
var documentDownloadFilename: Dynamic = (
  documentDownloadFilename2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  resolveDataOperationEngineTrim(
    `${documentDownloadFilename2?.trim() || `Untitled`}.ldoc`,
    `Untitled.ldoc`,
  );
/* Subsystem: text-file-save */
function hashTextSnapshot(
  items?: Dynamic,
  ..._extraArguments: unknown[]
): string {
  let count: number = 2166136261;
  let hashTextSnapshotResult: number = -567674544;
  for (let index: number = 0; index < items.length; index++) {
    let charCodeAt: Dynamic = items.charCodeAt(index);
    count = Math.imul(count ^ charCodeAt, 16777619);
    hashTextSnapshotResult = Math.imul(
      hashTextSnapshotResult ^ charCodeAt,
      16777619,
    );
  }
  return (
    (count >>> 0).toString(16).padStart(8, `0`) +
    (hashTextSnapshotResult >>> 16).toString(16).padStart(4, `0`)
  );
}
function computeSingleTextEdit(
  items?: Dynamic,
  items2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (items === items2) return [];
  let index: number = 0;
  let min: number = Math.min(items.length, items2.length);
  for (; index < min && items.charCodeAt(index) === items2.charCodeAt(index); )
    index++;
  if (
    index > 0 &&
    isHighSurrogate(items.charCodeAt(index - 1)) &&
    (isLowSurrogate(items.charCodeAt(index)) ||
      isLowSurrogate(items2.charCodeAt(index)))
  ) {
    index--;
  }
  let index2: number = 0;
  let difference: number = Math.min(items.length, items2.length) - index;
  for (
    ;
    index2 < difference &&
    items.charCodeAt(items.length - 1 - index2) ===
      items2.charCodeAt(items2.length - 1 - index2);

  )
    index2++;
  if (
    index2 > 0 &&
    isLowSurrogate(items.charCodeAt(items.length - index2)) &&
    (isHighSurrogate(items.charCodeAt(items.length - index2 - 1)) ||
      isHighSurrogate(items2.charCodeAt(items2.length - index2 - 1)))
  ) {
    index2--;
  }
  return [
    {
      at: index,
      del: items.slice(index, items.length - index2),
      ins: items2.slice(index, items2.length - index2),
    },
  ];
}
var TEXT_FILE_MIME_TYPES: Dynamic = {
  md: `text/markdown`,
  markdown: `text/markdown`,
  txt: `text/plain`,
  json: `application/json`,
  csv: `text/csv`,
  html: `text/html`,
  htm: `text/html`,
  py: `text/x-python`,
  ts: `text/x-typescript`,
  tsx: `text/x-typescript`,
  js: `text/javascript`,
  sql: `application/sql`,
  yaml: `application/yaml`,
  yml: `application/yaml`,
  toml: `application/toml`,
};
function textFileMimeType(
  textFileMimeType2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let pop: Dynamic = textFileMimeType2.split(`/`).pop() ?? ``;
  if (/\.ldoc(\.|$)/i.test(pop)) return;
  let normalizedPop: Dynamic = pop.includes(`.`)
    ? pop.split(`.`).pop().toLowerCase()
    : ``;
  return Object.hasOwn(TEXT_FILE_MIME_TYPES, normalizedPop)
    ? TEXT_FILE_MIME_TYPES[normalizedPop]
    : undefined;
}
function parseProjectFilePath(
  projectFilePath?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let match: Dynamic = /^projects\/([^/]+)\/versions\/main\/(.+)$/.exec(
    projectFilePath,
  );
  if (
    match &&
    !(match[1] === `.` || match[1] === `..`) &&
    !match[2]
      .split(`/`)
      .some(
        (matchItemPart?: Dynamic, ..._extraArguments: unknown[]): boolean =>
          matchItemPart === `..` ||
          matchItemPart === `.` ||
          matchItemPart === ``,
      )
  )
    return {
      slug: match[1],
      key: match[2],
    };
}
var FILE_ID_HEADER: string = `x-bongo-v3-file-id`;
var isHighSurrogate: Dynamic = (
  highSurrogate?: Dynamic,
  ..._extraArguments: unknown[]
): boolean => highSurrogate >= 55296 && highSurrogate <= 56319;
var isLowSurrogate: Dynamic = (
  lowSurrogate?: Dynamic,
  ..._extraArguments: unknown[]
): boolean => lowSurrogate >= 56320 && lowSurrogate <= 57343;
var linesStoreModule: Dynamic = createLiveModuleNamespace({
  useLinesStore: (..._extraArguments: unknown[]): Dynamic => useLinesStore,
});
var activeLinesSubscription: Dynamic;
var linesStoreEpoch: number = 0;
var doorRefKey: Dynamic = (
  doorRefKey2?: Dynamic,
  ..._extraArguments: unknown[]
): null | string => {
  let ref: Dynamic = doorRefKey2?.ref;
  return ref?.object !== undefined && ref?.id !== undefined
    ? ref.object + `/` + ref.id
    : null;
};
var useLinesStore: Dynamic = create(
  (
    linesStore?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let useLinesStoreHandler: Dynamic = (
      linesStore4?: Dynamic,
      options2?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => {
      let linesStore5: Dynamic = linesStore4;
      for (let useLinesStoreResult of options2.values() as Dynamic)
        if (useLinesStoreResult.bornAtSeq > linesStore5) {
          linesStore5 = useLinesStoreResult.bornAtSeq;
        }
      return linesStore5 + 1;
    };
    let linesStore2: Dynamic = (
      pid?: Dynamic,
      options2?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic =>
      linesStore({
        pid: pid,
        head: options2.head,
        defaultVersionId: options2.defaultVersionId,
        lines: new (Map as Dynamic)(
          options2.lines.map(
            (line?: Dynamic, ..._extraArguments: unknown[]): Dynamic => [
              line.id,
              {
                ...line,
                bornAtSeq: line.bornAtSeq ?? 0,
              },
            ],
          ),
        ),
        loading: false,
        loadError: undefined,
      });
    let refresh: Dynamic = async (
      linesStore4?: Dynamic,
      ..._extraArguments: unknown[]
    ): Promise<Dynamic> => {
      let pid: Dynamic = options().pid;
      let linesStoreEpoch2: Dynamic = linesStoreEpoch;
      let options2: Dynamic = (..._extraArguments: unknown[]): boolean =>
        linesStoreEpoch2 === linesStoreEpoch && options().pid === pid;
      try {
        let response: Dynamic = await loadPlatformSessionAndSourcesAckOf(
          pid,
          linesStore4,
          (
            linesStore5?: Dynamic,
            options3?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic =>
            fetch(resolvePlatformApiAndAuthValue(linesStore5), options3),
        );
        return options2()
          ? response.verdict === `deny`
            ? (linesStore({
                lastDeny: resolvePlatformSessionAndSourcesUnavailable(
                  response.reason,
                  resolvePlatformSessionAndSourcesData(response),
                ),
              }),
              {
                ok: false,
              })
            : {
                ok: true,
                minted: response.minted,
              }
          : {
              ok: false,
              stale: true,
            };
      } catch {
        return options2()
          ? (linesStore({
              lastDeny: `The change didn't reach the server — check your connection and try again.`,
            }),
            options().refresh(),
            {
              ok: false,
            })
          : {
              ok: false,
              stale: true,
            };
      }
    };
    let linesStore3 = (
      linesStore4?: Dynamic,
      options2?: Dynamic,
      context?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      let lineEntry: Dynamic = options().lines.get(linesStore4);
      if (
        lineEntry !== undefined &&
        JSON.stringify(lineEntry) === JSON.stringify(context)
      ) {
        linesStore({
          lines: new (Map as Dynamic)(options().lines).set(
            linesStore4,
            options2,
          ),
        });
      }
    };
    return {
      pid: ``,
      lines: new (Map as Dynamic)(),
      defaultVersionId: null,
      head: 0,
      loading: false,
      loadError: undefined,
      lastDeny: undefined,
      mount: async (
        pid?: Dynamic,
        ..._extraArguments: unknown[]
      ): Promise<undefined> => {
        if (
          options().pid === pid &&
          (options().loading || options().lines.size > 0)
        )
          return;
        options().unmount();
        let useLinesStoreResult: number = ++linesStoreEpoch;
        linesStore({
          pid: pid,
          loading: true,
          loadError: undefined,
        });
        try {
          let useLinesStoreResult2: Dynamic =
            await loadPlatformSessionAndSourcesFrameVersionTable(
              pid,
              (
                linesStore4?: Dynamic,
                options2?: Dynamic,
                ..._extraArguments: unknown[]
              ): Dynamic =>
                fetch(resolvePlatformApiAndAuthValue(linesStore4), options2),
            );
          if (useLinesStoreResult !== linesStoreEpoch) return;
          linesStore2(pid, useLinesStoreResult2);
        } catch (error: Dynamic) {
          if (useLinesStoreResult !== linesStoreEpoch) return;
          linesStore({
            loading: false,
            loadError:
              error instanceof (Error as Dynamic)
                ? error.message
                : String(error),
          });
          return;
        }
        activeLinesSubscription = subscribeProjectFeed(
          pid,
          (entry?: Dynamic, ..._extraArguments: unknown[]): undefined => {
            if (
              entry.kind === `live` ||
              entry.kind === `recovered` ||
              entry.kind === `access-changed`
            ) {
              if (options().pid === pid) {
                options().refresh();
              }
              return;
            }
            if (entry.kind === `revoked` || entry.kind !== `envelope`) return;
            let envelope: Dynamic = entry.envelope;
            let options2: Dynamic = options();
            if (options2.pid !== pid) return;
            let filteredDiff: Dynamic = envelope.diff.filter(
              (diff?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
                doorRefKey(diff.address)?.startsWith(`version/`),
            );
            let lines: Dynamic = options2.lines;
            if (filteredDiff.length > 0) {
              lines = new (Map as Dynamic)(options2.lines);
              for (let useLinesStoreResult2 of filteredDiff as Dynamic) {
                let doorRefKeySlice: Dynamic = doorRefKey(
                  useLinesStoreResult2.address,
                ).slice(8);
                if (useLinesStoreResult2.after == null) {
                  lines.delete(doorRefKeySlice);
                  continue;
                }
                if (typeof useLinesStoreResult2.after != `object`) continue;
                let lineEntry: Dynamic = lines.get(doorRefKeySlice);
                let after: Dynamic = useLinesStoreResult2.after;
                lines.set(doorRefKeySlice, {
                  ...after,
                  id: doorRefKeySlice,
                  bornAtSeq:
                    lineEntry?.bornAtSeq ??
                    useLinesStoreHandler(options2.head, lines),
                });
              }
            }
            let defaultVersionId: Dynamic = options2.defaultVersionId;
            for (let useLinesStoreResult2 of envelope.diff as Dynamic)
              if (
                doorRefKey(useLinesStoreResult2.address) === `project/` + pid &&
                useLinesStoreResult2.after !== null &&
                typeof useLinesStoreResult2.after == `object`
              ) {
                let after: Dynamic = useLinesStoreResult2.after;
                if (`defaultVersionId` in after) {
                  defaultVersionId = after.defaultVersionId ?? null;
                }
              }
            if (
              lines !== options2.lines ||
              defaultVersionId !== options2.defaultVersionId
            ) {
              linesStore({
                lines: lines,
                defaultVersionId: defaultVersionId,
              });
            }
          },
        );
      },
      unmount: (..._extraArguments: unknown[]): undefined => {
        linesStoreEpoch++;
        activeLinesSubscription?.();
        activeLinesSubscription = undefined;
        linesStore({
          pid: ``,
          lines: new (Map as Dynamic)(),
          defaultVersionId: null,
          head: 0,
          lastDeny: undefined,
          loading: false,
          loadError: undefined,
        });
      },
      remount: async (
        linesStore4?: Dynamic,
        ..._extraArguments: unknown[]
      ): Promise<undefined> => {
        options().unmount();
        await options().mount(linesStore4);
      },
      refresh: async (..._extraArguments: unknown[]): Promise<undefined> => {
        let pid: Dynamic = options().pid;
        if (pid === ``) return;
        let linesStoreEpoch2: Dynamic = linesStoreEpoch;
        try {
          let useLinesStoreResult: Dynamic =
            await loadPlatformSessionAndSourcesFrameVersionTable(
              pid,
              (
                linesStore4?: Dynamic,
                options2?: Dynamic,
                ..._extraArguments: unknown[]
              ): Dynamic =>
                fetch(resolvePlatformApiAndAuthValue(linesStore4), options2),
            );
          if (linesStoreEpoch2 !== linesStoreEpoch || options().pid !== pid)
            return;
          linesStore2(pid, useLinesStoreResult);
        } catch {}
      },
      mint: async (
        { parent: parent, name: name }: Dynamic,
        ..._extraArguments: unknown[]
      ): Promise<Dynamic> => {
        let base: Dynamic = options().head;
        let pid: Dynamic = options().pid;
        let refresh2: Dynamic = await refresh(
          resolvePlatformSessionAndSourcesVerb(pid, {
            parent: parent,
            base: base,
            ...(name !== undefined && {
              name: name,
            }),
          }),
        );
        if (!refresh2.ok || refresh2.minted === undefined) return;
        let options2: Dynamic = options();
        let record: Dynamic = {
          id: refresh2.minted,
          parent: parent,
          base: base,
          bornAtSeq: useLinesStoreHandler(options2.head, options2.lines),
          ...(name !== undefined && {
            name: name,
          }),
        };
        linesStore({
          lines: new (Map as Dynamic)(options2.lines).set(
            refresh2.minted,
            record,
          ),
          head: options2.head + 1,
        });
        return refresh2.minted;
      },
      publish: async (
        defaultVersionId?: Dynamic,
        ..._extraArguments: unknown[]
      ): Promise<Dynamic> => {
        let options2: Dynamic = options();
        let defaultVersionId2: Dynamic = options2.defaultVersionId;
        linesStore({
          defaultVersionId: defaultVersionId,
        });
        let refresh2: Dynamic = await refresh(
          resolvePlatformSessionAndSourcesVerb2(options2.pid, defaultVersionId),
        );
        if (
          !refresh2.ok &&
          !refresh2.stale &&
          options().defaultVersionId === defaultVersionId
        ) {
          linesStore({
            defaultVersionId: defaultVersionId2,
          });
        }
        return refresh2.ok;
      },
      unpublish: async (..._extraArguments: unknown[]): Promise<Dynamic> => {
        let options2: Dynamic = options();
        let defaultVersionId: Dynamic = options2.defaultVersionId;
        linesStore({
          defaultVersionId: null,
        });
        let refresh2: Dynamic = await refresh(
          resolvePlatformSessionAndSourcesVerb3(options2.pid),
        );
        if (
          !refresh2.ok &&
          !refresh2.stale &&
          options().defaultVersionId === null
        ) {
          linesStore({
            defaultVersionId: defaultVersionId,
          });
        }
        return refresh2.ok;
      },
      setFrozen: async (
        linesStore4?: Dynamic,
        frozen?: Dynamic,
        ..._extraArguments: unknown[]
      ): Promise<Dynamic> => {
        let options2: Dynamic = options();
        let lineEntry: Dynamic = options2.lines.get(linesStore4);
        if (lineEntry === undefined) return false;
        let record: Dynamic = {
          ...lineEntry,
          frozen: frozen,
        };
        linesStore({
          lines: new (Map as Dynamic)(options2.lines).set(linesStore4, record),
        });
        let refresh2: Dynamic = await refresh(
          frozen
            ? resolvePlatformSessionAndSourcesFrozen(options2.pid, linesStore4)
            : resolvePlatformSessionAndSourcesFrozen2(
                options2.pid,
                linesStore4,
              ),
        );
        if (!refresh2.ok && !refresh2.stale) {
          linesStore3(linesStore4, lineEntry, record);
        }
        return refresh2.ok;
      },
      abandon: async (
        linesStore4?: Dynamic,
        ..._extraArguments: unknown[]
      ): Promise<Dynamic> => {
        let options2: Dynamic = options();
        let lineEntry: Dynamic = options2.lines.get(linesStore4);
        if (lineEntry === undefined) return false;
        let record: Dynamic = {
          ...lineEntry,
          abandoned: true,
        };
        linesStore({
          lines: new (Map as Dynamic)(options2.lines).set(linesStore4, record),
        });
        let refresh2: Dynamic = await refresh(
          resolvePlatformSessionAndSourcesAbandoned(options2.pid, linesStore4),
        );
        if (!refresh2.ok && !refresh2.stale) {
          linesStore3(linesStore4, lineEntry, record);
        }
        return refresh2.ok;
      },
      rename: async (
        linesStore4?: Dynamic,
        name?: Dynamic,
        ..._extraArguments: unknown[]
      ): Promise<Dynamic> => {
        let options2: Dynamic = options();
        let lineEntry: Dynamic = options2.lines.get(linesStore4);
        if (lineEntry === undefined) return false;
        let record: Dynamic = {
          ...lineEntry,
          name: name,
        };
        linesStore({
          lines: new (Map as Dynamic)(options2.lines).set(linesStore4, record),
        });
        let refresh2: Dynamic = await refresh(
          resolvePlatformSessionAndSourcesName(options2.pid, linesStore4, name),
        );
        if (!refresh2.ok && !refresh2.stale) {
          linesStore3(linesStore4, lineEntry, record);
        }
        return refresh2.ok;
      },
      clearDeny: (..._extraArguments: unknown[]): Dynamic =>
        linesStore({
          lastDeny: undefined,
        }),
    };
  },
);
var FILE_SERVE_HEADER: string = `x-bongo-v3-serve`;
var FILE_CONSULT_HEADER: string = `x-bongo-v3-consult`;
async function fetchTextSaveEvidence(
  fetchTextSaveEvidence2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let response: Dynamic = await fetch(
    collectPlatformApiAndAuthJoin(fetchTextSaveEvidence2 + `/` + options),
    {
      headers: resolvePlatformApiAndAuthXBongoUniverse(),
      cache: `no-store`,
    },
  );
  if (response.status === 404) {
    let consult2: Dynamic = response.headers.get(FILE_CONSULT_HEADER);
    return consult2 === null
      ? {
          kind: `no-evidence`,
        }
      : {
          kind: `stamped-404`,
          consult: consult2,
        };
  }
  if (!response.ok)
    throw Error(
      `textSave read ${response.status}: ${(await response.text()).slice(0, 200)}`,
    );
  let headerEntry: Dynamic = response.headers.get(FILE_SERVE_HEADER);
  let headerEntry2: Dynamic = response.headers.get(FILE_ID_HEADER);
  if (headerEntry === `text`) {
    if (headerEntry2 === null || headerEntry2 === ``)
      throw Error(`textSave: fold serve without a row id — refusing to guess`);
    return {
      kind: `hit`,
      id: headerEntry2,
      text: await response.text(),
    };
  }
  let consult: Dynamic = response.headers.get(FILE_CONSULT_HEADER);
  if (consult !== null) {
    let number: number = Number(
      response.headers.get(`x-bongo-v3-head`) ?? `0`,
    );
    let text: Dynamic = await response.text();
    return {
      kind: `stamped-miss`,
      consult: consult,
      head: Number.isFinite(number) ? number : 0,
      v1HasBytes: text.length > 0,
    };
  }
  return {
    kind: `no-evidence`,
  };
}
var boundFilePlacements: Dynamic = new (Map as Dynamic)();
var filePlacementKey: Dynamic = (
  filePlacementKey2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): string => filePlacementKey2 + `/` + options;
var filePlacementRequests: Dynamic = new (Map as Dynamic)();
var RESERVED_PLACEMENT_KEYS: Dynamic = new (Set as Dynamic)([
  `uploadUrl`,
  `__proto__`,
  `constructor`,
  `prototype`,
]);
var allowProjectFileIdLookup: boolean = false;
async function readProjectJson(
  projectJson?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let response: Dynamic = ackOf(
    await liveDoor(projectJson).call(`read`, {
      ref: {
        object: `project`,
        id: projectJson,
      },
      engine: `json`,
      payload: {
        engine: `json`,
      },
    }),
  );
  if (response.verdict !== `allow`) return;
  let value: Dynamic = response.value;
  return typeof value == `object` && value && !Array.isArray(value)
    ? value
    : undefined;
}
async function bindFilePlacement(
  callDoor?: Dynamic,
  pid?: Dynamic,
  project?: Dynamic,
  path?: Dynamic,
  fileId?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let files: Dynamic = updatePlatformSyncAndRoutingDirectory(project);
  let pathParts: Dynamic = path.split(`/`);
  let fileName: Dynamic = pathParts.pop() ?? ``;
  let birthName: Dynamic = fileName.includes(`.`)
    ? fileName.slice(0, fileName.lastIndexOf(`.`))
    : fileName;
  if (birthName === ``) throw Error(`cannot bind a file with an empty name`);
  let patch: Dynamic = [];
  let parentId: Dynamic;
  let parentPath: string = ``;
  for (let name of pathParts as Dynamic) {
    if (name === ``) continue;
    parentPath += `/` + name;
    let total: string = pid + ` ` + parentPath;
    let bindFilePlacementResult: Dynamic;
    for (let [
      bindFilePlacementResult2,
      bindFilePlacementResult3,
    ] of files as Dynamic)
      if (
        bindFilePlacementResult2 !== fileId &&
        bindFilePlacementResult3.name === name &&
        bindFilePlacementResult3.subtabOf === parentId
      ) {
        bindFilePlacementResult = bindFilePlacementResult2;
        break;
      }
    if (bindFilePlacementResult !== undefined)
      filePlacementRequests.delete(total);
    else {
      let filePlacementRequestEntry: Dynamic = filePlacementRequests.get(total);
      if (filePlacementRequestEntry !== undefined)
        bindFilePlacementResult = filePlacementRequestEntry;
      else {
        let birthName2: Dynamic = documentDownloadFilename(name);
        let callDoor2: Dynamic = await callDoor({
          verb: `create`,
          object: `file`,
          engine: `json`,
          payload: {
            engine: `json`,
            value: {
              birthName: birthName2,
            },
          },
        });
        if (callDoor2.verdict !== `allow` || callDoor2.minted === undefined)
          throw new (DoorRefused as Dynamic)(
            `bind`,
            callDoor2.verdict === `allow`
              ? `segment create ack had no minted id`
              : (callDoor2.reason ?? `unknown`),
          );
        let callDoor3: Dynamic = await callDoor({
          verb: `create`,
          object: `node`,
          engine: `prose`,
          payload: {
            engine: `prose`,
            doc: resolveDataOperationControlLevel2(),
            localId: `ln-body`,
            parent: {
              object: `file`,
              id: callDoor2.minted,
            },
          },
        });
        if (callDoor3.verdict !== `allow` || callDoor3.minted === undefined)
          throw new (DoorRefused as Dynamic)(
            `bind`,
            callDoor3.verdict === `allow`
              ? `segment node ack had no minted id`
              : (callDoor3.reason ?? `unknown`),
          );
        let callDoor4: Dynamic = await callDoor({
          verb: `update`,
          ref: {
            object: `file`,
            id: callDoor2.minted,
          },
          engine: `json`,
          payload: {
            engine: `json`,
            kind: `value`,
            value: {
              birthName: birthName2,
              content: {
                kind: `node`,
                id: callDoor3.minted,
              },
            },
          },
        });
        if (callDoor4.verdict !== `allow`)
          throw new (DoorRefused as Dynamic)(
            `bind`,
            callDoor4.reason ?? `unknown`,
          );
        bindFilePlacementResult = callDoor2.minted;
        filePlacementRequests.set(total, bindFilePlacementResult);
      }
      let record: Dynamic =
        parentId === undefined
          ? {
              name: name,
            }
          : {
              name: name,
              subtabOf: parentId,
            };
      record.order = getDataOperationControlKeys(files, parentId);
      files.set(bindFilePlacementResult, record);
      (patch.push as Dynamic)(
        ...resolvePlatformSyncAndRoutingPath3(bindFilePlacementResult, record),
      );
    }
    parentId = bindFilePlacementResult;
  }
  let existingFile: Dynamic = files.get(fileId);
  let fileValue: Dynamic = {
    name: birthName,
  };
  if (parentId !== undefined) {
    fileValue.subtabOf = parentId;
  }
  if (existingFile?.order === undefined) {
    if (existingFile === undefined) {
      fileValue.order = getDataOperationControlKeys(files, parentId);
    }
  } else {
    fileValue.order = existingFile.order;
  }
  (patch.push as Dynamic)(
    ...resolvePlatformSyncAndRoutingPath3(fileId, fileValue),
  );
  return patch;
}
function projectFileIdByName(
  projectFileIdByName2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (!allowProjectFileIdLookup) return;
  let files: Dynamic = projectFileIdByName2?.files;
  if (
    typeof files != `object` ||
    !files ||
    Array.isArray(files) ||
    !Object.hasOwn(files, options)
  )
    return;
  let fileItem: Dynamic = files[options];
  return typeof fileItem?.id == `string` ? fileItem.id : undefined;
}
var DoorRefused: Dynamic = class extends Error {
  [key: string]: Dynamic;
  stage: Dynamic;
  reason: Dynamic;
  constructor(
    doorRefused?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ) {
    super(
      `${doorRefused === `create` ? `create` : doorRefused === `delete` ? `delete` : `placement bind`} refused: ${options}`,
    );
    this.stage = doorRefused;
    this.reason = options;
    this.name = `DoorRefused`;
  }
};
var projectDoorSeat: Dynamic = (
  projectDoorSeat2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  collectPlatformApiAndAuthVerb(liveDoor(projectDoorSeat2), {
    kind: `project`,
    id: projectDoorSeat2,
  });
async function saveTextFileThroughDoor(
  saveTextFileThroughDoor2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
) {
  if (textFileMimeType(options) === undefined) return `not-applicable`;
  let projectFilePath: Dynamic = parseProjectFilePath(
    saveTextFileThroughDoor2 + `/` + options,
  );
  if (projectFilePath === undefined) return `not-applicable`;
  let pid: Dynamic = useLinesStore.getState().pid;
  let name: Dynamic = useContainerStore.getState().project?.name;
  let matchesName: boolean =
    name === undefined || name !== `projects/` + projectFilePath.slug;
  let getState = (..._extraArguments: unknown[]): undefined => {
    if (useLinesStore.getState().pid !== pid)
      throw Error(`project changed mid-save — reopen the file and save again`);
  };
  for (let index: number = 0; index < 2; index++) {
    let fetchTextSaveEvidence2: Dynamic = await fetchTextSaveEvidence(
      saveTextFileThroughDoor2,
      options,
    );
    if (fetchTextSaveEvidence2.kind === `hit`) {
      if (matchesName || pid === ``)
        throw Error(`can't save files outside the open project yet`);
      boundFilePlacements.delete(
        filePlacementKey(saveTextFileThroughDoor2, options),
      );
      let splices: Dynamic = computeSingleTextEdit(
        fetchTextSaveEvidence2.text,
        context,
      );
      if (splices.length === 0) return `saved`;
      getState();
      let projectDoorSeat2: Dynamic = await projectDoorSeat(pid)({
        verb: `update`,
        ref: {
          object: `file`,
          id: fetchTextSaveEvidence2.id,
        },
        engine: `text`,
        payload: {
          engine: `text`,
          base: hashTextSnapshot(fetchTextSaveEvidence2.text),
          splices: splices,
        },
      });
      if (projectDoorSeat2.verdict === `allow`) return `saved`;
      if (projectDoorSeat2.reason === `text-stale` && index === 0) continue;
      throw Error(`save refused: ${projectDoorSeat2.reason}`);
    }
    if (fetchTextSaveEvidence2.kind === `stamped-miss`) {
      if (
        matchesName ||
        pid === `` ||
        fetchTextSaveEvidence2.head < 1 ||
        (fetchTextSaveEvidence2.consult !== `placement-pending` &&
          fetchTextSaveEvidence2.consult !== `row-pending`) ||
        !fetchTextSaveEvidence2.v1HasBytes
      )
        return `not-applicable`;
      getState();
      if (
        (await ensureFilePlacementBound(
          projectDoorSeat(pid),
          getState,
          saveTextFileThroughDoor2,
          options,
          projectFilePath.key,
          options.split(`/`).pop(),
          context,
          {
            allowHeal: index === 0,
          },
        )) === `rebound`
      )
        continue;
      return `saved`;
    }
    return `not-applicable`;
  }
  throw Error(`save refused: text-stale (after reconcile)`);
}
async function ensureFilePlacementBound(
  ensureFilePlacementBound2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  argument2?: Dynamic,
  text?: Dynamic,
  argument3?: Dynamic,
  ..._extraArguments: unknown[]
) {
  if (RESERVED_PLACEMENT_KEYS.has(argument))
    throw Error(
      `cannot bind a file named ${JSON.stringify(argument)} — reserved placement key`,
    );
  let filePlacementKey2: Dynamic = filePlacementKey(context, dependencies);
  let boundFilePlacementEntry: Dynamic =
    boundFilePlacements.get(filePlacementKey2);
  options();
  let pid: Dynamic = useLinesStore.getState().pid;
  let projectJson: Dynamic = await readProjectJson(pid);
  if (boundFilePlacementEntry === undefined && argument3?.allowHeal === true) {
    let projectFileIdByName2: Dynamic = projectFileIdByName(
      projectJson,
      argument,
    );
    if (projectFileIdByName2 !== undefined) {
      options();
      let ensureFilePlacementBound4: Dynamic = await ensureFilePlacementBound2({
        verb: `update`,
        ref: {
          object: `project`,
          id: pid,
        },
        engine: `json`,
        payload: {
          engine: `json`,
          kind: `patch`,
          patch: await bindFilePlacement(
            ensureFilePlacementBound2,
            pid,
            projectJson,
            dependencies,
            projectFileIdByName2,
          ),
        },
      });
      if (ensureFilePlacementBound4.verdict !== `allow`)
        throw new (DoorRefused as Dynamic)(
          `bind`,
          ensureFilePlacementBound4.reason ?? `unknown`,
        );
      return `rebound`;
    }
  }
  if (boundFilePlacementEntry === undefined) {
    options();
    let ensureFilePlacementBound4: Dynamic = await ensureFilePlacementBound2({
      verb: `create`,
      object: `file`,
      engine: `text`,
      payload: {
        engine: `text`,
        birthName: resolveDataOperationEngineTrim(argument2, `save.txt`),
        content: {
          kind: `text`,
          text: text,
        },
      },
    });
    if (ensureFilePlacementBound4.verdict === `deny`)
      throw new (DoorRefused as Dynamic)(
        `create`,
        ensureFilePlacementBound4.reason ?? `unknown`,
      );
    if (
      ensureFilePlacementBound4.verdict !== `allow` ||
      ensureFilePlacementBound4.minted === undefined
    )
      throw Error(
        `door protocol bug: create ack was not an explicit allow-with-mint`,
      );
    boundFilePlacementEntry = {
      id: ensureFilePlacementBound4.minted,
      lastKnownText: text,
    };
    boundFilePlacements.set(filePlacementKey2, boundFilePlacementEntry);
  }
  options();
  let pid2: Dynamic = useLinesStore.getState().pid;
  let ensureFilePlacementBound3: Dynamic = await ensureFilePlacementBound2({
    verb: `update`,
    ref: {
      object: `project`,
      id: pid2,
    },
    engine: `json`,
    payload: {
      engine: `json`,
      kind: `patch`,
      patch: await bindFilePlacement(
        ensureFilePlacementBound2,
        pid2,
        projectJson,
        dependencies,
        boundFilePlacementEntry.id,
      ),
    },
  });
  if (ensureFilePlacementBound3.verdict === `deny`) {
    let doorRefused: Dynamic = new (DoorRefused as Dynamic)(
      `bind`,
      ensureFilePlacementBound3.reason ?? `unknown`,
    );
    throw (
      (doorRefused.message += ` (row ${boundFilePlacementEntry.id} created — retry will re-bind, not re-create)`),
      doorRefused
    );
  }
  if (boundFilePlacementEntry.lastKnownText !== text) {
    options();
    let ensureFilePlacementBound4: Dynamic = await ensureFilePlacementBound2({
      verb: `update`,
      ref: {
        object: `file`,
        id: boundFilePlacementEntry.id,
      },
      engine: `text`,
      payload: {
        engine: `text`,
        base: hashTextSnapshot(boundFilePlacementEntry.lastKnownText),
        splices: computeSingleTextEdit(
          boundFilePlacementEntry.lastKnownText,
          text,
        ),
      },
    });
    if (
      ensureFilePlacementBound4.verdict === `deny` &&
      ensureFilePlacementBound4.reason === `text-stale`
    ) {
      let fetchTextSaveEvidence2: Dynamic = await fetchTextSaveEvidence(
        context,
        dependencies,
      );
      if (fetchTextSaveEvidence2.kind !== `hit`)
        throw (
          boundFilePlacements.delete(filePlacementKey2),
          Error(
            `save incomplete: placement bound but content not reconciled — save again`,
          )
        );
      let splices: Dynamic = computeSingleTextEdit(
        fetchTextSaveEvidence2.text,
        text,
      );
      if (splices.length > 0) {
        options();
        let ensureFilePlacementBound5: Dynamic =
          await ensureFilePlacementBound2({
            verb: `update`,
            ref: {
              object: `file`,
              id: fetchTextSaveEvidence2.id,
            },
            engine: `text`,
            payload: {
              engine: `text`,
              base: hashTextSnapshot(fetchTextSaveEvidence2.text),
              splices: splices,
            },
          });
        if (ensureFilePlacementBound5.verdict === `deny`)
          throw (
            boundFilePlacements.delete(filePlacementKey2),
            Error(`save refused: ${ensureFilePlacementBound5.reason}`)
          );
      }
    } else if (ensureFilePlacementBound4.verdict === `deny`)
      throw (
        boundFilePlacements.delete(filePlacementKey2),
        Error(`save refused: ${ensureFilePlacementBound4.reason}`)
      );
  }
  boundFilePlacements.delete(filePlacementKey2);
  return `created`;
}
async function saveTextFilesAndUploadOtherFiles(
  saveTextFilesAndUploadOtherFiles2?: Dynamic,
  options?: Dynamic,
  items?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let record: Dynamic = {};
  let record2: Dynamic = {};
  for (let [
    saveTextFilesAndUploadOtherFilesResult,
    saveTextFilesAndUploadOtherFilesResult2,
  ] of Object.entries(options) as Dynamic)
    if (
      !(
        textFileMimeType(saveTextFilesAndUploadOtherFilesResult) !==
          undefined &&
        (await saveTextFileThroughDoor(
          saveTextFilesAndUploadOtherFiles2,
          saveTextFilesAndUploadOtherFilesResult,
          await saveTextFilesAndUploadOtherFilesResult2.text(),
        )) === `saved`
      )
    ) {
      record[saveTextFilesAndUploadOtherFilesResult] =
        saveTextFilesAndUploadOtherFilesResult2;
      if (dependencies[saveTextFilesAndUploadOtherFilesResult] !== undefined) {
        record2[saveTextFilesAndUploadOtherFilesResult] =
          dependencies[saveTextFilesAndUploadOtherFilesResult];
      }
    }
  return Object.keys(record).length === 0 && items.length === 0
    ? {
        mtimes: {},
        shas: {},
        conflicts: [],
      }
    : loadPlatformApiAndAuthMethod2(
        saveTextFilesAndUploadOtherFiles2,
        record,
        items,
        record2,
        argument,
      );
}
var stripMarkdownFrontmatter: Dynamic = (
  stripMarkdownFrontmatter2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  stripMarkdownFrontmatter2.startsWith(`---
`)
    ? stripMarkdownFrontmatter2.replace(/^---\n[\s\S]*?\n---\r?\n/, ``)
    : stripMarkdownFrontmatter2;
var fileAtUrl: Dynamic = (
  file?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  resolvePlatformApiAndAuthValue(
    `/api/file-at?rel=${encodeURIComponent(file)}&sha=${encodeURIComponent(options)}`,
  );
var fileSnapshotKey = (
  fileSnapshotKey2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
) =>
  context === undefined
    ? `${options}\u0000${fileSnapshotKey2}`
    : `${options}\u0000${fileSnapshotKey2}\u0000${context}`;
var bytesSnapshot: Dynamic = (
  bytes?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let bytesSnapshotResult: Dynamic;
  return {
    status: `ok`,
    bytes: bytes,
    text: (..._extraArguments: unknown[]): Dynamic =>
      (bytesSnapshotResult ??= new (TextDecoder as Dynamic)().decode(bytes)),
  };
};
var fileSnapshotRequests: Dynamic = new (Map as Dynamic)();
var useFileSnapshotStore: Dynamic = create(
  (
    fileSnapshotStore?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => ({
    entries: new (Map as Dynamic)(),
    load: (
      fileSnapshotStore2?: Dynamic,
      options2?: Dynamic,
      context?: Dynamic,
      dependencies?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => {
      let fileSnapshotKey2: string = fileSnapshotKey(
        fileSnapshotStore2,
        options2,
        context,
      );
      let fileSnapshotRequestEntry: Dynamic =
        fileSnapshotRequests.get(fileSnapshotKey2);
      if (fileSnapshotRequestEntry) return fileSnapshotRequestEntry;
      let entryEntry: Dynamic = options().entries.get(fileSnapshotKey2);
      if (entryEntry?.status === `ok` && dependencies !== true)
        return Promise.resolve();
      let matchesStatus: boolean = entryEntry?.status === `ok`;
      if (!matchesStatus) {
        fileSnapshotStore({
          entries: new (Map as Dynamic)(options().entries).set(
            fileSnapshotKey2,
            {
              status: `loading`,
            },
          ),
        });
      }
      let result: Dynamic = fetch(
        context ?? fileAtUrl(fileSnapshotStore2, options2),
      )
        .then(
          async (
            response?: Dynamic,
            ..._extraArguments: unknown[]
          ): Promise<Dynamic> => {
            if (!response.ok)
              throw Error(`${response.status} ${response.statusText}`);
            return new (Uint8Array as Dynamic)(await response.arrayBuffer());
          },
        )
        .then(
          (result2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
            fileSnapshotStore({
              entries: new (Map as Dynamic)(options().entries).set(
                fileSnapshotKey2,
                bytesSnapshot(result2),
              ),
            }),
          (error?: Dynamic, ..._extraArguments: unknown[]): undefined => {
            if (!matchesStatus) {
              fileSnapshotStore({
                entries: new (Map as Dynamic)(options().entries).set(
                  fileSnapshotKey2,
                  {
                    status: `error`,
                    error: String(error?.message ?? error),
                  },
                ),
              });
            }
          },
        )
        .finally(
          (..._extraArguments: unknown[]): Dynamic =>
            fileSnapshotRequests.delete(fileSnapshotKey2),
        );
      fileSnapshotRequests.set(fileSnapshotKey2, result);
      return result;
    },
  }),
);
var ACTIVITY_READ_KIND: string = `activity`;
var isActivityObject: Dynamic = (
  activityObject?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  typeof activityObject == `object` &&
  !!activityObject &&
  !Array.isArray(activityObject);
var ACTIVITY_WORD_PATTERN: Dynamic = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
var parseActivityActor: Dynamic = (
  actor?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  !isActivityObject(actor) ||
  typeof actor.principal != `string` ||
  actor.principal.length === 0
    ? null
    : {
        principal: actor.principal,
        channel: typeof actor.channel == `string` ? actor.channel : `human`,
        ...(typeof actor.via == `string`
          ? {
              via: actor.via,
            }
          : {}),
      };
/* Subsystem: activity-attribution */
function parseActivityEntry(
  activity?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (
    !isActivityObject(activity) ||
    typeof activity.rev != `number` ||
    typeof activity.blockKind != `string` ||
    !ACTIVITY_WORD_PATTERN.test(activity.blockKind)
  )
    return;
  let cause: Dynamic =
    typeof activity.cause == `string` &&
    ACTIVITY_WORD_PATTERN.test(activity.cause)
      ? activity.cause
      : `edited`;
  return {
    ...(typeof activity.blockId == `string` && activity.blockId.length > 0
      ? {
          blockId: activity.blockId,
        }
      : {}),
    blockKind: activity.blockKind,
    ...(typeof activity.label == `string` && activity.label.length > 0
      ? {
          label: activity.label,
        }
      : {}),
    ...(typeof activity.at == `string` &&
    Number.isFinite(Date.parse(activity.at))
      ? {
          at: activity.at,
        }
      : {}),
    rev: activity.rev,
    cause: cause,
    ...(typeof activity.blocks == `number`
      ? {
          blocks: activity.blocks,
        }
      : {}),
    ...(typeof activity.rewroteAs == `string` && activity.rewroteAs.length > 0
      ? {
          rewroteAs: activity.rewroteAs,
        }
      : {}),
    ...(typeof activity.rewroteId == `string` && activity.rewroteId.length > 0
      ? {
          rewroteId: activity.rewroteId,
        }
      : {}),
  };
}
var parseActivityCursor: Dynamic = (
  activityCursor?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  if (
    !(
      !isActivityObject(activityCursor) ||
      typeof activityCursor.before != `number`
    )
  )
    return {
      before: activityCursor.before,
      ...(typeof activityCursor.skip == `number` && activityCursor.skip > 0
        ? {
            skip: activityCursor.skip,
          }
        : {}),
    };
};
function parseActivityResponse(
  activityResponse?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (
    !isActivityObject(activityResponse) ||
    !Array.isArray(activityResponse.actors)
  )
    return;
  let actors: Dynamic = [];
  let lookup: Dynamic = new (Map as Dynamic)();
  for (let parseActivityResponseResult of activityResponse.actors as Dynamic) {
    if (
      !isActivityObject(parseActivityResponseResult) ||
      !Array.isArray(parseActivityResponseResult.entries)
    )
      continue;
    let entries: Dynamic = parseActivityResponseResult.entries.flatMap(
      (entry?: Dynamic, ..._extraArguments: unknown[]): Dynamic => {
        let activityEntry: Dynamic = parseActivityEntry(entry);
        return activityEntry ? [activityEntry] : [];
      },
    );
    if (entries.length === 0) continue;
    let actor: Dynamic = parseActivityActor(parseActivityResponseResult.actor);
    let lookupEntry: Dynamic = lookup.get(activityActorKey(actor));
    if (lookupEntry === undefined) {
      let record: Dynamic = {
        actor: actor,
        entries: entries,
      };
      lookup.set(activityActorKey(actor), record);
      actors.push(record);
    } else {
      (lookupEntry.entries.push as Dynamic)(...entries);
      lookupEntry.entries.sort(
        (
          entry?: Dynamic,
          entry2?: Dynamic,
          ..._extraArguments: unknown[]
        ): number => entry2.rev - entry.rev,
      );
    }
  }
  let next: Dynamic = parseActivityCursor(activityResponse.next);
  return {
    rev: typeof activityResponse.rev == `number` ? activityResponse.rev : 0,
    complete: activityResponse.complete === true,
    ...(typeof activityResponse.recordedFromRev == `number`
      ? {
          recordedFromRev: activityResponse.recordedFromRev,
        }
      : {}),
    goneForgotten: activityResponse.goneForgotten === true,
    actors: actors,
    ...(next
      ? {
          next: next,
        }
      : {}),
  };
}
function activityActorKind(actor?: Dynamic, ..._extraArguments: unknown[]) {
  return actor === null
    ? `nobody`
    : actor.principal === `room`
      ? `room`
      : actor.channel === `human` || resolveDataModelSchemasFrame(actor.via)
        ? `person`
        : `agent`;
}
var activityActorKey = (actor?: Dynamic, ..._extraArguments: unknown[]) =>
  actor === null
    ? `\0nobody`
    : `${actor.principal}\u0000${actor.channel}\u0000${actor.via ?? ``}`;
function isActivityReadUnavailable(
  activityReadUnavailable?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (
    !(
      activityReadUnavailable instanceof
      (PlatformLiveDocumentAndHistoryDENIED as Dynamic)
    )
  )
    return false;
  if (
    activityReadUnavailable.reason === `forbidden` ||
    activityReadUnavailable.reason === `access` ||
    activityReadUnavailable.reason === `not_found`
  )
    return true;
  if (activityReadUnavailable.reason !== `bad_request`) return false;
  let data: Dynamic = isActivityObject(activityReadUnavailable.data)
    ? activityReadUnavailable.data
    : {};
  return (Array.isArray(data.issues) ? data.issues : []).some(
    (issue?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      isActivityObject(issue) && issue.path === `kind`,
  );
}
function activityReadRequest(
  activityReadRequest2?: Dynamic,
  options: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  let payload: Dynamic = {
    kind: ACTIVITY_READ_KIND,
    limit: Math.max(1, Math.min(500, options.limit ?? 200)),
  };
  if (options.cursor !== undefined) {
    payload.before = options.cursor.before;
    if (options.cursor.skip !== undefined && options.cursor.skip > 0) {
      payload.skip = options.cursor.skip;
    }
  }
  return {
    ref: resolvePlatformLiveDocumentAndHistoryNode4(activityReadRequest2),
    payload: payload,
  };
}
async function readPageActivity(
  pageActivity?: Dynamic,
  options: Dynamic = {},
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let readPageActivityResult: Dynamic =
    await loadPlatformLiveDocumentAndHistoryRef(pageActivity);
  let activityResponse: Dynamic = parseActivityResponse(
    resolvePlatformLiveDocumentAndHistoryAllow(
      `activity`,
      await resolvePlatformLiveDocumentAndHistorySchedule(
        pageActivity,
        `activity`,
        pageActivity.door.call(
          `read`,
          activityReadRequest(readPageActivityResult, options),
        ),
      ),
    ).attribution,
  );
  if (activityResponse === undefined)
    throw new (PlatformLiveDocumentAndHistoryMALFORMED as Dynamic)(`activity`);
  return activityResponse;
}
var activityDoorContext: Dynamic = (
  page?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  isFrameArtifact()
    ? resolvePlatformLiveDocumentAndHistoryValue33(page)
    : {
        pid: page.pid,
        fileId: page.fileId,
        door: liveDoor(page.pid, {
          container: {
            kind: `project`,
            id: page.pid,
          },
        }),
        schedule: (
          activityDoorContext2?: Dynamic,
          options?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic => {
          let setTimeout2: Dynamic = setTimeout(activityDoorContext2, options);
          return (..._extraArguments: unknown[]): void =>
            clearTimeout(setTimeout2);
        },
      };
var pageActivityKey = (page?: Dynamic, ..._extraArguments: unknown[]) =>
  `${page.pid}/${page.fileId}`;
var activityCursorKey = (
  activityCursorKey2?: Dynamic,
  ..._extraArguments: unknown[]
) =>
  activityCursorKey2 === undefined
    ? ``
    : `${activityCursorKey2.before}.${activityCursorKey2.skip ?? 0}`;
function fetchPageActivity(
  fetchPageActivity2?: Dynamic,
  cursor?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return updatePlatformLiveDocumentAndHistoryFinally(
    `activity ${pageActivityKey(fetchPageActivity2)} ${activityCursorKey(cursor)}`,
    (..._extraArguments: unknown[]): Dynamic =>
      readPageActivity(
        activityDoorContext(fetchPageActivity2),
        cursor === undefined
          ? {}
          : {
              cursor: cursor,
            },
      ),
  );
}
var useActivityRefusalStore: Dynamic = create(
  (..._extraArguments: unknown[]): Dynamic => ({
    refused: {},
  }),
);
function markActivityRefused(
  markActivityRefused2?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  let pageActivityKey2: string = pageActivityKey(markActivityRefused2);
  if (!useActivityRefusalStore.getState().refused[pageActivityKey2]) {
    useActivityRefusalStore.setState(
      (
        markActivityRefused3?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => ({
        refused: {
          ...markActivityRefused3.refused,
          [pageActivityKey2]: true,
        },
      }),
    );
  }
}
function useAttributionPanelEnabled(
  page?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let useAttributionPanelEnabledResult: Dynamic =
    usePlatformFeatureFlagsUseSyncExternalStore(`attributionPanel`);
  let label: string =
    page === undefined || page.pid.length === 0 || page.fileId.length === 0
      ? ``
      : pageActivityKey(page);
  let useActivityRefusalStore2: Dynamic = useActivityRefusalStore(
    (input?: Dynamic, ..._extraArguments: unknown[]) =>
      label === `` ? true : input.refused[label] === true,
  );
  return (
    options && useAttributionPanelEnabledResult && !useActivityRefusalStore2
  );
}
var IDLE_ACTIVITY_STATE: Dynamic = {
  status: `idle`,
  loadingMore: false,
};
var activityStorePageKey = (page?: Dynamic, ..._extraArguments: unknown[]) =>
  `${page.pid}/${page.fileId}`;
var activityResponseState: Dynamic = (
  activityResponseState2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => ({
  rev: activityResponseState2.rev,
  complete: activityResponseState2.complete,
  ...(activityResponseState2.recordedFromRev === undefined
    ? {}
    : {
        recordedFromRev: activityResponseState2.recordedFromRev,
      }),
  goneForgotten: activityResponseState2.goneForgotten,
  groups: activityResponseState2.actors,
  ...(activityResponseState2.next
    ? {
        next: activityResponseState2.next,
      }
    : {}),
});
function appendActivityGroups(
  appendActivityGroups2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let groups: Dynamic = appendActivityGroups2.groups.map(
    (group?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
      ...group,
      entries: [...group.entries],
    }),
  );
  let lookup: Dynamic = new (Map as Dynamic)(
    groups.map(
      (
        group?: Dynamic,
        index?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => [activityActorKey(group.actor), index],
    ),
  );
  for (let appendActivityGroupsResult of options.actors as Dynamic) {
    let activityActorKey2: string = activityActorKey(
      appendActivityGroupsResult.actor,
    );
    let lookupEntry: Dynamic = lookup.get(activityActorKey2);
    if (lookupEntry === undefined) {
      lookup.set(activityActorKey2, groups.length);
      groups.push({
        actor: appendActivityGroupsResult.actor,
        entries: [...appendActivityGroupsResult.entries],
      });
    } else {
      (groups[lookupEntry].entries.push as Dynamic)(
        ...appendActivityGroupsResult.entries,
      );
    }
  }
  let { next: appendActivityGroups3, ...appendActivityGroups4 }: Dynamic =
    appendActivityGroups2;
  return {
    ...appendActivityGroups4,
    complete: appendActivityGroups2.complete && options.complete,
    ...(options.recordedFromRev === undefined
      ? {}
      : {
          recordedFromRev: options.recordedFromRev,
        }),
    goneForgotten: appendActivityGroups2.goneForgotten || options.goneForgotten,
    groups: groups,
    ...(options.next
      ? {
          next: options.next,
        }
      : {}),
  };
}
var normalizeActivityError: Dynamic = (
  activityError?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  activityError instanceof (Error as Dynamic)
    ? activityError
    : Error(`activity read failed`);
var equalActivityCursors: Dynamic = (
  equalActivityCursors2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  equalActivityCursors2 !== undefined &&
  equalActivityCursors2.before === options.before &&
  (equalActivityCursors2.skip ?? 0) === (options.skip ?? 0);
var activityReadClock: Dynamic = (..._extraArguments: unknown[]): number =>
  Date.now();
var usePageActivityStore: Dynamic = create(
  (
    pageActivityStore?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let pageActivityStore2: Dynamic = (
      pageActivityStore4?: Dynamic,
      options2?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic =>
      pageActivityStore(
        (
          pageActivityStore5?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic => ({
          byPage: {
            ...pageActivityStore5.byPage,
            [pageActivityStore4]: options2(
              pageActivityStore5.byPage[pageActivityStore4] ??
                IDLE_ACTIVITY_STATE,
            ),
          },
        }),
      );
    let pageActivityStore3 = (
      pageActivityStore4?: Dynamic,
      options2?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      markActivityRefused(pageActivityStore4);
      pageActivityStore2(
        options2,
        (..._extraArguments: unknown[]): Dynamic => ({
          status: `unavailable`,
          loadingMore: false,
        }),
      );
    };
    async function load(
      pageActivityStore4?: Dynamic,
      ..._extraArguments: unknown[]
    ): Promise<undefined> {
      let activityStorePageKey2: string =
        activityStorePageKey(pageActivityStore4);
      if (options().byPage[activityStorePageKey2]?.status !== `unavailable`) {
        pageActivityStore2(
          activityStorePageKey2,
          (
            pageActivityStore5?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic => ({
            ...pageActivityStore5,
            status: `loading`,
            error: undefined,
          }),
        );
        try {
          let fetchPageActivity2: Dynamic =
            await fetchPageActivity(pageActivityStore4);
          pageActivityStore2(
            activityStorePageKey2,
            (..._extraArguments: unknown[]): Dynamic => ({
              status: `ready`,
              feed: activityResponseState(fetchPageActivity2),
              loadingMore: false,
              readAt: activityReadClock(),
            }),
          );
        } catch (usePageActivityStoreResult: Dynamic) {
          if (isActivityReadUnavailable(usePageActivityStoreResult)) {
            pageActivityStore3(pageActivityStore4, activityStorePageKey2);
          } else {
            pageActivityStore2(
              activityStorePageKey2,
              (
                pageActivityStore5?: Dynamic,
                ..._extraArguments: unknown[]
              ): Dynamic => ({
                ...pageActivityStore5,
                status: `error`,
                error: normalizeActivityError(usePageActivityStoreResult),
                loadingMore: false,
              }),
            );
          }
        }
      }
    }
    async function usePageActivityStoreHandler(
      pageActivityStore4?: Dynamic,
      options2: Dynamic = 1,
      ..._extraArguments: unknown[]
    ): Promise<undefined> {
      let activityStorePageKey2: string =
        activityStorePageKey(pageActivityStore4);
      let byPageItem: Dynamic = options().byPage[activityStorePageKey2];
      if (
        !byPageItem?.feed?.next ||
        byPageItem.loadingMore ||
        byPageItem.status === `loading` ||
        byPageItem.status === `unavailable`
      )
        return;
      let next: Dynamic = byPageItem.feed.next;
      pageActivityStore2(
        activityStorePageKey2,
        (
          pageActivityStore5?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic => ({
          ...pageActivityStore5,
          loadingMore: true,
        }),
      );
      try {
        let fetchPageActivity2: Dynamic = await fetchPageActivity(
          pageActivityStore4,
          next,
        );
        let feed: Dynamic = options().byPage[activityStorePageKey2]?.feed;
        if (
          feed === undefined ||
          fetchPageActivity2.rev !== feed.rev ||
          !equalActivityCursors(feed.next, next)
        ) {
          pageActivityStore2(
            activityStorePageKey2,
            (
              pageActivityStore5?: Dynamic,
              ..._extraArguments: unknown[]
            ): Dynamic => ({
              ...pageActivityStore5,
              loadingMore: false,
            }),
          );
          await load(pageActivityStore4);
          if (options2 > 0) {
            await usePageActivityStoreHandler(pageActivityStore4, options2 - 1);
          }
          return;
        }
        pageActivityStore2(
          activityStorePageKey2,
          (
            pageActivityStore5?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic => ({
            ...pageActivityStore5,
            status: `ready`,
            error: undefined,
            feed: appendActivityGroups(feed, fetchPageActivity2),
            loadingMore: false,
          }),
        );
      } catch (usePageActivityStoreResult: Dynamic) {
        if (isActivityReadUnavailable(usePageActivityStoreResult)) {
          pageActivityStore3(pageActivityStore4, activityStorePageKey2);
        } else {
          pageActivityStore2(
            activityStorePageKey2,
            (
              pageActivityStore5?: Dynamic,
              ..._extraArguments: unknown[]
            ): Dynamic => ({
              ...pageActivityStore5,
              status: `error`,
              error: normalizeActivityError(usePageActivityStoreResult),
              loadingMore: false,
            }),
          );
        }
      }
    }
    return {
      byPage: {},
      load: load,
      loadMore: (
        pageActivityStore4?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => usePageActivityStoreHandler(pageActivityStore4),
    };
  },
);
var usePageActivity: Dynamic = (
  pageActivity?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  usePageActivityStore(
    (pageActivity2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      pageActivity2.byPage[activityStorePageKey(pageActivity)] ??
      IDLE_ACTIVITY_STATE,
  );
function isPageActivityFresh(
  pageActivityFresh?: Dynamic,
  ..._extraArguments: unknown[]
): boolean {
  let byPageItem: Dynamic =
    usePageActivityStore.getState().byPage[
      activityStorePageKey(pageActivityFresh)
    ];
  return (
    byPageItem?.status === `ready` &&
    byPageItem.readAt !== undefined &&
    activityReadClock() - byPageItem.readAt < 3e4
  );
}
/* Subsystem: manifest-preview */
function collectDocumentReadRefs(
  node?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  let ref: Dynamic = node.attrs?.ref;
  if (typeof ref == `string` && ref) {
    options.add(ref);
  }
  if (node.content)
    for (let collectDocumentReadRefsResult of node.content as Dynamic)
      collectDocumentReadRefs(collectDocumentReadRefsResult, options);
}
function collectManifestReferences(
  file?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let runs: Dynamic = new (Set as Dynamic)();
  let reads: Dynamic = new (Set as Dynamic)();
  for (let collectManifestReferencesResult of Object.values(
    file.nodes,
  ) as Dynamic)
    if (
      !(
        !collectManifestReferencesResult ||
        typeof collectManifestReferencesResult != `object`
      )
    ) {
      if (collectManifestReferencesResult.type === `prose`) {
        collectDocumentReadRefs(collectManifestReferencesResult.json, reads);
      }
    }
  return {
    runs: runs,
    reads: reads,
  };
}
var functionRunsLoadEpochs: Dynamic = new (Map as Dynamic)();
var functionListRequests: Dynamic = new (Map as Dynamic)();
var loadFunctionList: Dynamic = (
  functionList?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let functionListRequestEntry: Dynamic =
    functionListRequests.get(functionList);
  if (functionListRequestEntry !== undefined) return functionListRequestEntry;
  let list: Dynamic = api.functions.list(functionList);
  functionListRequests.set(functionList, list);
  list
    .then(
      (..._extraArguments: unknown[]): undefined => {},
      (..._extraArguments: unknown[]): undefined => {},
    )
    .then((..._extraArguments: unknown[]): undefined => {
      if (functionListRequests.get(functionList) === list) {
        functionListRequests.delete(functionList);
      }
    });
  return list;
};
var functionRunsLoadEpoch: number = 0;
var useFunctionRunStore: Dynamic = create(
  (
    functionRunStore?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => ({
    entries: {},
    load: async (
      functionRunStore2?: Dynamic,
      options2?: Dynamic,
      context?: Dynamic,
      ..._extraArguments: unknown[]
    ): Promise<undefined> => {
      let useFunctionRunStoreResult: number = ++functionRunsLoadEpoch;
      functionRunsLoadEpochs.set(functionRunStore2, useFunctionRunStoreResult);
      let address: Dynamic = await loadFunctionList(options2)
        .then(
          (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
            filterDataContentAndReferencesFilter(result, context) ?? null,
        )
        .catch((..._extraArguments: unknown[]): Dynamic => context);
      let run: Dynamic;
      try {
        run =
          address === null
            ? null
            : ((await api.functions.runs(options2, address, 1))[0] ?? null);
      } catch {
        run = null;
      }
      if (
        functionRunsLoadEpochs.get(functionRunStore2) ===
        useFunctionRunStoreResult
      ) {
        functionRunStore({
          entries: {
            ...options().entries,
            [functionRunStore2]: {
              run: run,
              address: address,
            },
          },
        });
      }
    },
    release: (
      functionRunStore2?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      functionRunsLoadEpochs.delete(functionRunStore2);
      if (functionRunStore2 in options().entries) {
        let { [functionRunStore2]: entries, ...entries2 }: Dynamic =
          options().entries;
        functionRunStore({
          entries: entries2,
        });
      }
    },
  }),
);
var loadManifestFilm: Dynamic = (
  manifestFilm?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => api.manifestFilmBlob(manifestFilm);
var loadManifestWidgetFilm: Dynamic = (
  manifestWidgetFilm?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => api.manifestWidgetFilmBundle(manifestWidgetFilm, options);
async function tryLoadManifestFilmBytes(
  tryLoadManifestFilmBytes2?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  try {
    return new (Uint8Array as Dynamic)(
      await api.manifestFilmBlobBytes(tryLoadManifestFilmBytes2),
    );
  } catch {
    return null;
  }
}
var BLOB_SHA_PATTERN: Dynamic = /^[0-9a-f]{64}$/;
var DOCUMENT_MANIFEST_ID: string = `ln-doc`;
var BODY_MANIFEST_ID: string = `ln-body`;
function manifestFromDocument(
  node?: Dynamic,
  file: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  let body: Dynamic =
    file.bodyLid !== undefined && file.bodyLid.startsWith(`ln-`)
      ? file.bodyLid
      : BODY_MANIFEST_ID;
  let root: Dynamic =
    body === `ln-doc` ? `${DOCUMENT_MANIFEST_ID}-root` : DOCUMENT_MANIFEST_ID;
  let content: Dynamic =
    Array.isArray(node.content) && node.content.length > 0
      ? node.content
      : [
          {
            type: `paragraph`,
          },
        ];
  return {
    version: 1,
    sha: `000000`,
    root: root,
    nodes: {
      ...file.nodes,
      [root]: {
        type: `document`,
        body: body,
      },
      [body]: {
        type: `prose`,
        json: {
          type: `doc`,
          content: content,
        },
      },
    },
    ...(file.styleSheet === undefined
      ? {}
      : {
          styleSheet: file.styleSheet,
        }),
  };
}
function withManifestRedline(
  file?: Dynamic,
  redline?: Dynamic,
  redlineOpts?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let nodeItem: Dynamic = file.nodes[file.root];
  if (nodeItem?.type !== `document` || typeof nodeItem.body != `string`)
    return file;
  let body: Dynamic = nodeItem.body;
  let nodeItem2: Dynamic = file.nodes[body];
  if (nodeItem2?.type !== `prose`) return file;
  let matchesRedline: boolean =
    nodeItem2.redline !== undefined && nodeItem2.redline !== null;
  if (redline == null) {
    if (!matchesRedline) return file;
    let {
      redline: nodeItem3,
      redlineOpts: nodeItem4,
      ...nodeItem5
    }: Dynamic = nodeItem2;
    return {
      ...file,
      nodes: {
        ...file.nodes,
        [body]: nodeItem5,
      },
    };
  }
  return nodeItem2.redline === redline
    ? file
    : {
        ...file,
        nodes: {
          ...file.nodes,
          [body]: {
            ...nodeItem2,
            redline: redline,
            ...(redlineOpts === undefined
              ? {}
              : {
                  redlineOpts: redlineOpts,
                }),
          },
        },
      };
}
function documentFromManifest(
  file?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let nodeItem: Dynamic = file.nodes[file.root];
  if (nodeItem?.type !== `document` || typeof nodeItem.body != `string`)
    return null;
  let nodeItem2: Dynamic = file.nodes[nodeItem.body];
  return nodeItem2?.type === `prose` &&
    nodeItem2.json !== null &&
    typeof nodeItem2.json == `object`
    ? nodeItem2.json
    : null;
}
var CODE_DIFF_UNCHECKED_PREFIX: string = `code-diff: `;
var pluralizeDiffCount = (
  pluralizeDiffCount2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
) =>
  pluralizeDiffCount2 === 1
    ? `1 ${options}`
    : `${pluralizeDiffCount2} ${context}`;
var uniqueValues: Dynamic = (
  uniqueValues2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => [...new (Set as Dynamic)(uniqueValues2)];
/* Subsystem: version-faces */
function describeUncheckedDiffs(
  describeUncheckedDiffs2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let filteredUnchecked: Dynamic = describeUncheckedDiffs2.unchecked.filter(
    (unchecked?: Dynamic, ..._extraArguments: unknown[]): boolean =>
      unchecked.ref !== null &&
      !unchecked.reason.startsWith(CODE_DIFF_UNCHECKED_PREFIX),
  );
  let filteredUnchecked2: Dynamic = describeUncheckedDiffs2.unchecked.filter(
    (unchecked?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      unchecked.ref !== null &&
      unchecked.reason.startsWith(CODE_DIFF_UNCHECKED_PREFIX),
  );
  let some: Dynamic = describeUncheckedDiffs2.unchecked.some(
    (unchecked?: Dynamic, ..._extraArguments: unknown[]) =>
      unchecked.ref === null,
  );
  let items: Dynamic = [];
  if (filteredUnchecked.length > 0) {
    let uniqueValuesCount: Dynamic = uniqueValues(
      filteredUnchecked.map(
        (
          filteredUnchecked3?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic => filteredUnchecked3.ref,
      ),
    ).length;
    items.push(
      `${pluralizeDiffCount(uniqueValuesCount, `embed`, `embeds`)} not checked (${uniqueValues(filteredUnchecked.map((filteredUnchecked3?: Dynamic, ..._extraArguments: unknown[]): Dynamic => filteredUnchecked3.reason)).join(`, `)})`,
    );
  }
  if (filteredUnchecked2.length > 0) {
    let uniqueValuesCount: Dynamic = uniqueValues(
      filteredUnchecked2.map(
        (
          filteredUnchecked3?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic => filteredUnchecked3.ref,
      ),
    ).length;
    let uniqueValuesText: Dynamic = uniqueValues(
      filteredUnchecked2.map(
        (
          filteredUnchecked3?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic => filteredUnchecked3.reason.slice(11),
      ),
    ).join(`, `);
    items.push(
      `code changes unavailable for ${pluralizeDiffCount(uniqueValuesCount, `widget`, `widgets`)} (${uniqueValuesText})`,
    );
  }
  if (describeUncheckedDiffs2.truncated) {
    items.push(`more embeds than checked`);
  }
  if (some) {
    items.push(`Changes after the newest version aren’t checked`);
  }
  return items.join(` · `);
}
var SIMPLER_COMPARISON_MESSAGE: string = `Showing a simpler comparison: this version couldn’t be compared in detail`;
async function tryDetailedDiff(
  tryDetailedDiff2?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  try {
    return {
      diff: await tryDetailedDiff2(),
    };
  } catch (error: Dynamic) {
    return {
      simpler: true,
      error: error,
    };
  }
}
var VERSION_GONE_MESSAGE: string = `This version isn’t available anymore.`;
var VERSION_SLOW_MESSAGE: string = `This version is taking too long to load.`;
var VERSION_LOAD_FAILED_MESSAGE: string = `This version couldn’t be loaded.`;
var FINAL_VERSION_REFUSAL_REASONS: Dynamic = new (Set as Dynamic)([
  `bad_request`,
  `not_found`,
  `gone`,
]);
var isVersionErrorObject: Dynamic = (
  versionErrorObject?: Dynamic,
  ..._extraArguments: unknown[]
): boolean => typeof versionErrorObject == `object` && !!versionErrorObject;
function versionLoadErrorMessage(
  response?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let code: Dynamic = isVersionErrorObject(response)
    ? response.code
    : undefined;
  let reason: Dynamic = isVersionErrorObject(response)
    ? response.reason
    : undefined;
  let status: Dynamic = isVersionErrorObject(response)
    ? response.status
    : undefined;
  return code === `TIMEOUT`
    ? {
        text: VERSION_SLOW_MESSAGE,
        retry: true,
        final: true,
      }
    : (code === `DENIED` &&
          typeof reason == `string` &&
          FINAL_VERSION_REFUSAL_REASONS.has(reason)) ||
        status === 404 ||
        status === 410
      ? {
          text: VERSION_GONE_MESSAGE,
          retry: false,
          final: true,
        }
      : {
          text: VERSION_LOAD_FAILED_MESSAGE,
          retry: true,
          final: false,
        };
}
var EMPTY_VERSION_SIDE: Dynamic = {
  doc: {
    type: `doc`,
    content: [],
  },
  runs: [],
};
var frameVersionReader: Dynamic = {
  async read(
    page?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ): Promise<Dynamic> {
    let face: Dynamic = await fetchVersionXml(page.pid, page.fileId, options);
    let match: Dynamic = /^<doc\b[^>]*\srev="(\d+)"/.exec(face);
    return {
      face: face,
      ...(match
        ? {
            rev: Number(match[1]),
          }
        : {}),
    };
  },
  async readRev(
    page?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ): Promise<Dynamic> {
    return {
      face: await fetchVersionXmlAtRev(page.pid, page.fileId, options),
    };
  },
  readFirst: (page?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
    readEarliestVersion(
      (frameVersionReader2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        fetchVersionXmlAtRev(page.pid, page.fileId, frameVersionReader2),
    ),
};
async function readEarliestVersion(
  earliestVersion?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  try {
    return {
      face: await earliestVersion(1),
      rev: 1,
    };
  } catch (readEarliestVersionResult: Dynamic) {
    let rev: Dynamic = firstAvailableRevisionFromError(
      readEarliestVersionResult,
    );
    if (rev === undefined || rev === 1) throw readEarliestVersionResult;
    return {
      face: await earliestVersion(rev),
      rev: rev,
    };
  }
}
function firstAvailableRevisionFromError(
  firstAvailableRevision?: Dynamic,
  ..._extraArguments: unknown[]
): number | undefined {
  if (
    !(
      firstAvailableRevision instanceof
      (PlatformLiveDocumentAndHistoryDENIED as Dynamic)
    ) ||
    typeof firstAvailableRevision.data != `object` ||
    firstAvailableRevision.data === null
  )
    return;
  let data: Dynamic = firstAvailableRevision.data;
  if (data.problem !== `range` && data.was !== `bad_range`) return;
  let first: Dynamic = data.expected?.first ?? data.min;
  return typeof first == `number` && Number.isInteger(first) && first >= 1
    ? first
    : undefined;
}
var standaloneVersionReader: Dynamic = {
  async read(
    page?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ): Promise<Dynamic> {
    let v3FileAt: Dynamic = await api.v3FileAt(page.pid, page.fileId, options);
    // BaoCut: 文档服务回的是编辑器读的 XML（packages/docs 的 serializeDocument），与 Frame 里按 rev 取到的一样，
    // 交给 parseVersionPreviewFace 用编辑器自己的解析器读。
    if (typeof v3FileAt.xml == `string`)
      return {
        face: v3FileAt.xml,
      };
    if (
      !v3FileAt.doc ||
      typeof v3FileAt.doc != `object` ||
      v3FileAt.doc.type !== `doc`
    )
      throw new (PlatformLiveDocumentAndHistoryDETAILSUNAVAILABLE as Dynamic)(
        `shown`,
      );
    return {
      face: {
        doc: v3FileAt.doc,
      },
    };
  },
};
function versionBlobReader(
  versionBlobReader2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return async (
    versionBlobReader3?: Dynamic,
    ..._extraArguments: unknown[]
  ): Promise<Dynamic> => {
    try {
      if (isFrameArtifact()) {
        let response: Dynamic = await frameBlobBytesResult(
          versionBlobReader2,
          versionBlobReader3,
        );
        return response.ok ? response.bytes : null;
      }
      return new (Uint8Array as Dynamic)(
        await api.blob.get(`project/${versionBlobReader2}`, versionBlobReader3),
      );
    } catch {
      return null;
    }
  };
}
async function fetchProjectEnums(
  fetchProjectEnums2?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  try {
    if (isFrameArtifact()) return await frameEnumRows(fetchProjectEnums2);
    let response: Dynamic = await rawReq(
      `GET`,
      `/api/v3/project/${encodeURIComponent(fetchProjectEnums2)}/enums`,
    );
    if (!response.ok) return null;
    let json: Dynamic = await response.json();
    return Array.isArray(json.rows) ? json.rows : [];
  } catch {
    return null;
  }
}
var projectEnumRequests: Dynamic = new (Map as Dynamic)();
function loadProjectEnums(
  projectEnums?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let projectEnumRequestEntry: Dynamic = projectEnumRequests.get(projectEnums);
  if (projectEnumRequestEntry !== undefined) return projectEnumRequestEntry;
  let then: Dynamic = fetchProjectEnums(projectEnums).then(
    (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic => (
      result === null && projectEnumRequests.delete(projectEnums),
      result
    ),
  );
  projectEnumRequests.set(projectEnums, then);
  return then;
}
function clearProjectEnumCache(..._extraArguments: unknown[]): undefined {
  projectEnumRequests.clear();
}
var versionReaderOverride: Dynamic = null;
var getVersionReader: Dynamic = (..._extraArguments: unknown[]): Dynamic =>
  versionReaderOverride ??
  (isFrameArtifact() ? frameVersionReader : standaloneVersionReader);
function collectEmbedReferences(
  collectEmbedReferences2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items: Dynamic = [];
  let uniqueItems: Dynamic = new (Set as Dynamic)();
  let collectEmbedReferencesHandler = (
    node?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (
      (node.type === `embed` || node.type === `embedInline`) &&
      node.attrs !== undefined
    ) {
      let collectEmbedReferencesResult: Dynamic =
        resolvePlatformSessionAndSourcesNode(node.attrs.ref);
      if (
        collectEmbedReferencesResult !== undefined &&
        !uniqueItems.has(collectEmbedReferencesResult)
      ) {
        uniqueItems.add(collectEmbedReferencesResult);
        items.push(collectEmbedReferencesResult);
      }
      return;
    }
    if (Array.isArray(node.content))
      for (let collectEmbedReferencesResult of node.content as Dynamic)
        collectEmbedReferencesHandler(collectEmbedReferencesResult);
  };
  collectEmbedReferencesHandler(collectEmbedReferences2);
  return items;
}
function fillMissingPreviewWidgets(
  fillMissingPreviewWidgets2?: Dynamic,
  options: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  let record: Dynamic = {};
  for (let fillMissingPreviewWidgetsResult of collectEmbedReferences(
    fillMissingPreviewWidgets2,
  ) as Dynamic)
    record[fillMissingPreviewWidgetsResult] = options[
      fillMissingPreviewWidgetsResult
    ] ?? {
      type: `widget`,
      code: ``,
      note: `Preview isn’t available for embedded content in past versions yet`,
      noteSub: `Open the current version to see it.`,
    };
  return {
    ...record,
    ...options,
  };
}
function parseVersionPreviewFace(
  items?: Dynamic,
  upto?: Dynamic,
  file: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  let parseVersionPreviewFaceResult: Dynamic;
  let runs: Dynamic = [];
  let rev: Dynamic = file.rev;
  let faceSize: Dynamic;
  if (typeof items == `string`) {
    let parseVersionPreviewFaceResult2: Dynamic =
      resolveEditorExtensionsValue25(items);
    parseVersionPreviewFaceResult = parseVersionPreviewFaceResult2.docJson;
    runs = parseVersionPreviewFaceResult2.blocks;
    if (
      rev === undefined &&
      Number.isInteger(parseVersionPreviewFaceResult2.rev) &&
      parseVersionPreviewFaceResult2.rev > 0
    ) {
      rev = parseVersionPreviewFaceResult2.rev;
    }
    faceSize = items.length;
  } else {
    parseVersionPreviewFaceResult = items.doc;
    runs = items.runs ?? [];
    faceSize = JSON.stringify(items.doc).length;
  }
  let file2: Dynamic = manifestFromDocument(parseVersionPreviewFaceResult, {
    bodyLid: file.bodyLid,
    styleSheet: file.styleSheet,
    nodes: fillMissingPreviewWidgets(parseVersionPreviewFaceResult, file.nodes),
  });
  let doc: Dynamic =
    documentFromManifest(file2) ?? parseVersionPreviewFaceResult;
  return {
    upto: upto,
    rev: rev,
    file: file2,
    doc: doc,
    runs: runs,
    blocks: Array.isArray(doc.content) ? doc.content.length : 0,
    faceSize: faceSize,
  };
}
var versionFaceCache: Dynamic = new (Map as Dynamic)();
var versionFaceRequests: Dynamic = new (Map as Dynamic)();
var revisionFaceCache: Dynamic = new (Map as Dynamic)();
var revisionFaceRequests: Dynamic = new (Map as Dynamic)();
var versionFaceCacheScope: string = ``;
var versionPageKey = (page?: Dynamic, ..._extraArguments: unknown[]) =>
  `${page.pid}/${page.fileId}`;
var versionFaceKey = (
  versionFaceKey2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) => `${versionPageKey(versionFaceKey2)}/${options}`;
var revisionFaceKey = (
  revisionFaceKey2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) => `${versionPageKey(revisionFaceKey2)}/rev:${options}`;
function ensureVersionFaceCacheScope(
  ensureVersionFaceCacheScope2?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  let versionPageKey2: string = versionPageKey(ensureVersionFaceCacheScope2);
  if (versionFaceCacheScope !== versionPageKey2) {
    versionFaceCache.clear();
    revisionFaceCache.clear();
    versionFaceCacheScope = versionPageKey2;
  }
}
function touchRevisionFaceCache(
  touchRevisionFaceCache2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  revisionFaceCache.delete(touchRevisionFaceCache2);
  revisionFaceCache.set(touchRevisionFaceCache2, options);
  for (let touchRevisionFaceCacheResult of revisionFaceCache.keys() as Dynamic) {
    if (revisionFaceCache.size <= 6) break;
    revisionFaceCache.delete(touchRevisionFaceCacheResult);
  }
}
function touchVersionFaceCache(
  touchVersionFaceCache2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  versionFaceCache.delete(touchVersionFaceCache2);
  versionFaceCache.set(touchVersionFaceCache2, options);
  for (let touchVersionFaceCacheResult of versionFaceCache.keys() as Dynamic) {
    if (versionFaceCache.size <= 6) break;
    versionFaceCache.delete(touchVersionFaceCacheResult);
  }
}
function getCachedVersionFace(
  cachedVersionFace?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  ensureVersionFaceCacheScope(cachedVersionFace);
  let versionFaceKey2: string = versionFaceKey(cachedVersionFace, options);
  let versionFaceCacheEntry: Dynamic = versionFaceCache.get(versionFaceKey2);
  if (versionFaceCacheEntry !== undefined) {
    touchVersionFaceCache(versionFaceKey2, versionFaceCacheEntry);
  }
  return versionFaceCacheEntry;
}
async function loadVersionFace(
  page?: Dynamic,
  options?: Dynamic,
  context: Dynamic = {},
  dependencies: Dynamic = getVersionReader(),
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let cachedVersionFace: Dynamic = getCachedVersionFace(page, options);
  if (cachedVersionFace !== undefined) return cachedVersionFace;
  let isCurrentRow2: Dynamic = isCurrentRow(page.pid, page.fileId, options);
  let label: string = isCurrentRow2
    ? `${versionFaceKey(page, options)}~head`
    : versionFaceKey(page, options);
  let versionFaceRequestEntry: Dynamic = versionFaceRequests.get(label);
  if (versionFaceRequestEntry !== undefined) return versionFaceRequestEntry;
  let record: Dynamic = {};
  record.p = (async (..._extraArguments: unknown[]): Promise<Dynamic> => {
    let { face: page2, rev: rev }: Dynamic = await dependencies.read(
      page,
      options,
    );
    let versionPreviewFace: Dynamic = parseVersionPreviewFace(page2, options, {
      rev: rev,
      ...context,
    });
    let record2: Dynamic = isCurrentRow2
      ? {
          ...versionPreviewFace,
          head: true,
        }
      : versionPreviewFace;
    if (
      versionFaceCacheScope === versionPageKey(page) &&
      versionFaceRequests.get(label) === record.p &&
      !isCurrentRow2
    ) {
      touchVersionFaceCache(label, record2);
    }
    return record2;
  })().finally((..._extraArguments: unknown[]): undefined => {
    if (versionFaceRequests.get(label) === record.p) {
      versionFaceRequests.delete(label);
    }
  });
  versionFaceRequests.set(label, record.p);
  return record.p;
}
function loadRevisionFace(
  revisionFace?: Dynamic,
  rev?: Dynamic,
  context: Dynamic = getVersionReader(),
  ..._extraArguments: unknown[]
): Dynamic {
  let bind: Dynamic = context.readRev?.bind(context);
  return loadSpecialVersionFace(
    revisionFace,
    revisionFaceKey(revisionFace, rev),
    bind &&
      (async (..._extraArguments: unknown[]): Promise<Dynamic> => ({
        ...(await bind(revisionFace, rev)),
        rev: rev,
      })),
    false,
  );
}
function loadFirstVersionFace(
  firstVersionFace?: Dynamic,
  options: Dynamic = getVersionReader(),
  ..._extraArguments: unknown[]
): Dynamic {
  let bind: Dynamic = options.readFirst?.bind(options);
  return loadSpecialVersionFace(
    firstVersionFace,
    `${versionPageKey(firstVersionFace)}/first`,
    bind &&
      ((..._extraArguments: unknown[]): Dynamic => bind(firstVersionFace)),
    true,
  );
}
function isEmptyVersionDocument(
  node?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return (Array.isArray(node.content) ? node.content : []).every(
    (node2?: Dynamic, ..._extraArguments: unknown[]): boolean =>
      node2.type === `paragraph` &&
      (node2.content === undefined || node2.content.length === 0),
  );
}
function loadSpecialVersionFace(
  specialVersionFace?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  ensureVersionFaceCacheScope(specialVersionFace);
  let revisionFaceCacheEntry: Dynamic = revisionFaceCache.get(options);
  if (revisionFaceCacheEntry !== undefined) {
    touchRevisionFaceCache(options, revisionFaceCacheEntry);
    return Promise.resolve(revisionFaceCacheEntry);
  }
  let revisionFaceRequestEntry: Dynamic = revisionFaceRequests.get(options);
  if (revisionFaceRequestEntry !== undefined) return revisionFaceRequestEntry;
  if (context === undefined)
    return Promise.reject(
      new (PlatformLiveDocumentAndHistoryDETAILSUNAVAILABLE as Dynamic)(
        `shown`,
      ),
    );
  let record: Dynamic = {};
  record.p = (async (..._extraArguments: unknown[]): Promise<Dynamic> => {
    let { face: context2, rev: rev }: Dynamic = await context();
    let sideOf2: Dynamic = sideOf(context2);
    let record2: Dynamic = {
      doc:
        dependencies && isEmptyVersionDocument(sideOf2.doc)
          ? EMPTY_VERSION_SIDE.doc
          : (documentFromManifest(manifestFromDocument(sideOf2.doc)) ??
            sideOf2.doc),
      runs: sideOf2.runs,
      rev: rev,
    };
    if (
      versionFaceCacheScope === versionPageKey(specialVersionFace) &&
      revisionFaceRequests.get(options) === record.p
    ) {
      touchRevisionFaceCache(options, record2);
    }
    return record2;
  })().finally((..._extraArguments: unknown[]): undefined => {
    if (revisionFaceRequests.get(options) === record.p) {
      revisionFaceRequests.delete(options);
    }
  });
  revisionFaceRequests.set(options, record.p);
  return record.p;
}
async function prewarmVersionFaces(
  prewarmVersionFaces2?: Dynamic,
  options?: Dynamic,
  context: Dynamic = {},
  dependencies: Dynamic = getVersionReader(),
  argument: Dynamic = (..._extraArguments: unknown[]) => true,
  ..._extraArguments: unknown[]
): Promise<undefined> {
  for (let prewarmVersionFacesResult of options as Dynamic) {
    if (!argument()) return;
    try {
      await loadVersionFace(
        prewarmVersionFaces2,
        prewarmVersionFacesResult,
        context,
        dependencies,
      );
    } catch {}
  }
}
function clearVersionFaceCaches(..._extraArguments: unknown[]): undefined {
  versionFaceCache.clear();
  versionFaceRequests.clear();
  revisionFaceCache.clear();
  revisionFaceRequests.clear();
  versionFaceCacheScope = ``;
}
function neighboringVersionRevisions(
  neighboringVersionRevisions2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let toSorted: Dynamic = [
    ...new (Set as Dynamic)(neighboringVersionRevisions2),
  ].toSorted(
    (item?: Dynamic, item2?: Dynamic, ..._extraArguments: unknown[]): number =>
      item2 - item,
  );
  let toSortedIndex: Dynamic = toSorted.indexOf(options);
  return toSortedIndex < 0
    ? []
    : [toSorted[toSortedIndex - 1], toSorted[toSortedIndex + 1]].filter(
        (item?: Dynamic, ..._extraArguments: unknown[]) => item !== undefined,
      );
}
var DIFF_MARK_TYPES: Dynamic = {
  ins: `diffIns`,
  del: `diffDel`,
  fmt: `diffFmt`,
};
var MAX_DIFF_COLUMN_SPAN: number = 1e3;
var MAX_DIFF_ROW_SPAN: number = 1e3;
var DIFF_ATTRIBUTE_NAMES: Dynamic = {
  kind: `diff`,
  id: `diffId`,
  summary: `diffSummary`,
  before: `diffBefore`,
  ghost: `diffGhost`,
  moveTo: `diffMoveTo`,
  pair: `diffPair`,
  unchecked: `diffUnchecked`,
  face: `diffFace`,
};
var DIFF_THEME_TOKEN_VALUES: Dynamic = {
  light: {
    "--cds-bg-success": `#caeac7`,
    "--cds-text-success": `#006300`,
    "--cds-bg-danger": `#fad6d6`,
    "--cds-text-danger": `#8e2626`,
    "--cds-fill-accent": `#2a78d6`,
    "--cds-bg-accent": `#cde2fb`,
    "--cds-page-bg": `#f9f9f7`,
    "--cds-text-primary": `#0b0b0b`,
    "--cds-border": `rgba(11,11,11,0.1)`,
    "--cds-surface-1": `#fcfcfb`,
    "--cds-text-secondary": `#52514e`,
    "--cds-bg-neutral": `rgba(11,11,11,0.05)`,
    "--cds-blue-500": `#256abf`,
    "--cds-blue-400": `#3987e5`,
    "--cds-bg-warning": `#f9dca4`,
  },
  dark: {
    "--cds-bg-success": `#11260f`,
    "--cds-text-success": `#0ca30c`,
    "--cds-bg-danger": `#3c0e0e`,
    "--cds-text-danger": `#ec7e7e`,
    "--cds-fill-accent": `#2a78d6`,
    "--cds-bg-accent": `#032042`,
    "--cds-page-bg": `#0b0b0b`,
    "--cds-text-primary": `#f0efec`,
    "--cds-border": `rgba(255,255,255,0.1)`,
    "--cds-surface-1": `#151515`,
    "--cds-text-secondary": `#c3c2b7`,
    "--cds-bg-neutral": `rgba(255,255,255,0.05)`,
    "--cds-blue-500": `#256abf`,
    "--cds-blue-400": `#3987e5`,
    "--cds-bg-warning": `#311a00`,
  },
};
var DIFF_PALETTE_TOKENS: Dynamic = {
  insBg: `--cds-bg-success`,
  insLine: `--cds-text-success`,
  delBg: `--cds-bg-danger`,
  delLine: `--cds-text-danger`,
  activeRing: `--cds-fill-accent`,
  activeGlow: `--cds-bg-accent`,
  cardRule: `--cds-border`,
  cardBg: `--cds-surface-1`,
  cardInk: `--cds-text-secondary`,
  codeInk: `--cds-text-primary`,
  neutralBg: `--cds-bg-neutral`,
  calloutInfo: `--cds-bg-accent`,
  calloutSuccess: `--cds-bg-success`,
  calloutWarning: `--cds-bg-warning`,
  quietLine: `--cds-text-secondary`,
};
var DIFF_MODE_PALETTE_TOKENS: Dynamic = {
  light: {
    ...DIFF_PALETTE_TOKENS,
    linkInk: `--cds-blue-500`,
  },
  dark: {
    ...DIFF_PALETTE_TOKENS,
    linkInk: `--cds-blue-400`,
  },
};
var DIFF_MODE_PALETTES: Dynamic = {
  light: resolveDiffPalette(`light`),
  dark: resolveDiffPalette(`dark`),
};
/* Subsystem: diff-styles */
function resolveDiffPalette(
  diffPalette?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let DIFFMODEPALETTETOKENSItem: Dynamic =
    DIFF_MODE_PALETTE_TOKENS[diffPalette];
  return Object.fromEntries(
    Object.keys(DIFFMODEPALETTETOKENSItem).map(
      (
        DIFFMODEPALETTETOKENSItemKey?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => [
        DIFFMODEPALETTETOKENSItemKey,
        {
          token: DIFFMODEPALETTETOKENSItem[DIFFMODEPALETTETOKENSItemKey],
          value:
            DIFF_THEME_TOKEN_VALUES[diffPalette][
              DIFFMODEPALETTETOKENSItem[DIFFMODEPALETTETOKENSItemKey]
            ],
        },
      ],
    ),
  );
}
var diffPaletteCss = (
  diffPaletteCss2?: Dynamic,
  ..._extraArguments: unknown[]
) => {
  let DIFFMODEPALETTESItem: Dynamic = DIFF_MODE_PALETTES[diffPaletteCss2];
  return `--vh-ins-bg:${DIFFMODEPALETTESItem.insBg.value};--vh-ins-line:${DIFFMODEPALETTESItem.insLine.value};--vh-del-bg:${DIFFMODEPALETTESItem.delBg.value};--vh-del-line:${DIFFMODEPALETTESItem.delLine.value};--vh-active-ring:${DIFFMODEPALETTESItem.activeRing.value};--vh-active-glow:${DIFFMODEPALETTESItem.activeGlow.value};--vh-card-rule:${DIFFMODEPALETTESItem.cardRule.value};--vh-card-bg:${DIFFMODEPALETTESItem.cardBg.value};--vh-card-ink:${DIFFMODEPALETTESItem.cardInk.value};--vh-code-ink:${DIFFMODEPALETTESItem.codeInk.value};--vh-neutral-bg:${DIFFMODEPALETTESItem.neutralBg.value};--vh-link:${DIFFMODEPALETTESItem.linkInk.value};--vh-callout-info:${DIFFMODEPALETTESItem.calloutInfo.value};--vh-callout-success:${DIFFMODEPALETTESItem.calloutSuccess.value};--vh-callout-warning:${DIFFMODEPALETTESItem.calloutWarning.value};--vh-quiet:${DIFFMODEPALETTESItem.quietLine.value}`;
};
var DIFF_BLOCK_SELECTOR: string = `p,h1,h2,h3,h4,h5,h6,li,ul,ol,blockquote,pre,dt,dd`;
var DIFF_WIDGET_SELECTOR: string = `figure,[data-lfile-embed],details.vh-widget-code`;
var DIFF_PENDING_SELECTOR: string = `[data-ldoc-pending]`;
var DIFF_HEADING_SELECTOR: string = `h1,h2,h3,h4,h5,h6`;
var DIFF_PROSE_SELECTOR: string = `p,${DIFF_HEADING_SELECTOR},dt,dd`;
var DIFF_CHECKLIST_STRIKE_SELECTOR: string = `ul[data-kind=check]>li[data-checked=true]:is([data-diff=chg],[data-diff=move]):not(.vh-moved)>div>p:first-child:not(:has(ins.vh-ins,del.vh-del))`;
var DIFF_ATOM_SELECTOR: string = `.ldoc-chip,.ldoc-mention,a[data-ref-chip],.lfile-pm-media,.lfile-pm-media-card,img,video,[data-diff-atom]`;
var DIFF_INLINE_SELECTOR: string = `:is(a,span,strong,em,b,i,u,s,code,mark,sub,sup,small):not(:is(${DIFF_ATOM_SELECTOR}),[data-lfile-embed],[data-pm])`;
var DIFF_DELETED_INLINE_SELECTOR: string = `:is(del.vh-del,${DIFF_INLINE_SELECTOR}[data-diff=del])`;
var DIFF_ACTIVE_SELECTOR: string = `:is([data-diff-active],[id^="vh-"]:target)`;
var DIFF_STRIKE_THICKNESS: string = `max(1.5px,.12em)`;
var DIFF_DOCUMENT_SELECTOR: string = `[data-lfile-doc] .ProseMirror`;
var DIFF_MOVED_WRAPPER_SELECTOR: string = `.vh-moved,label.ldoc-check,div`;
var DIFF_MOVED_CONTAINER_SELECTORS: string = [
  `:is(${DIFF_BLOCK_SELECTOR}):has(>.vh-moved):not(:has(>:not(.vh-moved)))`,
  `li:has(.vh-moved):not(:has(>:not(${DIFF_MOVED_WRAPPER_SELECTOR}))):not(:has(>div:not(.vh-moved)>:not(.vh-moved)))`,
  `:is(ul,ol):has(.vh-moved):not(:has(>:not(li))):not(:has(>li:not(.vh-moved)>:not(${DIFF_MOVED_WRAPPER_SELECTOR}))):not(:has(>li>div:not(.vh-moved)>:not(.vh-moved)))`,
].join(`,`);
var DIFF_MOVED_ROW_SELECTOR: string = `tr:has(.vh-moved):not(:has(>:not(td,th))):not(:has(>:is(td,th):not(.vh-moved)>:not(.vh-moved)))`;
var DIFF_MOVED_TABLE_SELECTOR: string = [
  `:is(td,th):has(>.vh-moved):not(:has(>:not(.vh-moved)))`,
  DIFF_MOVED_ROW_SELECTOR,
  `table:has(tr.vh-moved):not(:has(tr:not(.vh-moved)))`,
].join(`,`);
`${DIFF_MOVED_CONTAINER_SELECTORS}${DIFF_MOVED_TABLE_SELECTOR}`;
var DIFF_STRIKE_CSS: string = `text-decoration-line:line-through;text-decoration-color:var(--vh-del-line);text-decoration-style:var(--vh-strike-style,solid);text-decoration-thickness:${DIFF_STRIKE_THICKNESS}`;
var DIFF_DELETED_BLOCK_SELECTOR: string = `:is(${DIFF_BLOCK_SELECTOR})[data-diff=del],:is(td,th)[data-diff=del],tr[data-diff=del]>:is(td,th),table[data-diff=del] :is(td,th)`;
var DIFF_EXISTING_STRIKE_SELECTOR: string = `s,strike,del:not(.vh-del)`;
var VERSION_DIFF_CSS: string = `:root{${diffPaletteCss(`light`)}}\n@media (prefers-color-scheme:dark){:root{${diffPaletteCss(`dark`)}}}\n[data-mode=dark],[data-theme=dark]{${diffPaletteCss(`dark`)}}\n[data-mode=light],[data-theme=light]{${diffPaletteCss(`light`)}}\nins.vh-ins,[data-diff=ins]{--vh-w:var(--vh-ins-bg);--vh-l:var(--vh-ins-line)}\ndel.vh-del,[data-diff=del]{--vh-w:var(--vh-del-bg);--vh-l:var(--vh-del-line)}\n.vh-fmt,[data-diff=chg],[data-diff=move]{--vh-w:transparent;--vh-l:var(--vh-quiet)}\n:is(ins.vh-ins,del.vh-del,.vh-fmt,${DIFF_INLINE_SELECTOR}[data-diff]){color:inherit;background:var(--vh-w);border-radius:2px;-webkit-box-decoration-break:clone;box-decoration-break:clone;text-decoration-color:var(--vh-l);text-decoration-thickness:${DIFF_STRIKE_THICKNESS};text-decoration-skip-ink:none}\n:is(ins.vh-ins,${DIFF_INLINE_SELECTOR}[data-diff=ins]){text-decoration-line:underline;text-decoration-style:solid;text-underline-offset:.32em}\n:is(ins.vh-ins,${DIFF_INLINE_SELECTOR}[data-diff=ins]) u{text-underline-offset:auto}\n:is(${DIFF_HEADING_SELECTOR})[data-diff=ins]:not(:is(td,th) *) ins.vh-ins,:is(:is(td,th)[data-diff=ins],tr[data-diff=ins]>:is(td,th)) ins.vh-ins,:is(${DIFF_HEADING_SELECTOR})[data-diff=del]:not(:is(td,th) *) del.vh-del,:is(:is(td,th)[data-diff=del],tr[data-diff=del]>:is(td,th)) del.vh-del{background:none}\n${DIFF_DELETED_INLINE_SELECTOR}{${DIFF_STRIKE_CSS}}\n:is(.vh-fmt,${DIFF_INLINE_SELECTOR}:is([data-diff=chg],[data-diff=move])),:is(${DIFF_PROSE_SELECTOR}):is([data-diff=chg],[data-diff=move]):not(.vh-moved,:has(ins.vh-ins,del.vh-del)),li:is([data-diff=chg],[data-diff=move]):not(.vh-moved)>:is(${DIFF_PROSE_SELECTOR}):first-child:not(:has(ins.vh-ins,del.vh-del)),li:is([data-diff=chg],[data-diff=move]):not(.vh-moved)>div>:is(${DIFF_PROSE_SELECTOR}):first-child:not(:has(ins.vh-ins,del.vh-del)){text-decoration-line:underline;text-decoration-style:dotted;text-decoration-color:var(--vh-l);text-decoration-thickness:1px;text-underline-offset:.3em;text-decoration-skip-ink:none}\n:is(ul,ol,blockquote):is([data-diff=chg],[data-diff=move]):not(.ldoc-callout,[data-callout],.vh-moved){outline:1px dotted var(--vh-l);outline-offset:3px;border-radius:4px}\n${DIFF_CHECKLIST_STRIKE_SELECTOR}{width:fit-content;max-width:100%;background-image:repeating-linear-gradient(to right,var(--vh-l) 0 2px,transparent 2px 4px);background-position:left bottom;background-size:100% 1px;background-repeat:no-repeat}\n:is(td,th)[data-align=center] ${DIFF_CHECKLIST_STRIKE_SELECTOR}{margin-inline:auto}\n:is(td,th)[data-align=right] ${DIFF_CHECKLIST_STRIKE_SELECTOR}{margin-inline-start:auto}\n:is(.vh-ins,.vh-del,:is(${DIFF_HEADING_SELECTOR},td,th):is([data-diff=ins],[data-diff=del]),tr:is([data-diff=ins],[data-diff=del])>:is(td,th)) :is(mark,:not(pre)>code,kbd){box-shadow:inset 0 0 0 100vmax var(--vh-w)}\n:is(${DIFF_HEADING_SELECTOR}):is([data-diff=ins],[data-diff=del]):not(:is(td,th) *){width:fit-content;max-width:100%;border-radius:2px;box-shadow:inset 0 0 0 100vmax var(--vh-w)}\n:is(${DIFF_HEADING_SELECTOR}):is([data-diff=ins],[data-diff=del]):is([data-align=center],[style*="text-align:center"],[style*="text-align: center"]){margin-inline:auto}\n:is(${DIFF_HEADING_SELECTOR}):is([data-diff=ins],[data-diff=del]):is([data-align=right],[style*="text-align:right"],[style*="text-align: right"]){margin-inline-start:auto}\n[data-lfile-doc] .ProseMirror blockquote[data-callout]{border:0;border-radius:10px;padding:10px 14px;background:var(--vh-callout-info)}\n[data-lfile-doc] .ProseMirror blockquote[data-callout=success]{background:var(--vh-callout-success)}[data-lfile-doc] .ProseMirror blockquote[data-callout=warning]{background:var(--vh-callout-warning)}\nblockquote:is(.ldoc-callout,[data-callout])[data-diff]{outline:2px solid var(--vh-l);outline-offset:2px}\nblockquote:is(.ldoc-callout,[data-callout]):is([data-diff=chg],[data-diff=move]){outline:1px dotted var(--vh-l);outline-offset:3px}\n${DIFF_DOCUMENT_SELECTOR} :is(${DIFF_MOVED_CONTAINER_SELECTORS}){box-shadow:none;background:none;border:0;padding:0;color:inherit;text-decoration-line:none;list-style:none}\n${DIFF_DOCUMENT_SELECTOR} :is(${DIFF_MOVED_CONTAINER_SELECTORS})::before{content:none}\n${DIFF_DOCUMENT_SELECTOR} :is(${DIFF_MOVED_CONTAINER_SELECTORS})>label.ldoc-check{display:none}\n${DIFF_DOCUMENT_SELECTOR} :is(${DIFF_MOVED_TABLE_SELECTOR}){box-shadow:none;text-decoration-line:none;color:inherit}\n${DIFF_DOCUMENT_SELECTOR} :is(${DIFF_MOVED_ROW_SELECTOR})>:is(td,th):not(.vh-moved){box-shadow:none;text-decoration-line:none;color:inherit}\n${DIFF_DOCUMENT_SELECTOR} :is(${DIFF_MOVED_ROW_SELECTOR})>:first-child:not(.vh-moved)::before{content:none}\n${DIFF_DOCUMENT_SELECTOR} :is(${DIFF_MOVED_CONTAINER_SELECTORS},${DIFF_MOVED_TABLE_SELECTOR}):not(${DIFF_ACTIVE_SELECTOR}){outline:0}\n${DIFF_DOCUMENT_SELECTOR} :is(${DIFF_MOVED_CONTAINER_SELECTORS},${DIFF_MOVED_TABLE_SELECTOR})${DIFF_ACTIVE_SELECTOR}{outline:2px solid var(--vh-active-ring);outline-offset:2px;border-radius:6px}\n:is(${DIFF_BLOCK_SELECTOR})[data-diff=del]{${DIFF_STRIKE_CSS}}\npre[data-diff]{overflow:visible;white-space:pre-wrap;overflow-wrap:anywhere}\nhr[data-diff]{overflow:visible;height:0;border:0;border-top:2px solid var(--vh-l)}\nhr:is([data-diff=chg],[data-diff=move]){border-top:1px dotted var(--vh-l)}\n:is(${DIFF_WIDGET_SELECTOR})[data-diff]{outline:2px solid var(--vh-l);outline-offset:3px;border-radius:8px}\n:is(${DIFF_WIDGET_SELECTOR}):is([data-diff=chg],[data-diff=move]){outline:1px dotted var(--vh-l)}\n${DIFF_PENDING_SELECTOR}[data-diff]{position:relative;outline:2px solid var(--vh-l);outline-offset:3px;border-radius:8px}\n${DIFF_PENDING_SELECTOR}:is([data-diff=chg],[data-diff=move]){outline:1px dotted var(--vh-l)}\npre:is([data-diff=chg],[data-diff=move]){outline:1px dotted var(--vh-l);outline-offset:3px}\n:is(${DIFF_ATOM_SELECTOR})[data-diff],ins.vh-ins :is(${DIFF_ATOM_SELECTOR}):not(:is(${DIFF_ATOM_SELECTOR}) *),del.vh-del :is(${DIFF_ATOM_SELECTOR}):not(:is(${DIFF_ATOM_SELECTOR}) *){outline:2px solid var(--vh-l);outline-offset:0}\n:is(${DIFF_ATOM_SELECTOR}):is([data-diff=chg],[data-diff=move]){outline:1px dotted var(--vh-l);outline-offset:1px}\n:is(:is(${DIFF_ATOM_SELECTOR})[data-diff=del],:is(del.vh-del,:is(${DIFF_BLOCK_SELECTOR})[data-diff=del],tr[data-diff=del],:is(td,th)[data-diff=del],table[data-diff=del]) :is(${DIFF_ATOM_SELECTOR}):not(:is(${DIFF_ATOM_SELECTOR}) *)){${DIFF_STRIKE_CSS}}\n:is(:is(${DIFF_ATOM_SELECTOR})[data-diff=del],:is(del.vh-del,:is(${DIFF_BLOCK_SELECTOR})[data-diff=del],tr[data-diff=del],:is(td,th)[data-diff=del],table[data-diff=del]) :is(${DIFF_ATOM_SELECTOR}):not(:is(${DIFF_ATOM_SELECTOR}) *))>.t{${DIFF_STRIKE_CSS}}\ntable[data-diff]{outline:2px solid var(--vh-l);outline-offset:2px}\ntable:is([data-diff=chg],[data-diff=move]){outline:1px dotted var(--vh-l)}\n.tableWrapper[data-diff]>table{outline:2px solid var(--vh-l);outline-offset:2px}\n.tableWrapper:is([data-diff=chg],[data-diff=move])>table{outline:1px dotted var(--vh-l)}\ntr:is([data-diff=ins],[data-diff=del])>:is(td,th),:is(td,th):is([data-diff=ins],[data-diff=del]){box-shadow:inset 0 0 0 100vmax var(--vh-w)}\n:is(tr[data-diff=ins]>:is(td,th),:is(td,th)[data-diff=ins]){text-decoration-line:underline;text-decoration-style:solid;text-decoration-color:var(--vh-l);text-decoration-thickness:${DIFF_STRIKE_THICKNESS};text-underline-offset:.32em;text-decoration-skip-ink:none}\n:is(td,th):is([data-diff=chg],[data-diff=move]),tr[data-diff=move]:not(.vh-moved)>:is(td,th){outline:1px dotted var(--vh-l);outline-offset:-3px}\n:is(:is(td,th)[data-diff=del],tr[data-diff=del]>:is(td,th),table[data-diff=del] :is(td,th)){${DIFF_STRIKE_CSS}}\ndetails.vh-widget-code{margin:.6em 0;border:1px solid var(--vh-card-rule);border-radius:8px;background:var(--vh-card-bg)}\ndetails.vh-widget-code>summary{cursor:pointer;padding:6px 10px;color:var(--vh-card-ink);font:500 12px/1.4 "Anthropic Sans",ui-sans-serif,system-ui,sans-serif}\ndetails.vh-widget-code>pre,pre.vh-code-diff{margin:0;padding:8px 12px 10px;border-top:1px solid var(--vh-card-rule);border-radius:0 0 8px 8px;background:none;overflow-x:auto;white-space:pre;color:var(--vh-card-ink);font:12.5px/1.5 ${EditorHostMessage10}}\n:is(details.vh-widget-code,pre.vh-code-diff) pre code,pre.vh-code-diff code{font:inherit;color:inherit;background:none;padding:0}\npre.vh-code-diff :is(ins.vh-ins,del.vh-del){color:var(--vh-code-ink)}\npre.vh-code-diff .vh-code-skip{color:var(--vh-card-ink);font-style:italic;user-select:none}\n.vh-card{box-sizing:border-box;border:1px solid var(--vh-card-rule);border-radius:8px;background:var(--vh-card-bg);padding:8px 12px;max-width:100%;vertical-align:bottom}\n.vh-media{display:inline-flex;flex-direction:column;justify-content:center;min-height:48px;overflow:hidden}\n.vh-embed{display:flex;flex-direction:column;margin:12px 0}\n.vh-card-label{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.vh-card-meta{color:var(--vh-card-ink);font-size:.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\np.vh-unsupported{border:1px solid var(--vh-card-rule);border-radius:8px;background:var(--vh-neutral-bg);padding:6px 12px}\n.vh-unsupported-label{display:block;font-size:.8em;color:var(--vh-card-ink);user-select:none}\n.vh-moved[data-diff][data-diff]{--vh-w:transparent;--vh-l:var(--vh-quiet);position:relative;margin:2px 0;padding:0 0 0 2px;font-size:.8em;line-height:1.4;color:var(--vh-card-ink);background:none;box-shadow:none;outline:0;text-decoration-line:none;list-style:none}\ntr.vh-moved[data-diff][data-diff]>:is(td,th){box-shadow:none;outline:0;text-decoration-line:none;color:var(--vh-card-ink);font-size:.8em}\n[data-lfile-doc] .ProseMirror a:not(.ldoc-chip,[data-ref-chip]){color:var(--vh-link)}\n[data-lfile-doc] .ProseMirror,[data-lfile-doc] .ProseMirror :is(ins.vh-ins,del.vh-del,.vh-fmt){overflow-wrap:anywhere}\n:is(${DIFF_DELETED_INLINE_SELECTOR},${DIFF_DELETED_BLOCK_SELECTOR}):has(:is(${DIFF_EXISTING_STRIKE_SELECTOR})),:is(${DIFF_EXISTING_STRIKE_SELECTOR}) ${DIFF_DELETED_INLINE_SELECTOR}{--vh-strike-style:double}\n.vh-invisible.vh-invisible.vh-invisible{display:inline-block;margin:0 .15em;padding:0 .4em;border-radius:4px;font:500 .72em/1.55 "Anthropic Sans",ui-sans-serif,system-ui,sans-serif;letter-spacing:.02em;color:var(--vh-card-ink);white-space:nowrap;vertical-align:.12em;user-select:none;text-decoration-line:none;background:var(--vh-neutral-bg);box-shadow:inset 0 0 0 1px var(--vh-card-rule)}\n.vh-invisible.vh-invisible.vh-invisible:is([data-diff=ins],[data-diff=del],[data-diff=chg]){background:var(--vh-w);box-shadow:inset 0 0 0 1px var(--vh-l)}\n.vh-invisible.vh-invisible.vh-invisible.vh-w[data-vh-invisible=empty]:is([data-diff=ins],[data-diff=del]){font-size:0;letter-spacing:0;margin:0;padding:0;min-width:2.2rem;height:1.45rem;line-height:1.45rem;vertical-align:baseline;border-radius:2px;box-shadow:none;text-align:left}\n.vh-invisible.vh-invisible.vh-invisible.vh-w[data-vh-invisible=empty][data-diff=ins]{box-shadow:inset 0 calc(-1 * max(1.5px,.12rem)) 0 var(--vh-l)}\n.vh-invisible.vh-invisible.vh-invisible.vh-w[data-vh-invisible=empty]:is([data-diff=ins],[data-diff=del])::before{content:"\\00B6";content:"\\00B6" / "";font:400 .8rem/1.45rem "Anthropic Sans",ui-sans-serif,system-ui,sans-serif;color:var(--vh-quiet);padding:0 .35rem}\n.vh-invisible.vh-invisible.vh-invisible.vh-w[data-vh-invisible=empty][data-diff=del]::before{text-decoration:line-through solid var(--vh-l) max(1.5px,.12rem)}\n.vh-invisible.vh-invisible.vh-invisible[data-diff=del]:not([data-vh-invisible=space],[data-vh-invisible=break],[data-vh-invisible=empty]){text-decoration-line:line-through;text-decoration-style:solid;text-decoration-color:var(--vh-del-line);text-decoration-thickness:1.5px}\n:is(ins.vh-ins,del.vh-del,.vh-fmt,${DIFF_INLINE_SELECTOR}[data-diff])${DIFF_ACTIVE_SELECTOR},:is(${DIFF_BLOCK_SELECTOR},hr)[data-diff]:not(.ldoc-callout,[data-callout])${DIFF_ACTIVE_SELECTOR},:is(td,th)[data-diff]${DIFF_ACTIVE_SELECTOR}{outline:2px solid var(--vh-active-ring);outline-offset:2px}\n:is(${DIFF_BLOCK_SELECTOR},hr)[data-diff]:not(.ldoc-callout,[data-callout])${DIFF_ACTIVE_SELECTOR}{outline-offset:6px;border-radius:6px}\n:is(td,th)[data-diff]${DIFF_ACTIVE_SELECTOR}{outline-offset:-2px}\ntr[data-diff]${DIFF_ACTIVE_SELECTOR}>:is(td,th){outline:0;box-shadow:inset 0 2px 0 var(--vh-active-ring),inset 0 -2px 0 var(--vh-active-ring),inset 0 0 0 100vmax var(--vh-w)}\ntr[data-diff]${DIFF_ACTIVE_SELECTOR}>:first-child{box-shadow:inset 2px 0 0 var(--vh-active-ring),inset 0 2px 0 var(--vh-active-ring),inset 0 -2px 0 var(--vh-active-ring),inset 0 0 0 100vmax var(--vh-w)}\ntr[data-diff]${DIFF_ACTIVE_SELECTOR}>:last-child{box-shadow:inset -2px 0 0 var(--vh-active-ring),inset 0 2px 0 var(--vh-active-ring),inset 0 -2px 0 var(--vh-active-ring),inset 0 0 0 100vmax var(--vh-w)}\ntr[data-diff]${DIFF_ACTIVE_SELECTOR}>:first-child:last-child{box-shadow:inset 0 0 0 2px var(--vh-active-ring),inset 0 0 0 100vmax var(--vh-w)}\n:is(${DIFF_ATOM_SELECTOR})[data-diff]${DIFF_ACTIVE_SELECTOR},:is(ins.vh-ins,del.vh-del)${DIFF_ACTIVE_SELECTOR} :is(${DIFF_ATOM_SELECTOR}):not(:is(${DIFF_ATOM_SELECTOR}) *){box-shadow:0 0 0 4px var(--vh-active-ring),0 0 6px 5px var(--vh-active-glow)}\n:is(${DIFF_WIDGET_SELECTOR},${DIFF_PENDING_SELECTOR},table,blockquote.ldoc-callout,blockquote[data-callout])[data-diff]${DIFF_ACTIVE_SELECTOR}{box-shadow:0 0 0 7px var(--vh-active-glow),0 0 0 8px var(--vh-active-ring)}\n[data-diff-id]{scroll-margin-block:30vh}\n@media print{:is(.vh-ins,.vh-del,.vh-fmt,[data-diff]){-webkit-print-color-adjust:exact;print-color-adjust:exact}}\n`;
/* Subsystem: diff-sequences */
function stableStringify(
  stableStringify2?: Dynamic,
  ..._extraArguments: unknown[]
): string {
  return JSON.stringify(sortObjectKeys(stableStringify2));
}
function sortObjectKeys(
  sortObjectKeys2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (Array.isArray(sortObjectKeys2))
    return sortObjectKeys2.map(sortObjectKeys);
  if (typeof sortObjectKeys2 == `object` && sortObjectKeys2) {
    let record: Dynamic = {};
    for (let sortObjectKeysResult of Object.keys(
      sortObjectKeys2,
    ).toSorted() as Dynamic)
      Object.defineProperty(record, sortObjectKeysResult, {
        value: sortObjectKeys(sortObjectKeys2[sortObjectKeysResult]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    return record;
  }
  return sortObjectKeys2;
}
var DiffStepBudgetExceeded: Dynamic = class extends Error {
  [key: string]: Dynamic;
  constructor(..._extraArguments: unknown[]) {
    super(`version diff step budget exceeded`);
  }
};
function sequenceMatches(
  items?: Dynamic,
  items2?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items3: Dynamic = [];
  bisectSequenceMatches(
    items,
    items2,
    0,
    items.length,
    0,
    items2.length,
    items3,
    context,
  );
  return items3;
}
function bisectSequenceMatches(
  bisectSequenceMatches2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  argument2?: Dynamic,
  argument3?: Dynamic,
  argument4?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  let context2: Dynamic = context;
  let argument5: Dynamic = argument;
  for (
    ;
    context2 < dependencies &&
    argument5 < argument2 &&
    bisectSequenceMatches2[context2] === options[argument5];

  ) {
    argument3.push(context2, argument5);
    context2++;
    argument5++;
  }
  let index: number = 0;
  for (
    ;
    context2 < dependencies - index &&
    argument5 < argument2 - index &&
    bisectSequenceMatches2[dependencies - 1 - index] ===
      options[argument2 - 1 - index];

  )
    index++;
  let difference: number = dependencies - index;
  let difference2: number = argument2 - index;
  if (context2 < difference && argument5 < difference2) {
    let findSequenceMiddleSnake2: Dynamic = findSequenceMiddleSnake(
      bisectSequenceMatches2,
      options,
      context2,
      difference,
      argument5,
      difference2,
      argument4,
    );
    if (
      findSequenceMiddleSnake2 !== null &&
      !(
        findSequenceMiddleSnake2[0] === context2 &&
        findSequenceMiddleSnake2[1] === argument5
      ) &&
      !(
        findSequenceMiddleSnake2[0] === difference &&
        findSequenceMiddleSnake2[1] === difference2
      )
    ) {
      bisectSequenceMatches(
        bisectSequenceMatches2,
        options,
        context2,
        findSequenceMiddleSnake2[0],
        argument5,
        findSequenceMiddleSnake2[1],
        argument3,
        argument4,
      );
      bisectSequenceMatches(
        bisectSequenceMatches2,
        options,
        findSequenceMiddleSnake2[0],
        difference,
        findSequenceMiddleSnake2[1],
        difference2,
        argument3,
        argument4,
      );
    }
  }
  for (let index2: number = 0; index2 < index; index2++)
    argument3.push(difference + index2, difference2 + index2);
}
function findSequenceMiddleSnake(
  findSequenceMiddleSnake2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  argument2?: Dynamic,
  argument3?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let difference: number = dependencies - context;
  let difference2: number = argument2 - argument;
  let ceil: number = Math.ceil((difference + difference2) / 2);
  let ceil2: Dynamic = ceil;
  let total: number = 2 * ceil + 2;
  let fill: Dynamic = new (Int32Array as Dynamic)(total).fill(-1);
  let fill2: Dynamic = new (Int32Array as Dynamic)(total).fill(-1);
  fill[ceil2 + 1] = 0;
  fill2[ceil2 + 1] = 0;
  let difference3: number = difference - difference2;
  let matchesAmount: boolean = difference3 % 2 != 0;
  let count: number = 0;
  let count2: number = 0;
  let count3: number = 0;
  let count4: number = 0;
  let index: number = 0;
  for (let index2: number = 0; index2 < ceil; index2++) {
    for (
      let total2: Dynamic = -index2 + count;
      total2 <= index2 - count2;
      total2 += 2
    ) {
      let total3: Dynamic = ceil2 + total2;
      let fillItem: Dynamic =
        total2 === -index2 ||
        (total2 !== index2 && fill[total3 - 1] < fill[total3 + 1])
          ? fill[total3 + 1]
          : fill[total3 - 1] + 1;
      let difference4: number = fillItem - total2;
      for (
        ;
        fillItem < difference &&
        difference4 < difference2 &&
        findSequenceMiddleSnake2[context + fillItem] ===
          options[argument + difference4];

      ) {
        fillItem++;
        difference4++;
        index++;
      }
      index++;
      fill[total3] = fillItem;
      if (fillItem > difference) count2 += 2;
      else if (difference4 > difference2) count += 2;
      else if (matchesAmount) {
        let difference5: number = ceil2 + difference3 - total2;
        if (
          difference5 >= 0 &&
          difference5 < total &&
          fill2[difference5] !== -1 &&
          fillItem >= difference - fill2[difference5]
        )
          return [context + fillItem, argument + difference4];
      }
    }
    for (
      let total2: Dynamic = -index2 + count3;
      total2 <= index2 - count4;
      total2 += 2
    ) {
      let total3: Dynamic = ceil2 + total2;
      let fillItem: Dynamic =
        total2 === -index2 ||
        (total2 !== index2 && fill2[total3 - 1] < fill2[total3 + 1])
          ? fill2[total3 + 1]
          : fill2[total3 - 1] + 1;
      let difference4: number = fillItem - total2;
      for (
        ;
        fillItem < difference &&
        difference4 < difference2 &&
        findSequenceMiddleSnake2[dependencies - 1 - fillItem] ===
          options[argument2 - 1 - difference4];

      ) {
        fillItem++;
        difference4++;
        index++;
      }
      index++;
      fill2[total3] = fillItem;
      if (fillItem > difference) count4 += 2;
      else if (difference4 > difference2) count3 += 2;
      else if (!matchesAmount) {
        let difference5: number = ceil2 + difference3 - total2;
        if (
          difference5 >= 0 &&
          difference5 < total &&
          fill[difference5] !== -1
        ) {
          let fillItem2: Dynamic = fill[difference5];
          let difference6: number = ceil2 + fillItem2 - difference5;
          if (fillItem2 >= difference - fillItem)
            return [context + fillItem2, argument + difference6];
        }
      }
    }
    argument3.left -= index;
    index = 0;
    if (argument3.left < 0) throw new (DiffStepBudgetExceeded as Dynamic)();
  }
  return null;
}
function longestIncreasingSubsequence(
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items2: Dynamic = [];
  let fill: Dynamic = new (Int32Array as Dynamic)(items.length).fill(-1);
  for (let index: number = 0; index < items.length; index++) {
    let itemItem: Dynamic = items[index];
    let count: number = 0;
    let itemsCount: Dynamic = items2.length;
    for (; count < itemsCount; ) {
      let amount: number = (count + itemsCount) >> 1;
      if (items[items2[amount]] < itemItem) {
        count = amount + 1;
      } else {
        itemsCount = amount;
      }
    }
    if (count > 0) {
      fill[index] = items2[count - 1];
    }
    items2[count] = index;
  }
  let items3: Dynamic = [];
  for (
    let itemItem: Dynamic = items2.length ? items2[items2.length - 1] : -1;
    itemItem >= 0;
    itemItem = fill[itemItem]
  )
    items3.push(itemItem);
  return items3.toReversed();
}
function weightedIncreasingSubsequence(
  items?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let length: Dynamic = items.length;
  if (length === 0) return [];
  let toSorted: Dynamic = Array.from<Dynamic, Dynamic>(
    {
      length: length,
    },
    (
      weightedIncreasingSubsequence2?: unknown,
      options2?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => options2,
  ).toSorted(
    (
      record?: Dynamic,
      record2?: Dynamic,
      ..._extraArguments: unknown[]
    ): number => items[record] - items[record2],
  );
  let int32Array: Dynamic = new (Int32Array as Dynamic)(length);
  let index: number = 0;
  for (let index2: number = 0; index2 < length; index2++) {
    if (
      index2 === 0 ||
      items[toSorted[index2]] !== items[toSorted[index2 - 1]]
    ) {
      index++;
    }
    int32Array[toSorted[index2]] = index;
  }
  let int32Array2: Dynamic = new (Int32Array as Dynamic)(index + 1);
  let float64Array: Dynamic = new (Float64Array as Dynamic)(index + 1);
  let fill: Dynamic = new (Int32Array as Dynamic)(index + 1).fill(-1);
  let int32Array3: Dynamic = new (Int32Array as Dynamic)(length);
  let float64Array2: Dynamic = new (Float64Array as Dynamic)(length);
  let fill2: Dynamic = new (Int32Array as Dynamic)(length).fill(-1);
  let weightedIncreasingSubsequenceHandler: Dynamic = (
    weightedIncreasingSubsequence2?: Dynamic,
    options2?: Dynamic,
    context?: Dynamic,
    dependencies?: Dynamic,
    argument?: Dynamic,
    argument2?: Dynamic,
    ..._extraArguments: unknown[]
  ): boolean =>
    weightedIncreasingSubsequence2 > dependencies ||
    (weightedIncreasingSubsequence2 === dependencies &&
      (options2 > argument || (options2 === argument && context < argument2)));
  for (let index2: number = 0; index2 < length; index2++) {
    let count2: number = 0;
    let count3: number = 0;
    let weightedIncreasingSubsequenceResult: number = -1;
    for (
      let difference: number = int32Array[index2] - 1;
      difference > 0;
      difference -= difference & -difference
    ) {
      let fillItem: Dynamic = fill[difference];
      if (
        fillItem >= 0 &&
        (weightedIncreasingSubsequenceResult < 0 ||
          weightedIncreasingSubsequenceHandler(
            int32Array2[difference],
            float64Array[difference],
            fillItem,
            count2,
            count3,
            weightedIncreasingSubsequenceResult,
          ))
      ) {
        count2 = int32Array2[difference];
        count3 = float64Array[difference];
        weightedIncreasingSubsequenceResult = fillItem;
      }
    }
    int32Array3[index2] =
      weightedIncreasingSubsequenceResult < 0 ? 1 : count2 + 1;
    float64Array2[index2] =
      weightedIncreasingSubsequenceResult < 0
        ? options[index2]
        : count3 + options[index2];
    fill2[index2] = weightedIncreasingSubsequenceResult;
    for (
      let int32ArrayItem: Dynamic = int32Array[index2];
      int32ArrayItem <= index;
      int32ArrayItem += int32ArrayItem & -int32ArrayItem
    ) {
      let fillItem: Dynamic = fill[int32ArrayItem];
      if (
        fillItem < 0 ||
        weightedIncreasingSubsequenceHandler(
          int32Array3[index2],
          float64Array2[index2],
          index2,
          int32Array2[int32ArrayItem],
          float64Array[int32ArrayItem],
          fillItem,
        )
      ) {
        int32Array2[int32ArrayItem] = int32Array3[index2];
        float64Array[int32ArrayItem] = float64Array2[index2];
        fill[int32ArrayItem] = index2;
      }
    }
  }
  let count: number = 0;
  for (let count2: number = 1; count2 < length; count2++)
    if (
      int32Array3[count2] > int32Array3[count] ||
      (int32Array3[count2] === int32Array3[count] &&
        float64Array2[count2] > float64Array2[count])
    ) {
      count = count2;
    }
  let items2: Dynamic = [];
  for (let count2: Dynamic = count; count2 >= 0; count2 = fill2[count2])
    items2.push(count2);
  return items2.toReversed();
}
function maximumWeightedPairing(
  maximumWeightedPairing2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let int32Array: Dynamic = new (Int32Array as Dynamic)(
    maximumWeightedPairing2 * options,
  );
  for (let index3: number = 0; index3 < maximumWeightedPairing2; index3++)
    for (let index4: number = 0; index4 < options; index4++)
      int32Array[index3 * options + index4] = context(index3, index4);
  let total: Dynamic = options + 1;
  let int32Array2: Dynamic = new (Int32Array as Dynamic)(
    (maximumWeightedPairing2 + 1) * total,
  );
  for (
    let difference: number = maximumWeightedPairing2 - 1;
    difference >= 0;
    difference--
  )
    for (
      let difference2: number = options - 1;
      difference2 >= 0;
      difference2--
    ) {
      let max: number = Math.max(
        int32Array2[(difference + 1) * total + difference2],
        int32Array2[difference * total + difference2 + 1],
      );
      let int32ArrayItem: Dynamic =
        int32Array[difference * options + difference2];
      int32Array2[difference * total + difference2] =
        int32ArrayItem > 0
          ? Math.max(
              max,
              int32ArrayItem +
                int32Array2[(difference + 1) * total + difference2 + 1],
            )
          : max;
    }
  let items: Dynamic = [];
  let index: number = 0;
  let index2: number = 0;
  for (; index < maximumWeightedPairing2 && index2 < options; ) {
    let int32ArrayItem: Dynamic = int32Array[index * options + index2];
    if (
      int32ArrayItem > 0 &&
      int32Array2[index * total + index2] ===
        int32ArrayItem + int32Array2[(index + 1) * total + index2 + 1]
    ) {
      items.push({
        op: `pair`,
        i: index++,
        j: index2++,
      });
    } else {
      if (
        int32Array2[(index + 1) * total + index2] >=
        int32Array2[index * total + index2 + 1]
      ) {
        items.push({
          op: `del`,
          i: index++,
        });
      } else {
        items.push({
          op: `ins`,
          j: index2++,
        });
      }
    }
  }
  for (; index < maximumWeightedPairing2; )
    items.push({
      op: `del`,
      i: index++,
    });
  for (; index2 < options; )
    items.push({
      op: `ins`,
      j: index2++,
    });
  return items;
}
var ownProperty: Dynamic = (
  ownProperty2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  typeof options == `string` && Object.hasOwn(ownProperty2, options)
    ? ownProperty2[options]
    : undefined;
var paragraphKindLabel = (
  paragraphKindLabel2?: Dynamic,
  ..._extraArguments: unknown[]
) => {
  let paragraphKindLabelResult: Dynamic =
    resolveEditorHostIsInteger(paragraphKindLabel2);
  return paragraphKindLabelResult === null
    ? `Paragraph`
    : `Heading ${paragraphKindLabelResult}`;
};
var LIST_KIND_LABELS: Dynamic = {
  bullet: `Bulleted list`,
  ordered: `Numbered list`,
  check: `Checklist`,
};
var listKindLabel: Dynamic = (
  listKindLabel2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  ownProperty(
    LIST_KIND_LABELS,
    typeof listKindLabel2 == `string` ? listKindLabel2 : `bullet`,
  ) ?? `List`;
var CALLOUT_KIND_LABELS: Dynamic = {
  info: `Info callout`,
  success: `Success callout`,
  warning: `Warning callout`,
};
var CALLOUT_PREFIX_PATTERN: Dynamic = /^(ℹ️|✅️?|⚠️)/u;
var CALLOUT_EMOJI_KINDS: Dynamic = {
  ℹ: `info`,
  "✅": `success`,
  "⚠": `warning`,
};
/* Subsystem: diff-labels */
function calloutKindFromJson(
  node?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (node.type !== `blockquote`) return null;
  let contentItem: Dynamic = node.content?.[0];
  if (contentItem?.type !== `paragraph`) return null;
  let contentItem2: Dynamic = contentItem.content?.[0];
  if (contentItem2?.type !== `text` || typeof contentItem2.text != `string`)
    return null;
  let match: Dynamic = CALLOUT_PREFIX_PATTERN.exec(contentItem2.text);
  return match
    ? (ownProperty(CALLOUT_EMOJI_KINDS, match[1].replace(/️/g, ``)) ?? null)
    : null;
}
var calloutKindLabel: Dynamic = (
  calloutKindLabel2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  calloutKindLabel2 === null ? `Quote` : CALLOUT_KIND_LABELS[calloutKindLabel2];
var NODE_TYPE_LABELS: Dynamic = {
  listItem: `List item`,
  codeBlock: `Code block`,
  horizontalRule: `Divider`,
  embed: `Embed`,
  table: `Table`,
  tableRow: `Row`,
  cell: `Cell`,
  frozenBlock: `Block`,
  pending: `Placeholder`,
  text: `Text`,
  hardBreak: `Line break`,
  mention: `Mention`,
  media: `Image`,
  date: `Date`,
  dropdown: `Dropdown`,
};
function nodeKindLabel(
  nodeKindLabel2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return nodeKindLabel2.type === `paragraph`
    ? paragraphKindLabel(nodeKindLabel2.attrs?.heading)
    : nodeKindLabel2.type === `list`
      ? listKindLabel(nodeKindLabel2.attrs?.kind)
      : nodeKindLabel2.type === `blockquote`
        ? calloutKindLabel(calloutKindFromJson(nodeKindLabel2))
        : (ownProperty(NODE_TYPE_LABELS, nodeKindLabel2.type) ??
          `Unknown block (${nodeKindLabel2.type})`);
}
var isEmptyCalloutPrefix: Dynamic = (
  emptyCalloutPrefix?: Dynamic,
  ..._extraArguments: unknown[]
): boolean => /^(?:ℹ️|✅️?|⚠️)?\s*$/u.test(emptyCalloutPrefix);
var nodeAddedSummary = (
  nodeAddedSummary2?: Dynamic,
  ..._extraArguments: unknown[]
) => `${nodeKindLabel(nodeAddedSummary2)} added`;
var nodeDeletedSummary = (
  nodeDeletedSummary2?: Dynamic,
  ..._extraArguments: unknown[]
) => `${nodeKindLabel(nodeDeletedSummary2)} deleted`;
function calloutKindChangeSummary(
  calloutKindChangeSummary2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let calloutKindFromJson2: Dynamic = calloutKindFromJson(
    calloutKindChangeSummary2,
  );
  let calloutKindFromJson3: Dynamic = calloutKindFromJson(options);
  return calloutKindFromJson2 === calloutKindFromJson3
    ? null
    : `${calloutKindLabel(calloutKindFromJson2)} → ${calloutKindLabel(calloutKindFromJson3)}`;
}
var alignmentValue: Dynamic = (
  alignmentValue2?: Dynamic,
  ..._extraArguments: unknown[]
): string =>
  typeof alignmentValue2 == `string` && alignmentValue2 !== ``
    ? alignmentValue2
    : `left`;
var listNumberingValue: Dynamic = (
  listNumberingValue2?: Dynamic,
  ..._extraArguments: unknown[]
): string =>
  typeof listNumberingValue2 == `string` && listNumberingValue2 !== ``
    ? listNumberingValue2
    : `1`;
var listStartValue: Dynamic = (
  listStartValue2?: Dynamic,
  ..._extraArguments: unknown[]
): string =>
  typeof listStartValue2 == `number` ? String(listStartValue2) : `1`;
var codeLanguageValue: Dynamic = (
  codeLanguageValue2?: Dynamic,
  ..._extraArguments: unknown[]
): string =>
  typeof codeLanguageValue2 == `string` && codeLanguageValue2 !== ``
    ? codeLanguageValue2
    : `plain`;
var highlightValue: Dynamic = (
  highlightValue2?: Dynamic,
  ..._extraArguments: unknown[]
): string =>
  typeof highlightValue2 == `string` && highlightValue2 !== ``
    ? highlightValue2
    : `none`;
var cellSpanArea: Dynamic = (
  cellSpanArea2?: Dynamic,
  ..._extraArguments: unknown[]
): number => {
  let cellSpanAreaHandler: Dynamic = (
    cellSpanArea3?: Dynamic,
    ..._extraArguments: unknown[]
  ): number =>
    typeof cellSpanArea3 == `number` && cellSpanArea3 > 0 ? cellSpanArea3 : 1;
  return (
    cellSpanAreaHandler(cellSpanArea2.colspan) *
    cellSpanAreaHandler(cellSpanArea2.rowspan)
  );
};
function nodeAttributeChangeSummary(
  type?: Dynamic,
  options?: Dynamic,
  attrs?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let nodeAttributeChangeSummaryHandler: Dynamic = (
    node?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => dependencies.includes(node);
  let items: Dynamic = [];
  let dependencies2 = (
    node?: Dynamic,
    options2?: Dynamic,
    context?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (nodeAttributeChangeSummaryHandler(context)) {
      items.push(
        `${node}${options2(ownProperty(options, context))} → ${options2(ownProperty(attrs, context))}`,
      );
    }
  };
  switch (type) {
    case `paragraph`:
      dependencies2(``, paragraphKindLabel, `heading`);
      break;
    case `list`:
      dependencies2(``, listKindLabel, `kind`);
      dependencies2(`Numbering: `, listNumberingValue, `numbering`);
      dependencies2(`Start: `, listStartValue, `start`);
      break;
    case `listItem`:
      if (nodeAttributeChangeSummaryHandler(`checked`)) {
        items.push(
          attrs.checked === true
            ? `Checked`
            : attrs.checked === false
              ? `Unchecked`
              : `Checkbox removed`,
        );
      }
      break;
    case `cell`:
      if (nodeAttributeChangeSummaryHandler(`header`)) {
        items.push(
          attrs.header === true ? `Made header cell` : `Made body cell`,
        );
      }
      if (
        nodeAttributeChangeSummaryHandler(`colspan`) ||
        nodeAttributeChangeSummaryHandler(`rowspan`)
      ) {
        items.push(
          cellSpanArea(attrs) > cellSpanArea(options)
            ? `Merged cells`
            : `Split cells`,
        );
      }
      dependencies2(`Cell background: `, highlightValue, `background`);
      dependencies2(`Cell alignment: `, alignmentValue, `align`);
      if (nodeAttributeChangeSummaryHandler(`colwidth`)) {
        items.push(`Column resized`);
      }
      break;
    case `codeBlock`:
      dependencies2(`Code language: `, codeLanguageValue, `language`);
      break;
    case `embed`:
      if (nodeAttributeChangeSummaryHandler(`ref`)) {
        items.push(`Embed changed`);
      }
      if (nodeAttributeChangeSummaryHandler(`width`)) {
        items.push(
          `Embed resized ${mediaDimensionLabel(options.width)} → ${mediaDimensionLabel(attrs.width)} px`,
        );
      }
      dependencies2(`Embed alignment: `, alignmentValue, `align`);
      if (nodeAttributeChangeSummaryHandler(`caption`)) {
        items.push(`Caption changed`);
      }
      break;
    case `media`:
      if (nodeAttributeChangeSummaryHandler(`blob`)) {
        items.push(`Image replaced`);
      }
      if (
        nodeAttributeChangeSummaryHandler(`dims`) ||
        nodeAttributeChangeSummaryHandler(`width`) ||
        nodeAttributeChangeSummaryHandler(`height`)
      ) {
        items.push(mediaDimensionChangeSummary(options, attrs));
      }
      if (nodeAttributeChangeSummaryHandler(`crop`)) {
        items.push(attrs.crop == null ? `Crop removed` : `Image cropped`);
      }
      if (nodeAttributeChangeSummaryHandler(`alt`)) {
        items.push(`Alt text changed`);
      }
      dependencies2(`Image alignment: `, alignmentValue, `align`);
      if (nodeAttributeChangeSummaryHandler(`mime`)) {
        items.push(`Image type changed`);
      }
      break;
    case `mention`:
      items.push(mentionChangeSummary(options, attrs, dependencies));
      break;
    case `date`:
      if (nodeAttributeChangeSummaryHandler(`ts`)) {
        items.push(dateChangeSummary(options.ts, attrs.ts));
      }
      break;
    case `dropdown`:
      if (
        nodeAttributeChangeSummaryHandler(`index`) ||
        nodeAttributeChangeSummaryHandler(`enum`)
      ) {
        items.push(dropdownChangeSummary(options, attrs, argument));
      }
      break;
    default:
      break;
  }
  return items.length
    ? items.join(`; `)
    : `${nodeKindLabel({
        type: type,
        attrs: attrs,
      })} changed`;
}
var truncateCodePoints: Dynamic = (
  truncateCodePoints2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let truncateCodePoints3: Dynamic = Array.from<Dynamic>(truncateCodePoints2);
  return truncateCodePoints3.length > options
    ? `${truncateCodePoints3.slice(0, options - 1).join(``)}…`
    : truncateCodePoints2;
};
var DIFF_LABEL_LIMIT: number = 40;
var DIFF_LABEL_CONTEXT: number = 12;
function shortTextChangeSummary(
  shortTextChangeSummary2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let shortTextChangeSummary3: Dynamic = Array.from<Dynamic>(
    shortTextChangeSummary2,
  );
  let options2: Dynamic = Array.from<Dynamic>(options);
  let count: number = 0;
  if (
    shortTextChangeSummary3.length > DIFF_LABEL_LIMIT ||
    options2.length > DIFF_LABEL_LIMIT
  ) {
    let index: number = 0;
    for (
      ;
      index < shortTextChangeSummary3.length &&
      index < options2.length &&
      shortTextChangeSummary3[index] === options2[index];

    )
      index++;
    if (index > DIFF_LABEL_LIMIT - DIFF_LABEL_CONTEXT) {
      count = index - DIFF_LABEL_CONTEXT;
      for (
        let count2: Dynamic = count;
        count2 > count - DIFF_LABEL_CONTEXT;
        count2--
      )
        if (shortTextChangeSummary3[count2 - 1] === ` `) {
          count = count2;
          break;
        }
    }
  }
  let join: Dynamic = (
    shortTextChangeSummary4?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    count > 0
      ? `…${truncateCodePoints(shortTextChangeSummary4.slice(count).join(``), DIFF_LABEL_LIMIT - 1)}`
      : truncateCodePoints(shortTextChangeSummary4.join(``), DIFF_LABEL_LIMIT);
  return `${join(shortTextChangeSummary3)} → ${join(options2)}`;
}
var normalizedNonemptyLabel: Dynamic = (
  dNonemptyLabel?: Dynamic,
  ..._extraArguments: unknown[]
): null | string =>
  typeof dNonemptyLabel == `string` && dNonemptyLabel.trim() !== ``
    ? dNonemptyLabel.trim().replace(/\s+/g, ` `)
    : null;
var UNNAMED_LABEL: string = `unnamed`;
var normalizedLabel: Dynamic = (
  dLabel?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => normalizedNonemptyLabel(dLabel) ?? UNNAMED_LABEL;
var SOMEONE_LABEL: string = `Someone`;
var isReferenceMention: Dynamic = (
  actor?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  typeof actor.ref == `string` && typeof actor.principal != `string`;
function referenceMentionKindLabel(
  referenceMentionKindLabel2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (typeof referenceMentionKindLabel2 != `string`)
    return resolveEditorExtensionsValue9(`ref`);
  let referenceMentionKindLabelParts: Dynamic =
    referenceMentionKindLabel2.split(`/`);
  return resolveEditorExtensionsValue9(
    (referenceMentionKindLabelParts[0] === `project` &&
    referenceMentionKindLabelParts.length >= 4
      ? referenceMentionKindLabelParts[2]
      : referenceMentionKindLabelParts[0]) ?? `ref`,
  );
}
function mentionDisplayLabel(
  actor?: Dynamic,
  options: Dynamic = false,
  ..._extraArguments: unknown[]
): Dynamic {
  let normalizedNonemptyLabel2: Dynamic = normalizedNonemptyLabel(actor.label);
  if (normalizedNonemptyLabel2 !== null) return normalizedNonemptyLabel2;
  if (isReferenceMention(actor)) return null;
  let principal: Dynamic = actor.principal;
  if (typeof principal != `string` || principal === ``) return null;
  if (principal === `claude`) return `Claude`;
  let principalIndex: number = principal.indexOf(`@`);
  return principalIndex > 0 && principalIndex < principal.length - 1
    ? options
      ? principal
      : principal.slice(0, principalIndex)
    : null;
}
var mentionSummaryLabel: Dynamic = (
  mentionSummaryLabel2?: Dynamic,
  options: Dynamic = false,
  ..._extraArguments: unknown[]
): Dynamic =>
  mentionDisplayLabel(mentionSummaryLabel2, options) ??
  (isReferenceMention(mentionSummaryLabel2) ? UNNAMED_LABEL : SOMEONE_LABEL);
function mentionChangeSummary(
  mentionChangeSummary2?: Dynamic,
  options?: Dynamic,
  items?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let referenceMentionKindLabel2: Dynamic = isReferenceMention(options)
    ? referenceMentionKindLabel(options.ref)
    : `Mention`;
  if (items.length === 1 && items[0] === `label`)
    return `${referenceMentionKindLabel2} renamed: ${shortTextChangeSummary(normalizedLabel(mentionChangeSummary2.label), normalizedLabel(options.label))}`;
  if (
    mentionDisplayLabel(mentionChangeSummary2) === null &&
    mentionDisplayLabel(options) === null
  )
    return `${referenceMentionKindLabel2} changed`;
  let [items2, setItems]: Dynamic = [
    mentionSummaryLabel(mentionChangeSummary2),
    mentionSummaryLabel(options),
  ];
  if (items2 === setItems) {
    [items2, setItems] = [
      mentionSummaryLabel(mentionChangeSummary2, true),
      mentionSummaryLabel(options, true),
    ];
  }
  return items2 === setItems
    ? `${referenceMentionKindLabel2} changed`
    : `${referenceMentionKindLabel2}: ${shortTextChangeSummary(items2, setItems)}`;
}
var DIFF_URL_LABEL_LIMIT: number = 40;
function shortUrlLabel(
  shortUrlLabel2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (typeof shortUrlLabel2 != `string` || shortUrlLabel2.trim() === ``)
    return null;
  let replace: string = shortUrlLabel2.trim().replace(/\s+/g, ` `);
  let shortUrlLabelResult: Dynamic;
  try {
    shortUrlLabelResult = new (URL as Dynamic)(replace);
  } catch {
    return (
      truncateCodePoints(replace.split(/[?#]/)[0], DIFF_URL_LABEL_LIMIT) || null
    );
  }
  return shortUrlLabelResult.protocol === `http:` ||
    shortUrlLabelResult.protocol === `https:`
    ? `${shortUrlLabelResult.protocol}//${shortUrlLabelResult.host}${shortUrlLabelResult.pathname === `/` ? `` : truncateCodePoints(shortUrlLabelResult.pathname, DIFF_URL_LABEL_LIMIT)}`
    : shortUrlLabelResult.protocol === `mailto:` ||
        shortUrlLabelResult.protocol === `tel:`
      ? `${shortUrlLabelResult.protocol}${truncateCodePoints(shortUrlLabelResult.pathname, DIFF_URL_LABEL_LIMIT)}`
      : shortUrlLabelResult.protocol;
}
var mediaDimensionLabel: Dynamic = (
  mediaDimensionLabel2?: Dynamic,
  ..._extraArguments: unknown[]
): string =>
  typeof mediaDimensionLabel2 == `number` &&
  Number.isFinite(mediaDimensionLabel2)
    ? String(Math.round(mediaDimensionLabel2))
    : `auto`;
function mediaDimensionChangeSummary(
  mediaDimensionChangeSummary2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let ownProperty2: Dynamic = (
    mediaDimensionChangeSummary3?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let dims: Dynamic =
      mediaDimensionChangeSummary3.dims !== null &&
      typeof mediaDimensionChangeSummary3.dims == `object`
        ? mediaDimensionChangeSummary3.dims
        : {};
    return {
      w:
        ownProperty(mediaDimensionChangeSummary3, `width`) ??
        ownProperty(dims, `w`),
      h:
        ownProperty(mediaDimensionChangeSummary3, `height`) ??
        ownProperty(dims, `h`),
    };
  };
  let ownProperty3: Dynamic = ownProperty2(mediaDimensionChangeSummary2);
  let ownProperty4: Dynamic = ownProperty2(options);
  let isFinite2: Dynamic = (
    mediaDimensionChangeSummary3?: Dynamic,
    ..._extraArguments: unknown[]
  ): boolean =>
    typeof mediaDimensionChangeSummary3 == `number` &&
    Number.isFinite(mediaDimensionChangeSummary3);
  let filteredItems: Dynamic = [`w`, `h`].filter(
    (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      isFinite2(ownProperty3[item]) || isFinite2(ownProperty4[item]),
  );
  if (!filteredItems.length) return `Image resized`;
  let join: Dynamic = (
    mediaDimensionChangeSummary3?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    filteredItems.some(
      (filteredItem?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        isFinite2(mediaDimensionChangeSummary3[filteredItem]),
    )
      ? filteredItems
          .map(
            (filteredItem?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              mediaDimensionLabel(mediaDimensionChangeSummary3[filteredItem]),
          )
          .join(`×`)
      : `auto`;
  return `Image resized ${join(ownProperty3)} → ${join(ownProperty4)}`;
}
var MONTH_ABBREVIATIONS: Dynamic = [
  `Jan`,
  `Feb`,
  `Mar`,
  `Apr`,
  `May`,
  `Jun`,
  `Jul`,
  `Aug`,
  `Sep`,
  `Oct`,
  `Nov`,
  `Dec`,
];
var ISO_DATE_PREFIX_PATTERN: Dynamic =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?:\[([^\]]+)\])?)?/;
function dateSummaryLabel(
  dateSummaryLabel2?: Dynamic,
  options: Dynamic = false,
  ..._extraArguments: unknown[]
): string {
  if (typeof dateSummaryLabel2 != `string` || dateSummaryLabel2 === ``)
    return `unset`;
  let match: Dynamic = ISO_DATE_PREFIX_PATTERN.exec(dateSummaryLabel2);
  let MONTHABBREVIATIONSItem: Dynamic = match
    ? MONTH_ABBREVIATIONS[Number(match[2]) - 1]
    : undefined;
  if (!match || MONTHABBREVIATIONSItem === undefined) return dateSummaryLabel2;
  let label: string = `${MONTHABBREVIATIONSItem} ${Number(match[3])}`;
  if (options) {
    label += `, ${match[1]}`;
  }
  if (match[4] !== undefined) {
    let number: number = Number(match[4]);
    label += ` ${number % 12 || 12}:${match[5]} ${number < 12 ? `AM` : `PM`}`;
    if (match[6] !== undefined) {
      label += ` ${match[6]}`;
    }
  }
  return label;
}
var dateYear: Dynamic = (
  dateYear2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  typeof dateYear2 == `string`
    ? (ISO_DATE_PREFIX_PATTERN.exec(dateYear2)?.[1] ?? null)
    : null;
function dateChangeSummary(
  dateChangeSummary2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let dateYear2: Dynamic = dateYear(dateChangeSummary2);
  let dateYear3: Dynamic = dateYear(options);
  let matchesDateYear: boolean =
    dateYear2 !== null && dateYear3 !== null && dateYear2 !== dateYear3;
  return `Date: ${dateSummaryLabel(dateChangeSummary2, matchesDateYear)} → ${dateSummaryLabel(options, matchesDateYear)}`;
}
function resolveDiffEnum(
  diffEnum?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (typeof diffEnum != `string` || !options?.resolveEnum) return null;
  try {
    return options.resolveEnum(diffEnum) ?? null;
  } catch {
    return null;
  }
}
function dropdownDisplayLabel(
  dropdownDisplayLabel2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let diffEnum: Dynamic = resolveDiffEnum(dropdownDisplayLabel2.enum, options);
  if (diffEnum === null) return null;
  let index: Dynamic = dropdownDisplayLabel2.index;
  if (typeof index != `number` || !Number.isInteger(index) || index < 0)
    return typeof diffEnum.name == `string` && diffEnum.name !== ``
      ? diffEnum.name
      : null;
  let optionItem: Dynamic = Array.isArray(diffEnum.options)
    ? diffEnum.options[index]
    : undefined;
  return typeof optionItem == `string` && optionItem !== `` ? optionItem : null;
}
function dropdownChangeSummary(
  dropdownChangeSummary2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let diffEnum: Dynamic = resolveDiffEnum(options.enum, context);
  let name: Dynamic =
    typeof diffEnum?.name == `string` && diffEnum.name !== ``
      ? diffEnum.name
      : `Dropdown`;
  let isInteger: Dynamic = (
    dropdownChangeSummary3?: Dynamic,
    ..._extraArguments: unknown[]
  ): string => {
    if (
      typeof dropdownChangeSummary3 != `number` ||
      !Number.isInteger(dropdownChangeSummary3) ||
      dropdownChangeSummary3 < 0
    )
      return `unset`;
    let optionItem: Dynamic = Array.isArray(diffEnum?.options)
      ? diffEnum.options[dropdownChangeSummary3]
      : undefined;
    return typeof optionItem == `string` && optionItem !== ``
      ? optionItem
      : `option ${dropdownChangeSummary3 + 1}`;
  };
  return `${name}: ${isInteger(dropdownChangeSummary2.index)} → ${isInteger(options.index)}`;
}
var MARK_TYPE_ORDER: Dynamic = [
  `bold`,
  `italic`,
  `underline`,
  `strike`,
  `code`,
  `link`,
  `highlight`,
];
var MARK_TYPE_LABELS: Dynamic = {
  bold: `Bold`,
  italic: `Italic`,
  underline: `Underline`,
  strike: `Strikethrough`,
  code: `Code`,
  link: `Link`,
  highlight: `Highlight`,
};
var markSortIndex: Dynamic = (
  markSortIndex2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let MARKTYPEORDERIndex: Dynamic = MARK_TYPE_ORDER.indexOf(markSortIndex2);
  return MARKTYPEORDERIndex === -1
    ? MARK_TYPE_ORDER.length
    : MARKTYPEORDERIndex;
};
var markAttributesKey: Dynamic = (
  mark?: Dynamic,
  ..._extraArguments: unknown[]
): string => {
  let lookup: Dynamic = new (Map as Dynamic)();
  for (let [
    markAttributesKeyResult,
    markAttributesKeyResult2,
  ] of Object.entries(mark.attrs ?? {}) as Dynamic)
    if (markAttributesKeyResult2 != null) {
      lookup.set(markAttributesKeyResult, markAttributesKeyResult2);
    }
  return stableStringify(Object.fromEntries(lookup));
};
function markChangeSummary(
  markChangeSummary2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let lookup: Dynamic = new (Map as Dynamic)(
    markChangeSummary2.map(
      (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => [
        item.type,
        item,
      ],
    ),
  );
  let lookup2: Dynamic = new (Map as Dynamic)(
    options.map(
      (option?: Dynamic, ..._extraArguments: unknown[]): Dynamic => [
        option.type,
        option,
      ],
    ),
  );
  let toSorted: Dynamic = [
    ...new (Set as Dynamic)([...lookup.keys(), ...lookup2.keys()]),
  ].toSorted(
    (item?: Dynamic, item2?: Dynamic, ..._extraArguments: unknown[]): number =>
      markSortIndex(item) - markSortIndex(item2) ||
      (item < item2 ? -1 : +(item > item2)),
  );
  let items: Dynamic = [];
  for (let type of toSorted as Dynamic) {
    let ownProperty2: Dynamic =
      ownProperty(MARK_TYPE_LABELS, type) ??
      nodeKindLabel({
        type: type,
      });
    let lookupEntry: Dynamic = lookup.get(type);
    let lookupEntry2: Dynamic = lookup2.get(type);
    let slice = (
      markChangeSummary3?: Dynamic,
      ..._extraArguments: unknown[]
    ) => {
      let markChangeSummaryResult: Dynamic = resolveEditorExtensionsYellow3(
        markChangeSummary3.attrs?.color,
      );
      return `${markChangeSummaryResult.charAt(0).toUpperCase()}${markChangeSummaryResult.slice(1)} highlight`;
    };
    let shortUrlLabel2: Dynamic = (
      markChangeSummary3?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic =>
      type === `link` ? shortUrlLabel(markChangeSummary3.attrs?.href) : null;
    let shortUrlLabel3: Dynamic = (
      markChangeSummary3?: Dynamic,
      options2?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => {
      let shortUrlLabel4: Dynamic = shortUrlLabel2(options2);
      return shortUrlLabel4 === null
        ? markChangeSummary3
        : `${markChangeSummary3}: ${shortUrlLabel4}`;
    };
    if (lookupEntry === undefined)
      items.push(
        type === `highlight`
          ? `${slice(lookupEntry2)} added`
          : shortUrlLabel3(`${ownProperty2} added`, lookupEntry2),
      );
    else if (lookupEntry2 === undefined)
      items.push(
        type === `highlight`
          ? `${slice(lookupEntry)} removed`
          : shortUrlLabel3(`${ownProperty2} removed`, lookupEntry),
      );
    else if (
      markAttributesKey(lookupEntry) !== markAttributesKey(lookupEntry2)
    ) {
      let shortUrlLabel4: Dynamic = shortUrlLabel2(lookupEntry);
      let shortUrlLabel5: Dynamic = shortUrlLabel2(lookupEntry2);
      items.push(
        type === `highlight`
          ? `Highlight ${resolveEditorExtensionsYellow3(lookupEntry.attrs?.color)} → ${resolveEditorExtensionsYellow3(lookupEntry2.attrs?.color)}`
          : shortUrlLabel4 !== null &&
              shortUrlLabel5 !== null &&
              shortUrlLabel4 !== shortUrlLabel5
            ? `${ownProperty2} changed: ${shortUrlLabel4} → ${shortUrlLabel5}`
            : `${ownProperty2} changed`,
      );
    }
  }
  return items.length ? items.join(`, `) : null;
}
var DIFF_BUDGETS: Dynamic = {
  sequenceSteps: 25e6,
  totalSteps: 6e7,
  pairCells: 4e4,
  convertOps: 2e6,
  convertOpsPerDiff: 4e6,
  linePairChars: 16e6,
};
var MIN_NODE_PAIR_SIMILARITY: number = 0.2;
var MIN_NODE_PAIR_WORDS: number = 2;
var MIN_REPLACEMENT_WORDS: number = 6;
var REPLACEMENT_CHANGE_RATIO: number = 0.6;
var MIN_CHANGED_WORDS: number = 5;
var MIN_TEXT_PAIR_SIMILARITY: number = 0.5;
var MIN_TOKEN_PAIR_SIMILARITY: number = 0.3;
var MAX_NODE_CONTENT_WEIGHT: number = 512;
var MAX_TOKENIZER_CHARACTERS: number = 4096;
var MAX_PAIR_TOKEN_CHARACTERS: number = 4 * MAX_TOKENIZER_CHARACTERS;
var MAX_TABLE_COLUMNS: number = 64;
var TOKEN_CHUNK_CHARACTERS: number = 256;
var MIN_CODE_BLOCK_WORDS: number = 6;
var MIN_CODE_CONVERSION_SIMILARITY: number = 0.7;
var MAX_SEQUENCE_PAIRING_WINDOW: number = 32;
var MAX_CONVERSION_ROUNDS: number = 4;
var MAX_MOVE_PAIRING_ROUNDS: number = 8;
var defineEnumerableProperty = (
  defineEnumerableProperty2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): undefined => {
  Object.defineProperty(defineEnumerableProperty2, options, {
    value: context,
    enumerable: true,
    writable: true,
    configurable: true,
  });
};
var IDENTITY_NODE_ATTRIBUTES: Dynamic = new (Set as Dynamic)([
  `bid`,
  `h`,
  `frozen`,
  `unknownType`,
]);
var DIFF_NODE_ATTRIBUTES: Dynamic = new (Set as Dynamic)(
  Object.values(DIFF_ATTRIBUTE_NAMES),
);
var DIFF_MARK_NAMES: Dynamic = new (Set as Dynamic)(
  Object.values(DIFF_MARK_TYPES),
);
var DEFAULT_NODE_ATTRIBUTES: Dynamic = {
  paragraph: {
    heading: null,
  },
  list: {
    kind: `bullet`,
    start: null,
    numbering: null,
  },
  listItem: {
    checked: null,
  },
  codeBlock: {
    language: null,
  },
  embed: {
    ref: null,
    width: null,
    align: null,
    caption: null,
  },
  cell: {
    header: false,
    colspan: 1,
    rowspan: 1,
    colwidth: null,
    align: null,
    background: null,
  },
  frozenBlock: {
    label: null,
    rows: null,
  },
  mention: {
    principal: null,
    ref: null,
  },
  media: {
    blob: null,
    mime: null,
    alt: null,
    dims: null,
    crop: null,
    align: null,
  },
  date: {
    ts: null,
  },
  dropdown: {
    enum: null,
    index: null,
  },
  pending: {
    intent: ``,
  },
};
var CONTAINER_NODE_TYPES: Dynamic = new (Set as Dynamic)([
  `doc`,
  `blockquote`,
  `list`,
  `listItem`,
  `cell`,
]);
var TEXT_BLOCK_NODE_TYPES: Dynamic = new (Set as Dynamic)([
  `paragraph`,
  `codeBlock`,
]);
var DIFFABLE_NODE_TYPES: Dynamic = new (Set as Dynamic)([
  ...CONTAINER_NODE_TYPES,
  `paragraph`,
  `codeBlock`,
  `table`,
  `tableRow`,
  `embed`,
  `horizontalRule`,
]);
var COMPLEX_NODE_TYPES: Dynamic = new (Set as Dynamic)([
  `list`,
  `table`,
  `blockquote`,
  `codeBlock`,
  `embed`,
]);
var CONVERTIBLE_CONTAINER_TYPES: Dynamic = new (Set as Dynamic)([
  `list`,
  `blockquote`,
  `table`,
]);
var INLINE_NODE_TYPES: Dynamic = new (Set as Dynamic)([
  `text`,
  `hardBreak`,
  `mention`,
  `media`,
  `date`,
  `dropdown`,
]);
var ROOT_CONTAINER_TYPES: Dynamic = new (Set as Dynamic)([`cell`, `doc`]);
var WORD_PATTERN: Dynamic = /\S+/g;
var WHITESPACE_ONLY_PATTERN: Dynamic = /^\s+$/;
var WHITESPACE_PATTERN: Dynamic = /\s/;
var EMOJI_TOKEN_PATTERN: string = String.raw`\p{Regional_Indicator}{2}|\p{Extended_Pictographic}[\p{M}\p{Emoji_Modifier}]*(?:‍\p{Extended_Pictographic}[\p{M}\p{Emoji_Modifier}]*)*`;
var UNSEGMENTED_SCRIPT_PATTERN: string = String.raw`[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]`;
var WORD_CHARACTER_PATTERN: string = String.raw`(?:(?!${UNSEGMENTED_SCRIPT_PATTERN})[\p{L}\p{N}_]\p{M}*)`;
var WORD_TOKENIZER_PATTERN: Dynamic = new (RegExp as Dynamic)(
  String.raw`${EMOJI_TOKEN_PATTERN}|${UNSEGMENTED_SCRIPT_PATTERN}\p{M}*|\p{N}+(?:[.,:]\p{N}+)*%|${WORD_CHARACTER_PATTERN}+(?:[.,:'’]${WORD_CHARACTER_PATTERN}+)*|[\s\S]\p{M}*`,
  `gu`,
);
var GRAPHEME_FALLBACK_PATTERN: Dynamic = new (RegExp as Dynamic)(
  String.raw`${EMOJI_TOKEN_PATTERN}|\r\n|[\s\S]\p{M}*`,
  `gu`,
);
var graphemeSegmenter: Dynamic =
  typeof Intl == `object` && typeof Intl.Segmenter == `function`
    ? new (Intl.Segmenter as Dynamic)(`und`, {
        granularity: `grapheme`,
      })
    : null;
/* Subsystem: document-diff */
function chunkLongToken(
  items?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  for (let count: number = 0; count < items.length; ) {
    let min: number = Math.min(items.length, count + TOKEN_CHUNK_CHARACTERS);
    let charCodeAt: Dynamic = items.charCodeAt(min);
    if (min < items.length && charCodeAt >= 56320 && charCodeAt <= 57343) {
      min++;
    }
    options.push(items.slice(count, min));
    count = min;
  }
}
function tokenizeWords(
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items2: Dynamic = [];
  for (let count: number = 0; count < items.length; ) {
    let test: Dynamic = WHITESPACE_PATTERN.test(items[count]);
    let total: Dynamic = count + 1;
    for (
      ;
      total < items.length && WHITESPACE_PATTERN.test(items[total]) === test;

    )
      total++;
    let itemsSlice: Dynamic = items.slice(count, total);
    if (test) items2.push(itemsSlice);
    else {
      let match: Dynamic =
        itemsSlice.length <= MAX_TOKENIZER_CHARACTERS
          ? itemsSlice.match(WORD_TOKENIZER_PATTERN)
          : null;
      if (match !== null && match.join(``) === itemsSlice)
        for (let tokenizeWordsResult of match as Dynamic)
          items2.push(tokenizeWordsResult);
      else chunkLongToken(itemsSlice, items2);
    }
    count = total;
  }
  return items2;
}
function tokenizeGraphemes(
  tokenizeGraphemes2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let segment: Dynamic = graphemeSegmenter
    ? Array.from<Dynamic, Dynamic>(
        graphemeSegmenter.segment(tokenizeGraphemes2),
        (
          tokenizeGraphemes3?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic => tokenizeGraphemes3.segment,
      )
    : tokenizeGraphemes2.match(GRAPHEME_FALLBACK_PATTERN);
  return segment !== null && segment.join(``) === tokenizeGraphemes2
    ? segment
    : Array.from<Dynamic>(tokenizeGraphemes2);
}
var createChangeRecord: Dynamic = (
  kind?: Dynamic,
  nodeType?: Dynamic,
  summary?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => ({
  kind: kind,
  nodeType: nodeType,
  summary: summary,
  alias: null,
  id: null,
  path: null,
});
var resolveChangeAlias: Dynamic = (
  changeAlias?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let changeAlias2: Dynamic = changeAlias;
  for (; changeAlias2.alias !== null; ) changeAlias2 = changeAlias2.alias;
  return changeAlias2;
};
var DocumentDiffContext: Dynamic = class {
  [key: string]: Dynamic;
  prev: Dynamic;
  curr: Dynamic;
  opts: Dynamic;
  totalLeft: Dynamic = DIFF_BUDGETS.totalSteps;
  stepAllowance: Dynamic = this.totalLeft;
  nodeCh: Dynamic = new (WeakMap as Dynamic)();
  markCh: Dynamic = new (WeakMap as Dynamic)();
  primary: Dynamic = new (WeakSet as Dynamic)();
  ghosts: Dynamic = new (WeakSet as Dynamic)();
  settled: Dynamic = new (WeakSet as Dynamic)();
  regionRoots: Dynamic = new (WeakMap as Dynamic)();
  source: Dynamic = new (WeakMap as Dynamic)();
  origin: Dynamic = new (WeakMap as Dynamic)();
  husks: Dynamic = new (WeakMap as Dynamic)();
  moves: Dynamic = new (Map as Dynamic)();
  rowPerm: Dynamic = new (WeakMap as Dynamic)();
  keys: Dynamic = new (WeakMap as Dynamic)();
  keyLens: Dynamic = new (WeakMap as Dynamic)();
  keyIds: Dynamic = new (Map as Dynamic)();
  bags: Dynamic = new (WeakMap as Dynamic)();
  wordCounts: Dynamic = new (WeakMap as Dynamic)();
  tokBags: Dynamic = new (WeakMap as Dynamic)();
  tokenBounds: Dynamic = new (WeakMap as Dynamic)();
  contentKeys: Dynamic = new (WeakMap as Dynamic)();
  attrWeights: Dynamic = new (WeakMap as Dynamic)();
  convert: Dynamic = {
    left: DIFF_BUDGETS.convertOpsPerDiff,
  };
  convertAllowance: Dynamic = this.convert.left;
  words: Dynamic = new (Map as Dynamic)();
  common: Dynamic = new (Set as Dynamic)();
  prevRuns: Dynamic;
  nextRuns: Dynamic;
  scopes: Dynamic = [];
  scopeStack: Dynamic = [];
  unkeyable: Dynamic = 0;
  counts: Dynamic = null;
  twins: Dynamic = null;
  constructor(
    documentDiffContext?: Dynamic,
    options?: Dynamic,
    context?: Dynamic,
    ..._extraArguments: unknown[]
  ) {
    this.prev = documentDiffContext;
    this.curr = options;
    this.opts = context;
    let countDocumentBlockIds2: Dynamic =
      countDocumentBlockIds(documentDiffContext);
    let countDocumentBlockIds3: Dynamic = countDocumentBlockIds(options);
    for (let [
      documentDiffContextResult,
      documentDiffContextResult2,
    ] of countDocumentBlockIds2 as Dynamic) {
      let countDocumentBlockIdEntry: Dynamic = countDocumentBlockIds3.get(
        documentDiffContextResult,
      );
      if (
        documentDiffContextResult2.count === 1 &&
        countDocumentBlockIdEntry?.count === 1 &&
        documentDiffContextResult2.type === countDocumentBlockIdEntry.type
      ) {
        this.common.add(documentDiffContextResult);
      }
    }
    this.prevRuns = indexRunBlocks(context.prevRuns);
    this.nextRuns = indexRunBlocks(context.nextRuns);
  }
  convertSpent(..._extraArguments: unknown[]): number {
    return this.convertAllowance - this.convert.left;
  }
  stepsSpent(..._extraArguments: unknown[]): number {
    return this.stepAllowance - this.totalLeft;
  }
  degrade(
    documentDiffContext?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined {
    let context: Dynamic =
      options ?? this.scopeStack[this.scopeStack.length - 1] ?? this.curr;
    if (
      !this.scopes.some(
        (scope?: Dynamic, ..._extraArguments: unknown[]): boolean =>
          scope.reason === documentDiffContext && scope.node === context,
      )
    ) {
      this.scopes.push({
        reason: documentDiffContext,
        node: context,
      });
    }
  }
  hashCounts(..._extraArguments: unknown[]): Dynamic {
    if (this.counts === null) {
      let nodeChildren2: Dynamic = (
        documentDiffContext?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => {
        let lookup: Dynamic = new (Map as Dynamic)();
        let nodeChildren3 = (
          documentDiffContext2?: Dynamic,
          ..._extraArguments: unknown[]
        ): undefined => {
          let nodeContentKey2: Dynamic = nodeContentKey(
            documentDiffContext2,
            this,
          );
          lookup.set(nodeContentKey2, (lookup.get(nodeContentKey2) ?? 0) + 1);
          if (!TEXT_BLOCK_NODE_TYPES.has(documentDiffContext2.type))
            for (let documentDiffContextResult of nodeChildren(
              documentDiffContext2,
            ) as Dynamic)
              nodeChildren3(documentDiffContextResult);
        };
        for (let documentDiffContextResult of nodeChildren(
          documentDiffContext,
        ) as Dynamic)
          nodeChildren3(documentDiffContextResult);
        return lookup;
      };
      this.counts = {
        prev: nodeChildren2(this.prev),
        curr: nodeChildren2(this.curr),
      };
    }
    return this.counts;
  }
  nearTwins(
    documentDiffContext?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic {
    if (this.twins === null) {
      let { prev: hashCounts, curr: hashCounts2 }: Dynamic = this.hashCounts();
      let documentDiffContextHandler: Dynamic = (
        documentDiffContext2?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => {
        let items: Dynamic = [];
        let nodeChildren2 = (
          documentDiffContext3?: Dynamic,
          ..._extraArguments: unknown[]
        ): undefined => {
          if (documentDiffContext3.type === `codeBlock`) {
            let nodeContentKey2: Dynamic = nodeContentKey(
              documentDiffContext3,
              this,
            );
            if (
              !(
                hashCounts.get(nodeContentKey2) === 1 &&
                hashCounts2.get(nodeContentKey2) === 1
              ) &&
              commonNodeBlockId(documentDiffContext3, this) === null &&
              nodeWordCount(documentDiffContext3) >= MIN_CODE_BLOCK_WORDS
            ) {
              items.push(documentDiffContext3);
            }
            return;
          }
          if (!TEXT_BLOCK_NODE_TYPES.has(documentDiffContext3.type))
            for (let documentDiffContextResult of nodeChildren(
              documentDiffContext3,
            ) as Dynamic)
              nodeChildren2(documentDiffContextResult);
        };
        nodeChildren2(documentDiffContext2);
        return items;
      };
      this.twins = {
        prev: documentDiffContextHandler(this.prev),
        curr: documentDiffContextHandler(this.curr),
      };
    }
    return this.twins[documentDiffContext];
  }
};
var isDiffNodeObject: Dynamic = (
  diffNodeObject?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  typeof diffNodeObject == `object` &&
  !!diffNodeObject &&
  !Array.isArray(diffNodeObject);
function copyNodeAttributes(
  node?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (node === undefined)
    return {
      attrs: undefined,
      bad: false,
    };
  if (!isDiffNodeObject(node))
    return {
      attrs: undefined,
      bad: true,
    };
  let record: Dynamic = {};
  let index: number = 0;
  let index2: number = 0;
  for (let [
    copyNodeAttributesResult,
    copyNodeAttributesResult2,
  ] of Object.entries(node) as Dynamic)
    if (options.has(copyNodeAttributesResult)) {
      index2++;
    } else {
      defineEnumerableProperty(
        record,
        copyNodeAttributesResult,
        copyNodeAttributesResult2,
      );
      index++;
    }
  return {
    attrs: index > 0 || index2 === 0 ? record : undefined,
    bad: false,
  };
}
function copyDiffNode(
  diffNode2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (
    !isDiffNodeObject(diffNode2) ||
    typeof diffNode2.type != `string` ||
    (diffNode2.type === `text` && typeof diffNode2.text != `string`)
  )
    return null;
  let node: Dynamic = {
    type: diffNode2.type,
  };
  let bad: boolean = false;
  if (diffNode2.type === `text`) {
    node.text = diffNode2.text;
  }
  let copyNodeAttributes2: Dynamic = copyNodeAttributes(
    diffNode2.attrs,
    DIFF_NODE_ATTRIBUTES,
  );
  bad ||= copyNodeAttributes2.bad;
  if (copyNodeAttributes2.attrs !== undefined) {
    node.attrs = copyNodeAttributes2.attrs;
  }
  if (diffNode2.marks !== undefined)
    if (!Array.isArray(diffNode2.marks)) bad = true;
    else {
      let items: Dynamic = [];
      let index: number = 0;
      for (let copyDiffNodeResult of diffNode2.marks as Dynamic) {
        if (
          !isDiffNodeObject(copyDiffNodeResult) ||
          typeof copyDiffNodeResult.type != `string`
        ) {
          bad = true;
          continue;
        }
        if (DIFF_MARK_NAMES.has(copyDiffNodeResult.type)) {
          index++;
          continue;
        }
        let copyNodeAttributes3: Dynamic = copyNodeAttributes(
          copyDiffNodeResult.attrs,
          new (Set as Dynamic)(),
        );
        bad ||= copyNodeAttributes3.bad;
        items.push(
          copyNodeAttributes3.attrs === undefined
            ? {
                type: copyDiffNodeResult.type,
              }
            : {
                type: copyDiffNodeResult.type,
                attrs: copyNodeAttributes3.attrs,
              },
        );
      }
      if (items.length > 0 || index === 0) {
        node.marks = items;
      }
    }
  return {
    node: node,
    bad: bad,
  };
}
function copyDiffDocument(
  diffDocument?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let record: Dynamic = {
    doc: null,
    malformed: true,
    deep: new (Set as Dynamic)(),
    tooDeep: false,
  };
  let copyDiffNode2: Dynamic = copyDiffNode(diffDocument);
  if (copyDiffNode2 === null) return record;
  let malformed: Dynamic = copyDiffNode2.bad;
  let count: number = 1;
  let deep: Dynamic = new (Set as Dynamic)();
  let items: Dynamic = [];
  let updateContent = (
    node?: Dynamic,
    dst?: Dynamic,
    depth?: Dynamic,
    topIndex?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    let src: Dynamic = node.content;
    if (src !== undefined) {
      if (!Array.isArray(src)) {
        malformed = true;
        return;
      }
      dst.content = [];
      items.push({
        src: src,
        dst: dst,
        depth: depth,
        topIndex: topIndex,
      });
    }
  };
  for (updateContent(diffDocument, copyDiffNode2.node, 0, -1); items.length; ) {
    let {
      src: pop,
      dst: pop2,
      depth: pop3,
      topIndex: pop4,
    }: Dynamic = items.pop();
    for (let copyDiffDocumentResult of pop as Dynamic) {
      let copyDiffNode3: Dynamic = copyDiffNode(copyDiffDocumentResult);
      if (copyDiffNode3 === null) {
        malformed = true;
        continue;
      }
      malformed ||= copyDiffNode3.bad;
      if (++count > 4e6) return record;
      pop2.content.push(copyDiffNode3.node);
      let difference: Dynamic = pop4 === -1 ? pop2.content.length - 1 : pop4;
      if (pop3 + 1 > 1e3) {
        deep.add(difference);
      }
      updateContent(
        copyDiffDocumentResult,
        copyDiffNode3.node,
        pop3 + 1,
        difference,
      );
    }
  }
  return {
    doc: copyDiffNode2.node,
    malformed: malformed,
    deep: deep,
    tooDeep: deep.size > 0,
  };
}
function safelyCopyDiffDocument(
  safelyCopyDiffDocument2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  try {
    return copyDiffDocument(safelyCopyDiffDocument2);
  } catch {
    return {
      doc: null,
      malformed: true,
      deep: new (Set as Dynamic)(),
      tooDeep: false,
    };
  }
}
var emptyDiffStats: Dynamic = (..._extraArguments: unknown[]): Dynamic => ({
  ins: 0,
  del: 0,
  chg: 0,
  fmt: 0,
  move: 0,
  replace: 0,
});
var DEGRADATION_PRIORITY: Dynamic = new (Map as Dynamic)([
  [`budget`, 0],
  [`unreadable`, 1],
  [`exception`, 2],
]);
var emptyDocument: Dynamic = (..._extraArguments: unknown[]): Dynamic => ({
  type: `doc`,
  content: [],
});
function unreadableDocumentDiff(
  doc?: Dynamic,
  reason?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let ask: Dynamic = {
    reason: reason,
    nodeType: doc.type,
    bid: null,
    path: [],
  };
  return {
    doc: doc,
    changes: [],
    stats: emptyDiffStats(),
    degraded: true,
    degradedReason: reason,
    degradedScopes: [ask],
  };
}
function diffDocuments(
  diffDocuments2?: Dynamic,
  options?: Dynamic,
  context: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  return diffDocumentsWithWork(diffDocuments2, options, context).result;
}
var emptyDiffWork: Dynamic = (..._extraArguments: unknown[]): Dynamic => ({
  convertOps: 0,
  steps: 0,
});
var diffWorkSpent: Dynamic = (
  diffWorkSpent2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => ({
  convertOps: diffWorkSpent2.convertSpent(),
  steps: diffWorkSpent2.stepsSpent(),
});
function diffDocumentsWithWork(
  before?: Dynamic,
  after?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let nextDocument: Dynamic = safelyCopyDiffDocument(after);
  if (nextDocument.doc === null)
    return {
      result: unreadableDocumentDiff(emptyDocument(), `unreadable`),
      work: emptyDiffWork(),
    };
  if (before == null)
    return {
      result: nextDocument.malformed
        ? unreadableDocumentDiff(nextDocument.doc, `unreadable`)
        : {
            doc: nextDocument.doc,
            changes: [],
            stats: emptyDiffStats(),
            degraded: false,
          },
      work: emptyDiffWork(),
    };
  let previousDocument: Dynamic = safelyCopyDiffDocument(before);
  if (previousDocument.doc === null)
    return {
      result: unreadableDocumentDiff(nextDocument.doc, `unreadable`),
      work: emptyDiffWork(),
    };
  if (previousDocument.tooDeep || nextDocument.tooDeep)
    return {
      result: diffTooDeepDocument(nextDocument),
      work: emptyDiffWork(),
    };
  let previous: Dynamic = previousDocument.doc;
  let next: Dynamic = nextDocument.doc;
  let differentRootTypes: boolean = previous.type !== next.type;
  if (differentRootTypes) {
    previous = wrapNodeAsDocument(previous);
    next = wrapNodeAsDocument(next);
  }
  let work: Dynamic = new (DocumentDiffContext as Dynamic)(
    previous,
    next,
    options,
  );
  if (
    previousDocument.malformed ||
    nextDocument.malformed ||
    differentRootTypes
  ) {
    work.degrade(`unreadable`, next);
  }
  let diffDocument: Dynamic;
  let baseWork: Dynamic = emptyDiffWork();
  try {
    diffDocument = diffRootNode(previous, next, work);
    detectMovedNodes(diffDocument, work);
    collapseNestedChangeAliases(diffDocument, work);
    mergeAdjacentMoves(diffDocument, work);
    removeRedundantMoveGhosts(diffDocument, work);
  } catch {
    let filteredScopes: Dynamic = work.scopes.filter(
      (scope?: Dynamic, ..._extraArguments: unknown[]) =>
        scope.reason === `unreadable`,
    );
    baseWork = diffWorkSpent(work);
    work = new (DocumentDiffContext as Dynamic)(previous, next, options);
    for (let diffDocumentsWithWorkResult of filteredScopes as Dynamic)
      work.scopes.push(diffDocumentsWithWorkResult);
    work.degrade(`exception`, next);
    diffDocument = replaceDocumentContents(previous, next, work);
  }
  let usedWork: Dynamic = diffWorkSpent(work);
  let workCounts: Dynamic = {
    convertOps: baseWork.convertOps + usedWork.convertOps,
    steps: baseWork.steps + usedWork.steps,
  };
  let finalized: Dynamic;
  try {
    finalized = finalizeDocumentDiff(diffDocument, work);
  } catch {
    return {
      result: unreadableDocumentDiff(next, `exception`),
      work: workCounts,
    };
  }
  let {
    changes: changes,
    stats: stats,
    scopes: finalized2,
  }: Dynamic = finalized;
  let result: Dynamic = {
    doc: diffDocument,
    changes: changes,
    stats: stats,
    degraded: finalized2.length > 0,
  };
  if (finalized2.length) {
    result.degradedReason = finalized2.reduce(
      (
        accumulator?: Dynamic,
        finalized3?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic =>
        (DEGRADATION_PRIORITY.get(finalized3.reason) ?? 0) >
        (DEGRADATION_PRIORITY.get(accumulator) ?? 0)
          ? finalized3.reason
          : accumulator,
      finalized2[0].reason,
    );
    result.degradedScopes = finalized2;
  }
  return {
    result: result,
    work: workCounts,
  };
}
var wrapNodeAsDocument: Dynamic = (
  wrapNodeAsDocument2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  wrapNodeAsDocument2.type === `doc`
    ? wrapNodeAsDocument2
    : INLINE_NODE_TYPES.has(wrapNodeAsDocument2.type)
      ? {
          type: `doc`,
          content: [
            {
              type: `paragraph`,
              content: [wrapNodeAsDocument2],
            },
          ],
        }
      : {
          type: `doc`,
          content: [wrapNodeAsDocument2],
        };
function diffTooDeepDocument(
  diff?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let doc: Dynamic = diff.doc;
  let summary: string = `Not compared: nested too deeply`;
  let changes: Dynamic = [];
  let degradedScopes: Dynamic = [];
  let content: Dynamic = [];
  nodeChildren(doc).forEach(
    (
      nodeChildren2?: Dynamic,
      index?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      if (!diff.deep.has(index)) {
        content.push(nodeChildren2);
        return;
      }
      let label: string = `c${changes.length + 1}`;
      changes.push({
        id: label,
        kind: `chg`,
        nodeType: nodeChildren2.type,
        summary: summary,
        path: [index],
      });
      degradedScopes.push({
        reason: `unreadable`,
        nodeType: nodeChildren2.type,
        bid: nodeBlockId(nodeChildren2),
        path: [index],
      });
      let attrs: Dynamic = {
        ...nodeChildren2.attrs,
        [DIFF_ATTRIBUTE_NAMES.kind]: `chg`,
        [DIFF_ATTRIBUTE_NAMES.id]: label,
        [DIFF_ATTRIBUTE_NAMES.summary]: summary,
      };
      content.push({
        ...nodeChildren2,
        attrs: attrs,
      });
    },
  );
  if (!degradedScopes.length) {
    degradedScopes.push({
      reason: `unreadable`,
      nodeType: doc.type,
      bid: null,
      path: [],
    });
  }
  let stats: Dynamic = emptyDiffStats();
  stats.chg = changes.length;
  return {
    doc: {
      ...doc,
      content: content,
    },
    changes: changes,
    stats: stats,
    degraded: true,
    degradedReason: `unreadable`,
    degradedScopes: degradedScopes,
  };
}
function diffRootNode(
  diffRootNode2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return nodeContentKey(diffRootNode2, context) ===
    nodeContentKey(options, context) &&
    !hasChangedInlineRuns(diffRootNode2, options, context)
    ? options
    : diffRootNode2.type === options.type &&
        DIFFABLE_NODE_TYPES.has(options.type)
      ? diffNode(diffRootNode2, options, context)
      : (context.degrade(`unreadable`, options),
        replaceDocumentContents(diffRootNode2, options, context));
}
function replaceDocumentContents(
  replaceDocumentContents2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  try {
    let content: Dynamic = [
      ...nodeChildren(replaceDocumentContents2).map(
        (nodeChildren2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          markNodeInsertionOrDeletion(
            nodeChildren2,
            `del`,
            createChangeRecord(
              `del`,
              nodeChildren2.type,
              nodeDeletedSummary(nodeChildren2),
            ),
            context,
          ),
      ),
      ...nodeChildren(options).map(
        (nodeChildren2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          markNodeInsertionOrDeletion(
            nodeChildren2,
            `ins`,
            createChangeRecord(
              `ins`,
              nodeChildren2.type,
              nodeAddedSummary(nodeChildren2),
            ),
            context,
          ),
      ),
    ];
    return {
      ...options,
      content: content,
    };
  } catch {
    return options;
  }
}
var nodeChildren: Dynamic = (
  node?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => (Array.isArray(node.content) ? node.content : []);
var nodeAttributes: Dynamic = (
  node?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  node.attrs !== null && typeof node.attrs == `object` ? node.attrs : {};
var nodeAttribute: Dynamic = (
  node?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => ownProperty(nodeAttributes(node), options);
var nodeBlockId: Dynamic = (
  nodeBlockId2?: Dynamic,
  ..._extraArguments: unknown[]
): null | string => {
  let nodeAttribute2: Dynamic = nodeAttribute(nodeBlockId2, `bid`);
  return typeof nodeAttribute2 == `string` && nodeAttribute2 !== ``
    ? nodeAttribute2
    : null;
};
var commonNodeBlockId: Dynamic = (
  commonNodeBlockId2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let nodeBlockId2: Dynamic = nodeBlockId(commonNodeBlockId2);
  return nodeBlockId2 !== null && options.common.has(nodeBlockId2)
    ? nodeBlockId2
    : null;
};
var internKey: Dynamic = (
  internKey2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let internKeyEntry: Dynamic = internKey2.get(options);
  if (internKeyEntry === undefined) {
    internKeyEntry = internKey2.size;
    internKey2.set(options, internKeyEntry);
  }
  return internKeyEntry;
};
var withNodeChildren: Dynamic = (
  node?: Dynamic,
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let record: Dynamic = {
    ...node,
  };
  if (items.length || node.content !== undefined) {
    record.content = items;
  } else {
    delete record.content;
  }
  return record;
};
function countDocumentBlockIds(
  countDocumentBlockIds2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let lookup: Dynamic = new (Map as Dynamic)();
  let nodeChildren2 = (
    countDocumentBlockIds3?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    let nodeBlockId2: Dynamic = nodeBlockId(countDocumentBlockIds3);
    if (nodeBlockId2 !== null) {
      let lookupEntry: Dynamic = lookup.get(nodeBlockId2);
      if (lookupEntry) {
        lookupEntry.count++;
      } else {
        lookup.set(nodeBlockId2, {
          type: countDocumentBlockIds3.type,
          count: 1,
        });
      }
    }
    if (!TEXT_BLOCK_NODE_TYPES.has(countDocumentBlockIds3.type))
      for (let countDocumentBlockIdsResult of nodeChildren(
        countDocumentBlockIds3,
      ) as Dynamic)
        nodeChildren2(countDocumentBlockIdsResult);
  };
  nodeChildren2(countDocumentBlockIds2);
  return lookup;
}
function indexRunBlocks(
  indexRunBlocks2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let lookup: Dynamic = new (Map as Dynamic)();
  for (let ask of (Array.isArray(indexRunBlocks2)
    ? indexRunBlocks2
    : []) as Dynamic)
    if (typeof ask?.bid == `string`) {
      lookup.set(ask.bid, ask);
    }
  return lookup;
}
var nodeDefaultAttributes: Dynamic = (
  nodeDefault?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => ownProperty(DEFAULT_NODE_ATTRIBUTES, nodeDefault) ?? {};
var nodeDefaultAttribute: Dynamic = (
  nodeDefault?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => ownProperty(nodeDefaultAttributes(nodeDefault), options) ?? null;
var effectiveNodeAttribute: Dynamic = (
  effectiveNode?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  nodeAttribute(effectiveNode, options) ??
  nodeDefaultAttribute(effectiveNode.type, options);
var equalValues: Dynamic = (
  equalValues2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  equalValues2 === options ||
  stableStringify(equalValues2) === stableStringify(options);
var isSemanticNodeAttribute: Dynamic = (
  semanticNode?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  !IDENTITY_NODE_ATTRIBUTES.has(semanticNode) &&
  !DIFF_NODE_ATTRIBUTES.has(semanticNode);
function changedNodeAttributes(
  changedNode?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let uniqueItems: Dynamic = new (Set as Dynamic)([
    ...Object.keys(nodeAttributes(changedNode)),
    ...Object.keys(nodeAttributes(options)),
  ]);
  let items: Dynamic = [];
  for (let changedNodeAttributesResult of uniqueItems as Dynamic)
    if (
      isSemanticNodeAttribute(changedNodeAttributesResult) &&
      !equalValues(
        effectiveNodeAttribute(changedNode, changedNodeAttributesResult),
        effectiveNodeAttribute(options, changedNodeAttributesResult),
      )
    ) {
      items.push(changedNodeAttributesResult);
    }
  return items;
}
function semanticNodeAttributes(
  semanticNode?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let record: Dynamic = {
    ...nodeDefaultAttributes(semanticNode.type),
  };
  for (let [
    semanticNodeAttributesResult,
    semanticNodeAttributesResult2,
  ] of Object.entries(nodeAttributes(semanticNode)) as Dynamic)
    if (
      isSemanticNodeAttribute(semanticNodeAttributesResult) &&
      semanticNodeAttributesResult2 != null
    ) {
      defineEnumerableProperty(
        record,
        semanticNodeAttributesResult,
        semanticNodeAttributesResult2,
      );
    }
  return record;
}
function nodeAttributeChanges(
  node?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  items: Dynamic = changedNodeAttributes(node, options),
  ..._extraArguments: unknown[]
): Dynamic {
  if (!items.length) return null;
  let before: Dynamic = {};
  for (let nodeAttributeChangesResult of items as Dynamic)
    defineEnumerableProperty(
      before,
      nodeAttributeChangesResult,
      effectiveNodeAttribute(node, nodeAttributeChangesResult),
    );
  return {
    summary: nodeAttributeChangeSummary(
      options.type,
      semanticNodeAttributes(node),
      semanticNodeAttributes(options),
      items,
      context.opts,
    ),
    before: before,
  };
}
var nonnullAttributes: Dynamic = (
  nonnull?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let record: Dynamic = {};
  for (let [
    nonnullAttributesResult,
    nonnullAttributesResult2,
  ] of Object.entries(nonnull ?? {}) as Dynamic)
    if (nonnullAttributesResult2 != null) {
      defineEnumerableProperty(
        record,
        nonnullAttributesResult,
        nonnullAttributesResult2,
      );
    }
  return record;
};
var markKey: Dynamic = (
  markKey2?: Dynamic,
  ..._extraArguments: unknown[]
): string =>
  markKey2.type + stableStringify(nonnullAttributes(markKey2.attrs));
var marksKey: Dynamic = (
  marksKey2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => marksKey2.map(markKey).toSorted().join(`|`);
function nodeContentKey(
  nodeContentKey2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let keyEntry: Dynamic = options.keys.get(nodeContentKey2);
  if (keyEntry !== undefined) return keyEntry;
  let items: Dynamic;
  let nodeContentKeyResult: Dynamic;
  try {
    let stringify: string = JSON.stringify(nodeContentKey2.type);
    let nodeAttributes2: Dynamic = nodeAttributes(nodeContentKey2);
    for (let nodeContentKeyResult2 of Object.keys(
      nodeAttributes2,
    ).toSorted() as Dynamic) {
      if (!isSemanticNodeAttribute(nodeContentKeyResult2)) continue;
      let effectiveNodeAttribute2: Dynamic = effectiveNodeAttribute(
        nodeContentKey2,
        nodeContentKeyResult2,
      );
      if (
        !equalValues(
          effectiveNodeAttribute2,
          nodeDefaultAttribute(nodeContentKey2.type, nodeContentKeyResult2),
        )
      ) {
        stringify += `${JSON.stringify(nodeContentKeyResult2)}=${stableStringify(effectiveNodeAttribute2)};`;
      }
    }
    if (nodeContentKey2.type === `text`) {
      stringify += `|${JSON.stringify(typeof nodeContentKey2.text == `string` ? nodeContentKey2.text : ``)}`;
    }
    if (nodeContentKey2.marks?.length) {
      stringify += `|m${JSON.stringify(marksKey(nodeContentKey2.marks))}`;
    }
    nodeContentKeyResult = stringify.length;
    let nodeChildren2: Dynamic = nodeChildren(nodeContentKey2);
    if (nodeChildren2.length) {
      stringify += `[${nodeChildren2.map((nodeChildren3?: Dynamic, ..._extraArguments: unknown[]): Dynamic => nodeContentKey(nodeChildren3, options)).join(`,`)}]`;
      nodeContentKeyResult += nodeChildren2.length + 1;
      for (let nodeContentKeyResult2 of nodeChildren2 as Dynamic)
        nodeContentKeyResult += options.keyLens.get(nodeContentKeyResult2);
    }
    items = `#${internKey(options.keyIds, stringify)}`;
  } catch {
    items = `!unkeyable${options.unkeyable++}`;
    nodeContentKeyResult = items.length;
  }
  options.keys.set(nodeContentKey2, items);
  options.keyLens.set(nodeContentKey2, nodeContentKeyResult);
  return items;
}
function nodeContentKeyLength(
  nodeContentKeyLength2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  nodeContentKey(nodeContentKeyLength2, options);
  return options.keyLens.get(nodeContentKeyLength2);
}
function nodeWordBag(
  nodeWordBag2?: Dynamic,
  request?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let bagEntry: Dynamic = request.bags.get(nodeWordBag2);
  if (bagEntry !== undefined) return bagEntry;
  let items: Dynamic = [];
  let match = (
    nodeWordBag3?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (nodeWordBag3.type === `text`) {
      for (let nodeWordBagResult of ((typeof nodeWordBag3.text == `string`
        ? nodeWordBag3.text
        : ``
      ).match(WORD_PATTERN) ?? []) as Dynamic)
        items.push(internKey(request.words, nodeWordBagResult));
      return;
    }
    if (INLINE_NODE_TYPES.has(nodeWordBag3.type)) {
      items.push(internKey(request.words, `atom ${nodeWordBag3.type}`));
    }
    for (let nodeWordBagResult of nodeChildren(nodeWordBag3) as Dynamic)
      match(nodeWordBagResult);
  };
  match(nodeWordBag2);
  let toSorted: Dynamic = Int32Array.from(items).toSorted();
  request.bags.set(nodeWordBag2, toSorted);
  return toSorted;
}
function textWordBag(
  textWordBag2?: Dynamic,
  request?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return Int32Array.from(
    (textWordBag2.match(WORD_PATTERN) ?? []).map(
      (match?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        internKey(request.words, match),
    ),
  ).toSorted();
}
function bagSimilarity(
  items?: Dynamic,
  items2?: Dynamic,
  ..._extraArguments: unknown[]
) {
  if (!items.length || !items2.length) return +(items.length === items2.length);
  let index: number = 0;
  let index2: number = 0;
  let index3: number = 0;
  for (; index < items.length && index2 < items2.length; )
    if (items[index] === items2[index2]) {
      index3++;
      index++;
      index2++;
    } else {
      if (items[index] < items2[index2]) {
        index++;
      } else {
        index2++;
      }
    }
  return (2 * index3) / (items.length + items2.length);
}
var nodeTokenWeight: Dynamic = (
  node?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let tokenBoundEntry: Dynamic = options.tokenBounds.get(node);
  if (tokenBoundEntry !== undefined) return tokenBoundEntry;
  let textCount: Dynamic =
    node.type === `text`
      ? typeof node.text == `string`
        ? node.text.length
        : 0
      : 1;
  for (let nodeTokenWeightResult of nodeChildren(node) as Dynamic)
    textCount += nodeTokenWeight(nodeTokenWeightResult, options);
  options.tokenBounds.set(node, textCount);
  return textCount;
};
var nodeChildTokenWeight = (
  nodeChild?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) => nodeTokenWeight(nodeChild, options) - 1;
var nodeAttributeWeight: Dynamic = (
  node?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let attrWeightEntry: Dynamic = options.attrWeights.get(node);
  if (attrWeightEntry !== undefined) return attrWeightEntry;
  let count: number = 0;
  for (let nodeAttributeWeightResult of Object.keys(
    nodeAttributes(node),
  ) as Dynamic) {
    if (!isSemanticNodeAttribute(nodeAttributeWeightResult)) continue;
    count += 1;
    let effectiveNodeAttribute2: Dynamic = effectiveNodeAttribute(
      node,
      nodeAttributeWeightResult,
    );
    if (typeof effectiveNodeAttribute2 == `string`)
      count += effectiveNodeAttribute2.length;
    else if (
      typeof effectiveNodeAttribute2 == `object` &&
      effectiveNodeAttribute2
    )
      try {
        count += stableStringify(effectiveNodeAttribute2).length;
      } catch {
        count += MAX_PAIR_TOKEN_CHARACTERS;
      }
  }
  options.attrWeights.set(node, count);
  return count;
};
var nodeWordCount: Dynamic = (
  nodeWordCount2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let wordCountEntry: Dynamic = options?.wordCounts.get(nodeWordCount2);
  if (wordCountEntry !== undefined) return wordCountEntry;
  let count: number = 0;
  if (nodeWordCount2.type !== `text`)
    for (let nodeWordCountResult of nodeChildren(nodeWordCount2) as Dynamic)
      count += nodeWordCount(nodeWordCountResult, options);
  else
    count =
      (typeof nodeWordCount2.text == `string` ? nodeWordCount2.text : ``).match(
        WORD_PATTERN,
      )?.length ?? 0;
  options?.wordCounts.set(nodeWordCount2, count);
  return count;
};
var textBlockText: Dynamic = (
  textBlockText2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  nodeChildren(textBlockText2)
    .map(
      (nodeChildren2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        nodeChildren2.type === `text` && typeof nodeChildren2.text == `string`
          ? nodeChildren2.text
          : ``,
    )
    .join(``);
function canPairNodeKinds(
  pairNodeKinds?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return pairNodeKinds.type !== options.type ||
    !DIFFABLE_NODE_TYPES.has(pairNodeKinds.type)
    ? false
    : pairNodeKinds.type !== `embed` ||
        equalValues(
          effectiveNodeAttribute(pairNodeKinds, `ref`),
          effectiveNodeAttribute(options, `ref`),
        );
}
function canConvertTextBlockKinds(
  convertTextBlockKinds?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let matchesType: boolean =
    convertTextBlockKinds.type === `paragraph` && options.type === `codeBlock`;
  return (
    (convertTextBlockKinds.type === `codeBlock` &&
      options.type === `paragraph`) ||
    (matchesType &&
      nodeChildren(convertTextBlockKinds).every(
        (nodeChildren2?: Dynamic, ..._extraArguments: unknown[]): boolean =>
          nodeChildren2.type === `text` || nodeChildren2.type === `hardBreak`,
      ))
  );
}
function canPairOrConvertNodes(
  pairOrConvertNodes?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return canPairNodeKinds(pairOrConvertNodes, options)
    ? true
    : canConvertTextBlockKinds(pairOrConvertNodes, options) &&
        bagSimilarity(
          nodeWordBag(pairOrConvertNodes, context),
          nodeWordBag(options, context),
        ) >= MIN_CODE_CONVERSION_SIMILARITY;
}
var MAX_WEIGHTED_SEQUENCE_LENGTH: number = 2e3;
function weightedStablePairs(
  items?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let itemsCount: Dynamic = items.length;
  let record: Dynamic = Array.from<Dynamic, Dynamic>(
    {
      length: itemsCount + 1,
    },
    (..._extraArguments: unknown[]) => 1 / 0,
  );
  for (let difference: number = itemsCount - 1; difference >= 0; difference--)
    record[difference] = Math.min(items[difference], record[difference + 1]);
  let lookup: Dynamic = new (Map as Dynamic)();
  items
    .toSorted(
      (
        item?: Dynamic,
        item2?: Dynamic,
        ..._extraArguments: unknown[]
      ): number => item - item2,
    )
    .forEach(
      (
        toSorted?: Dynamic,
        index?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => lookup.set(toSorted, index),
    );
  let items2: Dynamic = [];
  let items3: Dynamic = [];
  let selectStationaryNodes2 = (..._extraArguments: unknown[]): undefined => {
    if (items3.length)
      for (let weightedStablePairsResult of selectStationaryNodes(
        items3,
        items,
        options,
        lookup,
      ) as Dynamic)
        items2.push(weightedStablePairsResult);
    items3 = [];
  };
  let amount: number = -1 / 0;
  for (let index: number = 0; index < itemsCount; index++) {
    if (items[index] > amount && items[index] < record[index + 1]) {
      selectStationaryNodes2();
      items2.push(index);
    } else {
      items3.push(index);
    }
    amount = Math.max(amount, items[index]);
  }
  selectStationaryNodes2();
  return items2;
}
function selectStationaryNodes(
  items?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (items.length > MAX_WEIGHTED_SEQUENCE_LENGTH)
    return longestIncreasingSubsequence(
      items.map(
        (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          options[item],
      ),
    ).map(
      (
        longestIncreasingSubsequence2?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => items[longestIncreasingSubsequence2],
    );
  let mappedItems: Dynamic = items.map(
    (item?: Dynamic, ..._extraArguments: unknown[]): number => {
      let contextItem: Dynamic = context[options[item]];
      let matchesType: boolean =
        contextItem.type === `paragraph` &&
        effectiveNodeAttribute(contextItem, `heading`) === null &&
        /\S/.test(textBlockText(contextItem));
      let dependencyEntry: Dynamic = dependencies.get(options[item]);
      return (
        (matchesType ? 1e6 : 0) -
        Math.min(Math.abs(dependencyEntry - item), 999) * 1e3 +
        +(dependencyEntry > item)
      );
    },
  );
  return weightedIncreasingSubsequence(
    items.map(
      (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => options[item],
    ),
    mappedItems,
  ).map(
    (
      weightedIncreasingSubsequence2?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => items[weightedIncreasingSubsequence2],
  );
}
function indexNodeParents(
  indexNodeParents2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let lookup: Dynamic = new (Map as Dynamic)();
  let nodeChildren2 = (
    parent?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    nodeChildren(parent).forEach(
      (
        nodeChildren3?: Dynamic,
        index?: Dynamic,
        ..._extraArguments: unknown[]
      ): undefined => {
        lookup.set(nodeChildren3, {
          parent: parent,
          i: index,
        });
        nodeChildren2(nodeChildren3);
      },
    );
  };
  nodeChildren2(indexNodeParents2);
  return lookup;
}
function annotateNodeChange(
  annotateNodeChange2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  annotateNodeChange2.attrs = {
    ...annotateNodeChange2.attrs,
    [DIFF_ATTRIBUTE_NAMES.kind]: options,
    [DIFF_ATTRIBUTE_NAMES.id]: ``,
    ...argument,
  };
  dependencies.nodeCh.set(annotateNodeChange2, context);
}
function annotateAttributeChange(
  annotate?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let changeRecord: Dynamic = createChangeRecord(
    `chg`,
    annotate.type,
    options.summary,
  );
  annotateNodeChange(annotate, `chg`, changeRecord, context, {
    [DIFF_ATTRIBUTE_NAMES.summary]: options.summary,
    [DIFF_ATTRIBUTE_NAMES.before]: options.before,
  });
  return changeRecord;
}
var DELETED_DROPDOWN_LABEL_LIMIT: number = 48;
var deletedDropdownFace: Dynamic = (
  deletedDropdownFace2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  if (options !== `del` || deletedDropdownFace2.type !== `dropdown`) return;
  let dropdownDisplayLabel2: Dynamic = dropdownDisplayLabel(
    nodeAttributes(deletedDropdownFace2),
    context.opts,
  );
  return dropdownDisplayLabel2 === null
    ? undefined
    : {
        [DIFF_ATTRIBUTE_NAMES.face]: truncateCodePoints(
          dropdownDisplayLabel2,
          DELETED_DROPDOWN_LABEL_LIMIT,
        ),
      };
};
function createChangeMark(
  type?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  summary?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let record: Dynamic = {
    type: type,
    attrs:
      summary === undefined
        ? {
            id: ``,
          }
        : {
            id: ``,
            summary: summary,
          },
  };
  context.markCh.set(record, options);
  return record;
}
var isInlineChangeBoundary: Dynamic = (
  inlineChangeBoundary?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  TEXT_BLOCK_NODE_TYPES.has(inlineChangeBoundary.type) ||
  (!DIFFABLE_NODE_TYPES.has(inlineChangeBoundary.type) &&
    INLINE_NODE_TYPES.has(options.type));
function markNodeInsertionOrDeletion(
  markNodeInsertionOrDeletion2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let changeMark: Dynamic = createChangeMark(
    options === `ins` ? DIFF_MARK_TYPES.ins : DIFF_MARK_TYPES.del,
    context,
    dependencies,
  );
  let nodeChildren2: Dynamic = (
    markNodeInsertionOrDeletion3?: Dynamic,
    options2?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    if (markNodeInsertionOrDeletion3.type === `text`)
      return {
        ...markNodeInsertionOrDeletion3,
        marks: [...(markNodeInsertionOrDeletion3.marks ?? []), changeMark],
      };
    let record: Dynamic = {
      ...markNodeInsertionOrDeletion3,
    };
    if (options2) {
      annotateNodeChange(
        record,
        options,
        context,
        dependencies,
        deletedDropdownFace(
          markNodeInsertionOrDeletion3,
          options,
          dependencies,
        ),
      );
      return record;
    }
    let nodeChildren4: Dynamic = nodeChildren(markNodeInsertionOrDeletion3);
    if (nodeChildren4.length) {
      record.content = nodeChildren4.map(
        (nodeChildren5?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          nodeChildren2(
            nodeChildren5,
            isInlineChangeBoundary(markNodeInsertionOrDeletion3, nodeChildren5),
          ),
      );
    }
    dependencies.source.set(record, markNodeInsertionOrDeletion3);
    return record;
  };
  let nodeChildren3: Dynamic = nodeChildren2(
    markNodeInsertionOrDeletion2,
    false,
  );
  annotateNodeChange(nodeChildren3, options, context, dependencies);
  dependencies.regionRoots.set(nodeChildren3, options);
  return nodeChildren3;
}
var lowercaseInitial = (
  lowercaseInitial2?: Dynamic,
  ..._extraArguments: unknown[]
) =>
  `${lowercaseInitial2.charAt(0).toLowerCase()}${lowercaseInitial2.slice(1)}`;
var nodeReplacementSummary = (
  nodeReplacementSummary2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) =>
  nodeReplacementSummary2.type === options.type
    ? `${nodeKindLabel(options)} replaced`
    : `${nodeKindLabel(nodeReplacementSummary2)} replaced with ${lowercaseInitial(nodeKindLabel(options))}`;
function replaceNodePair(
  replaceNodePair2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let changeRecord: Dynamic = createChangeRecord(
    `replace`,
    options.type,
    nodeReplacementSummary(replaceNodePair2, options),
  );
  let markNodeInsertionOrDeletion2: Dynamic = markNodeInsertionOrDeletion(
    replaceNodePair2,
    `del`,
    changeRecord,
    context,
  );
  let markNodeInsertionOrDeletion3: Dynamic = markNodeInsertionOrDeletion(
    options,
    `ins`,
    changeRecord,
    context,
  );
  markNodeInsertionOrDeletion2.attrs = {
    ...markNodeInsertionOrDeletion2.attrs,
    [DIFF_ATTRIBUTE_NAMES.pair]: `old`,
  };
  markNodeInsertionOrDeletion3.attrs = {
    ...markNodeInsertionOrDeletion3.attrs,
    [DIFF_ATTRIBUTE_NAMES.pair]: `new`,
  };
  context.settled.add(markNodeInsertionOrDeletion2);
  context.settled.add(markNodeInsertionOrDeletion3);
  return [markNodeInsertionOrDeletion2, markNodeInsertionOrDeletion3];
}
var emptySequenceMovementState: Dynamic = (
  ..._extraArguments: unknown[]
): Dynamic => ({
  reordered: false,
  moved: new (Set as Dynamic)(),
  hoisted: [],
});
function alignNodeSequences(
  items?: Dynamic,
  items2?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items3: Dynamic = [];
  let lookup: Dynamic = new (Map as Dynamic)();
  items2.forEach(
    (
      item?: Dynamic,
      index?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      let commonNodeBlockId2: Dynamic = commonNodeBlockId(item, context);
      if (commonNodeBlockId2 !== null) {
        lookup.set(commonNodeBlockId2, index);
      }
    },
  );
  let items4: Dynamic = [];
  let items5: Dynamic = [];
  items.forEach(
    (
      item?: Dynamic,
      index?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      let commonNodeBlockId2: Dynamic = commonNodeBlockId(item, context);
      let lookupEntry: Dynamic =
        commonNodeBlockId2 === null
          ? undefined
          : lookup.get(commonNodeBlockId2);
      if (lookupEntry !== undefined) {
        items4.push(index);
        items5.push(lookupEntry);
      }
    },
  );
  let weightedStablePairs2: Dynamic = weightedStablePairs(items5, items2);
  if (dependencies !== undefined) {
    let alignNodeSequenceAnchors2: Dynamic = alignNodeSequenceAnchors(
      items,
      items2,
      items4,
      items5,
      weightedStablePairs2,
      context,
      dependencies,
    );
    if (alignNodeSequenceAnchors2 !== null) return alignNodeSequenceAnchors2;
  }
  let count: number = 0;
  let count2: number = 0;
  for (let alignNodeSequencesResult of weightedStablePairs2 as Dynamic) {
    let itemItem: Dynamic = items4[alignNodeSequencesResult];
    let itemItem2: Dynamic = items5[alignNodeSequencesResult];
    alignNodeSequenceRange(
      items,
      count,
      itemItem,
      items2,
      count2,
      itemItem2,
      context,
      items3,
    );
    let itemItem3: Dynamic = items[itemItem];
    let itemItem4: Dynamic = items2[itemItem2];
    if (
      nodeContentKey(itemItem3, context) === nodeContentKey(itemItem4, context)
    ) {
      items3.push({
        t: `keep`,
        a: itemItem3,
        b: itemItem4,
      });
    } else {
      if (
        canPairNodeKinds(itemItem3, itemItem4) ||
        canConvertTextBlockKinds(itemItem3, itemItem4)
      ) {
        items3.push({
          t: `pair`,
          a: itemItem3,
          b: itemItem4,
        });
      } else {
        items3.push(
          {
            t: `del`,
            a: itemItem3,
          },
          {
            t: `ins`,
            b: itemItem4,
          },
        );
      }
    }
    count = itemItem + 1;
    count2 = itemItem2 + 1;
  }
  alignNodeSequenceRange(
    items,
    count,
    items.length,
    items2,
    count2,
    items2.length,
    context,
    items3,
  );
  return items3;
}
function alignNodeSequenceAnchors(
  items?: Dynamic,
  items2?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  argument2?: Dynamic,
  argument3?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let context2: Dynamic = context;
  let dependencies2: Dynamic = dependencies;
  if (!context2.length) {
    let alignNodeSequenceAnchorsHandler: Dynamic = (
      alignNodeSequenceAnchors2?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => {
      let lookup3: Dynamic = new (Map as Dynamic)();
      alignNodeSequenceAnchors2.forEach(
        (
          item?: Dynamic,
          index?: Dynamic,
          ..._extraArguments: unknown[]
        ): undefined => {
          let nodeContentKey2: Dynamic = nodeContentKey(item, argument2);
          lookup3.set(
            nodeContentKey2,
            lookup3.has(nodeContentKey2) ? -1 : index,
          );
        },
      );
      return lookup3;
    };
    let alignNodeSequenceAnchorsHandler2: Dynamic =
      alignNodeSequenceAnchorsHandler(items);
    let alignNodeSequenceAnchorsHandler3: Dynamic =
      alignNodeSequenceAnchorsHandler(items2);
    let items4: Dynamic = [];
    for (let [
      alignNodeSequenceAnchorsResult2,
      alignNodeSequenceAnchorsResult3,
    ] of alignNodeSequenceAnchorsHandler2 as Dynamic) {
      let alignNodeSequenceAnchorsHandlerEntry: Dynamic =
        alignNodeSequenceAnchorsHandler3.get(alignNodeSequenceAnchorsResult2);
      if (
        alignNodeSequenceAnchorsResult3 >= 0 &&
        alignNodeSequenceAnchorsHandlerEntry !== undefined &&
        alignNodeSequenceAnchorsHandlerEntry >= 0
      ) {
        items4.push([
          alignNodeSequenceAnchorsResult3,
          alignNodeSequenceAnchorsHandlerEntry,
        ]);
      }
    }
    items4.sort(
      (
        item?: Dynamic,
        item2?: Dynamic,
        ..._extraArguments: unknown[]
      ): number => item[0] - item2[0],
    );
    context2 = items4.map(
      (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => item[0],
    );
    dependencies2 = items4.map(
      (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => item[1],
    );
  }
  let uniqueItems: Dynamic = new (Set as Dynamic)(
    context2 === context
      ? argument
      : weightedStablePairs(dependencies2, items2),
  );
  let difference: number = context2.length - uniqueItems.size;
  if (difference < 2 || difference <= MIN_TEXT_PAIR_SIMILARITY * items2.length)
    return null;
  argument3.reordered = true;
  dependencies2.forEach(
    (
      dependency?: Dynamic,
      index?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      if (!uniqueItems.has(index)) {
        argument3.moved.add(items2[dependency]);
      }
    },
  );
  let lookup: Dynamic = new (Map as Dynamic)();
  context2.forEach(
    (
      context3?: Dynamic,
      index?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => lookup.set(dependencies2[index], context3),
  );
  let uniqueItems2: Dynamic = new (Set as Dynamic)(context2);
  let lookup2: Dynamic = new (Map as Dynamic)();
  let alignNodeSequenceAnchorsResult: number = -1;
  for (let index: number = 0; index < items.length; index++) {
    if (uniqueItems2.has(index)) {
      alignNodeSequenceAnchorsResult = index;
      continue;
    }
    let lookupEntry: Dynamic = lookup2.get(alignNodeSequenceAnchorsResult);
    if (lookupEntry === undefined) {
      lookup2.set(alignNodeSequenceAnchorsResult, (lookupEntry = []));
    }
    lookupEntry.push({
      t: `del`,
      a: items[index],
    });
  }
  let items3: Dynamic = [...(lookup2.get(-1) ?? [])];
  items2.forEach(
    (
      item?: Dynamic,
      index?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      let lookupEntry: Dynamic = lookup.get(index);
      if (lookupEntry === undefined) {
        items3.push({
          t: `ins`,
          b: item,
        });
        return;
      }
      let itemItem: Dynamic = items[lookupEntry];
      if (
        nodeContentKey(itemItem, argument2) === nodeContentKey(item, argument2)
      ) {
        items3.push({
          t: `keep`,
          a: itemItem,
          b: item,
        });
      } else {
        if (
          canPairNodeKinds(itemItem, item) ||
          canConvertTextBlockKinds(itemItem, item)
        ) {
          items3.push({
            t: `pair`,
            a: itemItem,
            b: item,
          });
        } else {
          items3.push(
            {
              t: `del`,
              a: itemItem,
            },
            {
              t: `ins`,
              b: item,
            },
          );
        }
      }
      for (let alignNodeSequenceAnchorsResult2 of (lookup2.get(lookupEntry) ??
        []) as Dynamic)
        items3.push(alignNodeSequenceAnchorsResult2);
    },
  );
  return items3;
}
function alignNodeSequenceRange(
  alignNodeSequenceRange2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  argument2?: Dynamic,
  argument3?: Dynamic,
  argument4?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  let difference: number = context - options;
  let difference2: number = argument2 - argument;
  if (difference === 0 || difference2 === 0) {
    pairUnmatchedNodeRange(
      alignNodeSequenceRange2,
      options,
      context,
      dependencies,
      argument,
      argument2,
      argument3,
      argument4,
    );
    return;
  }
  let lookup: Dynamic = new (Map as Dynamic)();
  let int32Array: Dynamic = new (Int32Array as Dynamic)(difference);
  let int32Array2: Dynamic = new (Int32Array as Dynamic)(difference2);
  for (let index: number = 0; index < difference; index++) {
    let alignNodeSequenceRangeItem: Dynamic =
      alignNodeSequenceRange2[options + index];
    int32Array[index] =
      commonNodeBlockId(alignNodeSequenceRangeItem, argument3) === null
        ? internKey(
            lookup,
            nodeContentKey(alignNodeSequenceRangeItem, argument3),
          )
        : -1 - 2 * index;
  }
  for (let index: number = 0; index < difference2; index++) {
    let dependencyItem: Dynamic = dependencies[argument + index];
    int32Array2[index] =
      commonNodeBlockId(dependencyItem, argument3) === null
        ? internKey(lookup, nodeContentKey(dependencyItem, argument3))
        : -2 - 2 * index;
  }
  let budgetedSequenceMatches2: Dynamic = budgetedSequenceMatches(
    int32Array,
    int32Array2,
    argument3,
  );
  let count: number = 0;
  let count2: number = 0;
  for (
    let count3: number = 0;
    count3 < budgetedSequenceMatches2.length;
    count3 += 2
  ) {
    let budgetedSequenceMatcheItem: Dynamic = budgetedSequenceMatches2[count3];
    let budgetedSequenceMatcheItem2: Dynamic =
      budgetedSequenceMatches2[count3 + 1];
    pairUnmatchedNodeRange(
      alignNodeSequenceRange2,
      options + count,
      options + budgetedSequenceMatcheItem,
      dependencies,
      argument + count2,
      argument + budgetedSequenceMatcheItem2,
      argument3,
      argument4,
    );
    argument4.push({
      t: `keep`,
      a: alignNodeSequenceRange2[options + budgetedSequenceMatcheItem],
      b: dependencies[argument + budgetedSequenceMatcheItem2],
    });
    count = budgetedSequenceMatcheItem + 1;
    count2 = budgetedSequenceMatcheItem2 + 1;
  }
  pairUnmatchedNodeRange(
    alignNodeSequenceRange2,
    options + count,
    context,
    dependencies,
    argument + count2,
    argument2,
    argument3,
    argument4,
  );
}
function pairUnmatchedNodeRange(
  pairUnmatchedNodeRange2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  argument2?: Dynamic,
  argument3?: Dynamic,
  argument4?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  let items: Dynamic = [];
  let items2: Dynamic = [];
  for (let options3: Dynamic = options; options3 < context; options3++)
    if (
      commonNodeBlockId(pairUnmatchedNodeRange2[options3], argument3) === null
    ) {
      items.push(options3);
    }
  for (let argument6: Dynamic = argument; argument6 < argument2; argument6++)
    if (commonNodeBlockId(dependencies[argument6], argument3) === null) {
      items2.push(argument6);
    }
  let options2: Dynamic = options;
  let argument5: Dynamic = argument;
  let pairUnmatchedNodeRangeHandler = (
    pairUnmatchedNodeRange3?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    for (; options2 < pairUnmatchedNodeRange3; options2++)
      argument4.push({
        t: `del`,
        a: pairUnmatchedNodeRange2[options2],
      });
  };
  let pairUnmatchedNodeRangeHandler2 = (
    pairUnmatchedNodeRange3?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    for (; argument5 < pairUnmatchedNodeRange3; argument5++)
      argument4.push({
        t: `ins`,
        b: dependencies[argument5],
      });
  };
  let pairUnmatchedNodeRangeHandler3 = (
    pairUnmatchedNodeRange3?: Dynamic,
    options3?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    pairUnmatchedNodeRangeHandler(pairUnmatchedNodeRange3);
    pairUnmatchedNodeRangeHandler2(options3);
    argument4.push({
      t: `pair`,
      a: pairUnmatchedNodeRange2[pairUnmatchedNodeRange3],
      b: dependencies[options3],
    });
    options2 = pairUnmatchedNodeRange3 + 1;
    argument5 = options3 + 1;
  };
  let itemsCount: Dynamic = items.length;
  let itemsCount2: Dynamic = items2.length;
  if (
    itemsCount === 1 &&
    itemsCount2 === 1 &&
    canPairOrConvertNodes(
      pairUnmatchedNodeRange2[items[0]],
      dependencies[items2[0]],
      argument3,
    )
  )
    pairUnmatchedNodeRangeHandler3(items[0], items2[0]);
  else if (
    itemsCount > 0 &&
    itemsCount2 > 0 &&
    itemsCount * itemsCount2 > DIFF_BUDGETS.pairCells
  ) {
    let matchesItemsCount: boolean = itemsCount === itemsCount2;
    for (
      let index: number = 0;
      matchesItemsCount && index < itemsCount;
      index++
    )
      matchesItemsCount = canPairNodeKinds(
        pairUnmatchedNodeRange2[items[index]],
        dependencies[items2[index]],
      );
    if (matchesItemsCount)
      for (let index: number = 0; index < itemsCount; index++)
        pairUnmatchedNodeRangeHandler3(items[index], items2[index]);
    else argument3.degrade(`budget`);
  } else if (itemsCount > 0 && itemsCount2 > 0) {
    let replacementSimilarityContext: Dynamic = withinLinePairingBudget(
      pairUnmatchedNodeRange2,
      items,
      dependencies,
      items2,
      argument3,
    )
      ? createReplacementSimilarityContext()
      : null;
    let round: Dynamic = (
      pairUnmatchedNodeRange3?: Dynamic,
      options3?: Dynamic,
      ..._extraArguments: unknown[]
    ): number => {
      let pairUnmatchedNodeRangeItem: Dynamic =
        pairUnmatchedNodeRange2[items[pairUnmatchedNodeRange3]];
      let dependencyItem: Dynamic = dependencies[items2[options3]];
      let canPairNodeKinds2: Dynamic = canPairNodeKinds(
        pairUnmatchedNodeRangeItem,
        dependencyItem,
      );
      if (
        !canPairNodeKinds2 &&
        !canConvertTextBlockKinds(pairUnmatchedNodeRangeItem, dependencyItem)
      )
        return 0;
      let bagSimilarity2: number = bagSimilarity(
        nodeWordBag(pairUnmatchedNodeRangeItem, argument3),
        nodeWordBag(dependencyItem, argument3),
      );
      return bagSimilarity2 <
        (canPairNodeKinds2
          ? MIN_NODE_PAIR_SIMILARITY
          : MIN_CODE_CONVERSION_SIMILARITY) ||
        (canPairNodeKinds2 &&
          replacementSimilarityContext &&
          isParagraphLikeNode(pairUnmatchedNodeRangeItem) &&
          isParagraphLikeNode(dependencyItem) &&
          !shouldReplaceNodePair(
            pairUnmatchedNodeRangeItem,
            dependencyItem,
            replacementSimilarityContext,
            argument3,
          ))
        ? 0
        : 1 + Math.round(bagSimilarity2 * 100);
    };
    for (let operation of maximumWeightedPairing(
      itemsCount,
      itemsCount2,
      round,
    ) as Dynamic)
      if (operation.op === `pair`) {
        pairUnmatchedNodeRangeHandler3(items[operation.i], items2[operation.j]);
      } else {
        if (operation.op === `del`) {
          pairUnmatchedNodeRangeHandler(items[operation.i] + 1);
        } else {
          pairUnmatchedNodeRangeHandler2(items2[operation.j] + 1);
        }
      }
  }
  pairUnmatchedNodeRangeHandler(context);
  pairUnmatchedNodeRangeHandler2(argument2);
}
function withinLinePairingBudget(
  withinLinePairingBudget2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let index: number = 0;
  let index2: number = 0;
  let count: number = 0;
  let count2: number = 0;
  for (let withinLinePairingBudgetResult of options as Dynamic)
    if (
      isParagraphLikeNode(
        withinLinePairingBudget2[withinLinePairingBudgetResult],
      )
    ) {
      index++;
      count += nodeTokenWeight(
        withinLinePairingBudget2[withinLinePairingBudgetResult],
        argument,
      );
    }
  for (let withinLinePairingBudgetResult of dependencies as Dynamic)
    if (isParagraphLikeNode(context[withinLinePairingBudgetResult])) {
      index2++;
      count2 += nodeTokenWeight(
        context[withinLinePairingBudgetResult],
        argument,
      );
    }
  return count * index2 + count2 * index <= DIFF_BUDGETS.linePairChars;
}
function budgetedSequenceMatches(
  budgetedSequenceMatches2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let record: Dynamic = {
    left: Math.min(DIFF_BUDGETS.sequenceSteps, context.totalLeft),
  };
  let left: Dynamic = record.left;
  try {
    return sequenceMatches(budgetedSequenceMatches2, options, record);
  } catch (budgetedSequenceMatchesResult: Dynamic) {
    if (
      !(
        budgetedSequenceMatchesResult instanceof
        (DiffStepBudgetExceeded as Dynamic)
      )
    )
      throw budgetedSequenceMatchesResult;
    context.degrade(`budget`);
    return prefixSuffixMatches(budgetedSequenceMatches2, options);
  } finally {
    context.totalLeft -= left - Math.max(record.left, 0);
  }
}
function prefixSuffixMatches(
  items?: Dynamic,
  items2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items3: Dynamic = [];
  let index: number = 0;
  for (
    ;
    index < items.length &&
    index < items2.length &&
    items[index] === items2[index];

  ) {
    items3.push(index, index);
    index++;
  }
  let index2: number = 0;
  for (
    ;
    index2 < items.length - index &&
    index2 < items2.length - index &&
    items[items.length - 1 - index2] === items2[items2.length - 1 - index2];

  )
    index2++;
  for (let index3: Dynamic = index2; index3 > 0; index3--)
    items3.push(items.length - index3, items2.length - index3);
  return items3;
}
function diffNodeSequence(
  diffNodeSequence2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies: Dynamic = {},
  argument?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let alignNodeSequences2: Dynamic = alignNodeSequences(
    diffNodeSequence2,
    options,
    context,
    argument,
  );
  let pairContainerConversions2: Dynamic = pairContainerConversions(
    alignNodeSequences2,
    context,
  );
  let pairSequenceConversions2: Dynamic = pairSequenceConversions(
    alignNodeSequences2,
    pairContainerConversions2,
    context,
  );
  let items: Dynamic = [];
  for (let index: number = 0; index < alignNodeSequences2.length; index++) {
    let pairContainerConversionEntry: Dynamic =
      pairContainerConversions2.get(index);
    if (pairContainerConversionEntry !== undefined) {
      items.push(pairContainerConversionEntry);
      continue;
    }
    let pairSequenceConversionEntry: Dynamic =
      pairSequenceConversions2.get(index);
    if (pairSequenceConversionEntry !== undefined) {
      for (let diffNodeSequenceResult of pairSequenceConversionEntry as Dynamic)
        items.push(diffNodeSequenceResult);
      continue;
    }
    let trySplitOrJoinNodes2: Dynamic =
      index + 1 < alignNodeSequences2.length &&
      !pairContainerConversions2.has(index + 1) &&
      !pairSequenceConversions2.has(index + 1)
        ? trySplitOrJoinNodes(
            alignNodeSequences2[index],
            alignNodeSequences2[index + 1],
            context,
            dependencies,
          )
        : null;
    if (trySplitOrJoinNodes2 !== null) {
      for (let diffNodeSequenceResult of trySplitOrJoinNodes2 as Dynamic)
        items.push(diffNodeSequenceResult);
      index++;
      continue;
    }
    for (let diffNodeSequenceResult of renderNodeSequenceOperation(
      alignNodeSequences2[index],
      context,
      dependencies,
    ) as Dynamic)
      items.push(diffNodeSequenceResult);
  }
  return items;
}
function pairContainerConversions(
  items?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let lookup: Dynamic = new (Map as Dynamic)();
  let count: number = 0;
  for (let index: number = 0; index <= items.length; index++) {
    let itemItem: Dynamic = items[index];
    if (
      itemItem !== undefined &&
      (itemItem.t === `del` || itemItem.t === `ins`)
    )
      continue;
    let pairContainerConversionsResult: number = -1;
    let pairContainerConversionsResult2: number = -1;
    let index2: number = 0;
    let index3: number = 0;
    for (let count2: Dynamic = count; count2 < index; count2++) {
      let itemItem2: Dynamic = items[count2];
      if (itemItem2.t === `del` && COMPLEX_NODE_TYPES.has(itemItem2.a.type)) {
        index2++;
        pairContainerConversionsResult = count2;
      } else {
        if (itemItem2.t === `ins` && COMPLEX_NODE_TYPES.has(itemItem2.b.type)) {
          index3++;
          pairContainerConversionsResult2 = count2;
        }
      }
    }
    count = index + 1;
    if (index2 !== 1 || index3 !== 1) continue;
    let a2: Dynamic = items[pairContainerConversionsResult].a;
    let b2: Dynamic = items[pairContainerConversionsResult2].b;
    if (
      a2.type === b2.type ||
      isStableNodeIdentity(a2, options) ||
      isStableNodeIdentity(b2, options) ||
      containerHasStableContent(a2, b2, options) ||
      containerHasStableContent(b2, a2, options) ||
      hasNearbyCodeTwin(a2, b2, `curr`, options) ||
      hasNearbyCodeTwin(b2, a2, `prev`, options)
    )
      continue;
    let [replaceNodePair2, setReplaceNodePair]: Dynamic = replaceNodePair(
      a2,
      b2,
      options,
    );
    let lowercaseInitial2: string = lowercaseInitial(nodeKindLabel(b2));
    setReplaceNodePair.attrs = {
      ...setReplaceNodePair.attrs,
      [DIFF_ATTRIBUTE_NAMES.summary]: nodeReplacementSummary(a2, b2),
    };
    replaceNodePair2.attrs = {
      ...replaceNodePair2.attrs,
      [DIFF_ATTRIBUTE_NAMES.summary]: `Replaced by the ${lowercaseInitial2} ${pairContainerConversionsResult < pairContainerConversionsResult2 ? `below` : `above`}`,
    };
    lookup.set(pairContainerConversionsResult, replaceNodePair2);
    lookup.set(pairContainerConversionsResult2, setReplaceNodePair);
  }
  return lookup;
}
function containerParagraphs(
  containerParagraphs2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let nodeChildren2: Dynamic = (
    containerParagraphs3?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let nodeChildren3: Dynamic = nodeChildren(containerParagraphs3);
    return nodeChildren3.length === 1 && nodeChildren3[0].type === `paragraph`
      ? nodeChildren3[0]
      : null;
  };
  let items: Dynamic = [];
  if (containerParagraphs2.type === `blockquote`)
    for (let containerParagraphsResult of nodeChildren(
      containerParagraphs2,
    ) as Dynamic) {
      if (containerParagraphsResult.type !== `paragraph`) return null;
      items.push(containerParagraphsResult);
    }
  else if (containerParagraphs2.type === `list`)
    for (let containerParagraphsResult of nodeChildren(
      containerParagraphs2,
    ) as Dynamic) {
      let nodeChildren3: Dynamic =
        containerParagraphsResult.type === `listItem`
          ? nodeChildren2(containerParagraphsResult)
          : null;
      if (nodeChildren3 === null) return null;
      items.push(nodeChildren3);
    }
  else if (containerParagraphs2.type === `table`)
    for (let containerParagraphsResult of nodeChildren(
      containerParagraphs2,
    ) as Dynamic) {
      if (containerParagraphsResult.type !== `tableRow`) return null;
      for (let containerParagraphsResult2 of nodeChildren(
        containerParagraphsResult,
      ) as Dynamic) {
        let nodeChildren3: Dynamic =
          containerParagraphsResult2.type === `cell`
            ? nodeChildren2(containerParagraphsResult2)
            : null;
        if (nodeChildren3 === null) return null;
        items.push(nodeChildren3);
      }
    }
  else return null;
  return items.length ? items : null;
}
function paragraphPairIdentity(
  paragraphPairIdentity2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
) {
  if (
    paragraphPairIdentity2.type !== `paragraph` ||
    options.type !== `paragraph`
  )
    return null;
  let commonNodeBlockId2: Dynamic = commonNodeBlockId(
    paragraphPairIdentity2,
    context,
  );
  let commonNodeBlockId3: Dynamic = commonNodeBlockId(options, context);
  if (commonNodeBlockId2 !== null || commonNodeBlockId3 !== null)
    return commonNodeBlockId2 !== null &&
      commonNodeBlockId2 === commonNodeBlockId3
      ? `bid`
      : null;
  let nodeChildren2: Dynamic = nodeChildren(paragraphPairIdentity2);
  let nodeChildren3: Dynamic = nodeChildren(options);
  if (nodeChildren2.length === nodeChildren3.length) {
    if (
      dependencies &&
      spendWorkBudget(dependencies, nodeChildren2.length + nodeChildren3.length)
    )
      return null;
    if (
      paragraphContentKey(paragraphPairIdentity2, context) ===
      paragraphContentKey(options, context)
    )
      return `content`;
  }
  let nodeWordBagCount: Dynamic = nodeWordBag(
    paragraphPairIdentity2,
    context,
  ).length;
  let nodeWordBagCount2: Dynamic = nodeWordBag(options, context).length;
  return 2 * Math.min(nodeWordBagCount, nodeWordBagCount2) <
    MIN_CODE_CONVERSION_SIMILARITY * (nodeWordBagCount + nodeWordBagCount2) ||
    (dependencies &&
      spendWorkBudget(dependencies, nodeWordBagCount + nodeWordBagCount2))
    ? null
    : nodeWordCount(paragraphPairIdentity2, context) >= MIN_CODE_BLOCK_WORDS &&
        nodeWordCount(options, context) >= MIN_CODE_BLOCK_WORDS &&
        bagSimilarity(
          nodeWordBag(paragraphPairIdentity2, context),
          nodeWordBag(options, context),
        ) >= MIN_CODE_CONVERSION_SIMILARITY
      ? `near`
      : null;
}
function cloneNodeTree(
  cloneNodeTree2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let optionEntry: Dynamic = options.get(cloneNodeTree2);
  if (optionEntry !== undefined) return optionEntry;
  let nodeChildren2: Dynamic = nodeChildren(cloneNodeTree2);
  let content: Dynamic = nodeChildren2.map(
    (nodeChildren3?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      cloneNodeTree(nodeChildren3, options),
  );
  return content.every(
    (content2?: Dynamic, index?: Dynamic, ..._extraArguments: unknown[]) =>
      content2 === nodeChildren2[index],
  )
    ? cloneNodeTree2
    : {
        ...cloneNodeTree2,
        content: content,
      };
}
var indefiniteArticle = (
  indefiniteArticle2?: Dynamic,
  ..._extraArguments: unknown[]
) => (/^[aeiou]/i.test(indefiniteArticle2) ? `an` : `a`);
var capitalizeInitial = (
  capitalizeInitial2?: Dynamic,
  ..._extraArguments: unknown[]
) =>
  `${capitalizeInitial2.charAt(0).toUpperCase()}${capitalizeInitial2.slice(1)}`;
var spendWorkBudget: Dynamic = (
  spendWorkBudget2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): boolean => (
  (spendWorkBudget2.left -= options),
  spendWorkBudget2.ceiling === undefined
    ? spendWorkBudget2.left < 0
    : ((spendWorkBudget2.ceiling.left -= options),
      spendWorkBudget2.left < 0 || spendWorkBudget2.ceiling.left < 0)
);
var TABLE_CONVERSION_START_COST: number = 256;
function tableColumnCandidates(
  tableColumnCandidates2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let nodeChildren2: Dynamic = nodeChildren(tableColumnCandidates2);
  if (
    !nodeChildren2.length ||
    nodeChildren2.some(
      (nodeChildren3?: Dynamic, ..._extraArguments: unknown[]) =>
        nodeChildren3.type !== `tableRow`,
    )
  )
    return [];
  let nodeChildrenCount: Dynamic = nodeChildren(nodeChildren2[0]).length;
  if (nodeChildrenCount < 2 || nodeChildrenCount > MAX_TABLE_COLUMNS) return [];
  for (let tableColumnCandidatesResult of nodeChildren2 as Dynamic) {
    let nodeChildren3: Dynamic = nodeChildren(tableColumnCandidatesResult);
    if (nodeChildren3.length !== nodeChildrenCount) return [];
    for (let tableColumnCandidatesResult2 of nodeChildren3 as Dynamic)
      if (
        tableColumnCandidatesResult2.type !== `cell` ||
        effectiveNodeAttribute(tableColumnCandidatesResult2, `colspan`) !== 1 ||
        effectiveNodeAttribute(tableColumnCandidatesResult2, `rowspan`) !== 1
      )
        return [];
  }
  let nodeChildrenSlice: Dynamic =
    nodeChildren2.length > 1 &&
    nodeChildren(nodeChildren2[0]).every(
      (nodeChildren3?: Dynamic, ..._extraArguments: unknown[]) =>
        effectiveNodeAttribute(nodeChildren3, `header`) === true,
    )
      ? nodeChildren2.slice(1)
      : nodeChildren2;
  let items: Dynamic = [];
  for (let index: number = 0; index < nodeChildrenCount; index++) {
    let slots: Dynamic = [];
    let slotCells: Dynamic = [];
    for (let tableColumnCandidatesResult of nodeChildrenSlice as Dynamic) {
      let nodeChildrenItem: Dynamic = nodeChildren(tableColumnCandidatesResult)[
        index
      ];
      let nodeChildren3: Dynamic = nodeChildren(nodeChildrenItem);
      if (nodeChildren3.length !== 1 || nodeChildren3[0].type !== `paragraph`)
        break;
      slots.push(nodeChildren3[0]);
      slotCells.push(nodeChildrenItem);
    }
    if (slots.length === nodeChildrenSlice.length) {
      items.push({
        slots: slots,
        slotCells: slotCells,
      });
    }
  }
  return items;
}
function tableCellsOutsideColumn(
  tableCellsOutsideColumn2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let uniqueItems: Dynamic = new (Set as Dynamic)(options.slotCells);
  let items: Dynamic = [];
  for (let tableCellsOutsideColumnResult of nodeChildren(
    tableCellsOutsideColumn2,
  ) as Dynamic)
    for (let tableCellsOutsideColumnResult2 of nodeChildren(
      tableCellsOutsideColumnResult,
    ) as Dynamic)
      if (!uniqueItems.has(tableCellsOutsideColumnResult2)) {
        items.push(tableCellsOutsideColumnResult2);
      }
  return items;
}
var paragraphContentKey: Dynamic = (
  paragraphContentKey2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let contentKeyEntry: Dynamic = options.contentKeys.get(paragraphContentKey2);
  if (contentKeyEntry !== undefined) return contentKeyEntry;
  let label: string = `p:${nodeChildren(paragraphContentKey2)
    .map(
      (nodeChildren2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        nodeContentKey(nodeChildren2, options),
    )
    .join(`,`)}`;
  options.contentKeys.set(paragraphContentKey2, label);
  return label;
};
function tableConversionEvidence(
  tableConversionEvidence2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let record: Dynamic = {
    unclean: 0,
    uncleanCell: new (WeakSet as Dynamic)(),
    keyCount: new (Map as Dynamic)(),
    cellKeys: new (WeakMap as Dynamic)(),
  };
  for (let tableConversionEvidenceResult of nodeChildren(
    tableConversionEvidence2,
  ) as Dynamic)
    for (let tableConversionEvidenceResult2 of nodeChildren(
      tableConversionEvidenceResult,
    ) as Dynamic) {
      let enabled: boolean = true;
      let items: Dynamic = [];
      let nodeChildren2 = (
        tableConversionEvidence3?: Dynamic,
        ..._extraArguments: unknown[]
      ): undefined => {
        if (!(!enabled || tableConversionEvidence3.type === `text`))
          if (
            (spendWorkBudget(context, 1),
            commonNodeBlockId(tableConversionEvidence3, options) !== null)
          )
            enabled = false;
          else if (
            TEXT_BLOCK_NODE_TYPES.has(tableConversionEvidence3.type) &&
            isStableNodeIdentity(tableConversionEvidence3, options)
          )
            enabled = false;
          else {
            if (tableConversionEvidence3.type === `paragraph`) {
              items.push(
                paragraphContentKey(tableConversionEvidence3, options),
              );
            }
            for (let tableConversionEvidenceResult3 of nodeChildren(
              tableConversionEvidence3,
            ) as Dynamic)
              nodeChildren2(tableConversionEvidenceResult3);
          }
      };
      for (let tableConversionEvidenceResult3 of nodeChildren(
        tableConversionEvidenceResult2,
      ) as Dynamic)
        nodeChildren2(tableConversionEvidenceResult3);
      if (!enabled) {
        record.unclean++;
        record.uncleanCell.add(tableConversionEvidenceResult2);
      }
      record.cellKeys.set(tableConversionEvidenceResult2, items);
      for (let tableConversionEvidenceResult3 of items as Dynamic)
        record.keyCount.set(
          tableConversionEvidenceResult3,
          (record.keyCount.get(tableConversionEvidenceResult3) ?? 0) + 1,
        );
    }
  return record;
}
function canConvertTableColumn(
  convertTableColumn?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let index: number = 0;
  let lookup: Dynamic = new (Map as Dynamic)();
  for (let canConvertTableColumnResult of convertTableColumn.slotCells as Dynamic) {
    if (context.uncleanCell.has(canConvertTableColumnResult)) {
      index++;
    }
    for (let canConvertTableColumnResult2 of (context.cellKeys.get(
      canConvertTableColumnResult,
    ) ?? []) as Dynamic)
      lookup.set(
        canConvertTableColumnResult2,
        (lookup.get(canConvertTableColumnResult2) ?? 0) + 1,
      );
  }
  if (context.unclean - index > 0) return false;
  for (let canConvertTableColumnResult of options as Dynamic) {
    if (nodeWordBag(canConvertTableColumnResult, dependencies).length === 0)
      continue;
    let paragraphContentKey2: Dynamic = paragraphContentKey(
      canConvertTableColumnResult,
      dependencies,
    );
    if (
      (context.keyCount.get(paragraphContentKey2) ?? 0) -
        (lookup.get(paragraphContentKey2) ?? 0) >
      0
    )
      return false;
  }
  return true;
}
function pairSequenceConversions(
  items?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let lookup: Dynamic = new (Map as Dynamic)();
  let count: number = 0;
  for (let index: number = 0; index <= items.length; index++) {
    let itemItem: Dynamic = items[index];
    if (
      !(
        itemItem !== undefined &&
        (itemItem.t === `del` || itemItem.t === `ins`)
      )
    ) {
      if (index > count) {
        convertNodeSequenceRegion(
          items,
          count,
          index,
          options,
          context,
          lookup,
        );
      }
      count = index + 1;
    }
  }
  return lookup;
}
function convertNodeSequenceRegion(
  sequence?: Dynamic,
  start?: Dynamic,
  end?: Dynamic,
  excluded?: Dynamic,
  work?: Dynamic,
  output?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  let convertIndex: number = -1;
  for (let start2: Dynamic = start; start2 < end; start2++) {
    if (excluded.has(start2)) return;
    let sequenceItem: Dynamic = sequence[start2];
    let a2: Dynamic =
      sequenceItem.t === `del`
        ? sequenceItem.a
        : sequenceItem.t === `ins`
          ? sequenceItem.b
          : null;
    if (!(a2 === null || !COMPLEX_NODE_TYPES.has(a2.type))) {
      if (convertIndex >= 0) return;
      convertIndex = start2;
    }
  }
  if (convertIndex < 0) return;
  let operation: Dynamic = sequence[convertIndex];
  let convertNode: Dynamic =
    operation.t === `del`
      ? operation.a
      : operation.t === `ins`
        ? operation.b
        : null;
  if (
    convertNode === null ||
    !CONVERTIBLE_CONTAINER_TYPES.has(convertNode.type) ||
    isStableNodeIdentity(convertNode, work)
  )
    return;
  let kind: string = operation.t === `del` ? `del` : `ins`;
  let oppositeKind: string = kind === `del` ? `ins` : `del`;
  if (work.convert.left < 0) return;
  let layouts: Dynamic = [];
  let slots: Dynamic = containerParagraphs(convertNode);
  if (slots !== null) {
    layouts.push([
      {
        slots: slots,
        slotCells: [],
      },
    ]);
  }
  if (kind === `ins` && convertNode.type === `table`) {
    layouts.push(tableColumnCandidates(convertNode));
  }
  if (
    !layouts.some(
      (items?: Dynamic, ..._extraArguments: unknown[]): Dynamic => items.length,
    )
  )
    return;
  let paragraphRuns: Dynamic = [];
  let currentRun: Dynamic = {
    lines: [],
    idx: [],
  };
  let flushParagraphRun = (..._extraArguments: unknown[]): undefined => {
    if (currentRun.lines.length) {
      paragraphRuns.push(currentRun);
    }
    currentRun = {
      lines: [],
      idx: [],
    };
  };
  for (let start2: Dynamic = start; start2 < end; start2++) {
    let sequenceItem: Dynamic = sequence[start2];
    let a2: Dynamic =
      sequenceItem.t === `del`
        ? sequenceItem.a
        : sequenceItem.t === `ins`
          ? sequenceItem.b
          : null;
    if (!(a2 === null || sequenceItem.t !== oppositeKind)) {
      if (a2.type === `paragraph`) {
        currentRun.lines.push(a2);
        currentRun.idx.push(start2);
      } else {
        flushParagraphRun();
      }
    }
  }
  flushParagraphRun();
  let maxRunLength: Dynamic = paragraphRuns.reduce(
    (
      accumulator?: Dynamic,
      paragraphRun?: Dynamic,
      ..._extraArguments: unknown[]
    ): number => Math.max(accumulator, paragraphRun.lines.length),
    0,
  );
  let withinPairBudget = (
    convertNodeSequenceRegion2?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ) =>
    (convertNodeSequenceRegion2 - options + 1) * options <=
    DIFF_BUDGETS.pairCells;
  let candidateFits: Dynamic = new (Map as Dynamic)();
  let bestFit: Dynamic = null;
  for (let convertNodeSequenceRegionResult of layouts as Dynamic) {
    if (bestFit !== null) break;
    let record: Dynamic = {
      left: DIFF_BUDGETS.convertOps,
      ceiling: work.convert,
    };
    let convertNodeSequenceRegionResult2: Dynamic = null;
    for (let layout of convertNodeSequenceRegionResult as Dynamic) {
      let { slots: layout2 }: Dynamic = layout;
      let layoutCount: Dynamic = layout2.length;
      if (layoutCount > maxRunLength) continue;
      let count: number = 0;
      for (let convertNodeSequenceRegionResult3 of paragraphRuns as Dynamic) {
        let linesCount: Dynamic = convertNodeSequenceRegionResult3.lines.length;
        if (linesCount === layoutCount) {
          count += 1;
        } else {
          if (linesCount > layoutCount) {
            count += withinPairBudget(linesCount, layoutCount)
              ? linesCount - layoutCount + 1
              : 2;
          }
        }
      }
      if (
        spendWorkBudget(
          record,
          TABLE_CONVERSION_START_COST * (1 + paragraphRuns.length) + count,
        )
      )
        return;
      let candidateFitEntry: Dynamic = candidateFits.get(layoutCount);
      if (candidateFitEntry === undefined) {
        let items2: Dynamic = [];
        for (let [
          run,
          convertNodeSequenceRegionResult3,
        ] of paragraphRuns.entries() as Dynamic) {
          let linesCount: Dynamic =
            convertNodeSequenceRegionResult3.lines.length;
          if (linesCount === layoutCount)
            items2.push({
              run: run,
              at: 0,
              cut: false,
            });
          else if (linesCount > layoutCount)
            for (
              let count2: number = 0;
              count2 + layoutCount <= linesCount;
              count2 += withinPairBudget(linesCount, layoutCount)
                ? 1
                : linesCount - layoutCount
            )
              items2.push({
                run: run,
                at: count2,
                cut: true,
              });
        }
        candidateFitEntry = items2;
        candidateFits.set(layoutCount, candidateFitEntry);
      }
      let uniqueItems: Dynamic = new (Set as Dynamic)();
      let uniqueItems2: Dynamic = new (Set as Dynamic)();
      let enabled: boolean = false;
      for (let convertNodeSequenceRegionResult3 of layout2 as Dynamic) {
        uniqueItems.add(
          paragraphContentKey(convertNodeSequenceRegionResult3, work),
        );
        let commonNodeBlockId2: Dynamic = commonNodeBlockId(
          convertNodeSequenceRegionResult3,
          work,
        );
        if (commonNodeBlockId2 !== null) {
          uniqueItems2.add(commonNodeBlockId2);
        }
        if (nodeWordBag(convertNodeSequenceRegionResult3, work).length === 0) {
          enabled = true;
        }
      }
      let items: Dynamic = [];
      for (let convertNodeSequenceRegionResult3 of paragraphRuns as Dynamic) {
        let linesCount: Dynamic = convertNodeSequenceRegionResult3.lines.length;
        if (
          linesCount <= layoutCount ||
          !withinPairBudget(linesCount, layoutCount)
        ) {
          items.push(null);
          continue;
        }
        if (spendWorkBudget(record, layoutCount + linesCount)) return;
        let uint32Array: Dynamic = new (Uint32Array as Dynamic)(linesCount + 1);
        convertNodeSequenceRegionResult3.lines.forEach(
          (
            line?: Dynamic,
            index?: Dynamic,
            ..._extraArguments: unknown[]
          ): undefined => {
            let commonNodeBlockId2: Dynamic = commonNodeBlockId(line, work);
            let hasParagraphContentKey: Dynamic =
              uniqueItems.has(paragraphContentKey(line, work)) ||
              (commonNodeBlockId2 !== null &&
                uniqueItems2.has(commonNodeBlockId2)) ||
              (enabled && nodeWordBag(line, work).length === 0);
            uint32Array[index + 1] =
              uint32Array[index] + +!!hasParagraphContentKey;
          },
        );
        items.push(uint32Array);
      }
      for (let activity of candidateFitEntry as Dynamic) {
        let itemItem: Dynamic = items[activity.run];
        if (
          activity.cut &&
          itemItem &&
          itemItem[activity.at + layoutCount] - itemItem[activity.at] <
            layoutCount
        )
          continue;
        let { lines: paragraphRunItem, idx: paragraphRunItem2 }: Dynamic =
          paragraphRuns[activity.run];
        let fit: Dynamic = pairConvertedParagraphs(
          paragraphRunItem,
          activity.at,
          layout2,
          kind,
          work,
          activity.cut,
          record,
        );
        if (spendWorkBudget(record, 0)) return;
        if (fit === null) continue;
        let lines: Dynamic = activity.cut
          ? paragraphRunItem.slice(activity.at, activity.at + layoutCount)
          : paragraphRunItem;
        if (layout.slotCells.length > 0) {
          convertNodeSequenceRegionResult2 ??= tableConversionEvidence(
            convertNode,
            work,
            record,
          );
          if (spendWorkBudget(record, 2 * layoutCount)) return;
          if (
            !canConvertTableColumn(
              layout,
              lines,
              convertNodeSequenceRegionResult2,
              work,
            )
          )
            continue;
        }
        if (bestFit !== null) return;
        bestFit = {
          lines: lines,
          idx: activity.cut
            ? paragraphRunItem2.slice(activity.at, activity.at + layoutCount)
            : paragraphRunItem2,
          fit: fit,
          layout: layout,
        };
      }
    }
  }
  if (bestFit === null) return;
  let {
    lines: bestFit2,
    idx: bestFit3,
    fit: bestFit4,
    layout: bestFit5,
  }: Dynamic = bestFit;
  let { slots: bestFit6 }: Dynamic = bestFit5;
  let tableCellsOutsideColumn2: Dynamic =
    bestFit5.slotCells.length > 0
      ? tableCellsOutsideColumn(convertNode, bestFit5)
      : [];
  let slotCount: Dynamic = bestFit6.length;
  let blockKind: string = bestFit4.headings ? `heading` : `paragraph`;
  let summary: Dynamic =
    slotCount === 1 ? blockKind : `${slotCount} ${blockKind}s`;
  let diffOptions: Dynamic = {
    impliedHeading: true,
  };
  let convertedNode: Dynamic;
  if (kind === `ins`) {
    let lowercaseInitial2: string = lowercaseInitial(
      nodeKindLabel(convertNode),
    );
    let label: string = `${slotCount === 1 ? capitalizeInitial(summary) : summary} turned into ${indefiniteArticle(lowercaseInitial2)} ${lowercaseInitial2}`;
    let changeRecord: Dynamic = createChangeRecord(
      `chg`,
      convertNode.type,
      label,
    );
    let lookup: Dynamic = new (Map as Dynamic)();
    for (let index: number = 0; index < slotCount; index++)
      lookup.set(
        bestFit6[index],
        diffNode(bestFit2[index], bestFit6[index], work, diffOptions),
      );
    for (let convertNodeSequenceRegionResult of tableCellsOutsideColumn2 as Dynamic) {
      let markNodeInsertionOrDeletion2: Dynamic = markNodeInsertionOrDeletion(
        convertNodeSequenceRegionResult,
        `ins`,
        changeRecord,
        work,
      );
      work.settled.add(markNodeInsertionOrDeletion2);
      lookup.set(convertNodeSequenceRegionResult, markNodeInsertionOrDeletion2);
    }
    let cloneNodeTree2: Dynamic = cloneNodeTree(convertNode, lookup);
    work.origin.set(cloneNodeTree2, convertNode);
    annotateNodeChange(cloneNodeTree2, `chg`, changeRecord, work, {
      [DIFF_ATTRIBUTE_NAMES.summary]: label,
      [DIFF_ATTRIBUTE_NAMES.before]: {
        type: `paragraph`,
      },
    });
    convertedNode = [cloneNodeTree2];
  } else {
    let label: string = `${nodeKindLabel(convertNode)} turned into ${slotCount === 1 ? `${indefiniteArticle(summary)} ${summary}` : summary}`;
    let changeRecord: Dynamic = createChangeRecord(`chg`, `paragraph`, label);
    let record: Dynamic = {
      type: convertNode.type,
    };
    if (convertNode.type === `list`) {
      defineEnumerableProperty(
        record,
        `kind`,
        effectiveNodeAttribute(convertNode, `kind`),
      );
    }
    convertedNode = [];
    for (let index: number = 0; index < slotCount; index++) {
      let diffNode2: Dynamic = diffNode(
        bestFit6[index],
        bestFit2[index],
        work,
        diffOptions,
      );
      annotateNodeChange(diffNode2, `chg`, changeRecord, work, {
        [DIFF_ATTRIBUTE_NAMES.summary]: label,
        ...(index === 0
          ? {
              [DIFF_ATTRIBUTE_NAMES.before]: record,
            }
          : {}),
      });
      convertedNode.push(diffNode2);
    }
  }
  let firstIndex: Dynamic =
    kind === `ins` ? convertIndex : bestFit3[slotCount - 1];
  let lastIndex: Dynamic =
    kind === `ins` ? bestFit3[slotCount - 1] : convertIndex;
  let replacementOps: Dynamic = [];
  for (let total: Dynamic = lastIndex + 1; total < firstIndex; total++) {
    let sequenceItem: Dynamic = sequence[total];
    if (sequenceItem.t === `del`) {
      (replacementOps.push as Dynamic)(
        ...renderNodeSequenceOperation(sequenceItem, work),
      );
      output.set(total, []);
    }
  }
  if (kind === `ins`) {
    for (let convertNodeSequenceRegionResult of bestFit3 as Dynamic)
      output.set(convertNodeSequenceRegionResult, []);
    output.set(convertIndex, [...convertedNode, ...replacementOps]);
  } else {
    output.set(convertIndex, []);
    bestFit3.forEach(
      (
        bestFit7?: Dynamic,
        index?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic =>
        output.set(
          bestFit7,
          index === slotCount - 1
            ? [convertedNode[index], ...replacementOps]
            : [convertedNode[index]],
        ),
    );
  }
}
function pairConvertedParagraphs(
  pairConvertedParagraphs2?: Dynamic,
  options?: Dynamic,
  items?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  argument2?: Dynamic,
  argument3?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let itemsCount: Dynamic = items.length;
  if (spendWorkBudget(argument3, TABLE_CONVERSION_START_COST + itemsCount))
    return null;
  let index: number = 0;
  for (let index4: number = 0; index4 < itemsCount; index4++)
    if (
      effectiveNodeAttribute(
        pairConvertedParagraphs2[options + index4],
        `heading`,
      ) !== null
    ) {
      index++;
    }
  if (index !== 0 && index !== itemsCount) return null;
  let index2: number = 0;
  let index3: number = 0;
  let items2: Dynamic = [];
  for (let index4: number = 0; index4 < itemsCount; index4++) {
    if (2 * (index2 + (itemsCount - index4)) <= itemsCount - index3)
      return null;
    let itemItem: Dynamic = items[index4];
    let pairConvertedParagraphItem: Dynamic =
      pairConvertedParagraphs2[options + index4];
    if (
      spendWorkBudget(
        argument3,
        TABLE_CONVERSION_START_COST +
          nodeAttributeWeight(itemItem, argument) +
          nodeAttributeWeight(pairConvertedParagraphItem, argument),
      )
    )
      return null;
    let effectiveNodeAttribute2: Dynamic = effectiveNodeAttribute(
      itemItem,
      `heading`,
    );
    if (
      (effectiveNodeAttribute2 !== null &&
        !equalValues(
          effectiveNodeAttribute2,
          effectiveNodeAttribute(pairConvertedParagraphItem, `heading`),
        )) ||
      changedNodeAttributes(itemItem, pairConvertedParagraphItem).some(
        (changedNodeAttribute?: Dynamic, ..._extraArguments: unknown[]) =>
          changedNodeAttribute !== `heading`,
      )
    )
      return null;
    let pairConvertedParagraphItem2: Dynamic =
      dependencies === `ins` ? pairConvertedParagraphItem : itemItem;
    let itemItem2: Dynamic =
      dependencies === `ins` ? itemItem : pairConvertedParagraphItem;
    if (
      nodeWordBag(pairConvertedParagraphItem2, argument).length === 0 &&
      nodeWordBag(itemItem2, argument).length === 0
    ) {
      index3++;
      continue;
    }
    let paragraphPairIdentity2: Dynamic = paragraphPairIdentity(
      pairConvertedParagraphItem2,
      itemItem2,
      argument,
      argument3,
    );
    if (
      paragraphPairIdentity2 === `bid` ||
      paragraphPairIdentity2 === `content`
    ) {
      index2++;
      continue;
    }
    if (
      isStableNodeIdentity(pairConvertedParagraphItem2, argument) ||
      isStableNodeIdentity(itemItem2, argument) ||
      argument2
    )
      return null;
    if (paragraphPairIdentity2 === `near`) {
      index2++;
      continue;
    }
    items2.push([pairConvertedParagraphItem2, itemItem2]);
  }
  if (2 * index2 <= itemsCount - index3) return null;
  for (let [
    pairConvertedParagraphsResult,
    pairConvertedParagraphsResult2,
  ] of items2 as Dynamic) {
    if (
      nodeChildTokenWeight(pairConvertedParagraphsResult, argument) +
        nodeChildTokenWeight(pairConvertedParagraphsResult2, argument) >
      MAX_PAIR_TOKEN_CHARACTERS
    )
      return null;
    let nodeTokenBag2: Dynamic = nodeTokenBag(
      pairConvertedParagraphsResult,
      argument,
      argument3,
    );
    let nodeTokenBag3: Dynamic = nodeTokenBag(
      pairConvertedParagraphsResult2,
      argument,
      argument3,
    );
    if (
      spendWorkBudget(argument3, nodeTokenBag2.length + nodeTokenBag3.length) ||
      isSubstantialTokenReplacement(nodeTokenBag2, nodeTokenBag3)
    )
      return null;
  }
  return {
    headings: index === itemsCount,
  };
}
function nodeTokenBag(
  node?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let tokBagEntry: Dynamic = options.tokBags.get(node);
  if (tokBagEntry !== undefined) return tokBagEntry;
  spendWorkBudget(context, nodeChildTokenWeight(node, options));
  let mappedFilteredInlineNodeTokens: Dynamic = inlineNodeTokens(
    nodeChildren(node),
    options,
  )
    .filter(isContentToken)
    .map(
      (event?: Dynamic, ..._extraArguments: unknown[]): Dynamic => event.key,
    );
  options.tokBags.set(node, mappedFilteredInlineNodeTokens);
  return mappedFilteredInlineNodeTokens;
}
function isSubstantialTokenReplacement(
  items?: Dynamic,
  items2?: Dynamic,
  ..._extraArguments: unknown[]
): boolean {
  let lookup: Dynamic = new (Map as Dynamic)();
  for (let isSubstantialTokenReplacementResult of items as Dynamic)
    lookup.set(
      isSubstantialTokenReplacementResult,
      (lookup.get(isSubstantialTokenReplacementResult) ?? 0) + 1,
    );
  let index: number = 0;
  for (let isSubstantialTokenReplacementResult of items2 as Dynamic) {
    let lookupEntry: Dynamic =
      lookup.get(isSubstantialTokenReplacementResult) ?? 0;
    if (lookupEntry > 0) {
      lookup.set(isSubstantialTokenReplacementResult, lookupEntry - 1);
      index++;
    }
  }
  let difference: number = items.length - index;
  let difference2: number = items2.length - index;
  let total: Dynamic = items.length + items2.length;
  return (
    difference > 0 &&
    difference2 > 0 &&
    total > 0 &&
    (difference + difference2) / total > REPLACEMENT_CHANGE_RATIO
  );
}
function isParagraphLikeNode(
  paragraphLikeNode?: Dynamic,
  ..._extraArguments: unknown[]
): boolean {
  if (paragraphLikeNode.type === `paragraph`) return true;
  if (paragraphLikeNode.type !== `listItem`) return false;
  let nodeChildren2: Dynamic = nodeChildren(paragraphLikeNode);
  return nodeChildren2.length === 1 && nodeChildren2[0].type === `paragraph`;
}
var WORD_OR_EMOJI_PATTERN: Dynamic =
  /[\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
var createReplacementSimilarityContext: Dynamic = (
  ..._extraArguments: unknown[]
): Dynamic => ({
  words: new (Map as Dynamic)(),
  atoms: new (Map as Dynamic)(),
  heavyKeys: new (Map as Dynamic)(),
  bags: new (Map as Dynamic)(),
});
var LOWERCASE_CHANGE_PATTERN: Dynamic = /\p{Changes_When_Lowercased}/u;
function nodeReplacementWordBag(
  nodeReplacementWordBag2?: Dynamic,
  request?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let bagEntry: Dynamic = request.bags.get(nodeReplacementWordBag2);
  if (bagEntry !== undefined) return bagEntry;
  let items: Dynamic = [];
  let items2: Dynamic = [];
  let words: number = 0;
  let internKey2 = (
    nodeReplacementWordBag3?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (!TEXT_BLOCK_NODE_TYPES.has(nodeReplacementWordBag3.type)) {
      for (let nodeReplacementWordBagResult of nodeChildren(
        nodeReplacementWordBag3,
      ) as Dynamic)
        internKey2(nodeReplacementWordBagResult);
      return;
    }
    let label: string = ``;
    let toLowerCase = (..._extraArguments: unknown[]): undefined => {
      for (let nodeReplacementWordBagResult of tokenizeWords(label) as Dynamic)
        if (!WHITESPACE_ONLY_PATTERN.test(nodeReplacementWordBagResult)) {
          items2.push(
            internKey(request.heavyKeys, `t${nodeReplacementWordBagResult}`),
          );
          if (WORD_OR_EMOJI_PATTERN.test(nodeReplacementWordBagResult)) {
            items.push(
              internKey(
                request.words,
                LOWERCASE_CHANGE_PATTERN.test(nodeReplacementWordBagResult)
                  ? nodeReplacementWordBagResult.toLowerCase()
                  : nodeReplacementWordBagResult,
              ),
            );
            words++;
          }
        }
      label = ``;
    };
    for (let nodeReplacementWordBagResult of nodeChildren(
      nodeReplacementWordBag3,
    ) as Dynamic)
      if (nodeReplacementWordBagResult.type === `text`) {
        label +=
          typeof nodeReplacementWordBagResult.text == `string`
            ? nodeReplacementWordBagResult.text
            : ``;
      } else {
        toLowerCase();
        items2.push(
          internKey(
            request.heavyKeys,
            `a${inlineAtomIdentity(nodeReplacementWordBagResult, context)}`,
          ),
        );
        if (nodeReplacementWordBagResult.type !== `hardBreak`) {
          items.push(
            -1 -
              internKey(
                request.atoms,
                nodeContentKey(nodeReplacementWordBagResult, context),
              ),
          );
        }
      }
    toLowerCase();
  };
  internKey2(nodeReplacementWordBag2);
  let first: Dynamic = items.length > 0 ? items[0] : 0;
  let last: Dynamic = items.length > 0 ? items[items.length - 1] : 0;
  let record: Dynamic = {
    ids: Int32Array.from(items).toSorted(),
    words: words,
    first: first,
    last: last,
    heavy: Int32Array.from(items2).toSorted(),
  };
  request.bags.set(nodeReplacementWordBag2, record);
  return record;
}
function countBagIntersection(
  items?: Dynamic,
  items2?: Dynamic,
  ..._extraArguments: unknown[]
): number {
  let index: number = 0;
  let index2: number = 0;
  let index3: number = 0;
  for (; index < items.length && index2 < items2.length; )
    if (items[index] === items2[index2]) {
      index3++;
      index++;
      index2++;
    } else {
      if (items[index] < items2[index2]) {
        index++;
      } else {
        index2++;
      }
    }
  return index3;
}
function isSubstantialBagReplacement(
  items?: Dynamic,
  items2?: Dynamic,
  ..._extraArguments: unknown[]
): boolean {
  if (items.length < MIN_CHANGED_WORDS || items2.length < MIN_CHANGED_WORDS)
    return false;
  let countBagIntersection2: Dynamic = countBagIntersection(items, items2);
  let difference: number = items.length - countBagIntersection2;
  let difference2: number = items2.length - countBagIntersection2;
  return (
    difference > 0 &&
    difference2 > 0 &&
    (difference + difference2) / (items.length + items2.length) >
      REPLACEMENT_CHANGE_RATIO
  );
}
function shouldReplaceNodePair(
  shouldReplaceNodePair2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): boolean {
  if (
    nodeChildTokenWeight(shouldReplaceNodePair2, dependencies) +
      nodeChildTokenWeight(options, dependencies) >
    MAX_PAIR_TOKEN_CHARACTERS
  )
    return true;
  let nodeReplacementWordBag2: Dynamic = nodeReplacementWordBag(
    shouldReplaceNodePair2,
    context,
    dependencies,
  );
  let nodeReplacementWordBag3: Dynamic = nodeReplacementWordBag(
    options,
    context,
    dependencies,
  );
  if (
    nodeReplacementWordBag2.words === 0 &&
    nodeReplacementWordBag3.words === 0 &&
    nodeReplacementWordBag2.ids.length > 0 &&
    nodeReplacementWordBag3.ids.length > 0
  )
    return true;
  let countBagIntersection2: Dynamic = countBagIntersection(
    nodeReplacementWordBag2.ids,
    nodeReplacementWordBag3.ids,
  );
  let total: Dynamic =
    nodeReplacementWordBag2.ids.length + nodeReplacementWordBag3.ids.length;
  return countBagIntersection2 === nodeReplacementWordBag2.ids.length ||
    countBagIntersection2 === nodeReplacementWordBag3.ids.length ||
    (total <= MIN_REPLACEMENT_WORDS &&
      (nodeReplacementWordBag2.first === nodeReplacementWordBag3.first ||
        nodeReplacementWordBag2.last === nodeReplacementWordBag3.last))
    ? true
    : isSubstantialBagReplacement(
          nodeReplacementWordBag2.heavy,
          nodeReplacementWordBag3.heavy,
        )
      ? false
      : countBagIntersection2 >= MIN_NODE_PAIR_WORDS ||
        4 * countBagIntersection2 >= total;
}
function isStableNodeIdentity(
  stableNodeIdentity?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): boolean {
  if (commonNodeBlockId(stableNodeIdentity, options) !== null) return true;
  if (nodeWordBag(stableNodeIdentity, options).length === 0) return false;
  let nodeContentKey2: Dynamic = nodeContentKey(stableNodeIdentity, options);
  let { prev: hashCounts, curr: hashCounts2 }: Dynamic = options.hashCounts();
  return (
    hashCounts.get(nodeContentKey2) === 1 &&
    hashCounts2.get(nodeContentKey2) === 1
  );
}
function hasNearbyCodeTwin(
  nearbyCodeTwin?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (
    nearbyCodeTwin.type !== `codeBlock` ||
    commonNodeBlockId(nearbyCodeTwin, dependencies) !== null ||
    nodeWordCount(nearbyCodeTwin) < MIN_CODE_BLOCK_WORDS
  )
    return false;
  let nodeWordBag2: Dynamic = nodeWordBag(nearbyCodeTwin, dependencies);
  let uniqueItems: Dynamic = new (Set as Dynamic)(collectTextBlocks(options));
  return dependencies
    .nearTwins(context)
    .some(
      (nearTwin?: Dynamic, ..._extraArguments: unknown[]): boolean =>
        !uniqueItems.has(nearTwin) &&
        bagSimilarity(nodeWordBag2, nodeWordBag(nearTwin, dependencies)) >=
          MIN_CODE_CONVERSION_SIMILARITY,
    );
}
function collectTextBlocks(
  collectTextBlocks2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items: Dynamic = [];
  let nodeChildren2 = (
    collectTextBlocks3?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (TEXT_BLOCK_NODE_TYPES.has(collectTextBlocks3.type))
      items.push(collectTextBlocks3);
    else
      for (let collectTextBlocksResult of nodeChildren(
        collectTextBlocks3,
      ) as Dynamic)
        nodeChildren2(collectTextBlocksResult);
  };
  nodeChildren2(collectTextBlocks2);
  return items;
}
function containerHasStableContent(
  containerHasStableContent2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let filteredCollectTextBlocks: Dynamic = collectTextBlocks(
    containerHasStableContent2,
  ).filter(
    (collectTextBlock?: Dynamic, ..._extraArguments: unknown[]) =>
      nodeWordBag(collectTextBlock, context).length > 0,
  );
  if (filteredCollectTextBlocks.length === 0) return false;
  let uniqueItems: Dynamic = new (Set as Dynamic)();
  for (let containerHasStableContentResult of collectTextBlocks(
    options,
  ) as Dynamic) {
    let nodeBlockId2: Dynamic = nodeBlockId(containerHasStableContentResult);
    if (nodeBlockId2 !== null) {
      uniqueItems.add(`b:${nodeBlockId2}`);
    }
    uniqueItems.add(
      `h:${nodeContentKey(containerHasStableContentResult, context)}`,
    );
  }
  let { prev: hashCounts, curr: hashCounts2 }: Dynamic = context.hashCounts();
  let index: number = 0;
  for (let containerHasStableContentResult of filteredCollectTextBlocks as Dynamic) {
    let commonNodeBlockId2: Dynamic = commonNodeBlockId(
      containerHasStableContentResult,
      context,
    );
    let nodeContentKey2: Dynamic = nodeContentKey(
      containerHasStableContentResult,
      context,
    );
    if (
      commonNodeBlockId2 === null
        ? hashCounts.get(nodeContentKey2) === 1 &&
          hashCounts2.get(nodeContentKey2) === 1 &&
          !uniqueItems.has(`h:${nodeContentKey2}`)
        : !uniqueItems.has(`b:${commonNodeBlockId2}`)
    ) {
      index++;
    }
  }
  return 2 * index >= filteredCollectTextBlocks.length;
}
function renderNodeSequenceOperation(
  nodeSequenceOperation?: Dynamic,
  options?: Dynamic,
  context: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  switch (nodeSequenceOperation.t) {
    case `keep`:
      return hasChangedInlineRuns(
        nodeSequenceOperation.a,
        nodeSequenceOperation.b,
        options,
      )
        ? renderNodeSequenceOperation(
            {
              t: `pair`,
              a: nodeSequenceOperation.a,
              b: nodeSequenceOperation.b,
            },
            options,
            context,
          )
        : [nodeSequenceOperation.b];
    case `pair`:
      try {
        return diffPairedNodes(
          nodeSequenceOperation.a,
          nodeSequenceOperation.b,
          options,
          context,
        );
      } catch {
        options.degrade(`exception`, nodeSequenceOperation.b);
        return replaceNodePair(
          nodeSequenceOperation.a,
          nodeSequenceOperation.b,
          options,
        );
      }
    case `del`:
      return [
        markNodeInsertionOrDeletion(
          nodeSequenceOperation.a,
          `del`,
          createChangeRecord(
            `del`,
            nodeSequenceOperation.a.type,
            nodeDeletedSummary(nodeSequenceOperation.a),
          ),
          options,
        ),
      ];
    case `ins`:
      return [
        markNodeInsertionOrDeletion(
          nodeSequenceOperation.b,
          `ins`,
          createChangeRecord(
            `ins`,
            nodeSequenceOperation.b.type,
            nodeAddedSummary(nodeSequenceOperation.b),
          ),
          options,
        ),
      ];
  }
}
function diffPairedNodes(
  diffPairedNodes2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (diffPairedNodes2.type !== options.type)
    return diffConvertedTextBlock(diffPairedNodes2, options, context);
  if (!TEXT_BLOCK_NODE_TYPES.has(options.type))
    return [diffNode(diffPairedNodes2, options, context, dependencies)];
  context.scopeStack.push(options);
  let diffPairedNodesResult: Dynamic;
  try {
    diffPairedNodesResult = diffTextBlockTokensWithRuns(
      diffPairedNodes2,
      options,
      context,
    );
    if (
      diffPairedNodesResult !== null &&
      isSubstantialInlineReplacement(
        diffPairedNodesResult.runs
          ? diffTextBlockTokens(diffPairedNodes2, options, context)
          : diffPairedNodesResult.ops,
      )
    )
      return replaceNodePair(diffPairedNodes2, options, context);
  } finally {
    context.scopeStack.pop();
  }
  let diffNode2: Dynamic = diffNode(
    diffPairedNodes2,
    options,
    context,
    dependencies,
    diffPairedNodesResult,
  );
  if (isDeletedTextBlock(diffPairedNodes2, options)) {
    context.husks.set(diffNode2, diffPairedNodes2);
  }
  return [diffNode2];
}
function diffConvertedTextBlock(
  diffConvertedTextBlock2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let mappedNodeChildren: Dynamic =
    options.type === `codeBlock`
      ? nodeChildren(diffConvertedTextBlock2).map(
          (nodeChildren2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
            nodeChildren2.type === `hardBreak`
              ? {
                  type: `text`,
                  text: `
`,
                }
              : nodeChildren2,
        )
      : nodeChildren(diffConvertedTextBlock2);
  context.scopeStack.push(options);
  let diffConvertedTextBlockResult: Dynamic;
  try {
    diffConvertedTextBlockResult = deferInsertionsUntilDeletionFlush(
      alignInlineTokens(
        inlineNodeTokens(mappedNodeChildren, context),
        inlineNodeTokens(nodeChildren(options), context),
        context,
      ),
    );
  } finally {
    context.scopeStack.pop();
  }
  if (isSubstantialInlineReplacement(diffConvertedTextBlockResult))
    return replaceNodePair(diffConvertedTextBlock2, options, context);
  let renderInlineTokenDiff2: Dynamic = renderInlineTokenDiff(
    diffConvertedTextBlockResult,
    context,
  );
  let withNodeChildren2: Dynamic = withNodeChildren(
    {
      ...options,
    },
    options.type === `codeBlock`
      ? mergeAdjacentTextNodes(
          renderInlineTokenDiff2.map(keepOnlyDiffMarks),
          context,
        )
      : renderInlineTokenDiff2,
  );
  context.origin.set(withNodeChildren2, options);
  annotateAttributeChange(
    withNodeChildren2,
    {
      summary: `${nodeKindLabel(diffConvertedTextBlock2)} → ${nodeKindLabel(options)}`,
      before: {
        type: diffConvertedTextBlock2.type,
      },
    },
    context,
  );
  return [withNodeChildren2];
}
function keepOnlyDiffMarks(
  keepOnlyDiffMarks2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (
    keepOnlyDiffMarks2.type !== `text` ||
    keepOnlyDiffMarks2.marks === undefined
  )
    return keepOnlyDiffMarks2;
  let marks: Dynamic = keepOnlyDiffMarks2.marks.filter(
    (mark?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      DIFF_MARK_NAMES.has(mark.type),
  );
  if (marks.length === keepOnlyDiffMarks2.marks.length)
    return keepOnlyDiffMarks2;
  let { marks: keepOnlyDiffMarks3, ...keepOnlyDiffMarks4 }: Dynamic =
    keepOnlyDiffMarks2;
  return marks.length
    ? {
        ...keepOnlyDiffMarks4,
        marks: marks,
      }
    : keepOnlyDiffMarks4;
}
var isDeletedTextBlock: Dynamic = (
  deletedTextBlock?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  nodeChildren(options).every(
    (nodeChildren2?: Dynamic, ..._extraArguments: unknown[]): boolean =>
      nodeChildren2.type === `text` && !nodeChildren2.text,
  ) && /\S/.test(textBlockText(deletedTextBlock));
function diffNode(
  diffNode2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies: Dynamic = {},
  argument?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let diffNodeDetails2: Dynamic = diffNodeDetails(
    diffNode2,
    options,
    context,
    dependencies,
    argument,
  );
  if (diffNodeDetails2.summary !== null) {
    absorbChildChanges(
      diffNodeDetails2,
      annotateAttributeChange(
        diffNodeDetails2.node,
        {
          summary: diffNodeDetails2.summary,
          before: diffNodeDetails2.before,
        },
        context,
      ),
      context,
    );
  }
  return diffNodeDetails2.node;
}
var emptyNodeDiffDetails: Dynamic = (
  node?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => ({
  node: node,
  summary: null,
  before: {},
  absorbed: [],
  moved: [],
});
function absorbChildChanges(
  absorbChildChanges2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  for (let absorbChildChangesResult of absorbChildChanges2.absorbed as Dynamic)
    absorbChildChangesResult.alias = options;
  for (let absorbChildChangesResult of absorbChildChanges2.moved as Dynamic)
    annotateNodeChange(absorbChildChangesResult, `move`, options, context, {
      [DIFF_ATTRIBUTE_NAMES.summary]: `Reordered`,
    });
}
function diffNodeDetails(
  diffNodeDetails2?: Dynamic,
  node?: Dynamic,
  context?: Dynamic,
  dependencies: Dynamic = {},
  argument?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items: Dynamic = [];
  let nodeAttributeChanges2: Dynamic = nodeAttributeChanges(
    diffNodeDetails2,
    node,
    context,
    explicitlyChangedAttributes(diffNodeDetails2, node, dependencies),
  );
  let before: Dynamic = nodeAttributeChanges2?.before ?? {};
  if (nodeAttributeChanges2 !== null) {
    items.push(nodeAttributeChanges2.summary);
  }
  let calloutKindChangeSummary2: Dynamic =
    node.type === `blockquote`
      ? calloutKindChangeSummary(diffNodeDetails2, node)
      : null;
  if (calloutKindChangeSummary2 !== null) {
    items.push(calloutKindChangeSummary2);
    before.callout = calloutKindFromJson(diffNodeDetails2);
  }
  let emptySequenceMovementState2: Dynamic = emptySequenceMovementState();
  let items2: Dynamic;
  context.scopeStack.push(node);
  try {
    if (TEXT_BLOCK_NODE_TYPES.has(node.type)) {
      let diffTextBlockTokensWithRuns2: Dynamic =
        argument === undefined
          ? diffTextBlockTokensWithRuns(diffNodeDetails2, node, context)
          : argument;
      items2 =
        diffTextBlockTokensWithRuns2 === null
          ? nodeChildren(node)
          : renderInlineTokenDiff(diffTextBlockTokensWithRuns2.ops, context);
    } else if (node.type === `table`)
      items2 = diffTableRows(
        nodeChildren(diffNodeDetails2),
        nodeChildren(node),
        context,
        emptySequenceMovementState2,
      );
    else if (node.type === `list`) {
      let impliedChecked: boolean =
        (effectiveNodeAttribute(diffNodeDetails2, `kind`) === `check`) !=
        (effectiveNodeAttribute(node, `kind`) === `check`);
      items2 = diffNodeSequence(
        nodeChildren(diffNodeDetails2),
        nodeChildren(node),
        context,
        {
          impliedChecked: impliedChecked,
        },
        emptySequenceMovementState2,
      );
    } else if (
      node.type === `tableRow` ||
      CONTAINER_NODE_TYPES.has(node.type)
    ) {
      items2 = diffNodeSequence(
        nodeChildren(diffNodeDetails2),
        nodeChildren(node),
        context,
        {},
        emptySequenceMovementState2,
      );
    }
  } finally {
    context.scopeStack.pop();
  }
  let moved: Dynamic = [];
  if (emptySequenceMovementState2.reordered) {
    items.push(`Reordered`);
    items2 = items2?.map(
      (diffNodeDetails3?: Dynamic, ..._extraArguments: unknown[]): Dynamic => {
        let originEntry: Dynamic =
          context.origin.get(diffNodeDetails3) ?? diffNodeDetails3;
        if (
          !emptySequenceMovementState2.moved.has(originEntry) ||
          context.nodeCh.has(diffNodeDetails3)
        )
          return diffNodeDetails3;
        let record: Dynamic = {
          ...diffNodeDetails3,
        };
        context.origin.set(record, originEntry);
        moved.push(record);
        return record;
      },
    );
  }
  let node2: Dynamic = {
    ...node,
  };
  if (
    items2 !== undefined &&
    (items2.length > 0 || node.content !== undefined)
  ) {
    node2.content = items2;
  }
  context.origin.set(node2, node);
  let absorbed: Dynamic =
    calloutKindChangeSummary2 === null
      ? []
      : leadingCalloutMarkChanges(items2?.[0], context);
  for (let diffNodeDetailsResult of emptySequenceMovementState2.hoisted as Dynamic) {
    items.push(diffNodeDetailsResult.summary);
    absorbed.push(diffNodeDetailsResult);
  }
  return {
    node: node2,
    summary: items.length ? items.join(`; `) : null,
    before: before,
    absorbed: absorbed,
    moved: moved,
  };
}
var isImpliedUnchecked: Dynamic = (
  impliedUnchecked?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  (impliedUnchecked === null && options === false) || options === null;
function explicitlyChangedAttributes(
  explicitlyChanged?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let changedNodeAttributes2: Dynamic = changedNodeAttributes(
    explicitlyChanged,
    options,
  );
  if (context.impliedChecked && options.type === `listItem`) {
    changedNodeAttributes2 = changedNodeAttributes2.filter(
      (
        changedNodeAttribute?: Dynamic,
        ..._extraArguments: unknown[]
      ): boolean =>
        changedNodeAttribute !== `checked` ||
        !isImpliedUnchecked(
          effectiveNodeAttribute(explicitlyChanged, changedNodeAttribute),
          effectiveNodeAttribute(options, changedNodeAttribute),
        ),
    );
  }
  if (context.impliedHeading && options.type === `paragraph`) {
    changedNodeAttributes2 = changedNodeAttributes2.filter(
      (changedNodeAttribute?: Dynamic, ..._extraArguments: unknown[]) =>
        changedNodeAttribute !== `heading`,
    );
  }
  return changedNodeAttributes2;
}
function leadingCalloutMarkChanges(
  leadingCalloutMarkChanges2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (leadingCalloutMarkChanges2?.type !== `paragraph`) return [];
  let uniqueItems: Dynamic = new (Set as Dynamic)();
  let lookup: Dynamic = new (Map as Dynamic)([
    [DIFF_MARK_TYPES.ins, ``],
    [DIFF_MARK_TYPES.del, ``],
  ]);
  let enabled: boolean = true;
  for (let leadingCalloutMarkChangesResult of nodeChildren(
    leadingCalloutMarkChanges2,
  ) as Dynamic) {
    let mark: Dynamic =
      leadingCalloutMarkChangesResult.type === `text`
        ? leadingCalloutMarkChangesResult.marks?.find(
            (
              leadingCalloutMarkChanges3?: Dynamic,
              ..._extraArguments: unknown[]
            ): Dynamic => options.markCh.has(leadingCalloutMarkChanges3),
          )
        : undefined;
    if (enabled && mark !== undefined && lookup.has(mark.type)) {
      uniqueItems.add(options.markCh.get(mark));
      lookup.set(
        mark.type,
        lookup.get(mark.type) + (leadingCalloutMarkChangesResult.text ?? ``),
      );
      continue;
    }
    enabled = false;
    let mark2: Dynamic =
      leadingCalloutMarkChangesResult.type === `text`
        ? leadingCalloutMarkChangesResult.marks?.find(
            (
              leadingCalloutMarkChanges3?: Dynamic,
              ..._extraArguments: unknown[]
            ): Dynamic => options.markCh.has(leadingCalloutMarkChanges3),
          )
        : undefined;
    if (
      (mark2 !== undefined && uniqueItems.has(options.markCh.get(mark2))) ||
      (options.nodeCh.has(leadingCalloutMarkChangesResult) &&
        uniqueItems.has(options.nodeCh.get(leadingCalloutMarkChangesResult)))
    )
      return [];
  }
  return uniqueItems.size === 1 &&
    isEmptyCalloutPrefix(lookup.get(DIFF_MARK_TYPES.ins)) &&
    isEmptyCalloutPrefix(lookup.get(DIFF_MARK_TYPES.del))
    ? [...uniqueItems]
    : [];
}
var isWhitespaceToken: Dynamic = (
  whitespace?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  whitespace.text !== null && WHITESPACE_ONLY_PATTERN.test(whitespace.text);
var isContentToken = (content?: Dynamic, ..._extraArguments: unknown[]) =>
  !isWhitespaceToken(content);
function alignSplitOrJoinedParagraph(
  alignSplitOrJoinedParagraph2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let inlineNodeTokens2: Dynamic = inlineNodeTokens(
    nodeChildren(options),
    argument,
  );
  let inlineNodeTokens3: Dynamic = inlineNodeTokens(
    nodeChildren(context),
    argument,
  );
  let inlineNodeTokens4: Dynamic = inlineNodeTokens(
    nodeChildren(alignSplitOrJoinedParagraph2),
    argument,
  );
  let items: Dynamic = [...inlineNodeTokens2, ...inlineNodeTokens3];
  let ops: Dynamic = dependencies
    ? alignInlineTokens(inlineNodeTokens4, items, argument)
    : alignInlineTokens(items, inlineNodeTokens4, argument);
  let tail: Dynamic = new (Set as Dynamic)(inlineNodeTokens3);
  let index: number = 0;
  let index2: number = 0;
  for (let alignSplitOrJoinedParagraphResult of ops as Dynamic) {
    if (alignSplitOrJoinedParagraphResult.k !== `keep`) continue;
    let b2: Dynamic = dependencies
      ? alignSplitOrJoinedParagraphResult.b
      : alignSplitOrJoinedParagraphResult.a;
    if (isContentToken(b2)) {
      if (tail.has(b2)) {
        index2++;
      } else {
        index++;
      }
    }
  }
  let filteredInlineNodeTokensCount: Dynamic =
    inlineNodeTokens2.filter(isContentToken).length;
  let filteredInlineNodeTokensCount2: Dynamic =
    inlineNodeTokens3.filter(isContentToken).length;
  return filteredInlineNodeTokensCount > 0 &&
    filteredInlineNodeTokensCount2 > 0 &&
    index * 2 >= filteredInlineNodeTokensCount &&
    index2 * 2 >= filteredInlineNodeTokensCount2
    ? {
        ops: ops,
        tail: tail,
      }
    : null;
}
function diffSplitParagraph(
  diffSplitParagraph2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let alignSplitOrJoinedParagraph2: Dynamic = alignSplitOrJoinedParagraph(
    diffSplitParagraph2,
    options,
    context,
    true,
    dependencies,
  );
  if (alignSplitOrJoinedParagraph2 === null) return null;
  let items: Dynamic = [];
  let items2: Dynamic = [];
  let enabled: boolean = false;
  for (let diffSplitParagraphResult of alignSplitOrJoinedParagraph2.ops as Dynamic) {
    if (
      diffSplitParagraphResult.k !== `del` &&
      alignSplitOrJoinedParagraph2.tail.has(diffSplitParagraphResult.b)
    ) {
      enabled = true;
    }
    (enabled ? items2 : items).push(diffSplitParagraphResult);
  }
  for (
    let itemItem: Dynamic = items[items.length - 1];
    itemItem?.k === `del` && isWhitespaceToken(itemItem.a);
    itemItem = items[items.length - 1]
  )
    items.pop();
  return {
    head: renderInlineTokenDiff(
      deferInsertionsUntilDeletionFlush(items),
      dependencies,
    ),
    tail: renderInlineTokenDiff(
      deferInsertionsUntilDeletionFlush(items2),
      dependencies,
    ),
  };
}
function diffJoinedParagraph(
  diffJoinedParagraph2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let alignSplitOrJoinedParagraph2: Dynamic = alignSplitOrJoinedParagraph(
    context,
    diffJoinedParagraph2,
    options,
    false,
    dependencies,
  );
  if (alignSplitOrJoinedParagraph2 === null) return null;
  let opsSlice: Dynamic = alignSplitOrJoinedParagraph2.ops.slice();
  let opsSliceIndex: Dynamic = opsSlice.findIndex(
    (opsSlice2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      opsSlice2.k !== `ins` &&
      alignSplitOrJoinedParagraph2.tail.has(opsSlice2.a),
  );
  for (
    let difference: number = opsSliceIndex - 1;
    difference >= 0;
    difference--
  ) {
    let opsSliceItem: Dynamic = opsSlice[difference];
    if (opsSliceItem.k !== `ins`) break;
    if (isWhitespaceToken(opsSliceItem.b)) {
      opsSlice[difference] = {
        k: `keep`,
        a: opsSliceItem.b,
        b: opsSliceItem.b,
      };
    }
  }
  return renderInlineTokenDiff(
    deferInsertionsUntilDeletionFlush(opsSlice),
    dependencies,
  );
}
function trySplitOrJoinNodes(
  trySplitOrJoinNodes2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return trySplitOrJoinNodes2.t === `pair` && options.t === `ins`
    ? splitParagraphNodes(
        trySplitOrJoinNodes2.a,
        trySplitOrJoinNodes2.b,
        options.b,
        true,
        context,
        dependencies,
      )
    : trySplitOrJoinNodes2.t === `ins` && options.t === `pair`
      ? splitParagraphNodes(
          options.a,
          trySplitOrJoinNodes2.b,
          options.b,
          false,
          context,
          dependencies,
        )
      : trySplitOrJoinNodes2.t === `pair` && options.t === `del`
        ? joinParagraphNodes(
            trySplitOrJoinNodes2.a,
            options.a,
            trySplitOrJoinNodes2.b,
            context,
            dependencies,
          )
        : trySplitOrJoinNodes2.t === `del` && options.t === `pair`
          ? joinParagraphNodes(
              trySplitOrJoinNodes2.a,
              options.a,
              options.b,
              context,
              dependencies,
            )
          : null;
}
var singleParagraphChildren: Dynamic = (
  ...singleParagraphChildren2: Dynamic[]
): Dynamic => {
  let mappedSingleParagraphChildren: Dynamic = singleParagraphChildren2.map(
    (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      nodeChildren(item)[0],
  );
  return mappedSingleParagraphChildren.every(
    (mappedSingleParagraphChildren2?: Dynamic, ..._extraArguments: unknown[]) =>
      mappedSingleParagraphChildren2?.type === `paragraph`,
  )
    ? mappedSingleParagraphChildren
    : null;
};
function splitParagraphNodes(
  splitParagraphNodes2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  argument2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (
    splitParagraphNodes2.type !== options.type ||
    splitParagraphNodes2.type !== context.type
  )
    return null;
  let splitParagraphNodesResult: Dynamic;
  let splitParagraphNodesResult2: Dynamic;
  let splitParagraphNodesResult3: Dynamic;
  if (splitParagraphNodes2.type === `paragraph`) {
    let diffSplitParagraph2: Dynamic = diffSplitParagraph(
      splitParagraphNodes2,
      options,
      context,
      argument,
    );
    if (diffSplitParagraph2 === null) return null;
    splitParagraphNodesResult = withNodeChildren(
      options,
      diffSplitParagraph2.head,
    );
    splitParagraphNodesResult2 = withNodeChildren(
      context,
      diffSplitParagraph2.tail,
    );
    splitParagraphNodesResult3 = `Paragraph split`;
  } else if (splitParagraphNodes2.type === `listItem`) {
    let singleParagraphChildren2: Dynamic = singleParagraphChildren(
      splitParagraphNodes2,
      options,
      context,
    );
    if (singleParagraphChildren2 === null) return null;
    let [
      singleParagraphChildren3,
      setSingleParagraphChildren,
      singleParagraphChildren4,
    ]: Dynamic = singleParagraphChildren2;
    let diffSplitParagraph2: Dynamic = diffSplitParagraph(
      singleParagraphChildren3,
      setSingleParagraphChildren,
      singleParagraphChildren4,
      argument,
    );
    if (diffSplitParagraph2 === null) return null;
    let diffNodeSequence2: Dynamic = diffNodeSequence(
      nodeChildren(splitParagraphNodes2).slice(1),
      nodeChildren(dependencies ? options : context).slice(1),
      argument,
    );
    let mappedNodeChildrenSlice: Dynamic = nodeChildren(
      dependencies ? context : options,
    )
      .slice(1)
      .map(
        (nodeChildrenSlice?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          markNodeInsertionOrDeletion(
            nodeChildrenSlice,
            `ins`,
            createChangeRecord(
              `ins`,
              nodeChildrenSlice.type,
              nodeAddedSummary(nodeChildrenSlice),
            ),
            argument,
          ),
      );
    splitParagraphNodesResult = {
      ...options,
      content: [
        withNodeChildren(setSingleParagraphChildren, diffSplitParagraph2.head),
        ...(dependencies ? diffNodeSequence2 : mappedNodeChildrenSlice),
      ],
    };
    splitParagraphNodesResult2 = {
      ...context,
      content: [
        withNodeChildren(singleParagraphChildren4, diffSplitParagraph2.tail),
        ...(dependencies ? mappedNodeChildrenSlice : diffNodeSequence2),
      ],
    };
    splitParagraphNodesResult3 = `List item split`;
  } else return null;
  let options2: Dynamic = dependencies ? options : context;
  let nodeAttributeChanges2: Dynamic = nodeAttributeChanges(
    splitParagraphNodes2,
    options2,
    argument,
    explicitlyChangedAttributes(splitParagraphNodes2, options2, argument2),
  );
  if (nodeAttributeChanges2 !== null) {
    annotateAttributeChange(
      dependencies ? splitParagraphNodesResult : splitParagraphNodesResult2,
      nodeAttributeChanges2,
      argument,
    );
  }
  annotateNodeChange(
    dependencies ? splitParagraphNodesResult2 : splitParagraphNodesResult,
    `ins`,
    createChangeRecord(
      `ins`,
      splitParagraphNodes2.type,
      splitParagraphNodesResult3,
    ),
    argument,
    {
      [DIFF_ATTRIBUTE_NAMES.summary]: splitParagraphNodesResult3,
    },
  );
  argument.origin.set(splitParagraphNodesResult, options);
  argument.origin.set(splitParagraphNodesResult2, context);
  return [splitParagraphNodesResult, splitParagraphNodesResult2];
}
function joinParagraphNodes(
  joinParagraphNodes2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (
    joinParagraphNodes2.type !== context.type ||
    options.type !== context.type
  )
    return null;
  let joinParagraphNodesResult: Dynamic;
  let joinParagraphNodesResult2: Dynamic;
  if (context.type === `paragraph`) {
    let diffJoinedParagraph2: Dynamic = diffJoinedParagraph(
      joinParagraphNodes2,
      options,
      context,
      dependencies,
    );
    if (diffJoinedParagraph2 === null) return null;
    joinParagraphNodesResult = withNodeChildren(context, diffJoinedParagraph2);
    joinParagraphNodesResult2 = `Paragraphs joined`;
  } else if (context.type === `listItem`) {
    let singleParagraphChildren2: Dynamic = singleParagraphChildren(
      joinParagraphNodes2,
      options,
      context,
    );
    if (singleParagraphChildren2 === null) return null;
    let [
      singleParagraphChildren3,
      setSingleParagraphChildren,
      singleParagraphChildren4,
    ]: Dynamic = singleParagraphChildren2;
    let diffJoinedParagraph2: Dynamic = diffJoinedParagraph(
      singleParagraphChildren3,
      setSingleParagraphChildren,
      singleParagraphChildren4,
      dependencies,
    );
    if (diffJoinedParagraph2 === null) return null;
    let diffNodeSequence2: Dynamic = diffNodeSequence(
      [
        ...nodeChildren(joinParagraphNodes2).slice(1),
        ...nodeChildren(options).slice(1),
      ],
      nodeChildren(context).slice(1),
      dependencies,
    );
    joinParagraphNodesResult = {
      ...context,
      content: [
        withNodeChildren(singleParagraphChildren4, diffJoinedParagraph2),
        ...diffNodeSequence2,
      ],
    };
    joinParagraphNodesResult2 = `List items joined`;
  } else return null;
  let nodeBlockId2: Dynamic = nodeBlockId(context);
  let options2: Dynamic =
    nodeBlockId2 !== null &&
    nodeBlockId(options) === nodeBlockId2 &&
    nodeBlockId(joinParagraphNodes2) !== nodeBlockId2
      ? options
      : joinParagraphNodes2;
  let nodeAttributeChanges2: Dynamic = nodeAttributeChanges(
    options2,
    context,
    dependencies,
    explicitlyChangedAttributes(options2, context, argument),
  );
  let joinParagraphNodesResult3: Dynamic =
    nodeAttributeChanges2 === null
      ? joinParagraphNodesResult2
      : `${nodeAttributeChanges2.summary}; ${joinParagraphNodesResult2}`;
  annotateNodeChange(
    joinParagraphNodesResult,
    `chg`,
    createChangeRecord(`chg`, context.type, joinParagraphNodesResult3),
    dependencies,
    {
      [DIFF_ATTRIBUTE_NAMES.summary]: joinParagraphNodesResult3,
      ...(nodeAttributeChanges2 === null
        ? {}
        : {
            [DIFF_ATTRIBUTE_NAMES.before]: nodeAttributeChanges2.before,
          }),
    },
  );
  dependencies.origin.set(joinParagraphNodesResult, context);
  return [joinParagraphNodesResult];
}
function diffTableRows(
  diffTableRows2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let alignNodeSequences2: Dynamic = alignNodeSequences(
    diffTableRows2,
    options,
    context,
    dependencies,
  );
  let findCommonColumnPermutation2: Dynamic = findCommonColumnPermutation(
    alignNodeSequences2,
    context,
  );
  let diffChangedTableColumns2: Dynamic =
    findCommonColumnPermutation2 === null
      ? diffChangedTableColumns(alignNodeSequences2, context)
      : applyColumnPermutation(
          alignNodeSequences2,
          findCommonColumnPermutation2,
          context,
        );
  let groupTableColumnChanges2: Dynamic = groupTableColumnChanges(
    diffChangedTableColumns2,
    context,
  );
  if (dependencies !== undefined) {
    dependencies.hoisted = groupTableColumnChanges2;
  }
  return diffChangedTableColumns2;
}
var tableRowColumnCount: Dynamic = (
  tableRowColumnCount2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  tableRowColumnCount2.reduce(
    (
      accumulator?: Dynamic,
      accumulator2?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => {
      let nodeAttribute2: Dynamic = nodeAttribute(accumulator2, `colspan`);
      return (
        accumulator +
        (typeof nodeAttribute2 == `number` && nodeAttribute2 > 0
          ? nodeAttribute2
          : 1)
      );
    },
    0,
  );
var isUnspannedCell: Dynamic = (
  unspannedCell?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  effectiveNodeAttribute(unspannedCell, `colspan`) === 1 &&
  effectiveNodeAttribute(unspannedCell, `rowspan`) === 1;
function tableColumnPermutation(
  tableColumnPermutation2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let mappedTableColumnPermutation: Dynamic = tableColumnPermutation2.map(
    (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      commonNodeBlockId(item, context),
  );
  let mappedOptions: Dynamic = options.map(
    (option?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      commonNodeBlockId(option, context),
  );
  let mappedTableColumnPermutation2: Dynamic = mappedTableColumnPermutation;
  let mappedOptions2: Dynamic = mappedOptions;
  if (
    (!mappedTableColumnPermutation.every(
      (
        mappedTableColumnPermutation3?: Dynamic,
        ..._extraArguments: unknown[]
      ) => mappedTableColumnPermutation3 !== null,
    ) ||
      !mappedOptions.every(
        (mappedOption?: Dynamic, ..._extraArguments: unknown[]) =>
          mappedOption !== null,
      )) &&
    ((mappedTableColumnPermutation2 = tableColumnPermutation2.map(
      (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        nodeContentKey(item, context),
    )),
    (mappedOptions2 = options.map(
      (option?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        nodeContentKey(option, context),
    )),
    new (Set as Dynamic)(mappedTableColumnPermutation2).size !==
      mappedTableColumnPermutation2.length ||
      new (Set as Dynamic)(mappedOptions2).size !== mappedOptions2.length)
  )
    return null;
  let lookup: Dynamic = new (Map as Dynamic)(
    mappedOptions2.map(
      (
        mappedOption?: Dynamic,
        index?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => [mappedOption, index],
    ),
  );
  let mappedMappedTableColumnPermutation: Dynamic =
    mappedTableColumnPermutation2.map(
      (
        mappedTableColumnPermutation3?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => lookup.get(mappedTableColumnPermutation3) ?? -1,
    );
  return mappedMappedTableColumnPermutation.includes(-1)
    ? null
    : mappedMappedTableColumnPermutation;
}
function hasColumnPermutation(
  columnPermutation?: Dynamic,
  options?: Dynamic,
  items?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let nodeChildren2: Dynamic = nodeChildren(columnPermutation);
  let nodeChildren3: Dynamic = nodeChildren(options);
  if (
    nodeChildren2.length !== items.length ||
    nodeChildren3.length !== items.length ||
    !nodeChildren2.every(isUnspannedCell) ||
    !nodeChildren3.every(isUnspannedCell)
  )
    return false;
  let tableColumnPermutation2: Dynamic = tableColumnPermutation(
    nodeChildren2,
    nodeChildren3,
    dependencies,
  );
  return tableColumnPermutation2 === null
    ? nodeChildren2.every(
        (
          nodeChildren4?: Dynamic,
          index?: Dynamic,
          ..._extraArguments: unknown[]
        ) =>
          nodeContentKey(nodeChildren4, dependencies) ===
          nodeContentKey(nodeChildren3[items[index]], dependencies),
      )
    : tableColumnPermutation2.every(
        (
          tableColumnPermutation3?: Dynamic,
          index?: Dynamic,
          ..._extraArguments: unknown[]
        ) => tableColumnPermutation3 === items[index],
      );
}
function findCommonColumnPermutation(
  findCommonColumnPermutation2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items: Dynamic = [];
  for (let findCommonColumnPermutationResult3 of findCommonColumnPermutation2 as Dynamic)
    if (
      findCommonColumnPermutationResult3.t === `pair` ||
      findCommonColumnPermutationResult3.t === `keep`
    ) {
      items.push(findCommonColumnPermutationResult3);
    }
  let findCommonColumnPermutationResult: Dynamic = null;
  for (let findCommonColumnPermutationResult3 of items as Dynamic) {
    let nodeChildren2: Dynamic = nodeChildren(
      findCommonColumnPermutationResult3.a,
    );
    let nodeChildren3: Dynamic = nodeChildren(
      findCommonColumnPermutationResult3.b,
    );
    if (
      nodeChildren2.length < 2 ||
      nodeChildren2.length !== nodeChildren3.length ||
      !nodeChildren2.every(isUnspannedCell) ||
      !nodeChildren3.every(isUnspannedCell)
    )
      continue;
    let tableColumnPermutation2: Dynamic = tableColumnPermutation(
      nodeChildren2,
      nodeChildren3,
      options,
    );
    if (
      tableColumnPermutation2 !== null &&
      tableColumnPermutation2.some(
        (
          tableColumnPermutation3?: Dynamic,
          index?: Dynamic,
          ..._extraArguments: unknown[]
        ) => tableColumnPermutation3 !== index,
      )
    ) {
      findCommonColumnPermutationResult = tableColumnPermutation2;
      break;
    }
  }
  if (findCommonColumnPermutationResult === null) return null;
  let findCommonColumnPermutationResult2: Dynamic =
    findCommonColumnPermutationResult;
  return items.every(
    (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      hasColumnPermutation(
        item.a,
        item.b,
        findCommonColumnPermutationResult2,
        options,
      ),
  )
    ? findCommonColumnPermutationResult2
    : null;
}
function applyColumnPermutation(
  applyColumnPermutation2?: Dynamic,
  items?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let flatMap: Dynamic = items.flatMap(
    (
      item?: Dynamic,
      index?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => (item === index ? [index] : []),
  );
  let longestIncreasingSubsequence2: Dynamic =
    longestIncreasingSubsequence(items);
  let uniqueItems: Dynamic = new (Set as Dynamic)(
    flatMap.length >= longestIncreasingSubsequence2.length
      ? flatMap
      : longestIncreasingSubsequence2,
  );
  let moved: Dynamic = new (Map as Dynamic)();
  items.forEach(
    (
      item?: unknown,
      index?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      if (!uniqueItems.has(index)) {
        moved.set(index, createChangeRecord(`move`, `cell`, `Column moved`));
      }
    },
  );
  let inv: Dynamic = Array.from<Dynamic, Dynamic>(
    {
      length: items.length,
    },
    (..._extraArguments: unknown[]) => 0,
  );
  items.forEach(
    (
      item?: Dynamic,
      index?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      inv[item] = index;
    },
  );
  let record: Dynamic = {
    pi: items,
    inv: inv,
    moved: moved,
  };
  for (let applyColumnPermutationResult of applyColumnPermutation2 as Dynamic)
    if (applyColumnPermutationResult.t !== `del`) {
      context.rowPerm.set(applyColumnPermutationResult.b, record);
    }
  return applyColumnPermutation2.flatMap(
    (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      item.t === `pair` || item.t === `keep`
        ? [diffPermutedTableRow(item.a, item.b, record, context)]
        : renderNodeSequenceOperation(item, context),
  );
}
function diffPermutedTableRow(
  diffPermutedTableRow2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let nodeChildren2: Dynamic = nodeChildren(diffPermutedTableRow2);
  let content: Dynamic = nodeChildren(options).map(
    (
      nodeChildren3?: Dynamic,
      index?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => {
      let invItem: Dynamic = context.inv[index];
      let nodeChildrenItem: Dynamic = nodeChildren2[invItem];
      let matchesNodeContentKey: boolean =
        nodeContentKey(nodeChildrenItem, dependencies) ===
        nodeContentKey(nodeChildren3, dependencies);
      let movedEntry: Dynamic = context.moved.get(invItem);
      if (movedEntry === undefined)
        return matchesNodeContentKey
          ? nodeChildren3
          : diffNode(nodeChildrenItem, nodeChildren3, dependencies);
      let emptyNodeDiffDetails2: Dynamic = matchesNodeContentKey
        ? emptyNodeDiffDetails({
            ...nodeChildren3,
          })
        : diffNodeDetails(nodeChildrenItem, nodeChildren3, dependencies);
      annotateNodeChange(
        emptyNodeDiffDetails2.node,
        `move`,
        movedEntry,
        dependencies,
        {
          [DIFF_ATTRIBUTE_NAMES.summary]:
            emptyNodeDiffDetails2.summary === null
              ? `Column moved`
              : `Column moved; ${emptyNodeDiffDetails2.summary}`,
          ...(emptyNodeDiffDetails2.summary === null
            ? {}
            : {
                [DIFF_ATTRIBUTE_NAMES.before]: emptyNodeDiffDetails2.before,
              }),
        },
      );
      absorbChildChanges(emptyNodeDiffDetails2, movedEntry, dependencies);
      return emptyNodeDiffDetails2.node;
    },
  );
  let record: Dynamic = {
    ...options,
    content: content,
  };
  dependencies.origin.set(record, options);
  return record;
}
function diffChangedTableColumns(
  diffChangedTableColumns2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let lookup: Dynamic = new (Map as Dynamic)();
  let diffChangedTableColumnsResult: Dynamic = null;
  let diffChangedTableColumnsResult2: Dynamic = null;
  let enabled: boolean = true;
  for (let diffChangedTableColumnsResult3 of diffChangedTableColumns2 as Dynamic) {
    if (diffChangedTableColumnsResult3.t === `keep`) {
      enabled = false;
    }
    if (diffChangedTableColumnsResult3.t !== `pair`) continue;
    let alignNodeSequences2: Dynamic = alignNodeSequences(
      nodeChildren(diffChangedTableColumnsResult3.a),
      nodeChildren(diffChangedTableColumnsResult3.b),
      options,
    );
    lookup.set(diffChangedTableColumnsResult3, alignNodeSequences2);
    if (
      tableRowColumnCount(nodeChildren(diffChangedTableColumnsResult3.a)) ===
      tableRowColumnCount(nodeChildren(diffChangedTableColumnsResult3.b))
    ) {
      enabled = false;
    }
    let items: Dynamic = [];
    let items2: Dynamic = [];
    let index: number = 0;
    let index2: number = 0;
    for (let diffChangedTableColumnsResult4 of alignNodeSequences2 as Dynamic)
      if (diffChangedTableColumnsResult4.t === `ins`) {
        items.push(index2++);
      } else {
        if (diffChangedTableColumnsResult4.t === `del`) {
          items2.push(index++);
        } else {
          index++;
          index2++;
        }
      }
    let itemsText: Dynamic = items.join(`,`);
    let itemsText2: Dynamic = items2.join(`,`);
    if (diffChangedTableColumnsResult === null) {
      diffChangedTableColumnsResult = itemsText;
      diffChangedTableColumnsResult2 = itemsText2;
    } else {
      if (
        diffChangedTableColumnsResult !== itemsText ||
        diffChangedTableColumnsResult2 !== itemsText2
      ) {
        enabled = false;
      }
    }
  }
  enabled &&=
    diffChangedTableColumnsResult !== null &&
    (diffChangedTableColumnsResult !== `` ||
      diffChangedTableColumnsResult2 !== ``);
  let lookup2: Dynamic = new (Map as Dynamic)();
  let lookup3: Dynamic = new (Map as Dynamic)();
  if (enabled) {
    for (let diffChangedTableColumnsResult3 of (
      diffChangedTableColumnsResult ?? ``
    )
      .split(`,`)
      .filter(Boolean) as Dynamic)
      lookup2.set(
        Number(diffChangedTableColumnsResult3),
        createChangeRecord(`ins`, `cell`, `Column added`),
      );
    for (let diffChangedTableColumnsResult3 of (
      diffChangedTableColumnsResult2 ?? ``
    )
      .split(`,`)
      .filter(Boolean) as Dynamic)
      lookup3.set(
        Number(diffChangedTableColumnsResult3),
        createChangeRecord(`del`, `cell`, `Column deleted`),
      );
  }
  return diffChangedTableColumns2.flatMap(
    (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => {
      let lookupEntry: Dynamic = lookup.get(item);
      if (item.t !== `pair` || lookupEntry === undefined)
        return renderNodeSequenceOperation(item, options);
      let content: Dynamic = [];
      let index: number = 0;
      let index2: number = 0;
      for (let diffChangedTableColumnsResult3 of lookupEntry as Dynamic)
        if (diffChangedTableColumnsResult3.t === `ins`)
          content.push(
            markNodeInsertionOrDeletion(
              diffChangedTableColumnsResult3.b,
              `ins`,
              lookup2.get(index2++) ??
                createChangeRecord(
                  `ins`,
                  `cell`,
                  nodeAddedSummary(diffChangedTableColumnsResult3.b),
                ),
              options,
            ),
          );
        else if (diffChangedTableColumnsResult3.t === `del`)
          content.push(
            markNodeInsertionOrDeletion(
              diffChangedTableColumnsResult3.a,
              `del`,
              lookup3.get(index++) ??
                createChangeRecord(
                  `del`,
                  `cell`,
                  nodeDeletedSummary(diffChangedTableColumnsResult3.a),
                ),
              options,
            ),
          );
        else {
          for (let diffChangedTableColumnsResult4 of renderNodeSequenceOperation(
            diffChangedTableColumnsResult3,
            options,
          ) as Dynamic)
            content.push(diffChangedTableColumnsResult4);
          index++;
          index2++;
        }
      let record: Dynamic = {
        ...item.b,
        content: content,
      };
      options.origin.set(record, item.b);
      return [record];
    },
  );
}
var HEADER_CELL_CHANGE_SUMMARIES: Dynamic = new (Set as Dynamic)([
  `Made header cell`,
  `Made body cell`,
]);
var headerColumnSummary: Dynamic = (
  headerColumnSummary2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  headerColumnSummary2 === `Made header cell`
    ? `Header ${options} added`
    : headerColumnSummary2 === `Made body cell`
      ? `Header ${options} removed`
      : headerColumnSummary2;
function groupTableColumnChanges(
  groupTableColumnChanges2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let tableCellColumnPositions2: Dynamic = tableCellColumnPositions(
    groupTableColumnChanges2,
  );
  let items: Dynamic = [];
  let items2: Dynamic = [];
  groupTableColumnChanges2.forEach(
    (
      item?: Dynamic,
      index?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      if (item.attrs?.[DIFF_ATTRIBUTE_NAMES.kind] === undefined) {
        nodeChildren(item).forEach(
          (
            cell?: Dynamic,
            index2?: Dynamic,
            ..._extraArguments: unknown[]
          ): undefined => {
            if (cell.type !== `cell` || isDeletedDiffNode(cell)) return;
            let tableCellColumnPositionEntry: Dynamic =
              tableCellColumnPositions2.get(cell) ?? index2;
            let header: boolean = nodeAttribute(cell, `header`) === true;
            let nodeAttribute2: Dynamic = nodeAttribute(
              cell,
              DIFF_ATTRIBUTE_NAMES.before,
            );
            let matchesCondition: boolean =
              typeof nodeAttribute2 == `object` &&
              !!nodeAttribute2 &&
              ownProperty(nodeAttribute2, `header`) === true;
            let body: boolean =
              !header &&
              !matchesCondition &&
              nodeAttribute(cell, DIFF_ATTRIBUTE_NAMES.kind) !== `ins`;
            items2.push({
              r: index,
              c: index2,
              g: tableCellColumnPositionEntry,
              header: header,
              body: body,
            });
            let nodeChEntry: Dynamic = options.nodeCh.get(cell);
            if (nodeChEntry?.kind === `chg`) {
              items.push({
                r: index,
                c: index2,
                g: tableCellColumnPositionEntry,
                ch: nodeChEntry,
                cell: cell,
              });
            }
          },
        );
      }
    },
  );
  for (let groupTableColumnChangesResult of items as Dynamic) {
    let summaryParts: Dynamic =
      groupTableColumnChangesResult.ch.summary.split(`; `);
    if (
      summaryParts.length < 2 ||
      !summaryParts.includes(`Column resized`) ||
      resolveChangeAlias(groupTableColumnChangesResult.ch) !==
        groupTableColumnChangesResult.ch
    )
      continue;
    let filteredSummaryPartsText: Dynamic = summaryParts
      .filter(
        (summaryPart?: Dynamic, ..._extraArguments: unknown[]) =>
          summaryPart !== `Column resized`,
      )
      .join(`; `);
    groupTableColumnChangesResult.ch.summary = filteredSummaryPartsText;
    groupTableColumnChangesResult.cell.attrs = {
      ...groupTableColumnChangesResult.cell.attrs,
      [DIFF_ATTRIBUTE_NAMES.summary]: filteredSummaryPartsText,
    };
  }
  let items3: Dynamic = [];
  let lookup: Dynamic = new (Map as Dynamic)();
  let uniqueItems: Dynamic = new (Set as Dynamic)();
  let split: Dynamic = (
    groupTableColumnChanges3?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    groupTableColumnChanges3
      .split(`; `)
      .find(
        (textPart?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          HEADER_CELL_CHANGE_SUMMARIES.has(textPart),
      ) ?? null;
  let join = (
    axis?: Dynamic,
    options2?: Dynamic,
    context?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    let groupTableColumnChangesResult: Dynamic =
      axis === `row`
        ? (
            groupTableColumnChanges3?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic => groupTableColumnChanges3.r
        : (
            groupTableColumnChanges3?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic => groupTableColumnChanges3.g;
    let lookup2: Dynamic = new (Map as Dynamic)();
    let lookup3: Dynamic = new (Map as Dynamic)();
    let lookup4: Dynamic = new (Map as Dynamic)();
    for (let groupTableColumnChangesResult2 of items2 as Dynamic) {
      lookup2.set(
        groupTableColumnChangesResult(groupTableColumnChangesResult2),
        (lookup2.get(
          groupTableColumnChangesResult(groupTableColumnChangesResult2),
        ) ?? 0) + 1,
      );
      if (groupTableColumnChangesResult2.header) {
        lookup3.set(
          groupTableColumnChangesResult(groupTableColumnChangesResult2),
          (lookup3.get(
            groupTableColumnChangesResult(groupTableColumnChangesResult2),
          ) ?? 0) + 1,
        );
      }
      if (groupTableColumnChangesResult2.body) {
        lookup4.set(
          groupTableColumnChangesResult(groupTableColumnChangesResult2),
          (lookup4.get(
            groupTableColumnChangesResult(groupTableColumnChangesResult2),
          ) ?? 0) + 1,
        );
      }
    }
    let lookup5: Dynamic = new (Map as Dynamic)();
    for (let groupTableColumnChangesResult2 of items as Dynamic) {
      if (uniqueItems.has(groupTableColumnChangesResult2.ch)) continue;
      let textParts: Dynamic = split(groupTableColumnChangesResult2.ch.summary);
      let label: string = `${options2(groupTableColumnChangesResult2)}\n${textParts ?? groupTableColumnChangesResult2.ch.summary}`;
      let lookupEntry: Dynamic = lookup5.get(label);
      if (lookupEntry === undefined) {
        lookup5.set(label, (lookupEntry = []));
      }
      lookupEntry.push(groupTableColumnChangesResult2);
    }
    for (let items4 of lookup5.values() as Dynamic) {
      if (items4.length < 2) continue;
      let textParts: Dynamic = split(items4[0].ch.summary);
      let groupTableColumnChangesResult2: Dynamic =
        groupTableColumnChangesResult(items4[0]);
      let made: boolean = textParts === `Made header cell`;
      let matchesTextParts: Dynamic =
        textParts !== null &&
        items4.every(
          (item2?: Dynamic, ..._extraArguments: unknown[]) =>
            groupTableColumnChangesResult(item2) ===
            groupTableColumnChangesResult2,
        ) &&
        (made
          ? (lookup3.get(groupTableColumnChangesResult2) ?? 0) ===
            lookup2.get(groupTableColumnChangesResult2)
          : (lookup3.get(groupTableColumnChangesResult2) ?? 0) === 0 &&
            (lookup4.get(groupTableColumnChangesResult2) ?? 0) === 0);
      if (context && !matchesTextParts) continue;
      if (!matchesTextParts) {
        let lookup6: Dynamic = new (Map as Dynamic)();
        for (let groupTableColumnChangesResult3 of items4 as Dynamic) {
          let lookupEntry: Dynamic = lookup6.get(
            groupTableColumnChangesResult3.ch.summary,
          );
          if (lookupEntry === undefined) {
            lookup6.set(
              groupTableColumnChangesResult3.ch.summary,
              (lookupEntry = []),
            );
          }
          lookupEntry.push(groupTableColumnChangesResult3);
        }
        for (let items5 of lookup6.values() as Dynamic)
          if (!(items5.length < 2))
            for (let groupTableColumnChangesResult3 of items5 as Dynamic) {
              uniqueItems.add(groupTableColumnChangesResult3.ch);
              if (groupTableColumnChangesResult3.ch !== items5[0].ch) {
                groupTableColumnChangesResult3.ch.alias = items5[0].ch;
              }
            }
        continue;
      }
      let uniqueItems2: Dynamic = new (Set as Dynamic)(
        items4
          .filter(
            (item2?: Dynamic, ..._extraArguments: unknown[]) =>
              item2.ch.summary === textParts,
          )
          .map(
            (filteredItem?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              filteredItem.ch,
          ),
      );
      let ch2: Dynamic =
        items4.find(
          (item2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
            uniqueItems2.has(item2.ch),
        )?.ch ?? createChangeRecord(`chg`, `table`, textParts);
      ch2.summary = headerColumnSummary(textParts, axis);
      let item: Dynamic = items3.find(
        (item2?: Dynamic, ..._extraArguments: unknown[]) =>
          item2.summary === ch2.summary,
      );
      if (item === undefined) {
        items3.push(ch2);
        lookup.set(ch2, {
          made: made,
          axis: axis,
          lines: 1,
          cells: items4.length,
        });
      } else {
        let lookupEntry: Dynamic = lookup.get(item);
        lookupEntry.lines += 1;
        lookupEntry.cells += items4.length;
        ch2.alias = item;
        ch2 = item;
      }
      for (let groupTableColumnChangesResult3 of items4 as Dynamic)
        if (uniqueItems2.has(groupTableColumnChangesResult3.ch)) {
          uniqueItems.add(groupTableColumnChangesResult3.ch);
          if (groupTableColumnChangesResult3.ch !== ch2) {
            groupTableColumnChangesResult3.ch.alias = ch2;
          }
          let { [DIFF_ATTRIBUTE_NAMES.summary]: attrs, ...attrs2 }: Dynamic =
            groupTableColumnChangesResult3.cell.attrs ?? {};
          groupTableColumnChangesResult3.cell.attrs = attrs2;
        } else {
          let filteredSummaryPartsText: Dynamic =
            groupTableColumnChangesResult3.ch.summary
              .split(`; `)
              .filter(
                (summaryPart?: Dynamic, ..._extraArguments: unknown[]) =>
                  summaryPart !== textParts,
              )
              .join(`; `);
          groupTableColumnChangesResult3.ch.summary = filteredSummaryPartsText;
          groupTableColumnChangesResult3.cell.attrs = {
            ...groupTableColumnChangesResult3.cell.attrs,
            [DIFF_ATTRIBUTE_NAMES.summary]: filteredSummaryPartsText,
          };
        }
    }
  };
  join(
    `column`,
    (
      groupTableColumnChanges3?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => groupTableColumnChanges3.g,
    true,
  );
  join(
    `row`,
    (
      groupTableColumnChanges3?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => groupTableColumnChanges3.r,
    true,
  );
  join(
    `column`,
    (
      groupTableColumnChanges3?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => groupTableColumnChanges3.g,
    false,
  );
  join(
    `row`,
    (
      groupTableColumnChanges3?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => groupTableColumnChanges3.r,
    false,
  );
  for (let [
    groupTableColumnChangesResult,
    groupTableColumnChangesResult2,
  ] of lookup as Dynamic)
    if (
      groupTableColumnChangesResult2.lines > 1 &&
      groupTableColumnChangesResult2.cells === items2.length
    ) {
      groupTableColumnChangesResult.summary =
        groupTableColumnChangesResult2.made
          ? `Every cell made a header cell`
          : `Every header cell made a body cell`;
    } else {
      if (groupTableColumnChangesResult2.lines > 1) {
        groupTableColumnChangesResult.summary = `Header ${groupTableColumnChangesResult2.axis}s ${groupTableColumnChangesResult2.made ? `added` : `removed`}`;
      }
    }
  let columnWidthChangeSummary2: Dynamic = columnWidthChangeSummary(
    items,
    groupTableColumnChanges2,
    tableCellColumnPositions2,
  );
  if (columnWidthChangeSummary2 !== null) {
    items3.push(columnWidthChangeSummary2);
  }
  return items3;
}
var visibleNodeText: Dynamic = (
  visibleNodeText2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  visibleNodeText2.attrs?.[DIFF_ATTRIBUTE_NAMES.kind] === `del`
    ? ``
    : visibleNodeText2.type === `text`
      ? (visibleNodeText2.marks ?? []).some(
          (mark?: Dynamic, ..._extraArguments: unknown[]) =>
            mark.type === DIFF_MARK_TYPES.del,
        )
        ? ``
        : (visibleNodeText2.text ?? ``)
      : visibleNodeText2.type === `hardBreak`
        ? ` `
        : nodeChildren(visibleNodeText2)
            .map(visibleNodeText)
            .join(TEXT_BLOCK_NODE_TYPES.has(visibleNodeText2.type) ? `` : ` `);
var isDeletedDiffNode = (
  deletedDiffNode?: Dynamic,
  ..._extraArguments: unknown[]
) => deletedDiffNode.attrs?.[DIFF_ATTRIBUTE_NAMES.kind] === `del`;
var clampColumnSpan: Dynamic = (
  clampColumnSpan2?: Dynamic,
  ..._extraArguments: unknown[]
): number =>
  typeof clampColumnSpan2 == `number` && Number.isFinite(clampColumnSpan2)
    ? Math.min(MAX_DIFF_COLUMN_SPAN, Math.max(1, Math.trunc(clampColumnSpan2)))
    : 1;
function tableCellColumnPositions(
  tableCellColumnPositions2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let metadata: Dynamic = new (WeakMap as Dynamic)();
  let items: Dynamic = [];
  for (let tableCellColumnPositionsResult of tableCellColumnPositions2 as Dynamic) {
    if (isDeletedDiffNode(tableCellColumnPositionsResult)) continue;
    let mappedItems: Dynamic = items.map(
      (item?: Dynamic, ..._extraArguments: unknown[]) => item > 0,
    );
    for (
      items = items.map((item?: Dynamic, ..._extraArguments: unknown[]) =>
        item > 0 ? item - 1 : 0,
      );
      items.length > 0 && !(items[items.length - 1] > 0);

    )
      items.pop();
    let index: number = 0;
    for (let tableCellColumnPositionsResult2 of nodeChildren(
      tableCellColumnPositionsResult,
    ) as Dynamic) {
      if (isDeletedDiffNode(tableCellColumnPositionsResult2)) continue;
      for (; index < 1e3 && mappedItems[index]; ) index++;
      if (index >= 1e3) break;
      metadata.set(tableCellColumnPositionsResult2, index);
      let min: number = Math.min(
        clampColumnSpan(
          nodeAttribute(tableCellColumnPositionsResult2, `colspan`),
        ),
        MAX_DIFF_ROW_SPAN - index,
      );
      let clampColumnSpan2: Dynamic = clampColumnSpan(
        nodeAttribute(tableCellColumnPositionsResult2, `rowspan`),
      );
      for (let index2: number = 0; index2 < min; index2++) {
        mappedItems[index + index2] = true;
        if (clampColumnSpan2 > 1) {
          items[index + index2] = Math.max(
            items[index + index2] ?? 0,
            clampColumnSpan2 - 1,
          );
        }
      }
      index += min;
    }
  }
  return metadata;
}
function columnWidthChangeSummary(
  columnWidthChangeSummary2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let nodeAttribute2: Dynamic = (
    columnWidthChangeSummary3?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let nodeAttribute4: Dynamic = nodeAttribute(
      columnWidthChangeSummary3,
      DIFF_ATTRIBUTE_NAMES.before,
    );
    return typeof nodeAttribute4 == `object` && nodeAttribute4
      ? nodeAttribute4
      : null;
  };
  let filteredColumnWidthChangeSummary: Dynamic =
    columnWidthChangeSummary2.filter(
      (item?: Dynamic, ..._extraArguments: unknown[]): boolean => {
        let nodeAttribute4: Dynamic = nodeAttribute2(item.cell);
        return (
          nodeAttribute4 !== null &&
          Object.hasOwn(nodeAttribute4, `colwidth`) &&
          !Object.hasOwn(nodeAttribute4, `colspan`)
        );
      },
    );
  if (!filteredColumnWidthChangeSummary.length) return null;
  let columnWidthChangeSummaryHandler: Dynamic = (
    items2?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    Array.isArray(items2) &&
    items2.length > 0 &&
    items2.every(
      (item?: Dynamic, ..._extraArguments: unknown[]) =>
        typeof item == `number`,
    )
      ? items2
      : null;
  let columnWidthChangeSummaryHandler2: Dynamic = (
    columnWidthChangeSummary3?: Dynamic,
    options2?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let columnWidthChangeSummaryItem: Dynamic =
      columnWidthChangeSummary3?.[options2];
    return columnWidthChangeSummaryItem === undefined ||
      columnWidthChangeSummaryItem <= 0
      ? null
      : columnWidthChangeSummaryItem;
  };
  let nodeAttribute3 = (
    columnWidthChangeSummary3?: Dynamic,
    ..._extraArguments: unknown[]
  ) => nodeAttribute(columnWidthChangeSummary3, `header`) === true;
  let items: Dynamic = [];
  for (let columnWidthChangeSummaryResult of options as Dynamic) {
    if (isDeletedDiffNode(columnWidthChangeSummaryResult)) continue;
    let filteredNodeChildren: Dynamic = nodeChildren(
      columnWidthChangeSummaryResult,
    ).filter(
      (nodeChildren2?: Dynamic, ..._extraArguments: unknown[]) =>
        !isDeletedDiffNode(nodeChildren2),
    );
    if (
      !(
        filteredNodeChildren.length > 0 &&
        (filteredNodeChildren.every(nodeAttribute3) ||
          filteredNodeChildren.some(
            (
              filteredNodeChildren2?: Dynamic,
              ..._extraArguments: unknown[]
            ): boolean =>
              nodeAttribute3(filteredNodeChildren2) &&
              (context.get(filteredNodeChildren2) ?? 0) > 0,
          ))
      )
    )
      break;
    items.push(filteredNodeChildren);
  }
  let trim: Dynamic = (
    columnWidthChangeSummary3?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let label: string = ``;
    for (let columnWidthChangeSummaryResult of items as Dynamic) {
      let columnWidthChangeSummaryResult2: Dynamic =
        columnWidthChangeSummaryResult.find(
          (item?: Dynamic, ..._extraArguments: unknown[]): boolean => {
            let contextEntry: Dynamic = context.get(item) ?? -1;
            return (
              contextEntry <= columnWidthChangeSummary3 &&
              columnWidthChangeSummary3 <
                contextEntry + clampColumnSpan(nodeAttribute(item, `colspan`))
            );
          },
        );
      if (
        columnWidthChangeSummaryResult2 === undefined ||
        !nodeAttribute3(columnWidthChangeSummaryResult2)
      )
        break;
      if (
        clampColumnSpan(
          nodeAttribute(columnWidthChangeSummaryResult2, `colspan`),
        ) === 1
      ) {
        label = visibleNodeText(columnWidthChangeSummaryResult2)
          .replace(/\s+/g, ` `)
          .trim();
        break;
      }
    }
    return label === ``
      ? `column ${columnWidthChangeSummary3 + 1}`
      : truncateCodePoints(label, 24);
  };
  let context2 = (
    columnWidthChangeSummary3?: Dynamic,
    options2?: Dynamic,
    ..._extraArguments: unknown[]
  ) => {
    let join = (
      columnWidthChangeSummary4?: Dynamic,
      options3?: Dynamic,
      ..._extraArguments: unknown[]
    ) =>
      columnWidthChangeSummary4 === null
        ? `auto`
        : `${columnWidthChangeSummary4.join(`+`)}${options3 ? ` px` : ``}`;
    return columnWidthChangeSummary3 !== null && options2 !== null
      ? `${join(columnWidthChangeSummary3, false)} → ${join(options2, true)}`
      : `${join(columnWidthChangeSummary3, true)} → ${join(options2, true)}`;
  };
  let columnWidthChangeSummaryHandler3 = (
    columnWidthChangeSummary3?: Dynamic,
    options2?: Dynamic,
    ..._extraArguments: unknown[]
  ) =>
    columnWidthChangeSummary3 !== null && options2 !== null
      ? `${columnWidthChangeSummary3} → ${options2} px`
      : `${columnWidthChangeSummary3 === null ? `auto` : `${columnWidthChangeSummary3} px`} → ${options2 === null ? `auto` : `${options2} px`}`;
  let lookup: Dynamic = new (Map as Dynamic)();
  for (let columnWidthChangeSummaryResult of filteredColumnWidthChangeSummary as Dynamic) {
    let contextEntry: Dynamic = context.get(
      columnWidthChangeSummaryResult.cell,
    );
    if (contextEntry === undefined) continue;
    let nodeAttribute4: Dynamic = nodeAttribute(
      columnWidthChangeSummaryResult.cell,
      DIFF_ATTRIBUTE_NAMES.before,
    );
    let columnWidthChangeSummaryHandler4: Dynamic =
      columnWidthChangeSummaryHandler(
        typeof nodeAttribute4 == `object` && nodeAttribute4
          ? ownProperty(nodeAttribute4, `colwidth`)
          : undefined,
      );
    let columnWidthChangeSummaryHandler5: Dynamic =
      columnWidthChangeSummaryHandler(
        nodeAttribute(columnWidthChangeSummaryResult.cell, `colwidth`),
      );
    let min: number = Math.min(
      clampColumnSpan(
        nodeAttribute(columnWidthChangeSummaryResult.cell, `colspan`),
      ),
      MAX_DIFF_ROW_SPAN - contextEntry,
    );
    let enabled: boolean = false;
    for (let index: number = 0; index < min; index++) {
      let [items2, setItems]: Dynamic = [
        columnWidthChangeSummaryHandler2(
          columnWidthChangeSummaryHandler4,
          index,
        ),
        columnWidthChangeSummaryHandler2(
          columnWidthChangeSummaryHandler5,
          index,
        ),
      ];
      if (items2 !== setItems) {
        enabled = true;
        if (!lookup.has(contextEntry + index)) {
          lookup.set(
            contextEntry + index,
            `${trim(contextEntry + index)} ${columnWidthChangeSummaryHandler3(items2, setItems)}`,
          );
        }
      }
    }
    if (!enabled && !lookup.has(contextEntry)) {
      lookup.set(
        contextEntry,
        `${trim(contextEntry)} ${context2(columnWidthChangeSummaryHandler4, columnWidthChangeSummaryHandler5)}`,
      );
    }
  }
  let filteredFilteredColumnWidthChangeSummary: Dynamic =
    filteredColumnWidthChangeSummary.filter(
      (
        filteredColumnWidthChangeSummary2?: Dynamic,
        ..._extraArguments: unknown[]
      ) =>
        resolveChangeAlias(filteredColumnWidthChangeSummary2.ch).summary ===
        `Column resized`,
    );
  let changeAlias: Dynamic =
    filteredFilteredColumnWidthChangeSummary.length > 0
      ? resolveChangeAlias(filteredFilteredColumnWidthChangeSummary[0].ch)
      : createChangeRecord(`chg`, `table`, ``);
  changeAlias.summary =
    lookup.size === 0
      ? `Column resized`
      : `${lookup.size > 1 ? `Columns resized` : `Column resized`}: ${[
          ...lookup.keys(),
        ]
          .toSorted(
            (
              item?: Dynamic,
              item2?: Dynamic,
              ..._extraArguments: unknown[]
            ): number => item - item2,
          )
          .map(
            (toSorted?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              lookup.get(toSorted),
          )
          .join(`, `)}`;
  for (let columnWidthChangeSummaryResult of filteredFilteredColumnWidthChangeSummary as Dynamic) {
    let changeAlias2: Dynamic = resolveChangeAlias(
      columnWidthChangeSummaryResult.ch,
    );
    if (changeAlias2 !== changeAlias) {
      changeAlias2.alias = changeAlias;
    }
    let { [DIFF_ATTRIBUTE_NAMES.summary]: attrs, ...attrs2 }: Dynamic =
      columnWidthChangeSummaryResult.cell.attrs ?? {};
    columnWidthChangeSummaryResult.cell.attrs = attrs2;
  }
  return changeAlias;
}
var plainTextToken: Dynamic = (
  text?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => ({
  text: text,
  segs: [
    {
      text: text,
      marks: [],
    },
  ],
  node: null,
  key: `t${text}`,
  ident: null,
});
function inlineAtomIdentity(
  inline?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) {
  switch (inline.type) {
    case `mention`:
      return typeof nodeAttribute(inline, `principal`) == `string`
        ? `mention:person`
        : typeof nodeAttribute(inline, `ref`) == `string`
          ? `mention:ref`
          : `mention`;
    case `date`:
      return `date`;
    case `dropdown`:
      return `dropdown:${stableStringify(nodeAttribute(inline, `enum`) ?? null)}`;
    case `media`: {
      let nodeAttribute2: Dynamic = nodeAttribute(inline, `blob`);
      if (typeof nodeAttribute2 == `string`) return `media:${nodeAttribute2}`;
      break;
    }
    case `hardBreak`:
      return `hardBreak`;
    default:
      break;
  }
  return `x:${nodeContentKey(inline, options)}`;
}
function inlineNodeTokens(
  items?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items2: Dynamic = [];
  let index: number = 0;
  for (; index < items.length; ) {
    let node: Dynamic = items[index];
    if (node.type !== `text`) {
      items2.push({
        text: null,
        segs: [],
        node: node,
        key: `a${nodeContentKey(node, options)}`,
        ident: inlineAtomIdentity(node, options),
      });
      index++;
      continue;
    }
    let items3: Dynamic = [];
    let label: string = ``;
    for (; index < items.length && items[index].type === `text`; index++) {
      let itemItem: Dynamic = items[index];
      let text: Dynamic = typeof itemItem.text == `string` ? itemItem.text : ``;
      items3.push({
        start: label.length,
        end: label.length + text.length,
        marks: itemItem.marks ?? [],
      });
      label += text;
    }
    let index2: number = 0;
    let count: number = 0;
    for (let text of tokenizeWords(label) as Dynamic) {
      let total: Dynamic = count + text.length;
      for (; items3[index2].end <= count; ) index2++;
      let segs: Dynamic = [];
      for (
        let index3: Dynamic = index2;
        index3 < items3.length && items3[index3].start < total;
        index3++
      ) {
        let itemItem: Dynamic = items3[index3];
        let max: number = Math.max(count, itemItem.start);
        let min: number = Math.min(total, itemItem.end);
        if (min > max) {
          segs.push({
            text: label.slice(max, min),
            marks: itemItem.marks,
          });
        }
      }
      items2.push({
        text: text,
        segs: segs,
        node: null,
        key: `t${text}`,
        ident: null,
      });
      count = total;
    }
  }
  return items2;
}
function alignInlineTokens(
  items?: Dynamic,
  items2?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let lookup: Dynamic = new (Map as Dynamic)();
  let items3: Dynamic = [];
  let items4: Dynamic = [];
  items.forEach(
    (
      item?: Dynamic,
      index3?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      if (!isWhitespaceToken(item)) {
        items3.push(index3);
      }
    },
  );
  items2.forEach(
    (
      item?: Dynamic,
      index3?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      if (!isWhitespaceToken(item)) {
        items4.push(index3);
      }
    },
  );
  let budgetedSequenceMatches2: Dynamic = budgetedSequenceMatches(
    Int32Array.from(
      items3,
      (alignInline?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        internKey(lookup, items[alignInline].key),
    ),
    Int32Array.from(
      items4,
      (alignInline?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        internKey(lookup, items2[alignInline].key),
    ),
    context,
  );
  let items5: Dynamic = [];
  let index: number = 0;
  let index2: number = 0;
  let alignInlineTokensHandler = (
    alignInline?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (
      index < alignInline &&
      index2 < options &&
      alignInline - index + (options - index2) <= MAX_NODE_CONTENT_WEIGHT
    ) {
      let index3: Dynamic = index;
      let index4: Dynamic = index2;
      let budgetedSequenceMatches3: Dynamic = budgetedSequenceMatches(
        Int32Array.from(
          {
            length: alignInline - index3,
          },
          (
            alignInline2?: unknown,
            options2?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic => internKey(lookup, items[index3 + options2].key),
        ),
        Int32Array.from(
          {
            length: options - index4,
          },
          (
            alignInline2?: unknown,
            options2?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic => internKey(lookup, items2[index4 + options2].key),
        ),
        context,
      );
      for (
        let count: number = 0;
        count < budgetedSequenceMatches3.length;
        count += 2
      ) {
        let total: Dynamic = index3 + budgetedSequenceMatches3[count];
        let total2: Dynamic = index4 + budgetedSequenceMatches3[count + 1];
        for (; index < total; )
          items5.push({
            k: `del`,
            a: items[index++],
          });
        for (; index2 < total2; )
          items5.push({
            k: `ins`,
            b: items2[index2++],
          });
        items5.push({
          k: `keep`,
          a: items[index++],
          b: items2[index2++],
        });
      }
    }
    for (; index < alignInline; )
      items5.push({
        k: `del`,
        a: items[index++],
      });
    for (; index2 < options; )
      items5.push({
        k: `ins`,
        b: items2[index2++],
      });
  };
  for (
    let count: number = 0;
    count < budgetedSequenceMatches2.length;
    count += 2
  ) {
    alignInlineTokensHandler(
      items3[budgetedSequenceMatches2[count]],
      items4[budgetedSequenceMatches2[count + 1]],
    );
    items5.push({
      k: `keep`,
      a: items[index++],
      b: items2[index2++],
    });
  }
  alignInlineTokensHandler(items.length, items2.length);
  return alignChangedTokenGroups(
    expandChangedTokenEdges(expandChangedWhitespace(pairChangedAtoms(items5))),
  );
}
function pairChangedAtoms(
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items2: Dynamic = [];
  let index: number = 0;
  for (; index < items.length; ) {
    if (items[index].k === `keep`) {
      items2.push(items[index++]);
      continue;
    }
    let index2: Dynamic = index;
    for (; index2 < items.length && items[index2].k !== `keep`; ) index2++;
    let itemsSlice: Dynamic = items.slice(index, index2);
    index = index2;
    let flatMap: Dynamic = itemsSlice.flatMap(
      (itemsSlice2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        itemsSlice2.k === `del` ? [itemsSlice2] : [],
    );
    let uniqueItems: Dynamic = new (Set as Dynamic)();
    let lookup: Dynamic = new (Map as Dynamic)();
    for (let pairChangedAtomsResult of itemsSlice as Dynamic) {
      if (
        pairChangedAtomsResult.k !== `ins` ||
        pairChangedAtomsResult.b.ident === null
      )
        continue;
      let flatMapIndex: Dynamic = flatMap.findIndex(
        (
          flatMap2?: Dynamic,
          index4?: Dynamic,
          ..._extraArguments: unknown[]
        ): boolean =>
          !uniqueItems.has(index4) &&
          flatMap2.a.ident === pairChangedAtomsResult.b.ident,
      );
      if (!(flatMapIndex < 0)) {
        uniqueItems.add(flatMapIndex);
        lookup.set(pairChangedAtomsResult, flatMapIndex);
      }
    }
    if (lookup.size === 0) {
      for (let pairChangedAtomsResult of itemsSlice as Dynamic)
        items2.push(pairChangedAtomsResult);
      continue;
    }
    let index3: number = 0;
    let items3: Dynamic = [];
    let pairChangedAtomsHandler = (
      pairChanged?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      for (; index3 < pairChanged; index3++)
        if (!uniqueItems.has(index3)) {
          items2.push(flatMap[index3]);
        }
      for (let pairChangedAtomsResult of items3 as Dynamic)
        items2.push(pairChangedAtomsResult);
      items3 = [];
    };
    for (let pairChangedAtomsResult of itemsSlice as Dynamic) {
      if (pairChangedAtomsResult.k !== `ins`) continue;
      let lookupEntry: Dynamic = lookup.get(pairChangedAtomsResult);
      if (lookupEntry === undefined) {
        items3.push(pairChangedAtomsResult);
      } else {
        pairChangedAtomsHandler(lookupEntry);
        items2.push({
          k: `keep`,
          a: flatMap[lookupEntry].a,
          b: pairChangedAtomsResult.b,
        });
      }
    }
    pairChangedAtomsHandler(flatMap.length);
  }
  return items2;
}
function expandChangedWhitespace(
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items2: Dynamic = [];
  for (let index: number = 0; index < items.length; index++) {
    let itemItem: Dynamic = items[index];
    if (
      itemItem.k === `keep` &&
      isWhitespaceToken(itemItem.b) &&
      index > 0 &&
      index < items.length - 1 &&
      items[index - 1].k !== `keep` &&
      items[index + 1].k !== `keep` &&
      itemItem.k === `keep`
    ) {
      items2.push(
        {
          k: `del`,
          a: itemItem.a,
        },
        {
          k: `ins`,
          b: itemItem.b,
        },
      );
    } else {
      items2.push(itemItem);
    }
  }
  return items2;
}
function uniformTokenMarksKey(
  uniform?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let uniqueItems: Dynamic = new (Set as Dynamic)(
    uniform.segs.map(
      (seg?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        marksKey(seg.marks),
    ),
  );
  return uniqueItems.size === 1 ? Array.from<Dynamic>(uniqueItems)[0] : null;
}
function expandChangedTokenEdges(
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let readA: Dynamic = (
    expandChanged?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    for (
      let expandChanged2: Dynamic = expandChanged;
      expandChanged2 >= 0 &&
      expandChanged2 < items.length &&
      items[expandChanged2].k !== `keep`;
      expandChanged2 += options
    ) {
      let itemItem: Dynamic = items[expandChanged2];
      if (
        itemItem.k === `del` &&
        itemItem.a.text !== null &&
        isContentToken(itemItem.a)
      )
        return itemItem.a;
    }
  };
  let items2: Dynamic = [];
  let index: number = 0;
  for (; index < items.length; ) {
    if (items[index].k !== `keep`) {
      items2.push(items[index++]);
      continue;
    }
    let index2: Dynamic = index;
    for (; index2 < items.length && items[index2].k === `keep`; ) index2++;
    let itemsSlice: Dynamic = items.slice(index, index2);
    let matchesIndex: boolean = index > 0 && index2 < items.length;
    let expandChangedTokenEdgesResult: Dynamic;
    let index3: number = 0;
    for (let expandChangedTokenEdgesResult2 of itemsSlice as Dynamic) {
      if (!matchesIndex) break;
      if (
        expandChangedTokenEdgesResult2.k !== `keep` ||
        expandChangedTokenEdgesResult2.b.text === null
      )
        matchesIndex = false;
      else if (isContentToken(expandChangedTokenEdgesResult2.b)) {
        index3++;
        let uniformTokenMarksKey2: Dynamic = uniformTokenMarksKey(
          expandChangedTokenEdgesResult2.a,
        );
        if (expandChangedTokenEdgesResult === undefined) {
          expandChangedTokenEdgesResult = uniformTokenMarksKey2;
        }
        matchesIndex =
          uniformTokenMarksKey2 !== null &&
          uniformTokenMarksKey2 !== `` &&
          uniformTokenMarksKey2 === expandChangedTokenEdgesResult &&
          alignTokenMarkSegments(
            expandChangedTokenEdgesResult2.a,
            expandChangedTokenEdgesResult2.b,
          ).some(
            (alignTokenMarkSegment?: Dynamic, ..._extraArguments: unknown[]) =>
              alignTokenMarkSegment.delta !== null,
          );
      }
    }
    if (matchesIndex && index3 > 0 && index3 <= 2) {
      let a2: Dynamic = readA(index - 1, -1);
      let a3: Dynamic = readA(index2, 1);
      matchesIndex =
        a2 !== undefined &&
        a3 !== undefined &&
        uniformTokenMarksKey(a2) === expandChangedTokenEdgesResult &&
        uniformTokenMarksKey(a3) === expandChangedTokenEdgesResult;
    } else matchesIndex = false;
    for (let expandChangedTokenEdgesResult2 of itemsSlice as Dynamic)
      if (matchesIndex && expandChangedTokenEdgesResult2.k === `keep`) {
        items2.push(
          {
            k: `del`,
            a: expandChangedTokenEdgesResult2.a,
          },
          {
            k: `ins`,
            b: expandChangedTokenEdgesResult2.b,
          },
        );
      } else {
        items2.push(expandChangedTokenEdgesResult2);
      }
    index = index2;
  }
  return items2;
}
function sliceInlineToken(
  sliceInline?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let text: Dynamic = (sliceInline.text ?? ``).slice(options, context);
  let segs: Dynamic = [];
  let count: number = 0;
  for (let sliceInlineTokenResult of sliceInline.segs as Dynamic) {
    let max: number = Math.max(options, count);
    let min: number = Math.min(
      context,
      count + sliceInlineTokenResult.text.length,
    );
    if (min > max) {
      segs.push({
        text: sliceInlineTokenResult.text.slice(max - count, min - count),
        marks: sliceInlineTokenResult.marks,
      });
    }
    count += sliceInlineTokenResult.text.length;
  }
  return {
    text: text,
    segs: segs,
    node: null,
    key: `t${text}`,
    ident: null,
  };
}
function pairTokenGraphemes(
  items?: Dynamic,
  items2?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items3: Dynamic = [];
  let index: number = 0;
  let index2: number = 0;
  let count: number = 0;
  let count2: number = 0;
  let count3: number = 0;
  for (; index < items.length || index2 < items2.length; ) {
    let itemItem: Dynamic = items[index];
    let itemItem2: Dynamic = items2[index2];
    if (itemItem !== undefined && itemItem.text === null) {
      items3.push({
        k: `del`,
        a: itemItem,
      });
      index++;
    } else if (itemItem2 !== undefined && itemItem2.text === null) {
      items3.push({
        k: `ins`,
        b: itemItem2,
      });
      index2++;
    } else if (
      count3 < context &&
      itemItem !== undefined &&
      itemItem2 !== undefined
    ) {
      let textCount: Dynamic = (itemItem.text ?? ``).length;
      let textCount2: Dynamic = (itemItem2.text ?? ``).length;
      let min: number = Math.min(
        textCount - count,
        textCount2 - count2,
        context - count3,
      );
      items3.push({
        k: `keep`,
        a: sliceInlineToken(itemItem, count, count + min),
        b: sliceInlineToken(itemItem2, count2, count2 + min),
      });
      count3 += min;
      count += min;
      count2 += min;
      if (count === textCount) {
        [index, count] = [index + 1, 0];
      }
      if (count2 === textCount2) {
        [index2, count2] = [index2 + 1, 0];
      }
    } else if (itemItem === undefined) {
      if (itemItem2 !== undefined) {
        items3.push({
          k: `ins`,
          b: count2
            ? sliceInlineToken(itemItem2, count2, (itemItem2.text ?? ``).length)
            : itemItem2,
        });
        [index2, count2] = [index2 + 1, 0];
      }
    } else {
      items3.push({
        k: `del`,
        a: count
          ? sliceInlineToken(itemItem, count, (itemItem.text ?? ``).length)
          : itemItem,
      });
      [index, count] = [index + 1, 0];
    }
  }
  return items3;
}
function alignChangedTokenGroups(
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items2: Dynamic = [];
  let index: number = 0;
  for (; index < items.length; ) {
    if (items[index].k === `keep`) {
      items2.push(items[index++]);
      continue;
    }
    let index2: Dynamic = index;
    for (; index2 < items.length && items[index2].k !== `keep`; ) index2++;
    let itemsSlice: Dynamic = items.slice(index, index2);
    index = index2;
    let items3: Dynamic = [];
    let items4: Dynamic = [];
    for (let alignChangedTokenGroupsResult2 of itemsSlice as Dynamic)
      if (alignChangedTokenGroupsResult2.k === `del`) {
        items3.push(alignChangedTokenGroupsResult2.a);
      } else {
        if (alignChangedTokenGroupsResult2.k === `ins`) {
          items4.push(alignChangedTokenGroupsResult2.b);
        }
      }
    let mappedItemsText: Dynamic = items3
      .map(
        (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          item.text ?? ``,
      )
      .join(``);
    let mappedItemsText2: Dynamic = items4
      .map(
        (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          item.text ?? ``,
      )
      .join(``);
    let some: Dynamic =
      items3.some(
        (item?: Dynamic, ..._extraArguments: unknown[]) => item.text === null,
      ) ||
      items4.some(
        (item?: Dynamic, ..._extraArguments: unknown[]) => item.text === null,
      );
    let alignChangedTokenGroupsResult: number = -1;
    if (some && mappedItemsText !== `` && mappedItemsText === mappedItemsText2)
      alignChangedTokenGroupsResult = mappedItemsText.length;
    else if (
      !some &&
      WHITESPACE_ONLY_PATTERN.test(mappedItemsText) &&
      WHITESPACE_ONLY_PATTERN.test(mappedItemsText2)
    ) {
      let index3: number = 0;
      for (
        ;
        index3 < mappedItemsText.length &&
        index3 < mappedItemsText2.length &&
        mappedItemsText[index3] === mappedItemsText2[index3];

      )
        index3++;
      if (index3 > 0) {
        alignChangedTokenGroupsResult = index3;
      }
    }
    for (let alignChangedTokenGroupsResult2 of (alignChangedTokenGroupsResult <
    0
      ? itemsSlice
      : pairTokenGraphemes(
          items3,
          items4,
          alignChangedTokenGroupsResult,
        )) as Dynamic)
      items2.push(alignChangedTokenGroupsResult2);
  }
  return items2;
}
function deferInsertionsUntilDeletionFlush(
  deferInsertionsUntilDeletionFlush2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items: Dynamic = [];
  let items2: Dynamic = [];
  let deferInsertionsUntilDeletionFlushHandler = (
    ..._extraArguments: unknown[]
  ): undefined => {
    for (let deferInsertionsUntilDeletionFlushResult of items2 as Dynamic)
      items.push(deferInsertionsUntilDeletionFlushResult);
    items2 = [];
  };
  for (let deferInsertionsUntilDeletionFlushResult of deferInsertionsUntilDeletionFlush2 as Dynamic)
    if (deferInsertionsUntilDeletionFlushResult.k === `ins`) {
      items2.push(deferInsertionsUntilDeletionFlushResult);
    } else {
      if (deferInsertionsUntilDeletionFlushResult.k === `keep`) {
        deferInsertionsUntilDeletionFlushHandler();
      }
      items.push(deferInsertionsUntilDeletionFlushResult);
    }
  deferInsertionsUntilDeletionFlushHandler();
  return items;
}
function diffTextBlockTokens(
  diffTextBlock?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return options.type === `codeBlock`
    ? deferInsertionsUntilDeletionFlush(
        diffCodeBlockTokens(diffTextBlock, options, context),
      )
    : deferInsertionsUntilDeletionFlush(
        alignInlineTokens(
          inlineNodeTokens(nodeChildren(diffTextBlock), context),
          inlineNodeTokens(nodeChildren(options), context),
          context,
        ),
      );
}
function diffTextBlockTokensWithRuns(
  diffTextBlock?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let nodeChildren2: Dynamic = nodeChildren(diffTextBlock);
  let nodeChildren3: Dynamic = nodeChildren(options);
  if (
    nodeChildren2.length === nodeChildren3.length &&
    nodeChildren2.every(
      (
        nodeChildren4?: Dynamic,
        index?: Dynamic,
        ..._extraArguments: unknown[]
      ) =>
        nodeContentKey(nodeChildren4, context) ===
        nodeContentKey(nodeChildren3[index], context),
    )
  ) {
    let ops: Dynamic = changedInlineRunMetadata(
      diffTextBlock,
      options,
      context,
    );
    return ops === null
      ? null
      : {
          ops: ops,
          runs: true,
        };
  }
  let alignInlineRunTokens2: Dynamic = alignInlineRunTokens(
    diffTextBlock,
    options,
    context,
  );
  return alignInlineRunTokens2 === null
    ? {
        ops: diffTextBlockTokens(diffTextBlock, options, context),
        runs: false,
      }
    : {
        ops: deferInsertionsUntilDeletionFlush(alignInlineRunTokens2),
        runs: true,
      };
}
function changedInlineRunMetadata(
  changedInlineRunMetadata2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (
    !nodeChildren(options).some(
      (nodeChildren2?: Dynamic, ..._extraArguments: unknown[]) =>
        nodeChildren2.type !== `text`,
    )
  )
    return null;
  let nodeBlockId2: Dynamic = nodeBlockId(changedInlineRunMetadata2);
  let nodeBlockId3: Dynamic = nodeBlockId(options);
  let prevRunEntry: Dynamic =
    nodeBlockId2 === null ? undefined : context.prevRuns.get(nodeBlockId2);
  let nextRunEntry: Dynamic =
    nodeBlockId3 === null ? undefined : context.nextRuns.get(nodeBlockId3);
  if (prevRunEntry === undefined || nextRunEntry === undefined) return null;
  let inlineTokensFromRuns2: Dynamic = inlineTokensFromRuns(
    nodeChildren(changedInlineRunMetadata2),
    prevRunEntry,
    context,
  );
  let inlineTokensFromRuns3: Dynamic = inlineTokensFromRuns(
    nodeChildren(options),
    nextRunEntry,
    context,
  );
  if (
    inlineTokensFromRuns2 === null ||
    inlineTokensFromRuns3 === null ||
    inlineTokensFromRuns2.length !== inlineTokensFromRuns3.length
  )
    return null;
  let items: Dynamic = [];
  let enabled: boolean = false;
  inlineTokensFromRuns2.forEach(
    (
      inlineTokensFromRun?: Dynamic,
      index?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      let inlineTokensFromRunItem: Dynamic = inlineTokensFromRuns3[index];
      if (
        inlineTokensFromRun.tok.text === null &&
        inlineTokensFromRunItem.tok.text === null &&
        inlineTokensFromRun.id !== inlineTokensFromRunItem.id
      ) {
        items.push(
          {
            k: `del`,
            a: inlineTokensFromRun.tok,
          },
          {
            k: `ins`,
            b: inlineTokensFromRunItem.tok,
          },
        );
        enabled = true;
      } else {
        items.push({
          k: `keep`,
          a: inlineTokensFromRun.tok,
          b: inlineTokensFromRunItem.tok,
        });
      }
    },
  );
  return enabled ? items : null;
}
function hasChangedInlineRuns(
  changedInlineRuns?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (context.prevRuns.size === 0 || context.nextRuns.size === 0) return false;
  if (TEXT_BLOCK_NODE_TYPES.has(options.type))
    return (
      changedInlineRunMetadata(changedInlineRuns, options, context) !== null
    );
  let nodeChildren2: Dynamic = nodeChildren(changedInlineRuns);
  let nodeChildren3: Dynamic = nodeChildren(options);
  return (
    nodeChildren2.length === nodeChildren3.length &&
    nodeChildren2.some(
      (
        nodeChildren4?: Dynamic,
        index?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic =>
        hasChangedInlineRuns(nodeChildren4, nodeChildren3[index], context),
    )
  );
}
function isSubstantialInlineReplacement(
  substantialInlineReplacement?: Dynamic,
  ..._extraArguments: unknown[]
): boolean {
  let index: number = 0;
  let index2: number = 0;
  let enabled: boolean = false;
  let enabled2: boolean = false;
  let index3: number = 0;
  let index4: number = 0;
  for (let isSubstantialInlineReplacementResult of substantialInlineReplacement as Dynamic)
    if (
      isContentToken(
        isSubstantialInlineReplacementResult.k === `del`
          ? isSubstantialInlineReplacementResult.a
          : isSubstantialInlineReplacementResult.b,
      )
    ) {
      if (isSubstantialInlineReplacementResult.k !== `ins`) {
        index3++;
      }
      if (isSubstantialInlineReplacementResult.k !== `del`) {
        index4++;
      }
      if (isSubstantialInlineReplacementResult.k === `keep`) {
        index2 += 2;
      } else {
        index++;
        index2++;
        if (isSubstantialInlineReplacementResult.k === `del`) {
          enabled = true;
        } else {
          enabled2 = true;
        }
      }
    }
  return (
    enabled &&
    enabled2 &&
    index3 >= MIN_CHANGED_WORDS &&
    index4 >= MIN_CHANGED_WORDS &&
    index2 > 0 &&
    index / index2 > REPLACEMENT_CHANGE_RATIO
  );
}
function inlineTokensFromRuns(
  inline?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (options.opaque || !Array.isArray(options.runs)) return null;
  let items: Dynamic = [];
  for (let inlineTokensFromRunsResult of options.runs as Dynamic) {
    if (typeof inlineTokensFromRunsResult?.id != `string`) return null;
    let lastIndexOf: Dynamic = inlineTokensFromRunsResult.id.lastIndexOf(`.`);
    let number: number = Number(
      inlineTokensFromRunsResult.id.slice(lastIndexOf + 1),
    );
    if (
      lastIndexOf <= 0 ||
      !Number.isInteger(number) ||
      !(inlineTokensFromRunsResult.len >= 0)
    )
      return null;
    let idSlice: Dynamic = inlineTokensFromRunsResult.id.slice(0, lastIndexOf);
    for (
      let index: number = 0;
      index < inlineTokensFromRunsResult.len;
      index++
    )
      items.push(`${idSlice}.${number + index}`);
  }
  let items2: Dynamic = [];
  let count: number = 0;
  let join: Dynamic = (
    inline2?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    if (count + inline2 > items.length) return null;
    let itemsSliceText: Dynamic = items.slice(count, count + inline2).join(`+`);
    count += inline2;
    return itemsSliceText;
  };
  for (let node of inline as Dynamic)
    if (node.type === `text`) {
      let marks: Dynamic = node.marks ?? [];
      for (let text of tokenizeGraphemes(
        typeof node.text == `string` ? node.text : ``,
      ) as Dynamic) {
        let contentText: Dynamic = join([...text].length);
        if (contentText === null) return null;
        items2.push({
          id: contentText,
          tok: {
            text: text,
            segs: [
              {
                text: text,
                marks: marks,
              },
            ],
            node: null,
            key: `t${text}`,
            ident: null,
          },
        });
      }
    } else {
      let contentText: Dynamic = join(1);
      if (contentText === null) return null;
      items2.push({
        id: contentText,
        tok: {
          text: null,
          segs: [],
          node: node,
          key: `a${nodeContentKey(node, context)}`,
          ident: inlineAtomIdentity(node, context),
        },
      });
    }
  return count === items.length ? items2 : null;
}
function alignInlineRunTokens(
  alignInlineRun?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let nodeBlockId2: Dynamic = nodeBlockId(alignInlineRun);
  let nodeBlockId3: Dynamic = nodeBlockId(options);
  let prevRunEntry: Dynamic =
    nodeBlockId2 === null ? undefined : context.prevRuns.get(nodeBlockId2);
  let nextRunEntry: Dynamic =
    nodeBlockId3 === null ? undefined : context.nextRuns.get(nodeBlockId3);
  if (prevRunEntry === undefined || nextRunEntry === undefined) return null;
  let inlineTokensFromRuns2: Dynamic = inlineTokensFromRuns(
    nodeChildren(alignInlineRun),
    prevRunEntry,
    context,
  );
  let inlineTokensFromRuns3: Dynamic = inlineTokensFromRuns(
    nodeChildren(options),
    nextRunEntry,
    context,
  );
  if (inlineTokensFromRuns2 === null || inlineTokensFromRuns3 === null)
    return null;
  let lookup: Dynamic = new (Map as Dynamic)();
  inlineTokensFromRuns3.forEach(
    (
      inlineTokensFromRun?: Dynamic,
      index3?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => lookup.set(inlineTokensFromRun.id, index3),
  );
  if (
    lookup.size !== inlineTokensFromRuns3.length ||
    new (Set as Dynamic)(
      inlineTokensFromRuns2.map(
        (
          inlineTokensFromRun?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic => inlineTokensFromRun.id,
      ),
    ).size !== inlineTokensFromRuns2.length
  )
    return null;
  let items: Dynamic = [];
  let index: number = 0;
  let index2: number = 0;
  for (let alignInlineRunTokensResult of inlineTokensFromRuns2 as Dynamic) {
    let lookupEntry: Dynamic = lookup.get(alignInlineRunTokensResult.id);
    if (lookupEntry === undefined) {
      items.push({
        k: `del`,
        a: alignInlineRunTokensResult.tok,
      });
      continue;
    }
    if (lookupEntry < index) return null;
    for (; index < lookupEntry; )
      items.push({
        k: `ins`,
        b: inlineTokensFromRuns3[index++].tok,
      });
    let tok: Dynamic = inlineTokensFromRuns3[index++].tok;
    if (
      !(alignInlineRunTokensResult.tok.text === null
        ? tok.text === null &&
          alignInlineRunTokensResult.tok.node.type === tok.node.type
        : alignInlineRunTokensResult.tok.text === tok.text)
    )
      return null;
    items.push({
      k: `keep`,
      a: alignInlineRunTokensResult.tok,
      b: tok,
    });
    if (isContentToken(tok)) {
      index2++;
    }
  }
  for (; index < inlineTokensFromRuns3.length; )
    items.push({
      k: `ins`,
      b: inlineTokensFromRuns3[index++].tok,
    });
  let total: Dynamic =
    inlineTokensFromRuns2.filter(
      (inlineTokensFromRun?: Dynamic, ..._extraArguments: unknown[]): boolean =>
        isContentToken(inlineTokensFromRun.tok),
    ).length +
    inlineTokensFromRuns3.filter(
      (inlineTokensFromRun?: Dynamic, ..._extraArguments: unknown[]): boolean =>
        isContentToken(inlineTokensFromRun.tok),
    ).length;
  return total > 0 && (2 * index2) / total < MIN_TOKEN_PAIR_SIMILARITY
    ? null
    : groupNumericTokenChanges(items);
}
var NUMERIC_TOKEN_PATTERN: Dynamic = /^[\p{N}%]$/u;
var NUMERIC_PUNCTUATION_PATTERN: Dynamic = /^[.,:]$/;
function groupNumericTokenChanges(
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let groupNumericTokenChangesHandler: Dynamic = (
    groupNumeric?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    groupNumeric === undefined
      ? null
      : (groupNumeric.k === `del` ? groupNumeric.a : groupNumeric.b).text;
  let test: Dynamic = (
    groupNumeric?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let groupNumericTokenChangesHandler2: Dynamic =
      groupNumericTokenChangesHandler(items[groupNumeric]);
    return groupNumericTokenChangesHandler2 === null
      ? false
      : NUMERIC_TOKEN_PATTERN.test(groupNumericTokenChangesHandler2) ||
          (NUMERIC_PUNCTUATION_PATTERN.test(groupNumericTokenChangesHandler2) &&
            NUMERIC_TOKEN_PATTERN.test(
              groupNumericTokenChangesHandler(items[groupNumeric + 1]) ?? ``,
            ));
  };
  let items2: Dynamic = [];
  let index: number = 0;
  for (; index < items.length; ) {
    if (
      !NUMERIC_TOKEN_PATTERN.test(
        groupNumericTokenChangesHandler(items[index]) ?? ``,
      )
    ) {
      items2.push(items[index++]);
      continue;
    }
    let index2: Dynamic = index;
    for (; index2 < items.length && test(index2); ) index2++;
    let itemsSlice: Dynamic = items.slice(index, index2);
    index = index2;
    let some: Dynamic = itemsSlice.some(
      (itemsSlice2?: Dynamic, ..._extraArguments: unknown[]) =>
        itemsSlice2.k !== `keep`,
    );
    for (let groupNumericTokenChangesResult of itemsSlice as Dynamic)
      if (some && groupNumericTokenChangesResult.k === `keep`) {
        items2.push(
          {
            k: `del`,
            a: groupNumericTokenChangesResult.a,
          },
          {
            k: `ins`,
            b: groupNumericTokenChangesResult.b,
          },
        );
      } else {
        items2.push(groupNumericTokenChangesResult);
      }
  }
  return items2;
}
var splitLinesKeepingEndings: Dynamic = (
  splitLinesKeepingEndings2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  splitLinesKeepingEndings2 === ``
    ? []
    : splitLinesKeepingEndings2.split(/(?<=\n)/);
function diffCodeBlockTokens(
  diffCodeBlock?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let splitLinesKeepingEndings2: Dynamic = splitLinesKeepingEndings(
    textBlockText(diffCodeBlock),
  );
  let splitLinesKeepingEndings3: Dynamic = splitLinesKeepingEndings(
    textBlockText(options),
  );
  let lookup: Dynamic = new (Map as Dynamic)();
  let budgetedSequenceMatches2: Dynamic = budgetedSequenceMatches(
    Int32Array.from(
      splitLinesKeepingEndings2,
      (diffCodeBlock2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        internKey(lookup, diffCodeBlock2),
    ),
    Int32Array.from(
      splitLinesKeepingEndings3,
      (diffCodeBlock2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        internKey(lookup, diffCodeBlock2),
    ),
    context,
  );
  let items: Dynamic = [];
  let plainTextToken2: Dynamic = (
    diffCodeBlock2?: Dynamic,
    options2?: Dynamic,
    context2?: Dynamic,
    dependencies?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let difference: number = options2 - diffCodeBlock2;
    let difference2: number = dependencies - context2;
    let plainTextToken3 = (..._extraArguments: unknown[]): undefined => {
      for (
        let diffCodeBlock3: Dynamic = diffCodeBlock2;
        diffCodeBlock3 < options2;
        diffCodeBlock3++
      )
        items.push({
          k: `del`,
          a: plainTextToken(splitLinesKeepingEndings2[diffCodeBlock3]),
        });
      for (
        let context3: Dynamic = context2;
        context3 < dependencies;
        context3++
      )
        items.push({
          k: `ins`,
          b: plainTextToken(splitLinesKeepingEndings3[context3]),
        });
    };
    if (difference === 0 || difference2 === 0) return plainTextToken3();
    if (difference * difference2 > DIFF_BUDGETS.pairCells) {
      context.degrade(`budget`);
      return plainTextToken3();
    }
    let slice: Dynamic = (
      diffCodeBlock3?: Dynamic,
      options3?: Dynamic,
      context3?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic =>
      diffCodeBlock3
        .slice(options3, context3)
        .map(
          (itemsSlice3?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
            textWordBag(itemsSlice3, context),
        );
    let itemsSlice: Dynamic = slice(
      splitLinesKeepingEndings2,
      diffCodeBlock2,
      options2,
    );
    let itemsSlice2: Dynamic = slice(
      splitLinesKeepingEndings3,
      context2,
      dependencies,
    );
    let round: Dynamic = (
      diffCodeBlock3?: Dynamic,
      options3?: Dynamic,
      ..._extraArguments: unknown[]
    ): number => {
      let bagSimilarity2: number = bagSimilarity(
        itemsSlice[diffCodeBlock3],
        itemsSlice2[options3],
      );
      return difference * difference2 === 1 ||
        bagSimilarity2 >= MIN_NODE_PAIR_SIMILARITY
        ? 1 + Math.round(bagSimilarity2 * 100)
        : 0;
    };
    for (let operation of maximumWeightedPairing(
      difference,
      difference2,
      round,
    ) as Dynamic)
      if (operation.op === `pair`) {
        let mappedTokenizeWords: Dynamic = tokenizeWords(
          splitLinesKeepingEndings2[diffCodeBlock2 + operation.i],
        ).map(plainTextToken);
        let mappedTokenizeWords2: Dynamic = tokenizeWords(
          splitLinesKeepingEndings3[context2 + operation.j],
        ).map(plainTextToken);
        for (let diffCodeBlockTokensResult of alignInlineTokens(
          mappedTokenizeWords,
          mappedTokenizeWords2,
          context,
        ) as Dynamic)
          items.push(diffCodeBlockTokensResult);
      } else if (operation.op === `del`) {
        items.push({
          k: `del`,
          a: plainTextToken(
            splitLinesKeepingEndings2[diffCodeBlock2 + operation.i],
          ),
        });
      } else {
        items.push({
          k: `ins`,
          b: plainTextToken(splitLinesKeepingEndings3[context2 + operation.j]),
        });
      }
  };
  let count: number = 0;
  let count2: number = 0;
  for (
    let count3: number = 0;
    count3 < budgetedSequenceMatches2.length;
    count3 += 2
  ) {
    let budgetedSequenceMatcheItem: Dynamic = budgetedSequenceMatches2[count3];
    let budgetedSequenceMatcheItem2: Dynamic =
      budgetedSequenceMatches2[count3 + 1];
    plainTextToken2(
      count,
      budgetedSequenceMatcheItem,
      count2,
      budgetedSequenceMatcheItem2,
    );
    items.push({
      k: `keep`,
      a: plainTextToken(splitLinesKeepingEndings2[budgetedSequenceMatcheItem]),
      b: plainTextToken(splitLinesKeepingEndings3[budgetedSequenceMatcheItem2]),
    });
    count = budgetedSequenceMatcheItem + 1;
    count2 = budgetedSequenceMatcheItem2 + 1;
  }
  plainTextToken2(
    count,
    splitLinesKeepingEndings2.length,
    count2,
    splitLinesKeepingEndings3.length,
  );
  return items;
}
var textNodeWithMarks: Dynamic = (
  text?: Dynamic,
  marks?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  marks.length
    ? {
        type: `text`,
        text: text,
        marks: marks,
      }
    : {
        type: `text`,
        text: text,
      };
var changedMarksSummary: Dynamic = (
  changedMarksSummary2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  changedMarksSummary2 === options ||
  marksKey(changedMarksSummary2) === marksKey(options)
    ? null
    : markChangeSummary(changedMarksSummary2, options);
function alignTokenMarkSegments(
  align?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (align.segs.length === 1 && options.segs.length === 1)
    return [
      {
        text: options.text ?? ``,
        marks: options.segs[0].marks,
        delta: changedMarksSummary(align.segs[0].marks, options.segs[0].marks),
      },
    ];
  let items: Dynamic = [];
  let index: number = 0;
  let textCount: Dynamic = align.segs[0]?.text.length ?? 0;
  let count: number = 0;
  for (let alignTokenMarkSegmentsResult of options.segs as Dynamic) {
    let count2: number = 0;
    for (; count2 < alignTokenMarkSegmentsResult.text.length; ) {
      for (; index < align.segs.length - 1 && textCount <= count; )
        textCount += align.segs[++index].text.length;
      let max: number = Math.max(
        1,
        Math.min(
          alignTokenMarkSegmentsResult.text.length - count2,
          textCount - count,
        ),
      );
      items.push({
        text: alignTokenMarkSegmentsResult.text.slice(count2, count2 + max),
        marks: alignTokenMarkSegmentsResult.marks,
        delta: changedMarksSummary(
          align.segs[index]?.marks ?? [],
          alignTokenMarkSegmentsResult.marks,
        ),
      });
      count2 += max;
      count += max;
    }
  }
  return items;
}
function finalizeTextChangeSummary(
  finalizeTextChangeSummary2?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  let label: string =
    finalizeTextChangeSummary2.sides.size === 2
      ? `replace`
      : finalizeTextChangeSummary2.sides.has(`ins`)
        ? `ins`
        : `del`;
  let label2: string =
    label === `replace` ? `replaced` : label === `ins` ? `added` : `deleted`;
  let label3: string = `Text`;
  let label4: string = `text`;
  let atoms: Dynamic = finalizeTextChangeSummary2.atoms;
  if (!finalizeTextChangeSummary2.text && atoms.length) {
    let type: Dynamic = atoms[0].type;
    let every: Dynamic = atoms.every(
      (atom?: Dynamic, ..._extraArguments: unknown[]) => atom.type === type,
    );
    let matchesAtomsCount: boolean =
      label === `replace` ? atoms.length === 2 : atoms.length === 1;
    label3 =
      every && matchesAtomsCount
        ? nodeKindLabel(atoms[atoms.length - 1])
        : `Content`;
    label4 = type;
  }
  finalizeTextChangeSummary2.ch.kind = label;
  finalizeTextChangeSummary2.ch.nodeType = label4;
  finalizeTextChangeSummary2.ch.summary = `${label3} ${label2}`;
}
function renderInlineTokenDiff(
  inline?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items: Dynamic = [];
  let renderInlineTokenDiffResult: Dynamic = null;
  let renderInlineTokenDiffResult2: Dynamic = null;
  let finalizeTextChangeSummary2 = (
    ..._extraArguments: unknown[]
  ): undefined => {
    if (renderInlineTokenDiffResult !== null) {
      finalizeTextChangeSummary(renderInlineTokenDiffResult);
    }
    renderInlineTokenDiffResult = null;
  };
  for (let renderInlineTokenDiffResult3 of inline as Dynamic) {
    if (renderInlineTokenDiffResult3.k === `keep`) {
      let {
        a: renderInlineTokenDiffResult5,
        b: renderInlineTokenDiffResult6,
      }: Dynamic = renderInlineTokenDiffResult3;
      if (renderInlineTokenDiffResult6.text === null) {
        finalizeTextChangeSummary2();
        renderInlineTokenDiffResult2 = null;
        items.push(
          diffInlineAtom(
            renderInlineTokenDiffResult5.node,
            renderInlineTokenDiffResult6.node,
            options,
          ),
        );
        continue;
      }
      if (!WHITESPACE_ONLY_PATTERN.test(renderInlineTokenDiffResult6.text)) {
        finalizeTextChangeSummary2();
      }
      for (let renderInlineTokenDiffResult7 of alignTokenMarkSegments(
        renderInlineTokenDiffResult5,
        renderInlineTokenDiffResult6,
      ) as Dynamic)
        if (renderInlineTokenDiffResult7.delta === null) {
          if (
            !(
              renderInlineTokenDiffResult2 !== null &&
              WHITESPACE_ONLY_PATTERN.test(renderInlineTokenDiffResult7.text)
            )
          ) {
            renderInlineTokenDiffResult2 = null;
          }
          items.push(
            textNodeWithMarks(
              renderInlineTokenDiffResult7.text,
              renderInlineTokenDiffResult7.marks,
            ),
          );
        } else {
          if (
            renderInlineTokenDiffResult2 === null ||
            renderInlineTokenDiffResult2.summary !==
              renderInlineTokenDiffResult7.delta
          ) {
            let changeRecord: Dynamic = createChangeRecord(
              `fmt`,
              `text`,
              renderInlineTokenDiffResult7.delta,
            );
            renderInlineTokenDiffResult2 = {
              summary: renderInlineTokenDiffResult7.delta,
              mark: createChangeMark(
                DIFF_MARK_TYPES.fmt,
                changeRecord,
                options,
                renderInlineTokenDiffResult7.delta,
              ),
            };
          }
          items.push(
            textNodeWithMarks(renderInlineTokenDiffResult7.text, [
              ...renderInlineTokenDiffResult7.marks,
              renderInlineTokenDiffResult2.mark,
            ]),
          );
        }
      continue;
    }
    renderInlineTokenDiffResult2 = null;
    let k2: Dynamic = renderInlineTokenDiffResult3.k;
    let a2: Dynamic =
      renderInlineTokenDiffResult3.k === `del`
        ? renderInlineTokenDiffResult3.a
        : renderInlineTokenDiffResult3.b;
    let renderInlineTokenDiffResult4: Dynamic = renderInlineTokenDiffResult ?? {
      ch: createChangeRecord(k2, `text`, ``),
      del: null,
      ins: null,
      text: false,
      atoms: [],
      sides: new (Set as Dynamic)(),
    };
    renderInlineTokenDiffResult = renderInlineTokenDiffResult4;
    renderInlineTokenDiffResult4.sides.add(k2);
    if (a2.text !== null) {
      renderInlineTokenDiffResult4.text = true;
      let renderInlineTokenDiffResult5: Dynamic = (renderInlineTokenDiffResult4[
        k2
      ] ??= createChangeMark(
        k2 === `ins` ? DIFF_MARK_TYPES.ins : DIFF_MARK_TYPES.del,
        renderInlineTokenDiffResult4.ch,
        options,
      ));
      for (let renderInlineTokenDiffResult6 of a2.segs as Dynamic)
        items.push(
          textNodeWithMarks(renderInlineTokenDiffResult6.text, [
            ...renderInlineTokenDiffResult6.marks,
            renderInlineTokenDiffResult5,
          ]),
        );
    } else {
      renderInlineTokenDiffResult4.atoms.push(a2.node);
      let record: Dynamic = {
        ...a2.node,
      };
      annotateNodeChange(
        record,
        k2,
        renderInlineTokenDiffResult4.ch,
        options,
        deletedDropdownFace(record, k2, options),
      );
      items.push(record);
    }
  }
  finalizeTextChangeSummary2();
  return mergeAdjacentTextNodes(items, options);
}
function isMentionLabelResolution(
  mentionLabelResolution?: Dynamic,
  options?: Dynamic,
  items?: Dynamic,
  ..._extraArguments: unknown[]
): boolean {
  if (options.type !== `mention` || items.length !== 1 || items[0] !== `label`)
    return false;
  let effectiveNodeAttribute2: Dynamic = effectiveNodeAttribute(
    mentionLabelResolution,
    `label`,
  );
  return (
    effectiveNodeAttribute2 === null ||
    (typeof effectiveNodeAttribute2 == `string` &&
      effectiveNodeAttribute2.trim() === ``)
  );
}
function diffInlineAtom(
  diffInline?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (nodeContentKey(diffInline, context) === nodeContentKey(options, context))
    return options;
  let items: Dynamic = [];
  let changedNodeAttributes2: Dynamic = changedNodeAttributes(
    diffInline,
    options,
  );
  let nodeAttributeChanges2: Dynamic = isMentionLabelResolution(
    diffInline,
    options,
    changedNodeAttributes2,
  )
    ? null
    : nodeAttributeChanges(
        diffInline,
        options,
        context,
        changedNodeAttributes2,
      );
  if (nodeAttributeChanges2 !== null) {
    items.push(nodeAttributeChanges2.summary);
  }
  let markChangeSummary2: Dynamic = markChangeSummary(
    diffInline.marks ?? [],
    options.marks ?? [],
  );
  if (markChangeSummary2 !== null) {
    items.push(markChangeSummary2);
  }
  if (!items.length) return options;
  let itemsText: Dynamic = items.join(`; `);
  let record: Dynamic = {
    ...options,
  };
  annotateNodeChange(
    record,
    `chg`,
    createChangeRecord(`chg`, options.type, itemsText),
    context,
    {
      [DIFF_ATTRIBUTE_NAMES.summary]: itemsText,
      ...(nodeAttributeChanges2 === null
        ? {}
        : {
            [DIFF_ATTRIBUTE_NAMES.before]: nodeAttributeChanges2.before,
          }),
    },
  );
  return record;
}
function equalMarksForMerge(
  equalMarks?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
) {
  if (equalMarks === options) return true;
  let equalMarks2: Dynamic = equalMarks ?? [];
  let options2: Dynamic = options ?? [];
  if (equalMarks2.length !== options2.length) return false;
  for (let index: number = 0; index < equalMarks2.length; index++) {
    let equalMarkItem: Dynamic = equalMarks2[index];
    let optionItem: Dynamic = options2[index];
    if (
      equalMarkItem !== optionItem &&
      (context.markCh.has(equalMarkItem) ||
        context.markCh.has(optionItem) ||
        markKey(equalMarkItem) !== markKey(optionItem))
    )
      return false;
  }
  return true;
}
function mergeAdjacentTextNodes(
  mergeAdjacentTextNodes2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items: Dynamic = [];
  for (let mergeAdjacentTextNodesResult of mergeAdjacentTextNodes2 as Dynamic) {
    let itemItem: Dynamic = items[items.length - 1];
    if (
      mergeAdjacentTextNodesResult.type === `text` &&
      itemItem?.type === `text` &&
      equalMarksForMerge(
        itemItem.marks,
        mergeAdjacentTextNodesResult.marks,
        options,
      )
    ) {
      itemItem.text =
        (itemItem.text ?? ``) + (mergeAdjacentTextNodesResult.text ?? ``);
    } else {
      items.push(mergeAdjacentTextNodesResult);
    }
  }
  return items;
}
function collectMoveCandidates(
  collectMoveCandidates2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items: Dynamic = [];
  let items2: Dynamic = [];
  let slice = (
    out?: Dynamic,
    src?: Dynamic,
    side?: Dynamic,
    husk?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    items.push({
      out: out,
      src: src,
      side: side,
      husk: husk,
      ancestors: items2.slice(),
      listDepth: items2.filter(
        (item?: Dynamic, ..._extraArguments: unknown[]) => item.type === `list`,
      ).length,
    });
  };
  let nodeChildren2 = (
    collectMoveCandidates3?: Dynamic,
    options2?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (
      options.ghosts.has(collectMoveCandidates3) ||
      options.settled.has(collectMoveCandidates3) ||
      collectMoveCandidates3.type === `text`
    )
      return;
    let regionRootEntry: Dynamic =
      options.regionRoots.get(collectMoveCandidates3) ?? options2;
    let sourceEntry: Dynamic =
      regionRootEntry === null
        ? undefined
        : options.source.get(collectMoveCandidates3);
    if (
      regionRootEntry !== null &&
      sourceEntry !== undefined &&
      !ROOT_CONTAINER_TYPES.has(collectMoveCandidates3.type)
    ) {
      slice(collectMoveCandidates3, sourceEntry, regionRootEntry, false);
    }
    let huskEntry: Dynamic =
      regionRootEntry === null
        ? options.husks.get(collectMoveCandidates3)
        : undefined;
    if (huskEntry !== undefined) {
      slice(collectMoveCandidates3, huskEntry, `del`, true);
    }
    if (!TEXT_BLOCK_NODE_TYPES.has(collectMoveCandidates3.type)) {
      items2.push(collectMoveCandidates3);
      for (let collectMoveCandidatesResult of nodeChildren(
        collectMoveCandidates3,
      ) as Dynamic)
        nodeChildren2(collectMoveCandidatesResult, regionRootEntry);
      items2.pop();
    }
  };
  nodeChildren2(collectMoveCandidates2, null);
  return items;
}
function moveCandidateIdentity(
  moveCandidateIdentity2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let commonNodeBlockId2: Dynamic = moveCandidateIdentity2.husk
    ? null
    : commonNodeBlockId(moveCandidateIdentity2.src, options);
  if (commonNodeBlockId2 !== null) return `b:${commonNodeBlockId2}`;
  if (nodeWordBag(moveCandidateIdentity2.src, options).length === 0)
    return null;
  let nodeContentKey2: Dynamic = nodeContentKey(
    moveCandidateIdentity2.src,
    options,
  );
  let { prev: hashCounts, curr: hashCounts2 }: Dynamic = options.hashCounts();
  return hashCounts.get(nodeContentKey2) === 1 &&
    hashCounts2.get(nodeContentKey2) === 1
    ? `h:${nodeContentKey2}`
    : null;
}
function moveCandidateRegionRoot(
  moveCandidateRegionRoot2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (
    options.regionRoots.get(moveCandidateRegionRoot2.out) ===
    moveCandidateRegionRoot2.side
  )
    return moveCandidateRegionRoot2.out;
  for (
    let difference: number = moveCandidateRegionRoot2.ancestors.length - 1;
    difference >= 0;
    difference--
  ) {
    let ancestorItem: Dynamic = moveCandidateRegionRoot2.ancestors[difference];
    if (options.regionRoots.get(ancestorItem) === moveCandidateRegionRoot2.side)
      return ancestorItem;
  }
  return null;
}
function isWeakMoveCandidate(
  weakMoveCandidate?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): boolean {
  if (
    weakMoveCandidate.husk ||
    commonNodeBlockId(weakMoveCandidate.src, context) !== null
  )
    return false;
  let moveCandidateRegionRoot2 = (
    weakMoveCandidate2?: Dynamic,
    ..._extraArguments: unknown[]
  ) =>
    moveCandidateRegionRoot(weakMoveCandidate2, context) !==
    weakMoveCandidate2.out;
  return (
    moveCandidateRegionRoot2(weakMoveCandidate) &&
    moveCandidateRegionRoot2(options) &&
    nodeWordBag(weakMoveCandidate.src, context).length < MAX_CONVERSION_ROUNDS
  );
}
function pairRewrittenMoveCandidates(
  pairRewrittenMoveCandidates2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let nodeWordCount2: Dynamic = (
    pairRewrittenMoveCandidates3?: Dynamic,
    ..._extraArguments: unknown[]
  ): boolean =>
    !options.has(pairRewrittenMoveCandidates3) &&
    !pairRewrittenMoveCandidates3.husk &&
    context.regionRoots.get(pairRewrittenMoveCandidates3.out) ===
      pairRewrittenMoveCandidates3.side &&
    commonNodeBlockId(pairRewrittenMoveCandidates3.src, context) === null &&
    (pairRewrittenMoveCandidates3.src.type === `codeBlock` ||
      (pairRewrittenMoveCandidates3.src.type === `paragraph` &&
        effectiveNodeAttribute(pairRewrittenMoveCandidates3.src, `heading`) ===
          null)) &&
    nodeWordCount(pairRewrittenMoveCandidates3.src) >= MIN_CODE_BLOCK_WORDS;
  let filteredPairRewrittenMoveCandidates: Dynamic =
    pairRewrittenMoveCandidates2.filter(
      (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        item.side === `del` && nodeWordCount2(item),
    );
  let filteredPairRewrittenMoveCandidates2: Dynamic =
    pairRewrittenMoveCandidates2.filter(
      (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        item.side === `ins` && nodeWordCount2(item),
    );
  if (
    !filteredPairRewrittenMoveCandidates.length ||
    !filteredPairRewrittenMoveCandidates2.length
  )
    return [];
  let lookup: Dynamic = new (Map as Dynamic)();
  filteredPairRewrittenMoveCandidates2.forEach(
    (
      filteredPairRewrittenMoveCandidate?: Dynamic,
      index?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      for (let pairRewrittenMoveCandidatesResult of new (Set as Dynamic)(
        nodeWordBag(filteredPairRewrittenMoveCandidate.src, context),
      ) as Dynamic) {
        let lookupEntry: Dynamic = lookup.get(
          pairRewrittenMoveCandidatesResult,
        );
        if (lookupEntry === undefined) {
          lookup.set(pairRewrittenMoveCandidatesResult, (lookupEntry = []));
        }
        lookupEntry.push(index);
      }
    },
  );
  let lookup2: Dynamic = new (Map as Dynamic)();
  let lookup3: Dynamic = new (Map as Dynamic)();
  let updateSecond = (
    pairRewrittenMoveCandidates3?: Dynamic,
    options2?: Dynamic,
    other?: Dynamic,
    sim?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    let pairRewrittenMoveCandidateEntry: Dynamic =
      pairRewrittenMoveCandidates3.get(options2);
    if (pairRewrittenMoveCandidateEntry === undefined) {
      pairRewrittenMoveCandidates3.set(options2, {
        other: other,
        sim: sim,
        second: -1,
      });
    } else {
      if (sim > pairRewrittenMoveCandidateEntry.sim) {
        pairRewrittenMoveCandidates3.set(options2, {
          other: other,
          sim: sim,
          second: pairRewrittenMoveCandidateEntry.sim,
        });
      } else {
        if (sim > pairRewrittenMoveCandidateEntry.second) {
          pairRewrittenMoveCandidateEntry.second = sim;
        }
      }
    }
  };
  filteredPairRewrittenMoveCandidates.forEach(
    (
      item?: Dynamic,
      index?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      let nodeWordBag2: Dynamic = nodeWordBag(item.src, context);
      let uniqueItems: Dynamic = new (Set as Dynamic)();
      for (let pairRewrittenMoveCandidatesResult of new (Set as Dynamic)(
        nodeWordBag2,
      ) as Dynamic) {
        let lookupEntry: Dynamic = lookup.get(
          pairRewrittenMoveCandidatesResult,
        );
        if (
          !(
            lookupEntry === undefined ||
            lookupEntry.length > MAX_SEQUENCE_PAIRING_WINDOW
          )
        )
          for (let pairRewrittenMoveCandidatesResult2 of lookupEntry as Dynamic) {
            if (
              uniqueItems.has(pairRewrittenMoveCandidatesResult2) ||
              filteredPairRewrittenMoveCandidates2[
                pairRewrittenMoveCandidatesResult2
              ].src.type !== item.src.type
            )
              continue;
            uniqueItems.add(pairRewrittenMoveCandidatesResult2);
            let bagSimilarity2: number = bagSimilarity(
              nodeWordBag2,
              nodeWordBag(
                filteredPairRewrittenMoveCandidates2[
                  pairRewrittenMoveCandidatesResult2
                ].src,
                context,
              ),
            );
            updateSecond(
              lookup2,
              index,
              pairRewrittenMoveCandidatesResult2,
              bagSimilarity2,
            );
            updateSecond(
              lookup3,
              pairRewrittenMoveCandidatesResult2,
              index,
              bagSimilarity2,
            );
          }
      }
    },
  );
  let items: Dynamic = [];
  for (let [
    pairRewrittenMoveCandidatesResult,
    pairRewrittenMoveCandidatesResult2,
  ] of lookup2 as Dynamic) {
    let lookupEntry: Dynamic = lookup3.get(
      pairRewrittenMoveCandidatesResult2.other,
    );
    if (
      pairRewrittenMoveCandidatesResult2.sim >=
        MIN_CODE_CONVERSION_SIMILARITY &&
      pairRewrittenMoveCandidatesResult2.sim >
        pairRewrittenMoveCandidatesResult2.second &&
      lookupEntry?.other === pairRewrittenMoveCandidatesResult &&
      lookupEntry.sim > lookupEntry.second
    ) {
      items.push([
        filteredPairRewrittenMoveCandidates[pairRewrittenMoveCandidatesResult],
        filteredPairRewrittenMoveCandidates2[
          pairRewrittenMoveCandidatesResult2.other
        ],
      ]);
    }
  }
  return items;
}
function moveCandidateRuns(
  moveCandidateRuns2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let lookup: Dynamic = new (Map as Dynamic)([
    [`del`, []],
    [`ins`, []],
  ]);
  let nodeChildren2 = (
    moveCandidateRuns3?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (
      moveCandidateRuns3.type === `text` ||
      TEXT_BLOCK_NODE_TYPES.has(moveCandidateRuns3.type)
    )
      return;
    let items: Dynamic = [];
    for (let moveCandidateRunsResult of nodeChildren(
      moveCandidateRuns3,
    ) as Dynamic) {
      let optionEntry: Dynamic = options.get(moveCandidateRunsResult);
      let optionEntry2: Dynamic =
        optionEntry !== undefined &&
        (optionEntry.husk ||
          context.regionRoots.get(moveCandidateRunsResult) === optionEntry.side)
          ? optionEntry
          : null;
      if (
        items.length &&
        (optionEntry2 === null || optionEntry2.side !== items[0].side)
      ) {
        lookup.get(items[0].side).push(items);
        items = [];
      }
      if (optionEntry2 !== null) {
        items.push(optionEntry2);
      }
    }
    if (items.length) {
      lookup.get(items[0].side).push(items);
    }
    for (let moveCandidateRunsResult of nodeChildren(
      moveCandidateRuns3,
    ) as Dynamic)
      nodeChildren2(moveCandidateRunsResult);
  };
  nodeChildren2(moveCandidateRuns2);
  return lookup;
}
function canPairMoveCandidates(
  pairMoveCandidates?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): boolean {
  let src: Dynamic = pairMoveCandidates.src;
  let src2: Dynamic = options.src;
  if (
    commonNodeBlockId(src2, context) !== null ||
    (!pairMoveCandidates.husk && commonNodeBlockId(src, context) !== null) ||
    src.type !== src2.type ||
    (nodeContentKey(src, context) !== nodeContentKey(src2, context) &&
      !canPairNodeKinds(src, src2))
  )
    return false;
  let nodeWordBag2: Dynamic = nodeWordBag(src, context);
  let nodeWordBag3: Dynamic = nodeWordBag(src2, context);
  return (
    !nodeWordBag2.length ||
    !nodeWordBag3.length ||
    bagSimilarity(nodeWordBag2, nodeWordBag3) >= MIN_NODE_PAIR_SIMILARITY
  );
}
function alignMoveCandidateRuns(
  alignMoveCandidateRuns2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let lookup: Dynamic = new (Map as Dynamic)();
  for (let alignMoveCandidateRunsResult of options as Dynamic)
    if (!lookup.has(alignMoveCandidateRunsResult.out)) {
      lookup.set(
        alignMoveCandidateRunsResult.out,
        alignMoveCandidateRunsResult,
      );
    }
  let moveCandidateRuns2: Dynamic = moveCandidateRuns(
    alignMoveCandidateRuns2,
    lookup,
    argument,
  );
  let moveCandidateRunEntry: Dynamic = moveCandidateRuns2.get(`ins`);
  let lookup2: Dynamic = new (Map as Dynamic)();
  moveCandidateRunEntry.forEach(
    (
      moveCandidateRunEntry2?: Dynamic,
      run?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic =>
      moveCandidateRunEntry2.forEach(
        (
          item?: Dynamic,
          pos?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic =>
          lookup2.set(item, {
            run: run,
            pos: pos,
          }),
      ),
  );
  let lookup3: Dynamic = new (Map as Dynamic)(
    context.map(
      (
        [context2, context3]: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => [context2, context3],
    ),
  );
  let items: Dynamic = [];
  for (let items2 of moveCandidateRuns2.get(`del`) as Dynamic) {
    let lookup4: Dynamic = new (Map as Dynamic)();
    items2.forEach(
      (
        item?: Dynamic,
        dpos?: Dynamic,
        ..._extraArguments: unknown[]
      ): undefined => {
        let lookupEntry: Dynamic = lookup3.get(item);
        let lookupEntry2: Dynamic =
          lookupEntry === undefined ? undefined : lookup2.get(lookupEntry);
        if (lookupEntry2 === undefined) return;
        let lookupEntry3: Dynamic = lookup4.get(lookupEntry2.run);
        if (lookupEntry3 === undefined) {
          lookup4.set(lookupEntry2.run, (lookupEntry3 = []));
        }
        lookupEntry3.push({
          dpos: dpos,
          ipos: lookupEntry2.pos,
        });
      },
    );
    let alignMoveCandidateRunsResult: number = -1;
    let items3: Dynamic = [];
    for (let [alignMoveCandidateRunsResult2, items5] of lookup4 as Dynamic)
      if (!(items5.length <= items3.length)) {
        alignMoveCandidateRunsResult = alignMoveCandidateRunsResult2;
        items3 = items5;
      }
    let mappedLongestIncreasingSubsequence: Dynamic =
      longestIncreasingSubsequence(
        items3.map(
          (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => item.ipos,
        ),
      ).map(
        (
          longestIncreasingSubsequence2?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic => items3[longestIncreasingSubsequence2],
      );
    if (
      mappedLongestIncreasingSubsequence.length < 2 ||
      mappedLongestIncreasingSubsequence.length * 2 <= items2.length
    )
      continue;
    let moveCandidateRunEntryItem: Dynamic =
      moveCandidateRunEntry[alignMoveCandidateRunsResult];
    let items4: Dynamic = [
      {
        dpos: -1,
        ipos: -1,
      },
      ...mappedLongestIncreasingSubsequence,
      {
        dpos: items2.length,
        ipos: moveCandidateRunEntryItem.length,
      },
    ];
    for (let index: number = 0; index + 1 < items4.length; index++) {
      let total: Dynamic = items4[index].dpos + 1;
      let total2: Dynamic = items4[index].ipos + 1;
      let difference: number = items4[index + 1].dpos - total;
      if (difference === items4[index + 1].ipos - total2)
        for (let index2: number = 0; index2 < difference; index2++) {
          let itemItem: Dynamic = items2[total + index2];
          let moveCandidateRunEntryItemItem: Dynamic =
            moveCandidateRunEntryItem[total2 + index2];
          if (
            !(
              dependencies.has(itemItem) ||
              dependencies.has(moveCandidateRunEntryItemItem) ||
              !canPairMoveCandidates(
                itemItem,
                moveCandidateRunEntryItemItem,
                argument,
              )
            )
          ) {
            dependencies.add(itemItem);
            dependencies.add(moveCandidateRunEntryItemItem);
            items.push([itemItem, moveCandidateRunEntryItemItem]);
          }
        }
    }
  }
  return items;
}
function detectMovedNodes(
  detectMovedNodes2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  for (let index: number = 0; index < MAX_MOVE_PAIRING_ROUNDS; index++) {
    let collectMoveCandidates2: Dynamic = collectMoveCandidates(
      detectMovedNodes2,
      options,
    );
    let lookup: Dynamic = new (Map as Dynamic)();
    for (let detectMovedNodesResult of collectMoveCandidates2 as Dynamic) {
      let moveCandidateIdentity2: Dynamic = moveCandidateIdentity(
        detectMovedNodesResult,
        options,
      );
      if (moveCandidateIdentity2 === null) continue;
      let lookupEntry: Dynamic = lookup.get(moveCandidateIdentity2);
      if (lookupEntry === undefined) {
        lookup.set(
          moveCandidateIdentity2,
          (lookupEntry = {
            del: [],
            ins: [],
          }),
        );
      }
      (detectMovedNodesResult.side === `del`
        ? lookupEntry.del
        : lookupEntry.ins
      ).push(detectMovedNodesResult);
    }
    let items: Dynamic = [];
    let uniqueItems: Dynamic = new (Set as Dynamic)();
    let detectMovedNodesHandler = (
      detectMovedNodes3?: Dynamic,
      options2?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      items.push([detectMovedNodes3, options2]);
      uniqueItems.add(detectMovedNodes3);
      uniqueItems.add(options2);
    };
    let items2: Dynamic = [];
    for (let detectMovedNodesResult of lookup.values() as Dynamic)
      if (
        !(
          detectMovedNodesResult.del.length !== 1 ||
          detectMovedNodesResult.ins.length !== 1
        )
      ) {
        if (
          isWeakMoveCandidate(
            detectMovedNodesResult.del[0],
            detectMovedNodesResult.ins[0],
            options,
          )
        ) {
          items2.push([
            detectMovedNodesResult.del[0],
            detectMovedNodesResult.ins[0],
          ]);
        } else {
          detectMovedNodesHandler(
            detectMovedNodesResult.del[0],
            detectMovedNodesResult.ins[0],
          );
        }
      }
    if (items2.length) {
      let lookup2: Dynamic = new (Map as Dynamic)();
      for (let [
        detectMovedNodesResult,
        detectMovedNodesResult2,
      ] of items as Dynamic) {
        let moveCandidateRegionRoot2: Dynamic = moveCandidateRegionRoot(
          detectMovedNodesResult,
          options,
        );
        let moveCandidateRegionRoot3: Dynamic = moveCandidateRegionRoot(
          detectMovedNodesResult2,
          options,
        );
        if (
          moveCandidateRegionRoot2 === null ||
          moveCandidateRegionRoot3 === null ||
          moveCandidateRegionRoot2 === detectMovedNodesResult.out ||
          moveCandidateRegionRoot3 === detectMovedNodesResult2.out
        )
          continue;
        let lookupEntry: Dynamic = lookup2.get(moveCandidateRegionRoot2);
        if (lookupEntry === undefined) {
          lookup2.set(
            moveCandidateRegionRoot2,
            (lookupEntry = new (Set as Dynamic)()),
          );
        }
        lookupEntry.add(moveCandidateRegionRoot3);
      }
      for (let [
        detectMovedNodesResult,
        detectMovedNodesResult2,
      ] of items2 as Dynamic) {
        let moveCandidateRegionRoot2: Dynamic = moveCandidateRegionRoot(
          detectMovedNodesResult,
          options,
        );
        let moveCandidateRegionRoot3: Dynamic = moveCandidateRegionRoot(
          detectMovedNodesResult2,
          options,
        );
        if (
          moveCandidateRegionRoot2 !== null &&
          moveCandidateRegionRoot3 !== null &&
          lookup2.get(moveCandidateRegionRoot2)?.has(moveCandidateRegionRoot3)
        ) {
          detectMovedNodesHandler(
            detectMovedNodesResult,
            detectMovedNodesResult2,
          );
        }
      }
    }
    for (let [
      detectMovedNodesResult,
      detectMovedNodesResult2,
    ] of pairRewrittenMoveCandidates(
      collectMoveCandidates2,
      uniqueItems,
      options,
    ) as Dynamic)
      detectMovedNodesHandler(detectMovedNodesResult, detectMovedNodesResult2);
    for (let detectMovedNodesResult of alignMoveCandidateRuns(
      detectMovedNodes2,
      collectMoveCandidates2,
      items,
      uniqueItems,
      options,
    ) as Dynamic)
      items.push(detectMovedNodesResult);
    if (!items.length) return;
    items.sort(
      (
        item?: Dynamic,
        item2?: Dynamic,
        ..._extraArguments: unknown[]
      ): number =>
        nodeContentKeyLength(item2[1].src, options) -
        nodeContentKeyLength(item[1].src, options),
    );
    let uniqueItems2: Dynamic = new (Set as Dynamic)();
    let uniqueItems3: Dynamic = new (Set as Dynamic)();
    let enabled: boolean = false;
    for (let [
      detectMovedNodesResult,
      detectMovedNodesResult2,
    ] of items as Dynamic)
      if (
        !(
          uniqueItems3.has(detectMovedNodesResult.out) ||
          uniqueItems3.has(detectMovedNodesResult2.out) ||
          detectMovedNodesResult.ancestors.some(
            (ancestor?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              uniqueItems2.has(ancestor),
          ) ||
          detectMovedNodesResult2.ancestors.some(
            (ancestor?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              uniqueItems2.has(ancestor),
          ) ||
          !applyMovedNodePair(
            detectMovedNodesResult,
            detectMovedNodesResult2,
            options,
          )
        )
      ) {
        enabled = true;
        uniqueItems2.add(detectMovedNodesResult.out);
        uniqueItems2.add(detectMovedNodesResult2.out);
        for (let detectMovedNodesResult3 of detectMovedNodesResult.ancestors as Dynamic)
          uniqueItems3.add(detectMovedNodesResult3);
        for (let detectMovedNodesResult3 of detectMovedNodesResult2.ancestors as Dynamic)
          uniqueItems3.add(detectMovedNodesResult3);
      }
    if (!enabled) return;
  }
}
var emptyParagraph: Dynamic = (..._extraArguments: unknown[]): Dynamic => ({
  type: `paragraph`,
});
function emptyTableCell(
  emptyTableCell2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let attrs: Dynamic = {};
  for (let emptyTableCellResult of [`colspan`, `rowspan`] as Dynamic) {
    let nodeAttribute2: Dynamic =
      emptyTableCell2 === undefined
        ? undefined
        : nodeAttribute(emptyTableCell2, emptyTableCellResult);
    if (typeof nodeAttribute2 == `number` && nodeAttribute2 > 1) {
      attrs[emptyTableCellResult] = nodeAttribute2;
    }
  }
  return Object.keys(attrs).length
    ? {
        type: `cell`,
        attrs: attrs,
        content: [emptyParagraph()],
      }
    : {
        type: `cell`,
        content: [emptyParagraph()],
      };
}
var EMPTY_CONTAINER_CONTENT: Dynamic = new (Map as Dynamic)([
  [
    `blockquote`,
    (..._extraArguments: unknown[]): Dynamic => [emptyParagraph()],
  ],
  [`listItem`, (..._extraArguments: unknown[]): Dynamic => [emptyParagraph()]],
  [`cell`, (..._extraArguments: unknown[]): Dynamic => [emptyParagraph()]],
  [
    `list`,
    (..._extraArguments: unknown[]): Dynamic => [
      {
        type: `listItem`,
        content: [emptyParagraph()],
      },
    ],
  ],
  [
    `tableRow`,
    (
      eMPTYCONTAINERCONTENT?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic =>
      nodeChildren(eMPTYCONTAINERCONTENT).length
        ? nodeChildren(eMPTYCONTAINERCONTENT).map(emptyTableCell)
        : [emptyTableCell()],
  ],
  [
    `table`,
    (..._extraArguments: unknown[]): Dynamic => [
      {
        type: `tableRow`,
        content: [emptyTableCell()],
      },
    ],
  ],
]);
function nodeHusk(
  nodeHusk2?: Dynamic,
  options: Dynamic = true,
  ..._extraArguments: unknown[]
): Dynamic {
  let bid: Dynamic = options ? nodeBlockId(nodeHusk2) : null;
  let record: Dynamic = {
    type: nodeHusk2.type,
    ...(bid === null
      ? {}
      : {
          attrs: {
            bid: bid,
          },
        }),
  };
  let EMPTYCONTAINERCONTENTEntry: Dynamic = EMPTY_CONTAINER_CONTENT.get(
    nodeHusk2.type,
  )?.(nodeHusk2);
  if (EMPTYCONTAINERCONTENTEntry !== undefined) {
    record.content = EMPTYCONTAINERCONTENTEntry;
  }
  return record;
}
function applyMovedNodePair(
  applyMovedNodePair2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let src: Dynamic = applyMovedNodePair2.src;
  let src2: Dynamic = options.src;
  let matchesNodeContentKey: boolean =
    nodeContentKey(src, context) === nodeContentKey(src2, context);
  if (
    src.type !== src2.type ||
    (!matchesNodeContentKey && !canPairNodeKinds(src, src2))
  )
    return false;
  if (applyMovedNodePair2.husk) {
    let ancestorItem: Dynamic =
      applyMovedNodePair2.ancestors[applyMovedNodePair2.ancestors.length - 1];
    let items: Dynamic =
      ancestorItem === undefined ? [] : nodeChildren(ancestorItem);
    let itemIndex: Dynamic = items.indexOf(applyMovedNodePair2.out);
    let originEntry: Dynamic = context.origin.get(applyMovedNodePair2.out);
    if (itemIndex < 0 || originEntry === undefined) return false;
    items.splice(itemIndex, 0, {
      ...originEntry,
    });
  }
  let rowPermEntry: Dynamic =
    src2.type === `tableRow` ? context.rowPerm.get(src2) : undefined;
  let emptyNodeDiffDetails2: Dynamic =
    rowPermEntry !== undefined &&
    hasColumnPermutation(src, src2, rowPermEntry.pi, context)
      ? emptyNodeDiffDetails(
          diffPermutedTableRow(src, src2, rowPermEntry, context),
        )
      : matchesNodeContentKey
        ? emptyNodeDiffDetails({
            ...src2,
          })
        : diffNodeDetails(src, src2, context);
  let label: string =
    src2.type === `listItem` &&
    options.listDepth !== applyMovedNodePair2.listDepth
      ? options.listDepth > applyMovedNodePair2.listDepth
        ? `Indented`
        : `Outdented`
      : `Moved`;
  let label2: Dynamic =
    emptyNodeDiffDetails2.summary === null
      ? label
      : `${label}; ${emptyNodeDiffDetails2.summary}`;
  let changeRecord: Dynamic = createChangeRecord(`move`, src2.type, label2);
  annotateNodeChange(
    emptyNodeDiffDetails2.node,
    `move`,
    changeRecord,
    context,
    {
      [DIFF_ATTRIBUTE_NAMES.summary]: label2,
      ...(emptyNodeDiffDetails2.summary === null
        ? {}
        : {
            [DIFF_ATTRIBUTE_NAMES.before]: emptyNodeDiffDetails2.before,
          }),
    },
  );
  absorbChildChanges(emptyNodeDiffDetails2, changeRecord, context);
  context.primary.add(emptyNodeDiffDetails2.node);
  replaceNodeInPlace(options.out, emptyNodeDiffDetails2.node, context);
  let changeRecord2: Dynamic = createChangeRecord(`del`, src.type, `Moved`);
  changeRecord2.alias = changeRecord;
  let nodeHusk2: Dynamic = nodeHusk(src, !applyMovedNodePair2.husk);
  annotateNodeChange(nodeHusk2, `del`, changeRecord2, context, {
    [DIFF_ATTRIBUTE_NAMES.summary]: `Moved`,
    [DIFF_ATTRIBUTE_NAMES.ghost]: `move`,
    [DIFF_ATTRIBUTE_NAMES.moveTo]: ``,
  });
  context.ghosts.add(nodeHusk2);
  replaceNodeInPlace(applyMovedNodePair2.out, nodeHusk2, context);
  context.moves.set(changeRecord, {
    move: options.out,
    ghost: applyMovedNodePair2.out,
    src: src2,
  });
  return true;
}
function replaceNodeInPlace(
  replaceNodeInPlace2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  let replaceNodeInPlace3: Dynamic = replaceNodeInPlace2;
  for (let replaceNodeInPlaceResult of Object.keys(
    replaceNodeInPlace3,
  ) as Dynamic)
    delete replaceNodeInPlace3[replaceNodeInPlaceResult];
  Object.assign(replaceNodeInPlace2, options);
  let nodeChEntry: Dynamic = context.nodeCh.get(options);
  if (nodeChEntry) {
    context.nodeCh.set(replaceNodeInPlace2, nodeChEntry);
  } else {
    context.nodeCh.delete(replaceNodeInPlace2);
  }
  if (context.primary.has(options)) {
    context.primary.add(replaceNodeInPlace2);
  } else {
    context.primary.delete(replaceNodeInPlace2);
  }
  if (context.ghosts.has(options)) {
    context.ghosts.add(replaceNodeInPlace2);
  } else {
    context.ghosts.delete(replaceNodeInPlace2);
  }
  let regionRootEntry: Dynamic = context.regionRoots.get(options);
  if (regionRootEntry) {
    context.regionRoots.set(replaceNodeInPlace2, regionRootEntry);
  } else {
    context.regionRoots.delete(replaceNodeInPlace2);
  }
  let sourceEntry: Dynamic = context.source.get(options);
  if (sourceEntry) {
    context.source.set(replaceNodeInPlace2, sourceEntry);
  } else {
    context.source.delete(replaceNodeInPlace2);
  }
}
function singleNestedChange(
  singleNestedChange2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let singleNestedChangeResult: Dynamic = null;
  let enabled: boolean = false;
  let nodeChildren2 = (
    singleNestedChange3?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (enabled) return;
    if (
      singleNestedChange3 !== singleNestedChange2 &&
      (options.primary.has(singleNestedChange3) ||
        options.ghosts.has(singleNestedChange3))
    ) {
      singleNestedChangeResult ??= singleNestedChange3;
      return;
    }
    let nodeChildren3: Dynamic = nodeChildren(singleNestedChange3);
    if (
      TEXT_BLOCK_NODE_TYPES.has(singleNestedChange3.type) ||
      singleNestedChange3.type === `text` ||
      INLINE_NODE_TYPES.has(singleNestedChange3.type) ||
      (nodeChildren3.length === 0 &&
        singleNestedChange3 !== singleNestedChange2)
    ) {
      enabled = true;
      return;
    }
    for (let singleNestedChangeResult2 of nodeChildren3 as Dynamic)
      nodeChildren2(singleNestedChangeResult2);
  };
  nodeChildren2(singleNestedChange2);
  return enabled ? null : singleNestedChangeResult;
}
function collapseNestedChangeAliases(
  collapseNestedChangeAliases2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  let nodeChildren2 = (
    collapseNestedChangeAliases3?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    let regionRootEntry: Dynamic = options.regionRoots.get(
      collapseNestedChangeAliases3,
    );
    if (
      regionRootEntry !== undefined &&
      !options.ghosts.has(collapseNestedChangeAliases3) &&
      !options.settled.has(collapseNestedChangeAliases3)
    ) {
      let singleNestedChange2: Dynamic = singleNestedChange(
        collapseNestedChangeAliases3,
        options,
      );
      let nodeChEntry: Dynamic = options.nodeCh.get(
        collapseNestedChangeAliases3,
      );
      let nodeChEntry2: Dynamic =
        singleNestedChange2 === null
          ? undefined
          : options.nodeCh.get(singleNestedChange2);
      if (nodeChEntry !== undefined && nodeChEntry2 !== undefined) {
        let changeAlias: Dynamic = resolveChangeAlias(nodeChEntry2);
        if (resolveChangeAlias(nodeChEntry) !== changeAlias) {
          let changeRecord: Dynamic = createChangeRecord(
            nodeChEntry.kind,
            nodeChEntry.nodeType,
            nodeChEntry.summary,
          );
          changeRecord.alias = changeAlias;
          options.nodeCh.set(collapseNestedChangeAliases3, changeRecord);
          let moveEntry: Dynamic = options.moves.get(changeAlias);
          if (moveEntry !== undefined && changeAlias.summary === `Moved`) {
            changeAlias.summary =
              regionRootEntry === `ins`
                ? `${nodeKindLabel(moveEntry.src)} → ${nodeKindLabel(collapseNestedChangeAliases3)}`
                : `${nodeKindLabel(collapseNestedChangeAliases3)} → ${nodeKindLabel(moveEntry.src)}`;
            moveEntry.move.attrs = {
              ...moveEntry.move.attrs,
              [DIFF_ATTRIBUTE_NAMES.summary]: changeAlias.summary,
            };
          }
        }
      }
      return;
    }
    for (let collapseNestedChangeAliasesResult of nodeChildren(
      collapseNestedChangeAliases3,
    ) as Dynamic)
      nodeChildren2(collapseNestedChangeAliasesResult);
  };
  nodeChildren2(collapseNestedChangeAliases2);
}
function mergeAdjacentMoves(
  mergeAdjacentMoves2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  if (!options.moves.size) return;
  let indexNodeParents2: Dynamic = indexNodeParents(mergeAdjacentMoves2);
  let mergeAdjacentMovesHandler: Dynamic = (
    mergeAdjacentMoves3?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let nodeChEntry: Dynamic = options.primary.has(mergeAdjacentMoves3)
      ? options.nodeCh.get(mergeAdjacentMoves3)
      : undefined;
    return nodeChEntry?.kind === `move` && options.moves.has(nodeChEntry)
      ? nodeChEntry
      : undefined;
  };
  let resolveChangeAlias2 = (
    mergeAdjacentMoves3?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    let nodeChildren2: Dynamic = nodeChildren(mergeAdjacentMoves3);
    for (let index: number = 0; index + 1 < nodeChildren2.length; index++) {
      let mergeAdjacentMovesHandler2: Dynamic = mergeAdjacentMovesHandler(
        nodeChildren2[index],
      );
      let mergeAdjacentMovesHandler3: Dynamic = mergeAdjacentMovesHandler(
        nodeChildren2[index + 1],
      );
      if (
        mergeAdjacentMovesHandler2 === undefined ||
        mergeAdjacentMovesHandler3 === undefined
      )
        continue;
      let indexNodeParentEntry: Dynamic = indexNodeParents2.get(
        options.moves.get(mergeAdjacentMovesHandler2).ghost,
      );
      let indexNodeParentEntry2: Dynamic = indexNodeParents2.get(
        options.moves.get(mergeAdjacentMovesHandler3).ghost,
      );
      if (
        indexNodeParentEntry === undefined ||
        indexNodeParentEntry2 === undefined ||
        indexNodeParentEntry.parent !== indexNodeParentEntry2.parent ||
        indexNodeParentEntry2.i !== indexNodeParentEntry.i + 1
      )
        continue;
      let changeAlias: Dynamic = resolveChangeAlias(mergeAdjacentMovesHandler2);
      if (resolveChangeAlias(mergeAdjacentMovesHandler3) !== changeAlias) {
        mergeAdjacentMovesHandler3.alias = changeAlias;
      }
    }
    for (let mergeAdjacentMovesResult of nodeChildren2 as Dynamic)
      resolveChangeAlias2(mergeAdjacentMovesResult);
  };
  resolveChangeAlias2(mergeAdjacentMoves2);
}
function removeRedundantMoveGhosts(
  removeRedundantMoveGhosts2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  if (!options.moves.size) return;
  let indexNodeParents2: Dynamic = indexNodeParents(removeRedundantMoveGhosts2);
  let uniqueItems: Dynamic = new (Set as Dynamic)();
  for (let [
    removeRedundantMoveGhostsResult,
    removeRedundantMoveGhostsResult2,
  ] of options.moves as Dynamic) {
    let indexNodeParentEntry: Dynamic = indexNodeParents2.get(
      removeRedundantMoveGhostsResult2.ghost,
    );
    if (indexNodeParentEntry === undefined) continue;
    let enabled: boolean = false;
    let indexNodeParentEntry2: Dynamic = indexNodeParents2.get(
      removeRedundantMoveGhostsResult2.move,
    );
    for (
      ;
      indexNodeParentEntry2 !== undefined &&
      indexNodeParentEntry2.parent !== indexNodeParentEntry.parent;

    ) {
      if (options.regionRoots.get(indexNodeParentEntry2.parent) === `ins`) {
        enabled = true;
      }
      indexNodeParentEntry2 = indexNodeParents2.get(
        indexNodeParentEntry2.parent,
      );
    }
    if (
      indexNodeParentEntry2 === undefined ||
      (!enabled &&
        !/^(Indented|Outdented)/.test(
          resolveChangeAlias(removeRedundantMoveGhostsResult).summary,
        )) ||
      (indexNodeParentEntry.parent.type === `listItem` &&
        indexNodeParentEntry.i === 0)
    )
      continue;
    let nodeChildren3: Dynamic = nodeChildren(indexNodeParentEntry.parent);
    let enabled2: boolean = true;
    for (
      let total: number =
        Math.min(indexNodeParentEntry2.i, indexNodeParentEntry.i) + 1;
      enabled2 &&
      total < Math.max(indexNodeParentEntry2.i, indexNodeParentEntry.i);
      total++
    )
      enabled2 = options.ghosts.has(nodeChildren3[total]);
    if (enabled2) {
      uniqueItems.add(removeRedundantMoveGhostsResult2.ghost);
    }
  }
  if (!uniqueItems.size) return;
  let nodeChildren2 = (
    node?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    let nodeChildren3: Dynamic = nodeChildren(node);
    if (
      nodeChildren3.some(
        (nodeChildren4?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          uniqueItems.has(nodeChildren4),
      )
    ) {
      node.content = nodeChildren3.filter(
        (nodeChildren4?: Dynamic, ..._extraArguments: unknown[]) =>
          !uniqueItems.has(nodeChildren4),
      );
    }
    for (let removeRedundantMoveGhostsResult of nodeChildren(node) as Dynamic)
      nodeChildren2(removeRedundantMoveGhostsResult);
  };
  nodeChildren2(removeRedundantMoveGhosts2);
}
function finalizeDocumentDiff(
  finalizeDocumentDiff2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items: Dynamic = [];
  let items2: Dynamic = [];
  let lookup: Dynamic = new (Map as Dynamic)();
  let uniqueItems: Dynamic = new (Set as Dynamic)(
    options.scopes.map(
      (scope?: Dynamic, ..._extraArguments: unknown[]): Dynamic => scope.node,
    ),
  );
  let uniqueItems2: Dynamic = new (Set as Dynamic)();
  let slice: Dynamic = (
    finalizeDocumentDiff3?: Dynamic,
    options2?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let changeAlias: Dynamic = resolveChangeAlias(finalizeDocumentDiff3);
    if (changeAlias.id === null) {
      changeAlias.id = `c${items.length + 1}`;
      changeAlias.path = items2.slice();
      items.push(changeAlias);
      if (options2) {
        uniqueItems2.add(changeAlias);
      }
    } else {
      if (options2 && !uniqueItems2.has(changeAlias)) {
        changeAlias.path = items2.slice();
        uniqueItems2.add(changeAlias);
      }
    }
    return changeAlias.id;
  };
  let slice2 = (node?: Dynamic, ..._extraArguments: unknown[]): undefined => {
    let originEntry: Dynamic =
      options.origin.get(node) ?? options.source.get(node) ?? node;
    if (uniqueItems.has(originEntry) && !lookup.has(originEntry)) {
      lookup.set(originEntry, items2.slice());
    }
    let nodeChEntry: Dynamic = options.nodeCh.get(node);
    if (nodeChEntry) {
      let itemsSlice: Dynamic = slice(nodeChEntry, options.primary.has(node));
      node.attrs = {
        ...node.attrs,
        [DIFF_ATTRIBUTE_NAMES.id]: itemsSlice,
        ...(options.ghosts.has(node)
          ? {
              [DIFF_ATTRIBUTE_NAMES.moveTo]: itemsSlice,
            }
          : {}),
      };
    }
    if (
      node.type === `text` &&
      node.marks?.some(
        (
          finalizeDocumentDiff3?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic => options.markCh.has(finalizeDocumentDiff3),
      )
    ) {
      node.marks = node.marks.map(
        (mark?: Dynamic, ..._extraArguments: unknown[]): Dynamic => {
          let markChEntry: Dynamic = options.markCh.get(mark);
          return markChEntry
            ? {
                type: mark.type,
                attrs: {
                  ...mark.attrs,
                  id: slice(markChEntry, false),
                },
              }
            : mark;
        },
      );
    }
    let content: Dynamic = node.content;
    if (Array.isArray(content))
      for (let index: number = 0; index < content.length; index++) {
        items2.push(index);
        slice2(content[index]);
        items2.pop();
      }
  };
  slice2(finalizeDocumentDiff2);
  let stats: Dynamic = emptyDiffStats();
  for (let entry of items as Dynamic) stats[entry.kind]++;
  return {
    changes: items.map(
      (entry?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
        id: entry.id,
        kind: entry.kind,
        nodeType: entry.nodeType,
        summary: entry.summary,
        path: entry.path ?? [],
      }),
    ),
    stats: stats,
    scopes: options.scopes.map(
      (scope?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
        reason: scope.reason,
        nodeType: scope.node.type,
        bid: nodeBlockId(scope.node),
        path: lookup.get(scope.node) ?? null,
      }),
    ),
  };
}
/* Subsystem: diff-worker */
function workerDiffOptions(
  workerDiffOptions2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let lookup: Dynamic =
    workerDiffOptions2.enums === undefined
      ? null
      : new (Map as Dynamic)(workerDiffOptions2.enums);
  return {
    ...(workerDiffOptions2.prevRuns
      ? {
          prevRuns: workerDiffOptions2.prevRuns,
        }
      : {}),
    ...(workerDiffOptions2.nextRuns
      ? {
          nextRuns: workerDiffOptions2.nextRuns,
        }
      : {}),
    ...(lookup
      ? {
          resolveEnum: (
            workerDiffOptions3?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic => lookup.get(workerDiffOptions3) ?? null,
        }
      : {}),
  };
}
function serializeDiffEnums(
  diffEnums?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let serializeDiffEnumsHandler: Dynamic = (
    diffEnums2?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    typeof diffEnums2 == `string`
      ? diffEnums2
      : typeof diffEnums2 == `object` &&
          diffEnums2 &&
          typeof diffEnums2.name == `string`
        ? diffEnums2.name
        : ``;
  return diffEnums.map(
    (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => [
      item.id,
      {
        name: item.name,
        options: item.options.map(serializeDiffEnumsHandler),
      },
    ],
  );
}
// BaoCut: restorer fix — 还原代码照抄了原版构建产物里 Vite 改写后的地址（`diffWorker-Dnf0Jf6P.js`，原包里同目录的 Worker 分块），
// 这里的构建不产出这个文件，Worker 加载失败，版本对比退回主线程计算。原版源码是 `new Worker(new URL(<worker 源文件>, import.meta.url), …)`，
// 改回这个写法，Vite 把 diff-worker.ts（就是从 diffWorker-Dnf0Jf6P.js 还原的）打成 Worker 分块。
var createDiffWorker: Dynamic = (..._extraArguments: unknown[]): Dynamic =>
  new Worker(new URL("../document-history/diff-worker.ts", import.meta.url), {
    type: `module`,
    name: `version-diff`,
  });
var diffWorkerFactory: Dynamic = createDiffWorker;
var diffWorker: Dynamic = null;
var diffWorkerUnavailable: boolean = false;
var nextDiffWorkerRequestId: number = 1;
var diffWorkerRequests: Dynamic = new (Map as Dynamic)();
function ensureDiffWorker(..._extraArguments: unknown[]): Dynamic {
  if (diffWorkerUnavailable) return null;
  if (diffWorker !== null) return diffWorker;
  if (diffWorkerFactory === createDiffWorker && typeof Worker === "undefined") {
    diffWorkerUnavailable = true;
    return null;
  }
  try {
    let diffWorkerFactory2: Dynamic = diffWorkerFactory();
    diffWorkerFactory2.addEventListener(
      `message`,
      (event?: Dynamic, ..._extraArguments: unknown[]): Dynamic => {
        let diffWorkerRequestEntry: Dynamic = diffWorkerRequests.get(
          event.data.id,
        );
        if (diffWorkerRequestEntry === undefined) return;
        diffWorkerRequests.delete(event.data.id);
        if (!event.data.ok) return diffWorkerRequestEntry.fallback();
        let ensureDiffWorkerResult: Dynamic;
        try {
          ensureDiffWorkerResult = JSON.parse(event.data.result);
        } catch {
          return diffWorkerRequestEntry.fallback();
        }
        diffWorkerRequestEntry.done(ensureDiffWorkerResult);
      },
    );
    diffWorkerFactory2.addEventListener(
      `error`,
      (..._extraArguments: unknown[]): undefined => {
        diffWorkerUnavailable = true;
        terminateDiffWorker();
      },
    );
    diffWorker = diffWorkerFactory2;
    return diffWorkerFactory2;
  } catch {
    diffWorkerUnavailable = true;
    return null;
  }
}
function terminateDiffWorker(..._extraArguments: unknown[]): undefined {
  diffWorker?.terminate();
  diffWorker = null;
  let items: Dynamic = [...diffWorkerRequests.values()];
  diffWorkerRequests.clear();
  for (let terminateDiffWorkerResult of items as Dynamic)
    terminateDiffWorkerResult.fallback();
}
function diffDocumentsAsync(
  diffDocumentsAsync2?: Dynamic,
  options?: Dynamic,
  context: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  let diffDocuments2: Dynamic = (..._extraArguments: unknown[]): Dynamic =>
    diffDocuments(diffDocumentsAsync2, options, workerDiffOptions(context));
  let ensureDiffWorker2: Dynamic = ensureDiffWorker();
  return ensureDiffWorker2 === null
    ? Promise.resolve().then(diffDocuments2)
    : new (Promise as Dynamic)(
        (
          done?: Dynamic,
          reject?: Dynamic,
          ..._extraArguments: unknown[]
        ): undefined => {
          let diffDocumentsAsyncResult: number = nextDiffWorkerRequestId++;
          let fallback = (..._extraArguments: unknown[]): undefined => {
            try {
              done(diffDocuments2());
            } catch (diffDocumentsAsyncResult2: Dynamic) {
              reject(diffDocumentsAsyncResult2);
            }
          };
          diffWorkerRequests.set(diffDocumentsAsyncResult, {
            done: done,
            fallback: fallback,
          });
          try {
            let record: Dynamic = {
              id: diffDocumentsAsyncResult,
              prev:
                diffDocumentsAsync2 === null
                  ? null
                  : JSON.stringify(diffDocumentsAsync2),
              curr: JSON.stringify(options),
              opts: JSON.stringify(context),
            };
            ensureDiffWorker2.postMessage(record);
          } catch {
            diffWorkerRequests.delete(diffDocumentsAsyncResult);
            fallback();
          }
        },
      );
}
var MAX_WIDGET_CODE_BYTES: number = 2 * 1024 * 1024;
var MAX_WIDGET_CODE_PAIR_BYTES: number = 4 * 1024 * 1024;
var MAX_WIDGET_CODE_CHARACTERS: number = 45e4;
var MAX_CODE_LINE_CHARACTERS: number = 2e3;
var OPEN_ENDED_SEQUENCE: number = 2 ** 53 - 1;
var MAX_CODE_LINE_PAIR_CELLS: number = 4e6;
var MAX_EMBED_DELTA_CACHE_ENTRIES: number = 256;
var EMBED_NODE_TYPES: Dynamic = new (Set as Dynamic)([`embed`, `embedInline`]);
var WIDGET_HISTORY_VERBS: Dynamic = new (Set as Dynamic)([
  `create`,
  `update`,
  `delete`,
]);
var EMBED_HISTORY_REFUSAL_REASONS: Dynamic = new (Set as Dynamic)([
  `forbidden`,
  `access`,
  `not_found`,
  `gone`,
  `unknown_id`,
  `unavailable`,
  `ledger-busy`,
  `answer-too-large`,
  `bad_request`,
  `internal`,
]);
var embedHistoryRefusalReason: Dynamic = (
  embedHistoryRefusalReason2?: Dynamic,
  ..._extraArguments: unknown[]
): string =>
  typeof embedHistoryRefusalReason2 == `string` &&
  EMBED_HISTORY_REFUSAL_REASONS.has(embedHistoryRefusalReason2)
    ? embedHistoryRefusalReason2
    : `denied`;
var createEmbedDeltaCache: Dynamic = (
  ..._extraArguments: unknown[]
): Dynamic => ({
  entries: new (Map as Dynamic)(),
});
/* Subsystem: embed-history */
function getCachedEmbedDelta(
  cachedEmbedDelta?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let entryEntry: Dynamic = cachedEmbedDelta?.entries.get(options);
  if (entryEntry !== undefined) {
    cachedEmbedDelta.entries.delete(options);
    cachedEmbedDelta.entries.set(options, entryEntry);
    return entryEntry;
  }
}
function cacheEmbedDelta(
  cacheEmbedDelta2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  if (cacheEmbedDelta2 !== undefined) {
    cacheEmbedDelta2.entries.delete(options);
    cacheEmbedDelta2.entries.set(options, context);
    if (cacheEmbedDelta2.entries.size > MAX_EMBED_DELTA_CACHE_ENTRIES) {
      cacheEmbedDelta2.entries.delete(
        cacheEmbedDelta2.entries.keys().next().value,
      );
    }
  }
}
var isEmbedHistoryObject: Dynamic = (
  embedHistoryObject?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  typeof embedHistoryObject == `object` &&
  !!embedHistoryObject &&
  !Array.isArray(embedHistoryObject);
var stringValue: Dynamic = (
  stringValue2?: Dynamic,
  ..._extraArguments: unknown[]
): string | undefined => (typeof stringValue2 == `string` ? stringValue2 : undefined);
async function mapWithConcurrency(
  items?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let items2: Dynamic = [];
  let index: number = 0;
  await Promise.all(
    Array.from<Dynamic, Dynamic>(
      {
        length: Math.min(options, items.length),
      },
      async (..._extraArguments: unknown[]): Promise<undefined> => {
        for (; index < items.length; ) {
          let mapWithConcurrencyResult: number = index++;
          items2[mapWithConcurrencyResult] = await context(
            items[mapWithConcurrencyResult],
          );
        }
      },
    ),
  );
  return items2;
}
function embeddedNodeReference(
  embeddedNodeReference2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (!EMBED_NODE_TYPES.has(embeddedNodeReference2.type)) return;
  let ref: Dynamic = embeddedNodeReference2.attrs?.ref;
  if (
    !(
      typeof ref != `string` ||
      resolvePlatformSessionAndSourcesNode(ref) === undefined
    )
  )
    return {
      ref: ref,
      legacy: !ref.startsWith(`node/`),
    };
}
var isDeletedEmbedNode = (
  deletedEmbedNode?: Dynamic,
  ..._extraArguments: unknown[]
) => deletedEmbedNode.attrs?.[DIFF_ATTRIBUTE_NAMES.kind] === `del`;
var isNodeReference: Dynamic = (
  nodeReference?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  nodeReference.startsWith(`node/`) &&
  resolvePlatformSessionAndSourcesNode(nodeReference) !== undefined;
function collectDiffEmbedReferences(
  collectDiffEmbedReferences2?: Dynamic,
  options: Dynamic = 10,
  ..._extraArguments: unknown[]
): Dynamic {
  let uniqueItems: Dynamic = new (Set as Dynamic)();
  let refs: Dynamic = [];
  let legacy: Dynamic = [];
  let truncated: boolean = false;
  let embeddedNodeReference2 = (
    node?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (isDeletedEmbedNode(node)) return;
    let embeddedNodeReference3: Dynamic = embeddedNodeReference(node);
    if (
      embeddedNodeReference3 !== undefined &&
      !uniqueItems.has(embeddedNodeReference3.ref)
    ) {
      uniqueItems.add(embeddedNodeReference3.ref);
      if (embeddedNodeReference3.legacy) {
        legacy.push(embeddedNodeReference3.ref);
      } else {
        if (refs.length < options) {
          refs.push(embeddedNodeReference3.ref);
        } else {
          truncated = true;
        }
      }
    }
    if (Array.isArray(node.content))
      for (let collectDiffEmbedReferencesResult of node.content as Dynamic)
        embeddedNodeReference2(collectDiffEmbedReferencesResult);
  };
  embeddedNodeReference2(collectDiffEmbedReferences2);
  return {
    refs: refs,
    truncated: truncated,
    legacy: legacy,
  };
}
var versionRowNumber: Dynamic = (
  versionRowNumber2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): number | undefined => {
  let paramItem: Dynamic = versionRowNumber2.params[options];
  return typeof paramItem == `number` ? paramItem : undefined;
};
var versionRowUpto: Dynamic = (
  versionRowUpto2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => versionRowNumber(versionRowUpto2, `upto`);
var versionRowHeadSequence: Dynamic = (
  versionRowHeadSequence2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  versionRowNumber(versionRowHeadSequence2, `headSeq`) ??
  versionRowUpto(versionRowHeadSequence2);
function versionSequenceRange(
  versionSequenceRange2?: Dynamic,
  options?: Dynamic,
  context: Dynamic = `previous`,
  ..._extraArguments: unknown[]
): Dynamic {
  let versionSequenceRange3: Dynamic = versionSequenceRange2.find(
    (item?: Dynamic, ..._extraArguments: unknown[]) =>
      `upto` in options
        ? versionRowUpto(item) === options.upto
        : resolvePlatformLiveDocumentAndHistoryParams2(item) === options.rev,
  );
  let versionRowUpto2: Dynamic =
    versionSequenceRange3 === undefined
      ? undefined
      : versionRowUpto(versionSequenceRange3);
  let seqA: Dynamic =
    versionSequenceRange3 === undefined
      ? undefined
      : versionRowHeadSequence(versionSequenceRange3);
  if (versionRowUpto2 === undefined || seqA === undefined) return null;
  if (context === `current`)
    return {
      seqA: seqA,
      seqB: OPEN_ENDED_SEQUENCE,
    };
  let versionSequenceRangeResult: Dynamic;
  let enabled: boolean = true;
  for (let versionSequenceRangeResult2 of versionSequenceRange2 as Dynamic) {
    let versionRowUpto3: Dynamic = versionRowUpto(versionSequenceRangeResult2);
    if (versionRowUpto3 !== undefined) {
      if (versionRowUpto3 > versionRowUpto2) {
        enabled = false;
      } else {
        if (
          versionRowUpto3 < versionRowUpto2 &&
          (versionSequenceRangeResult === undefined ||
            versionRowUpto3 > versionRowUpto(versionSequenceRangeResult))
        ) {
          versionSequenceRangeResult = versionSequenceRangeResult2;
        }
      }
    }
  }
  let difference: Dynamic =
    versionRowNumber(versionSequenceRange3, `headSeq`) !== undefined &&
    versionRowUpto2 > 0
      ? versionRowUpto2 - 1
      : undefined;
  let seqA2: Dynamic =
    versionSequenceRangeResult === undefined
      ? difference
      : versionRowHeadSequence(versionSequenceRangeResult);
  return seqA2 === undefined
    ? null
    : {
        seqA: seqA2,
        seqB: seqA,
        ...(enabled
          ? {
              openTail: true,
            }
          : {}),
      };
}
function parseNodeHistoryEntry(
  activity?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (
    !(
      !isEmbedHistoryObject(activity) ||
      typeof activity.rev != `number` ||
      typeof activity.verb != `string`
    )
  )
    return {
      rev: activity.rev,
      verb: activity.verb,
      ...(typeof activity.at == `string`
        ? {
            at: activity.at,
          }
        : {}),
      ...(typeof activity.by == `string`
        ? {
            by: activity.by,
          }
        : {}),
      ...(typeof activity.object == `string`
        ? {
            object: activity.object,
          }
        : {}),
      ...(typeof activity.id == `string`
        ? {
            id: activity.id,
          }
        : {}),
      ...(typeof activity.engine == `string`
        ? {
            engine: activity.engine,
          }
        : {}),
      payloadBytes:
        typeof activity.payloadBytes == `number` ? activity.payloadBytes : 0,
      ...(`src` in activity
        ? {
            src: activity.src,
          }
        : {}),
    };
}
function parseNodeHistoryResponse(
  nodeHistoryResponse?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let body: Dynamic = nodeHistoryResponse.body;
  if (!isEmbedHistoryObject(body))
    return {
      ok: false,
      reason: `malformed`,
    };
  if (body.verdict !== `allow`)
    return {
      ok: false,
      reason: embedHistoryRefusalReason(body.reason),
    };
  if (!Array.isArray(body.items))
    return {
      ok: false,
      reason: `malformed`,
    };
  let items: Dynamic = [];
  for (let parseNodeHistoryResponseResult of body.items as Dynamic) {
    let nodeHistoryEntry: Dynamic = parseNodeHistoryEntry(
      parseNodeHistoryResponseResult,
    );
    if (nodeHistoryEntry === undefined)
      return {
        ok: false,
        reason: `malformed`,
      };
    items.push(nodeHistoryEntry);
  }
  return {
    ok: true,
    items: items,
    complete: body.complete === true,
  };
}
async function queryNodeHistory(
  queryNodeHistory2?: Dynamic,
  under?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  limit?: Dynamic,
  argument?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let where: Dynamic = {};
  if (context !== null) {
    where.since = context;
  }
  if (dependencies) {
    where.include = [`src`];
  }
  let queryNodeHistoryResult: Dynamic;
  try {
    queryNodeHistoryResult = queryNodeHistory2
      .call(`query`, {
        object: `node`,
        under: under,
        where: where,
        limit: limit,
      })
      .then(
        parseNodeHistoryResponse,
        (..._extraArguments: unknown[]): Dynamic => ({
          ok: false,
          reason: `transport`,
        }),
      );
  } catch {
    return {
      ok: false,
      reason: `transport`,
    };
  }
  let { schedule: argument2 }: Dynamic = argument;
  return argument2 === undefined
    ? queryNodeHistoryResult
    : new (Promise as Dynamic)(
        (resolve?: Dynamic, ..._extraArguments: unknown[]): undefined => {
          let enabled: boolean = false;
          let argument3: Dynamic = argument2(
            (..._extraArguments: unknown[]): undefined => {
              if (!enabled) {
                enabled = true;
                resolve({
                  ok: false,
                  reason: `timeout`,
                });
              }
            },
            argument.timeoutMs ?? 15e3,
          );
          queryNodeHistoryResult.then(
            (result?: Dynamic, ..._extraArguments: unknown[]): undefined => {
              if (!enabled) {
                enabled = true;
                argument3();
                resolve(result);
              }
            },
          );
        },
      );
}
async function readNodeHistoryPages(
  nodeHistoryPages?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  argument2?: Dynamic,
  argument3?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let optionsSlice: Dynamic = options.slice(5);
  let items: Dynamic = [];
  let count: number = 0;
  let context2: Dynamic = context;
  let count2: number = argument ? 16 : 256;
  let index: number = 0;
  for (
    let index2: number = 0;
    index2 < 64 && index < (argument ? 64 : 16);
    index2++
  ) {
    let queryNodeHistory2: Dynamic = await queryNodeHistory(
      nodeHistoryPages,
      options,
      context2,
      argument,
      count2,
      argument2,
    );
    if (!queryNodeHistory2.ok) {
      if (queryNodeHistory2.reason === `answer-too-large` && count2 > 1) {
        count2 = Math.max(1, Math.floor(count2 / 2));
        continue;
      }
      return queryNodeHistory2;
    }
    index++;
    let context3: Dynamic = context2 ?? -1;
    for (let readNodeHistoryPagesResult of queryNodeHistory2.items as Dynamic) {
      if (
        readNodeHistoryPagesResult.rev <= context3 ||
        readNodeHistoryPagesResult.id === undefined
      )
        return {
          ok: false,
          reason: `malformed`,
        };
      context3 = readNodeHistoryPagesResult.rev;
      if (readNodeHistoryPagesResult.rev > dependencies)
        return {
          ok: true,
          items: items,
          capped: false,
          overBudget: false,
        };
      if (
        !(
          readNodeHistoryPagesResult.object !== `node` ||
          readNodeHistoryPagesResult.id !== optionsSlice ||
          !WIDGET_HISTORY_VERBS.has(readNodeHistoryPagesResult.verb)
        ) &&
        (items.push(readNodeHistoryPagesResult),
        (count += readNodeHistoryPagesResult.payloadBytes),
        argument3 !== undefined &&
          (items.length > argument3.rows || count > argument3.bytes))
      )
        return {
          ok: true,
          items: items,
          capped: false,
          overBudget: true,
        };
    }
    if (
      queryNodeHistory2.complete ||
      queryNodeHistory2.items.length === 0 ||
      context3 >= dependencies
    )
      return {
        ok: true,
        items: items,
        capped: false,
        overBudget: false,
      };
    context2 = context3;
  }
  return {
    ok: true,
    items: items,
    capped: true,
    overBudget: false,
  };
}
function classifyWidgetHistoryEntry(
  classifyWidgetHistoryEntry2?: Dynamic,
  ..._extraArguments: unknown[]
) {
  if (classifyWidgetHistoryEntry2.verb === `delete`) return `removed`;
  let src: Dynamic = classifyWidgetHistoryEntry2.src;
  if (!isEmbedHistoryObject(src)) return `unknown`;
  if (classifyWidgetHistoryEntry2.verb === `create`)
    return src.landed === `live`
      ? `published`
      : src.landed === `draft` ||
          stringValue(src.code) === undefined ||
          src.code === ``
        ? `draft`
        : `unknown`;
  if (classifyWidgetHistoryEntry2.verb !== `update`) return `unknown`;
  switch (resolveDataOperationEngineKind2(src)) {
    case `publish`:
    case `text`:
    case `chart-title`:
    case `spec-patch`:
    case `definition`:
      return `published`;
    case `draft`:
      return src.landed === `live`
        ? `published`
        : src.landed === `draft` || src.state === `draft`
          ? `draft`
          : `unknown`;
    case `draft-edit`:
    case `text-draft`:
    case `chart-title-draft`:
    case `revert`:
      return `draft`;
    default:
      return `unknown`;
  }
}
function emptyEmbedDelta(
  emptyEmbedDelta2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return {
    ref: emptyEmbedDelta2,
    engine: null,
    rows: 0,
    authors: [],
    firstAt: null,
    lastAt: null,
    kind: `none`,
    publishes: 0,
    detailsUnavailable: false,
    born: false,
    deleted: false,
  };
}
function summarizeEmbedDelta(
  summarizeEmbedDelta2?: Dynamic,
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let authors: Dynamic = [];
  for (let summarizeEmbedDeltaResult of items as Dynamic)
    if (
      summarizeEmbedDeltaResult.by !== undefined &&
      !authors.includes(summarizeEmbedDeltaResult.by)
    ) {
      authors.push(summarizeEmbedDeltaResult.by);
    }
  return {
    ...emptyEmbedDelta(summarizeEmbedDelta2),
    engine:
      items.find(
        (item?: Dynamic, ..._extraArguments: unknown[]) =>
          item.engine !== undefined,
      )?.engine ?? null,
    rows: items.length,
    authors: authors,
    firstAt:
      items.find(
        (activity?: Dynamic, ..._extraArguments: unknown[]) =>
          activity.at !== undefined,
      )?.at ?? null,
    lastAt:
      items.findLast(
        (activity?: Dynamic, ..._extraArguments: unknown[]) =>
          activity.at !== undefined,
      )?.at ?? null,
    kind: items.length > 0 ? `changed` : `none`,
    born: items.some(
      (item?: Dynamic, ..._extraArguments: unknown[]) => item.verb === `create`,
    ),
    deleted: items.some(
      (item?: Dynamic, ..._extraArguments: unknown[]) => item.verb === `delete`,
    ),
  };
}
var isValidSequenceRange: Dynamic = (
  validSequenceRange?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  Number.isSafeInteger(validSequenceRange) &&
  Number.isSafeInteger(options) &&
  validSequenceRange >= 0 &&
  options >= validSequenceRange;
async function readEmbedDelta(
  door?: Dynamic,
  ref?: Dynamic,
  beforeSeq?: Dynamic,
  afterSeq?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let unknownDelta: Dynamic = (
    reason?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => ({
    d: {
      ...emptyEmbedDelta(ref),
      kind: `unknown`,
      reason: reason,
    },
    settled: false,
  });
  if (!isValidSequenceRange(beforeSeq, afterSeq)) return unknownDelta(`range`);
  if (beforeSeq === afterSeq)
    return {
      d: emptyEmbedDelta(ref),
      settled: true,
    };
  let history: Dynamic = await readNodeHistoryPages(
    door,
    ref,
    beforeSeq,
    afterSeq,
    false,
    options,
  );
  if (!(history as Dynamic).ok)
    return unknownDelta((history as Dynamic).reason);
  if ((history as Dynamic).items.length === 0)
    return (history as Dynamic).capped
      ? unknownDelta(`capped`)
      : {
          d: emptyEmbedDelta(ref),
          settled: true,
        };
  let delta: Dynamic = summarizeEmbedDelta(ref, (history as Dynamic).items);
  if (delta.engine !== `widget` || options.classify !== true)
    return {
      d: delta,
      settled: true,
    };
  let unavailableDetails: Dynamic = (
    settled?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => ({
    d: {
      ...delta,
      detailsUnavailable: true,
    },
    settled: settled,
  });
  let payloadBytes: Dynamic = (history as Dynamic).items.reduce(
    (
      accumulator?: Dynamic,
      item?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => accumulator + item.payloadBytes,
    0,
  );
  if (
    (history as Dynamic).capped ||
    (history as Dynamic).items.length > 64 ||
    payloadBytes > 2097152
  )
    return unavailableDetails(true);
  let fullHistory: Dynamic = await readNodeHistoryPages(
    door,
    ref,
    beforeSeq,
    afterSeq,
    true,
    options,
    {
      rows: 64,
      bytes: MAX_WIDGET_CODE_BYTES,
    },
  );
  if (!fullHistory.ok) return unavailableDetails(false);
  if (fullHistory.overBudget || fullHistory.capped)
    return unavailableDetails(true);
  let byRevision: Dynamic = new (Map as Dynamic)(
    fullHistory.items.map(
      (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => [
        item.rev,
        item,
      ],
    ),
  );
  let completeItems: Dynamic = (history as Dynamic).items.map(
    (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      byRevision.get(item.rev),
  );
  if (
    completeItems.some(
      (completeItem?: Dynamic, ..._extraArguments: unknown[]) =>
        completeItem === undefined,
    )
  )
    return unavailableDetails(false);
  let publishedCount: number = 0;
  let codeChangeCount: number = 0;
  let attributeChangeCount: number = 0;
  for (let readEmbedDeltaResult of completeItems as Dynamic) {
    let classifyWidgetHistoryEntry2: string =
      classifyWidgetHistoryEntry(readEmbedDeltaResult);
    if (classifyWidgetHistoryEntry2 === `published`) {
      publishedCount++;
    } else {
      if (classifyWidgetHistoryEntry2 === `unknown`) {
        codeChangeCount++;
      } else {
        if (classifyWidgetHistoryEntry2 === `removed`) {
          attributeChangeCount++;
        }
      }
    }
  }
  let widgetChangeKind: string =
    publishedCount > 0
      ? `published`
      : codeChangeCount > 0 || attributeChangeCount > 0
        ? `changed`
        : `draft-only`;
  return {
    d: {
      ...delta,
      kind: widgetChangeKind,
      publishes: publishedCount,
      detailsUnavailable: codeChangeCount > 0,
    },
    settled: true,
  };
}
async function readEmbedDeltas(
  embedDeltas?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument: Dynamic = {},
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let matchesDependencies: boolean = dependencies !== OPEN_ENDED_SEQUENCE;
  let mapWithConcurrency2: Dynamic = await mapWithConcurrency(
    options,
    2,
    async (
      embedDeltas2?: Dynamic,
      ..._extraArguments: unknown[]
    ): Promise<Dynamic> => {
      let label: string = `delta ${embedDeltas2} ${context} ${dependencies} ${+(argument.classify === true)}`;
      let cachedEmbedDelta: Dynamic = matchesDependencies
        ? getCachedEmbedDelta(argument.cache, label)
        : undefined;
      if (cachedEmbedDelta !== undefined) return cachedEmbedDelta;
      let { d: result, settled: result2 }: Dynamic = await readEmbedDelta(
        embedDeltas,
        embedDeltas2,
        context,
        dependencies,
        argument,
      ).catch(
        (..._extraArguments: unknown[]): Dynamic => ({
          d: {
            ...emptyEmbedDelta(embedDeltas2),
            kind: `unknown`,
            reason: `transport`,
          },
          settled: false,
        }),
      );
      if (matchesDependencies && result2) {
        cacheEmbedDelta(argument.cache, label, result);
      }
      return result;
    },
  );
  return new (Map as Dynamic)(
    options.map(
      (
        item?: Dynamic,
        index?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => [item, mapWithConcurrency2[index]],
    ),
  );
}
var EMBED_ENGINE_LABELS: Dynamic = new (Map as Dynamic)([
  [`prose`, `Embedded page`],
  [`text`, `Embedded text`],
  [`blob`, `Embedded file`],
]);
var embedEngineLabel: Dynamic = (
  embedEngineLabel2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  embedEngineLabel2.engine === `widget`
    ? `Widget`
    : ((embedEngineLabel2.engine === null
        ? undefined
        : EMBED_ENGINE_LABELS.get(embedEngineLabel2.engine)) ??
      `Embedded content`);
var collaboratorName: Dynamic = (
  collaboratorName2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => resolveEditorAnchorsAndMentionsEmail(collaboratorName2);
var MAX_AUTHOR_NAMES: number = 3;
function joinAuthorNames(
  joinAuthorNames2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items: Dynamic = [];
  let index: number = 0;
  for (let joinAuthorNamesResult of joinAuthorNames2 as Dynamic) {
    let trimmedOptions: Dynamic = options(joinAuthorNamesResult).trim();
    if (trimmedOptions === `` || trimmedOptions === `Someone`) {
      index++;
    } else {
      if (!items.includes(trimmedOptions)) {
        items.push(trimmedOptions);
      }
    }
  }
  if (items.length === 0)
    return index === 0
      ? ``
      : index === 1
        ? `a collaborator`
        : `${index} collaborators`;
  let itemsSlice: Dynamic = items.slice(0, MAX_AUTHOR_NAMES);
  let total: Dynamic = items.length - itemsSlice.length + index;
  return total === 0
    ? itemsSlice.join(`, `)
    : `${itemsSlice.join(`, `)} and ${total} other${total === 1 ? `` : `s`}`;
}
function embedDeltaSummary(entry?: Dynamic, ..._extraArguments: unknown[]) {
  if (entry.engine !== `widget`)
    return `${embedEngineLabel(entry)} ${entry.deleted ? `deleted` : entry.born ? `created` : `changed`}`;
  if (entry.deleted) return `Widget deleted`;
  if (entry.born)
    return entry.kind === `draft-only`
      ? `Widget created (not published)`
      : `Widget created`;
  switch (entry.kind) {
    case `published`:
      return `Widget updated — published code changed${entry.publishes > 1 ? ` (${entry.publishes} publishes)` : ``}`;
    case `draft-only`:
      return `Widget draft edited — not published`;
    default:
      return entry.detailsUnavailable
        ? `Widget changed (details unavailable)`
        : `Widget changed`;
  }
}
function embedDeltaSummaryWithAuthors(
  embedDeltaSummary2?: Dynamic,
  options: Dynamic = collaboratorName,
  ..._extraArguments: unknown[]
): string {
  let joinAuthorNames2: Dynamic = joinAuthorNames(
    embedDeltaSummary2.authors,
    options,
  );
  let embedDeltaSummary3: string = embedDeltaSummary(embedDeltaSummary2);
  return joinAuthorNames2 === ``
    ? embedDeltaSummary3
    : `${embedDeltaSummary3} · by ${joinAuthorNames2}`;
}
var isPublishedWidgetDelta: Dynamic = (
  entry?: Dynamic,
  ..._extraArguments: unknown[]
): boolean => entry.kind === `published` || entry.kind === `changed`;
var compareNodePaths: Dynamic = (
  items?: Dynamic,
  items2?: Dynamic,
  ..._extraArguments: unknown[]
): number => {
  for (
    let index: number = 0;
    index < Math.min(items.length, items2.length);
    index++
  )
    if (items[index] !== items2[index]) return items[index] - items2[index];
  return items.length - items2.length;
};
function mergeEmbedDeltasIntoDiff(
  mergeEmbedDeltasIntoDiff2?: Dynamic,
  options?: Dynamic,
  context: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  let nameOf: Dynamic = context.nameOf ?? collaboratorName;
  let count: number = 1;
  for (let mergeEmbedDeltasIntoDiffResult of mergeEmbedDeltasIntoDiff2.changes as Dynamic) {
    let match: Dynamic = /^c(\d+)$/.exec(mergeEmbedDeltasIntoDiffResult.id);
    if (match) {
      count = Math.max(count, Number(match[1]) + 1);
    }
  }
  let lookup: Dynamic = new (Map as Dynamic)(
    mergeEmbedDeltasIntoDiff2.changes.map(
      (change?: Dynamic, ..._extraArguments: unknown[]): Dynamic => [
        change.id,
        change,
      ],
    ),
  );
  let items: Dynamic = [];
  let lookup2: Dynamic = new (Map as Dynamic)();
  let annotations: Dynamic = [];
  let lookup3: Dynamic = new (Map as Dynamic)();
  let endsWith: Dynamic = (
    mergeEmbedDeltasIntoDiff3?: Dynamic,
    options2?: Dynamic,
    context2?: Dynamic,
    path?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    if (context2) {
      if (!lookup3.has(options2)) {
        lookup3.set(options2, `legacy-ref`);
      }
      return mergeEmbedDeltasIntoDiff3;
    }
    let attrs: Dynamic = mergeEmbedDeltasIntoDiff3.attrs ?? {};
    let attrItem: Dynamic = attrs[DIFF_ATTRIBUTE_NAMES.kind];
    let delta: Dynamic = options.get(options2);
    if (delta === undefined || delta.kind === `unknown`) {
      if (!lookup3.has(options2)) {
        lookup3.set(options2, delta?.reason ?? `not-read`);
      }
      return mergeEmbedDeltasIntoDiff3;
    }
    if (delta.kind === `none`) return mergeEmbedDeltasIntoDiff3;
    let block: boolean = mergeEmbedDeltasIntoDiff3.type === `embed`;
    if (attrItem == null) {
      let diffId2: string = `c${count++}`;
      let summary: Dynamic = embedDeltaSummaryWithAuthors(delta, nameOf);
      items.push({
        id: diffId2,
        kind: `chg`,
        nodeType: mergeEmbedDeltasIntoDiff3.type,
        summary: summary,
        path: path,
      });
      annotations.push({
        diffId: diffId2,
        ref: options2,
        block: block,
        delta: delta,
      });
      return {
        ...mergeEmbedDeltasIntoDiff3,
        attrs: {
          ...attrs,
          [DIFF_ATTRIBUTE_NAMES.kind]: `chg`,
          [DIFF_ATTRIBUTE_NAMES.id]: diffId2,
          [DIFF_ATTRIBUTE_NAMES.summary]: summary,
        },
      };
    }
    if (!isPublishedWidgetDelta(delta) || (attrItem === `ins` && delta.born))
      return mergeEmbedDeltasIntoDiff3;
    let diffId: Dynamic = attrs[DIFF_ATTRIBUTE_NAMES.id];
    if (typeof diffId != `string`) return mergeEmbedDeltasIntoDiff3;
    let label: string = `${embedEngineLabel(delta).toLowerCase()} also changed`;
    let stringValue2: Dynamic =
      stringValue(attrs[DIFF_ATTRIBUTE_NAMES.summary]) ??
      lookup2.get(diffId) ??
      lookup.get(diffId)?.summary ??
      `Embed changed`;
    let stringValue3: Dynamic = stringValue2.endsWith(label)
      ? stringValue2
      : `${stringValue2} · ${label}`;
    if (!lookup2.has(diffId)) {
      lookup2.set(diffId, stringValue3);
    }
    annotations.push({
      diffId: diffId,
      ref: options2,
      block: block,
      delta: delta,
    });
    return {
      ...mergeEmbedDeltasIntoDiff3,
      attrs: {
        ...attrs,
        [DIFF_ATTRIBUTE_NAMES.summary]: stringValue3,
      },
    };
  };
  let slice: Dynamic = (
    node?: Dynamic,
    options2?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    if (isDeletedEmbedNode(node)) return node;
    let embeddedNodeReference2: Dynamic = embeddedNodeReference(node);
    if (embeddedNodeReference2 !== undefined)
      return endsWith(
        node,
        embeddedNodeReference2.ref,
        embeddedNodeReference2.legacy,
        options2,
      );
    let content: Dynamic = node.content;
    if (!Array.isArray(content)) return node;
    let content2: Dynamic = null;
    for (let index: number = 0; index < content.length; index++) {
      let itemsSlice: Dynamic = slice(content[index], [...options2, index]);
      if (itemsSlice !== content[index]) {
        (content2 ??= content.slice())[index] = itemsSlice;
      }
    }
    return content2 === null
      ? node
      : {
          ...node,
          content: content2,
        };
  };
  let doc: Dynamic = slice(mergeEmbedDeltasIntoDiff2.doc, []);
  let changes: Dynamic = mergeEmbedDeltasIntoDiff2.changes.map(
    (change?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      lookup2.has(change.id)
        ? {
            ...change,
            summary: lookup2.get(change.id),
          }
        : change,
  );
  for (let mergeEmbedDeltasIntoDiffResult of items as Dynamic) {
    let changeIndex: Dynamic = changes.findIndex(
      (change?: Dynamic, ..._extraArguments: unknown[]) =>
        compareNodePaths(change.path, mergeEmbedDeltasIntoDiffResult.path) > 0,
    );
    if (changeIndex < 0) {
      changes.push(mergeEmbedDeltasIntoDiffResult);
    } else {
      changes.splice(changeIndex, 0, mergeEmbedDeltasIntoDiffResult);
    }
  }
  let stats: Dynamic = mergeEmbedDeltasIntoDiff2.stats;
  return {
    ...mergeEmbedDeltasIntoDiff2,
    doc: doc,
    changes: changes,
    ...(isEmbedHistoryObject(stats) && typeof stats.chg == `number`
      ? {
          stats: {
            ...stats,
            chg: stats.chg + items.length,
          },
        }
      : {}),
    annotations: annotations,
    unchecked: [...lookup3.keys()],
    uncheckedWhy: [...lookup3].map(
      ([item, reason]: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
        ref: item,
        reason: reason,
      }),
    ),
  };
}
function replayWidgetHistoryEntry(
  error?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let src: Dynamic = options.src;
  if (!isEmbedHistoryObject(src)) return `no-src`;
  if (options.verb === `create`) {
    if (src.code !== undefined && typeof src.code != `string`) return `shape`;
    let stringValue2: Dynamic = stringValue(src.code) ?? ``;
    if (stringValue2 === ``)
      return {
        code: ``,
        draft: null,
      };
    let code: Dynamic = stringValue(src.materialized) ?? stringValue2;
    return src.landed === `live`
      ? {
          code: code,
          draft: null,
        }
      : src.landed === `draft`
        ? {
            code: ``,
            draft: code,
          }
        : `unstamped-create`;
  }
  if (error === null) return `history-starts-mid-life`;
  if (options.verb === `delete`) return `deleted`;
  if (options.verb !== `update`) return `unknown-verb`;
  switch (resolveDataOperationEngineKind2(src)) {
    case `draft`: {
      let stringValue2: Dynamic = stringValue(src.code);
      if (stringValue2 === undefined) return `shape`;
      let code: Dynamic = stringValue(src.materialized) ?? stringValue2;
      return src.landed === `live`
        ? {
            code: code,
            draft: null,
          }
        : src.landed === `draft` || src.state === `draft`
          ? {
              code: error.code,
              draft: code,
            }
          : `unstamped-draft`;
    }
    case `publish`:
      return error.draft === null
        ? `publish-without-draft`
        : {
            code: error.draft,
            draft: null,
          };
    case `revert`:
      return {
        code: error.code,
        draft: null,
      };
    case `text`:
    case `chart-title`:
    case `spec-patch`:
    case `definition`: {
      let code: Dynamic = stringValue(src.spliced);
      return code === undefined
        ? `unstamped`
        : {
            code: code,
            draft: stringValue(src.splicedDraft) ?? null,
          };
    }
    case `text-draft`:
    case `chart-title-draft`: {
      let draft: Dynamic = stringValue(src.spliced);
      return draft === undefined
        ? `unstamped`
        : {
            code: error.code,
            draft: draft,
          };
    }
    case `draft-edit`: {
      let draft: Dynamic = stringValue(src.edited);
      return draft === undefined
        ? `unstamped`
        : {
            code: error.code,
            draft: draft,
          };
    }
    default:
      return `unknown-arm`;
  }
}
function widgetCodeAtSequence(
  widgetCode?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let error: Dynamic = null;
  for (let widgetCodeAtSequenceResult of widgetCode.toSorted(
    (item?: Dynamic, item2?: Dynamic, ..._extraArguments: unknown[]): number =>
      item.rev - item2.rev,
  ) as Dynamic) {
    if (widgetCodeAtSequenceResult.rev > options) break;
    if (!WIDGET_HISTORY_VERBS.has(widgetCodeAtSequenceResult.verb)) continue;
    let why: Dynamic = replayWidgetHistoryEntry(
      error,
      widgetCodeAtSequenceResult,
    );
    if (typeof why == `string`)
      return {
        ok: false,
        why: why,
      };
    error = why;
  }
  return error === null
    ? {
        ok: false,
        why: `not-born`,
      }
    : {
        ok: true,
        code: error.code,
      };
}
async function readWidgetCodePair(
  widgetCodePair?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument: Dynamic = {},
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  if (!isNodeReference(options))
    return {
      ok: false,
      why: `unavailable`,
    };
  if (!isValidSequenceRange(context, dependencies))
    return {
      ok: false,
      why: `range`,
    };
  let label: string = `code ${options} ${context} ${dependencies}`;
  let matchesDependencies: boolean = dependencies !== OPEN_ENDED_SEQUENCE;
  let cachedEmbedDelta: Dynamic = matchesDependencies
    ? getCachedEmbedDelta(argument.cache, label)
    : undefined;
  if (cachedEmbedDelta !== undefined) return cachedEmbedDelta;
  let result: Dynamic = await readNodeHistoryPages(
    widgetCodePair,
    options,
    null,
    dependencies,
    true,
    argument,
    {
      rows: 256,
      bytes: MAX_WIDGET_CODE_PAIR_BYTES,
    },
  ).catch(
    (..._extraArguments: unknown[]): Dynamic => ({
      ok: false,
      reason: `transport`,
    }),
  );
  if (!result.ok)
    return {
      ok: false,
      why: result.reason,
    };
  if (result.overBudget || result.capped)
    return {
      ok: false,
      why: `over-budget`,
    };
  let widgetCodeAtSequence2: Dynamic = widgetCodeAtSequence(
    result.items,
    dependencies,
  );
  if (!widgetCodeAtSequence2.ok)
    return {
      ok: false,
      why: widgetCodeAtSequence2.why,
    };
  let widgetCodeAtSequence3: Dynamic = widgetCodeAtSequence(
    result.items,
    context,
  );
  if (!widgetCodeAtSequence3.ok && widgetCodeAtSequence3.why !== `not-born`)
    return {
      ok: false,
      why: widgetCodeAtSequence3.why,
    };
  let before: Dynamic = widgetCodeAtSequence3.ok
    ? widgetCodeAtSequence3.code
    : ``;
  let record: Dynamic = {
    ok: true,
    before: before,
    after: widgetCodeAtSequence2.code,
    html: renderWidgetCodeDiff(before, widgetCodeAtSequence2.code),
  };
  if (matchesDependencies) {
    cacheEmbedDelta(argument.cache, label, record);
  }
  return record;
}
var splitCodeLines: Dynamic = (
  splitCodeLines2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  splitCodeLines2 === ``
    ? []
    : splitCodeLines2
        .replace(
          /\r\n?/g,
          `
`,
        )
        .replace(
          /[\u2028\u2029]/g,
          (splitCodeLines3?: Dynamic, ..._extraArguments: unknown[]) =>
            `${splitCodeLines3}\n`,
        ).split(`
`);
/* Subsystem: widget-code-diff */
function diffCodeLines(
  items?: Dynamic,
  items2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let index: number = 0;
  for (
    ;
    index < items.length &&
    index < items2.length &&
    items[index] === items2[index];

  )
    index++;
  let index2: number = 0;
  for (
    ;
    index2 < items.length - index &&
    index2 < items2.length - index &&
    items[items.length - 1 - index2] === items2[items2.length - 1 - index2];

  )
    index2++;
  let diffCodeLinesHandler: Dynamic = (
    line?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => ({
    k: `=`,
    line: line,
  });
  let itemsSlice: Dynamic = items.slice(index, items.length - index2);
  let itemsSlice2: Dynamic = items2.slice(index, items2.length - index2);
  return [
    ...items.slice(0, index).map(diffCodeLinesHandler),
    ...alignCodeLines(itemsSlice, itemsSlice2),
    ...items.slice(items.length - index2).map(diffCodeLinesHandler),
  ];
}
function alignCodeLines(
  items?: Dynamic,
  items2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let alignCodeLinesHandler: Dynamic = (
    line?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => ({
    k: `-`,
    line: line,
  });
  let alignCodeLinesHandler2: Dynamic = (
    line?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => ({
    k: `+`,
    line: line,
  });
  let itemsCount: Dynamic = items.length;
  let itemsCount2: Dynamic = items2.length;
  if (
    itemsCount === 0 ||
    itemsCount2 === 0 ||
    (itemsCount + 1) * (itemsCount2 + 1) > MAX_CODE_LINE_PAIR_CELLS
  )
    return [
      ...items.map(alignCodeLinesHandler),
      ...items2.map(alignCodeLinesHandler2),
    ];
  let total: Dynamic = itemsCount2 + 1;
  let uint32Array: Dynamic = new (Uint32Array as Dynamic)(
    (itemsCount + 1) * total,
  );
  for (let difference: number = itemsCount - 1; difference >= 0; difference--)
    for (
      let difference2: number = itemsCount2 - 1;
      difference2 >= 0;
      difference2--
    )
      uint32Array[difference * total + difference2] =
        items[difference] === items2[difference2]
          ? uint32Array[(difference + 1) * total + difference2 + 1] + 1
          : Math.max(
              uint32Array[(difference + 1) * total + difference2],
              uint32Array[difference * total + difference2 + 1],
            );
  let items3: Dynamic = [];
  let index: number = 0;
  let index2: number = 0;
  for (; index < itemsCount && index2 < itemsCount2; )
    if (items[index] === items2[index2]) {
      items3.push({
        k: `=`,
        line: items[index],
      });
      index++;
      index2++;
    } else {
      if (
        uint32Array[(index + 1) * total + index2] >=
        uint32Array[index * total + index2 + 1]
      ) {
        items3.push(alignCodeLinesHandler(items[index++]));
      } else {
        items3.push(alignCodeLinesHandler2(items2[index2++]));
      }
    }
  for (; index < itemsCount; )
    items3.push(alignCodeLinesHandler(items[index++]));
  for (; index2 < itemsCount2; )
    items3.push(alignCodeLinesHandler2(items2[index2++]));
  return items3;
}
function interleaveChangedCodeLines(
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items2: Dynamic = [];
  for (let index: number = 0; index < items.length; ) {
    if (items[index].k === `=`) {
      items2.push(items[index++]);
      continue;
    }
    let items3: Dynamic = [];
    let items4: Dynamic = [];
    for (; index < items.length && items[index].k !== `=`; )
      (items[index].k === `-` ? items3 : items4).push(items[index++]);
    for (
      let index2: number = 0;
      index2 < Math.max(items3.length, items4.length);
      index2++
    ) {
      if (index2 < items3.length) {
        items2.push(items3[index2]);
      }
      if (index2 < items4.length) {
        items2.push(items4[index2]);
      }
    }
  }
  return items2;
}
var CODE_CONTROL_PATTERN: Dynamic =
  /[&<>\u00A0\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u2028\u2029]/g;
var renderCodeControlCharacter = (
  codeControlCharacter?: Dynamic,
  ..._extraArguments: unknown[]
) =>
  `<span class="vh-code-ctl">\u27E8U+${codeControlCharacter.codePointAt(0).toString(16).toUpperCase().padStart(4, `0`)}\u27E9</span>`;
var escapeCodeHtml: Dynamic = (
  escapeCodeHtml2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  escapeCodeHtml2
    .split(`\0`)
    .join(`\uFFFD`)
    .replace(
      CODE_CONTROL_PATTERN,
      (escapeCodeHtml3?: Dynamic, ..._extraArguments: unknown[]): string =>
        escapeCodeHtml3 === `&`
          ? `&amp;`
          : escapeCodeHtml3 === `<`
            ? `&lt;`
            : escapeCodeHtml3 === `>`
              ? `&gt;`
              : escapeCodeHtml3 === `\xA0`
                ? `&nbsp;`
                : renderCodeControlCharacter(escapeCodeHtml3),
    );
function codeUtf8Length(
  items?: Dynamic,
  ..._extraArguments: unknown[]
): number {
  let count: number = 0;
  for (let index: number = 0; index < items.length; index++) {
    let charCodeAt: Dynamic = items.charCodeAt(index);
    if (charCodeAt < 128) count += 1;
    else if (charCodeAt < 2048) count += 2;
    else if (
      charCodeAt >= 55296 &&
      charCodeAt < 56320 &&
      index + 1 < items.length
    ) {
      let charCodeAt2: Dynamic = items.charCodeAt(index + 1);
      if (charCodeAt2 >= 56320 && charCodeAt2 < 57344) {
        count += 4;
        index++;
      } else {
        count += 3;
      }
    } else count += 3;
  }
  return count;
}
function renderCodeLine(
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (items.length <= 2e3) return escapeCodeHtml(items);
  let MAXCODELINECHARACTERS: Dynamic = MAX_CODE_LINE_CHARACTERS;
  let charCodeAt: Dynamic = items.charCodeAt(MAXCODELINECHARACTERS - 1);
  if (charCodeAt >= 55296 && charCodeAt < 56320) {
    MAXCODELINECHARACTERS--;
  }
  return `${escapeCodeHtml(items.slice(0, MAXCODELINECHARACTERS))}<span class="vh-code-skip">\u2026 ${items.length - MAXCODELINECHARACTERS} more characters</span>`;
}
var renderSkippedCode = (
  skippedCode?: Dynamic,
  ..._extraArguments: unknown[]
) => `<span class="vh-code-skip">\u22EF ${skippedCode}</span>\n`;
var renderWidgetCodeDiffDetails = (
  widgetCodeDiffDetails?: Dynamic,
  ..._extraArguments: unknown[]
) =>
  `<details class="vh-widget-code"><summary>Show code changes</summary><pre class="vh-code-diff"><code>${widgetCodeDiffDetails}</code></pre></details>`;
var renderUnavailableWidgetCodeDiff: Dynamic = (
  unavailableWidgetCodeDiff?: Dynamic,
  ..._extraArguments: unknown[]
): string =>
  renderWidgetCodeDiffDetails(renderSkippedCode(unavailableWidgetCodeDiff));
function skippedCodeSummary(
  items?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let index: number = 0;
  let index2: number = 0;
  let index3: number = 0;
  for (let context2: Dynamic = context; context2 < items.length; context2++) {
    if (items[context2].k === `+`) {
      index2++;
    } else {
      if (items[context2].k === `-`) {
        index3++;
      }
    }
    if (options[context2] === 1) {
      index++;
    }
  }
  return `${index} more line${index === 1 ? `` : `s`} (${index2} added, ${index3} removed) not shown`;
}
function renderWidgetCodeDiff(
  widgetCodeDiff?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (widgetCodeDiff === options) return ``;
  let splitCodeLines2: Dynamic = splitCodeLines(widgetCodeDiff);
  let splitCodeLines3: Dynamic = splitCodeLines(options);
  if (
    splitCodeLines2.length === splitCodeLines3.length &&
    splitCodeLines2.every(
      (
        splitCodeLine?: Dynamic,
        index2?: Dynamic,
        ..._extraArguments: unknown[]
      ) => splitCodeLine === splitCodeLines3[index2],
    )
  )
    return renderUnavailableWidgetCodeDiff(`Only line endings changed`);
  let interleaveChangedCodeLines2: Dynamic = interleaveChangedCodeLines(
    diffCodeLines(splitCodeLines2, splitCodeLines3),
  );
  let uint8Array: Dynamic = new (Uint8Array as Dynamic)(
    interleaveChangedCodeLines2.length,
  );
  interleaveChangedCodeLines2.forEach(
    (
      interleaveChangedCodeLine?: Dynamic,
      index2?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      if (interleaveChangedCodeLine.k === `=`) return;
      let min: number = Math.min(
        interleaveChangedCodeLines2.length - 1,
        index2 + 3,
      );
      for (let max: number = Math.max(0, index2 - 3); max <= min; max++)
        uint8Array[max] = 1;
    },
  );
  let label: string = ``;
  let count: number = 0;
  let index: number = 0;
  for (let index2: number = 0; index2 < interleaveChangedCodeLines2.length; ) {
    if (uint8Array[index2] === 0) {
      let index3: Dynamic = index2;
      for (
        ;
        index3 < interleaveChangedCodeLines2.length && uint8Array[index3] === 0;

      )
        index3++;
      label += renderSkippedCode(
        `${index3 - index2} unchanged line${index3 - index2 === 1 ? `` : `s`}`,
      );
      index2 = index3;
      continue;
    }
    let interleaveChangedCodeLineItem: Dynamic =
      interleaveChangedCodeLines2[index2];
    let label2: string = `${renderCodeLine(interleaveChangedCodeLineItem.line)}\n`;
    let label3: Dynamic =
      interleaveChangedCodeLineItem.k === `=`
        ? label2
        : interleaveChangedCodeLineItem.k === `-`
          ? `<del class="vh-del">${label2}</del>`
          : `<ins class="vh-ins">${label2}</ins>`;
    let codeUtf8Length2: Dynamic = codeUtf8Length(label3);
    if (index === 600) {
      label += renderSkippedCode(
        skippedCodeSummary(interleaveChangedCodeLines2, uint8Array, index2),
      );
      break;
    }
    if (count + codeUtf8Length2 > 2e5) {
      label += renderSkippedCode(
        `Code diff too large: ${skippedCodeSummary(interleaveChangedCodeLines2, uint8Array, index2)}`,
      );
      break;
    }
    label += label3;
    count += codeUtf8Length2;
    index++;
    index2++;
  }
  return renderWidgetCodeDiffDetails(label);
}
/* Subsystem: version-comparison */
function comparisonBaseKey(
  comparisonBaseKey2?: Dynamic,
  ..._extraArguments: unknown[]
): string {
  return comparisonBaseKey2 === null
    ? `none`
    : typeof comparisonBaseKey2 == `string`
      ? comparisonBaseKey2
      : typeof comparisonBaseKey2 == `number`
        ? String(comparisonBaseKey2)
        : `rev:${comparisonBaseKey2.rev}`;
}
var equalComparisonBases = (
  equalComparisonBases2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) => comparisonBaseKey(equalComparisonBases2) === comparisonBaseKey(options);
function normalizeComparisonBase(
  comparisonBase?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return comparisonBase === `none` || comparisonBase === `older`
    ? null
    : typeof comparisonBase == `object` &&
        comparisonBase &&
        `upto` in comparisonBase
      ? comparisonBase.upto
      : comparisonBase;
}
function resolveComparisonBase(
  comparisonBase?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (
    options === null ||
    typeof options == `string` ||
    typeof options == `number`
  )
    return options;
  for (let resolveComparisonBaseResult of comparisonBase as Dynamic) {
    let params: Dynamic = resolveComparisonBaseResult.params;
    if (params.rev === options.rev && typeof params.upto == `number`)
      return params.upto;
  }
  return options;
}
var VERSION_PREVIEW_CSS: string = `${VERSION_DIFF_CSS}\n.vh-w{pointer-events:none}
del.vh-del{text-decoration-line:line-through}
[data-tip].vh-w,.vh-w [data-tip]{pointer-events:auto}\n[data-vh-delblock]{margin:.15em 0;opacity:.95}
:is(td,th) .vh-invisible.vh-invisible.vh-invisible[data-vh-invisible=empty]{white-space:normal;overflow-wrap:normal;word-break:normal}
table[data-vh-delblock] th{font-size:inherit;font-weight:inherit;text-transform:inherit;letter-spacing:inherit}
.vh-moved{font-size:12px;color:var(--vh-card-ink);margin:.2em 0}
tr.vh-moved>td{font-size:12px;color:var(--vh-card-ink);padding:2px 8px}
tr.vh-moved.vh-moved>td,:is(td,th).vh-moved.vh-moved,[data-vh-delblock] .vh-moved{text-decoration:none;box-shadow:none;background:transparent;color:var(--vh-card-ink)}
[data-vh-delblock] li.vh-moved{list-style:none}
.vh-moved-words{display:inline-block}
tr[data-vh-delblock]>td,tr[data-vh-delblock]>th{box-shadow:inset 0 0 0 100vmax var(--vh-del-bg)}
.lfile-codewrap[data-diff]{position:relative;outline:2px solid var(--vh-l);outline-offset:3px;border-radius:8px}
.lfile-codewrap:is([data-diff=chg],[data-diff=move]){outline:1px dotted var(--vh-l)}
[data-vh-opaque=source]{--vh-l:var(--vh-quiet);--vh-w:transparent;position:relative;outline:1px dotted var(--vh-quiet);outline-offset:3px;border-radius:8px}
[data-vh-opaque=unchecked],[data-vh-opaque=checking]{position:relative}
.lfile-codewrap.cw-renderable[data-vh-opaque=source]:not(.cw-src-open) pre{display:block;margin-top:6px;border-top:1px solid var(--vh-card-rule);background:var(--vh-card-bg);border-radius:0 0 8px 8px;padding:10px 14px;white-space:pre-wrap;overflow-wrap:anywhere}
.lfile-codewrap.cw-renderable[data-vh-opaque=source]:not(.cw-src-open) pre::before{content:"Source changes";display:block;margin:0 0 6px;font:500 11px/16px "Anthropic Sans",ui-sans-serif,system-ui,sans-serif;letter-spacing:.02em;color:var(--vh-card-ink)}
.vh-chip-badge{display:none}
[data-vh-opaque=unchecked][data-vh-badge]:not([data-diff-atom])::after{content:attr(data-vh-badge);display:block;padding:4px 0 0;color:var(--vh-quiet);font:400 12px/16px "Anthropic Sans",ui-sans-serif,system-ui,sans-serif;text-indent:0;text-transform:none;text-decoration:none;pointer-events:none}
.tableWrapper[data-vh-in-added][data-diff=move]>table,table[data-vh-in-added][data-diff=move],.lfile-codewrap[data-vh-in-added][data-diff=move],:is(figure,[data-lfile-embed],details.vh-widget-code)[data-vh-in-added][data-diff=move],blockquote:is(.ldoc-callout,[data-callout])[data-vh-in-added][data-diff=move]{outline:0}
.lfile-codewrap[data-vh-in-added][data-diff=move][data-vh-opaque=source]{outline:1px dotted var(--vh-quiet);outline-offset:3px}
.vh-media-gone{display:inline-flex;flex-direction:column;gap:2px;min-width:180px;padding:10px 14px;margin:4px 0;outline:2px solid var(--vh-del-line);outline-offset:3px;color:var(--vh-card-ink)}
.vh-media-gone .vh-card-label{color:var(--vh-code-ink);text-decoration:line-through;text-decoration-color:var(--vh-del-line)}
.vh-media-gone .vh-card-meta,.vh-embed .vh-card-meta{display:inline-block;text-decoration:none}
.vh-embed[data-vh-opaque=del]{outline:2px solid var(--vh-del-line);outline-offset:3px}
.vh-embed[data-vh-opaque=del] .vh-card-label{text-decoration:line-through;text-decoration-color:var(--vh-del-line)}
details.vh-compare{pointer-events:auto;margin:6px 0 14px;border:1px solid var(--vh-card-rule);border-radius:8px;background:var(--vh-card-bg)}
details.vh-compare>summary{cursor:pointer;padding:5px 12px;color:var(--vh-card-ink);font:500 12px/18px "Anthropic Sans",ui-sans-serif,system-ui,sans-serif;list-style:revert}
.vh-compare-body{padding:8px 12px 12px;border-top:1px solid var(--vh-card-rule)}
.vh-compare-label{font:500 11px/16px "Anthropic Sans",ui-sans-serif,system-ui,sans-serif;letter-spacing:.02em;color:var(--vh-card-ink);margin-bottom:6px}
.vh-compare-face{overflow:auto;max-width:100%}.vh-compare-face svg{max-width:100%;height:auto}
.vh-compare-face table{border-collapse:collapse;font-size:13px}.vh-compare-face :is(td,th){border:1px solid var(--vh-card-rule);padding:3px 8px;text-align:left}
`;
var withVersionPreviewCss: Dynamic = (
  withVersionPreviewCss2?: Dynamic,
  ..._extraArguments: unknown[]
): string =>
  withVersionPreviewCss2 === undefined || withVersionPreviewCss2 === ``
    ? VERSION_PREVIEW_CSS
    : `${withVersionPreviewCss2}\n${VERSION_PREVIEW_CSS}`;
var EMPTY_PREVIEW_DIFF_STATS: Dynamic = {
  ins: 0,
  del: 0,
  chg: 0,
  fmt: 0,
  move: 0,
  total: 0,
};
var REPLACEMENT_STAT_NODE_TYPES: Dynamic = new (Set as Dynamic)([
  `paragraph`,
  `heading`,
  `codeBlock`,
  `list`,
  `table`,
  `blockquote`,
  `embed`,
]);
function previewDiffStats(
  previewDiffStats2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let stats: Dynamic = previewDiffStats2.stats;
  let replaced: Dynamic = previewDiffStats2.changes.filter(
    (entry?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      entry.kind === `replace` &&
      REPLACEMENT_STAT_NODE_TYPES.has(entry.nodeType),
  ).length;
  return {
    ins: stats.ins,
    del: stats.del,
    chg: stats.chg,
    fmt: stats.fmt,
    move: stats.move,
    total: previewDiffStats2.changes.length,
    ...(replaced > 0
      ? {
          replaced: replaced,
        }
      : {}),
  };
}
var diffVersionSides: Dynamic = (
  diffVersionSides2?: Dynamic,
  options?: Dynamic,
  enums?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  diffDocumentsAsync(diffVersionSides2.doc, options.doc, {
    prevRuns: diffVersionSides2.runs,
    nextRuns: options.runs,
    ...(enums
      ? {
          enums: enums,
        }
      : {}),
  });
var diffVersionContent: Dynamic = (
  diffVersionContent2?: Dynamic,
  options?: Dynamic,
  enums?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  diffDocumentsAsync(
    diffVersionContent2.doc,
    options.doc,
    enums
      ? {
          enums: enums,
        }
      : {},
  );
async function loadVersionDiffEnums(
  versionDiffEnums?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let projectEnums: Dynamic = await loadProjectEnums(versionDiffEnums);
  return projectEnums === null ? undefined : serializeDiffEnums(projectEnums);
}
var embedDeltaCachesByProject: Dynamic = new (Map as Dynamic)();
var enrichVersionDiffEmbeds: Dynamic = async (
  page?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> => {
  let collectDiffEmbedReferences2: Dynamic = collectDiffEmbedReferences(
    options.doc,
  );
  if (
    collectDiffEmbedReferences2.refs.length === 0 &&
    collectDiffEmbedReferences2.legacy.length === 0
  )
    return {
      doc: options.doc,
      changes: options.changes,
      unchecked: [],
    };
  let cache: Dynamic = embedDeltaCachesByProject.get(page.pid);
  if (cache === undefined) {
    cache = createEmbedDeltaCache();
    embedDeltaCachesByProject.set(page.pid, cache);
  }
  let scheduler: Dynamic = resolvePlatformLiveDocumentAndHistoryValue33(page);
  let embedDeltas: Dynamic = await readEmbedDeltas(
    scheduler.door,
    collectDiffEmbedReferences2.refs,
    context.seqA,
    context.seqB,
    {
      cache: cache,
      schedule: scheduler.schedule,
      classify: true,
    },
  );
  let mergeEmbedDeltasIntoDiff2: Dynamic = mergeEmbedDeltasIntoDiff(
    {
      doc: options.doc,
      changes: options.changes,
    },
    embedDeltas,
  );
  return {
    doc: mergeEmbedDeltasIntoDiff2.doc,
    changes: mergeEmbedDeltasIntoDiff2.changes,
    unchecked: mergeEmbedDeltasIntoDiff2.uncheckedWhy.filter(
      (uncheckedWhy?: Dynamic, ..._extraArguments: unknown[]) =>
        uncheckedWhy.ref !== null,
    ),
  };
};
var EMBED_DIFF_CHECKING_STATUS: string = `checking`;
var embedDiffErrors: Dynamic = new (WeakSet as Dynamic)();
function markEmbedDiffError(
  markEmbedDiffError2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let markEmbedDiffError3: Dynamic =
    typeof markEmbedDiffError2 == `object` && markEmbedDiffError2
      ? markEmbedDiffError2
      : Error(String(markEmbedDiffError2));
  embedDiffErrors.add(markEmbedDiffError3);
  return markEmbedDiffError3;
}
function isEmbedDiffError(
  embedDiffError?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return (
    typeof embedDiffError == `object` &&
    !!embedDiffError &&
    embedDiffErrors.has(embedDiffError)
  );
}
var UNLISTED_BASE_REASON: string = `base-unlisted`;
var UNCHECKED_DIFF_ATTRIBUTE: Dynamic = DIFF_ATTRIBUTE_NAMES.unchecked;
function annotateUncheckedEmbeds(
  annotateUncheckedEmbeds2?: Dynamic,
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (items.length === 0) return annotateUncheckedEmbeds2;
  let lookup: Dynamic = new (Map as Dynamic)(
    items.map(
      (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => [
        item.ref,
        item.reason,
      ],
    ),
  );
  let slice: Dynamic = (
    node?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    if (
      (node.type === `embed` || node.type === `embedInline`) &&
      node.attrs !== undefined
    ) {
      let ref: Dynamic = node.attrs.ref;
      let lookupEntry: Dynamic =
        typeof ref == `string` ? lookup.get(ref) : undefined;
      return lookupEntry !== undefined &&
        node.attrs.diff !== `del` &&
        node.attrs.diffGhost === undefined
        ? {
            ...node,
            attrs: {
              ...node.attrs,
              [UNCHECKED_DIFF_ATTRIBUTE]: lookupEntry,
            },
          }
        : node;
    }
    let content: Dynamic = node.content;
    if (!Array.isArray(content)) return node;
    let content2: Dynamic = null;
    for (let index: number = 0; index < content.length; index++) {
      let itemsSlice: Dynamic = slice(content[index]);
      if (itemsSlice !== content[index]) {
        (content2 ??= content.slice())[index] = itemsSlice;
      }
    }
    return content2 === null
      ? node
      : {
          ...node,
          content: content2,
        };
  };
  return slice(annotateUncheckedEmbeds2);
}
function comparisonSequenceRange(
  comparisonSequenceRange2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let comparisonSequenceRangeHandler: Dynamic = (
    comparisonSequenceRange3?: Dynamic,
    options2?: Dynamic,
    ..._extraArguments: unknown[]
  ): number | undefined => {
    let paramItem: Dynamic = comparisonSequenceRange3.params[options2];
    return typeof paramItem == `number` ? paramItem : undefined;
  };
  let comparisonSequenceRangeHandler2: Dynamic = (
    comparisonSequenceRange3?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    comparisonSequenceRange2.find(
      (item?: Dynamic, ..._extraArguments: unknown[]) =>
        comparisonSequenceRangeHandler(item, `upto`) ===
        comparisonSequenceRange3,
    );
  let comparisonSequenceRangeHandler3: Dynamic = (
    comparisonSequenceRange3?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    comparisonSequenceRangeHandler(comparisonSequenceRange3, `headSeq`) ??
    comparisonSequenceRangeHandler(comparisonSequenceRange3, `upto`);
  let comparisonSequenceRangeHandler4: Dynamic =
    comparisonSequenceRangeHandler2(context);
  let seqA: Dynamic;
  if (options === `empty` || options === `first`) seqA = 0;
  else if (typeof options == `number`) {
    let comparisonSequenceRangeHandler5: Dynamic =
      comparisonSequenceRangeHandler2(options);
    seqA =
      comparisonSequenceRangeHandler5 === undefined
        ? undefined
        : comparisonSequenceRangeHandler3(comparisonSequenceRangeHandler5);
  }
  let seqB: Dynamic =
    comparisonSequenceRangeHandler4 === undefined
      ? undefined
      : comparisonSequenceRangeHandler3(comparisonSequenceRangeHandler4);
  return seqA === undefined || seqB === undefined
    ? null
    : seqA <= seqB
      ? {
          seqA: seqA,
          seqB: seqB,
        }
      : {
          seqA: seqB,
          seqB: seqA,
        };
}
var versionComparisonCache: Dynamic = new (Map as Dynamic)();
var versionComparisonRequests: Dynamic = new (Map as Dynamic)();
var versionComparisonKey = (
  page?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies: Dynamic = false,
  ..._extraArguments: unknown[]
) =>
  `${page.pid}/${page.fileId}/${options}~${comparisonBaseKey(context)}${dependencies ? `~content` : ``}`;
function touchVersionComparisonCache(
  touchVersionComparisonCache2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  versionComparisonCache.delete(touchVersionComparisonCache2);
  versionComparisonCache.set(touchVersionComparisonCache2, options);
  for (let touchVersionComparisonCacheResult of versionComparisonCache.keys() as Dynamic) {
    if (versionComparisonCache.size <= 6) break;
    versionComparisonCache.delete(touchVersionComparisonCacheResult);
  }
}
function getCachedVersionComparison(
  cachedVersionComparison?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies: Dynamic = false,
  ..._extraArguments: unknown[]
): Dynamic {
  let versionComparisonKey2: string = versionComparisonKey(
    cachedVersionComparison,
    options,
    context,
    dependencies,
  );
  let versionComparisonCacheEntry: Dynamic = versionComparisonCache.get(
    versionComparisonKey2,
  );
  if (versionComparisonCacheEntry !== undefined) {
    touchVersionComparisonCache(
      versionComparisonKey2,
      versionComparisonCacheEntry,
    );
  }
  return versionComparisonCacheEntry;
}
function readComparisonBase(
  comparisonBase?: Dynamic,
  options?: Dynamic,
  context: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  return options === `empty`
    ? Promise.resolve(EMPTY_VERSION_SIDE)
    : options === `first`
      ? loadFirstVersionFace(comparisonBase, context.reader)
      : typeof options == `number`
        ? loadVersionFace(
            comparisonBase,
            options,
            context.envelope,
            context.reader,
          )
        : loadRevisionFace(comparisonBase, options.rev, context.reader);
}
function prewarmComparisonBase(
  prewarmComparisonBase2?: Dynamic,
  options?: Dynamic,
  context: Dynamic = {},
  ..._extraArguments: unknown[]
): undefined {
  if (!(options === null || options === `empty`)) {
    readComparisonBase(prewarmComparisonBase2, options, context).catch(
      (..._extraArguments: unknown[]): undefined => undefined,
    );
  }
}
function compareVersionDocuments(
  page?: Dynamic,
  options?: Dynamic,
  base?: Dynamic,
  envelope: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  let label: string = `${versionComparisonKey(page, options.upto, base, envelope.byContent === true)}${options.head === true ? `~head` : ``}`;
  let versionComparisonCacheEntry: Dynamic =
    options.head === true ? undefined : versionComparisonCache.get(label);
  if (versionComparisonCacheEntry !== undefined)
    return Promise.resolve(versionComparisonCacheEntry);
  let touchVersionComparisonCache2 = (
    compareVersionDocuments2?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (options.head !== true) {
      touchVersionComparisonCache(label, compareVersionDocuments2);
    }
  };
  let versionComparisonRequestEntry: Dynamic =
    versionComparisonRequests.get(label);
  if (versionComparisonRequestEntry !== undefined) {
    if (envelope.onProse !== undefined) {
      if (versionComparisonRequestEntry.prose === null) {
        versionComparisonRequestEntry.waiters.push(envelope.onProse);
      } else {
        envelope.onProse(versionComparisonRequestEntry.prose);
      }
    }
    return versionComparisonRequestEntry.whole;
  }
  let record: Dynamic = {
    whole: Promise.resolve(null),
    prose: null,
    waiters: envelope.onProse ? [envelope.onProse] : [],
  };
  record.whole = (async (..._extraArguments: unknown[]): Promise<Dynamic> => {
    if (base === null) {
      let record4: Dynamic = {
        upto: options.upto,
        base: null,
        merged: null,
        stats: EMPTY_PREVIEW_DIFF_STATS,
        degraded: false,
        unchecked: [],
        checking: false,
      };
      touchVersionComparisonCache2(record4);
      return record4;
    }
    let compareVersionDocumentsResult: Dynamic;
    try {
      compareVersionDocumentsResult = await readComparisonBase(
        page,
        base,
        envelope,
      );
    } catch (compareVersionDocumentsResult2: Dynamic) {
      throw markEmbedDiffError(compareVersionDocumentsResult2);
    }
    let versionDiffEnums: Dynamic =
      envelope.diff === undefined
        ? await loadVersionDiffEnums(page.pid)
        : undefined;
    let diff: Dynamic = await (
      envelope.diff ??
      (envelope.byContent === true ? diffVersionContent : diffVersionSides)
    )(compareVersionDocumentsResult, options, versionDiffEnums);
    let previewDiffStats2: Dynamic = (
      compareVersionDocuments2?: Dynamic,
      changes?: Dynamic,
      context?: Dynamic,
      checking?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => ({
      upto: options.upto,
      base: base,
      merged: annotateUncheckedEmbeds(compareVersionDocuments2, context),
      stats: previewDiffStats({
        stats: {
          ...diff.stats,
          chg: diff.stats.chg + (changes.length - diff.changes.length),
        },
        changes: changes,
      }),
      degraded: diff.degraded,
      unchecked: checking ? [] : context,
      checking: checking,
    });
    let enrichVersionDiffEmbeds2: Dynamic =
      envelope.byContent === true
        ? null
        : envelope.embeds === undefined
          ? enrichVersionDiffEmbeds
          : envelope.embeds;
    let { refs: record2, legacy: record3 }: Dynamic =
      enrichVersionDiffEmbeds2 === null
        ? {
            refs: [],
            legacy: [],
          }
        : collectDiffEmbedReferences(diff.doc, 1 / 0);
    let items: Dynamic = [...record2, ...record3];
    if (enrichVersionDiffEmbeds2 === null || items.length === 0) {
      let previewDiffStats4: Dynamic = previewDiffStats2(
        diff.doc,
        diff.changes,
        [],
        false,
      );
      touchVersionComparisonCache2(previewDiffStats4);
      return previewDiffStats4;
    }
    let previewDiffStats3: Dynamic = previewDiffStats2(
      diff.doc,
      diff.changes,
      items.map(
        (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
          ref: item,
          reason: EMBED_DIFF_CHECKING_STATUS,
        }),
      ),
      true,
    );
    record.prose = previewDiffStats3;
    for (let compareVersionDocumentsResult2 of record.waiters.splice(
      0,
    ) as Dynamic)
      compareVersionDocumentsResult2(previewDiffStats3);
    let comparisonSequenceRange2: Dynamic = comparisonSequenceRange(
      resolvePlatformLiveDocumentAndHistoryValue32(page.pid, page.fileId),
      base,
      options.upto,
    );
    if (comparisonSequenceRange2 === null && typeof base == `object` && base) {
      let previewDiffStats4: Dynamic = previewDiffStats2(
        diff.doc,
        diff.changes,
        items.map(
          (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
            ref: item,
            reason: UNLISTED_BASE_REASON,
          }),
        ),
        false,
      );
      touchVersionComparisonCache2(previewDiffStats4);
      return previewDiffStats4;
    }
    let reason: string = `pending-rows`;
    if (comparisonSequenceRange2 !== null)
      try {
        let enrichVersionDiffEmbeds3: Dynamic = await enrichVersionDiffEmbeds2(
          page,
          {
            doc: diff.doc,
            changes: diff.changes,
          },
          comparisonSequenceRange2,
        );
        let previewDiffStats4: Dynamic = previewDiffStats2(
          enrichVersionDiffEmbeds3.doc,
          enrichVersionDiffEmbeds3.changes,
          enrichVersionDiffEmbeds3.unchecked,
          false,
        );
        touchVersionComparisonCache2(previewDiffStats4);
        return previewDiffStats4;
      } catch {
        reason = `transport`;
      }
    return previewDiffStats2(
      diff.doc,
      diff.changes,
      items.map(
        (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
          ref: item,
          reason: reason,
        }),
      ),
      false,
    );
  })().finally((..._extraArguments: unknown[]): undefined => {
    if (versionComparisonRequests.get(label) === record) {
      versionComparisonRequests.delete(label);
    }
  });
  versionComparisonRequests.set(label, record);
  return record.whole;
}
function previousVersionRevision(
  previousVersionRevision2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let toSorted: Dynamic = [
    ...new (Set as Dynamic)(previousVersionRevision2),
  ].toSorted(
    (item?: Dynamic, item2?: Dynamic, ..._extraArguments: unknown[]): number =>
      item2 - item,
  );
  let toSortedIndex: Dynamic = toSorted.indexOf(options);
  return toSortedIndex < 0 ? null : (toSorted[toSortedIndex + 1] ?? null);
}
function versionDiffStatsSummary(
  versionDiffStatsSummary2?: Dynamic,
  options: Dynamic = 0,
  context: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  let items: Dynamic = [];
  if (versionDiffStatsSummary2.ins > 0) {
    items.push(`${versionDiffStatsSummary2.ins} added`);
  }
  if (versionDiffStatsSummary2.del > 0) {
    items.push(`${versionDiffStatsSummary2.del} removed`);
  }
  let max: number = Math.max(
    0,
    versionDiffStatsSummary2.total -
      (versionDiffStatsSummary2.ins +
        versionDiffStatsSummary2.del +
        versionDiffStatsSummary2.chg +
        versionDiffStatsSummary2.fmt +
        versionDiffStatsSummary2.move),
  );
  let min: number = Math.min(
    max,
    Math.max(0, versionDiffStatsSummary2.replaced ?? 0),
  );
  let total: Dynamic =
    versionDiffStatsSummary2.chg +
    versionDiffStatsSummary2.fmt +
    versionDiffStatsSummary2.move +
    (max - min);
  if (total > 0) {
    items.push(`${total} changed`);
  }
  if (min > 0) {
    items.push(`${min} replaced`);
  }
  if (options > 0) {
    if (items.length === 0) {
      items.push(context.net === true ? `No net changes` : `No changes`);
    }
    items.push(resolvePlatformSyncAndRoutingIsFinite3(options));
  }
  return items.join(` · `);
}
var restoreVersionRowNumber: Dynamic = (
  restoreVersionRowNumber2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): number | undefined => {
  let paramItem: Dynamic = restoreVersionRowNumber2.params[options];
  return typeof paramItem == `number` ? paramItem : undefined;
};
function restoredVersionDetails(
  restoredVersionDetails2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let restoredVersionDetail: Dynamic = restoredVersionDetails2.find(
    (item?: Dynamic, ..._extraArguments: unknown[]) =>
      restoreVersionRowNumber(item, `upto`) === options,
  );
  if (restoredVersionDetail === undefined) return null;
  let restoredFrom: Dynamic = restoreVersionRowNumber(
    restoredVersionDetail,
    `restoredFrom`,
  );
  if (restoredFrom === undefined) return null;
  let activity: Dynamic;
  let restoredVersionDetailsResult: number = -1;
  for (let restoredVersionDetailsResult2 of restoredVersionDetails2 as Dynamic) {
    let restoreVersionRowNumber2: Dynamic = restoreVersionRowNumber(
      restoredVersionDetailsResult2,
      `rev`,
    );
    let restoreVersionRowNumber3: Dynamic = restoreVersionRowNumber(
      restoredVersionDetailsResult2,
      `upto`,
    );
    if (
      !(
        restoreVersionRowNumber2 === undefined ||
        restoreVersionRowNumber3 === undefined ||
        restoreVersionRowNumber3 >= options
      )
    ) {
      if (
        restoreVersionRowNumber2 <= restoredFrom &&
        restoreVersionRowNumber2 > restoredVersionDetailsResult
      ) {
        activity = restoredVersionDetailsResult2;
        restoredVersionDetailsResult = restoreVersionRowNumber2;
      }
    }
  }
  if (activity === undefined)
    return {
      restoredFrom: restoredFrom,
    };
  let sourceUpto: Dynamic = restoreVersionRowNumber(activity, `upto`);
  let reverted: Dynamic = new (Set as Dynamic)(
    restoredVersionDetails2
      .map(
        (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          restoreVersionRowNumber(item, `upto`),
      )
      .filter(
        (mappedItem?: Dynamic, ..._extraArguments: unknown[]): boolean =>
          mappedItem !== undefined &&
          mappedItem > sourceUpto &&
          mappedItem < options,
      ),
  ).size;
  return {
    restoredFrom: restoredFrom,
    sourceUpto: sourceUpto,
    sourceAt: activity.at,
    reverted: reverted,
  };
}
function restoredVersionSummary(
  restoredVersionSummary2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) {
  return `Restored from ${restoredVersionSummary2.sourceAt === undefined ? `rev ${restoredVersionSummary2.restoredFrom}` : options(restoredVersionSummary2.sourceAt)}${restoredVersionSummary2.reverted === undefined || restoredVersionSummary2.reverted === 0 ? `` : ` · reverts ${restoredVersionSummary2.reverted} version${restoredVersionSummary2.reverted === 1 ? `` : `s`}`}`;
}
function clearVersionComparisonCache(..._extraArguments: unknown[]): undefined {
  versionComparisonCache.clear();
  versionComparisonRequests.clear();
}
var HTML_DIFF_TOKEN_PATTERN: Dynamic =
  /<style\b[^>]*>[\s\S]*?<\/style>|<script\b[^>]*>[\s\S]*?<\/script>|<!--[\s\S]*?-->|<[^>]+>|[^\s<]+|\s+/g;
/* Subsystem: html-preview */
function tokenizeHtmlForDiff(
  tokenizeHtml?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items: Dynamic = [];
  for (let tokenizeHtmlForDiffResult of tokenizeHtml.matchAll(
    HTML_DIFF_TOKEN_PATTERN,
  ) as Dynamic) {
    let tokenizeHtmlForDiffResultItem: Dynamic = tokenizeHtmlForDiffResult[0];
    if (tokenizeHtmlForDiffResultItem.startsWith(`<!--`)) continue;
    let isTag: boolean = tokenizeHtmlForDiffResultItem[0] === `<`;
    items.push({
      s: tokenizeHtmlForDiffResultItem,
      isTag: isTag,
      isWs: !isTag && !tokenizeHtmlForDiffResultItem.trim(),
    });
  }
  return items;
}
var HTML_DIFF_STRUCTURAL_TAG_PATTERN: Dynamic =
  /^<\/?(tr|td|th|thead|tbody|tfoot|table|colgroup|col|ul|ol|li)\b/i;
var MAX_HTML_DIFF_CELLS: number = 16e6;
function diffHtml(
  diffHtml2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let tokenizeHtmlForDiff2: Dynamic = tokenizeHtmlForDiff(diffHtml2);
  let tokenizeHtmlForDiff3: Dynamic = tokenizeHtmlForDiff(options);
  let tokenizeHtmlForDiffCount: Dynamic = tokenizeHtmlForDiff2.length;
  let tokenizeHtmlForDiffCount2: Dynamic = tokenizeHtmlForDiff3.length;
  if (
    tokenizeHtmlForDiffCount * tokenizeHtmlForDiffCount2 >
    MAX_HTML_DIFF_CELLS
  )
    return tokenizeHtmlForDiff3
      .map(
        (
          tokenizeHtmlForDiff4?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic => tokenizeHtmlForDiff4.s,
      )
      .join(``);
  let record: Dynamic = Array.from<Dynamic, Dynamic>(
    {
      length: tokenizeHtmlForDiffCount + 1,
    },
    (..._extraArguments: unknown[]): Dynamic =>
      new (Uint32Array as Dynamic)(tokenizeHtmlForDiffCount2 + 1),
  );
  for (
    let difference: number = tokenizeHtmlForDiffCount - 1;
    difference >= 0;
    difference--
  )
    for (
      let difference2: number = tokenizeHtmlForDiffCount2 - 1;
      difference2 >= 0;
      difference2--
    )
      record[difference][difference2] =
        tokenizeHtmlForDiff2[difference].s ===
        tokenizeHtmlForDiff3[difference2].s
          ? record[difference + 1][difference2 + 1] + 1
          : Math.max(
              record[difference + 1][difference2],
              record[difference][difference2 + 1],
            );
  let items: Dynamic = [];
  let index: number = 0;
  let index2: number = 0;
  for (
    ;
    index < tokenizeHtmlForDiffCount && index2 < tokenizeHtmlForDiffCount2;

  )
    if (tokenizeHtmlForDiff2[index].s === tokenizeHtmlForDiff3[index2].s) {
      items.push({
        tag: ` `,
        t: tokenizeHtmlForDiff3[index2++],
      });
      index++;
    } else {
      if (record[index + 1][index2] >= record[index][index2 + 1]) {
        items.push({
          tag: `-`,
          t: tokenizeHtmlForDiff2[index++],
        });
      } else {
        items.push({
          tag: `+`,
          t: tokenizeHtmlForDiff3[index2++],
        });
      }
    }
  for (; index < tokenizeHtmlForDiffCount; )
    items.push({
      tag: `-`,
      t: tokenizeHtmlForDiff2[index++],
    });
  for (; index2 < tokenizeHtmlForDiffCount2; )
    items.push({
      tag: `+`,
      t: tokenizeHtmlForDiff3[index2++],
    });
  let label: string = ``;
  let index3: number = 0;
  for (; index3 < items.length; ) {
    let tag: Dynamic = items[index3].tag;
    let items2: Dynamic = [];
    for (; index3 < items.length && items[index3].tag === tag; )
      items2.push(items[index3++].t);
    if (tag === ` `) {
      for (let diffHtmlResult of items2 as Dynamic) label += diffHtmlResult.s;
      continue;
    }
    let matchesTag: Dynamic =
      tag === `-` &&
      items2.some(
        (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          item.isTag && HTML_DIFF_STRUCTURAL_TAG_PATTERN.test(item.s),
      );
    let label2: string = ``;
    for (let diffHtmlResult of items2 as Dynamic)
      if (diffHtmlResult.isTag) {
        if (label2) {
          label += renderHtmlDiffToken(tag, label2, matchesTag);
        }
        label2 = ``;
        if (tag === `+`) {
          label += diffHtmlResult.s;
        }
      } else {
        label2 += diffHtmlResult.s;
      }
    if (label2) {
      label += renderHtmlDiffToken(tag, label2, matchesTag);
    }
  }
  return label;
}
function renderHtmlDiffToken(
  htmlDiff?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return !options.trim() || context
    ? htmlDiff === `-`
      ? ``
      : options
    : htmlDiff === `+`
      ? `<ins class="bongo-ins">${options}</ins>`
      : `<del class="bongo-del">${options}</del>`;
}
var LEGACY_HTML_DIFF_CSS: string = `
  ins.bongo-ins {
    background: rgba(34, 197, 94, 0.26);
    box-shadow: inset 0 -0.14em 0 0 rgba(34, 197, 94, 0.6);
    text-decoration: none;
    border-radius: 2px;
  }
  del.bongo-del {
    background: rgba(239, 68, 68, 0.2);
    text-decoration: line-through;
    text-decoration-color: rgba(239, 68, 68, 0.85);
    text-decoration-thickness: 0.12em;
    border-radius: 2px;
  }
  /* The washes above sit BEHIND an opaque <img>, so an added/removed/resized
   * image carried its ins/del mark invisibly. Carry the redline onto the
   * image itself: a hue ring, plus a fade on deletes so "this image was
   * removed" reads at a glance. Two selector families: <ins>/<del> wrappers
   * (static htmlDiff path + Node.fromJSON mounts, where the atom's mark
   * survives) and [data-diffmark] (the live pmDiff preview — y-prosemirror's
   * seed drops marks on non-text nodes, so pmDiff also writes the signal
   * into the image's attrs; see markAtom in pmDiff.ts). */
  ins.bongo-ins img,
  img[data-diffmark="ins"] {
    outline: 3px solid rgba(34, 197, 94, 0.65);
    outline-offset: 2px;
    border-radius: 2px;
  }
  del.bongo-del img,
  img[data-diffmark="del"] {
    outline: 3px solid rgba(239, 68, 68, 0.65);
    outline-offset: 2px;
    border-radius: 2px;
    opacity: 0.5;
  }
  /* Marker rows render the snapshot's STATIC serialization (the ldoc runtime
   * is deliberately not loaded when redline marks are present — see
   * VersionPreview's HtmlPreview). Prose tables serialize there as
   * data-pm="table|tableRow|tableHeader|tableCell" <span> wrappers with no
   * <table> element, so without these rules an added/edited table degrades to
   * a stack of bare lines. Cell geometry follows DASHBOARD_CSS; header font
   * treatment follows the hydrated .ProseMirror th (iframeRuntime). Header
   * background is an alpha tint (not the opaque #f5f3ed the hydrated view
   * uses) per this sheet's cross-theme contract above.
   * Known gap: resized column widths live in PM attrs and don't reach the
   * static serialization — columns auto-size here. True 1:1 (and chips/live
   * values) is the pmDiff follow-up. */
  span[data-pm="table"]{display:table;width:100%;border-collapse:collapse;font-size:.94em;line-height:1.45;margin:18px 0}
  span[data-pm="tableRow"]{display:table-row}
  span[data-pm="tableHeader"],span[data-pm="tableCell"]{display:table-cell;padding:.5rem .6rem;border-bottom:1px solid var(--line, rgba(127,127,127,.35));vertical-align:top}
  span[data-pm="tableHeader"]{background:rgba(138,136,130,0.12);color:var(--mute, #8a8882)}
  span[data-pm="tableHeader"] p,span[data-pm="tableCell"] p{margin:0}
`;
function diffAnchorId(
  diffAnchorId2?: Dynamic,
  ..._extraArguments: unknown[]
): string {
  let label: string = `vh-`;
  for (let diffAnchorIdResult of diffAnchorId2 as Dynamic)
    label += /^[A-Za-z0-9]$/.test(diffAnchorIdResult)
      ? diffAnchorIdResult
      : `_${diffAnchorIdResult.codePointAt(0).toString(16)}_`;
  return label;
}
var VERSION_PREVIEW_DOCUMENT_CSS: string = `[data-lfile-doc]{margin:24px auto;max-width:780px;padding:0 24px}`;
function legacyDiffPreviewHtml(
  legacyDiffPreviewHtml2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${EditorHostStyles13}"><style>${legacyDiffPreviewHtml2}${resolveDataModelSchemasReplace(EditorHostState2)}${EditorHostSans}${LEGACY_HTML_DIFF_CSS}${VERSION_PREVIEW_DOCUMENT_CSS}</style><body><div data-lfile-doc>${options}</div>`;
}
function diffAnchorScrollCss(
  diffAnchorScrollCss2?: Dynamic,
  ..._extraArguments: unknown[]
) {
  return diffAnchorScrollCss2 !== null &&
    /^vh-[A-Za-z0-9_]*$/.test(diffAnchorScrollCss2)
    ? `#${diffAnchorScrollCss2}{scroll-initial-target:nearest}`
    : ``;
}
function versionDiffPreviewHtml(
  versionDiffPreviewHtml2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let label: string = context.mode === `dark` ? `dark` : `light`;
  return `<!doctype html><html class="cds-root" data-mode="${label}" data-theme="${label}"><meta http-equiv="Content-Security-Policy" content="${EditorHostStyles13}"><style>${EditorHostState}${versionDiffPreviewHtml2}${resolveDataModelSchemasReplace(EditorHostState2)}${EditorHostSans}${EditorExtensionsBlue2}${VERSION_DIFF_CSS}${diffAnchorScrollCss(context.firstAnchor)}${VERSION_PREVIEW_DOCUMENT_CSS}</style><body><div data-lfile-doc>${options}</div>`;
}
var FORBIDDEN_PREVIEW_ELEMENTS: string = `meta, base, link, form, area, animate, animateColor, animateMotion, animateTransform, set, template, iframe, frame, embed, object, svg, math`;
var FORBIDDEN_PREVIEW_ATTRIBUTES: Dynamic = [
  `href`,
  `xlink:href`,
  `ping`,
  `formaction`,
  `http-equiv`,
  `srcdoc`,
  `data`,
  `shadowrootmode`,
];
var MAX_PREVIEW_SANITIZE_ROUNDS: number = 3;
function sanitizePreviewHtmlOnce(
  sanitizePreviewHtmlOnce2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let options2: Dynamic = options(
    `<!doctype html><body>${sanitizePreviewHtmlOnce2}</body>`,
  );
  for (let sanitizePreviewHtmlOnceResult of Array.from<Dynamic>(
    options2.querySelectorAll(FORBIDDEN_PREVIEW_ELEMENTS),
  ) as Dynamic)
    sanitizePreviewHtmlOnceResult.remove();
  for (let sanitizePreviewHtmlOnceResult of Array.from<Dynamic>(
    options2.body.querySelectorAll(`*`),
  ) as Dynamic)
    for (let sanitizePreviewHtmlOnceResult2 of FORBIDDEN_PREVIEW_ATTRIBUTES as Dynamic)
      if (
        sanitizePreviewHtmlOnceResult.hasAttribute(
          sanitizePreviewHtmlOnceResult2,
        )
      ) {
        sanitizePreviewHtmlOnceResult.removeAttribute(
          sanitizePreviewHtmlOnceResult2,
        );
      }
  return options2.body.innerHTML;
}
function sanitizePreviewHtml(
  sanitizePreviewHtml2?: Dynamic,
  options: Dynamic = (
    sanitizePreviewHtml3?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    new (DOMParser as Dynamic)().parseFromString(
      sanitizePreviewHtml3,
      `text/html`,
    ),
  ..._extraArguments: unknown[]
): Dynamic {
  let sanitizePreviewHtmlOnce2: Dynamic = sanitizePreviewHtmlOnce(
    sanitizePreviewHtml2,
    options,
  );
  if (sanitizePreviewHtmlOnce2 === sanitizePreviewHtml2)
    return sanitizePreviewHtmlOnce2;
  for (let index: number = 0; index < MAX_PREVIEW_SANITIZE_ROUNDS; index++) {
    let sanitizePreviewHtmlOnce3: Dynamic = sanitizePreviewHtmlOnce(
      sanitizePreviewHtmlOnce2,
      options,
    );
    if (sanitizePreviewHtmlOnce3 === sanitizePreviewHtmlOnce2)
      return sanitizePreviewHtmlOnce2;
    sanitizePreviewHtmlOnce2 = sanitizePreviewHtmlOnce3;
  }
  return ``;
}
/* Subsystem: preview-sources */
function publishPreviewDiffStats(
  publishPreviewDiffStats2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  if (
    publishPreviewDiffStats2 === null ||
    publishPreviewDiffStats2.stats === null
  ) {
    updatePlatformSyncAndRoutingStats(null);
    return;
  }
  updatePlatformSyncAndRoutingStats(publishPreviewDiffStats2.stats, options);
}
function parseVisualizeSource(
  name?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (typeof options != `object` || !options || Array.isArray(options))
    return null;
  let options2: Dynamic = options;
  let kind: Dynamic =
    typeof options2.kind == `string` ? options2.kind : undefined;
  let label: Dynamic =
    typeof options2.label == `string` && options2.label !== ``
      ? options2.label
      : undefined;
  return kind === `data`
    ? {
        name: name,
        kind: `data`,
        ...(label
          ? {
              label: label,
            }
          : {}),
      }
    : kind === `node` && typeof options2.ref == `string`
      ? {
          name: name,
          kind: `node`,
          ref: options2.ref,
          parsed: resolveEditorAnchorsAndMentionsKind(options2.ref),
          ...(label
            ? {
                label: label,
              }
            : {}),
        }
      : (kind === `ref` || kind === undefined) &&
          typeof options2.ref == `string`
        ? {
            name: name,
            kind: `ref`,
            ref: options2.ref,
            parsed: resolveEditorAnchorsAndMentionsKind(options2.ref),
            pinnedRun: resolveEditorAnchorsAndMentionsSplit(options2.ref),
            ...(label
              ? {
                  label: label,
                }
              : {}),
          }
        : null;
}
function parseVisualizeSources(
  visualizeSources?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (
    typeof visualizeSources != `object` ||
    !visualizeSources ||
    Array.isArray(visualizeSources)
  )
    return [];
  let items: Dynamic = [];
  for (let [
    parseVisualizeSourcesResult,
    parseVisualizeSourcesResult2,
  ] of Object.entries(visualizeSources) as Dynamic) {
    let visualizeSource: Dynamic = parseVisualizeSource(
      parseVisualizeSourcesResult,
      parseVisualizeSourcesResult2,
    );
    if (visualizeSource) {
      items.push(visualizeSource);
    }
  }
  return items;
}
function extractVisualizeSources(
  extractVisualizeSources2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items: Dynamic = [];
  for (let entry of (extractVisualizeSources2 ?? []) as Dynamic) {
    if ((entry.method ?? entry.kind) !== `Visualize`) continue;
    let argItem: Dynamic = entry.args?.[0];
    if (
      !argItem ||
      !(`lit` in argItem) ||
      argItem.lit === null ||
      typeof argItem.lit != `object`
    )
      continue;
    let lit: Dynamic = argItem.lit;
    if (
      !(
        lit.sources === null ||
        typeof lit.sources != `object` ||
        Array.isArray(lit.sources)
      )
    ) {
      items.push(lit);
    }
  }
  let lookup: Dynamic = new (Map as Dynamic)();
  return items.map(
    (
      node?: Dynamic,
      index?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => {
      let component: Dynamic =
        typeof node.component == `string` && node.component !== ``
          ? node.component
          : typeof node.id == `string` && node.id !== ``
            ? node.id
            : typeof node.anchor == `string` && node.anchor !== ``
              ? node.anchor
              : null;
      let mode: Dynamic =
        node.mode === `hand` || node.mode === `engine`
          ? node.mode
          : node.children === undefined
            ? node.definition !== undefined && node.definition !== null
              ? `engine`
              : null
            : `hand`;
      let count: Dynamic =
        component === null ? 0 : (lookup.get(component) ?? 0);
      if (component !== null) {
        lookup.set(component, count + 1);
      }
      return {
        key:
          component === null
            ? `__unnamed-${index}`
            : count === 0
              ? component
              : `${component}~dup${count}`,
        id: component,
        label:
          typeof node.label == `string` && node.label !== ``
            ? node.label
            : null,
        mode: mode,
        sources: parseVisualizeSources(node.sources),
        duplicate: count > 0,
      };
    },
  );
}
function referenceSource(
  referenceSource2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let parsed: Dynamic = resolveEditorAnchorsAndMentionsKind(referenceSource2);
  return {
    name:
      options !== undefined && options !== ``
        ? options
        : parsed === null
          ? referenceSource2
          : parsed.kind === `run`
            ? `pinned run`
            : parsed.id,
    kind: `ref`,
    ref: referenceSource2,
    parsed: parsed,
    pinnedRun: resolveEditorAnchorsAndMentionsSplit(referenceSource2),
  };
}
function extractNamedReadSources(
  extractNamedReadSources2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let lookup: Dynamic = new (Map as Dynamic)();
  for (let extractNamedReadSourcesResult of (extractNamedReadSources2 ??
    []) as Dynamic) {
    if (extractNamedReadSourcesResult.method !== `sources`) continue;
    let argItem: Dynamic = extractNamedReadSourcesResult.args?.[0];
    if (
      !argItem ||
      !(`lit` in argItem) ||
      !argItem.lit ||
      typeof argItem.lit != `object`
    )
      continue;
    let lit: Dynamic = argItem.lit;
    if (
      lit.type === `read` &&
      typeof lit.ref == `string` &&
      typeof lit.name == `string` &&
      lit.name.length > 0 &&
      !lookup.has(lit.ref)
    ) {
      lookup.set(lit.ref, lit.name);
    }
  }
  return lookup;
}
function mergePreviewSources(
  mergePreviewSources2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let lookup: Dynamic = new (Map as Dynamic)();
  let uniqueItems: Dynamic = new (Set as Dynamic)();
  for (let mergePreviewSourcesResult of mergePreviewSources2 as Dynamic)
    for (let mergePreviewSourcesResult2 of mergePreviewSourcesResult.sources as Dynamic) {
      lookup.set(
        `${mergePreviewSourcesResult2.name}\u0000${mergePreviewSourcesResult2.ref ?? ``}`,
        mergePreviewSourcesResult2,
      );
      if (mergePreviewSourcesResult2.ref !== undefined) {
        uniqueItems.add(mergePreviewSourcesResult2.ref);
      }
    }
  for (let mergePreviewSourcesResult of options as Dynamic)
    if (!uniqueItems.has(mergePreviewSourcesResult)) {
      lookup.set(
        `\u0000${mergePreviewSourcesResult}`,
        referenceSource(
          mergePreviewSourcesResult,
          context?.get(mergePreviewSourcesResult),
        ),
      );
    }
  return [...lookup.values()];
}
function previewSourcesEmptyMessage(
  previewSourcesEmptyMessage2?: Dynamic,
  ..._extraArguments: unknown[]
) {
  return previewSourcesEmptyMessage2
    ? `Sources unavailable — try again.`
    : `No sources`;
}
var EMPTY_PREVIEW_COMMENTS: Dynamic = [];
var previewCommentsSubscriptions: Dynamic = new (Map as Dynamic)();
var previewCommentsRequestEpochs: Dynamic = new (Map as Dynamic)();
var nextPreviewCommentsEpoch: number = 0;
var usePreviewCommentsStore: Dynamic = create(
  (
    previewCommentsStore?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => ({
    entries: {},
    mount: (
      previewCommentsStore2?: Dynamic,
      options2?: Dynamic,
      context?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      options().stop(previewCommentsStore2);
      let list = async (
        previewCommentsStore3?: Dynamic,
        ..._extraArguments: unknown[]
      ): Promise<undefined> => {
        if (!previewCommentsStore3 && (document as Dynamic).hidden) return;
        let usePreviewCommentsStoreResult: number = ++nextPreviewCommentsEpoch;
        previewCommentsRequestEpochs.set(
          previewCommentsStore2,
          usePreviewCommentsStoreResult,
        );
        try {
          let list2: Dynamic = await api.comments.list(options2, context, true);
          if (
            previewCommentsRequestEpochs.get(previewCommentsStore2) !==
            usePreviewCommentsStoreResult
          )
            return;
          let entryItem: Dynamic =
            options().entries[previewCommentsStore2] ?? EMPTY_PREVIEW_COMMENTS;
          if (JSON.stringify(entryItem) === JSON.stringify(list2)) return;
          previewCommentsStore({
            entries: {
              ...options().entries,
              [previewCommentsStore2]: list2,
            },
          });
        } catch {}
      };
      list(true);
      previewCommentsSubscriptions.set(
        previewCommentsStore2,
        setInterval(
          (..._extraArguments: unknown[]): undefined => void list(false),
          7e3,
        ),
      );
    },
    stop: (
      previewCommentsStore2?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      let previewCommentsSubscriptionEntry: Dynamic =
        previewCommentsSubscriptions.get(previewCommentsStore2);
      if (previewCommentsSubscriptionEntry !== undefined) {
        clearInterval(previewCommentsSubscriptionEntry);
        previewCommentsSubscriptions.delete(previewCommentsStore2);
      }
      previewCommentsRequestEpochs.set(
        previewCommentsStore2,
        ++nextPreviewCommentsEpoch,
      );
    },
    release: (
      previewCommentsStore2?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      options().stop(previewCommentsStore2);
      previewCommentsRequestEpochs.delete(previewCommentsStore2);
      if (previewCommentsStore2 in options().entries) {
        let { [previewCommentsStore2]: entries, ...entries2 }: Dynamic =
          options().entries;
        previewCommentsStore({
          entries: entries2,
        });
      }
    },
  }),
);
var MAX_CENSUS_VALUE: number = 1e6;
var CENSUS_REPORT_LIMIT: number = 1e3;
var CENSUS_SAMPLE_LIMIT: number = 2e3;
/* Subsystem: preview-comments */
function isEmptyCensus(
  emptyCensus?: Dynamic,
  ..._extraArguments: unknown[]
): boolean {
  return (
    emptyCensus.datum.total === 0 &&
    emptyCensus.textIds.total === 0 &&
    emptyCensus.anchors.total === 0 &&
    emptyCensus.misses === 0
  );
}
var CENSUS_DATUM_LABEL: string = `datum`;
`${CENSUS_DATUM_LABEL}${CENSUS_DATUM_LABEL}`;
`${CENSUS_DATUM_LABEL}`;
var missingDatumMessage = (
  missingDatumMessage2?: Dynamic,
  ..._extraArguments: unknown[]
) =>
  `${missingDatumMessage2} ${missingDatumMessage2 === 1 ? `mark carries` : `marks carry`} no datum: pass the row object you received, not a copy`;
function censusTotal(census?: Dynamic, ..._extraArguments: unknown[]): Dynamic {
  return census == null
    ? 0
    : census.datum.total + census.textIds.total + census.anchors.total;
}
function censusWarnings(
  censusWarnings2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (censusWarnings2 == null || isEmptyCensus(censusWarnings2)) return [];
  let items: Dynamic = [];
  if (censusWarnings2.datum.total > 0) {
    let {
      total: datum,
      pairs: datum2,
      unreadable: datum3,
      first: items2,
    }: Dynamic = censusWarnings2.datum;
    let items3: Dynamic = [];
    if (datum2 > 0) {
      items3.push(`${datum2} ${datum2 === 1 ? `column` : `columns`}`);
    }
    if (datum3 > 0) {
      items3.push(`${datum3} unreadable`);
    }
    let label: string =
      datum > 2e3 ? `; in the first ${CENSUS_SAMPLE_LIMIT}: ` : `, `;
    items.push({
      key: `datum`,
      label: `Data marks: ${datum} stamped${items3.length > 0 ? label + items3.join(`, `) : ``}`,
      items: items2,
    });
  }
  if (censusWarnings2.textIds.total > 0) {
    items.push({
      key: `textIds`,
      label: `Text ids: ${censusWarnings2.textIds.total}`,
      items: censusWarnings2.textIds.first,
    });
  }
  if (censusWarnings2.anchors.total > 0) {
    items.push({
      key: `anchors`,
      label: `Named elements: ${censusWarnings2.anchors.total}`,
      items: censusWarnings2.anchors.first,
    });
  }
  if (censusWarnings2.misses > 0) {
    items.push({
      key: `misses`,
      label: missingDatumMessage(censusWarnings2.misses),
      items: [],
    });
  }
  return items;
}
var useCensusStore: Dynamic = create(
  (censusStore?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
    byKey: new (Map as Dynamic)(),
    set: (
      censusStore2?: Dynamic,
      options?: Dynamic,
      context?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic =>
      censusStore(
        (censusStore3?: Dynamic, ..._extraArguments: unknown[]): Dynamic => {
          let useCensusStoreResult: string =
            resolveEditorSelectionAndTablesValue11(censusStore2, options);
          let byKeyEntry: Dynamic =
            censusStore3.byKey.get(useCensusStoreResult);
          if (context === null || isEmptyCensus(context)) {
            if (byKeyEntry === undefined) return censusStore3;
            let byKey2: Dynamic = new (Map as Dynamic)(censusStore3.byKey);
            byKey2.delete(useCensusStoreResult);
            return {
              byKey: byKey2,
            };
          }
          if (
            byKeyEntry !== undefined &&
            JSON.stringify(byKeyEntry) === JSON.stringify(context)
          )
            return censusStore3;
          let byKey: Dynamic = new (Map as Dynamic)(censusStore3.byKey);
          byKey.delete(useCensusStoreResult);
          byKey.set(useCensusStoreResult, context);
          for (let useCensusStoreResult2 of byKey.keys() as Dynamic) {
            if (byKey.size <= 200) break;
            byKey.delete(useCensusStoreResult2);
          }
          return {
            byKey: byKey,
          };
        },
      ),
    clearFile: (
      censusStore2?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic =>
      censusStore(
        (censusStore3?: Dynamic, ..._extraArguments: unknown[]): Dynamic => {
          let useCensusStoreResult: string =
            resolveEditorSelectionAndTablesValue11(censusStore2, ``);
          let filteredItems: Dynamic = [...censusStore3.byKey.keys()].filter(
            (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              item.startsWith(useCensusStoreResult),
          );
          if (filteredItems.length === 0) return censusStore3;
          let byKey: Dynamic = new (Map as Dynamic)(censusStore3.byKey);
          for (let useCensusStoreResult2 of filteredItems as Dynamic)
            byKey.delete(useCensusStoreResult2);
          return {
            byKey: byKey,
          };
        },
      ),
  }),
);
var COMMENT_RETRY_DELAYS: Dynamic = [250, 1e3, 3e3, 1e4];
function createCommentAnchorRetryQueue(
  commentAnchorRetryQueue?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let ladderMs: Dynamic =
    commentAnchorRetryQueue.ladderMs ?? COMMENT_RETRY_DELAYS;
  let lookup: Dynamic = new (Map as Dynamic)();
  let enabled: boolean = false;
  let attempt = (
    ask?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    let record: Dynamic = {
      ev: ask,
      park: null,
      claimed: false,
    };
    lookup.set(ask.threadId, record);
    let createCommentAnchorRetryQueueHandler = (
      ..._extraArguments: unknown[]
    ) => lookup.get(ask.threadId) === record;
    let createCommentAnchorRetryQueueHandler2: Dynamic = (
      ..._extraArguments: unknown[]
    ): boolean =>
      enabled || !createCommentAnchorRetryQueueHandler()
        ? false
        : ((record.claimed = true), true);
    let onReady = (
      commentAnchorRetryQueue2?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      if (!createCommentAnchorRetryQueueHandler()) return;
      if (commentAnchorRetryQueue2 !== `unanchored`)
        return void lookup.delete(ask.threadId);
      if (enabled || !commentAnchorRetryQueue.alive())
        return void (lookup.delete(ask.threadId),
        commentAnchorRetryQueue.repark(ask, `unmounted`));
      if (options >= ladderMs.length) {
        lookup.delete(ask.threadId);
        commentAnchorRetryQueue.sayNoAnchor(ask);
        if (!commentAnchorRetryQueue.gone(ask)) {
          commentAnchorRetryQueue.repark(ask, `exhausted`);
        }
        return;
      }
      let enabled2: boolean = false;
      let createCommentAnchorRetryQueueHandler3 = (
        ..._extraArguments: unknown[]
      ): undefined => {};
      let createCommentAnchorRetryQueueHandler4 = (
        ..._extraArguments: unknown[]
      ): undefined => {};
      let createCommentAnchorRetryQueueHandler5: Dynamic = (
        ..._extraArguments: unknown[]
      ): Dynamic => (
        createCommentAnchorRetryQueueHandler3(),
        createCommentAnchorRetryQueueHandler4()
      );
      let repark = (..._extraArguments: unknown[]): undefined => {
        if (!(enabled2 || !createCommentAnchorRetryQueueHandler())) {
          enabled2 = true;
          createCommentAnchorRetryQueueHandler5();
          if (enabled || !commentAnchorRetryQueue.alive())
            return void (lookup.delete(ask.threadId),
            commentAnchorRetryQueue.repark(ask, `unmounted`));
          attempt(ask, options + 1);
        }
      };
      record.park = (..._extraArguments: unknown[]): undefined => {
        if (!enabled2) {
          enabled2 = true;
          createCommentAnchorRetryQueueHandler5();
          lookup.delete(ask.threadId);
          commentAnchorRetryQueue.repark(ask, `unmounted`);
        }
      };
      createCommentAnchorRetryQueueHandler3 = commentAnchorRetryQueue.wait(
        repark,
        ladderMs[options],
      );
      createCommentAnchorRetryQueueHandler4 =
        commentAnchorRetryQueue.onReady(repark);
    };
    commentAnchorRetryQueue
      .attempt(ask, createCommentAnchorRetryQueueHandler2)
      .then(
        onReady,
        (..._extraArguments: unknown[]): Dynamic => onReady(`threw`),
      );
  };
  return {
    run(ask?: Dynamic, ..._extraArguments: unknown[]): undefined {
      if (enabled) return void commentAnchorRetryQueue.repark(ask, `unmounted`);
      if (!lookup.has(ask.threadId)) {
        attempt(ask, 0);
      }
    },
    dispose(..._extraArguments: unknown[]): undefined {
      enabled = true;
      for (let createCommentAnchorRetryQueueResult of Array.from<Dynamic>(
        lookup.values(),
      ) as Dynamic)
        if (createCommentAnchorRetryQueueResult.park === null) {
          if (!createCommentAnchorRetryQueueResult.claimed) {
            lookup.delete(createCommentAnchorRetryQueueResult.ev.threadId);
            commentAnchorRetryQueue.repark(
              createCommentAnchorRetryQueueResult.ev,
              `unmounted`,
            );
          }
        } else {
          createCommentAnchorRetryQueueResult.park();
        }
    },
    get size(): Dynamic {
      return lookup.size;
    },
  };
}
var CLAUDE_SESSION_SEND_CAPABILITIES: Dynamic = new (Set as Dynamic)([
  `available`,
  `available_if_summoned`,
  `no_session`,
  `unsupported`,
  `off`,
]);
var CLAUDE_SESSION_SEND_FAILURES: Dynamic = new (Set as Dynamic)([
  `invalid_argument`,
  `claude_unavailable`,
  `rate_limited`,
  `upstream_error`,
  `capability_removed`,
  `no_gesture`,
]);
var isSessionRoomObject: Dynamic = (
  sessionRoomObject?: Dynamic,
  ..._extraArguments: unknown[]
): boolean => typeof sessionRoomObject == `object` && !!sessionRoomObject;
var isClaudeSessionRoom: Dynamic = (
  claudeSessionRoom?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  isSessionRoomObject(claudeSessionRoom) &&
  typeof claudeSessionRoom.canSendToClaudeSession == `function` &&
  typeof claudeSessionRoom.sendToClaudeSession == `function`;
/* Subsystem: claude-session-send */
async function resolveClaudeSessionRoom(
  claudeSessionRoom?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  if (typeof claudeSessionRoom.use == `function`)
    try {
      let use: Dynamic = await claudeSessionRoom.use(`room`);
      if (isClaudeSessionRoom(use)) return use;
      if (use === null) return null;
    } catch {}
  return isClaudeSessionRoom(claudeSessionRoom.room)
    ? claudeSessionRoom.room
    : null;
}
var claudeSessionSendFailure: Dynamic = (
  error?: Dynamic,
  ..._extraArguments: unknown[]
): string => {
  let code: Dynamic = isSessionRoomObject(error) ? error.code : undefined;
  return typeof code == `string` && CLAUDE_SESSION_SEND_FAILURES.has(code)
    ? code
    : `other`;
};
var normalizeClaudeSessionSendResult: Dynamic = (
  post?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let to2: Dynamic = isSessionRoomObject(post) ? post.to : undefined;
  let id2: Dynamic = isSessionRoomObject(post) ? post.id : undefined;
  return {
    ok: true,
    sent: {
      to: to2 === `pane` || to2 === `session` || to2 === `new` ? to2 : `other`,
      ...(typeof id2 == `string` &&
        id2 !== `` && {
          id: id2,
        }),
    },
  };
};
var normalizeClaudeSessionSendStatus: Dynamic = (
  claudeSessionSendStatus?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let state: Dynamic = isSessionRoomObject(claudeSessionSendStatus)
    ? claudeSessionSendStatus.state
    : undefined;
  if (state !== `working` && state !== `sent` && state !== `failed`)
    return null;
  let reason: Dynamic = isSessionRoomObject(claudeSessionSendStatus)
    ? claudeSessionSendStatus.reason
    : undefined;
  return {
    state: state,
    ...(typeof reason == `string` && {
      reason: reason,
    }),
  };
};
function createClaudeSessionSender(
  claudeSessionSender?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let label: string = `unasked`;
  let createClaudeSessionSenderResult: Dynamic = null;
  let index: number = 0;
  return {
    last: (..._extraArguments: unknown[]): string => label,
    async probe(..._extraArguments: unknown[]): Promise<Dynamic> {
      let createClaudeSessionSenderResult2: number = ++index;
      let label2: string = `unknown`;
      let createClaudeSessionSenderResult3: Dynamic = null;
      try {
        let claudeSessionSender2: Dynamic = claudeSessionSender();
        createClaudeSessionSenderResult3 =
          claudeSessionSender2 == null
            ? null
            : await resolveClaudeSessionRoom(claudeSessionSender2);
        if (createClaudeSessionSenderResult3 !== null) {
          let canSendToClaudeSession: Dynamic =
            await createClaudeSessionSenderResult3.canSendToClaudeSession();
          label2 =
            typeof canSendToClaudeSession == `string` &&
            CLAUDE_SESSION_SEND_CAPABILITIES.has(canSendToClaudeSession)
              ? canSendToClaudeSession
              : `unknown`;
        }
      } catch {
        label2 = `unknown`;
      }
      if (createClaudeSessionSenderResult2 === index) {
        label = label2;
        createClaudeSessionSenderResult = createClaudeSessionSenderResult3;
      }
      return label2;
    },
    send(
      claudeSessionSender2?: Dynamic,
      options?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic {
      let createClaudeSessionSenderResult2: Dynamic =
        createClaudeSessionSenderResult;
      if (createClaudeSessionSenderResult2 === null) return null;
      let createClaudeSessionSenderResult3: Dynamic;
      try {
        createClaudeSessionSenderResult3 =
          createClaudeSessionSenderResult2.sendToClaudeSession(
            claudeSessionSender2,
            {
              deliver: `send`,
              ...(options && {
                onStatus: (
                  claudeSessionSender3?: Dynamic,
                  ..._extraArguments: unknown[]
                ): undefined => {
                  let claudeSessionSendStatus: Dynamic =
                    normalizeClaudeSessionSendStatus(claudeSessionSender3);
                  if (claudeSessionSendStatus !== null)
                    try {
                      options(claudeSessionSendStatus);
                    } catch {}
                },
              }),
            },
          );
      } catch (createClaudeSessionSenderResult4: Dynamic) {
        return Promise.resolve({
          ok: false,
          code: claudeSessionSendFailure(createClaudeSessionSenderResult4),
        });
      }
      return Promise.resolve(createClaudeSessionSenderResult3).then(
        normalizeClaudeSessionSendResult,
        (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
          ok: false,
          code: claudeSessionSendFailure(result),
        }),
      );
    },
  };
}
var MAX_REQUEST_LABEL_GRAPHEMES: number = 8;
var UNSENDABLE_CONTROL_PATTERN: Dynamic =
  /^[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]$/;
var PRIVATE_OR_FORMAT_CHARACTER_PATTERN: Dynamic = /^[\p{Cf}\p{Co}]$/u;
var UNSENDABLE_CODE_POINT_RANGES: Dynamic = [
  [173, 173],
  [847, 847],
  [1564, 1564],
  [4447, 4448],
  [6068, 6069],
  [6155, 6159],
  [8203, 8207],
  [8234, 8238],
  [8288, 8303],
  [10240, 10240],
  [12644, 12644],
  [65024, 65039],
  [65279, 65279],
  [65440, 65440],
  [65520, 65528],
  [65533, 65533],
  [94180, 94180],
  [113824, 113827],
  [119155, 119162],
  [917504, 921599],
];
var isUnsendableCodePoint: Dynamic = (
  unsendableCodePoint?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  UNSENDABLE_CODE_POINT_RANGES.some(
    (
      [UNSENDABLECODEPOINTRANGES, UNSENDABLECODEPOINTRANGES2]: Dynamic,
      ..._extraArguments: unknown[]
    ): boolean =>
      unsendableCodePoint >= UNSENDABLECODEPOINTRANGES &&
      unsendableCodePoint <= UNSENDABLECODEPOINTRANGES2,
  );
var isUnicodeNoncharacter: Dynamic = (
  unicodeNoncharacter?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  (unicodeNoncharacter >= 64976 && unicodeNoncharacter <= 65007) ||
  (unicodeNoncharacter & 65534) == 65534;
var EMOJI_CHARACTER_PATTERN: Dynamic =
  /^[\p{Extended_Pictographic}\p{Emoji_Modifier}]$/u;
var KEYCAP_BASE_PATTERN: Dynamic = /^[#*0-9]$/;
var HAN_CHARACTER_PATTERN: Dynamic = /^\p{Script=Han}$/u;
var COMBINING_SCRIPT_PATTERN: Dynamic =
  /^[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Mongolian}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Myanmar}\p{Script=Tibetan}\p{Script=Khmer}]$/u;
function isSendableRequestText(items?: Dynamic, ..._extraArguments: unknown[]) {
  if (items.length > 4096) return false;
  let index: number = 0;
  let label: string = `none`;
  for (let items2 of items as Dynamic) {
    let codePointAt: Dynamic = items2.codePointAt(0) ?? 0;
    if (items2.length === 1 && codePointAt >= 55296 && codePointAt <= 57343)
      return false;
    if (
      (codePointAt >= 65024 && codePointAt <= 65039) ||
      (codePointAt >= 917760 && codePointAt <= 917999)
    ) {
      if (
        !(codePointAt <= 65039
          ? label === `pictograph` ||
            label === `han` ||
            (label === `keycap` && codePointAt === 65039)
          : label === `han`) ||
        ++index > MAX_REQUEST_LABEL_GRAPHEMES
      )
        return false;
      label =
        label === `pictograph` && codePointAt === 65039 ? `selector` : `none`;
    } else if (codePointAt === 8205 || codePointAt === 8204) {
      if (
        !(
          (codePointAt === 8205 &&
            (label === `pictograph` || label === `selector`)) ||
          label === `joining`
        ) ||
        ++index > MAX_REQUEST_LABEL_GRAPHEMES
      )
        return false;
      label = `none`;
    } else if (
      UNSENDABLE_CONTROL_PATTERN.test(items2) ||
      PRIVATE_OR_FORMAT_CHARACTER_PATTERN.test(items2) ||
      isUnsendableCodePoint(codePointAt) ||
      isUnicodeNoncharacter(codePointAt)
    )
      return false;
    else
      label = EMOJI_CHARACTER_PATTERN.test(items2)
        ? `pictograph`
        : KEYCAP_BASE_PATTERN.test(items2)
          ? `keycap`
          : HAN_CHARACTER_PATTERN.test(items2)
            ? `han`
            : COMBINING_SCRIPT_PATTERN.test(items2)
              ? `joining`
              : `plain`;
  }
  return true;
}
var normalizeRequestText: Dynamic = (
  requestText?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  requestText
    .replace(
      /\r\n?/g,
      `
`,
    )
    .trim();
function shortRequestLabel(
  shortRequestLabel2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let replace: Dynamic = shortRequestLabel2.replace(/\s+/g, ` `);
  let test: Dynamic = (
    shortRequestLabel3?: Dynamic,
    ..._extraArguments: unknown[]
  ): boolean =>
    shortRequestLabel3 === ` ` ||
    shortRequestLabel3 === `‍` ||
    /^[\uFE00-\uFE0F]$/u.test(shortRequestLabel3) ||
    /^[\u{E0100}-\u{E01EF}]$/u.test(shortRequestLabel3);
  let items: Dynamic = [];
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter == `function`) {
    let count: number = 0;
    for (let {
      segment: shortRequestLabelResult,
    } of new (Intl.Segmenter as Dynamic)(undefined, {
      granularity: `grapheme`,
    }).segment(replace) as Dynamic) {
      let shortRequestLabelResult2: Dynamic = Array.from<Dynamic>(
        shortRequestLabelResult,
      );
      if (count + shortRequestLabelResult2.length > 120) break;
      (items.push as Dynamic)(...shortRequestLabelResult2);
      count += shortRequestLabelResult2.length;
    }
  } else items = Array.from<Dynamic>(replace).slice(0, 120);
  for (; items.length > 0 && test(items[items.length - 1]); ) items.pop();
  return items.join(``);
}
function buildClaudeRequest(
  claudeRequest?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let request: Dynamic = normalizeRequestText(claudeRequest.request);
  if (request.length > 4096)
    return {
      bag: null,
      why: `too_long`,
    };
  if (
    request === `` ||
    !isSendableRequestText(request) ||
    !isSendableRequestText(claudeRequest.instruction)
  )
    return {
      bag: null,
      why: `unsendable`,
    };
  let label: Dynamic = shortRequestLabel(request);
  let bag: Dynamic = {
    ...(isSendableRequestText(label) && {
      label: label,
    }),
    request: request,
    instruction: claudeRequest.instruction,
  };
  for (let [buildClaudeRequestResult, buildClaudeRequestResult2] of [
    [`tab`, claudeRequest.tab],
    [`nodeId`, claudeRequest.nodeId],
    [`blockId`, claudeRequest.blockId],
  ] as Dynamic)
    if (
      !(
        typeof buildClaudeRequestResult2 != `string` ||
        buildClaudeRequestResult2 === ``
      )
    ) {
      if (!isSendableRequestText(buildClaudeRequestResult2))
        return {
          bag: null,
          why: `unsendable`,
        };
      bag[buildClaudeRequestResult] = buildClaudeRequestResult2;
    }
  return new (TextEncoder as Dynamic)().encode(JSON.stringify(bag)).length <=
    4096
    ? {
        bag: bag,
      }
    : {
        bag: null,
        why: `too_long`,
      };
}
var ownCensusProperty: Dynamic = (
  ownCensusProperty2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  Object.hasOwn(ownCensusProperty2, options)
    ? ownCensusProperty2[options]
    : undefined;
var asCensusObject: Dynamic = (
  asCensusObject2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  typeof asCensusObject2 == `object` &&
  asCensusObject2 &&
  !Array.isArray(asCensusObject2)
    ? asCensusObject2
    : null;
var clampCensusCount: Dynamic = (
  clampCensusCount2?: Dynamic,
  options: Dynamic = MAX_CENSUS_VALUE,
  ..._extraArguments: unknown[]
): number =>
  typeof clampCensusCount2 == `number` && !Number.isNaN(clampCensusCount2)
    ? Math.trunc(Math.min(Math.max(clampCensusCount2, 0), options))
    : 0;
/* Subsystem: request-census */
function parseCensusExamples(
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (!Array.isArray(items)) return [];
  let uniqueItems: Dynamic = new (Set as Dynamic)();
  let min: number = Math.min(items.length, 20);
  for (let index: number = 0; index < min; index++) {
    let itemItem: Dynamic = items[index];
    if (typeof itemItem != `string`) continue;
    let items2: Dynamic = resolveCommentsStoreTrim2(
      resolveCommentsStoreCharCodeAt(itemItem, 200),
    );
    if (items2.length > 0) {
      uniqueItems.add(items2);
    }
  }
  return [...uniqueItems];
}
function parseCensus(census?: Dynamic, ..._extraArguments: unknown[]): Dynamic {
  let asCensusObject2: Dynamic = asCensusObject(census);
  if (asCensusObject2 === null) return null;
  let asCensusObject3: Dynamic = asCensusObject(
    ownCensusProperty(asCensusObject2, `datum`),
  );
  let asCensusObject4: Dynamic = asCensusObject(
    ownCensusProperty(asCensusObject2, `textIds`),
  );
  let asCensusObject5: Dynamic = asCensusObject(
    ownCensusProperty(asCensusObject2, `anchors`),
  );
  if (
    asCensusObject3 === null ||
    asCensusObject4 === null ||
    asCensusObject5 === null
  )
    return null;
  let first: Dynamic = parseCensusExamples(
    ownCensusProperty(asCensusObject3, `first`),
  );
  let first2: Dynamic = parseCensusExamples(
    ownCensusProperty(asCensusObject4, `first`),
  );
  let first3: Dynamic = parseCensusExamples(
    ownCensusProperty(asCensusObject5, `first`),
  );
  let total: number = Math.max(
    clampCensusCount(ownCensusProperty(asCensusObject3, `total`)),
    first.length,
  );
  return {
    datum: {
      total: total,
      pairs: Math.min(
        clampCensusCount(
          ownCensusProperty(asCensusObject3, `pairs`),
          CENSUS_REPORT_LIMIT,
        ),
        total,
      ),
      unreadable: Math.min(
        clampCensusCount(ownCensusProperty(asCensusObject3, `unreadable`)),
        total,
      ),
      first: first,
    },
    textIds: {
      total: Math.max(
        clampCensusCount(ownCensusProperty(asCensusObject4, `total`)),
        first2.length,
      ),
      first: first2,
    },
    anchors: {
      total: Math.max(
        clampCensusCount(ownCensusProperty(asCensusObject5, `total`)),
        first3.length,
      ),
      first: first3,
    },
    misses: clampCensusCount(ownCensusProperty(asCensusObject2, `misses`)),
  };
}
function parseCensusReport(
  censusReport?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let asCensusObject2: Dynamic = asCensusObject(censusReport);
  if (asCensusObject2 === null) return null;
  let nodeId: Dynamic = options(ownCensusProperty(asCensusObject2, `nodeId`));
  if (nodeId === ``) return null;
  let census: Dynamic = parseCensus(asCensusObject2);
  return census === null
    ? null
    : {
        nodeId: nodeId,
        census: census,
      };
}
var unavailablePagesModule: Dynamic = createLiveModuleNamespace({
  ActionsPage: (..._extraArguments: unknown[]): Dynamic => ActionsPage,
  Home: (..._extraArguments: unknown[]): Dynamic => Home,
  ManifestReplay: (..._extraArguments: unknown[]): Dynamic => ManifestReplay,
  Runs: (..._extraArguments: unknown[]): Dynamic => Runs,
  Sessions: (..._extraArguments: unknown[]): Dynamic => Sessions,
  Settings: (..._extraArguments: unknown[]): Dynamic => Settings,
  SuiteRun: (..._extraArguments: unknown[]): Dynamic => SuiteRun,
  SuiteRunsHome: (..._extraArguments: unknown[]): Dynamic => SuiteRunsHome,
  Workspace: (..._extraArguments: unknown[]): Dynamic => Workspace,
});
var unavailablePagesJsxRuntime: Dynamic = loadJsxRuntime();

var ActionsPage: Dynamic = UnavailablePage;
var Home: Dynamic = UnavailablePage;
var ManifestReplay: Dynamic = UnavailablePage;
var Runs: Dynamic = UnavailablePage;
var Sessions: Dynamic = UnavailablePage;
var Settings: Dynamic = UnavailablePage;
var SuiteRun: Dynamic = UnavailablePage;
var SuiteRunsHome: Dynamic = UnavailablePage;
var Workspace: Dynamic = UnavailablePage;
var ironScopeModule: Dynamic = createLiveModuleNamespace({
  IronScope: (..._extraArguments: unknown[]): Dynamic => IronScope,
  default: (..._extraArguments: unknown[]): Dynamic => IronScopePassthrough,
});
function IronScopePassthrough(
  { children: children }: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return children ?? null;
}
var IronScope: Dynamic = IronScopePassthrough;
var shareDialogModule: Dynamic = createLiveModuleNamespace({
  ShareDialog: (..._extraArguments: unknown[]): Dynamic => ShareDialog,
});
function ShareDialog(shareDialog?: unknown, ..._extraArguments: unknown[]) {
  return null;
}
var spreadsheetPageModule: Dynamic = createLiveModuleNamespace({
  default: (..._extraArguments: unknown[]): Dynamic =>
    SpreadsheetUnavailablePage,
});

var CURRENCY_NAMES: Dynamic = {
  $: `USD`,
  "€": `EUR`,
  "£": `GBP`,
  "¥": `JPY`,
  "₹": `INR`,
  "₩": `KRW`,
};
var NUMBER_FORMAT_PATTERN: Dynamic =
  /^(?:(.)?([<>=^]))?([+\-( ])?([$#])?(0)?(\d+)?(,)?(\.\d+)?(~)?([a-z%])?$/i;
var SUPPORTED_NUMBER_FORMAT_TYPES: Dynamic = new (Set as Dynamic)([
  `f`,
  `d`,
  `%`,
  `s`,
]);
var NUMBER_FORMAT_HELP: string = `number formats read [+][,][.digits][~][type] with type f (fixed decimals), d (integer), % (percent), s (SI prefix: k, M, B) or no type — e.g. ",.0f", ".1%", "~s", ",d"; a currency mark or a unit is literal text in "prefix" / "suffix" ({"kind": "number", "spec": "~s", "prefix": "$"})`;
var currencyFormatHelp = (
  currency?: Dynamic,
  options: Dynamic = `$`,
  ..._extraArguments: unknown[]
) =>
  `money is prefix text — {"kind": "number", "spec": "~s", "prefix": "${options}"} (${currency})`;
var hasTimeFormatSpecifier: Dynamic = (
  time?: Dynamic,
  ..._extraArguments: unknown[]
): boolean => /%[-_0]?[A-Za-z]/.test(time);
var CURRENCY_SYMBOL_PATTERN: Dynamic = /[$€£¥₹₩]/u;
/* Subsystem: visualize-validation */
function validateNumberFormat(
  spec?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let matchItem: Dynamic = CURRENCY_SYMBOL_PATTERN.exec(spec)?.[0];
  let CURRENCYNAMESItem: Dynamic =
    matchItem === undefined ? undefined : CURRENCY_NAMES[matchItem];
  if (matchItem !== undefined && CURRENCYNAMESItem !== undefined)
    return {
      ok: false,
      message: `"${spec}" holds "${matchItem}": ${currencyFormatHelp(CURRENCYNAMESItem, matchItem)}`,
    };
  let match: Dynamic = NUMBER_FORMAT_PATTERN.exec(spec);
  if (!match)
    return {
      ok: false,
      message: `"${spec}" is not a format — ${NUMBER_FORMAT_HELP}`,
    };
  let [
    ,
    setMatch,
    match2,
    match3,
    match4,
    match5,
    match6,
    match7,
    match8,
    match9,
    match10,
  ]: Dynamic = match;
  if (
    setMatch !== undefined ||
    match2 !== undefined ||
    match5 !== undefined ||
    match6 !== undefined
  )
    return {
      ok: false,
      message: `"${spec}": padding, width and alignment are not supported — ${NUMBER_FORMAT_HELP}`,
    };
  if (match3 === `(` || match3 === ` `)
    return {
      ok: false,
      message: `"${spec}": the "${match3}" sign style is not supported — use "+" for an explicit sign or nothing`,
    };
  if (match4 === `#`)
    return {
      ok: false,
      message: `"${spec}": the "#" prefix is not supported — ${NUMBER_FORMAT_HELP}`,
    };
  let type: Dynamic = match10 === undefined ? undefined : match10;
  return type !== undefined && !SUPPORTED_NUMBER_FORMAT_TYPES.has(type)
    ? {
        ok: false,
        message: `"${spec}": type "${type}" is not supported — ${NUMBER_FORMAT_HELP}`,
      }
    : {
        ok: true,
        format: {
          kind: `number`,
          spec: spec,
          sign: match3 === `+` ? `+` : `-`,
          comma: match7 !== undefined,
          precision: match8 === undefined ? undefined : Number(match8.slice(1)),
          trim: match9 !== undefined,
          type: type,
        },
      };
}
var SUPPORTED_TIME_FORMAT_SPECIFIERS: Dynamic = {
  Y: true,
  y: true,
  m: true,
  d: true,
  e: true,
  b: true,
  B: true,
  a: true,
  A: true,
  H: true,
  I: true,
  M: true,
  S: true,
  p: true,
  q: true,
  V: true,
  G: true,
};
var TIME_FORMAT_HELP: string = `date formats use %Y %y (year) %m %b %B (month) %d %e (day) %a %A (weekday) %H %I %M %S %p (time) %q (quarter) %V %G (ISO week, week-year) and %% — e.g. "%b %Y" → Mar 2026, "%b %-d" → Mar 5`;
var ISO_WEEK_FORMAT_HELP: string = `ISO week is %V (with %G for the week-year) — %U/%W count Sunday/Monday weeks and are not in the subset`;
function parseTimeFormat(
  spec?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let parts: Dynamic = [];
  let lit: string = ``;
  for (let index: number = 0; index < spec.length; index++) {
    let specItem: Dynamic = spec[index];
    if (specItem !== `%`) {
      lit += specItem;
      continue;
    }
    let dir: Dynamic = spec[++index];
    let parseTimeFormatResult: Dynamic;
    if (dir === `-`) {
      parseTimeFormatResult = ``;
    } else {
      if (dir === `_`) {
        parseTimeFormatResult = ` `;
      } else {
        if (dir === `0`) {
          parseTimeFormatResult = `0`;
        }
      }
    }
    if (parseTimeFormatResult !== undefined) {
      dir = spec[++index];
    }
    if (dir === undefined)
      return {
        ok: false,
        message: `"${spec}" ends with a dangling % — ${TIME_FORMAT_HELP}`,
      };
    if (dir === `%` && parseTimeFormatResult === undefined) {
      lit += `%`;
      continue;
    }
    if (dir === `U` || dir === `W`)
      return {
        ok: false,
        message: `"${spec}" holds %${dir}: ${ISO_WEEK_FORMAT_HELP}`,
      };
    if (!Object.hasOwn(SUPPORTED_TIME_FORMAT_SPECIFIERS, dir))
      return {
        ok: false,
        message: `"${spec}": %${dir} is not supported — ${TIME_FORMAT_HELP}`,
      };
    if (lit) {
      parts.push({
        lit: lit,
      });
    }
    lit = ``;
    parts.push({
      dir: dir,
      pad: parseTimeFormatResult ?? (dir === `e` ? ` ` : `0`),
    });
  }
  if (lit) {
    parts.push({
      lit: lit,
    });
  }
  return parts.some(
    (part?: Dynamic, ..._extraArguments: unknown[]) => `dir` in part,
  )
    ? {
        ok: true,
        format: {
          kind: `time`,
          spec: spec,
          parts: parts,
        },
      }
    : {
        ok: false,
        message: `"${spec}" has no % directive — ${TIME_FORMAT_HELP}`,
      };
}
var MILLISECONDS_PER_DAY: number = 864e5;
var isReservedColumnName: Dynamic = (
  reservedColumnName?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => reservedColumnName.startsWith(`__`);
var RESERVED_COLUMN_NAME_MESSAGE: string = `column names starting with "__" are reserved`;
var quoteColumnName: Dynamic = (
  items?: Dynamic,
  ..._extraArguments: unknown[]
): string =>
  JSON.stringify(items.length > 40 ? `${items.slice(0, 40)}…` : items);
var reservedColumnNameMessage = (
  reservedColumnNameMessage2?: Dynamic,
  ..._extraArguments: unknown[]
) =>
  `is ${quoteColumnName(reservedColumnNameMessage2)} — ${RESERVED_COLUMN_NAME_MESSAGE}; rename the column in the query`;
function truncateColumnName(
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (items.length <= 40) return items;
  let charCodeAt: Dynamic = items.charCodeAt(39);
  let count: number = charCodeAt >= 55296 && charCodeAt <= 56319 ? 39 : 40;
  return `${items.slice(0, count)}…`;
}
7 * MILLISECONDS_PER_DAY;
function utcDateTimestamp(
  utcDateTimestamp2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let date: Dynamic = new (Date as Dynamic)(0);
  date.setUTCFullYear(utcDateTimestamp2, options, context);
  return date.getTime();
}
utcDateTimestamp(0, 0, 1);
utcDateTimestamp(1e4, 0, 1);
var UNSUPPORTED_SORT_MESSAGE: string = `not yet: order by column — ORDER BY in the query`;
var UNSUPPORTED_VISUALIZE_FEATURES: Dynamic = [
  {
    row: 2,
    kinds: [`chart`],
    path: `axes.x[0].compare`,
    cond: `minLength:2`,
    sentence: `not yet: a second compare unit`,
  },
  {
    row: 3,
    kinds: [`chart`],
    path: `axes.x[0].compare`,
    cond: `present`,
    sentence: `not yet: compare`,
  },
  {
    row: 4,
    kinds: [`chart`],
    path: `axes.x[0].yearStart`,
    cond: `present`,
    sentence: `not yet: yearStart`,
  },
  {
    row: 18,
    kinds: [`chart`],
    path: `marks[*].shape`,
    cond: `present`,
    sentence: `not yet: shape`,
  },
  {
    row: 22,
    kinds: [`table`],
    path: `columns`,
    cond: `minLength:2`,
    sentence: `not yet: a second columns entry — one header band; move the other column to rows`,
  },
  {
    row: 23,
    kinds: [`chart`],
    path: `rows`,
    cond: `present`,
    sentence: `not yet: rows`,
  },
  {
    row: 24,
    kinds: [`chart`],
    path: `axes.x[0].min`,
    cond: `present`,
    sentence: `not yet: x min/max`,
  },
  {
    row: 24,
    kinds: [`chart`],
    path: `axes.x[0].max`,
    cond: `present`,
    sentence: `not yet: x min/max`,
  },
  {
    row: 25,
    kinds: [`chart`],
    path: `axes.x[0].order.kind`,
    cond: `equals:"column"`,
    sentence: UNSUPPORTED_SORT_MESSAGE,
  },
  {
    row: 25,
    kinds: [`chart`],
    path: `marks[*].group.order.kind`,
    cond: `equals:"column"`,
    sentence: UNSUPPORTED_SORT_MESSAGE,
  },
  {
    row: 25,
    kinds: [`chart`],
    path: `marks[*].stack.order.kind`,
    cond: `equals:"column"`,
    sentence: UNSUPPORTED_SORT_MESSAGE,
  },
  {
    row: 25,
    kinds: [`chart`],
    path: `marks[*].hatch.order.kind`,
    cond: `equals:"column"`,
    sentence: UNSUPPORTED_SORT_MESSAGE,
  },
  {
    row: 25,
    kinds: [`chart`],
    path: `marks[*].dash.order.kind`,
    cond: `equals:"column"`,
    sentence: UNSUPPORTED_SORT_MESSAGE,
  },
  {
    row: 25,
    kinds: [`chart`, `table`],
    path: `columns[0].order.kind`,
    cond: `equals:"column"`,
    sentence: UNSUPPORTED_SORT_MESSAGE,
  },
  {
    row: 25,
    kinds: [`table`],
    path: `rows[*].order.kind`,
    cond: `equals:"column"`,
    sentence: UNSUPPORTED_SORT_MESSAGE,
  },
  {
    row: 27,
    kinds: [`chart`],
    path: `marks[*].sizeTitle`,
    cond: `present`,
    sentence: `not yet: sizeTitle — name the column as it should read`,
  },
  {
    row: 28,
    kinds: [`chart`],
    path: `marks[*].shadeTitle`,
    cond: `present`,
    sentence: `not yet: shadeTitle — name the column as it should read`,
  },
];
var parseVisualizePropertyPath: Dynamic = (
  visualizePropertyPath?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let items: Dynamic = [];
  for (let parseVisualizePropertyPathResult of visualizePropertyPath.matchAll(
    /([A-Za-z_$][\w$]*)|\[(\*|\d+)\]/g,
  ) as Dynamic)
    items.push(
      parseVisualizePropertyPathResult[1] === undefined
        ? parseVisualizePropertyPathResult[2] === `*`
          ? `*`
          : Number(parseVisualizePropertyPathResult[2])
        : parseVisualizePropertyPathResult[1],
    );
  return items;
};
var VISUALIZE_FEATURE_PATHS: Dynamic = new (Map as Dynamic)(
  UNSUPPORTED_VISUALIZE_FEATURES.map(
    (
      UNSUPPORTEDVISUALIZEFEATURES?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => [
      UNSUPPORTEDVISUALIZEFEATURES.path,
      parseVisualizePropertyPath(UNSUPPORTEDVISUALIZEFEATURES.path),
    ],
  ),
);
var VISUALIZE_FEATURE_EXPECTED_VALUES: Dynamic = new (Map as Dynamic)(
  UNSUPPORTED_VISUALIZE_FEATURES.flatMap(
    (
      UNSUPPORTEDVISUALIZEFEATURES?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic =>
      UNSUPPORTEDVISUALIZEFEATURES.cond.startsWith(`equals:`)
        ? [
            [
              UNSUPPORTEDVISUALIZEFEATURES.cond,
              JSON.parse(UNSUPPORTEDVISUALIZEFEATURES.cond.slice(7)),
            ],
          ]
        : [],
  ),
);
var matchesVisualizeFeatureCondition: Dynamic = (
  matchesVisualizeFeatureCondition2?: Dynamic,
  items?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  matchesVisualizeFeatureCondition2 === `present`
    ? items !== undefined
    : matchesVisualizeFeatureCondition2.startsWith(`minLength:`)
      ? Array.isArray(items) &&
        items.length >= Number(matchesVisualizeFeatureCondition2.slice(10))
      : VISUALIZE_FEATURE_EXPECTED_VALUES.has(
          matchesVisualizeFeatureCondition2,
        ) &&
        items ===
          VISUALIZE_FEATURE_EXPECTED_VALUES.get(
            matchesVisualizeFeatureCondition2,
          );
function findUnsupportedVisualizePath(
  items?: Dynamic,
  items2?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (items2.length === 0)
    return matchesVisualizeFeatureCondition(dependencies, items)
      ? [...context]
      : null;
  let [items3, ...setItems]: Dynamic = items2;
  if (items3 === `*`) {
    if (!Array.isArray(items)) return null;
    for (let index: number = 0; index < items.length; index++) {
      let findUnsupportedVisualizePath2: Dynamic = findUnsupportedVisualizePath(
        items[index],
        setItems,
        [...context, index],
        dependencies,
      );
      if (findUnsupportedVisualizePath2 !== null)
        return findUnsupportedVisualizePath2;
    }
    return null;
  }
  return typeof items3 == `number`
    ? !Array.isArray(items) || items.length <= items3
      ? null
      : findUnsupportedVisualizePath(
          items[items3],
          setItems,
          [...context, items3],
          dependencies,
        )
    : typeof items != `object` ||
        !items ||
        Array.isArray(items) ||
        !Object.hasOwn(items, items3)
      ? null
      : findUnsupportedVisualizePath(
          items[items3],
          setItems,
          [...context, items3],
          dependencies,
        );
}
function findUnsupportedVisualizeFeature(
  findUnsupportedVisualizeFeature2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  for (let findUnsupportedVisualizeFeatureResult of UNSUPPORTED_VISUALIZE_FEATURES as Dynamic) {
    if (!findUnsupportedVisualizeFeatureResult.kinds.includes(options))
      continue;
    let path: Dynamic = findUnsupportedVisualizePath(
      findUnsupportedVisualizeFeature2,
      VISUALIZE_FEATURE_PATHS.get(findUnsupportedVisualizeFeatureResult.path),
      [],
      findUnsupportedVisualizeFeatureResult.cond,
    );
    if (path !== null)
      return {
        path: path,
        message: findUnsupportedVisualizeFeatureResult.sentence,
      };
  }
  return null;
}
function createVisualizeHtmlCache(
  visualizeHtmlCache: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  let maxEntries: Dynamic = visualizeHtmlCache.maxEntries ?? 5e3;
  let maxBytes: Dynamic = visualizeHtmlCache.maxBytes ?? 8388608;
  let lookup: Dynamic = new (Map as Dynamic)();
  let count: number = 0;
  let epoch: number = 0;
  let createVisualizeHtmlCacheHandler = (
    items?: Dynamic,
    items2?: Dynamic,
    ..._extraArguments: unknown[]
  ) => (items.length + items2.length) * 2;
  let createVisualizeHtmlCacheHandler2: Dynamic = (
    visualizeHtmlCache2?: Dynamic,
    ..._extraArguments: unknown[]
  ): boolean => {
    for (let [
      createVisualizeHtmlCacheResult,
      createVisualizeHtmlCacheResult2,
    ] of lookup as Dynamic) {
      if (lookup.size < maxEntries && count + visualizeHtmlCache2 <= maxBytes)
        return true;
      if (createVisualizeHtmlCacheResult2.epoch === epoch) return false;
      lookup.delete(createVisualizeHtmlCacheResult);
      count -= createVisualizeHtmlCacheHandler(
        createVisualizeHtmlCacheResult,
        createVisualizeHtmlCacheResult2.html,
      );
    }
    return lookup.size < maxEntries && count + visualizeHtmlCache2 <= maxBytes;
  };
  return {
    begin(..._extraArguments: unknown[]): undefined {
      epoch++;
    },
    get(visualizeHtmlCache2?: Dynamic, ..._extraArguments: unknown[]): Dynamic {
      let lookupEntry: Dynamic = lookup.get(visualizeHtmlCache2);
      if (lookupEntry !== undefined) {
        lookup.delete(visualizeHtmlCache2);
        lookup.set(visualizeHtmlCache2, {
          html: lookupEntry.html,
          epoch: epoch,
        });
        return lookupEntry.html;
      }
    },
    set(
      visualizeHtmlCache2?: Dynamic,
      html?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined {
      let lookupEntry: Dynamic = lookup.get(visualizeHtmlCache2);
      if (lookupEntry !== undefined) {
        lookup.delete(visualizeHtmlCache2);
        count -= createVisualizeHtmlCacheHandler(
          visualizeHtmlCache2,
          lookupEntry.html,
        );
      }
      let visualizeHtmlCacheHandler: number = createVisualizeHtmlCacheHandler(
        visualizeHtmlCache2,
        html,
      );
      if (
        !(
          visualizeHtmlCacheHandler > maxBytes ||
          !createVisualizeHtmlCacheHandler2(visualizeHtmlCacheHandler)
        )
      ) {
        lookup.set(visualizeHtmlCache2, {
          html: html,
          epoch: epoch,
        });
        count += visualizeHtmlCacheHandler;
      }
    },
    get size(): Dynamic {
      return lookup.size;
    },
    get bytes(): number {
      return count;
    },
  };
}
var reflectApply: Dynamic = Reflect.apply;
var getOwnPropertyDescriptor: Dynamic = Object.getOwnPropertyDescriptor;
var nativePrototypeMethod: Dynamic = (
  nativePrototypeMethod2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  if (!nativePrototypeMethod2) return;
  let ownPropertyDescriptor: Dynamic = getOwnPropertyDescriptor(
    nativePrototypeMethod2,
    options,
  );
  return (
    ownPropertyDescriptor?.get ??
    (typeof ownPropertyDescriptor?.value == `function`
      ? ownPropertyDescriptor.value
      : undefined)
  );
};
var nativeEventAccessors: Dynamic = {
  isTrusted: getOwnPropertyDescriptor(new (Event as Dynamic)(`_`), `isTrusted`)
    ?.get,
  target: nativePrototypeMethod(Event.prototype, `target`),
  currentTarget: nativePrototypeMethod(Event.prototype, `currentTarget`),
  contains: nativePrototypeMethod(
    typeof Node === "undefined" ? undefined : Node.prototype,
    `contains`,
  ),
  clientX: nativePrototypeMethod(
    typeof MouseEvent === "undefined" ? undefined : MouseEvent.prototype,
    `clientX`,
  ),
  clientY: nativePrototypeMethod(
    typeof MouseEvent === "undefined" ? undefined : MouseEvent.prototype,
    `clientY`,
  ),
  closest: nativePrototypeMethod(
    typeof Element === "undefined" ? undefined : (Element as Dynamic).prototype,
    `closest`,
  ),
  cd: nativePrototypeMethod(
    typeof ClipboardEvent === "undefined"
      ? undefined
      : ClipboardEvent.prototype,
    `clipboardData`,
  ),
  dt: nativePrototypeMethod(
    typeof DragEvent === "undefined" ? undefined : DragEvent.prototype,
    `dataTransfer`,
  ),
  files: nativePrototypeMethod(
    typeof DataTransfer === "undefined" ? undefined : DataTransfer.prototype,
    `files`,
  ),
  types: nativePrototypeMethod(
    typeof DataTransfer === "undefined" ? undefined : DataTransfer.prototype,
    `types`,
  ),
  getData: nativePrototypeMethod(
    typeof DataTransfer === "undefined" ? undefined : DataTransfer.prototype,
    `getData`,
  ),
  blobType: nativePrototypeMethod(
    typeof Blob === "undefined" ? undefined : Blob.prototype,
    `type`,
  ),
  flLen: nativePrototypeMethod(
    typeof FileList === "undefined" ? undefined : FileList.prototype,
    `length`,
  ),
  flItem: nativePrototypeMethod(
    typeof FileList === "undefined" ? undefined : FileList.prototype,
    `item`,
  ),
  meSource: nativePrototypeMethod(
    typeof MessageEvent === "undefined" ? undefined : MessageEvent.prototype,
    `source`,
  ),
  meData: nativePrototypeMethod(
    typeof MessageEvent === "undefined" ? undefined : MessageEvent.prototype,
    `data`,
  ),
  gbcr: nativePrototypeMethod(
    typeof Element === "undefined" ? undefined : (Element as Dynamic).prototype,
    `getBoundingClientRect`,
  ),
  isConn: nativePrototypeMethod(
    typeof Node === "undefined" ? undefined : Node.prototype,
    `isConnected`,
  ),
  portPost: nativePrototypeMethod(
    typeof MessagePort === "undefined" ? undefined : MessagePort.prototype,
    `postMessage`,
  ),
  qMicrotask: queueMicrotask,
  sTimeout: typeof setTimeout == `function` ? setTimeout : undefined,
};
var OBJECT_MENU_CLASS: string = `ldoc-objmenu`;
var OBJECT_MENU_MORE_CLASS: string = `ldoc-more`;
var OBJECT_MENU_HOST_CLASS: string = `ldoc-objhost`;
var OBJECT_MENU_ATTRIBUTE: string = `data-objmenu`;
var OBJECT_MENU_STYLE_ID: string = `ldoc-objmenu-css`;
var OBJECT_MENU_SEAT_ATTRIBUTE: string = `data-objmenu-seat`;
var insetObjectMenuCss = (
  insetObjectMenuCss2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) => {
  let search: Dynamic = insetObjectMenuCss2.search(/[\s>+~]/);
  return `[${OBJECT_MENU_SEAT_ATTRIBUTE}=inset] ${insetObjectMenuCss2}{${options}}${search < 0 ? `${insetObjectMenuCss2}[${OBJECT_MENU_SEAT_ATTRIBUTE}=inset]` : `${insetObjectMenuCss2.slice(0, search)}[${OBJECT_MENU_SEAT_ATTRIBUTE}=inset]${insetObjectMenuCss2.slice(search)}`}{${options}}`;
};
var OBJECT_MENU_TAPPED_CLASS: string = `ldoc-tapped`;
var OBJECT_MENU_SURFACE_CSS: string = `border:0;background:var(--cds-surface-3,#ffffff);border-radius:calc(var(--cds-radius,8px) + 4px);box-shadow:inset 0 0 0 var(--cds-ring-inner,0px) var(--cds-ring-color,rgba(11,11,11,.1)),0 0 0 var(--cds-ring-outer,1px) var(--cds-ring-color,rgba(11,11,11,.1)),var(--cds-shadow-popover,0 8px 24px rgba(0,0,0,.12),0 2px 6px rgba(0,0,0,.08))`;
var OBJECT_MENU_TEXT_CSS: string = `font-family:var(--cds-font-sans,var(--font-body,ui-sans-serif)),system-ui;font-size:var(--cds-font-size-body,14px);line-height:var(--cds-leading-body,20px);font-weight:400;color:var(--cds-text-primary,#0b0b0b)`;
var OBJECT_MENU_HOVER_CSS: string = `var(--cds-fill-ghost-hover,rgba(11,11,11,.05))`;
var OBJECT_MENU_FOCUS_CSS: string = `outline:2px solid transparent;outline-offset:1px;box-shadow:var(--cds-focus-shadow,0 0 0 2px var(--cds-fill-accent,#2a78d6))`;
var OBJECT_MENU_CSS: string =
  ((oBJECTMENUCSS?: Dynamic, ..._extraArguments: unknown[]) =>
    `${oBJECTMENUCSS}{position:fixed;z-index:55;box-sizing:border-box;display:flex;flex-direction:column;min-width:160px;max-width:min(320px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow-x:hidden;overflow-y:auto;padding:4px;${OBJECT_MENU_SURFACE_CSS};${OBJECT_MENU_TEXT_CSS};-webkit-user-select:none;user-select:none;animation:none;transform:none}${oBJECTMENUCSS}[hidden]{display:none}${oBJECTMENUCSS}:focus{outline:0}`)(
    `.${OBJECT_MENU_CLASS}`,
  ) +
  ((oBJECTMENUCSS?: Dynamic, ..._extraArguments: unknown[]): string =>
    `${oBJECTMENUCSS} button{box-sizing:border-box;display:flex;align-items:center;gap:var(--cds-gap-xs,8px);width:100%;min-height:var(--cds-h-control,32px);margin:0;padding:0 10px;border:0;border-radius:var(--cds-radius,8px);background:transparent;color:inherit;font:inherit;text-align:left;white-space:nowrap;cursor:var(--cds-cursor-interactive,pointer)}${oBJECTMENUCSS} button:is(:hover,:focus-visible){background:${OBJECT_MENU_HOVER_CSS}}${oBJECTMENUCSS} button:focus{outline:0;box-shadow:none}` +
    resolveEditorHostValue(`${oBJECTMENUCSS} button:focus-visible`) +
    `${oBJECTMENUCSS} button[aria-disabled=true]{opacity:var(--cds-opacity-disabled,.4);cursor:default}${oBJECTMENUCSS} button[aria-disabled=true]:is(:hover,:focus-visible){background:transparent}@media (forced-colors:none){${oBJECTMENUCSS} button[aria-disabled=true]:focus-visible{outline:2px solid currentColor;outline-offset:-2px}}${oBJECTMENUCSS} [role=separator]{flex:none;height:1px;margin:4px 0;background:var(--cds-border,rgba(11,11,11,.1))}${oBJECTMENUCSS} .grp{display:block;padding:4px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:var(--cds-font-size-footnote,13px);line-height:var(--cds-leading-footnote,17px);font-weight:var(--cds-font-weight-medium,500);color:var(--cds-text-muted,#898781)}${oBJECTMENUCSS} button>.lb{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}${oBJECTMENUCSS} .gs{display:inline-block;flex:none;width:16px;height:1px}${oBJECTMENUCSS} button>svg{flex:none;display:block;color:var(--cds-text-secondary,#52514e)}${oBJECTMENUCSS} button>.ck{margin-left:auto;padding-left:12px;display:inline-flex;color:var(--cds-text-primary,#0b0b0b)}${oBJECTMENUCSS} button[aria-checked=false]>.ck{visibility:hidden}${oBJECTMENUCSS}.react{flex-direction:row;min-width:0;max-width:none;gap:4px}${oBJECTMENUCSS}.react button{width:24px;min-height:24px;height:24px;padding:0;justify-content:center;border-radius:var(--cds-radius,8px);font-size:16px;line-height:1}${oBJECTMENUCSS}.react button>.lb{overflow:visible;text-overflow:clip}` +
    resolveEditorExtensionsValue8(oBJECTMENUCSS) +
    `${oBJECTMENUCSS} button.danger[aria-disabled=true]:is(:hover,:focus-visible){background:transparent;color:var(--cds-text-danger,#8e2626)}@media (pointer:coarse){${oBJECTMENUCSS} button{min-height:40px}${oBJECTMENUCSS}.react button{width:40px;height:40px;font-size:20px}}`)(
    `.${OBJECT_MENU_CLASS}`,
  ) +
  ((oBJECTMENUCSS?: Dynamic, ..._extraArguments: unknown[]) =>
    `${oBJECTMENUCSS}{--more-size:28px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex:none;width:var(--more-size);height:var(--more-size);margin:0;padding:0;border:1px solid var(--cds-border,rgba(11,11,11,.1));border-radius:var(--cds-radius,8px);background:var(--cds-surface-3,#ffffff);color:var(--cds-text-secondary,#52514e);font:inherit;line-height:0;cursor:var(--cds-cursor-interactive,pointer);-webkit-user-select:none;user-select:none}${oBJECTMENUCSS}[hidden]{display:none}${oBJECTMENUCSS}>svg{display:block;width:14px;height:14px;pointer-events:none}${oBJECTMENUCSS}:is(:hover,[aria-expanded=true]){background-image:linear-gradient(${OBJECT_MENU_HOVER_CSS},${OBJECT_MENU_HOVER_CSS});color:var(--cds-text-primary,#0b0b0b)}${oBJECTMENUCSS}:focus{outline:0}${oBJECTMENUCSS}:focus-visible{${OBJECT_MENU_FOCUS_CSS}}@media (pointer:coarse){${oBJECTMENUCSS}{--more-size:40px}${oBJECTMENUCSS}>svg{width:16px;height:16px}}`)(
    `button.${OBJECT_MENU_MORE_CLASS}`,
  ) +
  ((
    oBJECTMENUCSS?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ): string =>
    `:where(${oBJECTMENUCSS}){position:relative}${oBJECTMENUCSS}>${options}{display:none;position:absolute;z-index:3;top:var(--objmenu-top,0px);right:calc(0px - 8px - var(--more-size))}${oBJECTMENUCSS}>${options}::before{content:"";position:absolute;top:-4px;bottom:-4px;right:-4px;left:calc(0px - 8px)}` +
    insetObjectMenuCss(
      `${oBJECTMENUCSS}>${options}`,
      `top:var(--objmenu-inset-top,6px);right:var(--objmenu-inset-right,6px)`,
    ) +
    insetObjectMenuCss(`${oBJECTMENUCSS}>${options}::before`, `left:-4px`) +
    `${oBJECTMENUCSS}[${OBJECT_MENU_ATTRIBUTE}]:is(:hover,:focus-within,.has-caret,.cw-has-caret,.ProseMirror-selectednode,.${OBJECT_MENU_TAPPED_CLASS})>${options}:not([hidden]),${oBJECTMENUCSS}[${OBJECT_MENU_ATTRIBUTE}]>${options}:is([aria-expanded=true],:focus-visible):not([hidden]){display:inline-flex}`)(
    `.${OBJECT_MENU_HOST_CLASS}`,
    `button.${OBJECT_MENU_MORE_CLASS}`,
  );
var objectMenuHost: Dynamic = null;
var OBJECT_MENU_VERB_SYMBOL: Dynamic = Symbol(`objectMenu.verb`);
/* Subsystem: object-menu */
function objectMenuCommentItems(
  objectMenuCommentItems2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let objectMenuHost2: Dynamic = objectMenuHost;
  let target: Dynamic =
    typeof objectMenuCommentItems2 == `function`
      ? objectMenuCommentItems2
      : (..._extraArguments: unknown[]): Dynamic => objectMenuCommentItems2;
  let target2: Dynamic = target();
  return !objectMenuHost2 ||
    !target2 ||
    !objectMenuHost2.mayComment(target2.view) ||
    !objectMenuHost2.canAnchor(target2)
    ? []
    : [
        {
          label: EditorExtensionsAskClaude.comment.label,
          onSelect: (..._extraArguments: unknown[]): undefined => {},
          [OBJECT_MENU_VERB_SYMBOL]: {
            verb: `comment`,
            target: target,
          },
        },
        {
          label: EditorExtensionsAskClaude.react.label,
          onSelect: (..._extraArguments: unknown[]): undefined => {},
          [OBJECT_MENU_VERB_SYMBOL]: {
            verb: `react`,
            target: target,
          },
        },
      ];
}
function objectMenuDeleteItems(
  objectMenuDeleteItems2?: Dynamic,
  onSelect?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return [
    {
      label: resolveEditorExtensionsDelete(objectMenuDeleteItems2),
      variant: `danger`,
      separatorBefore: true,
      onSelect: onSelect,
    },
  ];
}
function positionObjectMenu(
  positionObjectMenu2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument: Dynamic = `end`,
  argument2: Dynamic = 8,
  argument3: Dynamic = 0,
  ..._extraArguments: unknown[]
): Dynamic {
  let total: Dynamic = positionObjectMenu2.bottom + 4;
  let total2: Dynamic =
    total + options.height <= dependencies - argument2
      ? total
      : nativeMathMax(argument2, positionObjectMenu2.top - 4 - options.height);
  let difference: Dynamic =
    argument === `end`
      ? positionObjectMenu2.right - options.width
      : positionObjectMenu2.left;
  return {
    left: nativeMathRound(
      nativeMathMax(
        argument3 + argument2,
        nativeMathMin(difference, context - options.width - argument2),
      ),
    ),
    top: nativeMathRound(total2),
  };
}
var openObjectMenus: Dynamic = new (WeakMap as Dynamic)();
var closeObjectMenu: Dynamic = (
  closeObjectMenu2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  trustedWeakMapGet(openObjectMenus, closeObjectMenu2)?.close(false);
var objectMenuSequence: number = 0;
var REACTION_EMOJI_MENU_LABEL: string = `React with an emoji`;
var nodeEventTargetPrototype: Dynamic =
  typeof Node === "undefined"
    ? undefined
    : Object.getPrototypeOf(Node.prototype);
var nativeAddEventListener: Dynamic = nativePrototypeMethod(
  nodeEventTargetPrototype,
  `addEventListener`,
);
var nativeRemoveEventListener: Dynamic = nativePrototypeMethod(
  nodeEventTargetPrototype,
  `removeEventListener`,
);
function addTrustedEventListener(
  addTrustedEventListener2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies: Dynamic = false,
  ..._extraArguments: unknown[]
): undefined {
  if (nativeAddEventListener) {
    reflectApply(nativeAddEventListener, addTrustedEventListener2, [
      options,
      context,
      dependencies,
    ]);
  } else {
    addTrustedEventListener2.addEventListener(options, context, dependencies);
  }
}
function removeTrustedEventListener(
  removeTrustedEventListener2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies: Dynamic = false,
  ..._extraArguments: unknown[]
): undefined {
  if (nativeRemoveEventListener) {
    reflectApply(nativeRemoveEventListener, removeTrustedEventListener2, [
      options,
      context,
      dependencies,
    ]);
  } else {
    removeTrustedEventListener2.removeEventListener(
      options,
      context,
      dependencies,
    );
  }
}
var nativeWeakMapGet: Dynamic = WeakMap.prototype.get;
var nativeWeakMapSet: Dynamic = WeakMap.prototype.set;
var nativeWeakMapDelete: Dynamic = WeakMap.prototype.delete;
WeakMap.prototype.has;
WeakSet.prototype.has;
WeakSet.prototype.add;
WeakSet.prototype.delete;
var trustedWeakMapGet: Dynamic = (
  trustedWeakMapGet2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => reflectApply(nativeWeakMapGet, trustedWeakMapGet2, [options]);
var trustedWeakMapSet = (
  trustedWeakMapSet2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): undefined =>
  void reflectApply(nativeWeakMapSet, trustedWeakMapSet2, [options, context]);
var trustedWeakMapDelete = (
  trustedWeakMapDelete2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): undefined =>
  void reflectApply(nativeWeakMapDelete, trustedWeakMapDelete2, [options]);
var nativeMathMin: Dynamic = Math.min;
var nativeMathMax: Dynamic = Math.max;
var nativeMathRound: Dynamic = Math.round;
var numericValueOrNaN: Dynamic = (
  numericValueOrNaN2?: Dynamic,
  ..._extraArguments: unknown[]
): number =>
  typeof numericValueOrNaN2 == `number` ? numericValueOrNaN2 : NaN;
var trustedBoundingClientRect: Dynamic = (
  trustedBoundingClientRect2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  nativeEventAccessors.gbcr
    ? reflectApply(nativeEventAccessors.gbcr, trustedBoundingClientRect2, [])
    : trustedBoundingClientRect2.getBoundingClientRect();
var nativeEventTarget: Dynamic = (
  event?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  readNativeEventProperty(
    nativeEventAccessors.target,
    event,
    null,
    (..._extraArguments: unknown[]): Dynamic => event.target,
  );
var trustedClosest: Dynamic = (
  trustedClosest2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  if (nativeEventAccessors.closest)
    try {
      return (
        reflectApply(nativeEventAccessors.closest, trustedClosest2, [
          options,
        ]) ?? null
      );
    } catch {}
  return allowSyntheticRuntimeGestures()
    ? trustedClosest2.closest(options)
    : null;
};
var trustedContains: Dynamic = (
  trustedContains2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  if (!(options instanceof (Object as Dynamic))) return false;
  if (nativeEventAccessors.contains)
    try {
      return (
        reflectApply(nativeEventAccessors.contains, trustedContains2, [
          options,
        ]) === true
      );
    } catch {
      return false;
    }
  return trustedContains2.contains(options);
};
var keyboardEventPrototype: Dynamic =
  typeof KeyboardEvent === "undefined" ? undefined : KeyboardEvent.prototype;
var uiEventPrototype: Dynamic =
  typeof UIEvent === "undefined" ? undefined : UIEvent.prototype;
var nativeKeyboardKey: Dynamic = nativePrototypeMethod(
  keyboardEventPrototype,
  `key`,
);
nativePrototypeMethod(keyboardEventPrototype, `code`);
nativePrototypeMethod(keyboardEventPrototype, `shiftKey`);
nativePrototypeMethod(keyboardEventPrototype, `altKey`);
var nativeKeyboardRepeat: Dynamic = nativePrototypeMethod(
  keyboardEventPrototype,
  `repeat`,
);
nativePrototypeMethod(uiEventPrototype, `detail`);
function readNativeEventProperty(
  nativeEventProperty?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (nativeEventProperty)
    try {
      return reflectApply(nativeEventProperty, options, []);
    } catch {}
  return allowSyntheticRuntimeGestures() ? dependencies() : context;
}
var nativeEventKey: Dynamic = (
  event?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  readNativeEventProperty(
    nativeKeyboardKey,
    event,
    ``,
    (..._extraArguments: unknown[]): Dynamic => event.key,
  );
var nativeIsComposingAccessor: Dynamic = nativePrototypeMethod(
  keyboardEventPrototype,
  `isComposing`,
);
var nativeKeyCodeAccessor: Dynamic = nativePrototypeMethod(
  keyboardEventPrototype,
  `keyCode`,
);
var nativeStringToLowerCase: Dynamic = String.prototype.toLowerCase;
var nativeStringStartsWith: Dynamic = String.prototype.startsWith;
var trustedLowercase: Dynamic = (
  trustedLowercase2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => reflectApply(nativeStringToLowerCase, trustedLowercase2, []);
var trustedStartsWith = (
  trustedStarts?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) => reflectApply(nativeStringStartsWith, trustedStarts, [options]) === true;
var isTypingGesture: Dynamic = (
  typingGesture?: Dynamic,
  items?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  items.length === 1 &&
  items !== ` ` &&
  !isRepeatedGesture(typingGesture) &&
  readNativeEventProperty(
    nativeKeyboardEventAccessors.ctrl,
    typingGesture,
    true,
    (..._extraArguments: unknown[]): Dynamic => typingGesture.ctrlKey,
  ) !== true &&
  readNativeEventProperty(
    nativeKeyboardEventAccessors.alt,
    typingGesture,
    true,
    (..._extraArguments: unknown[]): Dynamic => typingGesture.altKey,
  ) !== true &&
  readNativeEventProperty(
    nativeKeyboardEventAccessors.meta,
    typingGesture,
    true,
    (..._extraArguments: unknown[]): Dynamic => typingGesture.metaKey,
  ) !== true &&
  readNativeEventProperty(
    nativeIsComposingAccessor,
    typingGesture,
    true,
    (..._extraArguments: unknown[]): Dynamic => typingGesture.isComposing,
  ) !== true &&
  numericValueOrNaN(
    readNativeEventProperty(
      nativeKeyCodeAccessor,
      typingGesture,
      229,
      (..._extraArguments: unknown[]): Dynamic => typingGesture.keyCode,
    ),
  ) !== 229;
var isRepeatedGesture = (
  repeatedGesture?: Dynamic,
  ..._extraArguments: unknown[]
) =>
  readNativeEventProperty(
    nativeKeyboardRepeat,
    repeatedGesture,
    true,
    (..._extraArguments: unknown[]): Dynamic => repeatedGesture.repeat,
  ) === true;
var gestureCoordinates: Dynamic = (
  gestureCoordinates2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => ({
  x: numericValueOrNaN(
    readNativeEventProperty(
      nativeEventAccessors.clientX,
      gestureCoordinates2,
      NaN,
      (..._extraArguments: unknown[]): Dynamic => gestureCoordinates2.clientX,
    ),
  ),
  y: numericValueOrNaN(
    readNativeEventProperty(
      nativeEventAccessors.clientY,
      gestureCoordinates2,
      NaN,
      (..._extraArguments: unknown[]): Dynamic => gestureCoordinates2.clientY,
    ),
  ),
});
var objectMenuTestHarness: Dynamic = {
  on: false,
};
var isStandaloneRuntimeBundle: boolean =
  typeof __LFILE_RUNTIME_BUNDLE__ === "undefined";
var allowSyntheticRuntimeGestures: Dynamic = (
  ..._extraArguments: unknown[]
): Dynamic => isStandaloneRuntimeBundle && objectMenuTestHarness.on;
var allowSyntheticRuntimeRect: Dynamic = (
  ..._extraArguments: unknown[]
): Dynamic =>
  allowSyntheticRuntimeGestures() && objectMenuTestHarness.rect !== false;
var isTrustedGesture: Dynamic = (
  trustedGesture?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  readNativeEventProperty(
    nativeEventAccessors.isTrusted,
    trustedGesture,
    false,
    (..._extraArguments: unknown[]): Dynamic => trustedGesture.isTrusted,
  ) === true || allowSyntheticRuntimeGestures();
var nativeKeyboardEventAccessors: Dynamic = {
  code: nativePrototypeMethod(keyboardEventPrototype, `code`),
  shift: nativePrototypeMethod(keyboardEventPrototype, `shiftKey`),
  alt: nativePrototypeMethod(keyboardEventPrototype, `altKey`),
  ctrl: nativePrototypeMethod(keyboardEventPrototype, `ctrlKey`),
  meta: nativePrototypeMethod(keyboardEventPrototype, `metaKey`),
};
var objectMenuGeneration: number = 0;
if (typeof window !== "undefined") {
  let isTrustedGesture2 = (
    callback?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (isTrustedGesture(callback)) {
      objectMenuGeneration++;
    }
  };
  for (let localResult of [
    `pointerdown`,
    `pointermove`,
    `pointerrawupdate`,
    `pointerover`,
    `mousemove`,
    `mousedown`,
    `touchstart`,
    `wheel`,
  ] as Dynamic)
    addTrustedEventListener(window, localResult, isTrustedGesture2, true);
}
var keyboardGesture: Dynamic = (
  error?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => ({
  key: nativeEventKey(error),
  code: readNativeEventProperty(
    nativeKeyboardEventAccessors.code,
    error,
    ``,
    (..._extraArguments: unknown[]): Dynamic => error.code,
  ),
  shiftKey:
    readNativeEventProperty(
      nativeKeyboardEventAccessors.shift,
      error,
      false,
      (..._extraArguments: unknown[]): Dynamic => error.shiftKey,
    ) === true,
  altKey:
    readNativeEventProperty(
      nativeKeyboardEventAccessors.alt,
      error,
      false,
      (..._extraArguments: unknown[]): Dynamic => error.altKey,
    ) === true,
  ctrlKey:
    readNativeEventProperty(
      nativeKeyboardEventAccessors.ctrl,
      error,
      false,
      (..._extraArguments: unknown[]): Dynamic => error.ctrlKey,
    ) === true,
  metaKey:
    readNativeEventProperty(
      nativeKeyboardEventAccessors.meta,
      error,
      false,
      (..._extraArguments: unknown[]): Dynamic => error.metaKey,
    ) === true,
});
function openObjectMenu(
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let { view: options2, label: options3 }: Dynamic = options;
  if (options.gesture && !isTrustedGesture(options.gesture)) return null;
  closeObjectMenu(options2);
  let items: Dynamic = [];
  for (let index: number = 0; index < options.items.length; index++) {
    let itemItem: Dynamic = options.items[index];
    if (itemItem && typeof itemItem.label == `string`) {
      items[items.length] = itemItem;
    }
  }
  if (items.length === 0 && !options.quickReact) return null;
  let document2: Dynamic = options2.dom.ownerDocument;
  let window2: Dynamic = document2.defaultView;
  resolveEditorAnchorsAndMentionsStyle(
    document2,
    OBJECT_MENU_STYLE_ID,
    OBJECT_MENU_CSS,
  );
  let anchorElement: Dynamic =
    `nodeType` in options.anchor ? options.anchor : null;
  let anchorPoint: Dynamic = anchorElement
    ? null
    : {
        x: options.anchor.x,
        y: options.anchor.y,
      };
  let anchorTop: Dynamic = options.anchor.top;
  let anchorOffset: number =
    anchorPoint && typeof anchorTop == `number` && anchorTop < anchorPoint.y
      ? anchorPoint.y - anchorTop
      : 0;
  let anchorOwner: Dynamic =
    !anchorElement && (options.enter === `first` || options.enter === `last`)
      ? (options.anchor.of ?? null)
      : null;
  let anchorBounds: Dynamic = anchorOwner
    ? trustedBoundingClientRect(anchorOwner)
    : null;
  let position: Dynamic = anchorPoint
    ? {
        x: anchorPoint.x,
        y: anchorPoint.y,
      }
    : null;
  let typeaheadDelay: Dynamic = objectMenuGeneration;
  let typeaheadTimer: number = 0;
  let menuId: string = `ldoc-objmenu-${++objectMenuSequence}`;
  let menuElement: Dynamic = document2.createElement(`div`);
  menuElement.className = OBJECT_MENU_CLASS;
  menuElement.id = menuId;
  menuElement.setAttribute(`role`, `menu`);
  menuElement.setAttribute(`aria-label`, options3);
  menuElement.setAttribute(`data-testid`, `ldoc-objmenu`);
  menuElement.tabIndex = -1;
  menuElement.setAttribute(`contenteditable`, `false`);
  let closed: boolean = false;
  let menuBounds: Dynamic = {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  };
  let rowElements: Dynamic = [];
  let activeIndex: number = -1;
  let containsPointer: Dynamic = (
    openObjectMenu2?: Dynamic,
    ..._extraArguments: unknown[]
  ): boolean => {
    if (allowSyntheticRuntimeRect()) return true;
    let { x: gestureCoordinates2, y: gestureCoordinates3 }: Dynamic =
      gestureCoordinates(openObjectMenu2);
    return (
      gestureCoordinates2 >= menuBounds.left &&
      gestureCoordinates2 <= menuBounds.left + menuBounds.width &&
      gestureCoordinates3 >= menuBounds.top &&
      gestureCoordinates3 <= menuBounds.top + menuBounds.height
    );
  };
  let positionMenu = (..._extraArguments: unknown[]): undefined => {
    let trustedBoundingClientRect2: Dynamic =
      trustedBoundingClientRect(menuElement);
    let total: number = reactionMode ? rowElements.length * 44 + 16 : 320;
    let total2: number = rowElements.length * 49 + 16;
    let difference: number =
      (document2.documentElement.clientWidth || window2.innerWidth) -
      documentIconGutter(document2);
    let trustedBoundingClientRect3: Dynamic = anchorElement
      ? trustedBoundingClientRect(anchorElement)
      : {
          left: anchorPoint.x,
          right: anchorPoint.x,
          top: anchorPoint.y - anchorOffset,
          bottom: anchorPoint.y,
        };
    let label: string = anchorElement ? `end` : `start`;
    let positionObjectMenu2: Dynamic = positionObjectMenu(
      trustedBoundingClientRect3,
      trustedBoundingClientRect2,
      difference,
      window2.innerHeight,
      label,
      8,
      resolveEditorHostGetPropertyValue(document2),
    );
    menuElement.style.left = `${positionObjectMenu2.left}px`;
    menuElement.style.top = `${positionObjectMenu2.top}px`;
    menuBounds = {
      left: positionObjectMenu2.left,
      top: positionObjectMenu2.top,
      width: nativeMathMin(
        numericValueOrNaN(trustedBoundingClientRect2.width),
        total,
      ),
      height: nativeMathMin(
        numericValueOrNaN(trustedBoundingClientRect2.height),
        total2,
      ),
    };
  };
  let announceOpen = (
    open?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    let CustomEvent2: Dynamic = window2.CustomEvent ?? CustomEvent;
    document2.dispatchEvent(
      new (CustomEvent2 as Dynamic)(EditorAnchorsAndMentionsLfileTypeahead, {
        detail: {
          id: menuId,
          open: open,
        },
      }),
    );
  };
  let selectRow = (
    openObjectMenu2?: Dynamic,
    options4: Dynamic = false,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (closed) return;
    let itemItem: Dynamic = items[openObjectMenu2];
    if (!itemItem || itemItem.disabledReason !== undefined) return;
    let itemItemItem: Dynamic = itemItem[OBJECT_MENU_VERB_SYMBOL];
    if (itemItemItem?.verb === `react`) {
      let enabled: boolean = false;
      showReactions(
        (
          openObjectMenu3?: Dynamic,
          ..._extraArguments: unknown[]
        ): undefined => {
          if (enabled) return;
          enabled = true;
          let target: Dynamic = itemItemItem.target();
          if (target && objectMenuHost) {
            objectMenuHost.react(target, openObjectMenu3);
          }
        },
      );
      return;
    }
    closeMenu(false);
    if (itemItemItem?.verb === `comment`) {
      let target: Dynamic = itemItemItem.target();
      if (target && objectMenuHost) {
        objectMenuHost.comment(target);
      }
    } else itemItem.onSelect(options4);
    if (
      options2.dom.isConnected &&
      !options2.hasFocus() &&
      document2.activeElement === document2.body
    ) {
      options2.focus();
    }
  };
  let focusRow = (
    openObjectMenu2?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (rowElements.length === 0) return;
    let activeIndex2: Dynamic = activeIndex;
    activeIndex = (openObjectMenu2 + rowElements.length) % rowElements.length;
    let rowElementItem: Dynamic = rowElements[activeIndex];
    if (typeof options.maxHeightPx == `number`) {
      if (activeIndex2 >= 0 && rowElements[activeIndex2]) {
        rowElements[activeIndex2].tabIndex = -1;
      }
      rowElementItem.tabIndex = 0;
    }
    rowElementItem.focus({
      preventScroll: true,
    });
    if (menuElement.scrollHeight <= menuElement.clientHeight) return;
    let offsetTop: Dynamic = rowElementItem.offsetTop;
    let total: Dynamic = offsetTop + rowElementItem.offsetHeight;
    if (activeIndex === 0) {
      menuElement.scrollTop = 0;
    } else {
      if (activeIndex === rowElements.length - 1) {
        menuElement.scrollTop =
          menuElement.scrollHeight - menuElement.clientHeight;
      } else {
        if (offsetTop < menuElement.scrollTop) {
          menuElement.scrollTop = offsetTop;
        } else {
          if (total > menuElement.scrollTop + menuElement.clientHeight) {
            menuElement.scrollTop = total - menuElement.clientHeight;
          }
        }
      }
    }
  };
  let renderRows = (
    items2?: Dynamic,
    options4?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    menuElement.replaceChildren();
    rowElements = [];
    activeIndex = -1;
    let enabled: boolean = false;
    let enabled2: boolean = false;
    for (let index: number = 0; index < items2.length; index++) {
      if (items2[index].icon !== undefined) {
        enabled = true;
      }
      if (items2[index].checked !== undefined) {
        enabled2 = true;
      }
    }
    for (let index: number = 0; index < items2.length; index++) {
      let itemItem: Dynamic = items2[index];
      if (itemItem.separatorBefore && index > 0) {
        let element3: Dynamic = document2.createElement(`div`);
        element3.setAttribute(`role`, `separator`);
        menuElement.append(element3);
      }
      let element: Dynamic = document2.createElement(`button`);
      element.type = `button`;
      element.tabIndex = -1;
      element.setAttribute(
        `role`,
        itemItem.checked === undefined ? `menuitem` : `menuitemradio`,
      );
      if (itemItem.checked !== undefined) {
        element.setAttribute(
          `aria-checked`,
          itemItem.checked ? `true` : `false`,
        );
      }
      if (itemItem.icon)
        element.append(
          resolveEditorAnchorsAndMentionsGrid2(document2, itemItem.icon, 16),
        );
      else if (enabled) {
        let element3: Dynamic = document2.createElement(`span`);
        element3.className = `gs`;
        element3.setAttribute(`aria-hidden`, `true`);
        element.append(element3);
      }
      let element2: Dynamic = document2.createElement(`span`);
      element2.className = `lb`;
      element2.textContent = itemItem.label;
      element.append(element2);
      if (itemItem.ariaLabel !== undefined) {
        element.setAttribute(`aria-label`, itemItem.ariaLabel);
      }
      if (enabled2) {
        let element3: Dynamic = document2.createElement(`span`);
        element3.className = `ck`;
        element3.setAttribute(`aria-hidden`, `true`);
        if (itemItem.checked !== undefined) {
          element3.append(
            resolveEditorAnchorsAndMentionsGrid2(
              document2,
              EditorSelectionAndTablesMaster167,
              16,
            ),
          );
        }
        element.append(element3);
      }
      if (itemItem.variant === `danger`) {
        element.classList.add(`danger`);
      }
      if (itemItem.disabledReason !== undefined) {
        element.setAttribute(`aria-disabled`, `true`);
        element.dataset.tip = itemItem.disabledReason;
      }
      addTrustedEventListener(
        element,
        `mousedown`,
        (event?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          event.preventDefault(),
      );
      addTrustedEventListener(
        element,
        `click`,
        (
          openObjectMenu2?: Dynamic,
          ..._extraArguments: unknown[]
        ): undefined => {
          if (
            !(
              !isTrustedGesture(openObjectMenu2) ||
              !containsPointer(openObjectMenu2)
            )
          ) {
            options4(
              index,
              resolveDataOperationControlDetail(openObjectMenu2) === true,
            );
          }
        },
      );
      rowElements[rowElements.length] = element;
      menuElement.append(element);
    }
  };
  let showReactions = (
    openObjectMenu2?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    let items2: Dynamic = [];
    for (let index: number = 0; index < QUICK_EMOJI.length; index++)
      items2[index] = {
        label: QUICK_EMOJI[index],
        ariaLabel: resolveEditorExtensionsValue6(QUICK_EMOJI[index]),
        onSelect: (..._extraArguments: unknown[]): undefined => {},
      };
    menuElement.classList.add(`react`);
    menuElement.setAttribute(`aria-label`, REACTION_EMOJI_MENU_LABEL);
    let focus = (
      openObjectMenu3?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      if (closed) return;
      let Item: string = QUICK_EMOJI[openObjectMenu3];
      if (typeof Item == `string`) {
        closeMenu(false);
        openObjectMenu2(Item);
        if (options2.dom.isConnected) {
          options2.focus();
        }
      }
    };
    renderRows(items2, focus);
    selectItem = focus;
    reactionMode = true;
    enteredReactionMode = true;
    menuElement.setAttribute(`aria-orientation`, `horizontal`);
    positionMenu();
    activeIndex = -1;
    menuElement.focus({
      preventScroll: true,
    });
  };
  let selectItem: Dynamic = selectRow;
  let reactionMode: boolean = false;
  let enteredReactionMode: boolean = false;
  renderRows(items, selectRow);
  let onOutsideMouseDown = (
    openObjectMenu2?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (!isTrustedGesture(openObjectMenu2)) return;
    let nativeEventTarget2: Dynamic = nativeEventTarget(openObjectMenu2);
    if (
      !trustedContains(menuElement, nativeEventTarget2) &&
      !(
        anchorElement &&
        (nativeEventTarget2 === anchorElement ||
          trustedContains(anchorElement, nativeEventTarget2))
      )
    ) {
      closeMenu(false);
    }
  };
  let onKeyDown = (
    event?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (!isTrustedGesture(event)) return;
    if (resolveEditorAnchorsAndMentionsEscape(event)) {
      resolveEditorAnchorsAndMentionsValue3(event);
      event.preventDefault();
      event.stopPropagation();
      if (enteredReactionMode || options.escapeTo === `text`) {
        closeMenu(false);
        if (options2.dom.isConnected) {
          options2.focus();
        }
      } else {
        closeMenu(true);
      }
      return;
    }
    let nativeEventTarget2: Dynamic = nativeEventTarget(event);
    if (
      nativeEventTarget2 !== menuElement &&
      !trustedContains(menuElement, nativeEventTarget2)
    )
      return;
    let nativeEventKey2: Dynamic = nativeEventKey(event);
    let matchesNativeEventKey: Dynamic =
      nativeEventKey2 === `ArrowDown` ||
      (reactionMode && nativeEventKey2 === `ArrowRight`);
    let matchesNativeEventKey2: Dynamic =
      nativeEventKey2 === `ArrowUp` ||
      (reactionMode && nativeEventKey2 === `ArrowLeft`);
    if (
      matchesNativeEventKey ||
      matchesNativeEventKey2 ||
      nativeEventKey2 === `Home` ||
      nativeEventKey2 === `End`
    ) {
      event.preventDefault();
      event.stopPropagation();
      typeaheadText = ``;
      let difference: number = rowElements.length - 1;
      focusRow(
        activeIndex < 0
          ? matchesNativeEventKey || nativeEventKey2 === `Home`
            ? 0
            : difference
          : matchesNativeEventKey
            ? activeIndex + 1
            : matchesNativeEventKey2
              ? activeIndex - 1
              : nativeEventKey2 === `Home`
                ? 0
                : difference,
      );
    } else if (nativeEventKey2 === `Enter` || nativeEventKey2 === ` `) {
      event.preventDefault();
      event.stopPropagation();
      if (activeIndex >= 0 && !isRepeatedGesture(event)) {
        selectItem(activeIndex, true);
      }
    } else {
      if (nativeEventKey2 === `Tab`) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(false);
        if (options2.dom.isConnected) {
          options2.focus();
        }
      } else {
        if (
          options.typeAhead === true &&
          !enteredReactionMode &&
          isTypingGesture(event, nativeEventKey2)
        ) {
          event.preventDefault();
          event.stopPropagation();
          typeahead(trustedLowercase(nativeEventKey2));
        }
      }
    }
  };
  let typeaheadText: string = ``;
  let findTypeaheadRow: Dynamic = (
    openObjectMenu2?: Dynamic,
    options4?: Dynamic,
    ..._extraArguments: unknown[]
  ): number => {
    for (let index: number = 0; index < rowElements.length; index++) {
      let amount: number = (options4 + index) % rowElements.length;
      if (
        trustedStartsWith(
          trustedLowercase(items[amount]?.label ?? ``),
          openObjectMenu2,
        )
      )
        return amount;
    }
    return -1;
  };
  let typeahead = (
    openObjectMenu2?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    let count: Dynamic = activeIndex < 0 ? 0 : activeIndex;
    let total: Dynamic = typeaheadText + openObjectMenu2;
    let findTypeaheadRow2: Dynamic =
      total.length > 1 ? findTypeaheadRow(total, count) : -1;
    if (findTypeaheadRow2 < 0) {
      total = openObjectMenu2;
      findTypeaheadRow2 = findTypeaheadRow(
        total,
        activeIndex < 0 ? 0 : activeIndex + 1,
      );
    }
    typeaheadText = findTypeaheadRow2 < 0 ? `` : total;
    if (findTypeaheadRow2 >= 0) {
      focusRow(findTypeaheadRow2);
    }
  };
  function closeMenu(
    openObjectMenu2?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined {
    if (!closed) {
      closed = true;
      menuElement.remove();
      if (openObjectMenu2 && anchorElement?.isConnected) {
        anchorElement.focus({
          preventScroll: true,
        });
      }
      anchorElement?.setAttribute(`aria-expanded`, `false`);
      removeTrustedEventListener(
        document2,
        `mousedown`,
        onOutsideMouseDown,
        true,
      );
      removeTrustedEventListener(document2, `keydown`, onKeyDown, true);
      removeTrustedEventListener(window2, `scroll`, onViewportChange, true);
      removeTrustedEventListener(window2, `resize`, onViewportChange);
      removeTrustedEventListener(window2, `blur`, onViewportChange);
      if (trustedWeakMapGet(openObjectMenus, options2)?.close === closeMenu) {
        trustedWeakMapDelete(openObjectMenus, options2);
      }
      announceOpen(false);
      options.onClose?.();
      if (
        openObjectMenu2 &&
        document2.activeElement !== anchorElement &&
        options2.dom.isConnected
      ) {
        options2.focus();
      }
    }
  }
  let onViewportChange = (
    event?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (
      event &&
      event.type === `scroll` &&
      event.target instanceof (window2.Node as Dynamic) &&
      menuElement.contains(event.target)
    )
      return;
    if (
      event &&
      anchorPoint &&
      anchorOwner &&
      anchorBounds &&
      (event.type === `scroll` || event.type === `resize`)
    ) {
      if (
        typeaheadTimer < 3 &&
        objectMenuGeneration === typeaheadDelay &&
        isTrustedGesture(event) &&
        trustedContains(document2, anchorOwner)
      ) {
        let trustedBoundingClientRect2: Dynamic =
          trustedBoundingClientRect(anchorOwner);
        let difference: number =
          anchorPoint.x +
          numericValueOrNaN(trustedBoundingClientRect2.left) -
          numericValueOrNaN(anchorBounds.left);
        let difference2: number =
          anchorPoint.y +
          numericValueOrNaN(trustedBoundingClientRect2.top) -
          numericValueOrNaN(anchorBounds.top);
        let clientWidth: Dynamic =
          document2.documentElement.clientWidth || window2.innerWidth;
        let allowSyntheticRuntimeRect2: Dynamic =
          allowSyntheticRuntimeRect() ||
          ((numericValueOrNaN(trustedBoundingClientRect2.width) > 0 ||
            numericValueOrNaN(trustedBoundingClientRect2.height) > 0) &&
            difference2 > 0 &&
            difference2 < window2.innerHeight &&
            difference > 0 &&
            difference < clientWidth);
        let matchesNativeMathMax: boolean =
          nativeMathMax(difference - position.x, position.x - difference) <=
            120 &&
          nativeMathMax(difference2 - position.y, position.y - difference2) <=
            120;
        if (allowSyntheticRuntimeRect2 && matchesNativeMathMax) {
          typeaheadTimer++;
          anchorPoint.x = difference;
          anchorPoint.y = difference2;
          anchorBounds = trustedBoundingClientRect2;
          positionMenu();
          return;
        }
      }
      let matchesActiveElement: Dynamic =
        document2.activeElement === menuElement ||
        trustedContains(menuElement, document2.activeElement);
      closeMenu(false);
      if (matchesActiveElement && options2.dom.isConnected) {
        options2.focus();
      }
      return;
    }
    let matchesEscapeTo: Dynamic =
      options.escapeTo === `text` &&
      event?.type !== `blur` &&
      (document2.activeElement === menuElement ||
        trustedContains(menuElement, document2.activeElement));
    closeMenu(false);
    if (matchesEscapeTo && options2.dom.isConnected) {
      options2.focus();
    }
  };
  addTrustedEventListener(
    menuElement,
    `mousedown`,
    (event?: Dynamic, ..._extraArguments: unknown[]): undefined => {
      if (event.button === 2) {
        event.preventDefault();
        closeMenu(false);
      }
    },
  );
  addTrustedEventListener(
    menuElement,
    `contextmenu`,
    (event?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      event.preventDefault(),
  );
  if (typeof options.maxHeightPx == `number`) {
    menuElement.style.maxHeight = `min(${options.maxHeightPx}px,calc(100vh - 16px))`;
    menuElement.style.overscrollBehavior = `contain`;
  }
  document2.body.append(menuElement);
  positionMenu();
  anchorElement?.setAttribute(`aria-expanded`, `true`);
  let menu: Dynamic = {
    close: closeMenu,
    el: menuElement,
    anchor: anchorElement,
  };
  trustedWeakMapSet(openObjectMenus, options2, menu);
  addTrustedEventListener(document2, `mousedown`, onOutsideMouseDown, true);
  addTrustedEventListener(document2, `keydown`, onKeyDown, true);
  addTrustedEventListener(window2, `scroll`, onViewportChange, true);
  addTrustedEventListener(window2, `resize`, onViewportChange);
  addTrustedEventListener(window2, `blur`, onViewportChange);
  announceOpen(true);
  if (options.quickReact) {
    showReactions(options.quickReact);
  } else {
    if (options.enter === `first`) {
      focusRow(0);
    } else {
      if (options.enter === `last`) {
        focusRow(rowElements.length - 1);
      } else {
        if (options.enter && typeof options.enter == `object`) {
          focusRow(
            nativeMathMax(
              0,
              nativeMathMin(
                numericValueOrNaN(options.enter.row) | 0,
                rowElements.length - 1,
              ),
            ),
          );
        } else {
          if (options.enter !== `text`) {
            menuElement.focus({
              preventScroll: true,
            });
          }
        }
      }
    }
  }
  return menu;
}
resolvePlatformKeyboardAndSaveStatusFind(`formatToolbar`).also?.find(
  (callback?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
    callback.startsWith(`Mod-`),
) ?? resolvePlatformKeyboardAndSaveStatusFind(`formatToolbar`).key;
`${OBJECT_MENU_HOST_CLASS}${OBJECT_MENU_ATTRIBUTE}`;
`${OBJECT_MENU_MORE_CLASS}`;
nativePrototypeMethod(
  typeof Element === "undefined" ? undefined : (Element as Dynamic).prototype,
  `querySelector`,
);
nativePrototypeMethod(
  typeof HTMLElement === "undefined" ? undefined : HTMLElement.prototype,
  `focus`,
);
nativePrototypeMethod(
  typeof Document === "undefined" ? undefined : Document.prototype,
  `activeElement`,
);
nativePrototypeMethod(
  typeof Node === "undefined" ? undefined : Node.prototype,
  `ownerDocument`,
);
`${EditorHostMermaid.map((item?: Dynamic, ..._extraArguments: unknown[]) => `:not(${item})`).join(``)}`;
/* Subsystem: callout-plugin */
function documentIconGutter(
  documentIconGutter2?: Dynamic,
  ..._extraArguments: unknown[]
): number {
  let documentIconGutterResult: number =
    resolveEditorHostDocumentElement2(documentIconGutter2);
  if (documentIconGutterResult > 0) return documentIconGutterResult;
  let documentElement: Dynamic = documentIconGutter2.documentElement;
  if (!documentElement.classList.contains(`lfile-icons`)) return 0;
  let number: number = parseFloat(
    documentIconGutter2.defaultView
      ?.getComputedStyle(documentElement)
      .getPropertyValue(`--gutter`) ?? ``,
  );
  return Number.isFinite(number) && number > 0
    ? number + resolveEditorHostDocumentElement(documentIconGutter2)
    : 0;
}
var CALLOUT_KINDS: Dynamic = [
  {
    kind: `info`,
    emoji: `ℹ️`,
    label: `Info`,
    icon: EditorChipsAndNodeViewsCode.info,
  },
  {
    kind: `success`,
    emoji: `✅`,
    label: `Success`,
    icon: EditorChipsAndNodeViewsCode.checkCircle,
  },
  {
    kind: `warning`,
    emoji: `⚠️`,
    label: `Warning`,
    icon: EditorChipsAndNodeViewsCode.warning,
  },
];
var calloutKindDescriptor: Dynamic = (
  calloutKindDescriptor2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  CALLOUT_KINDS.find(
    (entry?: Dynamic, ..._extraArguments: unknown[]) =>
      entry.kind === calloutKindDescriptor2,
  );
var CALLOUT_MARKER_PATTERN: Dynamic =
  /^(\u2139\uFE0F|\u2705\uFE0F?|\u26A0\uFE0F)( ?)/u;
var CALLOUT_MARKER_KINDS: Dynamic = {
  ℹ: `info`,
  "✅": `success`,
  "⚠": `warning`,
};
function proseMirrorCalloutKind(
  proseMirrorCalloutKind2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (proseMirrorCalloutKind2.type.name !== `blockquote`) return null;
  let firstChild: Dynamic = proseMirrorCalloutKind2.firstChild;
  if (
    !firstChild ||
    firstChild.type.name !== `paragraph` ||
    !firstChild.firstChild?.isText
  )
    return null;
  let textBetween: Dynamic = firstChild.textBetween(
    0,
    Math.min(firstChild.content.size, 8),
    `￼`,
    `￼`,
  );
  let match: Dynamic = CALLOUT_MARKER_PATTERN.exec(textBetween);
  if (!match) return null;
  let emoji: Dynamic = match[1];
  return {
    kind: CALLOUT_MARKER_KINDS[emoji.replace(/\uFE0F/g, ``)],
    emoji: emoji,
    leadLen: match[0].length,
  };
}
var CALLOUT_STYLE_ID: string = `lfile-callout-css`;
var CALLOUT_SELECTOR: string = `[data-lfile-doc] .ProseMirror blockquote.ldoc-callout[data-callout]`;
var CALLOUT_CSS: string =
  `${CALLOUT_SELECTOR}{position:relative;box-sizing:border-box;margin-top:.9em;margin-bottom:.9em;padding:10px 40px 10px 14px;border:0;border-radius:var(--cds-radius--lg,10px);background:var(--cds-bg-accent,#cde2fb);color:var(--cds-text-primary,#0b0b0b)}${CALLOUT_SELECTOR}[data-callout=success]{background:var(--cds-bg-success,#caeac7)}${CALLOUT_SELECTOR}[data-callout=warning]{background:var(--cds-bg-warning,#f9dca4)}${CALLOUT_SELECTOR}>*{margin-left:28px}${CALLOUT_SELECTOR}>p{margin-top:0;margin-bottom:0}${CALLOUT_SELECTOR}>p+p,${CALLOUT_SELECTOR}>p+.lfile-gap+p{margin-top:.4em}${CALLOUT_SELECTOR}>:first-child,${CALLOUT_SELECTOR}>.lfile-gap:first-child+*{text-indent:-28px}${CALLOUT_SELECTOR}>:is(p,h1,h2,h3,h4,h5,h6):first-child>*,${CALLOUT_SELECTOR}>.lfile-gap:first-child+:is(p,h1,h2,h3,h4,h5,h6)>*{text-indent:0}${CALLOUT_SELECTOR} .ldoc-callout-lead{display:inline-block;width:28px;text-indent:0;vertical-align:top;white-space:pre;color:transparent;caret-color:var(--cds-text-primary,#0b0b0b)}${CALLOUT_SELECTOR} .ldoc-callout-gap{display:inline-block;width:0;text-indent:0;vertical-align:top;white-space:pre;color:transparent;caret-color:var(--cds-text-primary,#0b0b0b)}${CALLOUT_SELECTOR}>.ldoc-callout-kind{position:absolute;left:10px;top:10px;width:26px;height:26px;margin:0;padding:0;text-indent:0;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:var(--cds-radius,6px);background:transparent;color:var(--cds-text-accent,#2c6bd6);font:inherit;-webkit-user-select:none;user-select:none}${CALLOUT_SELECTOR}[data-callout=success]>.ldoc-callout-kind{color:var(--cds-text-success,#3c7a36)}${CALLOUT_SELECTOR}[data-callout=warning]>.ldoc-callout-kind{color:var(--cds-text-warning,#a15c00)}${CALLOUT_SELECTOR}>button.ldoc-callout-kind{cursor:pointer}${CALLOUT_SELECTOR}>button.ldoc-callout-kind:hover,${CALLOUT_SELECTOR}>button.ldoc-callout-kind[aria-expanded=true]{background:var(--cds-fill-ghost-hover,rgba(0,0,0,.075))}${CALLOUT_SELECTOR}>button.ldoc-callout-kind:focus-visible,${CALLOUT_SELECTOR}>.ldoc-callout-x:focus-visible{outline:2px solid var(--cds-fill-accent,#2c84db);outline-offset:1px}${CALLOUT_SELECTOR}>.ldoc-callout-x{position:absolute;top:10px;right:8px;width:26px;height:26px;margin:0;padding:0;text-indent:0;display:none;align-items:center;justify-content:center;border:0;border-radius:var(--cds-radius,6px);background:transparent;color:var(--cds-text-secondary,#5e5d59);cursor:pointer}${CALLOUT_SELECTOR}>.ldoc-callout-x:hover{background:var(--cds-fill-ghost-hover,rgba(0,0,0,.075));color:var(--cds-text-primary,#0b0b0b)}.ProseMirror[contenteditable=true] blockquote.ldoc-callout[data-callout]:hover>.ldoc-callout-x,.ProseMirror[contenteditable=true] blockquote.ldoc-callout[data-callout].has-caret>.ldoc-callout-x,${CALLOUT_SELECTOR}>.ldoc-callout-x:focus-visible{display:inline-flex}.ldoc-callout-menu{position:fixed;z-index:2147483646;min-width:160px;padding:4px;background:var(--cds-surface-3,#fff);border-radius:10px;box-shadow:0 0 0 1px var(--cds-border,rgba(0,0,0,.1)),var(--cds-shadow-popover,0 8px 24px rgba(0,0,0,.12));font-family:var(--cds-font-sans,ui-sans-serif),system-ui;font-size:var(--cds-font-size-body,14px);line-height:var(--cds-leading-body,20px);color:var(--cds-text-primary,#0b0b0b)}.ldoc-callout-menu .row{display:flex;align-items:center;gap:8px;height:var(--cds-h-control,28px);padding:0 10px;border-radius:var(--cds-radius,6px);cursor:pointer;outline:0}@media (pointer:coarse){.ldoc-callout-menu .row{height:40px}}.ldoc-callout-menu .row:hover,.ldoc-callout-menu .row:focus,.ldoc-callout-menu .row.is-sel{background:var(--cds-fill-ghost-hover,rgba(0,0,0,.075))}` +
  resolveEditorHostValue(`.ldoc-callout-menu .row:focus`) +
  `.ldoc-callout-menu .row svg{flex:none;color:var(--cds-text-secondary,#5e5d59)}.ldoc-callout-menu .row[aria-selected=true] .tick{margin-left:auto;color:var(--cds-text-secondary,#5e5d59)}`;
function installCalloutStyles(
  installCalloutStyles2?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  if (installCalloutStyles2.getElementById(`lfile-callout-css`)) return;
  let element: Dynamic = installCalloutStyles2.createElement(`style`);
  element.id = CALLOUT_STYLE_ID;
  element.textContent = CALLOUT_CSS;
  installCalloutStyles2.head.append(element);
}
function calloutPositionFromDom(
  calloutPosition?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): null | number {
  let trustedClosest2: Dynamic = trustedClosest(options, `blockquote`);
  if (
    !trustedClosest2 ||
    !trustedContains(calloutPosition.dom, trustedClosest2)
  )
    return null;
  let calloutPositionFromDomResult: Dynamic;
  try {
    calloutPositionFromDomResult = calloutPosition.posAtDOM(trustedClosest2, 0);
  } catch {
    return null;
  }
  let difference: number = calloutPositionFromDomResult - 1;
  return calloutPosition.state.doc.nodeAt(difference)?.type.name ===
    `blockquote`
    ? difference
    : null;
}
var closeCalloutKindPopover: Dynamic = null;
function positionCalloutKindPopover(
  positionCalloutKindPopover2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument: Dynamic = 8,
  ..._extraArguments: unknown[]
): Dynamic {
  let total: Dynamic = positionCalloutKindPopover2.bottom + 4;
  let total2: Dynamic =
    total + options.height <= dependencies - argument
      ? total
      : Math.max(
          argument,
          positionCalloutKindPopover2.top - 4 - options.height,
        );
  let max: number = Math.max(
    argument,
    Math.min(
      positionCalloutKindPopover2.left,
      context - options.width - argument,
    ),
  );
  return {
    left: Math.round(max),
    top: Math.round(total2),
  };
}
function openCalloutKindPopover(
  openCalloutKindPopover2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  closeCalloutKindPopover?.();
  if (!openCalloutKindPopover2.editable) return;
  let calloutPositionFromDom2: Dynamic = (
    ..._extraArguments: unknown[]
  ): null | number =>
    options.isConnected
      ? calloutPositionFromDom(openCalloutKindPopover2, options)
      : null;
  let calloutPositionFromDom3: Dynamic = calloutPositionFromDom2();
  let kind: Dynamic =
    calloutPositionFromDom3 === null
      ? null
      : (proseMirrorCalloutKind(
          openCalloutKindPopover2.state.doc.nodeAt(calloutPositionFromDom3),
        )?.kind ?? null);
  let ownerDocument: Dynamic = openCalloutKindPopover2.dom.ownerDocument;
  let defaultView: Dynamic = ownerDocument.defaultView;
  let element: Dynamic = ownerDocument.createElement(`div`);
  element.className = `ldoc-callout-menu`;
  element.setAttribute(`role`, `listbox`);
  element.setAttribute(`aria-label`, `Panel type`);
  let items: Dynamic = [];
  let changeCalloutKind2 = (
    openCalloutKindPopover3?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    openCalloutKindPopoverHandler(true);
    let calloutPositionFromDom4: Dynamic = calloutPositionFromDom2();
    if (calloutPositionFromDom4 !== null) {
      changeCalloutKind(
        openCalloutKindPopover2,
        calloutPositionFromDom4,
        openCalloutKindPopover3,
      );
    }
  };
  for (let entry of CALLOUT_KINDS as Dynamic) {
    let element2: Dynamic = ownerDocument.createElement(`div`);
    element2.className = `row`;
    element2.setAttribute(`role`, `option`);
    element2.setAttribute(`tabindex`, `-1`);
    element2.setAttribute(`data-kind`, entry.kind);
    element2.setAttribute(`aria-selected`, String(entry.kind === kind));
    element2.append(
      resolveEditorAnchorsAndMentionsGrid2(ownerDocument, entry.icon, 16),
      ownerDocument.createTextNode(entry.label),
    );
    if (entry.kind === kind) {
      let openCalloutKindPopoverResult: Dynamic =
        resolveEditorAnchorsAndMentionsGrid2(
          ownerDocument,
          EditorChipsAndNodeViewsCode.check,
          14,
        );
      openCalloutKindPopoverResult.classList.add(`tick`);
      element2.append(openCalloutKindPopoverResult);
    }
    element2.addEventListener(
      `mousedown`,
      (event?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        event.preventDefault(),
    );
    element2.addEventListener(
      `click`,
      (..._extraArguments: unknown[]): Dynamic =>
        changeCalloutKind2(entry.kind),
    );
    items.push(element2);
    element.append(element2);
  }
  ownerDocument.body.append(element);
  let elementBounds: Dynamic = element.getBoundingClientRect();
  let positionCalloutKindPopover2: Dynamic = positionCalloutKindPopover(
    options.getBoundingClientRect(),
    {
      width: elementBounds.width,
      height: elementBounds.height,
    },
    defaultView.innerWidth,
    defaultView.innerHeight,
  );
  element.style.left = `${positionCalloutKindPopover2.left}px`;
  element.style.top = `${positionCalloutKindPopover2.top}px`;
  options.setAttribute(`aria-expanded`, `true`);
  let max: number = Math.max(
    0,
    CALLOUT_KINDS.findIndex(
      (entry?: Dynamic, ..._extraArguments: unknown[]) => entry.kind === kind,
    ),
  );
  let focus = (
    openCalloutKindPopover3?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    max = (openCalloutKindPopover3 + items.length) % items.length;
    items[max].focus();
  };
  let contains = (
    event?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (
      !element.contains(event.target) &&
      event.target !== options &&
      !options.contains(event.target)
    ) {
      openCalloutKindPopoverHandler(false);
    }
  };
  let contains2 = (
    event?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (resolveEditorAnchorsAndMentionsEscape(event)) {
      resolveEditorAnchorsAndMentionsValue3(event);
      event.preventDefault();
      event.stopPropagation();
      openCalloutKindPopoverHandler(true);
      return;
    }
    if (!element.contains(event.target)) return;
    let key: Dynamic = event.key;
    if (
      key === `ArrowDown` ||
      key === `ArrowUp` ||
      key === `Home` ||
      key === `End`
    ) {
      event.preventDefault();
      event.stopPropagation();
      focus(
        key === `ArrowDown`
          ? max + 1
          : key === `ArrowUp`
            ? max - 1
            : key === `Home`
              ? 0
              : items.length - 1,
      );
    } else {
      if (key === `Enter` || key === ` `) {
        event.preventDefault();
        event.stopPropagation();
        changeCalloutKind2(CALLOUT_KINDS[max].kind);
      } else {
        if (key === `Tab`) {
          event.preventDefault();
          event.stopPropagation();
          openCalloutKindPopoverHandler(true);
        }
      }
    }
  };
  function openCalloutKindPopoverHandler(
    openCalloutKindPopover3?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined {
    element.remove();
    options.removeAttribute(`aria-expanded`);
    ownerDocument.removeEventListener(`mousedown`, contains, true);
    ownerDocument.removeEventListener(`keydown`, contains2, true);
    defaultView.removeEventListener(
      `scroll`,
      openCalloutKindPopoverHandler2,
      true,
    );
    defaultView.removeEventListener(`blur`, openCalloutKindPopoverHandler3);
    if (closeCalloutKindPopover === openCalloutKindPopoverHandler4) {
      closeCalloutKindPopover = null;
    }
    if (openCalloutKindPopover3 && openCalloutKindPopover2.dom.isConnected) {
      openCalloutKindPopover2.focus();
    }
  }
  let openCalloutKindPopoverHandler2: Dynamic = (
    ..._extraArguments: unknown[]
  ): Dynamic => openCalloutKindPopoverHandler(false);
  let openCalloutKindPopoverHandler3: Dynamic = (
    ..._extraArguments: unknown[]
  ): Dynamic => openCalloutKindPopoverHandler(false);
  let openCalloutKindPopoverHandler4: Dynamic = (
    ..._extraArguments: unknown[]
  ): Dynamic => openCalloutKindPopoverHandler(false);
  closeCalloutKindPopover = openCalloutKindPopoverHandler4;
  ownerDocument.addEventListener(`mousedown`, contains, true);
  ownerDocument.addEventListener(`keydown`, contains2, true);
  defaultView.addEventListener(`scroll`, openCalloutKindPopoverHandler2, true);
  defaultView.addEventListener(`blur`, openCalloutKindPopoverHandler3);
  focus(max);
}
function changeCalloutKind(
  changeCalloutKind2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
) {
  if (!changeCalloutKind2.editable) return false;
  let nodeAt: Dynamic = changeCalloutKind2.state.doc.nodeAt(options);
  let proseMirrorCalloutKind2: Dynamic = nodeAt
    ? proseMirrorCalloutKind(nodeAt)
    : null;
  if (!nodeAt || !proseMirrorCalloutKind2) return false;
  if (proseMirrorCalloutKind2.kind === context) return true;
  let total: Dynamic = options + 2;
  changeCalloutKind2.dispatch(
    changeCalloutKind2.state.tr
      .insertText(
        `${calloutKindDescriptor(context).emoji} `,
        total,
        total + proseMirrorCalloutKind2.leadLen,
      )
      .scrollIntoView(),
  );
  return true;
}
function deleteCalloutTransaction(
  deleteCalloutTransaction2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let nodeAt: Dynamic = deleteCalloutTransaction2.doc.nodeAt(options);
  if (!nodeAt || !proseMirrorCalloutKind(nodeAt)) return null;
  let result: Dynamic = closeHistory(deleteCalloutTransaction2.tr).delete(
    options,
    options + nodeAt.nodeSize,
  );
  let resolve: Dynamic = result.doc.resolve(result.mapping.map(options));
  result.setSelection(
    Selection.findFrom(resolve, 1, true) ??
      Selection.findFrom(resolve, -1, true) ??
      Selection.near(resolve, 1),
  );
  return result.scrollIntoView();
}
function deleteCallout(
  deleteCallout2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): boolean {
  if (!deleteCallout2.editable) return false;
  let { selection: state, doc: state2 }: Dynamic = deleteCallout2.state;
  let nodeAt: Dynamic = state2.nodeAt(options);
  let proseMirrorCalloutKind2: Dynamic = nodeAt
    ? proseMirrorCalloutKind(nodeAt)
    : null;
  if (!nodeAt || !proseMirrorCalloutKind2) return false;
  let total: Dynamic = options + nodeAt.nodeSize;
  if (state.from < options || state.to > total) {
    deleteCallout2.dispatch(
      deleteCallout2.state.tr.setSelection(
        TextSelection.create(
          state2,
          options + 2 + proseMirrorCalloutKind2.leadLen,
        ),
      ),
    );
  }
  let deleteCalloutTransaction2: Dynamic = deleteCalloutTransaction(
    deleteCallout2.state,
    options,
  );
  return deleteCalloutTransaction2
    ? (deleteCallout2.dispatch(deleteCalloutTransaction2),
      deleteCallout2.focus(),
      resolvePlatformAnnouncementsValue(
        deleteCallout2.dom.ownerDocument,
        resolveEditorExtensionsNoun2(`callout`),
      ),
      true)
    : false;
}
function firstCalloutTextPosition(
  firstCalloutTextPosition2?: Dynamic,
  options?: Dynamic,
  context: Dynamic = 0,
  ..._extraArguments: unknown[]
): Dynamic {
  let total: Dynamic = 1 + options.leadLen;
  let firstCalloutTextPositionResult: Dynamic = null;
  firstCalloutTextPosition2.descendants(
    (node?: Dynamic, options2?: Dynamic, ..._extraArguments: unknown[]) => {
      if (
        firstCalloutTextPositionResult !== null ||
        node.type.spec.tableRole !== undefined
      )
        return false;
      if (!node.isText) return true;
      let text: Dynamic = node.text;
      for (
        let max: number = Math.max(0, total - options2);
        max < text.length;
        max++
      )
        if (!/\s/.test(text[max])) {
          firstCalloutTextPositionResult = options2 + max;
          return false;
        }
      return false;
    },
  );
  return firstCalloutTextPositionResult === null
    ? null
    : context + 1 + firstCalloutTextPositionResult;
}
function calloutObjectMenuItems(
  view?: Dynamic,
  options?: Dynamic,
  items: Dynamic = [],
  ..._extraArguments: unknown[]
): Dynamic {
  let options2: Dynamic = options();
  let nodeAt: Dynamic =
    options2 === null ? null : view.state.doc.nodeAt(options2);
  if (options2 === null || !nodeAt || !proseMirrorCalloutKind(nodeAt))
    return [];
  let items2: Dynamic = [
    ...objectMenuCommentItems((..._extraArguments: unknown[]): Dynamic => {
      let pos: Dynamic = options();
      let nodeAt2: Dynamic = pos === null ? null : view.state.doc.nodeAt(pos);
      let proseMirrorCalloutKind2: Dynamic = nodeAt2
        ? proseMirrorCalloutKind(nodeAt2)
        : null;
      let from: Dynamic =
        nodeAt2 && proseMirrorCalloutKind2
          ? firstCalloutTextPosition(nodeAt2, proseMirrorCalloutKind2, pos)
          : null;
      return pos === null || from === null
        ? null
        : {
            kind: `block`,
            view: view,
            pos: pos,
            from: from,
          };
    }),
  ];
  if (items.length) {
    (items2.push as Dynamic)(
      {
        ...items[0],
        separatorBefore: true,
      },
      ...items.slice(1),
    );
  }
  if (view.editable) {
    (items2.push as Dynamic)(
      ...objectMenuDeleteItems(
        `callout`,
        (..._extraArguments: unknown[]): undefined => {
          let options3: Dynamic = options();
          if (options3 !== null) {
            deleteCallout(view, options3);
          }
        },
      ),
    );
  }
  return items2;
}
var isContextMenuKeyboardShortcut: Dynamic = (
  contextMenuKeyboardShortcut?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let keyboardGesture2: Dynamic = keyboardGesture(contextMenuKeyboardShortcut);
  return (
    keyboardGesture2.key === `ContextMenu` ||
    ((keyboardGesture2.key === `F10` || keyboardGesture2.code === `F10`) &&
      keyboardGesture2.shiftKey &&
      !keyboardGesture2.altKey &&
      !keyboardGesture2.metaKey)
  );
};
function selectedCallout(
  selectedCallout2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let { $from: selection, empty: selection2 }: Dynamic =
    selectedCallout2.selection;
  if (
    !selection2 ||
    selection.parent.type.name !== `paragraph` ||
    selection.depth < 2
  )
    return null;
  let difference: number = selection.depth - 1;
  let node: Dynamic = selection.node(difference);
  let proseMirrorCalloutKind2: Dynamic =
    node.type.name === `blockquote` ? proseMirrorCalloutKind(node) : null;
  return proseMirrorCalloutKind2
    ? (selection.index(difference) === 0
        ? selection.parent.textContent.slice(proseMirrorCalloutKind2.leadLen)
        : selection.parent.textContent
      ).trim() === ``
      ? null
      : {
          pos: selection.before(difference),
          node: node,
        }
    : null;
}
function installCalloutKeyboardMenu(
  view?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let dom: Dynamic = view.dom;
  let ownerDocument: Dynamic = dom.ownerDocument;
  let enabled: boolean = false;
  let isTrustedGesture2 = (
    installCalloutKeyboardMenu2?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (isTrustedGesture(installCalloutKeyboardMenu2)) {
      enabled = false;
    }
  };
  let isTrustedGesture3 = (
    installCalloutKeyboardMenu2?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (
      isTrustedGesture(installCalloutKeyboardMenu2) &&
      !installCalloutKeyboardMenu2.repeat
    ) {
      enabled = false;
    }
  };
  let coordsAtPos = (
    gesture?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (
      !isTrustedGesture(gesture) ||
      !isContextMenuKeyboardShortcut(gesture) ||
      !view.hasFocus() ||
      view.composing
    )
      return;
    let selectedCallout2: Dynamic = selectedCallout(view.state);
    if (!selectedCallout2) return;
    let nodeDOM: Dynamic = view.nodeDOM(selectedCallout2.pos);
    if (
      !(
        nodeDOM instanceof (ownerDocument.defaultView.HTMLElement as Dynamic)
      ) ||
      !trustedContains(dom, nodeDOM)
    )
      return;
    let items: Dynamic = calloutObjectMenuItems(
      view,
      (..._extraArguments: unknown[]): null | number =>
        nodeDOM.isConnected ? calloutPositionFromDom(view, nodeDOM) : null,
    );
    if (items.length === 0) return;
    let coordsAtPos2: Dynamic = view.coordsAtPos(view.state.selection.from);
    if (
      openObjectMenu({
        view: view,
        anchor: {
          x: coordsAtPos2.left,
          y: coordsAtPos2.bottom,
          of: nodeDOM,
        },
        items: items,
        label: `Panel actions`,
        enter: `first`,
        gesture: gesture,
      })
    ) {
      enabled = true;
      gesture.preventDefault();
    }
  };
  let stopImmediatePropagation = (
    event?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (enabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  ownerDocument.addEventListener(`keydown`, isTrustedGesture3, true);
  dom.addEventListener(`keydown`, coordsAtPos, true);
  dom.addEventListener(`contextmenu`, stopImmediatePropagation, true);
  ownerDocument.addEventListener(`pointerdown`, isTrustedGesture2, true);
  ownerDocument.addEventListener(`mousedown`, isTrustedGesture2, true);
  return (..._extraArguments: unknown[]): undefined => {
    ownerDocument.removeEventListener(`keydown`, isTrustedGesture3, true);
    dom.removeEventListener(`keydown`, coordsAtPos, true);
    dom.removeEventListener(`contextmenu`, stopImmediatePropagation, true);
    ownerDocument.removeEventListener(`pointerdown`, isTrustedGesture2, true);
    ownerDocument.removeEventListener(`mousedown`, isTrustedGesture2, true);
  };
}
function calloutKindButton(
  calloutKindButton2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let ownerDocument: Dynamic = calloutKindButton2.dom.ownerDocument;
  let calloutKindDescriptor2: Dynamic = calloutKindDescriptor(options);
  let element: Dynamic = ownerDocument.createElement(
    context ? `button` : `span`,
  );
  element.className = `ldoc-callout-kind`;
  element.setAttribute(`contenteditable`, `false`);
  element.setAttribute(`data-callout-icon`, options);
  element.append(
    resolveEditorAnchorsAndMentionsGrid2(
      ownerDocument,
      calloutKindDescriptor2.icon,
      20,
    ),
  );
  if (!context) {
    element.setAttribute(`aria-hidden`, `true`);
    return element;
  }
  let element2: Dynamic = element;
  element2.type = `button`;
  element2.setAttribute(`aria-haspopup`, `listbox`);
  element2.setAttribute(
    `aria-label`,
    `${calloutKindDescriptor2.label} panel — change type`,
  );
  element2.setAttribute(`data-testid`, `callout-kind`);
  element2.addEventListener(
    `mousedown`,
    (event?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      event.preventDefault(),
  );
  element2.addEventListener(
    `click`,
    (event?: Dynamic, ..._extraArguments: unknown[]): undefined => {
      event.preventDefault();
      if (calloutPositionFromDom(calloutKindButton2, element2) !== null) {
        openCalloutKindPopover(calloutKindButton2, element2);
      }
    },
  );
  return element2;
}
function calloutDeleteButton(
  calloutDeleteButton2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let ownerDocument: Dynamic = calloutDeleteButton2.dom.ownerDocument;
  let element: Dynamic = ownerDocument.createElement(`button`);
  element.type = `button`;
  element.className = `ldoc-callout-x`;
  element.setAttribute(`aria-label`, resolveEditorExtensionsNoun(`callout`));
  element.dataset.tip = resolveEditorExtensionsDelete(`callout`);
  element.setAttribute(`contenteditable`, `false`);
  element.setAttribute(`data-testid`, `callout-x`);
  element.append(
    resolveEditorAnchorsAndMentionsGrid2(
      ownerDocument,
      EditorChipsAndNodeViewsCode.x,
      14,
    ),
  );
  let deleteCallout2 = (
    event?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    event.preventDefault();
    let calloutPositionFromDom2: Dynamic = calloutPositionFromDom(
      calloutDeleteButton2,
      element,
    );
    if (calloutPositionFromDom2 !== null) {
      deleteCallout(calloutDeleteButton2, calloutPositionFromDom2);
    }
  };
  element.addEventListener(
    `mousedown`,
    (event?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      event.preventDefault(),
  );
  element.addEventListener(`click`, deleteCallout2);
  element.addEventListener(
    `keydown`,
    (event?: Dynamic, ..._extraArguments: unknown[]): undefined => {
      if (!(event.key !== `Enter` && event.key !== ` `)) {
        event.stopPropagation();
        deleteCallout2(event);
      }
    },
  );
  return element;
}
var calloutPluginKey: Dynamic = new (PluginKey as Dynamic)(`lfileCallout`);
function calloutDecorations(
  calloutDecorations2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items: Dynamic = [];
  calloutDecorations2.descendants(
    (node?: Dynamic, options2?: Dynamic, ..._extraArguments: unknown[]) => {
      if (node.isTextblock) return false;
      if (node.type.name !== `blockquote`) return true;
      let proseMirrorCalloutKind2: Dynamic = proseMirrorCalloutKind(node);
      if (!proseMirrorCalloutKind2) return true;
      let { kind: dataCallout }: Dynamic = proseMirrorCalloutKind2;
      items.push(
        Decoration.node(options2, options2 + node.nodeSize, {
          class: `ldoc-callout`,
          "data-callout": dataCallout,
          role: `note`,
          "aria-label": calloutKindDescriptor(dataCallout).label,
        }),
      );
      let total: Dynamic = options2 + 2;
      let total2: Dynamic = total + proseMirrorCalloutKind2.emoji.length;
      items.push(
        Decoration.inline(total, total2, {
          class: `ldoc-callout-lead`,
        }),
      );
      if (
        proseMirrorCalloutKind2.leadLen > proseMirrorCalloutKind2.emoji.length
      ) {
        items.push(
          Decoration.inline(total2, total + proseMirrorCalloutKind2.leadLen, {
            class: `ldoc-callout-gap`,
          }),
        );
      }
      let difference: number = options2 + node.nodeSize - 1;
      items.push(
        Decoration.widget(
          difference,
          (
            calloutDecorations3?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic =>
            calloutKindButton(calloutDecorations3, dataCallout, options),
          {
            side: 1,
            key: `ldoc-callout-kind:${dataCallout}:${+!!options}`,
            ignoreSelection: true,
            stopEvent: (..._extraArguments: unknown[]) => true,
          },
        ),
      );
      if (options) {
        items.push(
          Decoration.widget(
            difference,
            (
              calloutDecorations3?: Dynamic,
              ..._extraArguments: unknown[]
            ): Dynamic => calloutDeleteButton(calloutDecorations3),
            {
              side: 1,
              key: `ldoc-callout-x`,
              ignoreSelection: true,
              stopEvent: (..._extraArguments: unknown[]) => true,
            },
          ),
        );
      }
      return true;
    },
  );
  return items.length
    ? DecorationSet.create(calloutDecorations2, items)
    : DecorationSet.empty;
}
function calloutAtSelection(
  callout?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let { $from: selection }: Dynamic = callout.selection;
  for (let depth: Dynamic = selection.depth; depth > 0; depth--) {
    let node: Dynamic = selection.node(depth);
    if (node.type.name === `blockquote`)
      return proseMirrorCalloutKind(node)
        ? {
            pos: selection.before(depth),
            node: node,
          }
        : null;
  }
  return null;
}
Extension.create({
  name: `lfileCallout`,
  addProseMirrorPlugins(this: Dynamic, ..._extraArguments: unknown[]): Dynamic {
    let matchesEditable: boolean = this.editor.options.editable !== false;
    return [
      new (Plugin as Dynamic)({
        key: calloutPluginKey,
        state: {
          init: (
            callback?: unknown,
            options?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic => calloutDecorations(options.doc, matchesEditable),
          apply: (
            callback?: Dynamic,
            options?: Dynamic,
            context?: unknown,
            dependencies?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic =>
            callback.docChanged
              ? calloutDecorations(dependencies.doc, matchesEditable)
              : options,
        },
        view(callback?: Dynamic, ..._extraArguments: unknown[]): Dynamic {
          installCalloutStyles(callback.dom.ownerDocument);
          let installCalloutKeyboardMenu2: Dynamic =
            installCalloutKeyboardMenu(callback);
          return {
            destroy(..._extraArguments: unknown[]): undefined {
              installCalloutKeyboardMenu2();
              closeCalloutKindPopover?.();
            },
          };
        },
        props: {
          decorations(
            callback?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic {
            let calloutPluginKeyState: Dynamic =
              calloutPluginKey.getState(callback) ?? DecorationSet.empty;
            if (!matchesEditable) return calloutPluginKeyState;
            let calloutAtSelection2: Dynamic = calloutAtSelection(callback);
            return calloutAtSelection2
              ? calloutPluginKeyState.add(callback.doc, [
                  Decoration.node(
                    calloutAtSelection2.pos,
                    calloutAtSelection2.pos + calloutAtSelection2.node.nodeSize,
                    {
                      class: `has-caret`,
                    },
                  ),
                ])
              : calloutPluginKeyState;
          },
        },
      }),
    ];
  },
});
var escapeWidgetSlotHtml: Dynamic = (
  escapeWidgetSlotHtml2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  escapeWidgetSlotHtml2.replace(
    /[&"<>\u00A0]/g,
    (escapeWidgetSlotHtml3?: Dynamic, ..._extraArguments: unknown[]) =>
      escapeWidgetSlotHtml3 === `&`
        ? `&amp;`
        : escapeWidgetSlotHtml3 === `"`
          ? `&quot;`
          : escapeWidgetSlotHtml3 === `<`
            ? `&lt;`
            : escapeWidgetSlotHtml3 === `>`
              ? `&gt;`
              : `&nbsp;`,
  );
var WIDGET_CODE_SLOT_ATTRIBUTE: string = `data-vh-widget-slot`;
var widgetCodeSlotHtml = (
  widgetCodeSlotHtml2?: Dynamic,
  ..._extraArguments: unknown[]
) =>
  `<span ${WIDGET_CODE_SLOT_ATTRIBUTE}="${escapeWidgetSlotHtml(widgetCodeSlotHtml2)}"></span>`;
var WIDGET_CODE_ALLOWED_TAGS: Dynamic = new (Set as Dynamic)([
  `details`,
  `summary`,
  `pre`,
  `code`,
  `ins`,
  `del`,
  `span`,
]);
/* Subsystem: preview-sanitizer */
function isSafeWidgetCodeHtml(
  safeWidgetCodeHtml?: Dynamic,
  ..._extraArguments: unknown[]
) {
  if (!safeWidgetCodeHtml.startsWith(`<details class="vh-widget-code">`))
    return false;
  for (let isSafeWidgetCodeHtmlResult of safeWidgetCodeHtml.matchAll(
    /<\/?([A-Za-z][A-Za-z0-9-]*)([^>]*)>/g,
  ) as Dynamic) {
    if (
      !WIDGET_CODE_ALLOWED_TAGS.has(isSafeWidgetCodeHtmlResult[1].toLowerCase())
    )
      return false;
    let trimmedIsSafeWidgetCodeHtmlResultItem: Dynamic =
      isSafeWidgetCodeHtmlResult[2].trim();
    if (
      trimmedIsSafeWidgetCodeHtmlResultItem !== `` &&
      !/^class="[A-Za-z0-9 _-]*"$/.test(trimmedIsSafeWidgetCodeHtmlResultItem)
    )
      return false;
  }
  return true;
}
var REPEATED_WIDGET_CODE_MESSAGE: Dynamic = renderUnavailableWidgetCodeDiff(
  `Same code changes as the card above`,
);
function fillWidgetCodeSlots(
  fillWidgetCodeSlots2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let fillWidgetCodeSlots3: Dynamic = fillWidgetCodeSlots2;
  for (let [
    fillWidgetCodeSlotsResult,
    fillWidgetCodeSlotsResult2,
  ] of options as Dynamic) {
    if (
      fillWidgetCodeSlotsResult2 === `` ||
      !isSafeWidgetCodeHtml(fillWidgetCodeSlotsResult2)
    )
      continue;
    let widgetCodeSlotHtml2: string = widgetCodeSlotHtml(
      fillWidgetCodeSlotsResult,
    );
    let fillWidgetCodeSlotIndex: Dynamic =
      fillWidgetCodeSlots3.indexOf(widgetCodeSlotHtml2);
    if (fillWidgetCodeSlotIndex < 0) continue;
    let widgetCodeSlotHtmlSlice: Dynamic = widgetCodeSlotHtml2.slice(0, -7);
    let fillWidgetCodeSlotsSlicePartsText: Dynamic = fillWidgetCodeSlots3
      .slice(fillWidgetCodeSlotIndex + widgetCodeSlotHtml2.length)
      .split(widgetCodeSlotHtml2)
      .join(`${widgetCodeSlotHtmlSlice}${REPEATED_WIDGET_CODE_MESSAGE}</span>`);
    fillWidgetCodeSlots3 = `${fillWidgetCodeSlots3.slice(0, fillWidgetCodeSlotIndex)}${widgetCodeSlotHtmlSlice}${fillWidgetCodeSlotsResult2}</span>${fillWidgetCodeSlotsSlicePartsText}`;
  }
  return fillWidgetCodeSlots3;
}
var REMOVED_PREVIEW_ATTRIBUTES: Dynamic = [
  ...Object.values(DIFF_ATTRIBUTE_NAMES),
  `diffGhost`,
  `diffMoveTo`,
];
var REMOVED_PREVIEW_MARKS: Dynamic = new (Set as Dynamic)(
  Object.values(DIFF_MARK_TYPES),
);
var SanitizeError: Dynamic = class extends Error {
  [key: string]: Dynamic;
  constructor(sanitizeError?: Dynamic, ..._extraArguments: unknown[]) {
    super(
      `version history: cannot show this version safely (${sanitizeError})`,
    );
    this.name = `SanitizeError`;
  }
};
var isSanitizeObject: Dynamic = (
  sanitizeObject?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  typeof sanitizeObject == `object` &&
  !!sanitizeObject &&
  !Array.isArray(sanitizeObject);
function sanitizePreviewNode(
  sanitizePreviewNode2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (
    !isSanitizeObject(sanitizePreviewNode2) ||
    typeof sanitizePreviewNode2.type != `string`
  )
    throw new (SanitizeError as Dynamic)(`a node without a type`);
  let record: Dynamic = {
    type: sanitizePreviewNode2.type,
  };
  if (typeof sanitizePreviewNode2.text == `string`) {
    record.text = sanitizePreviewNode2.text;
  }
  if (isSanitizeObject(sanitizePreviewNode2.attrs)) {
    let record2: Dynamic = {};
    for (let [
      sanitizePreviewNodeResult,
      sanitizePreviewNodeResult2,
    ] of Object.entries(sanitizePreviewNode2.attrs) as Dynamic)
      if (!REMOVED_PREVIEW_ATTRIBUTES.includes(sanitizePreviewNodeResult)) {
        record2[sanitizePreviewNodeResult] = sanitizePreviewNodeResult2;
      }
    record.attrs = record2;
  }
  if (Array.isArray(sanitizePreviewNode2.marks)) {
    let items: Dynamic = [];
    for (let sanitizePreviewNodeResult of sanitizePreviewNode2.marks as Dynamic)
      if (
        isSanitizeObject(sanitizePreviewNodeResult) &&
        typeof sanitizePreviewNodeResult.type == `string` &&
        !REMOVED_PREVIEW_MARKS.has(sanitizePreviewNodeResult.type)
      ) {
        items.push(
          isSanitizeObject(sanitizePreviewNodeResult.attrs)
            ? {
                type: sanitizePreviewNodeResult.type,
                attrs: {
                  ...sanitizePreviewNodeResult.attrs,
                },
              }
            : {
                type: sanitizePreviewNodeResult.type,
              },
        );
      }
    record.marks = items;
  }
  return record;
}
function sanitizePreviewDocument(
  src?: Dynamic,
  options: Dynamic = 200,
  ..._extraArguments: unknown[]
): Dynamic {
  let out: Dynamic = sanitizePreviewNode(src);
  let items: Dynamic = [
    {
      src: src,
      out: out,
      depth: 0,
    },
  ];
  for (; items.length > 0; ) {
    let { src: pop, out: pop2, depth: pop3 }: Dynamic = items.pop();
    let content: Dynamic = isSanitizeObject(pop) ? pop.content : undefined;
    if (content === undefined) continue;
    if (!Array.isArray(content))
      throw new (SanitizeError as Dynamic)(`content that is not a list`);
    if (pop3 >= options)
      throw new (SanitizeError as Dynamic)(`nested too deep`);
    let mappedContent: Dynamic = content.map(sanitizePreviewNode);
    pop2.content = mappedContent;
    for (let index: number = 0; index < content.length; index++)
      items.push({
        src: content[index],
        out: mappedContent[index],
        depth: pop3 + 1,
      });
  }
  return out;
}
var doorCommentsModule: Dynamic = createLiveModuleNamespace({
  doorPidOf: (..._extraArguments: unknown[]): Dynamic => doorPidOf,
  listCommentsUnder: (..._extraArguments: unknown[]): Dynamic =>
    listCommentsUnder,
  resolveNodeEngines: (..._extraArguments: unknown[]): Dynamic =>
    resolveNodeEngines,
  threadsFromRows: (..._extraArguments: unknown[]): Dynamic => threadsFromRows,
  underRefsOf: (..._extraArguments: unknown[]): Dynamic => underRefsOf,
  utterancesFromRows: (..._extraArguments: unknown[]): Dynamic =>
    utterancesFromRows,
});
var MAX_COMMENT_QUERY_PAGES: number = 40;
/* Subsystem: door-comments */
function underRefsOf(
  underRefs?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let record: Dynamic = {
    object: `file`,
    id: underRefs,
  };
  return platformSessionAndSourcesPattern9.test(underRefs)
    ? [
        record,
        {
          object: `node`,
          id: underRefs,
        },
      ]
    : [record];
}
var isCommentRowObject: Dynamic = (
  commentRowObject?: Dynamic,
  ..._extraArguments: unknown[]
): boolean =>
  typeof commentRowObject == `object` &&
  !!commentRowObject &&
  !Array.isArray(commentRowObject);
var UNSAFE_COMMENT_PATCH_KEYS: Dynamic = new (Set as Dynamic)([
  `__proto__`,
  `constructor`,
  `prototype`,
]);
function applyCommentRowPatches(
  applyCommentRowPatches2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let structuredClone2: Dynamic = structuredClone(applyCommentRowPatches2);
  for (let operation of options as Dynamic) {
    if (
      !Array.isArray(operation.path) ||
      !operation.path.every(
        (path2?: Dynamic, ..._extraArguments: unknown[]): boolean =>
          typeof path2 == `string` && !UNSAFE_COMMENT_PATCH_KEYS.has(path2),
      )
    )
      continue;
    let path: Dynamic = operation.path;
    if (path.length === 0) {
      if (operation.op === `set`) {
        structuredClone2 = structuredClone(operation.value);
      }
      continue;
    }
    if (!isCommentRowObject(structuredClone2)) {
      structuredClone2 = {};
    }
    let structuredClone3: Dynamic = structuredClone2;
    for (let applyCommentRowPatchesResult of path.slice(0, -1) as Dynamic) {
      if (
        !Object.hasOwn(structuredClone3, applyCommentRowPatchesResult) ||
        !isCommentRowObject(structuredClone3[applyCommentRowPatchesResult])
      ) {
        structuredClone3[applyCommentRowPatchesResult] = {};
      }
      structuredClone3 = structuredClone3[applyCommentRowPatchesResult];
    }
    let pathItem: Dynamic = path[path.length - 1];
    if (operation.op === `set`) {
      structuredClone3[pathItem] = structuredClone(operation.value);
    } else {
      if (
        operation.op === `unset` ||
        operation.op === `delete` ||
        operation.op === `remove`
      ) {
        delete structuredClone3[pathItem];
      }
    }
  }
  return structuredClone2;
}
function utterancesFromRows(
  utterances?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let lookup: Dynamic = new (Map as Dynamic)();
  let toSorted: Dynamic = utterances.toSorted(
    (item?: Dynamic, item2?: Dynamic, ..._extraArguments: unknown[]): number =>
      item.seq - item2.seq,
  );
  for (let activity of toSorted as Dynamic) {
    let payload: Dynamic = isCommentRowObject(activity.payload)
      ? activity.payload
      : {};
    if (activity.verb === `create`) {
      lookup.set(activity.id, {
        value: payload.value,
        born: {
          seq: activity.seq,
          at: activity.at,
          actor: activity.actor,
        },
      });
      continue;
    }
    let lookupEntry: Dynamic = lookup.get(activity.id);
    if (lookupEntry !== undefined) {
      if (activity.verb === `delete`) {
        lookup.delete(activity.id);
        continue;
      }
      if (payload.kind === `patch` && Array.isArray(payload.patch)) {
        lookupEntry.value = applyCommentRowPatches(
          lookupEntry.value,
          payload.patch,
        );
      } else {
        if (`value` in payload) {
          lookupEntry.value = structuredClone(payload.value);
        }
      }
      if (resolvePlatformApiAndAuthHuman(activity.actor) !== `host`) {
        lookupEntry.born = {
          ...lookupEntry.born,
          edited: true,
        };
      }
    }
  }
  return [...lookup].map(
    ([item, item2]: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
      id: item,
      value: item2.value,
      born: item2.born,
    }),
  );
}
function threadsFromRows(
  threads?: Dynamic,
  options?: Dynamic,
  context: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  let utterancesFromRows2: Dynamic = utterancesFromRows(threads);
  let lookup: Dynamic = new (Map as Dynamic)();
  if (options.object === `node`) {
    lookup.set(`node/${options.id}`, {
      engine: `widget`,
    });
  }
  if (options.object === `file`)
    for (let threadsFromRowsResult of commentNodeIds(
      utterancesFromRows2,
    ) as Dynamic) {
      let engine: Dynamic =
        context.engineOf?.(threadsFromRowsResult) ?? `prose`;
      lookup.set(
        `node/${threadsFromRowsResult}`,
        engine === `widget`
          ? {
              engine: engine,
            }
          : {
              engine: engine,
              parent: {
                object: `file`,
                id: options.id,
              },
            },
      );
    }
  return (
    updateCommentsStoreUser(
      utterancesFromRows2,
      (threads2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        lookup.get(threads2),
      (..._extraArguments: unknown[]): undefined => undefined,
      {},
      context.me,
    ).byPage.get(options.id) ?? []
  ).filter(
    (byPageEntry?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      context.resolved || !byPageEntry.resolved,
  );
}
function commentNodeIds(
  commentNodeIds2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let uniqueItems: Dynamic = new (Set as Dynamic)();
  for (let commentNodeIdsResult of commentNodeIds2 as Dynamic) {
    let commentNodeIdsResult2: Dynamic = resolveEditorExtensionsAnchor2(
      commentNodeIdsResult.value,
    );
    if (commentNodeIdsResult2?.object === `node`) {
      uniqueItems.add(commentNodeIdsResult2.id);
    }
  }
  return [...uniqueItems];
}
async function resolveNodeEngines(
  nodeEngines?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let lookup: Dynamic = new (Map as Dynamic)();
  await Promise.all(
    options.map(
      async (
        item?: Dynamic,
        ..._extraArguments: unknown[]
      ): Promise<undefined> => {
        try {
          let response: Dynamic = ackOf(
            await nodeEngines.call(`read`, {
              ref: {
                object: `node`,
                id: item,
              },
              engine: `widget`,
              payload: {
                engine: `widget`,
              },
            }),
          );
          if (response.verdict === `allow`) {
            if (
              isCommentRowObject(response.value) &&
              typeof response.value.pub == `number`
            ) {
              lookup.set(item, `widget`);
            }
          } else {
            if (
              response.reason === `engine-bound` ||
              response.reason === `engine-mismatch`
            ) {
              lookup.set(item, `prose`);
            }
          }
        } catch {}
      },
    ),
  );
  return lookup;
}
var isCommentUtteranceRow: Dynamic = (
  commentUtteranceRow?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  isCommentRowObject(commentUtteranceRow) &&
  typeof commentUtteranceRow.seq == `number` &&
  typeof commentUtteranceRow.id == `string` &&
  (commentUtteranceRow.verb === `create` ||
    commentUtteranceRow.verb === `update` ||
    commentUtteranceRow.verb === `delete`) &&
  isCommentRowObject(commentUtteranceRow.actor);
function doorPidOf(doorPid?: Dynamic, ..._extraArguments: unknown[]): Dynamic {
  let lastIndexOf: Dynamic = doorPid.lastIndexOf(`@`);
  let doorPidSlice: Dynamic =
    lastIndexOf > 0 ? doorPid.slice(0, lastIndexOf) : doorPid;
  let match: Dynamic = /^projects?\/([^/]+)$/.exec(doorPidSlice);
  return match ? match[1] : doorPidSlice;
}
async function listCommentsUnder(
  listCommentsUnder2?: Dynamic,
  options?: Dynamic,
  resolved?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  if (!options) return [];
  let listCommentsUnderResult: Dynamic = liveDoor(
    doorPidOf(listCommentsUnder2),
  );
  let {
    foldStore: listCommentsUnderResult2,
    refIndexAtom: listCommentsUnderResult3,
  }: Dynamic = await preloadModule(
    async (..._extraArguments: unknown[]): Promise<Dynamic> => {
      let { foldStore: foldStore, refIndexAtom: refIndexAtom }: Dynamic =
        await import("./index").then(
          (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
            result.DataOperationEngineFOLDLAZYENGINES,
        );
      return {
        foldStore: foldStore,
        refIndexAtom: refIndexAtom,
      };
    },
    mapPreloadDependencies([0, 1, 2, 3]),
    import.meta.url,
  );
  let listCommentsUnderHandler: Dynamic = (
    listCommentsUnder3?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    listCommentsUnderResult2
      .get(listCommentsUnderResult3)
      .get(`node/${listCommentsUnder3}`)?.engine;
  for (let listCommentsUnderResult4 of underRefsOf(options) as Dynamic) {
    let queryCommentUtterances2: Dynamic = await queryCommentUtterances(
      listCommentsUnderResult,
      listCommentsUnderResult4,
    );
    if (queryCommentUtterances2.length === 0) continue;
    let engineOf: Dynamic = listCommentsUnderHandler;
    if (listCommentsUnderResult4.object === `file`) {
      let filteredCommentNodeIds: Dynamic = commentNodeIds(
        utterancesFromRows(queryCommentUtterances2),
      ).filter(
        (commentNodeId?: Dynamic, ..._extraArguments: unknown[]) =>
          listCommentsUnderHandler(commentNodeId) === undefined,
      );
      if (filteredCommentNodeIds.length > 0) {
        let nodeEngines: Dynamic = await resolveNodeEngines(
          listCommentsUnderResult,
          filteredCommentNodeIds,
        );
        engineOf = (
          listCommentsUnder3?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic =>
          listCommentsUnderHandler(listCommentsUnder3) ??
          nodeEngines.get(listCommentsUnder3);
      }
    }
    return threadsFromRows(queryCommentUtterances2, listCommentsUnderResult4, {
      resolved: resolved,
      engineOf: engineOf,
    });
  }
  return [];
}
async function queryCommentUtterances(
  queryCommentUtterances2?: Dynamic,
  under?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  let items: Dynamic = [];
  let afterSeq: Dynamic;
  for (let index: number = 0; index < MAX_COMMENT_QUERY_PAGES; index++) {
    let response: Dynamic = ackOf(
      await queryCommentUtterances2.call(`query`, {
        object: `utterance`,
        payload: {
          under: under,
          limit: 500,
          ...(afterSeq !== undefined && {
            afterSeq: afterSeq,
          }),
        },
      }),
    );
    if (response.verdict === `deny`)
      throw Error(`comments: ${response.reason}`);
    let filteredRows: Dynamic = (response.rows ?? []).filter(
      isCommentUtteranceRow,
    );
    (items.push as Dynamic)(...filteredRows);
    let filteredRowItem: Dynamic = filteredRows[filteredRows.length - 1];
    if (response.truncated !== true || filteredRowItem === undefined) break;
    afterSeq = filteredRowItem.seq;
  }
  return items;
}
var workflowClientModule: Dynamic = createLiveModuleNamespace({
  propagateWorkflowClient: (..._extraArguments: unknown[]): Dynamic =>
    propagateWorkflowClient,
  runWorkflowClient: (..._extraArguments: unknown[]): Dynamic =>
    runWorkflowClient,
});
var OVERWRITE_GUARD_PREFIX: string = `OVERWRITE_GUARD:`;
/* Subsystem: workflow-client */
async function appendWorkflowDirtyFiles(
  appendWorkflowDirtyFiles2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  scheduler?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<undefined> {
  for (let [
    appendWorkflowDirtyFilesResult,
    appendWorkflowDirtyFilesResult2,
  ] of Object.entries(
    await useWorkbookStore.getState().dirtyBytes(options),
  ) as Dynamic)
    appendWorkflowDirtyFiles2.set(
      `dirty:${appendWorkflowDirtyFilesResult}`,
      new (Blob as Dynamic)([appendWorkflowDirtyFilesResult2]),
    );
  appendWorkflowDirtyFiles2.set(
    `dirty:${context}`,
    new (Blob as Dynamic)([
      JSON.stringify({
        sourcePath: scheduler.sourcePath,
        ...(scheduler.mcpSource && {
          mcpSource: scheduler.mcpSource,
        }),
        configuration: scheduler.configuration,
        params: scheduler.params,
        propagations: scheduler.propagations,
        schedule: scheduler.schedule,
        order: scheduler.order,
        syncedRunId: scheduler.syncedRunId,
      }),
    ]),
  );
}
async function applyWorkflowResponse(
  response?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  if (!response.ok) throw Error(`${response.status} ${await response.text()}`);
  let json: Dynamic = await response.json();
  if (json.meta.status === `ok` && json.sync)
    for (let [
      applyWorkflowResponseResult,
      applyWorkflowResponseResult2,
    ] of Object.entries(json.changed) as Dynamic) {
      let atob2: Dynamic = Uint8Array.from(
        atob(applyWorkflowResponseResult2),
        (
          applyWorkflowResponse2?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic => applyWorkflowResponse2.charCodeAt(0),
      );
      await useWorkbookStore
        .getState()
        .swap(`${options}/${applyWorkflowResponseResult}`, atob2);
    }
  return json;
}
async function runWorkflowClient(
  runWorkflowClient2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  await useContainerStore.getState().forkIfLocked();
  let version: Dynamic = useContainerStore.getState().version;
  let runWorkflowClientResult: Dynamic = PlatformApiAndAuthState7(
    runWorkflowClient2,
    version,
  );
  let pop: Dynamic = runWorkflowClient2.split(`/`).pop();
  let body: Dynamic = new (FormData as Dynamic)();
  await appendWorkflowDirtyFiles(
    body,
    runWorkflowClientResult,
    context,
    dependencies,
  );
  let applyWorkflowResponse2: Dynamic = await applyWorkflowResponse(
    await fetch(
      resolvePlatformApiAndAuthValue(
        `/api/projects/${pop}/versions/${encodeURIComponent(version || `main`)}/workflows/${options}/run-scratch`,
      ),
      {
        method: `POST`,
        body: body,
      },
    ),
    runWorkflowClientResult,
  );
  if (applyWorkflowResponse2.meta.status === `error`) {
    let result: Dynamic = applyWorkflowResponse2.meta.result;
    if (result?.slug && result.code) {
      CommentsStoreHealth.getState().promptReconnect({
        slug: result.slug,
        name: CommentsStoreBigQuery[result.slug] ?? result.slug,
        code: result.code,
      });
    }
  }
  if (
    applyWorkflowResponse2.sync?.propagationError?.includes(
      OVERWRITE_GUARD_PREFIX,
    ) &&
    applyWorkflowResponse2.meta.status === `ok`
  ) {
    let trimmedReplaceAll: Dynamic =
      applyWorkflowResponse2.sync.propagationError
        .replaceAll(OVERWRITE_GUARD_PREFIX, ``)
        .trim();
    if (
      confirm(
        `Overwrite existing data?\n\n${trimmedReplaceAll}\n\nThis will replace those cells.`,
      )
    )
      return propagateWorkflowClient(
        runWorkflowClient2,
        options,
        context,
        dependencies,
        applyWorkflowResponse2.meta.id,
        true,
      );
  }
  return applyWorkflowResponse2;
}
async function propagateWorkflowClient(
  propagateWorkflowClient2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  dependencies?: Dynamic,
  argument?: Dynamic,
  argument2: Dynamic = false,
  ..._extraArguments: unknown[]
): Promise<Dynamic> {
  await useContainerStore.getState().forkIfLocked();
  let version: Dynamic = useContainerStore.getState().version;
  let propagateWorkflowClientResult: Dynamic = PlatformApiAndAuthState7(
    propagateWorkflowClient2,
    version,
  );
  let pop: Dynamic = propagateWorkflowClient2.split(`/`).pop();
  let body: Dynamic = new (FormData as Dynamic)();
  await appendWorkflowDirtyFiles(
    body,
    propagateWorkflowClientResult,
    context,
    dependencies,
  );
  body.set(`propagateOnly`, argument);
  if (argument2) {
    body.set(`confirmOverwrite`, `1`);
  }
  return applyWorkflowResponse(
    await fetch(
      resolvePlatformApiAndAuthValue(
        `/api/projects/${pop}/versions/${encodeURIComponent(version || `main`)}/workflows/${options}/run-scratch`,
      ),
      {
        method: `POST`,
        body: body,
      },
    ),
    propagateWorkflowClientResult,
  );
}
export {
  MAX_WIDGET_CODE_CHARACTERS,
  extractNamedReadSources,
  BLOB_SHA_PATTERN,
  previousVersionRevision,
  activityActorKey,
  createCommentAnchorRetryQueue,
  versionBlobReader,
  EMPTY_PREVIEW_COMMENTS,
  tryDetailedDiff,
  censusTotal,
  versionLoadErrorMessage,
  versionDiffPreviewHtml,
  collectManifestReferences,
  normalizeComparisonBase,
  stripMarkdownFrontmatter,
  getCachedVersionComparison,
  fileSnapshotKey,
  legacyDiffPreviewHtml,
  isPageActivityFresh,
  clearVersionComparisonCache,
  useFileSnapshot,
  compareVersionDocuments,
  saveTextFilesAndUploadOtherFiles,
  diffAnchorId,
  usePageActivity,
  mergePreviewSources,
  tryLoadManifestFilmBytes,
  publishPreviewDiffStats,
  loadManifestWidgetFilm,
  usePreviewCommentsStore,
  describeUncheckedDiffs,
  sanitizePreviewHtml,
  useFunctionRunStore,
  equalComparisonBases,
  useVersionHistoryPanelStore,
  diffHtml,
  usePageActivityStore,
  createClaudeSessionSender,
  clearVersionFaceCaches,
  censusWarnings,
  SIMPLER_COMPARISON_MESSAGE,
  isEmbedDiffError,
  fileAtUrl,
  versionDiffStatsSummary,
  activityActorKind,
  prewarmComparisonBase,
  useFileSnapshotStore,
  restoredVersionDetails,
  fetchVersionXml,
  resolveComparisonBase,
  fetchVersionPreviewDocs,
  restoredVersionSummary,
  versionXmlModule,
  ironScopeModule,
  getVersionReader,
  fillWidgetCodeSlots,
  readEmbedDeltas,
  parseCensusReport,
  loadVersionFace,
  findUnsupportedVisualizeFeature,
  serializeDiffEnums,
  reservedColumnNameMessage,
  MAX_DIFF_ROW_SPAN,
  mergeEmbedDeltasIntoDiff,
  hasTimeFormatSpecifier,
  MAX_DIFF_COLUMN_SPAN,
  shareDialogModule,
  parseVersionPreviewFace,
  spreadsheetPageModule,
  neighboringVersionRevisions,
  WIDGET_CODE_SLOT_ATTRIBUTE,
  readWidgetCodePair,
  previewSourcesEmptyMessage,
  loadManifestFilm,
  extractVisualizeSources,
  withManifestRedline,
  truncateColumnName,
  DIFF_ATTRIBUTE_NAMES,
  parseTimeFormat,
  getCachedVersionFace,
  doorCommentsModule,
  collectDiffEmbedReferences,
  proseMirrorCalloutKind,
  versionSequenceRange,
  validateNumberFormat,
  collectEmbedReferences,
  withVersionPreviewCss,
  linesStoreModule,
  sanitizePreviewDocument,
  createEmbedDeltaCache,
  createVisualizeHtmlCache,
  diffDocumentsAsync,
  workflowClientModule,
  renderUnavailableWidgetCodeDiff,
  isReservedColumnName,
  DIFF_MARK_TYPES,
  Workspace,
  prewarmVersionFaces,
  useCensusStore,
  loadProjectEnums,
  buildClaudeRequest,
  clearProjectEnumCache,
  unavailablePagesModule,
  fetchProjectEnums,
  comparisonBaseKey,
  useAttributionPanelEnabled,
};
