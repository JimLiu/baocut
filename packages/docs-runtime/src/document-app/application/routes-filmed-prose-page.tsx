import type { RoutineRun } from "./project-contracts";
/** BaoCut: application routes from index-CX4IZqzA.js. */
import type { Dynamic } from "../../interop/legacy-dynamic";
import {
  Button,
  DataOperationControlRoomReadDenied,
  EditorSelectionAndTablesDataPagesPrintSkip,
  EditorSelectionAndTablesSelection2,
  FrameUnavailable,
  PaneResizeHandle,
  PlatformApiAndAuthTick,
  PlatformLiveDocumentAndHistoryEntries2,
  PlatformRuntimeAndChatAssign,
  PlatformSyncAndRoutingAssign2,
  PlatformSyncAndRoutingLabel2,
  PlatformSyncAndRoutingState4,
  UiOverlaysAndIconsCustomIcon,
  clearPlatformKeyboardAndSaveStatusDelete,
  frameViewerLocus,
  isFrameArtifact,
  isPlatformLiveDocumentAndHistoryChanged,
  isPlatformLiveDocumentAndHistoryHasFocus,
  isPlatformLiveDocumentAndHistoryKind,
  loadPlatformLiveDocumentAndHistoryChanged,
  platformKeyboardAndSaveStatusValue2500,
  preloadModule,
  resolveCommentsStoreLayer,
  resolveDataOperationControlEngineBound,
  resolveDataOperationEngineApplicationOctetStream,
  resolveDataOperationEngineLdoc,
  resolveEditorSelectionAndTablesLocale,
  resolveObservabilityBootPaint2,
  resolveObservabilityBrowserAndOperationEventsToFixed,
  resolvePlatformApiAndAuthUseContext2,
  resolvePlatformApiAndAuthValue,
  resolvePlatformKeyboardAndSaveStatusValue3,
  resolvePlatformLiveDocumentAndHistoryOpen,
  resolvePlatformLiveDocumentAndHistoryRestoreFailed,
  resolvePlatformLiveDocumentAndHistoryRestored,
  resolvePlatformLiveDocumentAndHistoryValue36,
  resolvePlatformRuntimeAndChatPill,
  resolvePlatformSyncAndRoutingCompact,
  resolvePlatformSyncAndRoutingUseContext,
  resolvePlatformSyncAndRoutingValue20,
  standaloneDocsChat,
  standaloneDocsHost,
  subscribeProjectFeed,
  toast,
  updateDataModelSchemasPath,
  updatePlatformLiveDocumentAndHistoryOpen2,
  useCommentStore,
  useCommentsEditorState,
  useCommentsEditorState2,
  useDataOperationControlRawStart,
  usePlatformSyncAndRoutingPhone,
  versionHistoryOffered,
  viewerId,
} from "../dependencies";
import {
  React,
  mapPreloadDependencies,
} from "../bootstrap";
import {
  filePresentationKind,
} from "../presence-and-chat";
import {
  ImagePreview,
  documentScrollKey,
  getDocumentScroll,
  rememberDocumentScroll,
} from "../ask-cards/document-posture-badge";
import {
  resolveDocumentRuntimeReadOnly,
} from "../document-runtime/widget-provenance-gutter";
import {
  RoomDocumentPage,
} from "../room-document-page/1";
import {
  PdfPreview,
  UseDocumentPreviewSlotElComponent,
  UseDocumentPreviewStatusComponent,
  documentPreviewKey,
  isDocumentPreviewHistoryRoad,
  resolveDocumentPreviewRailOverlay,
} from "../document-preview/use-page-skill-seat";
import {
  isSessionNavigationKind,
  resolveSessionNavigationBirthName,
  resolveSessionNavigationContent,
  resolveSessionNavigationFilmed,
  resolveSessionNavigationFrame,
  resolveSessionNavigationValue3,
  sessionNavigationLimit3000,
} from "../session-navigation/create-file-placement-waiter";
import {
  SessionNavigationDefault,
  SessionNavigationDefault2,
  SessionNavigationDefault3,
  SessionNavigationNodeId,
  SessionNavigationPanel,
  SessionNavigationRightRail,
  SessionNavigationThen,
  SessionNavigationThen2,
  sessionNavigationLimit20002,
  sessionNavigationLimit4,
} from "../session-navigation/ldoc-comments-btn";
import { RoomTabUnbound } from "./document-states";
import { isRoutineFeedUpdate } from "./project-data";
import type * as ReactComponentTypes from "react";
import { useRef } from "react";

