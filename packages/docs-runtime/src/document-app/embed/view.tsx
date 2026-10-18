import { jsx as renderReactJsx } from "react/jsx-runtime";
// BaoCut: extracted embed view callbacks; state stays with the component.
import type { Dynamic } from "../../interop/legacy-dynamic";

export interface RenderRoomViewEmbedPageViewContext {
  ApplicationRoutesSet: Dynamic;
  Button: Dynamic;
  ChatPill: Dynamic;
  DOCUMENT_LANGUAGE_COPY: Dynamic;
  DataModelSchemasDragging2: Dynamic;
  DebugReportFloatingButton: Dynamic;
  DocFontControlGate: Dynamic;
  DocLayoutControlGate: Dynamic;
  DocumentPostureBadge: Dynamic;
  FileTabNavigation: Dynamic;
  FilmedProsePage: Dynamic;
  FrameUnavailable: Dynamic;
  HeaderPath: Dynamic;
  HistoryRailToggle: Dynamic;
  HomeButton: Dynamic;
  IconButton: Dynamic;
  KeyboardHelpDialog: Dynamic;
  LanguagePickerSkeleton: Dynamic;
  LdocCommentsBtn: Dynamic;
  MemoizedTabRail: Dynamic;
  PageLoadingFace: Dynamic;
  PageSkillBulbGate: Dynamic;
  Pagebar: Dynamic;
  PagebarImageInput: Dynamic;
  ProjectDoorProvider: Dynamic;
  React: Dynamic;
  ResolvePlatformSyncAndRoutingValue18Component: Dynamic;
  RoomDeniedScreen: Dynamic;
  RoomSigninFace: Dynamic;
  RoomviewAuthorityFailed: Dynamic;
  RoomviewEmbedCommentsSeat: Dynamic;
  RoomviewFrameToolbar: Dynamic;
  RouteErrorBoundary: Dynamic;
  RoutinePage: Dynamic;
  RoutinesDialog: Dynamic;
  SessionNavigationDefault4: Dynamic;
  SessionNavigationDocLanguageDialog: Dynamic;
  SessionNavigationThen3: Dynamic;
  TabsLeftListGate: Dynamic;
  Tooltip: Dynamic;
  UiDialogsRoot: Dynamic;
  UiOverlaysAndIconsCustomIcon: Dynamic;
  UseApplicationRootHasFilesComponent: Dynamic;
  UseDocumentHostStateParticipantsComponent: Dynamic;
  UseDocumentPreviewUseLayoutEffectComponent: Dynamic;
  bar: Dynamic;
  bar2: Dynamic;
  chipNav: Dynamic;
  className: Dynamic;
  container2: Dynamic;
  contentPending: Dynamic;
  denied: Dynamic;
  displayName: Dynamic;
  docked: Dynamic;
  documentPreviewCaption: Dynamic;
  documentPreviewChromeShown: Dynamic;
  documentPreviewKey: Dynamic;
  documentScrollKey: Dynamic;
  documentTabsFormat: Dynamic;
  edgeMinLeft: Dynamic;
  elementRef3: Dynamic;
  enabled: Dynamic;
  enabledState3: Dynamic;
  enabledState4: Dynamic;
  enabledState5: Dynamic;
  faceUp: Dynamic;
  failed: Dynamic;
  failed2: Dynamic;
  feed: Dynamic;
  filePath: Dynamic;
  following: Dynamic;
  frame: Dynamic;
  frameSignInHref: Dynamic;
  getDocumentScroll: Dynamic;
  gone: Dynamic;
  homeOffered: Dynamic;
  hostCommentOffered: Dynamic;
  image: Dynamic;
  initialFocus: Dynamic;
  inputRef: Dynamic;
  isTabsLocationFeatureEnabled2: Dynamic;
  join2: Dynamic;
  jsxRuntime: Dynamic;
  kind2: Dynamic;
  liveSupportCode: Dynamic;
  matchShell: Dynamic;
  measureKey: Dynamic;
  memoized: Dynamic;
  memoized5: Dynamic;
  memoized7: Dynamic;
  navigate: Dynamic;
  nodeId: Dynamic;
  objectFiles: Dynamic;
  onDocFont: Dynamic;
  onDocLanguage: Dynamic;
  onDrillChange: Dynamic;
  onEscapeToChrome: Dynamic;
  onFirstHeading: Dynamic;
  onFollow: Dynamic;
  onHeadKind: Dynamic;
  onJumpHeading: Dynamic;
  onLeft: Dynamic;
  onLost: Dynamic;
  onOpenChange: Dynamic;
  onOpenChange2: Dynamic;
  onOpenFile: Dynamic;
  onOpenFile2: Dynamic;
  onOpenSources: Dynamic;
  onPage: Dynamic;
  onPageGone: Dynamic;
  onPageSkill: Dynamic;
  onPanelOpen: Dynamic;
  onRailInSlot: Dynamic;
  onRenamed: Dynamic;
  onRenaming: Dynamic;
  onSelect: Dynamic;
  onShown: Dynamic;
  onSurfaceKind: Dynamic;
  onTabGone: Dynamic;
  onTitleCommit: Dynamic;
  onUp: Dynamic;
  onUserNavigate: Dynamic;
  onViewOnly: Dynamic;
  onVisualize: Dynamic;
  open: Dynamic;

