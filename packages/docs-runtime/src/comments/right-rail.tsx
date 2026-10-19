/** right-rail: restored from RightRail-BuctNQEl.js. */

import type { Dynamic } from "../interop/legacy-dynamic";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type * as ReactComponentTypes from "react";

export const VersionHistoryPanel: ReactComponentTypes.FC<Dynamic> = ({
  container: container,
  version: version,
  path: path,
  pageId: pageId,
  roomFile: roomFile,
  onRestore: onRestore,
  onCopy: onCopy,
  readOnly: readOnly,
  diffV2: diffV2,
  redline: redline,
  stacked: stacked,
  onLeave: onLeave,
}) => {
  let versionHistoryPanelResult: Dynamic = resolvePlatformApiAndAuthUseContext2();
  let containerAtVersion2: string = containerAtVersion(container, version);
  let versionHistoryPanelResult2: Dynamic = resolvePlatformSyncAndRoutingValue22();
  let diffV22: Dynamic = diffV2 ?? versionHistoryPanelResult2;
  let versionHistoryPanelResult3: Dynamic = resolvePlatformSyncAndRoutingValue24();
  let versionHistoryPanelResult4: Dynamic =
    diffV2 === undefined ? versionHistoryPanelResult3 : diffV2 && isFrameArtifact();
  let versionHistoryPanelResult5: Dynamic = resolvePlatformSyncAndRoutingValue26();
  let redline2: Dynamic =
    (redline ?? versionHistoryPanelResult5) && versionHistoryPanelResult4;
  let versionHistoryPanelResult6: Dynamic = resolvePlatformSyncAndRoutingPreview();
  let elementRef: Dynamic = (0, React.useRef)(null);
  let [enabledState, setEnabledState]: Dynamic = (0, React.useState)(false);
  let elementRef2: Dynamic = (0, React.useRef)(null);
  let elementRef3: Dynamic = (0, React.useRef)(null);
  let elementRef4: Dynamic = (0, React.useRef)(null);
  let controlId: Dynamic = (0, React.useId)();
  let error: Dynamic = PlatformLiveDocumentAndHistoryEntries2(
    (versionHistoryPanel?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      versionHistoryPanel.entries[controlId] ?? `loading`,
  );
  let versionHistoryPanelResult7: Dynamic = usePlatformLiveDocumentAndHistoryPid2(
    diffV22 && roomFile ? roomFile.pid : ``,
    roomFile?.fileId,
  );
  let versionHistoryPanelResultRef: Dynamic = (0, React.useRef)(
    versionHistoryPanelResult7,
  );
  versionHistoryPanelResultRef.current = versionHistoryPanelResult7;
  let versionHistoryPanelResult8: Dynamic = PlatformLiveDocumentAndHistoryEntries2(
    (versionHistoryPanel?: Dynamic, ..._extraArguments: unknown[]) =>
      versionHistoryPanel.more[controlId] === true,
  );
  let [enabledState2, setEnabledState2]: Dynamic = (0, React.useState)(false);
  let versionHistoryPanelHandler = async (
    ..._extraArguments: unknown[]
  ): Promise<undefined> => {
    setEnabledState2(true);
    try {
      await PlatformLiveDocumentAndHistoryEntries2.getState().loadOlder(controlId, {
        ctr: containerAtVersion2,
        version: version,
        path: path,
        pageId: pageId,
        roomFile: roomFile,
      });
    } finally {
      setEnabledState2(false);
    }
  };
  let activity: Dynamic = PlatformSyncAndRoutingAssign2(
    (versionHistoryPanel?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      versionHistoryPanel.preview,
  );
  let id: Dynamic = activity?.id ?? null;
  let [enabledState3, setEnabledState3]: Dynamic = (0, React.useState)(false);
  let [enabledState4, setEnabledState4]: Dynamic = (0, React.useState)(false);
  let onLeave2: Dynamic = diffV22 && !stacked ? onLeave : undefined;
  let record: Dynamic = (0, React.useRef)({
    pressed: false,
    held: null,
  }).current;
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (enabledState3) {
        cancelActivationPress(record);
      }
    },
    [enabledState3, record],
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic =>
      (..._extraArguments: unknown[]): Dynamic =>
        cancelActivationPress(record),
    [record],
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      setEnabledState3(elementRef4.current !== null && elementRef4.current === id);
      elementRef4.current = null;
    },
    [id],
  );
  let versionFilePath2: string = activity
    ? versionFilePath(container, version, activity.path || path || ``)
    : ``;
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      PlatformLiveDocumentAndHistoryEntries2.getState().load(controlId, {
        ctr: containerAtVersion2,
        version: version,
        path: path,
        pageId: pageId,
        roomFile: roomFile,
      });
    },
    [
      controlId,
      containerAtVersion2,
      path,
      version,
      PlatformApiAndAuthTick(
        (versionHistoryPanel?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          versionHistoryPanel.tick,
      ),
      pageId,
      roomFile,
    ],
  );
  let pid: Dynamic = roomFile?.pid;
  let fileId: Dynamic = roomFile?.fileId;
  let isArray: boolean = Array.isArray(error) && error.length > 0;
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (
        !(
          !versionHistoryPanelResult4 ||
          pid === undefined ||
          fileId === undefined ||
          !isArray
        )
      ) {
        preloadModule(
          (..._extraArguments: unknown[]): Dynamic =>
            import("../platform/lazy")
              .then(
                (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
                  result.versionXmlModule,
              )
              .then(
                (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
                  result.prewarmNewestVersion(pid, fileId),
                (..._extraArguments: unknown[]): undefined => undefined,
              ),
          mapPreloadDependencies([0, 1, 2, 3, 4]),
          import.meta.url,
        );
      }
    },
    [versionHistoryPanelResult4, pid, fileId, isArray],
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic =>
      (..._extraArguments: unknown[]): Dynamic =>
        PlatformLiveDocumentAndHistoryEntries2.getState().release(controlId),
    [controlId],
  );
  usePrimeContributorAccounts(error);
  let {
    sections: memoized,
    headId: memoized2,
    indexed: memoized3,
    prevShaOf: memoized4,
    prevPathOf: memoized5,
    olderRowOf: memoized6,
  }: Dynamic = (0, React.useMemo)(
    (..._extraArguments: unknown[]): Dynamic => {
      let lookup: Dynamic = new (Map as Dynamic)();
      let lookup2: Dynamic = new (Map as Dynamic)();
      let lookup3: Dynamic = new (Map as Dynamic)();
      if (!Array.isArray(error))
        return {
          sections: [],
          headId: null,
          indexed: false,
          prevShaOf: lookup,
          prevPathOf: lookup2,
          olderRowOf: lookup3,
        };
      let toSorted: Dynamic = error
        .filter(
          (error2?: Dynamic, ..._extraArguments: unknown[]): boolean =>
            error2.tool === `v3.checkpoint` || versionShaOf(error2) !== null,
        )
        .toSorted(
          (
            activity3?: Dynamic,
            activity4?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic => activity4.at.localeCompare(activity3.at),
        );
      let filteredToSorted: Dynamic = toSorted.filter(
        (toSorted2?: Dynamic, index?: Dynamic, ..._extraArguments: unknown[]) => {
          if (index === 0) return true;
          let toSortedItem: Dynamic = toSorted[index - 1];
          let matchesVersionShaOf: boolean =
            versionShaOf(toSorted2) === versionShaOf(toSortedItem);
          let matchesTool: boolean =
            toSorted2.tool === `lfile.checkpoint` ||
            toSortedItem.tool === `lfile.checkpoint`;
          return !(matchesVersionShaOf && matchesTool);
        },
      );
      let tool: Dynamic = filteredToSorted[0]?.tool;
      let diffV29: Dynamic = diffV22 && hasVersionEvents(filteredToSorted);
      let filteredToSortedItem: Dynamic = filteredToSorted[0];
      let id3: Dynamic = diffV29
        ? (currentVersionId(filteredToSorted) ??
          (filteredToSortedItem !== undefined &&
          versionHistoryPanelResult7 !== undefined &&
          resolvePlatformLiveDocumentAndHistoryParams2(filteredToSortedItem) ===
            versionHistoryPanelResult7
            ? filteredToSortedItem.id
            : null))
        : // BaoCut: 文档服务把最新一版标成 cause: 'current'（packages/docs 的 versions.ts）；没开 versionHistoryV2 也认它是现在这一版，
          // 不给「回到这个版本」。
          tool === `v3.checkpoint`
          ? currentVersionId(filteredToSorted)
          : tool === `lfile.checkpoint`
            ? null
            : (filteredToSortedItem?.id ?? null);
      for (let index: number = 0; index < filteredToSorted.length; index++) {
        let filteredToSortedItem2: Dynamic = filteredToSorted[index + 1];
        lookup.set(
          filteredToSorted[index].id,
          filteredToSortedItem2 ? versionShaOf(filteredToSortedItem2) : null,
        );
        lookup2.set(
          filteredToSorted[index].id,
          filteredToSortedItem2 ? versionPathOf(filteredToSortedItem2, path ?? ``) : null,
        );
        lookup3.set(filteredToSorted[index].id, filteredToSortedItem2);
      }
      if (diffV22) {
        let versionHistoryPanelResult18: Dynamic = makeHistoryDayLabeler(
          new (Date as Dynamic)(versionHistoryPanelResult.now()),
          versionHistoryPanelResult.locale,
          versionHistoryPanelResult.timeZone,
        );
        let versionHistoryPanelHandler20: Dynamic = (
          activity3?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic => versionHistoryPanelResult18(activity3.at);
        let items2: Dynamic = [];
        let versionHistoryPanelHandler21 = (
          versionHistoryPanel?: Dynamic,
          ..._extraArguments: unknown[]
        ) => historyActionLabel(versionHistoryPanel) !== null;
        let versionHistoryPanelResult19: Dynamic = diffV29
          ? historyRows(filteredToSorted, {
              isEvent: versionHistoryPanelHandler21,
              dayOf: versionHistoryPanelHandler20,
            })
          : groupCheckpointHistory(filteredToSorted, {
              isEvent: versionHistoryPanelHandler21,
              dayOf: versionHistoryPanelHandler20,
            });
        for (let versionHistoryPanelResult20 of versionHistoryPanelResult19 as Dynamic) {
          let versionHistoryPanelHandler22: Dynamic = versionHistoryPanelHandler20(
            versionHistoryPanelResult20.items[0],
          );
          let itemItem: Dynamic = items2[items2.length - 1];
          if (itemItem?.day === versionHistoryPanelHandler22) {
            itemItem.groups.push(versionHistoryPanelResult20);
          } else {
            items2.push({
              day: versionHistoryPanelHandler22,
              groups: [versionHistoryPanelResult20],
            });
          }
        }
        return {
          sections: items2,
          headId: id3,
          indexed: diffV29,
          prevShaOf: lookup,
          prevPathOf: lookup2,
          olderRowOf: lookup3,
        };
      }
      let items: Dynamic = [];
      let versionHistoryPanelResult17: Dynamic = makeHistoryDayLabeler(
        new (Date as Dynamic)(versionHistoryPanelResult.now()),
        versionHistoryPanelResult.locale,
        versionHistoryPanelResult.timeZone,
      );
      for (let activity3 of filteredToSorted as Dynamic) {
        let versionHistoryPanelResult18: Dynamic = versionHistoryPanelResult17(
          activity3.at,
        );
        let itemItem: Dynamic = items[items.length - 1];
        if (itemItem?.day === versionHistoryPanelResult18) {
          itemItem.items.push(activity3);
        } else {
          items.push({
            day: versionHistoryPanelResult18,
            items: [activity3],
          });
        }
      }
      return {
        sections: items.map(
          (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
            day: item.day,
            groups: groupHistoryByActor(item.items, {
              // BaoCut: 文档服务的每一行已经是分好的版本（checkpoint.stored，packages/docs 的 versions.ts），各自一行，
              // 不再按 5 分钟与改动者合并。
              isSingleton: (
                versionHistoryPanel?: Dynamic,
                ..._extraArguments: unknown[]
              ) =>
                historyActionLabel(versionHistoryPanel) !== null ||
                isCheckpointBoundary(versionHistoryPanel),
            }),
          }),
        ),
        headId: id3,
        indexed: diffV29,
        prevShaOf: lookup,
        prevPathOf: lookup2,
        olderRowOf: lookup3,
      };
    },
    [error, path, versionHistoryPanelResult, diffV22, versionHistoryPanelResult7],
  );
  let memoized7: Dynamic = (0, React.useMemo)(
    (..._extraArguments: unknown[]): Dynamic =>
      id === null
        ? undefined
        : memoized
            .flatMap(
              (memoized13?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
                memoized13.groups,
            )
            .find(
              (flatMap2?: Dynamic, ..._extraArguments: unknown[]): boolean =>
                flatMap2.items.length > 1 && historyGroupId(flatMap2) === id,
            ),
    [memoized, id],
  );
  let id2: Dynamic =
    memoized7 === undefined
      ? activity?.group === undefined
        ? id
        : null
      : memoized7.items[0].id;
  let memoized8: Dynamic =
    memoized3 && activity != null && activity.group === undefined && activity.isCurrent;
  let recordRef: Dynamic = (0, React.useRef)({
    id: null,
    currentRow: false,
  });
  if (recordRef.current.id !== id && Array.isArray(error)) {
    let error2: Dynamic =
      id === null
        ? undefined
        : error.find(
            (error3?: Dynamic, ..._extraArguments: unknown[]) => error3.id === id,
          );
    recordRef.current = {
      id: id,
      currentRow:
        memoized3 &&
        error2 !== undefined &&
        resolvePlatformLiveDocumentAndHistoryParams(error2) === `current`,
    };
  }
  let recordRef2: Dynamic = (0, React.useRef)({
    id: null,
    rev: undefined,
  });
  if (recordRef2.current.id !== id) {
    recordRef2.current = {
      id: id,
      rev: versionHistoryPanelResult7,
    };
  }
  let elementRef5: Dynamic = (0, React.useRef)(null);
  let versionHistoryPanelHandler2: Dynamic = (
    versionHistoryPanel?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let itemItem: Dynamic = versionHistoryPanel.items[0];
    let itemItem2: Dynamic =
      versionHistoryPanel.items[versionHistoryPanel.items.length - 1];
    return historyGroupPreview(versionHistoryPanel, {
      isCurrent: itemItem.id === memoized2,
      prevSha: memoized4.get(itemItem2.id) ?? null,
      path: versionPathOf(itemItem, path ?? ``),
      prevPath: memoized5.get(itemItem2.id) ?? null,
      base: groupComparisonBase(
        versionHistoryPanel,
        memoized3,
        (versionHistoryPanel2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          memoized6.get(versionHistoryPanel2),
        versionHistoryPanelResult8,
      ),
    });
  };
  let versionHistoryPanelHandler3: Dynamic = (
    versionHistoryPanel?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    memoized3
      ? rowComparisonBase(
          versionHistoryPanel,
          memoized3,
          memoized6.get(versionHistoryPanel.id),
          versionHistoryPanelResult8,
        )
      : undefined;
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (!diffV22 || activity?.group === undefined || id === null) return;
      let historyGroupHeadId2: Dynamic = historyGroupHeadId(id);
      let memoized13: Dynamic =
        memoized7 ??
        memoized
          .flatMap(
            (memoized14?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              memoized14.groups,
          )
          .find(
            (flatMap2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              flatMap2.items.length > 1 &&
              flatMap2.items.some(
                (item?: Dynamic, ..._extraArguments: unknown[]) =>
                  item.id === historyGroupHeadId2,
              ),
          );
      if (memoized13 === undefined) {
        if (
          Array.isArray(error) &&
          error.some(
            (error2?: Dynamic, ..._extraArguments: unknown[]) =>
              error2.id === historyGroupHeadId2,
          )
        ) {
          PlatformSyncAndRoutingAssign2.getState().clear();
        }
        return;
      }
      let versionHistoryPanelHandler20: Dynamic = versionHistoryPanelHandler2(memoized13);
      if (
        !(
          versionHistoryPanelHandler20 === null ||
          versionHistoryPanelHandler20.group === undefined ||
          (versionHistoryPanelHandler20.id === activity.id &&
            versionHistoryPanelHandler20.upto === activity.upto &&
            versionHistoryPanelHandler20.at === activity.at &&
            versionHistoryPanelHandler20.isCurrent === activity.isCurrent &&
            versionHistoryPanelHandler20.group.count === activity.group.count &&
            JSON.stringify(versionHistoryPanelHandler20.group.base) ===
              JSON.stringify(activity.group.base))
        )
      ) {
        PlatformSyncAndRoutingAssign2.getState().reissue(versionHistoryPanelHandler20);
      }
    },
    [diffV22, memoized, error, versionHistoryPanelResult8, memoized7, activity, id],
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (
        !diffV22 ||
        !memoized3 ||
        activity == null ||
        activity.group !== undefined ||
        id === null ||
        !Array.isArray(error)
      )
        return;
      let error2: Dynamic = error.find(
        (error3?: Dynamic, ..._extraArguments: unknown[]) => error3.id === id,
      );
      if (error2 === undefined) return;
      let versionHistoryPanelHandler20: Dynamic = versionHistoryPanelHandler3(error2);
      if (
        !(
          versionHistoryPanelHandler20 === undefined ||
          (activity.base !== undefined &&
            JSON.stringify(versionHistoryPanelHandler20) ===
              JSON.stringify(activity.base))
        )
      ) {
        PlatformSyncAndRoutingAssign2.getState().reissue({
          ...activity,
          base: versionHistoryPanelHandler20,
        });
      }
    },
    [diffV22, memoized3, error, versionHistoryPanelResult8, activity, id],
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (
        !diffV22 ||
        !memoized3 ||
        activity == null ||
        activity.group !== undefined ||
        id === null ||
        !Array.isArray(error)
      )
        return;
      let error2: Dynamic = error.find(
        (error3?: Dynamic, ..._extraArguments: unknown[]) => error3.id === id,
      );
      let matchesId: boolean = id === memoized2;
      if (recordRef.current.id === id && recordRef.current.currentRow) {
        if (
          (matchesId &&
            error2 !== undefined &&
            resolvePlatformLiveDocumentAndHistoryParams(error2) === `current`) ||
          memoized2 === null
        )
          return;
        let error3: Dynamic = error.find(
          (error4?: Dynamic, ..._extraArguments: unknown[]) => error4.id === memoized2,
        );
        if (error3 === undefined) return;
        let rowComparisonBase2: Dynamic = rowComparisonBase(
          error3,
          memoized3,
          memoized6.get(error3.id),
          versionHistoryPanelResult8,
        );
        let versionPreviewOf2: Dynamic = versionPreviewOf(error3, {
          isCurrent: true,
          prevSha: memoized4.get(error3.id) ?? null,
          path: versionPathOf(error3, path ?? ``),
          prevPath: memoized5.get(error3.id) ?? null,
          base: rowComparisonBase2,
        });
        if (versionPreviewOf2 === null) return;
        if (versionPreviewOf2.id === id) {
          if (!activity.isCurrent) {
            PlatformSyncAndRoutingAssign2.getState().reissue(versionPreviewOf2);
          }
          return;
        }
        recordRef.current = {
          id: versionPreviewOf2.id,
          currentRow: true,
        };
        recordRef2.current = {
          id: versionPreviewOf2.id,
          rev: recordRef2.current.rev,
        };
        if (elementRef5.current !== null && elementRef5.current.id === id) {
          elementRef5.current = {
            ...elementRef5.current,
            id: versionPreviewOf2.id,
          };
        }
        let matchesRev: boolean =
          recordRef2.current.rev !== versionHistoryPanelResultRef.current;
        PlatformSyncAndRoutingAssign2.getState().set(versionPreviewOf2);
        if (matchesRev) {
          updatePlatformSyncAndRoutingHeadDrivenId(versionPreviewOf2.id);
        }
        return;
      }
      if (error2 !== undefined) {
        if (activity.isCurrent && !matchesId) {
          PlatformSyncAndRoutingAssign2.getState().reissue({
            ...activity,
            isCurrent: false,
          });
        } else {
          if (!activity.isCurrent && matchesId) {
            PlatformSyncAndRoutingAssign2.getState().reissue({
              ...activity,
              isCurrent: true,
            });
          }
        }
      }
    },
    [
      diffV22,
      memoized3,
      memoized2,
      activity,
      id,
      error,
      memoized4,
      memoized5,
      memoized6,
      versionHistoryPanelResult8,
      path,
    ],
  );
  let memoized9: Dynamic = (0, React.useMemo)(
    (..._extraArguments: unknown[]): Dynamic => {
      if (!Array.isArray(error) || memoized2 === null) return;
      let error2: Dynamic = error.find(
        (error3?: Dynamic, ..._extraArguments: unknown[]) => error3.id === memoized2,
      );
      return error2 === undefined
        ? undefined
        : resolvePlatformLiveDocumentAndHistoryParams2(error2);
    },
    [error, memoized2],
  );
  let diffV23: Dynamic =
    diffV22 &&
    memoized3 &&
    activity != null &&
    activity.group === undefined &&
    id !== null;
  let matchesMemoized: Dynamic =
    memoized2 === null || (memoized8 && memoized9 !== versionHistoryPanelResult7);
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      if (!diffV23 || versionHistoryPanelResult7 === undefined || !matchesMemoized)
        return;
      let id3: Dynamic = memoized8 ? id : null;
      let element: Dynamic = elementRef5.current;
      return element !== null &&
        element.key === controlId &&
        element.rev === versionHistoryPanelResult7 &&
        (element.id === id3 || id3 === null)
        ? undefined
        : scheduleRestorePress(
            recordRef2.current.rev === versionHistoryPanelResult7
              ? 0
              : RESTORE_PRESS_HOLD_MS,
            (..._extraArguments: unknown[]): undefined => {
              elementRef5.current = {
                key: controlId,
                id: id3,
                rev: versionHistoryPanelResult7,
              };
              let id4: Dynamic = id;
              PlatformLiveDocumentAndHistoryEntries2.getState()
                .load(controlId, {
                  ctr: containerAtVersion2,
                  version: version,
                  path: path,
                  pageId: pageId,
                  roomFile: roomFile,
                })
                .then((..._extraArguments: unknown[]): undefined => {
                  let preview: Dynamic = PlatformSyncAndRoutingAssign2.getState().preview;
                  if (
                    preview !== null &&
                    preview.id === id4 &&
                    preview.isCurrent &&
                    preview.group === undefined
                  ) {
                    updatePlatformSyncAndRoutingHeadEpoch();
                  }
                });
            },
          );
    },
    [
      diffV23,
      matchesMemoized,
      memoized8,
      versionHistoryPanelResult7,
      id,
      controlId,
      containerAtVersion2,
      version,
      path,
      pageId,
      roomFile,
    ],
  );
  let [uniqueItemsState, setUniqueItemsState]: Dynamic = (0, React.useState)(
    new (Set as Dynamic)(),
  );
  let versionHistoryPanelHandler4: Dynamic = (
    versionHistoryPanel?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    setUniqueItemsState(
      (versionHistoryPanel2?: Dynamic, ..._extraArguments: unknown[]): Dynamic => {
        let uniqueItems: Dynamic = new (Set as Dynamic)(versionHistoryPanel2);
        for (let versionHistoryPanelResult17 of versionHistoryPanel.items as Dynamic)
          if (options) {
            uniqueItems.add(versionHistoryPanelResult17.id);
          } else {
            uniqueItems.delete(versionHistoryPanelResult17.id);
          }
        return uniqueItems;
      },
    );
  let diffV24: Dynamic = diffV22 && onCopy !== undefined && !readOnly;
  let [enabledState5, setEnabledState5]: Dynamic = (0, React.useState)(false);
  let enabledRef: Dynamic = (0, React.useRef)(false);
  let callback: Dynamic = (0, React.useCallback)(
    (versionHistoryPanel?: Dynamic, ..._extraArguments: unknown[]): undefined => {
      let versionHistoryPanel2: Dynamic = versionHistoryPanel ?? activity;
      if (!(versionHistoryPanel2 == null || onCopy === undefined || enabledRef.current)) {
        enabledRef.current = true;
        setEnabledState5(true);
        Promise.resolve()
          .then((..._extraArguments: unknown[]): Dynamic => onCopy(versionHistoryPanel2))
          .finally((..._extraArguments: unknown[]): undefined => {
            enabledRef.current = false;
            setEnabledState5(false);
          });
      }
    },
    [activity, onCopy],
  );
  let versionHistoryPanelResult9: Dynamic = resolvePlatformLiveDocumentAndHistoryBars();
  let versionHistoryPanelHandler5: Dynamic = (
    versionHistoryPanel?: Dynamic,
    options: Dynamic = false,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    !versionHistoryPanelResult9 &&
    activity &&
    (readOnly ? !versionHistoryPanel : (onRestore && !versionHistoryPanel) || diffV24) ? (
      <div
        className={
          options
            ? `flex items-start gap-2 pr-2 pb-2 pl-6`
            : `flex items-start gap-2 px-2 pb-2`
        }
      >
        {!diffV22 && <span className={`size-[10px] shrink-0`} />}
        {readOnly ? (
          versionFilePath2 &&
          activity.sha && (
            <a
              href={fileAtUrl(versionFilePath2, activity.sha)}
              download={(activity.path || path || `version`).split(`/`).pop()}
              data-testid={`history-preview-download`}
              className={`text-accent text-body font-medium underline-offset-2 hover:underline`}
            >{`Download this version`}</a>
          )
        ) : (
          <jsxRuntime.Fragment>
            {onRestore && !versionHistoryPanel && (
              <Button
                data-testid={`history-preview-restore`}
                disabled={enabledState4}
                onClick={(..._extraArguments: unknown[]): Dynamic =>
                  setEnabledState3(true)
                }
              >
                {enabledState4 ? RESTORING_LABEL : `Restore this version`}
              </Button>
            )}
            {diffV24 && (
              <Button
                variant={`ghost`}
                data-testid={`history-preview-copy`}
                disabled={enabledState5}
                onClick={(..._extraArguments: unknown[]): Dynamic => callback()}
              >
                {enabledState5 ? `Making a copy…` : `Make a copy`}
              </Button>
            )}
          </jsxRuntime.Fragment>
        )}
      </div>
    ) : null;
  let versionHistoryPanelHandler6: Dynamic = (
    versionHistoryPanel?: Dynamic,
    options?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    if (!diffV22 || readOnly || versionHistoryPanel === null) return;
    let matchesId: boolean = id === versionHistoryPanel.id;
    let items: Dynamic = [];
    if (onRestore && !options) {
      items.push({
        label: `Restore this version`,
        onSelect: (..._extraArguments: unknown[]): Dynamic => {
          if (matchesId) return setEnabledState3(true);
          elementRef4.current = versionHistoryPanel.id;
          PlatformSyncAndRoutingAssign2.getState().set(versionHistoryPanel);
        },
      });
    }
    if (diffV24) {
      items.push({
        label: `Make a copy`,
        disabled: enabledState5,
        disabledReason: `Making a copy…`,
        onSelect: (..._extraArguments: unknown[]): undefined => {
          if (!matchesId) {
            PlatformSyncAndRoutingAssign2.getState().set(versionHistoryPanel);
          }
          callback(versionHistoryPanel);
        },
      });
    }
    return items.length === 0 ? (
      <span className={`size-6 shrink-0`} />
    ) : (
      <HistoryRowMenu items={items} shown={matchesId} />
    );
  };
  let label: string = diffV22 ? `bg-fill-ghost-hover rounded` : `bg-alpha-1 rounded`;
  let versionHistoryPanelHandler7: Dynamic = (
    versionHistoryPanel?: Dynamic,
    options?: Dynamic,
    context?: Dynamic,
    dependencies?: Dynamic,
    argument?: Dynamic,
    argument2?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    diffV22 ? (
      <div
        data-vh-row={``}
        className={`group/vhrow relative py-0.5${context && !options ? ` before:absolute before:top-0 before:right-2 before:h-px before:bg-alpha-1 before:content-[''] hover:before:hidden has-[button[aria-pressed]:focus-visible]:before:hidden ${dependencies ? `before:left-6` : `before:left-2`}` : ``}`}
        key={versionHistoryPanel}
      >
        {<div className={options ? label : undefined}>{argument}</div>}
      </div>
    ) : (
      <div className={argument2} key={versionHistoryPanel}>
        {argument}
      </div>
    );
  let versionHistoryPanelHandler8: Dynamic = (
    versionHistoryPanel?: Dynamic,
    options?: Dynamic,
    context?: Dynamic,
    dependencies?: Dynamic,
    argument: Dynamic = false,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let matchesId: boolean = id === versionHistoryPanel.id;
    let matchesId2: Dynamic =
      versionHistoryPanel.id === memoized2 || (matchesId && memoized8);
    return versionHistoryPanelHandler7(
      versionHistoryPanel.id,
      matchesId,
      argument,
      context,
      <jsxRuntime.Fragment>
        <HistoryVersionRow
          a={versionHistoryPanel}
          who={options}
          label={
            diffV22
              ? rowDisplayLabel(versionHistoryPanel)
              : versionLabelOf(versionHistoryPanel)
          }
          isCurrent={matchesId2}
          selected={matchesId}
          prevSha={memoized4.get(versionHistoryPanel.id) ?? null}
          path={versionPathOf(versionHistoryPanel, path ?? ``)}
          prevPath={memoized5.get(versionHistoryPanel.id) ?? null}
          {...(diffV22
            ? {
                v2: diffV22,
                base: versionHistoryPanelHandler3(versionHistoryPanel),
                navId: versionHistoryPanel.id,
                tabStops: versionHistoryPanelHandler10,
                stats: matchesId ? versionHistoryPanelResult6 : null,
                stacked: stacked,
                day: dependencies,
                indent: context,
                menu: (
                  versionHistoryPanel2?: Dynamic,
                  ..._extraArguments: unknown[]
                ): Dynamic =>
                  versionHistoryPanelHandler6(versionHistoryPanel2, matchesId2),
              }
            : {})}
        />
        {matchesId && versionHistoryPanelHandler5(matchesId2, context && diffV22)}
      </jsxRuntime.Fragment>,
      `${matchesId ? label : ``} ${context ? `pl-4` : ``}`,
    );
  };
  let memoized10: Dynamic = (0, React.useMemo)(
    (..._extraArguments: unknown[]): Dynamic =>
      diffV22
        ? memoized
            .flatMap(
              (memoized13?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
                memoized13.groups.flatMap(
                  (group?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
                    group.items.length > 1 &&
                    !group.items.some(
                      (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
                        uniqueItemsState.has(item.id),
                    )
                      ? [
                          {
                            id: historyGroupId(group),
                            a: group.items[0],
                            g: group,
                          },
                        ]
                      : group.items.map(
                          (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
                            id: item.id,
                            a: item,
                          }),
                        ),
                ),
            )
            .filter(
              (flatMap2?: Dynamic, ..._extraArguments: unknown[]) =>
                versionPreviewOf(flatMap2.a, {
                  isCurrent: false,
                  prevSha: null,
                  path: ``,
                  prevPath: null,
                }) !== null,
            )
        : [],
    [diffV22, memoized, uniqueItemsState],
  );
  let [createHistoryRoverState]: Dynamic = (0, React.useState)(createHistoryRover);
  let versionHistoryPanelHandler9: Dynamic = (
    versionHistoryPanel?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let uniqueItems: Dynamic = new (Set as Dynamic)(
      versionHistoryPanel.map(
        (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => item.id,
      ),
    );
    let versionHistoryPanel2: Dynamic =
      id === null
        ? undefined
        : versionHistoryPanel.find(
            (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              item.g?.items.some(
                (versionHistoryPanel3?: Dynamic, ..._extraArguments: unknown[]) =>
                  versionHistoryPanel3.id === id,
              ),
          );
    return {
      sel:
        (id !== null && uniqueItems.has(id) ? id : null) ??
        versionHistoryPanel2?.id ??
        null,
      first: versionHistoryPanel[0]?.id ?? null,
      ids: uniqueItems,
      rover: createHistoryRoverState,
    };
  };
  let versionHistoryPanelHandler10: Dynamic = diffV22
    ? versionHistoryPanelHandler9(memoized10)
    : undefined;
  let versionHistoryPanelHandler11 = (
    versionHistoryPanel?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    let versionHistoryPanelHandler20: Dynamic =
      versionHistoryPanelHandler3(versionHistoryPanel);
    let versionPreviewOf2: Dynamic = versionPreviewOf(versionHistoryPanel, {
      isCurrent: versionHistoryPanel.id === memoized2,
      prevSha: memoized4.get(versionHistoryPanel.id) ?? null,
      path: versionPathOf(versionHistoryPanel, path ?? ``),
      prevPath: memoized5.get(versionHistoryPanel.id) ?? null,
      ...(versionHistoryPanelHandler20 === undefined
        ? {}
        : {
            base: versionHistoryPanelHandler20,
          }),
    });
    if (versionPreviewOf2 !== null && versionHistoryPanel.id !== id) {
      PlatformSyncAndRoutingAssign2.getState().set(versionPreviewOf2);
    }
  };
  let versionHistoryPanelHandler12: Dynamic = (
    versionHistoryPanel?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    if (versionHistoryPanel.g === undefined)
      return versionHistoryPanelHandler11(versionHistoryPanel.a);
    let versionHistoryPanelHandler20: Dynamic = versionHistoryPanelHandler2(
      versionHistoryPanel.g,
    );
    if (versionHistoryPanelHandler20 !== null && versionHistoryPanelHandler20.id !== id) {
      PlatformSyncAndRoutingAssign2.getState().set(versionHistoryPanelHandler20);
    }
  };
  let versionHistoryPanelHandler13 = (
    versionHistoryPanel?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    for (let element of (elementRef.current?.querySelectorAll(`[data-nav-id]`) ??
      []) as Dynamic)
      if (element.getAttribute(`data-nav-id`) === versionHistoryPanel) {
        element.focus();
        element.scrollIntoView?.({
          block: `nearest`,
        });
        if (diffV27) {
          setVersionHistoryPanelState(versionHistoryPanel);
        }
        return;
      }
    let itemOfEntry: Dynamic = memoized12.itemOf.get(versionHistoryPanel);
    if (!(!diffV27 || itemOfEntry === undefined)) {
      elementRef6.current = versionHistoryPanel;
      setVersionHistoryPanelState(versionHistoryPanel);
      useVirtualizer2.scrollToIndex(itemOfEntry, {
        align: `auto`,
      });
    }
  };
  let versionHistoryPanelHandler14 = (..._extraArguments: unknown[]): undefined => {
    elementRef3.current?.();
    elementRef3.current = null;
    elementRef2.current = null;
  };
  let versionHistoryPanelHandler15 = (
    versionHistoryPanel?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    let memoized13: Dynamic = memoized10.find(
      (memoized14?: Dynamic, ..._extraArguments: unknown[]) =>
        memoized14.id === versionHistoryPanel,
    );
    if (memoized13) {
      versionHistoryPanelHandler12(memoized13);
    }
  };
  let versionHistoryPanelHandler16 = (
    event?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.isComposing
    )
      return;
    let target: Dynamic =
      event.target instanceof (Element as Dynamic) ? event.target : null;
    if (event.key === `ArrowDown` || event.key === `ArrowUp`) {
      if (memoized10.length === 0 || target?.closest(`[data-vh-menu]`)) return;
      event.preventDefault();
      let matchesKey: boolean = event.key === `ArrowDown`;
      let versionHistoryPanelHandler20: Dynamic = (
        versionHistoryPanel?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic =>
        versionHistoryPanel
          ? memoized10.findIndex(
              (memoized13?: Dynamic, ..._extraArguments: unknown[]) =>
                memoized13.id === versionHistoryPanel,
            )
          : -1;
      let element: Dynamic = elementRef2.current ?? id;
      let versionHistoryPanelHandler21: Dynamic = versionHistoryPanelHandler20(element);
      if (versionHistoryPanelHandler21 < 0 && element !== null) {
        let flatMap2: Dynamic = memoized
          .flatMap(
            (memoized13?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              memoized13.groups,
          )
          .find(
            (flatMap3?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              flatMap3.items.some(
                (item?: Dynamic, ..._extraArguments: unknown[]) => item.id === element,
              ) ||
              (flatMap3.items.length > 1 && historyGroupId(flatMap3) === element),
          );
        if (flatMap2 !== undefined) {
          let versionHistoryPanelHandler22: Dynamic = versionHistoryPanelHandler20(
            historyGroupId(flatMap2),
          );
          let versionHistoryPanelHandler23: Dynamic = versionHistoryPanelHandler20(
            flatMap2.items[0].id,
          );
          versionHistoryPanelHandler21 =
            versionHistoryPanelHandler22 >= 0
              ? versionHistoryPanelHandler22
              : versionHistoryPanelHandler23 < 0
                ? -1
                : matchesKey
                  ? versionHistoryPanelHandler23 - 1
                  : versionHistoryPanelHandler23;
        }
      }
      let versionHistoryPanelResult17: Dynamic;
      if (versionHistoryPanelHandler21 >= 0)
        versionHistoryPanelResult17 = Math.min(
          memoized10.length - 1,
          Math.max(0, versionHistoryPanelHandler21 + (matchesKey ? 1 : -1)),
        );
      else {
        let versionHistoryPanelHandler22: Dynamic = versionHistoryPanelHandler20(
          historyNavigationId(target),
        );
        versionHistoryPanelResult17 =
          versionHistoryPanelHandler22 >= 0
            ? versionHistoryPanelHandler22
            : matchesKey
              ? 0
              : memoized10.length - 1;
      }
      let memoizedItem: Dynamic = memoized10[versionHistoryPanelResult17];
      versionHistoryPanelHandler13(memoizedItem.id);
      elementRef3.current?.();
      elementRef2.current = memoizedItem.id;
      elementRef3.current = scheduleHistoryAction(
        250,
        (..._extraArguments: unknown[]): undefined => {
          elementRef3.current = null;
          elementRef2.current = null;
          versionHistoryPanelHandlerRef2.current(memoizedItem.id);
        },
      );
      return;
    }
    if (event.key === `Enter`) {
      let closest: Dynamic =
        target?.closest(`[data-testid="history-version-row"]`) ?? null;
      if (closest === null || (event.preventDefault(), event.repeat)) return;
      let matchesAttribute: boolean = closest.getAttribute(`aria-pressed`) === `true`;
      let attribute: Dynamic = closest.getAttribute(`data-nav-id`);
      let enabled: boolean =
        !matchesAttribute && attribute !== null && elementRef2.current === attribute;
      if (!matchesAttribute && !enabled) {
        closest.click();
        return;
      }
      let id3: Dynamic = enabled
        ? (memoized10.find(
            (memoized13?: Dynamic, ..._extraArguments: unknown[]) =>
              memoized13.id === attribute,
          )?.a.id ?? null)
        : id2;
      if (
        id3 === null ||
        id3 === memoized2 ||
        readOnly ||
        !onRestore ||
        (!enabled && memoized8)
      )
        return;
      versionHistoryPanelHandler14();
      if (enabled && attribute !== null) {
        elementRef4.current = attribute;
        versionHistoryPanelHandler15(attribute);
      } else {
        setEnabledState3(true);
      }
      return;
    }
    if (event.key === `Escape` && (activity !== null || elementRef2.current !== null)) {
      event.preventDefault();
      event.stopPropagation();
      versionHistoryPanelHandler14();
      if (activity !== null) {
        PlatformSyncAndRoutingAssign2.getState().clear();
      }
    }
  };
  let versionHistoryPanelHandlerRef: Dynamic = (0, React.useRef)(
    versionHistoryPanelHandler16,
  );
  let versionHistoryPanelHandlerRef2: Dynamic = (0, React.useRef)(
    versionHistoryPanelHandler15,
  );
  let enabledRef2: Dynamic = (0, React.useRef)(false);
  (0, React.useEffect)((..._extraArguments: unknown[]): undefined => {
    versionHistoryPanelHandlerRef.current = versionHistoryPanelHandler16;
    versionHistoryPanelHandlerRef2.current = versionHistoryPanelHandler15;
    enabledRef2.current = diffV27;
  });
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      let element: Dynamic = elementRef.current;
      if (!diffV22 || !element) return;
      let versionHistoryPanelHandler20: Dynamic = (
        versionHistoryPanel?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => versionHistoryPanelHandlerRef.current(versionHistoryPanel);
      let versionHistoryPanelHandler21 = (..._extraArguments: unknown[]): undefined => {
        elementRef3.current?.();
        elementRef3.current = null;
        elementRef2.current = null;
      };
      let versionHistoryPanelHandler22 = (
        event?: Dynamic,
        ..._extraArguments: unknown[]
      ): undefined => {
        let historyNavigationId2: Dynamic = historyNavigationId(
          event.target instanceof (Element as Dynamic) ? event.target : null,
        );
        if (historyNavigationId2 && enabledRef2.current) {
          setVersionHistoryPanelState(historyNavigationId2);
        }
        if (historyNavigationId2) {
          createHistoryRoverState.set(historyNavigationId2);
        }
      };
      element.addEventListener(`keydown`, versionHistoryPanelHandler20);
      element.addEventListener(`click`, versionHistoryPanelHandler21);
      element.addEventListener(`focusin`, versionHistoryPanelHandler22);
      element.addEventListener(`pointerdown`, versionHistoryPanelHandler22);
      return (..._extraArguments: unknown[]): undefined => {
        element.removeEventListener(`keydown`, versionHistoryPanelHandler20);
        element.removeEventListener(`click`, versionHistoryPanelHandler21);
        element.removeEventListener(`focusin`, versionHistoryPanelHandler22);
        element.removeEventListener(`pointerdown`, versionHistoryPanelHandler22);
        versionHistoryPanelHandler21();
      };
    },
    [diffV22, createHistoryRoverState],
  );
  let diffV25: Dynamic = diffV22 && !readOnly && !!onRestore;
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic =>
      diffV25 ? resolvePlatformSyncAndRoutingRestoreOffers() : undefined,
    [diffV25],
  );
  let diffV26: Dynamic = diffV24 && stacked;
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic =>
      diffV26 ? resolvePlatformSyncAndRoutingCopyOffers() : undefined,
    [diffV26],
  );
  let versionHistoryPanelResult10: Dynamic = resolvePlatformSyncAndRoutingList();
  let versionHistoryPanelResultRef2: Dynamic = (0, React.useRef)(
    versionHistoryPanelResult10,
  );
  let idRef: Dynamic = (0, React.useRef)(id);
  idRef.current = id;
  (0, React.useLayoutEffect)(
    (..._extraArguments: unknown[]): undefined => {
      let versionHistoryPanelResult17: Dynamic = versionHistoryPanelResultRef2.current;
      versionHistoryPanelResultRef2.current = versionHistoryPanelResult10;
      let element: Dynamic = elementRef.current;
      if (
        !stacked ||
        versionHistoryPanelResult17 !== `preview` ||
        versionHistoryPanelResult10 !== `list` ||
        !element
      )
        return;
      let ownerDocument: Dynamic = element.ownerDocument;
      let activeElement: Dynamic = ownerDocument.activeElement;
      if (
        !(
          ownerDocument.hasFocus() &&
          (activeElement === null ||
            activeElement === ownerDocument.body ||
            activeElement.closest(`[data-testid="history-phone-bar"]`) !== null)
        )
      )
        return;
      let id3: Dynamic = idRef.current;
      (
        (id3 !== null &&
          [...element.querySelectorAll(`[data-nav-id]`)].find(
            (element2?: Dynamic, ..._extraArguments: unknown[]) =>
              element2.getAttribute(`data-nav-id`) === id3,
          )) ||
        element.querySelector(
          `[data-testid="history-version-row"][aria-pressed="true"]`,
        ) ||
        element.querySelector(
          `[data-testid="history-group-contains"] > [data-testid="history-version-row"]`,
        )
      )?.focus({
        preventScroll: true,
      });
    },
    [stacked, versionHistoryPanelResult10],
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (!diffV22 || id === null || !Array.isArray(error)) return;
      let error2: Dynamic = error.find(
        (error3?: Dynamic, ..._extraArguments: unknown[]) => error3.id === id,
      );
      let contributors: Dynamic =
        memoized7 === undefined
          ? error2 === undefined
            ? null
            : contributorsOf(error2)
          : memoized7.contributors;
      if (contributors !== null) {
        updatePlatformSyncAndRoutingCaption(
          id,
          contributorsAccessibleLabel(withResolvedContributorNames(contributors)),
        );
      }
    },
    [diffV22, id, error, memoized7],
  );
  let versionHistoryPanelResult11: Dynamic = resolvePlatformSyncAndRoutingRestoreAsk();
  let versionHistoryPanelResultRef3: Dynamic = (0, React.useRef)(
    versionHistoryPanelResult11,
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (versionHistoryPanelResult11 !== versionHistoryPanelResultRef3.current) {
        versionHistoryPanelResultRef3.current = versionHistoryPanelResult11;
        if (!(!diffV25 || id2 === null || id2 === memoized2 || memoized8)) {
          elementRef3.current?.();
          elementRef3.current = null;
          elementRef2.current = null;
          setEnabledState3(true);
        }
      }
    },
    [versionHistoryPanelResult11, diffV25, id2, memoized2, memoized8],
  );
  let memoized11: Dynamic = (0, React.useMemo)(
    (..._extraArguments: unknown[]): Dynamic => {
      if (id === null) return false;
      if (memoized7 !== undefined) return true;
      let flatMap2: Dynamic = memoized
        .flatMap(
          (memoized13?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
            memoized13.groups,
        )
        .find(
          (flatMap3?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
            flatMap3.items.some(
              (item?: Dynamic, ..._extraArguments: unknown[]) => item.id === id,
            ),
        );
      return (
        flatMap2 !== undefined &&
        (flatMap2.items.length === 1 ||
          flatMap2.items.some(
            (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              uniqueItemsState.has(item.id),
          ))
      );
    },
    [id, memoized7, memoized, uniqueItemsState],
  );
  let versionHistoryPanelResult12: Dynamic =
    versionHistoryPanelResult4 && !stacked && !readOnly && activity != null && memoized11;
  let versionHistoryPanelResult13: Dynamic =
    versionHistoryPanelResult12 &&
    diffV25 &&
    id2 !== null &&
    id2 !== memoized2 &&
    !memoized8;
  let versionHistoryPanelResult14: Dynamic =
    versionHistoryPanelResult12 && activity.group === undefined && activity.isCurrent;
  (0, React.useLayoutEffect)(
    (..._extraArguments: unknown[]): undefined => {
      updatePlatformLiveDocumentAndHistoryRail(
        versionHistoryPanelResult12
          ? {
              canRestore: versionHistoryPanelResult13,
              isCurrent: versionHistoryPanelResult14,
              restoring: enabledState4,
            }
          : null,
      );
    },
    [
      versionHistoryPanelResult12,
      versionHistoryPanelResult13,
      versionHistoryPanelResult14,
      enabledState4,
    ],
  );
  (0, React.useLayoutEffect)(
    (..._extraArguments: unknown[]): Dynamic =>
      (..._extraArguments: unknown[]): Dynamic =>
        updatePlatformLiveDocumentAndHistoryRail(null),
    [],
  );
  let versionHistoryPanelResult15: Dynamic =
    versionHistoryPanelResult4 && !stacked && !readOnly;
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (versionHistoryPanelResult15) {
        preloadModule(
          (..._extraArguments: unknown[]): Dynamic =>
            import("../document-history/bar").then(
              (result?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
                updatePlatformLiveDocumentAndHistoryComponent(result.VersionBar),
            ),
          mapPreloadDependencies([5, 1, 6, 2, 7, 3, 4, 8, 9, 10]),
          import.meta.url,
        ).catch((..._extraArguments: unknown[]): undefined => undefined);
      }
    },
    [versionHistoryPanelResult15],
  );
  let versionHistoryPanelResult16: Dynamic = resolvePlatformSyncAndRoutingCopyAsk();
  let versionHistoryPanelResultRef4: Dynamic = (0, React.useRef)(
    versionHistoryPanelResult16,
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (versionHistoryPanelResult16 !== versionHistoryPanelResultRef4.current) {
        versionHistoryPanelResultRef4.current = versionHistoryPanelResult16;
        if (diffV26) {
          callback();
        }
      }
    },
    [versionHistoryPanelResult16, diffV26, callback],
  );
  let versionHistoryPanelHandler17 = async (
    ..._extraArguments: unknown[]
  ): Promise<undefined> => {
    setEnabledState(true);
    try {
      await PlatformLiveDocumentAndHistoryEntries2.getState().load(controlId, {
        ctr: containerAtVersion2,
        version: version,
        path: path,
        pageId: pageId,
        roomFile: roomFile,
      });
    } finally {
      setEnabledState(false);
    }
  };
  let versionHistoryPanelHandler18: Dynamic = (
    event?: Dynamic,
    options?: Dynamic,
    context: Dynamic = true,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let itemItem: Dynamic = event.items[0];
    if (event.items.length === 1)
      return versionHistoryPanelHandler8(
        itemItem,
        event.contributors,
        false,
        options,
        !context,
      );
    let some: Dynamic = event.items.some(
      (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        uniqueItemsState.has(item.id),
    );
    let some2: Dynamic = event.items.some(
      (item?: Dynamic, ..._extraArguments: unknown[]) => item.id === id,
    );
    let diffV29: Dynamic = diffV22 && id === historyGroupId(event);
    let diffV210: Dynamic = diffV22 ? diffV29 : !some && some2;
    let diffV211: Dynamic = diffV22 && !some && some2;
    let matchesId: boolean = itemItem.id === memoized2;
    let diffV212: Dynamic = diffV210 || (!diffV22 && some && id === itemItem.id);
    return (
      <Collapsible.Root
        open={some}
        onOpenChange={(
          versionHistoryPanel?: Dynamic,
          ..._extraArguments: unknown[]
        ): undefined => {
          if (
            diffV22 &&
            versionHistoryPanel &&
            createHistoryRoverState.get() === historyGroupId(event)
          ) {
            createHistoryRoverState.set(itemItem.id);
          }
          if (diffV22 && !versionHistoryPanel) {
            let activeElement: Dynamic =
              elementRef.current?.ownerDocument.activeElement ?? null;
            let attribute: Dynamic = activeElement
              ?.closest(`[data-nav-id]`)
              ?.getAttribute(`data-nav-id`);
            let matchesMatches: boolean =
              activeElement?.matches(`[data-testid="history-group-toggle"]`) === true &&
              activeElement
                .closest(`[data-testid="history-group"]`)
                ?.querySelector(`[data-nav-id]`)
                ?.getAttribute(`data-nav-id`) === itemItem.id;
            if (
              attribute != null &&
              event.items.some(
                (item?: Dynamic, ..._extraArguments: unknown[]) => item.id === attribute,
              )
            ) {
              elementRef6.current = historyGroupId(event);
            } else {
              if (matchesMatches) {
                createHistoryRoverState.set(historyGroupId(event));
              }
            }
          }
          versionHistoryPanelHandler4(event, versionHistoryPanel);
        }}
        data-testid={`history-group`}
        key={event.key}
      >
        {versionHistoryPanelHandler7(
          undefined,
          diffV210,
          !context,
          false,
          <jsxRuntime.Fragment>
            <HistoryVersionRow
              a={itemItem}
              who={event.contributors}
              label={diffV22 ? groupDisplayLabel(event).label : firstGroupLabel(event)}
              count={event.items.length}
              {...(diffV22
                ? {
                    v2: diffV22,
                    navId: some ? undefined : historyGroupId(event),
                    tabStops: versionHistoryPanelHandler10,
                    stats: diffV212 ? versionHistoryPanelResult6 : null,
                    editsTitle: groupDisplayLabel(event).edits,
                    stacked: stacked,
                    opens: versionHistoryPanelHandler2(event),
                    contains: diffV211,
                    day: options,
                    menu: (
                      versionHistoryPanel?: Dynamic,
                      ..._extraArguments: unknown[]
                    ): Dynamic =>
                      versionHistoryPanelHandler6(versionHistoryPanel, matchesId),
                  }
                : {})}
              lead={
                <Collapsible.Trigger
                  hideCaret={true}
                  data-testid={`history-group-toggle`}
                  aria-label={`${some ? `Hide` : `Show`} ${event.items.length} versions`}
                  className={`${diffV22 ? `relative ` : ``}mt-1 h-[10px] shrink-0 justify-center`}
                >
                  <UiOverlaysAndIconsCustomIcon
                    name={`CaretRight`}
                    customSize={10}
                    className={`transition-transform group-data-[panel-open]/clp:rotate-90`}
                  />
                </Collapsible.Trigger>
              }
              isCurrent={matchesId}
              selected={diffV212}
              prevSha={memoized4.get(itemItem.id) ?? null}
              path={versionPathOf(itemItem, path ?? ``)}
              prevPath={memoized5.get(itemItem.id) ?? null}
            />
            {diffV210 &&
              versionHistoryPanelHandler5(
                diffV22 ? matchesId : activity?.id === memoized2,
              )}
          </jsxRuntime.Fragment>,
          diffV210 ? label : ``,
        )}
        {
          <Collapsible.Panel>
            {event.items.map(
              (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
                versionHistoryPanelHandler8(
                  item,
                  contributorsOf(item),
                  true,
                  options,
                  true,
                ),
            )}
          </Collapsible.Panel>
        }
      </Collapsible.Root>
    );
  };
  let versionHistoryPanelHandler19: Dynamic = (
    versionHistoryPanel?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => (
    <div className={`text-secondary px-2 pb-1 text-[11px]`}>{versionHistoryPanel}</div>
  );
  let flatMap: Dynamic = diffV22
    ? memoized.flatMap(
        (memoized13?: Dynamic, index?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          memoized13.groups.map(
            (group?: Dynamic, index2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              versionHistoryPanelHandler18(
                group,
                memoized13.day,
                index === 0 && index2 === 0,
              ),
          ),
      )
    : memoized.map(
        (memoized13?: Dynamic, ..._extraArguments: unknown[]): Dynamic => (
          <div className={`mb-3`} key={memoized13.day}>
            {versionHistoryPanelHandler19(memoized13.day)}
            {memoized13.groups.map(
              (group?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
                versionHistoryPanelHandler18(group),
            )}
          </div>
        ),
      );
  let diffV27: Dynamic =
    diffV22 &&
    memoized.reduce(
      (
        accumulator?: Dynamic,
        memoized13?: Dynamic,
        ..._extraArguments: unknown[]
      ): Dynamic => accumulator + memoized13.groups.length,
      0,
    ) > 200;
  let memoized12: Dynamic = (0, React.useMemo)(
    (..._extraArguments: unknown[]): Dynamic => {
      let items: Dynamic = [];
      let lookup: Dynamic = new (Map as Dynamic)();
      if (diffV27) {
        memoized.forEach(
          (
            memoized13?: Dynamic,
            index?: Dynamic,
            ..._extraArguments: unknown[]
          ): undefined => {
            memoized13.groups.forEach(
              (
                event?: Dynamic,
                index2?: Dynamic,
                ..._extraArguments: unknown[]
              ): undefined => {
                for (let versionHistoryPanelResult17 of event.items as Dynamic)
                  lookup.set(versionHistoryPanelResult17.id, items.length);
                if (event.items.length > 1) {
                  lookup.set(historyGroupId(event), items.length);
                }
                items.push({
                  key: event.key,
                  day: memoized13.day,
                  g: event,
                  first: index === 0 && index2 === 0,
                });
              },
            );
          },
        );
      }
      return {
        items: items,
        itemOf: lookup,
      };
    },
    [diffV27, memoized],
  );
  let [versionHistoryPanelState, setVersionHistoryPanelState]: Dynamic = (0,
  React.useState)(null);
  let elementRef6: Dynamic = (0, React.useRef)(null);
  let callback2: Dynamic = (0, React.useCallback)(
    (versionHistoryPanel?: Dynamic, ..._extraArguments: unknown[]): Dynamic => {
      let uniqueItems: Dynamic = new (Set as Dynamic)(
        defaultRangeExtractor(versionHistoryPanel),
      );
      for (let versionHistoryPanelResult17 of [id, versionHistoryPanelState] as Dynamic) {
        let itemOfEntry: Dynamic =
          versionHistoryPanelResult17 == null
            ? undefined
            : memoized12.itemOf.get(versionHistoryPanelResult17);
        if (itemOfEntry !== undefined) {
          uniqueItems.add(itemOfEntry);
        }
      }
      return [...uniqueItems].toSorted(
        (item?: Dynamic, item2?: Dynamic, ..._extraArguments: unknown[]): number =>
          item - item2,
      );
    },
    [memoized12, id, versionHistoryPanelState],
  );
  let useVirtualizer2: Dynamic = useVirtualizer({
    enabled: diffV27,
    count: memoized12.items.length,
    getScrollElement: (..._extraArguments: unknown[]): Dynamic => elementRef.current,
    estimateSize: (..._extraArguments: unknown[]): number => HISTORY_ROW_ESTIMATE_PX,
    getItemKey: (versionHistoryPanel?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      memoized12.items[versionHistoryPanel]?.key ?? versionHistoryPanel,
    overscan: HISTORY_OVERSCAN_ROWS,
    rangeExtractor: callback2,
  });
  let memoizedRef: Dynamic = (0, React.useRef)(memoized12);
  memoizedRef.current = memoized12;
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      let itemOfEntry: Dynamic =
        diffV27 && id != null ? memoizedRef.current.itemOf.get(id) : undefined;
      if (itemOfEntry !== undefined) {
        useVirtualizer2.scrollToIndex(itemOfEntry, {
          align: `auto`,
        });
      }
    },
    [diffV27, id, useVirtualizer2],
  );
  (0, React.useEffect)((..._extraArguments: unknown[]): undefined => {
    let element: Dynamic = elementRef6.current;
    if (element !== null) {
      for (let element2 of (elementRef.current?.querySelectorAll(`[data-nav-id]`) ??
        []) as Dynamic)
        if (element2.getAttribute(`data-nav-id`) === element) {
          elementRef6.current = null;
          element2.focus();
          element2.scrollIntoView?.({
            block: `nearest`,
          });
          return;
        }
    }
  });
  if (diffV27) {
    let uniqueItems: Dynamic = new (Set as Dynamic)(
      useVirtualizer2
        .getVirtualItems()
        .map(
          (virtualItem?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
            virtualItem.index,
        ),
    );
    versionHistoryPanelHandler10 = versionHistoryPanelHandler9(
      memoized10.filter(
        (memoized13?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          uniqueItems.has(memoized12.itemOf.get(memoized13.id) ?? -1),
      ),
    );
  }
  let ids: Dynamic = versionHistoryPanelHandler10?.ids;
  (0, React.useLayoutEffect)((..._extraArguments: unknown[]): undefined => {
    let createHistoryRoverStateEntry: Dynamic = createHistoryRoverState.get();
    if (
      createHistoryRoverStateEntry !== null &&
      ids !== undefined &&
      !ids.has(createHistoryRoverStateEntry)
    ) {
      createHistoryRoverState.set(null);
    }
  });
  let diffV28: Dynamic = diffV27 && (
    <div
      data-testid={`history-window`}
      className={`relative`}
      style={{
        height: useVirtualizer2.getTotalSize(),
      }}
    >
      {useVirtualizer2
        .getVirtualItems()
        .map((event?: Dynamic, ..._extraArguments: unknown[]): Dynamic => {
          let itemItem: Dynamic = memoized12.items[event.index];
          return (
            <div
              data-index={event.index}
              ref={useVirtualizer2.measureElement}
              className={`absolute inset-x-0 top-0`}
              style={{
                transform: `translateY(${event.start}px)`,
              }}
              key={event.key}
            >
              {versionHistoryPanelHandler18(itemItem.g, itemItem.day, itemItem.first)}
            </div>
          );
        })}
    </div>
  );
  let isArray2: Dynamic = Array.isArray(error) && versionHistoryPanelResult8 && (
    <div className={diffV22 ? `px-2 pt-3 pb-2` : `px-2 pb-2`}>
      <Button
        data-testid={`history-load-older`}
        disabled={enabledState2}
        onClick={(..._extraArguments: unknown[]): undefined =>
          void versionHistoryPanelHandler()
        }
      >
        {enabledState2 ? `Loading…` : `Show older versions`}
      </Button>
    </div>
  );
  let activity2: Dynamic = activity && (
    <UiDialogsRoot.Root open={enabledState3} onOpenChange={setEnabledState3}>
      <PhoneDialogPopup size={`sm`} data-testid={`history-restore-dialog`}>
        {onLeave2 && <UseHistoryDialogExitComponent onLeave={onLeave2} press={record} />}
        <UiDialogsRoot.Title
          className={`text-primary mb-2 font-semibold`}
        >{`Restore this version`}</UiDialogsRoot.Title>
        <UiDialogsRoot.Description
          className={`text-secondary text-footnote mb-4 leading-relaxed`}
        >
          {activity.group === undefined
            ? `The file will be set to its state from `
            : `The file will be set to the newest of the ${activity.group.count} versions in this group, saved `}
          {new (Date as Dynamic)(activity.at).toLocaleString(
            versionHistoryPanelResult.locale,
            {
              timeZone: versionHistoryPanelResult.timeZone,
            },
          )}
          {`.`}
          {(activity.group?.base ?? activity.base) === `first`
            ? ` Its changes are shown against the document as first saved.`
            : null}
          {` `}
          {diffV22 ? RESTORE_EXPLANATION : `Your current version stays in history.`}
        </UiDialogsRoot.Description>
        <UiDialogsRoot.Footer align={`end`}>
          <UiDialogsRoot.Close render={<Button>{`Cancel`}</Button>} />
          <Button
            variant={`primary`}
            disabled={enabledState4}
            data-testid={`history-restore-confirm`}
            onClick={(event?: Dynamic, ..._extraArguments: unknown[]): undefined => {
              record.pressed = true;
              setEnabledState4(true);
              let ownerDocument: Dynamic = event.currentTarget.ownerDocument;
              if (diffV22) {
                resolvePlatformAnnouncementsValue(ownerDocument, RESTORING_LABEL, {
                  key: RESTORE_ACTION,
                });
              }
              Promise.resolve()
                .then(
                  (..._extraArguments: unknown[]): Dynamic =>
                    onRestore?.(
                      activity.group !== undefined && id2 !== null
                        ? {
                            ...activity,
                            id: id2,
                          }
                        : activity,
                    ),
                )
                .finally((..._extraArguments: unknown[]): undefined => {
                  if (diffV22) {
                    resolvePlatformAnnouncementsValue2(ownerDocument, RESTORE_ACTION);
                  }
                  setEnabledState4(false);
                  setEnabledState3(false);
                });
            }}
          >
            {enabledState4 ? RESTORING_LABEL : `Restore`}
          </Button>
        </UiDialogsRoot.Footer>
      </PhoneDialogPopup>
    </UiDialogsRoot.Root>
  );
  return diffV22 ? (
    <div className={`flex h-full flex-col`} data-testid={`history-rail`}>
      {redline2 && <HistoryControls />}
      <div
        ref={elementRef}
        role={`group`}
        aria-label={`Versions`}
        data-testid={`history-list`}
        data-rail-list={``}
        className={`min-h-0 flex-1 overflow-y-auto px-2 py-3`}
      >
        {error === `loading` ? (
          <HistoryLoading />
        ) : error instanceof (Error as Dynamic) ? (
          <HistoryError
            forbidden={isHistoryForbidden(error)}
            retrying={enabledState}
            onRetry={(..._extraArguments: unknown[]): undefined =>
              void versionHistoryPanelHandler17()
            }
          />
        ) : memoized.length === 0 ? (
          <HistoryEmpty readOnly={!!readOnly} />
        ) : diffV27 ? (
          diffV28
        ) : (
          flatMap
        )}
        {isArray2}
      </div>
      {activity2}
    </div>
  ) : (
    <div className={`h-full overflow-y-auto px-2 py-3`}>
      {error === `loading` ? (
        <div className={`text-muted py-6 text-center text-xs`}>{`loading…`}</div>
      ) : error instanceof (Error as Dynamic) ? (
        <div className={`text-danger py-6 text-center text-xs`}>
          {String(error.message)}
        </div>
      ) : memoized.length === 0 ? (
        <div className={`text-muted py-6 text-center text-xs`}>{`No history yet`}</div>
      ) : (
        flatMap
      )}
      {isArray2}
      {activity2}
    </div>
  );
};

export const ContributorAvatar: ReactComponentTypes.FC<Dynamic> = ({
  who: who,
  xs = false,
}) => {
  let size: number = xs ? 16 : 14;
  let sizeClass: string = xs ? `size-4` : `size-[14px]`;
  let profile: Dynamic = useCommentsActionsAndSelectionPlatform(
    who.kind === `human` && resolveEditorAnchorsAndMentionsOther(who.email) === `platform`
      ? who.email
      : null,
  );
  let mode: Dynamic = resolvePlatformApiAndAuthUseContext2();
  let hasLocale: boolean = mode.locale !== undefined || mode.timeZone !== undefined;
  let account: Dynamic = PlatformApiAndAuthPriming(
    (contributorAvatar?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      hasLocale || who.kind !== `human`
        ? undefined
        : resolvePlatformApiAndAuthToLowerCase(contributorAvatar, who.email),
  );
  return who.kind === `system` ? (
    <span className={`bg-alpha-2 size-[6px] shrink-0 rounded-full`} />
  ) : who.kind === `human` &&
    resolveEditorAnchorsAndMentionsOther(who.email) !== `email` ? (
    profile === undefined ? (
      <span className={`bg-alpha-2 ${sizeClass} shrink-0 animate-pulse rounded-full`} />
    ) : (
      <CollaboratorAvatar
        email={resolveEditorAnchorsAndMentionsEmail(who.email, profile?.name)}
        photoUrl={resolveObservabilityBrowserAndOperationEventsStartsWith(
          profile?.avatarUrl,
          hasLocale,
        )}
        size={size}
        className={`shrink-0`}
      />
    )
  ) : who.kind === `claude` ? (
    <span
      className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-full`}
      style={{
        background: CLAUDE_AVATAR_COLOR,
      }}
    >
      <img
        src={CLAUDE_LOGO_DATA_URI}
        alt={``}
        className={xs ? `size-2.5` : `size-[9px]`}
        style={{
          filter: `brightness(0) invert(1)`,
        }}
      />
    </span>
  ) : (
    <CollaboratorAvatar
      email={who.email}
      photoUrl={account}
      size={size}
      className={`shrink-0`}
    />
  );
};

export const ContributorAvatars: ReactComponentTypes.FC<Dynamic> = ({
  who: who,
  max = 3,
  keepClaude = false,
  xs = false,
  decorative = false,
}) => {
  let humans: Dynamic = who.filter(
    (entry?: Dynamic, ..._extraArguments: unknown[]) => entry.kind === `human`,
  );
  let agents: Dynamic = who.filter(
    (entry?: Dynamic, ..._extraArguments: unknown[]) => entry.kind !== `human`,
  );
  let shown: Dynamic = keepClaude
    ? [...humans.slice(0, Math.max(0, max - agents.length)), ...agents].slice(0, max)
    : [...humans, ...agents].slice(0, max);
  return (
    <span
      className={`flex shrink-0 items-center gap-0.5`}
      aria-hidden={decorative ? true : undefined}
    >
      {shown.map(
        (contributor?: Dynamic, ..._extraArguments: unknown[]): Dynamic => (
          <ContributorAvatar
            who={contributor}
            xs={xs}
            key={contributor.kind === `human` ? contributor.email : contributor.kind}
          />
        ),
      )}
    </span>
  );
};

export const HistoryRowMenu: ReactComponentTypes.FC<Dynamic> = ({
  items: items,
  shown: shown,
}) => {
  let menuRef: Dynamic = (0, React.useRef)(null);
  let [open, setOpen]: Dynamic = (0, React.useState)(false);
  let openedRef: Dynamic = (0, React.useRef)(false);
  let closeIfBlurred: Dynamic = (0, React.useCallback)(
    (..._extraArguments: unknown[]): undefined => {
      let menu: Dynamic = menuRef.current;
      if (!(menu === null || openedRef.current)) {
        if (
          !menu.contains(menu.ownerDocument.activeElement) &&
          menu.closest(`[data-vh-row]`)?.matches(`:hover`) !== true
        ) {
          setOpen(false);
        }
      }
    },
    [],
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (!shown && !open) {
        openedRef.current = false;
      }
    },
    [shown, open],
  );
  let callback: Dynamic = (0, React.useCallback)(
    (..._extraArguments: unknown[]): undefined =>
      void scheduleHistoryAction(0, closeIfBlurred),
    [closeIfBlurred],
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      let menu: Dynamic = menuRef.current;
      let closest: Dynamic = menu?.closest(`[data-vh-row]`) ?? null;
      if (menu === null || closest === null) return;
      let historyRowMenuHandler = (
        historyRowMenu?: Dynamic,
        ..._extraArguments: unknown[]
      ): undefined => {
        if (historyRowMenu.pointerType !== `touch`) {
          setOpen(true);
        }
      };
      let historyRowMenuHandler2: Dynamic = (..._extraArguments: unknown[]): Dynamic =>
        setOpen(true);
      closest.addEventListener(`pointerenter`, historyRowMenuHandler);
      closest.addEventListener(`pointerleave`, callback);
      menu.addEventListener(`focusin`, historyRowMenuHandler2);
      menu.addEventListener(`focusout`, callback);
      return (..._extraArguments: unknown[]): undefined => {
        closest.removeEventListener(`pointerenter`, historyRowMenuHandler);
        closest.removeEventListener(`pointerleave`, callback);
        menu.removeEventListener(`focusin`, historyRowMenuHandler2);
        menu.removeEventListener(`focusout`, callback);
      };
    },
    [callback],
  );
  return (
    <span
      ref={menuRef}
      data-vh-menu={``}
      className={`relative size-6 shrink-0${shown || open ? `` : ` pointer-events-none`}`}
    >
      {(shown || open) && (
        <Menu.Root
          modal={false}
          onOpenChange={(
            historyRowMenu?: Dynamic,
            ..._extraArguments: unknown[]
          ): undefined => {
            if (historyRowMenu) {
              openedRef.current = true;
              setOpen(true);
            }
          }}
          onOpenChangeComplete={(
            historyRowMenu?: Dynamic,
            ..._extraArguments: unknown[]
          ): undefined => {
            if (!historyRowMenu) {
              openedRef.current = false;
              callback();
            }
          }}
        >
          <Tooltip content={`More actions`}>
            <Menu.Trigger
              render={
                <IconButton
                  aria-label={`More actions`}
                  size={20}
                  icon={
                    <UiOverlaysAndIconsCustomIcon
                      name={`DotsHorizontal`}
                      customSize={14}
                    />
                  }
                />
              }
            />
          </Tooltip>
          <Menu.Popup align={`end`}>{renderMenuItems(items)}</Menu.Popup>
        </Menu.Root>
      )}
    </span>
  );
};

export const HistoryVersionRow: ReactComponentTypes.FC<Dynamic> = ({
  a: activity,
  who: who,
  label: label,
  count = 1,
  lead: lead,
  isCurrent: isCurrent,
  selected: selected,
  prevSha: prevSha,
  path: path,
  prevPath: prevPath,
  base: base,
  v2 = false,
  navId: navId,
  tabStops: tabStops,
  stats: stats,
  editsTitle = false,
  stacked = false,
  opens: opens,
  contains = false,
  day: day,
  menu: menu,
  indent = false,
}) => {
  let historyVersionRowResult: Dynamic = resolvePlatformApiAndAuthUseContext2();
  let useHistoryTabStops2: Dynamic = useHistoryTabStops(tabStops, navId);
  let historyVersionRowResult2: Dynamic =
    resolvePlatformLiveDocumentAndHistoryNote2(selected);
  let useContributorNames2: Dynamic = useContributorNames(who);
  let versionPreviewOf2: Dynamic =
    opens === undefined
      ? versionPreviewOf(activity, {
          isCurrent: isCurrent,
          prevSha: prevSha,
          path: path,
          prevPath: prevPath,
          ...(base === undefined
            ? {}
            : {
                base: base,
              }),
        })
      : opens;
  let historyActionLabel2: Dynamic = historyActionLabel(activity);
  let matchesVersionPreviewOf: boolean = versionPreviewOf2 !== null;
  let versionTimeLabel: Dynamic = v2
    ? formatVersionTimeLabel(
        formatVersionTime(
          activity.at,
          historyVersionRowResult.locale,
          historyVersionRowResult.timeZone,
        ),
        day,
      )
    : formatVersionTime(
        activity.at,
        historyVersionRowResult.locale,
        historyVersionRowResult.timeZone,
      );
  let versionTimeLabel2: Dynamic = versionTimeLabel;
  if (label) {
    versionTimeLabel2 = v2 ? (
      <HistoryLabel label={label} />
    ) : (
      <span className={`line-clamp-2`}>{label}</span>
    );
  } else {
    if (editsTitle) {
      versionTimeLabel2 = (
        <HistoryLabel
          label={`${count} edits by ${contributorsAccessibleLabel(useContributorNames2)}`}
        />
      );
    }
  }
  let enabled: Dynamic = !!label || editsTitle;
  return (
    <div
      className={
        v2
          ? `relative flex w-full items-start gap-2 rounded py-2.5 pr-2 has-[>button[aria-pressed]:focus-visible]:ring-2 has-[>button[aria-pressed]:focus-visible]:ring-fill-accent has-[>button[aria-pressed]:focus-visible]:ring-inset ${indent ? `pl-6` : `pl-2`} ${selected ? `` : matchesVersionPreviewOf ? `group-hover/vhrow:bg-fill-ghost-hover has-[[data-popup-open]]:bg-fill-ghost-hover` : ``}${contains ? ` ring-fill-accent ring-1 ring-inset` : ``}`
          : `flex w-full items-start gap-2 rounded px-2 py-1.5 ${selected ? `` : matchesVersionPreviewOf ? `hover:bg-alpha-0` : ``}${contains ? ` ring-fill-accent ring-1 ring-inset` : ``}`
      }
      data-testid={contains ? `history-group-contains` : undefined}
    >
      {!v2 && (lead ?? <span className={`mt-1 size-[10px] shrink-0`} />)}
      <button
        type={`button`}
        data-testid={`history-version-row`}
        data-versions={count > 1 ? count : undefined}
        data-nav-id={navId}
        tabIndex={useHistoryTabStops2 ? undefined : -1}
        aria-pressed={v2 ? selected : undefined}
        onClick={
          versionPreviewOf2 === null
            ? undefined
            : (..._extraArguments: unknown[]): undefined => {
                if (selected) {
                  if (!stacked) {
                    PlatformSyncAndRoutingAssign2.getState().clear();
                  }
                } else {
                  PlatformSyncAndRoutingAssign2.getState().set(versionPreviewOf2);
                }
                if (stacked) {
                  updatePlatformSyncAndRoutingPhoneView2();
                }
              }
        }
        disabled={!matchesVersionPreviewOf}
        className={`min-w-0 flex-1 text-left ${v2 ? `before:absolute before:inset-0 before:content-[''] focus-visible:outline-hidden ` : ``}${matchesVersionPreviewOf ? `` : `cursor-default`}`}
      >
        <div
          className={
            v2
              ? `text-primary text-body-regular relative`
              : `text-primary text-[13px] font-medium`
          }
        >
          {versionTimeLabel2}
          {isCurrent && (
            <span
              className={
                v2 ? `text-muted text-caption ml-2` : `text-secondary ml-2 text-[11px]`
              }
            >{`Current`}</span>
          )}
          {historyActionLabel2 && (
            <span
              className={
                v2
                  ? `text-secondary text-caption ml-2`
                  : `text-secondary ml-2 text-[11px]`
              }
            >
              {historyActionLabel2}
            </span>
          )}
        </div>
        <div
          className={
            v2
              ? `text-secondary text-caption relative mt-1 flex min-w-0 items-center gap-x-1.5 gap-y-0.5${enabled ? ` flex-wrap` : ``}`
              : `text-secondary mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px]`
          }
        >
          <ContributorAvatars who={who} keepClaude={v2} xs={v2} decorative={v2} />
          <span
            className={v2 && enabled ? `max-w-max min-w-0 flex-1 truncate` : `truncate`}
          >
            {contributorsSummary(useContributorNames2)}
          </span>
          {enabled && (
            <span
              className={v2 ? `text-muted order-last basis-full` : `text-muted shrink-0`}
            >
              {v2 ? versionTimeLabel : `· ${versionTimeLabel}`}
            </span>
          )}
          {count > 1 && !editsTitle && (
            <span className={`text-muted shrink-0`} data-testid={`history-group-count`}>
              {`· `}
              {count}
              {` versions`}
            </span>
          )}
          {stats &&
            !(
              stats.total === 0 &&
              historyVersionRowResult2?.aside?.inPlaceOfNoChanges === true
            ) && (
              <span className={`text-muted shrink-0`} data-testid={`history-row-stats`}>
                {`· `}
                {changeStatsLabel(stats, historyVersionRowResult.locale, {
                  net: opens?.group !== undefined,
                })}
              </span>
            )}
          {(stats
            ? [historyVersionRowResult2?.aside]
            : [historyVersionRowResult2?.note, historyVersionRowResult2?.aside]
          ).map(
            (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              item != null && (
                <Tooltip content={item.full} key={item.full}>
                  {
                    <span
                      className={`text-muted min-w-0 truncate`}
                      data-testid={`history-row-note`}
                    >
                      <span aria-hidden={`true`}>
                        {`· `}
                        {item.short}
                      </span>
                      <span className={`sr-only`}>{item.full}</span>
                    </span>
                  }
                </Tooltip>
              ),
          )}
          {contains && (
            <span className={`sr-only`}>{`Contains the selected version`}</span>
          )}
        </div>
      </button>
      {v2 && menu?.(versionPreviewOf2)}
      {v2 &&
        (useHistoryTabStops2 || !(0, React.isValidElement)(lead)
          ? lead
          : (0, React.cloneElement)(lead, {
              tabIndex: -1,
            }))}
    </div>
  );
};

export const HistoryLabel: ReactComponentTypes.FC<Dynamic> = ({ label: label }) => {
  let labelRef: Dynamic = (0, React.useRef)(null);
  return (
    <Tooltip
      lazy={true}
      content={(..._extraArguments: unknown[]): Dynamic =>
        overflowLabel(labelRef.current, label)
      }
    >
      <span ref={labelRef} className={`line-clamp-2`} data-testid={`history-row-label`}>
        {label}
      </span>
    </Tooltip>
  );
};

export const HistoryControls: ReactComponentTypes.FC<
  Readonly<Record<string, unknown>>
> = () => {
  let historyControlsResult: Dynamic = resolvePlatformSyncAndRoutingShowChanges();
  let historyControlsResult2: Dynamic = resolvePlatformSyncAndRoutingCompareMode();
  let historyControlsResult3: Dynamic = resolvePlatformSyncAndRoutingCompact();
  let controlId: Dynamic = (0, React.useId)();
  return (
    <div
      data-testid={`history-controls`}
      className={`flex shrink-0 flex-col gap-2 border-b px-4 py-2`}
    >
      <div className={`flex items-center justify-between gap-2`}>
        <span
          id={controlId}
          className={`text-primary text-caption font-medium`}
        >{`Show changes`}</span>
        <Switch
          size={historyControlsResult3(`xs`)}
          checked={historyControlsResult}
          onCheckedChange={(
            historyControls?: Dynamic,
            ..._extraArguments: unknown[]
          ): Dynamic => updatePlatformSyncAndRoutingShowChanges(historyControls)}
          aria-labelledby={controlId}
        />
      </div>
      {historyControlsResult && (
        <div className={`flex flex-col gap-1`} data-testid={`history-compare`}>
          <span className={`text-secondary text-caption`}>{`Compare to`}</span>
          <SegmentedControl
            aria-label={`Compare to`}
            size={historyControlsResult3(`xs`)}
            fullWidth={true}
            value={historyControlsResult2}
            onChange={updatePlatformSyncAndRoutingCompareMode}
            segments={HISTORY_COMPARE_OPTIONS}
          />
        </div>
      )}
    </div>
  );
};

export const HistoryLoading: ReactComponentTypes.FC<
  Readonly<Record<string, unknown>>
> = () => {
  return (
    <div
      role={`status`}
      aria-label={`Loading versions`}
      data-testid={`history-loading`}
      className={`flex flex-col gap-4 px-2 py-1.5`}
    >
      {[0, 1, 2].map(
        (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => (
          <div className={`flex flex-col gap-1.5`} key={item}>
            {<div className={`bg-alpha-1 h-3 w-2/3 animate-pulse rounded`} />}
            {<div className={`bg-alpha-1 h-2.5 w-1/3 animate-pulse rounded`} />}
          </div>
        ),
      )}
    </div>
  );
};

export const UseHistoryDialogExitComponent: ReactComponentTypes.FC<Dynamic> = ({
  onLeave: onLeave,
  press: press,
}) => {
  let elementRef: Dynamic = (0, React.useRef)(null);
  let onLeaveRef: Dynamic = (0, React.useRef)(onLeave);
  onLeaveRef.current = onLeave;
  (0, React.useLayoutEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      let closest: Dynamic =
        elementRef.current?.closest(`[role="dialog"], [role="alertdialog"]`) ?? null;
      let ownerDocument: Dynamic = closest?.ownerDocument;
      let useHistoryDialogExitHandler = (
        historyDialogExit?: Dynamic,
        ..._extraArguments: unknown[]
      ): undefined => {
        if (ownerDocument && isActivationKey(historyDialogExit)) {
          holdActivationKey(ownerDocument, press, historyDialogExit);
        }
      };
      ownerDocument?.addEventListener(`keydown`, useHistoryDialogExitHandler, true);
      return (..._extraArguments: unknown[]): undefined => {
        ownerDocument?.removeEventListener(`keydown`, useHistoryDialogExitHandler, true);
        if (!closest || !ownerDocument || !press.pressed) return;
        let useHistoryDialogExitHandler2 = (..._extraArguments: unknown[]): undefined => {
          let activeElement: Dynamic = ownerDocument.activeElement;
          if (
            !(
              !press.pressed ||
              closest.isConnected ||
              (activeElement !== null && activeElement !== ownerDocument.body) ||
              !ownerDocument.hasFocus()
            )
          ) {
            onLeaveRef.current();
          }
        };
        ownerDocument.defaultView?.requestAnimationFrame(
          (..._extraArguments: unknown[]): Dynamic =>
            afterActivationKeyReleased(press, useHistoryDialogExitHandler2),
        );
      };
    },
    [press],
  );
  return <span ref={elementRef} hidden={true} />;
};

export const ActivityEntry: ReactComponentTypes.FC<Dynamic> = ({
  entry: entry,
  now: now,
  locale: locale,
  tz: tz,
}) => {
  let deleted: boolean = entry.blockKind === `deleted`;
  let restore: boolean = entry.blockKind === `restore`;
  let blockId: Dynamic = deleted ? entry.rewroteId : restore ? undefined : entry.blockId;
  let label: Dynamic = entry.label ?? activityBlockLabel(entry.blockKind, entry.blocks);
  let at: Dynamic =
    entry.at === undefined
      ? null
      : resolvePlatformSessionAndSourcesWeekday(entry.at, now, locale, tz);
  let toLocaleString: Dynamic =
    entry.at === undefined
      ? undefined
      : new (Date as Dynamic)(entry.at).toLocaleString(locale, {
          dateStyle: `medium`,
          timeStyle: `short`,
          timeZone: tz,
        });
  let activityCauseLabel2: Dynamic =
    entry.label === undefined && ((deleted && entry.cause === `deleted`) || restore)
      ? undefined
      : activityCauseLabel(entry.cause);
  let label2: Dynamic =
    entry.blocks !== undefined &&
    entry.blocks > 1 &&
    !(deleted && entry.label === undefined)
      ? `${entry.blocks} blocks`
      : undefined;
  let matchesActivityCauseLabel: boolean =
    activityCauseLabel2 !== undefined ||
    label2 !== undefined ||
    entry.rewroteAs !== undefined;
  let jsxs: Dynamic = (
    <jsxRuntime.Fragment>
      <span className={`flex min-w-0 items-baseline gap-2`}>
        <span
          className={`min-w-0 flex-1 truncate ${deleted ? `text-secondary line-through` : restore ? `text-secondary italic` : `text-primary`}`}
          data-testid={`activity-entry-label`}
        >
          {label}
        </span>
        {at !== null && (
          <time
            className={`text-secondary text-caption shrink-0`}
            dateTime={entry.at}
            title={toLocaleString}
          >
            {at}
          </time>
        )}
      </span>
      {matchesActivityCauseLabel && (
        <span
          className={`text-secondary text-caption mt-0.5 flex min-w-0 items-center gap-1.5`}
        >
          {activityCauseLabel2 !== undefined && (
            <span className={`rounded border px-1`} data-testid={`activity-entry-cause`}>
              {activityCauseLabel2}
            </span>
          )}
          {label2 !== undefined && (
            <span>
              {activityCauseLabel2 === undefined ? `` : `· `}
              {label2}
            </span>
          )}
          {entry.rewroteAs !== undefined && (
            <span className={`min-w-0 truncate`} data-testid={`activity-entry-rewrote`}>
              {`· rewrote as “`}
              {entry.rewroteAs}
              {`”`}
            </span>
          )}
        </span>
      )}
    </jsxRuntime.Fragment>
  );
  let label3: string = `text-body flex w-full flex-col rounded py-1.5 pr-2 pl-8 text-left`;
  return blockId === undefined ? (
    <div className={label3} data-testid={`activity-entry`} data-cause={entry.cause}>
      {jsxs}
    </div>
  ) : (
    <button
      type={`button`}
      className={`${label3} hover:bg-fill-ghost-hover focus-visible:ring-fill-accent focus-visible:ring-2 focus-visible:outline-hidden focus-visible:ring-inset`}
      data-testid={`activity-entry`}
      data-cause={entry.cause}
      data-bid={blockId}
      onClick={(..._extraArguments: unknown[]): Dynamic =>
        updateEditorSelectionAndTablesAsk(blockId)
      }
    >
      {jsxs}
      <span className={`sr-only`}>
        {`, `}
        {SHOW_ACTIVITY_IN_DOCUMENT_LABEL}
      </span>
    </button>
  );
};

export const ActivityGroup: ReactComponentTypes.FC<Dynamic> = ({
  group: group,
  now: now,
  locale: locale,
  tz: tz,
}) => {
  return (
    <section data-testid={`activity-group`} className={`flex flex-col`}>
      <ActivityGroupHeader actor={group.actor} />
      <ul className={`flex flex-col`}>
        {group.entries.map(
          (entry?: Dynamic, ..._extraArguments: unknown[]): Dynamic => (
            <li key={`${entry.rev}:${entry.blockId ?? entry.blockKind}`}>
              {<ActivityEntry entry={entry} now={now} locale={locale} tz={tz} />}
            </li>
          ),
        )}
      </ul>
    </section>
  );
};

export const ActivityLoading: ReactComponentTypes.FC<
  Readonly<Record<string, unknown>>
> = () => {
  return (
    <div
      role={`status`}
      aria-label={`Loading activity`}
      data-testid={`activity-loading`}
      className={`flex flex-col gap-4 px-2 py-1.5`}
    >
      {[0, 1].map(
        (item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => (
          <div className={`flex flex-col gap-2`} key={item}>
            {
              <div className={`flex items-center gap-2`}>
                <div className={`bg-alpha-1 size-4 animate-pulse rounded-full`} />
                <div className={`bg-alpha-1 h-3 w-1/3 animate-pulse rounded`} />
              </div>
            }
            {<div className={`bg-alpha-1 ml-8 h-3 w-2/3 animate-pulse rounded`} />}
            {<div className={`bg-alpha-1 ml-8 h-3 w-1/2 animate-pulse rounded`} />}
          </div>
        ),
      )}
    </div>
  );
};

export const ActivityCoverageNotice: ReactComponentTypes.FC<Dynamic> = ({
  feed: feed,
}) => {
  let allUnattributed: Dynamic =
    feed.groups.length > 0 &&
    feed.groups.every(
      (group?: Dynamic, ..._extraArguments: unknown[]) => group.actor === null,
    );
  let messages: Dynamic = [
    ...(allUnattributed ? [NO_ATTRIBUTION_COPY] : []),
    ...(!allUnattributed && feed.recordedFromRev !== undefined
      ? [PARTIAL_ATTRIBUTION_COPY]
      : []),
    ...(feed.goneForgotten ? [FORGOTTEN_ACTIVITY_COPY] : []),
    ...(!allUnattributed &&
    !feed.complete &&
    feed.recordedFromRev === undefined &&
    !feed.goneForgotten
      ? [INCOMPLETE_ATTRIBUTION_COPY]
      : []),
  ];
  return messages.length === 0 ? null : (
    <div
      data-testid={`activity-footer`}
      data-recorded-from-rev={feed.recordedFromRev}
      className={`text-secondary text-caption flex flex-col gap-1 px-2 pt-4 pb-2`}
    >
      {messages.map(
        (message?: Dynamic, ..._extraArguments: unknown[]): Dynamic => (
          <p key={message}>{message}</p>
        ),
      )}
    </div>
  );
};

export const PageActivityPanel: ReactComponentTypes.FC<Dynamic> = ({
  roomFile: roomFile,
}) => {
  let mode: Dynamic = resolvePlatformApiAndAuthUseContext2();
  let now: number = Date.parse(mode.now());
  let feed: Dynamic = usePageActivity(roomFile);
  let { pid: pid, fileId: fileId }: Dynamic = roomFile;
  let reader: Dynamic = (0, React.useMemo)(
    (..._extraArguments: unknown[]): Dynamic => ({
      pid: pid,
      fileId: fileId,
    }),
    [pid, fileId],
  );
  let tick: Dynamic = PlatformApiAndAuthTick(
    (pageActivityPanel?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      pageActivityPanel.tick,
  );
  let listRef: Dynamic = (0, React.useRef)(null);
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      let matchesList: boolean = listRef.current !== null && listRef.current !== tick;
      listRef.current = tick;
      if (matchesList || !isPageActivityFresh(reader)) {
        usePageActivityStore.getState().load(reader);
      }
    },
    [reader, tick],
  );
  let feed2: Dynamic = feed.feed;
  let groups: Dynamic = feed2?.groups ?? [];
  let pageActivityPanelHandler = (..._extraArguments: unknown[]): undefined =>
    void usePageActivityStore.getState().load(reader);
  return feed.status === `unavailable` ? null : (
    <div className={`flex h-full flex-col`} data-testid={`activity-rail`}>
      <div
        role={`group`}
        aria-label={`Activity`}
        data-testid={`activity-list`}
        data-rail-list={``}
        className={`min-h-0 flex-1 overflow-y-auto px-2 py-1`}
      >
        {feed2 === undefined && (feed.status === `loading` || feed.status === `idle`) ? (
          <ActivityLoading />
        ) : feed2 === undefined && feed.status === `error` ? (
          <ActivityError onRetry={pageActivityPanelHandler} />
        ) : feed2 === undefined ? null : (
          <jsxRuntime.Fragment>
            {feed.status === `error` && (
              <ActivityError onRetry={pageActivityPanelHandler} />
            )}
            {groups.length === 0 ? (
              <ActivityEmpty />
            ) : (
              groups.map(
                (group?: Dynamic, ..._extraArguments: unknown[]): Dynamic => (
                  <ActivityGroup
                    group={group}
                    now={now}
                    locale={mode.locale}
                    tz={mode.timeZone}
                    key={activityActorKey(group.actor)}
                  />
                ),
              )
            )}
            {feed2.next !== undefined && feed.status === `ready` && (
              <div className={`px-2 pt-3 pb-2`}>
                <Button
                  data-testid={`activity-load-older`}
                  disabled={feed.loadingMore}
                  onClick={(..._extraArguments: unknown[]): undefined =>
                    void usePageActivityStore.getState().loadMore(reader)
                  }
                >
                  {feed.loadingMore ? `Loading…` : `Show older activity`}
                </Button>
              </div>
            )}
            <ActivityCoverageNotice feed={feed2} />
          </jsxRuntime.Fragment>
        )}
      </div>
    </div>
  );
};

export const FileSourcesPanel: ReactComponentTypes.FC<Dynamic> = ({
  container: container,
  version: version,
  path: path,
}) => {
  let project: Dynamic = container.replace(/@[^@]*$/, ``);
  let relativePath: string = `${project}/versions/${version}/${path}`;
  let fileEntry: Dynamic = collectPlatformApiAndAuthJoin2(relativePath);
  let key: string = fileSnapshotKey(relativePath, version, fileEntry);
  let content: Dynamic = useFileSnapshotStore(
    (fileSourcesPanel?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      fileSourcesPanel.entries.get(key),
  );
  let [error, setError]: Dynamic = (0, React.useState)(null);
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      setError(key);
      useFileSnapshotStore.getState().load(relativePath, version, fileEntry, true);
    },
    [relativePath, version, fileEntry, key],
  );
  let memoized: Dynamic = (0, React.useMemo)(
    (..._extraArguments: unknown[]): Dynamic => {
      if (content?.status !== `ok`) return null;
      try {
        let fileSourcesPanelResult: Dynamic = collectManifestReferences(
          JSON.parse(content.text()),
        );
        return {
          runs: [...fileSourcesPanelResult.runs].toSorted(),
          reads: [...fileSourcesPanelResult.reads].toSorted(),
        };
      } catch (error2: Dynamic) {
        return {
          parseErr:
            error2 instanceof (Error as Dynamic) ? error2.message : String(error2),
        };
      }
    },
    [content],
  );
  let fileSourcesPanelHandler: Dynamic = (
    fileSourcesPanel?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => (
    <div className={`text-muted text-footnote p-md`}>
      {`Couldn’t read sources (`}
      {fileSourcesPanel}
      {`).`}
    </div>
  );
  return memoized !== null && `parseErr` in memoized ? (
    fileSourcesPanelHandler(memoized.parseErr)
  ) : content?.status === `error` && error === key ? (
    fileSourcesPanelHandler(content.error)
  ) : memoized === null ? (
    <div className={`text-muted text-footnote p-md`}>{`Loading…`}</div>
  ) : (
    <div className={`flex h-full flex-col gap-4 overflow-auto p-3`}>
      <SourceSection title={`Functions this doc runs`} empty={`No functions`}>
        {memoized.runs.slice(0, 64).map(
          (runsSlice?: Dynamic, ..._extraArguments: unknown[]): Dynamic => (
            <FunctionSourcesPanel container={project} fnRef={runsSlice} key={runsSlice} />
          ),
        )}
        {memoized.runs.length > 64 && <MoreSourcesCount n={memoized.runs.length - 64} />}
      </SourceSection>
      <SourceSection title={`Data this doc reads`} empty={`No bound data`}>
        {memoized.reads.slice(0, 64).map(
          (readsSlice?: Dynamic, ..._extraArguments: unknown[]): Dynamic => (
            <SourceReference refStr={readsSlice} key={readsSlice} />
          ),
        )}
        {memoized.reads.length > 64 && (
          <MoreSourcesCount n={memoized.reads.length - 64} />
        )}
      </SourceSection>
    </div>
  );
};

export const FunctionSourcesPanel: ReactComponentTypes.FC<Dynamic> = ({
  container: container,
  fnRef: fnRef,
}) => {
  let parsedRef: Dynamic = resolveDataModelSchemasEmptyRef(fnRef);
  let resource: Dynamic = resolvePlatformApiAndAuthValue28(parsedRef)
    ? undefined
    : parsedRef[0]?.resource;
  let fnId: Dynamic = resource?.kind === `fn` ? resource.id.split(`/`)[0] : fnRef;
  let mode: Dynamic = resolvePlatformApiAndAuthUseContext2();
  let slot: Dynamic = (0, React.useId)();
  let entry: Dynamic = useFunctionRunStore(
    (functionSourcesPanel?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      functionSourcesPanel.entries[slot],
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      useFunctionRunStore.getState().load(slot, container, fnId);
    },
    [slot, container, fnId],
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic =>
      (..._extraArguments: unknown[]): Dynamic =>
        useFunctionRunStore.getState().release(slot),
    [slot],
  );
  let fnId2: Dynamic = entry === undefined ? fnId : entry.address;
  let jsxs: Dynamic = (
    <jsxRuntime.Fragment>
      <SourceBadge icon={`Play`}>{fnId}</SourceBadge>
      <span className={`text-muted ml-auto text-[10px]`}>
        {entry === undefined
          ? ``
          : entry.run
            ? relativeSourceTime(entry.run.timing.endedAt, Date.parse(mode.now()))
            : `never run`}
      </span>
    </jsxRuntime.Fragment>
  );
  let label: string = `hover:bg-alpha-1 group flex items-center gap-2 rounded px-1 py-1`;
  return fnId2 === null ? (
    <div className={label}>{jsxs}</div>
  ) : (
    <a href={`?path=${encodeURIComponent(`.function/${fnId2}`)}`} className={label}>
      {jsxs}
    </a>
  );
};

export const RightRail: ReactComponentTypes.FC<Dynamic> = ({
  container: container,
  version: version,
  path: path,
  pageId: pageId,
  roomFile: roomFile,
  initial = `history`,
  onRestore: onRestore,
  onCopy: onCopy,
  readOnly: readOnly,
  stacked: stacked,
  besideBar: besideBar,
  onLeave: onLeave,
}) => {
  let isDocument: Dynamic = !!path && path.endsWith(`.ldoc`);
  let activityAvailable: Dynamic = useAttributionPanelEnabled(roomFile, !readOnly);
  let filteredRAILTABS: Dynamic = RAIL_TABS.filter(
    (RAILTABS?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      RAILTABS.k === `history` ||
      (RAILTABS.k === `activity` && activityAvailable && !!roomFile) ||
      (RAILTABS.k === `sources` && isDocument && !roomFile),
  );
  let [initialState, setInitialState]: Dynamic = (0, React.useState)(initial);
  let initialState2: Dynamic = filteredRAILTABS.some(
    (filteredRAILTABS2?: Dynamic, ..._extraArguments: unknown[]) =>
      filteredRAILTABS2.k === initialState,
  )
    ? initialState
    : `history`;
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (initialState2 !== initialState) {
        setInitialState(initialState2);
      }
    },
    [initialState2, initialState],
  );
  let rightRailHandler = (
    rightRail?: Dynamic,
    ..._extraArguments: unknown[]
  ): undefined => {
    if (rightRail === `activity`) {
      PlatformSyncAndRoutingAssign2.getState().clear();
    }
    setInitialState(rightRail);
  };
  let label: Dynamic = roomFile ? `${roomFile.pid}/${roomFile.fileId}` : (path ?? ``);
  let labelRef: Dynamic = (0, React.useRef)(label);
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): undefined => {
      if (labelRef.current !== label) {
        setInitialState(initial);
      }
      labelRef.current = label;
    },
    [label, initial],
  );
  let [enabledState, setEnabledState]: Dynamic = (0, React.useState)(false);
  let elementRef: Dynamic = (0, React.useRef)(null);
  let elementRef2: Dynamic = (0, React.useRef)(null);
  let elementRef3: Dynamic = (0, React.useRef)(null);
  let callback: Dynamic = (0, React.useCallback)(
    (..._extraArguments: unknown[]): undefined => {
      let element: Dynamic = elementRef2.current;
      let matchedElement: Dynamic =
        elementRef3.current?.querySelector(`[data-rail-list]`);
      setEnabledState(isPopupScrollBoundary(element, matchedElement ?? null));
    },
    [],
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      let element: Dynamic = elementRef3.current;
      if (!besideBar || !element) return;
      callback();
      let mutationObserver: Dynamic =
        typeof MutationObserver === "undefined"
          ? null
          : new (MutationObserver as Dynamic)(callback);
      mutationObserver?.observe(element, {
        childList: true,
        subtree: true,
      });
      return (..._extraArguments: unknown[]): undefined => {
        mutationObserver?.disconnect();
        setEnabledState(false);
      };
    },
    [besideBar, callback],
  );
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic =>
      stacked ? resolvePlatformSyncAndRoutingStackOffers() : undefined,
    [stacked],
  );
  let rightRailResult: Dynamic = resolvePlatformSyncAndRoutingValue22();
  let record: Dynamic = rightRailResult
    ? {
        role: `complementary`,
        "aria-label": RAIL_TAB_TITLES[initialState2],
      }
    : {};
  return (
    <div
      ref={elementRef}
      className={
        stacked
          ? `bg-surface-panel flex h-full w-full flex-col`
          : `bg-surface-panel flex h-full w-[320px] shrink-0 flex-col border-l`
      }
      {...record}
    >
      {
        <div
          ref={elementRef2}
          className={
            besideBar
              ? `relative flex ${RAIL_ROW_HEIGHT_CLASS} shrink-0 items-center gap-1 px-3`
              : `flex h-12 shrink-0 items-center gap-1 border-b px-3`
          }
        >
          {filteredRAILTABS.length === 1 ? (
            <h2 className={`text-primary flex-1 truncate text-[13px] font-semibold`}>
              {filteredRAILTABS[0].label}
            </h2>
          ) : (
            <div className={`flex flex-1 gap-3`}>
              {filteredRAILTABS.map(
                (
                  { k: k2, label: label2, antOnly: antOnly }: Dynamic,
                  ..._extraArguments: unknown[]
                ): Dynamic => (
                  <button
                    type={`button`}
                    data-testid={`rail-tab-${k2}`}
                    aria-pressed={initialState2 === k2}
                    onClick={(..._extraArguments: unknown[]): Dynamic =>
                      rightRailHandler(k2)
                    }
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold ${initialState2 === k2 ? `text-primary` : `text-muted hover:text-primary`}`}
                    key={k2}
                  >
                    {label2}
                    {antOnly && (
                      <jsxRuntime.Fragment>
                        {` `}
                        <Tooltip
                          content={`Only visible to Anthropic employees while Page activity is in preview.`}
                        >
                          <Badge
                            variant={`neutral`}
                            size={`xxs`}
                            aria-description={`Only visible to Anthropic employees while Page activity is in preview.`}
                            data-testid={`rail-tab-${k2}-ant-only`}
                            className={`shrink-0 select-none`}
                          >{`Ant only`}</Badge>
                        </Tooltip>
                      </jsxRuntime.Fragment>
                    )}
                  </button>
                ),
              )}
            </div>
          )}
          <Tooltip content={`Close`}>
            <IconButton
              aria-label={`Close`}
              size={24}
              icon={<UiOverlaysAndIconsCustomIcon name={`X`} customSize={14} />}
              onClick={(event?: Dynamic, ..._extraArguments: unknown[]): undefined => {
                let rightRailResult2: Dynamic =
                  rightRailResult &&
                  (document as Dynamic).hasFocus() &&
                  event.detail === 0;
                try {
                  if (
                    rightRailResult &&
                    !rightRailResult2 &&
                    (document as Dynamic).hasFocus() &&
                    event.currentTarget.matches(`:focus-visible`)
                  ) {
                    rightRailResult2 = true;
                  }
                } catch {}
                let activeElement: Dynamic = (document as Dynamic).activeElement;
                let activeElement2: Dynamic =
                  rightRailResult2 &&
                  activeElement instanceof (HTMLElement as Dynamic) &&
                  elementRef.current?.contains(activeElement)
                    ? activeElement
                    : null;
                if (
                  !activeElement2 &&
                  activeElement !== null &&
                  activeElement !== (document as Dynamic).body
                ) {
                  rightRailResult2 = false;
                }
                PlatformSyncAndRoutingAssign2.getState().clear();
                PlatformSyncAndRoutingState4.getState().set(false);
                if (rightRailResult2) {
                  activeElement2?.blur();
                  onLeave?.();
                }
              }}
            />
          </Tooltip>
          {besideBar && (
            <div
              aria-hidden={`true`}
              data-testid={`rail-header-rule`}
              className={`bg-border duration-snap pointer-events-none absolute inset-x-0 bottom-0 h-px transition-opacity ease-out motion-reduce:transition-none ${enabledState ? `opacity-100` : `opacity-0`}`}
            />
          )}
        </div>
      }
      {
        <div
          ref={elementRef3}
          className={`relative min-h-0 flex-1 overflow-clip`}
          onScrollCapture={besideBar ? callback : undefined}
        >
          {initialState2 === `sources` && isDocument && path ? (
            <FileSourcesPanel container={container} version={version} path={path} />
          ) : initialState2 === `activity` && roomFile ? (
            <PageActivityPanel roomFile={roomFile} />
          ) : (
            <VersionHistoryPanel
              container={container}
              version={version}
              path={path}
              pageId={pageId}
              roomFile={roomFile}
              onRestore={onRestore}
              onCopy={onCopy}
              readOnly={readOnly}
              onLeave={onLeave}
              {...(stacked
                ? {
                    stacked: stacked,
                  }
                : {})}
            />
          )}
        </div>
      }
    </div>
  );
};

export const HistoryError: ReactComponentTypes.FC<Dynamic> = ({
  forbidden: forbidden,
  retrying: retrying,
  onRetry: onRetry,
}) => {
  return (
    <div
      role={`alert`}
      data-testid={`history-error`}
      className={`flex flex-col items-center gap-2 px-4 py-6 text-center`}
    >
      <div className={`text-primary text-body font-medium`}>
        {forbidden
          ? `You don't have access to this document's history`
          : `Couldn't load version history`}
      </div>
      <div className={`text-secondary text-caption`}>
        {forbidden
          ? `Only people who can edit this document can see its earlier versions.`
          : `Check your connection, then try again.`}
      </div>
      {!forbidden && (
        <Button data-testid={`history-retry`} disabled={retrying} onClick={onRetry}>
          {retrying ? `Retrying…` : `Try again`}
        </Button>
      )}
    </div>
  );
};

export const HistoryEmpty: ReactComponentTypes.FC<Dynamic> = ({ readOnly: readOnly }) => {
  return (
    <div
      data-testid={`history-empty`}
      className={`flex flex-col items-center gap-1 px-4 py-8 text-center`}
    >
      <div className={`text-primary text-body font-medium`}>{`No versions yet`}</div>
      <div className={`text-secondary text-caption`}>
        {readOnly
          ? `Earlier versions of this document will appear here.`
          : `Versions are saved automatically as you edit.`}
      </div>
    </div>
  );
};

export const ActivityGroupHeader: ReactComponentTypes.FC<Dynamic> = ({
  actor: actor,
}) => {
  let kind: string = activityActorKind(actor);
  let displayName: Dynamic = useActivityActorName(actor?.principal ?? ``);
  if (kind === `nobody`)
    return (
      <div
        className={`flex items-center gap-2 px-2 pt-3 pb-1`}
        data-testid={`activity-group-header`}
        data-actor-kind={kind}
      >
        <span
          className={`bg-alpha-2 size-4 shrink-0 rounded-full`}
          aria-hidden={`true`}
        />
        <h3 className={`text-secondary text-body min-w-0 flex-1 truncate font-semibold`}>
          {UNATTRIBUTED_LABEL}
        </h3>
      </div>
    );
  let record: Dynamic =
    kind === `agent`
      ? {
          kind: `claude`,
          label: `Claude`,
        }
      : kind === `room`
        ? {
            kind: `system`,
            label: `auto-save`,
          }
        : {
            kind: `human`,
            label: displayName.words ?? `Someone`,
            email: actor.principal,
          };
  let label: Dynamic =
    kind === `room`
      ? `auto-save`
      : displayName.words === undefined
        ? undefined
        : kind === `agent`
          ? claudeViaLabel(displayName.named ? displayName.words : null)
          : displayName.words;
  return (
    <div
      className={`flex items-center gap-2 px-2 pt-3 pb-1`}
      data-testid={`activity-group-header`}
      data-actor-kind={kind}
    >
      <ContributorAvatar who={record} xs={true} />
      {label === undefined ? (
        <span
          className={`bg-alpha-1 h-3 w-24 animate-pulse rounded`}
          data-testid={`activity-name-loading`}
        />
      ) : (
        <h3 className={`text-primary text-body min-w-0 flex-1 truncate font-semibold`}>
          {label}
        </h3>
      )}
    </div>
  );
};

export const ActivityEmpty: ReactComponentTypes.FC<
  Readonly<Record<string, unknown>>
> = () => {
  return (
    <div
      data-testid={`activity-empty`}
      className={`flex flex-col items-center gap-1 px-4 py-8 text-center`}
    >
      <div className={`text-primary text-body font-medium`}>{ACTIVITY_EMPTY_TITLE}</div>
      <div className={`text-secondary text-caption`}>{ACTIVITY_EMPTY_COPY}</div>
    </div>
  );
};

export const ActivityError: ReactComponentTypes.FC<Dynamic> = ({ onRetry: onRetry }) => {
  return (
    <div
      role={`alert`}
      data-testid={`activity-error`}
      className={`flex flex-col items-center gap-2 px-4 py-6 text-center`}
    >
      <div className={`text-primary text-body font-medium`}>{ACTIVITY_ERROR_TITLE}</div>
      <div className={`text-secondary text-caption`}>{ACTIVITY_ERROR_COPY}</div>
      <Button data-testid={`activity-retry`} onClick={onRetry}>{`Try again`}</Button>
    </div>
  );
};

export const MoreSourcesCount: ReactComponentTypes.FC<Dynamic> = ({ n: count }) => {
  return (
    <div className={`text-muted px-1 py-1 text-[11px]`}>
      {`(+`}
      {count}
      {` more)`}
    </div>
  );
};

export const SourceReference: ReactComponentTypes.FC<Dynamic> = ({ refStr: refStr }) => {
  return (
    <div className={`flex items-center gap-2 px-1 py-1`}>
      <SourceBadge
        icon={
          /^(fn|routine):/.test(refStr)
            ? `Play`
            : refStr.startsWith(`run:`)
              ? `History`
              : `CodeBrackets`
        }
      >
        {refStr}
      </SourceBadge>
    </div>
  );
};

export const SourceSection: ReactComponentTypes.FC<Dynamic> = ({
  title: title,
  empty: empty,
  children: children,
}) => {
  let hasChildren: boolean = React.Children.toArray(children).length > 0;
  return (
    <div className={`flex flex-col gap-1`}>
      <div className={`text-muted px-1 text-[10px] font-medium tracking-wide uppercase`}>
        {title}
      </div>
      {hasChildren ? (
        children
      ) : (
        <div className={`text-muted px-1 py-1 text-[11px]`}>{empty}</div>
      )}
    </div>
  );
};

export const SourceBadge: ReactComponentTypes.FC<Dynamic> = ({
  icon: icon,
  children: children,
}) => {
  return (
    <span
      className={`bg-surface-0 text-muted inline-flex max-w-full items-center gap-1 truncate rounded border px-1 py-0.5 text-[10px]`}
    >
      <UiOverlaysAndIconsCustomIcon name={icon} customSize={10} />
      <span className={`truncate`}>{children}</span>
    </span>
  );
};

const mapPreloadDependencies: Dynamic = (
  ..._extraArguments: unknown[]
): Dynamic => [];
import { toModuleNamespace } from "../boot/module-runtime";
import {
  Button,
  collectPlatformApiAndAuthJoin2,
  framePeekProfile,
  frameProfiles,
  loadJsxRuntime,
  loadReact,
  PlatformApiAndAuthPriming,
  PlatformApiAndAuthTick,
  PlatformLiveDocumentAndHistoryEntries2,
  PlatformSyncAndRoutingAssign2,
  PlatformSyncAndRoutingState4,
  resolveDataModelSchemasEmptyRef,
  resolveEditorAnchorsAndMentionsEmail,
  resolveEditorAnchorsAndMentionsOther,
  resolveObservabilityBrowserAndOperationEventsStartsWith,
  resolvePlatformAnnouncementsValue,
  resolvePlatformAnnouncementsValue2,
  resolvePlatformApiAndAuthSplit2,
  resolvePlatformApiAndAuthToLowerCase,
  resolvePlatformApiAndAuthUseContext2,
  resolvePlatformApiAndAuthValue28,
  resolvePlatformLiveDocumentAndHistoryBars,
  resolvePlatformLiveDocumentAndHistoryNote2,
  resolvePlatformLiveDocumentAndHistoryParams,
  resolvePlatformLiveDocumentAndHistoryParams2,
  resolvePlatformSessionAndSourcesWeekday,
  resolvePlatformSyncAndRoutingCompact,
  resolvePlatformSyncAndRoutingCompareMode,
  resolvePlatformSyncAndRoutingCopyAsk,
  resolvePlatformSyncAndRoutingCopyOffers,
  resolvePlatformSyncAndRoutingList,
  resolvePlatformSyncAndRoutingPreview,
  resolvePlatformSyncAndRoutingRestoreAsk,
  resolvePlatformSyncAndRoutingRestoreOffers,
  resolvePlatformSyncAndRoutingShowChanges,
  resolvePlatformSyncAndRoutingStackOffers,
  resolvePlatformSyncAndRoutingValue22,
  resolvePlatformSyncAndRoutingValue24,
  resolvePlatformSyncAndRoutingValue26,
  Tooltip,
  UiDialogsRoot,
  UiOverlaysAndIconsCustomIcon,
  updateEditorSelectionAndTablesAsk,
  updatePlatformLiveDocumentAndHistoryComponent,
  updatePlatformLiveDocumentAndHistoryRail,
  updatePlatformSyncAndRoutingCaption,
  updatePlatformSyncAndRoutingCompareMode,
  updatePlatformSyncAndRoutingHeadDrivenId,
  updatePlatformSyncAndRoutingHeadEpoch,
  updatePlatformSyncAndRoutingPhoneView2,
  updatePlatformSyncAndRoutingShowChanges,
  useCommentsActionsAndSelectionAccount,
  useCommentsActionsAndSelectionPlatform,
  usePlatformLiveDocumentAndHistoryPid2,
} from "../platform/index";
import { isFrameArtifact } from "../boot/environment";
import { preloadModule } from "../boot/preload";
import {
  Badge,
  Collapsible,
  Menu,
  renderMenuItems,
  SegmentedControl,
  Switch,
} from "../design-system/index";
import {
  CLAUDE_LOGO_DATA_URI,
  CollaboratorAvatar,
  IconButton,
  isPopupScrollBoundary,
  PhoneDialogPopup,
} from "../document-app/index";
import {
  activityActorKey,
  activityActorKind,
  collectManifestReferences,
  fileAtUrl,
  fileSnapshotKey,
  isPageActivityFresh,
  useAttributionPanelEnabled,
  useFileSnapshotStore,
  useFunctionRunStore,
  usePageActivity,
  usePageActivityStore,
} from "../platform/lazy";
import {
  changeStatsLabel,
  checkpointName,
  contributorsAccessibleLabel,
  contributorsOf,
  contributorsSummary,
  currentVersionId,
  groupCheckpointHistory,
  groupHistoryByActor,
  hasVersionEvents,
  historyRows,
  isCheckpointBoundary,
  makeHistoryDayLabeler,
  restoreLabel,
} from "../document-history/groups";
var React: Dynamic = toModuleNamespace(loadReact(), 1);
var RAIL_ROW_HEIGHT_CLASS: string = `h-10 pointer-coarse:h-12`;
var jsxRuntime: Dynamic = loadJsxRuntime();
var CLAUDE_AVATAR_COLOR: string = `#d97757`;
function createHistoryRover(..._extraArguments: unknown[]): Dynamic {
  let current: Dynamic = null;
  let listeners: Dynamic = new (Set as Dynamic)();
  return {
    get: (..._extraArguments: unknown[]): Dynamic => current,
    set: (historyRover?: Dynamic, ..._extraArguments: unknown[]): undefined => {
      if (historyRover !== current) {
        current = historyRover;
        for (let createHistoryRoverResult of listeners as Dynamic)
          createHistoryRoverResult();
      }
    },
    subscribe: (
      historyRover?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => (
      listeners.add(historyRover),
      (..._extraArguments: unknown[]): Dynamic => listeners.delete(historyRover)
    ),
  };
}
var EMPTY_HISTORY_ROVER: Dynamic = {
  get: (..._extraArguments: unknown[]) => null,
  set: (..._extraArguments: unknown[]): undefined => {},
  subscribe:
    (..._extraArguments: unknown[]): Dynamic =>
    (..._extraArguments: unknown[]): undefined => {},
};
function useHistoryTabStops(
  tabStops?: Dynamic,
  id?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let rover: Dynamic = tabStops?.rover ?? EMPTY_HISTORY_ROVER;
  let isCurrent: Dynamic = (0, React.useSyncExternalStore)(
    rover.subscribe,
    (..._extraArguments: unknown[]): boolean =>
      id !== undefined && rover.get() === id,
  );
  let containsCurrent: Dynamic = (0, React.useSyncExternalStore)(
    rover.subscribe,
    (..._extraArguments: unknown[]): Dynamic => {
      let roverEntry: Dynamic = rover.get();
      return roverEntry !== null && (tabStops?.ids.has(roverEntry) ?? false);
    },
  );
  return tabStops === undefined || id === undefined
    ? true
    : tabStops.sel === null
      ? containsCurrent
        ? isCurrent
        : tabStops.first === id
      : tabStops.sel === id;
}
function historyNavigationId(
  element?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let row: Dynamic = element?.closest(`[data-vh-row]`);
  return (
    (
      element?.closest(`[data-nav-id]`) ??
      row?.querySelector(`[data-nav-id]`) ??
      row
        ?.closest(`[data-testid="history-group"]`)
        ?.querySelector(`[data-nav-id]`)
    )?.getAttribute(`data-nav-id`) ?? null
  );
}

function usePrimeContributorAccounts(
  primeContributorAccounts?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      if (!Array.isArray(primeContributorAccounts)) return;
      let mappedItems: Dynamic = [
        ...new (Set as Dynamic)(
          primeContributorAccounts
            .flatMap(contributorsOf)
            .flatMap(
              (
                contributor?: Dynamic,
                ..._extraArguments: unknown[]
              ): Dynamic =>
                contributor.kind === `human` &&
                resolveEditorAnchorsAndMentionsOther(contributor.email) ===
                  `email`
                  ? [contributor.email]
                  : [],
            ),
        ),
      ].map(
        (
          item?: Dynamic,
          index?: Dynamic,
          ..._extraArguments: unknown[]
        ): Dynamic =>
          setTimeout(
            (..._extraArguments: unknown[]): undefined =>
              void PlatformApiAndAuthPriming.getState().prime(
                resolvePlatformApiAndAuthSplit2(item),
              ),
            index * 250,
          ),
      );
      return (..._extraArguments: unknown[]): Dynamic =>
        mappedItems.forEach(clearTimeout);
    },
    [primeContributorAccounts],
  );
}
var HISTORY_ROW_ESTIMATE_PX: number = 52;
var HISTORY_OVERSCAN_ROWS: number = 12;
var formatVersionTime: Dynamic = (
  versionTime?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  new (Date as Dynamic)(versionTime).toLocaleTimeString(options, {
    hour: `numeric`,
    minute: `2-digit`,
    timeZone: context,
  });
var formatVersionTimeLabel: Dynamic = (
  versionTimeLabel?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  options ? `${options} at ${versionTimeLabel}` : versionTimeLabel;
function historyActionLabel(
  historyActionLabel2?: Dynamic,
  ..._extraArguments: unknown[]
): null | string {
  if (historyActionLabel2.tool === `file:delete`) return `deleted`;
  if (historyActionLabel2.tool === `file:rename`) {
    let params: Dynamic = historyActionLabel2.params;
    return params.to ? `renamed → ${params.to}` : `renamed`;
  }
  return restoreLabel(historyActionLabel2);
}
function versionShaOf(
  versionSha?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let params: Dynamic = versionSha.params;
  if (versionSha.tool === `file:write`) return params.after_sha ?? null;
  if (versionSha.tool === `file:delete`) return params.before_sha ?? null;
  if (versionSha.tool === `lfile.checkpoint`) {
    if (params.sha) return params.sha;
    let mutation: Dynamic = versionSha.mutation;
    if (mutation && typeof mutation == `object` && !(`nodes` in mutation)) {
      let sha: Dynamic = mutation.sha;
      if (typeof sha == `string`) return sha;
    }
    return null;
  }
  return null;
}
function versionPathOf(
  versionPath?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return versionPath.tool === `lfile.checkpoint`
    ? options
    : (versionPath.anchor?.path ?? options);
}
function versionLabelOf(
  versionLabel?: Dynamic,
  ..._extraArguments: unknown[]
): null | string {
  let label: Dynamic = versionLabel.params.label;
  return typeof label == `string` && label.trim() ? label : null;
}
function useContributorNames(
  contributorNames?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let flatMapText: Dynamic = contributorNames
    .flatMap(
      (contributor?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        contributor.kind === `human` &&
        resolveEditorAnchorsAndMentionsOther(contributor.email) === `platform`
          ? [contributor.email]
          : [],
    )
    .join(`\0`);
  let [recordState, setRecordState]: Dynamic = (0, React.useState)({});
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      if (flatMapText === `` || !isFrameArtifact()) return;
      let flatMapTextParts: Dynamic = flatMapText.split(`\0`);
      let enabled: boolean = true;
      frameProfiles(flatMapTextParts).then(
        (result?: Dynamic, ..._extraArguments: unknown[]): undefined => {
          if (!enabled) return;
          let record: Dynamic = {};
          for (let useContributorNamesResult of flatMapTextParts as Dynamic)
            if (result[useContributorNamesResult]?.name) {
              record[useContributorNamesResult] =
                result[useContributorNamesResult].name;
            }
          setRecordState(record);
        },
      );
      return (..._extraArguments: unknown[]): undefined => {
        enabled = false;
      };
    },
    [flatMapText],
  );
  return flatMapText === ``
    ? contributorNames
    : contributorNames.map(
        (contributor?: Dynamic, ..._extraArguments: unknown[]): Dynamic => {
          if (contributor.kind !== `human`) return contributor;
          let recordStateItem: Dynamic =
            recordState[contributor.email] ??
            framePeekProfile(contributor.email)?.name;
          return recordStateItem
            ? {
                ...contributor,
                label: resolveEditorAnchorsAndMentionsEmail(
                  contributor.email,
                  recordStateItem,
                ),
              }
            : contributor;
        },
      );
}

function versionPreviewOf(
  activity?: Dynamic,
  details?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let sha: Dynamic = versionShaOf(activity);
  let upto: Dynamic =
    activity.tool === `v3.checkpoint` ? activity.params.upto : undefined;
  return !sha && upto === undefined
    ? null
    : {
        id: activity.id,
        sha: sha ?? ``,
        path: details.path,
        prevPath: details.prevPath,
        at: activity.at,
        tool: activity.tool,
        isCurrent: details.isCurrent,
        prevSha: details.prevSha,
        ...(upto === undefined
          ? {}
          : {
              upto: upto,
            }),
        ...(details.base === undefined
          ? {}
          : {
              base: details.base,
            }),
      };
}
var HISTORY_GROUP_ID_PREFIX: string = `group:`;
var historyGroupId = (
  historyGroupId2?: Dynamic,
  ..._extraArguments: unknown[]
) =>
  `${HISTORY_GROUP_ID_PREFIX}${historyGroupId2.items[historyGroupId2.items.length - 1].id}`;
var historyGroupHeadId: Dynamic = (
  historyGroupHeadId2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  historyGroupHeadId2.startsWith(HISTORY_GROUP_ID_PREFIX)
    ? historyGroupHeadId2.slice(6)
    : null;
var FIRST_SAVED_BASE: string = `first`;
function versionComparisonBase(
  activity?: Dynamic,
  v2?: Dynamic,
  previous?: Dynamic,
  hasOlder?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let previousUpto: Dynamic =
    previous === undefined ? undefined : previous.params.upto;
  let upto: Dynamic = typeof previousUpto == `number` ? previousUpto : null;
  if (!v2)
    return upto === null
      ? null
      : {
          upto: upto,
        };
  let baseRev: Dynamic = activity.params.baseRev;
  return typeof baseRev == `number` && baseRev > 1
    ? {
        rev: baseRev,
      }
    : upto === null
      ? typeof baseRev == `number`
        ? FIRST_SAVED_BASE
        : hasOlder
          ? `older`
          : FIRST_SAVED_BASE
      : {
          upto: upto,
        };
}
function rowComparisonBase(
  activity?: Dynamic,
  v2?: Dynamic,
  previous?: Dynamic,
  hasOlder?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let rev: Dynamic = resolvePlatformLiveDocumentAndHistoryParams2(activity);
  return v2 && rev !== undefined && rev <= 1
    ? `none`
    : versionComparisonBase(activity, v2, previous, hasOlder);
}
function groupComparisonBase(
  group?: Dynamic,
  v2?: Dynamic,
  previousById?: Dynamic,
  hasOlder?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let last: Dynamic = group.items[group.items.length - 1];
  return versionComparisonBase(last, v2, previousById(last.id), hasOlder);
}
function historyGroupPreview(
  group?: Dynamic,
  details?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let first: Dynamic = group.items[0];
  let last: Dynamic = group.items[group.items.length - 1];
  let { base: base, ...previewDetails }: Dynamic = details;
  let preview: Dynamic = versionPreviewOf(first, previewDetails);
  return preview === null
    ? null
    : {
        ...preview,
        id: historyGroupId(group),
        group: {
          count: group.items.length,
          since: last.at,
          base: base,
        },
      };
}

var firstGroupLabel: Dynamic = (
  firstGroupLabel2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  for (let firstGroupLabelResult of firstGroupLabel2.items as Dynamic) {
    let versionLabelOf2: Dynamic = versionLabelOf(firstGroupLabelResult);
    if (versionLabelOf2) return versionLabelOf2;
  }
  return null;
};
var groupDisplayLabel: Dynamic = (
  groupDisplayLabel2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let itemItem: Dynamic = groupDisplayLabel2.items[0];
  let groupDisplayLabelResult: Dynamic = checkpointName(itemItem);
  if (groupDisplayLabelResult)
    return {
      label: groupDisplayLabelResult,
      edits: false,
    };
  if (
    groupDisplayLabel2.contributors.some(
      (entry?: Dynamic, ..._extraArguments: unknown[]) =>
        entry.kind === `claude`,
    ) &&
    groupDisplayLabel2.contributors.some(
      (entry?: Dynamic, ..._extraArguments: unknown[]) =>
        entry.kind === `human`,
    )
  )
    return {
      label: null,
      edits: true,
    };
  let versionLabelOf2: Dynamic = versionLabelOf(itemItem);
  return versionLabelOf2
    ? {
        label: versionLabelOf2,
        edits: false,
      }
    : {
        label: null,
        edits: groupDisplayLabel2.items.some(
          (item?: Dynamic, ..._extraArguments: unknown[]) =>
            versionLabelOf(item) !== null,
        ),
      };
};
var rowDisplayLabel: Dynamic = (
  rowDisplayLabel2?: Dynamic,
  ..._extraArguments: unknown[]
): null | string =>
  checkpointName(rowDisplayLabel2) ?? versionLabelOf(rowDisplayLabel2);
var withResolvedContributorNames: Dynamic = (
  withResolvedContributorNames2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  withResolvedContributorNames2.map(
    (contributor?: Dynamic, ..._extraArguments: unknown[]): Dynamic => {
      if (contributor.kind !== `human`) return contributor;
      let name: Dynamic = framePeekProfile(contributor.email)?.name;
      return name
        ? {
            ...contributor,
            label: resolveEditorAnchorsAndMentionsEmail(
              contributor.email,
              name,
            ),
          }
        : contributor;
    },
  );
function overflowLabel(
  overflowLabel2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return overflowLabel2 !== null &&
    overflowLabel2.scrollHeight > overflowLabel2.clientHeight + 1
    ? options
    : null;
}

var HISTORY_COMPARE_OPTIONS: Dynamic = [
  {
    value: `previous`,
    label: `Previous version`,
  },
  {
    value: `current`,
    label: `Current version`,
  },
];

function isHistoryForbidden(
  history?: Dynamic,
  ..._extraArguments: unknown[]
): boolean {
  let history2: Dynamic = history;
  return history2.status === 403 || history2.status === 404
    ? true
    : history2.code === `DENIED` &&
        (history2.reason === `forbidden` || history2.reason === `access`);
}

var RESTORING_LABEL: string = `Restoring…`;
var RESTORE_ACTION: string = `restore`;
var RESTORE_EXPLANATION: string = `Restoring creates a new version with this content. Recent edits since the last saved version may not appear in this list.`;
var scheduleTimeout: Dynamic = (
  scheduleTimeout2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  let setTimeout2: Dynamic = setTimeout(options, scheduleTimeout2);
  return (..._extraArguments: unknown[]): void => clearTimeout(setTimeout2);
};
var scheduleHistoryAction: Dynamic = scheduleTimeout;
var RESTORE_PRESS_HOLD_MS: number = 1500;
var scheduleRestorePress: Dynamic = scheduleTimeout;
var containerAtVersion = (
  container?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) => {
  let lastIndexOf: Dynamic = container.lastIndexOf(`@`);
  return `${lastIndexOf >= 0 ? container.slice(0, lastIndexOf) : container}@${(lastIndexOf >= 0 ? container.slice(lastIndexOf + 1) : ``) || options || `main`}`;
};
var versionFilePath = (
  versionFilePath2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
) =>
  `${versionFilePath2.replace(/@[^@]*$/, ``)}/versions/${options}/${context}`;
var isActivationKey: Dynamic = (
  event?: Dynamic,
  ..._extraArguments: unknown[]
): boolean => (event.key === `Enter` || event.key === ` `) && !event.metaKey;
var keyIdentity: Dynamic = (
  event?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => event.code || event.key;
function holdActivationKey(
  holdActivationKey2?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  if (options.held === null) {
    let defaultView: Dynamic = holdActivationKey2.defaultView;
    let holdActivationKeyHandler = (
      holdActivationKey3?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      let held: Dynamic = options.held;
      if (held !== null) {
        holdActivationKey2.removeEventListener(
          `keyup`,
          holdActivationKeyHandler2,
          true,
        );
        defaultView?.removeEventListener(`blur`, holdActivationKeyHandler3);
        options.held = null;
        if (holdActivationKey3) {
          held.onUp?.();
        }
      }
    };
    let holdActivationKeyHandler2 = (
      event?: Dynamic,
      ..._extraArguments: unknown[]
    ): undefined => {
      if (
        event.key === `Meta` ||
        (options.held?.keys.delete(keyIdentity(event)) === true &&
          options.held.keys.size === 0)
      ) {
        holdActivationKeyHandler(true);
      }
    };
    let holdActivationKeyHandler3: Dynamic = (
      ..._extraArguments: unknown[]
    ): Dynamic => holdActivationKeyHandler(false);
    holdActivationKey2.addEventListener(
      `keyup`,
      holdActivationKeyHandler2,
      true,
    );
    defaultView?.addEventListener(`blur`, holdActivationKeyHandler3);
    options.held = {
      keys: new (Set as Dynamic)(),
      stop: (..._extraArguments: unknown[]): Dynamic =>
        holdActivationKeyHandler(false),
      onUp: null,
    };
  }
  options.held.keys.add(keyIdentity(context));
}
var afterActivationKeyReleased = (
  afterActivationKeyReleased2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): undefined => {
  if (afterActivationKeyReleased2.held === null) {
    options();
  } else {
    afterActivationKeyReleased2.held.onUp = options;
  }
};
var cancelActivationPress = (
  celActivationPress?: Dynamic,
  ..._extraArguments: unknown[]
): undefined => {
  celActivationPress.held?.stop();
  celActivationPress.pressed = false;
};

var ACTIVITY_EMPTY_TITLE: string = `No activity yet`;
var ACTIVITY_EMPTY_COPY: string = `Edits to this document will show up here, grouped by who made them.`;
var ACTIVITY_ERROR_TITLE: string = `Couldn't load page activity`;
var ACTIVITY_ERROR_COPY: string = `Try again in a moment.`;
var UNATTRIBUTED_LABEL: string = `Not attributed`;
var claudeViaLabel = (
  claudeViaLabel2?: Dynamic,
  ..._extraArguments: unknown[]
) => (claudeViaLabel2 === null ? `Claude` : `Claude (via ${claudeViaLabel2})`);
var PARTIAL_ATTRIBUTION_COPY: string = `Attribution on this page starts partway through its history. Earlier edits aren't attributed to anyone.`;
var FORGOTTEN_ACTIVITY_COPY: string = `Older deleted or replaced text may no longer be listed.`;
var NO_ATTRIBUTION_COPY: string = `Edits on this page aren't attributed to anyone yet.`;
var INCOMPLETE_ATTRIBUTION_COPY: string = `Some edits on this page aren't attributed to anyone.`;
var SHOW_ACTIVITY_IN_DOCUMENT_LABEL: string = `show in document`;
var ACTIVITY_CAUSE_LABELS: Dynamic = {
  created: `added`,
  deleted: `deleted`,
  replaced: `replaced`,
  restored: `restored`,
};
var activityCauseLabel: Dynamic = (
  activityCauseLabel2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  activityCauseLabel2 === `edited`
    ? undefined
    : (ACTIVITY_CAUSE_LABELS[activityCauseLabel2] ?? activityCauseLabel2);
var ACTIVITY_BLOCK_LABELS: Dynamic = {
  paragraph: `Paragraph`,
  heading: `Heading`,
  codeBlock: `Code block`,
  table: `Table`,
  embed: `Embed`,
  horizontalRule: `Divider`,
  pending: `Placeholder`,
  deleted: `Deleted block`,
  restore: `Restored an earlier version`,
};
var activityBlockLabel: Dynamic = (
  activityBlockLabel2?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  activityBlockLabel2 === `deleted` && options !== undefined && options > 1
    ? `${options} deleted blocks`
    : (ACTIVITY_BLOCK_LABELS[activityBlockLabel2] ?? `Block`);
function useActivityActorName(
  activityActorName?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let useActivityActorNameResult: string =
    resolveEditorAnchorsAndMentionsOther(activityActorName);
  let useActivityActorNameResult2: Dynamic =
    useCommentsActionsAndSelectionPlatform(
      useActivityActorNameResult === `platform` ? activityActorName : null,
    );
  let useActivityActorNameResult3: Dynamic =
    useCommentsActionsAndSelectionAccount(
      useActivityActorNameResult === `account` ? activityActorName : null,
    );
  return useActivityActorNameResult === `platform`
    ? useActivityActorNameResult2 === undefined
      ? {
          words: undefined,
          named: false,
        }
      : {
          words: resolveEditorAnchorsAndMentionsEmail(
            activityActorName,
            useActivityActorNameResult2?.name,
          ),
          named: !!useActivityActorNameResult2?.name,
        }
    : useActivityActorNameResult === `account`
      ? {
          words: resolveEditorAnchorsAndMentionsEmail(
            activityActorName,
            useActivityActorNameResult3 ?? undefined,
          ),
          named: useActivityActorNameResult3 !== null,
        }
      : {
          words: resolveEditorAnchorsAndMentionsEmail(activityActorName),
          named: useActivityActorNameResult === `email`,
        };
}

function relativeSourceTime(
  at?: Dynamic,
  now?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let elapsed: number = now - new (Date as Dynamic)(at).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return at;
  let minutes: number = Math.round(elapsed / 6e4);
  if (minutes < 60) return `${minutes}m ago`;
  let hours: number = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
var RAIL_TABS: Dynamic = [
  {
    k: `history`,
    label: `History`,
  },
  {
    k: `activity`,
    label: `Activity`,
    antOnly: true,
  },
  {
    k: `sources`,
    label: `Sources`,
  },
];
var RAIL_TAB_TITLES: Dynamic = {
  history: `Version history`,
  activity: `Page activity`,
  sources: `Sources`,
};
var ANT_ONLY_LABEL: string = `Ant only`;
var ACTIVITY_ANT_ONLY_TIP: string = `Only visible to Anthropic employees while Page activity is in preview.`;

export { ACTIVITY_ANT_ONLY_TIP, ANT_ONLY_LABEL };