export const FilmedProsePage: ReactComponentTypes.FC<Dynamic> = ({
  room: room,
  pid: pid,
  fileId: fileId,
  snapshotHead: snapshotHead,
  snapshotReady = false,
  displayName: displayName,
  version: version,
  objectFiles: objectFiles,
  tabNames: tabNames,
  onSurfaceKind: onSurfaceKind,
  onHeadKind: onHeadKind,
  onShown: onShown,
  onLeaveProbe: onLeaveProbe,
  leaving = false,
  onViewOnly: onViewOnly,
  onPageGone: onPageGone,
  onTabGone: onTabGone,
  onEscapeToChrome: onEscapeToChrome,
  onHistoryLeave: onHistoryLeave,
  onTitleCommit: onTitleCommit,
  onFirstHeading: onFirstHeading,
  filmedProse: filmedProse,
  readOnly = false,
  embed = false,
  edgeMinLeft: edgeMinLeft,
  railSlot = null,
  onRailInSlot: onRailInSlot,
  leftOverlayHost: leftOverlayHost,
  leftOverlayHeld: leftOverlayHeld,
  onLeftOverlayState: onLeftOverlayState,
  outlineWanted = false,
  onOutline: onOutline,
  onOutlineAt: onOutlineAt,
  onOutlineScrolled: onOutlineScrolled,
  outlineJump = null,
  bornHere = false,
  hostCommentOffered = false,
  placement: placement,
  onOpenFile: onOpenFile,
}) => {
  let filmedProsePageResult: Dynamic = resolvePlatformApiAndAuthUseContext2();
  let filmed = resolveEditorSelectionAndTablesLocale(filmedProsePageResult);
  let phone: Dynamic = resolvePlatformSyncAndRoutingValue20();
  let filmedProsePageResult2 = usePlatformSyncAndRoutingPhone();
  let filmedProsePageResult3: Dynamic = useCommentsEditorState(pid);
  let frameWritable: Dynamic = filmedProsePageResult3 && !filmedProsePageResult2;
  let frameCommentable: Dynamic = useCommentsEditorState2(pid);
  let documentRuntimeReadOnly: Dynamic = resolveDocumentRuntimeReadOnly({
    frameWritable: frameWritable,
    frameCommentable: frameCommentable,
    hostReadOnly: !!readOnly,
  });
  let frame: Dynamic = isFrameArtifact();
  let filmed2: Dynamic = filmed || frame;
  let filmedProsePageResult4: Dynamic = resolvePlatformLiveDocumentAndHistoryValue36(
    pid,
    fileId,
  );
  // BaoCut: 版本面板与版本预览经 docs-host.ts 的 versionHistoryOffered 开关（BaoCut 的文档服务提供接口，宿主标了只读时关）；
  // 关着时记在本地的「面板开着」（bongo.settings.historyRailOpen）也不起作用。
  let historyRoad: Dynamic =
    !filmed && filmedProsePageResult4 && !readOnly && versionHistoryOffered();
  let [filmedProsePageState]: Dynamic = (0, React.useState)(
    (..._extraArguments: unknown[]): number => ++applicationRoutesLimit0,
  );
  let onLeftOverlayState2: Dynamic = (0, React.useCallback)(
    (filmedProsePage?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      onLeftOverlayState?.(
        documentPreviewKey(pid, fileId, version),
        filmedProsePageState,
        filmedProsePage,
      ),
    [onLeftOverlayState, pid, fileId, version, filmedProsePageState],
  );
  let onOutline2: Dynamic = (0, React.useCallback)(
    (filmedProsePage?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      onOutline?.(fileId, filmedProsePage),
    [onOutline, fileId],
  );
  let onOutlineAt2: Dynamic = (0, React.useCallback)(
    (
      filmedProsePage?: Dynamic,
      options?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => onOutlineAt?.(fileId, filmedProsePage, options),
    [onOutlineAt, fileId],
  );
  let onOutlineScrolled2: Dynamic = (0, React.useCallback)(
    (filmedProsePage?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      onOutlineScrolled?.(fileId, filmedProsePage),
    [onOutlineScrolled, fileId],
  );
  let [fileValue, setFileValue]: Dynamic = (0, React.useState)();
  let fileValueRef: Dynamic = (0, React.useRef)(fileValue);
  fileValueRef.current = fileValue;
  let [sessionNavigationValue3State]: Dynamic = (0, React.useState)(
    (..._extraArguments: unknown[]): Dynamic => resolveSessionNavigationValue3(),
  );
  let historyOpen: Dynamic = PlatformSyncAndRoutingState4(
    (filmedProsePage?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      filmedProsePage.value,
  );
  let roomFile: Dynamic = (0, React.useMemo)(
    (..._extraArguments: unknown[]): Dynamic => ({
      pid: pid,
      fileId: fileId,
    }),
    [pid, fileId],
  );
  let embed2: Dynamic = embed || frame;
  let [filmedProsePageState2, setFilmedProsePageState]: Dynamic = (0, React.useState)(
    null,
  );
  let parentElement: Dynamic = railSlot?.parentElement ?? filmedProsePageState2;
  let [matchesClientWidthState, setMatchesClientWidthState]: Dynamic = (0,
  React.useState)(
    (..._extraArguments: unknown[]) =>
      (railSlot?.parentElement?.clientWidth ?? applicationRoutesLimit640) <
      applicationRoutesLimit640,
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      if (!embed2 || !parentElement || typeof ResizeObserver === "undefined") return;
      let setMatchesClientWidthState2: Dynamic = (
        ..._extraArguments: unknown[]
      ): Dynamic =>
        setMatchesClientWidthState(parentElement.clientWidth < applicationRoutesLimit640);
      let resizeObserver = new ResizeObserver(setMatchesClientWidthState2);
      resizeObserver.observe(parentElement);
      setMatchesClientWidthState2();
      return (..._extraArguments: unknown[]) => resizeObserver.disconnect();
    },
    [embed2, parentElement],
  );
  let embed3: Dynamic = embed2 && matchesClientWidthState;
  let documentPreviewRailOverlay: Dynamic = resolveDocumentPreviewRailOverlay(embed3);
  let inSlot: Dynamic = historyRoad && historyOpen && !embed3 && railSlot !== null;
  let filmedProsePageResult5: Dynamic = PlatformSyncAndRoutingAssign2(
    (filmedProsePage?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      filmedProsePage.preview,
  );
  let entry: Dynamic = isPlatformLiveDocumentAndHistoryKind(
    filmedProsePageResult5,
    historyRoad,
  );
  let upto: Dynamic = entry.kind === `pinned` ? entry.upto : undefined;
  let envelope: Dynamic = (0, React.useMemo)(
    (..._extraArguments: unknown[]): Dynamic => ({
      bodyLid: fileValue?.content?.localId,
    }),
    [fileValue?.content?.localId],
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic =>
      PlatformSyncAndRoutingAssign2.getState().clear(),
    [pid, fileId],
  );
  let [enabledState, setEnabledState]: Dynamic = (0, React.useState)(false);
  let countRef: Dynamic = (0, React.useRef)(0);
  let onHistoryLeaveRef: Dynamic = (0, React.useRef)(onHistoryLeave);
  onHistoryLeaveRef.current = onHistoryLeave;
  let enabledRef: Dynamic = (0, React.useRef)(false);
  let enabledRef2: Dynamic = (0, React.useRef)(false);
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      let enabled: Dynamic = enabledRef.current && !enabledState;
      enabledRef.current = enabledState;
      if (!enabled) return;
      let enabled2: Dynamic = enabledRef2.current;
      enabledRef2.current = false;
      if (
        !enabled2 ||
        documentPreviewRailOverlay.stacked ||
        leaving ||
        upto !== undefined
      )
        return;
      let requestAnimationFrame2 = requestAnimationFrame(
        (..._extraArguments: unknown[]) =>
          isPlatformLiveDocumentAndHistoryHasFocus(document, onHistoryLeaveRef.current),
      );
      return (..._extraArguments: unknown[]) =>
        cancelAnimationFrame(requestAnimationFrame2);
    },
    [enabledState, documentPreviewRailOverlay.stacked, leaving, upto],
  );
  let issue: Dynamic = (0, React.useCallback)(
    (
      filmedProsePage?: Dynamic,
      options?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      let issue2: Dynamic = sessionNavigationValue3State.issue(!filmedProsePage);
      (async (..._extraArguments: unknown[]): Promise<Dynamic> => {
        try {
          return await room.read(
            {
              object: `file`,
              id: fileId,
            },
            `json`,
          );
        } catch (filmedProsePageResult8: Dynamic) {
          if (
            filmedProsePageResult8 instanceof
              (DataOperationControlRoomReadDenied as Dynamic) &&
            resolveDataOperationControlEngineBound(filmedProsePageResult8.reason)
          )
            return await room.read(
              {
                object: `file`,
                id: fileId,
              },
              `text`,
            );
          throw filmedProsePageResult8;
        }
      })()
        .then((result?: Dynamic, ..._extraArguments: unknown[]): undefined => {
          if (sessionNavigationValue3State.land(issue2)) {
            setFileValue(resolveSessionNavigationBirthName(result));
          }
        })
        .catch((error?: Dynamic, ..._extraArguments: unknown[]): undefined => {
          if (
            filmedProsePage &&
            !(error instanceof (DataOperationControlRoomReadDenied as Dynamic))
          ) {
            options?.();
            return;
          }
          if (sessionNavigationValue3State.land(issue2)) {
            setFileValue(
              error instanceof (DataOperationControlRoomReadDenied as Dynamic) &&
                error.reason === `engine-unported`
                ? {
                    birthName: ``,
                    unported: true,
                  }
                : {
                    birthName: ``,
                  },
            );
          }
        });
    },
    [room, fileId, sessionNavigationValue3State],
  );
  let road = resolveSessionNavigationFrame({
    frame: frame,
    snapshotReady: snapshotReady,
    snapshotHead: snapshotHead,
  });
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      if (fileValueRef.current === undefined && road !== `wait`) {
        if (road === `snapshot`) {
          setFileValue(resolveSessionNavigationBirthName(snapshotHead));
          resolveCommentsStoreLayer(`host`, `head`, {
            road: road,
            synced: snapshotReady,
          });
          return;
        }
        resolveCommentsStoreLayer(`host`, `head`, {
          road: road,
          synced: snapshotReady,
        });
        issue(false);
        return (..._extraArguments: unknown[]): undefined =>
          void sessionNavigationValue3State.issue(true);
      }
    },
    [road, snapshotHead, snapshotReady, issue, sessionNavigationValue3State],
  );
  let matchesUnbound = fileValue?.unbound === true;
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      if (!matchesUnbound || filmed) return;
      let enabled = false;
      let filmedProsePageResult8: Dynamic;
      let issue2: Dynamic = (
        filmedProsePage: Dynamic = false,
        ..._extraArguments: unknown[]
      ): Dynamic =>
        issue(true, (..._extraArguments: unknown[]): undefined => {
          if (!(enabled || filmedProsePage || filmedProsePageResult8 !== undefined)) {
            filmedProsePageResult8 = setTimeout(
              (..._extraArguments: unknown[]): undefined => {
                filmedProsePageResult8 = undefined;
                if (!enabled) {
                  issue2(true);
                }
              },
              sessionNavigationLimit3000,
            );
          }
        });
      let filmedProsePageResult9: Dynamic = subscribeProjectFeed(
        pid,
        (filmedProsePage?: Dynamic, ..._extraArguments: unknown[]): undefined => {
          if (isSessionNavigationKind(filmedProsePage, fileId)) {
            issue2();
          }
        },
      );
      return (..._extraArguments: unknown[]): undefined => {
        enabled = true;
        clearTimeout(filmedProsePageResult8);
        filmedProsePageResult9();
      };
    },
    [matchesUnbound, filmed, pid, fileId, issue],
  );
  let intend: Dynamic = resolvePlatformSyncAndRoutingUseContext();
  let SessionNavigationPanel2: Dynamic = SessionNavigationPanel(
    (filmedProsePage?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      filmedProsePage.panel,
  );
  let nodeId: Dynamic = SessionNavigationNodeId(
    (filmedProsePage?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      filmedProsePage.nodeId,
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic =>
      (..._extraArguments: unknown[]): undefined => {
        SessionNavigationPanel.getState().close();
        SessionNavigationNodeId.getState().close();
      },
    [fileId],
  );
  let room2: Dynamic = (0, React.useMemo)(
    (..._extraArguments: unknown[]): Dynamic => ({
      intend: intend,
      read: (
        filmedProsePage?: Dynamic,
        options?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => room.read(filmedProsePage, options),
      pid: pid,
      fileId: fileId,
    }),
    [intend, room, pid, fileId],
  );
  let kind = resolveSessionNavigationContent(fileValue);
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (kind !== undefined) {
        onSurfaceKind?.({
          fileId: fileId,
          kind: kind,
        });
      }
    },
    [kind, fileId, onSurfaceKind],
  );
  let kind2 = fileValue === undefined ? undefined : filePresentationKind(fileValue);
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (kind2 !== undefined) {
        onHeadKind?.({
          fileId: fileId,
          kind: kind2,
        });
      }
    },
    [kind2, fileId, onHeadKind],
  );
  let [enabledState2, setEnabledState2]: Dynamic = (0, React.useState)(false);
  let shown: Dynamic =
    fileValue !== undefined &&
    (!resolveSessionNavigationFilmed(fileValue, {
      frame: frame,
      filmed: filmed,
    }) ||
      enabledState2);
  let matchesFileValue =
    (fileValue !== undefined &&
      !resolveSessionNavigationFilmed(fileValue, {
        frame: frame,
        filmed: filmed,
      })) ||
    upto !== undefined;
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (matchesFileValue) {
        onLeftOverlayState2(`off`);
      }
    },
    [matchesFileValue, onLeftOverlayState2],
  );
  let [warmed, setWarmed]: Dynamic = (0, React.useState)(false);
  let filmedProsePageResult6: Dynamic = resolvePlatformLiveDocumentAndHistoryOpen();
  let historyOpenRef: Dynamic = (0, React.useRef)(historyOpen);
  let [enabledState3, setEnabledState3]: Dynamic = (0, React.useState)(false);
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (historyOpen) {
        if (!historyOpenRef.current) {
          historyOpenRef.current = true;
          setEnabledState3(true);
        }
      } else {
        historyOpenRef.current = false;
        setEnabledState3(false);
        updatePlatformLiveDocumentAndHistoryOpen2();
      }
    },
    [historyOpen],
  );
  let [enabledState4, setEnabledState4]: Dynamic = (0, React.useState)(false);
  let elementRef: Dynamic = (0, React.useRef)(null);
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (!historyOpen) {
        setEnabledState4(false);
        elementRef.current = null;
      }
    },
    [historyOpen],
  );
  let setEnabledState5: Dynamic = (0, React.useCallback)(
    (filmedProsePage?: Dynamic, ..._extraArguments: unknown[]): undefined => {
      let element: Dynamic = elementRef.current;
      if (element === null) {
        elementRef.current = {
          x: filmedProsePage.clientX,
          y: filmedProsePage.clientY,
          d: 0,
        };
        return;
      }
      element.d +=
        Math.abs(filmedProsePage.clientX - element.x) +
        Math.abs(filmedProsePage.clientY - element.y);
      element.x = filmedProsePage.clientX;
      element.y = filmedProsePage.clientY;
      if (element.d >= sessionNavigationLimit4) {
        setEnabledState4(true);
      }
    },
    [],
  );
  let intent: Dynamic = filmedProsePageResult6 || enabledState3 || enabledState4;
  let labelRef: Dynamic = (0, React.useRef)(``);
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      let isDocumentPreviewHistoryRoad2 = isDocumentPreviewHistoryRoad({
        historyRoad: historyRoad,
        historyOpen: historyOpen,
        pinned: upto !== undefined,
        warmed: warmed,
        shown: shown,
        intent: intent,
      });
      if (isDocumentPreviewHistoryRoad2 === `off`) {
        setWarmed(false);
        return;
      }
      if (isDocumentPreviewHistoryRoad2 === `now`) {
        labelRef.current = upto === undefined ? `intent` : `pin`;
        setWarmed(true);
        return;
      }
      if (
        isDocumentPreviewHistoryRoad2 === `keep` ||
        isDocumentPreviewHistoryRoad2 === `idle`
      )
        return;
      let window2 = window;
      let filmedProsePageResult8: Dynamic;
      let filmedProsePageResult9: Dynamic;
      let cancelIdleCallback = (..._extraArguments: unknown[]): undefined => {
        if (filmedProsePageResult8 !== undefined) {
          clearTimeout(filmedProsePageResult8);
        }
        if (filmedProsePageResult9 !== undefined) {
          window2.cancelIdleCallback?.(filmedProsePageResult9);
        }
        filmedProsePageResult8 = undefined;
        filmedProsePageResult9 = undefined;
      };
      let cancelIdleCallback2 = (
        filmedProsePage?: Dynamic,
        ..._extraArguments: unknown[]
      ): undefined => {
        cancelIdleCallback();
        filmedProsePageResult8 = setTimeout((..._extraArguments: unknown[]) => {
          filmedProsePageResult8 = undefined;
          let filmedProsePageResult11: Dynamic =
            resolvePlatformKeyboardAndSaveStatusValue3();
          if (filmedProsePageResult11 < 2500)
            return cancelIdleCallback2(
              platformKeyboardAndSaveStatusValue2500 - filmedProsePageResult11,
            );
          labelRef.current = `quiet`;
          if (typeof window2.requestIdleCallback == `function`) {
            filmedProsePageResult9 = window2.requestIdleCallback(
              (..._extraArguments: unknown[]): Dynamic => setWarmed(true),
              {
                timeout: sessionNavigationLimit20002,
              },
            );
          } else {
            setWarmed(true);
          }
        }, filmedProsePage);
      };
      cancelIdleCallback2(platformKeyboardAndSaveStatusValue2500);
      let filmedProsePageResult10: Dynamic = clearPlatformKeyboardAndSaveStatusDelete(
        (..._extraArguments: unknown[]) =>
          cancelIdleCallback2(platformKeyboardAndSaveStatusValue2500),
      );
      return (..._extraArguments: unknown[]): undefined => {
        filmedProsePageResult10();
        cancelIdleCallback();
      };
    },
    [historyRoad, historyOpen, upto, shown, warmed, intent],
  );
  let historyRoad2: Dynamic =
    historyRoad && (upto !== undefined || (historyOpen && warmed));
  let key = documentPreviewKey(pid, fileId, version);
  (0, React.useLayoutEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (shown) {
        resolveObservabilityBootPaint2(`paint`);
      }
      onShown?.({
        key: key,
        shown: shown,
      });
    },
    [shown, key, onShown],
  );
  let leaveWordRef: Dynamic = (0, React.useRef)(null);
  (0, React.useLayoutEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      if (onLeaveProbe) {
        onLeaveProbe(
          key,
          (..._extraArguments: unknown[]): Dynamic => leaveWordRef.current?.(),
        );
        return (..._extraArguments: unknown[]): Dynamic => onLeaveProbe(key, null);
      }
    },
    [key, onLeaveProbe],
  );
  let [viewOnly, onViewOnly2]: Dynamic = (0, React.useState)(false);
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      onViewOnly?.({
        fileId: fileId,
        viewOnly: viewOnly,
      });
    },
    [viewOnly, fileId, onViewOnly],
  );
  let [recordState, setRecordState]: Dynamic = (0, React.useState)({
    gone: false,
    why: null,
  });
  let onPageGone2: Dynamic = (0, React.useCallback)(
    (gone?: Dynamic, why?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      setRecordState(
        (filmedProsePage?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          filmedProsePage.gone === gone && filmedProsePage.why === why
            ? filmedProsePage
            : {
                gone: gone,
                why: why,
              },
      ),
    [],
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      onPageGone?.({
        fileId: fileId,
        gone: recordState.gone,
        why: recordState.why,
      });
    },
    [recordState, fileId, onPageGone],
  );
  let onTabGone2: Dynamic = (0, React.useCallback)(
    (..._extraArguments: unknown[]): Dynamic =>
      onTabGone?.({
        fileId: fileId,
      }),
    [fileId, onTabGone],
  );
  let mode = frameWritable && kind === `prose` ? `edit` : `read`;
  let matchesFileValue2 = fileValue !== undefined;
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      if (!(!frame || !matchesFileValue2))
        return frameViewerLocus({
          mode: mode,
          tab: fileId,
        });
    },
    [frame, matchesFileValue2, mode, fileId],
  );
  if (fileValue === undefined) return null;
  let filmedProsePageResult7: Dynamic;
  filmedProsePageResult7 =
    frame &&
    (fileValue.unported === true ||
      fileValue.content?.kind === `blob` ||
      resolveDataOperationEngineLdoc(fileValue.birthName) === `iron`) ? (
      <FrameUnavailable what={displayName ?? fileValue.birthName} />
    ) : fileValue.content?.kind === `blob` ? (
      <BlobFileView
        room={room}
        blobRef={fileValue.content.blob ?? ``}
        mime={resolveDataOperationEngineApplicationOctetStream(fileValue.birthName)}
        displayName={displayName}
      />
    ) : resolveDataOperationEngineLdoc(fileValue.birthName) === `iron` ? (
      <React.Suspense fallback={<PlatformSyncAndRoutingLabel2 />}>
        <SessionNavigationThen2 room={room} pid={pid} fileId={fileId} filmed={filmed} />
      </React.Suspense>
    ) : fileValue.content?.kind === `text` ? (
      <TextFileView
        text={fileValue.content.text ?? ``}
        mime={resolveDataOperationEngineApplicationOctetStream(fileValue.birthName)}
        scrollKey={documentScrollKey(pid, fileId)}
      />
    ) : fileValue.unbound ? (
      <RoomTabUnbound fileId={fileId} />
    ) : filmed ? (
      filmedProse ? (
        filmedProse(fileId)
      ) : (
        <div
          data-testid={`filmed-prose-unregistered`}
          className={`told--info text-secondary text-footnote p-3`}
        >{`this filmed mount has no prose renderer registered`}</div>
      )
    ) : (
      <RoomDocumentPage
        room={{
          pid: pid,
          fileId: fileId,
          fileValue: fileValue,
        }}
        fsEntryId={fileId}
        container={`project/${pid}`}
        dir={`project/${pid}`}
        path={fileId}
        displayName={displayName}
        version={version}
        readOnly={documentRuntimeReadOnly.readOnly}
        edgeMinLeft={edgeMinLeft}
        leftOverlayHost={leftOverlayHost}
        leftOverlayHeld={leftOverlayHeld}
        onLeftOverlayState={
          matchesFileValue || onLeftOverlayState === undefined
            ? undefined
            : onLeftOverlayState2
        }
        outlineWanted={outlineWanted}
        onOutline={onOutline === undefined ? undefined : onOutline2}
        onOutlineAt={onOutlineAt === undefined ? undefined : onOutlineAt2}
        onOutlineScrolled={onOutlineScrolled2}
        outlineJump={
          outlineJump !== null && outlineJump.fileId === fileId ? outlineJump : null
        }
        bornHere={bornHere}
        commentsReadOnly={documentRuntimeReadOnly.commentsReadOnly}
        commentOnly={documentRuntimeReadOnly.commentOnly}
        onOpenWidgetPanel={(
          filmedProsePage?: Dynamic,
          options?: Dynamic,
          ..._extraArguments: unknown[]
        ): undefined => {
          PlatformSyncAndRoutingState4.getState().set(false);
          let storeState: Dynamic = useCommentStore.getState();
          if (storeState.commentMode === `list`) {
            storeState.setCommentMode(`margin`);
          }
          SessionNavigationPanel.getState().open(filmedProsePage, options);
        }}
        widgetPanelNodeId={SessionNavigationPanel2?.nodeId ?? null}
        objectFiles={objectFiles}
        tabNames={tabNames}
        onOpenWidgetCode={(
          filmedProsePage?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic => SessionNavigationNodeId.getState().open(filmedProsePage)}
        onShown={onShown ? setEnabledState2 : undefined}
        leaving={leaving}
        leaveWordRef={leaveWordRef}
        onViewOnly={onViewOnly2}
        onPageGone={onPageGone2}
        onTabGone={onTabGone2}
        onEscapeToChrome={onEscapeToChrome}
        onTitleCommit={
          onTitleCommit
            ? (
                filmedProsePage?: Dynamic,
                options?: Dynamic,
                ..._extraArguments: unknown[]
              ): Dynamic =>
                onTitleCommit(
                  {
                    pid: pid,
                    fileId: fileId,
                  },
                  filmedProsePage,
                  options,
                )
            : undefined
        }
        onFirstHeading={
          onFirstHeading
            ? (filmedProsePage?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
                onFirstHeading(
                  {
                    pid: pid,
                    fileId: fileId,
                  },
                  filmedProsePage,
                )
            : undefined
        }
        phone={phone}
        hostCommentOffered={hostCommentOffered}
        resolveOwnOnly={frameCommentable && !filmedProsePageResult3}
        shortcutSheet={true}
      />
    );
  return (
    <div className={`flex h-full min-h-0 flex-col`}>
      <div
        ref={setFilmedProsePageState}
        className={`relative flex min-h-0 flex-1 flex-row`}
      >
        <div className={`relative min-w-0 flex-1`}>
          {historyRoad2 && (
            <div
              data-testid={`history-version-pane`}
              data-shown={upto === undefined ? undefined : `1`}
              data-warm-road={labelRef.current}
              className={
                upto === undefined
                  ? `hidden`
                  : (documentPreviewRailOverlay.overlayClass ??
                    `bg-surface-popover dark:bg-surface-0 absolute inset-0 z-10`)
              }
              style={
                upto === undefined ? undefined : documentPreviewRailOverlay.overlayStyle
              }
              inert={
                upto === undefined ||
                (historyOpen && documentPreviewRailOverlay.listCovers === true)
              }
              aria-hidden={
                upto === undefined ||
                (historyOpen && documentPreviewRailOverlay.listCovers === true)
              }
              {...(upto === undefined
                ? {
                    "data-pages-print-skip": ``,
                  }
                : {})}
            >
              {
                <React.Suspense
                  fallback={
                    upto === undefined ? null : (
                      <div className={`bg-alpha-0 h-full animate-pulse`} />
                    )
                  }
                >
                  <SessionNavigationDefault3
                    pid={pid}
                    fileId={fileId}
                    upto={upto}
                    previewId={filmedProsePageResult5?.id}
                    title={fileValue?.birthName || `Document`}
                    envelope={envelope}
                    scrollY={(..._extraArguments: unknown[]): Dynamic =>
                      getDocumentScroll(documentScrollKey(pid, fileId))
                    }
                    stacked={documentPreviewRailOverlay.stacked}
                  />
                </React.Suspense>
              }
            </div>
          )}
          <div
            className={upto === undefined ? `size-full` : `invisible size-full`}
            inert={upto !== undefined || leaving || enabledState}
            {...(upto === undefined
              ? {}
              : {
                  [EditorSelectionAndTablesDataPagesPrintSkip]: ``,
                })}
          >
            {filmedProsePageResult7}
          </div>
        </div>
        {historyRoad && historyOpen && (
          <UseDocumentPreviewSlotElComponent
            slotEl={railSlot}
            inSlot={inSlot}
            onInSlot={onRailInSlot}
            data-testid={`history-rail-seat`}
            onPointerMove={enabledState4 ? undefined : setEnabledState5}
            onFocusCapture={(..._extraArguments: unknown[]): Dynamic =>
              setEnabledState4(true)
            }
            className={
              documentPreviewRailOverlay.seatClass ??
              (embed3
                ? `absolute inset-y-0 right-0 z-20 flex shadow-xl`
                : `flex shrink-0`)
            }
            style={documentPreviewRailOverlay.seatStyle}
          >
            <React.Suspense
              fallback={
                inSlot ? (
                  <div
                    className={`bg-surface-panel h-full shrink-0 border-l`}
                    style={{
                      width: 320,
                    }}
                  />
                ) : null
              }
            >
              <SessionNavigationRightRail
                container={`project/${pid}`}
                version={version ?? `main`}
                roomFile={roomFile}
                stacked={documentPreviewRailOverlay.stacked}
                besideBar={inSlot}
                readOnly={
                  version !== undefined || !!documentRuntimeReadOnly.readOnly || viewOnly
                }
                onLeave={onHistoryLeave}
                onRestore={(filmedProsePage?: Dynamic, ..._extraArguments: unknown[]) => {
                  if (filmedProsePage.upto === undefined) return;
                  let filmedProsePageResult8: Dynamic = viewerId();
                  if (filmedProsePageResult8) {
                    setEnabledState(++countRef.current > 0);
                  }
                  let enabled = !filmedProsePageResult8;
                  let getState = (..._extraArguments: unknown[]): undefined => {
                    if (!enabled) {
                      enabled = true;
                      enabledRef2.current =
                        PlatformSyncAndRoutingAssign2.getState().preview === null;
                      setEnabledState(--countRef.current > 0);
                    }
                  };
                  return loadPlatformLiveDocumentAndHistoryChanged(
                    pid,
                    fileId,
                    filmedProsePage.upto,
                  )
                    .then(
                      async (
                        result?: Dynamic,
                        ..._extraArguments: unknown[]
                      ): Promise<undefined> => {
                        let filmedProsePageResult9: Dynamic =
                          isPlatformLiveDocumentAndHistoryChanged(
                            {
                              pid: pid,
                              fileId: fileId,
                            },
                            result,
                          );
                        if (filmedProsePageResult9 !== null) {
                          await filmedProsePageResult9;
                        }
                        getState();
                        let { changed: result2 }: Dynamic = result;
                        PlatformSyncAndRoutingAssign2.getState().clear();
                        resolvePlatformLiveDocumentAndHistoryRestored(
                          {
                            pid: pid,
                            fileId: fileId,
                          },
                          result2,
                          {
                            toast: (
                              filmedProsePage2?: Dynamic,
                              ..._extraArguments: unknown[]
                            ): Dynamic => toast(filmedProsePage2),
                            touch: (..._extraArguments: unknown[]): Dynamic =>
                              PlatformApiAndAuthTick.getState().touch(),
                            later: (
                              filmedProsePage2?: Dynamic,
                              options?: Dynamic,
                              ..._extraArguments: unknown[]
                            ) => setTimeout(filmedProsePage2, options),
                            dropHead: (..._extraArguments: unknown[]): Dynamic =>
                              PlatformLiveDocumentAndHistoryEntries2.getState().dropOpenHead(
                                {
                                  pid: pid,
                                  fileId: fileId,
                                },
                              ),
                          },
                        );
                      },
                    )
                    .catch(
                      (error?: Dynamic, ..._extraArguments: unknown[]): undefined => {
                        getState();
                        PlatformSyncAndRoutingAssign2.getState().clear();
                        toast.error(
                          resolvePlatformLiveDocumentAndHistoryRestoreFailed(error),
                        );
                      },
                    )
                    .finally(getState);
                }}
                onCopy={
                  frame && placement && onOpenFile
                    ? (preview?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
                        preloadModule(
                          (..._extraArguments: unknown[]): Dynamic =>
                            import("../../document-history/copy").then(
                              (
                                result?: Dynamic,
                                ..._extraArguments: unknown[]
                              ): Dynamic =>
                                result.copyVersionToTab({
                                  room: room,
                                  view: placement,
                                  pid: pid,
                                  fileId: fileId,
                                  preview: preview,
                                  locale: filmedProsePageResult.locale,
                                  timeZone: filmedProsePageResult.timeZone,
                                  open: onOpenFile,
                                }),
                            ),
                          mapPreloadDependencies([47, 0, 1, 2, 3, 10]),
                          import.meta.url,
                        )
                    : undefined
                }
              />
            </React.Suspense>
          </UseDocumentPreviewSlotElComponent>
        )}
        {!filmed2 && SessionNavigationPanel2 && (
          <React.Suspense
            fallback={
              <div
                className={`bg-surface-panel text-muted text-footnote w-[320px] max-w-[calc(100%-340px)] shrink-0 border-l p-3`}
              >{`Loading widget panel…`}</div>
            }
          >
            <SessionNavigationDefault
              container={`project/${pid}`}
              dir={`project/${pid}`}
              fsEntryId={fileId}
              nodeId={SessionNavigationPanel2.nodeId}
              onClose={(..._extraArguments: unknown[]): Dynamic =>
                SessionNavigationPanel.getState().close()
              }
              onOpenCode={(
                filmedProsePage?: Dynamic,
                ..._extraArguments: unknown[]
              ): Dynamic => SessionNavigationNodeId.getState().open(filmedProsePage)}
              room={room2}
              onOpenRef={(file?: Dynamic, ..._extraArguments: unknown[]): undefined => {
                updateDataModelSchemasPath({
                  file: file,
                });
              }}
              key={`${fileId}/${SessionNavigationPanel2.nodeId}`}
            />
          </React.Suspense>
        )}
      </div>
      {!filmed2 && nodeId !== null && (
        <React.Suspense fallback={null}>
          <SessionNavigationDefault2
            container={`project/${pid}`}
            dir={`project/${pid}`}
            fsEntryId={fileId}
            nodeId={nodeId}
            room={room2}
            onClose={(..._extraArguments: unknown[]): Dynamic =>
              SessionNavigationNodeId.getState().close()
            }
          />
        </React.Suspense>
      )}
    </div>
  );
};

export const BlobFileView: ReactComponentTypes.FC<Dynamic> = ({
  room: room,
  blobRef: blobRef,
  mime: mime,
  displayName: displayName,
}) => {
  let blobFileViewResult: Dynamic = resolvePlatformSyncAndRoutingCompact();
  let blobRefSlice: Dynamic = blobRef.startsWith(`blob/`) ? blobRef.slice(5) : blobRef;
  let [blobFileViewState, setBlobFileViewState]: Dynamic = (0, React.useState)();
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      let enabled = true;
      setBlobFileViewState(undefined);
      room
        .read(
          {
            object: `blob`,
            id: blobRefSlice,
          },
          `blob`,
        )
        .then(
          (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
            enabled && setBlobFileViewState(result),
        )
        .catch(
          (..._extraArguments: unknown[]): Dynamic =>
            enabled && setBlobFileViewState(null),
        );
      return (..._extraArguments: unknown[]): undefined => {
        enabled = false;
      };
    },
    [room, blobRefSlice],
  );
  if (blobFileViewState === undefined) return null;
  let mime2: Dynamic =
    typeof blobFileViewState?.mime == `string` && blobFileViewState.mime !== ``
      ? blobFileViewState.mime
      : mime;
  let sha256: Dynamic = blobFileViewState?.sha256;
  if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256))
    return (
      <div className={`text-secondary text-caption p-md`}>
        {`Blob record unavailable (`}
        {mime || `unknown`}
        {`).`}
      </div>
    );
  let src: Dynamic = resolvePlatformApiAndAuthValue(`/api/blob/${sha256}`);
  return mime2.startsWith(`image/`) ? (
    <ImagePreview src={src} />
  ) : mime2 === `application/pdf` ? (
    <PdfPreview src={src} />
  ) : (
    <div className={`p-md flex h-full items-center justify-center`}>
      <div
        data-testid={`blob-file-view`}
        className={`bg-surface-1 gap-md p-md flex min-w-64 flex-col items-start rounded-md border shadow-sm`}
      >
        <div className={`gap-md flex items-center`}>
          <UiOverlaysAndIconsCustomIcon name={`File`} customSize={20} />
          <div className={`flex flex-col`}>
            <span className={`text-primary text-body`}>{displayName ?? `Download`}</span>
            <span className={`text-secondary text-caption`}>
              {mime2 || `application/octet-stream`}
              {` · `}
              {resolveObservabilityBrowserAndOperationEventsToFixed(
                blobFileViewState?.bytes ?? 0,
              )}
            </span>
          </div>
        </div>
        <Button
          variant={`secondary`}
          size={blobFileViewResult(`sm`)}
          href={src}
          download={displayName ?? true}
        >
          <UiOverlaysAndIconsCustomIcon name={`Download`} customSize={14} />
          {`Download`}
        </Button>
      </div>
    </div>
  );
};