  outlineFeed: Dynamic;
  outlineJump: Dynamic;
  outlineWanted: Dynamic;
  page2: Dynamic;
  participants: Dynamic;
  pid2: Dynamic;
  pid3: Dynamic;
  place: Dynamic;
  placement: Dynamic;
  posture: Dynamic;
  posture2: Dynamic;
  presence: Dynamic;
  previewUp: Dynamic;
  previewUpRef: Dynamic;
  projectName2: Dynamic;
  proseSurface: Dynamic;
  railSlot: Dynamic;
  readOnly: Dynamic;
  readOnly2: Dynamic;
  reason: Dynamic;
  resolveDataContentAndReferencesKind2: Dynamic;
  resolveSessionNavigationClosest: Dynamic;
  room: Dynamic;
  roomViewEmbedPageResult: Dynamic;
  roomViewEmbedPageResult13: Dynamic;
  roomViewEmbedPageResult15: Dynamic;
  roomViewEmbedPageResult16: Dynamic;
  roomViewEmbedPageResult17: Dynamic;
  roomViewEmbedPageResult18: Dynamic;
  roomViewEmbedPageResult20: Dynamic;
  roomViewEmbedPageResult3: Dynamic;
  roomViewEmbedPageResult31: Dynamic;
  roomViewEmbedPageResult32: Dynamic;
  roomViewEmbedPageResult4: Dynamic;
  roomViewEmbedPageState: Dynamic;
  roomViewEmbedPageState13: Dynamic;
  roomViewEmbedPageState7: Dynamic;
  roomViewEmbedPageState9: Dynamic;
  routineId: Dynamic;
  seat: Dynamic;
  seat2: Dynamic;
  seat3: Dynamic;
  seat4: Dynamic;
  seats: Dynamic;
  send: Dynamic;
  send2: Dynamic;
  send3: Dynamic;
  setRailSlot: Dynamic;
  setRoomViewEmbedPageState2: Dynamic;
  setRoomViewEmbedPageState3: Dynamic;
  setRoomViewEmbedPageState5: Dynamic;
  snapshotHead: Dynamic;
  snapshotReady: Dynamic;
  tabNames: Dynamic;
  tabsOnPage: Dynamic;
  tabsSidebarDrawingState2: Dynamic;
  tooLarge: Dynamic;
  triggerHidden: Dynamic;
  useDocumentPreviewShown2: Dynamic;
  useDocumentPreviewState2: Dynamic;
  usePageSkillSeat2: Dynamic;
  useStableDocumentIdentity2: Dynamic;
  version: Dynamic;
  versionHistoryOffered: Dynamic;
  versionHistoryV2: Dynamic;
  viewerReadOnly: Dynamic;
  zIndex: Dynamic;
  zIndex2: Dynamic;
}

