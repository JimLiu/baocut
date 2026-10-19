/** BaoCut: session navigation from index-CX4IZqzA.js. */
import type { Dynamic } from "../../interop/legacy-dynamic";
import {
  React,
  mapPreloadDependencies,
} from "../bootstrap";
import {
  Button,
  DisabledReasonTooltip,
  PlatformSyncAndRoutingAssign2,
  PlatformSyncAndRoutingState4,
  Tooltip,
  UiOverlaysAndIconsCustomIcon,
  cardDraftAtRisk,
  create,
  frameConversationPane,
  frameHostChromeWitnessed,
  getPlatformSyncAndRoutingValue,
  hostSays,
  isEditorExtensionsLocation,
  isEditorExtensionsValue,
  isFrameArtifact,
  isPlatformLiveDocumentAndHistoryKind,
  preloadModule,
  resolveCommentsEditorLabel,
  resolveCommentsEditorPostOrDiscardYourCommentFirst,
  resolveObservabilityBootChat,
  resolvePlatformChunkLoadingLazy,
  resolvePlatformChunkLoadingLazy3,
  resolvePlatformRuntimeAndChatCustomSize,
  resolvePlatformSyncAndRoutingCompact,
  useCommentStore,
  useThreads,
} from "../dependencies";
import {
  IconButton,
  runReviewModule,
} from "../run-review";
import {
  resolveCommentComponentsKey,
} from "../comment-components/state";
import {
  resolveSessionNavigationThen3,
} from "./create-file-placement-waiter";
import type * as ReactComponentTypes from "react";