export const TextFileView: ReactComponentTypes.FC<{
  text: string;
  mime?: string;
  scrollKey: string;
}> = ({
  text: text,
  mime: mime,
  scrollKey: scrollKey,
}) => {
  let elementRef = useRef<HTMLPreElement | null>(null);
  (0, React.useLayoutEffect)(
    (..._extraArguments: unknown[]): undefined => {
      let documentScroll: Dynamic = getDocumentScroll(scrollKey);
      if (documentScroll !== undefined && elementRef.current) {
        elementRef.current.scrollTop = documentScroll;
      }
    },
    [scrollKey],
  );
  return (
    <div className={`flex h-full min-h-0 flex-col`}>
      <div
        className={`bg-surface-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border shadow-sm`}
      >
        <div
          className={`text-secondary text-caption gap-md px-md flex shrink-0 items-center border-b py-1.5`}
        >
          <span>{mime || `text/plain`}</span>
          <span className={`text-muted`}>{`read-only`}</span>
        </div>
        <pre
          ref={elementRef}
          data-testid={`text-file-view`}
          className={`text-primary p-md text-code min-h-0 flex-1 overflow-auto whitespace-pre-wrap`}
          onScroll={(event: ReactComponentTypes.UIEvent<HTMLPreElement>, ..._extraArguments: unknown[]) =>
            rememberDocumentScroll(scrollKey, event.currentTarget.scrollTop)
          }
        >
          {text}
        </pre>
      </div>
    </div>
  );
};