export function renderRoomViewEmbedPageView(embedPageLiveContext: RenderRoomViewEmbedPageViewContext): Dynamic {
  return (embedPageLiveContext.enabled ? (
    <embedPageLiveContext.ProjectDoorProvider pid={embedPageLiveContext.pid3}>
      <div
        data-testid={`roomview-embed`}
        className={`bg-surface-popover dark:bg-surface-0 flex h-full flex-col`}
      >
        <embedPageLiveContext.DataModelSchemasDragging2 />
        <div
          data-testid={`roomview-embed-header`}
          className={`flex h-12 shrink-0 items-center gap-2 border-b px-3`}
        >
          {embedPageLiveContext.denied ? (
            <div className={`min-w-0 flex-1`} />
          ) : (
            <embedPageLiveContext.jsxRuntime.Fragment>
              <div className={`flex min-w-0 flex-1 items-center`}>
                <embedPageLiveContext.HeaderPath
                  pid={embedPageLiveContext.pid2}
                  door={embedPageLiveContext.pid3 ? embedPageLiveContext.memoized : undefined}
                  projectName={embedPageLiveContext.projectName2}
                  fileId={embedPageLiveContext.nodeId}
                  proseSurface={embedPageLiveContext.proseSurface}
                  routineId={embedPageLiveContext.routineId}
                  onRenamed={embedPageLiveContext.onRenamed}
                  version={embedPageLiveContext.version}
                  navigate={embedPageLiveContext.navigate}
                  onOpenSources={embedPageLiveContext.onOpenSources}
                  embed={true}
                  // BaoCut: 项目菜单的「Version history」经 docs-host.ts 的 versionHistoryOffered 开关。
                  historyOffered={!embedPageLiveContext.viewerReadOnly && (0, embedPageLiveContext.versionHistoryOffered)()}
                />
                {embedPageLiveContext.readOnly2 && (
                  <embedPageLiveContext.DocumentPostureBadge
                    className={`ml-2`}
                    posture={embedPageLiveContext.posture2}
                    reason={embedPageLiveContext.reason}
                  />
                )}
              </div>
              {embedPageLiveContext.nodeId && embedPageLiveContext.proseSurface && (
                <embedPageLiveContext.RoomviewEmbedCommentsSeat fileId={embedPageLiveContext.nodeId} />
              )}
              <embedPageLiveContext.UseDocumentHostStateParticipantsComponent
                participants={embedPageLiveContext.participants}
                following={embedPageLiveContext.following}
                onFollow={embedPageLiveContext.onFollow}
                showSelf={true}
                restingClaude={true}
              />
              <embedPageLiveContext.Button
                variant={`secondary`}
                size={(0, embedPageLiveContext.roomViewEmbedPageResult)(`sm`)}
                data-testid={`share-btn`}
                disabled={!embedPageLiveContext.pid3}
                disabledReason={
                  embedPageLiveContext.failed ? `Couldn't load project` : `Loading project…`
                }
                disabledReasonSide={`bottom`}
                onClick={(..._extraArguments: unknown[]): Dynamic =>
                  (0, embedPageLiveContext.onOpenChange)(true)
                }
              >{`Share`}</embedPageLiveContext.Button>
            </embedPageLiveContext.jsxRuntime.Fragment>
          )}
          {embedPageLiveContext.roomViewEmbedPageResult20 && (
            <embedPageLiveContext.Tooltip content={`Close`} side={`bottom`}>
              <embedPageLiveContext.IconButton
                data-testid={`embed-close-btn`}
                aria-label={`Close`}
                variant={`ghost`}
                size={28}
                onClick={(
                  event?: Dynamic,
                  ..._extraArguments: unknown[]
                ): Dynamic => (0, embedPageLiveContext.roomViewEmbedPageResult20)(event.nativeEvent)}
                icon={
                  <embedPageLiveContext.UiOverlaysAndIconsCustomIcon name={`X`} customSize={14} />
                }
              />
            </embedPageLiveContext.Tooltip>
          )}
        </div>
        <div className={`relative min-h-0 flex-1 overflow-hidden`}>
          {embedPageLiveContext.denied ? (
            <embedPageLiveContext.RoomDeniedScreen
              goHome={embedPageLiveContext.roomViewEmbedPageResult20 === null}
              gone={embedPageLiveContext.gone}
              tooLarge={embedPageLiveContext.tooLarge}
              pid={embedPageLiveContext.pid2}
            />
          ) : embedPageLiveContext.failed2 ? (
            <embedPageLiveContext.RoomSigninFace
              signInHref={(0, embedPageLiveContext.frameSignInHref)()}
              supportCode={(0, embedPageLiveContext.liveSupportCode)()}
            />
          ) : embedPageLiveContext.failed ? (
            <embedPageLiveContext.RoomviewAuthorityFailed
              onRetry={embedPageLiveContext.onRenamed}
              message={embedPageLiveContext.page2.message}
              supportCode={embedPageLiveContext.frame ? (0, embedPageLiveContext.liveSupportCode)() : undefined}
            />
          ) : embedPageLiveContext.roomViewEmbedPageResult15 ? (
            <div
              className={`text-footnote text-secondary border-strong p-sm relative z-20 border-b`}
              data-testid={`roomview-reconnecting`}
              role={`status`}
            >{`Reconnecting…`}</div>
          ) : null}
          {embedPageLiveContext.contentPending && !embedPageLiveContext.failed && !embedPageLiveContext.denied && (
            <div
              className={`text-muted flex h-full flex-col items-center justify-center`}
            >
              <embedPageLiveContext.UiOverlaysAndIconsCustomIcon
                name={`Spinner`}
                size={`md`}
                bold={true}
                className={`animate-spin`}
              />
            </div>
          )}
          {embedPageLiveContext.pid3 ? (
            embedPageLiveContext.routineId && embedPageLiveContext.frame ? (
              <embedPageLiveContext.FrameUnavailable what={`Routines`} />
            ) : embedPageLiveContext.routineId ? (
              <embedPageLiveContext.RoutinePage
                pid={embedPageLiveContext.pid2}
                routineId={embedPageLiveContext.routineId}
                version={embedPageLiveContext.version}
                key={`${embedPageLiveContext.pid2}/${embedPageLiveContext.routineId}`}
              />
            ) : embedPageLiveContext.seat2 && embedPageLiveContext.room ? (
              <embedPageLiveContext.FilmedProsePage
                room={embedPageLiveContext.room}
                pid={embedPageLiveContext.seat2.pid}
                fileId={embedPageLiveContext.seat2.fileId}
                snapshotHead={embedPageLiveContext.snapshotHead}
                snapshotReady={embedPageLiveContext.snapshotReady}
                displayName={embedPageLiveContext.displayName}
                version={embedPageLiveContext.seat2.version}
                objectFiles={embedPageLiveContext.objectFiles}
                tabNames={embedPageLiveContext.tabNames}
                onSurfaceKind={embedPageLiveContext.onSurfaceKind}
                onHeadKind={embedPageLiveContext.onHeadKind}
                onLeaveProbe={embedPageLiveContext.useDocumentPreviewShown2.onProbe}
                leaving={embedPageLiveContext.useDocumentPreviewShown2.held}
                onViewOnly={embedPageLiveContext.onViewOnly}
                onPageGone={embedPageLiveContext.onPageGone}
                onTabGone={embedPageLiveContext.onTabGone}
                onEscapeToChrome={embedPageLiveContext.onEscapeToChrome}
                onHistoryLeave={embedPageLiveContext.documentTabsFormat.refocusEditor}
                onTitleCommit={embedPageLiveContext.onTitleCommit}
                onFirstHeading={embedPageLiveContext.onFirstHeading}
                readOnly={embedPageLiveContext.viewerReadOnly}
                placement={embedPageLiveContext.placement}
                onOpenFile={embedPageLiveContext.onOpenFile2}
                embed={true}
                bornHere={embedPageLiveContext.roomViewEmbedPageState13 === embedPageLiveContext.pid2}
                hostCommentOffered={embedPageLiveContext.hostCommentOffered}
                key={(0, embedPageLiveContext.documentPreviewKey)(embedPageLiveContext.seat2.pid, embedPageLiveContext.seat2.fileId, embedPageLiveContext.seat2.version)}
              />
            ) : embedPageLiveContext.contentPending ? null : (
              <embedPageLiveContext.UseApplicationRootHasFilesComponent
                hasFiles={embedPageLiveContext.objectFiles.length > 0}
              />
            )
          ) : null}
          {embedPageLiveContext.useDocumentPreviewState2 && <embedPageLiveContext.PageLoadingFace matchShell={false} />}
          {embedPageLiveContext.pid3 && !embedPageLiveContext.denied && !embedPageLiveContext.failed && (
            <div
              className={`bg-surface-popover absolute top-3 left-3 z-10 rounded-lg shadow-sm`}
              data-testid={`roomview-embed-tabs`}
            >
              <div
                className={`bg-fill-secondary flex items-center rounded-lg border`}
              >
                <embedPageLiveContext.MemoizedTabRail
                  pid={embedPageLiveContext.pid2}
                  activeId={embedPageLiveContext.nodeId}
                  pageName={embedPageLiveContext.roomViewEmbedPageResult18?.name}
                  version={embedPageLiveContext.version}
                  room={embedPageLiveContext.room}
                  presence={embedPageLiveContext.presence}
                  onNavigate={embedPageLiveContext.onOpenFile2}
                  readOnly={embedPageLiveContext.readOnly}
                  onPageSkill={embedPageLiveContext.onPageSkill}
                  onDocFont={embedPageLiveContext.onDocFont}
                  onDocLanguage={embedPageLiveContext.onDocLanguage}
                  key={embedPageLiveContext.pid2}
                />
                <embedPageLiveContext.PageSkillBulbGate seat={embedPageLiveContext.seat3} />
              </div>
            </div>
          )}
        </div>
        {embedPageLiveContext.pid3 && embedPageLiveContext.roomViewEmbedPageResult3 && (
          <embedPageLiveContext.React.Suspense fallback={null}>
            <embedPageLiveContext.SessionNavigationThen3
              name={embedPageLiveContext.pid2}
              displayName={embedPageLiveContext.roomViewEmbedPageResult18?.name ?? embedPageLiveContext.pid2}
              filePath={embedPageLiveContext.filePath}
              pid={embedPageLiveContext.pid2}
              pageId={embedPageLiveContext.nodeId}
              v3Ref={
                embedPageLiveContext.routineId
                  ? {
                      noun: `routine`,
                      id: embedPageLiveContext.routineId,
                    }
                  : undefined
              }
              doorPid={embedPageLiveContext.pid2}
              v3Container={embedPageLiveContext.container2}
              open={embedPageLiveContext.open}
              onOpenChange={embedPageLiveContext.onOpenChange}
            />
          </embedPageLiveContext.React.Suspense>
        )}
        <embedPageLiveContext.DebugReportFloatingButton />
        <embedPageLiveContext.KeyboardHelpDialog />
      </div>
    </embedPageLiveContext.ProjectDoorProvider>
  ) : (
    <embedPageLiveContext.ProjectDoorProvider pid={embedPageLiveContext.pid3}>
      <div className={`bg-surface-0 relative flex h-full flex-col`}>
        <embedPageLiveContext.DataModelSchemasDragging2 />
        <div className={`flex min-h-0 flex-1 overflow-hidden`}>
          {!embedPageLiveContext.frame && (
            <embedPageLiveContext.ChatPill
              pid={embedPageLiveContext.pid3}
              currentFile={
                embedPageLiveContext.nodeId && embedPageLiveContext.filePath
                  ? {
                      id: embedPageLiveContext.nodeId,
                      path: embedPageLiveContext.filePath,
                    }
                  : undefined
              }
            />
          )}
          <embedPageLiveContext.RoutinesDialog
            open={embedPageLiveContext.memoized7 !== null}
            onOpenChange={(
              roomViewEmbedPage?: Dynamic,
              ..._extraArguments: unknown[]
            ): undefined => {
              if (!roomViewEmbedPage) {
                (0, embedPageLiveContext.join2)();
              }
            }}
            pid={embedPageLiveContext.pid2}
            version={embedPageLiveContext.version}
            drill={
              embedPageLiveContext.memoized7 ?? {
                kind: `routines`,
              }
            }
            drillSeq={`${embedPageLiveContext.memoized5 ?? ``}|${embedPageLiveContext.kind2 ?? ``}`}
            onDrillChange={embedPageLiveContext.onDrillChange}
            onVisualize={embedPageLiveContext.onVisualize}
          />
          <div
            role={`main`}
            className={
              embedPageLiveContext.frame
                ? `flex min-w-0 flex-1 flex-col overflow-hidden`
                : `flex min-w-0 flex-1 flex-col overflow-hidden md:gap-1.5 md:overflow-visible md:px-5 md:pt-3 md:pb-0`
            }
          >
            {!embedPageLiveContext.frame && (
              <embedPageLiveContext.FileTabNavigation
                tray={{
                  leading: (
                    <div className={`mr-1 flex shrink-0 items-center gap-1.5`}>
                      {/* BaoCut: 独立页面没有项目列表首页（docs-host.ts 的 homeOffered），不显示 Home 按钮。 */}
                      {(0, embedPageLiveContext.homeOffered)() && (
                        <div
                          className={`bg-fill-secondary flex items-center rounded-lg border`}
                        >
                          <embedPageLiveContext.HomeButton boxed={true} />
                        </div>
                      )}
                      <div
                        className={`bg-fill-secondary flex items-center rounded-lg border`}
                      >
                        <embedPageLiveContext.MemoizedTabRail
                          pid={embedPageLiveContext.pid2}
                          activeId={embedPageLiveContext.nodeId}
                          pageName={embedPageLiveContext.roomViewEmbedPageResult18?.name}
                          version={embedPageLiveContext.version}
                          room={embedPageLiveContext.room}
                          presence={embedPageLiveContext.presence}
                          onPageSkill={embedPageLiveContext.onPageSkill}
                          onDocFont={embedPageLiveContext.onDocFont}
                          onDocLanguage={embedPageLiveContext.onDocLanguage}
                          key={embedPageLiveContext.pid2}
                        />
                        <embedPageLiveContext.PageSkillBulbGate seat={embedPageLiveContext.seat3} />
                      </div>
                    </div>
                  ),
                  trailing: (
                    <div className={`ml-1 flex shrink-0 items-center gap-1.5`}>
                      {embedPageLiveContext.enabledState5 && (
                        <div
                          className={`bg-fill-secondary flex items-center rounded-lg border`}
                        >
                          <embedPageLiveContext.Tooltip
                            content={`Routines & databases`}
                            side={`left`}
                          >
                            <button
                              type={`button`}
                              aria-label={`Routines & databases`}
                              data-testid={`sources-pill`}
                              className={`text-primary hover:bg-alpha-1 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors`}
                              onClick={(
                                ..._extraArguments: unknown[]
                              ): Dynamic =>
                                (0, embedPageLiveContext.onOpenSources)({
                                  kind: `routines`,
                                })
                              }
                            >
                              <embedPageLiveContext.UiOverlaysAndIconsCustomIcon
                                name={`Lightning`}
                                size={`sm`}
                              />
                            </button>
                          </embedPageLiveContext.Tooltip>
                        </div>
                      )}
                    </div>
                  ),
                  path: (
                    <embedPageLiveContext.jsxRuntime.Fragment>
                      <embedPageLiveContext.HeaderPath
                        pid={embedPageLiveContext.pid2}
                        door={embedPageLiveContext.pid3 ? embedPageLiveContext.memoized : undefined}
                        projectName={embedPageLiveContext.projectName2}
                        fileId={embedPageLiveContext.nodeId}
                        proseSurface={embedPageLiveContext.proseSurface}
                        routineId={embedPageLiveContext.routineId}
                        onRenamed={embedPageLiveContext.onRenamed}
                        version={embedPageLiveContext.version}
                        navigate={embedPageLiveContext.navigate}
                        onOpenSources={embedPageLiveContext.onOpenSources}
                      />
                      {embedPageLiveContext.readOnly2 && (
                        <embedPageLiveContext.DocumentPostureBadge
                          className={`ml-2`}
                          posture={embedPageLiveContext.posture2}
                          reason={embedPageLiveContext.reason}
                        />
                      )}
                    </embedPageLiveContext.jsxRuntime.Fragment>
                  ),
                }}
                tabs={[]}
                active={embedPageLiveContext.filePath}
                entries={embedPageLiveContext.objectFiles}
                onSelect={embedPageLiveContext.onSelect}
                onClose={(..._extraArguments: unknown[]): undefined => {}}
                onSelectFilesDashboard={(
                  ..._extraArguments: unknown[]
                ): Dynamic =>
                  (0, embedPageLiveContext.navigate)((0, embedPageLiveContext.resolveDataContentAndReferencesKind2)(embedPageLiveContext.container2))
                }
                elevated={true}
                cosMember={false}
                actions={
                  <embedPageLiveContext.jsxRuntime.Fragment>
                    <embedPageLiveContext.UseDocumentHostStateParticipantsComponent
                      participants={embedPageLiveContext.participants}
                      following={embedPageLiveContext.following}
                      onFollow={embedPageLiveContext.onFollow}
                    />
                    {embedPageLiveContext.nodeId && embedPageLiveContext.proseSurface && (
                      <embedPageLiveContext.LdocCommentsBtn fileId={embedPageLiveContext.nodeId} />
                    )}
                    {/* BaoCut: History 按钮经 docs-host.ts 的 versionHistoryOffered 开关。 */}
                    {embedPageLiveContext.nodeId && !embedPageLiveContext.viewerReadOnly && (0, embedPageLiveContext.versionHistoryOffered)() && (
                      <embedPageLiveContext.HistoryRailToggle />
                    )}
                    <embedPageLiveContext.Button
                      variant={`primary`}
                      size={(0, embedPageLiveContext.roomViewEmbedPageResult)(`sm`)}
                      data-testid={`share-btn`}
                      disabled={!embedPageLiveContext.pid3}
                      disabledReason={
                        embedPageLiveContext.failed ? `Couldn't load project` : `Loading project…`
                      }
                      disabledReasonSide={`bottom`}
                      onClick={(..._extraArguments: unknown[]): Dynamic =>
                        (0, embedPageLiveContext.onOpenChange)(true)
                      }
                    >{`Share`}</embedPageLiveContext.Button>
                    <embedPageLiveContext.ResolvePlatformSyncAndRoutingValue18Component
                      me={embedPageLiveContext.roomViewEmbedPageResult4}
                      hideRoutinesPanel={true}
                    />
                  </embedPageLiveContext.jsxRuntime.Fragment>
                }
              />
            )}
            <div
              className={embedPageLiveContext.className}
              style={
                embedPageLiveContext.enabledState4
                  ? {
                      paddingRight: 320,
                    }
                  : undefined
              }
            >
              {embedPageLiveContext.bar && (
                <div
                  className={`relative shrink-0`}
                  style={{
                    zIndex: embedPageLiveContext.zIndex,
                  }}
                  data-testid={`roomview-page-bar`}
                >
                  <embedPageLiveContext.Pagebar
                    tabs={
                      embedPageLiveContext.pid3 && embedPageLiveContext.documentPreviewChromeShown && !embedPageLiveContext.failed ? (
                        <embedPageLiveContext.MemoizedTabRail
                          pid={embedPageLiveContext.pid2}
                          activeId={embedPageLiveContext.nodeId}
                          pageName={embedPageLiveContext.roomViewEmbedPageResult18?.name}
                          version={embedPageLiveContext.version}
                          room={embedPageLiveContext.room}
                          presence={embedPageLiveContext.presence}
                          onUserNavigate={embedPageLiveContext.onUserNavigate}
                          readOnly={embedPageLiveContext.readOnly2}
                          onPageSkill={embedPageLiveContext.onPageSkill}
                          onDocFont={embedPageLiveContext.onDocFont}
                          onDocLanguage={embedPageLiveContext.onDocLanguage}
                          outlineFeed={embedPageLiveContext.outlineFeed}
                          onJumpHeading={embedPageLiveContext.onJumpHeading}
                          onPanelOpen={embedPageLiveContext.onPanelOpen}
                          timers={embedPageLiveContext.ApplicationRoutesSet}
                          onTabsSeat={embedPageLiveContext.isTabsLocationFeatureEnabled2 ? embedPageLiveContext.setRoomViewEmbedPageState2 : undefined}
                          tabsPlaceOffered={embedPageLiveContext.isTabsLocationFeatureEnabled2 && embedPageLiveContext.frame}
                          tabsPlace={embedPageLiveContext.place}
                          tabsOnPage={embedPageLiveContext.tabsOnPage}
                          tabsListShown={embedPageLiveContext.onLeft}
                          tabsNoRoom={embedPageLiveContext.tabsSidebarDrawingState2 || embedPageLiveContext.useStableDocumentIdentity2}
                          triggerHidden={embedPageLiveContext.triggerHidden}
                          triggerChrome={`readout`}
                          key={embedPageLiveContext.pid2}
                        />
                      ) : null
                    }
                    pageSkill={
                      <embedPageLiveContext.PageSkillBulbGate seat={embedPageLiveContext.seat3} chrome={`bar`} />
                    }
                    docFont={<embedPageLiveContext.DocFontControlGate seat={embedPageLiveContext.seat4} />}
                    docLayout={<embedPageLiveContext.DocLayoutControlGate seat={embedPageLiveContext.seat4} />}
                    status={
                      embedPageLiveContext.readOnly2 ? (
                        <embedPageLiveContext.DocumentPostureBadge
                          chrome={`badge`}
                          posture={embedPageLiveContext.posture2}
                          reason={embedPageLiveContext.reason}
                        />
                      ) : undefined
                    }
                    posture={
                      embedPageLiveContext.posture === `edit` &&
                      embedPageLiveContext.proseSurface &&
                      !embedPageLiveContext.previewUp &&
                      embedPageLiveContext.documentPreviewChromeShown &&
                      !embedPageLiveContext.failed
                        ? `edit`
                        : `none`
                    }
                    surface={
                      embedPageLiveContext.nodeId !== undefined &&
                      embedPageLiveContext.roomViewEmbedPageState9?.fileId === embedPageLiveContext.nodeId
                        ? embedPageLiveContext.roomViewEmbedPageState9.kind
                        : undefined
                    }
                    preview={embedPageLiveContext.previewUp}
                    image={embedPageLiveContext.image}
                    format={embedPageLiveContext.documentTabsFormat.format}
                    onCommand={embedPageLiveContext.documentTabsFormat.run}
                    onMenuClose={embedPageLiveContext.documentTabsFormat.refocusEditor}
                  />
                </div>
              )}
              <embedPageLiveContext.PagebarImageInput
                inputRef={embedPageLiveContext.inputRef}
                focusTarget={embedPageLiveContext.documentTabsFormat.focusTarget}
              />
              {embedPageLiveContext.bar && embedPageLiveContext.versionHistoryV2 && (
                <div
                  ref={embedPageLiveContext.setRailSlot}
                  className={`absolute inset-y-0 right-0 flex`}
                  style={{
                    zIndex: embedPageLiveContext.zIndex,
                  }}
                  data-testid={`roomview-rail-slot`}
                />
              )}
              {embedPageLiveContext.frame && embedPageLiveContext.pid3 && embedPageLiveContext.documentPreviewChromeShown && !embedPageLiveContext.failed && (
                <embedPageLiveContext.RoomviewFrameToolbar
                  seats={embedPageLiveContext.seats}
                  tabs={
                    <embedPageLiveContext.MemoizedTabRail
                      pid={embedPageLiveContext.pid2}
                      activeId={embedPageLiveContext.nodeId}
                      pageName={embedPageLiveContext.roomViewEmbedPageResult18?.name}
                      version={embedPageLiveContext.version}
                      room={embedPageLiveContext.room}
                      presence={embedPageLiveContext.presence}
                      onUserNavigate={embedPageLiveContext.onUserNavigate}
                      readOnly={embedPageLiveContext.readOnly2}
                      onPageSkill={embedPageLiveContext.onPageSkill}
                      onDocFont={embedPageLiveContext.onDocFont}
                      onDocLanguage={embedPageLiveContext.onDocLanguage}
                      outlineFeed={embedPageLiveContext.outlineFeed}
                      onJumpHeading={embedPageLiveContext.onJumpHeading}
                      onPanelOpen={embedPageLiveContext.onPanelOpen}
                      timers={embedPageLiveContext.ApplicationRoutesSet}
                      onTabsSeat={embedPageLiveContext.isTabsLocationFeatureEnabled2 ? embedPageLiveContext.setRoomViewEmbedPageState2 : undefined}
                      tabsPlaceOffered={embedPageLiveContext.isTabsLocationFeatureEnabled2 && embedPageLiveContext.frame}
                      tabsPlace={embedPageLiveContext.place}
                      tabsOnPage={embedPageLiveContext.tabsOnPage}
                      tabsListShown={embedPageLiveContext.onLeft}
                      tabsNoRoom={embedPageLiveContext.tabsSidebarDrawingState2 || embedPageLiveContext.useStableDocumentIdentity2}
                      triggerChrome={embedPageLiveContext.docked ? `readout` : `button`}
                      key={embedPageLiveContext.pid2}
                    />
                  }
                  pageSkill={
                    <embedPageLiveContext.PageSkillBulbGate
                      seat={embedPageLiveContext.seat3}
                      chrome={embedPageLiveContext.docked ? `docked` : `button`}
                    />
                  }
                  viewOnly={embedPageLiveContext.readOnly2 && !embedPageLiveContext.bar}
                  pillPosture={embedPageLiveContext.posture2}
                  pillReason={embedPageLiveContext.reason}
                  docked={embedPageLiveContext.docked}
                />
              )}
              {embedPageLiveContext.failed2 ? (
                <embedPageLiveContext.RoomSigninFace
                  signInHref={(0, embedPageLiveContext.frameSignInHref)()}
                  supportCode={(0, embedPageLiveContext.liveSupportCode)()}
                />
              ) : embedPageLiveContext.failed ? (
                <embedPageLiveContext.RoomviewAuthorityFailed
                  onRetry={embedPageLiveContext.onRenamed}
                  message={embedPageLiveContext.page2.message}
                  frame={embedPageLiveContext.frame}
                  supportCode={embedPageLiveContext.frame ? (0, embedPageLiveContext.liveSupportCode)() : undefined}
                />
              ) : null}
              {embedPageLiveContext.roomViewEmbedPageResult17 && (
                <div
                  className={`text-footnote text-secondary border-strong p-sm relative z-20 border-b`}
                  data-testid={`roomview-page-gone`}
                  role={`status`}
                >{`This document has been deleted or is no longer available.`}</div>
              )}
              {embedPageLiveContext.roomViewEmbedPageResult15 &&
                !embedPageLiveContext.failed &&
                !embedPageLiveContext.denied &&
                !embedPageLiveContext.roomViewEmbedPageResult16 && (
                  <div
                    className={`text-footnote text-secondary border-strong p-sm relative z-20 border-b`}
                    data-testid={`roomview-reconnecting`}
                    role={`status`}
                  >{`Reconnecting…`}</div>
                )}
              {embedPageLiveContext.roomViewEmbedPageResult13 && !embedPageLiveContext.roomViewEmbedPageResult16 && (
                <div
                  className={`text-footnote text-secondary border-strong p-sm relative z-20 border-b`}
                  data-testid={`roomview-stale-refresh`}
                >{`Couldn’t refresh — showing the last loaded state.`}</div>
              )}
              {embedPageLiveContext.roomViewEmbedPageState && (
                <div
                  className={`text-footnote text-danger border-strong p-sm relative z-20 border-b`}
                  data-testid={`roomview-error`}
                >
                  {embedPageLiveContext.roomViewEmbedPageState}
                </div>
              )}
              <div
                className={embedPageLiveContext.bar2 ? `min-h-0 flex-1` : `h-full`}
                aria-busy={embedPageLiveContext.faceUp || embedPageLiveContext.usePageSkillSeat2.covers}
                onPointerOver={(
                  event?: Dynamic,
                  ..._extraArguments: unknown[]
                ): Dynamic =>
                  embedPageLiveContext.usePageSkillSeat2.hoverTab(
                    (0, embedPageLiveContext.resolveSessionNavigationClosest)(event.target),
                  )
                }
                onPointerLeave={(..._extraArguments: unknown[]): Dynamic =>
                  embedPageLiveContext.usePageSkillSeat2.hoverTab(null)
                }
                onFocus={(
                  event?: Dynamic,
                  ..._extraArguments: unknown[]
                ): Dynamic =>
                  embedPageLiveContext.usePageSkillSeat2.hoverTab(
                    (0, embedPageLiveContext.resolveSessionNavigationClosest)(event.target),
                  )
                }
              >
                {embedPageLiveContext.onPage && embedPageLiveContext.seat !== null ? (
                  <div
                    className={`pointer-events-none absolute inset-0 overflow-clip`}
                    style={{
                      zIndex: embedPageLiveContext.zIndex2,
                    }}
                    data-testid={`tabs-left-fence`}
                  >
                    <div
                      ref={embedPageLiveContext.setRoomViewEmbedPageState3}
                      className={`pointer-events-auto absolute flex flex-col`}
                      style={{
                        visibility: embedPageLiveContext.tabsOnPage ? `visible` : `hidden`,
                      }}
                      data-testid={`tabs-left-host`}
                    >
                      <embedPageLiveContext.TabsLeftListGate
                        seat={embedPageLiveContext.seat}
                        onUp={embedPageLiveContext.onUp}
                        onRenaming={embedPageLiveContext.onRenaming}
                        onLost={embedPageLiveContext.onLost}
                        feed={embedPageLiveContext.outlineWanted ? embedPageLiveContext.feed : null}
                        onJump={embedPageLiveContext.onJumpHeading}
                        timers={embedPageLiveContext.ApplicationRoutesSet}
                      />
                    </div>
                  </div>
                ) : null}
                {embedPageLiveContext.pid3 ? (
                  embedPageLiveContext.routineId && embedPageLiveContext.frame ? (
                    <embedPageLiveContext.FrameUnavailable what={`Routines`} />
                  ) : embedPageLiveContext.routineId ? (
                    <embedPageLiveContext.RoutinePage
                      pid={embedPageLiveContext.pid2}
                      routineId={embedPageLiveContext.routineId}
                      version={embedPageLiveContext.version}
                      chipNav={embedPageLiveContext.chipNav}
                      onVisualize={embedPageLiveContext.onVisualize}
                      key={`${embedPageLiveContext.pid2}/${embedPageLiveContext.routineId}`}
                    />
                  ) : embedPageLiveContext.seat2 && embedPageLiveContext.room ? (
                    <embedPageLiveContext.FilmedProsePage
                      room={embedPageLiveContext.room}
                      pid={embedPageLiveContext.seat2.pid}
                      fileId={embedPageLiveContext.seat2.fileId}
                      snapshotHead={embedPageLiveContext.snapshotHead}
                      snapshotReady={embedPageLiveContext.snapshotReady}
                      displayName={embedPageLiveContext.displayName}
                      version={embedPageLiveContext.seat2.version}
                      objectFiles={embedPageLiveContext.objectFiles}
                      tabNames={embedPageLiveContext.tabNames}
                      onSurfaceKind={embedPageLiveContext.onSurfaceKind}
                      onHeadKind={embedPageLiveContext.onHeadKind}
                      onShown={embedPageLiveContext.onShown}
                      onLeaveProbe={embedPageLiveContext.useDocumentPreviewShown2.onProbe}
                      leaving={embedPageLiveContext.useDocumentPreviewShown2.held}
                      onViewOnly={embedPageLiveContext.onViewOnly}
                      onPageGone={embedPageLiveContext.onPageGone}
                      onTabGone={embedPageLiveContext.onTabGone}
                      onEscapeToChrome={embedPageLiveContext.onEscapeToChrome}
                      onHistoryLeave={embedPageLiveContext.documentTabsFormat.refocusEditor}
                      onTitleCommit={embedPageLiveContext.onTitleCommit}
                      onFirstHeading={embedPageLiveContext.onFirstHeading}
                      readOnly={embedPageLiveContext.viewerReadOnly}
                      placement={embedPageLiveContext.placement}
                      onOpenFile={embedPageLiveContext.onOpenFile}
                      edgeMinLeft={embedPageLiveContext.edgeMinLeft}
                      railSlot={embedPageLiveContext.railSlot}
                      onRailInSlot={embedPageLiveContext.onRailInSlot}
                      leftOverlayHost={embedPageLiveContext.onPage ? embedPageLiveContext.roomViewEmbedPageState7 : null}
                      leftOverlayHeld={embedPageLiveContext.tabsOnPage}
                      onLeftOverlayState={embedPageLiveContext.onPage ? embedPageLiveContext.setRoomViewEmbedPageState5 : undefined}
                      outlineWanted={embedPageLiveContext.outlineWanted}
                      onOutline={embedPageLiveContext.outlineWanted ? embedPageLiveContext.send : undefined}
                      onOutlineAt={embedPageLiveContext.outlineWanted ? embedPageLiveContext.send2 : undefined}
                      onOutlineScrolled={embedPageLiveContext.outlineWanted ? embedPageLiveContext.send3 : undefined}
                      outlineJump={embedPageLiveContext.outlineJump}
                      bornHere={embedPageLiveContext.roomViewEmbedPageState13 === embedPageLiveContext.pid2}
                      hostCommentOffered={embedPageLiveContext.hostCommentOffered}
                      key={(0, embedPageLiveContext.documentPreviewKey)(embedPageLiveContext.seat2.pid, embedPageLiveContext.seat2.fileId, embedPageLiveContext.seat2.version)}
                    />
                  ) : embedPageLiveContext.faceUp ? null : (
                    <embedPageLiveContext.UseApplicationRootHasFilesComponent
                      hasFiles={embedPageLiveContext.objectFiles.length > 0}
                    />
                  )
                ) : null}
              </div>
              {embedPageLiveContext.usePageSkillSeat2.layer !== null && (
                <embedPageLiveContext.RouteErrorBoundary
                  component={`tabpic`}
                  fallback={
                    <embedPageLiveContext.UseDocumentPreviewUseLayoutEffectComponent
                      onError={embedPageLiveContext.usePageSkillSeat2.layer.onError}
                    />
                  }
                >
                  <embedPageLiveContext.React.Suspense fallback={null}>
                    {renderReactJsx(embedPageLiveContext.SessionNavigationDefault4, {
  pid: embedPageLiveContext.pid2,
  container: `project/${embedPageLiveContext.pid2}`,
  measureKey: embedPageLiveContext.measureKey,
  scrollYOf: (roomViewEmbedPage?: Dynamic, ..._extraArguments: unknown[]): Dynamic => (0, embedPageLiveContext.getDocumentScroll)((0, embedPageLiveContext.documentScrollKey)(embedPageLiveContext.pid2, roomViewEmbedPage.slice(embedPageLiveContext.pid2.length + 1))),
  ...embedPageLiveContext.usePageSkillSeat2.layer
}, embedPageLiveContext.pid2)}
                  </embedPageLiveContext.React.Suspense>
                </embedPageLiveContext.RouteErrorBoundary>
              )}
              {embedPageLiveContext.faceUp && (
                <embedPageLiveContext.PageLoadingFace
                  matchShell={embedPageLiveContext.matchShell}
                  caption={embedPageLiveContext.documentPreviewCaption.caption}
                  captionTestId={embedPageLiveContext.documentPreviewCaption.testId}
                  hint={embedPageLiveContext.documentPreviewCaption.hint}
                />
              )}
            </div>
          </div>
        </div>
        {embedPageLiveContext.roomViewEmbedPageResult32 && embedPageLiveContext.elementRef3.current !== null && (
          <embedPageLiveContext.React.Suspense
            fallback={
              <embedPageLiveContext.UiDialogsRoot.Root
                open={embedPageLiveContext.enabledState3 && embedPageLiveContext.roomViewEmbedPageResult31}
                onOpenChange={embedPageLiveContext.onOpenChange2}
                onOpenChangeComplete={(
                  roomViewEmbedPage?: Dynamic,
                  ..._extraArguments: unknown[]
                ): undefined => {
                  if (
                    !roomViewEmbedPage &&
                    document.hasFocus() &&
                    !embedPageLiveContext.previewUpRef.current
                  ) {
                    embedPageLiveContext.documentTabsFormat.refocusEditor();
                  }
                }}
              >
                <embedPageLiveContext.UiDialogsRoot.Popup
                  ref={embedPageLiveContext.initialFocus}
                  initialFocus={embedPageLiveContext.initialFocus}
                  finalFocus={false}
                  size={`lg`}
                  aria-busy={true}
                >
                  <embedPageLiveContext.UiDialogsRoot.Header
                    description={embedPageLiveContext.DOCUMENT_LANGUAGE_COPY.hint}
                  >
                    {embedPageLiveContext.DOCUMENT_LANGUAGE_COPY.title}
                  </embedPageLiveContext.UiDialogsRoot.Header>
                  <embedPageLiveContext.LanguagePickerSkeleton className={`mt-md`} count={44} />
                </embedPageLiveContext.UiDialogsRoot.Popup>
              </embedPageLiveContext.UiDialogsRoot.Root>
            }
          >
            <embedPageLiveContext.SessionNavigationDocLanguageDialog
              seat={embedPageLiveContext.elementRef3.current}
              open={embedPageLiveContext.enabledState3 && embedPageLiveContext.roomViewEmbedPageResult31}
              onOpenChange={embedPageLiveContext.onOpenChange2}
              onClosed={(..._extraArguments: unknown[]): undefined => {
                if (document.hasFocus() && !embedPageLiveContext.previewUpRef.current) {
                  embedPageLiveContext.documentTabsFormat.refocusEditor();
                }
              }}
            />
          </embedPageLiveContext.React.Suspense>
        )}
        {embedPageLiveContext.pid3 && !embedPageLiveContext.frame && embedPageLiveContext.roomViewEmbedPageResult3 && (
          <embedPageLiveContext.React.Suspense fallback={null}>
            <embedPageLiveContext.SessionNavigationThen3
              name={embedPageLiveContext.pid2}
              displayName={embedPageLiveContext.roomViewEmbedPageResult18?.name ?? embedPageLiveContext.pid2}
              filePath={embedPageLiveContext.filePath}
              pid={embedPageLiveContext.pid2}
              pageId={embedPageLiveContext.nodeId}
              v3Ref={
                embedPageLiveContext.routineId
                  ? {
                      noun: `routine`,
                      id: embedPageLiveContext.routineId,
                    }
                  : undefined
              }
              doorPid={embedPageLiveContext.pid2}
              v3Container={embedPageLiveContext.container2}
              open={embedPageLiveContext.open}
              onOpenChange={embedPageLiveContext.onOpenChange}
            />
          </embedPageLiveContext.React.Suspense>
        )}
        <embedPageLiveContext.DebugReportFloatingButton />
        <embedPageLiveContext.KeyboardHelpDialog />
      </div>
    </embedPageLiveContext.ProjectDoorProvider>
  ));
}