export const LdocCommentsBtn: ReactComponentTypes.FC<Dynamic> = ({
  fileId: fileId,
  embed = false,
  narrow = false,
  blockedReason: blockedReason,
}) => {
  let mode: Dynamic = useCommentStore(
    (ldocCommentsBtn?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      ldocCommentsBtn.commentMode,
  );
  let Count: Dynamic = useThreads(fileId).length;
  let reason: Dynamic = PlatformSyncAndRoutingAssign2(
    (ldocCommentsBtn?: Dynamic, ..._extraArguments: unknown[]) =>
      isPlatformLiveDocumentAndHistoryKind(ldocCommentsBtn.preview, true).kind ===
      `pinned`,
  )
    ? `Comments aren't available for this view`
    : blockedReason;
  let ldocCommentsBtnResult = resolveCommentsEditorLabel({
    mode: mode,
    narrow: narrow,
  });
  let content = embed
    ? ldocCommentsBtnResult.label
    : mode === `list`
      ? `Floating comments`
      : mode === `hidden`
        ? `Show comments`
        : `All comments`;
  return (
    <DisabledReasonTooltip reason={reason}>
      <Tooltip content={content} side={embed ? `left` : undefined}>
        <IconButton
          data-testid={`ldoc-comments-btn`}
          aria-label={embed ? content : `Comments`}
          variant={`default`}
          size={28}
          disabled={reason !== undefined}
          onClick={(..._extraArguments: unknown[]): undefined => {
            let storeState: Dynamic = useCommentStore.getState();
            if (embed) {
              let { next: ldocCommentsBtnResult2 }: Dynamic = resolveCommentsEditorLabel({
                mode: storeState.commentMode,
                narrow: narrow,
              });
              if (ldocCommentsBtnResult2 === `hidden`) {
                storeState.setDraftAnchor(null);
                storeState.setDraftY(null);
              } else {
                if (ldocCommentsBtnResult2 === `list`) {
                  PlatformSyncAndRoutingState4.getState().set(false);
                  SessionNavigationPanel.getState().close();
                }
              }
              storeState.setCommentMode(ldocCommentsBtnResult2);
              if (!narrow) {
                resolveCommentComponentsKey(
                  document,
                  ldocCommentsBtnResult2 === `hidden` ? `hidden` : `shown`,
                );
              }
              return;
            }
            let label = storeState.commentMode === `margin` ? `list` : `margin`;
            storeState.setCommentMode(label);
            if (label === `list`) {
              PlatformSyncAndRoutingState4.getState().set(false);
              SessionNavigationPanel.getState().close();
            }
          }}
          icon={
            <span className={`relative inline-flex`}>
              <UiOverlaysAndIconsCustomIcon name={`Chat`} customSize={14} />
              {mode === `hidden` && Count > 0 && (
                <span
                  className={`bg-fill-primary text-on-primary absolute -top-1.5 -right-2 min-w-3.5 rounded-full px-1 text-center text-[9px] leading-[14px] font-medium`}
                >
                  {Count}
                </span>
              )}
            </span>
          }
        />
      </Tooltip>
    </DisabledReasonTooltip>
  );
};

export const RoomviewEmbedCommentsSeat: ReactComponentTypes.FC<Dynamic> = ({
  fileId: fileId,
}) => {
  let drafting: Dynamic = useCommentStore(
    (roomviewEmbedCommentsSeat?: Dynamic, ..._extraArguments: unknown[]) =>
      roomviewEmbedCommentsSeat.draftAnchor !== null ||
      cardDraftAtRisk(roomviewEmbedCommentsSeat),
  );
  let elementRef: Dynamic = (0, React.useRef)(null);
  let [narrow, setNarrow]: Dynamic = (0, React.useState)(false);
  (0, React.useEffect)((..._extraArguments: unknown[]): Dynamic => {
    let closest: Dynamic = elementRef.current?.closest(`[data-testid="roomview-embed"]`);
    if (!closest) return;
    let resizeObserver = new ResizeObserver(
      (
        [roomviewEmbedCommentsSeat]: Dynamic,
        ..._extraArguments: unknown[]
      ): undefined => {
        let matchesInlineSize =
          (roomviewEmbedCommentsSeat?.borderBoxSize?.[0]?.inlineSize ??
            closest.offsetWidth) <= 767;
        setNarrow(
          (
            roomviewEmbedCommentsSeat2?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic =>
            roomviewEmbedCommentsSeat2 === matchesInlineSize
              ? roomviewEmbedCommentsSeat2
              : matchesInlineSize,
        );
      },
    );
    resizeObserver.observe(closest);
    return (..._extraArguments: unknown[]) => resizeObserver.disconnect();
  }, []);
  return (
    <div ref={elementRef} className={`flex`} data-testid={`roomview-embed-comments-seat`}>
      <LdocCommentsBtn
        fileId={fileId}
        embed={true}
        narrow={narrow}
        blockedReason={
          resolveCommentsEditorPostOrDiscardYourCommentFirst({
            drafting: drafting,
          }) ?? undefined
        }
      />
    </div>
  );
};

export const HistoryRailUnavailable: ReactComponentTypes.FC<Dynamic> = ({
  besideBar: besideBar,
}) => {
  return (
    <div
      className={
        besideBar
          ? `bg-surface-panel text-secondary text-footnote flex h-full w-80 shrink-0 items-start border-l p-4`
          : `text-secondary text-footnote flex w-80 shrink-0 items-start border-l p-4`
      }
      data-testid={`history-rail-unavailable`}
    >
      {resolveSessionNavigationValue4(`version history`)}
    </div>
  );
};

export const RoutineEditorUnavailable: ReactComponentTypes.FC<unknown | undefined> = (
  routineEditorUnavailable,
) => {
  return (
    <div
      className={`text-muted text-body p-lg`}
      data-testid={`routine-editor-unavailable`}
    >
      {resolveSessionNavigationValue4(`this routine`)}
    </div>
  );
};

export const UseSessionNavigationWhatComponent: ReactComponentTypes.FC<Dynamic> = ({
  what: what,
  onClose: onClose,
  testId: testId,
}) => {
  let useSessionNavigationWhatResult: Dynamic = resolvePlatformSyncAndRoutingCompact();
  return (
    <div
      className={`bg-surface-popover border-strong text-secondary text-footnote z-popover rounded-card fixed top-1/3 left-1/2 flex w-max max-w-sm -translate-x-1/2 items-start gap-2 border p-3 shadow-xl`}
      role={`alertdialog`}
      data-testid={testId}
    >
      <span className={`min-w-0 flex-1`}>{resolveSessionNavigationValue4(what)}</span>
      {onClose && (
        <Button
          size={useSessionNavigationWhatResult(`sm`)}
          variant={`ghost`}
          onClick={onClose}
          aria-label={`Dismiss`}
        >
          <UiOverlaysAndIconsCustomIcon name={`X`} size={`xs`} />
        </Button>
      )}
    </div>
  );
};

var SessionNavigationDefault: Dynamic;

var SessionNavigationDefault2: Dynamic;

var SessionNavigationState4: Dynamic;

var SessionNavigationPanel: Dynamic;

var SessionNavigationNodeId: Dynamic;

var SessionNavigationThen: Dynamic;

var SessionNavigationThen2: Dynamic;

var SessionNavigationDefault3: Dynamic;

var SessionNavigationDefault4: Dynamic;

var resolveSessionNavigationMatches: Dynamic;

var resolveSessionNavigationClosest: Dynamic;

var sessionNavigationLimit20002: number;

var sessionNavigationLimit4: number;

var SessionNavigation_TheTabYouWereOnHasBeenDeletedOrIsNoLongerAvailable: string;

var resolveSessionNavigationValue4: (sessionNavigationValue4?: Dynamic, ..._extraArguments: unknown[]) => string;

function useSessionNavigationOpen(
  { open: open, onOpenChange: onOpenChange }: Dynamic,
  ..._extraArguments: unknown[]
) {
  return open ? (
    <UseSessionNavigationWhatComponent
      what={`the share dialog`}
      onClose={(..._extraArguments: unknown[]): Dynamic =>
        onOpenChange?.(false)
      }
      testId={`share-dialog-unavailable`}
    />
  ) : null;
}

function useSessionNavigationReview(
  { review: review, onClose: onClose }: Dynamic,
  ..._extraArguments: unknown[]
) {
  return review ? (
    <UseSessionNavigationWhatComponent
      what={`the review dialog`}
      onClose={onClose}
      testId={`approve-review-unavailable`}
    />
  ) : null;
}

var SessionNavigationThen3: Dynamic;

var resolveSessionNavigationValue5: Dynamic;

var SessionNavigationDocLanguageDialog: Dynamic;

var SessionNavigationThen4: Dynamic;

var SessionNavigationThen5: Dynamic;

var SessionNavigationRightRail: Dynamic;

function getSessionNavigationUnshift(
  sessionNavigationUnshift?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let getSessionNavigationUnshiftHandler: Dynamic = (
    sessionNavigationUnshift2?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let name: Dynamic = options.get(sessionNavigationUnshift2)?.name;
    return name !== undefined && name.length > 0 ? name : `Untitled`;
  };
  let items: Dynamic = [options.get(sessionNavigationUnshift)?.name ?? ``];
  let uniqueItems: Dynamic = new (Set as Dynamic)([sessionNavigationUnshift]);
  let getSessionNavigationUnshiftResult: Dynamic =
    getPlatformSyncAndRoutingValue(sessionNavigationUnshift, options);
  for (
    ;
    getSessionNavigationUnshiftResult !== undefined &&
    !uniqueItems.has(getSessionNavigationUnshiftResult);

  ) {
    uniqueItems.add(getSessionNavigationUnshiftResult);
    items.unshift(
      getSessionNavigationUnshiftHandler(getSessionNavigationUnshiftResult),
    );
    getSessionNavigationUnshiftResult = getPlatformSyncAndRoutingValue(
      getSessionNavigationUnshiftResult,
      options,
    );
  }
  return items.join(`/`);
}

function resolveSessionNavigationPath(
  sessionNavigationPath?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let items: Dynamic = [];
  for (let pageId of sessionNavigationPath.keys() as Dynamic)
    items.push({
      path: getSessionNavigationUnshift(pageId, sessionNavigationPath),
      size: 0,
      mtime: 0,
      pageId: pageId,
    });
  return items.toSorted(
    (item?: Dynamic, item2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      item.path.localeCompare(item2.path),
  );
}

var resolveSessionNavigationFrame2: Dynamic;

// BaoCut: called by docs-app-initialize in the recovered source order.
export function initializeSessionNavigationLdocCommentsBtnStep1(): void {
  resolvePlatformChunkLoadingLazy(
    (..._extraArguments: unknown[]): Dynamic =>
      resolveSessionNavigationThen3().then(
        (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
          default: result.SlidesEditor,
        }),
      ),
  );
  resolvePlatformChunkLoadingLazy(
    (..._extraArguments: unknown[]): Dynamic =>
      preloadModule(
        (..._extraArguments: unknown[]): Dynamic =>
          import("../../embedded-widgets/panel").then(
            (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
              default: result.WidgetPanel,
            }),
          ),
        mapPreloadDependencies([28, 1, 2, 6, 0, 3, 9, 10]),
        import.meta.url,
      ),
  );
  (SessionNavigationDefault = resolvePlatformChunkLoadingLazy(
    (..._extraArguments: unknown[]): Dynamic =>
      preloadModule(
        (..._extraArguments: unknown[]): Dynamic =>
          import("../../embedded-widgets/console-panel").then(
            (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
              default: result.WidgetConsolePanel,
            }),
          ),
        mapPreloadDependencies([27, 1, 6, 2, 0, 3, 28, 9, 10]),
        import.meta.url,
      ),
  ));
  (SessionNavigationDefault2 = resolvePlatformChunkLoadingLazy(
    (..._extraArguments: unknown[]): Dynamic =>
      preloadModule(
        (..._extraArguments: unknown[]): Dynamic =>
          import("../../embedded-widgets/console-panel").then(
            (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
              default: result.CodeModal,
            }),
          ),
        mapPreloadDependencies([27, 1, 6, 2, 0, 3, 28, 9, 10]),
        import.meta.url,
      ),
  ));
  resolvePlatformChunkLoadingLazy(
    (..._extraArguments: unknown[]): Dynamic =>
      preloadModule(
        (..._extraArguments: unknown[]): Dynamic =>
          import("../../markdown/code-viewer").then(
            (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
              default: result.CodeViewer,
            }),
          ),
        mapPreloadDependencies([37, 1, 0, 2, 3, 38, 39, 40, 7, 8]),
        import.meta.url,
      ),
  );
  (SessionNavigationState4 = resolvePlatformRuntimeAndChatCustomSize(`History`));
  (SessionNavigationPanel = create(
    (
      sessionNavigationPanel?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => ({
      panel: null,
      open: (
        nodeId?: Dynamic,
        tab?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic =>
        sessionNavigationPanel({
          panel: {
            nodeId: nodeId,
            tab: tab,
          },
        }),
      setTab: (tab?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        sessionNavigationPanel(
          (
            sessionNavigationPanel2?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic =>
            sessionNavigationPanel2.panel
              ? {
                  panel: {
                    ...sessionNavigationPanel2.panel,
                    tab: tab,
                  },
                }
              : sessionNavigationPanel2,
        ),
      close: (..._extraArguments: unknown[]): Dynamic =>
        sessionNavigationPanel({
          panel: null,
        }),
    }),
  ));
  (SessionNavigationNodeId = create(
    (
      sessionNavigationNodeId?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => ({
      nodeId: null,
      open: (nodeId?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        sessionNavigationNodeId({
          nodeId: nodeId,
        }),
      close: (..._extraArguments: unknown[]): Dynamic =>
        sessionNavigationNodeId({
          nodeId: null,
        }),
    }),
  ));
  (SessionNavigationThen = resolvePlatformChunkLoadingLazy3(
    (..._extraArguments: unknown[]): Dynamic =>
      preloadModule(
        (..._extraArguments: unknown[]): Dynamic =>
          import("../../platform/index").then(
            (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              result.PlatformSyncAndRoutingChatRow,
          ),
        mapPreloadDependencies([0, 1, 2, 3]),
        import.meta.url,
      ),
    (sessionNavigationThen?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      sessionNavigationThen.default,
  ));
  (SessionNavigationThen2 = resolvePlatformChunkLoadingLazy3(
    (..._extraArguments: unknown[]): Dynamic =>
      preloadModule(
        (..._extraArguments: unknown[]): Dynamic =>
          import("../../platform/lazy").then(
            (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              result.spreadsheetPageModule,
          ),
        mapPreloadDependencies([10, 1, 2, 0, 3]),
        import.meta.url,
      ),
    (sessionNavigationThen2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      sessionNavigationThen2.default,
  ));
  (SessionNavigationDefault3 = resolvePlatformChunkLoadingLazy3(
    (..._extraArguments: unknown[]): Dynamic =>
      preloadModule(
        (..._extraArguments: unknown[]): Dynamic =>
          import("../../document-history/preview-pane"),
        mapPreloadDependencies([41, 1, 2, 6, 0, 3, 42, 43, 9, 10]),
        import.meta.url,
      ),
    (
      sessionNavigationDefault3?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => sessionNavigationDefault3.VersionPreviewPane,
  ));
  (SessionNavigationDefault4 = resolvePlatformChunkLoadingLazy3(
    (..._extraArguments: unknown[]): Dynamic =>
      preloadModule(
        (..._extraArguments: unknown[]): Dynamic => import("../../document-tabs/tab-picture-layer"),
        mapPreloadDependencies([44, 1, 2, 0, 3, 9, 43, 10]),
        import.meta.url,
      ),
    (
      sessionNavigationDefault4?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => sessionNavigationDefault4.TabPictureLayer,
  ));
  (resolveSessionNavigationMatches = (
    ..._extraArguments: unknown[]
  ) => typeof matchMedia == `function` && matchMedia(`(pointer: fine)`).matches);
  (resolveSessionNavigationClosest = (
    sessionNavigationClosest?: Dynamic,
    ..._extraArguments: unknown[]
  ) =>
    sessionNavigationClosest instanceof Element
      ? (sessionNavigationClosest
          .closest(`[data-tab-row]`)
          ?.getAttribute(`data-tab-row`) ?? null)
      : null);
  (sessionNavigationLimit20002 = 2e3);
  (sessionNavigationLimit4 = 4);
  (SessionNavigation_TheTabYouWereOnHasBeenDeletedOrIsNoLongerAvailable = `The tab you were on has been deleted or is no longer available.`);
  (resolveSessionNavigationValue4 = (
    sessionNavigationValue4?: Dynamic,
    ..._extraArguments: unknown[]
  ) =>
    `Couldn\u2019t load ${sessionNavigationValue4} \u2014 refresh the page to try again.`);
  (SessionNavigationThen3 = resolvePlatformChunkLoadingLazy3(
    (..._extraArguments: unknown[]): Dynamic =>
      preloadModule(
        (..._extraArguments: unknown[]): Dynamic =>
          import("../../platform/lazy").then(
            (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              result.shareDialogModule,
          ),
        mapPreloadDependencies([10, 1, 2, 0, 3]),
        import.meta.url,
      ),
    (sessionNavigationThen3?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      sessionNavigationThen3.ShareDialog,
    useSessionNavigationOpen,
  ));
  (resolveSessionNavigationValue5 = (
    ..._extraArguments: unknown[]
  ): Dynamic =>
    preloadModule(
      (..._extraArguments: unknown[]): Dynamic => import("../formatting/language-dialog"),
      mapPreloadDependencies([45, 1, 6, 2, 0, 3]),
      import.meta.url,
    ));
  (SessionNavigationDocLanguageDialog = resolvePlatformChunkLoadingLazy3(
      resolveSessionNavigationValue5,
      (
        sessionNavigationDocLanguageDialog?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => sessionNavigationDocLanguageDialog.DocLanguageDialog,
    ));
  (SessionNavigationThen4 = resolvePlatformChunkLoadingLazy3(
    (..._extraArguments: unknown[]): Dynamic =>
      preloadModule(
        (..._extraArguments: unknown[]): Dynamic =>
          Promise.resolve().then(
            (..._extraArguments: unknown[]): Dynamic => runReviewModule,
          ),
        undefined,
        import.meta.url,
      ),
    (sessionNavigationThen4?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      sessionNavigationThen4.ApproveReviewDialog,
    useSessionNavigationReview,
  ));
  (SessionNavigationThen5 = resolvePlatformChunkLoadingLazy3(
    (..._extraArguments: unknown[]): Dynamic =>
      preloadModule(
        (..._extraArguments: unknown[]): Dynamic =>
          import("../../platform/index").then(
            (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              result.PlatformApiAndAuthCodeModal,
          ),
        mapPreloadDependencies([0, 1, 2, 3]),
        import.meta.url,
      ),
    (sessionNavigationThen5?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      sessionNavigationThen5.RoutineEditor,
    RoutineEditorUnavailable,
  ));
  (SessionNavigationRightRail = resolvePlatformChunkLoadingLazy3(
    (..._extraArguments: unknown[]): Dynamic =>
      preloadModule(
        (..._extraArguments: unknown[]): Dynamic => import("../../comments/right-rail"),
        mapPreloadDependencies([46, 1, 2, 6, 0, 3, 42, 10]),
        import.meta.url,
      ),
    (
      sessionNavigationRightRail?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => sessionNavigationRightRail.RightRail,
    HistoryRailUnavailable,
  ));
  (resolveSessionNavigationFrame2 = (..._extraArguments: unknown[]) =>
    resolveObservabilityBootChat({
      frame: isFrameArtifact(),
      shell: isEditorExtensionsValue(),
      hostPane: isEditorExtensionsLocation(),
      poked: frameHostChromeWitnessed(),
      pane: frameConversationPane(),
      chatBeside: hostSays(`chat_beside`),
    }));
}

export { SessionNavigationDefault, SessionNavigationDefault2, SessionNavigationDefault3, SessionNavigationDefault4, SessionNavigationDocLanguageDialog, SessionNavigationNodeId, SessionNavigationPanel, SessionNavigationRightRail, SessionNavigationState4, SessionNavigationThen, SessionNavigationThen2, SessionNavigationThen3, SessionNavigationThen4, SessionNavigationThen5, SessionNavigation_TheTabYouWereOnHasBeenDeletedOrIsNoLongerAvailable, resolveSessionNavigationClosest, resolveSessionNavigationFrame2, resolveSessionNavigationMatches, resolveSessionNavigationPath, resolveSessionNavigationValue5, sessionNavigationLimit20002, sessionNavigationLimit4 };