export const ChatPill: ReactComponentTypes.FC<Dynamic> = ({
  pid: pid,
  currentFile: currentFile,
}) => {
  let chatPillResult: Dynamic = PlatformRuntimeAndChatAssign(
    (chatPill?: Dynamic, ..._extraArguments: unknown[]): Dynamic => chatPill.mode,
  );
  let chatPillResult2: Dynamic = PlatformRuntimeAndChatAssign(
    (chatPill?: Dynamic, ..._extraArguments: unknown[]): Dynamic => chatPill.set,
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      chatPillResult2(`pill`);
    },
    [pid, chatPillResult2],
  );
  let chatPillResult3: Dynamic = EditorSelectionAndTablesSelection2(
    (chatPill?: Dynamic, ..._extraArguments: unknown[]): Dynamic => chatPill.revealNonce,
  );
  let chatPillResultRef: Dynamic = (0, React.useRef)(chatPillResult3);
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (chatPillResult3 !== chatPillResultRef.current) {
        chatPillResultRef.current = chatPillResult3;
        chatPillResult2(resolvePlatformRuntimeAndChatPill(chatPillResult));
      }
    },
    [chatPillResult3, chatPillResult, chatPillResult2],
  );
  let chatPillResult4: Dynamic = useDataOperationControlRawStart({
    key: `chatWidth`,
    initial: 400,
    min: 280,
    max: 700,
    edge: `right`,
  });
  // BaoCut: 独立页面没有原版的对话栏（点了只出一块空白、挡住左下角的浮层）。宿主装了 docsHost.chat 时一直是按钮，点了交给宿主
  // （BaoCut 把焦点交给会话的输入框）；BaoCut 的页面单独打开、不在会话里（有 comments 没有 chat）时不显示。
  let baocutHost: boolean = standaloneDocsHost() !== null;
  let hostChat: Dynamic = baocutHost ? standaloneDocsChat() : null;
  if (baocutHost && !hostChat) return null;
  return pid ? (
    hostChat || chatPillResult === `pill` ? (
      <div className={`absolute bottom-4 left-4 z-30`}>
        <button
          type={`button`}
          data-chat-pill={true}
          data-testid={`chat-pill`}
          aria-label={`Ask Agent`}
          onClick={(..._extraArguments: unknown[]): Dynamic =>
            hostChat ? hostChat.focus() : chatPillResult2(`floating`)
          }
          className={`bg-surface-popover text-primary hover:after:bg-alpha-1 relative flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium shadow-lg after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:transition-colors after:content-['']`}
        >
          <UiOverlaysAndIconsCustomIcon
            name={`Chat`}
            size={`sm`}
            className={`text-secondary`}
          />
          {`Ask Agent`}
        </button>
      </div>
    ) : chatPillResult === `floating` ? (
      <div
        className={`absolute bottom-4 left-4 z-30 h-[32rem] w-96 max-md:inset-3 max-md:h-auto max-md:w-auto`}
        data-testid={`room-chat`}
      >
        <React.Suspense fallback={null}>
          <SessionNavigationThen pid={pid} currentFile={currentFile} />
        </React.Suspense>
      </div>
    ) : (
      <div
        className={`relative hidden min-w-0 shrink-0 flex-col p-3 md:flex`}
        style={{
          width: chatPillResult4.width,
          maxWidth: `calc(100vw - 340px)`,
        }}
        data-testid={`room-chat`}
      >
        <React.Suspense fallback={null}>
          <SessionNavigationThen pid={pid} currentFile={currentFile} />
        </React.Suspense>
        <PaneResizeHandle
          {...chatPillResult4.handleProps}
          side={`right`}
          label={`Resize chat`}
        />
      </div>
    )
  ) : null;
};

export const RoutineInflightChip: ReactComponentTypes.FC<Dynamic> = ({ run: run }) => {
  return (
    <span
      data-testid={`routine-inflight-chip`}
      className={`bg-alpha-1 text-secondary text-caption flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5`}
    >
      <UseDocumentPreviewStatusComponent
        status={run.status === `staged` ? `warning` : undefined}
        running={run.status === `running`}
      />
      {ApplicationRoutesStaged[run.status] ?? run.status}
    </span>
  );
};

var applicationRoutesLimit640: number;

var ApplicationRoutesSet: Dynamic;

var applicationRoutesLimit0: number;

function resolveApplicationRoutesKind(
  entry?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return isRoutineFeedUpdate(entry)
    ? true
    : entry.kind === `envelope`
      ? entry.envelope.diff.some(
          (diff?: Dynamic, ..._extraArguments: unknown[]) =>
            diff.address?.ref?.object === `run`,
        )
      : false;
}

var ApplicationRoutesStaged: Readonly<Record<string, string>>;

var applicationRoutesSet: Set<string>;

var resolveApplicationRoutesRuns: (row: { runs?: readonly RoutineRun[] | null }) => RoutineRun | undefined;

var ApplicationRoutes_Styles: string;

// BaoCut: called by docs-app-initialize in the recovered source order.
export function initializeApplicationRoutesFilmedProsePageStep1(): void {
  (applicationRoutesLimit640 = 640);
  (ApplicationRoutesSet = {
    set: (
      applicationRoutesSet2?: Dynamic,
      options?: Dynamic,
      ..._extraArguments: unknown[]
    ) => setTimeout(applicationRoutesSet2, options),
    clear: (applicationRoutesSet2?: Dynamic, ..._extraArguments: unknown[]) =>
      clearTimeout(applicationRoutesSet2),
  });
  (applicationRoutesLimit0 = 0);
  (ApplicationRoutesStaged = {
    staged: `Staged for review`,
    pending: `Queued`,
    running: `Running…`,
    done: `Done`,
    error: `Failed`,
    cancelled: `Cancelled`,
  });
  (applicationRoutesSet = new Set<string>([
    `staged`,
    `pending`,
    `running`,
  ]));
  (resolveApplicationRoutesRuns = (row) =>
    row.runs?.find(run => applicationRoutesSet.has(run.status)));
  (ApplicationRoutes_Styles = `hover:bg-alpha-1 data-[popup-open]:bg-alpha-1 text-primary flex min-w-0 cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[13px] font-semibold transition-colors outline-none`);
}

export { ApplicationRoutesSet, ApplicationRoutesStaged, ApplicationRoutes_Styles, applicationRoutesSet, resolveApplicationRoutesKind, resolveApplicationRoutesRuns };
