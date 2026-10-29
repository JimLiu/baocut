/** Restored application module; prepare first, initialize in original order. */
import {
  bindRuntimeValue,
  type Dynamic,
  type RuntimeBindings,
} from "../runtime-types";
export function installCanvasDesignCanvas(
  runtime: RuntimeBindings,
): () => void {
  var noopCanvasSubscription: Dynamic;
  var zeroCanvasRevision: Dynamic;
  var canvasNeedsPageMessage: Dynamic;
  var fitArtboardsLabel: Dynamic;
  var loosePieceRenameHint: Dynamic;
  var staleDeleteFailureMessage: Dynamic;
  var singleArtboardPngCopyMessage: Dynamic;
  var singleArtboardSvgCopyMessage: Dynamic;
  var staticArtboardPlaybackMessage: Dynamic;
  var loosePiecePlaybackMessage: Dynamic;
  var pageHasNoArtboardsMessage: Dynamic;
  var existingThumbnailMessage: Dynamic;
  var oversizedThumbnailMessage: Dynamic;
  var MemoizedCanvasZoomControl: Dynamic;
  var MemoizedCanvasSaveIndicator: Dynamic;
  var isCanvasReadonlySaveState: Dynamic;
  var CanvasSaveStatus: Dynamic;
  var CanvasSaveKeyboardShortcut: Dynamic;
  var artboardRevealSettleTimeoutMs: Dynamic;
  var artboardFrameReadyTimeoutMs: Dynamic;
  var dragGhostFilename: Dynamic;
  var previewDropNoticeDurationMs: Dynamic;
  var canvasExportSettleTimeoutMs: Dynamic;
  var exportAlreadyRunningMessage: Dynamic;
  var maxSessionDirtyFlushRetries: Dynamic;
  var canvasExitExportWaitTimeoutMs: Dynamic;
  var crossCanvasPasteConfirmFeatureFlag: Dynamic;
  var emptyCanvasFileSet: Dynamic;
  var emptyCanvasSelectionFiles: Dynamic;
  var emptyCanvasOptions: Dynamic;
  var layerEntriesEqual: Dynamic;
  var emptyCanvasNoteSet: Dynamic;
  var singleCanvasCaptureSemaphore: Dynamic;
  var parallelCanvasCaptureSemaphore: Dynamic;
  var artboardIsNotExpandedFill: Dynamic;
  var canvasPastePositionStep: Dynamic;
  var defaultCanvasCamera: Dynamic;
  var canvasPanUsageWindowMs: Dynamic;
  var canvasZoomUsageWindow: Dynamic;
  var minimumCanvasZoomUsage: Dynamic;
  var hasActiveUserGesture: Dynamic;
  var canvasSelectionChromeInsetPixels: Dynamic;
  function useCanvasSaveState(
    document2?: Dynamic,
    synced?: Dynamic,
    localDirty?: Dynamic,
  ): Dynamic {
    let [value, value2]: Dynamic = (0, runtime.reactChromeTheme.useState)(
      document2.saveState(),
    );
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic => document2.subscribeSave(value2),
      [document2],
    );
    return (0, runtime.reactChromeTheme.useMemo)(
      (): Dynamic =>
        localDirty && value.status === "ready"
          ? {
              status: "dirty",
              ...(synced
                ? {
                    message: "Changes waiting to sync",
                  }
                : {}),
            }
          : value,
      [localDirty, synced, value],
    );
  }
  function artboardFullscreenCamera(
    artboard?: Dynamic,
    fit2?: Dynamic,
    viewportWidth?: Dynamic,
    viewportHeight?: Dynamic,
    topInset: Dynamic = 0,
    padding: Dynamic = 0,
  ): Dynamic {
    if (!fit2)
      return {
        x: artboard.x,
        y: artboard.y - topInset,
        scale: 1,
      };
    let value: Dynamic = Math.max(1, viewportHeight - topInset - padding * 2),
      value2: Dynamic = Math.max(
        0.01,
        Math.min(
          1,
          Math.max(1, viewportWidth - padding * 2) / artboard.w,
          value / artboard.h,
        ),
      );
    return {
      x: artboard.x - (viewportWidth / value2 - artboard.w) / 2,
      y:
        artboard.y -
        (topInset + padding) / value2 -
        (value / value2 - artboard.h) / 2,
      scale: value2,
    };
  }
  function nextArtboardPlacementPoint(artboards?: Dynamic): Dynamic {
    return artboards.length
      ? {
          x:
            Math.max(
              ...artboards.map((input?: Dynamic): Dynamic => input.x + input.w),
            ) + 80,
          y: Math.min(...artboards.map((input?: Dynamic): Dynamic => input.y)),
        }
      : {
          x: 0,
          y: 0,
        };
  }
  function runWhenConditionReady(
    condition?: Dynamic,
    callback?: Dynamic,
    attempts: Dynamic = 100,
  ): Dynamic {
    if (condition()) {
      callback();
      return;
    }
    attempts > 0 &&
      setTimeout(
        (): Dynamic => runWhenConditionReady(condition, callback, attempts - 1),
        30,
      );
  }
  async function readCanvasClipboardText(): Promise<Dynamic> {
    try {
      return (await navigator.clipboard?.readText()) ?? "";
    } catch {
      return "";
    }
  }
  function canvasSelectionsEqual(first?: Dynamic, second?: Dynamic): Dynamic {
    return first === second
      ? true
      : first.artboards.size !== second.artboards.size ||
          first.notes.size !== second.notes.size ||
          first.elements.size !== second.elements.size
        ? false
        : [...first.artboards].every(
            (input?: Dynamic): Dynamic => second.artboards.has(input),
          ) &&
          [...first.notes].every(
            (input?: Dynamic): Dynamic => second.notes.has(input),
          ) &&
          [...first.elements].every(
            ([input, input2]: Dynamic): Dynamic =>
              second.elements.get(input)?.tids.join() === input2.tids.join(),
          );
  }
  function DesignCanvas({
    filePath: filePath,
    assets: assets,
    doc: doc,
  }: Dynamic): Dynamic {
    let { showToast: showToast, hideToast: hideToast }: Dynamic = (0,
      runtime.useToast)(),
      value: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value2: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value3: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value4: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value5: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      value6: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        async (): Promise<Dynamic> => {},
      ),
      dirtySessionFlushersRef: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        new Map(),
      ),
      [sessionsDirty, setSessionsDirty]: Dynamic = (0,
      runtime.reactChromeTheme.useState)(false),
      [sessionFlushEpoch, incrementSessionFlushEpoch]: Dynamic = (0,
      runtime.reactChromeTheme.useState)(0),
      sessionFlushRetryCountRef: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        0,
      ),
      registerDirtySession: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let current4: Dynamic = dirtySessionFlushersRef.current;
          if (options) {
            current4.set(input, options);
            let value653: Dynamic =
              sessionFlushRetryCountRef.current > maxSessionDirtyFlushRetries;
            sessionFlushRetryCountRef.current = 0;
            value653 &&
              incrementSessionFlushEpoch(
                (input2?: Dynamic): Dynamic => input2 + 1,
              );
          } else current4.delete(input);
          setSessionsDirty(current4.size > 0);
        },
        [],
      ),
      saveCanvas: Dynamic = (0,
      runtime.reactChromeTheme.useMemo)((): Dynamic => {
        let value653: Dynamic = (0, runtime.beforeExport)(
          value3,
          async (): Promise<Dynamic> => {
            for (let value654 of [
              ...dirtySessionFlushersRef.current.values(),
            ] as Dynamic)
              await value654();
            await value6.current();
            await doc.save();
          },
        );
        return async (): Promise<Dynamic> => {
          let current4: Dynamic = localDirtyEpochRef.current;
          try {
            await value653();
            localDirtyEpochRef.current === current4 && setLocalDirty(false);
          } catch (value654: Dynamic) {
            let value655: Dynamic = "loadState" in doc ? "sync" : "Save";
            showToast(
              value654 instanceof runtime.SessionBusyError
                ? "Close the open dialog first, then " + value655 + "."
                : value654 instanceof runtime.UnsettledEditsError
                  ? "Some edits could not be written. Fix the reported error, then " +
                    value655 +
                    "."
                  : (value655 === "Save" ? "Save failed: " : "Sync failed: ") +
                    (value654 instanceof Error
                      ? value654.message
                      : String(value654)),
              "error",
            );
          }
        };
      }, [doc, showToast]),
      supportsLoadState: Dynamic = "loadState" in doc,
      [saveState, setSaveState]: Dynamic = (0,
      runtime.reactChromeTheme.useState)(doc.saveState());
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic =>
        doc.subscribeSave(
          (input?: Dynamic): Dynamic =>
            setSaveState(
              (input2?: Dynamic): Dynamic =>
                supportsLoadState &&
                isCanvasReadonlySaveState(input2) ===
                  isCanvasReadonlySaveState(input) &&
                (isCanvasReadonlySaveState(input) === "live" ||
                  input2.message === input.message)
                  ? input2
                  : input,
            ),
        ),
      [doc, supportsLoadState],
    );
    let editable: Dynamic = saveState.status !== "readonly",
      editableRef: Dynamic = (0, runtime.reactChromeTheme.useRef)(editable);
    editableRef.current = editable;
    let [mode, setMode]: Dynamic = (0, runtime.reactChromeTheme.useState)(
      (): Dynamic => (editable ? "edit" : "preview"),
    );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      editable && setMode("edit");
    }, [editable]);
    let [value7, value8]: Dynamic = (0, runtime.npm_useLocalStorage_QP)(
        runtime.inspectorOpenStorageKey,
        runtime.defaultInspectorOpen,
      ),
      [value9, value10]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        false,
      ),
      value11: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic => [value9, value10],
        [value9],
      ),
      [value12, value13]: Dynamic = (0, runtime.npm_useLocalStorage_QP)(
        runtime.DcEditorGuidesVisibleKey,
        true,
      ),
      value14: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      propertiesHaveFocusRef: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        false,
      );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let callback15: Dynamic = (input?: Dynamic): Dynamic =>
          input instanceof Node &&
          ((document as Dynamic)
            .getElementById(runtime.inspectorPanelId)
            ?.contains(input) ??
            false),
        callback16: Dynamic = (event?: Dynamic): Dynamic => {
          propertiesHaveFocusRef.current = callback15(event.target);
        },
        callback17: Dynamic = (event?: Dynamic): Dynamic => {
          let target: Dynamic = event.target;
          !(target instanceof Node) ||
            !callback15(target) ||
            callback15(event.relatedTarget) ||
            queueMicrotask((): Dynamic => {
              target.isConnected &&
                !callback15((document as Dynamic).activeElement) &&
                (propertiesHaveFocusRef.current = false);
            });
        };
      (document as Dynamic).addEventListener("focusin", callback16);
      (document as Dynamic).addEventListener("focusout", callback17);
      return (): Dynamic => {
        (document as Dynamic).removeEventListener("focusin", callback16);
        (document as Dynamic).removeEventListener("focusout", callback17);
      };
    }, []);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let callback15: Dynamic = (): Dynamic => {
        value14.current = !(0, runtime.hasBlockingEditorOverlay)();
      };
      (window as Dynamic).addEventListener("panel-toggle-key", callback15);
      return (): Dynamic =>
        (window as Dynamic).removeEventListener("panel-toggle-key", callback15);
    }, []);
    let value15: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      editing: Dynamic = editable && mode === "edit",
      readOnly: Dynamic = !editable,
      [toolResetTick, setToolResetTick]: Dynamic = (0,
      runtime.reactChromeTheme.useState)(0),
      previousEditingRef: Dynamic = (0, runtime.reactChromeTheme.useRef)(false);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      editing &&
        !previousEditingRef.current &&
        setToolResetTick((input?: Dynamic): Dynamic => input + 1);
      previousEditingRef.current = editing;
    }, [editing]);
    let [value16, value17]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        false,
      ),
      [localDirty, setLocalDirty]: Dynamic = (0,
      runtime.reactChromeTheme.useState)(false),
      localDirtyEpochRef: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      value18: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value19: Dynamic = runtime.SelectionActionsReplace,
      [selection, setSelection]: Dynamic = (0,
      runtime.reactChromeTheme.useState)(runtime.emptyCanvasSelection),
      focusedFileRef: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value20: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      selectionRef: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        runtime.emptyCanvasSelection,
      ),
      value21: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => runtime.NothingSelectedMessage,
      ),
      value22: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Map()),
      value23: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      value24: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value25: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      selectionEpochRef: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      value26: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value27: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value28: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      abandonSelectionGesture: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)(
        (): Dynamic => (
          value24.current?.abandon(),
          (value26.current = null),
          (value27.current = null),
          value28.current++,
          ++selectionEpochRef.current
        ),
        [],
      ),
      isSelectionEpochCurrent: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => selectionEpochRef.current === input,
        [],
      ),
      recordFrameSelectionSequence: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          frameSelectionSequencesRef.current.set(input, options);
        },
        [],
      ),
      handleFrameSelection: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          if (input !== focusedFileRef.current) return;
          input === pendingFrameSelectionRef.current?.file &&
            options.tids &&
            options.tids.length > 0 &&
            (pendingFrameSelectionRef.current = null);
          let value653: Dynamic =
            options.re != null && options.re.startsWith(runtime.HostValue);
          value653 && options.re != null && value30.current.get(options.re)?.();
          value653 &&
            options.re === value31.current?.token &&
            (value31.current = null);
          if (
            value653 &&
            options.re !== frameSelectionTokensRef.current.get(input)
          )
            return;
          if (
            (0, runtime.isSessionCancelMessage)(options.re, value27.current)
          ) {
            value27.current = null;
            return;
          }
          if (options.artboard) {
            value29.current(input, options.additive === true);
            return;
          }
          let value654: Dynamic =
              options.tids && options.tids.length > 0
                ? {
                    name: options.name ?? null,
                    tids: options.tids,
                    rect: options.rect ?? null,
                    count: options.tids.length,
                    part: options.part,
                  }
                : null,
            value655: Dynamic =
              options.re != null &&
              options.re.startsWith(runtime.keyboardNavigationMode);
          if (
            !value655 &&
            !value653 &&
            !options.additive &&
            value654 == null &&
            value25.current === input
          ) {
            value25.current = null;
            return;
          }
          if (
            value24.current?.noteSelection(
              input,
              value654?.tids ?? null,
              options.re,
            ) === false
          )
            return;
          value654 == null &&
            !value655 &&
            !value653 &&
            !options.artboard &&
            selectionEpochRef.current++;
          value654 != null &&
            !value655 &&
            !value653 &&
            ((value25.current = null), selectionEpochRef.current++);
          let value656: Dynamic = (0, runtime.applyHostSelectionResponse)(
            selectionRef.current,
            input,
            {
              entry: value654,
              additive: options.additive === true,
              re: options.re,
            },
          );
          value656.kind !== "confirm" &&
            ((selectionRef.current = value656.next),
            setSelection(value656.next),
            value656.pushback === "clear" &&
              setShownFrameSelectionRef.current(input, null));
        },
        [],
      ),
      frameSelectionSequencesRef: Dynamic = (0,
      runtime.reactChromeTheme.useRef)(new Map()),
      value29: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => {},
      ),
      value30: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Map()),
      value31: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      count: Dynamic = 2e3,
      count2: Dynamic = 6e3,
      pendingFrameSelectionRef: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        null,
      ),
      value32: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      frameSelectionTokenSequenceRef: Dynamic = (0,
      runtime.reactChromeTheme.useRef)(0),
      frameSelectionTokensRef: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        new Map(),
      ),
      setShownFrameSelection: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          let entry: Dynamic = value177.current.get(input);
          if (!entry) return null;
          let value653: Dynamic =
            context ??
            runtime.HostValue +
              String(++frameSelectionTokenSequenceRef.current);
          frameSelectionTokensRef.current.set(input, value653);
          return entry.setShownSelection(
            options,
            options ? value19(input) : null,
            value653,
            frameSelectionSequencesRef.current.get(input) ?? 0,
          )
            ? value653
            : null;
        },
        [],
      ),
      setShownFrameSelectionRef: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        setShownFrameSelection,
      );
    setShownFrameSelectionRef.current = setShownFrameSelection;
    let value33: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => {},
      ),
      applyCanvasSelection: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let current4: Dynamic = selectionRef.current;
          selectionRef.current = input;
          setSelection(input);
          let current5: Dynamic = focusedFileRef.current;
          for (let value657 of (options?.repush ?? []) as Dynamic) {
            if (value657 === current5) continue;
            let value658: Dynamic = input.elements.get(value657)?.tids;
            if (value658 == null) continue;
            let callback15: Dynamic = (): Dynamic => {
              let value659: Dynamic =
                selectionRef.current.elements.get(value657)?.tids;
              return (
                focusedFileRef.current !== value657 && value659 === value658
              );
            };
            for (let value659 of [0, 150, 600] as Dynamic)
              (window as Dynamic).setTimeout((): Dynamic => {
                callback15() &&
                  value177.current
                    .get(value657)
                    ?.setShownSelection(value658, value19(value657));
              }, value659);
          }
          if (current5 == null) return;
          let value653: Dynamic = current4.elements.get(current5)?.tids,
            value654: Dynamic = input.elements.get(current5)?.tids,
            value655: Dynamic =
              value653 === value654 ||
              (value653 != null &&
                value654 != null &&
                value653.length === value654.length &&
                value653.every(
                  (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                    input2 === value654[options2],
                )),
            value656: Dynamic =
              options?.repush != null && [...options.repush].includes(current5);
          if (!value655 || (value656 && value654 != null)) {
            let value657: Dynamic = setShownFrameSelection(
              current5,
              value654 ?? null,
            );
            if (value656 && value654 != null && value657 != null) {
              let callback15: Dynamic = (): Dynamic => {
                let value658: Dynamic =
                  selectionRef.current.elements.get(current5)?.tids;
                return (
                  focusedFileRef.current === current5 &&
                  frameSelectionTokensRef.current.get(current5) === value657 &&
                  value658 != null &&
                  value658.length === value654.length &&
                  value658.every(
                    (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                      input2 === value654[options2],
                  )
                );
              };
              for (let value658 of [150, 600] as Dynamic)
                (window as Dynamic).setTimeout((): Dynamic => {
                  callback15() &&
                    setShownFrameSelection(current5, value654, value657);
                }, value658);
            }
          }
        },
        [setShownFrameSelection],
      );
    value33.current = applyCanvasSelection;
    let value34: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let value653: Dynamic = abandonSelectionGesture(),
            value654: Dynamic =
              focusedFileRef.current !== input
                ? {
                    file: input,
                  }
                : null;
          value654 && (pendingFrameSelectionRef.current = value654);
          let callback15: Dynamic = (): Dynamic => {
            value654 &&
              pendingFrameSelectionRef.current === value654 &&
              (pendingFrameSelectionRef.current = null);
          };
          return value274
            .current(input)
            .then(
              (): Dynamic =>
                new Promise((input2?: Dynamic): Dynamic => {
                  let entry: Dynamic =
                      frameSelectionSequencesRef.current.get(input),
                    items: Dynamic = [],
                    index: Dynamic = 0,
                    index2: Dynamic = 0,
                    index3: Dynamic = 0,
                    flag2: Dynamic = false,
                    callback16: Dynamic = (): Dynamic => {
                      for (let value655 of items as Dynamic)
                        value30.current.delete(value655);
                      callback15();
                      input2(
                        flag2 ||
                          (focusedFileRef.current === input &&
                            selectionRef.current.elements.has(input)),
                      );
                    },
                    callback17: Dynamic = (): Dynamic => {
                      if (
                        flag2 ||
                        selectionEpochRef.current !== value653 ||
                        frameSelectionSequencesRef.current.get(input) !== entry
                      )
                        return callback16();
                      let entry2: Dynamic =
                          selectionRef.current.elements.get(input),
                        value655: Dynamic =
                          focusedFileRef.current != null &&
                          focusedFileRef.current !== input;
                      if (!entry2 || value655 || index >= 25 || index2++ >= 400)
                        return callback16();
                      let entry3: Dynamic = value177.current.get(input);
                      if (
                        Date.now() - index3 >= 300 &&
                        focusedFileRef.current === input &&
                        entry3?.isReady()
                      ) {
                        setShownFrameSelection(input, null);
                        let value656: Dynamic = setShownFrameSelection(
                          input,
                          entry2.tids,
                        );
                        value656 &&
                          (index++,
                          (index3 = Date.now()),
                          items.push(value656),
                          value30.current.set(value656, (): Dynamic => {
                            flag2 = true;
                            callback16();
                          }));
                      }
                      (window as Dynamic).setTimeout(callback17, 60);
                    };
                  (window as Dynamic).setTimeout(callback17, 60);
                }),
            )
            .catch((): Dynamic => (callback15(), false));
        },
        [setShownFrameSelection, abandonSelectionGesture],
      ),
      value35: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value36: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, source?: Dynamic): Dynamic => {
          let value653: Dynamic = Promise.all([
              options.catch((): Dynamic => {}),
              source.ended,
            ]).then(([, input2]: Dynamic): Dynamic => {
              state.travelled = input2.travelled;
            }),
            state: Dynamic = {
              file: input,
              over: value653,
              gen: source.gen,
              kind: source.kind,
              travelled: false,
              after: null,
              answered: false,
              expired: false,
            };
          value32.current = state;
          let callback15: Dynamic = (): Dynamic => {
              (window as Dynamic).clearTimeout(value654);
              value32.current === state && (value32.current = null);
            },
            value654: Dynamic = (window as Dynamic).setTimeout((): Dynamic => {
              state.expired = true;
              callback15();
            }, count2);
          value653.then(callback15);
        },
        [],
      ),
      value37: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          value35.current = {
            file: input,
            x: options.x,
            y: options.y,
            at: Date.now(),
          };
        },
        [],
      ),
      value38: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653?: Dynamic,
          extra?: Dynamic,
        ): Dynamic => {
          let value654: Dynamic = value19(input);
          abandonSelectionGesture();
          let value655: Dynamic =
            value32.current?.file === input ? value32.current : null;
          value655 && (value655.answered = true);
          if (extra && (value653 === "replace" || value653 === "narrow")) {
            let current4: Dynamic = value35.current;
            current4 &&
              current4.file === input &&
              Date.now() - current4.at < 2e3 &&
              value177.current.get(input)?.armedByClick(current4.x, current4.y);
          }
          if (value653 === "toggle" || value653 === "remove")
            applyCanvasSelection(
              (0, runtime.toggleCanvasElementIds)(
                selectionRef.current,
                input,
                [options],
                {
                  name: value654,
                  rect: context,
                },
              ),
            );
          else {
            let current4: Dynamic = selectionRef.current,
              value657: Dynamic =
                current4.elements.size === 1 &&
                current4.artboards.size === 0 &&
                current4.notes.size === 0 &&
                current4.elements.get(input)?.tids.length === 1 &&
                current4.elements.get(input)?.tids[0] === options;
            value279.current();
            value657 ||
              applyCanvasSelection(
                (0, runtime.selectionFromElements)(input, {
                  name: value654,
                  tids: [options],
                  rect: context,
                  count: 1,
                }),
              );
          }
          value655 && (value655.after = selectionRef.current);
          let value656: Dynamic = extra ? value34(input) : undefined;
          value655 && (value655.gen = selectionEpochRef.current);
          return value656;
        },
        [value34, applyCanvasSelection, abandonSelectionGesture],
      ),
      value39: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value40: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          (0, runtime.OutlineGlyphsTest)(doc.content().files[input] ?? "") &&
            (value39.current != null && hideToast(value39.current),
            (value39.current = showToast(
              runtime.CanTReadThisArtboardSFileAskMessage,
            )));
        },
        [doc, hideToast, showToast],
      ),
      value41: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let entry: Dynamic = value177.current.get(input);
          if (!entry) return;
          let value653: Dynamic = abandonSelectionGesture();
          entry.ensureOutline().then((items?: Dynamic): Dynamic => {
            if (selectionEpochRef.current !== value653) return;
            if (items === null) return value40(input);
            if (items.length === 0) return;
            let value654: Dynamic = items
              .filter(
                (input2?: Dynamic): Dynamic =>
                  !runtime.SelectionActionsHelmetScHelmetPattern.test(
                    input2.tag,
                  ),
              )
              .map((input2?: Dynamic): Dynamic => input2.tid);
            value654.length !== 0 &&
              (applyCanvasSelection(
                (0, runtime.selectionFromElements)(input, {
                  name: value19(input),
                  tids: value654,
                  rect: null,
                  count: value654.length,
                }),
              ),
              value34(input));
          });
        },
        [value34, applyCanvasSelection, value40, abandonSelectionGesture],
      ),
      value42: Dynamic = (0, runtime.reactChromeTheme.useRef)(value41);
    value42.current = value41;
    let value43: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let current4: Dynamic = selectionRef.current;
          if (current4.artboards.has(input) && !current4.elements.has(input)) {
            value41(input);
            return;
          }
          let entry: Dynamic = current4.elements.get(input),
            entry2: Dynamic = value177.current.get(input);
          if (!entry || entry.tids.length !== 1 || !entry2 || !entry2.isReady())
            return;
          let [tids]: Dynamic = entry.tids;
          if (tids == null) return;
          if (entry2.describeTids([tids])[0]?.editable) {
            entry2.startTextEdit(value19(input), tids);
            return;
          }
          let current5: Dynamic = value28.current;
          entry2
            .pickAt(options.x, options.y, "deeper", [tids])
            .then((input2?: Dynamic): Dynamic => {
              let entry3: Dynamic = selectionRef.current.elements.get(input);
              value28.current !== current5 ||
                (entry3 != null &&
                  !(entry3.tids.length === 1 && entry3.tids[0] === tids)) ||
                input2 == null ||
                "empty" in input2 ||
                input2.tid === tids ||
                value38(input, input2.tid, input2.rect, "replace", true);
            });
        },
        [value38, value41],
      ),
      value44: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => false,
      ),
      value45: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => ({
          flipped: false,
        }),
      ),
      value46: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => false,
      ),
      value47: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        Promise.resolve(),
      ),
      value48: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      value49: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let value653: Dynamic = value47.current
            .then(input, input)
            .finally((): Dynamic => options?.());
          value47.current = value653.catch((): Dynamic => {});
        },
        [],
      ),
      value50: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      value51: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          if (value48.current === 0) {
            input();
            return;
          }
          let current4: Dynamic = selectionRef.current,
            callback15: Dynamic = (): Dynamic =>
              selectionEpochRef.current - value50.current,
            value653: Dynamic = callback15();
          value49((): Dynamic => {
            (0, runtime.sameSelectedObjectFiles)(
              current4,
              selectionRef.current,
            ) && callback15() === value653
              ? input()
              : options?.();
          });
        },
        [value49],
      ),
      value52: Dynamic = (0, runtime.reactChromeTheme.useRef)(value51);
    value52.current = value51;
    let value53: Dynamic = (0, runtime.reactChromeTheme.useRef)({
        at: 0,
        seq: new Map(),
        dead: new Set(),
      }),
      count3: Dynamic = 400,
      value54: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let entry: Dynamic = value177.current.get(input);
          if (!entry) return;
          let value653: Dynamic =
            runtime.HostValue +
            String(++frameSelectionTokenSequenceRef.current);
          frameSelectionTokensRef.current.set(input, value653);
          entry.setShownSelection(null, null, value653);
        },
        [],
      ),
      callback: Dynamic = (input?: Dynamic): Dynamic =>
        [...input.elements]
          .filter(
            ([input2, input3]: Dynamic): Dynamic =>
              input3.name === value19(input2),
          )
          .map(
            ([input2, input3]: Dynamic): Dynamic => [input2, [...input3.tids]],
          ),
      value55: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (source?: Dynamic): Dynamic => {
          let callback15: Dynamic = (): Dynamic =>
            (0, runtime.canNavigateSelection)({
              gesturing: value218.current,
              setMoveCommits: value155.current,
            });
          if (!callback15()) return;
          let current4: Dynamic = selectionRef.current,
            callback16: Dynamic = (input?: Dynamic): Dynamic =>
              (0, runtime.sameSelectionStructure)(current4, input);
          if (source.kind === "all") {
            let value654: Dynamic = (0, runtime.selectionNavigationScope)(
              current4,
              false,
            );
            if (value654 === "panel") return;
            if (value654 === "canvas") {
              abandonSelectionGesture();
              let current5: Dynamic = value87.current;
              applyCanvasSelection(
                (0, runtime.selectionFromBoards)({
                  files: new Set(
                    current5.artboards.map(
                      (input?: Dynamic): Dynamic => input.file,
                    ),
                  ),
                  notes: new Set(
                    (current5.annotations ?? []).map(
                      (input?: Dynamic): Dynamic => input.id,
                    ),
                  ),
                }),
              );
              return;
            }
          }
          if (source.kind === "nudge") {
            let { dx: value654, dy: value655 }: Dynamic = source,
              value656: Dynamic = Date.now(),
              callback17: Dynamic = async (): Promise<Dynamic> => {
                if (
                  !callback15() ||
                  (source.repeat &&
                    Date.now() - value656 > count3 &&
                    value48.current > 1)
                )
                  return;
                let current5: Dynamic = selectionRef.current;
                if (!callback16(current5)) return;
                value50.current++;
                let value657: Dynamic = abandonSelectionGesture();
                Date.now() - value53.current.at >
                  runtime.ModelModelStateLimit &&
                  (value53.current = {
                    at: 0,
                    seq: new Map(),
                    dead: new Set(),
                  });
                let current6: Dynamic = value53.current;
                current6.at = Date.now();
                let value658: Dynamic = callback(current5).filter(
                    ([input]: Dynamic): Dynamic => !current6.dead.has(input),
                  ),
                  values: Dynamic = new Set(
                    value658.map(([input]: Dynamic): Dynamic => input),
                  ),
                  value659: Dynamic = (0, runtime.canvasBoardSelection)(
                    current5,
                  ),
                  value660: Dynamic =
                    (0, runtime.boardSelectionCount)(value659) > 0 &&
                    true &&
                    value44.current(value659, value654, value655, current6.seq);
                if (value658.length === 0) {
                  value660 &&
                    (0, runtime.announce)(
                      (0, runtime.moveDirectionAnnouncement)(
                        value654,
                        value655,
                      ),
                    );
                  return;
                }
                let value661: Dynamic = value432.current?.group(values),
                  current7: Dynamic = focusedFileRef.current,
                  values2: Dynamic = new Set(),
                  value662: Dynamic = await Promise.all(
                    value658.map(
                      ([input, input2]: Dynamic): Dynamic =>
                        (
                          value177.current.get(input)?.nudgeSelection(
                            input2,
                            value654,
                            value655,
                            input === current7
                              ? (): Dynamic => {
                                  values2.add(input);
                                  value54(input);
                                }
                              : undefined,
                          ) ?? Promise.resolve(null)
                        )
                          .then(
                            (input3?: Dynamic): Dynamic => (
                              input3?.did === "timeout" &&
                                current6.dead.add(input),
                              input3
                            ),
                          )
                          .catch((): Dynamic => null)
                          .finally((): Dynamic => value661?.settled(input)),
                    ),
                  ).finally((): Dynamic => value661?.end());
                for (let value664 of values as Dynamic)
                  current6.seq.set(
                    value664,
                    value440.current.get(value664) ?? 0,
                  );
                current6.at = Date.now();
                let entries: Dynamic = new Map(),
                  values3: Dynamic = new Set(values2),
                  index: Dynamic = 0,
                  index2: Dynamic = 0;
                value662.forEach(
                  (input?: Dynamic, options?: Dynamic): Dynamic => {
                    let value664: Dynamic = value658[options][0];
                    input?.did === "reordered"
                      ? (entries.set(value664, input.tids),
                        values3.add(value664),
                        index2++)
                      : input?.did === "nudged" &&
                        (values3.add(value664), index++);
                  },
                );
                index > 0 || value660
                  ? (0, runtime.announce)(
                      (0, runtime.moveDirectionAnnouncement)(
                        value654,
                        value655,
                      ),
                    )
                  : index2 > 0 &&
                    (0, runtime.announce)(
                      (0, runtime.reorderAnnouncement)(
                        value654 < 0 || value655 < 0 ? -1 : 1,
                        false,
                      ),
                    );
                if (
                  values3.size === 0 ||
                  selectionEpochRef.current !== value657
                )
                  return;
                let current8: Dynamic = selectionRef.current;
                applyCanvasSelection(
                  entries.size > 0
                    ? (0, runtime.selectionAfterElementEdits)(
                        current8,
                        "next",
                        new Map(),
                        entries,
                        value19,
                      )
                    : current8,
                  {
                    repush: values3,
                  },
                );
                let value663: Dynamic =
                  current7 != null &&
                  current7 === focusedFileRef.current &&
                  values2.has(current7)
                    ? frameSelectionTokensRef.current.get(current7)
                    : undefined;
                value663 != null &&
                  (value31.current = {
                    token: value663,
                    at: Date.now(),
                  });
              };
            value48.current++;
            value49(callback17, (): Dynamic => {
              value48.current--;
            });
            return;
          }
          let value653: Dynamic =
            source.kind === "enter"
              ? "children"
              : source.kind === "parent"
                ? "parents"
                : source.kind === "all"
                  ? "siblings"
                  : source.kind;
          value49(async (): Promise<Dynamic> => {
            if (!callback15()) return;
            let current5: Dynamic = selectionRef.current;
            if (!callback16(current5)) return;
            value50.current++;
            let value654: Dynamic = abandonSelectionGesture(),
              value655: Dynamic = callback(current5),
              value656: Dynamic = (
                value653 === "children" ? [...current5.artboards] : []
              ).map(async (input?: Dynamic): Promise<Dynamic> => {
                if (
                  value73.current.artboards.find(
                    (input2?: Dynamic): Dynamic => input2.file === input,
                  )?.frameless
                )
                  return null;
                let value661: Dynamic = await value177.current
                  .get(input)
                  ?.ensureOutline();
                return value661
                  ? [
                      input,
                      value661
                        .filter(
                          (input2?: Dynamic): Dynamic =>
                            !runtime.SelectionActionsHelmetScHelmetPattern.test(
                              input2.tag,
                            ),
                        )
                        .map((input2?: Dynamic): Dynamic => input2.tid),
                    ]
                  : null;
              }),
              value657: Dynamic = value655.map(
                async ([input, input2]: Dynamic): Promise<Dynamic> => {
                  let value661: Dynamic = await value177.current
                    .get(input)
                    ?.walkTids(input2, value653);
                  return value661 == null
                    ? null
                    : [
                        input,
                        value653 === "parents" && value661.length === 0
                          ? "artboard"
                          : value661,
                      ];
                },
              ),
              [value658, value659]: Dynamic = await Promise.all([
                Promise.all(value656),
                Promise.all(value657),
              ]);
            if (selectionEpochRef.current !== value654) return;
            let value660: Dynamic = (0, runtime.selectionAfterElementEdits)(
              current5,
              value653,
              new Map(
                value658.filter((input?: Dynamic): Dynamic => input != null),
              ),
              new Map(
                value659.filter((input?: Dynamic): Dynamic => input != null),
              ),
              value19,
            );
            if (value660 === current5) return;
            applyCanvasSelection(value660);
            let current6: Dynamic = focusedFileRef.current;
            if (
              value653 === "children" &&
              !(current6 != null && value660.elements.has(current6))
            ) {
              let value661: Dynamic = value73.current.artboards.find(
                (input?: Dynamic): Dynamic =>
                  value660.elements.has(input.file) &&
                  current5.artboards.has(input.file),
              );
              value661 && (value50.current++, value34(value661.file));
            }
          });
        },
        [
          value34,
          value54,
          applyCanvasSelection,
          value49,
          abandonSelectionGesture,
        ],
      ),
      value56: Dynamic = (0, runtime.reactChromeTheme.useRef)(value55);
    value56.current = value55;
    let value57: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let current4: Dynamic = selectionRef.current,
            value653: Dynamic = null;
          return {
            sweep: (input2?: Dynamic): Dynamic => {
              if (value653 == null) {
                value653 = abandonSelectionGesture();
                value279.current();
              } else if (selectionEpochRef.current !== value653) return;
              applyCanvasSelection(
                (0, runtime.mergeCanvasSelection)(current4, input2, input),
              );
            },
            cancel: (): Dynamic => {
              (value653 == null || selectionEpochRef.current === value653) &&
                (applyCanvasSelection(current4), abandonSelectionGesture());
            },
          };
        },
        [applyCanvasSelection, abandonSelectionGesture],
      ),
      value58: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let current4: Dynamic = value26.current,
            activeElement: Dynamic = (document as Dynamic).activeElement,
            value653: Dynamic = (0, runtime.reduceSessionCancellation)(
              current4,
              input,
              {
                now: Date.now(),
                focusedFile: focusedFileRef.current,
                busy: value218.current || value193.current != null,
                frameFocused:
                  activeElement instanceof HTMLIFrameElement &&
                  activeElement
                    .closest("[data-mega-artboard]")
                    ?.getAttribute("data-mega-artboard") ===
                    focusedFileRef.current,
                selection: selectionRef.current,
              },
            );
          value26.current = value653.rec;
          return value653.cancelKey != null && current4
            ? (value177.current
                .get(current4.file)
                ?.cancelBox(value653.cancelKey),
              true)
            : value653.restore != null && current4
              ? (abandonSelectionGesture(),
                (value27.current = current4.key),
                (selectionRef.current = value653.restore),
                setSelection(value653.restore),
                true)
              : false;
        },
        [applyCanvasSelection, abandonSelectionGesture],
      ),
      value59: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          value58({
            type: options.type,
            file: input,
            key: options.key,
          });
        },
        [value58],
      ),
      value60: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (): Dynamic =>
          value58({
            type: "escape",
          }),
        [value58],
      ),
      value61: Dynamic = (0, runtime.reactChromeTheme.useRef)(value60);
    value61.current = value60;
    (0, runtime.reactChromeTheme.useLayoutEffect)((): Dynamic => {
      selectionRef.current = selection;
    }, [selection]);
    let value62: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {
        let current4: Dynamic = focusedFileRef.current;
        if (current4 == null || !selectionRef.current.elements.has(current4))
          return;
        let entry: Dynamic = value177.current.get(current4);
        entry &&
          ((value25.current = current4),
          entry.setShownSelection(null, null) || (value25.current = null));
      }, []),
      value63: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic =>
          selection.primary != null
            ? ((): Dynamic => {
                let entry: Dynamic = selection.elements.get(selection.primary);
                return entry
                  ? {
                      file: selection.primary,
                      rect: entry.rect,
                      count: entry.count,
                      name: entry.name,
                      tids: entry.tids,
                      part: entry.part,
                      identity:
                        selection.primary +
                        ":" +
                        (entry.name ?? "") +
                        ":" +
                        entry.tids.join(".") +
                        (entry.part ? ":" + entry.part : ""),
                    }
                  : null;
              })()
            : null,
        [selection],
      ),
      value64: Dynamic = (0, runtime.reactChromeTheme.useRef)(value63);
    value64.current = value63;
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let callback15: Dynamic = (event?: Dynamic): Dynamic => {
        let current4: Dynamic = value64.current,
          target: Dynamic = event.target,
          value653: Dynamic =
            !!target &&
            (target.tagName === "INPUT" ||
              target.tagName === "TEXTAREA" ||
              target.tagName === "SELECT" ||
              target.isContentEditable);
        event.key !== "Escape" ||
          event.repeat ||
          event.defaultPrevented ||
          current4?.part !== "text" ||
          !current4.tids ||
          value653 ||
          (0, runtime.hasBlockingEditorOverlay)() ||
          target?.closest("[data-mega-selection-strip]") ||
          (event.preventDefault(),
          event.stopPropagation(),
          value177.current.get(current4.file)?.clearLabelPart());
      };
      (window as Dynamic).addEventListener("keydown", callback15, true);
      return (): Dynamic =>
        (window as Dynamic).removeEventListener("keydown", callback15, true);
    }, []);
    let value65: Dynamic = supportsLoadState
        ? sessionsDirty
        : value16 || localDirty || sessionsDirty,
      value66: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic =>
          value65 && saveState.status === "ready"
            ? {
                status: "dirty",
                ...(supportsLoadState
                  ? {
                      message: "Changes waiting to sync",
                    }
                  : {}),
              }
            : saveState,
        [value65, supportsLoadState, saveState],
      ),
      [value67, value68]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        (): Dynamic =>
          (0, runtime.parseCanvasMetadata)(
            doc.content().files[runtime.canvasMetadataFile],
            doc.content().files,
          ),
      ),
      value69: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        doc.content().files[runtime.canvasMetadataFile],
      ),
      value70: Dynamic = (0, runtime.reactChromeTheme.useRef)(null);
    value70.current === null && (value70.current = value67);
    let value71: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value72: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic =>
          value71.current
            ? (0, runtime.reconcileCanvasManifestHistory)(
                input,
                value71.current,
                value70.current,
              )
            : input,
        [],
      );
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic =>
        doc.subscribe((input?: Dynamic): Dynamic => {
          let files: Dynamic = doc.content().files,
            value653: Dynamic = files[runtime.canvasMetadataFile],
            value654: Dynamic =
              input?.remote === true && value653 !== value69.current;
          value69.current = value653;
          let value655: Dynamic,
            callback15: Dynamic = (input2?: Dynamic): Dynamic =>
              (0, runtime.designArtboardsMatchFiles)(input2, files) && !value654
                ? input2
                : value653 === undefined
                  ? (0, runtime.parseCanvasMetadata)(
                      (0, runtime.serializeCanvasMetadata)(input2),
                      files,
                    )
                  : (value655 ??= (0, runtime.parseCanvasMetadata)(
                      value653,
                      files,
                    )),
            current4: Dynamic = value70.current;
          value70.current = callback15(current4);
          input?.remote === true &&
            value70.current !== current4 &&
            (value71.current ??= current4);
          value68(callback15);
        }),
      [doc],
    );
    let value73: Dynamic = (0, runtime.reactChromeTheme.useRef)(value67),
      callback2: Dynamic = (input?: Dynamic): Dynamic =>
        value73.current.artboards.find(
          (input2?: Dynamic): Dynamic => input2.file === input,
        )?.title ?? input.replace(/\.dc\.html$/, "");
    value73.current = value67;
    (0, runtime.reactChromeTheme.useLayoutEffect)((): Dynamic => {
      doc.editorSaw?.(value67);
    }, [doc, value67]);
    (0, runtime.reactChromeTheme.useLayoutEffect)((): Dynamic => {
      let current4: Dynamic = value71.current;
      value71.current = null;
      if (!current4) return;
      let value653: Dynamic = (0, runtime.reconcileCanvasManifestHistory)(
        value67,
        current4,
        value70.current,
      );
      (0, runtime.structurallyEqual)(value653, value67) || value68(value653);
    }, [value67]);
    let [value74]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        (): Dynamic => {
          let value653: Dynamic =
            (0, runtime.embedMemoryPrefix)() !== ""
              ? null
              : (0, runtime.classifyPlaceLink)();
          return value653 === null || value653.why === "known"
            ? null
            : (0, runtime.prototypeFileFromPlaceFragment)(
                value653.place,
                value67,
              );
        },
      ),
      [value75, value76]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        (): Dynamic => {
          let value653: Dynamic = value67.artboards.find(
            (input?: Dynamic): Dynamic => input.file === value74,
          );
          if (value653)
            return (0, runtime.designPageId)(value653, value67.pages);
          let value654: Dynamic =
            doc.content().files[runtime.canvasMetadataFile] != null;
          if (
            value654 &&
            value67.launch?.view === "canvas" &&
            value67.launch.page !== undefined
          )
            return value67.launch.page;
          let value655: Dynamic =
              value654 && value67.launch?.view === "focused"
                ? value67.launch.file
                : filePath,
            value656: Dynamic =
              value67.artboards.find(
                (input?: Dynamic): Dynamic => input.file === value655,
              ) ??
              value67.artboards.find(
                (input?: Dynamic): Dynamic => input.file === filePath,
              );
          return value656
            ? (0, runtime.designPageId)(value656, value67.pages)
            : (value67.pages?.[0]?.id ?? "");
        },
      ),
      value77: Dynamic = value67.pages ?? [],
      value78: Dynamic = value77[0]?.id ?? "",
      value79: Dynamic = value77.some(
        (input?: Dynamic): Dynamic => input.id === value75,
      )
        ? value75
        : value78,
      value80: Dynamic = (0, runtime.reactChromeTheme.useRef)(value79);
    value80.current = value79;
    let value81: Dynamic =
        value77.find((input?: Dynamic): Dynamic => input.id === value79)
          ?.name ?? "Page 1",
      value82: Dynamic = (0, runtime.reactChromeTheme.useSyncExternalStore)(
        noopCanvasSubscription,
        zeroCanvasRevision,
      ),
      value83: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic => value77,
        [value77, value67, value82],
      ),
      value84: Dynamic = (0, runtime.reactChromeTheme.useRef)(value83);
    value84.current = value83;
    let value85: Dynamic = (0, runtime.useInspectorPosture)() === "sheet",
      value86: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic => (0, runtime.designPageContents)(value67, value79),
        [value67, value79],
      ),
      value87: Dynamic = (0, runtime.reactChromeTheme.useRef)(value86);
    value87.current = value86;
    let [value88]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        runtime.creationSequenceEnabled,
      ),
      value89: Dynamic = (0, runtime.useDesignCreationProgress)({
        doc: doc,
        flag: value88,
        artboards: value67.artboards,
        pages: value67.pages,
        artboardsHere: value86.artboards,
        pageId: value79,
        editing: editing,
        pageEmpty:
          value86.artboards.length === 0 &&
          (value86.annotations ?? []).length === 0,
      }),
      value90: Dynamic = (0, runtime.reactChromeTheme.useRef)([]);
    value90.current =
      value89.boxesHere.length === 0
        ? value86.artboards
        : [...value86.artboards, ...value89.boxesHere];
    let value91: Dynamic = (0, runtime.reactChromeTheme.useRef)(
      value89.boxesHere,
    );
    value91.current = value89.boxesHere;
    let flag: Dynamic = false,
      value92: Dynamic = (0, runtime.useClipboardFeatureFlag)(),
      value93: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic => ({
          migrated: flag,
          fillFlows: value92,
          settle: value92,
        }),
        [flag, value92],
      ),
      value94: Dynamic = flag ? value11 : null,
      [value95, value96]: Dynamic = value94 ?? [value7, value8],
      value97: Dynamic = (0, runtime.reactChromeTheme.useRef)(value95);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let current4: Dynamic = value97.current;
      value97.current = value95;
      if (value95 === current4) return;
      let current5: Dynamic = value14.current;
      value14.current = false;
      let value653: Dynamic = requestAnimationFrame((): Dynamic => {
        let value654: Dynamic =
          (document as Dynamic).activeElement === (document as Dynamic).body ||
          (document as Dynamic).activeElement === null;
        if (
          value95
            ? !current5 && !value654
            : !(value654 && (current5 || propertiesHaveFocusRef.current))
        )
          return;
        let value655: Dynamic = (document as Dynamic).getElementById(
          runtime.inspectorPanelId,
        );
        (value95
          ? (value655?.querySelector('[role="tab"][aria-selected="true"]') ??
            value655?.querySelector(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ))
          : (document as Dynamic).getElementById(runtime.inspectorToggleId)
        )?.focus({
          preventScroll: true,
        });
      });
      return (): Dynamic => cancelAnimationFrame(value653);
    }, [value95]);
    let callback3: Dynamic = (input: Dynamic = value80.current): Dynamic =>
        input === "" || input === (value73.current.pages?.[0]?.id ?? "")
          ? {}
          : {
              page: input,
            },
      value98: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let value653: Dynamic = (0,
            runtime.mergeMissingCanvasManifestMetadata)(
              input,
              options ?? value73.current,
            ),
            value654: Dynamic =
              options === undefined ? value72(value653) : value653;
          value70.current = value654;
          value73.current = value654;
          value68(value654);
          localDirtyEpochRef.current++;
          setLocalDirty(true);
          (0, runtime.getKvClient)()
            .set(
              (0, runtime.PlatformFileContentHandler_4)(
                runtime.canvasMetadataFile,
              ),
              (0, runtime.serializeCanvasMetadata)(value654),
            )
            .catch(
              (input2?: Dynamic): Dynamic =>
                showToast(
                  "Couldn't save the layout: " + String(input2),
                  "error",
                ),
            );
        },
        [showToast, value72],
      ),
      [value99]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        runtime.isSmallTouchDevice,
      ),
      [value100]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        (): Dynamic =>
          value99 &&
          !flag &&
          (0, runtime.wasPhoneCanvasKilled)(
            (0, runtime.getPhoneCanvasStorage)(),
            (0, runtime.phoneCanvasStorageKey)(),
          ),
      ),
      [value101]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        (): Dynamic =>
          value74 ??
          (0, runtime.initialFocusedArtboard)({
            manifest: value67,
            pageId: value79,
            entryFile: filePath,
            embedded: (0, runtime.embedMemoryPrefix)() !== "",
            laidOut: doc.content().files[runtime.canvasMetadataFile] != null,
            phoneCanvas: value99 && !flag,
            killedBefore: value100,
            migrated: flag,
            budget: 15e5,
          }),
      ),
      value102: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      [value103, value104]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        (): Dynamic => {
          if (value101 != null) {
            let value654: Dynamic = value67.artboards.find(
              (input?: Dynamic): Dynamic => input.file === value101,
            );
            if (value654)
              return artboardFullscreenCamera(
                value654,
                artboardIsNotExpandedFill(value654),
                1200,
                800,
              );
          }
          let value653: Dynamic = (0, runtime.recallCanvasView)(value79);
          return value653
            ? ((value102.current = true), value653)
            : defaultCanvasCamera;
        },
      ),
      [value105]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        (): Dynamic =>
          (0, runtime.createViewportStore)(
            value103,
            (input?: Dynamic, options?: Dynamic): Dynamic =>
              options
                ? value104(input)
                : (0, runtime.reactChromeTheme.startTransition)(
                    (): Dynamic => value104(input),
                  ),
          ),
      ),
      value106: Dynamic = (0, runtime.reactChromeTheme.useRef)(null);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let callback15: Dynamic = (event?: Dynamic): Dynamic =>
          value106.current?.contains(event.target)
            ? value105.halt()
            : value105.settle(),
        callback16: Dynamic = (): Dynamic => value105.settle();
      (window as Dynamic).addEventListener("pointerdown", callback15, true);
      (window as Dynamic).addEventListener("keydown", callback16, true);
      return (): Dynamic => {
        (window as Dynamic).removeEventListener(
          "pointerdown",
          callback15,
          true,
        );
        (window as Dynamic).removeEventListener("keydown", callback16, true);
      };
    }, [value105]);
    let value107: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value108: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value109: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {
        let value653: Dynamic = value108.current?.() ?? null;
        value653 != null && value653.file == null;
        return value653;
      }, []),
      value110: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value111: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (): Dynamic => value110.current?.() ?? null,
        [],
      ),
      value112: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          items?: Dynamic,
          items2?: Dynamic,
          context?: Dynamic,
          value653?: Dynamic,
        ): Dynamic =>
          items.length > 0
            ? value111()
            : (0, runtime.pointerCoordinates)(
                items2.length > 0 ? context : value653,
              ),
        [value111],
      ),
      value113: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {
        let current4: Dynamic = selectionRef.current;
        if (
          current4.notes.size > 0 ||
          current4.elements.size > 0 ||
          current4.artboards.size !== 1
        )
          return null;
        let [artboards]: Dynamic = current4.artboards;
        return (
          value87.current.artboards.find(
            (input?: Dynamic): Dynamic =>
              input.file === artboards && !input.frameless,
          ) ?? null
        );
      }, []),
      [value114, value115]: Dynamic = (0, runtime.useToolbarOverlaySize)(),
      value116: Dynamic = (0, runtime.reactChromeTheme.useRef)(value114);
    value116.current = value114;
    let value117: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      value118: Dynamic = (0, runtime.reactChromeTheme.useRef)(0);
    value114 > 0 && (value118.current = value114);
    let value119: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          value106.current = input;
          value115(input);
        },
        [value115],
      ),
      value120: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (): Dynamic => ({
          w: value106.current?.clientWidth ?? 1200,
          h: value106.current?.clientHeight ?? 800,
          top: value117.current ? 0 : value116.current || value118.current,
        }),
        [],
      ),
      [value121, value122]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        (): Dynamic => {
          if (value101 != null) return value101;
          if (value99 && !flag && editable) return null;
          let callback15: Dynamic = (input?: Dynamic): Dynamic =>
              (0, runtime.designPageId)(input, value67.pages) === value79,
            value653: Dynamic = value67.artboards.find(
              (input?: Dynamic): Dynamic => input.file === filePath,
            );
          return value653 && callback15(value653)
            ? filePath
            : (value67.artboards.find(
                (input?: Dynamic): Dynamic =>
                  callback15(input) && !input.frameless,
              )?.file ?? null);
        },
      ),
      [value123, value124]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        null,
      ),
      value125: Dynamic = (0, runtime.reactChromeTheme.useRef)(null);
    value125.current = value123;
    let value126: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value127: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Map()),
      [value128, value129]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        new Set(),
      ),
      [value130, value131]: Dynamic = (0, runtime.reactChromeTheme.useState)(0),
      value132: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value133: Dynamic = (0, runtime.reactChromeTheme.useRef)(false);
    value133.current = supportsLoadState && editing;
    let value134: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          value73.current.artboards.some(
            (input2?: Dynamic): Dynamic =>
              input2.file === input && input2.frameless,
          ) && value127.current.set(input, Date.now());
          input === focusedFileRef.current &&
            ((value132.current = {
              file: input,
              at: Date.now(),
            }),
            value133.current &&
              (0, runtime.currentEditingArtboardPath)() !==
                (0, runtime.artboardStorePath)(input) &&
              value131((input2?: Dynamic): Dynamic => input2 + 1));
        },
        [],
      ),
      value135: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          input !== focusedFileRef.current ||
            (0, runtime.currentEditingArtboardPath)() !==
              (0, runtime.artboardStorePath)(input) ||
            (value132.current = {
              file: input,
              at: Date.now(),
            });
        },
        [],
      );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let value653: Dynamic,
        callback15: Dynamic = (): Dynamic => {
          let current4: Dynamic = value132.current,
            value654: Dynamic =
              current4 !== null && current4.file === value121
                ? runtime.SessionArtboardStateConstant -
                  (Date.now() - current4.at)
                : 0,
            value655: Dynamic =
              supportsLoadState && editing && value121 !== null && value654 > 0;
          value655 || (value132.current = null);
          let value656: Dynamic = (0, runtime.setCurrentEditingArtboard)(
            value655 ? value121 : null,
          );
          value656 !== null && doc.releaseHold?.(value656);
          value655 &&
            (value653 = (window as Dynamic).setTimeout(callback15, value654));
        };
      callback15();
      return (): Dynamic => (window as Dynamic).clearTimeout(value653);
    }, [supportsLoadState, editing, value121, value130, doc]);
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic => (): Dynamic => {
        let value653: Dynamic = (0, runtime.setCurrentEditingArtboard)(null);
        value653 !== null && doc.releaseHold?.(value653);
      },
      [doc],
    );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let value653: Dynamic = doc;
      (0, runtime.setArtboardWritableCheck)(
        value653.theirsOnItsWay
          ? (input?: Dynamic): Dynamic => value653.theirsOnItsWay(input)
          : value653.releaseHold
            ? "cannot tell"
            : null,
      );
      return (): Dynamic => (0, runtime.setArtboardWritableCheck)(null);
    }, [doc]);
    let value136: Dynamic = (0, runtime.reactChromeTheme.useRef)(
      doc.content().files,
    );
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic =>
        doc.subscribe((input?: Dynamic): Dynamic => {
          let files: Dynamic = doc.content().files,
            current4: Dynamic = value136.current;
          value136.current = files;
          if (current4 === files) return;
          let value653: Dynamic = Object.keys(files).filter(
            (input2?: Dynamic): Dynamic =>
              input2 !== runtime.canvasMetadataFile &&
              files[input2] !== current4[input2],
          );
          for (let value654 of Object.keys(current4) as Dynamic)
            value654 !== runtime.canvasMetadataFile &&
              !(value654 in files) &&
              value653.push(value654);
          if (value653.length !== 0) {
            if (input?.remote !== true) {
              let current5: Dynamic = focusedFileRef.current;
              current5 !== null &&
                value653.includes(current5) &&
                value134(current5);
              return;
            }
            (0, runtime.emitEditorEvent)("files-changed", {
              projectPath: "appifact",
              paths: value653,
            });
            (window as Dynamic).dispatchEvent(
              new CustomEvent(runtime.remoteFilesEventName, {
                detail: {
                  paths: value653,
                },
              }),
            );
          }
        }),
      [doc, value134],
    );
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic => (
        (0, runtime.setFilePublishHandler)((input?: Dynamic): Dynamic => {
          showToast(
            "Stored a compressed copy of the image (" +
              (input === "unavailable"
                ? "uploads are unavailable here"
                : input === "unsupported_type" || input === "too_large"
                  ? "this file type or size can\u2019t be uploaded as-is"
                  : "the upload did not go through") +
              ").",
          );
        }),
        (): Dynamic => (0, runtime.setFilePublishHandler)(null)
      ),
      [showToast],
    );
    let value137: Dynamic =
        selection.elements.size > 1 ||
        (selection.elements.size > 0 &&
          selection.artboards.size + selection.notes.size > 0),
      value138: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (): Dynamic =>
          [...selectionRef.current.elements].map(
            ([input, input2]: Dynamic): Dynamic => [
              input,
              {
                tids: [...input2.tids],
              },
            ],
          ),
        [],
      ),
      value139: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let items: Dynamic = [];
          try {
            for (let [value653, value654] of value138() as Dynamic) {
              let value655: Dynamic = value177.current
                .get(value653)
                ?.serializeSelection(value654.tids);
              value655 && items.push(value655);
            }
          } catch (value653: Dynamic) {
            throw (input?.drop(), value653);
          }
          return items.length === 0
            ? (input?.drop(), false)
            : (input
                ? input.write(
                    items.join(`
`),
                  )
                : (0, runtime.setElementClipboard)(
                    items.join(`
`),
                    {
                      inTabOnly: true,
                    },
                  ),
              true);
        },
        [value138],
      ),
      value140: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Map()),
      value141: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Map()),
      value142: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Map()),
      value143: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Map()),
      value144: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic =>
          new Promise((input2?: Dynamic): Dynamic => {
            let callback15: Dynamic = (): Dynamic => {
                clearTimeout(value653);
                value140.current.delete(input);
                input2();
              },
              value653: Dynamic = setTimeout(callback15, 3e3);
            value140.current.set(input, callback15);
          }),
        [],
      ),
      value145: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options: Dynamic = {}): Dynamic => {
          if (
            !(0, runtime.sessionAllowsMutation)({
              gesturing: value218.current,
              setMoveCommits: value155.current,
            })
          )
            return false;
          let current4: Dynamic = selectionRef.current,
            value653: Dynamic = [...current4.elements].map(
              ([input2, input3]: Dynamic): Dynamic => [
                input2,
                {
                  tids: [...input3.tids],
                },
              ],
            );
          abandonSelectionGesture();
          let value654: Dynamic = options.elementsOnly
              ? runtime.emptyBoardSelection
              : (0, runtime.canvasBoardSelection)(current4),
            value655: Dynamic =
              (0, runtime.boardSelectionCount)(value654) > 0 &&
              value653.length > 0
                ? (0, runtime.randomSessionToken)()
                : undefined,
            value656: Dynamic =
              value655 !== undefined ? value144(value655) : null,
            value657: Dynamic =
              (0, runtime.boardSelectionCount)(value654) > 0
                ? value459.current(value654, value655)
                : false,
            value658: Dynamic = value432.current?.group(
              value653.map(([input2]: Dynamic): Dynamic => input2),
              {
                bound: value655,
              },
            ),
            entries: Dynamic = new Map(value22.current);
          (value657 && value656 ? value656 : Promise.resolve())
            .then(
              (): Dynamic =>
                Promise.all(
                  value653.map(
                    ([input2, input3]: Dynamic): Dynamic =>
                      (value22.current.get(input2) === entries.get(input2)
                        ? value177.current
                            .get(input2)
                            ?.removeSelection(input3.tids)
                        : Promise.resolve("skipped")
                      )
                        ?.catch((): Dynamic => "failed")
                        .finally((): Dynamic => value658?.settled(input2)),
                  ),
                ),
            )
            .finally((): Dynamic => value658?.end())
            .then((items?: Dynamic): Dynamic => {
              if (items.length === 0) return;
              let value659: Dynamic = items.some(
                (input2?: Dynamic): Dynamic =>
                  input2 !== "failed" && input2 !== "skipped" && !!input2,
              );
              if (
                items.some((input2?: Dynamic): Dynamic => input2 === "failed")
              ) {
                value448.current(
                  value659
                    ? input + " \u2014 one artboard's delete failed"
                    : "Nothing deleted \u2014 an artboard could not apply the delete.",
                );
                return;
              }
              let length: Dynamic = items.filter(
                (input2?: Dynamic): Dynamic => input2 === "skipped",
              ).length;
              if (length > 0) {
                value448.current(
                  (0, runtime.selectionActionFailureMessage)(
                    "delete",
                    length,
                    value659,
                  ),
                );
                return;
              }
              items.every((input2?: Dynamic): Dynamic => !input2)
                ? value448.current(
                    "Nothing deleted \u2014 repeated rows are generated by the layout's data and stay with it.",
                  )
                : (0, runtime.announce)(
                    items.every(Boolean)
                      ? input
                      : input + " \u2014 repeated rows stayed",
                  );
            });
          applyCanvasSelection(
            options.elementsOnly
              ? (0, runtime.selectionFromBoards)(
                  (0, runtime.canvasBoardSelection)(current4),
                )
              : runtime.emptyCanvasSelection,
          );
          return true;
        },
        [abandonSelectionGesture, applyCanvasSelection, value144],
      ),
      value146: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (): Dynamic => value145(runtime.DeletedValue),
        [value145],
      ),
      value147: Dynamic = (0, runtime.reactChromeTheme.useRef)(value145);
    value147.current = value145;
    let value148: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input: Dynamic = {}): Dynamic => {
          if (
            !(0, runtime.sessionAllowsMutation)({
              gesturing: value218.current,
              setMoveCommits: value155.current,
            }) ||
            value48.current > 0
          )
            return false;
          value31.current = null;
          abandonSelectionGesture();
          let value653: Dynamic = value138(),
            value654: Dynamic = input.elementsOnly
              ? runtime.emptyBoardSelection
              : (0, runtime.canvasBoardSelection)(selectionRef.current),
            value655: Dynamic =
              (0, runtime.boardSelectionCount)(value654) > 0 &&
              value653.length > 0
                ? (0, runtime.randomSessionToken)()
                : undefined,
            value656: Dynamic =
              value655 !== undefined ? value144(value655) : null,
            value657: Dynamic =
              (0, runtime.boardSelectionCount)(value654) > 0
                ? value323.current(value654, value655)
                : false,
            value658: Dynamic = value432.current?.group(
              value653.map(([input2]: Dynamic): Dynamic => input2),
              {
                bound: value655,
              },
            ),
            entries: Dynamic = new Map(value22.current);
          (value657 && value656 ? value656 : Promise.resolve())
            .then(
              (): Dynamic =>
                Promise.all(
                  value653.map(
                    ([input2, input3]: Dynamic): Dynamic =>
                      (value22.current.get(input2) === entries.get(input2)
                        ? value177.current
                            .get(input2)
                            ?.duplicateSelection(input3.tids)
                        : Promise.resolve("skipped")
                      )
                        ?.catch((): Dynamic => "failed")
                        .finally((): Dynamic => value658?.settled(input2)),
                  ),
                ),
            )
            .finally((): Dynamic => value658?.end())
            .then((items?: Dynamic): Dynamic => {
              let value659: Dynamic = items.some(
                (input2?: Dynamic): Dynamic =>
                  input2 !== "failed" && input2 !== "skipped" && !!input2,
              );
              if (
                items.some((input2?: Dynamic): Dynamic => input2 === "failed")
              ) {
                value448.current(
                  value659
                    ? "Duplicated \u2014 one artboard's duplicate failed"
                    : "Nothing duplicated \u2014 an artboard could not apply the duplicate.",
                );
                return;
              }
              let length: Dynamic = items.filter(
                (input2?: Dynamic): Dynamic => input2 === "skipped",
              ).length;
              if (length > 0) {
                value448.current(
                  (0, runtime.selectionActionFailureMessage)(
                    "duplicate",
                    length,
                    value659,
                  ),
                );
                return;
              }
              items.length > 0 &&
                items.every((input2?: Dynamic): Dynamic => !input2) &&
                value448.current(
                  "Nothing duplicated \u2014 repeated rows are generated by the layout's data and stay with it.",
                );
            });
          return true;
        },
        [value138, abandonSelectionGesture, value144],
      ),
      value149: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      value150: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (): Dynamic =>
          value339.current === "vector"
            ? runtime.FinishEditingThisDrawingSPointsToMessage
            : (0, runtime.activeCropElement)() !== null ||
                (document as Dynamic).querySelector("[data-media-crop]") !==
                  null
              ? runtime.GeometryFlipElementsLabel_6
              : undefined,
        [],
      ),
      value151: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options: Dynamic = {}): Dynamic => {
          if (value149.current) {
            value448.current(runtime.GeometryFlipAnnotationsLabel_3 + ".");
            return true;
          }
          if (
            !value224.current ||
            !(0, runtime.sessionAllowsMutation)({
              gesturing: value218.current,
              setMoveCommits: value155.current,
            }) ||
            value150() !== undefined
          )
            return false;
          let current4: Dynamic = selectionRef.current,
            value653: Dynamic = [...current4.elements]
              .filter(
                ([input2, input3]: Dynamic): Dynamic =>
                  input3.name === value19(input2),
              )
              .map(
                ([input2, input3]: Dynamic): Dynamic => [
                  input2,
                  {
                    tids: [...input3.tids],
                  },
                ],
              ),
            value654: Dynamic = options.elementsOnly
              ? emptyCanvasSelectionFiles
              : current4.notes;
          if (value653.length === 0 && value654.size === 0) {
            current4.artboards.size > 0 &&
              value448.current(runtime.GeometryFlipAnnotationsLabel_2);
            return false;
          }
          if (value653.length === 0) return value46.current(value654, input);
          value155.current++;
          value149.current = true;
          let flag2: Dynamic = true,
            callback15: Dynamic = (): Dynamic => {
              flag2 &&
                ((flag2 = false),
                (value149.current = false),
                value155.current--);
            },
            value655: Dynamic = (window as Dynamic).setTimeout(
              callback15,
              artboardRevealSettleTimeoutMs,
            );
          (async (): Promise<Dynamic> => {
            let value656: Dynamic = await Promise.all(
                value653.map(
                  ([input2, input3]: Dynamic): Dynamic =>
                    (
                      value177.current.get(input2)?.flipRead(input3.tids) ??
                      Promise.resolve(null)
                    ).catch((): Dynamic => null),
                ),
              ),
              current5: Dynamic = selectionRef.current;
            if (
              !value224.current ||
              value150() !== undefined ||
              value653.some(
                ([input2, input3]: Dynamic): Dynamic =>
                  current5.elements.get(input2)?.tids.join() !==
                  input3.tids.join(),
              ) ||
              [...value654].some(
                (input2?: Dynamic): Dynamic => !current5.notes.has(input2),
              )
            )
              return;
            if (
              !flag2 ||
              value656.some((input2?: Dynamic): Dynamic => input2 === null)
            )
              return void value448.current(
                runtime.CouldnTFlipRightNowTryAgainMessage,
              );
            let value657: Dynamic =
                value654.size > 0
                  ? (0, runtime.randomSessionToken)()
                  : undefined,
              value658: Dynamic =
                value657 !== undefined ? value144(value657) : null,
              value659: Dynamic =
                value654.size > 0
                  ? value45.current(value654, input, value657)
                  : null,
              value660: Dynamic = value432.current?.group(
                value653.map(([input2]: Dynamic): Dynamic => input2),
                {
                  bound: value657,
                },
              );
            value659?.flipped && value658 && (await value658);
            let value661: Dynamic = await Promise.all(
                value653.map(
                  ([input2]: Dynamic, options2?: Dynamic): Dynamic =>
                    (
                      value177.current
                        .get(input2)
                        ?.flipSelection(value656[options2], input) ??
                      Promise.resolve(null)
                    )
                      .catch((): Dynamic => null)
                      .finally((): Dynamic => value660?.settled(input2)),
                ),
              ).finally((): Dynamic => value660?.end()),
              value662: Dynamic = value661.some(
                (input2?: Dynamic): Dynamic => (input2?.flipped ?? 0) > 0,
              ),
              value663: Dynamic = value662 || value659?.flipped === true,
              value664: Dynamic = value661.some(
                (input2?: Dynamic): Dynamic =>
                  input2 === null ||
                  (input2.flipped === 0 &&
                    (input2.refused === undefined ||
                      input2.refused ===
                        runtime.CouldnTFlipRightNowTryAgainMessage)),
              ),
              value665: Dynamic = [
                ...value661.map((input2?: Dynamic): Dynamic => input2?.refused),
                value659?.refused,
              ].filter((input2?: Dynamic): Dynamic => input2 !== undefined),
              value666: Dynamic =
                value665.find(
                  (input2?: Dynamic): Dynamic =>
                    input2 !== runtime.FlippingThisWayWouldnTChangeItMessage,
                ) ?? (value663 ? undefined : value665[0]),
              value667: Dynamic = value664
                ? value663
                  ? runtime.PartOfTheSelectionCouldnTBeMessage
                  : runtime.CouldnTFlipRightNowTryAgainMessage
                : value666 !== undefined
                  ? (0, runtime.partialFlipMessage)(
                      value666,
                      value663,
                      runtime.GeometryFlipAnnotationsWytKytYtConfig,
                    )
                  : undefined;
            value662 &&
              applyCanvasSelection(selectionRef.current, {
                repush: new Set(
                  value653.map(([input2]: Dynamic): Dynamic => input2),
                ),
              });
            !(!value664 && options.then?.(value667, value663) === true) &&
              (value667 !== undefined && value448.current(value667),
              value663 &&
                (0, runtime.announce)(
                  (0, runtime.flipDirectionAnnouncement)(input),
                ));
          })().finally((): Dynamic => {
            (window as Dynamic).clearTimeout(value655);
            callback15();
          });
          return true;
        },
        [value144, applyCanvasSelection, value150],
      ),
      value152: Dynamic = (0, runtime.reactChromeTheme.useRef)(value151);
    value152.current = value151;
    let value153: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Map()),
      callback4: Dynamic = async (input?: Dynamic): Promise<Dynamic> => {
        let { token: value653, travel: value654 }: Dynamic = input,
          current4: Dynamic = selectionRef.current,
          value655: Dynamic = value654?.pieces ?? [],
          items: Dynamic = [...input.unanswered],
          callback15: Dynamic = (): Dynamic => {
            for (let value662 of input.plans.keys() as Dynamic) {
              let entry: Dynamic = value177.current.get(value662);
              entry?.moveCancel(value653);
              entry?.moveSettle();
            }
          },
          callback16: Dynamic = (): Dynamic => (
            callback15(),
            {
              written: [],
              refused: items,
              selection: current4,
            }
          ),
          callback17: Dynamic = async (input2?: Dynamic): Promise<Dynamic> => {
            let value662: Dynamic =
                input.copy && input.canvasMoved
                  ? value144(value653)
                  : Promise.resolve(),
              value663: Dynamic = input.canvas();
            for (let value664 of (value654?.travellers ?? []) as Dynamic)
              value654?.endHome(value664.file, false);
            await value662;
            value448.current(
              value663 === false
                ? "Nothing " +
                    (input.copy ? "copied" : "moved") +
                    " \u2014 the drag was interrupted; try it again."
                : input2,
            );
            input.copy &&
              input.canvasMoved &&
              (value142.current.has(value653)
                ? Promise.resolve()
                : value144(value653)
              ).then((): Dynamic => {
                let entry: Dynamic = value142.current.get(value653);
                value142.current.delete(value653);
                entry &&
                  (entry.files.size > 0 || entry.notes.size > 0) &&
                  setSelection(
                    (0, runtime.selectionFromBoards)({
                      files: entry.files,
                      notes: entry.notes,
                    }),
                  );
              });
            return callback16();
          };
        if (!value654 || value655.length === 0)
          return callback17(
            "Nothing " + (input.copy ? "copied" : "moved") + ".",
          );
        callback15();
        let files: Dynamic = doc.content().files;
        if (
          Object.keys(files).length + value655.length >
          runtime.PlatformFileContentFilesValue
        )
          return callback17(
            (input.canvasMoved
              ? "The rest " + (input.copy ? "copied" : "moved") + "; "
              : "") +
              "couldn't make new artboards \u2014 the canvas is at its " +
              String(runtime.PlatformFileContentFilesValue) +
              "-file limit; delete something first",
          );
        let state: Dynamic = {
            moves: [],
            annMoves: [],
          },
          items2: Dynamic = [],
          callback18: Dynamic = (): Dynamic => {},
          promise: Dynamic = new Promise((input2?: Dynamic): Dynamic => {
            callback18 = input2;
          });
        value143.current.set(value653, (input2?: Dynamic): Dynamic => {
          state = input2;
        });
        value141.current.set(value653, (source?: Dynamic): Dynamic => {
          source.kind === "add"
            ? items2.push({
                entries: source.entries,
                anns: source.anns ?? [],
              })
            : source.kind === "ann-add" &&
              items2.push({
                entries: [],
                anns: [source.spec],
              });
          callback18();
        });
        let value656: Dynamic = input.canvasMoved
            ? value144(value653)
            : Promise.resolve(),
          value657: Dynamic;
        try {
          value657 = input.canvas();
        } finally {
          value143.current.delete(value653);
        }
        value654.copy &&
          input.canvasMoved &&
          (await Promise.race([
            promise,
            value656,
            new Promise((input2?: Dynamic): Dynamic => setTimeout(input2, 2e3)),
          ]));
        value141.current.delete(value653);
        value142.current.delete(value653);
        let state2: Dynamic = {
          entries: items2.flatMap(
            (input2?: Dynamic): Dynamic => input2.entries,
          ),
          anns: items2.flatMap((input2?: Dynamic): Dynamic => input2.anns),
        };
        if (input.canvasMoved && value657 === false) {
          for (let value662 of value654.travellers as Dynamic)
            value654.endHome(value662.file, false);
          value448.current(
            "Nothing " +
              (value654.copy ? "copied" : "moved") +
              " \u2014 the drag was interrupted; try it again.",
          );
          return callback16();
        }
        let callback19: Dynamic = (): Dynamic => {
          (state.moves.length > 0 || state.annMoves.length > 0) &&
            value396.current(
              {
                kind: "move",
                moves: state.moves,
                ...(state.annMoves.length > 0
                  ? {
                      anns: state.annMoves,
                    }
                  : {}),
              },
              new Set(),
              undefined,
              value653,
            );
          (state2.entries.length > 0 || state2.anns.length > 0) &&
            value396.current(
              {
                kind: "add",
                entries: state2.entries,
                ...(state2.anns.length > 0
                  ? {
                      anns: state2.anns,
                    }
                  : {}),
              },
              new Set(
                state2.entries.map((input2?: Dynamic): Dynamic => input2.file),
              ),
              undefined,
              value653,
            );
        };
        if (
          Object.keys(doc.content().files).length + value655.length >
          runtime.PlatformFileContentFilesValue
        ) {
          callback19();
          for (let value662 of value654.travellers as Dynamic)
            value654.endHome(value662.file, false);
          value448.current(
            (input.canvasMoved
              ? "The rest " + (value654.copy ? "copied" : "moved") + "; "
              : "") +
              "couldn't make new artboards \u2014 the canvas is at its " +
              String(runtime.PlatformFileContentFilesValue) +
              "-file limit; delete something first",
          );
          return callback16();
        }
        let items3: Dynamic = [],
          entries: Dynamic = new Map(),
          state3: Dynamic = {
            files: {
              ...doc.content().files,
              ...Object.fromEntries(
                state2.entries.map(
                  (input2?: Dynamic): Dynamic => [input2.file, input2.src],
                ),
              ),
            },
            artboards: [
              ...value73.current.artboards,
              ...state2.entries.map((input2?: Dynamic): Dynamic => input2.spec),
            ],
          };
        try {
          for (let value662 of value655 as Dynamic) {
            let entry: Dynamic = value177.current.get(value662.file);
            if (!entry || (await entry.travellerHtml(value662.tid)) === null)
              continue;
            let value663: Dynamic = entry.serializeSelection([value662.tid], {
              lift: {
                ew: value662.box.w,
                ox: 0,
                oy: 0,
              },
            });
            if (!value663) continue;
            await entry.flushPending();
            let value664: Dynamic =
                (await (0, runtime.getKvClient)().get(
                  (0, runtime.PlatformFileContentHandler_4)(value662.file),
                )) ??
                files[value662.file] ??
                "",
              value665: Dynamic = (0, runtime.uniqueArtboardFile)(
                state3.files,
                "Piece",
                supportsLoadState,
              ),
              value666: Dynamic = (0, runtime.buildDcDocument)(
                value663,
                typeof value664 == "string" ? value664 : "",
              ),
              value667: Dynamic = entry.describeTids([value662.tid])[0],
              value668: Dynamic = value667
                ? value667.tag.charAt(0).toUpperCase() + value667.tag.slice(1)
                : "Piece",
              state4: Dynamic = {
                file: value665,
                x: Math.max(
                  -runtime.PlatformFileContentConstant_18,
                  Math.min(
                    runtime.PlatformFileContentConstant_18,
                    Math.round(value662.box.x),
                  ),
                ),
                y: Math.max(
                  -runtime.PlatformFileContentConstant_18,
                  Math.min(
                    runtime.PlatformFileContentConstant_18,
                    Math.round(value662.box.y),
                  ),
                ),
                w: Math.min(
                  runtime.PlatformFileContentLimit_6,
                  Math.max(
                    runtime.PlatformFileContentConstant_17,
                    value662.box.w,
                  ),
                ),
                h: Math.min(
                  runtime.PlatformFileContentLimit_6,
                  Math.max(
                    runtime.PlatformFileContentConstant_17,
                    value662.box.h,
                  ),
                ),
                title: (0, runtime.uniqueElementArtboardTitle)(
                  value668,
                  state3.artboards,
                ),
                frameless: true,
                ...callback3(),
              };
            state3.files[value665] = value666;
            state3.artboards.push(state4);
            items3.push({
              file: value665,
              src: value666,
              spec: state4,
              home: value662.file,
              tid: value662.tid,
            });
            entries.set(value662.file, [
              ...(entries.get(value662.file) ?? []),
              value662.tid,
            ]);
          }
        } catch (value662: Dynamic) {
          callback19();
          for (let value663 of value654.travellers as Dynamic)
            value654.endHome(value663.file, false);
          console.error("set pieces:", value662);
          value448.current(
            input.canvasMoved
              ? "The rest " +
                  (value654.copy ? "copied" : "moved") +
                  "; the elements could not be lifted and stayed."
              : "Nothing " +
                  (value654.copy ? "copied" : "moved") +
                  " \u2014 the elements could not be lifted.",
          );
          return callback16();
        }
        if (items3.length === 0) {
          callback19();
          for (let value662 of value654.travellers as Dynamic)
            value654.endHome(value662.file, false);
          value448.current(
            (input.canvasMoved
              ? "The rest " +
                (value654.copy ? "copied" : "moved") +
                "; the elements stayed \u2014 "
              : "Nothing " +
                (value654.copy ? "copied" : "moved") +
                " \u2014 ") +
              "repeated, nested or locked elements stay with their artboard.",
          );
          return callback16();
        }
        if (!value224.current) {
          callback19();
          for (let value662 of value654.travellers as Dynamic)
            value654.endHome(value662.file, false);
          value448.current(
            (input.canvasMoved
              ? "The rest " +
                (value654.copy ? "copied" : "moved") +
                "; the elements stayed \u2014 "
              : "Nothing " +
                (value654.copy ? "copied" : "moved") +
                " \u2014 ") + "the canvas is read-only now.",
          );
          return callback16();
        }
        let items4: Dynamic = [
          ...items3.map(
            ({ file: file, src: src, spec: spec }: Dynamic): Dynamic => ({
              file: file,
              src: src,
              spec: spec,
            }),
          ),
          ...state2.entries,
        ];
        value396.current(
          {
            kind: "add",
            entries: items4,
            ...(state2.anns.length > 0
              ? {
                  anns: state2.anns,
                }
              : {}),
            ...(state.moves.length > 0
              ? {
                  moves: state.moves,
                }
              : {}),
            ...(state.annMoves.length > 0
              ? {
                  annMoves: state.annMoves,
                }
              : {}),
          },
          new Set(items4.map((input2?: Dynamic): Dynamic => input2.file)),
          undefined,
          value653,
        );
        try {
          for (let value662 of items3 as Dynamic) {
            await (0, runtime.getKvClient)().set(
              (0, runtime.PlatformFileContentHandler_4)(value662.file),
              value662.src,
            );
            value127.current.set(value662.file, Date.now());
          }
        } catch (value662: Dynamic) {
          for (let value663 of value654.travellers as Dynamic)
            value654.endHome(value663.file, false);
          console.error("set pieces:", value662);
          value448.current(
            "Couldn't finish the drop \u2014 some of the pieces may be missing; " +
              (0, runtime.keyboardShortcutLabel)("Z") +
              " takes back what was made.",
          );
          return callback16();
        }
        value98({
          artboards: [
            ...value73.current.artboards.filter(
              (input2?: Dynamic): Dynamic =>
                !items3.some(
                  (input3?: Dynamic): Dynamic => input3.file === input2.file,
                ),
            ),
            ...items3.map((input2?: Dynamic): Dynamic => input2.spec),
          ],
        });
        let items5: Dynamic = [...entries.keys()];
        callback15();
        let value658: Dynamic = value654.copy
            ? undefined
            : value432.current?.group(items5, {
                bound: value653,
                atomic: true,
              }),
          items6: Dynamic = [...items],
          items7: Dynamic = [],
          entries2: Dynamic = new Map();
        await Promise.all(
          items5.map(async (input2?: Dynamic): Promise<Dynamic> => {
            if (value654.copy) {
              value654.endHome(input2, false);
              return;
            }
            let entry: Dynamic = value177.current.get(input2),
              value662: Dynamic = entries.get(input2) ?? [],
              value663: Dynamic = (
                current4.elements.get(input2)?.tids ?? []
              ).filter(
                (input3?: Dynamic): Dynamic => !value662.includes(input3),
              ),
              value664: Dynamic = entry
                ? await entry
                    .removeTravelled(value662, value663)
                    .catch((): Dynamic => "failed")
                : "failed";
            value658?.settled(input2);
            typeof value664 == "string"
              ? items6.push(input2)
              : (items7.push(input2), entries2.set(input2, value664.kept));
            value654.endHome(input2, typeof value664 != "string");
          }),
        );
        value658?.end();
        for (let value662 of value654.travellers as Dynamic)
          items5.includes(value662.file) ||
            value654.endHome(value662.file, false);
        for (let value662 of items7 as Dynamic)
          value153.current.set(value662, Date.now());
        let value659: Dynamic = items5.filter(
            (input2?: Dynamic): Dynamic => items6.includes(input2),
          ),
          entries3: Dynamic = new Map();
        for (let value662 of value655 as Dynamic)
          items3.some(
            (input2?: Dynamic): Dynamic =>
              input2.home === value662.file && input2.tid === value662.tid,
          ) ||
            entries3.set(value662.file, [
              ...(entries3.get(value662.file) ?? []),
              value662.tid,
            ]);
        let callback20: Dynamic = (items8?: Dynamic): Dynamic =>
          items8.length === 1
            ? items8[0]
            : items8.slice(0, -1).join(", ") +
              " and " +
              items8[items8.length - 1];
        if (value659.length > 0) {
          let value662: Dynamic = value659.map(callback2);
          value448.current(
            "Moved onto the canvas, but " +
              callback20(value662) +
              " kept what was dragged, so it is now in both places. Check " +
              (value662.length === 1 ? "that artboard" : "those artboards") +
              ".",
          );
        } else
          entries3.size > 0
            ? value189(
                (value654.copy ? "Copied" : "Moved") +
                  " " +
                  String(items3.length) +
                  (items3.length === 1 ? " element" : " elements") +
                  " onto the canvas. The rest stayed in " +
                  callback20([...entries3.keys()].map(callback2)) +
                  " \u2014 repeated, nested or locked elements stay with their artboard.",
              )
            : value189(
                (value654.copy ? "Copied" : "Moved") +
                  (items3.length === 1
                    ? ""
                    : " " + String(items3.length) + " elements") +
                  " onto the canvas",
              );
        abandonSelectionGesture();
        let entries4: Dynamic = new Map();
        if (!value654.copy) {
          for (let [value662, value663] of current4.elements as Dynamic)
            items5.includes(value662) || entries4.set(value662, value663);
          for (let value662 of items5 as Dynamic) {
            let entry: Dynamic = current4.elements.get(value662);
            if (!entry) continue;
            let value663: Dynamic = items7.includes(value662)
              ? (entries2.get(value662) ?? [])
              : null;
            value663 === null
              ? entries4.set(value662, entry)
              : value663.length > 0 &&
                entries4.set(value662, {
                  ...entry,
                  tids: value663,
                  rect: null,
                  count: value663.length,
                });
          }
        }
        let current5: Dynamic = focusedFileRef.current;
        (current5 == null ||
          entries4.get(current5) !== current4.elements.get(current5)) &&
          value62();
        let value660: Dynamic = (0, runtime.replaceSelectedElements)(
          (0, runtime.selectionFromArtboards)(
            new Set(items3.map((input2?: Dynamic): Dynamic => input2.file)),
          ),
          entries4,
          null,
        );
        setSelection(value660);
        for (let value662 of [
          ...new Set([
            ...items5,
            ...items,
            ...value654.travellers.map(
              (input2?: Dynamic): Dynamic => input2.file,
            ),
          ]),
        ] as Dynamic)
          value177.current.get(value662)?.moveSettle();
        (window as Dynamic).setTimeout((): Dynamic => {
          for (let value662 of new Set([
            ...items7,
            ...entries4.keys(),
          ]) as Dynamic) {
            let value663: Dynamic = entries4.get(value662)?.tids ?? null;
            value662 === focusedFileRef.current
              ? setShownFrameSelection(value662, value663)
              : value177.current
                  .get(value662)
                  ?.setShownSelection(
                    value663,
                    value663 ? value19(value662) : null,
                  );
          }
        }, 80);
        let value661: Dynamic = items.filter(
          (input2?: Dynamic): Dynamic =>
            !items5.includes(input2) && current4.elements.has(input2),
        );
        value661.length > 0 &&
          value659.length === 0 &&
          entries3.size === 0 &&
          value448.current(
            "Nothing moved inside " +
              callback20(value661.map(callback2)) +
              "; the rest " +
              (value654.copy ? "copied" : "moved") +
              ".",
          );
        return {
          written: items7,
          refused: items6,
          selection: value660,
        };
      },
      callback5: Dynamic = async (input?: Dynamic): Promise<Dynamic> => {
        let {
          token: value653,
          plans: value654,
          unanswered: value655,
          travel: value656,
        }: Dynamic = input;
        if (value656?.pieces) return callback4(input);
        input.canvas();
        let items: Dynamic = [...value654.keys()],
          current4: Dynamic = selectionRef.current,
          current5: Dynamic = focusedFileRef.current,
          items2: Dynamic = [...value655],
          entries: Dynamic = new Map(current4.elements),
          items3: Dynamic = [],
          primary: Dynamic = current4.primary,
          items4: Dynamic = [];
        if (value656) {
          let target: Dynamic = value656.target,
            value660: Dynamic = value656.travellers
              .filter((input2?: Dynamic): Dynamic => !input2.external)
              .map((input2?: Dynamic): Dynamic => input2.file),
            value661: Dynamic = items.filter(
              (input2?: Dynamic): Dynamic =>
                input2 !== target && !value660.includes(input2),
            ),
            items6: Dynamic = [],
            entries2: Dynamic = new Map();
          for (let value665 of value656.travellers as Dynamic) {
            let entry: Dynamic = value177.current.get(value665.file),
              items7: Dynamic = [];
            for (let value666 of value665.members as Dynamic) {
              let value667: Dynamic = value656.plan.landing.find(
                  (input2?: Dynamic): Dynamic => input2.tid === value666.index,
                ),
                value668: Dynamic = value667
                  ? (value666.html ??
                    (entry
                      ? await entry
                          .travellerHtml(value666.tid)
                          .catch((): Dynamic => null)
                      : null))
                  : null;
              value667 && value668
                ? items6.push({
                    file: value665.file,
                    tid: value666.tid,
                    html: value668,
                    landing: value667,
                  })
                : items7.push(value666.tid);
            }
            entries2.set(value665.file, items7);
          }
          let value662: Dynamic = value656.copy === true,
            value663: Dynamic = value662
              ? [target, ...value661]
              : [...new Set([target, ...value660, ...value661])],
            value664: Dynamic = value432.current?.group(
              value663,
              value662
                ? {
                    bound: value653,
                  }
                : {
                    bound: value653,
                    atomic: true,
                    holder: target,
                    waiting: value660.filter(
                      (input2?: Dynamic): Dynamic => input2 !== target,
                    ),
                  },
            );
          try {
            current5 != null &&
              value663.includes(current5) &&
              (value25.current = current5);
            let entry: Dynamic = value177.current.get(target),
              value665: Dynamic =
                value662 && value660.includes(target)
                  ? []
                  : (current4.elements.get(target)?.tids ?? []),
              value666: Dynamic = await (
                entry?.landTravellers(
                  items6.map(
                    ({ html: html, landing: landing }: Dynamic): Dynamic => ({
                      key: landing.tid,
                      html: html,
                      landing: landing,
                    }),
                  ),
                  value654.get(target) ?? [],
                  value665,
                ) ?? Promise.resolve("failed")
              ).catch((): Dynamic => "failed");
            value664?.settled(target);
            let entries3: Dynamic = new Map(),
              items7: Dynamic = [],
              items8: Dynamic = [],
              callback15: Dynamic = async (): Promise<Dynamic> => {
                for (let value672 of [...items8].reverse() as Dynamic) {
                  let entry2: Dynamic = value177.current.get(value672),
                    value673: Dynamic = entry2
                      ? (value664?.discard(value672) ?? null)
                      : null;
                  if (!entry2 || !value673) return false;
                  if (
                    !(await entry2
                      .applyHistory(value19(value672), "undo")
                      .catch((): Dynamic => false))
                  ) {
                    value673();
                    return false;
                  }
                  entry2.dropRedo();
                  items8.pop();
                  items4.push(value672);
                  items3 = items3.filter(
                    (input2?: Dynamic): Dynamic => input2 !== value672,
                  );
                  let entry3: Dynamic = current4.elements.get(value672);
                  entry3
                    ? entries.set(value672, entry3)
                    : entries.delete(value672);
                }
                return true;
              };
            if (value666 === "failed") {
              items2.push(target);
              target === current5 &&
                value25.current === current5 &&
                (value25.current = null);
              for (let value672 of value656.travellers as Dynamic)
                entries2.set(
                  value672.file,
                  value672.members.map(
                    (input2?: Dynamic): Dynamic => input2.tid,
                  ),
                );
            } else {
              for (let value672 of items6 as Dynamic) {
                let entry2: Dynamic = value666.landed.get(value672.landing.tid);
                if (!entry2 || entry2.length === 0) {
                  entries2.get(value672.file)?.push(value672.tid);
                  continue;
                }
                let value673: Dynamic = entries3.get(value672.file) ?? [];
                value673.push(value672.tid);
                entries3.set(value672.file, value673);
                items7.push(...entry2);
              }
              let stayers: Dynamic = value666.stayers;
              stayers && typeof stayers == "object"
                ? items7.push(...stayers.newTids)
                : (stayers === "refused" && items2.push(target),
                  items7.push(...(value666.stayersOwn ?? value665)));
              (items7.length > 0 || entries3.size > 0) && items3.push(target);
              if (entries3.size > 0) {
                let value672: Dynamic = items2.indexOf(target);
                value672 >= 0 && items2.splice(value672, 1);
              }
              entries3.size > 0 && items8.push(target);
            }
            let value667: Dynamic = await Promise.all(
              value661.map(
                (input2?: Dynamic): Dynamic =>
                  (
                    value177.current
                      .get(input2)
                      ?.moveElements(value654.get(input2) ?? []) ??
                    Promise.resolve("failed")
                  )
                    .catch((): Dynamic => "failed")
                    .finally((): Dynamic => value664?.settled(input2)),
              ),
            );
            value661.forEach((input2?: Dynamic, options?: Dynamic): Dynamic => {
              let value672: Dynamic = value667[options],
                entry2: Dynamic = current4.elements.get(input2);
              if (typeof value672 == "string" || !entry2) {
                (value672 === "refused" || value672 === "failed") &&
                  items2.push(input2);
                input2 === current5 &&
                  value25.current === current5 &&
                  (value25.current = null);
                return;
              }
              entries.set(input2, {
                ...entry2,
                tids: value672.newTids,
                rect: null,
                count: value672.newTids.length,
              });
              items3.push(input2);
            });
            let value668: Dynamic = callback2,
              callback16: Dynamic = (items11?: Dynamic): Dynamic =>
                items11.length <= 1
                  ? (items11[0] ?? "")
                  : items11.slice(0, -1).join(", ") +
                    " and " +
                    items11[items11.length - 1],
              items9: Dynamic = [],
              items10: Dynamic = [],
              value669: Dynamic = null;
            for (let value672 of value656.travellers as Dynamic) {
              if (value672.external) continue;
              if (value662) {
                value656.endHome(value672.file, false);
                value672.file !== target &&
                  (entries3.get(value672.file)?.length ?? 0) > 0 &&
                  entries.delete(value672.file);
                continue;
              }
              let entry2: Dynamic = value177.current.get(value672.file),
                value673: Dynamic = entries3.get(value672.file) ?? [],
                value674: Dynamic = (
                  current4.elements.get(value672.file)?.tids ?? []
                ).filter(
                  (input2?: Dynamic): Dynamic => !value673.includes(input2),
                ),
                value675: Dynamic = value674,
                flag2: Dynamic = false;
              if (value669 != null) {
                value675 = current4.elements.get(value672.file)?.tids ?? [];
                value669.how === "partial" &&
                  value673.length > 0 &&
                  items9.push(value672.file);
              } else if (value673.length > 0) {
                value664?.admit(value672.file);
                let value676: Dynamic = entry2
                  ? await entry2
                      .removeTravelled(value673, value674)
                      .catch((): Dynamic => "failed")
                  : "failed";
                typeof value676 == "string"
                  ? (value664?.settled(value672.file),
                    (value675 =
                      current4.elements.get(value672.file)?.tids ?? []),
                    (value669 = {
                      at: value672.file,
                      how: (await callback15()) ? "reverted" : "partial",
                    }),
                    value669.how === "partial" &&
                      items9.push(...items4, value672.file))
                  : ((value675 = value676.kept),
                    (flag2 = true),
                    items3.push(value672.file),
                    items8.push(value672.file));
              } else items10.push(value672.file);
              value672.file === current5 &&
                !flag2 &&
                value25.current === current5 &&
                (value25.current = null);
              value664?.settled(value672.file);
              value656.endHome(value672.file, flag2);
              let entry3: Dynamic = current4.elements.get(value672.file);
              value675.length === 0
                ? entries.delete(value672.file)
                : entry3 &&
                  entries.set(value672.file, {
                    ...entry3,
                    tids: value675,
                    rect: null,
                    count: value675.length,
                  });
            }
            let value670: Dynamic = value660.filter(
                (input2?: Dynamic): Dynamic =>
                  !items10.includes(input2) &&
                  (entries2.get(input2)?.length ?? 0) > 0,
              ),
              value671: Dynamic = value662 ? "copy" : "move";
            value669?.how === "reverted"
              ? value448.current(
                  "Couldn't " +
                    value671 +
                    " to " +
                    value668(target) +
                    ". " +
                    value668(value669.at) +
                    " kept what was dragged, so the copies in " +
                    value668(target) +
                    " were removed.",
                )
              : items9.length > 0
                ? value448.current(
                    "The move landed in " +
                      value668(target) +
                      " but could not leave " +
                      callback16(items9.map(value668)) +
                      (items9.length > 1
                        ? ". Check those artboards."
                        : ". Check both artboards."),
                  )
                : items10.length > 0 && value666 !== "failed"
                  ? value448.current(
                      "Nowhere to land in " +
                        value668(target) +
                        " for " +
                        callback16(items10.map(value668)) +
                        "'s selection; " +
                        (value662 ? "nothing of it was copied." : "it stayed."),
                    )
                  : value670.length > 0 &&
                    value448.current(
                      "Part of " +
                        callback16(value670.map(value668)) +
                        "'s selection could not land in " +
                        value668(target) +
                        (value662
                          ? "; that part was not copied."
                          : "; that part stayed where it was."),
                    );
            items9 = [];
            if (items7.length > 0 && value669?.how !== "reverted") {
              let entry2: Dynamic = current4.elements.get(target);
              entries.set(
                target,
                entry2
                  ? {
                      ...entry2,
                      tids: items7,
                      rect: null,
                      count: items7.length,
                    }
                  : {
                      name: value19(target),
                      tids: items7,
                      rect: null,
                      count: items7.length,
                    },
              );
              primary = target;
            }
            if (value669?.how !== "reverted")
              for (let value672 of [target, ...value660] as Dynamic)
                value153.current.set(value672, Date.now());
          } finally {
            value664?.end();
          }
        } else {
          let value660: Dynamic =
            items.length > 0
              ? value432.current?.group(items, {
                  bound: value653,
                })
              : undefined;
          current5 != null &&
            items.includes(current5) &&
            (value25.current = current5);
          let value661: Dynamic = await Promise.all(
            items.map(
              (input2?: Dynamic): Dynamic =>
                (
                  value177.current
                    .get(input2)
                    ?.moveElements(value654.get(input2) ?? []) ??
                  Promise.resolve("failed")
                )
                  .catch((): Dynamic => "failed")
                  .finally((): Dynamic => value660?.settled(input2)),
            ),
          );
          value660?.end();
          items.forEach((input2?: Dynamic, options?: Dynamic): Dynamic => {
            let value662: Dynamic = value661[options],
              entry: Dynamic = current4.elements.get(input2);
            if (typeof value662 == "string" || !entry) {
              (value662 === "refused" || value662 === "failed") &&
                items2.push(input2);
              input2 === current5 &&
                value25.current === current5 &&
                (value25.current = null);
              return;
            }
            entries.set(input2, {
              ...entry,
              tids: value662.newTids,
              rect: null,
              count: value662.newTids.length,
            });
          });
          items3 = items.filter(
            (input2?: Dynamic, options?: Dynamic): Dynamic =>
              typeof value661[options] != "string",
          );
        }
        input.canvasDropped &&
          value448.current(
            "The artboards and notes in the drag did not " +
              (input.copy ? "copy" : "move") +
              " \u2014 the drag was interrupted; try it again.",
          );
        let value657: Dynamic = current4;
        if (input.copy && input.canvasMoved && !input.canvasDropped) {
          value142.current.has(value653) || (await value144(value653));
          let entry: Dynamic = value142.current.get(value653);
          value142.current.delete(value653);
          value657 = entry
            ? (0, runtime.selectionFromBoards)({
                files: entry.files,
                notes: entry.notes,
              })
            : (0, runtime.selectionFromBoards)({
                files: emptyCanvasSelectionFiles,
                notes: emptyCanvasSelectionFiles,
              });
        } else
          input.copy &&
            (value657 = (0, runtime.selectionFromBoards)({
              files: emptyCanvasSelectionFiles,
              notes: emptyCanvasSelectionFiles,
            }));
        let value658: Dynamic = (0, runtime.replaceSelectedElements)(
          value657,
          entries,
          primary,
        );
        applyCanvasSelection(value658);
        let value659: Dynamic = value658,
          items5: Dynamic = [
            ...new Set([
              ...items,
              ...(value656
                ? [
                    value656.target,
                    ...value656.travellers.map(
                      (input2?: Dynamic): Dynamic => input2.file,
                    ),
                  ]
                : []),
            ]),
          ];
        for (let value660 of items5 as Dynamic)
          !items3.includes(value660) &&
            !items4.includes(value660) &&
            value177.current.get(value660)?.moveSettle();
        for (let value660 of value655 as Dynamic)
          value177.current.get(value660)?.moveSettle();
        (window as Dynamic).setTimeout((): Dynamic => {
          for (let value660 of [
            ...new Set([...items3, ...items4]),
          ] as Dynamic) {
            let value661: Dynamic =
              selectionRef.current.elements.get(value660)?.tids ?? null;
            value660 === focusedFileRef.current
              ? setShownFrameSelection(value660, value661)
              : value177.current
                  .get(value660)
                  ?.setShownSelection(
                    value661,
                    value661 ? value19(value660) : null,
                  );
            value177.current.get(value660)?.moveSettle();
          }
        }, 80);
        if (items2.length > 0) {
          let value660: Dynamic = items2.map(callback2),
            value661: Dynamic =
              value660.length === 1
                ? value660[0]
                : value660.slice(0, -1).join(", ") +
                  " and " +
                  value660[value660.length - 1],
            value662: Dynamic = items3.length === 0;
          value448.current(
            value662 && !input.canvasMoved
              ? "Nothing moved."
              : value662
                ? "The rest moved; nothing moved inside " + value661 + "."
                : "Nothing moved inside " + value661 + "; the rest moved.",
          );
        }
        return {
          written: items3,
          refused: items2,
          selection: value659,
        };
      },
      value154: Dynamic = (0, runtime.reactChromeTheme.useRef)(callback5);
    value154.current = callback5;
    let value155: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      value156: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let flag2: Dynamic = true;
          value155.current++;
          let value653: Dynamic = (window as Dynamic).setTimeout(
              (): Dynamic => callback15(),
              input,
            ),
            callback15: Dynamic = (): Dynamic => {
              flag2 &&
                ((flag2 = false),
                (window as Dynamic).clearTimeout(value653),
                value155.current--);
            };
          return callback15;
        },
        [],
      ),
      value157: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async (input?: Dynamic): Promise<Dynamic> => {
          let value653: Dynamic = value156(
            input.travel
              ? runtime.CanvasWorkingStateConstant_8
              : Math.max(
                  0,
                  runtime.CanvasWorkingStateLimit_5 -
                    (Date.now() - (input.releasedAt ?? Date.now())),
                ),
          );
          try {
            return await value154.current(input);
          } finally {
            value653();
          }
        },
        [value156],
      ),
      value158: Dynamic = (0, runtime.reactChromeTheme.useRef)(value148);
    value158.current = value148;
    let value159: Dynamic = (0, runtime.reactChromeTheme.useRef)(value137);
    value159.current = value137;
    let value160: Dynamic = (0, runtime.reactChromeTheme.useRef)(value139);
    value160.current = value139;
    let value161: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let activeElement: Dynamic = (document as Dynamic).activeElement;
          activeElement instanceof HTMLElement &&
            activeElement.tagName === "IFRAME" &&
            activeElement.blur();
          (window as Dynamic).focus();
          (0, runtime.announce)(input);
          value448.current?.(input);
        },
        [],
      ),
      value162: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options?: Dynamic,
          context: Dynamic = false,
          value653?: Dynamic,
        ): Dynamic => {
          let callback15: Dynamic = (): Dynamic => (
            context && (0, runtime.startClipboardMark)().drop(),
            true
          );
          if (input === "artboard") {
            let current4: Dynamic = focusedFileRef.current;
            return current4 == null
              ? false
              : (value29.current(current4, false), true);
          }
          if (input === "escape") return !context && value61.current();
          if (input === "deselect") {
            let current4: Dynamic = focusedFileRef.current,
              value654: Dynamic =
                value48.current > 0 ||
                (value31.current != null &&
                  Date.now() - value31.current.at < count);
            return context ||
              current4 == null ||
              !value654 ||
              !selectionRef.current.elements.has(current4)
              ? false
              : (value51((): Dynamic => {
                  abandonSelectionGesture();
                  applyCanvasSelection(runtime.emptyCanvasSelection);
                }),
                true);
          }
          if (
            input === "enter" ||
            input === "parent" ||
            input === "next" ||
            input === "prev" ||
            input === "a" ||
            input === "nudge"
          ) {
            if (context || !value137) return false;
            if (input === "nudge") {
              if (!value653) return false;
              value56.current({
                kind: "nudge",
                dx: value653.dx,
                dy: value653.dy,
                repeat: value653.repeat,
              });
            } else if (input === "a") {
              if (
                (0, runtime.selectionNavigationScope)(
                  selectionRef.current,
                  false,
                ) === "panel"
              )
                return false;
              value56.current({
                kind: "all",
              });
            } else
              value56.current({
                kind: input,
              });
            return true;
          }
          if (input === "z" || input === "Z") {
            let value654: Dynamic = input === "Z" ? "redo" : "undo";
            if (
              (0, runtime.hasHeldUndoOverlay)() ||
              value432.current?.busy() ||
              value155.current > 0
            )
              return true;
            value192.current(value654);
            if (value430.current.reachable(value654)) {
              value430.current.apply(value654);
              return true;
            }
            let current4: Dynamic = value432.current;
            if (!current4) return true;
            let value655: Dynamic =
              value654 === "undo" ? current4.undo() : current4.redo();
            value655 === "skipped-all"
              ? value448.current?.(
                  "Nothing left to " +
                    value654 +
                    " \u2014 that artboard's history changed.",
                )
              : value655 === "empty" &&
                (0, runtime.announce)(
                  runtime.AccessibilityAnnouncementsUndoRedoConfig[value654],
                );
            return true;
          }
          if (input === "v") {
            if (
              options?.seen.artboards != null &&
              (0, runtime.getActiveClipboardSource)(options.seen) ===
                "foreign-artboards"
            ) {
              if (!value224.current) return false;
              if (
                hasActiveUserGesture() &&
                !(0, runtime.hasBlockingEditorOverlay)()
              ) {
                let current4: Dynamic = focusedFileRef.current,
                  value658: Dynamic =
                    current4 == null
                      ? null
                      : value106.current?.querySelector(
                          `[data-mega-artboard="${CSS.escape(current4)}"] :is([data-mega-chrome="expand"], [data-mega-chrome="play"])`,
                        );
                value658
                  ? value658.focus({
                      preventScroll: true,
                    })
                  : (document as Dynamic).activeElement?.blur();
                (window as Dynamic).focus();
                value188(
                  runtime.ClipboardFileTransferRegistry.pressAgain(
                    (0, runtime.keyboardShortcutLabel)("V"),
                  ),
                );
              }
              return true;
            }
            let value654: Dynamic =
              hasActiveUserGesture() && !(0, runtime.hasBlockingEditorOverlay)()
                ? value109()
                : null;
            if (value654 == null) return false;
            let value655: Dynamic = (0, runtime.getAnnotationClipboard)();
            if (value654.overAnnotation && value655.length === 0) return false;
            let value656: Dynamic = (0, runtime.getActiveClipboardSource)(
              options?.seen ?? {
                text: "",
                stamp: null,
                hasImage: false,
              },
            );
            if (value656 === "text") return false;
            let value657: Dynamic = (0, runtime.getArtboardClipboard)();
            if (value656 === "artboards" && value657)
              value464.current(
                value657,
                value655,
                (0, runtime.pointerCoordinates)(value654),
              );
            else {
              if (value654.overAnnotation) return false;
              value470.current(value654, "");
            }
            return true;
          }
          if (
            input === "d" &&
            (value155.current > 0 || (value137 && value48.current > 0))
          )
            return true;
          if (input === "x" && value137 && value48.current > 0)
            return callback15();
          if (!value137) return false;
          if (input === "c") {
            if (value48.current === 0) return value139();
            let value654: Dynamic = (0, runtime.startClipboardMark)();
            value51((): Dynamic => {
              value139(value654);
            }, value654.drop);
            return true;
          }
          if (input === "x")
            return (0, runtime.sessionAllowsMutation)({
              gesturing: value218.current,
              setMoveCommits: value155.current,
            })
              ? value139()
                ? (value145(runtime.CutValue, {
                    elementsOnly: true,
                  }),
                  true)
                : false
              : callback15();
          if (input === "delete" || input === "delete-while-writing")
            return input === "delete-while-writing" &&
              value48.current === 0 &&
              !(
                value31.current != null &&
                Date.now() - value31.current.at < count
              )
              ? false
              : (value51((): Dynamic => {
                  if (context) {
                    let value654: Dynamic = (0, runtime.canvasBoardSelection)(
                      selectionRef.current,
                    );
                    value145(runtime.DeletedValue, {
                      elementsOnly: true,
                    }) &&
                      (0, runtime.boardSelectionCount)(value654) > 0 &&
                      value161(
                        "The artboards and notes stay selected \u2014 press Delete again to remove them",
                      );
                  } else value146();
                }),
                true);
          if (input === "flip-horizontal" || input === "flip-vertical") {
            let value654: Dynamic = context
                ? (0, runtime.canvasBoardSelection)(selectionRef.current)
                : runtime.emptyBoardSelection,
              value655: Dynamic =
                ((0, runtime.isApplePlatform)() ? "\u21E7" : "Shift+") +
                (input === "flip-horizontal" ? "H" : "V"),
              value656: Dynamic =
                input === "flip-horizontal" ? "horizontal" : "vertical",
              current4: Dynamic = selectionRef.current,
              callback16: Dynamic = (
                input2?: Dynamic,
                options2?: Dynamic,
              ): Dynamic =>
                input2.artboards.size === options2.artboards.size &&
                input2.notes.size === options2.notes.size &&
                input2.elements.size === options2.elements.size &&
                [...input2.artboards].every(
                  (input3?: Dynamic): Dynamic => options2.artboards.has(input3),
                ) &&
                [...input2.notes].every(
                  (input3?: Dynamic): Dynamic => options2.notes.has(input3),
                ) &&
                [...input2.elements].every(
                  ([input3, input4]: Dynamic): Dynamic =>
                    options2.elements.get(input3)?.tids.join() ===
                    input4.tids.join(),
                );
            value151(
              value656,
              context
                ? {
                    elementsOnly: true,
                    then: (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                      !value224.current ||
                      !callback16(current4, selectionRef.current) ||
                      (0, runtime.flipAnnotations)(
                        (value73.current.annotations ?? []).filter(
                          (input3?: Dynamic): Dynamic =>
                            value654.notes.has(input3.id),
                        ),
                        value656,
                      ).flips.length === 0
                        ? false
                        : (abandonSelectionGesture(),
                          applyCanvasSelection(
                            (0, runtime.selectionFromBoards)(value654),
                          ),
                          value161(
                            (input2 !== undefined
                              ? input2 + " "
                              : options2
                                ? (0, runtime.flipDirectionAnnouncement)(
                                    value656,
                                  ) + ". "
                                : "") +
                              "Press " +
                              value655 +
                              " again to flip what is outside the artboards, which stays selected.",
                          ),
                          true),
                  }
                : {},
            );
            return true;
          }
          if (input === "d") {
            let value654: Dynamic = context
              ? (0, runtime.canvasBoardSelection)(selectionRef.current)
              : runtime.emptyBoardSelection;
            value148(
              context
                ? {
                    elementsOnly: true,
                  }
                : {},
            ) &&
              (0, runtime.boardSelectionCount)(value654) > 0 &&
              (applyCanvasSelection((0, runtime.selectionFromBoards)(value654)),
              value161(
                "The artboards and notes stay selected \u2014 press " +
                  (0, runtime.keyboardShortcutLabel)("D") +
                  " again to copy them",
              ));
            return true;
          }
          return false;
        },
        [
          value51,
          value137,
          value139,
          value146,
          value145,
          value148,
          value151,
          abandonSelectionGesture,
          value109,
          applyCanvasSelection,
          value161,
        ],
      ),
      value163: Dynamic = (0, runtime.reactChromeTheme.useRef)(value162);
    value163.current = value162;
    let value164: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653?: Dynamic,
        ): Dynamic => value163.current(input, options, context, value653),
        [],
      ),
      value165: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value166: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          value165.current?.booted(input);
          value25.current === input && (value25.current = null);
          frameSelectionSequencesRef.current.delete(input);
          value26.current?.file === input && (value26.current = null);
          value24.current?.frameRebooted(input) === "redriven" &&
            selectionRef.current.elements.has(input) &&
            (value23.current = true);
          setSelection(
            (input2?: Dynamic): Dynamic =>
              (0, runtime.filterSelectedElements)(
                input2,
                (input3?: Dynamic): Dynamic => input3 !== input,
              ),
          );
          value89.onArtboardReady(input);
        },
        [value89.onArtboardReady],
      ),
      value167: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Set());
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let values: Dynamic = new Set();
      for (let [value653, value654] of selection.elements as Dynamic)
        value653 !== value121 &&
          (value177.current
            .get(value653)
            ?.setShownSelection(value654.tids, value19(value653)),
          values.add(value653));
      for (let value653 of value167.current as Dynamic)
        !values.has(value653) &&
          value653 !== value121 &&
          value177.current.get(value653)?.setShownSelection(null, null);
      value167.current = values;
    }, [selection, value121]);
    let value168: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic =>
          selection.artboards.size > 0
            ? selection.artboards
            : emptyCanvasFileSet,
        [selection],
      ),
      value169: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic =>
          selection.notes.size > 0
            ? selection.notes
            : emptyCanvasSelectionFiles,
        [selection],
      ),
      value170: Dynamic = (0, runtime.reactChromeTheme.useMemo)((): Dynamic => {
        if (selection.elements.size === 0) return emptyCanvasOptions;
        let state: Dynamic = {};
        for (let [value653, value654] of selection.elements as Dynamic)
          state[value653] = value654.tids;
        return state;
      }, [selection]),
      value171: Dynamic = (0, runtime.reactChromeTheme.useMemo)((): Dynamic => {
        if (selection.elements.size === 0) return;
        let state: Dynamic = {};
        for (let [value653, value654] of selection.elements as Dynamic)
          state[value653] = value654.rect;
        return state;
      }, [selection]),
      value172: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic =>
          selection.elements.size > 0
            ? new Set(selection.elements.keys())
            : emptyCanvasNoteSet,
        [selection],
      ),
      value173: Dynamic = (0, runtime.reactChromeTheme.useMemo)((): Dynamic => {
        if (value168.size !== 1 || value169.size > 0) return null;
        let value653: Dynamic = [...value168][0],
          value654: Dynamic = value67.artboards.find(
            (input?: Dynamic): Dynamic => input.file === value653,
          );
        return value654
          ? {
              file: value653,
              w: value654.w,
              h: value654.h,
              print: value654.print === "flow" ? "flow" : "fixed",
              ...((0, runtime.isFlowExport)(
                {
                  expand: value654.expand,
                },
                value93,
              )
                ? {
                    fillPaginates: true,
                  }
                : {}),
              paper: (0, runtime.getArtboardPaperSize)(value654),
              paperSet: value654.paper,
              guides: value654.guides ?? [],
              radius: value654.radius,
              ...(value654.frameless
                ? {
                    frameless: true,
                    label: value654.title,
                  }
                : {}),
            }
          : null;
      }, [value168, value169, value67, value93]),
      [value174, value175]: Dynamic = (0, runtime.reactChromeTheme.useState)(0),
      value176: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (): Dynamic => value175(0),
        [],
      ),
      value177: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Map()),
      value178: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value179: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        runtime.createPeerSelectionStore,
        [],
      ),
      value180: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        runtime.createPageScrollStore,
        [],
      ),
      value181: Dynamic = (0, runtime.reactChromeTheme.useRef)(value103.scale);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let count4: Dynamic = 1,
        count5: Dynamic = 1,
        value653: Dynamic,
        callback15: Dynamic = (input?: Dynamic, options?: Dynamic): Dynamic => {
          count4 = input;
          options === undefined && (count5 = input);
          for (let [value655, value656] of value177.current as Dynamic) {
            if (options !== undefined && value655 !== options) continue;
            let value657: Dynamic = (0, runtime.createPreviewHandle)(
              value656.webviewRef.current,
            );
            value657 && (0, runtime.setPickerHostScale)(value657, input);
          }
        },
        callback16: Dynamic = (): Dynamic => {
          let current4: Dynamic = focusedFileRef.current;
          return (
            current4 != null && selectionRef.current.elements.has(current4)
          );
        },
        callback17: Dynamic = (input?: Dynamic): Dynamic => {
          value181.current = input;
          Math.abs(input - count4) / count4 > 0.02 &&
            (value177.current.size <= 1 || callback16()) &&
            callback15(
              input,
              value177.current.size > 1 ? focusedFileRef.current : undefined,
            );
          clearTimeout(value653);
          value653 = setTimeout((): Dynamic => {
            let scale: Dynamic = value105.get().scale;
            (scale !== count5 || scale !== count4) && callback15(scale);
          }, 150);
        };
      callback17(value105.get().scale);
      let value654: Dynamic = value105.subscribe(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          input.scale !== options.scale && callback17(input.scale);
        },
      );
      return (): Dynamic => {
        value654();
        clearTimeout(value653);
      };
    }, [value105]);
    let [value182, value183]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        0,
      ),
      value184: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          let current4: Dynamic = value178.current;
          options == null
            ? (value177.current.delete(input),
              value165.current?.gone(input),
              context &&
                !current4?.keeper.holds(input) &&
                value432.current?.forget(input))
            : (value177.current.set(input, options),
              value165.current?.seen(input),
              value183((input2?: Dynamic): Dynamic => input2 + 1),
              current4?.keeper.holds(input) && current4.host.startLoad(input));
        },
        [],
      ),
      [value185, value186]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        null,
      ),
      value187: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value188: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          value186(input);
          (0, runtime.announce)(input);
          value187.current && clearTimeout(value187.current);
          value187.current = setTimeout((): Dynamic => value186(null), 6e3);
        },
        [],
      ),
      value189: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          value186(null);
          value187.current && clearTimeout(value187.current);
          (0, runtime.announce)(input);
        },
        [],
      ),
      value190: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => null,
      ),
      value191: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => {},
      ),
      value192: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => {},
      ),
      callback6: Dynamic = (): Dynamic => {
        let current4: Dynamic = focusedFileRef.current;
        return current4 === null
          ? null
          : (value177.current.get(current4)?.undoDepth() ?? null);
      };
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let callback15: Dynamic = (event?: Dynamic): Dynamic => {
        if (
          !(event.metaKey || event.ctrlKey) ||
          typeof event.key != "string" ||
          event.key.toLowerCase() !== "z"
        )
          return;
        let current4: Dynamic = value4.current,
          value653: Dynamic = (0, runtime.handleInlineUndoKey)(event, {
            editing: value224.current,
            filesOpen: value285.current,
            textEditOpen: current4 !== null,
            pending: value5.current,
            targetOwnsKey: (): Dynamic =>
              (0, runtime.isCanvasTypingTarget)(event.target),
            stepMadeDuringEdit: (input?: Dynamic): Dynamic =>
              current4 !== null &&
              (0, runtime.canApplyTextEditHistory)(
                current4,
                input,
                callback6(),
                value430.current.reachable(input),
              ),
            canvasStepOnTop: (input?: Dynamic): Dynamic =>
              value430.current.reachable(input) !== null,
          });
        value653 !== "ignore" &&
          (event.preventDefault(),
          event.stopImmediatePropagation(),
          value653 === "undo"
            ? value447.current?.undo()
            : value653 === "redo" && value447.current?.redo());
      };
      (document as Dynamic).addEventListener("keydown", callback15, true);
      return (): Dynamic =>
        (document as Dynamic).removeEventListener("keydown", callback15, true);
    }, []);
    let value193: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      [value194, value195]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        null,
      ),
      value196: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value197: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653?: Dynamic,
        ): Dynamic => ({
          key: input.key,
          x: options,
          y: context,
          label: input.label,
          alt: value653,
          box: input.box,
          ghost:
            value196.current?.key === input.key ? value196.current.ghost : null,
        }),
        [],
      ),
      value198: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          if (!input.box || value196.current?.key === input.key) return;
          value196.current = {
            key: input.key,
            ghost: null,
          };
          let entry: Dynamic = value177.current.get(input.file),
            box: Dynamic = input.box;
          if (entry)
            try {
              entry
                .renderDefaults()
                .then((input2?: Dynamic): Dynamic => {
                  if (value196.current?.key !== input.key) return;
                  let value653: Dynamic = entry.serializeSelection(input.tids, {
                    bakeProps: true,
                    lift: box,
                    vals: input2,
                  });
                  if (!value653 || value653.length > 2e5) return;
                  let files: Dynamic = doc.content().files,
                    state: Dynamic = {
                      ...(0, runtime.mergeDesignSystemFileOverlay)(files),
                      [dragGhostFilename]: (0, runtime.buildDcDocument)(
                        value653,
                        files[input.file] ?? "",
                        {
                          logic: false,
                        },
                      ),
                    },
                    value654: Dynamic = (0, runtime.normalizeProjectBlobPaths)(
                      (0, runtime.collectProjectDependencyFiles)(
                        state,
                        dragGhostFilename,
                      ),
                    ),
                    { doc: value655, parts: value656 }: Dynamic = (0,
                    runtime.buildPreviewDocument)(
                      value654,
                      dragGhostFilename,
                      assets,
                      new Set(),
                      {
                        frameless: true,
                        fileUrlFor: runtime.createLinkedFileScript,
                      },
                    ),
                    value657: Dynamic =
                      Object.keys(value656).length > 0
                        ? {
                            srcdoc: runtime.PreviewBuildDocumentResolvedValue_3,
                            boot: {
                              doc: value655,
                              parts: (0, runtime.runtimeModuleBlobs)(value656),
                              urls: (0, runtime.runtimeModuleUrls)(value656),
                            },
                          }
                        : {
                            srcdoc: value655,
                            boot: null,
                          };
                  value196.current.ghost = value657;
                  value195(
                    (input3?: Dynamic): Dynamic =>
                      input3 && {
                        ...input3,
                        ghost: value657,
                      },
                  );
                })
                .catch((): Dynamic => {});
            } catch {}
        },
        [doc, assets],
      ),
      [value199, value200]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        null,
      ),
      value201: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value202: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      value203: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value204: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let current4: Dynamic = value203.current;
          if (!current4) return;
          let target: Dynamic = current4.target;
          if (target && target.file !== input) {
            let entry: Dynamic = value177.current.get(target.file);
            entry?.dropPlanClear(current4.token);
            current4.closing.set(
              target.file,
              target.opened
                .then((): Dynamic => entry?.moveHost(current4.token, "close"))
                .catch((): Dynamic => false),
            );
            current4.target = null;
          }
          current4.pending = null;
        },
        [],
      ),
      value205: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          if (value203.current?.gestureKey === input.key) return;
          value204();
          let state: Dynamic = {
            gestureKey: input.key,
            token: (0, runtime.randomSessionToken)(),
            html: null,
            member: null,
            laidOut: new Map(),
            closing: new Map(),
            target: null,
            inFlight: null,
            pending: null,
          };
          value203.current = state;
          let entry: Dynamic = value177.current.get(input.file);
          if (!entry || !input.box || input.tids.length !== 1) return;
          let box: Dynamic = input.box;
          entry
            .renderDefaults()
            .then((input2?: Dynamic): Dynamic => {
              if (value203.current !== state) return;
              let value653: Dynamic = entry.serializeSelection(input.tids, {
                bakeProps: true,
                vals: input2,
              });
              state.html = value653 || null;
              state.member =
                value653 &&
                (0, runtime.canFreezeSinglePaste)(
                  false,
                  input.tids,
                  value653,
                  false,
                )
                  ? (0, runtime.pastedElementGeometry)(value653, box)
                  : null;
            })
            .catch((): Dynamic => {});
        },
        [value204],
      ),
      value206: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          event?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653?: Dynamic,
          extra?: Dynamic,
        ): Dynamic => {
          if (event.inFlight) {
            event.pending = {
              cx: context,
              cy: value653,
              mode: extra,
            };
            return;
          }
          let html: Dynamic = event.html,
            member: Dynamic = event.member;
          if (!html || !member) return;
          let entry: Dynamic = value177.current.get(options.file),
            value654: Dynamic = value87.current.artboards.find(
              (input?: Dynamic): Dynamic => input.file === options.file,
            );
          if (!entry || !value654) return;
          let entry2: Dynamic = event.laidOut.get(options.file);
          entry2 ||
            ((entry2 = entry.isFreeCanvas(html).then(
              (input?: Dynamic): Dynamic => !input,
              (): Dynamic => false,
            )),
            event.laidOut.set(options.file, entry2));
          event.inFlight = Promise.all([options.opened, entry2])
            .then(
              ([input, input2]: Dynamic): Dynamic =>
                input && input2
                  ? entry.dropPlanAt(
                      event.token,
                      {
                        x: context - value654.x,
                        y: value653 - value654.y,
                      },
                      [member],
                      extra,
                    )
                  : null,
            )
            .then(
              (input?: Dynamic): Dynamic => {
                event.target === options &&
                  (!input ||
                    !input.landing.some(
                      (input2?: Dynamic): Dynamic => input2.tid === 0,
                    )) &&
                  entry.dropPlanClear(event.token);
              },
              (): Dynamic => {},
            )
            .finally((): Dynamic => {
              event.inFlight = null;
              let pending: Dynamic = event.pending;
              event.pending = null;
              pending &&
                event.target &&
                value203.current === event &&
                value206(
                  event,
                  event.target,
                  pending.cx,
                  pending.cy,
                  pending.mode,
                );
            });
        },
        [],
      ),
      value207: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653?: Dynamic,
        ): Dynamic => {
          let current4: Dynamic = value203.current;
          if (!current4 || current4.gestureKey !== input.key) return;
          let value654: Dynamic =
              value653 || input.tids.length !== 1 || value345.current
                ? null
                : [...value87.current.artboards]
                    .reverse()
                    .find(
                      (input2?: Dynamic): Dynamic =>
                        !(
                          input2.frameless && input2.file !== value125.current
                        ) &&
                        options >= input2.x &&
                        options <= input2.x + input2.w &&
                        context >= input2.y &&
                        context <= input2.y + input2.h,
                    ),
            value655: Dynamic =
              value654 &&
              value654.file !== input.file &&
              value654.file !== value271.current
                ? value654.file
                : null;
          current4.target && current4.target.file !== value655 && value204();
          if (!!value655) {
            if (!current4.target) {
              let entry: Dynamic = value177.current.get(value655);
              current4.target = {
                file: value655,
                opened: (current4.closing.get(value655) ?? Promise.resolve())
                  .then(
                    (): Dynamic =>
                      entry?.moveHost(current4.token, "open") ?? false,
                  )
                  .catch((): Dynamic => false),
              };
            }
            value206(
              current4,
              current4.target,
              options,
              context,
              input.ctrl ? "keep" : "flow",
            );
          }
        },
        [value204, value206],
      ),
      value208: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input: Dynamic = false): Dynamic => {
          value193.current = null;
          value201.current && clearTimeout(value201.current);
          value195(null);
          value200(value216.current?.file ?? null);
          input || (value204(), (value203.current = null));
        },
        [value204],
      ),
      value209: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {
        value216.current = null;
        value193.current ||
          (value201.current && clearTimeout(value201.current),
          value200(null),
          (value196.current = null),
          (value203.current = null));
      }, []),
      value210: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {
        let value653: Dynamic = value193.current ?? value216.current;
        value653 &&
          value177.current.get(value653.file)?.hostDrag("cancel", value653.key);
        value216.current = null;
        value208();
      }, [value208]);
    value20.current = value208;
    let callback7: Dynamic = (source?: Dynamic): Dynamic => {
        let callback15: Dynamic = (input?: Dynamic): Dynamic =>
            input
              .replace(/&/g, "&amp;")
              .replace(/"/g, "&quot;")
              .replace(/</g, "&lt;"),
          value653: Dynamic = [
            (0, runtime.annotationRotation)(source) !== 0
              ? "rotate(" +
                String((0, runtime.annotationRotation)(source)) +
                "deg)"
              : "",
            (0, runtime.imageFlipCss)(source)?.transform ?? "",
          ]
            .filter((input?: Dynamic): Dynamic => input !== "")
            .join(" "),
          value654: Dynamic =
            value653 !== "" ? " transform: " + value653 + ";" : "";
        if ((0, runtime.isShapeAnnotation)(source)) {
          if (source.kind !== "image" || source.video) return null;
          let value657: Dynamic = String(Math.round(source.w)),
            value658: Dynamic = String(Math.round(source.h));
          if (source.crop) {
            let value659: Dynamic = (0, runtime.imageCropCss)(source.crop),
              value660: Dynamic =
                "position: absolute; width: " +
                value659.width +
                "; height: " +
                value659.height +
                "; left: " +
                value659.left +
                "; top: " +
                value659.top +
                "; max-width: none; max-height: none; object-fit: cover; object-position: " +
                value659.objectPosition;
            return (
              '<div style="position: relative; contain: layout; overflow: hidden; width: ' +
              value657 +
              "px; height: " +
              value658 +
              "px;" +
              value654 +
              '"><img src="' +
              callback15(source.src) +
              '"' +
              (source.alt ? ' alt="' + callback15(source.alt) + '"' : "") +
              ' style="' +
              value660 +
              '"></div>'
            );
          }
          return (
            '<img src="' +
            callback15(source.src) +
            '"' +
            (source.alt ? ' alt="' + callback15(source.alt) + '"' : "") +
            ' width="' +
            value657 +
            '" height="' +
            value658 +
            '" style="width: ' +
            value657 +
            "px; height: auto;" +
            value654 +
            '">'
          );
        }
        let value655: Dynamic = (0, runtime.annotationTextStyle)(source),
          callback16: Dynamic = (input?: Dynamic): Dynamic =>
            input
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;"),
          state: Dynamic = {
            bold: "strong",
            italic: "em",
            code: "code",
          },
          callback17: Dynamic = (input?: Dynamic): Dynamic =>
            (0, runtime.NotesBlocksHandler)(input)
              .map(
                (source2?: Dynamic): Dynamic =>
                  source2.kind === "text"
                    ? callback16(source2.text)
                    : source2.kind === "link"
                      ? /^https?:\/\//i.test(source2.href)
                        ? '<a href="' +
                          callback15(source2.href) +
                          '">' +
                          callback16(source2.text) +
                          "</a>"
                        : callback16(source2.text)
                      : "<" +
                        state[source2.kind] +
                        ">" +
                        callback16(source2.text) +
                        "</" +
                        state[source2.kind] +
                        ">",
              )
              .join(""),
          value656: Dynamic = (0, runtime.parseNoteBlocks)(source.text)
            .map(
              (source2?: Dynamic): Dynamic =>
                source2.kind === "p"
                  ? "<div>" +
                    (source2.text === "" ? "<br>" : callback17(source2.text)) +
                    "</div>"
                  : source2.kind === "ul"
                    ? "<ul>" +
                      source2.items
                        .map(
                          (input?: Dynamic): Dynamic =>
                            "<li>" + callback17(input) + "</li>",
                        )
                        .join("") +
                      "</ul>"
                    : '<ol start="' +
                      String(source2.start) +
                      '">' +
                      source2.items
                        .map(
                          (input?: Dynamic): Dynamic =>
                            "<li>" + callback17(input) + "</li>",
                        )
                        .join("") +
                      "</ol>",
            )
            .join("");
        return source.text.trim() === ""
          ? null
          : '<div style="margin: 0; width: ' +
              String(Math.round(source.w)) +
              "px; font-size: " +
              String(value655.size) +
              "px;" +
              (value655.bold ? " font-weight: 600;" : "") +
              (value655.italic ? " font-style: italic;" : "") +
              " white-space: pre-wrap;" +
              value654 +
              '">' +
              value656 +
              "</div>";
      },
      value211: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async (input?: Dynamic): Promise<Dynamic> => {
          if ("note" in input) {
            let value653: Dynamic = (value73.current.annotations ?? []).find(
              (input2?: Dynamic): Dynamic => input2.id === input.note,
            );
            return value653 ? callback7(value653) : null;
          }
          let entry: Dynamic = value177.current.get(input.file);
          return entry &&
            value73.current.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input.file,
            )?.frameless
            ? entry.pieceContent()
            : null;
        },
        [],
      ),
      value212: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (event?: Dynamic): Dynamic => {
          let current4: Dynamic = value203.current;
          current4 &&
            current4.gestureKey !== event.key &&
            (value204(), (current4 = null));
          let value653: Dynamic = value202.current || value345.current;
          if (!current4) {
            if (!event.target || value653) return;
            let state: Dynamic = {
                ew: event.at.w,
                eh: event.at.h,
                ox: 0,
                oy: 0,
                gx: event.point.x - event.at.x,
                gy: event.point.y - event.at.y,
              },
              state2: Dynamic = {
                gestureKey: event.key,
                token: (0, runtime.randomSessionToken)(),
                html: null,
                member: null,
                laidOut: new Map(),
                target: null,
                closing: new Map(),
                inFlight: null,
                pending: null,
              };
            value203.current = state2;
            current4 = state2;
            value211(event.object)
              .then((input?: Dynamic): Dynamic => {
                value203.current === state2 &&
                  ((state2.html = input),
                  (state2.member = input
                    ? (0, runtime.pastedElementGeometry)(input, state)
                    : null));
              })
              .catch((): Dynamic => {});
          }
          let value654: Dynamic =
            event.target &&
            !value653 &&
            event.target !== value271.current &&
            event.target !== ("file" in event.object ? event.object.file : null)
              ? event.target
              : null;
          current4.target && current4.target.file !== value654 && value204();
          if (!!value654) {
            if (!current4.target) {
              let entry: Dynamic = value177.current.get(value654),
                value655: Dynamic = current4;
              current4.target = {
                file: value654,
                opened: (current4.closing.get(value654) ?? Promise.resolve())
                  .then(
                    (): Dynamic =>
                      entry?.moveHost(value655.token, "open") ?? false,
                  )
                  .catch((): Dynamic => false),
              };
            }
            value206(
              current4,
              current4.target,
              event.point.x,
              event.point.y,
              event.ctrl ? "keep" : "flow",
            );
          }
        },
        [value204, value206, value211],
      ),
      value213: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async (
          input?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
        ): Promise<Dynamic> => {
          let current4: Dynamic = value432.current;
          (await new Promise((input2?: Dynamic): Dynamic => {
            let flag2: Dynamic = false,
              callback15: Dynamic = (input3?: Dynamic): Dynamic => {
                flag2 || ((flag2 = true), input2(input3));
              };
            if (!current4 || current4.headBound("undo") !== options)
              return callback15(false);
            runWhenConditionReady(
              (): Dynamic => flag2 || !current4.busy(),
              (): Dynamic => {
                if (flag2 || current4.headBound("undo") !== options)
                  return callback15(false);
                let value653: Dynamic = current4.undo();
                value653 === "applied" && current4.clearRedo();
                callback15(value653 === "applied");
              },
            );
            setTimeout((): Dynamic => callback15(false), 3500);
          })) ||
            value448.current(
              "Couldn't undo the move into " +
                callback2(input) +
                ". The " +
                context +
                " may now be in both places.",
            );
        },
        [],
      ),
      value214: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let {
            target: value653,
            point: value654,
            at: value655,
            ctrl: value656,
          }: Dynamic = input;
          if (value345.current || value653 === value271.current) return false;
          let value657: Dynamic = value87.current.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === value653,
            ),
            entry: Dynamic = value177.current.get(value653);
          if (
            !value657 ||
            value657.frameless ||
            !entry ||
            value202.current ||
            value155.current > 0
          )
            return false;
          let value658: Dynamic, value659: Dynamic, value660: Dynamic;
          if ("note" in input.object) {
            let value663: Dynamic = (value73.current.annotations ?? []).find(
              (input2?: Dynamic): Dynamic => input2.id === input.object.note,
            );
            if (!value663) return false;
            let value664: Dynamic = callback7(value663);
            if (!value664) return false;
            value658 = async (): Promise<Dynamic> => value664;
            value659 = {
              files: new Set(),
              notes: new Set([value663.id]),
            };
            value660 = value663.kind === "image" ? "image" : "note";
          } else {
            let file: Dynamic = input.object.file,
              entry2: Dynamic = value177.current.get(file);
            if (
              !entry2 ||
              !value73.current.artboards.find(
                (input2?: Dynamic): Dynamic => input2.file === file,
              )?.frameless
            )
              return false;
            value658 = (): Dynamic => entry2.pieceContent();
            value659 = {
              files: new Set([file]),
              notes: new Set(),
            };
            value660 = "piece";
          }
          let value661: Dynamic =
              value203.current?.gestureKey === input.key
                ? value203.current
                : null,
            value662: Dynamic =
              !!value661?.target && value661.target.file === value653;
          value661 && !value662 && value204();
          value203.current = null;
          value202.current = true;
          (async (): Promise<Dynamic> => {
            try {
              let value663: Dynamic =
                  (value661?.html ?? null) || (await value658()),
                value664: Dynamic = value663
                  ? (0, runtime.pastedRootElementCount)(value663)
                  : 0;
              if (!value663 || value664 !== 1) {
                value662 &&
                  value661?.target &&
                  value661.target.opened.then(
                    (): Dynamic => entry.moveHost(value661.token, "close"),
                  );
                value188(
                  value663
                    ? "Nothing moved. This piece holds " +
                        String(value664) +
                        " elements; a piece with one element can join an artboard."
                    : "Nothing moved. This " +
                        value660 +
                        " has nothing that can go into an artboard.",
                );
                return;
              }
              let value665: Dynamic = value654.x - value657.x,
                value666: Dynamic = value654.y - value657.y,
                state: Dynamic = {
                  ew: value655.w,
                  eh: value655.h,
                  ox: 0,
                  oy: 0,
                  gx: value654.x - value655.x,
                  gy: value654.y - value655.y,
                },
                value667: Dynamic =
                  value662 && value661
                    ? value661.token
                    : (0, runtime.randomSessionToken)(),
                flag2: Dynamic = false,
                flag3: Dynamic = false,
                value668: Dynamic = null,
                value669: Dynamic = (0, runtime.pastedElementGeometry)(
                  value663,
                  state,
                );
              if (
                value669 &&
                (0, runtime.canFreezeSinglePaste)(
                  false,
                  [0],
                  value663,
                  false,
                ) &&
                (0, runtime.canFreezeSinglePaste)(
                  false,
                  [0],
                  value663,
                  await entry.isFreeCanvas(value663),
                )
              ) {
                let value674: Dynamic = Date.now() + 1500,
                  value675: Dynamic = Symbol("timed out"),
                  callback15: Dynamic = (input2?: Dynamic): Dynamic => {
                    let index: Dynamic = 0,
                      promise: Dynamic = new Promise(
                        (input3?: Dynamic): Dynamic => {
                          index = (window as Dynamic).setTimeout(
                            (): Dynamic => input3(value675),
                            Math.max(0, value674 - Date.now()),
                          );
                        },
                      );
                    return Promise.race([
                      input2.catch((): Dynamic => value675),
                      promise,
                    ]).finally(
                      (): Dynamic => (window as Dynamic).clearTimeout(index),
                    );
                  };
                try {
                  let value676: Dynamic = await callback15(
                      value662 && value661?.target
                        ? value661.target.opened
                        : (
                            value661?.closing.get(value653) ?? Promise.resolve()
                          ).then(
                            (): Dynamic => entry.moveHost(value667, "open"),
                          ),
                    ),
                    value677: Dynamic =
                      value676 === true
                        ? await callback15(
                            entry.dropPlanAt(
                              value667,
                              {
                                x: value665,
                                y: value666,
                              },
                              [value669],
                              value656 ? "keep" : "flow",
                            ),
                          )
                        : value676;
                  if (value677 === value675) {
                    value188(
                      "Nothing moved. " +
                        callback2(value653) +
                        " did not answer; try the drag again.",
                    );
                    return;
                  }
                  let value678: Dynamic = value677
                    ? (value677.landing.find(
                        (input2?: Dynamic): Dynamic => input2.tid === 0,
                      ) ?? null)
                    : null;
                  if (value677 && value678) {
                    flag3 = true;
                    let value679: Dynamic = await value157({
                      token: value667,
                      plans: new Map(),
                      unanswered: [],
                      canvasMoved: false,
                      copy: false,
                      canvas: (): Dynamic => {},
                      travel: {
                        target: value653,
                        pureTarget: true,
                        plan: value677,
                        travellers: [
                          {
                            file: "<canvas>",
                            external: true,
                            members: [
                              {
                                tid: 0,
                                index: 0,
                                html: value663,
                              },
                            ],
                          },
                        ],
                        endHome: (): Dynamic => {},
                      },
                    });
                    flag2 = value679.written.includes(value653);
                    flag2 &&
                      ((value668 = value679.selection),
                      entry.dropPlanClear(value667, true));
                  }
                } finally {
                  let callback16: Dynamic = (): Dynamic => {
                    entry.dropPlanClear(value667);
                    entry.moveHost(value667, "close");
                  };
                  flag2
                    ? (window as Dynamic).setTimeout(callback16, 150)
                    : callback16();
                }
              }
              if (!flag2 && flag3) return;
              let value670: Dynamic = null;
              if (!flag2) {
                let value674: Dynamic = value432.current?.group([value653], {
                  bound: value667,
                });
                try {
                  let value675: Dynamic = await entry.insertHtml(
                    (0, runtime.positionPastedHtml)(value663, {
                      ew: state.ew,
                      ox: value665 - state.gx,
                      oy: value666 - state.gy,
                    }),
                    "root-end",
                  );
                  flag2 = value675.length > 0;
                  flag2 &&
                    ((value670 = value675),
                    entry.setShownSelection(value675, value19(value653)));
                } finally {
                  value674?.settled(value653);
                  value674?.end();
                  if (value662 && value661?.target) {
                    let target: Dynamic = value661.target;
                    entry.dropPlanClear(value661.token);
                    target.opened
                      .then(
                        (): Dynamic => entry.moveHost(value661.token, "close"),
                      )
                      .catch((): Dynamic => false);
                  }
                }
              }
              if (!flag2) {
                value188("Could not move \u2014 nothing changed.");
                return;
              }
              value276.current = {
                file: value653,
                at: Date.now(),
              };
              let value671: Dynamic = value670
                  ? (0, runtime.selectionFromElements)(value653, {
                      name: value19(value653),
                      tids: value670,
                      rect: null,
                      count: value670.length,
                    })
                  : (value668 ?? selectionRef.current),
                value672: Dynamic = (0, runtime.filterSelectedAnnotations)(
                  (0, runtime.filterSelectedArtboards)(
                    value671,
                    (input2?: Dynamic): Dynamic => !value659.files.has(input2),
                  ),
                  (input2?: Dynamic): Dynamic => !value659.notes.has(input2),
                ),
                value673: Dynamic =
                  value659.files.size > 0 ? value144(value667) : null;
              if (!value459.current(value659, value667)) {
                await value213(value653, value667, value660);
                value188(
                  "Nothing moved. The " +
                    value660 +
                    " could not leave the canvas.",
                );
                return;
              }
              value189("Moved into " + callback2(value653));
              if (value673) {
                value155.current++;
                try {
                  await value673;
                } finally {
                  value155.current--;
                }
              }
              setSelection(value672);
              (window as Dynamic).setTimeout((): Dynamic => {
                setSelection(value672);
                let value674: Dynamic =
                  value672.elements.get(value653)?.tids ?? null;
                value653 === focusedFileRef.current
                  ? setShownFrameSelection(value653, value674)
                  : entry.setShownSelection(
                      value674,
                      value674 ? value19(value653) : null,
                    );
              }, 160);
            } catch (value663: Dynamic) {
              showToast(
                "Couldn't finish the drop: " + String(value663),
                "error",
              );
              if (value662 && value661?.target) {
                let target: Dynamic = value661.target;
                entry.dropPlanClear(value661.token);
                target.opened
                  .then((): Dynamic => entry.moveHost(value661.token, "close"))
                  .catch((): Dynamic => false);
              }
            } finally {
              value202.current = false;
            }
          })();
          return true;
        },
        [
          value188,
          showToast,
          value189,
          value157,
          value213,
          value204,
          setShownFrameSelection,
        ],
      ),
      value215: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653?: Dynamic,
        ): Dynamic => {
          let value654: Dynamic =
            value203.current?.gestureKey === input.key
              ? value203.current
              : null;
          value203.current = null;
          let callback15: Dynamic = (input2?: Dynamic): Dynamic => {
            let value656: Dynamic = value654?.target;
            if (!value654 || !value656 || value656.file === input2) return;
            let entry3: Dynamic = value177.current.get(value656.file);
            entry3?.dropPlanClear(value654.token);
            value654.closing.set(
              value656.file,
              value656.opened
                .then((): Dynamic => entry3?.moveHost(value654.token, "close"))
                .catch((): Dynamic => false),
            );
            value654.target = null;
          };
          if (value345.current) {
            callback15();
            value188(
              "Nothing moved \u2014 only this artboard is on screen; drag the element within its frame.",
            );
            return;
          }
          let value655: Dynamic = [...value87.current.artboards]
            .reverse()
            .find(
              (input2?: Dynamic): Dynamic =>
                !(input2.frameless && input2.file !== value125.current) &&
                options >= input2.x &&
                options <= input2.x + input2.w &&
                context >= input2.y &&
                context <= input2.y + input2.h,
            );
          callback15(value655?.file);
          if (value655 != null && value655.file === value271.current) {
            callback15();
            value188(
              "Nothing moved. That artboard is playing. Press Edit on it first.",
            );
            return;
          }
          if (!value655) {
            let entry3: Dynamic = value177.current.get(input.file);
            if (!entry3 || value202.current || value155.current > 0) return;
            value202.current = true;
            let value656: Dynamic;
            (async (): Promise<Dynamic> => {
              try {
                let value657: Dynamic = input.box ?? {
                    w: 320,
                    h: 200,
                    ew: 320,
                    eh: 200,
                    ox: 0,
                    oy: 0,
                    gx: 160,
                    gy: 100,
                  },
                  value658: Dynamic = entry3.serializeSelection(input.tids, {
                    lift: value657,
                  });
                if (!value658) {
                  value188(
                    "Nothing moved \u2014 repeated or root-level elements stay with their artboard.",
                  );
                  return;
                }
                let files: Dynamic = doc.content().files;
                if (
                  Object.keys(files).length >=
                  runtime.PlatformFileContentFilesValue
                ) {
                  showToast(
                    "Couldn't make a new artboard \u2014 the canvas is at its " +
                      String(runtime.PlatformFileContentFilesValue) +
                      "-file limit; delete something first",
                    "error",
                  );
                  return;
                }
                await entry3.flushPending();
                let value659: Dynamic =
                    (await (0, runtime.getKvClient)().get(
                      (0, runtime.PlatformFileContentHandler_4)(input.file),
                    )) ??
                    files[input.file] ??
                    "",
                  value660: Dynamic = (0, runtime.uniqueArtboardFile)(
                    files,
                    "Piece",
                    supportsLoadState,
                  ),
                  value661: Dynamic = (0, runtime.buildDcDocument)(
                    value658,
                    typeof value659 == "string" ? value659 : "",
                  );
                await (0, runtime.getKvClient)().set(
                  (0, runtime.PlatformFileContentHandler_4)(value660),
                  value661,
                );
                value127.current.set(value660, Date.now());
                let state: Dynamic = {
                    file: value660,
                    x: Math.round(options - value657.gx),
                    y: Math.round(context - value657.gy),
                    w: Math.min(
                      runtime.PlatformFileContentLimit_6,
                      Math.max(
                        runtime.PlatformFileContentConstant_17,
                        value657.w,
                      ),
                    ),
                    h: Math.min(
                      runtime.PlatformFileContentLimit_6,
                      Math.max(
                        runtime.PlatformFileContentConstant_17,
                        value657.h,
                      ),
                    ),
                    title: (0, runtime.uniqueElementArtboardTitle)(
                      input.label,
                      value73.current.artboards,
                    ),
                    frameless: true,
                    ...callback3(),
                  },
                  value662: Dynamic = value653
                    ? undefined
                    : (0, runtime.randomSessionToken)();
                value653 ||
                  (value656 = value156(runtime.CanvasWorkingStateConstant_8));
                value396.current(
                  {
                    kind: "add",
                    entries: [
                      {
                        file: value660,
                        src: value661,
                        spec: state,
                      },
                    ],
                  },
                  new Set([value660]),
                  undefined,
                  value662,
                );
                value98({
                  artboards: [
                    ...value73.current.artboards.filter(
                      (input2?: Dynamic): Dynamic => input2.file !== value660,
                    ),
                    state,
                  ],
                });
                if (!value653) {
                  let value663: Dynamic = value432.current?.group(
                      [input.file],
                      {
                        bound: value662,
                        atomic: true,
                      },
                    ),
                    flag2: Dynamic = false;
                  try {
                    flag2 = await entry3.removeSelection(input.tids);
                  } finally {
                    value663?.end();
                  }
                  if (!flag2) {
                    value188(
                      "Copied onto the canvas \u2014 the original could not be removed.",
                    );
                    return;
                  }
                }
                value189((value653 ? "Copied" : "Moved") + " onto the canvas");
                abandonSelectionGesture();
                value62();
                setSelection(
                  (0, runtime.selectionFromArtboards)(new Set([value660])),
                );
              } catch (value657: Dynamic) {
                showToast(
                  "Couldn't finish the drop: " + String(value657),
                  "error",
                );
              } finally {
                value656?.();
                value202.current = false;
              }
            })();
            return;
          }
          if (value655.file === input.file) {
            value188(
              "Released over the same artboard \u2014 drag the element itself to move it within its frame.",
            );
            return;
          }
          let entry: Dynamic = value177.current.get(input.file),
            entry2: Dynamic = value177.current.get(value655.file);
          if (!entry || !entry2 || value202.current || value155.current > 0) {
            callback15();
            return;
          }
          value202.current = true;
          (async (): Promise<Dynamic> => {
            let value656: Dynamic = value654?.target?.file === value655.file,
              value657: Dynamic,
              value658: Dynamic;
            try {
              let value659: Dynamic = entry.serializeSelection(input.tids, {
                bakeProps: true,
                vals: await entry.renderDefaults(),
              });
              if (!value659) {
                value188(
                  "Nothing moved \u2014 repeated or root-level elements stay with their artboard.",
                );
                return;
              }
              let box: Dynamic = input.box,
                value660: Dynamic = options - value655.x,
                value661: Dynamic = context - value655.y,
                value662: Dynamic = box
                  ? (0, runtime.pastedElementGeometry)(value659, box)
                  : null,
                flag2: Dynamic = false;
              if (
                value662 &&
                (0, runtime.canFreezeSinglePaste)(
                  value653,
                  input.tids,
                  value659,
                  false,
                ) &&
                (0, runtime.canFreezeSinglePaste)(
                  value653,
                  input.tids,
                  value659,
                  await entry2.isFreeCanvas(value659),
                )
              ) {
                let value665: Dynamic =
                  value656 && value654
                    ? value654.token
                    : (0, runtime.randomSessionToken)();
                value656 = false;
                let value666: Dynamic = Date.now() + 1500,
                  value667: Dynamic = Symbol("timed out"),
                  callback16: Dynamic = (input2?: Dynamic): Dynamic => {
                    let index: Dynamic = 0,
                      promise: Dynamic = new Promise(
                        (input3?: Dynamic): Dynamic => {
                          index = (window as Dynamic).setTimeout(
                            (): Dynamic => input3(value667),
                            Math.max(0, value666 - Date.now()),
                          );
                        },
                      );
                    return Promise.race([
                      input2.catch((): Dynamic => value667),
                      promise,
                    ]).finally(
                      (): Dynamic => (window as Dynamic).clearTimeout(index),
                    );
                  },
                  flag3: Dynamic = false;
                try {
                  let value668: Dynamic = await callback16(
                      (
                        value654?.closing.get(value655.file) ??
                        Promise.resolve()
                      ).then((): Dynamic => entry2.moveHost(value665, "open")),
                    ),
                    value669: Dynamic =
                      value668 === true
                        ? await callback16(
                            entry2.dropPlanAt(
                              value665,
                              {
                                x: value660,
                                y: value661,
                              },
                              [value662],
                              input.ctrl ? "keep" : "flow",
                            ),
                          )
                        : value668;
                  if (value669 === value667) {
                    value188(
                      "Nothing moved. " +
                        callback2(value655.file) +
                        " did not answer; try the drag again.",
                    );
                    return;
                  }
                  let value670: Dynamic = value669
                    ? (value669.landing.find(
                        (input2?: Dynamic): Dynamic => input2.tid === 0,
                      ) ?? null)
                    : null;
                  flag2 = !value670;
                  if (value669 && value670) {
                    let value671: Dynamic = await value157({
                      token: value665,
                      plans: new Map(),
                      unanswered: [],
                      canvasMoved: false,
                      copy: false,
                      canvas: (): Dynamic => {},
                      travel: {
                        target: value655.file,
                        pureTarget: true,
                        plan: value669,
                        travellers: [
                          {
                            file: input.file,
                            members: [
                              {
                                tid: input.tids[0],
                                index: 0,
                              },
                            ],
                          },
                        ],
                        endHome: (): Dynamic => {},
                      },
                    });
                    value276.current = {
                      file: value655.file,
                      at: Date.now(),
                    };
                    flag3 = value671.written.includes(value655.file);
                    flag3 && entry2.dropPlanClear(value665, true);
                    flag3 &&
                      value671.written.includes(input.file) &&
                      value189("Moved to " + callback2(value655.file));
                    return;
                  }
                } finally {
                  let callback17: Dynamic = (): Dynamic => {
                    entry2.dropPlanClear(value665);
                    entry2.moveHost(value665, "close");
                  };
                  flag3
                    ? (window as Dynamic).setTimeout(callback17, 150)
                    : callback17();
                }
              }
              let value663: Dynamic = box
                ? {
                    ew: box.ew,
                    ox: value660 - box.gx + box.ox,
                    oy: value661 - box.gy + box.oy,
                  }
                : {
                    ox: value660,
                    oy: value661,
                  };
              value653 ||
                ((value657 = value432.current?.group(
                  [value655.file, input.file],
                  {
                    atomic: true,
                    holder: value655.file,
                    waiting: [input.file],
                  },
                )),
                (value658 = value156(runtime.CanvasWorkingStateConstant_8)));
              let value664: Dynamic = flag2
                ? await entry2.insertHtml(
                    (0, runtime.positionPastedHtml)(value659, value663),
                    "root-end",
                  )
                : await entry2.insertHtml(value659, "root-end", value663);
              value276.current = {
                file: value655.file,
                at: Date.now(),
              };
              if (value664.length === 0) {
                value188("Could not move \u2014 nothing changed.");
                return;
              }
              if (value653)
                value189(
                  "Copied to " + value655.file.replace(/\.dc\.html$/, ""),
                );
              else {
                value657?.admit(input.file);
                if (!(await entry.removeSelection(input.tids))) {
                  value657?.end();
                  let value665: Dynamic =
                      value657?.discard(value655.file) ?? null,
                    value666: Dynamic = value665
                      ? await entry2
                          .applyHistory(value19(value655.file), "undo")
                          .catch((): Dynamic => false)
                      : false;
                  value665 && !value666 && value665();
                  value666 && entry2.dropRedo();
                  value188(
                    value666
                      ? "Could not move \u2014 reverted."
                      : "Move failed halfway \u2014 check both artboards.",
                  );
                  return;
                }
                value189("Moved to " + callback2(value655.file));
              }
              abandonSelectionGesture();
              setSelection(
                (0, runtime.setCanvasElementSelection)(
                  runtime.emptyCanvasSelection,
                  value655.file,
                  {
                    name: value19(value655.file),
                    tids: value664,
                    rect: null,
                    count: value664.length,
                  },
                  false,
                ),
              );
              entry2.setShownSelection(value664, value19(value655.file));
            } finally {
              value657?.end();
              value658?.();
              if (value656 && value654) {
                entry2.dropPlanClear(value654.token);
                let target: Dynamic = value654.target;
                value654.closing.set(
                  value655.file,
                  (target?.opened ?? Promise.resolve(true))
                    .then(
                      (): Dynamic => entry2.moveHost(value654.token, "close"),
                    )
                    .catch((): Dynamic => false),
                );
              }
              value202.current = false;
            }
          })();
        },
        [
          value67,
          doc,
          value98,
          value62,
          showToast,
          value189,
          abandonSelectionGesture,
          value157,
          value156,
        ],
      ),
      value216: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value217: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let entry: Dynamic = selectionRef.current.elements.get(input);
          if (!entry) return null;
          let values: Dynamic = new Set(entry.tids),
            value653: Dynamic = options.filter(
              (input2?: Dynamic): Dynamic => values.has(input2),
            );
          if (value653.length === 0) return null;
          let value654: Dynamic =
              value177.current.get(input)?.describeTids(value653) ?? [],
            value655: Dynamic =
              value654.length === 1
                ? value654[0].kind === "other"
                  ? "element"
                  : value654[0].kind
                : value654.length + " elements";
          return {
            tids: value653,
            label: value655,
          };
        },
        [],
      ),
      value218: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      value219: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          value218.current = input;
        },
        [],
      ),
      [value220, value221]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        false,
      ),
      value222: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let current4: Dynamic = value193.current;
          if (options.type === "arm") {
            if (
              input !== focusedFileRef.current ||
              value218.current ||
              (current4 &&
                current4.file === input &&
                current4.key !== options.key &&
                value208(),
              value209(),
              !options.tids)
            )
              return;
            let value657: Dynamic = value217(input, options.tids);
            if (!value657) return;
            value216.current = {
              key: options.key,
              file: input,
              tids: value657.tids,
              alt: options.alt,
              box: options.box,
              label: value657.label,
            };
            value198(value216.current);
            value205(value216.current);
            value200(input);
            value201.current && clearTimeout(value201.current);
            value201.current = setTimeout(value209, 6e4);
            return;
          }
          if (options.type === "disarm") {
            let current5: Dynamic = value216.current;
            current5 &&
              current5.file === input &&
              current5.key === options.key &&
              value209();
            current4 && current4.file === input && current4.key === options.key
              ? (current4.pendingDrop &&
                  value188(
                    "Nothing moved \u2014 the artboard ended the drag first.",
                  ),
                value208())
              : !current4 && !value216.current && value200(null);
            return;
          }
          if (options.type === "exit") {
            if (input !== focusedFileRef.current) return;
            if (current4) {
              if (current4.file === input) {
                if (current4.key !== options.key) return;
                current4.echoed = true;
                let pendingDrop: Dynamic = current4.pendingDrop;
                if (!pendingDrop) {
                  value198(current4);
                  return;
                }
                value208(true);
                value177.current.get(input)?.hostDrag("finish", current4.key);
                value215(
                  current4,
                  pendingDrop.cx,
                  pendingDrop.cy,
                  pendingDrop.alt,
                );
                return;
              }
              value208();
            }
            if (value218.current) return;
            let value657: Dynamic = value217(input, options.tids);
            if (!value657) return;
            value193.current = {
              key: options.key,
              file: input,
              tids: value657.tids,
              alt: options.alt,
              ctrl: false,
              box: options.box,
              label: value657.label,
              moves: [],
              latched: false,
              startedAt: Date.now(),
              echoed: true,
              pendingDrop: null,
            };
            value198(value193.current);
            value200(input);
            value201.current && clearTimeout(value201.current);
            value201.current = setTimeout(value210, 3e4);
            return;
          }
          if (
            !current4 ||
            current4.key !== options.key ||
            current4.file !== input
          )
            return;
          if (options.type === "cancel") {
            value208();
            return;
          }
          let value653: Dynamic = value67.artboards.find(
            (input2?: Dynamic): Dynamic => input2.file === input,
          );
          if (!value653) return;
          let value654: Dynamic = value653.x + options.x,
            value655: Dynamic = value653.y + options.y;
          if (current4.pendingDrop) return;
          if (options.type === "move") {
            let value657: Dynamic = Date.now();
            for (
              current4.moves.push(value657);
              current4.moves.length > 0 &&
              (current4.moves[0] < value657 - 1e3 ||
                current4.moves.length > 240);

            )
              current4.moves.shift();
            current4.moves.length > 120 && (current4.latched = true);
            value201.current && clearTimeout(value201.current);
            value201.current = setTimeout(value210, 3e4);
            current4.latched ||
              value195(value197(current4, value654, value655, options.alt));
            current4.ctrl = options.ctrl;
            value207(current4, value654, value655, options.alt);
            return;
          }
          let value656: Dynamic = current4.moves.length > 0;
          value208(value656);
          value656 &&
            ((current4.ctrl = options.ctrl),
            value215(current4, value654, value655, options.alt));
        },
        [
          value67,
          value208,
          value209,
          value210,
          value215,
          value217,
          value198,
          value205,
          value207,
          value197,
          value188,
        ],
      ),
      value223: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653?: Dynamic,
          extra: Dynamic = false,
        ): Dynamic => {
          let current4: Dynamic = value193.current,
            current5: Dynamic = value216.current,
            value654: Dynamic = current4 ?? current5,
            value655: Dynamic = value654
              ? value177.current.get(value654.file)
              : undefined;
          if (!current4?.pendingDrop) {
            if (input === "stale") {
              value210();
              return;
            }
            if (input === "move") {
              if (!current4) {
                if (!current5 || current5.file !== focusedFileRef.current)
                  return;
                current4 = {
                  ...current5,
                  alt: value653,
                  ctrl: extra,
                  moves: [],
                  latched: false,
                  startedAt: Date.now(),
                  echoed: false,
                  pendingDrop: null,
                };
                value193.current = current4;
                value655?.hostDrag("exit", current5.key, value653);
              }
              current4.moves.push(Date.now());
              current4.moves.length > 240 && current4.moves.shift();
              value201.current && clearTimeout(value201.current);
              value201.current = setTimeout(value210, 3e4);
              value195(value197(current4, options, context, value653));
              current4.ctrl = extra;
              value207(current4, options, context, value653);
              return;
            }
            value209();
            if (!current4) {
              current5 && value655?.hostDrag("cancel", current5.key);
              return;
            }
            current4.ctrl = extra;
            if (input === "cancel" || current4.moves.length === 0) {
              value208();
              value655?.hostDrag("cancel", current4.key);
              return;
            }
            if (!current4.echoed) {
              current4.pendingDrop = {
                cx: options,
                cy: context,
                alt: value653,
              };
              value195(null);
              value201.current && clearTimeout(value201.current);
              value201.current = setTimeout((): Dynamic => {
                value193.current?.pendingDrop &&
                  value188(
                    "Nothing moved \u2014 the artboard did not answer; try the drag again.",
                  );
                value210();
              }, 1500);
              return;
            }
            value208(true);
            value655?.hostDrag("finish", current4.key);
            value215(current4, options, context, value653);
          }
        },
        [value208, value209, value210, value215, value197, value207, value188],
      ),
      value224: Dynamic = (0, runtime.reactChromeTheme.useRef)(editing);
    value224.current = editing;
    let value225: Dynamic = (0, runtime.reactChromeTheme.useRef)(readOnly);
    value225.current = readOnly;
    let value226: Dynamic = (0, runtime.reactChromeTheme.useRef)({
      dx: 0,
      dy: 0,
      dz: 0,
      px: 0,
      py: 0,
      pinch: false,
      zoomMsgs: 0,
      raf: 0,
      winStart: 0,
      winPan: 0,
      winZoom: 0,
    });
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic => (): Dynamic => {
        value226.current.raf && cancelAnimationFrame(value226.current.raf);
      },
      [],
    );
    let value227: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          if (value345.current) return false;
          let value653: Dynamic =
              !value224.current ||
              input === focusedFileRef.current ||
              input === value271.current,
            value654: Dynamic = value67.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input,
            );
          if (!value653 || !value654) return false;
          let current4: Dynamic = value226.current;
          current4.dx += options.dx;
          current4.dy += options.dy;
          options.pinch &&
            ((current4.pinch = true),
            (current4.dz += options.dz),
            options.dz !== 0 && (current4.zoomMsgs += 1),
            (current4.px =
              value654.x + Math.max(0, Math.min(value654.w, options.x))),
            (current4.py =
              value654.y + Math.max(0, Math.min(value654.h, options.y))));
          current4.raf ||
            (current4.raf = requestAnimationFrame((): Dynamic => {
              current4.raf = 0;
              let value655: Dynamic = performance.now();
              value655 - current4.winStart > 1e3 &&
                ((current4.winStart = value655),
                (current4.winPan = 0),
                (current4.winZoom = 0));
              let value656: Dynamic =
                  Math.abs(current4.dx) + Math.abs(current4.dy),
                value657: Dynamic =
                  value656 > 0
                    ? Math.min(
                        1,
                        Math.max(0, canvasPanUsageWindowMs - current4.winPan) /
                          value656,
                      )
                    : 0,
                value658: Dynamic = current4.dx * value657,
                value659: Dynamic = current4.dy * value657;
              current4.winPan += Math.abs(value658) + Math.abs(value659);
              let scale: Dynamic = value105.get().scale,
                value660: Dynamic = current4.pinch
                  ? Math.log(
                      Math.max(
                        runtime.viewportScaleLimits.minScale,
                        Math.min(
                          runtime.viewportScaleLimits.maxScale,
                          scale * Math.exp(current4.dz),
                        ),
                      ) / scale,
                    )
                  : 0,
                value661: Dynamic = Math.max(
                  0,
                  canvasZoomUsageWindow - current4.winZoom,
                ),
                value662: Dynamic = Math.max(
                  -value661,
                  Math.min(value661, value660),
                );
              current4.winZoom += Math.max(
                Math.abs(value662),
                current4.zoomMsgs * minimumCanvasZoomUsage,
              );
              let pinch: Dynamic = current4.pinch,
                px2: Dynamic = current4.px,
                py2: Dynamic = current4.py,
                value663: Dynamic = value106.current?.clientWidth ?? 0,
                value664: Dynamic = value106.current?.clientHeight ?? 0;
              current4.dx = 0;
              current4.dy = 0;
              current4.dz = 0;
              current4.zoomMsgs = 0;
              current4.pinch = false;
              value105.set((input2?: Dynamic): Dynamic => {
                let value665: Dynamic = input2;
                if (pinch && value662 !== 0) {
                  let value666: Dynamic = Math.max(
                      0,
                      Math.min(value663, (px2 - value665.x) * value665.scale),
                    ),
                    value667: Dynamic = Math.max(
                      0,
                      Math.min(value664, (py2 - value665.y) * value665.scale),
                    );
                  value665 = (0, runtime.zoomViewportAtPoint)(
                    value665,
                    value666,
                    value667,
                    Math.exp(value662),
                    runtime.viewportScaleLimits,
                  );
                }
                (value658 !== 0 || value659 !== 0) &&
                  (value665 = (0, runtime.panViewport)(
                    value665,
                    -value658,
                    -value659,
                  ));
                return value665;
              });
            }));
          return true;
        },
        [value67, value105],
      ),
      value228: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let value653: Dynamic = !options?.live,
            items: Dynamic = [...value138()],
            values: Dynamic = new Set(),
            value654: Dynamic = items.map(
              ([input2, input3]: Dynamic): Dynamic => {
                let entry: Dynamic = value177.current.get(input2),
                  value657: Dynamic = entry
                    ? entry.describeTids(input3.tids)
                    : [];
                for (let value658 of value657 as Dynamic)
                  values.add(value658.kind);
                return {
                  h: entry,
                  desc: value657,
                };
              },
            ),
            value655: Dynamic = values.size > 1,
            current4: Dynamic = value245.current,
            value656: Dynamic = value654.map(
              ({ h: h, desc: desc }: Dynamic): Dynamic =>
                h
                  ? h.setStylePropsPerTid(
                      (0, runtime.routeStyleEditsByElementKind)(
                        input,
                        desc,
                        value655,
                      ),
                      {
                        undo: value653,
                      },
                    )
                  : Promise.resolve(false),
            );
          return Promise.all(value656).then((input2?: Dynamic): Dynamic => {
            let value657: Dynamic = input2.some(Boolean);
            if (value657 && value653) {
              let value658: Dynamic = input.map(
                ([input3, input4]: Dynamic): Dynamic => ({
                  prop: input3,
                  value: input4 ?? null,
                }),
              );
              (0, runtime.announce)(
                (0, runtime.addContrastToAnnouncement)(
                  (0, runtime.propertyEditAnnouncement)(value658),
                  value658,
                  current4?.check,
                  current4?.resolve,
                ),
              );
            }
            return value657;
          });
        },
        [value138],
      ),
      value229: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value230: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          if (input === "start") {
            let value653: Dynamic = value138().map(
              ([input2]: Dynamic): Dynamic => input2,
            );
            value229.current = value653;
            for (let value654 of value653 as Dynamic)
              value177.current.get(value654)?.beginStyleGesture();
          } else {
            let value653: Dynamic = value229.current ?? [];
            value229.current = null;
            for (let value654 of value653 as Dynamic)
              value177.current.get(value654)?.endStyleGesture();
          }
        },
        [value138],
      ),
      value231: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let current4: Dynamic = focusedFileRef.current;
          current4 && value177.current.get(current4)?.formatCommand(input);
        },
        [],
      ),
      [value232, value233]: Dynamic = (0, runtime.reactChromeTheme.useState)(0),
      value234: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Set()),
      [value235, value236]: Dynamic = (0, runtime.reactChromeTheme.useState)(0),
      [value237, value238]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        false,
      );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let value653: Dynamic = value121,
        value654: Dynamic =
          value653 == null ? undefined : value177.current.get(value653);
      if (!value654) {
        value238(false);
        return;
      }
      let flag2: Dynamic = false;
      value654.stageIsEmpty().then((input?: Dynamic): Dynamic => {
        flag2 || value238(input);
      });
      return (): Dynamic => {
        flag2 = true;
      };
    }, [value121, value232, value235, value182]);
    let value239: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          value234.current.add(input);
          value236((input2?: Dynamic): Dynamic => input2 + 1);
        },
        [],
      ),
      value240: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          value239(input);
          value22.current.set(input, (value22.current.get(input) ?? 0) + 1);
          let current4: Dynamic = selectionRef.current,
            { next: value653, tell: value654 }: Dynamic = (0,
            runtime.reconcileSelectedElementIds)(
              current4,
              input,
              options,
              focusedFileRef.current,
            );
          selectionRef.current = value653;
          value653 !== current4 &&
            (setSelection(value653),
            input === focusedFileRef.current &&
              !value653.elements.has(input) &&
              value24.current?.noteSelection(input, null));
          value654 != null &&
            context?.(
              value654,
              (input2?: Dynamic): Dynamic =>
                (window as Dynamic).setTimeout((): Dynamic => {
                  selectionRef.current.elements.get(input)?.tids === value654 &&
                    input2() &&
                    applyCanvasSelection(selectionRef.current, {
                      repush: [input],
                    });
                }, 60),
            );
        },
        [value239, applyCanvasSelection],
      ),
      value241: Dynamic = (0, runtime.useDesignSystems)(),
      value242: Dynamic = (0, runtime.reactChromeTheme.useRef)([]),
      value243: Dynamic = (0, runtime.useElementSessionState)(
        selection.primary ?? null,
      ),
      value244: Dynamic = (0, runtime.reactChromeTheme.useMemo)((): Dynamic => {
        if (selection.elements.size === 0) return null;
        let index: Dynamic = 0,
          index2: Dynamic = 0,
          index3: Dynamic = 0,
          index4: Dynamic = 0,
          index5: Dynamic = 0,
          index6: Dynamic = 0,
          state: Dynamic = {},
          text: Dynamic = "",
          value653: Dynamic = null,
          value654: Dynamic = null,
          items: Dynamic = [],
          text2: Dynamic = "none",
          items2: Dynamic = [
            "font-weight",
            "font-style",
            "text-decoration-line",
            "text-align",
            "line-height",
            "letter-spacing",
            "border-style",
            "border-width",
            "border-top-width",
            "border-right-width",
            "border-bottom-width",
            "border-left-width",
            "border-color",
            "border-radius",
            "border-top-left-radius",
            "border-top-right-radius",
            "border-bottom-right-radius",
            "border-bottom-left-radius",
            "padding-top",
            "padding-right",
            "padding-bottom",
            "padding-left",
            "margin-top",
            "margin-right",
            "margin-bottom",
            "margin-left",
            "stroke-width",
            "stroke-dasharray",
            "fill",
            "background-color",
            "background",
            ...runtime.InspectorPropertySchemaItems,
          ],
          value655: Dynamic = null,
          flag2: Dynamic = false,
          value656: Dynamic = null,
          value657: Dynamic = null,
          value658: Dynamic = null,
          value659: Dynamic = null,
          value660: Dynamic = null,
          value661: Dynamic = null,
          items3: Dynamic = [];
        for (let [value664, value665] of selection.elements as Dynamic) {
          let entry: Dynamic = value177.current.get(value664),
            value666: Dynamic = entry?.describeTids(value665.tids) ?? [],
            value667: Dynamic = value664 === selection.primary,
            value668: Dynamic = value19(value664);
          for (let value669 of value666 as Dynamic) {
            if (
              value667 &&
              value656 == null &&
              ((value656 = {
                file: value664,
                tid: value669.tid,
                kind: value669.kind,
              }),
              (text = value669.tag),
              entry)
            ) {
              for (let value670 of items2 as Dynamic) {
                let value671: Dynamic = entry.readInlineStyle(
                  value668,
                  value669.tid,
                  value670,
                );
                value671 && (state[value670] = value671);
              }
              value669.kind === "image" &&
                (value653 =
                  entry.readAttrs(value668, value669.tid)?.src ?? null);
              value669.tag === "a" &&
                (value654 =
                  entry.readAttrs(value668, value669.tid)?.href ?? null);
              text2 = entry.listKindOf(value669.tid);
            }
            value669.kind === "box"
              ? index3++
              : value669.kind === "image"
                ? index4++
                : value669.kind === "other" && index5++;
            value669.kind === "text" &&
              (index++,
              entry &&
                items.length < 64 &&
                items.push(
                  entry.readInlineStyle(value668, value669.tid, "font-size") ||
                    null,
                ),
              value667 &&
                value655 == null &&
                ((value655 = {
                  file: value664,
                  tid: value669.tid,
                }),
                (flag2 = value669.editable)),
              value667 &&
                entry &&
                value657 == null &&
                value658 == null &&
                ((value657 =
                  entry.readInlineStyle(value668, value669.tid, "color") ||
                  null),
                (value658 =
                  entry.readInlineStyle(value668, value669.tid, "font-size") ||
                  null),
                (value659 =
                  entry.readInlineStyle(
                    value668,
                    value669.tid,
                    "font-family",
                  ) || null)),
              value667 &&
                entry &&
                value660 == null &&
                (value660 =
                  entry.readInlineStyle(
                    value668,
                    value669.tid,
                    "background-color",
                  ) || null));
            if (value669.kind === "shape" || value669.kind === "box") {
              value669.kind === "shape" && index2++;
              let callback17: Dynamic = (input?: Dynamic): Dynamic =>
                  input && input !== "none" ? input : null,
                value670: Dynamic =
                  value667 && entry
                    ? entry.readAttrs(value668, value669.tid)
                    : null;
              value667 &&
                entry &&
                value660 == null &&
                (value660 =
                  callback17(
                    entry.readInlineStyle(
                      value668,
                      value669.tid,
                      "background-color",
                    ),
                  ) ||
                  callback17(
                    entry.readInlineStyle(value668, value669.tid, "fill"),
                  ) ||
                  callback17(value670?.fill) ||
                  null);
              value667 &&
                entry &&
                value661 == null &&
                (value661 =
                  callback17(
                    entry.readInlineStyle(value668, value669.tid, "stroke"),
                  ) ||
                  callback17(
                    entry.readInlineStyle(
                      value668,
                      value669.tid,
                      "border-color",
                    ),
                  ) ||
                  callback17(value670?.stroke) ||
                  null);
            } else
              value669.kind === "line" &&
                (index6++,
                value667 &&
                  entry &&
                  value661 == null &&
                  (value661 =
                    entry.readInlineStyle(value668, value669.tid, "stroke") ||
                    entry.readInlineStyle(
                      value668,
                      value669.tid,
                      "border-color",
                    ) ||
                    null));
          }
          value667 && entry && (items3 = entry.pageFonts());
        }
        let entries: Dynamic = new Map(),
          callback15: Dynamic = (input?: Dynamic): Dynamic => {
            let value664: Dynamic = input.toLowerCase();
            entries.has(value664) || entries.set(value664, input);
          };
        for (let value664 of items3 as Dynamic) callback15(value664);
        let values: Dynamic = new Set(),
          values2: Dynamic = new Set(),
          entries2: Dynamic = new Map(),
          entries3: Dynamic = new Map(),
          state2: Dynamic = {},
          state3: Dynamic = {};
        for (let [value664, value665] of value177.current as Dynamic) {
          let value666: Dynamic = value665.pageCensus();
          for (let value667 of value666.fonts as Dynamic) callback15(value667);
          for (let value667 of value666.webfonts as Dynamic)
            values2.add(value667);
          for (let value667 of value666.sizes as Dynamic) values.add(value667);
          for (let [value667, value668] of value666.colors as Dynamic)
            entries2.set(value667, (entries2.get(value667) ?? 0) + value668);
          if (selection.elements.has(value664))
            for (let [value667, value668] of value666.colors as Dynamic)
              entries3.set(value667, (entries3.get(value667) ?? 0) + value668);
          for (let [value667, value668] of value666.roles as Dynamic)
            for (let [value669, value670] of value668 as Dynamic)
              (state2[value667] ??= {})[value669] =
                (state2[value667]?.[value669] ?? 0) + value670;
          for (let [value667, value668] of value666.families as Dynamic)
            state3[value667] ??= value668;
        }
        let callback16: Dynamic = (
            input?: Dynamic,
            options?: Dynamic,
          ): Dynamic =>
            [...input]
              .sort(
                (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                  options2[1] - input2[1],
              )
              .slice(0, options)
              .map(([input2]: Dynamic): Dynamic => input2),
          value662: Dynamic = callback16(entries2, 12),
          value663: Dynamic = callback16(
            entries3,
            canvasSelectionChromeInsetPixels,
          );
        value663.join(`
`) !==
          value242.current.join(`
`) && (value242.current = value663);
        let values3: Dynamic = new Set(entries.values());
        return {
          text: index,
          shape: index2,
          box: index3,
          image: index4,
          other: index5,
          line: index6,
          primaryTag: text,
          primaryText: value655,
          primaryEditable: flag2,
          probeEl: value655
            ? {
                ...value655,
                kind: "text",
              }
            : value656,
          seed: {
            epoch: value232,
            color: value657,
            fontSize: value658,
            fontFamily: value659,
            background: value660,
            stroke: value661,
            more: state,
            imageSrc: value653,
            href: value654,
            list: text2,
            fontSizes: items,
            fonts: [...values3],
            webfonts: [...values2],
            sizes: [...values],
            sizeRoles: state2,
            sizeFamilies: state3,
            colors: value662,
            artboardColors: value242.current,
          },
        };
      }, [selection, value232, value241]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let value653: Dynamic = value244?.seed;
      value653 &&
        (0, runtime.updateTypographyCensus)({
          sizes: value653.sizes,
          sizeRoles: value653.sizeRoles ?? {},
          sizeFamilies: value653.sizeFamilies ?? {},
        });
    }, [value244]);
    let value245: Dynamic = (0, runtime.reactChromeTheme.useRef)(undefined),
      [value246, value247]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        null,
      ),
      value248: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value249: Dynamic = value244?.probeEl?.file ?? null,
      value250: Dynamic =
        value244 &&
        [...selection.elements.values()].reduce(
          (input?: Dynamic, options?: Dynamic): Dynamic =>
            input + options.count,
          0,
        ) === 1
          ? (value244.probeEl?.tid ?? null)
          : null;
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      if (value249 !== null) {
        (0, runtime.updateElementSessionState)(value249, {
          selected: value250,
        });
        return (): Dynamic =>
          (0, runtime.updateElementSessionState)(value249, {
            selected: null,
          });
      }
    }, [value249, value250]);
    let [value251, value252]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        null,
      ),
      [value253, value254]: Dynamic = (0, runtime.reactChromeTheme.useState)(0);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let value653: Dynamic = value244?.probeEl;
      if (!value653) return;
      let { file: value654, tid: value655, kind: value656 }: Dynamic = value653,
        entry: Dynamic = value177.current.get(value654),
        value657: Dynamic = entry
          ? (0, runtime.createPreviewHandle)(entry.webviewRef.current)
          : null;
      if (!value657) return;
      let value658: Dynamic = value654 + ":" + String(value655),
        value659: Dynamic = value248.current === value658;
      value248.current = value658;
      let flag2: Dynamic = true,
        value660: Dynamic = value656 === "text";
      (0, runtime.inspectPickerSelection)(
        value657,
        value655,
        value19(value654),
        runtime.InspectorComputedDataItems,
        {
          afterPaint: value659,
          srgb: true,
          ground: value660,
        },
      ).then((input?: Dynamic): Dynamic => {
        flag2 &&
          value247({
            key: value658,
            ...(0, runtime.normalizeInspectorComputedData)(value656, input, {
              ground: value660,
            }),
          });
      });
      return (): Dynamic => {
        flag2 = false;
      };
    }, [value244]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let value653: Dynamic = value244?.probeEl;
      if (!value653 || value653.kind !== "text") return;
      let entry: Dynamic = value177.current.get(value653.file),
        value654: Dynamic = entry
          ? (0, runtime.createPreviewHandle)(entry.webviewRef.current)
          : null;
      if (!value654) return;
      let value655: Dynamic = value653.file + ":" + String(value653.tid),
        flag2: Dynamic = true;
      (0, runtime.getPickerFontFaces)(value654).then(
        (input?: Dynamic): Dynamic => {
          if (!flag2 || !input) return;
          let value656: Dynamic =
            value655 +
            `
` +
            input.map(
              (input2?: Dynamic): Dynamic =>
                input2.family + "|" + input2.weight + "|" + input2.style,
            ).join(`
`);
          value252(
            (input2?: Dynamic): Dynamic =>
              input2 !== null && input2.sig === value656
                ? input2
                : {
                    key: value655,
                    sig: value656,
                    faces: input,
                  },
          );
        },
      );
      return (): Dynamic => {
        flag2 = false;
      };
    }, [value244, value253]);
    let value255: Dynamic =
        value244?.probeEl &&
        value246?.key ===
          value244.probeEl.file + ":" + String(value244.probeEl.tid)
          ? value246
          : null,
      value256: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic => [
          ...new Set(
            value241.flatMap(
              (input?: Dynamic): Dynamic =>
                input.colors.map(
                  (input2?: Dynamic): Dynamic => "--" + input2.name,
                ),
            ),
          ),
        ],
        [value241],
      ),
      [value257, value258]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        (): Dynamic => new Map(),
      ),
      value259: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          value258((input2?: Dynamic): Dynamic => {
            if (input2.get(input) === options) return input2;
            let entries: Dynamic = new Map(input2);
            options === undefined
              ? entries.delete(input)
              : entries.set(input, options);
            return entries;
          });
        },
        [],
      ),
      [value260, value261]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        (): Dynamic => new Map(),
      ),
      value262: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic =>
          value261(
            (input2?: Dynamic): Dynamic =>
              (0, runtime.updateArtboardErrorMap)(input2, input, options),
          ),
        [],
      ),
      [value263, value264]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        false,
      ),
      value265: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (): Dynamic => value264(true),
        [],
      ),
      value266: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic =>
          value86.artboards.flatMap((input?: Dynamic): Dynamic => {
            let entry: Dynamic = value260.get(input.file);
            return entry
              ? [
                  {
                    file: input.file,
                    path: input.file,
                    title: input.title ?? input.file.replace(/\.dc\.html$/, ""),
                    messages: entry,
                  },
                ]
              : [];
          }),
        [value86, value260],
      ),
      value267: Dynamic = value266.length > 0;
    (0, runtime.useArtboardErrorReporting)(value267);
    let value268: Dynamic = (0, runtime.useArtboardErrorNotices)(
      value260,
      value266,
      {
        canvasTitle: (document as Dynamic).title,
        canAsk: editable && (0, runtime.embedMemoryPrefix)() === "",
        large: value99,
        onShowAll: value265,
      },
    );
    !value267 && value263 && value264(false);
    (0, runtime.reactChromeTheme.useLayoutEffect)((): Dynamic => {
      focusedFileRef.current = value121;
      value25.current = null;
      value26.current = null;
      value27.current = null;
      let current4: Dynamic = value216.current;
      current4 &&
        current4.file !== value121 &&
        (value177.current.get(current4.file)?.hostDrag("cancel", current4.key),
        (value216.current = null),
        value193.current || value200(null));
      value193.current &&
        value193.current.file !== value121 &&
        value20.current?.();
    }, [value121]);
    let [value269, value270]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        null,
      ),
      value271: Dynamic = (0, runtime.reactChromeTheme.useRef)(null);
    value271.current = value269;
    let value272: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      value273: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          (input === value271.current ||
            (value99 && !flag && !value345.current)) &&
            value270(null);
          value124(
            (input2?: Dynamic): Dynamic => (input2 === input ? input2 : null),
          );
          if (input === value121) return Promise.resolve(true);
          let current4: Dynamic = value272.current;
          return (async (): Promise<Dynamic> => (
            await value.current?.("preview"),
            current4 !== value272.current ? false : (value122(input), true)
          ))();
        },
        [value121],
      ),
      value274: Dynamic = (0, runtime.reactChromeTheme.useRef)(value273);
    value274.current = value273;
    let value275: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
      (input?: Dynamic): Dynamic => {
        (async (): Promise<Dynamic> => {
          try {
            await value.current?.("preview");
          } catch {}
          input();
        })();
      },
      [],
    );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value121 != null &&
        value73.current.artboards.some(
          (input?: Dynamic): Dynamic =>
            input.file === value121 && !input.frameless,
        ) &&
        (value126.current = value121);
    }, [value121]);
    let value276: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value277: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {
        let current4: Dynamic = value125.current;
        if (current4 == null) return;
        value124(null);
        let current5: Dynamic = value126.current,
          current6: Dynamic = value276.current;
        if (
          current5 == null ||
          current5 === current4 ||
          !value87.current.artboards.some(
            (input?: Dynamic): Dynamic => input.file === current5,
          )
        )
          return;
        let entry: Dynamic = value153.current.get(current5);
        (current6 &&
          current6.file === current5 &&
          Date.now() - current6.at < 5e3) ||
        (entry != null && Date.now() - entry < 5e3) ||
        current5 === value271.current
          ? value122(null)
          : value274.current(current5);
      }, []),
      value278: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {
        abandonSelectionGesture();
        value277();
        value62();
        setSelection(runtime.emptyCanvasSelection);
      }, [abandonSelectionGesture, value277, value62]),
      value279: Dynamic = (0, runtime.reactChromeTheme.useRef)(value277);
    value279.current = value277;
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value123 != null &&
        !value86.artboards.some(
          (input?: Dynamic): Dynamic => input.file === value123,
        ) &&
        value124(null);
    }, [value123, value86]);
    let [value280, value281]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        false,
      ),
      value282: Dynamic = null,
      [value283, value284]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        false,
      ),
      value285: Dynamic = (0, runtime.reactChromeTheme.useRef)(false);
    value285.current = value283;
    (0, runtime.reactChromeTheme.useLayoutEffect)(
      (): Dynamic => (): Dynamic => {},
      [value283],
    );
    let value286: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value287: Dynamic = (0, runtime.reactChromeTheme.useRef)(undefined),
      value288: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          value286.current = input;
          let current4: Dynamic = value287.current;
          typeof current4 == "function"
            ? current4(input)
            : current4 && (current4.current = input);
        },
        [],
      ),
      [value289, value290]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        false,
      ),
      value291: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      value292: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => false,
      ),
      value293: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value294: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      value295: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => {},
      ),
      value296: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      value297: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => {},
      ),
      value298: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          if (input === value80.current) return;
          abandonSelectionGesture();
          value124(null);
          value551.current = 0;
          value272.current++;
          let current4: Dynamic = value73.current,
            callback15: Dynamic = (input2?: Dynamic): Dynamic =>
              (0, runtime.designPageId)(input2, current4.pages) === input,
            value653: Dynamic = current4.artboards.find(
              (input2?: Dynamic): Dynamic =>
                callback15(input2) && !input2.frameless,
            ),
            value654: Dynamic = value345.current
              ? ((options === undefined
                  ? undefined
                  : current4.artboards.find(
                      (input2?: Dynamic): Dynamic =>
                        input2.file === options && callback15(input2),
                    )) ?? (0, runtime.defaultPageArtboard)(current4, input))
              : undefined;
          value345.current &&
            (value654
              ? value348({
                  file: value654.file,
                  prev:
                    (0, runtime.recallCanvasView)(input) ?? defaultCanvasCamera,
                  fit: artboardIsNotExpandedFill(value654),
                })
              : value297.current());
          value62();
          setSelection(runtime.emptyCanvasSelection);
          value270(null);
          value76(input);
          value122(
            options ??
              (value99 && editableRef.current && !value345.current
                ? null
                : ((value654 ?? value653)?.file ?? null)),
          );
          value291.current = !(value345.current && value654);
        },
        [value62, abandonSelectionGesture],
      ),
      value299: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {}, [
        value62,
        abandonSelectionGesture,
      ]),
      value300: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {
        abandonSelectionGesture();
        value62();
        setSelection(runtime.emptyCanvasSelection);
        value124(null);
        value275((): Dynamic => value284(true));
      }, [value275, value62, abandonSelectionGesture]),
      value301: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {
        value284(false);
        requestAnimationFrame((): Dynamic => {
          ((document as Dynamic).activeElement === (document as Dynamic).body ||
            (document as Dynamic).activeElement === null) &&
            value286.current?.focus({
              preventScroll: true,
            });
        });
      }, []),
      value302: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          value301();
          let current4: Dynamic = value73.current,
            value653: Dynamic = current4.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input,
            );
          if (!value653) return;
          let value654: Dynamic = (0, runtime.designPageId)(
            value653,
            current4.pages,
          );
          value654 !== value80.current
            ? value275((): Dynamic => value298(value654, value653.file))
            : value299();
        },
        [value275, value298, value299, value301],
      );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      if (!value283) return;
      let callback15: Dynamic = (event?: Dynamic): Dynamic => {
        event.key !== "Escape" ||
          event.defaultPrevented ||
          (0, runtime.hasBlockingEditorOverlay)() ||
          (event.preventDefault(), value301());
      };
      (window as Dynamic).addEventListener("keydown", callback15);
      return (): Dynamic =>
        (window as Dynamic).removeEventListener("keydown", callback15);
    }, [value283, value301]);
    let value303: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      value304: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => "",
      );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value303.current &&
        ((value303.current = false),
        value304.current(undefined, undefined, {
          auto: true,
        }));
      if (!value291.current) return;
      value291.current = false;
      let value653: Dynamic = (window as Dynamic).setTimeout(
        (): Dynamic => value292.current(),
        120,
      );
      return (): Dynamic => (window as Dynamic).clearTimeout(value653);
    }, [value79]);
    let value305: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {
        let current4: Dynamic = value73.current,
          value653: Dynamic =
            current4.pages !== undefined && current4.pages.length > 0,
          value654: Dynamic = value653
            ? [...current4.pages]
            : [runtime.defaultCanvasPage];
        if (value654.length >= runtime.PlatformFileContentLimit_3) {
          showToast(
            "This canvas is at its page limit (" +
              String(runtime.PlatformFileContentLimit_3) +
              ").",
          );
          return;
        }
        let state: Dynamic = {
          id: (0, runtime.createPageId)(value654, supportsLoadState),
          name: (0, runtime.nextCanvasPageName)(value654),
        };
        value396.current(
          {
            kind: "page-add",
            page: state,
            ...(value653
              ? {}
              : {
                  first: value654[0],
                }),
          },
          new Set(),
        );
        value98({
          ...current4,
          pages: [...value654, state],
        });
        value303.current = true;
        value298(state.id);
      }, [value98, value298, showToast]),
      value306: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async (input?: Dynamic): Promise<Dynamic> => {
          let pages: Dynamic = value73.current.pages,
            value653: Dynamic =
              input === "" && (pages === undefined || pages.length === 0)
                ? runtime.defaultCanvasPage
                : pages?.find(
                    (input2?: Dynamic): Dynamic => input2.id === input,
                  );
          if (!value653) return;
          let value654: Dynamic = await (0, runtime.promptCanvasValue)({
            title: "Rename page",
            initialValue: value653.name,
            inputLabel: "Page name",
            confirmLabel: "Rename",
            maxLength: 120,
          });
          (0, runtime.clearEscapeReleaseSuppression)();
          value286.current?.focus({
            preventScroll: true,
          });
          let value655: Dynamic =
            value654 === null
              ? undefined
              : (0, runtime.PlatformFileContentSlice)(value654);
          if (value655 === undefined || value655 === value653.name) return;
          let current4: Dynamic = value73.current,
            value656: Dynamic =
              current4.pages !== undefined && current4.pages.length > 0,
            value657: Dynamic = value656 ? [...current4.pages] : [value653],
            value658: Dynamic = value657.find(
              (input2?: Dynamic): Dynamic => input2.id === value653.id,
            );
          if (!value658 || value658.name === value655) return;
          let value659: Dynamic = value657.map(
            (input2?: Dynamic): Dynamic =>
              input2.id === value653.id
                ? {
                    ...input2,
                    name: value655,
                  }
                : input2,
          );
          value396.current(
            {
              kind: "page-rename",
              id: value658.id,
              from: value658.name,
              to: value655,
              ...(value656
                ? {}
                : {
                    first: value658,
                  }),
            },
            new Set(),
          );
          value98({
            ...current4,
            pages: value659,
          });
        },
        [value98],
      );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value121 != null &&
        !value67.artboards.some(
          (input?: Dynamic): Dynamic => input.file === value121,
        ) &&
        value122(
          value99 && !flag && editableRef.current && !value345.current
            ? null
            : (value87.current.artboards.find(
                (input?: Dynamic): Dynamic => !input.frameless,
              )?.file ?? null),
        );
      for (let value653 of [value127, value584, value585] as Dynamic)
        for (let value654 of [...value653.current.keys()] as Dynamic)
          value67.artboards.some(
            (input?: Dynamic): Dynamic => input.file === value654,
          ) || value653.current.delete(value654);
      value129(
        (input?: Dynamic): Dynamic =>
          [...input].every(
            (input2?: Dynamic): Dynamic =>
              value67.artboards.some(
                (input3?: Dynamic): Dynamic => input3.file === input2,
              ),
          )
            ? input
            : new Set(
                [...input].filter(
                  (input2?: Dynamic): Dynamic =>
                    value67.artboards.some(
                      (input3?: Dynamic): Dynamic => input3.file === input2,
                    ),
                ),
              ),
      );
      setSelection(
        (input?: Dynamic): Dynamic =>
          (0, runtime.filterSelectedAnnotations)(
            (0, runtime.filterSelectedArtboards)(
              input,
              (input2?: Dynamic): Dynamic =>
                value67.artboards.some(
                  (input3?: Dynamic): Dynamic => input3.file === input2,
                ),
            ),
            (input2?: Dynamic): Dynamic =>
              (value67.annotations ?? []).some(
                (input3?: Dynamic): Dynamic => input3.id === input2,
              ),
          ),
      );
    }, [value67, value121]);
    let [value307, value308]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        null,
      ),
      value309: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (): Dynamic => value308(null),
        [],
      ),
      value310: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      [value311, value312]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        false,
      ),
      callback8: Dynamic = (): Dynamic => {
        value99 && !flag && value312(true);
      },
      value313: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          let files: Dynamic = doc.content().files,
            value653: Dynamic = (0, runtime.uniqueArtboardFile)(
              files,
              "Artboard",
              supportsLoadState,
            );
          input && (value310.current = true);
          (async (): Promise<Dynamic> => {
            try {
              let value654: Dynamic = options
                ? (0, runtime.insertBlankArtboardMarkup)(
                    (0, runtime.blankDcDocument)(),
                    options,
                  )
                : (0, runtime.blankDcDocument)();
              await (0, runtime.getKvClient)().set(
                (0, runtime.PlatformFileContentHandler_4)(value653),
                value654,
              );
              let value655: Dynamic = value90.current.filter(
                  (input2?: Dynamic): Dynamic => input2.file !== value653,
                ),
                value656: Dynamic =
                  input ?? nextArtboardPlacementPoint(value655),
                state: Dynamic = {
                  file: value653,
                  x: Math.round(value656.x),
                  y: Math.round(value656.y),
                  w:
                    input && input.w > 0
                      ? input.w
                      : runtime.PlatformFileContentConstant_5,
                  h:
                    input && input.h > 0
                      ? input.h
                      : runtime.PlatformFileContentConstant_6,
                  title:
                    context?.title ?? (0, runtime.nextArtboardTitle)(value655),
                  ...callback3(),
                };
              value396.current(
                {
                  kind: "add",
                  entries: [
                    {
                      file: value653,
                      src: value654,
                      spec: state,
                    },
                  ],
                },
                new Set([value653]),
                context?.siblings,
              );
              value98({
                artboards: [
                  ...value73.current.artboards.filter(
                    (input2?: Dynamic): Dynamic => input2.file !== value653,
                  ),
                  state,
                ],
              });
              context?.auto !== true &&
                (0, runtime.frameAnalyticsReporter)(
                  runtime.designAnalyticsEvents.artboardInserted,
                );
              value273(value653);
              value338("select");
              value341((input2?: Dynamic): Dynamic => input2 + 1);
              context?.doneSay && value189(context.doneSay);
            } catch (value654: Dynamic) {
              showToast(
                "Couldn't add an artboard: " + String(value654),
                "error",
              );
            }
          })();
          return value653;
        },
        [doc, value98, value273, showToast, value189],
      );
    value304.current = value313;
    let value314: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          abandonSelectionGesture();
          value279.current();
          let value653: Dynamic =
              options === "toggle"
                ? (0, runtime.toggleCanvasSelection)(
                    selectionRef.current,
                    input,
                  )
                : (0, runtime.selectionFromBoards)(input),
            current4: Dynamic = focusedFileRef.current;
          current4 != null &&
            selectionRef.current.elements.has(current4) &&
            !value653.elements.has(current4) &&
            value62();
          selectionRef.current = value653;
          setSelection(value653);
        },
        [value62, abandonSelectionGesture],
      ),
      value315: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options: Dynamic = {}): Dynamic => {
          let value653: Dynamic = value73.current.annotations ?? [];
          if (value653.length >= runtime.PlatformFileContentLimit_5) {
            value188(
              "This canvas is at its limit for notes and shapes (" +
                String(runtime.PlatformFileContentLimit_5) +
                ").",
            );
            options.quiet ||
              (value338("select"),
              value341((input2?: Dynamic): Dynamic => input2 + 1));
            options.bound !== undefined &&
              value140.current.get(options.bound)?.();
            return null;
          }
          let state: Dynamic = {
            ...input,
            id: (0, runtime.createAnnotationId)(
              value653,
              supportsLoadState,
              (0, runtime.annotationKindCategory)(input),
            ),
          };
          value396.current(
            {
              kind: "ann-add",
              spec: state,
            },
            new Set(),
            undefined,
            options.bound,
          );
          value98({
            ...value73.current,
            annotations: [...value653, state],
          });
          options.quiet ||
            (abandonSelectionGesture(),
            value62(),
            setSelection(
              options.keepTool
                ? runtime.emptyCanvasSelection
                : (0, runtime.selectionFromBoards)(
                    (0, runtime.boardSelectionItems)({
                      note: state.id,
                    }),
                  ),
            ),
            options.keepTool ||
              (value338("select"),
              value341((input2?: Dynamic): Dynamic => input2 + 1)));
          return state.id;
        },
        [value98, value62, value188, abandonSelectionGesture],
      ),
      value316: Dynamic = (0, runtime.reactChromeTheme.useRef)(value315);
    value316.current = value315;
    let value317: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          value315({
            x: Math.round(input),
            y: Math.round(options),
            w: runtime.PlatformFileContentConstant_8,
            text: "",
            ...callback3(),
          });
        },
        [value315],
      ),
      value318: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653?: Dynamic,
          extra: Dynamic = false,
        ): Dynamic => {
          let value654: Dynamic =
              extra && value653 !== undefined ? value653 : undefined,
            value655: Dynamic = (value73.current.annotations ?? []).find(
              (input2?: Dynamic): Dynamic => input2.id === input,
            );
          if (!value655) {
            value654 !== undefined &&
              value142.current.set(value654, {
                files: new Set(),
                notes: new Set(),
              });
            value653 !== undefined && value140.current.get(value653)?.();
            return false;
          }
          let { id: value656, ...value657 }: Dynamic = value655,
            [items, items2]: Dynamic = [
              Math.round(options),
              Math.round(context),
            ],
            value658: Dynamic =
              value657.kind === "line" || value657.kind === "arrow"
                ? value315(
                    {
                      ...value657,
                      x: items,
                      y: items2,
                      x2: value657.x2 + items - value657.x,
                      y2: value657.y2 + items2 - value657.y,
                    },
                    {
                      bound: value653,
                      quiet: value654 !== undefined,
                    },
                  )
                : value315(
                    {
                      ...value657,
                      x: items,
                      y: items2,
                    },
                    {
                      bound: value653,
                      quiet: value654 !== undefined,
                    },
                  );
          value654 !== undefined &&
            value142.current.set(value654, {
              files: new Set(),
              notes: new Set(value658 !== null ? [value658] : []),
            });
          return value658 !== null;
        },
        [value315],
      ),
      value319: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          value338("select");
          value341((input2?: Dynamic): Dynamic => input2 + 1);
          let value653: Dynamic = callback3();
          if (input === "text") {
            value315({
              kind: "title1",
              size: runtime.PlatformFileContentSMLConfig.m,
              bold: false,
              x: options.x,
              y: options.y,
              w: runtime.PlatformFileContentConstant_8,
              text: "",
              ...value653,
            });
            return;
          }
          if (input === "rect" || input === "oval") {
            let value654: Dynamic = options.w > 0 || options.h > 0,
              [value655, value656]: Dynamic = value654
                ? [options.w, options.h]
                : runtime.PlatformFileContentRectOvalLineConfig[input],
              callback15: Dynamic = (input2?: Dynamic): Dynamic =>
                Math.min(
                  runtime.PlatformFileContentLimit_6,
                  Math.max(runtime.PlatformFileContentConstant_19, input2),
                );
            value315({
              kind: input,
              x: options.x,
              y: options.y,
              w: callback15(value655),
              h: callback15(value656),
              ...value653,
            });
            return;
          }
          value315({
            kind: input,
            ...(0, runtime.annotationLineEndpoints)(input, options, context),
            ...value653,
          });
        },
        [value315],
      ),
      value320: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          value315(
            {
              kind: "pen",
              ...input,
              ...callback3(),
            },
            {
              keepTool: true,
            },
          );
        },
        [value315],
      ),
      value321: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let value653: Dynamic = value73.current.annotations ?? [],
            value654: Dynamic = value653.findIndex(
              (input2?: Dynamic): Dynamic => input2.id === input,
            );
          if (value654 < 0) return false;
          value396.current(
            {
              kind: "ann-delete",
              spec: value653[value654],
              index: value654,
            },
            new Set(),
            undefined,
            options,
          );
          value98({
            ...value73.current,
            annotations: value653.filter(
              (input2?: Dynamic): Dynamic => input2.id !== input,
            ),
          });
          let value655: Dynamic = value653[value654];
          (0, runtime.announce)(
            value655.kind === "image"
              ? value655.video !== undefined
                ? runtime.AccessibilityAnnouncementsLabel_21
                : runtime.AccessibilityAnnouncementsLabel_20
              : (0, runtime.isShapeAnnotation)(value655)
                ? runtime.AccessibilityAnnouncementsLabel_19
                : runtime.AccessibilityAnnouncementsLabel_18,
          );
          return true;
        },
        [value98],
      );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let callback15: Dynamic = (): Dynamic => {
          let current4: Dynamic = selectionRef.current;
          !value224.current ||
            value218.current ||
            (0, runtime.hasBlockingEditorOverlay)() ||
            (0, runtime.isEmptyCanvasSelection)(current4) ||
            (current4.elements.size > 0
              ? value147.current(runtime.DeletedValue)
              : value459.current((0, runtime.canvasBoardSelection)(current4)));
        },
        callback16: Dynamic = (event?: Dynamic): Dynamic => {
          if (event.defaultPrevented || !value224.current || value345.current)
            return;
          let current4: Dynamic = selectionRef.current,
            value653: Dynamic =
              event.key === "Escape" &&
              (0, runtime.isEmptyCanvasSelection)(current4) &&
              value125.current != null,
            value654: Dynamic =
              focusedFileRef.current != null &&
              current4.elements.has(focusedFileRef.current),
            value655: Dynamic = event.metaKey || event.ctrlKey,
            value656: Dynamic =
              (event.key === "Delete" || event.key === "Backspace") &&
              !value655,
            value657: Dynamic =
              value656 && value32.current?.gen === selectionEpochRef.current
                ? value32.current
                : null,
            value658: Dynamic =
              value657 != null ||
              (value656 &&
                value654 &&
                pendingFrameSelectionRef.current != null &&
                pendingFrameSelectionRef.current.file ===
                  focusedFileRef.current),
            value659: Dynamic =
              event.target instanceof Element
                ? event.target.closest("[data-mega-title-text]")
                : null,
            value660: Dynamic =
              value659
                ?.closest("[data-mega-artboard]")
                ?.getAttribute("data-mega-artboard") ?? null,
            value661: Dynamic =
              value659 != null &&
              value659.closest("[data-mega-inside]") == null &&
              value660 != null &&
              (current4.artboards.has(value660) ||
                current4.elements.has(value660)),
            value662: Dynamic =
              current4.artboards.size +
                current4.notes.size +
                current4.elements.size >
              1,
            value663: Dynamic =
              value661 &&
              event.key === "Enter" &&
              !value655 &&
              !event.altKey &&
              !(0, runtime.hasBlockingEditorOverlay)() &&
              !value218.current &&
              (event.shiftKey ? current4.elements.size > 0 : value662),
            value664: Dynamic =
              value655 || event.altKey
                ? null
                : (0, runtime.keyboardNudgeDelta)(event.key, event.shiftKey),
            value665: Dynamic = value664 != null && value159.current,
            callback17: Dynamic = (input?: Dynamic): Dynamic =>
              input instanceof Element &&
              ((0, runtime.isEditingInputTarget)(input) ||
                input.closest(
                  "[data-mega-chrome],[data-mega-title-text],[data-mega-piece],button,[role=button],a[href],input,textarea,select",
                ) != null),
            callback18: Dynamic = (input?: Dynamic): Dynamic =>
              input instanceof Element
                ? (0, runtime.isEditingInputTarget)(input) ||
                  (0, runtime.isInteractivePreviewTarget)(input) ||
                  input.closest(
                    '[data-mega-inside],[data-mega-selection-strip],[aria-haspopup="menu"],[aria-haspopup="listbox"],input,textarea,select',
                  ) != null
                  ? true
                  : value659 != null
                    ? !value661
                    : input.closest("[data-mega-chrome]") != null
                : false;
          if (
            value655 &&
            !event.shiftKey &&
            !event.altKey &&
            event.key.toLowerCase() === "a"
          ) {
            if (
              value654 ||
              callback18(event.target) ||
              (0, runtime.hasBlockingEditorOverlay)() ||
              value218.current
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            value56.current({
              kind: "all",
            });
            return;
          }
          let value666: Dynamic =
            value655 || event.altKey || !event.shiftKey
              ? null
              : event.key.toLowerCase() === "h"
                ? "horizontal"
                : event.key.toLowerCase() === "v"
                  ? "vertical"
                  : null;
          if (
            value666 !== null &&
            !value654 &&
            !(0, runtime.isEmptyCanvasSelection)(current4)
          ) {
            if (
              event.repeat ||
              (0, runtime.isEditingInputTarget)(event.target) ||
              (0, runtime.hasBlockingEditorOverlay)() ||
              (event.target instanceof Element &&
                event.target.closest('[data-mega-chrome="selection-menu"]'))
            )
              return;
            if (
              event.target instanceof Element &&
              (event.target.hasAttribute("data-mega-title-text") ||
                event.target.hasAttribute("data-mega-piece"))
            ) {
              let value673: Dynamic = event.target
                .closest("[data-mega-artboard]")
                ?.getAttribute("data-mega-artboard");
              if (
                value673 != null &&
                !current4.artboards.has(value673) &&
                !current4.elements.has(value673)
              ) {
                event.preventDefault();
                (0, runtime.announce)(
                  (0, runtime.artboardNotSelectedAnnouncement)(
                    value73.current.artboards.find(
                      (input?: Dynamic): Dynamic => input.file === value673,
                    )?.title ?? value673.replace(/\.dc\.html$/, ""),
                  ),
                );
                return;
              }
            }
            if (!value152.current(value666)) return;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          let value667: Dynamic =
              event.target instanceof Element ? event.target : null,
            value668: Dynamic =
              value667?.closest("[data-mega-inside]") != null
                ? null
                : (value667
                    ?.closest("[data-mega-title-text],[data-mega-piece]")
                    ?.closest("[data-mega-artboard]")
                    ?.getAttribute("data-mega-artboard") ?? null);
          if (
            (0, runtime.isContextMenuShortcut)(event) &&
            !value655 &&
            !event.altKey &&
            (value668 != null ||
              (current4.elements.size === 0 &&
                current4.artboards.size + current4.notes.size > 0))
          ) {
            if (
              (value668 == null &&
                ((0, runtime.isEditingInputTarget)(value667) ||
                  value667?.closest(
                    "button,[role=button],[role=treeitem],[role=textbox],[data-mega-selection-strip],.tb-root",
                  ) != null)) ||
              (0, runtime.hasBlockingEditorOverlay)() ||
              value218.current
            )
              return;
            let value673: Dynamic = value668 ?? [...current4.artboards][0],
              value674: Dynamic = [...current4.notes][0] ?? "",
              current5: Dynamic = value106.current,
              value675: Dynamic = current5?.querySelector(
                value673 !== undefined
                  ? `[data-mega-artboard="${CSS.escape(value673)}"] :is([data-mega-chrome="title"], [data-mega-piece])`
                  : `[data-mega-annotation="${CSS.escape(value674)}"]`,
              );
            if (
              current5 == null ||
              value675 == null ||
              (event.preventDefault(),
              event.stopPropagation(),
              (0, runtime.suppressNativeContextMenu)(false),
              event.repeat)
            )
              return;
            let [items, items2]: Dynamic = [
                value675.getBoundingClientRect(),
                current5.getBoundingClientRect(),
              ],
              callback19: Dynamic = (
                input?: Dynamic,
                options?: Dynamic,
                context?: Dynamic,
              ): Dynamic => Math.min(Math.max(input, options + 8), context - 8),
              value676: Dynamic =
                value673 !== undefined
                  ? {
                      x: items.left,
                      y: items.bottom,
                    }
                  : {
                      x: items.left + Math.min(40, items.width / 2),
                      y: items.top + Math.min(24, items.height / 2),
                    };
            value295.current(
              value673 !== undefined
                ? {
                    kind: "artboard",
                    file: value673,
                  }
                : {
                    kind: "object",
                    id: value674,
                  },
              {
                x: callback19(value676.x, items2.left, items2.right),
                y: callback19(value676.y, items2.top, items2.bottom),
                keyboard: true,
              },
            );
            return;
          }
          if (
            ((0, runtime.isEmptyCanvasSelection)(current4) || value654) &&
            !value658 &&
            !value653 &&
            !value663 &&
            !value665
          )
            return;
          if (event.key === "Enter" && !value655 && !event.altKey) {
            if (
              !(
                event.target == null ||
                event.target === (document as Dynamic).body ||
                event.target === (document as Dynamic).documentElement ||
                (0, runtime.isCanvasEnterAction)(event) ||
                value663
              ) ||
              (0, runtime.hasBlockingEditorOverlay)() ||
              value218.current
            )
              return;
            if (event.shiftKey) {
              if (current4.elements.size === 0) return;
              event.preventDefault();
              event.stopPropagation();
              value56.current({
                kind: "parent",
              });
              return;
            }
            if (
              current4.notes.size === 0 &&
              current4.elements.size === 0 &&
              current4.artboards.size === 1
            ) {
              let [artboards]: Dynamic = current4.artboards;
              if (
                artboards == null ||
                value73.current.artboards.find(
                  (input?: Dynamic): Dynamic => input.file === artboards,
                )?.frameless
              )
                return;
              event.preventDefault();
              artboards !== focusedFileRef.current &&
                (0, runtime.isCanvasEnterAction)(event) &&
                (value552.refocusAt = Date.now());
              value42.current(artboards);
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            value56.current({
              kind: "enter",
            });
            return;
          }
          if (event.key === "Tab" && !value655 && !event.altKey) {
            if (
              current4.elements.size === 0 ||
              callback17(event.target) ||
              (0, runtime.hasBlockingEditorOverlay)() ||
              value218.current ||
              (0, runtime.activeCropElement)() !== null ||
              (event.target != null &&
                event.target !== (document as Dynamic).body &&
                event.target !== (document as Dynamic).documentElement)
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            value56.current({
              kind: event.shiftKey ? "prev" : "next",
            });
            return;
          }
          if (value664) {
            if (
              callback18(event.target) ||
              (0, runtime.hasBlockingEditorOverlay)() ||
              value218.current
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            value56.current({
              kind: "nudge",
              ...value664,
              repeat: event.repeat,
            });
            return;
          }
          let value669: Dynamic =
            event.metaKey || (event.ctrlKey && !event.altKey)
              ? null
              : event.key === "]"
                ? "front"
                : event.key === "["
                  ? "back"
                  : null;
          if (
            value669 !== null &&
            current4.artboards.size > 0 &&
            current4.elements.size === 0
          ) {
            let value673: Dynamic =
              event.target instanceof Element ? event.target : null;
            if (
              (0, runtime.isEditingInputTarget)(value673) ||
              value673?.closest(
                '[role=textbox],[role=searchbox],[role=combobox],[data-mega-selection-strip],[data-mega-chrome="selection-menu"]',
              ) != null
            )
              return;
            let value674: Dynamic = value673
              ?.closest("[data-mega-title-text],[data-mega-piece]")
              ?.closest("[data-mega-artboard]")
              ?.getAttribute("data-mega-artboard");
            if (
              (value674 != null && !current4.artboards.has(value674)) ||
              (0, runtime.hasBlockingEditorOverlay)() ||
              !(0, runtime.sessionAllowsMutation)({
                gesturing: value218.current,
                setMoveCommits: value155.current,
              }) ||
              (event.preventDefault(), event.stopPropagation(), event.repeat)
            )
              return;
            value52.current((): Dynamic => {
              let current5: Dynamic = selectionRef.current;
              !value224.current ||
                (0, runtime.hasBlockingEditorOverlay)() ||
                current5.artboards.size === 0 ||
                current5.elements.size > 0 ||
                !(0, runtime.sessionAllowsMutation)({
                  gesturing: value218.current,
                  setMoveCommits: value155.current,
                }) ||
                value404.current(current5.artboards, value669);
            });
            return;
          }
          if (
            event.key !== "Delete" &&
            event.key !== "Backspace" &&
            event.key !== "Escape"
          )
            return;
          let target: Dynamic = event.target,
            value670: Dynamic =
              target instanceof HTMLElement &&
              (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
                target.isContentEditable),
            value671: Dynamic =
              target instanceof Element &&
              target.closest(
                "[data-tweak-popup],[data-popover-primitive]," +
                  runtime.blockingOverlaySelector,
              ) != null;
          if (
            (0, runtime.isEditingInputTarget)(target) &&
            !(
              event.key === "Escape" &&
              (0, runtime.isPropertyEditorTarget)(target) &&
              !value670 &&
              !value671
            )
          )
            return;
          if (event.key === "Escape") {
            if (
              value339.current !== "select" ||
              (value653 && (0, runtime.hasBlockingEditorOverlay)())
            )
              return;
            if (value61.current()) {
              event.preventDefault();
              return;
            }
            event.preventDefault();
            let callback19: Dynamic = (): Dynamic => {
              abandonSelectionGesture();
              value653
                ? value279.current()
                : value33.current(runtime.emptyCanvasSelection);
            };
            !value653 && value48.current > 0
              ? value52.current(callback19)
              : callback19();
            return;
          }
          if (
            (0, runtime.hasBlockingEditorOverlay)() ||
            (event.target instanceof Element &&
              event.target.closest('[data-mega-chrome="selection-menu"]'))
          )
            return;
          if (
            event.target instanceof Element &&
            (event.target.hasAttribute("data-mega-title-text") ||
              event.target.hasAttribute("data-mega-piece"))
          ) {
            let value673: Dynamic = event.target
              .closest("[data-mega-artboard]")
              ?.getAttribute("data-mega-artboard");
            if (value673 != null && !current4.artboards.has(value673)) {
              event.preventDefault();
              let value674: Dynamic = value73.current.artboards.find(
                (input?: Dynamic): Dynamic => input.file === value673,
              );
              (0, runtime.announce)(
                (0, runtime.artboardNotSelectedAnnouncement)(
                  value674?.title ?? value673.replace(/\.dc\.html$/, ""),
                ),
              );
              return;
            }
          }
          let value672: Dynamic = (0, runtime.focusedOutlineRow)(event.target);
          if (value672 != null) {
            event.preventDefault();
            (0, runtime.announce)(
              (0, runtime.selectionActionRefusalAnnouncement)(
                value672.name,
                "deleted",
                value672.onRow,
                value21.current(),
              ),
            );
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (value657 != null) {
            value657.over.then(
              (): Dynamic => {
                if (
                  value657.expired ||
                  value657.travelled ||
                  value218.current ||
                  !value224.current
                )
                  return;
                let value673: Dynamic = value657.answered
                    ? value657.after
                    : value657.kind !== "focus"
                      ? current4
                      : null,
                  current5: Dynamic = selectionRef.current;
                value673 == null ||
                  (0, runtime.isEmptyCanvasSelection)(current5) ||
                  !canvasSelectionsEqual(value673, current5) ||
                  value52.current(callback15);
              },
              (): Dynamic => {},
            );
            return;
          }
          value52.current(callback15);
        };
      (document as Dynamic).addEventListener("keydown", callback16, true);
      return (): Dynamic =>
        (document as Dynamic).removeEventListener("keydown", callback16, true);
    }, []);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let callback15: Dynamic = (event?: Dynamic): Dynamic => {
        if (
          event.defaultPrevented ||
          !(event.metaKey || event.ctrlKey) ||
          event.shiftKey ||
          event.altKey ||
          event.key.toLowerCase() !== "d" ||
          !value224.current ||
          value345.current
        )
          return;
        let current4: Dynamic = selectionRef.current,
          value653: Dynamic =
            (0, runtime.isEditingInputTarget)(event.target) ||
            (0, runtime.hasBlockingEditorOverlay)();
        if (
          !(
            focusedFileRef.current != null &&
            current4.elements.has(focusedFileRef.current) &&
            !value653
          )
        ) {
          if (value653) {
            (0, runtime.isDuplicateShortcut)(event) && event.preventDefault();
            return;
          }
          event.preventDefault();
          !(
            (0, runtime.isEmptyCanvasSelection)(current4) ||
            event.repeat ||
            value218.current
          ) &&
            (event.stopPropagation(),
            current4.elements.size > 0
              ? value158.current()
              : value52.current((): Dynamic => {
                  let current5: Dynamic = selectionRef.current;
                  !value224.current ||
                    value218.current ||
                    (0, runtime.hasBlockingEditorOverlay)() ||
                    (0, runtime.isEmptyCanvasSelection)(current5) ||
                    (current5.elements.size > 0
                      ? value158.current()
                      : value323.current(
                          (0, runtime.canvasBoardSelection)(current5),
                        ));
                }));
        }
      };
      (document as Dynamic).addEventListener("keydown", callback15, true);
      return (): Dynamic =>
        (document as Dynamic).removeEventListener("keydown", callback15, true);
    }, []);
    let value322: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let value653: Dynamic = value87.current.artboards.filter(
              (input2?: Dynamic): Dynamic => input.files.has(input2.file),
            ),
            value654: Dynamic = (value87.current.annotations ?? []).filter(
              (input2?: Dynamic): Dynamic => input.notes.has(input2.id),
            ),
            items: Dynamic = [
              ...value653,
              ...value654.map(runtime.annotationVisibleBounds),
            ];
          if (items.length === 0) return false;
          let [items2, items3]: Dynamic = [
              Math.min(...items.map((input2?: Dynamic): Dynamic => input2.x)),
              Math.min(...items.map((input2?: Dynamic): Dynamic => input2.y)),
            ],
            value655: Dynamic =
              value653.length > 0
                ? nextArtboardPlacementPoint(value90.current)
                : {
                    x: items2 + 24,
                    y: items3 + 24,
                  },
            [items4, items5]: Dynamic = [
              value655.x - items2,
              value655.y - items3,
            ];
          value383.current({
            x: value655.x,
            y: value655.y,
            w:
              Math.max(
                ...items.map(
                  (input2?: Dynamic): Dynamic => input2.x + input2.w,
                ),
              ) - items2,
            h:
              Math.max(
                ...items.map(
                  (input2?: Dynamic): Dynamic => input2.y + input2.h,
                ),
              ) - items3,
          });
          return value344.current(
            value653.map(
              (input2?: Dynamic): Dynamic => ({
                file: input2.file,
                x: input2.x + items4,
                y: input2.y + items5,
              }),
            ),
            value654.map(
              (input2?: Dynamic): Dynamic => ({
                id: input2.id,
                x: input2.x + items4,
                y: input2.y + items5,
              }),
            ),
            options,
          );
        },
        [],
      ),
      value323: Dynamic = (0, runtime.reactChromeTheme.useRef)(value322);
    value323.current = value322;
    let value324: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => {},
      ),
      value325: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => {},
      ),
      value326: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          items?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653: Dynamic = "dropped",
          extra?: Dynamic,
          detail?: Dynamic,
          argument: Dynamic = 0,
        ): Dynamic => {
          let value654: Dynamic = items.filter(
              (input?: Dynamic): Dynamic =>
                input instanceof File && input.type.startsWith("image/"),
            ),
            value655: Dynamic = value654.slice(0, 6),
            value656: Dynamic = items.filter(
              (input?: Dynamic): Dynamic =>
                input instanceof File && (0, runtime.isVideoFile)(input),
            ),
            value657: Dynamic = value655.length > 0 ? "images" : "videos";
          if (value655.length === 0 && value656.length === 0) {
            items.length > 0 &&
              value188(
                `Only images and .mp4, .mov or .webm videos can be ${value653} on the canvas.`,
              );
            return;
          }
          if (!editable) {
            value188(
              `This design is view-only \u2014 ${value657} can't be added.`,
            );
            return;
          }
          if (!value224.current) return;
          let value658: Dynamic = extra;
          value654.length > value655.length &&
            value188(
              `Placing the first ${6} images \u2014 add the rest separately.`,
            );
          value655.length > 0 &&
            value324.current(value655, options, context, value653, value658);
          value656.length > 0 &&
            value325.current(
              value656,
              options,
              context,
              value653,
              value658,
              value655.length + argument,
              value658 === extra ? detail : undefined,
            );
        },
        [value188, editable],
      ),
      [value327, value328]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        [],
      ),
      value329: Dynamic = (0, runtime.reactChromeTheme.useRef)(value327);
    value329.current = value327;
    let value330: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      value331: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic =>
          value327.filter((input?: Dynamic): Dynamic => input.page === value79),
        [value327, value79],
      ),
      value332: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          let artboards: Dynamic = value87.current.artboards;
          return context != null
            ? artboards.find(
                (input2?: Dynamic): Dynamic => input2.file === context,
              )
            : [...artboards]
                .reverse()
                .find(
                  (input2?: Dynamic): Dynamic =>
                    !(input2.frameless && input2.file !== value125.current) &&
                    input >= input2.x &&
                    input <= input2.x + input2.w &&
                    options >= input2.y &&
                    options <= input2.y + input2.h,
                );
        },
        [],
      ),
      value333: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          items?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653?: Dynamic,
          extra?: Dynamic,
        ): Dynamic => {
          let callback15: Dynamic = (): Dynamic => {};
          (0, runtime.trackEmbeddedWrite)(
            (async (): Promise<Dynamic> => {
              let value654: Dynamic = value332(options, context, extra);
              if (value654 != null && value654.file === value271.current) {
                value188(
                  "Nothing added. That artboard is playing. Press Edit on it first.",
                );
                return;
              }
              if (extra != null && !value654) {
                value188(`Could not place the ${value653} image.`);
                return;
              }
              let callback16: Dynamic = (
                  input?: Dynamic,
                  options2?: Dynamic,
                  context2?: Dynamic,
                ): Dynamic =>
                  (0, runtime.droppedImagePlacement)(
                    {
                      x: options,
                      y: context,
                    },
                    context2,
                    input,
                    options2,
                  ),
                callback17: Dynamic = (
                  input?: Dynamic,
                  options2?: Dynamic,
                ): Dynamic => {
                  let { w: value662, h: value663 }: Dynamic = (0,
                  runtime.defaultPlacedImageSize)(input, options2);
                  return value663 > runtime.PlatformFileContentLimit_6
                    ? {
                        w: Math.max(
                          runtime.PlatformFileContentConstant_20,
                          Math.round(
                            (value662 * runtime.PlatformFileContentLimit_6) /
                              value663,
                          ),
                        ),
                        h: runtime.PlatformFileContentLimit_6,
                      }
                    : {
                        w: value662,
                        h: value663,
                      };
                };
              (0, runtime.markDropPerformance)("received");
              let value655: Dynamic = items.map(
                  (): Dynamic => ({
                    d: null,
                    density: null,
                  }),
                ),
                current4: Dynamic = value80.current,
                callback18: Dynamic = (input?: Dynamic): Dynamic => {
                  let index2: Dynamic = 0,
                    index3: Dynamic = 0,
                    index4: Dynamic = 0;
                  return items.map(
                    (input2?: Dynamic, options2?: Dynamic): Dynamic => {
                      if (input(options2)) return null;
                      let value662: Dynamic = value655[options2].d ?? {
                        width: 320,
                        height: 240,
                      };
                      if (value654)
                        return callback16(value662, index2++, value654);
                      let { w: value663, h: value664 }: Dynamic = callback17(
                        value662,
                        value655[options2].density,
                      );
                      index2++ === 0 &&
                        ([index3, index4] = [
                          Math.round(options - value663 / 2),
                          Math.round(context - value664 / 2),
                        ]);
                      let state: Dynamic = {
                        x: index3,
                        y: index4,
                        w: value663,
                        h: value664,
                      };
                      index3 += value663 + 80;
                      return state;
                    },
                  );
                },
                value656: Dynamic = callback18((): Dynamic => false).map(
                  (input?: Dynamic): Dynamic =>
                    (0, runtime.createDropGhost)({
                      file: value654?.file ?? null,
                      page: current4,
                      ...input,
                    }),
                ),
                values: Dynamic = new Set(value656.keys()),
                callback19: Dynamic = (
                  input?: Dynamic,
                  options2?: Dynamic,
                ): Dynamic => {
                  values.delete(input) && value656[input][options2]();
                };
              callback15 = (): Dynamic => {
                for (let value662 of [...values] as Dynamic)
                  callback19(value662, "cancel");
              };
              value655 = await Promise.all(
                items.map(async (input?: Dynamic): Promise<Dynamic> => {
                  let value662: Dynamic = await input
                    .slice(0, 262144)
                    .arrayBuffer()
                    .then((input2?: Dynamic): Dynamic => new DataView(input2))
                    .catch((): Dynamic => null);
                  return {
                    d: (0, runtime.isSvgFile)(input)
                      ? await (0, runtime.imageHeaderDimensions)(input).catch(
                          (): Dynamic => null,
                        )
                      : value662 &&
                        (0, runtime.rasterImageDimensions)(value662),
                    density:
                      value662 && (0, runtime.pngPhysicalDimensions)(value662),
                  };
                }),
              );
              callback18((): Dynamic => false).forEach(
                (input?: Dynamic, options2?: Dynamic): Dynamic => {
                  input && value656[options2].place(input);
                },
              );
              (0, runtime.markDropPerformance)("header");
              await (0, runtime.afterNextPaint)();
              let value657: Dynamic = await Promise.all(
                  items.map(
                    (input?: Dynamic): Dynamic =>
                      (0, runtime.imagePlacementRejectionReason)(input) ==
                        null && !(0, runtime.isSvgFile)(input)
                        ? (0, runtime.canDecodeRasterImage)(input)
                        : Promise.resolve(false),
                  ),
                ),
                value658: Dynamic = await Promise.all(
                  items.map(
                    (input?: Dynamic, options2?: Dynamic): Dynamic =>
                      value657[options2]
                        ? (0, runtime.previewImageFile)(input, {
                            sized: true,
                            head: value655[options2].d,
                          }).catch((): Dynamic => null)
                        : Promise.resolve(null),
                  ),
                ),
                value659: Dynamic = await Promise.all(
                  items.map(
                    (input?: Dynamic, options2?: Dynamic): Dynamic =>
                      value658[options2]
                        ? Promise.resolve(null)
                        : (0, runtime.validateCanvasPlacedImage)(
                            input,
                            (0, runtime.isSvgFile)(input)
                              ? undefined
                              : value657[options2],
                          ),
                  ),
                );
              await Promise.all(
                items.map(
                  async (
                    input?: Dynamic,
                    options2?: Dynamic,
                  ): Promise<Dynamic> => {
                    value659[options2] == null &&
                      !value658[options2] &&
                      (0, runtime.isSvgFile)(input) &&
                      (value658[options2] = await (0, runtime.previewImageFile)(
                        input,
                      ).catch((): Dynamic => null));
                  },
                ),
              );
              (0, runtime.markDropPerformance)("gate");
              let value660: Dynamic = value655.map(
                  (input?: Dynamic): Dynamic => input.d,
                ),
                value661: Dynamic = value655.map(
                  (input?: Dynamic): Dynamic => input.density,
                );
              items.forEach((input?: Dynamic, options2?: Dynamic): Dynamic => {
                value659[options2] == null &&
                  !value658[options2] &&
                  value660[options2] == null &&
                  (value659[options2] = "too large to place here");
              });
              items.forEach((input?: Dynamic, options2?: Dynamic): Dynamic => {
                value659[options2] != null && callback19(options2, "cancel");
              });
              callback18(
                (input?: Dynamic): Dynamic => value659[input] != null,
              ).forEach((input?: Dynamic, options2?: Dynamic): Dynamic => {
                input && value656[options2].move(input.x, input.y);
              });
              let length: Dynamic = value659.filter(
                (input?: Dynamic): Dynamic => input != null,
              ).length;
              length > 0 &&
                value188(
                  length === items.length
                    ? `Couldn't use the ${value653} image file` +
                        (items.length > 1 ? "s \u2014 " : " \u2014 ") +
                        [
                          ...new Set(
                            value659.filter(
                              (input?: Dynamic): Dynamic => input != null,
                            ),
                          ),
                        ].join("; ") +
                        "."
                    : String(length) +
                        ` of the ${value653} files couldn't be used as images \u2014 placing the rest.`,
                );
              if (length === items.length) return;
              let callback20: Dynamic = (
                input?: Dynamic,
                options2?: Dynamic,
              ): Dynamic => {
                let value662: Dynamic = `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" data-seed="${options2}-${Date.now()}"><rect width="100%" height="100%" fill="#e9e7e2"/></svg>`;
                return {
                  url: "data:image/svg+xml," + encodeURIComponent(value662),
                  width: input.width,
                  height: input.height,
                };
              };
              items.forEach((input?: Dynamic, options2?: Dynamic): Dynamic => {
                value658[options2] =
                  value659[options2] != null
                    ? null
                    : (value658[options2] ??
                      callback20(value660[options2], options2));
              });
              let callback21: Dynamic = (
                input?: Dynamic,
                options2?: Dynamic,
                context2?: Dynamic,
                value662?: Dynamic,
              ): Dynamic => {
                let value663: Dynamic = (0, runtime.registerHiddenPickerTag)(
                    value662,
                  ),
                  callback22: Dynamic = async (): Promise<Dynamic> => {
                    (0, runtime.isEmbedFrozen)() ||
                      (await input
                        .swapImageAttrs(context2, {
                          "data-dc-drop": null,
                        })
                        .catch((): Dynamic => false));
                  };
                (0, runtime.trackEmbeddedWrite)(
                  (0, runtime.uploadDesignFile)(
                    "appifact",
                    null,
                    items[options2],
                  )
                    .then(async ({ src: src }: Dynamic): Promise<Dynamic> => {
                      if ((0, runtime.isEmbedFrozen)()) return;
                      (await input.swapImageAttrs(context2, {
                        src: src,
                        "data-dc-drop": null,
                      })) ||
                        (await callback22(),
                        value188(
                          "Image kept as an embedded preview (upload settle was refused).",
                        ));
                    })
                    .catch(
                      async (): Promise<Dynamic> => (
                        await callback22(),
                        value188(
                          `Image upload failed \u2014 the ${value653} preview was kept.`,
                        ),
                        false
                      ),
                    )
                    .finally((): Dynamic => {
                      (0, runtime.markDropPerformance)("upload");
                      value663();
                    }),
                );
              };
              if (!value654) {
                let value662: Dynamic =
                  runtime.PlatformFileContentLimit_5 -
                  (value73.current.annotations ?? []).length -
                  value329.current.length;
                if (value662 <= 0) {
                  callback15();
                  value188(
                    "This canvas is at its limit for notes and shapes (" +
                      String(runtime.PlatformFileContentLimit_5) +
                      ").",
                  );
                  return;
                }
                let current5: Dynamic = value80.current,
                  state: Dynamic = {
                    sel: selectionRef.current,
                    tool: value339.current,
                    focus: focusedFileRef.current,
                  },
                  value663: Dynamic = null,
                  items2: Dynamic = [],
                  index2: Dynamic = 0,
                  index3: Dynamic = 0,
                  index4: Dynamic = 0,
                  index5: Dynamic = 0,
                  callback22: Dynamic = (): Dynamic => {
                    if (--index5 > 0 || items2.length === 0) return;
                    let value664: Dynamic = index4 - items2.length,
                      value665: Dynamic =
                        items2.length === 1
                          ? `Picture from the ${value653} image`
                          : `${items2.length} pictures from the ${value653} images`,
                      value666: Dynamic = `${value664} of the ${value653} images ${value664 === 1 ? "was" : "were"} not placed.`;
                    value664 > 0 && value188(value666);
                    (0, runtime.announce)(
                      value665 +
                        (value664 > 0 ? "; " + value666.slice(0, -1) : "") +
                        (length > 0
                          ? `; ${length} of the ${value653} files couldn't be used`
                          : ""),
                    );
                  };
                for (
                  let index6: Dynamic = 0;
                  index6 < items.length && index4 < value662;
                  index6++
                ) {
                  let value664: Dynamic = value658[index6];
                  if (!value664) continue;
                  let value665: Dynamic = value660[index6] ?? {
                      width: value664.width,
                      height: value664.height,
                    },
                    { w: value666, h: value667 }: Dynamic = callback17(
                      value665,
                      value661[index6],
                    );
                  index4 === 0 &&
                    ((index2 = Math.round(options - value666 / 2)),
                    (index3 = Math.round(context - value667 / 2)));
                  let state2: Dynamic = {
                    key: "pp-" + String(++value330.current),
                    x: index2,
                    y: index3,
                    w: value666,
                    h: value667,
                    url: value664.url,
                    page: current5,
                  };
                  value328((input?: Dynamic): Dynamic => [...input, state2]);
                  callback19(index6, "replaced");
                  (0, runtime.markDropPerformance)("insert");
                  let callback23: Dynamic = (): Dynamic => {
                    (0, runtime.markDropPerformance)("upload");
                    value328(
                      (input?: Dynamic): Dynamic =>
                        input.filter(
                          (input2?: Dynamic): Dynamic => input2 !== state2,
                        ),
                    );
                  };
                  index5++;
                  (0, runtime.trackEmbeddedWrite)(
                    (0, runtime.uploadDesignFile)(
                      "appifact",
                      null,
                      items[index6],
                    ).then(({ src: src }: Dynamic): Dynamic => {
                      if ((0, runtime.isEmbedFrozen)()) return;
                      callback23();
                      let value668: Dynamic = (0,
                      runtime.PlatformFileContentTest_2)(src);
                      if (value668 === null) {
                        value188(
                          `Could not place the ${value653} image on the canvas here.`,
                        );
                        return callback22();
                      }
                      let value669: Dynamic = value316.current(
                        {
                          kind: "image",
                          x: state2.x,
                          y: state2.y,
                          w: value666,
                          h: value667,
                          src: value668,
                          alt: (0, runtime.PlatformFileContentSlice)(
                            (0, runtime.droppedImageLabel)(
                              items[index6],
                              value653,
                            ),
                          ),
                          ...(current5 === "" ||
                          current5 === (value73.current.pages?.[0]?.id ?? "")
                            ? {}
                            : {
                                page: current5,
                              }),
                        },
                        {
                          quiet: true,
                        },
                      );
                      if (value669 === null) {
                        callback22();
                        return false;
                      }
                      items2.push(value669);
                      (selectionRef.current === state.sel ||
                        selectionRef.current === value663) &&
                        value339.current === state.tool &&
                        focusedFileRef.current === state.focus &&
                        value80.current === current5 &&
                        ((value663 = (0, runtime.selectionFromBoards)({
                          files: runtime.emptyBoardSelection.files,
                          notes: new Set(items2),
                        })),
                        (selectionRef.current = value663),
                        value62(),
                        setSelection(value663));
                      callback22();
                    }),
                  ).catch((): Dynamic => {
                    callback23();
                    value188(
                      `Couldn't use the ${value653} image \u2014 it was not placed.`,
                    );
                    callback22();
                  });
                  index2 += value666 + 80;
                  index4++;
                }
                callback15();
                let length2: Dynamic = value658.filter(Boolean).length;
                index4 < length2 &&
                  value188(
                    "Placing the first " +
                      String(index4) +
                      " \u2014 this canvas is at its limit for notes and shapes (" +
                      String(runtime.PlatformFileContentLimit_5) +
                      ").",
                  );
                return;
              }
              let entry: Dynamic = value177.current.get(value654.file);
              if (!entry) {
                callback15();
                value188(`Could not place the ${value653} image.`);
                return;
              }
              let index: Dynamic = 0;
              for (let index2: Dynamic = 0; index2 < items.length; index2++) {
                let value662: Dynamic = value658[index2];
                if (!value662) continue;
                let value663: Dynamic = value660[index2] ?? {
                    width: value662.width,
                    height: value662.height,
                  },
                  {
                    x: value664,
                    y: value665,
                    w: value666,
                  }: Dynamic = callback16(value663, index, value654),
                  value667: Dynamic = (0, runtime.createElementEditId)(index2),
                  value668: Dynamic = (0, runtime.droppedImageMarkup)({
                    src: value662.url,
                    mark: value667,
                    alt: (0, runtime.safeDroppedImageAltText)(
                      (0, runtime.droppedImageLabel)(items[index2], value653),
                      (0, runtime.droppedImageLabel)(
                        {
                          name: "",
                        },
                        value653,
                      ),
                    ),
                    natural: value663,
                    left: value664,
                    top: value665,
                    w: value666,
                  });
                if ((await entry.insertHtml(value668, "page")).length === 0) {
                  callback19(index2, "cancel");
                  continue;
                }
                callback19(index2, "landed");
                (0, runtime.markDropPerformance)("insert");
                index++;
                callback21(entry, index2, value662.url, value667);
              }
              callback15();
              index > 0
                ? (0, runtime.announce)(
                    index +
                      (index > 1 ? " images " : " image ") +
                      value653 +
                      (length > 0
                        ? `; ${length} of the ${value653} files couldn't be used`
                        : ""),
                  )
                : value188(`Could not place the ${value653} image.`);
            })().finally((): Dynamic => callback15()),
          );
        },
        [value188, value62, value332],
      );
    value324.current = value333;
    let value334: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
      (
        input?: Dynamic,
        options?: Dynamic,
        context?: Dynamic,
        value653?: Dynamic,
        extra?: Dynamic,
        detail?: Dynamic,
        argument?: Dynamic,
      ): Dynamic => {
        let callback15: Dynamic = (): Dynamic => {};
        (0, runtime.trackEmbeddedWrite)(
          (async (): Promise<Dynamic> => {
            let value654: Dynamic = value332(options, context, extra);
            if (value654 != null && value654.file === value271.current) {
              value188(
                "Nothing added. That artboard is playing. Press Edit on it first.",
              );
              return;
            }
            if (extra != null && !value654) {
              value188(
                `Could not place the ${value653} video: that artboard is gone.`,
              );
              return;
            }
            if (
              value654 &&
              value177.current.get(value654.file)?.isReady() !== true
            ) {
              value188(
                "Nothing added. That artboard isn't loaded yet. Click it, then add the video again.",
              );
              return;
            }
            if (value654 && value177.current.get(value654.file)?.holdsDeck()) {
              value188((0, runtime.CanvasWorkingStateHandler)("artboard"));
              return;
            }
            let values: Dynamic = new Set(),
              callback16: Dynamic = (input2?: Dynamic): Dynamic => {
                values.add(input2);
                value188([...values].join(" "));
              },
              value655: Dynamic = input.filter((input2?: Dynamic): Dynamic => {
                let value662: Dynamic = (0, runtime.videoUploadRefusal)(input2);
                value662 != null &&
                  callback16((0, runtime.videoUploadFailureMessage)(value662));
                return value662 == null;
              }),
              value656: Dynamic = value655.slice(
                0,
                runtime.CanvasWorkingStateConstant_5,
              );
            value655.length > value656.length &&
              callback16(
                `Adding the first ${runtime.CanvasWorkingStateConstant_5} videos. Add the rest separately.`,
              );
            if (value656.length === 0) return;
            if (
              !value654 &&
              (value73.current.annotations ?? []).length +
                value329.current.length +
                value656.length >
                runtime.PlatformFileContentLimit_5
            ) {
              value188(
                "This canvas is at its limit for notes and shapes (" +
                  String(runtime.PlatformFileContentLimit_5) +
                  ").",
              );
              return;
            }
            (0, runtime.markDropPerformance)("received");
            let current4: Dynamic = value80.current,
              state: Dynamic = {
                sel: selectionRef.current,
                tool: value339.current,
                focus: focusedFileRef.current,
              },
              value657: Dynamic = null,
              callback17: Dynamic = (
                input2?: Dynamic,
                options2?: Dynamic,
              ): Dynamic => {
                if (value654 && argument) {
                  let value666: Dynamic = Math.round(
                      Math.min(input2.width, Math.max(48, argument.w * 0.6)),
                    ),
                    value667: Dynamic = Math.max(
                      1,
                      Math.round((value666 * input2.height) / input2.width),
                    ),
                    { left: value668, top: value669 }: Dynamic = (0,
                    runtime.fileDropPosition)(
                      argument,
                      detail + options2,
                      value666,
                      value667,
                    );
                  return {
                    x: value668,
                    y: value669,
                    w: value666,
                    h: value667,
                  };
                }
                if (value654)
                  return (0, runtime.droppedImagePlacement)(
                    {
                      x: options,
                      y: context,
                    },
                    value654,
                    input2,
                    detail + options2,
                  );
                let value662: Dynamic = (0, runtime.defaultPlacedImageSize)(
                    input2,
                    null,
                  ),
                  { w: value663, h: value664 }: Dynamic =
                    value662.h > runtime.PlatformFileContentLimit_6
                      ? {
                          w: Math.max(
                            runtime.PlatformFileContentConstant_20,
                            Math.round(
                              (value662.w *
                                runtime.PlatformFileContentLimit_6) /
                                value662.h,
                            ),
                          ),
                          h: runtime.PlatformFileContentLimit_6,
                        }
                      : value662,
                  value665: Dynamic =
                    value657 ??
                    (detail > 0
                      ? Math.round(options) + detail * 1280
                      : Math.round(options - value663 / 2));
                value657 = value665 + value663 + 80;
                return {
                  x: value665,
                  y: Math.round(context - value664 / 2),
                  w: value663,
                  h: value664,
                };
              },
              callback18: Dynamic = (input2?: Dynamic): Dynamic =>
                value654 && argument
                  ? {
                      ...input2,
                      x: input2.x - argument.sx,
                      y: input2.y - argument.sy,
                    }
                  : input2,
              value658: Dynamic = value656.map(
                (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                  (0, runtime.createDropGhost)({
                    file: value654?.file ?? null,
                    page: current4,
                    washless: true,
                    ...callback18(
                      callback17(
                        {
                          width: 320,
                          height: 180,
                        },
                        options2,
                      ),
                    ),
                  }),
              );
            value657 = null;
            let values2: Dynamic = new Set(value658.keys()),
              callback19: Dynamic = (
                input2?: Dynamic,
                options2?: Dynamic,
              ): Dynamic => {
                values2.delete(input2) && value658[input2][options2]();
              };
            callback15 = (): Dynamic => {
              for (let value662 of [...values2] as Dynamic)
                callback19(value662, "cancel");
            };
            let value659: Dynamic = await Promise.all(
                value656.map(
                  (input2?: Dynamic): Dynamic =>
                    (value654
                      ? (0, runtime.probeVideoFile)(input2)
                      : (0, runtime.captureVideoPoster)(input2)
                    ).catch((): Dynamic => "probe_timeout"),
                ),
              ),
              index: Dynamic = 0,
              value660: Dynamic = value659.map(
                (input2?: Dynamic, options2?: Dynamic): Dynamic => {
                  if (typeof input2 == "string") {
                    callback19(options2, "cancel");
                    callback16((0, runtime.videoUploadFailureMessage)(input2));
                    return null;
                  }
                  let value662: Dynamic = callback17(input2, index++);
                  value658[options2].place(callback18(value662));
                  return value662;
                },
              );
            value660.some(Boolean) &&
              (0, runtime.announce)(
                value660.filter(Boolean).length > 1
                  ? "Uploading videos"
                  : "Uploading video",
              );
            let index2: Dynamic = 0,
              value661: Dynamic = null,
              items: Dynamic = [];
            for (let index3: Dynamic = 0; index3 < value656.length; index3++) {
              let value662: Dynamic = value659[index3],
                value663: Dynamic = value660[index3];
              if (
                value662 == null ||
                typeof value662 == "string" ||
                value663 == null
              )
                continue;
              let value664: Dynamic = null;
              if (!value654) {
                let blob: Dynamic = value662.blob;
                value664 =
                  blob === undefined
                    ? null
                    : await (0, runtime.uploadDesignFile)(
                        "appifact",
                        null,
                        new File(
                          [blob],
                          (0, runtime.videoFileTitle)(value656[index3]) +
                            ".jpg",
                          {
                            type: "image/jpeg",
                          },
                        ),
                      ).then(
                        (input2?: Dynamic): Dynamic =>
                          (0, runtime.PlatformFileContentTest_2)(input2.src),
                        (): Dynamic => null,
                      );
                if ((0, runtime.isEmbedFrozen)()) return;
                if (value664 === null) {
                  callback19(index3, "cancel");
                  callback16(
                    `Couldn't store a still of the ${value653} video, so it wasn't added. Try again.`,
                  );
                  continue;
                }
              }
              let value665: Dynamic = await (0, runtime.uploadDesignVideo)(
                value656[index3],
                value662,
              );
              (0, runtime.markDropPerformance)("upload");
              if ((0, runtime.isEmbedFrozen)()) return;
              if ("refused" in value665) {
                callback19(index3, "cancel");
                callback16(value665.refused);
                if (value665.repeats) break;
                continue;
              }
              if (!value654) {
                let value667: Dynamic = (0, runtime.PlatformFileContentTest_3)(
                    value665.src,
                  ),
                  value668: Dynamic =
                    value664 === null || value667 === null
                      ? null
                      : value316.current(
                          {
                            kind: "image",
                            x: value663.x,
                            y: value663.y,
                            w: value663.w,
                            h: value663.h,
                            src: value664,
                            video: value667,
                            alt: (0, runtime.PlatformFileContentSlice)(
                              (0, runtime.videoFileTitle)(value656[index3]),
                            ),
                            ...(current4 === "" ||
                            current4 === (value73.current.pages?.[0]?.id ?? "")
                              ? {}
                              : {
                                  page: current4,
                                }),
                          },
                          {
                            quiet: true,
                          },
                        );
                if (value668 === null) {
                  callback19(index3, "cancel");
                  (value73.current.annotations ?? []).length <
                    runtime.PlatformFileContentLimit_5 &&
                    callback16(
                      `Couldn't add the ${value653} video to the canvas. Add it again.`,
                    );
                  continue;
                }
                items.push(value668);
                (selectionRef.current === state.sel ||
                  selectionRef.current === value661) &&
                  value339.current === state.tool &&
                  focusedFileRef.current === state.focus &&
                  value80.current === current4 &&
                  ((value661 = (0, runtime.selectionFromBoards)({
                    files: runtime.emptyBoardSelection.files,
                    notes: new Set(items),
                  })),
                  (selectionRef.current = value661),
                  value62(),
                  setSelection(value661));
                callback19(index3, "landed");
                index2++;
                continue;
              }
              let value666: Dynamic;
              for (
                let index4: Dynamic = 0;
                index4 < 120 &&
                !(0, runtime.isEmbedFrozen)() &&
                ((value666 =
                  value654.file === value271.current
                    ? undefined
                    : value177.current.get(value654.file)),
                !value666);
                index4++
              )
                await new Promise(
                  (input2?: Dynamic): Dynamic => setTimeout(input2, 500),
                );
              if (
                (value666
                  ? await value666.insertHtml(
                      (0, runtime.positionedVideoHtml)(
                        value665.src,
                        value662,
                        {
                          left: value663.x,
                          top: value663.y,
                          w: value663.w,
                        },
                        (0, runtime.safeDroppedImageAltText)(
                          (0, runtime.videoFileTitle)(value656[index3]),
                          (0, runtime.videoFileTitle)({
                            name: "",
                          }),
                        ),
                      ),
                      "page",
                    )
                  : []
                ).length === 0
              ) {
                callback19(index3, "cancel");
                callback16(
                  value666
                    ? `Could not place the ${value653} video.`
                    : "The video uploaded, but its artboard did not come back within a minute, so it wasn't placed. Add it again.",
                );
                continue;
              }
              callback19(index3, "landed");
              (0, runtime.markDropPerformance)("insert");
              index2++;
            }
            index2 > 0 &&
              (0, runtime.announce)(
                index2 + (index2 > 1 ? " videos " : " video ") + value653,
              );
          })().finally((): Dynamic => callback15()),
        );
      },
      [value188, value332],
    );
    value325.current = value334;
    let value335: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653?: Dynamic,
        ): Dynamic => {
          let value654: Dynamic;
          if (input === "text") {
            let value655: Dynamic = (0, runtime.beginDeferredTextInput)();
            if (value655 === null) return;
            value654 = value655;
            value177.current.get(options)?.textPlacing();
          }
          value273(options).then((input2?: Dynamic): Dynamic => {
            input2 && value224.current
              ? value308({
                  file: options,
                  tool: input,
                  ...context,
                  dir: value653,
                  holdToken: value654,
                })
              : value654 !== undefined &&
                (0, runtime.finishDeferredTextInput)("edit", value654);
          });
        },
        [value273],
      ),
      value336: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let value653: Dynamic = (
            {
              text: "text",
              rect: "a rectangle",
              oval: "an oval",
              arrow: "an arrow",
              line: "a line",
            } as Dynamic
          )[input];
          value188(
            options === "blocked"
              ? "That artboard didn't load \u2014 pick another one to add " +
                  value653 +
                  "."
              : "Click inside an artboard to add " + value653 + ".",
          );
        },
        [value188],
      ),
      [value337, value338]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        "select",
      ),
      value339: Dynamic = (0, runtime.reactChromeTheme.useRef)(value337);
    value339.current = value337;
    let [value340, value341]: Dynamic = (0, runtime.reactChromeTheme.useState)(
      0,
    );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      editing || (value338("select"), value308(null));
    }, [editing]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value338("select");
      value308(
        (input?: Dynamic): Dynamic =>
          input && input.file !== value121 ? null : input,
      );
    }, [value121]);
    let callback9: Dynamic = (input?: Dynamic): Dynamic => {
        let value653: Dynamic = value73.current.annotations ?? [],
          items: Dynamic = [];
        for (let value654 of input as Dynamic) {
          let value655: Dynamic = (0, runtime.createAnnotationId)(
            [...value653, ...items],
            supportsLoadState,
            (0, runtime.annotationKindCategory)(value654.src),
          );
          items.push(
            (0, runtime.moveAnnotation)(
              {
                ...value654.src,
                id: value655,
              },
              Math.round(value654.x),
              Math.round(value654.y),
            ),
          );
        }
        return items;
      },
      value342: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          items: Dynamic = [],
          context?: Dynamic,
          value653: Dynamic = false,
        ): Dynamic => {
          let value654: Dynamic =
            value653 && context !== undefined ? context : undefined;
          (async (): Promise<Dynamic> => {
            try {
              let value655: Dynamic = input.flatMap(
                (input2?: Dynamic): Dynamic => {
                  let value658: Dynamic = value73.current.artboards.find(
                    (input3?: Dynamic): Dynamic => input3.file === input2.file,
                  );
                  return value658
                    ? [
                        {
                          a: value658,
                          x: input2.x,
                          y: input2.y,
                          title: input2.title,
                        },
                      ]
                    : [];
                },
              );
              if (value655.length === 0) return;
              if (
                Object.keys(doc.content().files).length + value655.length >
                runtime.PlatformFileContentFilesValue
              ) {
                showToast(
                  "Couldn't duplicate \u2014 the canvas would pass its " +
                    String(runtime.PlatformFileContentFilesValue) +
                    "-file limit; delete something first",
                  "error",
                );
                return;
              }
              await Promise.all(
                value655.map(
                  (input2?: Dynamic): Dynamic =>
                    value177.current.get(input2.a.file)?.flushPending(),
                ),
              );
              let state: Dynamic = {
                  ...doc.content().files,
                },
                items2: Dynamic = [];
              for (let {
                a: value658,
                x: value659,
                y: value660,
                title: value661,
              } of value655 as Dynamic) {
                let value662: Dynamic =
                  (await (0, runtime.getKvClient)().get(
                    (0, runtime.PlatformFileContentHandler_4)(value658.file),
                  )) ?? state[value658.file];
                if (
                  typeof value662 != "string" ||
                  (0, runtime.isLoadingArtboardHtml)(value662)
                ) {
                  let value665: Dynamic =
                    value655.length === 1 ? "the artboard" : "an artboard";
                  showToast(
                    typeof value662 == "string"
                      ? "Couldn't duplicate \u2014 " +
                          value665 +
                          " is still loading"
                      : "Couldn't duplicate \u2014 " +
                          value665 +
                          " has no source",
                    "error",
                  );
                  return;
                }
                let value663: Dynamic = value658.file.replace(
                    /\.dc\.html$/,
                    "",
                  ),
                  value664: Dynamic = (0, runtime.uniqueArtboardFile)(
                    state,
                    value663,
                    supportsLoadState,
                  );
                state[value664] = value662;
                let state2: Dynamic = {
                  file: value664,
                  x: Math.round(value659),
                  y: Math.round(value660),
                  w: value658.w,
                  h: value658.h,
                  title:
                    (0, runtime.PlatformFileContentSlice)(value661) ??
                    (0, runtime.duplicateArtboardTitle)(
                      value658.title ?? value663,
                      [
                        ...value87.current.artboards,
                        ...items2.map(
                          (input2?: Dynamic): Dynamic => input2.spec,
                        ),
                      ],
                    ),
                  ...(0, runtime.artboardAppearanceProperties)(value658),
                  ...(value658.page
                    ? {
                        page: value658.page,
                      }
                    : {}),
                };
                items2.push({
                  file: value664,
                  src: value662,
                  spec: state2,
                });
              }
              let values: Dynamic = new Set();
              try {
                for (let value658 of items2 as Dynamic) {
                  await (0, runtime.getKvClient)().set(
                    (0, runtime.PlatformFileContentHandler_4)(value658.file),
                    value658.src,
                  );
                  values.add(value658.file);
                }
              } catch (value658: Dynamic) {
                for (let value659 of values as Dynamic)
                  await (0, runtime.getKvClient)()
                    .delete((0, runtime.PlatformFileContentHandler_4)(value659))
                    .catch((): Dynamic => false);
                throw value658;
              }
              let value656: Dynamic =
                  (value73.current.annotations ?? []).length + items.length <=
                  runtime.PlatformFileContentLimit_5,
                value657: Dynamic = value656 ? callback9(items) : [];
              !value656 &&
                items.length > 0 &&
                showToast(
                  "The artboards were copied; the notes and shapes were not \u2014 this canvas is at its limit (" +
                    String(runtime.PlatformFileContentLimit_5) +
                    ").",
                  "error",
                );
              value98({
                artboards: [
                  ...value73.current.artboards.filter(
                    (input2?: Dynamic): Dynamic => !values.has(input2.file),
                  ),
                  ...items2.map((input2?: Dynamic): Dynamic => input2.spec),
                ],
                ...(value657.length > 0
                  ? {
                      annotations: [
                        ...(value73.current.annotations ?? []),
                        ...value657,
                      ],
                    }
                  : {}),
              });
              value413(
                {
                  kind: "add",
                  entries: items2,
                  ...(value657.length > 0
                    ? {
                        anns: [...value657],
                      }
                    : {}),
                },
                values,
                undefined,
                context,
              );
              value654 !== undefined
                ? value142.current.set(value654, {
                    files: values,
                    notes: new Set(
                      value657.map((input2?: Dynamic): Dynamic => input2.id),
                    ),
                  })
                : setSelection(
                    (0, runtime.selectionFromBoards)({
                      files: values,
                      notes: new Set(
                        value657.map((input2?: Dynamic): Dynamic => input2.id),
                      ),
                    }),
                  );
              values.size > 0 &&
                (0, runtime.frameAnalyticsReporter)(
                  runtime.designAnalyticsEvents.artboardInserted,
                );
            } catch (value655: Dynamic) {
              showToast("Couldn't duplicate: " + String(value655), "error");
            } finally {
              value654 !== undefined &&
                !value142.current.has(value654) &&
                value142.current.set(value654, {
                  files: new Set(),
                  notes: new Set(),
                });
              context !== undefined && value140.current.get(context)?.();
            }
          })();
        },
        [doc, value67, value98, showToast],
      ),
      value343: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          items?: Dynamic,
          items2?: Dynamic,
          context?: Dynamic,
          value653: Dynamic = false,
        ): Dynamic => {
          if (items.length === 0 && items2.length === 1) {
            let value659: Dynamic = items2[0];
            return value318(
              value659.id,
              value659.x,
              value659.y,
              context,
              value653,
            );
          }
          let value654: Dynamic =
              value653 && context !== undefined ? context : undefined,
            value655: Dynamic = value73.current.annotations ?? [],
            value656: Dynamic = items2.flatMap((input?: Dynamic): Dynamic => {
              let value659: Dynamic = value655.find(
                (input2?: Dynamic): Dynamic => input2.id === input.id,
              );
              return value659
                ? [
                    {
                      src: value659,
                      x: input.x,
                      y: input.y,
                    },
                  ]
                : [];
            }),
            callback15: Dynamic = (): Dynamic => (
              value654 !== undefined &&
                value142.current.set(value654, {
                  files: new Set(),
                  notes: new Set(),
                }),
              context !== undefined && value140.current.get(context)?.(),
              false
            );
          if (
            value656.length > 0 &&
            value655.length + value656.length >
              runtime.PlatformFileContentLimit_5
          ) {
            value188(
              "Couldn't copy \u2014 this canvas is at its limit for notes and shapes (" +
                String(runtime.PlatformFileContentLimit_5) +
                ").",
            );
            return callback15();
          }
          let value657: Dynamic = items.filter(
            (input?: Dynamic): Dynamic =>
              value73.current.artboards.some(
                (input2?: Dynamic): Dynamic => input2.file === input.file,
              ),
          );
          if (value657.length > 0) {
            value342(value657, value656, context, value653);
            return true;
          }
          let value658: Dynamic = callback9(value656);
          return value658.length === 0
            ? callback15()
            : (value396.current(
                {
                  kind: "add",
                  entries: [],
                  anns: value658,
                },
                new Set(),
                undefined,
                context,
              ),
              value98({
                ...value73.current,
                annotations: [...value655, ...value658],
              }),
              value654 !== undefined
                ? value142.current.set(value654, {
                    files: new Set(),
                    notes: new Set(
                      value658.map((input?: Dynamic): Dynamic => input.id),
                    ),
                  })
                : (value62(),
                  setSelection(
                    (0, runtime.selectionFromBoards)({
                      files: emptyCanvasSelectionFiles,
                      notes: new Set(
                        value658.map((input?: Dynamic): Dynamic => input.id),
                      ),
                    }),
                  )),
              true);
        },
        [value342, value318, value98, value62, value188],
      ),
      value344: Dynamic = (0, runtime.reactChromeTheme.useRef)(value343);
    value344.current = value343;
    let value345: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      value346: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      [value347, value348]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        (): Dynamic => {
          if (value101 == null) return null;
          let value653: Dynamic = value67.artboards.find(
            (input?: Dynamic): Dynamic => input.file === value101,
          );
          return {
            file: value101,
            prev: (0, runtime.recallCanvasView)(value79) ?? defaultCanvasCamera,
            fit: artboardIsNotExpandedFill(value653),
          };
        },
      ),
      value349: Dynamic = value99 && value347 == null;
    (0, runtime.usePhoneCanvasVisibility)(value349 && !flag && !value100);
    let value350: Dynamic =
        value349 && !flag && editing && value121 != null
          ? (value70.current ?? value67).artboards.find(
              (input?: Dynamic): Dynamic => input.file === value121,
            )
          : undefined,
      value351: Dynamic =
        value350 &&
        (0, runtime.shouldDelayPreviewMount)(value350, {
          editing: editing,
          runsNothing: value100,
        })
          ? null
          : value121,
      value352: Dynamic =
        editing &&
        value347 == null &&
        value351 == null &&
        value269 == null &&
        true;
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value352 || value338("select");
    }, [value352]);
    let value353: Dynamic = !(value347 != null && flag) || value95,
      [value354, value355]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        (): Dynamic => !value353,
      );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      if (value353) {
        value355(false);
        return;
      }
      let flag2: Dynamic = true;
      (async (): Promise<Dynamic> => {
        try {
          await value.current?.("preview");
        } finally {
          flag2 && value355(true);
        }
      })();
      return (): Dynamic => {
        flag2 = false;
      };
    }, [value353]);
    let value356: Dynamic = editing && (value353 || !value354),
      value357: Dynamic = (0, runtime.reactChromeTheme.useRef)(value356);
    value357.current = value356;
    let value358: Dynamic = readOnly && value353,
      [value359, value360]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        null,
      ),
      [value361, value362]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        {},
      ),
      value363: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          value362(
            (input2?: Dynamic): Dynamic =>
              !!input2[input] === options
                ? input2
                : {
                    ...input2,
                    [input]: options,
                  },
          );
        },
        [],
      ),
      value364: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          let { w: value653, h: value654, top: value655 }: Dynamic = value120();
          if (!value653 || value654 - value655 <= 0) return;
          value105.set(
            artboardFullscreenCamera(
              input,
              options,
              value653,
              value654,
              value655,
              context,
            ),
            true,
          );
          let value656: Dynamic = value654 - value655;
          value360(
            (input2?: Dynamic): Dynamic =>
              options
                ? null
                : input2 && input2.w === value653 && input2.h === value656
                  ? input2
                  : {
                      w: value653,
                      h: value656,
                    },
          );
        },
        [value105, value120],
      ),
      value365: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value366: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      [value367, value368]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        "",
      ),
      value369: Dynamic = (0, runtime.reactChromeTheme.useRef)(null);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let value653: Dynamic = (0, runtime.createDesignContextPublisher)();
      value365.current = value653;
      let value654: Dynamic = (0, runtime.createPresenceReporter)({
        minDelta: 2,
      });
      value366.current = value654;
      (0, runtime.getCurrentUserProfile)().then((input?: Dynamic): Dynamic => {
        value654.setWho(input?.name ?? "", input?.color ?? "");
        value368(input?.color ?? "");
      });
      let flag2: Dynamic = false,
        callback15: Dynamic = (): Dynamic => {
          value369.current?.ctrl.abort();
          !flag2 &&
            ((flag2 = true),
            value653.dispose(),
            value654.dispose(),
            (value365.current = null),
            (value366.current = null));
        };
      (0, runtime.setEmbedSilencer)(callback15);
      return (): Dynamic => {
        (0, runtime.setEmbedSilencer)(null);
        callback15();
      };
    }, []);
    let value370: Dynamic =
        (0, runtime.embedMemoryPrefix)() + "canvas:" + value79,
      value371: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      callback10: Dynamic = (input?: Dynamic, options?: Dynamic): Dynamic => {
        value371.current = true;
        value366.current?.move(
          value370,
          Math.round(input),
          Math.round(options),
        );
      },
      value372: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          value285.current ||
            ((value371.current = false),
            value366.current?.move(
              (0, runtime.pageCommentSurfaceKey)(input),
              Math.round(options),
              Math.round(context),
            ));
        },
        [],
      ),
      value373: Dynamic = value347?.file ?? null;
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic => (): Dynamic => {
        value371.current = false;
        value366.current?.say("");
        value366.current?.clear();
      },
      [value373, value347?.fit, value283, value79],
    );
    let value374: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (event?: Dynamic): Dynamic =>
          !(0, runtime.isEditingInputTarget)(event.target) &&
          !(0, runtime.hasBlockingEditorOverlay)() &&
          !value345.current &&
          value371.current,
        [],
      ),
      value375: Dynamic =
        value16 ||
        (!supportsLoadState && localDirty) ||
        sessionsDirty ||
        doc.dirty();
    (0, runtime.useLiveDismissalGuard)((): Dynamic => false);
    let value376: Dynamic = (0,
    runtime.reactChromeTheme.useCallback)((): Dynamic => {
      let { w: value653, h: value654, top: value655 }: Dynamic = value120(),
        state: Dynamic = {
          x: value103.x,
          y: value103.y + value655 / value103.scale,
          w: value653 / value103.scale,
          h: (value654 - value655) / value103.scale,
        },
        value656: Dynamic = value347
          ? [value347.file]
          : value86.artboards
              .filter(
                (input?: Dynamic): Dynamic =>
                  (0, runtime.distanceBetweenRects)(input, state) === 0,
              )
              .map((input?: Dynamic): Dynamic => input.file),
        items: Dynamic = [],
        items2: Dynamic = [],
        value657: Dynamic = !value347 || (flag && value356);
      if (selection.primary != null && value657) {
        let value662: Dynamic = [...selection.elements.keys()].filter(
          (input?: Dynamic): Dynamic => input !== selection.primary,
        );
        value662.push(selection.primary);
        for (let value663 of value662 as Dynamic) {
          let value664: Dynamic = selection.elements.get(value663)?.tids ?? [],
            value665: Dynamic = (0, runtime.encodeArtboardSelectionPath)(
              value663,
            );
          if (value665 !== null)
            for (let value666 of (value177.current
              .get(value663)
              ?.viewEntries(value664) ?? []) as Dynamic) {
              let value667: Dynamic = value665 + "#" + value666.path;
              runtime.encodedElementPathPattern.test(value667) &&
                (items.push(value667),
                items2.push({
                  id: value667,
                  kind: value666.kind,
                  words: value666.words,
                }));
            }
        }
      }
      let value658: Dynamic = value657 ? [...value168, ...value172] : [],
        current4: Dynamic = value365.current;
      if (current4 === null) return;
      let state2: Dynamic = {
          mode: value347 ? "focused" : "canvas",
          page: value79 === "" ? null : value79,
          pageName: {
            text: value79 === "" ? "" : value81,
          },
          visibleArtboards: (0, runtime.normalizeSelectedArtboardPaths)(
            value656,
          ),
          selectedArtboards: (0, runtime.normalizeSelectedArtboardPaths)(
            value658,
          ),
          ...(0, runtime.getEmbeddedPresence)(),
          dirty: value375,
          selected: items.slice(-20),
          selection: items2.slice(-5).map(
            (source?: Dynamic): Dynamic => ({
              id: source.id,
              kind: source.kind,
              label: source.words(runtime.artboardTextSnapshotLimit),
            }),
          ),
        },
        value659: Dynamic = value266.flatMap((input?: Dynamic): Dynamic => {
          let value662: Dynamic = (0, runtime.encodeArtboardSelectionPath)(
            input.file,
          );
          return value662 === null
            ? []
            : [
                {
                  name: value662,
                  first: input.messages[0] ?? "",
                },
              ];
        }),
        value660: Dynamic = value659[0]?.first ?? "",
        value661: Dynamic = (0, runtime.serializeArtboardErrorContext)(
          value659.map((input?: Dynamic): Dynamic => input.name),
          value660,
          state2,
        );
      current4.report(
        value661.length === 0
          ? state2
          : {
              ...state2,
              erroredArtboards: value661,
              firstError: {
                text: value660,
              },
            },
      );
    }, [
      value103,
      value120,
      value86,
      value79,
      value81,
      value232,
      value235,
      value347,
      value356,
      value168,
      value172,
      selection,
      value375,
      value266,
    ]);
    (0, runtime.reactChromeTheme.useEffect)(value376, [value376]);
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic => (
        (0, runtime.setEmbedPresenceListener)(value376),
        (): Dynamic => (0, runtime.setEmbedPresenceListener)(null)
      ),
      [value376],
    );
    let value377: Dynamic = (0, runtime.reactChromeTheme.useRef)(value376);
    value377.current = value376;
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let current4: Dynamic = value106.current;
      if (!current4 || typeof ResizeObserver === "undefined") return;
      let observer: Dynamic = new ResizeObserver(
        (): Dynamic => value377.current(),
      );
      observer.observe(current4);
      return (): Dynamic => observer.disconnect();
    }, []);
    let value378: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let value653: Dynamic = value67.artboards.find(
            (input2?: Dynamic): Dynamic => input2.file === input,
          );
          value653 &&
            value275(
              (): Dynamic =>
                value348({
                  file: input,
                  prev: options ?? value105.get(),
                  fit: artboardIsNotExpandedFill(value653),
                }),
            );
        },
        [value67, value275, value105],
      ),
      value379: Dynamic = (0, runtime.reactChromeTheme.useRef)(value378);
    value379.current = value378;
    let value380: Dynamic = (0, runtime.useLatestCallback)(
        (input?: Dynamic): Dynamic => {
          let current4: Dynamic = value73.current,
            value653: Dynamic = current4.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input,
            );
          if (!value653 || value653.frameless === true) return;
          let value654: Dynamic = (0, runtime.designPageId)(
              value653,
              current4.pages,
            ),
            value655: Dynamic = value654 !== value80.current;
          value655 && (value298(value654, input), (value291.current = false));
          value348(
            (input2?: Dynamic): Dynamic => ({
              file: input,
              prev:
                input2?.prev ??
                (value655
                  ? ((0, runtime.recallCanvasView)(value654) ??
                    defaultCanvasCamera)
                  : value105.get()),
              fit: artboardIsNotExpandedFill(value653),
            }),
          );
        },
      ),
      value381: Dynamic = (0, runtime.useLatestCallback)(
        (input?: Dynamic): Dynamic => value275((): Dynamic => value380(input)),
      ),
      value382: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => {},
      ),
      value383: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => {},
      ),
      value384: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          if (input == null) {
            value270(null);
            return;
          }
          let value653: Dynamic = value73.current.artboards.find(
            (input2?: Dynamic): Dynamic => input2.file === input,
          );
          value653?.frameless ||
            value275((): Dynamic => {
              let value654: Dynamic = value99 && !flag && !value345.current,
                value655: Dynamic =
                  options !== undefined && options !== value80.current;
              options !== undefined && value298(options);
              if (
                value654 &&
                value653 &&
                (0, runtime.shouldDelayPreviewMount)(value653, {
                  editing: value224.current,
                  runsNothing: value100,
                })
              ) {
                value655 && (value291.current = false);
                value270(null);
                value348({
                  file: input,
                  prev:
                    value655 && options !== undefined
                      ? ((0, runtime.recallCanvasView)(options) ??
                        defaultCanvasCamera)
                      : value105.get(),
                  fit: artboardIsNotExpandedFill(value653),
                });
                return;
              }
              selectionEpochRef.current++;
              (focusedFileRef.current === input || value654) && value62();
              value654 && value122(null);
              setSelection(
                (input2?: Dynamic): Dynamic =>
                  (0, runtime.filterSelectedArtboards)(
                    input2,
                    (input3?: Dynamic): Dynamic => input3 !== input,
                  ),
              );
              value270(input);
            });
        },
        [value275, value298, value62, value99, flag, value100, value105],
      ),
      value385: Dynamic = (0, runtime.reactChromeTheme.useRef)(null);
    (0, runtime.reactChromeTheme.useLayoutEffect)((): Dynamic => {
      let current4: Dynamic = value385.current;
      value385.current = value269;
      if (value269 == null) {
        let artboards: Dynamic = value87.current.artboards;
        current4 != null &&
          focusedFileRef.current == null &&
          value122(
            artboards.some(
              (input?: Dynamic): Dynamic => input.file === current4,
            )
              ? current4
              : value99 && !flag && editableRef.current && !value345.current
                ? null
                : (artboards.find(
                    (input?: Dynamic): Dynamic => !input.frameless,
                  )?.file ?? null),
          );
        return;
      }
      value121 === value269 && value122(null);
    }, [value269, value121, value99, flag]);
    let value386: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value387: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value388: Dynamic = (0, runtime.reactChromeTheme.useRef)(null);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let current4: Dynamic = value388.current;
      current4 === null ||
        (value347 == null && value114 === 0) ||
        ((value388.current = null),
        value347 == null && value105.get() === current4 && value292.current());
    }, [value347, value114, value105]);
    let value389: Dynamic = (0,
    runtime.reactChromeTheme.useCallback)((): Dynamic => {
      value270(null);
      value345.current = false;
      value346.current = null;
      value387.current = null;
      value117.current = false;
      let current4: Dynamic = value386.current;
      current4 === defaultCanvasCamera && value292.current()
        ? (value388.current = value105.get())
        : current4 && value105.set(current4, true);
      value348(null);
    }, [value105]);
    value297.current = value389;
    value345.current = value347 != null;
    value346.current = value347?.file ?? null;
    value386.current = value347?.prev ?? null;
    value387.current = value347;
    let value390: Dynamic = value347 != null && !flag;
    value117.current = value390;
    let value391: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let current4: Dynamic = value346.current,
            artboards: Dynamic = value87.current.artboards;
          if (
            current4 == null ||
            !artboards.some(
              (input2?: Dynamic): Dynamic => input2.file === current4,
            )
          )
            return false;
          let value653: Dynamic = (0, runtime.adjacentPrintableArtboard)(
            artboards,
            current4,
            input,
          );
          if (value653 == null) {
            let value654: Dynamic =
              (0, runtime.printableArtboards)(artboards).length <= 1;
            (0, runtime.announce)(
              value654
                ? runtime.ThisIsTheOnlyArtboardMessage
                : input > 0
                  ? runtime.ThisIsTheLastArtboardMessage
                  : runtime.ThisIsTheFirstArtboardMessage,
            );
            return false;
          }
          value382.current(value653.artboard.file);
          return true;
        },
        [],
      ),
      value392: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        value347?.file ?? null,
      );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let value653: Dynamic = value347?.file ?? null;
      if (
        value653 === value392.current ||
        ((value392.current = value653), value653 == null)
      )
        return;
      let artboards: Dynamic = value87.current.artboards,
        value654: Dynamic = artboards.find(
          (input?: Dynamic): Dynamic => input.file === value653,
        ),
        value655: Dynamic = (0, runtime.printableArtboardIndex)(
          artboards,
          value653,
        );
      value654 &&
        value655 &&
        (0, runtime.announce)(
          (0, runtime.artboardPositionAnnouncement)(
            value655.index,
            value655.count,
            value654.title ?? value654.file.replace(/\.dc\.html$/, ""),
          ),
        );
    }, [value347?.file]);
    let value393: Dynamic = (0, runtime.reactChromeTheme.useRef)(0);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let current4: Dynamic = value393.current;
      value393.current = 0;
      if (current4 === 0 || value347 == null) return;
      let value653: Dynamic = value177.current.get(value347.file)?.webviewRef
        .current;
      value653
        ? value653.focus({
            preventScroll: true,
          })
        : (document as Dynamic).activeElement instanceof HTMLIFrameElement &&
          (document as Dynamic).activeElement.blur();
    }, [value347]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let value653: Dynamic = value347?.prev ?? value103;
      if (value653 === defaultCanvasCamera) return;
      let value654: Dynamic = (window as Dynamic).setTimeout(
        (): Dynamic => (0, runtime.rememberCanvasView)(value79, value653),
        150,
      );
      return (): Dynamic => (window as Dynamic).clearTimeout(value654);
    }, [value79, value103, value347]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let callback15: Dynamic = (event?: Dynamic): Dynamic => {
        if (
          event.defaultPrevented ||
          event.altKey ||
          event.shiftKey ||
          !(event.metaKey || event.ctrlKey) ||
          (event.key !== "\\" && event.code !== "Backslash") ||
          !(value224.current || value225.current) ||
          value345.current ||
          (value99 && !value345.current && !value224.current) ||
          value285.current ||
          (event.preventDefault(), event.repeat)
        )
          return;
        let activeElement: Dynamic = (document as Dynamic).activeElement,
          value653: Dynamic =
            activeElement instanceof HTMLElement &&
            (/^(INPUT|TEXTAREA|SELECT)$/.test(activeElement.tagName) ||
              activeElement.isContentEditable);
        value14.current = !(0, runtime.hasBlockingEditorOverlay)() && !value653;
        value96((input?: Dynamic): Dynamic => !input);
      };
      (window as Dynamic).addEventListener("keydown", callback15, true);
      return (): Dynamic =>
        (window as Dynamic).removeEventListener("keydown", callback15, true);
    }, [value96, value99]);
    let callback11: Dynamic = (input?: Dynamic): Dynamic =>
        input == null
          ? null
          : (value106.current?.querySelector(
              `[data-mega-artboard="${CSS.escape(input)}"] [data-mega-title-text]`,
            ) ?? null),
      value394: Dynamic = (0, runtime.useCanvasKeyboardFocus)(
        [
          {
            el: (): Dynamic =>
              value107.current?.querySelector("header.tb-root") ?? null,
          },
          {
            el: (): Dynamic => value106.current,
            home: true,
            clipTo: (): Dynamic => value106.current,
            anchor: (): Dynamic =>
              callback11(value24.current?.insideRef.current ?? null),
            fallback: (): Dynamic => callback11(focusedFileRef.current),
          },
          {
            el: (): Dynamic =>
              value106.current?.querySelector("[data-mega-selection-strip]") ??
              null,
            clipTo: (): Dynamic => value106.current,
            escapeHome: true,
          },
          {
            el: (): Dynamic =>
              (document as Dynamic).getElementById(runtime.inspectorPanelId),
            fallback: (): Dynamic =>
              (document as Dynamic)
                .getElementById(runtime.inspectorPanelId)
                ?.querySelector('[role="tab"][aria-selected="true"]') ?? null,
          },
        ],
        (): Dynamic => value285.current,
      );
    value6.current = async (): Promise<Dynamic> => {
      let current4: Dynamic = value73.current;
      if (!editable || supportsLoadState || !doc.dirty()) return;
      let current5: Dynamic = value346.current,
        value653: Dynamic =
          (current4.pages?.length ?? 0) > 1 ? value80.current : undefined,
        value654: Dynamic =
          current5 !== null
            ? {
                view: "focused",
                file: current5,
              }
            : value653 !== undefined
              ? {
                  view: "canvas",
                  page: value653,
                }
              : {
                  view: "canvas",
                },
        value655: Dynamic = current4.artboards.some(
          (input?: Dynamic): Dynamic => input.file === filePath,
        )
          ? filePath
          : (current4.artboards[0]?.file ?? null),
        value656: Dynamic =
          current4.launch ??
          (doc.content().files[runtime.canvasMetadataFile] != null
            ? {
                view: "canvas",
              }
            : value655 !== null
              ? {
                  view: "focused",
                  file: value655,
                }
              : undefined);
      if (
        value654.view === "focused"
          ? value656?.view === "focused" && value656.file === value654.file
          : value656?.view === "canvas" && value656.page === value654.page
      )
        return;
      let state: Dynamic = {
        ...current4,
        launch: value654,
      };
      value70.current = state;
      value73.current = state;
      value68(state);
      await (0, runtime.getKvClient)().set(
        (0, runtime.PlatformFileContentHandler_4)(runtime.canvasMetadataFile),
        (0, runtime.serializeCanvasMetadata)(state),
        {
          auto: true,
        },
      );
    };
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      if (!supportsLoadState || !editable) return;
      let callback15: Dynamic = async (): Promise<Dynamic> => {
          await value3.current?.();
          for (let value653 of [
            ...dirtySessionFlushersRef.current.values(),
          ] as Dynamic)
            await value653();
        },
        callback16: Dynamic = (): Dynamic => {
          (document as Dynamic).visibilityState === "hidden" &&
            (async (): Promise<Dynamic> => {
              try {
                await callback15();
              } catch {}
              doc.flushNow?.();
            })();
        };
      (document as Dynamic).addEventListener("visibilitychange", callback16);
      (0, runtime.setEmbedSettler)(async (): Promise<Dynamic> => {
        let current4: Dynamic = value369.current;
        current4?.ctrl.abort();
        current4 &&
          (await Promise.race([
            current4.done,
            new Promise(
              (input?: Dynamic): Dynamic =>
                (window as Dynamic).setTimeout(
                  input,
                  canvasExitExportWaitTimeoutMs,
                ),
            ),
          ]));
        await callback15();
      });
      return (): Dynamic => {
        (document as Dynamic).removeEventListener(
          "visibilitychange",
          callback16,
        );
        (0, runtime.setEmbedSettler)(null);
      };
    }, [supportsLoadState, editable, doc]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      if (!supportsLoadState || !editable || !sessionsDirty) {
        sessionFlushRetryCountRef.current = 0;
        return;
      }
      let callback15: Dynamic = (): Dynamic => {
          Promise.allSettled(
            [...dirtySessionFlushersRef.current.values()].map(
              (input?: Dynamic): Dynamic => input(),
            ),
          ).then((): Dynamic => {
            sessionFlushRetryCountRef.current++ < maxSessionDirtyFlushRetries &&
              incrementSessionFlushEpoch(
                (input?: Dynamic): Dynamic => input + 1,
              );
          });
        },
        value653: Dynamic = (window as Dynamic).setTimeout(callback15, 1500);
      return (): Dynamic => (window as Dynamic).clearTimeout(value653);
    }, [supportsLoadState, editable, sessionsDirty, sessionFlushEpoch]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      if (value347 == null || flag) return;
      let callback15: Dynamic = (event?: Dynamic): Dynamic => {
          if (event.defaultPrevented) return;
          if (event.key === "Escape") {
            if ((0, runtime.hasBlockingEditorOverlay)() || value220) return;
            event.preventDefault();
            value389();
            return;
          }
          let value653: Dynamic =
            event.key === "ArrowRight" || event.key === "PageDown"
              ? 1
              : event.key === "ArrowLeft" || event.key === "PageUp"
                ? -1
                : 0;
          value653 === 0 ||
            event.repeat ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.shiftKey ||
            (0, runtime.hasBlockingEditorOverlay)() ||
            (0, runtime.isEditingInputTarget)(event.target) ||
            (0, runtime.isInteractivePreviewTarget)(event.target) ||
            (event.preventDefault(), value391(value653));
        },
        callback16: Dynamic = (dataset?: Dynamic): Dynamic => {
          let data: Dynamic = dataset.data;
          if (!(!data || typeof data != "object")) {
            if (data.__om_escape === 1) {
              [...value177.current.values()].some(
                (input?: Dynamic): Dynamic =>
                  dataset.source !== null &&
                  input.webviewRef.current?.contentWindow === dataset.source,
              ) && value389();
              return;
            }
            if (data.__om_step === 1 || data.__om_step === -1) {
              if (
                navigator.userActivation?.isActive !== true ||
                (0, runtime.hasBlockingEditorOverlay)()
              )
                return;
              let activeElement: Dynamic = (document as Dynamic).activeElement,
                value653: Dynamic = [...value177.current.entries()].find(
                  ([, input]: Dynamic): Dynamic =>
                    input.webviewRef.current === activeElement &&
                    (0, runtime.isPreviewMessage)(
                      dataset,
                      input.webviewRef.current,
                    ),
                );
              if (
                !value653 ||
                value87.current.artboards.find(
                  (input?: Dynamic): Dynamic => input.file === value653[0],
                )?.is_interactive === true
              )
                return;
              parallelCanvasCaptureSemaphore.take() &&
                value391(data.__om_step) &&
                (value393.current = data.__om_step);
            }
          }
        };
      (window as Dynamic).addEventListener("keydown", callback15);
      (window as Dynamic).addEventListener("message", callback16);
      return (): Dynamic => {
        (window as Dynamic).removeEventListener("keydown", callback15);
        (window as Dynamic).removeEventListener("message", callback16);
      };
    }, [value347, flag, value220, value389, value391]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      if (value269 == null) return;
      if (
        !value86.artboards.some(
          (input?: Dynamic): Dynamic => input.file === value269,
        )
      ) {
        value270(null);
        return;
      }
      if (value347 != null) return;
      let callback15: Dynamic = (event?: Dynamic): Dynamic => {
          event.key !== "Escape" ||
            event.repeat ||
            event.defaultPrevented ||
            (0, runtime.hasBlockingEditorOverlay)() ||
            value220 ||
            (value224.current &&
              !(0, runtime.isEmptyCanvasSelection)(selectionRef.current)) ||
            value339.current !== "select" ||
            (0, runtime.isEditingInputTarget)(event.target) ||
            (event.preventDefault(), value270(null));
        },
        callback16: Dynamic = (dataset?: Dynamic): Dynamic => {
          let data: Dynamic = dataset.data;
          !data ||
            typeof data != "object" ||
            data.__om_escape !== 1 ||
            (dataset.source !== null &&
              value177.current.get(value269)?.webviewRef.current
                ?.contentWindow === dataset.source &&
              value270(null));
        };
      (window as Dynamic).addEventListener("keydown", callback15);
      (window as Dynamic).addEventListener("message", callback16);
      return (): Dynamic => {
        (window as Dynamic).removeEventListener("keydown", callback15);
        (window as Dynamic).removeEventListener("message", callback16);
      };
    }, [value269, value86.artboards, value347, value220]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let callback15: Dynamic = (dataset?: Dynamic): Dynamic => {
        let data: Dynamic = dataset.data;
        if (
          !data ||
          typeof data != "object" ||
          typeof data.__om_open != "string" ||
          data.__om_open.length > 1024
        )
          return;
        let value653: Dynamic = (0, runtime.stripPreviewProjectRoot)(
          data.__om_open,
          dataset.source,
        );
        if (navigator.userActivation?.isActive !== true || value285.current)
          return;
        let value654: Dynamic = [...value177.current.entries()].find(
          ([, input]: Dynamic): Dynamic =>
            (0, runtime.isPreviewMessage)(dataset, input.webviewRef.current),
        );
        if (!value654 || value654[0] === value653) return;
        let value655: Dynamic =
          !value345.current && value654[0] === value271.current;
        if (
          (value224.current || value225.current) &&
          !value345.current &&
          !value655
        )
          return;
        let current4: Dynamic = value73.current,
          value656: Dynamic = value653,
          value657: Dynamic = current4.artboards.find(
            (input?: Dynamic): Dynamic => input.file === value656,
          );
        if (
          !value657 ||
          value657.file === value346.current ||
          !singleCanvasCaptureSemaphore.take()
        )
          return;
        let value658: Dynamic = (0, runtime.designPageId)(
            value657,
            current4.pages,
          ),
          value659: Dynamic = value658 !== value80.current;
        if (value655) {
          if (value657.frameless) return;
          value384(value657.file, value659 ? value658 : undefined);
          value659 || value382.current(value657.file);
          return;
        }
        let flag2: Dynamic = false;
        value659
          ? (value298(value658, flag2 ? value657.file : undefined),
            (value291.current = false))
          : flag2 &&
            (value62(),
            setSelection(runtime.emptyCanvasSelection),
            value274.current(value657.file));
        !flag2 &&
          value654[1].webviewRef.current ===
            (document as Dynamic).activeElement &&
          (value393.current = 1);
        value348(
          (input?: Dynamic): Dynamic => ({
            file: value657.file,
            prev:
              input?.prev ??
              (value659
                ? ((0, runtime.recallCanvasView)(value658) ??
                  defaultCanvasCamera)
                : value105.get()),
            fit: artboardIsNotExpandedFill(value657),
          }),
        );
      };
      (window as Dynamic).addEventListener("message", callback15);
      return (): Dynamic =>
        (window as Dynamic).removeEventListener("message", callback15);
    }, [value298, value384, value62, value105]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value347 != null &&
        setSelection(
          (input?: Dynamic): Dynamic => (0, runtime.clearSelectedBoards)(input),
        );
    }, [value347]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      if (!value347) return;
      let value653: Dynamic = value67.artboards.find(
        (input?: Dynamic): Dynamic => input.file === value347.file,
      );
      if (flag) {
        if (
          value653 &&
          (0, runtime.designPageId)(value653, value67.pages) === value79
        )
          return;
        let value654: Dynamic = (0, runtime.defaultPageArtboard)(
          value67,
          value79,
        );
        value654 &&
          value654.file !== value347.file &&
          value348({
            file: value654.file,
            prev: value347.prev,
            fit: artboardIsNotExpandedFill(value654),
          });
        return;
      }
      value653 || value389();
    }, [value67, value347, value389, value79]);
    let value395: Dynamic =
      value347 != null && value347.fit && flag && value361[value347.file]
        ? runtime.artboardTweaksRowHeight
        : 0;
    (0, runtime.reactChromeTheme.useLayoutEffect)((): Dynamic => {
      if (!value347) return;
      let value653: Dynamic = value67.artboards.find(
        (input?: Dynamic): Dynamic => input.file === value347.file,
      );
      if (!value653) return;
      let value654: Dynamic = value395
          ? {
              x: value653.x,
              y: value653.y - value395,
              w: value653.w,
              h: value653.h + value395,
            }
          : value653,
        value655: Dynamic = flag || value99 ? 0 : canvasPastePositionStep;
      value364(value654, value347.fit, value655);
      let current4: Dynamic = value106.current;
      if (!current4 || typeof ResizeObserver === "undefined") return;
      let observer: Dynamic = new ResizeObserver(
        (): Dynamic => value364(value654, value347.fit, value655),
      );
      observer.observe(current4);
      return (): Dynamic => observer.disconnect();
    }, [value347, value67, value395, value114, flag, value99]);
    let value396: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => {},
      ),
      value397: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let value653: Dynamic = input.replace(/\.dc\.html$/, ""),
            value654: Dynamic = (0, runtime.PlatformFileContentSlice)(options);
          if (value654 === undefined) return;
          let value655: Dynamic = value67.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input,
            ),
            value656: Dynamic = value654 !== value653 ? value654 : undefined;
          !value655 ||
            (value655.title ?? undefined) === value656 ||
            (value396.current(
              {
                kind: "rename",
                file: input,
                from: value655.title,
                to: value656,
              },
              new Set(),
            ),
            value98({
              artboards: value67.artboards.map((input2?: Dynamic): Dynamic => {
                if (input2.file !== input) return input2;
                let { title: value657, ...value658 }: Dynamic = input2;
                return value656
                  ? {
                      ...value658,
                      title: value656,
                    }
                  : value658;
              }),
            }));
        },
        [value67, value98],
      ),
      value398: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let value653: Dynamic = value67.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input,
            ),
            value654: Dynamic = value653?.print === "flow" ? "flow" : "fixed";
          !value653 ||
            value654 === options ||
            (value396.current(
              {
                kind: "print",
                file: input,
                from: value654,
                to: options,
              },
              new Set(),
            ),
            value98({
              artboards: value67.artboards.map((input2?: Dynamic): Dynamic => {
                if (input2.file !== input) return input2;
                let { print: value655, ...value656 }: Dynamic = input2;
                return options === "flow"
                  ? {
                      ...value656,
                      print: "flow",
                    }
                  : value656;
              }),
            }));
        },
        [value67, value98],
      ),
      value399: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          let value653: Dynamic = value73.current.artboards.find(
            (input2?: Dynamic): Dynamic => input2.file === input,
          );
          if (
            !value653 ||
            !Number.isFinite(options.w ?? 0) ||
            !Number.isFinite(options.h ?? 0)
          )
            return;
          let callback15: Dynamic = (
              input2?: Dynamic,
              options2?: Dynamic,
            ): Dynamic =>
              input2 === undefined
                ? options2
                : Math.min(
                    runtime.PlatformFileContentLimit_6,
                    Math.max(
                      runtime.PlatformFileContentConstant_16,
                      Math.round(input2),
                    ),
                  ),
            value654: Dynamic = callback15(options.w, value653.w),
            value655: Dynamic = callback15(options.h, value653.h),
            value656: Dynamic = value73.current.artboards.map(
              (input2?: Dynamic): Dynamic =>
                input2.file === input
                  ? {
                      ...input2,
                      w: value654,
                      h: value655,
                    }
                  : input2,
            );
          if (!context) {
            value68(
              (0, runtime.replaceDesignArtboards)(value73.current, value656),
            );
            return;
          }
          let value657: Dynamic =
            (value70.current ?? value73.current).artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input,
            ) ?? value653;
          if (
            Math.round(value657.w) === value654 &&
            Math.round(value657.h) === value655
          ) {
            (value653.w !== value654 || value653.h !== value655) &&
              value68(
                (0, runtime.replaceDesignArtboards)(value73.current, value656),
              );
            return;
          }
          value396.current(
            {
              kind: "resize",
              file: input,
              from: {
                x: value653.x,
                y: value653.y,
                w: value657.w,
                h: value657.h,
              },
              to: {
                x: value653.x,
                y: value653.y,
                w: value654,
                h: value655,
              },
            },
            new Set(),
          );
          value98({
            artboards: value656,
          });
          let value658: Dynamic = (0, runtime.artboardResizeAnnouncement)(
            value657,
            {
              w: value654,
              h: value655,
            },
          );
          value658 != null && (0, runtime.announce)(value658);
        },
        [value98],
      ),
      value400: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let value653: Dynamic = value67.artboards.find(
            (input2?: Dynamic): Dynamic => input2.file === input,
          );
          !value653 ||
            value653.paper === options ||
            (value396.current(
              {
                kind: "paper",
                file: input,
                from: value653.paper,
                to: options,
              },
              new Set(),
            ),
            value98({
              artboards: value67.artboards.map(
                (input2?: Dynamic): Dynamic =>
                  input2.file === input
                    ? {
                        ...input2,
                        paper: options,
                      }
                    : input2,
              ),
            }));
        },
        [value67, value98],
      ),
      value401: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, items?: Dynamic, context?: Dynamic): Dynamic => {
          let current4: Dynamic = value73.current;
          if (
            !current4.artboards.some(
              (input2?: Dynamic): Dynamic => input2.file === input,
            )
          )
            return;
          let value653: Dynamic = items.length > 0 ? [...items] : undefined;
          if (context) {
            value73.current = (0, runtime.updateArtboardGuides)(
              current4,
              input,
              value653,
            );
            value68(value73.current);
            return;
          }
          let value654: Dynamic = (value70.current ?? current4).artboards.find(
            (input2?: Dynamic): Dynamic => input2.file === input,
          )?.guides;
          if ((0, runtime.structurallyEqual)(value654, value653)) {
            value68(
              (0, runtime.updateArtboardGuides)(current4, input, value653),
            );
            return;
          }
          value396.current(
            {
              kind: "guides",
              file: input,
              from: value654,
              to: value653,
            },
            new Set(),
          );
          value98((0, runtime.updateArtboardGuides)(current4, input, value653));
        },
        [value98],
      ),
      value402: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          let current4: Dynamic = value73.current;
          if (
            !current4.artboards.some(
              (input2?: Dynamic): Dynamic => input2.file === input,
            )
          )
            return;
          let value653: Dynamic = (0, runtime.normalizeArtboardRadius)(options);
          if (context) {
            value73.current = (0, runtime.updateArtboardRadius)(
              current4,
              input,
              value653,
            );
            value68(value73.current);
            return;
          }
          let value654: Dynamic = (value70.current ?? current4).artboards.find(
            (input2?: Dynamic): Dynamic => input2.file === input,
          )?.radius;
          if ((0, runtime.structurallyEqual)(value654, value653)) {
            value68(
              (0, runtime.updateArtboardRadius)(current4, input, value653),
            );
            return;
          }
          value396.current(
            {
              kind: "radius",
              file: input,
              from: value654,
              to: value653,
            },
            new Set(),
          );
          value98((0, runtime.updateArtboardRadius)(current4, input, value653));
          (0, runtime.announce)(
            (0, runtime.propertyEditAnnouncement)([
              {
                prop: "border-radius",
                value: (0, runtime.artboardRadiusCss)(value653) ?? "0px",
              },
            ]),
          );
        },
        [value98],
      ),
      value403: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let current4: Dynamic = value73.current,
            value653: Dynamic = (0, runtime.reorderArtboardsOnPages)(
              current4.artboards,
              input,
              options,
              current4.pages,
            );
          value653 !== null &&
            (value396.current(
              (0, runtime.artboardOrderHistoryStep)(
                current4.artboards,
                value653,
              ),
              new Set(),
            ),
            value98({
              ...current4,
              artboards: value653,
            }));
          (0, runtime.announce)(
            (0, runtime.stackingAnnouncement)(options, value653 !== null),
          );
        },
        [value98],
      ),
      value404: Dynamic = (0, runtime.reactChromeTheme.useRef)(value403);
    value404.current = value403;
    let value405: Dynamic = (0, runtime.reactChromeTheme.useRef)([]),
      value406: Dynamic = (0, runtime.reactChromeTheme.useRef)([]),
      [value407, value408]: Dynamic = (0, runtime.reactChromeTheme.useState)(0),
      value409: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      value410: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      value411: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value412: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {
        let value653: Dynamic = ++value409.current;
        value411.current = null;
        let current4: Dynamic = value406.current;
        value406.current = [];
        let items: Dynamic = [
          value432.current?.clearRedo() ?? ((): Dynamic => {}),
          value178.current?.keeper.clearRedo() ?? ((): Dynamic => {}),
        ];
        for (let value654 of value177.current.values() as Dynamic)
          items.push(value654.dropRedo());
        current4.length > 0 &&
          value408((input?: Dynamic): Dynamic => input + 1);
        return (): Dynamic => {
          value409.current === value653 && (value409.current = value653 - 1);
          value406.current.length === 0 && (value406.current = current4);
          for (let value654 of items as Dynamic) value654();
          value408((input?: Dynamic): Dynamic => input + 1);
        };
      }, []),
      value413: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          source?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653?: Dynamic,
        ): Dynamic => {
          let value654: Dynamic =
            value653 !== undefined &&
            (source.kind === "add" || source.kind === "ann-add")
              ? value141.current.get(value653)
              : undefined;
          if (value654) {
            value654(source);
            value140.current.get(value653)?.();
            value140.current.delete(value653);
            return;
          }
          value412();
          value4.current !== null &&
            (0, runtime.updateTextEditHistoryCounts)(
              value4.current,
              "clear-redo",
            );
          let value655: Dynamic = value67.artboards
            .filter((input?: Dynamic): Dynamic => !options.has(input.file))
            .map(
              (input?: Dynamic): Dynamic => [
                input.file,
                value440.current.get(input.file) ?? 0,
              ],
            );
          if (source.kind === "add")
            for (let value656 of new Set([
              ...source.entries.map((input?: Dynamic): Dynamic => input.file),
              ...(context ?? []),
            ]) as Dynamic)
              value655.push([value656, value440.current.get(value656) ?? 0]);
          value405.current.length >= 50 && (value410.current += 1);
          value405.current = [
            ...value405.current,
            {
              op: source,
              at: Date.now(),
              depths: value655,
              ...(value653 !== undefined
                ? {
                    bound: value653,
                  }
                : {}),
              ...(value4.current !== null &&
              (0, runtime.CanvasWorkingStateHandler_3)(source.kind)
                ? {
                    duringTextEdit: value4.current,
                  }
                : {}),
            },
          ].slice(-50);
          value408((input?: Dynamic): Dynamic => input + 1);
          value653 !== undefined &&
            (value140.current.get(value653)?.(),
            value140.current.delete(value653));
        },
        [value67, value412],
      );
    value396.current = value413;
    let value414: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async (source?: Dynamic, options?: Dynamic): Promise<Dynamic> => {
          let current4: Dynamic = value70.current,
            callback15: Dynamic = (
              input?: Dynamic,
              options2: Dynamic = current4,
            ): Dynamic => value98(input, options2);
          if (source.kind === "tweak") {
            let entry: Dynamic = value177.current.get(source.file);
            if (!entry) return false;
            entry.setTweaks(options === "undo" ? source.from : source.to);
            return;
          }
          if (source.kind !== "add" && source.kind !== "delete") {
            let value658: Dynamic = (0, runtime.applyCanvasManifestHistory)(
              current4,
              source,
              options,
            );
            if (value658 === "nothing" || value658 === "full") return value658;
            if (source.kind === "page-add" && options === "undo") {
              let value659: Dynamic = (0,
              runtime.repairCanvasLaunchAfterDeletion)(
                current4,
                emptyCanvasSelectionFiles,
                source.page.id,
              );
              value659 !== undefined && (source.launch = value659);
            }
            if (source.kind === "page-add" && options === "redo") {
              let value659: Dynamic = (0,
              runtime.compatibleRestoredCanvasLaunch)(
                source.launch,
                current4.launch,
              );
              callback15(
                value659 !== undefined
                  ? {
                      ...value658,
                      launch: value659,
                    }
                  : value658,
              );
              delete source.launch;
              return;
            }
            callback15(value658);
            return;
          }
          let value653: Dynamic =
              source.kind === "delete"
                ? options === "undo"
                : options === "redo",
            callback16: Dynamic = (input?: Dynamic): Dynamic => {
              if (source.kind !== "add" || !source.moves) return input;
              let entries: Dynamic = new Map(
                source.moves.map(
                  (input2?: Dynamic): Dynamic => [
                    input2.file,
                    value653 ? input2.to : input2.from,
                  ],
                ),
              );
              return input.map((input2?: Dynamic): Dynamic => {
                let entry: Dynamic = entries.get(input2.file);
                return entry
                  ? {
                      ...input2,
                      x: entry.x,
                      y: entry.y,
                    }
                  : input2;
              });
            },
            callback17: Dynamic = (input?: Dynamic): Dynamic => {
              if (source.kind !== "add" || !source.annMoves) return input;
              let entries: Dynamic = new Map(
                source.annMoves.map(
                  (input2?: Dynamic): Dynamic => [
                    input2.id,
                    value653 ? input2.to : input2.from,
                  ],
                ),
              );
              return input.map((input2?: Dynamic): Dynamic => {
                let entry: Dynamic = entries.get(input2.id);
                return entry
                  ? (0, runtime.moveAnnotation)(input2, entry.x, entry.y)
                  : input2;
              });
            },
            value654: Dynamic =
              source.kind === "add" &&
              ((source.moves?.length ?? 0) > 0 ||
                (source.annMoves?.length ?? 0) > 0);
          if (
            !value653 &&
            source.kind === "delete" &&
            source.page !== undefined
          ) {
            let page: Dynamic = source.page;
            if (
              !(current4.pages ?? []).some(
                (input?: Dynamic): Dynamic => input.id !== page.spec.id,
              )
            )
              throw new Error("it is the only page left.");
            let value658: Dynamic = (0, runtime.remainingCanvasPageObjects)(
              current4,
              page.spec.id,
              new Set(
                source.entries.map((input?: Dynamic): Dynamic => input.file),
              ),
              new Set(
                (source.anns ?? []).map(
                  (input?: Dynamic): Dynamic => input.spec.id,
                ),
              ),
            );
            for (let value659 of value658.artboards as Dynamic) {
              await value177.current.get(value659.file)?.flushPending();
              let value660: Dynamic =
                (await (0, runtime.getKvClient)().get(
                  (0, runtime.PlatformFileContentHandler_4)(value659.file),
                )) ??
                doc.content().files[value659.file] ??
                "";
              source.entries.push({
                file: value659.file,
                src: value660,
                spec: value659,
                index: current4.artboards.findIndex(
                  (input?: Dynamic): Dynamic => input.file === value659.file,
                ),
              });
            }
            value658.notes.length > 0 &&
              (source.anns = [
                ...(source.anns ?? []),
                ...(current4.annotations ?? []).flatMap(
                  (input?: Dynamic, options2?: Dynamic): Dynamic =>
                    value658.notes.includes(input.id)
                      ? [
                          {
                            spec: input,
                            index: options2,
                          },
                        ]
                      : [],
                ),
              ]);
          }
          if (!value653) {
            let values: Dynamic = new Set(
              source.entries.map((input?: Dynamic): Dynamic => input.file),
            );
            current4.cover !== undefined &&
              values.has(current4.cover) &&
              (source.cover = current4.cover);
            let value658: Dynamic = (0,
            runtime.repairCanvasLaunchAfterDeletion)(
              current4,
              values,
              source.kind === "delete" ? source.page?.spec.id : undefined,
            );
            value658 !== undefined && (source.launch = value658);
          }
          let items: Dynamic = [...(current4.annotations ?? [])],
            value655: Dynamic =
              source.kind === "delete"
                ? (source.anns ?? [])
                : (source.anns ?? []).map(
                    (input?: Dynamic, options2?: Dynamic): Dynamic => ({
                      spec: input,
                      index: items.length + options2,
                    }),
                  ),
            value656: Dynamic = value653
              ? value655.filter(
                  (input?: Dynamic): Dynamic =>
                    !items.some(
                      (input2?: Dynamic): Dynamic =>
                        input2.id === input.spec.id,
                    ),
                ).length
              : 0;
          if (
            value656 > 0 &&
            items.length + value656 > runtime.PlatformFileContentLimit_5
          )
            return "full";
          if (
            value653 &&
            source.kind === "delete" &&
            source.page !== undefined
          ) {
            let page: Dynamic = source.page,
              value658: Dynamic = (current4.pages ?? []).some(
                (input?: Dynamic): Dynamic => input.id === page.spec.id,
              );
            if (!(value658 && page.relisted === true)) {
              if (
                (current4.pages ?? []).length >=
                runtime.PlatformFileContentLimit_3
              )
                throw new Error(
                  "this canvas is at its page limit (" +
                    String(runtime.PlatformFileContentLimit_3) +
                    ").",
                );
              value658 &&
                (0, runtime.retargetCanvasPageHistory)(
                  source,
                  (0, runtime.createPageId)(current4.pages ?? [], true),
                );
            }
          }
          let value657: Dynamic =
            source.kind === "delete" ? source.page : undefined;
          if (value653) {
            let value658: Dynamic =
              value657 !== undefined && value657.index === 0;
            value658 &&
              items.splice(
                0,
                items.length,
                ...(0, runtime.assignImplicitFirstCanvasPage)(
                  items,
                  current4.pages,
                ),
              );
            let value659: Dynamic = value658
              ? (0, runtime.assignImplicitFirstCanvasPage)(
                  current4.artboards,
                  current4.pages,
                )
              : [...current4.artboards];
            if (source.kind === "delete")
              for (let value661 of [...source.entries].sort(
                (input?: Dynamic, options2?: Dynamic): Dynamic =>
                  input.index - options2.index,
              ) as Dynamic)
                value659.some(
                  (input?: Dynamic): Dynamic => input.file === value661.file,
                ) ||
                  value659.splice(
                    Math.min(value661.index, value659.length),
                    0,
                    value661.spec,
                  );
            else
              value659.push(
                ...source.entries.map((input?: Dynamic): Dynamic => input.spec),
              );
            for (let value661 of [...value655].sort(
              (input?: Dynamic, options2?: Dynamic): Dynamic =>
                input.index - options2.index,
            ) as Dynamic)
              items.some(
                (input?: Dynamic): Dynamic => input.id === value661.spec.id,
              ) ||
                items.splice(
                  Math.min(value661.index, items.length),
                  0,
                  value661.spec,
                );
            let value660: Dynamic = (0, runtime.compatibleRestoredCanvasLaunch)(
              source.launch,
              current4.launch,
            );
            callback15({
              ...current4,
              artboards: callback16(value659),
              ...(value655.length > 0 || value654 || value658
                ? {
                    annotations: callback17(items),
                  }
                : {}),
              ...(source.cover !== undefined &&
              (source.kind === "delete" || current4.cover === undefined)
                ? {
                    cover: source.cover,
                  }
                : {}),
              ...(value657 !== undefined
                ? {
                    pages: (0, runtime.restoreCanvasPageSpec)(
                      current4.pages,
                      value657,
                    ),
                  }
                : {}),
              ...(value660 !== undefined
                ? {
                    launch: value660,
                  }
                : {}),
            });
            value657 !== undefined && (value657.relisted = true);
            if (source.kind === "add")
              for (let value661 of (source.files ?? []) as Dynamic)
                (doc.content().files[value661.path] ?? value661.src) ===
                  value661.src &&
                  (await (0, runtime.getKvClient)().set(
                    (0, runtime.PlatformFileContentHandler_4)(value661.path),
                    value661.src,
                  ));
            for (let value661 of source.entries as Dynamic)
              await (0, runtime.getKvClient)().set(
                (0, runtime.PlatformFileContentHandler_4)(value661.file),
                value661.src,
              );
            value657 !== undefined && value298(value657.spec.id);
            delete source.cover;
            delete source.launch;
          } else {
            for (let value660 of source.entries as Dynamic) {
              await value177.current.get(value660.file)?.flushPending();
              await (0, runtime.getKvClient)().delete(
                (0, runtime.PlatformFileContentHandler_4)(value660.file),
              );
            }
            if (source.kind === "add")
              for (let value660 of (source.files ?? []) as Dynamic)
                doc.content().files[value660.path] === value660.src &&
                  (await (0, runtime.getKvClient)().delete(
                    (0, runtime.PlatformFileContentHandler_4)(value660.path),
                  ));
            let current5: Dynamic = value70.current,
              value658: Dynamic =
                value657 !== undefined
                  ? (current5.pages ?? []).filter(
                      (input?: Dynamic): Dynamic =>
                        input.id !== value657.spec.id,
                    )
                  : [],
              value659: Dynamic =
                value657 !== undefined &&
                value658.length > 0 &&
                value80.current === value657.spec.id
                  ? ((0, runtime.neighboringCanvasPageId)(
                      current5.pages ?? [],
                      value657.spec.id,
                    ) ?? value658[0].id)
                  : undefined;
            callback15(
              {
                ...current5,
                artboards: callback16(
                  current5.artboards.filter(
                    (input?: Dynamic): Dynamic =>
                      !source.entries.some(
                        (input2?: Dynamic): Dynamic =>
                          input2.file === input.file,
                      ),
                  ),
                ),
                ...(value655.length > 0 || value654
                  ? {
                      annotations: callback17(
                        (current5.annotations ?? []).filter(
                          (input?: Dynamic): Dynamic =>
                            !value655.some(
                              (input2?: Dynamic): Dynamic =>
                                input2.spec.id === input.id,
                            ),
                        ),
                      ),
                    }
                  : {}),
                ...(value658.length > 0
                  ? {
                      pages: value658,
                    }
                  : {}),
              },
              current5,
            );
            value657 !== undefined &&
              (value657.relisted = value658.length === 0);
            value659 !== undefined && value298(value659);
          }
        },
        [value98, value298],
      ),
      value415: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let value653: Dynamic =
              input === "undo" ? value405.current : value406.current,
            value654: Dynamic = value653[value653.length - 1];
          if (!value654) return null;
          for (let [value655, value656] of value654.depths as Dynamic)
            if ((value440.current.get(value655) ?? 0) !== (value656 ?? 0))
              return null;
          return value654;
        },
        [],
      ),
      value416: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653: Dynamic = true,
        ): Dynamic => {
          let value654: Dynamic = value405.current[value405.current.length - 1],
            value655: Dynamic =
              Object.keys(context).length === 1
                ? Object.keys(context)[0]
                : undefined,
            value656: Dynamic =
              value654?.op.kind === "tweak" ? Object.keys(value654.op.to) : [];
          if (
            value653 &&
            value655 !== undefined &&
            value654?.op.kind === "tweak" &&
            !value654.sealed &&
            value654.op.file === input &&
            value656.length === 1 &&
            value656[0] === value655 &&
            Date.now() - value654.at < runtime.ModelModelStateLimit &&
            value415("undo") === value654
          ) {
            value654.op = {
              ...value654.op,
              to: context,
            };
            value654.at = Date.now();
            value412();
            (0, runtime.equalPropValues)(
              value654.op.from[value655],
              context[value655],
            ) &&
              (value405.current.pop(),
              value408((input2?: Dynamic): Dynamic => input2 + 1));
            return;
          }
          value413(
            {
              kind: "tweak",
              file: input,
              from: options,
              to: context,
            },
            new Set(),
          );
          let value657: Dynamic = value405.current[value405.current.length - 1];
          !value653 && value657 && (value657.sealed = true);
        },
        [value415, value413, value412],
      ),
      value417: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653?: Dynamic,
        ): Dynamic => {
          let value654: Dynamic = (0, runtime.nudgeCanvasObjects)(
            value73.current,
            input,
            options,
            context,
          );
          if (!value654) return false;
          let value655: Dynamic = (0, runtime.boardSelectionKey)(input),
            value656: Dynamic = value405.current[value405.current.length - 1],
            callback15: Dynamic = (): Dynamic =>
              value656 != null &&
              value656.depths.every(([input2, input3]: Dynamic): Dynamic => {
                let value657: Dynamic = value440.current.get(input2) ?? 0;
                return value653.has(input2)
                  ? value657 === value653.get(input2)
                  : value657 === (input3 ?? 0);
              });
          if (
            value656?.op.kind === "move" &&
            value656.nudgeKey === value655 &&
            !value656.sealed &&
            Date.now() - value656.at < runtime.ModelModelStateLimit &&
            (value415("undo") === value656 || callback15()) &&
            value654.moves.every(
              (input2?: Dynamic): Dynamic =>
                value656.op.kind === "move" &&
                value656.op.moves.some(
                  (input3?: Dynamic): Dynamic => input3.file === input2.file,
                ),
            ) &&
            value654.anns.every(
              (input2?: Dynamic): Dynamic =>
                value656.op.kind === "move" &&
                (value656.op.anns ?? []).some(
                  (input3?: Dynamic): Dynamic => input3.id === input2.id,
                ),
            )
          ) {
            let entries: Dynamic = new Map(
                value654.moves.map(
                  (input2?: Dynamic): Dynamic => [input2.file, input2.to],
                ),
              ),
              entries2: Dynamic = new Map(
                value654.anns.map(
                  (input2?: Dynamic): Dynamic => [input2.id, input2.to],
                ),
              );
            value656.op = {
              ...value656.op,
              moves: value656.op.moves.map(
                (input2?: Dynamic): Dynamic => ({
                  ...input2,
                  to: entries.get(input2.file) ?? input2.to,
                }),
              ),
              ...(value656.op.anns
                ? {
                    anns: value656.op.anns.map(
                      (input2?: Dynamic): Dynamic => ({
                        ...input2,
                        to: entries2.get(input2.id) ?? input2.to,
                      }),
                    ),
                  }
                : {}),
            };
            value656.at = Date.now();
            value412();
          } else {
            value413(
              {
                kind: "move",
                moves: value654.moves,
                ...(value654.anns.length > 0
                  ? {
                      anns: value654.anns,
                    }
                  : {}),
              },
              new Set(),
            );
            let value657: Dynamic =
              value405.current[value405.current.length - 1];
            value657 && (value657.nudgeKey = value655);
          }
          value98(value654.manifest);
          return true;
        },
        [value415, value413, value412, value98],
      );
    value44.current = value417;
    let value418: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          let current4: Dynamic = value73.current,
            value653: Dynamic = value224.current && true,
            { flips: value654, refused: value655 }: Dynamic = value653
              ? (0, runtime.flipAnnotations)(
                  (current4.annotations ?? []).filter(
                    (input2?: Dynamic): Dynamic => input.has(input2.id),
                  ),
                  options,
                )
              : {
                  flips: [],
                  refused: undefined,
                };
          if (value654.length === 0) {
            context !== undefined && value140.current.get(context)?.();
            return value655 === undefined
              ? {
                  flipped: false,
                }
              : {
                  flipped: false,
                  refused: value655,
                };
          }
          let entries: Dynamic = new Map(
            value654.map((input2?: Dynamic): Dynamic => [input2.id, input2.to]),
          );
          value413(
            {
              kind: "transform",
              label: "Flip",
              boards: [],
              anns: value654,
            },
            new Set(),
            undefined,
            context,
          );
          value98({
            ...current4,
            annotations: (current4.annotations ?? []).map(
              (input2?: Dynamic): Dynamic => {
                let entry: Dynamic = entries.get(input2.id);
                return entry
                  ? {
                      ...input2,
                      ...entry,
                    }
                  : input2;
              },
            ),
          });
          return value655 === undefined
            ? {
                flipped: true,
              }
            : {
                flipped: true,
                refused: value655,
              };
        },
        [value413, value98],
      ),
      value419: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let value653: Dynamic = value149.current
            ? runtime.GeometryFlipAnnotationsLabel_3
            : value150();
          if (value653 !== undefined) {
            value448.current?.(value653 + ".");
            return false;
          }
          if (
            !(0, runtime.sessionAllowsMutation)({
              gesturing: value218.current,
              setMoveCommits: value155.current,
            })
          )
            return false;
          let { flipped: value654, refused: value655 }: Dynamic = value418(
            input,
            options,
          );
          value655 !== undefined &&
            value448.current?.(
              (0, runtime.partialFlipMessage)(
                value655,
                value654,
                runtime.GeometryFlipAnnotationsWytKytYtConfig,
              ),
            );
          value654 &&
            (0, runtime.announce)(
              (0, runtime.flipDirectionAnnouncement)(options),
            );
          return value654;
        },
        [value418, value150],
      );
    value46.current = value419;
    value45.current = value418;
    let value420: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653?: Dynamic,
        ): Dynamic => {
          let value654: Dynamic = value73.current.annotations ?? [],
            value655: Dynamic = value654.find(
              (input2?: Dynamic): Dynamic => input2.id === input,
            );
          if (
            !value655 ||
            Object.values(options).some(
              (input2?: Dynamic): Dynamic =>
                input2 != null && !Number.isFinite(input2),
            )
          )
            return;
          let value656: Dynamic =
              (value70.current ?? value73.current).annotations?.find(
                (input2?: Dynamic): Dynamic => input2.id === input,
              ) ?? value655,
            callback15: Dynamic = (input2?: Dynamic): Dynamic =>
              Math.max(
                -runtime.PlatformFileContentConstant_18,
                Math.min(
                  runtime.PlatformFileContentConstant_18,
                  Math.round(input2),
                ),
              ),
            value657: Dynamic;
          if (
            value655.kind === "rect" ||
            value655.kind === "oval" ||
            value655.kind === "pen" ||
            value655.kind === "image"
          ) {
            let value659: Dynamic =
                value655.kind === "image"
                  ? runtime.PlatformFileContentConstant_20
                  : runtime.PlatformFileContentConstant_19,
              callback16: Dynamic = (input2?: Dynamic): Dynamic =>
                Math.min(
                  runtime.PlatformFileContentLimit_6,
                  Math.max(value659, Math.round(input2)),
                ),
              value660: Dynamic =
                options.w !== undefined ? callback16(options.w) : value655.w,
              value661: Dynamic =
                options.h !== undefined ? callback16(options.h) : value655.h;
            if (
              value655.kind === "image" &&
              value653 &&
              (options.w !== undefined) != (options.h !== undefined)
            ) {
              let value662: Dynamic = value656;
              options.w !== undefined
                ? (value661 = callback16((value660 * value662.h) / value662.w))
                : (value660 = callback16((value661 * value662.w) / value662.h));
            }
            value657 = {
              ...value655,
              x: callback15(options.x ?? value655.x),
              y: callback15(options.y ?? value655.y),
              w: value660,
              h: value661,
            };
          } else if ((0, runtime.isShapeAnnotation)(value655)) {
            let value659: Dynamic = (0, runtime.annotationBounds)(value655);
            value657 = (0, runtime.moveAnnotation)(
              value655,
              callback15(value655.x + ((options.x ?? value659.x) - value659.x)),
              callback15(value655.y + ((options.y ?? value659.y) - value659.y)),
            );
          } else {
            let value659: Dynamic =
                options.w !== undefined
                  ? Math.min(
                      runtime.PlatformFileContentConstant_10,
                      Math.max(
                        runtime.PlatformFileContentConstant_9,
                        Math.round(options.w),
                      ),
                    )
                  : value655.w,
              callback16: Dynamic = (
                input2?: Dynamic,
                options2?: Dynamic,
              ): Dynamic =>
                input2 === undefined
                  ? options2
                  : input2 === null
                    ? undefined
                    : Math.min(
                        runtime.PlatformFileContentConstant_13,
                        Math.max(
                          runtime.PlatformFileContentConstant_12,
                          Math.round(input2),
                        ),
                      ),
              {
                maxW: value660,
                maxH: value661,
                ...value662
              }: Dynamic = value655,
              [items, items2]: Dynamic = [
                value655.kind === "title1"
                  ? callback16(options.maxW, value655.maxW)
                  : undefined,
                callback16(options.maxH, value655.maxH),
              ];
            value657 = {
              ...value662,
              x: callback15(options.x ?? value655.x),
              y: callback15(options.y ?? value655.y),
              w: value659,
              ...(items !== undefined
                ? {
                    maxW: items,
                  }
                : {}),
              ...(items2 !== undefined
                ? {
                    maxH: items2,
                  }
                : {}),
            };
          }
          let value658: Dynamic = value654.map(
            (input2?: Dynamic): Dynamic =>
              input2.id === input ? value657 : input2,
          );
          if (!context) {
            value68({
              ...value73.current,
              annotations: value658,
            });
            return;
          }
          if (
            ["x", "y", "w", "h", "maxW", "maxH"].every(
              (input2?: Dynamic): Dynamic =>
                value656[input2] === value657[input2],
            ) &&
            (!("x2" in value656) ||
              (value656.x2 === value657.x2 && value656.y2 === value657.y2))
          ) {
            value655 !== value657 &&
              value68({
                ...value73.current,
                annotations: value658,
              });
            return;
          }
          if (
            (0, runtime.isShapeAnnotation)(value656) &&
            (0, runtime.isShapeAnnotation)(value657)
          )
            value396.current(
              {
                kind: "ann-box",
                id: input,
                from: (0, runtime.annotationGeometry)(value656),
                to: (0, runtime.annotationGeometry)(value657),
              },
              new Set(),
            );
          else if (
            !(0, runtime.isShapeAnnotation)(value656) &&
            !(0, runtime.isShapeAnnotation)(value657)
          ) {
            let value659: Dynamic = ["maxW", "maxH"].filter(
              (input2?: Dynamic): Dynamic =>
                value656[input2] !== value657[input2],
            );
            value659.length > 0 &&
              value396.current(
                {
                  kind: "transform",
                  label: "Resize",
                  boards: [],
                  anns: [
                    {
                      id: input,
                      from: Object.fromEntries(
                        value659.map(
                          (input2?: Dynamic): Dynamic => [
                            input2,
                            value656[input2],
                          ],
                        ),
                      ),
                      to: Object.fromEntries(
                        value659.map(
                          (input2?: Dynamic): Dynamic => [
                            input2,
                            value657[input2],
                          ],
                        ),
                      ),
                    },
                  ],
                },
                new Set(),
              );
            value656.w !== value657.w &&
              value396.current(
                {
                  kind: "ann-resize",
                  id: input,
                  from: value656.w,
                  to: value657.w,
                },
                new Set(),
              );
            (value656.x !== value657.x || value656.y !== value657.y) &&
              value396.current(
                {
                  kind: "ann-move",
                  id: input,
                  from: {
                    x: value656.x,
                    y: value656.y,
                  },
                  to: {
                    x: value657.x,
                    y: value657.y,
                  },
                },
                new Set(),
              );
          }
          value98({
            ...value73.current,
            annotations: value658,
          });
        },
        [value98],
      ),
      value421: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options?: Dynamic,
          context: Dynamic = false,
        ): Dynamic => {
          let value653: Dynamic = value73.current.annotations ?? [],
            value654: Dynamic = value653.find(
              (input2?: Dynamic): Dynamic => input2.id === input,
            );
          if (!value654 || !(0, runtime.isShapeAnnotation)(value654)) return;
          let value655: Dynamic = context
              ? value654
              : ((value70.current ?? value73.current).annotations?.find(
                  (input2?: Dynamic): Dynamic => input2.id === input,
                ) ?? value654),
            state: Dynamic = {
              ...(value654.css ?? {}),
            },
            flag2: Dynamic = false;
          for (let { prop: value661, value: value662 } of options as Dynamic) {
            if (
              !runtime.PlatformFileContentBackgroundBackgroundColorOpacityValues.includes(
                value661,
              )
            )
              continue;
            let value663: Dynamic = value661;
            if (value662 === null || value662.trim() === "")
              delete state[value663];
            else {
              let value664: Dynamic = (0, runtime.PlatformFileContentTrim)(
                value663,
                value662,
              );
              value664 === null ? (flag2 = true) : (state[value663] = value664);
            }
          }
          flag2 &&
            value188(
              "That value isn\u2019t one a canvas object can take (colours, lengths, gradients and shadows \u2014 nothing that loads a file).",
            );
          let value656: Dynamic =
            Object.keys(state).length > 0 ? state : undefined;
          if (context) {
            JSON.stringify(value656 ?? null) !==
              JSON.stringify(value654.css ?? null) &&
              value68({
                ...value73.current,
                annotations: value653.map(
                  (input2?: Dynamic): Dynamic =>
                    input2.id === input
                      ? (0, runtime.updateAnnotationCss)(value654, value656)
                      : input2,
                ),
              });
            return;
          }
          let value657: Dynamic = (0, runtime.isShapeAnnotation)(value655)
              ? value655.css
              : undefined,
            callback15: Dynamic = (input2?: Dynamic): Dynamic =>
              (value656?.[input2] ?? null) !== (value657?.[input2] ?? null),
            value658: Dynamic =
              value654.kind === "image" &&
              (callback15("object-fit") || callback15("object-position"))
                ? value654.crop
                : undefined,
            callback16: Dynamic = (): Dynamic =>
              value658 !== undefined && value654.kind === "image"
                ? (0, runtime.updateAnnotationCrop)(
                    (0, runtime.updateAnnotationCss)(value654, value656),
                    undefined,
                  )
                : (0, runtime.updateAnnotationCss)(value654, value656);
          if (
            JSON.stringify(value656 ?? null) ===
            JSON.stringify(value657 ?? null)
          ) {
            JSON.stringify(value656 ?? null) !==
              JSON.stringify(value654.css ?? null) &&
              value68({
                ...value73.current,
                annotations: value653.map(
                  (input2?: Dynamic): Dynamic =>
                    input2.id === input
                      ? (0, runtime.updateAnnotationCss)(value654, value656)
                      : input2,
                ),
              });
            return;
          }
          let value659: Dynamic =
              runtime.PlatformFileContentBackgroundBackgroundColorOpacityValues.filter(
                (input2?: Dynamic): Dynamic =>
                  (value657?.[input2] ?? null) !== (state[input2] ?? null),
              ),
            value660: Dynamic = value405.current[value405.current.length - 1];
          if (
            value660?.op.kind === "ann-css" &&
            value660.op.id === input &&
            value660.op.cropFrom === undefined &&
            value658 === undefined &&
            !value660.sealed &&
            value659.length === 1 &&
            value660.cssKey === value659[0] &&
            Date.now() - value660.at < runtime.ModelModelStateLimit &&
            value415("undo") === value660
          ) {
            let value661: Dynamic = (0, runtime.filterSettingHistoryStep)(
              value660.op,
              value659[0],
              value656,
            );
            value660.at = Date.now();
            value412();
            value661
              ? (value660.op = value661)
              : (value405.current.pop(),
                value408((input2?: Dynamic): Dynamic => input2 + 1));
          } else {
            value396.current(
              {
                kind: "ann-css",
                id: input,
                from: value657,
                to: value656,
                ...(value658 !== undefined
                  ? {
                      cropFrom: value658,
                    }
                  : {}),
              },
              new Set(),
            );
            let value661: Dynamic =
              value405.current[value405.current.length - 1];
            value661 &&
              value659.length === 1 &&
              (value661.cssKey = value659[0]);
          }
          value98({
            ...value73.current,
            annotations: value653.map(
              (input2?: Dynamic): Dynamic =>
                input2.id === input ? callback16() : input2,
            ),
          });
        },
        [value98, value188, value415, value412],
      ),
      value422: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          let value653: Dynamic = value73.current.annotations ?? [],
            value654: Dynamic = value653.find(
              (input2?: Dynamic): Dynamic => input2.id === input,
            );
          if (
            !value654 ||
            (value654.kind !== "line" && value654.kind !== "arrow")
          )
            return;
          let value655: Dynamic = (0, runtime.annotationArrowHeads)(value654);
          if (value655[options] === context) return;
          let state: Dynamic = {
            ...value655,
            [options]: context,
          };
          value396.current(
            {
              kind: "ann-heads",
              id: input,
              from: value655,
              to: state,
            },
            new Set(),
          );
          value98({
            ...value73.current,
            annotations: value653.map(
              (input2?: Dynamic): Dynamic =>
                input2.id === input
                  ? (0, runtime.updateAnnotationArrowHeads)(value654, state)
                  : input2,
            ),
          });
        },
        [value98],
      ),
      value423: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options?: Dynamic,
          context: Dynamic = false,
        ): Dynamic => {
          let value653: Dynamic = value73.current.annotations ?? [],
            value654: Dynamic = value653.find(
              (input2?: Dynamic): Dynamic => input2.id === input,
            );
          if (!value654 || (0, runtime.isShapeAnnotation)(value654)) return;
          let value655: Dynamic = (0, runtime.updateAnnotationTextStyle)(
              value654,
              options,
            ),
            value656: Dynamic = value653.map(
              (input2?: Dynamic): Dynamic =>
                input2.id === input ? value655 : input2,
            );
          if (context) {
            JSON.stringify((0, runtime.annotationTextStyle)(value654)) !==
              JSON.stringify((0, runtime.annotationTextStyle)(value655)) &&
              value68({
                ...value73.current,
                annotations: value656,
              });
            return;
          }
          let value657: Dynamic = (
              value70.current ?? value73.current
            ).annotations?.find(
              (input2?: Dynamic): Dynamic => input2.id === input,
            ),
            value658: Dynamic = (0, runtime.annotationTextStyle)(
              value657 !== undefined &&
                !(0, runtime.isShapeAnnotation)(value657)
                ? value657
                : value654,
            ),
            value659: Dynamic = (0, runtime.annotationTextStyle)(value655);
          if (JSON.stringify(value658) === JSON.stringify(value659)) {
            value654 !== value655 &&
              value68({
                ...value73.current,
                annotations: value656,
              });
            return;
          }
          value396.current(
            {
              kind: "ann-style",
              id: input,
              from: value658,
              to: value659,
            },
            new Set(),
          );
          value98({
            ...value73.current,
            annotations: value656,
          });
        },
        [value98],
      ),
      value424: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          if (
            typeof options == "string"
              ? (0, runtime.PlatformFileContentTest_2)(options) === null
              : !(options instanceof File) || !options.type.startsWith("image/")
          )
            return;
          let value653: Dynamic = (value73.current.annotations ?? []).find(
              (input2?: Dynamic): Dynamic => input2.id === input,
            ),
            value654: Dynamic =
              value653?.kind === "image" ? value653.src : undefined;
          (0, runtime.trackEmbeddedWrite)(
            (async (): Promise<Dynamic> => {
              if (typeof options != "string") {
                let value655: Dynamic = await (0,
                runtime.validateCanvasPlacedImage)(options);
                if (value655 !== null)
                  throw new runtime.CanvasImagePlacementError(value655);
              }
              return typeof options == "string"
                ? {
                    src: options,
                  }
                : (0, runtime.uploadDesignFile)("appifact", null, options);
            })().then(({ src: src }: Dynamic): Dynamic => {
              if ((0, runtime.isEmbedFrozen)()) return;
              let value655: Dynamic = (0, runtime.PlatformFileContentTest_2)(
                src,
              );
              if (value655 === null) {
                value188("Could not replace the picture here.");
                return false;
              }
              let value656: Dynamic = value73.current.annotations ?? [],
                value657: Dynamic = value656.find(
                  (input2?: Dynamic): Dynamic => input2.id === input,
                );
              if (
                !value657 ||
                value657.kind !== "image" ||
                value657.src === value655 ||
                value657.src !== value654
              )
                return;
              let value658: Dynamic =
                typeof options == "string"
                  ? value657.alt
                  : ((0, runtime.PlatformFileContentSlice)(
                      (0, runtime.droppedImageLabel)(options, "dropped"),
                    ) ?? value657.alt);
              value396.current(
                {
                  kind: "ann-src",
                  id: input,
                  from: {
                    src: value657.src,
                    alt: value657.alt,
                    crop: value657.crop,
                  },
                  to: {
                    src: value655,
                    alt: value658,
                  },
                },
                new Set(),
              );
              value98({
                ...value73.current,
                annotations: value656.map(
                  (input2?: Dynamic): Dynamic =>
                    input2.id === input
                      ? (0, runtime.updateAnnotationCrop)(
                          (0, runtime.updateAnnotationAlt)(
                            {
                              ...value657,
                              src: value655,
                            },
                            value658,
                          ),
                          undefined,
                        )
                      : input2,
                ),
              });
            }),
          ).catch(
            (input2?: Dynamic): Dynamic =>
              value188(
                `The picture was not replaced \u2014 ${input2 instanceof runtime.CanvasImagePlacementError ? input2.message : "the upload failed"}.`,
              ),
          );
        },
        [value98, value188],
      ),
      value425: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Map()),
      value426: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let value653: Dynamic = (value73.current.annotations ?? []).find(
            (input2?: Dynamic): Dynamic => input2.id === input,
          );
          if (
            !value653 ||
            value653.kind !== "image" ||
            !(options instanceof File)
          )
            return;
          let value654: Dynamic = (0, runtime.CanvasWorkingStateJoin)(options);
          if (
            (0, runtime.CanvasWorkingStatePrint)(
              value425.current.get(input),
              value654,
              value653,
            )
          )
            return;
          let state: Dynamic = {
              src: value653.src,
              video: value653.video,
            },
            callback15: Dynamic = (
              input2?: Dynamic,
              options2?: Dynamic,
              context?: Dynamic,
            ): Dynamic => {
              let value656: Dynamic = value73.current.annotations ?? [],
                value657: Dynamic = value656.find(
                  (input3?: Dynamic): Dynamic => input3.id === input,
                );
              if (
                !value657 ||
                value657.kind !== "image" ||
                value657.src !== state.src ||
                value657.video !== state.video ||
                (value657.src === input2.src && value657.video === input2.video)
              )
                return false;
              let value658: Dynamic = (0, runtime.CanvasWorkingStateWidth)(
                value657.w,
                context,
                value657.h,
                runtime.PlatformFileContentConstant_20,
                runtime.PlatformFileContentLimit_6,
              );
              value396.current(
                {
                  kind: "ann-src",
                  id: input,
                  from: {
                    src: value657.src,
                    alt: value657.alt,
                    h: value657.h,
                    ...(value657.video !== undefined
                      ? {
                          video: value657.video,
                        }
                      : {}),
                    ...(value657.crop !== undefined
                      ? {
                          crop: value657.crop,
                        }
                      : {}),
                  },
                  to: {
                    src: input2.src,
                    alt: options2,
                    h: value658,
                    ...(input2.video !== undefined
                      ? {
                          video: input2.video,
                        }
                      : {}),
                  },
                },
                new Set(),
              );
              value98({
                ...value73.current,
                annotations: value656.map(
                  (input3?: Dynamic): Dynamic =>
                    input3.id === input
                      ? (0, runtime.updateAnnotationCrop)(
                          (0, runtime.updateAnnotationAlt)(
                            (0, runtime.updateAnnotationVideo)(
                              {
                                ...value657,
                                src: input2.src,
                                h: value658,
                              },
                              input2.video,
                            ),
                            options2,
                          ),
                          undefined,
                        )
                      : input3,
                ),
              });
              value425.current.set(input, {
                print: value654,
                src: input2.src,
                video: input2.video,
              });
              return true;
            };
          if ((0, runtime.isImageFile)(options)) {
            (0, runtime.trackEmbeddedWrite)(
              (async (): Promise<Dynamic> => {
                let value656: Dynamic = await (0,
                runtime.validateCanvasPlacedImage)(options);
                if (value656 !== null)
                  throw new runtime.CanvasImagePlacementError(value656);
                let value657: Dynamic = await createImageBitmap(options).then(
                  (input2?: Dynamic): Dynamic => {
                    let state2: Dynamic = {
                      width: input2.width,
                      height: input2.height,
                    };
                    input2.close();
                    return state2;
                  },
                  (): Dynamic => null,
                );
                return {
                  ...(await (0, runtime.uploadDesignFile)(
                    "appifact",
                    null,
                    options,
                  )),
                  size: value657,
                };
              })().then(({ src: src, size: size }: Dynamic): Dynamic => {
                if ((0, runtime.isEmbedFrozen)()) return false;
                let value656: Dynamic = (0, runtime.PlatformFileContentTest_2)(
                  src,
                );
                return value656 === null
                  ? (value188(
                      "Could not replace the video with that picture here.",
                    ),
                    false)
                  : callback15(
                      {
                        src: value656,
                      },
                      (0, runtime.PlatformFileContentSlice)(
                        (0, runtime.droppedImageLabel)(options, "dropped"),
                      ),
                      size,
                    );
              }),
            ).catch(
              (input2?: Dynamic): Dynamic => (
                value188(
                  `The video was not replaced: ${input2 instanceof runtime.CanvasImagePlacementError ? input2.message : "the upload failed"}.`,
                ),
                false
              ),
            );
            return;
          }
          let value655: Dynamic = (0, runtime.isVideoFile)(options)
            ? (0, runtime.videoUploadRefusal)(options)
            : "unsupported_type";
          if (value655 !== null) {
            value188(
              (0, runtime.CanvasWorkingStateReplace)(
                (0, runtime.videoUploadFailureMessage)(value655),
              ),
            );
            return;
          }
          (0, runtime.announce)("Uploading video");
          (0, runtime.trackEmbeddedWrite)(
            (async (): Promise<Dynamic> => {
              let value656: Dynamic = await (0, runtime.captureVideoPoster)(
                options,
              ).catch((): Dynamic => "probe_timeout");
              if (typeof value656 == "string") {
                value188(
                  (0, runtime.CanvasWorkingStateReplace)(
                    (0, runtime.videoUploadFailureMessage)(value656),
                  ),
                );
                return false;
              }
              let value657: Dynamic = await (0, runtime.uploadDesignFile)(
                "appifact",
                null,
                new File(
                  [value656.blob],
                  (0, runtime.videoFileTitle)(options) + ".jpg",
                  {
                    type: "image/jpeg",
                  },
                ),
              ).then(
                (input2?: Dynamic): Dynamic =>
                  (0, runtime.PlatformFileContentTest_2)(input2.src),
                (): Dynamic => null,
              );
              if ((0, runtime.isEmbedFrozen)()) return false;
              if (value657 === null) {
                value188(
                  "Couldn't store a still of that video, so it wasn't replaced. Try again.",
                );
                return false;
              }
              let value658: Dynamic = await (0, runtime.uploadDesignVideo)(
                options,
                value656,
              );
              if ((0, runtime.isEmbedFrozen)()) return false;
              if ("refused" in value658) {
                value188(
                  (0, runtime.CanvasWorkingStateReplace)(value658.refused),
                );
                return false;
              }
              let value659: Dynamic = (0, runtime.PlatformFileContentTest_3)(
                value658.src,
              );
              if (value659 === null) {
                value188("Couldn't replace the video here. Try again.");
                return false;
              }
              let value660: Dynamic = callback15(
                {
                  src: value657,
                  video: value659,
                },
                (0, runtime.PlatformFileContentSlice)(
                  (0, runtime.videoFileTitle)(options),
                ),
                value656,
              );
              value660 && (0, runtime.announce)("Video replaced");
              return value660;
            })(),
          );
        },
        [value98, value188],
      ),
      value427: Dynamic = (0, runtime.reactChromeTheme.useRef)(null);
    value191.current = (input?: Dynamic): Dynamic => {
      let callback15: Dynamic = (): Dynamic => {
        let value653: Dynamic =
          value405.current.length + value406.current.length;
        value405.current = value405.current.filter(
          (input2?: Dynamic): Dynamic => input2.bound !== input,
        );
        value406.current = value406.current.filter(
          (input2?: Dynamic): Dynamic => input2.bound !== input,
        );
        value405.current.length + value406.current.length !== value653 &&
          value408((input2?: Dynamic): Dynamic => input2 + 1);
      };
      value427.current?.bound === input
        ? runWhenConditionReady(
            (): Dynamic => value427.current === null,
            callback15,
          )
        : callback15();
    };
    value192.current = (input?: Dynamic): Dynamic => {
      let current4: Dynamic = value432.current;
      if (!current4) return;
      current4.settle();
      let value653: Dynamic = current4.staleBound(input);
      value653 != null && value191.current(value653);
    };
    let value428: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          let current4: Dynamic = value432.current;
          if (!current4) {
            context?.();
            return;
          }
          runWhenConditionReady(
            (): Dynamic => !current4.busy(),
            (): Dynamic => {
              if (current4.headBound(options) !== input) {
                context?.();
                return;
              }
              options === "undo" ? current4.undo() : current4.redo();
            },
          );
        },
        [],
      ),
      value429: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options: Dynamic = false): Dynamic => {
          if (value427.current) return true;
          let value653: Dynamic = value415(input);
          if (!value653) return false;
          if (
            value653.op.kind === "delete" &&
            value653.op.page !== undefined &&
            value218.current
          )
            return true;
          value427.current = value653;
          let current4: Dynamic = value409.current,
            value654: Dynamic = input === "undo" ? value405 : value406,
            value655: Dynamic = value654.current.lastIndexOf(value653);
          value655 >= 0 && value654.current.splice(value655, 1);
          let callback15: Dynamic = (
              input2?: Dynamic,
              options2?: Dynamic,
            ): Dynamic => {
              value427.current = null;
              value654.current.push(value653);
              value408((input3?: Dynamic): Dynamic => input3 + 1);
              showToast(input2, options2);
            },
            callback16: Dynamic = (): Dynamic => {
              let value656: Dynamic =
                value653.op.kind === "delete" ? value653.op.page : undefined;
              return value656 === undefined
                ? undefined
                : (0, runtime.pageUndoFailureMessage)(
                    input,
                    value656.relisted === true &&
                      (value73.current.pages ?? []).some(
                        (input2?: Dynamic): Dynamic =>
                          input2.id === value656.spec.id,
                      ),
                  );
            };
          value414(value653.op, input)
            .then((input2?: Dynamic): Dynamic => {
              if (input2 === "full") {
                callback15(
                  (0, runtime.clipboardActionFailureMessage)(
                    input,
                    runtime.PlatformFileContentLimit_5,
                    value653.op.kind === "ann-add" ||
                      value653.op.kind === "ann-delete"
                      ? value653.op.spec
                      : undefined,
                    callback16(),
                    options,
                  ),
                  "warning",
                );
                return;
              }
              if (input2 === "nothing") {
                value427.current = null;
                value408((input3?: Dynamic): Dynamic => input3 + 1);
                let value659: Dynamic = (0,
                  runtime.canvasHistoryAnnouncementMode)(
                    input,
                    value653.bound !== undefined,
                    options,
                  ),
                  callback17: Dynamic = (): Dynamic =>
                    (0, runtime.announce)(
                      runtime.NothingChangedThatStepNoLongerMessage,
                    );
                value659 === "partner"
                  ? value428(value653.bound, input, callback17)
                  : value659 === "say" && callback17();
                return;
              }
              let value656: Dynamic =
                value653.op.kind === "delete" && input === "undo"
                  ? {
                      ...value653,
                      depths: [
                        ...value653.depths.filter(
                          ([input3]: Dynamic): Dynamic =>
                            value653.op.kind !== "delete" ||
                            !value653.op.entries.some(
                              (input4?: Dynamic): Dynamic =>
                                input4.file === input3,
                            ),
                        ),
                        ...value653.op.entries.map(
                          (input3?: Dynamic): Dynamic => [
                            input3.file,
                            value440.current.get(input3.file) ?? 0,
                          ],
                        ),
                      ],
                    }
                  : value653;
              (input === "redo" || value409.current === current4) &&
                (input === "undo" ? value406 : value405).current.push({
                  ...value656,
                  sealed: true,
                });
              value408((input3?: Dynamic): Dynamic => input3 + 1);
              let state: Dynamic = {
                  rename: "Artboard rename",
                  resize: "Artboard resize",
                  print: "Print mode change",
                  paper: "Paper change",
                  guides: "Layout guide change",
                  radius: "Corner radius change",
                  cover: "Thumbnail change",
                  order: "Artboard order change",
                  "ann-add": "New note",
                  "ann-delete": "Note delete",
                  "ann-move": "Note move",
                  "ann-resize": "Note resize",
                  "ann-text": "Note edit",
                  "ann-style": "Note style",
                  "ann-box": "Shape move/resize",
                  "ann-path": "Edit path",
                  "ann-color": "Shape color",
                  "ann-css": "Style",
                  "ann-heads": "Arrowhead change",
                  "ann-src": "Picture replace",
                  "ann-crop": "Crop",
                  "page-add": "Page change",
                  "page-rename": "Page change",
                  tweak: "Tweak",
                },
                state2: Dynamic = {
                  move: ["Artboard move", "artboard moves"],
                  add: ["New artboard", "new artboards"],
                  delete: ["Artboard delete", "artboard deletes"],
                },
                state3: Dynamic = {
                  move: "Move",
                  add: "Duplicate",
                  delete: "Delete",
                },
                op2: Dynamic = value653.op,
                value657: Dynamic =
                  op2.kind === "move"
                    ? op2.moves.length
                    : op2.kind === "add" || op2.kind === "delete"
                      ? op2.entries.length
                      : 0,
                value658: Dynamic =
                  op2.kind === "delete" && op2.page !== undefined
                    ? "Page delete"
                    : op2.kind === "move" ||
                        op2.kind === "add" ||
                        op2.kind === "delete"
                      ? (op2.anns?.length ?? 0) > 0
                        ? (op2.kind === "add" && op2.label) || state3[op2.kind]
                        : value657 === 1
                          ? state2[op2.kind][0]
                          : String(value657) + " " + state2[op2.kind][1]
                      : (op2.kind === "ann-add" || op2.kind === "ann-delete") &&
                          (0, runtime.isShapeAnnotation)(op2.spec)
                        ? op2.spec.kind === "image"
                          ? op2.spec.video !== undefined
                            ? op2.kind === "ann-add"
                              ? "New video"
                              : "Video delete"
                            : op2.kind === "ann-add"
                              ? "New picture"
                              : "Picture delete"
                          : op2.kind === "ann-add"
                            ? "New shape"
                            : "Shape delete"
                        : op2.kind === "transform"
                          ? op2.label
                          : op2.kind === "ann-box" &&
                              "w" in op2.from &&
                              "w" in op2.to &&
                              op2.from.x === op2.to.x &&
                              op2.from.y === op2.to.y &&
                              op2.from.w === op2.to.w &&
                              op2.from.h === op2.to.h
                            ? "Rotate"
                            : op2.kind === "ann-src" &&
                                (op2.from.video !== undefined ||
                                  op2.to.video !== undefined)
                              ? "Video replace"
                              : op2.kind === "ann-box" &&
                                  (value73.current.annotations ?? []).some(
                                    (source?: Dynamic): Dynamic =>
                                      source.id === op2.id &&
                                      source.kind === "image",
                                  )
                                ? (value73.current.annotations ?? []).some(
                                    (source?: Dynamic): Dynamic =>
                                      source.id === op2.id &&
                                      source.kind === "image" &&
                                      source.video !== undefined,
                                  )
                                  ? "Video move/resize"
                                  : "Picture move/resize"
                                : state[op2.kind];
              value188(
                input2 === false
                  ? "That artboard isn't open here. Its tweak was left as is."
                  : value658 + (input === "undo" ? " undone." : " redone."),
              );
              value427.current = null;
              value653.bound !== undefined &&
                input2 !== false &&
                value409.current === current4 &&
                value428(value653.bound, input);
            })
            .catch((input2?: Dynamic): Dynamic => {
              let value656: Dynamic = callback16();
              callback15(
                value656 !== undefined
                  ? value656 + (0, runtime.errorMessage)(input2)
                  : "Couldn't undo the artboard change: " + String(input2),
                "error",
              );
            });
          return true;
        },
        [value414, value415, value428, value188, showToast],
      ),
      value430: Dynamic = (0, runtime.reactChromeTheme.useRef)({
        reachable: value415,
        apply: value429,
      });
    value430.current = {
      reachable: value415,
      apply: value429,
    };
    value190.current = value415;
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let callback15: Dynamic = (event?: Dynamic): Dynamic => {
        if (
          event.defaultPrevented ||
          !(
            event.key.toLowerCase() === "z" &&
            (event.metaKey || event.ctrlKey)
          ) ||
          event.repeat ||
          !value224.current ||
          value285.current ||
          (0, runtime.isCanvasTypingTarget)(event.target) ||
          value155.current > 0
        )
          return;
        if (value439.current()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        let value653: Dynamic = event.shiftKey ? "redo" : "undo";
        value415(value653) &&
          (event.preventDefault(), event.stopPropagation(), value429(value653));
      };
      (document as Dynamic).addEventListener("keydown", callback15, true);
      return (): Dynamic =>
        (document as Dynamic).removeEventListener("keydown", callback15, true);
    }, [value415, value429]);
    let value431: Dynamic = (0, runtime.reactChromeTheme.useRef)({
        focusedFile: null,
        panelUndo: null,
      }),
      value432: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value433: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value434: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value435: Dynamic = (0, runtime.reactChromeTheme.useRef)(doc);
    value435.current = doc;
    let value436: Dynamic = (0, runtime.reactChromeTheme.useRef)(value298);
    value436.current = value298;
    let value437: Dynamic = (0, runtime.reactChromeTheme.useRef)(showToast);
    value437.current = showToast;
    value178.current ??= ((): Dynamic => {
      let callback15: Dynamic = (input?: Dynamic): Dynamic =>
          value70.current?.artboards.some(
            (input2?: Dynamic): Dynamic => input2.file === input,
          ) === true && value435.current.content().files[input] !== undefined,
        callback16: Dynamic = (input?: Dynamic): Dynamic => {
          let current4: Dynamic = value70.current,
            value655: Dynamic = current4?.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input,
            );
          return current4 && value655
            ? (0, runtime.designPageId)(value655, current4.pages)
            : undefined;
        },
        state: Dynamic = {
          changed: [],
          other: [],
        },
        value653: Dynamic,
        callback17: Dynamic = (): Dynamic => {
          clearTimeout(value653);
          value653 = undefined;
          state.changed.length = 0;
          state.other.length = 0;
        },
        value654: Dynamic = (0, runtime.createSessionHistory)({
          inDocument: callback15,
          isProtected: (input?: Dynamic): Dynamic =>
            callback16(input) === value80.current ||
            value434.current?.undoFile() === input ||
            value434.current?.redoFile() === input,
          now: (): Dynamic => performance.now(),
          onDrop: (input?: Dynamic, options?: Dynamic): Dynamic => {
            value434.current?.forget(input);
            if (
              !(0, runtime.CanvasWorkingStateHas)(options) ||
              ((options === "changed" ? state.changed : state.other).push(
                callback2(input),
              ),
              value653 !== undefined)
            )
              return;
            let current4: Dynamic = value435.current;
            value653 = setTimeout((): Dynamic => {
              value653 = undefined;
              if (value435.current !== current4) return callback17();
              let { message: value655, description: value656 }: Dynamic = (0,
              runtime.summarizeChangedArtboards)(
                state.changed.splice(0),
                state.other.splice(0),
              );
              value437.current(
                value655,
                "warning",
                value656 === undefined
                  ? undefined
                  : {
                      description: value656,
                    },
              );
            }, 50);
          },
        });
      return {
        keeper: value654,
        host: {
          inDocument: callback15,
          openPage: (): Dynamic => value80.current,
          pageOfFile: callback16,
          isFramed: (input?: Dynamic): Dynamic =>
            value70.current?.artboards.some(
              (input2?: Dynamic): Dynamic =>
                input2.file === input && !input2.frameless,
            ) === true,
          startLoad: (input?: Dynamic): Dynamic => {
            let entry: Dynamic = value177.current.get(input);
            (0, runtime.recordSessionLoadStart)(
              value654,
              input,
              entry
                ? (): Dynamic => entry.ensureModel(value19(input))
                : undefined,
            );
          },
          mayShowPage: (): Dynamic =>
            !value218.current && value427.current === null && !value285.current,
          currentSrc: (input?: Dynamic): Dynamic =>
            value435.current.content().files[input],
          afterExitGuard: value275,
          switchPage: (input?: Dynamic, options?: Dynamic): Dynamic =>
            value436.current(input, options),
          say: (source?: Dynamic): Dynamic => {
            source.kind === "loading"
              ? (0, runtime.announce)(
                  (0, runtime.pendingUndoAnnouncement)(
                    source.dir,
                    callback2(source.file),
                  ),
                )
              : value448.current?.(
                  (0, runtime.undoTargetAnnouncement)(
                    source.dir,
                    value70.current?.pages?.find(
                      (input?: Dynamic): Dynamic => input.id === source.page,
                    )?.name ?? "Page 1",
                  ),
                );
          },
        },
        cancelSaid: callback17,
      };
    })();
    let { keeper: current, host: current2 }: Dynamic = value178.current,
      value438: Dynamic = (0, runtime.reactChromeTheme.useRef)(false);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let value653: Dynamic = (0, runtime.textEditHistoryEpoch)(
        editing,
        value438.current,
        toolResetTick,
      );
      value438.current = editing;
      value653.clear && current.clearAll();
      current.setEpoch(value653.epoch);
    }, [editing, toolResetTick, current]);
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic => (
        current.clearAll(),
        (): Dynamic => value178.current?.cancelSaid()
      ),
      [doc, current],
    );
    value434.current ??= (0, runtime.createEditSessionManager)({
      depths: (input?: Dynamic): Dynamic =>
        (0, runtime.readHeldSessionState)(
          current,
          current2.inDocument,
          input,
          "depth",
          (): Dynamic => value177.current.get(input)?.undoDepth() ?? null,
        ),
      floor: (input?: Dynamic): Dynamic =>
        (0, runtime.readHeldSessionState)(
          current,
          current2.inDocument,
          input,
          "floor",
          (): Dynamic => value177.current.get(input)?.undoFloor() ?? null,
        ),
      redos: (input?: Dynamic): Dynamic =>
        (0, runtime.readHeldSessionState)(
          current,
          current2.inDocument,
          input,
          "redos",
          (): Dynamic => value177.current.get(input)?.redoDepth() ?? null,
        ),
      cutUndo: (input?: Dynamic, options?: Dynamic): Dynamic =>
        value177.current.get(input)?.cutUndo(options),
      dropRedo: (input?: Dynamic, options?: Dynamic): Dynamic => {
        value177.current.get(input)?.dropRedo(options);
      },
      onAtomicRefused: (
        input?: Dynamic,
        options?: Dynamic,
        context?: Dynamic,
        value653?: Dynamic,
      ): Dynamic => {
        options !== "failed" && input !== undefined && value191.current(input);
        if (options === "capped") return;
        let value654: Dynamic =
            String(input) + ":" + options + ":" + String(value653),
          current4: Dynamic = value433.current;
        if (
          (current4 &&
            current4.k === value654 &&
            Date.now() - current4.at < 4e3) ||
          ((value433.current = {
            k: value654,
            at: Date.now(),
          }),
          options === "stale" && context === "whole" && input === undefined)
        )
          return;
        let text: Dynamic =
          "That move across artboards can no longer be undone or redone as one step. An artboard it changed started its history over.";
        value448.current?.(
          options !== "stale"
            ? "Couldn't undo or redo that move across artboards whole. Check both artboards."
            : context === "others"
              ? value653 !== undefined
                ? text +
                  " Undo puts back what it still can; the rest stays in " +
                  callback2(value653) +
                  ", and undo there no longer goes back past the move."
                : text +
                  " Undo now puts the moved elements back where they came from; the copies stay."
              : context === "holder"
                ? text + " Redo now puts the copies back; the originals stay."
                : context === "whole"
                  ? text +
                    " Undo and redo still move the elements; the artboards that moved with them stay."
                  : value653 !== undefined
                    ? text +
                      " What you moved stays in " +
                      callback2(value653) +
                      ", and undo there no longer goes back past the move."
                    : text,
        );
      },
      onBoundApplied: (input?: Dynamic, options?: Dynamic): Dynamic => {
        runWhenConditionReady(
          (): Dynamic => value427.current === null,
          (): Dynamic => {
            value190.current?.(options)?.bound === input &&
              value430.current.apply(options, true);
          },
        );
      },
      apply: (
        input?: Dynamic,
        options?: Dynamic,
        context?: Dynamic,
      ): Dynamic => {
        let current4: Dynamic = value431.current;
        return input === current4.focusedFile && current4.panelUndo
          ? (options === "undo"
              ? current4.panelUndo.undo()
              : current4.panelUndo.redo(),
            context ? value177.current.get(input)?.flushPending() : undefined)
          : value177.current
              .get(input)
              ?.applyHistory(value19(input), options)
              .then((input2?: Dynamic): Dynamic => {
                if (!input2) return;
                let value653: Dynamic = (
                  input.split("/").pop() ?? input
                ).replace(/\.dc\.html$/, "");
                value448.current?.(
                  (options === "undo" ? "Undid on " : "Redid on ") + value653,
                );
              });
      },
    });
    value432.current ??= (0, runtime.createInlineHistoryBridge)(
      value434.current,
      current,
      current2,
    );
    let value439: Dynamic = (0, runtime.reactChromeTheme.useRef)(
      (): Dynamic => false,
    );
    value439.current = (): Dynamic => value432.current?.busy() ?? false;
    let value440: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Map()),
      value441: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let current4: Dynamic = value4.current;
          current4 !== null &&
            input === focusedFileRef.current &&
            !value5.current &&
            (0, runtime.updateTextEditHistoryCounts)(current4, options);
        },
        [],
      ),
      value442: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          value441(input, "push");
          value411.current = {
            file: input,
            restore: value412(),
          };
          value440.current.set(input, (value440.current.get(input) ?? 0) + 1);
          value432.current?.reportPush(input);
          value408((input2?: Dynamic): Dynamic => input2 + 1);
          value134(input);
          value239(input);
          value233((input2?: Dynamic): Dynamic => input2 + 1);
        },
        [value134, value239, value412, value441],
      ),
      value443: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          value440.current.set(
            input,
            (value440.current.get(input) ?? 0) + (options === "undo" ? -1 : 1),
          );
          value134(input);
          value239(input);
          value233((input2?: Dynamic): Dynamic => input2 + 1);
        },
        [value134, value239],
      ),
      value444: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          value441(input, "revoke");
          value443(input, "undo");
          let current4: Dynamic = value411.current;
          value411.current = null;
          current4 && current4.file === input && current4.restore();
        },
        [value443, value441],
      ),
      value445: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          value441(input, options);
          value443(input, options);
          (0, runtime.announce)(
            runtime.AccessibilityAnnouncementsUndoRedoConfig_2[options],
          );
        },
        [value443, value441],
      ),
      value446: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          value441(input, options === "undo" ? "drop-undo" : "drop-redo");
          let value653: Dynamic = value440.current.get(input) ?? 0,
            value654: Dynamic = options === "undo" ? value653 : value653 + 1,
            current4: Dynamic = value427.current;
          for (let value655 of [
            ...value405.current,
            ...value406.current,
            ...(current4 ? [current4] : []),
          ] as Dynamic)
            for (let value656 of value655.depths as Dynamic)
              value656[0] === input &&
                value656[1] != null &&
                value656[1] >= value654 &&
                (value656[1] -= 1);
          value408((input2?: Dynamic): Dynamic => input2 + 1);
          options !== "redo" &&
            (value440.current.set(input, value653 - 1),
            value134(input),
            value239(input),
            value233((input2?: Dynamic): Dynamic => input2 + 1));
        },
        [value134, value239, value441],
      );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let callback15: Dynamic = (event?: Dynamic): Dynamic => {
        if (
          event.defaultPrevented ||
          !(
            event.key.toLowerCase() === "z" &&
            (event.metaKey || event.ctrlKey)
          ) ||
          !value224.current ||
          value285.current ||
          (0, runtime.isCanvasTypingTarget)(event.target)
        )
          return;
        let current4: Dynamic = value432.current;
        if (!current4) return;
        if (current4.busy() || value155.current > 0) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        let value653: Dynamic = event.shiftKey ? "redo" : "undo";
        value192.current(value653);
        if (value430.current.reachable(value653)) return;
        if (value653 === "undo" ? !current4.canUndo() : !current4.canRedo()) {
          (0, runtime.announce)(
            runtime.AccessibilityAnnouncementsUndoRedoConfig[value653],
          );
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        (value653 === "undo" ? current4.undo() : current4.redo()) ===
          "skipped-all" &&
          value188(
            "Nothing left to " +
              value653 +
              " \u2014 that artboard's history changed.",
          );
      };
      (document as Dynamic).addEventListener("keydown", callback15, true);
      return (): Dynamic =>
        (document as Dynamic).removeEventListener("keydown", callback15, true);
    }, [value188]);
    let value447: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      callback12: Dynamic = (input?: Dynamic, options?: Dynamic): Dynamic => {
        (0, runtime.stepInlineHistory)({
          blocked: (): Dynamic =>
            (value432.current?.busy() ?? false) || value155.current > 0,
          stillOk: (): Dynamic => value224.current && !value285.current,
          liveUndoDepth: callback6,
          canvasStep: (input2?: Dynamic): Dynamic =>
            value430.current.reachable(input2),
          textEdit: value4.current,
          pending: value5,
          dir: input,
          step: options,
        });
      };
    value447.current ??= {
      exec(): Dynamic {
        throw new Error(
          "mega-editor history is snapshot-based \u2014 record via the edit paths, not UndoStack.exec",
        );
      },
      seed(): Dynamic {
        throw new Error(
          "mega-editor history is snapshot-based \u2014 record via the edit paths, not UndoStack.seed",
        );
      },
      undo: (): Dynamic =>
        callback12("undo", (): Dynamic => {
          value192.current("undo");
          if (value430.current.reachable("undo")) {
            value430.current.apply("undo");
            return;
          }
          let value653: Dynamic = value432.current?.undo();
          value653 === "skipped-all"
            ? value448.current?.(
                "Nothing left to undo \u2014 that artboard's history changed.",
              )
            : value653 === "empty" &&
              (0, runtime.announce)(
                runtime.AccessibilityAnnouncementsUndoRedoConfig.undo,
              );
        }),
      redo: (): Dynamic =>
        callback12("redo", (): Dynamic => {
          value192.current("redo");
          if (value430.current.reachable("redo")) {
            value430.current.apply("redo");
            return;
          }
          let value653: Dynamic = value432.current?.redo();
          value653 === "skipped-all"
            ? value448.current?.(
                "Nothing left to redo \u2014 that artboard's history changed.",
              )
            : value653 === "empty" &&
              (0, runtime.announce)(
                runtime.AccessibilityAnnouncementsUndoRedoConfig.redo,
              );
        }),
      canUndo: (): Dynamic =>
        value430.current.reachable("undo") != null ||
        (value432.current?.canUndo() ?? false),
      canRedo: (): Dynamic =>
        value430.current.reachable("redo") != null ||
        (value432.current?.canRedo() ?? false),
      redoDepth: (): Dynamic =>
        value430.current.reachable("redo") != null ||
        (value432.current?.canRedo() ?? false)
          ? 1
          : 0,
      clear(): Dynamic {},
      subscribe: (input?: Dynamic): Dynamic =>
        value432.current?.subscribe(input) ?? ((): Dynamic => {}),
    };
    let value448: Dynamic = (0, runtime.reactChromeTheme.useRef)(value188);
    value448.current = value188;
    let value449: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options: Dynamic = emptyCanvasSelectionFiles,
          context?: Dynamic,
          value653?: Dynamic,
        ): Dynamic => {
          let artboards: Dynamic = value73.current.artboards,
            value654: Dynamic = artboards.filter(
              (input2?: Dynamic): Dynamic => input.has(input2.file),
            );
          return value654.length === 0 && value653 === undefined
            ? false
            : ((async (): Promise<Dynamic> => {
                try {
                  let items: Dynamic = [],
                    callback15: Dynamic = async (
                      input2?: Dynamic,
                      options2?: Dynamic,
                    ): Promise<Dynamic> => {
                      await value177.current.get(input2.file)?.flushPending();
                      let value663: Dynamic =
                        (await (0, runtime.getKvClient)().get(
                          (0, runtime.PlatformFileContentHandler_4)(
                            input2.file,
                          ),
                        )) ??
                        doc.content().files[input2.file] ??
                        "";
                      items.push({
                        file: input2.file,
                        src: value663,
                        spec: input2,
                        index: options2.findIndex(
                          (input3?: Dynamic): Dynamic =>
                            input3.file === input2.file,
                        ),
                      });
                    };
                  for (let value663 of value654 as Dynamic)
                    await callback15(value663, artboards);
                  let value655: Dynamic =
                    value653 !== undefined
                      ? (0, runtime.remainingCanvasPageObjects)(
                          value73.current,
                          value653.spec.id,
                          new Set(
                            items.map(
                              (input2?: Dynamic): Dynamic => input2.file,
                            ),
                          ),
                          options,
                        )
                      : undefined;
                  for (let value663 of (value655?.artboards ?? []) as Dynamic)
                    await callback15(value663, value73.current.artboards);
                  let values: Dynamic = new Set(
                      items.map((input2?: Dynamic): Dynamic => input2.file),
                    ),
                    value656: Dynamic =
                      value655 !== undefined && value655.notes.length > 0
                        ? new Set([...options, ...value655.notes])
                        : options,
                    current4: Dynamic = value73.current;
                  if (
                    value653 !== undefined &&
                    !(current4.pages ?? []).some(
                      (input2?: Dynamic): Dynamic =>
                        input2.id !== value653.spec.id,
                    )
                  ) {
                    showToast(staleDeleteFailureMessage(value653.spec.name));
                    return;
                  }
                  let value657: Dynamic = (current4.annotations ?? []).flatMap(
                      (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                        value656.has(input2.id)
                          ? [
                              {
                                spec: input2,
                                index: options2,
                              },
                            ]
                          : [],
                    ),
                    value658: Dynamic =
                      current4.cover !== undefined && values.has(current4.cover)
                        ? current4.cover
                        : undefined,
                    value659: Dynamic = (0,
                    runtime.repairCanvasLaunchAfterDeletion)(
                      current4,
                      values,
                      value653?.spec.id,
                    );
                  value413(
                    {
                      kind: "delete",
                      entries: items,
                      ...(value657.length > 0
                        ? {
                            anns: value657,
                          }
                        : {}),
                      ...(value658 !== undefined
                        ? {
                            cover: value658,
                          }
                        : {}),
                      ...(value659 !== undefined
                        ? {
                            launch: value659,
                          }
                        : {}),
                      ...(value653 !== undefined
                        ? {
                            page: value653,
                          }
                        : {}),
                    },
                    new Set(
                      items.map((input2?: Dynamic): Dynamic => input2.file),
                    ),
                    undefined,
                    context,
                  );
                  for (let value663 of items as Dynamic)
                    await (0, runtime.getKvClient)().delete(
                      (0, runtime.PlatformFileContentHandler_4)(value663.file),
                    );
                  let value660: Dynamic = value73.current.pages ?? [],
                    value661: Dynamic =
                      value653 !== undefined
                        ? value660.filter(
                            (input2?: Dynamic): Dynamic =>
                              input2.id !== value653.spec.id,
                          )
                        : [];
                  value98({
                    artboards: value73.current.artboards.filter(
                      (input2?: Dynamic): Dynamic => !values.has(input2.file),
                    ),
                    ...(value657.length > 0
                      ? {
                          annotations: (
                            value73.current.annotations ?? []
                          ).filter(
                            (input2?: Dynamic): Dynamic =>
                              !value656.has(input2.id),
                          ),
                        }
                      : {}),
                    ...(value661.length > 0
                      ? {
                          pages: value661,
                        }
                      : {}),
                  });
                  value653 !== undefined &&
                    value661.length === 0 &&
                    (value653.relisted = true);
                  let value662: Dynamic =
                    value653 !== undefined &&
                    value80.current === value653.spec.id;
                  value653 !== undefined &&
                    value662 &&
                    value661.length > 0 &&
                    value298(
                      (0, runtime.neighboringCanvasPageId)(
                        value660,
                        value653.spec.id,
                      ) ?? value661[0].id,
                    );
                  (value653 === undefined || value662) &&
                    setSelection(runtime.emptyCanvasSelection);
                  (0, runtime.announce)(
                    value653 !== undefined
                      ? (0, runtime.pageDeletedAnnouncement)(
                          value653.spec.name,
                          items.length,
                          value657.length,
                        )
                      : value657.length > 0
                        ? (0, runtime.objectsDeletedAnnouncement)(
                            value654.length + value657.length,
                          )
                        : (0, runtime.artboardsDeletedAnnouncement)(
                            value654.map(
                              (input2?: Dynamic): Dynamic =>
                                input2.title ??
                                input2.file.replace(/\.dc\.html$/, ""),
                            ),
                          ),
                  );
                  items.length > 0 &&
                    (0, runtime.frameAnalyticsReporter)(
                      runtime.designAnalyticsEvents.artboardDeleted,
                    );
                } catch (value655: Dynamic) {
                  showToast(
                    "Couldn't delete the " +
                      (value653 !== undefined ? "page" : "artboard") +
                      ": " +
                      String(value655),
                    "error",
                  );
                } finally {
                  context !== undefined && value140.current.get(context)?.();
                }
              })(),
              true);
        },
        [value67, value98, value413, doc, showToast, value188, value298],
      ),
      value450: Dynamic = (0, runtime.reactChromeTheme.useRef)(value449);
    value450.current = value449;
    let value451: Dynamic = (0, runtime.reactChromeTheme.useRef)(value342);
    value451.current = value342;
    let value452: Dynamic = (0, runtime.reactChromeTheme.useRef)(callback3);
    value452.current = callback3;
    let value453: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic =>
          Object.assign(new WeakMap(), {
            next: 1,
          }),
        [],
      ),
      value454: Dynamic = (0, runtime.reactChromeTheme.useMemo)((): Dynamic => {
        let callback15: Dynamic = async (
            input?: Dynamic,
            options: Dynamic = 5e3,
          ): Promise<Dynamic> => {
            let value653: Dynamic = Date.now();
            for (; !input(); ) {
              if (Date.now() - value653 > options) return false;
              await new Promise(
                (input2?: Dynamic): Dynamic => setTimeout(input2, 40),
              );
            }
            return true;
          },
          callback16: Dynamic = (): Dynamic =>
            (0, runtime.designPageContents)(value73.current, value80.current)
              .artboards,
          callback17: Dynamic = (input?: Dynamic): Dynamic =>
            Math.min(
              runtime.PlatformFileContentLimit_6,
              Math.max(
                runtime.PlatformFileContentConstant_16,
                Math.round(input),
              ),
            );
        return {
          boards: (): Dynamic =>
            callback16().map(
              (input?: Dynamic): Dynamic => ({
                file: input.file,
                x: input.x,
                y: input.y,
                w: input.w,
                h: input.h,
                title: input.title ?? input.file.replace(/\.dc\.html$/, ""),
              }),
            ),
          pageIs: (input?: Dynamic): Dynamic =>
            (0, runtime.isCanvasPageMatch)(
              input,
              value80.current,
              value73.current.pages?.[0]?.id ?? "",
            ),
          token: (): Dynamic => (0, runtime.randomSessionToken)(),
          group: (input?: Dynamic, options?: Dynamic): Dynamic =>
            value432.current?.group(
              input,
              options !== undefined
                ? {
                    bound: options,
                  }
                : undefined,
            ) ?? null,
          hold: async (): Promise<Dynamic> => (
            await callback15(
              (): Dynamic =>
                value155.current <= 0 &&
                !value202.current &&
                !(value432.current?.busy() ?? false),
            ),
            value156(runtime.CanvasWorkingStateConstant_8)
          ),
          undo: (): Dynamic => value447.current?.undo(),
          redo: (): Dynamic => value447.current?.redo(),
          mark: (): Dynamic => {
            let current4: Dynamic = value405.current,
              value653: Dynamic = current4[current4.length - 1];
            value653 !== undefined &&
              !value453.has(value653) &&
              value453.set(value653, value453.next++);
            return (
              String(current4.length) +
              ":" +
              (value653 === undefined ? "" : String(value453.get(value653))) +
              "/" +
              String(value406.current.length) +
              "|" +
              [...value440.current]
                .filter(([, input]: Dynamic): Dynamic => input !== 0)
                .map(
                  ([input, input2]: Dynamic): Dynamic =>
                    input + "=" + String(input2),
                )
                .sort()
                .join(",") +
              "#" +
              String(value409.current)
            );
          },
          depth: (): Dynamic =>
            value410.current +
            value405.current.length +
            [...value440.current.values()].reduce(
              (input?: Dynamic, options?: Dynamic): Dynamic => input + options,
              0,
            ),
          revealRect: (input?: Dynamic): Dynamic => {
            value383.current?.({
              x: input.x,
              y: input.y,
              w: input.w,
              h: input.h,
            });
          },
          reveal: (input?: Dynamic): Dynamic => {
            let value653: Dynamic = value73.current.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input,
            );
            value653 !== undefined &&
              value383.current?.({
                x: value653.x,
                y: value653.y,
                w: value653.w,
                h: value653.h,
              });
          },
          focus: (input?: Dynamic): Dynamic => {
            value274.current(input);
          },
          place: (input?: Dynamic, options?: Dynamic): Dynamic => {
            let items: Dynamic = [],
              value653: Dynamic = value73.current.artboards.map(
                (input2?: Dynamic): Dynamic => {
                  let value654: Dynamic = input.find(
                    (input3?: Dynamic): Dynamic => input3.file === input2.file,
                  );
                  if (value654 === undefined) return input2;
                  let state: Dynamic = {};
                  value654.x !== undefined &&
                    Math.round(value654.x) !== Math.round(input2.x) &&
                    (state.x = Math.round(value654.x));
                  value654.y !== undefined &&
                    Math.round(value654.y) !== Math.round(input2.y) &&
                    (state.y = Math.round(value654.y));
                  value654.w !== undefined &&
                    input2.frameless !== true &&
                    callback17(value654.w) !== Math.round(input2.w) &&
                    (state.w = callback17(value654.w));
                  value654.h !== undefined &&
                    input2.frameless !== true &&
                    callback17(value654.h) !== Math.round(input2.h) &&
                    (state.h = callback17(value654.h));
                  let value655: Dynamic = Object.keys(state);
                  return value655.length === 0
                    ? input2
                    : (items.push({
                        file: input2.file,
                        from: Object.fromEntries(
                          value655.map(
                            (input3?: Dynamic): Dynamic => [
                              input3,
                              input2[input3],
                            ],
                          ),
                        ),
                        to: state,
                      }),
                      {
                        ...input2,
                        ...state,
                      });
                },
              );
            return items.length === 0
              ? []
              : (value396.current(
                  {
                    kind: "transform",
                    label: "Resize",
                    boards: items,
                    anns: [],
                  },
                  new Set(),
                  undefined,
                  options,
                ),
                value98({
                  artboards: value653,
                }),
                items.map((input2?: Dynamic): Dynamic => input2.file));
          },
          rename: (
            input?: Dynamic,
            options?: Dynamic,
            context?: Dynamic,
          ): Dynamic => {
            let value653: Dynamic = (0, runtime.PlatformFileContentSlice)(
                options,
              ),
              value654: Dynamic = value73.current.artboards.find(
                (input2?: Dynamic): Dynamic => input2.file === input,
              );
            if (value653 === undefined || value654 === undefined) return false;
            let value655: Dynamic =
              value653 !== input.replace(/\.dc\.html$/, "")
                ? value653
                : undefined;
            return (value654.title ?? undefined) === value655
              ? false
              : (value396.current(
                  {
                    kind: "rename",
                    file: input,
                    from: value654.title,
                    to: value655,
                  },
                  new Set(),
                  undefined,
                  context,
                ),
                value98({
                  artboards: value73.current.artboards.map(
                    (input2?: Dynamic): Dynamic => {
                      if (input2.file !== input) return input2;
                      let { title: value656, ...value657 }: Dynamic = input2;
                      return value655 !== undefined
                        ? {
                            ...value657,
                            title: value655,
                          }
                        : value657;
                    },
                  ),
                }),
                true);
          },
          add: async (input?: Dynamic, options?: Dynamic): Promise<Dynamic> => {
            let value653: Dynamic =
                /^\/\*ask:page\*\/body\{(?:(?:background|color):(?:#[0-9a-fA-F]{3,8}|[a-z]{3,24}|(?:rgb|rgba|hsl|hsla)\([0-9.,%\s-]{1,60}(?:deg)?[0-9.,%\s-]{0,60}\))|font-family:(?:"[A-Za-z0-9 \-]{1,40}"|[a-z-]{1,12})(?:,(?:"[A-Za-z0-9 \-]{1,40}"|[a-z-]{1,12})){0,2})(?:;(?:(?:background|color):(?:#[0-9a-fA-F]{3,8}|[a-z]{3,24}|(?:rgb|rgba|hsl|hsla)\([0-9.,%\s-]{1,60}(?:deg)?[0-9.,%\s-]{0,60}\))|font-family:(?:"[A-Za-z0-9 \-]{1,40}"|[a-z-]{1,12})(?:,(?:"[A-Za-z0-9 \-]{1,40}"|[a-z-]{1,12})){0,2})){0,2}\}\/\*ask:page-end\*\/$/i,
              state: Dynamic = {
                ...doc.content().files,
              },
              items: Dynamic = [...callback16()],
              items2: Dynamic = [];
            for (let value654 of input as Dynamic) {
              let value655: Dynamic = (0, runtime.uniqueArtboardFile)(
                  state,
                  "Artboard",
                  supportsLoadState,
                ),
                value656: Dynamic = value653.test(value654.pageRule ?? "")
                  ? (0, runtime.blankDcDocument)().replace(
                      /[ \t]*<\/style>/,
                      (input2?: Dynamic): Dynamic =>
                        value654.pageRule +
                        `
` +
                        input2,
                    )
                  : (0, runtime.blankDcDocument)(),
                value657: Dynamic =
                  value654.body.trim() === ""
                    ? value656
                    : value656.replace(
                        /[ \t]*<section class="stage"[^>]*><\/section>/,
                        (): Dynamic => value654.body,
                      );
              state[value655] = value657;
              let value658: Dynamic =
                  typeof value654.x == "number" &&
                  typeof value654.y == "number" &&
                  Number.isFinite(value654.x) &&
                  Number.isFinite(value654.y)
                    ? {
                        x: value654.x,
                        y: value654.y,
                      }
                    : nextArtboardPlacementPoint(items),
                state2: Dynamic = {
                  file: value655,
                  x: Math.round(value658.x),
                  y: Math.round(value658.y),
                  w: callback17(value654.w),
                  h: callback17(value654.h),
                  title:
                    (0, runtime.PlatformFileContentSlice)(value654.title) ??
                    (0, runtime.nextArtboardTitle)(items),
                  ...value452.current(),
                };
              items.push(state2);
              items2.push({
                file: value655,
                src: value657,
                spec: state2,
              });
            }
            if (
              items2.length === 0 ||
              Object.keys(doc.content().files).length + items2.length >
                runtime.PlatformFileContentFilesValue
            )
              return [];
            let values: Dynamic = new Set();
            try {
              for (let value654 of items2 as Dynamic) {
                await (0, runtime.getKvClient)().set(
                  (0, runtime.PlatformFileContentHandler_4)(value654.file),
                  value654.src,
                );
                values.add(value654.file);
              }
            } catch {
              for (let value654 of values as Dynamic)
                await (0, runtime.getKvClient)()
                  .delete((0, runtime.PlatformFileContentHandler_4)(value654))
                  .catch((): Dynamic => false);
              return [];
            }
            value98({
              artboards: [
                ...value73.current.artboards.filter(
                  (input2?: Dynamic): Dynamic => !values.has(input2.file),
                ),
                ...items2.map((input2?: Dynamic): Dynamic => input2.spec),
              ],
            });
            value396.current(
              {
                kind: "add",
                entries: items2,
              },
              values,
              undefined,
              options,
            );
            return items2.map((input2?: Dynamic): Dynamic => input2.file);
          },
          duplicate: async (
            input?: Dynamic,
            options?: Dynamic,
            context?: Dynamic,
          ): Promise<Dynamic> => {
            let values: Dynamic = new Set(
                value73.current.artboards.map(
                  (input2?: Dynamic): Dynamic => input2.file,
                ),
              ),
              items: Dynamic = [...callback16()],
              value653: Dynamic = input.flatMap(
                (
                  { file: file, title: title }: Dynamic,
                  options2?: Dynamic,
                ): Dynamic => {
                  let value654: Dynamic = items.find(
                    (input2?: Dynamic): Dynamic => input2.file === file,
                  );
                  if (value654 === undefined) return [];
                  let value655: Dynamic = context?.[options2],
                    value656: Dynamic =
                      value655 !== undefined &&
                      Number.isFinite(value655.x) &&
                      Number.isFinite(value655.y)
                        ? {
                            x: Math.round(value655.x),
                            y: Math.round(value655.y),
                          }
                        : nextArtboardPlacementPoint(items);
                  items.push({
                    ...value654,
                    file: file + "#copy",
                    x: value656.x,
                    y: value656.y,
                  });
                  return [
                    {
                      file: file,
                      x: value656.x,
                      y: value656.y,
                      title: title,
                    },
                  ];
                },
              );
            return value653.length === 0
              ? []
              : (value451.current(value653, [], options),
                await callback15(
                  (): Dynamic =>
                    value73.current.artboards.length >=
                    values.size + value653.length,
                ),
                value73.current.artboards
                  .map((input2?: Dynamic): Dynamic => input2.file)
                  .filter((input2?: Dynamic): Dynamic => !values.has(input2)));
          },
          remove: async (
            input?: Dynamic,
            options?: Dynamic,
          ): Promise<Dynamic> => {
            let values: Dynamic = new Set(
              input.filter(
                (input2?: Dynamic): Dynamic =>
                  value73.current.artboards.some(
                    (input3?: Dynamic): Dynamic => input3.file === input2,
                  ),
              ),
            );
            return values.size === 0 ||
              !value450.current(values, undefined, options)
              ? 0
              : (await callback15(
                  (): Dynamic =>
                    !value73.current.artboards.some(
                      (input2?: Dynamic): Dynamic => values.has(input2.file),
                    ),
                ),
                [...values].filter(
                  (input2?: Dynamic): Dynamic =>
                    !value73.current.artboards.some(
                      (input3?: Dynamic): Dynamic => input3.file === input2,
                    ),
                ).length);
          },
        };
      }, [doc, value98, supportsLoadState, value156]),
      value455: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async function value653(input?: Dynamic): Promise<Dynamic> {
          let value654: Dynamic = (0, runtime.canvasPageDeleteSnapshot)(
            value73.current,
            input,
          );
          if (!value654 || !value224.current) return;
          if (value654.files.size + value654.notes.size > 0) {
            let value656: Dynamic = await (0, runtime.confirmCanvasAction)(
              (0, runtime.canvasPageDeleteConfirmation)(
                value654.spec.name,
                value654.files.size,
                value654.notes.size,
                (0, runtime.keyboardShortcutLabel)("Z"),
              ),
            );
            (0, runtime.clearEscapeReleaseSuppression)();
            value286.current?.focus({
              preventScroll: true,
            });
            if (!value656) return;
          }
          let value655: Dynamic = (0, runtime.canvasPageDeleteSnapshot)(
            value73.current,
            input,
          );
          if (!value655) {
            let value656: Dynamic = value224.current
              ? (value73.current.pages ?? []).find(
                  (input2?: Dynamic): Dynamic => input2.id === input,
                )
              : undefined;
            value656 && showToast(staleDeleteFailureMessage(value656.name));
            return;
          }
          if (value224.current) {
            if (
              [...value655.files].some(
                (input2?: Dynamic): Dynamic => !value654.files.has(input2),
              ) ||
              [...value655.notes].some(
                (input2?: Dynamic): Dynamic => !value654.notes.has(input2),
              )
            )
              return value653(input);
            value450.current(value655.files, value655.notes, undefined, {
              spec: value655.spec,
              index: value655.index,
            });
            requestAnimationFrame((): Dynamic => {
              ((document as Dynamic).activeElement ===
                (document as Dynamic).body ||
                (document as Dynamic).activeElement === null) &&
                value286.current?.focus({
                  preventScroll: true,
                });
            });
          }
        },
        [],
      ),
      value456: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      value457: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          if (input !== focusedFileRef.current) return;
          let value653: Dynamic = Date.now();
          value653 - value456.current < 1500 ||
            ((value456.current = value653),
            value188(
              context === "self"
                ? options < 2
                  ? "That element is a repeating row driven by code, so it can\u2019t be dragged on the canvas."
                  : "That element repeats \xD7" +
                    String(options) +
                    " \u2014 its copies are one shared design, so it can\u2019t be dragged out on its own."
                : "That layout has repeating rows that can\u2019t be pinned in place \u2014 dragging out of it would scramble them, so it stays put.",
            ));
        },
        [value188],
      ),
      value458: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          abandonSelectionGesture();
          if (
            input.files.size > 0 &&
            value449(input.files, input.notes, options)
          )
            return true;
          if (input.notes.size === 0) return false;
          if (input.notes.size === 1)
            return value321([...input.notes][0], options);
          let value653: Dynamic = value73.current.annotations ?? [],
            value654: Dynamic = value653.flatMap(
              (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                input.notes.has(input2.id)
                  ? [
                      {
                        spec: input2,
                        index: options2,
                      },
                    ]
                  : [],
            );
          return value654.length === 0
            ? false
            : (value413(
                {
                  kind: "delete",
                  entries: [],
                  anns: value654,
                },
                new Set(),
                undefined,
                options,
              ),
              value98({
                ...value73.current,
                annotations: value653.filter(
                  (input2?: Dynamic): Dynamic => !input.notes.has(input2.id),
                ),
              }),
              (0, runtime.announce)(
                (0, runtime.objectsDeletedAnnouncement)(value654.length),
              ),
              true);
        },
        [value449, value321, value98, value413, abandonSelectionGesture],
      ),
      value459: Dynamic = (0, runtime.reactChromeTheme.useRef)(value458);
    value459.current = value458;
    let value460: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          (async (): Promise<Dynamic> => {
            try {
              let value653: Dynamic = value67.artboards.filter(
                  (input2?: Dynamic): Dynamic => input.has(input2.file),
                ),
                value654: Dynamic = (value67.annotations ?? []).filter(
                  (input2?: Dynamic): Dynamic => options.has(input2.id),
                );
              if (value653.length === 0 && value654.length === 0) {
                setTimeout(
                  (): Dynamic =>
                    (0, runtime.rememberClipboardStamp)(context?.()?.stamp),
                  0,
                );
                return;
              }
              await Promise.all(
                value653.map(
                  (input2?: Dynamic): Dynamic =>
                    value177.current.get(input2.file)?.flushPending(),
                ),
              );
              let files: Dynamic = doc.content().files,
                value655: Dynamic = value654.map(
                  (input2?: Dynamic): Dynamic =>
                    (0, runtime.annotationVisibleBounds)(input2),
                ),
                value656: Dynamic = Math.min(
                  ...value653.map((input2?: Dynamic): Dynamic => input2.x),
                  ...value655.map((input2?: Dynamic): Dynamic => input2.x),
                ),
                value657: Dynamic = Math.min(
                  ...value653.map((input2?: Dynamic): Dynamic => input2.y),
                  ...value655.map((input2?: Dynamic): Dynamic => input2.y),
                ),
                value658: Dynamic = value654.map(
                  (input2?: Dynamic, options2?: Dynamic): Dynamic => {
                    let value659: Dynamic = value655[options2];
                    return {
                      spec: input2,
                      dx: value659.x - value656,
                      dy: value659.y - value657,
                      w: value659.w,
                      h: value659.h,
                    };
                  },
                ),
                items: Dynamic = [];
              for (let value659 of value653 as Dynamic) {
                let value660: Dynamic =
                  (await (0, runtime.getKvClient)().get(
                    (0, runtime.PlatformFileContentHandler_4)(value659.file),
                  )) ?? files[value659.file];
                typeof value660 != "string" ||
                  (0, runtime.isLoadingArtboardHtml)(value660) ||
                  items.push({
                    src: value660,
                    stem: value659.file.replace(/\.dc\.html$/, ""),
                    dx: value659.x - value656,
                    dy: value659.y - value657,
                    w: value659.w,
                    h: value659.h,
                    ...(value659.title
                      ? {
                          title: value659.title,
                        }
                      : {}),
                    ...(0, runtime.artboardAppearanceProperties)(value659),
                  });
              }
              items.length > 0 || (value658.length > 0 && value653.length === 0)
                ? (0, runtime.setArtboardClipboard)(
                    items,
                    context?.(),
                    value658,
                  )
                : (0, runtime.rememberClipboardStamp)(context?.()?.stamp);
            } catch {
              (0, runtime.rememberClipboardStamp)(context?.()?.stamp);
            }
          })();
        },
        [value67, doc],
      ),
      value461: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Set()),
      value462: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (items?: Dynamic, items2?: Dynamic, context?: Dynamic): Dynamic => {
          let value653: Dynamic = (0, runtime.pasteCascadeStep)(
            value105.get().scale,
          );
          (async (): Promise<Dynamic> => {
            let items3: Dynamic = [];
            try {
              let state: Dynamic = {
                ...doc.content().files,
              };
              if (
                Object.keys(state).length + items.length >
                runtime.PlatformFileContentFilesValue
              ) {
                showToast(
                  `Couldn't paste: this canvas would pass its ${String(runtime.PlatformFileContentFilesValue)}-file limit. Delete something first.`,
                  "error",
                );
                return;
              }
              items.length > 0 && (value310.current = true);
              for (let value661 of items as Dynamic) {
                let value662: Dynamic = (0, runtime.uniqueArtboardFile)(
                  state,
                  value661.stem,
                  supportsLoadState,
                );
                state[value662] = value661.src;
                items3.push(value662);
                value461.current.add(value662);
                try {
                  await (0, runtime.getKvClient)().set(
                    (0, runtime.PlatformFileContentHandler_4)(value662),
                    value661.src,
                  );
                } catch (value663: Dynamic) {
                  for (let value664 of items3 as Dynamic)
                    await (0, runtime.getKvClient)()
                      .delete(
                        (0, runtime.PlatformFileContentHandler_4)(value664),
                      )
                      .catch((): Dynamic => false);
                  throw value663;
                }
              }
              let value654: Dynamic = (0, runtime.designPageContents)(
                  value73.current,
                  value80.current,
                ),
                value655: Dynamic = value654.artboards.filter(
                  (input?: Dynamic): Dynamic =>
                    !value461.current.has(input.file),
                ),
                value656: Dynamic = context
                  ? (0, runtime.avoidPastedObjectCollisions)(
                      (0, runtime.pastedObjectsOrigin)(
                        [...items, ...items2],
                        context,
                      ),
                      items,
                      value655,
                      value653,
                    )
                  : nextArtboardPlacementPoint([
                      ...value655,
                      ...value91.current,
                      ...(value654.annotations ?? []).map(
                        runtime.annotationVisibleBounds,
                      ),
                    ]),
                items4: Dynamic = [];
              items.forEach((input?: Dynamic, options?: Dynamic): Dynamic => {
                items4.push({
                  file: items3[options],
                  x: Math.round(value656.x + input.dx),
                  y: Math.round(value656.y + input.dy),
                  w: input.w,
                  h: input.h,
                  title: (0, runtime.duplicateArtboardTitle)(
                    input.title ?? input.stem,
                    [...value655, ...items4],
                  ),
                  ...(0, runtime.artboardAppearanceProperties)(input),
                  ...callback3(),
                });
              });
              let value657: Dynamic = items.map(
                  (input?: Dynamic): Dynamic => input.src,
                ),
                value658: Dynamic = value73.current.annotations ?? [],
                value659: Dynamic =
                  value658.length + items2.length <=
                  runtime.PlatformFileContentLimit_5,
                value660: Dynamic = value659
                  ? callback9(
                      items2.map((input?: Dynamic): Dynamic => {
                        let { page: spec, ...spec2 }: Dynamic = input.spec,
                          value661: Dynamic = (0,
                          runtime.annotationVisibleBounds)(input.spec);
                        return {
                          src: {
                            ...spec2,
                            ...callback3(),
                          },
                          x: value656.x + input.dx + (spec2.x - value661.x),
                          y: value656.y + input.dy + (spec2.y - value661.y),
                        };
                      }),
                    )
                  : [];
              !value659 &&
                items2.length > 0 &&
                showToast(
                  (items4.length > 0
                    ? "The artboards were pasted; the notes and shapes were not"
                    : "Couldn't paste") +
                    " \u2014 this canvas is at its limit for notes and shapes (" +
                    String(runtime.PlatformFileContentLimit_5) +
                    ").",
                  "error",
                );
              if (items4.length === 0 && value660.length === 0) return;
              let values: Dynamic = new Set(
                items4.map((input?: Dynamic): Dynamic => input.file),
              );
              value98({
                artboards: [
                  ...value73.current.artboards.filter(
                    (input?: Dynamic): Dynamic => !values.has(input.file),
                  ),
                  ...items4,
                ],
                ...(value660.length > 0
                  ? {
                      annotations: [...value658, ...value660],
                    }
                  : {}),
              });
              value413(
                {
                  kind: "add",
                  entries: items4.map(
                    (input?: Dynamic, options?: Dynamic): Dynamic => ({
                      file: input.file,
                      src: value657[options] ?? "",
                      spec: input,
                    }),
                  ),
                  ...(value660.length > 0
                    ? {
                        anns: value660,
                        label: "Paste",
                      }
                    : {}),
                },
                values,
              );
              items4.length === 0 && value62();
              setSelection(
                (0, runtime.selectionFromBoards)({
                  files: values,
                  notes: new Set(
                    value660.map((input?: Dynamic): Dynamic => input.id),
                  ),
                }),
              );
              items4.length > 0 &&
                (0, runtime.frameAnalyticsReporter)(
                  runtime.designAnalyticsEvents.artboardInserted,
                );
              !context &&
                !value345.current &&
                !value218.current &&
                value383.current(
                  (0, runtime.pastedObjectsBounds)([
                    ...items4,
                    ...value660.map(runtime.annotationVisibleBounds),
                  ]),
                );
            } catch (value654: Dynamic) {
              console.error("[design/paste]", value654);
              showToast("Couldn't paste.", "error");
            } finally {
              for (let value654 of items3 as Dynamic)
                value461.current.delete(value654);
            }
          })();
        },
        [doc, value98, value413, showToast, value62, value105],
      ),
      value463: Dynamic = (0, runtime.reactChromeTheme.useRef)(value460);
    value463.current = value460;
    let value464: Dynamic = (0, runtime.reactChromeTheme.useRef)(value462);
    value464.current = value462;
    let value465: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let artboards: Dynamic = value73.current.artboards,
            value653: Dynamic = (0, runtime.buildArtboardClipboard)(
              artboards.filter(
                (input2?: Dynamic): Dynamic => input.has(input2.file),
              ),
              artboards,
              doc.content().files,
              runtime.getCachedBlobObjectUrl,
              (0, runtime.getExternalFileReferences)(),
            );
          if (!value653 && input.size > 0) return {};
          if (value653?.tooLarge) {
            value188(
              `Copied. This selection is too large to paste into another canvas (limit ${String(runtime.ClipboardArtboardsResolvedValue >> 20)} MB). Paste here still works; copy fewer artboards to take them elsewhere.`,
            );
            return {};
          }
          let value654: Dynamic = (value73.current.annotations ?? []).filter(
              (input2?: Dynamic): Dynamic => options.has(input2.id),
            ),
            callback15: Dynamic = (input2?: Dynamic): Dynamic =>
              (0, runtime.getCachedBlobObjectUrl)(input2) ??
              ((0, runtime.fetchBlobAsset)(input2).catch((): Dynamic => {}),
              undefined),
            value655: Dynamic = (0, runtime.annotationClipboardEntries)(
              value654,
              value653?.origin ?? null,
              runtime.ClipboardArtboardsResolvedValue -
                (value653?.json.length ?? 0),
              !value653,
              {
                read: callback15,
                assets: value653?.clip.assets ?? {},
              },
            ),
            callback16: Dynamic = (input2?: Dynamic): Dynamic =>
              input2 === 1
                ? "Copied. One uploaded file wasn't read yet, so another canvas would go without it. Copy again in a moment."
                : `Copied. ${String(input2)} uploaded files weren't read yet, so another canvas would go without them. Copy again in a moment.`,
            callback17: Dynamic = (input2?: Dynamic): Dynamic =>
              input2 === 1
                ? "Copied. One uploaded file can't travel to another canvas (only images, stylesheets, scripts, fonts and JSON under 4 MB do); add it again there."
                : `Copied. ${String(input2)} uploaded files can't travel to another canvas (only images, stylesheets, scripts, fonts and JSON under 4 MB do); add them again there.`,
            { left: value656 }: Dynamic = value655;
          if (!value653) {
            value655.tooLarge
              ? value188(
                  value655.tooLarge === "bounds"
                    ? runtime.ClipboardFileTransferRegistry.tooManyNotesToCopy
                    : runtime.ClipboardFileTransferRegistry.tooLargeToCopy,
                )
              : value656.notRead > 0
                ? value188(
                    runtime.ClipboardFileTransferRegistry.picturesNotReady(
                      value656.notRead,
                    ),
                  )
                : value656.cannot > 0
                  ? value188(
                      runtime.ClipboardFileTransferRegistry.picturesCantGo(
                        value656.cannot,
                      ),
                    )
                  : value656.noRoom > 0
                    ? value188(
                        runtime.ClipboardFileTransferRegistry.picturesWontFit(
                          value656.noRoom,
                        ),
                      )
                    : value656.overCap > 0 &&
                      value188(
                        runtime.ClipboardFileTransferRegistry.picturesOverCap(
                          value656.overCap,
                        ),
                      );
            return {
              ...value655.fields,
              ...(Object.keys(value655.assets).length > 0
                ? {
                    assets: value655.assets,
                  }
                : {}),
            };
          }
          let callback18: Dynamic = (input2?: Dynamic): Dynamic =>
              value188(
                input2 +
                  (value655.tooLarge
                    ? runtime.ClipboardFileTransferRegistry.notesStayedToo
                    : ""),
              ),
            length: Dynamic = value653.clip.artboards.filter(
              (input2?: Dynamic): Dynamic =>
                value177.current
                  .get(input2.stem + ".dc.html")
                  ?.hasPendingEdits(),
            ).length;
          length > 0
            ? callback18(
                length === 1
                  ? "Copied. One artboard has unsaved edits, so another canvas would get its last saved version. Click outside it, then copy again."
                  : `Copied. ${String(length)} artboards have unsaved edits, so another canvas would get their last saved versions. Click outside them, then copy again.`,
              )
            : value653.missingAssets > 0
              ? callback18(
                  callback16(value653.missingAssets + value656.notRead),
                )
              : value656.notRead > 0
                ? callback18(
                    runtime.ClipboardFileTransferRegistry.picturesNotReady(
                      value656.notRead,
                    ),
                  )
                : value653.unsupportedAssets > 0
                  ? callback18(
                      callback17(value653.unsupportedAssets + value656.cannot),
                    )
                  : value656.cannot > 0
                    ? callback18(
                        runtime.ClipboardFileTransferRegistry.picturesCantGo(
                          value656.cannot,
                        ),
                      )
                    : value656.noRoom > 0
                      ? callback18(
                          runtime.ClipboardFileTransferRegistry.picturesWontFit(
                            value656.noRoom,
                          ),
                        )
                      : value655.tooLarge &&
                        value188(
                          runtime.ClipboardFileTransferRegistry
                            .tooLargeBesideArtboards,
                        );
          return {
            ...value653.clip,
            assets: {
              ...value653.clip.assets,
              ...value655.assets,
            },
            ...value655.fields,
          };
        },
        [doc, value188],
      ),
      value466: Dynamic = (0, runtime.reactChromeTheme.useRef)(value465);
    value466.current = value465;
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      if (!(0, runtime.canvasElementSelectionCount)(selection)) return;
      let artboards: Dynamic = selection.artboards,
        notes: Dynamic = selection.notes,
        callback15: Dynamic = (): Dynamic => {
          let artboards2: Dynamic = value73.current.artboards,
            value654: Dynamic = (0, runtime.annotationImageReferences)(
              (value73.current.annotations ?? []).filter(
                (input?: Dynamic): Dynamic => notes.has(input.id),
              ),
            );
          for (let value655 of [
            ...(artboards.size > 0
              ? (0, runtime.clipboardBlobAssets)(
                  artboards2.filter(
                    (input?: Dynamic): Dynamic => artboards.has(input.file),
                  ),
                  artboards2,
                  doc.content().files,
                  (0, runtime.getExternalFileReferences)(),
                )
              : []),
            ...value654,
          ] as Dynamic)
            (0, runtime.getCachedBlobObjectUrl)(value655) === undefined &&
              (0, runtime.fetchBlobAsset)(value655).catch((): Dynamic => {});
        };
      if (artboards.size === 0 && notes.size === 1) return callback15();
      let value653: Dynamic = setTimeout(callback15, 150);
      return (): Dynamic => clearTimeout(value653);
    }, [selection, doc]);
    let value467: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          if (!value224.current) return;
          if (value369.current) {
            value188(runtime.ClipboardFileTransferRegistry.stillPasting);
            return;
          }
          let callback15: Dynamic = (
              input2?: Dynamic,
              options2?: Dynamic,
            ): Dynamic =>
              input2.aborted
                ? "Paste cancelled: this canvas was closed meanwhile."
                : value224.current
                  ? options2 !== undefined &&
                    options2 !== "" &&
                    !(value73.current.pages ?? []).some(
                      (input3?: Dynamic): Dynamic => input3.id === options2,
                    )
                    ? "Paste cancelled: the page you pasted into was deleted meanwhile."
                    : null
                  : "Paste cancelled: this canvas stopped being editable meanwhile.",
            callback16: Dynamic = (
              input2?: Dynamic,
              options2?: Dynamic,
            ): Dynamic => ({
              gate: runtime.validateCanvasPlacedImage,
              upload: (input3?: Dynamic): Dynamic =>
                (0, runtime.uploadDesignFile)("appifact", null, input3),
              stored: input2,
              discard: (input3?: Dynamic): Dynamic => {
                (0, runtime.getKvClient)()
                  .delete((0, runtime.PlatformFileContentHandler_4)(input3))
                  .catch((): Dynamic => false);
              },
              maxPixels: (0, runtime.ClipboardAssetsHandler)(options2),
            }),
            callback17: Dynamic = (
              items?: Dynamic,
              options2?: Dynamic,
              context?: Dynamic,
            ): Dynamic => {
              if (
                (value73.current.annotations ?? []).length +
                  items.length +
                  options2.carried.length >
                runtime.PlatformFileContentLimit_5
              )
                return void showToast(
                  runtime.ClipboardFileTransferRegistry.atLimit,
                  "error",
                );
              let current5: Dynamic = value80.current,
                value657: Dynamic = value105.rest(),
                controller2: Dynamic = new AbortController(),
                callback20: Dynamic = (): Dynamic => {};
              value369.current = {
                ctrl: controller2,
                done: new Promise((input2?: Dynamic): Dynamic => {
                  callback20 = input2;
                }),
              };
              (async (): Promise<Dynamic> => {
                let items2: Dynamic = [],
                  flag2: Dynamic = false,
                  callback21: Dynamic = async (
                    input2?: Dynamic,
                  ): Promise<Dynamic> => {
                    for (let value658 of input2 as Dynamic)
                      await (0, runtime.getKvClient)()
                        .delete(
                          (0, runtime.PlatformFileContentHandler_4)(value658),
                        )
                        .catch((): Dynamic => false);
                  };
                try {
                  value188(
                    runtime.ClipboardFileTransferRegistry.bringing(
                      options2.carried.length,
                    ),
                  );
                  let { landed: value658, failed: value659 }: Dynamic =
                      await (0, runtime.resolveClipboardPictures)(
                        options2.carried,
                        options2.assets,
                        controller2.signal,
                        callback16(
                          (input2?: Dynamic): Dynamic => items2.push(input2),
                          runtime.ClipboardAnnotationsLimit,
                        ),
                      ),
                    value660: Dynamic = callback15(
                      controller2.signal,
                      current5,
                    ),
                    { group: value661 }: Dynamic = (0,
                    runtime.normalizeAnnotationPasteOrigin)(
                      [...items, ...value658].sort(
                        (input2?: Dynamic, options3?: Dynamic): Dynamic =>
                          input2.order - options3.order,
                      ),
                    );
                  if (value660 !== null || value661.length === 0) {
                    value188(value660 ?? options2.said([], [], value659));
                    return void (await callback21(items2));
                  }
                  let value662: Dynamic =
                      current5 === ""
                        ? (value73.current.pages?.[0]?.id ?? "")
                        : current5,
                    value663: Dynamic = (0, runtime.designPageContents)(
                      value73.current,
                      value662,
                    ),
                    value664: Dynamic = context
                      ? (0, runtime.pastedObjectsOrigin)(value661, context)
                      : nextArtboardPlacementPoint([
                          ...value663.artboards,
                          ...(value663.annotations ?? []).map(
                            runtime.annotationVisibleBounds,
                          ),
                        ]),
                    value665: Dynamic = value73.current.annotations ?? [],
                    value666: Dynamic = value661.map(
                      (input2?: Dynamic): Dynamic => {
                        let value670: Dynamic = (0,
                        runtime.annotationVisibleBounds)(input2.spec);
                        return {
                          src: {
                            ...input2.spec,
                            ...callback3(current5),
                          },
                          x:
                            value664.x +
                            input2.dx +
                            (input2.spec.x - value670.x),
                          y:
                            value664.y +
                            input2.dy +
                            (input2.spec.y - value670.y),
                        };
                      },
                    ),
                    value667: Dynamic =
                      value665.length + value666.length <=
                      runtime.PlatformFileContentLimit_5,
                    value668: Dynamic = value667 ? callback9(value666) : [];
                  if (
                    !value667 ||
                    !(0, runtime.ClipboardPastePlanningAnnotations)(
                      value73.current,
                      value668,
                    )
                  ) {
                    showToast(
                      value667
                        ? runtime.ClipboardFileTransferRegistry.wontFitPictures
                        : runtime.ClipboardFileTransferRegistry.atLimit,
                      "error",
                    );
                    return void (await callback21(items2));
                  }
                  flag2 = true;
                  value98({
                    artboards: value73.current.artboards,
                    annotations: [...value665, ...value668],
                  });
                  let files: Dynamic = doc.content().files;
                  value413(
                    {
                      kind: "add",
                      entries: [],
                      anns: value668,
                      label: "Paste",
                      files: items2
                        .filter(
                          (input2?: Dynamic): Dynamic =>
                            typeof files[input2] == "string",
                        )
                        .map(
                          (input2?: Dynamic): Dynamic => ({
                            path: input2,
                            src: files[input2],
                          }),
                        ),
                    },
                    new Set(),
                  );
                  value80.current === value662 &&
                    (value62(),
                    setSelection(
                      (0, runtime.selectionFromBoards)({
                        files: new Set(),
                        notes: new Set(
                          value668.map(
                            (input2?: Dynamic): Dynamic => input2.id,
                          ),
                        ),
                      }),
                    ),
                    !context &&
                      !value345.current &&
                      !value218.current &&
                      (0, runtime.sameViewport)(value105.rest(), value657) &&
                      value383.current(
                        (0, runtime.pastedObjectsBounds)(
                          value668.map(runtime.annotationVisibleBounds),
                        ),
                      ));
                  let value669: Dynamic = options2.said(
                    value668,
                    value658,
                    value659,
                  );
                  value80.current === value662 &&
                  (0, runtime.ClipboardFileTransferPasted)(value669, value668)
                    ? value189(value669)
                    : value188(value669);
                } catch (value658: Dynamic) {
                  console.error("[design/paste]", value658);
                  flag2 || (await callback21(items2));
                  showToast("Couldn't paste.", "error");
                } finally {
                  value369.current = null;
                  callback20();
                }
              })();
            };
          if (!(0, runtime.ClipboardStateIsArray)(input)) {
            let value657: Dynamic = (0, runtime.parseAnnotationPaste)(
              input,
              (items?: Dynamic): Dynamic =>
                (0, runtime.ClipboardPastePlanningAnnotations)(
                  value73.current,
                  items.map(
                    (input2?: Dynamic): Dynamic => ({
                      ...input2,
                      ...callback3(),
                    }),
                  ),
                  128 * items.length,
                ),
            );
            if (value657.land === null)
              value657.error
                ? showToast(value657.say, "error")
                : value188(value657.say);
            else if (value657.pictures !== undefined)
              callback17(value657.land, value657.pictures, value109());
            else {
              let current5: Dynamic = value73.current;
              value464.current(
                [],
                (0, runtime.normalizeAnnotationPasteOrigin)(value657.land)
                  .group,
                value109(),
              );
              if (value73.current === current5) return;
              (0, runtime.ClipboardFileTransferPasted)(
                value657.say,
                value657.land.map((input2?: Dynamic): Dynamic => input2.spec),
              )
                ? value189(value657.say)
                : value188(value657.say);
            }
            return;
          }
          let value653: Dynamic = (0, runtime.ClipboardPastePlanningIsArray)(
              input,
            )
              ? runtime.ClipboardFileTransferRegistry.notEither
              : "",
            value654: Dynamic = (0, runtime.parseArtboardClipboard)(input);
          if (!value654) {
            value188(
              "Nothing to paste: the copied artboards could not be read." +
                value653,
            );
            return;
          }
          let callback18: Dynamic = (items?: Dynamic): Dynamic =>
              items.length > 60 ? items.slice(0, 57) + "\u2026" : items,
            current4: Dynamic = value80.current,
            value655: Dynamic = value105.rest(),
            value656: Dynamic = (0, runtime.pasteCascadeStep)(
              value105.get().scale,
            ),
            controller: Dynamic = new AbortController(),
            callback19: Dynamic = (): Dynamic => {};
          value369.current = {
            ctrl: controller,
            done: new Promise((input2?: Dynamic): Dynamic => {
              callback19 = input2;
            }),
          };
          (async (): Promise<Dynamic> => {
            let items: Dynamic = [];
            try {
              let value657: Dynamic = (await (0, runtime.awaitFeatureFlag)(
                crossCanvasPasteConfirmFeatureFlag,
                true,
              ))
                ? await (0, runtime.askTrustForCodePaste)(
                    value654.artboards.length,
                    controller.signal,
                  )
                : "with-code";
              if (value657 === "cancel") return;
              let value658: Dynamic = callback15(controller.signal);
              if (value658 !== null) return value188(value658);
              let value659: Dynamic = value657 === "with-code",
                value660: Dynamic = (0, runtime.parseAnnotationClipboard)(
                  input,
                ),
                value661: Dynamic = (0, runtime.buildAnnotationPaste)(
                  value660?.entries ?? [],
                  value659,
                  value660?.pictures ?? [],
                ),
                value662: Dynamic = value659
                  ? value654
                  : (0, runtime.blankArtboardBody)(value654),
                value663: Dynamic =
                  (value73.current.annotations ?? []).length +
                    value661.land.length +
                    value661.pictures.length <=
                  runtime.PlatformFileContentLimit_5,
                value664: Dynamic = value663
                  ? (0, runtime.parseClipboardAssets)(
                      input,
                      value661.pictures,
                      (0, runtime.clipboardPayloadUsage)(value654),
                    )
                  : new Map(),
                items2: Dynamic = [],
                value665: Dynamic = value659
                  ? 0
                  : Object.keys(value654.files).filter(
                      (input2?: Dynamic): Dynamic => /\.svg$/i.test(input2),
                    ).length +
                    Object.values(value654.assets).filter(
                      (input2?: Dynamic): Dynamic =>
                        /^data:image\/svg\+xml/i.test(input2),
                    ).length,
                callback20: Dynamic = (): Dynamic =>
                  (0, runtime.hasPendingFileOverlay)()
                    ? new Set(
                        [
                          ...Object.keys((0, runtime.getDesignSystemFiles)()),
                          ...(0, runtime.getAllFileReferencePaths)(),
                        ].map(
                          (input2?: Dynamic): Dynamic =>
                            input2.startsWith(runtime.ProjectValue)
                              ? input2.slice(runtime.ProjectValue.length)
                              : input2,
                        ),
                      )
                    : "unknown",
                callback21: Dynamic = (
                  input2?: Dynamic,
                  options2?: Dynamic,
                ): Dynamic =>
                  Object.keys(options2).length +
                    input2.boards.length +
                    Object.keys(input2.files).length >
                  runtime.PlatformFileContentFilesValue,
                value666: Dynamic = (0, runtime.getDocumentFileCap)(doc),
                value667: Dynamic = (0, runtime.preparePastedArtboardFiles)(
                  value662,
                  doc.content().files,
                  supportsLoadState,
                  callback20(),
                  value666,
                );
              if (callback21(value667, doc.content().files)) {
                showToast(
                  `Couldn't paste: this canvas would pass its ${String(runtime.PlatformFileContentFilesValue)}-file limit. Delete something first.` +
                    value653,
                  "error",
                );
                return;
              }
              let items3: Dynamic = [
                  ...Object.entries(value662.assets).map(
                    ([input2, input3]: Dynamic): Dynamic => [
                      input2,
                      input3,
                      "asset",
                    ],
                  ),
                  ...Object.entries(value667.images).map(
                    ([input2, input3]: Dynamic): Dynamic => [
                      input2,
                      input3,
                      "image",
                    ],
                  ),
                ],
                value668: Dynamic = items3.map(
                  ([, input2, input3]: Dynamic): Dynamic =>
                    input3 === "asset" &&
                    (0, runtime.ClipboardArtboardsTest_2)(input2),
                ),
                items4: Dynamic = [
                  ...items3.filter(
                    (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                      !value668[options2],
                  ),
                  ...items3.filter(
                    (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                      value668[options2],
                  ),
                ],
                entries: Dynamic = new Map(),
                entries2: Dynamic = new Map(),
                items5: Dynamic = [],
                values: Dynamic = new Set(),
                entries3: Dynamic = new Map(),
                values2: Dynamic = new Set(),
                value669: Dynamic = value662.fontsLeftOut ?? 0,
                callback22: Dynamic = async (
                  input2?: Dynamic,
                ): Promise<Dynamic> => {
                  let value695: Dynamic = await (0,
                  runtime.getAssetsCapability)();
                  if (value695 === null || typeof value695.upload != "function")
                    return;
                  let value696: Dynamic = input2.type.split(";")[0].trim(),
                    value697: Dynamic = await value695.upload(
                      new Blob([input2], {
                        type: value696,
                      }),
                      {
                        type: value696,
                      },
                    ),
                    value698: Dynamic =
                      typeof value697?.url == "string" &&
                      (0, runtime.isBlobAssetUrl)(value697.url)
                        ? value697.url
                        : typeof value697?.id == "string"
                          ? "_blob/" + value697.id
                          : undefined;
                  return value698 !== undefined &&
                    (0, runtime.isBlobAssetUrl)(value698)
                    ? value698
                    : undefined;
                },
                value670: Dynamic = items4.length + value664.size;
              if (value670 > 0) {
                let length3: Dynamic = value667.boards.length;
                value188(
                  (length3 === 1
                    ? "Pasting an artboard"
                    : `Pasting ${String(length3)} artboards`) +
                    `, bringing over ${String(value670)} file${value670 === 1 ? "" : "s"}\u2026`,
                );
              }
              if (items4.length > 0) {
                let index: Dynamic = 0,
                  callback27: Dynamic = async (): Promise<Dynamic> => {
                    for (
                      let value695: Dynamic = index++;
                      value695 < items4.length && !controller.signal.aborted;
                      value695 = index++
                    ) {
                      let [value696, value697, value698]: Dynamic =
                        items4[value695];
                      if (
                        value698 === "asset" &&
                        (0, runtime.ClipboardArtboardsTest_2)(value697)
                      ) {
                        let value701: Dynamic = await (0,
                        runtime.dataUrlToFontFile)(
                          value697,
                          "pasted-font-" + String(value695 + 1),
                        );
                        if (controller.signal.aborted) break;
                        let value702: Dynamic = value701
                          ? await callback22(value701).catch((): Dynamic => {})
                          : undefined;
                        value702 === undefined
                          ? (value669 += 1)
                          : entries.set(
                              value696,
                              value702.startsWith("blob:")
                                ? value702
                                : "/" + value702.replace(/^\//, ""),
                            );
                        continue;
                      }
                      let value699: Dynamic = (0, runtime.dataUrlToBlob)(
                        value697,
                        value698 === "asset"
                          ? "pasted-image-" + String(value695 + 1)
                          : (value696.split("/").pop() ?? value696).replace(
                              /\.[^.]+$/,
                              "",
                            ),
                      );
                      if (
                        value698 === "asset" &&
                        (0, runtime.ClipboardArtboardsTest)(value697)
                      ) {
                        let value701: Dynamic = value699
                          ? await callback22(value699).catch((): Dynamic => {})
                          : undefined;
                        value701 === undefined || !value699
                          ? values2.add(value696)
                          : (entries.set(
                              value696,
                              value701.startsWith("blob:")
                                ? value701
                                : "/" + value701.replace(/^\//, ""),
                            ),
                            entries3.set(value696, {
                              bytes: value699.size,
                              type: value699.type.split(";")[0].trim(),
                            }));
                        continue;
                      }
                      if (
                        !value699 ||
                        !(await (0, runtime.isPlayableImage)(value699))
                      ) {
                        values.add(value696);
                        continue;
                      }
                      if (controller.signal.aborted) break;
                      let value700: Dynamic = value697;
                      try {
                        value700 = (
                          await (0, runtime.uploadDesignFile)(
                            "appifact",
                            null,
                            value699,
                          )
                        ).src;
                        value700.startsWith("./") &&
                          (items5.push(value700.slice(2)),
                          items.push(value700.slice(2)));
                      } catch {}
                      (value698 === "asset" ? entries : entries2).set(
                        value696,
                        value700,
                      );
                    }
                  };
                await Promise.all(
                  Array.from(
                    {
                      length: Math.min(4, items4.length),
                    },
                    callback27,
                  ),
                );
              }
              let value671: Dynamic = value663
                  ? await (0, runtime.resolveClipboardPictures)(
                      value661.pictures,
                      value664,
                      controller.signal,
                      callback16((input2?: Dynamic): Dynamic => {
                        items2.push(input2);
                        items5.push(input2);
                        items.push(input2);
                      }, runtime.ClipboardArtboardsLimit),
                    )
                  : {
                      landed: [],
                      failed: 0,
                    },
                callback23: Dynamic = (
                  input2?: Dynamic,
                  options2?: Dynamic,
                ): Dynamic =>
                  (/\.([^./]+)$/.exec(input2)?.[1] ?? "").toLowerCase() +
                  ":" +
                  options2,
                values3: Dynamic = new Set();
              for (let [value695, value696] of Object.entries(
                value662.files,
              ) as Dynamic) {
                if (controller.signal.aborted) break;
                if (
                  !runtime.PlatformFileContentWebpAvifPattern.test(value695) ||
                  entries2.has(value695) ||
                  values.has(value695)
                )
                  continue;
                let value697: Dynamic = (0, runtime.dataUrlToBlob)(
                  (0, runtime.fileDataUrl)(value695, value696),
                  "carried",
                );
                (!value697 ||
                  !(await (0, runtime.isPlayableImage)(value697))) &&
                  values3.add(callback23(value695, value696));
              }
              let callback24: Dynamic = async (): Promise<Dynamic> => {
                  for (let value695 of items.splice(0) as Dynamic)
                    await (0, runtime.getKvClient)()
                      .delete(
                        (0, runtime.PlatformFileContentHandler_4)(value695),
                      )
                      .catch((): Dynamic => false);
                },
                value672: Dynamic = callback15(controller.signal, current4);
              if (value672 !== null) {
                value188(value672);
                return void (await callback24());
              }
              value667 = (0, runtime.preparePastedArtboardFiles)(
                value662,
                doc.content().files,
                supportsLoadState,
                callback20(),
                value666,
              );
              if (callback21(value667, doc.content().files)) {
                showToast(
                  `Couldn't paste: this canvas would pass its ${String(runtime.PlatformFileContentFilesValue)}-file limit. Delete something first.` +
                    value653,
                  "error",
                );
                return void (await callback24());
              }
              for (let [value695, value696] of Object.entries(
                value667.images,
              ) as Dynamic)
                entries2.has(value695) ||
                  values.has(value695) ||
                  (values3.has(callback23(value695, value662.files[value695]))
                    ? values.add(value695)
                    : entries2.set(value695, value696));
              let values4: Dynamic = new Set(
                Object.keys(doc.content().files).map(
                  (input2?: Dynamic): Dynamic => input2.toLowerCase(),
                ),
              );
              for (let value695 of values as Dynamic)
                value695 in value667.images &&
                  values4.has(value695.toLowerCase()) &&
                  entries2.set(
                    value695,
                    value695.replace(/(\.[^./]*)?$/, "-missing$1"),
                  );
              (0, runtime.remapPastedAssetFiles)(
                value667,
                entries,
                entries2,
                value666,
              );
              let value673: Dynamic = new TextEncoder(),
                value674: Dynamic = value667.boards.filter(
                  (input2?: Dynamic): Dynamic =>
                    value673.encode(input2.entry.src).length <=
                    runtime.PlatformFileContentResolvedValue_11,
                ),
                value675: Dynamic = value667.boards.length - value674.length;
              if (value674.length === 0) {
                showToast(
                  "Couldn't paste: every copied artboard is over the 2 MiB per-artboard limit once its images are inlined." +
                    value653,
                  "error",
                );
                return void (await callback24());
              }
              for (let [value695, value696] of Object.entries(
                value667.files,
              ) as Dynamic) {
                let value697: Dynamic =
                  value673.encode(value696).length > value666
                    ? "too large once its images were inlined"
                    : runtime.PlatformFileContentWebpAvifPattern.test(
                          value695,
                        ) && values3.has(callback23(value695, value696))
                      ? "not an image the editor can decode"
                      : null;
                value697 !== null &&
                  (delete value667.files[value695],
                  value667.dropped.push({
                    path: value695,
                    why: value697,
                  }));
              }
              value310.current = true;
              for (let [value695, value696] of Object.entries(
                value667.files,
              ) as Dynamic) {
                await (0, runtime.getKvClient)().set(
                  (0, runtime.PlatformFileContentHandler_4)(value695),
                  value696,
                );
                items.push(value695);
              }
              let value676: Dynamic =
                  current4 === ""
                    ? (value73.current.pages?.[0]?.id ?? "")
                    : current4,
                artboards: Dynamic = (0, runtime.designPageContents)(
                  value73.current,
                  value676,
                ).artboards,
                value677: Dynamic = value674.map(
                  (input2?: Dynamic): Dynamic => input2.entry,
                ),
                value678: Dynamic = [...value661.land, ...value671.landed].sort(
                  (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                    input2.order - options2.order,
                ),
                { group: value679, shift: value680 }: Dynamic = (0,
                runtime.normalizeAnnotationPasteOrigin)([
                  ...value677,
                  ...value678,
                ]),
                value681: Dynamic = options
                  ? (0, runtime.pastedObjectsOrigin)(value679, options)
                  : nextArtboardPlacementPoint(
                      value678.length > 0
                        ? [
                            ...artboards,
                            ...(
                              (0, runtime.designPageContents)(
                                value73.current,
                                value676,
                              ).annotations ?? []
                            ).map(runtime.annotationVisibleBounds),
                          ]
                        : artboards,
                    ),
                state: Dynamic = {
                  x: value681.x + value680.x,
                  y: value681.y + value680.y,
                },
                value682: Dynamic = options
                  ? (0, runtime.avoidPastedObjectCollisions)(
                      state,
                      value677,
                      artboards,
                      value656,
                    )
                  : state,
                items6: Dynamic = [];
              for (let {
                path: value695,
                entry: value696,
              } of value674 as Dynamic) {
                await (0, runtime.getKvClient)().set(
                  (0, runtime.PlatformFileContentHandler_4)(value695),
                  value696.src,
                );
                items.push(value695);
                let value697: Dynamic =
                    value696.title ??
                    value696.stem.split("/").pop() ??
                    value696.stem,
                  value698: Dynamic = [...artboards, ...items6].some(
                    (input2?: Dynamic): Dynamic =>
                      (input2.title ??
                        input2.file.replace(/\.dc\.html$/, "")) === value697,
                  );
                items6.push({
                  file: value695,
                  x: Math.round(value682.x + value696.dx),
                  y: Math.round(value682.y + value696.dy),
                  w: value696.w,
                  h: value696.h,
                  title: value698
                    ? (0, runtime.duplicateArtboardTitle)(value697, [
                        ...artboards,
                        ...items6,
                      ])
                    : value697,
                  ...(0, runtime.artboardAppearanceProperties)(value696),
                  ...callback3(current4),
                });
              }
              let values5: Dynamic = new Set(
                  items6.map((input2?: Dynamic): Dynamic => input2.file),
                ),
                items7: Dynamic = [
                  ...value73.current.artboards.filter(
                    (input2?: Dynamic): Dynamic => !values5.has(input2.file),
                  ),
                  ...items6,
                ],
                value683: Dynamic = value73.current.annotations ?? [],
                value684: Dynamic = value678.map(
                  (input2?: Dynamic): Dynamic => {
                    let value695: Dynamic = (0,
                    runtime.annotationVisibleBounds)(input2.spec);
                    return {
                      src: {
                        ...input2.spec,
                        ...callback3(current4),
                      },
                      x: value682.x + input2.dx + (input2.spec.x - value695.x),
                      y: value682.y + input2.dy + (input2.spec.y - value695.y),
                    };
                  },
                ),
                value685: Dynamic =
                  value663 &&
                  value684.length > 0 &&
                  value683.length + value684.length <=
                    runtime.PlatformFileContentLimit_5
                    ? callback9(value684)
                    : [],
                value686: Dynamic =
                  value685.length > 0 &&
                  (0, runtime.ClipboardPastePlanningAnnotations)(
                    {
                      ...value73.current,
                      artboards: items7,
                    },
                    value685,
                  )
                    ? value685
                    : [];
              items.length = 0;
              value98({
                artboards: items7,
                ...(value686.length > 0
                  ? {
                      annotations: [...value683, ...value686],
                    }
                  : {}),
              });
              let files: Dynamic = doc.content().files;
              value413(
                {
                  kind: "add",
                  entries: items6.map(
                    (input2?: Dynamic, options2?: Dynamic): Dynamic => ({
                      file: input2.file,
                      src: value674[options2].entry.src,
                      spec: input2,
                    }),
                  ),
                  files: [
                    ...Object.entries(value667.files).map(
                      ([input2, input3]: Dynamic): Dynamic => ({
                        path: input2,
                        src: input3,
                      }),
                    ),
                    ...items5
                      .filter(
                        (input2?: Dynamic): Dynamic =>
                          typeof files[input2] == "string" &&
                          (value686.length > 0 || !items2.includes(input2)),
                      )
                      .map(
                        (input2?: Dynamic): Dynamic => ({
                          path: input2,
                          src: files[input2],
                        }),
                      ),
                  ],
                  ...(value686.length > 0
                    ? {
                        anns: value686,
                        label: "Paste",
                      }
                    : {}),
                },
                values5,
              );
              if (value686.length === 0)
                for (let value695 of items2 as Dynamic)
                  await (0, runtime.getKvClient)()
                    .delete((0, runtime.PlatformFileContentHandler_4)(value695))
                    .catch((): Dynamic => false);
              value80.current === value676 &&
                setSelection(
                  value686.length > 0
                    ? (0, runtime.selectionFromBoards)({
                        files: values5,
                        notes: new Set(
                          value686.map(
                            (input2?: Dynamic): Dynamic => input2.id,
                          ),
                        ),
                      })
                    : (0, runtime.selectionFromArtboards)(values5),
                );
              items6.length > 0 &&
                (0, runtime.frameAnalyticsReporter)(
                  runtime.designAnalyticsEvents.artboardInserted,
                );
              !options &&
                value80.current === value676 &&
                !value345.current &&
                !value218.current &&
                (0, runtime.sameViewport)(value105.rest(), value655) &&
                value383.current((0, runtime.pastedObjectsBounds)(items6));
              let value687: Dynamic = Object.entries(
                  value662.held ?? {},
                ).filter(
                  (
                    [input2]: Dynamic,
                    options2?: Dynamic,
                    context?: Dynamic,
                  ): Dynamic =>
                    context.findIndex(
                      ([input3]: Dynamic): Dynamic =>
                        input3.toLowerCase() === input2.toLowerCase(),
                    ) === options2,
                ),
                values6: Dynamic = new Set(
                  [
                    ...Object.keys(doc.content().files),
                    ...(0, runtime.getAllFileReferencePaths)(),
                  ].map((input2?: Dynamic): Dynamic => input2.toLowerCase()),
                ),
                callback25: Dynamic = (input2?: Dynamic): Dynamic =>
                  !(0, runtime.hasPendingFileOverlay)() ||
                  values6.has(input2.toLowerCase());
              value224.current &&
                (await Promise.all(
                  value687.map(
                    async ([input2, input3]: Dynamic): Promise<Dynamic> => {
                      let entry: Dynamic = entries.get(input3),
                        entry2: Dynamic = entries3.get(input3);
                      if (entry === undefined || entry2 === undefined) return;
                      let value695: Dynamic = (0,
                      runtime.saveExternalFileReference)(
                        input2,
                        entry,
                        entry2.bytes,
                        entry2.type,
                        callback25,
                      );
                      await Promise.race([
                        value695,
                        new Promise(
                          (input4?: Dynamic, options2?: Dynamic): Dynamic =>
                            setTimeout(
                              (): Dynamic =>
                                options2(new Error("no answer from the store")),
                              8e3,
                            ),
                        ),
                      ]).catch((input4?: Dynamic): Dynamic => {
                        console.warn(
                          "design (paste): the pointer document for " +
                            input2 +
                            " was not written \u2014 " +
                            (0, runtime.errorMessage)(input4),
                        );
                        value667.dropped.push({
                          path: input2,
                          why: "its upload came over, but could not be recorded here",
                        });
                      });
                    },
                  ),
                ));
              let entries4: Dynamic = new Map();
              for (let value695 of values2 as Dynamic) {
                let value696: Dynamic = value687
                  .filter(([, input2]: Dynamic): Dynamic => input2 === value695)
                  .map(([input2]: Dynamic): Dynamic => input2);
                for (let value699 of value696 as Dynamic)
                  value667.dropped.push({
                    path: value699,
                    why: "this canvas would not take the upload",
                  });
                let value697: Dynamic = value662.assets[value695] ?? "",
                  value698: Dynamic = /^data:text\/css/i.test(value697)
                    ? "stylesheet"
                    : /^data:text\/javascript/i.test(value697)
                      ? "script"
                      : "data file";
                value696.length === 0 &&
                  entries4.set(value698, (entries4.get(value698) ?? 0) + 1);
              }
              for (let [value695, value696] of entries4 as Dynamic)
                value667.dropped.push({
                  path:
                    value696 === 1
                      ? "a " + value695
                      : String(value696) + " " + value695 + "s",
                  why: "this canvas would not take the upload",
                });
              let items8: Dynamic = [
                  ...Object.keys(
                    (0, runtime.mergeDesignSystemFileOverlay)(
                      doc.content().files,
                    ),
                  ),
                  "support.js",
                ],
                value688: Dynamic = [
                  ...new Set(
                    value674.flatMap(
                      (input2?: Dynamic): Dynamic =>
                        (0, runtime.getLinkedProjectFiles)(
                          input2.entry.src,
                          items8,
                        ),
                    ),
                  ),
                ].map(callback18),
                length: Dynamic = items6.length,
                callback26: Dynamic = (input2?: Dynamic): Dynamic =>
                  input2.path.split("/").pop() ?? input2.path,
                value689: Dynamic =
                  value667.dropped.length === 0
                    ? ""
                    : value667.dropped.every(
                          (input2?: Dynamic): Dynamic =>
                            input2.why === value667.dropped[0].why,
                        )
                      ? `; ${callback18(value667.dropped.map(callback26).join(", "))} left out (${value667.dropped[0].why})`
                      : `; left out: ${value667.dropped
                          .slice(0, 3)
                          .map(
                            (input2?: Dynamic): Dynamic =>
                              `${callback18(callback26(input2))} (${input2.why})`,
                          )
                          .join(
                            ", ",
                          )}${value667.dropped.length > 3 ? "\u2026" : ""}`,
                value690: Dynamic =
                  (length === 1
                    ? "Pasted an artboard"
                    : `Pasted ${String(length)} artboards`) +
                  (value686.length > 0
                    ? runtime.ClipboardFileTransferRegistry.withObjects(
                        value686,
                      )
                    : "") +
                  " from another canvas" +
                  (value659
                    ? ""
                    : runtime.ClipboardTrustDialogTitleMessageKeepCodeConfig.dropped(
                        length,
                      )),
                value691: Dynamic = value660?.leftOut ?? 0,
                value692: Dynamic =
                  value671.failed + (value660?.unreadPictures ?? 0),
                length2: Dynamic = value671.landed.filter(
                  (input2?: Dynamic): Dynamic =>
                    value661.plainPictures.has(input2.spec.id),
                ).length,
                value693: Dynamic =
                  (value660?.pictures.length ?? 0) +
                  (value660?.unreadPictures ?? 0),
                value694: Dynamic =
                  (value675 > 0
                    ? `; ${String(value675)} left out (over 2 MiB with images inlined)`
                    : "") +
                  value689 +
                  (value665 > 0
                    ? `; ${value665 === 1 ? "1 SVG image" : `${String(value665)} SVG images`} left out (Paste with code keeps ${value665 === 1 ? "it" : "them"})`
                    : "") +
                  (value669 > 0
                    ? `; ${value669 === 1 ? "1 font" : `${String(value669)} fonts`} did not come across, so some text may show in a different font`
                    : "") +
                  (!value663 || value684.length > value686.length
                    ? runtime.ClipboardFileTransferRegistry.notLanded
                    : value653 !== "" &&
                        (value660?.entries.length ?? 0) + value693 === 0
                      ? runtime.ClipboardFileTransferRegistry.notRead
                      : (value660?.unread ?? 0) > 0
                        ? runtime.ClipboardFileTransferRegistry.someUnread(
                            value660?.unread ?? 0,
                          )
                        : value653 === "" &&
                            (0, runtime.ClipboardPastePlanningHandler)(input)
                          ? runtime.ClipboardFileTransferRegistry.stayedBehind
                          : "") +
                  (value661.notesOut > 0
                    ? runtime.ClipboardFileTransferRegistry.notesTooMuch
                    : "") +
                  (value686.length > 0 && value661.plain > 0
                    ? runtime.ClipboardFileTransferRegistry.plainShapes(
                        value661.plain,
                      )
                    : "") +
                  (value686.length > 0 && length2 > 0
                    ? runtime.ClipboardFileTransferRegistry.plainPictures(
                        length2,
                        true,
                      )
                    : "") +
                  (value692 > 0
                    ? runtime.ClipboardFileTransferRegistry.notBrought(value692)
                    : "") +
                  runtime.ClipboardFileTransferRegistry.leftOutCaveat(
                    value691,
                    value660?.videos ?? 0,
                  ) +
                  (value688.length > 0
                    ? `. It loads ${value688.slice(0, 3).join(", ")}${value688.length > 3 ? "\u2026" : ""}, which this canvas doesn't have. Publish that here for it to render as designed.`
                    : "");
              value694 ? value188(value690 + value694) : value189(value690);
            } catch (value657: Dynamic) {
              for (let value658 of items as Dynamic)
                await (0, runtime.getKvClient)()
                  .delete((0, runtime.PlatformFileContentHandler_4)(value658))
                  .catch((): Dynamic => false);
              showToast(
                (0, runtime.fileCapFailureMessage)(value657) ??
                  "Couldn't paste the artboards: " +
                    (0, runtime.errorMessage)(value657),
                "error",
              );
            } finally {
              value369.current = null;
              callback19();
            }
          })();
        },
        [
          doc,
          supportsLoadState,
          value98,
          value413,
          showToast,
          value188,
          value189,
          value62,
          value105,
        ],
      ),
      value468: Dynamic = (0, runtime.reactChromeTheme.useRef)(value467);
    value468.current = value467;
    let value469: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          if (!value224.current) return;
          let value653: Dynamic = options.trim(),
            value654: Dynamic =
              value653 || ((0, runtime.getElementClipboard)() ?? "").trim();
          if (!value654) {
            value188(
              "Nothing to paste here. Copy some text, an image or an artboard first.",
            );
            return;
          }
          let callback15: Dynamic = (input2?: Dynamic): Dynamic =>
            value653.startsWith("<")
              ? (0, runtime.sanitizePastedHtml)(input2)
              : input2;
          if (input.file == null) {
            let value657: Dynamic = (0, runtime.wrapInlinePastedHtml)(
              callback15(
                value654.startsWith("<")
                  ? (0, runtime.normalizeAuthoredHtml)(value654)
                  : (0, runtime.textToParagraphHtml)(
                      value654,
                      "margin: 0; position: absolute; left: 32px; top: 32px",
                    ),
              ),
            );
            if (!/<[a-z]/i.test(value657)) {
              value188(
                "Nothing to paste here: the copied markup has no elements.",
              );
              return;
            }
            value313(
              {
                x: Math.round(
                  input.x - runtime.PlatformFileContentConstant_5 / 2,
                ),
                y: Math.round(
                  input.y - runtime.PlatformFileContentConstant_6 / 2,
                ),
                w: runtime.PlatformFileContentConstant_5,
                h: runtime.PlatformFileContentConstant_6,
              },
              value657,
              {
                doneSay: "New artboard from the paste",
              },
            );
            return;
          }
          let file: Dynamic = input.file,
            value655: Dynamic = file.replace(/\.dc\.html$/, ""),
            entry: Dynamic = value177.current.get(file),
            value656: Dynamic = value87.current.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === file,
            );
          if (!entry || !value656) {
            value188(
              `Couldn't paste into ${value655}: it isn't loaded yet. Click it, then paste again.`,
            );
            return;
          }
          let [items, items2]: Dynamic = [
            input.x - value656.x,
            input.y - value656.y,
          ];
          (value654.startsWith("<")
            ? entry.insertHtml(callback15(value654), "stage", {
                ox: items,
                oy: items2,
              })
            : entry.insertLayerAt(
                {
                  x: items,
                  y: items2,
                },
                (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                  (0, runtime.textToParagraphHtml)(
                    value654,
                    `margin: 0; position: absolute; left: ${input2}px; top: ${options2}px`,
                  ),
                (): Dynamic => value224.current,
                (input2?: Dynamic): Dynamic => {
                  let entry2: Dynamic = value177.current.get(file);
                  return entry2 === entry
                    ? null
                    : entry2
                      ? entry2.insertHtml(input2, "stage")
                      : Promise.resolve(null);
                },
              )
          ).then((items3?: Dynamic): Dynamic => {
            if (items3 != null) {
              if (items3.length === 0) {
                value188("Could not paste: nothing changed.");
                return;
              }
              abandonSelectionGesture();
              value62();
              setSelection(
                (0, runtime.setCanvasElementSelection)(
                  runtime.emptyCanvasSelection,
                  file,
                  {
                    name: value19(file),
                    tids: items3,
                    rect: null,
                    count: items3.length,
                  },
                  false,
                ),
              );
              value189("Pasted into " + value655);
            }
          });
        },
        [value313, value188, value189, value62, abandonSelectionGesture],
      ),
      value470: Dynamic = (0, runtime.reactChromeTheme.useRef)(value469);
    value470.current = value469;
    let value471: Dynamic = (0, runtime.reactChromeTheme.useRef)(value326);
    value471.current = value326;
    let value472: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value473: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let value653: Dynamic = value87.current.artboards
              .filter((input2?: Dynamic): Dynamic => input.has(input2.file))
              .map(
                (input2?: Dynamic): Dynamic =>
                  input2.title || input2.file.replace(/\.dc\.html$/, ""),
              ),
            value654: Dynamic = (value87.current.annotations ?? [])
              .filter((input2?: Dynamic): Dynamic => options.has(input2.id))
              .map(
                (input2?: Dynamic): Dynamic =>
                  (0, runtime.isShapeAnnotation)(input2)
                    ? ""
                    : input2.text.trim(),
              );
          return {
            stamp:
              Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
            rendition:
              [...value653, ...value654].filter(
                (input2?: Dynamic): Dynamic => input2 !== "",
              ).join(`
`) || (input.size > 0 ? "artboard" : ""),
          };
        },
        [],
      ),
      value474: Dynamic = (0, runtime.reactChromeTheme.useRef)(undefined),
      value475: Dynamic = (0, runtime.reactChromeTheme.useRef)(-1 / 0);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let callback15: Dynamic = (event?: Dynamic): Dynamic => {
          if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
          let value654: Dynamic = event.key.toLowerCase();
          if (
            (value654 !== "c" && value654 !== "v") ||
            (!value224.current && value654 !== "c") ||
            (0, runtime.isEditingInputTarget)(event.target)
          )
            return;
          if (event.shiftKey) {
            value654 === "v" && (value475.current = event.timeStamp);
            return;
          }
          value654 === "v" && (value475.current = -1 / 0);
          if (value654 === "c") {
            let current4: Dynamic = selectionRef.current;
            if (!(0, runtime.canvasElementSelectionCount)(current4)) {
              let value661: Dynamic =
                focusedFileRef.current != null &&
                current4.elements.has(focusedFileRef.current);
              if (!value159.current && value661) return;
              if (value48.current > 0) {
                let value662: Dynamic = (0, runtime.startClipboardMark)({
                  markable: false,
                });
                value52.current((): Dynamic => {
                  value160.current(value662);
                }, value662.drop);
                event.stopPropagation();
              } else value160.current() && event.stopPropagation();
              return;
            }
            event.stopPropagation();
            if (event.repeat) return;
            let files: Dynamic = doc.content().files;
            if (
              !(current4.artboards.size === 0
                ? current4.notes.size > 0
                : [...current4.artboards].some((input?: Dynamic): Dynamic => {
                    let value661: Dynamic = files[input];
                    return (
                      typeof value661 == "string" &&
                      !(0, runtime.isLoadingArtboardHtml)(value661)
                    );
                  }))
            )
              return;
            let state: Dynamic = {
              files: new Set(current4.artboards),
              notes: new Set(current4.notes),
              mark: undefined,
            };
            value472.current = state;
            value463.current(
              state.files,
              state.notes,
              (): Dynamic => state.mark,
            );
            callback17();
            setTimeout((): Dynamic => {
              value472.current === state && (value472.current = null);
            }, 100);
            return;
          }
          if ((0, runtime.hasBlockingEditorOverlay)()) return;
          let value655: Dynamic = (0, runtime.getArtboardClipboard)(),
            value656: Dynamic = (0, runtime.getAnnotationClipboard)(),
            value657: Dynamic = value109(),
            value658: Dynamic = value657?.overAnnotation ? null : value657,
            value659: Dynamic = value655
              ? value112(value655, value656, value657, value658)
              : null;
          if (!value655 && !value658) return;
          event.stopPropagation();
          clearTimeout(value474.current);
          let value660: Dynamic = (0, runtime.isClipboardSettling)();
          value474.current = setTimeout((): Dynamic => {
            let value661: Dynamic =
              value660 || (0, runtime.isClipboardSettling)();
            (0, runtime.afterClipboardSettled)((): Dynamic => {
              if (!value224.current) return;
              let value662: Dynamic = value661
                  ? (0, runtime.getArtboardClipboard)()
                  : value655,
                value663: Dynamic = value661
                  ? (0, runtime.getAnnotationClipboard)()
                  : value656,
                value664: Dynamic = value661 ? value109() : value657,
                value665: Dynamic = value664?.overAnnotation ? null : value664;
              value662
                ? value464.current(
                    value662,
                    value663,
                    value661
                      ? value112(value662, value663, value664, value665)
                      : value659,
                  )
                : value665 &&
                  readCanvasClipboardText().then(
                    (input?: Dynamic): Dynamic =>
                      value470.current(
                        value665,
                        (0, runtime.getActiveClipboardSource)({
                          text: input,
                          stamp: null,
                          hasImage: false,
                        }) === "text"
                          ? input
                          : "",
                      ),
                  );
            });
          }, 100);
        },
        value653: Dynamic = null,
        callback16: Dynamic = (): Dynamic => {
          if (!value653) return;
          let value654: Dynamic = value653.__prev ?? null;
          value653.remove();
          value653 = null;
          value654 instanceof HTMLElement &&
            value654 !== (document as Dynamic).body &&
            value654.isConnected &&
            value654.focus({
              preventScroll: true,
            });
        },
        callback17: Dynamic = (): Dynamic => {
          callback16();
          let value654: Dynamic = (document as Dynamic).createElement(
            "textarea",
          );
          value654.__prev = (document as Dynamic).activeElement;
          value654.setAttribute("aria-hidden", "true");
          value654.value = " ";
          value654.style.cssText =
            "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0;padding:0";
          (document as Dynamic).body.appendChild(value654);
          value654.focus({
            preventScroll: true,
          });
          value654.select();
          value653 = value654;
          setTimeout(callback16, 0);
        },
        callback18: Dynamic = (event?: Dynamic): Dynamic => {
          let current4: Dynamic = value472.current;
          if (!event.isTrusted || current4 == null) return;
          value472.current = null;
          let { stamp: value654, rendition: value655 }: Dynamic = value473(
            current4.files,
            current4.notes,
          );
          event.preventDefault();
          event.stopImmediatePropagation();
          (0, runtime.writeClipboardObject)(event, runtime.DesignArtboardsKey, {
            data: {
              stamp: value654,
              ...value466.current(current4.files, current4.notes),
            },
            text: value655,
          }) &&
            ((current4.mark = {
              stamp: value654,
              rendition: value655,
            }),
            (0, runtime.mirrorArtboardClipboardStamp)(value654, value655));
        },
        callback19: Dynamic = (event?: Dynamic): Dynamic => {
          clearTimeout(value474.current);
          if (!value224.current || event.timeStamp - value475.current < 1e3)
            return;
          let items: Dynamic = [...(event.clipboardData?.files ?? [])],
            value654: Dynamic = items.filter(
              (input?: Dynamic): Dynamic =>
                (0, runtime.isImageFile)(input) ||
                (0, runtime.isVideoFile)(input),
            ),
            value655: Dynamic =
              event.clipboardData?.getData("text/plain") ?? "",
            value656: Dynamic = (0, runtime.readBoundedClipboardObject)(event),
            value657: Dynamic = (0, runtime.readArtboardClipboard)(value656),
            state: Dynamic = {
              text: value655,
              stamp: (0, runtime.clipboardObjectStamp)(value656),
              hasImage:
                value654.length > 0 &&
                (0, runtime.clipboardContainsFileNames)(items, value655),
              artboards: value657,
            },
            value658: Dynamic = (0, runtime.imagePasteRefusal)(
              event.target,
              (0, runtime.getActiveClipboardSource)(state) === "image",
              value655,
              value654.length > 0 && value654.every(runtime.isVideoFile)
                ? "video"
                : "image",
            );
          value658.to === "nobody" &&
            (event.preventDefault(),
            event.stopImmediatePropagation(),
            value448.current(value658.say));
          if (value658.to !== "canvas") return;
          let value659: Dynamic = (0, runtime.isClipboardSettling)(),
            callback20: Dynamic = (input?: Dynamic): Dynamic => {
              value659
                ? (0, runtime.markConsumedClipboardStamp)(event)
                : (event.preventDefault(),
                  input && event.stopImmediatePropagation());
            };
          (0, runtime.afterClipboardSettled)(
            (): Dynamic => {
              if (!value224.current) return;
              let value660: Dynamic = (0, runtime.getActiveClipboardSource)(
                  state,
                ),
                value661: Dynamic = (0, runtime.getArtboardClipboard)(),
                value662: Dynamic = (0, runtime.getAnnotationClipboard)(),
                value663: Dynamic = value109(),
                value664: Dynamic = value663?.overAnnotation ? null : value663;
              if (value660 === "foreign-artboards") {
                callback20(false);
                value468.current(value657, value111());
                return;
              }
              let value665: Dynamic =
                  value660 === "image" &&
                  (value663 == null
                    ? focusedFileRef.current == null
                    : value663.file == null)
                    ? value113()
                    : null,
                value666: Dynamic =
                  value660 === "image" && value665 == null ? value663 : null,
                value667: Dynamic =
                  value660 === "image" &&
                  value665 == null &&
                  value666 == null &&
                  focusedFileRef.current == null;
              if (value661 && value660 === "artboards") {
                callback20(true);
                value464.current(
                  value661,
                  value662,
                  value112(value661, value662, value663, value664),
                );
                return;
              }
              if (
                value665 == null &&
                value666 == null &&
                !value667 &&
                (value660 === "image" || value664 == null)
              )
                return;
              callback20(true);
              let {
                  w: value668,
                  h: value669,
                  top: value670,
                }: Dynamic = value120(),
                entry: Dynamic = value105.get();
              if (value665 != null) {
                let value671: Dynamic = (0, runtime.visibleArtboardCenter)(
                  value665,
                  {
                    ...entry,
                    y: entry.y + value670 / entry.scale,
                    width: value668,
                    height: value669 - value670,
                  },
                );
                value471.current(
                  value654,
                  value671.x,
                  value671.y,
                  "pasted",
                  value665.file,
                );
              } else
                value666 != null
                  ? value471.current(
                      value654,
                      value666.x,
                      value666.y,
                      "pasted",
                      value666.file ?? undefined,
                    )
                  : value667
                    ? value471.current(
                        value654,
                        entry.x + value668 / 2 / entry.scale,
                        entry.y + (value670 + value669) / 2 / entry.scale,
                        "pasted",
                      )
                    : value470.current(
                        value664,
                        value660 === "text" ? value655 : "",
                      );
            },
            (): Dynamic => (0, runtime.markConsumedClipboardStamp)(event),
          );
        };
      (window as Dynamic).addEventListener("keydown", callback15, true);
      (window as Dynamic).addEventListener("copy", callback18, true);
      (window as Dynamic).addEventListener("paste", callback19, true);
      return (): Dynamic => {
        clearTimeout(value474.current);
        callback16();
        (window as Dynamic).removeEventListener("keydown", callback15, true);
        (window as Dynamic).removeEventListener("copy", callback18, true);
        (window as Dynamic).removeEventListener("paste", callback19, true);
      };
    }, [
      value109,
      value111,
      value112,
      doc,
      value473,
      value113,
      value120,
      value105,
    ]);
    let [value476, value477]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        false,
      ),
      value478: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      value479: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          value478.current = input;
          value477(input);
        },
        [],
      ),
      value480: Dynamic = (0, runtime.useDownloadsWithheld)(),
      [value481, value482]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        emptyCanvasNoteSet,
      );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value476 || value482(emptyCanvasNoteSet);
    }, [value476]);
    let value483: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async (input?: Dynamic): Promise<Dynamic> => {
          let callback15: Dynamic = (): Dynamic => {
              let entry: Dynamic = value177.current.get(input);
              return entry != null && entry.isReady()
                ? entry.webviewRef.current
                : null;
            },
            value653: Dynamic = callback15();
          if (value653) return value653;
          if (
            !value87.current.artboards.some(
              (input2?: Dynamic): Dynamic => input2.file === input,
            ) ||
            value177.current.get(input)?.isBlocked()
          )
            return null;
          value99 &&
            !flag &&
            !value345.current &&
            (focusedFileRef.current != null || value271.current != null) &&
            (await value.current?.("preview"),
            value62(),
            value122(null),
            value270(null));
          value482(new Set([input]));
          let value654: Dynamic = Date.now();
          for (; Date.now() - value654 < artboardFrameReadyTimeoutMs; ) {
            await new Promise(
              (input2?: Dynamic): Dynamic => setTimeout(input2, 100),
            );
            let value655: Dynamic = callback15();
            if (value655) return value655;
            if (value177.current.get(input)?.isBlocked()) return null;
          }
          return null;
        },
        [value99, flag, value62],
      ),
      value484: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic =>
          value86.artboards.filter(
            (input?: Dynamic): Dynamic => !input.frameless,
          ),
        [value86],
      ),
      value485: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let current4: Dynamic = value73.current,
            current5: Dynamic = value80.current,
            length: Dynamic = value84.current.filter(
              (input2?: Dynamic): Dynamic =>
                input2.id !== current5 &&
                current4.artboards.some(
                  (input3?: Dynamic): Dynamic =>
                    !input3.frameless &&
                    (0, runtime.designPageId)(input3, current4.pages) ===
                      input2.id,
                ),
            ).length;
          return (0, runtime.describeExportScope)(input, options, {
            printable: value87.current.artboards.filter(
              (input2?: Dynamic): Dynamic => !input2.frameless,
            ).length,
            otherPages: length,
          });
        },
        [],
      ),
      value486: Dynamic = (0, runtime.useExportPicker)({
        artboards: value484,
        enter: (): Dynamic => {
          value346.current !== null ? value297.current() : value270(null);
          value339.current !== "select" &&
            (value338("select"),
            value341((input?: Dynamic): Dynamic => input + 1));
          let entry: Dynamic = value105.get(),
            current4: Dynamic = value80.current;
          value314(runtime.emptyBoardSelection, "replace");
          value296.current = runtime.exportPickerChromeHeight;
          value292.current();
          return (): Dynamic => {
            value296.current = 0;
            !(value80.current !== current4 || value271.current !== null) &&
              (value346.current !== null
                ? value348(
                    (input?: Dynamic): Dynamic =>
                      input && {
                        ...input,
                        prev: entry,
                      },
                  )
                : value105.set(entry, true));
          };
        },
        onLapse: (): Dynamic =>
          showToast(
            // BaoCut: on a page opened on its own the export starts from the toolbar's Export button, not Share.
            "No artboard was chosen in time, so the export was cancelled. Open " +
              (window.parent === window ? "Export" : "Share") +
              " to export again.",
          ),
        onStage: runtime.reportExportDeliveryEvent,
        homeFocus: (): Dynamic =>
          callback11(focusedFileRef.current) ??
          value106.current?.querySelector(
            "[data-mega-title-text]:not([inert])",
          ) ??
          null,
      }),
      {
        choose: value487,
        isUp: value488,
        end: value489,
        pick: value490,
        leave: value491,
      }: Dynamic = value486,
      value492: Dynamic = value486.session !== null;
    value294.current = value492;
    let value493: Dynamic = value476 || value492,
      value494: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (): Dynamic => value478.current || value488(),
        [value488],
      ),
      value495: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let value653: Dynamic = null,
            flag2: Dynamic = false,
            callback15: Dynamic = (): Dynamic => {
              flag2 = true;
            },
            callback16: Dynamic = (input2?: Dynamic): Dynamic => {
              for (let value654 of [
                "pointerdown",
                "wheel",
                "keydown",
              ] as Dynamic)
                input2
                  ? value106.current?.addEventListener(value654, callback15, {
                      capture: true,
                      passive: true,
                    })
                  : value106.current?.removeEventListener(
                      value654,
                      callback15,
                      true,
                    );
            },
            callback17: Dynamic = (input2?: Dynamic): Dynamic =>
              !flag2 &&
              value346.current === null &&
              value271.current === null &&
              !value488() &&
              value87.current.artboards.some(
                (input3?: Dynamic): Dynamic => input3.file === input2.file,
              ),
            callback18: Dynamic = (input2?: Dynamic): Dynamic => {
              if (
                value653 === null ||
                value653.isConnected ||
                ((document as Dynamic).activeElement !==
                  (document as Dynamic).body &&
                  (document as Dynamic).activeElement !== null)
              )
                return;
              let callback19: Dynamic = (input3?: Dynamic): Dynamic =>
                  (document as Dynamic).querySelector(input3),
                value654: Dynamic =
                  callback19('button[data-testid="mega-export"]') ??
                  callback19('[data-testid="mega-export"] button') ??
                  callback19('[data-testid="mega-collapse"]');
              value654
                ? value654.focus({
                    preventScroll: true,
                  })
                : input2 > 0 &&
                  requestAnimationFrame((): Dynamic => callback18(input2 - 1));
            };
          return (0, runtime.withClosedPreview)(
            {
              current: (): Dynamic => {
                let current4: Dynamic = value387.current;
                return !value92 || current4 === null
                  ? null
                  : input.some(
                        (input2?: Dynamic): Dynamic =>
                          input2.file !== current4.file,
                      )
                    ? {
                        ...current4,
                        playing: value271.current === current4.file,
                      }
                    : null;
              },
              leave: (): Dynamic => {
                value653 =
                  (document as Dynamic).hasFocus() &&
                  (document as Dynamic).activeElement !==
                    (document as Dynamic).body
                    ? (document as Dynamic).activeElement
                    : null;
                value297.current();
                callback16(true);
              },
              laidOut: async (): Promise<Dynamic> => {
                await new Promise(
                  (input2?: Dynamic): Dynamic =>
                    setTimeout((): Dynamic => {
                      let value654: Dynamic = setTimeout(input2, 250);
                      requestAnimationFrame(
                        (): Dynamic =>
                          requestAnimationFrame(
                            (): Dynamic => (clearTimeout(value654), input2()),
                          ),
                      );
                    }, 0),
                );
                await Promise.all(
                  input.map((input2?: Dynamic): Dynamic => {
                    let value654: Dynamic = value177.current.get(input2.file)
                      ?.webviewRef.current;
                    return value654
                      ? (0, runtime.createPreviewHandle)(value654)
                          ?.awaitSettled(1500)
                          .catch((): Dynamic => {})
                      : undefined;
                  }),
                );
              },
              mayReopen: callback17,
              reopen: ({ playing: playing, ...props }: Dynamic): Dynamic =>
                new Promise(
                  (input2?: Dynamic): Dynamic =>
                    value275((): Dynamic => {
                      input2();
                      callback16(false);
                      if (!callback17(props)) return;
                      value392.current = props.file;
                      value348(props);
                      playing && value270(props.file);
                      requestAnimationFrame((): Dynamic => callback18(2));
                      let value654: Dynamic =
                        value653 !== null
                          ? (document as Dynamic).activeElement?.closest(
                              '[role="dialog"], [role="alertdialog"]',
                            )
                          : null;
                      if (value654) {
                        let observer: Dynamic = new MutationObserver(
                            (): Dynamic => {
                              value654.isConnected ||
                                (callback19(),
                                setTimeout((): Dynamic => callback18(2), 0));
                            },
                          ),
                          callback19: Dynamic = (): Dynamic => (
                            observer.disconnect(),
                            clearTimeout(value655)
                          ),
                          value655: Dynamic = setTimeout(callback19, 12e4);
                        observer.observe((document as Dynamic).body, {
                          childList: true,
                          subtree: true,
                        });
                      }
                    }),
                ),
            },
            options,
          ).finally((): Dynamic => callback16(false));
        },
        [value275, value92, value488],
      ),
      value496: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic =>
          value490(input.files, options === "toggle"),
        [value490],
      ),
      callback13: Dynamic = (input?: Dynamic): Dynamic => {
        let value653: Dynamic = value484.find(
          (input2?: Dynamic): Dynamic => input2.file === input,
        );
        return value653 ? (
          <runtime.ExportArtboardPickTarget
            artboard={value653}
            picker={value486}
          />
        ) : null;
      },
      value497: Dynamic = !flag && !value99 && !value220 && value484.length > 1,
      value498: Dynamic = value92 ? "unicode" : "winansi",
      value499: Dynamic = value92,
      value500: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {
        value491() &&
          showToast(
            // BaoCut: see onLapse above.
            "Leaving that view cancelled the export. Open " +
              (window.parent === window ? "Export" : "Share") +
              " to export again.",
          );
      }, [value491, showToast]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value500();
    }, [value79, value500]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      (value347 != null || value269 != null || value220) && value500();
    }, [value347, value269, value220, value500]);
    let value501: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async (items?: Dynamic, options?: Dynamic): Promise<Dynamic> => {
          if (value494()) {
            showToast(exportAlreadyRunningMessage);
            return;
          }
          options?.();
          if (!editableRef.current) {
            showToast(
              "This canvas is read-only now, so its frames can\u2019t be changed.",
            );
            return;
          }
          value479(true);
          let value653: Dynamic =
              items.length === 1
                ? value73.current.artboards.find(
                    (input?: Dynamic): Dynamic => input.file === items[0],
                  )
                : undefined,
            value654: Dynamic =
              items.length > 1
                ? showToast(
                    "Measuring " + String(items.length) + " artboards\u2026",
                    "info",
                    {
                      pinned: true,
                    },
                  )
                : value653 && (0, runtime.isFillPagedExport)(value653)
                  ? showToast(
                      'Measuring "' + callback2(value653.file) + '"\u2026',
                      "info",
                      {
                        pinned: true,
                      },
                    )
                  : undefined,
            items2: Dynamic = [],
            items3: Dynamic = [],
            flag2: Dynamic = false;
          try {
            await value495(
              items.map(
                (input?: Dynamic): Dynamic => ({
                  file: input,
                }),
              ),
              async (): Promise<Dynamic> => {
                for (let value656 of items as Dynamic) {
                  let value657: Dynamic = value73.current.artboards.find(
                    (input?: Dynamic): Dynamic => input.file === value656,
                  );
                  items3.push(callback2(value656));
                  if (!value657 || !(0, runtime.needsPagedExport)(value657)) {
                    items2.push(value657 ? "keeps" : "gone");
                    continue;
                  }
                  let value658: Dynamic = await value483(value656),
                    value659: Dynamic = value658
                      ? (0, runtime.createPreviewHandle)(value658)
                      : null;
                  if (!value658 || !value659) {
                    items2.push(
                      value87.current.artboards.some(
                        (input?: Dynamic): Dynamic => input.file === value656,
                      )
                        ? value177.current.get(value656)?.isBlocked()
                          ? "stopped"
                          : "unmeasured"
                        : "gone",
                    );
                    continue;
                  }
                  if (value658.getBoundingClientRect().width === 0) {
                    items2.push("hidden");
                    continue;
                  }
                  let value660: Dynamic = await (0,
                    runtime.measureExpandedContentHeight)(value659, {
                      w: value657.w,
                      h: value657.h,
                    }),
                    value661: Dynamic =
                      typeof value660 == "number" &&
                      value660 <= value657.h + runtime.exportHeightTolerance &&
                      (0, runtime.isFillPagedExport)(value657)
                        ? await (0, runtime.measureFlowExportHeight)(value659, {
                            w: value657.w,
                            h: value657.h,
                          })
                        : undefined;
                  if (!editableRef.current) {
                    flag2 = true;
                    break;
                  }
                  let value662: Dynamic = value73.current.artboards.find(
                    (input?: Dynamic): Dynamic => input.file === value656,
                  );
                  if (
                    !value662 ||
                    !(0, runtime.needsPagedExport)(value662) ||
                    value662.w !== value657.w
                  ) {
                    items2.push(
                      value662
                        ? value662.w !== value657.w
                          ? "unmeasured"
                          : "keeps"
                        : "gone",
                    );
                    continue;
                  }
                  if (value660 === null || value660 === "unsettled") {
                    items2.push(value660 === null ? "unmeasured" : "unsettled");
                    continue;
                  }
                  if (
                    value661 === "unsettled" ||
                    value661 === "empty" ||
                    value661 === null
                  ) {
                    items2.push(
                      value661 === "unsettled"
                        ? "unsized"
                        : value661 === "empty"
                          ? "empty"
                          : "unmeasured",
                    );
                    continue;
                  }
                  if (
                    value661 !== undefined &&
                    (value662.h !== value657.h ||
                      !(0, runtime.isFillPagedExport)(value662))
                  ) {
                    items2.push("changed");
                    continue;
                  }
                  let value663: Dynamic = (0,
                  runtime.resolveMeasuredExportHeight)(
                    Math.max(value662.h, value657.h),
                    value660,
                    value661,
                  );
                  typeof value663 == "number" &&
                    value399(
                      value656,
                      {
                        h: value663,
                      },
                      true,
                    );
                  items2.push(
                    typeof value663 == "number"
                      ? value663 < value662.h
                        ? "shrunk"
                        : "grown"
                      : value663 === "fits" && value661 !== undefined
                        ? "matches"
                        : value663,
                  );
                }
              },
            );
          } catch (value656: Dynamic) {
            console.error("[fit-height]", value656);
            items2.push("unmeasured");
          } finally {
            value479(false);
            value654 !== undefined && hideToast(value654);
          }
          if (flag2) {
            showToast(
              "This canvas is read-only now, so its frames can\u2019t be changed.",
            );
            return;
          }
          let value655: Dynamic = (0, runtime.fitContentResultMessage)(
            items2,
            items3,
          );
          value655 !== null &&
            (items2.every(
              (input?: Dynamic): Dynamic =>
                input === "grown" || input === "shrunk",
            )
              ? (0, runtime.announce)(value655)
              : showToast(value655));
        },
        [
          value483,
          value494,
          hideToast,
          value399,
          value479,
          showToast,
          value495,
        ],
      ),
      value502: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          if (!value92 || flag || !editable) return false;
          let value653: Dynamic = value73.current.artboards.find(
            (input2?: Dynamic): Dynamic => input2.file === input,
          );
          return (
            value653 !== undefined && (0, runtime.needsPagedExport)(value653)
          );
        },
        [editable, value92, flag],
      ),
      value503: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          items?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653: Dynamic = false,
        ): Dynamic => {
          let items2: Dynamic = [...callback2(items[0] ?? "")],
            value654: Dynamic =
              items.length > 1
                ? "Fit " + String(items.length) + " frames to content"
                : options
                  ? 'Fit "' +
                    (items2.length > 24
                      ? items2.slice(0, 23).join("") + "\u2026"
                      : items2.join("")) +
                    '" to content'
                  : "Fit height to content";
          value653 ||
            (window as Dynamic).setTimeout(
              context,
              canvasExportSettleTimeoutMs,
            );
          return (
            <runtime.Button
              size={"sm"}
              data-testid={"dc-fit-height"}
              onClick={(): Dynamic => {
                value501(items, context);
              }}
            >
              {value654}
            </runtime.Button>
          );
        },
        [value501],
      ),
      value504: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async (input?: Dynamic, options?: Dynamic): Promise<Dynamic> => {
          if (!value493) {
            if (value480) {
              showToast(runtime.DownloadsArenTAvailableToYouForMessage);
              return;
            }
            value479(true);
            try {
              let value653: Dynamic = await value483(input),
                value654: Dynamic = value653
                  ? (0, runtime.createPreviewHandle)(value653)
                  : null;
              if (
                !value653 ||
                !value654 ||
                value653.getBoundingClientRect().width === 0
              ) {
                showToast(
                  value177.current.get(input)?.isBlocked()
                    ? "This artboard\u2019s preview is stopped \u2014 reload it before exporting."
                    : "This artboard isn\u2019t visible to capture \u2014 try again in a moment.",
                );
                runtime.healthReporter.report(
                  ...(0, runtime.classifyExportAbort)("image"),
                );
                return;
              }
              let value655: Dynamic = value67.artboards.find(
                  (input2?: Dynamic): Dynamic => input2.file === input,
                ),
                value656: Dynamic = (0, runtime.exportFileName)(
                  input,
                  value655?.title,
                ),
                value657: Dynamic = await (0, runtime.exportArtboardImage)(
                  value654,
                  input,
                  "png",
                  options ?? 2,
                  {
                    ...(value655
                      ? (0, runtime.getArtboardCaptureOptions)(
                          value655,
                          value93,
                        )
                      : {
                          selectionRoot: "body",
                        }),
                    filename:
                      options == null
                        ? value656 + ".png"
                        : value656 + "@" + options + "x.png",
                    scope: value485(1, "one"),
                  },
                ),
                [value658]: Dynamic = (0, runtime.fontSubstitutionWarnings)(
                  value657.fontWarningCount,
                ),
                value659: Dynamic =
                  value658 !== undefined
                    ? {
                        description: value658,
                      }
                    : undefined;
              if (!value657.ok)
                showToast(
                  "Couldn't capture this artboard to download.",
                  "error",
                );
              else if (value657.saveOutcome === "withheld")
                showToast(runtime.DownloadsArenTAvailableToYouForMessage);
              else if (
                value657.clipped &&
                value657.saveOutcome !== "declined"
              ) {
                let value660: Dynamic = value502(input),
                  value661: Dynamic = showToast(
                    (0, runtime.clippedArtboardsMessage)([value656], value660),
                    "info",
                    value660
                      ? {
                          ...value659,
                          action: value503(
                            [input],
                            false,
                            (): Dynamic => hideToast(value661),
                            value657.saveOutcome === "unsupported",
                          ),
                          pinned: true,
                        }
                      : value659,
                  );
              } else if (value657.saveOutcome !== "declined") {
                let flag2: Dynamic = false;
                if (
                  value655 &&
                  (0, runtime.getArtboardCaptureMode)(value655, value93) ===
                    "full" &&
                  (0, runtime.isFillPagedExport)(value655)
                ) {
                  let value660: Dynamic = await (0,
                  runtime.measureEmptyExportTail)(value654, {
                    w: value655.w,
                    h: value655.h,
                  }).catch((): Dynamic => null);
                  if (
                    value660 !== null &&
                    value660 >= runtime.ExportPaperAndScaleLimit_2
                  ) {
                    let value661: Dynamic = value502(input),
                      value662: Dynamic = showToast(
                        (0, runtime.emptyExportTailMessage)(
                          [value656],
                          value660,
                        ),
                        "info",
                        value661
                          ? {
                              ...value659,
                              action: value503(
                                [input],
                                false,
                                (): Dynamic => hideToast(value662),
                                value657.saveOutcome === "unsupported",
                              ),
                              pinned: true,
                            }
                          : value659,
                      );
                    flag2 = true;
                  }
                }
                !flag2 && value658 !== undefined && showToast(value658, "info");
              }
            } catch (value653: Dynamic) {
              console.error("[download-artboard]", value653);
              showToast(
                "Couldn't export this artboard as a PNG: " +
                  (0, runtime.errorMessage)(value653) +
                  ".",
                "error",
              );
            } finally {
              value479(false);
            }
          }
        },
        [
          value480,
          value483,
          value493,
          value67.artboards,
          value93,
          value502,
          value503,
          hideToast,
          value485,
          showToast,
        ],
      ),
      value505: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          if (value480) return;
          if (value494())
            return void showToast(runtime.AccessibilityAnnouncementsLabel_5);
          let value653: Dynamic = value87.current.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input,
            ),
            value654: Dynamic = (0, runtime.clipboardGeneration)(),
            value655: Dynamic = (0, runtime.createCurrentWorkingGeneration)(),
            value656: Dynamic = null,
            flag2: Dynamic = false,
            state: Dynamic = {
              blank: 0,
            },
            value657: Dynamic = (async (): Promise<Dynamic> => {
              value479(true);
              try {
                if (!(await (0, runtime.allowsClipboardImages)())) {
                  flag2 = true;
                  return null;
                }
                let value658: Dynamic = await value483(input),
                  value659: Dynamic = value658
                    ? (0, runtime.createPreviewHandle)(value658)
                    : null;
                if (
                  !value658 ||
                  !value659 ||
                  value658.getBoundingClientRect().width === 0
                ) {
                  value656 = value177.current.get(input)?.isBlocked()
                    ? runtime.AccessibilityAnnouncementsLabel_8
                    : runtime.AccessibilityAnnouncementsLabel_9;
                  return null;
                }
                let value660: Dynamic = await (0, runtime.captureArtboardImage)(
                  value659,
                  "png",
                  2,
                  value653
                    ? (0, runtime.getArtboardCaptureOptions)(value653, value93)
                    : {
                        selectionRoot: "body",
                      },
                ).catch(
                  (input2?: Dynamic): Dynamic => (
                    (value656 = (0, runtime.errorMessage)(input2)),
                    null
                  ),
                );
                return value660
                  ? value660.ok
                    ? ((state = {
                        blank: value660.embedWarningCount,
                        ...(value660.clipped
                          ? {
                              clipped: true,
                            }
                          : {}),
                      }),
                      (0, runtime.clipboardGeneration)() === value654 &&
                      value655()
                        ? (0, runtime.pngDataUrlToBlob)(value660.uri)
                        : null)
                    : ((value656 =
                        value660.softError === "zero-size"
                          ? runtime.AccessibilityAnnouncementsLabel_7
                          : runtime.ItsPageHasNothingToDrawMessage),
                      null)
                  : null;
              } catch (value658: Dynamic) {
                console.error("[copy-png] artboard", value658);
                value656 = runtime.ItsPictureCouldnTBeMadeTryMessage;
                return null;
              } finally {
                value479(false);
              }
            })();
          (0, runtime.writeClipboardPng)(value657).then(
            (input2?: Dynamic): Dynamic => {
              if (
                !(
                  (0, runtime.clipboardGeneration)() !== value654 || !value655()
                )
              )
                if (input2 === "copied") {
                  (0, runtime.clearClipboardBuffers)();
                  (0, runtime.announce)(
                    runtime.AccessibilityAnnouncementsLabel_2,
                  );
                  if (state.clipped) {
                    let value658: Dynamic = (0, runtime.exportFileName)(
                        input,
                        value653?.title,
                      ),
                      value659: Dynamic = value502(input),
                      value660: Dynamic = showToast(
                        (0, runtime.clippedArtboardsMessage)(
                          [value658],
                          value659,
                        ),
                        "info",
                        value659
                          ? {
                              action: value503(
                                [input],
                                false,
                                (): Dynamic => hideToast(value660),
                                false,
                              ),
                              pinned: true,
                            }
                          : undefined,
                      );
                  }
                  state.blank > 0 &&
                    showToast(
                      (0, runtime.missingCopiedImagesMessage)(state.blank),
                      "info",
                    );
                } else
                  flag2
                    ? showToast(runtime.DownloadsArenTAvailableToYouForMessage)
                    : showToast(
                        (0, runtime.pngCopyFailureMessage)(
                          "artboard",
                          input2 === "refused" ? null : value656,
                        ),
                        "error",
                      );
            },
          );
        },
        [
          value480,
          value483,
          value494,
          value93,
          value502,
          value503,
          hideToast,
          value479,
          showToast,
        ],
      ),
      value506: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          if (value480) return;
          if (value494())
            return void showToast(runtime.AccessibilityAnnouncementsLabel_5);
          let value653: Dynamic = value87.current.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input,
            ),
            value654: Dynamic = (0, runtime.clipboardGeneration)(),
            value655: Dynamic = (0, runtime.createCurrentWorkingGeneration)(),
            value656: Dynamic = null,
            flag2: Dynamic = false,
            index: Dynamic = 0,
            flag3: Dynamic = false,
            value657: Dynamic = (async (): Promise<Dynamic> => {
              value479(true);
              try {
                if (!(await (0, runtime.allowsClipboardImages)())) {
                  flag2 = true;
                  return null;
                }
                let value658: Dynamic = await value483(input),
                  value659: Dynamic = value658
                    ? (0, runtime.createPreviewHandle)(value658)
                    : null;
                if (
                  !value658 ||
                  !value659 ||
                  value658.getBoundingClientRect().width === 0
                ) {
                  value656 = value177.current.get(input)?.isBlocked()
                    ? runtime.AccessibilityAnnouncementsLabel_8
                    : runtime.AccessibilityAnnouncementsLabel_9;
                  return null;
                }
                let value660: Dynamic = value653
                    ? (0, runtime.getArtboardCaptureOptions)(value653, value93)
                    : null,
                  value661: Dynamic = value660?.frame,
                  value662: Dynamic =
                    value661 &&
                    Number.isFinite(value661.w) &&
                    Number.isFinite(value661.h) &&
                    value661.w > 0 &&
                    value661.h > 0
                      ? value661
                      : null,
                  value663: Dynamic = await (0, runtime.withCaptureViewport)(
                    value659,
                    value662,
                    (): Dynamic =>
                      (0, runtime.captureClipboardSvg)(
                        value659,
                        "page",
                        value662 && {
                          w: value662.w,
                          h: value660?.clipToFrame ? value662.h : null,
                        },
                      ),
                    value660?.settle === true,
                  ).catch(
                    (input2?: Dynamic): Dynamic => (
                      console.error("[copy-svg] artboard", input2),
                      (value656 = (0, runtime.svgCopyErrorMessage)(input2)),
                      null
                    ),
                  );
                return value663
                  ? value663.ok
                    ? ((index = value663.blank),
                      (flag3 = value663.clipped),
                      (0, runtime.clipboardGeneration)() === value654 &&
                      value655()
                        ? value663.svg
                        : null)
                    : ((value656 =
                        value663.softError === "zero-size"
                          ? runtime.AccessibilityAnnouncementsLabel_7
                          : runtime.AccessibilityAnnouncementsLabel_4),
                      null)
                  : null;
              } catch (value658: Dynamic) {
                console.error("[copy-svg] artboard", value658);
                value656 = runtime.AccessibilityAnnouncementsLabel_4;
                return null;
              } finally {
                value479(false);
              }
            })();
          (0, runtime.writeClipboardSvg)(value657).then(
            (input2?: Dynamic): Dynamic => {
              if (
                !(
                  (0, runtime.clipboardGeneration)() !== value654 || !value655()
                )
              )
                if (input2 === "copied") {
                  (0, runtime.clearClipboardBuffers)();
                  (0, runtime.announce)(
                    runtime.AccessibilityAnnouncementsLabel_3,
                  );
                  if (flag3) {
                    let value658: Dynamic = value502(input),
                      value659: Dynamic = showToast(
                        (0, runtime.clippedSvgCopyMessage)(
                          (0, runtime.formatArtboardNames)([
                            (0, runtime.exportFileName)(input, value653?.title),
                          ]),
                          value658,
                        ),
                        "info",
                        value658
                          ? {
                              action: value503(
                                [input],
                                false,
                                (): Dynamic => hideToast(value659),
                                false,
                              ),
                              pinned: true,
                            }
                          : undefined,
                      );
                  }
                  index > 0 &&
                    showToast(
                      (0, runtime.missingSvgImagesMessage)(index),
                      "info",
                    );
                } else
                  flag2
                    ? showToast(runtime.DownloadsArenTAvailableToYouForMessage)
                    : showToast(
                        (0, runtime.svgCopyFailureMessage)(
                          "artboard",
                          input2 === "refused" ? null : value656,
                        ),
                        "error",
                      );
            },
          );
        },
        [
          value480,
          value483,
          value494,
          value93,
          value502,
          value503,
          hideToast,
          value479,
          showToast,
        ],
      ),
      value507: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async (input?: Dynamic): Promise<Dynamic> => {
          if (!value493) {
            if (value480) {
              showToast(runtime.DownloadsArenTAvailableToYouForMessage);
              return;
            }
            value479(true);
            try {
              if (await (0, runtime.downloadsWithheld)()) {
                showToast(runtime.DownloadsArenTAvailableToYouForMessage);
                runtime.healthReporter.report(
                  ...(0, runtime.classifyExportAbort)("zip"),
                );
                return;
              }
              await value177.current.get(input)?.flushPending();
              let files: Dynamic = doc.content().files,
                callback15: Dynamic = async (
                  input2?: Dynamic,
                ): Promise<Dynamic> => {
                  let value660: Dynamic =
                    (await (0, runtime.getKvClient)().get(
                      (0, runtime.PlatformFileContentHandler_4)(input2),
                    )) ?? files[input2];
                  if (
                    typeof value660 == "string" &&
                    input2.endsWith(".dc.html") &&
                    (0, runtime.isLoadingArtboardHtml)(value660)
                  )
                    throw new Error(
                      "an artboard on this canvas has not loaded (its uploaded content is still arriving, or could not be read) \u2014 export again once it shows",
                    );
                  return typeof value660 == "string" ? value660 : undefined;
                },
                value653: Dynamic = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i,
                entries: Dynamic = new Map(),
                items: Dynamic = [input];
              for (; items.length > 0; ) {
                let value660: Dynamic = items.shift();
                if (entries.has(value660)) continue;
                let value661: Dynamic = await callback15(value660);
                if (
                  value661 !== undefined &&
                  (entries.set(value660, value661), !value653.test(value660))
                )
                  for (let value662 of Object.keys(files) as Dynamic) {
                    if (
                      value662 === value660 ||
                      entries.has(value662) ||
                      value662 === runtime.canvasMetadataFile
                    )
                      continue;
                    let value663: Dynamic = (
                      value662.split("/").pop() ?? value662
                    ).replace(/\.dc\.html$/, "");
                    (value662.endsWith(".dc.html")
                      ? value661.includes('name="' + value663 + '"')
                      : value661.includes(value662) ||
                        value661.includes(
                          value662.split("/").pop() ?? value662,
                        )) && items.push(value662);
                  }
              }
              let callback16: Dynamic = (input2?: Dynamic): Dynamic => {
                  let value660: Dynamic = atob(input2),
                    value661: Dynamic = new Uint8Array(value660.length);
                  for (let index: Dynamic = 0; index < value660.length; index++)
                    value661[index] = value660.charCodeAt(index);
                  return value661;
                },
                value654: Dynamic = await (0,
                runtime.collectExportUploadedAssets)(
                  new Map(
                    [...entries].filter(
                      ([input2]: Dynamic): Dynamic =>
                        (0, runtime.isProjectSourcePath)(input2),
                    ),
                  ),
                  input,
                  runtime.fetchExportAsset,
                  {
                    taken: Object.keys(files),
                    emulatorBlobUrls: (0, runtime.isEmulator)(),
                  },
                );
              for (let [value660, value661] of value654.sources as Dynamic)
                entries.set(value660, value661);
              let items2: Dynamic = [...value654.entries];
              for (let [value660, value661] of entries as Dynamic)
                if (value653.test(value660)) {
                  let value662: Dynamic;
                  try {
                    value662 = callback16(value661.replace(/^data:[^,]*,/, ""));
                  } catch {
                    continue;
                  }
                  items2.push({
                    name: value660,
                    data: value662,
                  });
                } else
                  value660.endsWith(".dc.html")
                    ? items2.push({
                        name: value660,
                        data: (0, runtime.prepareExportDcDocument)(value661),
                      })
                    : items2.push({
                        name: value660,
                        data: value661,
                      });
              items2.push({
                name: "support.js",
                data: assets.supportJs,
              });
              items2.push({
                name: "vendor/react.js",
                data: assets.reactUmd,
              });
              items2.push({
                name: "vendor/react-dom.js",
                data: assets.reactDomUmd,
              });
              let value655: Dynamic = (0, runtime.exportFileName)(
                input,
                value73.current.artboards.find(
                  (input2?: Dynamic): Dynamic => input2.file === input,
                )?.title,
              );
              items2.push({
                name: "README.md",
                data: (0, runtime.designExportReadme)(
                  value655,
                  input,
                  [...entries.keys()].filter(
                    (input2?: Dynamic): Dynamic => input2 !== input,
                  ),
                  value654,
                ),
              });
              let value656: Dynamic = (0, runtime.createStoredZip)(items2),
                value657: Dynamic = value655 + "-html.zip",
                value658: Dynamic = await (0, runtime.saveThroughHost)(
                  value656,
                  value657,
                ),
                value659: Dynamic = (0, runtime.missingExportAssetSuffix)(
                  value654.missing,
                );
              value658.outcome === "saved" &&
                value659 === undefined &&
                showToast("Saved " + value657 + ".", "success");
              value658.outcome !== "withheld" &&
                value658.outcome !== "declined" &&
                value659 !== undefined &&
                showToast(
                  (value658.outcome === "saved" ? "Saved " : "Built ") +
                    value657 +
                    ", " +
                    value659,
                  "error",
                );
              value658.outcome === "withheld" &&
                showToast(runtime.DownloadsArenTAvailableToYouForMessage);
              if (value658.outcome === "unsupported") {
                try {
                  let value660: Dynamic = (document as Dynamic).createElement(
                    "a",
                  );
                  value660.href = URL.createObjectURL(value656);
                  value660.download = value657;
                  value660.rel = "noopener";
                  value660.style.display = "none";
                  (document as Dynamic).body.appendChild(value660);
                  value660.click();
                  value660.remove();
                  setTimeout(
                    (): Dynamic => URL.revokeObjectURL(value660.href),
                    6e4,
                  );
                } catch {}
                (window as Dynamic).dispatchEvent(
                  new CustomEvent(runtime.exportDeliveryEventName, {
                    detail: {
                      url: "",
                      filename: value657,
                      embedWarningCount: 0,
                      file: {
                        blob: value656,
                        mime: "application/zip",
                      },
                      refusal: value658.code,
                    },
                  }),
                );
              }
              (0, runtime.reportExportOutcome)(
                (0, runtime.classifyExportSaveOutcome)("zip", value658.outcome),
                runtime.designAnalyticsEvents.exported.zip,
              );
            } catch (value653: Dynamic) {
              runtime.healthReporter.report(
                ...(0, runtime.classifyExportFailure)("zip"),
              );
              showToast(
                "Couldn't build the HTML zip: " + String(value653),
                "error",
              );
            } finally {
              value479(false);
            }
          }
        },
        [assets, doc, value480, value493, showToast],
      ),
      value508: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async (input?: Dynamic): Promise<Dynamic> => {
          let value653: Dynamic = await Promise.all(
            input.map((input2?: Dynamic): Dynamic => {
              let entry: Dynamic = value177.current.get(input2),
                value654: Dynamic =
                  entry !== undefined && entry.isReady()
                    ? (0, runtime.createPreviewHandle)(entry.webviewRef.current)
                    : null;
              return value654 === null
                ? Promise.resolve(null)
                : (0, runtime.collectArtboardFontDescriptors)(value654);
            }),
          );
          return value653.every((input2?: Dynamic): Dynamic => input2 !== null)
            ? value653.flat()
            : undefined;
        },
        [],
      ),
      value509: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)(async (): Promise<Dynamic> => {
        let value653: Dynamic =
            (document as Dynamic).title ||
            (0, runtime.exportBaseFileName)(filePath),
          value654: Dynamic = AbortSignal.timeout(55e3),
          files: Dynamic = doc.content().files,
          callback15: Dynamic = async (input?: Dynamic): Promise<Dynamic> => {
            let value658: Dynamic =
              (await (0, runtime.getKvClient)().get(
                (0, runtime.PlatformFileContentHandler_4)(input),
              )) ?? files[input];
            if (
              typeof value658 == "string" &&
              input.endsWith(".dc.html") &&
              (0, runtime.isLoadingArtboardHtml)(value658)
            )
              throw new runtime.ExportHtmlError(
                "not_loaded",
                "an artboard on this canvas has not loaded yet",
              );
            return typeof value658 == "string" ? value658 : undefined;
          };
        for (let value658 of value177.current.values() as Dynamic)
          await value658.flushPending();
        let value655: Dynamic = (0, runtime.selectHtmlExportArtboards)(
            value73.current,
            value80.current,
            value346.current,
          ),
          value656: Dynamic = value92
            ? await value508(
                value655.artboards.map(
                  (input?: Dynamic): Dynamic => input.file,
                ),
              )
            : undefined,
          value657: Dynamic = await (0, runtime.produceStandaloneHtmlExport)(
            {
              kind: "canvas",
              title: value653,
              ...value655,
              paths: Object.keys(files).filter(
                (input?: Dynamic): Dynamic =>
                  input !== runtime.canvasMetadataFile,
              ),
              read: callback15,
              fetchBlob: (input?: Dynamic): Dynamic =>
                fetch(input, {
                  credentials: "same-origin",
                  signal: value654,
                }),
              assets: assets,
              importerReady: value92,
              ...(value656 === undefined
                ? {}
                : {
                    fontLoads: value656,
                  }),
            },
            {
              signal: value654,
            },
          );
        for (let value658 of value657.warnings as Dynamic)
          console.warn("[design/export] " + value658);
        return {
          filename: value657.filename,
          data: value657.blob,
        };
      }, [value508, assets, doc, value92, filePath]),
      value510: Dynamic = (0, runtime.reactChromeTheme.useRef)(undefined),
      value511: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)(async (): Promise<Dynamic> => {
        value510.current = undefined;
        try {
          let value653: Dynamic = await value509();
          (0, runtime.reportExportEvent)("htmlBuilt");
          return value653;
        } catch (value653: Dynamic) {
          value510.current = value653;
          console.error("[design/export]", value653);
          let value654: Dynamic =
            value653 instanceof runtime.ExportHtmlError
              ? value653.code
              : undefined;
          throw (
            value654 === "too_large"
              ? (0, runtime.reportExportEvent)("tooLarge")
              : value654 !== "not_loaded" &&
                value654 !== "empty" &&
                value654 !== "timeout" &&
                (0, runtime.reportExportEvent)("failed"),
            showToast(
              value653 instanceof runtime.ExportHtmlError &&
                value653.code === "too_large"
                ? // BaoCut: the export limit is no longer 16 MB (export/downloads.tsx).
                  `This design is too large to send as one file (over ${String(runtime.ExportDownloadsResolvedValue >> 20)} MB).`
                : value653 instanceof runtime.ExportHtmlError &&
                    value653.code === "not_loaded"
                  ? "An artboard is still loading. Try sending again in a moment."
                  : value653 instanceof runtime.ExportHtmlError &&
                      value653.code === "timeout"
                    ? "Preparing this design to send took too long. Try again."
                    : "Couldn't prepare this design to send: " +
                      (0, runtime.errorMessage)(value653) +
                      ".",
              "error",
            ),
            value653
          );
        }
      }, [value509, showToast]),
      value512: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let current4: Dynamic = value510.current;
          (0, runtime.reportExportOutcome)(
            (0, runtime.classifyHtmlDelivery)(
              input,
              current4 instanceof runtime.ExportHtmlError
                ? current4.code
                : undefined,
            ),
            runtime.designAnalyticsEvents.exported.html,
          );
        },
        [],
      ),
      value513: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async (input?: Dynamic): Promise<Dynamic> => {
          if (value493) return;
          if (value480) {
            showToast(runtime.DownloadsArenTAvailableToYouForMessage);
            return;
          }
          let value653: Dynamic = value67.artboards.find(
            (input2?: Dynamic): Dynamic => input2.file === input,
          );
          if (value653) {
            value479(true);
            try {
              let value654: Dynamic = await value483(input);
              if (!value654 || value654.getBoundingClientRect().width === 0) {
                showToast(
                  value177.current.get(input)?.isBlocked()
                    ? "This artboard\u2019s preview is stopped \u2014 reload it before exporting."
                    : "This artboard isn\u2019t visible to capture \u2014 try again in a moment.",
                );
                runtime.healthReporter.report(
                  ...(0, runtime.classifyExportAbort)("pdf"),
                );
                return;
              }
              let value655: Dynamic;
              await (0, runtime.exportPdfWithFeedback)(
                [value653],
                (): Dynamic => value654,
                value653.title ?? (0, runtime.exportBaseFileName)(input),
                (...input2: Dynamic[]): Dynamic =>
                  (value655 = showToast(...input2)),
                {
                  rules: value93,
                  textEncoding: value498,
                  tagged: value499,
                  scope: value485(1, "one"),
                },
                {
                  eligible: value502,
                  action: (
                    input2?: Dynamic,
                    options?: Dynamic,
                    context?: Dynamic,
                  ): Dynamic =>
                    value503(
                      input2,
                      options,
                      (): Dynamic =>
                        value655 !== undefined && hideToast(value655),
                      context,
                    ),
                },
              );
            } finally {
              value479(false);
            }
          }
        },
        [
          value480,
          value483,
          value493,
          value67.artboards,
          value93,
          value502,
          value503,
          hideToast,
          value499,
          value498,
          value485,
          showToast,
        ],
      ),
      value514: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options: Dynamic = 2): Dynamic => {
          let value653: Dynamic = input
            ? (0, runtime.selectedExportableArtboards)(
                value87.current.artboards,
                input,
              )
            : value484;
          if (input && value653.length < options)
            return {
              ok: false,
              reason:
                options > 1
                  ? runtime.exportSelectionHint
                  : "None of the artboards you chose are still on this page.",
              stopped: false,
            };
          if (value653.length === 0)
            return {
              ok: false,
              reason: runtime.noExportableArtboardsMessage,
              stopped: false,
            };
          let value654: Dynamic = value653.find(
            (input2?: Dynamic): Dynamic =>
              value177.current.get(input2.file)?.isBlocked(),
          );
          return value654
            ? {
                ok: false,
                reason:
                  '"' +
                  (value654.title ??
                    (0, runtime.exportBaseFileName)(value654.file)) +
                  '"\u2019s preview is stopped \u2014 reload it before exporting.',
                stopped: true,
              }
            : {
                ok: true,
                printable: value653,
              };
        },
        [value484],
      ),
      value515: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async (input?: Dynamic): Promise<Dynamic> => {
          if (value493) return;
          if (value480) {
            showToast(runtime.DownloadsArenTAvailableToYouForMessage);
            return;
          }
          let value653: Dynamic = value514(input);
          if (!value653.ok) {
            showToast(value653.reason);
            value653.stopped &&
              runtime.healthReporter.report(
                ...(0, runtime.classifyExportAbort)("pdf"),
              );
            return;
          }
          value479(true);
          try {
            let value654: Dynamic;
            await value495(
              value653.printable,
              (): Dynamic =>
                (0, runtime.exportPdfWithFeedback)(
                  value653.printable,
                  value483,
                  input
                    ? ((0, runtime.sanitizeExportFileName)(
                        (document as Dynamic).title,
                        100,
                      ) || "design") + "-selection"
                    : (document as Dynamic).title || "design",
                  (...input2: Dynamic[]): Dynamic =>
                    (value654 = showToast(...input2)),
                  {
                    rules: value93,
                    textEncoding: value498,
                    tagged: value499,
                    scope: value485(value653.printable.length, "whole"),
                  },
                  {
                    eligible: value502,
                    action: (
                      input2?: Dynamic,
                      options?: Dynamic,
                      context?: Dynamic,
                    ): Dynamic =>
                      value503(
                        input2,
                        options,
                        (): Dynamic =>
                          value654 !== undefined && hideToast(value654),
                        context,
                      ),
                  },
                ),
            );
          } finally {
            value479(false);
          }
        },
        [
          value514,
          value480,
          value483,
          value493,
          value93,
          value502,
          value503,
          hideToast,
          value499,
          value498,
          value485,
          showToast,
          value495,
        ],
      ),
      value516: Dynamic = (0, runtime.reactChromeTheme.useRef)({
        notes: [],
        refused: false,
      }),
      value517: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async (input?: Dynamic): Promise<Dynamic> => {
          value516.current = {
            notes: [],
            refused: false,
          };
          let callback15: Dynamic = (
              input2?: Dynamic,
              options?: Dynamic,
              context: Dynamic = "refused",
            ): Dynamic => {
              throw (
                (value516.current.refused = true),
                (0, runtime.reportExportEvent)(context),
                showToast(input2, options),
                new Error(input2)
              );
            },
            text: Dynamic =
              "Another export is still running. Try again when it finishes.";
          if (value494()) return callback15(text);
          let value653: Dynamic = null;
          if (
            input.interactive &&
            value92 &&
            value497 &&
            ((value653 = await value487(
              "pdf",
              {
                picked: (0, runtime.initialExportPickedFiles)(
                  "pdf",
                  value484,
                  value346.current,
                  selectionRef.current.artboards,
                  focusedFileRef.current,
                ),
                scale: 1,
              },
              input.signal,
            )),
            value478.current)
          ) {
            value489();
            return callback15(text);
          }
          let value654: Dynamic = value653
            ? value514(new Set(value653.files), 1)
            : value514();
          if (!value654.ok) {
            value489();
            return callback15(value654.reason);
          }
          let controller: Dynamic = new AbortController(),
            value655: Dynamic = setTimeout(
              (): Dynamic => controller.abort(),
              55e3,
            );
          value653?.signal.addEventListener(
            "abort",
            (): Dynamic => controller.abort(),
          );
          let { signal: value656 }: Dynamic = controller,
            value657: Dynamic = value485(value654.printable.length, "whole"),
            value658: Dynamic = !value657.partial
              ? (document as Dynamic).title || "design"
              : ((0, runtime.sanitizeExportFileName)(
                  (document as Dynamic).title,
                  100,
                ) || "design") + "-selection";
          value479(true);
          try {
            let { blob: value659, ...value660 }: Dynamic = await value495(
              value654.printable,
              (): Dynamic =>
                (0, runtime.collectPdfExportPages)(
                  value654.printable,
                  value483,
                  value658,
                  {
                    signal: value656,
                    rules: value93,
                    textEncoding: value498,
                    tagged: value499,
                  },
                ),
            );
            if (value653?.signal.aborted) throw new runtime.ExportCancelled();
            (0, runtime.reportExportBuilt)({
              ...(0, runtime.pdfExportWarnings)(value660),
              ...value657,
              picked: value653 !== null,
            });
            value516.current.notes = (0, runtime.pdfExportMessage)(
              value660,
              value654.printable.length,
              {
                embeds: true,
                fitAdvice: value660.emptyTailFiles.some(value502),
              },
            );
            return {
              filename: value660.filename,
              data: value659,
            };
          } catch (value659: Dynamic) {
            if (value653?.signal.aborted) throw new runtime.ExportCancelled();
            console.error("[design/export]", value659);
            if (value656.aborted && value659 === value656.reason)
              return callback15(
                "Preparing this design\u2019s PDF took too long. Try again.",
                "error",
                "timedOut",
              );
            throw (
              (0, runtime.reportExportEvent)("failed"),
              showToast(
                "PDF export failed: " +
                  (0, runtime.errorMessage)(value659) +
                  ".",
                "error",
              ),
              value659
            );
          } finally {
            clearTimeout(value655);
            value489();
            value479(false);
          }
        },
        [
          value514,
          value497,
          value487,
          value489,
          value483,
          value494,
          value93,
          value92,
          value502,
          value499,
          value498,
          value484,
          value485,
          value479,
          showToast,
          value495,
        ],
      ),
      value518: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let { notes: current4, refused: current5 }: Dynamic =
            value516.current;
          (0, runtime.reportExportOutcome)(
            (0, runtime.classifyPdfDelivery)(input, current5),
            runtime.designAnalyticsEvents.exported.pdf,
          );
          input.outcome === "delivered" &&
            current4.length > 0 &&
            showToast(
              current4[0],
              undefined,
              current4.length > 1
                ? {
                    description: current4.slice(1).join(" "),
                  }
                : undefined,
            );
        },
        [showToast],
      ),
      value519: Dynamic = (0, runtime.reactChromeTheme.useRef)({
        notes: [],
        refused: false,
      }),
      value520: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      value521: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async (
          items?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
        ): Promise<Dynamic> => {
          let value653: Dynamic = value485(items.length, "whole"),
            callback15: Dynamic = (
              input?: Dynamic,
              options2?: Dynamic,
              context2: Dynamic = "refused",
            ): Dynamic => {
              throw (
                (value519.current.refused = true),
                (0, runtime.reportExportEvent)(context2),
                showToast(input, options2),
                new Error(input)
              );
            };
          if (options.signal.aborted)
            throw (value489(), new runtime.ExportCancelled());
          let controller: Dynamic = new AbortController(),
            value654: Dynamic = setTimeout(
              (): Dynamic => controller.abort(),
              (0, runtime.interactiveExportDeadline)(context) - Date.now(),
            );
          options.signal.addEventListener(
            "abort",
            (): Dynamic => controller.abort(),
          );
          let { signal: value655 }: Dynamic = controller,
            value656: Dynamic = null,
            items2: Dynamic = [],
            index: Dynamic = 0;
          value479(true);
          try {
            let value657: Dynamic = await (0, runtime.captureExportArtboards)(
              items,
              async (input?: Dynamic): Promise<Dynamic> => {
                let value658: Dynamic =
                    '"' +
                    (input.title ??
                      (0, runtime.exportBaseFileName)(input.file)) +
                    '"',
                  value659: Dynamic = await value483(input.file);
                value655.throwIfAborted();
                let value660: Dynamic = value659
                  ? (0, runtime.createPreviewHandle)(value659)
                  : null;
                if (value177.current.get(input.file)?.isBlocked())
                  return callback15(
                    value658 +
                      "\u2019s preview is stopped \u2014 reload it before exporting.",
                  );
                if (!value659 || !value660)
                  return callback15(
                    value658 +
                      " is still loading \u2014 try again in a moment.",
                  );
                if (value659.getBoundingClientRect().width === 0)
                  return callback15(
                    value658 +
                      " isn\u2019t on screen to capture \u2014 scroll to it, then try again.",
                  );
                let value661: Dynamic;
                try {
                  value661 = await (0, runtime.captureArtboardImage)(
                    value660,
                    "png",
                    options.scale,
                    (0, runtime.getArtboardCaptureOptions)(input, {
                      ...value93,
                      settle:
                        value93.settle &&
                        index < runtime.ExportCaptureViewportLimit,
                    }),
                  );
                } catch (value662: Dynamic) {
                  throw ((value656 = value658), value662);
                }
                if (options.signal.aborted) throw new runtime.ExportCancelled();
                return value661.ok
                  ? ((index += value661.settleMs ?? 0),
                    (0, runtime.artboardNeedsScaledDownExport)(input) &&
                      items2.push(value658),
                    {
                      bytes: (0, runtime.dataUrlToBytes)(value661.uri),
                      blank: value661.embedWarningCount,
                      clipped: value661.clipped,
                      fontFallback: value661.fontWarningCount,
                      hiddenContent: value661.hiddenContent,
                    })
                  : callback15(
                      "Couldn\u2019t capture " +
                        value658 +
                        " \u2014 it has nothing visible to export.",
                      "error",
                    );
              },
              {
                signal: value655,
              },
            );
            if (options.signal.aborted) throw new runtime.ExportCancelled();
            (0, runtime.reportExportBuilt)({
              ...(0, runtime.describeExportCaptureWarnings)(
                value657,
                items2.length,
              ),
              ...value653,
              picked: true,
            });
            value519.current.notes = [
              ...(items2.length > 0
                ? [
                    "Saved " +
                      (items2.length > 3
                        ? String(items2.length) + " artboards"
                        : items2.join(", ")) +
                      " at a reduced size: over the capture limit.",
                  ]
                : []),
              ...(value657.clipped.length > 0
                ? [(0, runtime.clippedArtboardsMessage)(value657.clipped)]
                : []),
              ...(0, runtime.fontSubstitutionWarnings)(value657.fontFallback),
              ...(value657.blank === 1
                ? [
                    "1 image could not be embedded and renders blank in the PNGs.",
                  ]
                : value657.blank > 1
                  ? [
                      String(value657.blank) +
                        " images could not be embedded and render blank in the PNGs.",
                    ]
                  : []),
            ];
            return {
              filename:
                ((0, runtime.sanitizeExportFileName)(
                  (document as Dynamic).title,
                  100,
                ) || "design") + "-png.zip",
              data: value657.blob,
            };
          } catch (value657: Dynamic) {
            if (options.signal.aborted) throw new runtime.ExportCancelled();
            if (
              value519.current.refused ||
              value657 instanceof runtime.ExportCancelled
            )
              throw value657;
            console.error(
              "[design/export] PNG archive failed" +
                (value656 !== null ? " capturing " + value656 : "") +
                ": " +
                (value657 instanceof Error ? value657.name : typeof value657),
            );
            if (value655.aborted && value657 === value655.reason)
              return callback15(
                "Preparing these artboards\u2019 PNGs took too long. Try " +
                  (options.scale === 2 ? "1\xD7, or " : "") +
                  "fewer artboards.",
                "error",
                "timedOut",
              );
            throw (
              (0, runtime.reportExportEvent)("failed"),
              showToast(
                value656 !== null
                  ? "Couldn\u2019t capture " +
                      value656 +
                      " as a PNG. " +
                      (options.scale === 2
                        ? "Try 1\xD7, or export without it."
                        : "Try again without it.")
                  : "Couldn\u2019t export these artboards as PNGs. Reload this tab and try again.",
                "error",
              ),
              value657
            );
          } finally {
            clearTimeout(value654);
            value489();
            value479(false);
          }
        },
        [value489, value483, value93, value485, value479, showToast],
      ),
      value522: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        async (input?: Dynamic): Promise<Dynamic> => {
          let value653: Dynamic = Date.now();
          value519.current = {
            notes: [],
            refused: false,
          };
          let callback15: Dynamic = (
              input2?: Dynamic,
              options?: Dynamic,
              context: Dynamic = "refused",
            ): Dynamic => {
              throw (
                (value519.current.refused = true),
                context !== null && (0, runtime.reportExportEvent)(context),
                showToast(input2, options),
                new Error(input2)
              );
            },
            text: Dynamic =
              "Another export is still running. Try again when it finishes.";
          if (value494()) return callback15(text);
          let value654: Dynamic,
            value655: Dynamic,
            value656: Dynamic = null;
          if (input.interactive && value497) {
            let value660: Dynamic = input.bundle ? "pngs" : "png",
              value661: Dynamic = (0, runtime.initialExportPickedFiles)(
                value660,
                value484,
                value346.current,
                selectionRef.current.artboards,
                focusedFileRef.current,
              ),
              value662: Dynamic = value484.filter(
                (input2?: Dynamic): Dynamic => value661.has(input2.file),
              );
            value656 = await value487(
              value660,
              {
                picked: value661,
                scale: (0, runtime.initialExportScale)(
                  value662,
                  value520.current,
                ),
              },
              input.signal,
            );
            let value663: Dynamic = value87.current.artboards.filter(
                (input2?: Dynamic): Dynamic => !input2.frameless,
              ),
              value664: Dynamic = value656.files.flatMap(
                (input2?: Dynamic): Dynamic =>
                  value663.find(
                    (input3?: Dynamic): Dynamic => input3.file === input2,
                  ) ?? [],
              );
            if (value664.length < value656.files.length || value478.current) {
              value489();
              return callback15(
                value478.current
                  ? text
                  : (value656.files.length > 1 ? "An" : "The") +
                      " artboard you chose is no longer on this page.",
              );
            }
            if (value664.length > 1)
              return value521(value664, value656, value653);
            value654 = value664[0];
            value655 = true;
          } else {
            let value660: Dynamic = (0, runtime.selectExportCaptureArtboard)(
              value484,
              value346.current,
              selectionRef.current.artboards,
              focusedFileRef.current,
            );
            if (value660.artboard === null)
              return callback15(
                value660.covered
                  ? '"' +
                      callback2(value346.current) +
                      '" isn\u2019t an artboard. Close its full-window view, then export a PNG.'
                  : runtime.noExportableArtboardsMessage,
              );
            value654 = value660.artboard;
            value655 = value660.chosen;
          }
          let value657: Dynamic = value485(
              1,
              value656 !== null && input.bundle === true ? "whole" : "one",
            ),
            value658: Dynamic =
              '"' +
              (value654.title ??
                (0, runtime.exportBaseFileName)(value654.file)) +
              '"',
            value659: Dynamic = Date.now() + 55e3;
          value479(true);
          try {
            let value660: Dynamic = await value483(value654.file);
            if (value656?.signal.aborted) throw new runtime.ExportCancelled();
            let value661: Dynamic = value660
              ? (0, runtime.createPreviewHandle)(value660)
              : null;
            if (value177.current.get(value654.file)?.isBlocked())
              return callback15(
                value658 +
                  "\u2019s preview is stopped \u2014 reload it before exporting.",
              );
            if (!value660 || !value661)
              return callback15(
                value658 + " is still loading \u2014 try again in a moment.",
              );
            if (value660.getBoundingClientRect().width === 0)
              return callback15(
                value658 +
                  " isn\u2019t on screen to capture \u2014 scroll to it, then try again.",
              );
            let value662: Dynamic = (0, runtime.imageCaptureScaleOptions)(
                value654.w,
                value654.h,
              )
                .filter(
                  (input2?: Dynamic): Dynamic =>
                    input2.fits && input2.scale <= 2,
                )
                .map((input2?: Dynamic): Dynamic => input2.scale),
              value663: Dynamic = value656
                ? value656.scale === 2 && value662.includes(2)
                  ? [2, 1]
                  : [1]
                : value662.includes(2) && value520.current !== value654.file
                  ? [2, 1]
                  : [1],
              value664: Dynamic = await (0,
              runtime.drainArtboardExportCaptures)(
                async (input2?: Dynamic): Promise<Dynamic> => {
                  if (value656?.signal.aborted)
                    throw new runtime.ExportCancelled();
                  let value667: Dynamic = await (0,
                  runtime.captureArtboardImage)(
                    value661,
                    "png",
                    input2,
                    (0, runtime.getArtboardCaptureOptions)(value654, value93),
                  );
                  return value667.ok
                    ? {
                        bytes: (0, runtime.dataUrlToBytes)(value667.uri),
                        blank: value667.embedWarningCount,
                        clipped: value667.clipped,
                        fontFallback: value667.fontWarningCount,
                        hiddenContent: value667.hiddenContent,
                      }
                    : null;
                },
                value663,
                value656 ? 1 / 0 : runtime.ExportDownloadsResolvedValue,
                value659,
              );
            if (value656?.signal.aborted) throw new runtime.ExportCancelled();
            if (!value664.ok) {
              value664.reason === "no_time" &&
                (value520.current = value654.file);
              (value664.reason === "too_large" ||
                (value664.reason === "no_time" &&
                  value664.after === "too_large")) &&
                (0, runtime.reportExportEvent)("tooLarge");
              return callback15(
                value664.reason === "nothing"
                  ? "Couldn\u2019t capture " +
                      value658 +
                      " \u2014 it has nothing visible to export."
                  : value664.reason === "no_time"
                    ? value658 +
                      (value664.after === "too_large"
                        ? ` is over the ${String(runtime.ExportDownloadsResolvedValue >> 20)} MB export limit at 2\xD7`
                        : " could not be captured at 2\xD7") +
                      ", and there wasn\u2019t time to try a smaller size. Try again to export it at 1\xD7."
                    : value658 +
                      ` is over the ${String(runtime.ExportDownloadsResolvedValue >> 20)} MB export limit` +
                      (value663.length > 1 ? " even at 1\xD7" : "") +
                      ". Export the PDF, or use the artboard\u2019s own Export menu.",
                "error",
                value664.reason === "nothing"
                  ? "refused"
                  : value664.reason === "no_time" &&
                      value664.after !== "too_large"
                    ? "timedOut"
                    : null,
              );
            }
            let value665: Dynamic =
                value664.steppedDown !== null
                  ? value664.steppedDown === "too_large"
                    ? ` at 1\xD7 to fit the ${String(runtime.ExportDownloadsResolvedValue >> 20)} MB export limit`
                    : " at 1\xD7: the browser could not capture it at 2\xD7"
                  : value662.length === 0
                    ? " at a reduced size: it is larger than the capture limit"
                    : value656
                      ? ""
                      : value662.includes(2)
                        ? value663[0] === 1
                          ? " at 1\xD7: at 2\xD7 it ran out of time before"
                          : ""
                        : " at 1\xD7: it is too large to capture at 2\xD7",
              value666: Dynamic =
                !value664.clipped &&
                (0, runtime.getArtboardCaptureMode)(value654, value93) ===
                  "full" &&
                (0, runtime.isFillPagedExport)(value654) &&
                Date.now() < value659 - 6e3
                  ? await (0, runtime.measureEmptyExportTail)(value661, {
                      w: value654.w,
                      h: value654.h,
                    }).catch((): Dynamic => null)
                  : null;
            if (value656?.signal.aborted) throw new runtime.ExportCancelled();
            (0, runtime.reportExportBuilt)({
              blankImages: value664.blank,
              clipped: value664.clipped,
              fontFallback: value664.fontFallback,
              scaledDown:
                value664.steppedDown !== null || value662.length === 0,
              ...value657,
              ...value664.hiddenContent,
              picked: value656 !== null,
            });
            value519.current.notes = [
              ...(value665 !== "" || !value655
                ? [
                    "Saved " +
                      value658 +
                      value665 +
                      "." +
                      (value655
                        ? ""
                        : " To pick a different artboard, select it or open it full-window first."),
                  ]
                : []),
              ...(value664.clipped
                ? [
                    (0, runtime.clippedArtboardsMessage)([
                      value654.title ??
                        (0, runtime.exportBaseFileName)(value654.file),
                    ]),
                  ]
                : []),
              ...(value666 !== null &&
              value666 >= runtime.ExportPaperAndScaleLimit_2
                ? [
                    (0, runtime.emptyExportTailMessage)(
                      [
                        value654.title ??
                          (0, runtime.exportBaseFileName)(value654.file),
                      ],
                      value666,
                      value502(value654.file),
                    ),
                  ]
                : []),
              ...(0, runtime.fontSubstitutionWarnings)(value664.fontFallback),
              ...(value664.blank === 1
                ? [
                    "1 image could not be embedded and renders blank in the PNG.",
                  ]
                : value664.blank > 1
                  ? [
                      String(value664.blank) +
                        " images could not be embedded and render blank in the PNG.",
                    ]
                  : []),
            ];
            return {
              filename:
                (0, runtime.exportFileName)(value654.file, value654.title) +
                ".png",
              data: value664.bytes,
            };
          } catch (value660: Dynamic) {
            throw value656?.signal.aborted
              ? new runtime.ExportCancelled()
              : (value519.current.refused ||
                  value660 instanceof runtime.ExportCancelled ||
                  (console.error("[design/export]", value660),
                  (0, runtime.reportExportEvent)("failed"),
                  showToast(
                    "Couldn\u2019t export " +
                      value658 +
                      " as a PNG: " +
                      (0, runtime.errorMessage)(value660) +
                      ". Reload this tab and try again.",
                    "error",
                  )),
                value660);
          } finally {
            value489();
            value479(false);
          }
        },
        [
          value497,
          value487,
          value489,
          value483,
          value494,
          value93,
          value502,
          value484,
          value521,
          value485,
          value479,
          showToast,
        ],
      ),
      value523: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let { notes: current4, refused: current5 }: Dynamic =
            value519.current;
          (0, runtime.reportExportOutcome)(
            (0, runtime.classifyImageDelivery)(input, current5),
            runtime.designAnalyticsEvents.exported.png,
          );
          input.outcome === "delivered" &&
            current4.length > 0 &&
            showToast(
              current4[0],
              undefined,
              current4.length > 1
                ? {
                    description: current4.slice(1).join(" "),
                  }
                : undefined,
            );
        },
        [showToast],
      ),
      value524: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic =>
          input.format === "pdf"
            ? value518(input)
            : input.format === "png"
              ? value523(input)
              : value512(input),
        [value512, value518, value523],
      );
    // BaoCut: the formats sit in a variable so the toolbar Export button (standalone page, next to Play) lists the
    // same ones the host would.
    let baocutExportFormats: Dynamic = value480
      ? null
      : [
          {
            format: "html",
            produce: value511,
          },
          {
            format: "pdf",
            produce: value517,
            interactive: value92 && value497,
            disabled: value484.length === 0,
          },
          ...(value92
            ? [
                {
                  format: "png",
                  produce: value522,
                  interactive: value497,
                  bundle: value497,
                  disabled:
                    value484.length === 0 ||
                    (value347 !== null &&
                      !value484.some(
                        (input?: Dynamic): Dynamic =>
                          input.file === value347.file,
                      )),
                },
              ]
            : []),
        ];
    (0, runtime.useExportFormats)(baocutExportFormats, {
      onResult: value524,
    });
    // BaoCut: a page opened on its own (no BaoCut window around it, e.g. the claude-design skill's local server) has no
    // host menu to export the whole design from, so the toolbar gets an Export button that sends the request the host
    // would. baocutToolbarExports counts that button's requests until they finish (picking artboards included), for its
    // spinner; value476 covers the exports that start elsewhere.
    let baocutStandalonePage: Dynamic =
        typeof window !== "undefined" && window.parent === window,
      [baocutToolbarExports, setBaocutToolbarExports]: Dynamic = (0,
      runtime.reactChromeTheme.useState)(0),
      baocutStartToolbarExport: Dynamic = (entry?: Dynamic): Dynamic => {
        let interactive: Dynamic = entry.interactive === true;
        setBaocutToolbarExports((input?: Dynamic): Dynamic => input + 1);
        Promise.resolve(
          (0, runtime.receiveExportRequest)(
            entry.format,
            // the frame bridge accepts 16–64 of [A-Za-z0-9_-]
            "baocut-toolbar-" +
              Date.now().toString(36) +
              Math.random().toString(36).slice(2, 8),
            interactive,
            undefined,
            entry.bundle === true,
            interactive
              ? runtime.interactiveExportWindowMs
              : runtime.noninteractiveExportWindowMs,
          ),
        ).finally((): Dynamic =>
          setBaocutToolbarExports((input?: Dynamic): Dynamic => input - 1),
        );
      };
    let [value525, value526]: Dynamic = (0, runtime.npm_useLocalStorage_QP)(
        runtime.DcEditorModeKey,
        null,
      ),
      value527: Dynamic = (0, runtime.reactChromeTheme.useRef)(0);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value527.current++;
    }, [value95, value525]);
    let value528: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          abandonSelectionGesture();
          value345.current && value297.current();
          setMode("edit");
          value62();
          setSelection((0, runtime.selectionFromArtboards)(new Set([input])));
          let value653: Dynamic = ++value527.current;
          value273(input).then((input2?: Dynamic): Dynamic => {
            !input2 ||
              value653 !== value527.current ||
              (value96(true), value526("tweaks"));
          });
        },
        [value62, value273, value96, value526, abandonSelectionGesture],
      ),
      value529: Dynamic = (0, runtime.getTweakSelection)(
        editing,
        value95,
        value525,
        value121,
      ),
      value530: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          if (input !== value529) return value528(input);
          value527.current++;
          value96(false);
        },
        [value528, value96, value529],
      ),
      value531: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          abandonSelectionGesture();
          setMode("edit");
          value62();
          setSelection((0, runtime.selectionFromArtboards)(new Set([input])));
          value175((input2?: Dynamic): Dynamic => input2 + 1);
        },
        [value62, abandonSelectionGesture],
      ),
      value532: Dynamic = value173?.file ?? null,
      value533: Dynamic = (0, runtime.reactChromeTheme.useRef)(value532);
    value533.current = value532;
    let value534: Dynamic = (0, runtime.reactChromeTheme.useRef)({
        timer: null,
        pending: null,
      }),
      [value535, value536]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        null,
      ),
      value537: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      value538: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      value539: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let value653: Dynamic =
            input == null ? undefined : value177.current.get(input);
          if (input == null || !value653) return void value536(null);
          if (value538.current > 0 || value534.current.pending?.file === input)
            return;
          let current4: Dynamic = value537.current;
          value653.pageFill().then(
            (input2?: Dynamic): Dynamic => {
              value533.current === input &&
                value537.current === current4 &&
                value536(
                  input2
                    ? {
                        file: input,
                        ...input2,
                      }
                    : null,
                );
            },
            (): Dynamic => {},
          );
        },
        [],
      );
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic => value539(value532),
      [value532, value232, value235, value182, value539],
    );
    let value540: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          value537.current += 1;
          value536((input2?: Dynamic): Dynamic => {
            let value653: Dynamic = input2?.file === input,
              state: Dynamic = {
                file: input,
                background: value653 ? input2.background : "",
                backgroundColor: value653 ? input2.backgroundColor : "",
                vars: value653 ? input2.vars : {},
              };
            for (let value654 of options as Dynamic)
              value654.prop === "background"
                ? (state.background = value654.value ?? "")
                : value654.prop === "background-color" &&
                  (state.backgroundColor = value654.value ?? "");
            return state;
          });
          let callback15: Dynamic = (
            input2?: Dynamic,
            options2?: Dynamic,
          ): Dynamic => {
            value538.current += 1;
            let callback17: Dynamic = (): Dynamic => {
              value538.current -= 1;
              value538.current === 0 &&
                value534.current.pending == null &&
                value539(value533.current);
            };
            return (
              value177.current.get(input2)?.setPageFill(options2) ??
              Promise.resolve(false)
            ).then((input3?: Dynamic): Dynamic => {
              input3 &&
                (0, runtime.announce)(
                  (0, runtime.backgroundEditAnnouncement)(options2),
                );
              callback17();
            }, callback17);
          };
          if (input === focusedFileRef.current)
            return void callback15(input, options);
          let current4: Dynamic = value534.current;
          current4.pending = {
            file: input,
            edits: options,
          };
          if (current4.timer != null) return;
          let callback16: Dynamic = (): Dynamic => {
            current4.timer = null;
            let pending: Dynamic = current4.pending;
            current4.pending = null;
            pending &&
              (callback15(pending.file, pending.edits),
              (current4.timer = setTimeout(callback16, 150)));
          };
          callback16();
        },
        [value539],
      ),
      value541: Dynamic = (0, runtime.reactChromeTheme.useMemo)((): Dynamic => {
        if (value169.size !== 1 || value168.size > 0) return null;
        let value653: Dynamic = [...value169][0],
          value654: Dynamic = (value67.annotations ?? []).find(
            (input?: Dynamic): Dynamic => input.id === value653,
          );
        if (!value654) return null;
        let value655: Dynamic = (0, runtime.isShapeAnnotation)(value654)
          ? (0, runtime.annotationBounds)(value654)
          : {
              x: value654.x,
              y: value654.y,
              w: value654.w,
            };
        return {
          id: value653,
          kind: value654.kind ?? "note",
          x: value655.x,
          y: value655.y,
          w: value655.w,
          ...("h" in value655 &&
          value654.kind !== "line" &&
          value654.kind !== "arrow"
            ? {
                h: value655.h,
              }
            : {}),
          ...((0, runtime.isShapeAnnotation)(value654)
            ? {
                css: value654.css,
                paint: (0, runtime.annotationColor)(
                  value654.kind,
                  value654.color ?? "default",
                ),
                ...(value654.kind === "line" ||
                value654.kind === "arrow" ||
                value654.kind === "pen"
                  ? {
                      strokeWidth:
                        runtime.CanvasAnnotationShapeStyleLineArrowPenConfig[
                          value654.kind
                        ],
                    }
                  : {}),
                ...(value654.kind === "line" || value654.kind === "arrow"
                  ? {
                      heads: (0, runtime.annotationArrowHeads)(value654),
                      onSetHeads: (
                        input?: Dynamic,
                        options?: Dynamic,
                      ): Dynamic => value422(value653, input, options),
                    }
                  : {}),
                onSetCss: (input?: Dynamic, options?: Dynamic): Dynamic =>
                  value421(value653, input, options),
              }
            : {
                textStyle: (0, runtime.annotationTextStyle)(value654),
                maxW: value654.maxW,
                maxH: value654.maxH,
                defaultMaxW:
                  value654.kind === "title1"
                    ? (0, runtime.PlatformFileContentMaxW)({
                        ...value654,
                        maxW: undefined,
                      })
                    : undefined,
                defaultMaxH: Number.isFinite(
                  (0, runtime.PlatformFileContentKind)({
                    ...value654,
                    maxH: undefined,
                  }),
                )
                  ? (0, runtime.PlatformFileContentKind)({
                      ...value654,
                      maxH: undefined,
                    })
                  : undefined,
                onSetTextStyle: (input?: Dynamic, options?: Dynamic): Dynamic =>
                  value423(value653, input, options),
              }),
          ...(value654.kind === "image"
            ? {
                src: value654.src,
                alt: value654.alt,
                ...(value654.video !== undefined
                  ? {
                      video: value654.video,
                    }
                  : {
                      onReplaceImage: (input?: Dynamic): Dynamic =>
                        value424(value653, input),
                    }),
              }
            : {}),
          onSetBox: (input?: Dynamic, options?: Dynamic): Dynamic =>
            value420(value653, input, options, false),
        };
      }, [
        value169,
        value168,
        value67,
        value420,
        value421,
        value422,
        value423,
        value424,
      ]),
      value542: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic =>
          value173
            ? {
                ...value173,
                fill: value535?.file === value173.file ? value535 : null,
                onSetPrint: (input?: Dynamic): Dynamic =>
                  value398(value173.file, input),
                onSetPaper: (input?: Dynamic): Dynamic =>
                  value400(value173.file, input),
                onSetSize: (input?: Dynamic, options?: Dynamic): Dynamic =>
                  value399(value173.file, input, options),
                ...(value502(value173.file)
                  ? {
                      onFitHeight: (): Dynamic => {
                        value501([value173.file]);
                      },
                    }
                  : {}),
                onSetFill: (input?: Dynamic): Dynamic =>
                  value540(value173.file, input),
                onSetRadius: (input?: Dynamic, options?: Dynamic): Dynamic =>
                  value402(value173.file, input, options),
                onSetGuides: (input?: Dynamic): Dynamic =>
                  value401(value173.file, input, false),
                onLiveGuides: (input?: Dynamic): Dynamic =>
                  value401(value173.file, input, true),
                onLiveEnd: (): Dynamic =>
                  value401(
                    value173.file,
                    value73.current.artboards.find(
                      (input?: Dynamic): Dynamic =>
                        input.file === value173.file,
                    )?.guides ?? [],
                    false,
                  ),
              }
            : null,
        [
          value173,
          value535,
          value501,
          value502,
          value398,
          value400,
          value399,
          value540,
          value401,
          value402,
        ],
      ),
      [value543, value544]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        (): Dynamic => new Set(value121 ? [value121] : []),
      );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value121 != null &&
        value544(
          (input?: Dynamic): Dynamic =>
            input.has(value121) ? input : new Set([...input, value121]),
        );
    }, [value121]);
    let [value545, value546]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        {},
      ),
      [value547, value548]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        {},
      ),
      value549: Dynamic = (0, runtime.reactChromeTheme.useRef)(value547);
    value549.current = value547;
    let value550: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
      (): Dynamic =>
        (0, runtime.selectionAnnouncement)(
          selectionRef.current,
          value549.current,
          (input?: Dynamic): Dynamic =>
            value73.current.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input,
            )?.title ?? input.replace(/\.dc\.html$/, ""),
          (input?: Dynamic): Dynamic => {
            let value653: Dynamic = (value73.current.annotations ?? []).find(
              (input2?: Dynamic): Dynamic => input2.id === input,
            );
            return value653 == null || !(0, runtime.isShapeAnnotation)(value653)
              ? "note"
              : value653.kind === "image"
                ? value653.video !== undefined
                  ? "video"
                  : "picture"
                : "shape";
          },
        ),
      [],
    );
    value21.current = value550;
    let value551: Dynamic = (0, runtime.reactChromeTheme.useRef)(0),
      [value552]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        (): Dynamic => ({
          key: null,
          refocusAt: 0,
        }),
      ),
      value553: Dynamic = value67.artboards.map(
        (input?: Dynamic): Dynamic => input.file,
      ).join(`
`),
      value554: Dynamic = value86.artboards.map(
        (input?: Dynamic): Dynamic => input.file,
      ).join(`
`);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let values: Dynamic = new Set(
          value553.split(`
`),
        ),
        callback15: Dynamic = (input?: Dynamic): Dynamic => {
          let value653: Dynamic = Object.keys(input).filter(
            (input2?: Dynamic): Dynamic => !values.has(input2),
          );
          if (value653.length === 0) return input;
          let state: Dynamic = {
            ...input,
          };
          for (let value654 of value653 as Dynamic) delete state[value654];
          return state;
        };
      value544((input?: Dynamic): Dynamic => {
        let values2: Dynamic = new Set(
          [...input].filter((input2?: Dynamic): Dynamic => values.has(input2)),
        );
        return values2.size === input.size ? input : values2;
      });
      value548(callback15);
      value546(callback15);
      value178.current?.keeper.prune();
    }, [value553]);
    let value555: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let entry: Dynamic = value177.current.get(input);
          if (!entry) return;
          let value653: Dynamic = doc.content().files[input] ?? "";
          entry.ensureOutline().then((items?: Dynamic): Dynamic => {
            if (value177.current.has(input)) {
              if ((doc.content().files[input] ?? "") !== value653)
                return value555(input);
              (items == null && (0, runtime.isLoadingArtboardHtml)(value653)) ||
                (items != null &&
                  items.length === 0 &&
                  value73.current.artboards.some(
                    (input2?: Dynamic): Dynamic =>
                      input2.file === input && input2.frameless,
                  ) &&
                  value129(
                    (input2?: Dynamic): Dynamic =>
                      input2.has(input) ? input2 : new Set([...input2, input]),
                  ),
                value548((input2?: Dynamic): Dynamic => {
                  let value654: Dynamic =
                      items ??
                      ((0, runtime.OutlineGlyphsTest)(value653) ? null : []),
                    value655: Dynamic = input2[input];
                  return (
                    value655 === undefined
                      ? false
                      : value655 === null || value654 === null
                        ? value655 === value654
                        : layerEntriesEqual(value655, value654)
                  )
                    ? input2
                    : {
                        ...input2,
                        [input]: value654,
                      };
                }));
            }
          });
        },
        [doc],
      ),
      value556: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic => new runtime.idleTaskScheduler(value555),
        [value555],
      );
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic => (): Dynamic => value556.dispose(),
      [value556],
    );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let value653: Dynamic = value554
        ? value554.split(`
`)
        : [];
      value556.retain((input?: Dynamic): Dynamic => value653.includes(input));
      value556.add(value653);
    }, [value554, value556]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value554 &&
        value556.add(
          value554
            .split(
              `
`,
            )
            .filter(
              (input?: Dynamic): Dynamic =>
                value549.current[input] === undefined,
            ),
        );
    }, [value554, value182, value556]);
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic =>
        (0, runtime.subscribeHtmlReferences)(
          (input?: Dynamic): Dynamic =>
            value556.add(
              input.filter(
                (input2?: Dynamic): Dynamic => value177.current.has(input2),
              ),
            ),
        ),
      [value556],
    );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let callback15: Dynamic = (input?: Dynamic): Dynamic => {
        let value653: Dynamic = input.detail?.paths ?? [],
          value654: Dynamic = value653.filter(
            (input2?: Dynamic): Dynamic =>
              !value177.current.has(input2) &&
              value549.current[input2] !== undefined,
          );
        value654.length > 0 &&
          value548((input2?: Dynamic): Dynamic => {
            let state: Dynamic = {
              ...input2,
            };
            for (let value655 of value654 as Dynamic) delete state[value655];
            return state;
          });
        value556.add(
          value653.filter(
            (input2?: Dynamic): Dynamic => value177.current.has(input2),
          ),
        );
      };
      (window as Dynamic).addEventListener(
        runtime.remoteFilesEventName,
        callback15,
      );
      return (): Dynamic =>
        (window as Dynamic).removeEventListener(
          runtime.remoteFilesEventName,
          callback15,
        );
    }, [value556]);
    let value557: Dynamic = (0, runtime.reactChromeTheme.useRef)(undefined);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let current4: Dynamic = value557.current;
      value557.current = value121;
      current4 === undefined
        ? value121 != null &&
          value556.add([value121], {
            front: true,
          })
        : current4 !== null && current4 !== value121 && value555(current4);
    }, [value121, value556, value555]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let items: Dynamic = [...value234.current];
      value234.current.clear();
      for (let value653 of items as Dynamic) value555(value653);
    }, [value235, value555]);
    let value558: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
      (input?: Dynamic): Dynamic =>
        value105.glide(
          (input2?: Dynamic): Dynamic =>
            (0, runtime.isArtboardInViewport)(input2, input, value120()),
        ),
      [value105, value120],
    );
    value383.current = value558;
    let value559: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
      (input?: Dynamic): Dynamic => {
        let value653: Dynamic = value87.current.artboards.find(
          (input2?: Dynamic): Dynamic => input2.file === input,
        );
        if (value653) {
          if (value345.current) {
            value653.file !== value346.current &&
              value348(
                (input2?: Dynamic): Dynamic =>
                  input2 && {
                    file: value653.file,
                    prev: input2.prev,
                    fit: artboardIsNotExpandedFill(value653),
                  },
              );
            return;
          }
          value558(value653);
        }
      },
      [value558],
    );
    value382.current = value559;
    let value560: Dynamic = (0, runtime.currentCanvasPlaceFragment)(
        selection,
        value347?.file ?? null,
        value79,
        !flag,
      ),
      value561: Dynamic = (0, runtime.reactChromeTheme.useRef)(value560);
    value561.current = value560;
    let value562: Dynamic = (0, runtime.reactChromeTheme.useRef)(
        (): Dynamic => null,
      ),
      value563: Dynamic = (0, runtime.reactChromeTheme.useRef)(null);
    value562.current = (input?: Dynamic, options: Dynamic = false): Dynamic => {
      let value653: Dynamic = (0, runtime.resolveCanvasPlaceAction)(
        input,
        value73.current,
        {
          filling: value346.current,
          plays: true,
          pageId: value80.current,
          mayFocus: value224.current || value225.current || false,
          restoring: options,
        },
      );
      if (value653 === null) return null;
      value563.current?.abort();
      if (value653.do === "nothing") return value653.lands;
      let callback15: Dynamic = (): Dynamic => {
          value284(false);
          abandonSelectionGesture();
          value62();
          let callback16: Dynamic = (input2?: Dynamic): Dynamic => {
            let value655: Dynamic = (0, runtime.recallCanvasView)(input2);
            value655 !== undefined &&
              ((value291.current = false),
              (value310.current = true),
              value105.set(value655, true));
          };
          value653.do === "play"
            ? value380(value653.file)
            : value653.do === "page"
              ? value653.id === value80.current
                ? setSelection(runtime.emptyCanvasSelection)
                : (value298(value653.id),
                  value653.camera || callback16(value653.id))
              : value653.do === "window"
                ? value653.page !== value80.current
                  ? value298(value653.page, value653.file)
                  : (setSelection(runtime.emptyCanvasSelection),
                    value559(value653.file),
                    value273(value653.file))
                : (value653.page !== value80.current
                    ? (value298(
                        value653.page,
                        value653.focus ? value653.file : undefined,
                      ),
                      value653.camera || callback16(value653.page))
                    : (value653.focus && value273(value653.file),
                      value653.camera && value559(value653.file)),
                  setSelection(
                    (0, runtime.selectionFromArtboards)(
                      new Set([value653.file]),
                    ),
                  ));
        },
        value654: Dynamic =
          value653.do === "window" ||
          value653.do === "play" ||
          (value653.do === "page" ? value653.id : value653.page) !==
            value80.current;
      value654 && (0, runtime.initializeDesignKeyboardBindings)();
      let controller: Dynamic = new AbortController();
      value563.current = controller;
      (0, runtime.runFindRevealAfterSettle)(
        value654 && value2.current?.() === true,
        controller.signal,
        value275,
        callback15,
      );
      return value653.lands;
    };
    let value564: Dynamic = (0, runtime.reactChromeTheme.useRef)(null);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      if ((0, runtime.embedMemoryPrefix)() !== "") return;
      let value653: Dynamic = (0, runtime.createPlaceLinkReporter)();
      value564.current = value653;
      let value654: Dynamic = (0, runtime.observeGotoAnchorMessages)(
          (input?: Dynamic): Dynamic => {
            let value656: Dynamic = value562.current(input);
            value656 !== null && (0, runtime.rememberPlaceLink)("goto", input);
            value653.answer(value656 ?? value561.current);
          },
        ),
        value655: Dynamic = (0, runtime.classifyPlaceLink)();
      value655 !== null &&
        ((0, runtime.rememberPlaceLink)("link", value655.place),
        value655.why !== "known" &&
          value562.current(value655.place, value655.why === "here"));
      return (): Dynamic => {
        value654();
        value653.stop();
        value564.current = null;
      };
    }, []);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value564.current?.report(value560);
    }, [value560]);
    let [value565, value566]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        null,
      ),
      value567: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic =>
          value565 === null || value481.has(value565)
            ? value481
            : new Set([...value481, value565]),
        [value481, value565],
      ),
      value568: Dynamic = (0, runtime.reactChromeTheme.useRef)(null),
      [value569]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        runtime.createFindNavigationOriginTracker,
      );
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic => value569.pageIs(value79),
      [value569, value79],
    );
    let value570: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic => ({
          manifest: (): Dynamic => value73.current,
          pageId: (): Dynamic => value80.current,
          windowFile: (): Dynamic => value346.current,
          showsTextMatchesOnCanvas: (): Dynamic => !value99,
          scrollsItself: (input?: Dynamic): Dynamic =>
            input === value346.current || input === value271.current,
          frame: (input?: Dynamic): Dynamic => {
            let entry: Dynamic = value177.current.get(input);
            return entry != null && entry.isReady() && !entry.isBlocked()
              ? entry.webviewRef.current
              : null;
          },
          canvasRoot: (): Dynamic => value106.current,
          storedText: (input?: Dynamic): Dynamic =>
            (0, runtime.designFileTextRuns)(input, doc.content().files[input]),
          keepRunning: value566,
          showPage: (
            input?: Dynamic,
            options?: Dynamic,
            context?: Dynamic,
          ): Dynamic => (
            (0, runtime.initializeDesignKeyboardBindings)(),
            (0, runtime.runFindRevealAfterSettle)(
              value2.current?.() === true,
              context,
              value275,
              (): Dynamic => {
                value298(input, options);
                value291.current = false;
                value569.showedPage(input, value105.get());
              },
            )
          ),
          editorOn: (input?: Dynamic): Dynamic => {
            try {
              return (
                value177.current
                  .get(input)
                  ?.webviewRef.current?.contentDocument?.body?.hasAttribute(
                    "data-dc-editor-on",
                  ) === true
              );
            } catch {
              return false;
            }
          },
          showInWindow: (
            input?: Dynamic,
            options?: Dynamic,
            context?: Dynamic,
          ): Dynamic => {
            let value653: Dynamic = (0, runtime.canRevealFindMatch)(
              input !== value80.current,
              value345.current,
              options === value346.current,
            );
            value653 && (0, runtime.initializeDesignKeyboardBindings)();
            return (0, runtime.runFindRevealAfterSettle)(
              value653 && value2.current?.() === true,
              context,
              value275,
              (): Dynamic => {
                let value654: Dynamic = input !== value80.current;
                if (
                  !(
                    value654 &&
                    (value298(input, options),
                    (value291.current = false),
                    value345.current)
                  )
                ) {
                  if (!value345.current) {
                    let value655: Dynamic = value569.opensWindow(
                      input,
                      value654,
                      value105.get(),
                      value568.current,
                    );
                    value379.current(
                      options,
                      value655 === "page"
                        ? ((0, runtime.recallCanvasView)(input) ??
                            defaultCanvasCamera)
                        : value655 === "fit"
                          ? defaultCanvasCamera
                          : undefined,
                    );
                    return;
                  }
                  value382.current(options);
                }
              },
            );
          },
          panTo: (input?: Dynamic, options?: Dynamic): Dynamic =>
            value105.glide((input2?: Dynamic): Dynamic => {
              value569.pansFrom(input2, value568.current);
              let value653: Dynamic = (0, runtime.isArtboardInViewport)(
                  options === true
                    ? {
                        ...input2,
                        ...(0, runtime.findRestoreCamera)(
                          input2,
                          value568.current,
                        ),
                      }
                    : input2,
                  input,
                  value120(),
                ),
                callback15: Dynamic = (input3?: Dynamic): Dynamic => (
                  (value568.current =
                    options === true
                      ? null
                      : {
                          from: input2,
                          to: input3,
                        }),
                  input3
                ),
                value654: Dynamic = (document as Dynamic)
                  .querySelector("[" + runtime.McFindAttribute + "]")
                  ?.getBoundingClientRect(),
                value655: Dynamic = value106.current?.getBoundingClientRect();
              if (!value654 || !value655) return callback15(value653);
              let value656: Dynamic =
                  value655.left + (input.x - value653.x) * value653.scale,
                value657: Dynamic =
                  value655.top + (input.y - value653.y) * value653.scale,
                value658: Dynamic =
                  value656 < value654.right &&
                  value656 + input.w * value653.scale > value654.left &&
                  value657 < value654.bottom + 8 &&
                  value657 + input.h * value653.scale > value654.top;
              return callback15(
                value658
                  ? {
                      ...value653,
                      y:
                        value653.y -
                        (value654.bottom + 8 - value657) / value653.scale,
                    }
                  : value653,
              );
            }),
          toCanvas: (input?: Dynamic): Dynamic => {
            value105.halt();
            let entry: Dynamic = value105.get(),
              value653: Dynamic = value106.current?.getBoundingClientRect();
            return {
              x: entry.x + (input.x - (value653?.left ?? 0)) / entry.scale,
              y: entry.y + (input.y - (value653?.top ?? 0)) / entry.scale,
              w: input.w / entry.scale,
              h: input.h / entry.scale,
            };
          },
        }),
        [
          value105,
          doc,
          value99,
          value120,
          value298,
          value62,
          value569,
          value275,
        ],
      ),
      value571: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (event?: Dynamic): Dynamic => {
          let current4: Dynamic = focusedFileRef.current;
          if (
            !value357.current ||
            current4 == null ||
            !selectionRef.current.elements.has(current4) ||
            (0, runtime.hasBlockingEditorOverlay)() ||
            value.current === null ||
            value271.current === current4 ||
            value218.current ||
            value193.current != null
          )
            return false;
          let target: Dynamic = event.target;
          if (
            target == null ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName ?? "") ||
            target.isContentEditable === true ||
            (0, runtime.isEditingInputTarget)(event.target)
          )
            return false;
          try {
            let value653: Dynamic =
              value177.current.get(current4)?.webviewRef.current
                ?.contentDocument;
            return value653?.querySelector(
              "[data-dc-editor-dragging],[data-dc-editor-drag-proxy],[data-dc-editor-marquee]",
            ) != null ||
              (target.ownerDocument === value653 &&
                value653?.querySelector("svg[data-dc-editor-overlay]") != null)
              ? false
              : target.ownerDocument === document ||
                  target.ownerDocument === value653;
          } catch {
            return false;
          }
        },
        [],
      ),
      value572: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => doc.subscribe((): Dynamic => input()),
        [doc],
      ),
      value573: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let items: Dynamic = [
            value572(input),
            doc.subscribeSave((): Dynamic => input()),
          ];
          return (): Dynamic =>
            items.forEach((input2?: Dynamic): Dynamic => input2());
        },
        [doc, value572],
      ),
      value574: Dynamic = (0, runtime.useArtboardKeyRouting)({
        host: value570,
        enabled: !value283 && !value492,
        onEnter: (): Dynamic => value275((): Dynamic => {}),
        settle: value275,
        textEditOpen: (): Dynamic => value2.current?.() === true,
        ownsStepChord: value571,
        pageOwnsKeys: (input?: Dynamic): Dynamic =>
          value271.current === input || (value346.current === input && true),
        subscribe: value572,
        textEditIn: (): Dynamic =>
          value2.current?.() === true ? focusedFileRef.current : null,
        editBeganFromStop: (): Dynamic =>
          value24.current?.editBeganFromStop() ?? null,
        walkInside: (): Dynamic => value24.current?.insideRef.current ?? null,
        stopOf: callback11,
      });
    value165.current = {
      booted: value574.frameBooted,
      seen: value574.frameSeen,
      gone: value574.frameGone,
    };
    let { changed: value575 }: Dynamic = value574,
      value576: Dynamic = value347?.file ?? null;
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic => value575(),
      [value575, value79, value576, value269, value232, value235, value82],
    );
    let value577: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let current4: Dynamic = value73.current,
            value653: Dynamic = (0, runtime.findArtboardByName)(
              current4.artboards,
              input,
              (input2?: Dynamic): Dynamic =>
                (0, runtime.designPageId)(input2, current4.pages) ===
                value80.current,
            );
          if (value653 === null || value653 === "ambiguous") {
            let value655: Dynamic = (0, runtime.isEditableComponentName)(
                value19(input),
              )
                ? value19(input)
                : "that component",
              value656: Dynamic = [
                ...new Set(
                  current4.artboards
                    .filter(
                      (input2?: Dynamic): Dynamic =>
                        value19(input2.file) === value19(input),
                    )
                    .map(
                      (input2?: Dynamic): Dynamic =>
                        (0, runtime.designPageId)(input2, current4.pages),
                    ),
                ),
              ].map(
                (input2?: Dynamic): Dynamic =>
                  current4.pages?.find(
                    (input3?: Dynamic): Dynamic => input3.id === input2,
                  )?.name ?? "this page",
              );
            showToast(
              value653
                ? `There's more than one ${value655} artboard (on ${value656.join(", ")}) \u2014 select the one you mean on the canvas.`
                : `There's no ${value655} artboard in this design.`,
            );
            return;
          }
          value345.current && value297.current();
          abandonSelectionGesture();
          value62();
          let value654: Dynamic = (0, runtime.designPageId)(
            value653,
            current4.pages,
          );
          value654 !== value80.current
            ? value298(value654, value653.file)
            : (value273(value653.file), value559(value653.file));
          setSelection(
            (0, runtime.selectionFromArtboards)(new Set([value653.file])),
          );
        },
        [
          value298,
          value273,
          value559,
          value62,
          showToast,
          abandonSelectionGesture,
        ],
      ),
      value578: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic =>
          value314(
            (0, runtime.boardSelectionItems)({
              file: input,
            }),
            options ? "toggle" : "replace",
          ),
        [value314],
      );
    value29.current = value578;
    let value579: Dynamic = (0, runtime.canvasSelectionKey)(selection);
    (0, runtime.useVectorToolReset)(value337, value579, value341);
    let value580: Dynamic = (0, runtime.reactChromeTheme.useRef)(null);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let current4: Dynamic = value580.current;
      value580.current = {
        sel: value579,
        page: value79,
        first: value78,
      };
      let current5: Dynamic = value23.current;
      value23.current = false;
      if (current4 == null) return;
      let value653: Dynamic = current4.sel !== value579;
      if (
        !(
          current4.page === value79 ||
          (current4.page === "" && value79 === value78) ||
          (value79 === "" && current4.page === current4.first)
        )
      ) {
        let value654: Dynamic = value289;
        (0, runtime.announce)(
          (): Dynamic => {
            let value655: Dynamic =
                value654 &&
                (document as Dynamic).activeElement === value286.current,
              value656: Dynamic = (0, runtime.canvasSelectionKey)(
                selectionRef.current,
              ),
              value657: Dynamic = [
                value655 ? null : (0, runtime.pageAnnouncement)(value81),
                value656 !== current4.sel && value656 !== "none"
                  ? value550()
                  : null,
              ].filter((input?: Dynamic): Dynamic => input != null);
            return value657.length > 0 ? value657.join(", ") : null;
          },
          {
            ifIdle: true,
          },
        );
        return;
      }
      if (value653) {
        if (current5) {
          (0, runtime.announce)((): Dynamic => null, {
            ifIdle: true,
          });
          return;
        }
        value24.current?.saidSelection(selectionRef.current) ||
          (0, runtime.announce)(value550, {
            ifIdle: true,
          });
      }
    }, [value579, value79, value78]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value23.current = false;
    });
    let value581: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (
          input?: Dynamic,
          options?: Dynamic,
          context?: Dynamic,
          value653?: Dynamic,
          extra?: Dynamic,
        ): Dynamic => {
          let value654: Dynamic = value19(input),
            value655: Dynamic =
              value653 != null
                ? ++selectionEpochRef.current
                : abandonSelectionGesture(),
            callback15: Dynamic = (): Dynamic => {
              selectionEpochRef.current === value655 &&
                selectionEpochRef.current++;
            };
          value124(
            value73.current.artboards.some(
              (input2?: Dynamic): Dynamic =>
                input2.file === input && input2.frameless,
            )
              ? input
              : null,
          );
          value62();
          value23.current = true;
          setSelection(runtime.emptyCanvasSelection);
          value273(input).then((): Dynamic => {
            let index: Dynamic = 0,
              index2: Dynamic = 0,
              index3: Dynamic = 0,
              callback16: Dynamic = (): Dynamic => {
                if (selectionEpochRef.current !== value655)
                  return extra?.("superseded");
                if (
                  selectionRef.current.elements
                    .get(input)
                    ?.tids.includes(options)
                )
                  return extra?.("landed");
                if (index >= 25 || index2++ >= 400) return extra?.("gave-up");
                let entry: Dynamic = value177.current.get(input);
                if (context && Date.now() - index3 < 300) {
                  (window as Dynamic).setTimeout(callback16, 60);
                  return;
                }
                focusedFileRef.current === input &&
                  entry?.isReady() &&
                  (value653 == null && (value25.current = input),
                  !entry.setShownSelection(null, null, value653) &&
                    value653 == null &&
                    (value25.current = null),
                  entry.setShownSelection([options], value654, value653) &&
                    (index++, (index3 = Date.now()), context?.()));
                (window as Dynamic).setTimeout(callback16, 60);
              };
            (window as Dynamic).setTimeout(callback16, 60);
          });
          return callback15;
        },
        [value62, value273, abandonSelectionGesture],
      ),
      value582: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic, context?: Dynamic): Dynamic => {
          let entry: Dynamic = value177.current.get(input);
          if (!entry) return;
          let value653: Dynamic = abandonSelectionGesture();
          value62();
          setSelection(runtime.emptyCanvasSelection);
          let callback15: Dynamic = (): Dynamic => {
            selectionEpochRef.current === value653 &&
              value273(input).then((): Dynamic => {
                selectionEpochRef.current === value653 && value124(input);
              });
          };
          if (!entry.isReady()) {
            callback15();
            return;
          }
          entry.pickAt(options, context).then((input2?: Dynamic): Dynamic => {
            selectionEpochRef.current === value653 &&
              (input2 && "tid" in input2
                ? value581(input, input2.tid)
                : callback15());
          }, callback15);
        },
        [value62, value273, value581, abandonSelectionGesture],
      ),
      value583: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Map()),
      value584: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Map()),
      value585: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Map()),
      value586: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          value129((input2?: Dynamic): Dynamic => {
            if (input2.has(input) === (options == null)) return input2;
            let values: Dynamic = new Set(input2);
            options == null ? values.add(input) : values.delete(input);
            return values;
          });
          let current4: Dynamic = value583.current,
            entry: Dynamic = current4.get(input);
          entry && clearTimeout(entry);
          if (options == null) {
            current4.delete(input);
            value584.current.delete(input);
            return;
          }
          let callback15: Dynamic = (): Dynamic => {
            current4.delete(input);
            let value653: Dynamic = value73.current.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input,
            );
            if (!value653 || !value653.frameless) return;
            let value654: Dynamic =
              value127.current.has(input) ||
              value125.current === input ||
              focusedFileRef.current === input;
            if (!value224.current || !value654) {
              value584.current.set(input, options);
              return;
            }
            value584.current.delete(input);
            if (value218.current || value202.current || value427.current) {
              current4.set(input, setTimeout(callback15, 300));
              return;
            }
            if (
              Math.abs(value653.w - options.w) <= 1 &&
              Math.abs(value653.h - options.h) <= 1
            )
              return;
            let value655: Dynamic = Date.now(),
              value656: Dynamic = (value585.current.get(input) ?? []).filter(
                (input2?: Dynamic): Dynamic => value655 - input2 < 5e3,
              );
            if (value656.length >= 8) {
              current4.set(
                input,
                setTimeout(callback15, 5e3 - (value655 - value656[0])),
              );
              return;
            }
            value585.current.set(input, [...value656, value655]);
            let value657: Dynamic = value72(
              (0, runtime.replaceDesignArtboards)(
                value73.current,
                value73.current.artboards.map(
                  (input2?: Dynamic): Dynamic =>
                    input2.file === input
                      ? {
                          ...input2,
                          w: options.w,
                          h: options.h,
                        }
                      : input2,
                ),
              ),
            );
            value70.current = value657;
            value73.current = value657;
            value68(value657);
            (0, runtime.getKvClient)()
              .set(
                (0, runtime.PlatformFileContentHandler_4)(
                  runtime.canvasMetadataFile,
                ),
                (0, runtime.serializeCanvasMetadata)(value657),
                {
                  auto: true,
                },
              )
              .catch((): Dynamic => {});
          };
          current4.set(input, setTimeout(callback15, 400));
        },
        [],
      );
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic => (): Dynamic => {
        for (let value653 of value583.current.values() as Dynamic)
          clearTimeout(value653);
      },
      [],
    );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      if (editing)
        for (let [value653, value654] of [...value584.current] as Dynamic)
          (value127.current.has(value653) ||
            value123 === value653 ||
            value121 === value653) &&
            value586(value653, value654);
    }, [editing, value123, value121, value586]);
    let [value587, value588]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        null,
      ),
      value589: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let files: Dynamic = doc.content().files;
          if (
            !(input.size === 0
              ? options.size > 0
              : [...input].some((input2?: Dynamic): Dynamic => {
                  let value655: Dynamic = files[input2];
                  return (
                    typeof value655 == "string" &&
                    !(0, runtime.isLoadingArtboardHtml)(value655)
                  );
                }))
          )
            return;
          let value653: Dynamic = value473(input, options),
            value654: Dynamic = (0, runtime.copyClipboardObject)(
              runtime.DesignArtboardsKey,
              {
                data: {
                  stamp: value653.stamp,
                  ...value466.current(input, options),
                },
                text: value653.rendition,
              },
            );
          value463.current(
            input,
            options,
            (): Dynamic => (value654 ? value653 : undefined),
          );
        },
        [doc, value473],
      ),
      value590: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let current4: Dynamic = value73.current,
            value653: Dynamic = current4.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input,
            );
          !value653 ||
            current4.cover === input ||
            (value396.current(
              {
                kind: "cover",
                from: (0, runtime.validCoverArtboard)(
                  current4.cover,
                  current4.artboards,
                ),
                to: input,
              },
              new Set(),
            ),
            value98({
              ...current4,
              cover: input,
            }),
            (0, runtime.announce)(
              "\u201C" +
                (value653.title ?? input.replace(/\.dc\.html$/, "")) +
                "\u201D is now the thumbnail.",
            ));
        },
        [value98],
      ),
      value591: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {
        let value653: Dynamic = (0, runtime.getArtboardClipboard)(),
          value654: Dynamic = (0, runtime.getAnnotationClipboard)(),
          value655: Dynamic = value109(),
          value656: Dynamic = value653
            ? value112(
                value653,
                value654,
                value655,
                value655?.overAnnotation ? null : value655,
              )
            : null;
        return {
          label: runtime.KeyboardEditActionsCutCopyPasteConfig.paste.label,
          hotkey: runtime.KeyboardEditActionsCutCopyPasteConfig.paste.shortcut,
          disabledReason: value224.current
            ? value653
              ? undefined
              : "No artboard or object copied in this tab yet. Press " +
                (0, runtime.keyboardShortcutLabel)("V") +
                " to paste anything else."
            : runtime.ViewOnlyYouCanInspectThisMessage,
          onClick: (): Dynamic => {
            value224.current &&
              value653 &&
              value464.current(value653, value654, value656);
          },
        };
      }, [value109, value112]),
      value592: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options: Dynamic = false): Dynamic => {
          let current4: Dynamic = selectionRef.current,
            value653: Dynamic = current4.artboards.has(input),
            value654: Dynamic = value653
              ? current4.artboards
              : new Set([input]);
          value653 || value578(input, false);
          let size: Dynamic = value654.size,
            value655: Dynamic =
              size > 1 ? " " + String(size) + " artboards" : "",
            value656: Dynamic = value224.current
              ? undefined
              : runtime.ViewOnlyYouCanInspectThisMessage,
            callback15: Dynamic = (): Dynamic => value224.current && true,
            current5: Dynamic = value73.current,
            value657: Dynamic = current5.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input,
            ),
            value658: Dynamic = value271.current === input,
            value659: Dynamic = value658
              ? undefined
              : value657?.frameless
                ? loosePiecePlaybackMessage
                : value657?.is_interactive !== true
                  ? staticArtboardPlaybackMessage
                  : undefined;
          return [
            {
              label: "Copy" + value655,
              hotkey: "cmd+c",
              disabledReason: undefined,
              onClick: (): Dynamic => {
                value589(
                  value654,
                  value653 ? current4.notes : emptyCanvasSelectionFiles,
                );
              },
            },
            ...(value92 && (0, runtime.supportsClipboardImages)()
              ? [
                  {
                    label: "Copy as PNG",
                    disabledReason: value480
                      ? runtime.DownloadsArenTAvailableToYouForMessage
                      : size > 1
                        ? singleArtboardPngCopyMessage
                        : undefined,
                    onClick: (): Dynamic => value505(input),
                  },
                  {
                    label: "Copy as SVG",
                    disabledReason: value480
                      ? runtime.DownloadsArenTAvailableToYouForMessage
                      : size > 1
                        ? singleArtboardSvgCopyMessage
                        : undefined,
                    onClick: (): Dynamic => value506(input),
                  },
                ]
              : []),
            value591(),
            {
              label:
                runtime.KeyboardEditActionsCutCopyPasteConfig.duplicate.label +
                value655,
              hotkey:
                runtime.KeyboardEditActionsCutCopyPasteConfig.duplicate
                  .shortcut,
              disabledReason: value656,
              onClick: (): Dynamic => {
                callback15() &&
                  value323.current({
                    files: value654,
                    notes: value653
                      ? current4.notes
                      : emptyCanvasSelectionFiles,
                  });
              },
            },
            ...["front", "back"].map(
              (input2?: Dynamic, options2?: Dynamic): Dynamic => ({
                label:
                  runtime.KeyboardEditActionsCutCopyPasteConfig[input2].label,
                hotkey:
                  runtime.KeyboardEditActionsCutCopyPasteConfig[input2]
                    .shortcut,
                separatorBefore: options2 === 0,
                disabledReason:
                  value656 ??
                  ((0, runtime.reorderArtboardsOnPages)(
                    current5.artboards,
                    value654,
                    input2,
                    current5.pages,
                  ) === null
                    ? (0, runtime.stackingAnnouncement)(input2, false)
                    : undefined),
                onClick: (): Dynamic => {
                  callback15() && value403(value654, input2);
                },
              }),
            ),
            {
              label: "Rename",
              separatorBefore: true,
              disabledReason:
                value656 ??
                (options && value657?.frameless
                  ? loosePieceRenameHint
                  : undefined),
              onClick: (): Dynamic => {
                if (!callback15()) return;
                if (!options) return void value588(input);
                let scale: Dynamic = value105.get().scale;
                value657 &&
                  value383.current({
                    x: value657.x,
                    y: value657.y - 32 / scale,
                    w: Math.min(value657.w, 240 / scale),
                    h: 40 / scale,
                  });
                value293.current?.(input);
              },
            },
            {
              label: "Set as thumbnail",
              disabledReason: value224.current
                ? current5.cover === input
                  ? existingThumbnailMessage
                  : value657 !== undefined &&
                      (0, runtime.shouldStoreArtboardByReference)(
                        value657,
                        doc.content().files[input] ?? "",
                      )
                    ? oversizedThumbnailMessage
                    : undefined
                : runtime.ViewOnlyYouCanInspectThisMessage,
              onClick: (): Dynamic => {
                callback15() && value590(input);
              },
            },
            {
              label: value658
                ? value224.current
                  ? "Edit"
                  : "Stop"
                : "Play on canvas",
              disabledReason: value659,
              onClick: (): Dynamic => {
                value658
                  ? value224.current || value225.current
                    ? value274.current(input)
                    : value384(null)
                  : value384(input);
              },
            },
            {
              label:
                value657?.is_interactive === true && !value657.frameless
                  ? "Play full screen"
                  : "Open full window",
              disabledReason: undefined,
              onClick: (): Dynamic => {
                value379.current(input);
              },
            },
            {
              label: "Delete" + value655,
              separatorBefore: true,
              danger: true,
              ...(value653 &&
              (current4.notes.size > 0 || current4.elements.size > 0)
                ? null
                : {
                    hotkey: "backspace",
                  }),
              disabledReason: value656,
              onClick: (): Dynamic => {
                callback15() && value449(value654);
              },
            },
          ];
        },
        [
          value578,
          value589,
          value505,
          value506,
          value480,
          value92,
          value591,
          value590,
          value403,
          value449,
          doc,
          value384,
          value105,
        ],
      ),
      value593: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          let current4: Dynamic = selectionRef.current,
            value653: Dynamic = current4.notes.has(input),
            state: Dynamic = {
              files: runtime.emptyBoardSelection.files,
              notes: value653 ? current4.notes : new Set([input]),
            };
          !value653 && value224.current && value314(state, "replace");
          let size: Dynamic = state.notes.size,
            value654: Dynamic = value653
              ? current4.artboards
              : emptyCanvasSelectionFiles,
            value655: Dynamic = size + value654.size,
            value656: Dynamic = (value73.current.annotations ?? []).filter(
              (input2?: Dynamic): Dynamic => state.notes.has(input2.id),
            ),
            callback15: Dynamic = (input2?: Dynamic): Dynamic => {
              if (value653 && current4.elements.size > 0) return;
              let value657: Dynamic = (0, runtime.flipAnnotations)(
                value656,
                input2,
              );
              return value657.flips.length > 0 ? undefined : value657.refused;
            };
          return [
            {
              label:
                "Copy" +
                (value655 > 1 ? " " + String(value655) + " objects" : ""),
              hotkey: "cmd+c",
              disabledReason: value224.current
                ? undefined
                : runtime.ViewOnlyYouCanInspectThisMessage,
              onClick: (): Dynamic => {
                value224.current && value589(value654, state.notes);
              },
            },
            value591(),
            {
              label:
                runtime.KeyboardEditActionsCutCopyPasteConfig.duplicate.label +
                (value655 > 1 ? " " + String(value655) + " objects" : ""),
              hotkey:
                runtime.KeyboardEditActionsCutCopyPasteConfig.duplicate
                  .shortcut,
              disabledReason: value224.current
                ? undefined
                : runtime.ViewOnlyYouCanInspectThisMessage,
              onClick: (): Dynamic => {
                value224.current &&
                  value323.current({
                    files: value654,
                    notes: state.notes,
                  });
              },
            },
            ...(!(value653 && current4.elements.size > 0) &&
            value656.every(
              (source?: Dynamic): Dynamic => source.kind === undefined,
            )
              ? []
              : ["horizontal", "vertical"]
            ).map(
              (input2?: Dynamic, options?: Dynamic): Dynamic => ({
                label: "Flip " + input2,
                separatorBefore: options === 0,
                hotkey: input2 === "horizontal" ? "shift+h" : "shift+v",
                disabledReason: value224.current
                  ? ((value653 ? value150() : undefined) ?? callback15(input2))
                  : runtime.ViewOnlyYouCanInspectThisMessage,
                onClick: (): Dynamic => {
                  value653
                    ? value152.current(input2)
                    : value46.current(state.notes, input2);
                },
              }),
            ),
            {
              label:
                "Delete" + (size > 1 ? " " + String(size) + " objects" : ""),
              separatorBefore: true,
              danger: true,
              ...(value653 &&
              (current4.artboards.size > 0 || current4.elements.size > 0)
                ? null
                : {
                    hotkey: "backspace",
                  }),
              disabledReason: value224.current
                ? undefined
                : runtime.ViewOnlyYouCanInspectThisMessage,
              onClick: (): Dynamic => {
                value224.current && value459.current(state);
              },
            },
          ];
        },
        [value314, value589, value591, value150],
      ),
      value594: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (): Dynamic => [
          value591(),
          {
            label: fitArtboardsLabel,
            hotkey: "cmd+0",
            separatorBefore: true,
            onClick: (): Dynamic => {
              value292.current();
            },
          },
        ],
        [value591],
      ),
      value595: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Map()),
      value596: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic =>
          (0, runtime.reconcileAnnotationOutline)(
            value86.annotations ?? [],
            value595.current,
          ),
        [value86.annotations],
      ),
      [value597, value598]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        null,
      ),
      value599: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (source?: Dynamic, options?: Dynamic): Dynamic => {
          if (
            value294.current ||
            value2.current?.() === true ||
            (source.kind !== "object" && selectionRef.current.elements.size > 1)
          )
            return;
          source.kind === "canvas" && value278();
          let value653: Dynamic =
              source.kind === "artboard"
                ? value592(source.file, true)
                : source.kind === "object"
                  ? value593(source.id)
                  : value594(),
            value654: Dynamic =
              source.kind === "artboard"
                ? (value73.current.artboards.find(
                    (input?: Dynamic): Dynamic => input.file === source.file,
                  )?.title ?? source.file.replace(/\.dc\.html$/, ""))
                : source.kind === "object"
                  ? (value596.find(
                      (input?: Dynamic): Dynamic => input.id === source.id,
                    )?.label ?? "Object")
                  : "Canvas";
          value598({
            x: options.x,
            y: options.y,
            keyboard: options.keyboard === true,
            items: value653.map(runtime.OutlineGlyphsLabel),
            label: value654 + " actions",
          });
        },
        [value278, value592, value593, value594, value596],
      );
    value295.current = value599;
    let [value600]: Dynamic = (0, runtime.reactChromeTheme.useState)(
      (): Dynamic => ({
        path: "",
        row: "",
      }),
    );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      selection.elements.size === 0 && (value600.path = value600.row = "");
    }, [selection, value600]);
    let value601: Dynamic = (0, runtime.validCoverArtboard)(
        value67.cover,
        value67.artboards,
      ),
      value602: Dynamic = (0, runtime.useCanvasKeyboardNavigation)(
        {
          focusedFileRef: focusedFileRef,
          megaSelRef: selectionRef,
          handlesRef: value177,
          canEditRef: value224,
          titleOf: (input?: Dynamic): Dynamic =>
            value73.current.artboards.find(
              (input2?: Dynamic): Dynamic => input2.file === input,
            )?.title ?? input.replace(/\.dc\.html$/, ""),
          rootNameOf: value19,
          selectElementIn: value581,
          clearSelectionQuietly: (): Dynamic => {
            selectionEpochRef.current++;
            value62();
            value23.current = true;
            setSelection(runtime.emptyCanvasSelection);
          },
          selectLayerNow: (
            input?: Dynamic,
            options?: Dynamic,
            context?: Dynamic,
            value653?: Dynamic,
          ): Dynamic => {
            let entry: Dynamic = value177.current.get(input);
            return focusedFileRef.current !== input ||
              !entry ||
              !entry.isReady()
              ? false
              : (value653 && selectionEpochRef.current++,
                entry.setShownSelection(null, null, context),
                entry.setShownSelection([options], value19(input), context));
          },
          forgetHostSelection: (input?: Dynamic): Dynamic => {
            selectionRef.current = (0, runtime.filterSelectedElements)(
              selectionRef.current,
              (input2?: Dynamic): Dynamic => input2 !== input,
            );
            setSelection(
              (input2?: Dynamic): Dynamic =>
                (0, runtime.filterSelectedElements)(
                  input2,
                  (input3?: Dynamic): Dynamic => input3 !== input,
                ),
            );
          },
          selectArtboard: (input?: Dynamic): Dynamic =>
            value314(
              (0, runtime.boardSelectionItems)({
                file: input,
              }),
              "replace",
            ),
          clearFrameSelection: (
            input?: Dynamic,
            options?: Dynamic,
          ): Dynamic => {
            value177.current.get(input)?.setShownSelection(null, null, options);
          },
          focusArtboard: (input?: Dynamic): Dynamic => value274.current(input),
          bringArtboardIntoView: value559,
          stopOf: callback11,
          sayUnreadable: value40,
        },
        value547,
      );
    value24.current = value602;
    let value603: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic => ({
          onEnter: value602.enter,
          onStep: value602.step,
          onDescend: value602.descend,
          onAscend: value602.ascend,
          onLeave: value602.leave,
          holdKey: value602.holdKey,
        }),
        [
          value602.enter,
          value602.step,
          value602.descend,
          value602.ascend,
          value602.leave,
          value602.holdKey,
        ],
      ),
      value604: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic => ({
          inside: value602.inside,
          keys: value603,
          onAbandon: value602.abandon,
          onTextEditEnded: value602.onTextEditEnded,
        }),
        [value602.inside, value603, value602.abandon, value602.onTextEditEnded],
      ),
      value605: Dynamic = (0, runtime.reactChromeTheme.useRef)(value121);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let value653: Dynamic = value605.current !== value121;
      value605.current = value121;
      let current4: Dynamic = value602.insideRef.current;
      current4 != null &&
        ((value653 && value121 !== current4) ||
          (0, runtime.canvasElementSelectionCount)(selection) ||
          !(value356 || value358) ||
          value347 != null) &&
        value602.abandon();
    }, [value602, value121, selection, value356, value358, value347]);
    let value606: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic => ({
          rows: value86.artboards.map(
            (input?: Dynamic): Dynamic => ({
              file: input.file,
              label: input.title ?? input.file.replace(/\.dc\.html$/, ""),
            }),
          ),
          selected: value168,
          cover: value601,
          contextActions: value592,
          renaming: value587,
          onRename: (input?: Dynamic, options?: Dynamic): Dynamic => {
            value588(null);
            options != null && value224.current && value397(input, options);
          },
          selectedIn: value170,
          open: value543,
          trees: value547,
          expanded: value545,
          scroll: value551,
          cursor: value552,
          revealed: value600,
          objects: value596,
          selectedObjects: value169,
          onSelectObject: (input?: Dynamic, options?: Dynamic): Dynamic => {
            value224.current &&
              value314(
                (0, runtime.boardSelectionItems)({
                  note: input,
                }),
                options ? "toggle" : "replace",
              );
          },
          objectContextActions: value593,
          onToggleOpen: (input?: Dynamic, options?: Dynamic): Dynamic =>
            value544((input2?: Dynamic): Dynamic => {
              if (input2.has(input) === options) return input2;
              let values: Dynamic = new Set(input2);
              options ? values.add(input) : values.delete(input);
              return values;
            }),
          onExpandedChange: (input?: Dynamic, options?: Dynamic): Dynamic =>
            value546(
              (input2?: Dynamic): Dynamic => ({
                ...input2,
                [input]: options,
              }),
            ),
          onSelectIn: (input?: Dynamic, options?: Dynamic): Dynamic => {
            value559(input);
            value581(input, options);
          },
          onFocus: (input?: Dynamic): Dynamic => {
            abandonSelectionGesture();
            value544(
              (input2?: Dynamic): Dynamic =>
                input2.has(input) ? input2 : new Set([...input2, input]),
            );
            value62();
            setSelection((0, runtime.selectionFromArtboards)(new Set([input])));
            value273(input);
            value559(input);
            value549.current[input] === null && value40(input);
          },
          onToggleSelected: (input?: Dynamic): Dynamic => value578(input, true),
        }),
        [
          value578,
          value592,
          value593,
          value596,
          value600,
          value169,
          value314,
          value587,
          value397,
          value86.artboards,
          value601,
          value168,
          value170,
          value543,
          value547,
          value545,
          value552,
          value62,
          value273,
          value559,
          value581,
          value40,
        ],
      ),
      [value607, value608]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        false,
      );
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let value653: Dynamic = (window as Dynamic).setTimeout(
        (): Dynamic => value608(true),
        900,
      );
      return (): Dynamic => (window as Dynamic).clearTimeout(value653);
    }, []);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let value653: Dynamic = [60, 450].map(
        (input?: Dynamic): Dynamic =>
          (window as Dynamic).setTimeout(
            (): Dynamic =>
              (0, runtime.refreshDesktopRendering)(
                (document as Dynamic).querySelector("header"),
              ),
            input,
          ),
      );
      return (): Dynamic =>
        value653.forEach(
          (input?: Dynamic): Dynamic => (window as Dynamic).clearTimeout(input),
        );
    }, [editing]);
    let value609: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic, options?: Dynamic): Dynamic => {
          let value653: Dynamic = Date.now();
          if (value653 - value15.current <= 5e3) return;
          let value654: Dynamic = options ? "Video" : "Image";
          value15.current = value653;
          let flag2: Dynamic = false,
            value655: Dynamic = input === value271.current,
            value656: Dynamic = showToast(
              <span data-testid={"dc-preview-drop-toast"}>
                {flag2
                  ? value654 +
                    " dropped \u2014 open the Properties panel to place it."
                  : value655
                    ? value654 +
                      " dropped. Press Edit on that artboard to place it."
                    : value654 + " dropped \u2014 switch to Edit to place it."}
              </span>,
              "info",
              {
                pinned: true,
                action: (
                  <runtime.Button
                    size={"sm"}
                    data-testid={"dc-preview-drop-edit"}
                    onClick={(): Dynamic => {
                      hideToast(value656);
                      value273(flag2 ? (value346.current ?? input) : input);
                      setMode("edit");
                      flag2 && value96(true);
                    }}
                  >
                    {flag2 ? "Open Properties" : "Edit"}
                  </runtime.Button>
                ),
              },
            );
          (window as Dynamic).setTimeout(
            (): Dynamic => hideToast(value656),
            previewDropNoticeDurationMs,
          );
        },
        [value273, hideToast, showToast, value96],
      ),
      [value610, value611]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        null,
      );
    value431.current = {
      focusedFile: value121,
      panelUndo: value610,
    };
    let value612: Dynamic = (0, runtime.reactChromeTheme.useRef)(new Set()),
      value613: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => (
          value612.current.add(input),
          input(value105.get().scale),
          (): Dynamic => {
            value612.current.delete(input);
          }
        ),
        [value105],
      );
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic =>
        value105.subscribe((input?: Dynamic, options?: Dynamic): Dynamic => {
          if (input.scale !== options.scale)
            for (let value653 of value612.current as Dynamic)
              value653(input.scale);
        }),
      [value105],
    );
    let [value614, value615]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        null,
      ),
      value616: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => ({
          ...input,
          undo: (): Dynamic => {
            value614?.exitMode?.();
            input.undo();
          },
          redo: (): Dynamic => {
            value614?.exitMode?.();
            input.redo();
          },
        }),
        [value614],
      ),
      value617: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic => {
          value105.set((input2?: Dynamic): Dynamic => {
            let {
              w: value653,
              h: value654,
              top: value655,
            }: Dynamic = value120();
            return (0, runtime.zoomViewportAtPoint)(
              input2,
              value653 / 2,
              value655 + (value654 - value655) / 2,
              input / input2.scale,
              runtime.viewportScaleLimits,
            );
          }, true);
        },
        [value105, value120],
      ),
      value618: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {
        let value653: Dynamic =
            value89.boxesHere.length === 0
              ? value86.artboards
              : [...value86.artboards, ...value89.boxesHere],
          value654: Dynamic = value86.annotations ?? [];
        if (!value653.length && !value654.length) return;
        let value655: Dynamic = value654.map(
            (input?: Dynamic): Dynamic =>
              (0, runtime.rotatedAnnotationBounds)(
                input,
                (0, runtime.isShapeAnnotation)(input)
                  ? (0, runtime.annotationBounds)(input)
                  : {
                      x: input.x,
                      y: input.y,
                      w: (0, runtime.NotesLinkEditingKind)(input),
                      h: (0, runtime.NotesLinkEditingLh)(input),
                    },
              ),
          ),
          value656: Dynamic = Math.min(
            ...value653.map((input?: Dynamic): Dynamic => input.x),
            ...value655.map((input?: Dynamic): Dynamic => input.x),
          ),
          value657: Dynamic = Math.min(
            ...value653.map(
              (input?: Dynamic): Dynamic =>
                input.y - runtime.fitArtboardHeaderHeight,
            ),
            ...value655.map((input?: Dynamic): Dynamic => input.y),
          ),
          value658: Dynamic = Math.max(
            ...value653.map((input?: Dynamic): Dynamic => input.x + input.w),
            ...value655.map((input?: Dynamic): Dynamic => input.x + input.w),
          ),
          value659: Dynamic = Math.max(
            ...value653.map((input?: Dynamic): Dynamic => input.y + input.h),
            ...value655.map((input?: Dynamic): Dynamic => input.y + input.h),
          ),
          value660: Dynamic = value120();
        return (0, runtime.fitBoundsCamera)(
          {
            minX: value656,
            minY: value657,
            maxX: value658,
            maxY: value659,
          },
          {
            ...value660,
            top: Math.max(value660.top, value296.current),
          },
        );
      }, [value86, value89.boxesHere, value120]),
      value619: Dynamic = (0,
      runtime.reactChromeTheme.useCallback)((): Dynamic => {
        let value653: Dynamic = value618();
        value653 !== undefined && value105.set(value653, true);
        return value653 !== undefined;
      }, [value105, value618]);
    value292.current = value619;
    let value620: Dynamic =
        value89.boxesHere.length > 0 ||
        (value89.creating && value86.artboards.length > 0),
      value621: Dynamic = (0, runtime.reactChromeTheme.useRef)(false),
      [value622]: Dynamic = (0, runtime.reactChromeTheme.useState)(value620);
    (0, runtime.reactChromeTheme.useLayoutEffect)((): Dynamic => {
      if (
        value622 ||
        value310.current ||
        !value620 ||
        value345.current ||
        value102.current
      )
        return;
      value310.current = true;
      let value653: Dynamic = value618(),
        value654: Dynamic =
          value621.current &&
          value653 !== undefined &&
          (document as Dynamic).visibilityState === "visible"
            ? (0, runtime.creationFocusedCamera)(
                [...value86.artboards, ...value89.boxesHere],
                value653,
                value120(),
              )
            : undefined;
      value653 !== undefined && value654 !== undefined
        ? (value105.set(value654), value105.glide(value653))
        : value292.current();
      callback8();
    }, [value620]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value310.current && callback8();
      if (
        value310.current ||
        (value86.artboards.length === 0 && value89.boxesHere.length === 0)
      )
        return;
      if (value345.current || value102.current) {
        value310.current = true;
        callback8();
        return;
      }
      let value653: Dynamic = (window as Dynamic).setTimeout((): Dynamic => {
        value310.current ||
          ((value310.current = true), value345.current || value619());
        callback8();
      }, 50);
      return (): Dynamic => (window as Dynamic).clearTimeout(value653);
    }, [value67, value619]);
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      let callback15: Dynamic = (input?: Dynamic): Dynamic => {
          value345.current ||
            (input === "0"
              ? value619()
              : value617(value105.get().scale * (input === "-" ? 0.8 : 1.25)),
            (0, runtime.announce)(
              (): Dynamic =>
                (0, runtime.zoomAnnouncement)(value105.get().scale),
            ));
        },
        callback16: Dynamic = (event?: Dynamic): Dynamic => {
          if (
            event.defaultPrevented ||
            value285.current ||
            !(event.metaKey || event.ctrlKey) ||
            event.altKey ||
            (event.key !== "0" &&
              event.key !== "=" &&
              event.key !== "+" &&
              event.key !== "-")
          )
            return;
          let target: Dynamic = event.target;
          target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable ||
            (event.preventDefault(),
            callback15(
              event.key === "0" ? "0" : event.key === "-" ? "-" : "+",
            ));
        },
        callback17: Dynamic = (input?: Dynamic): Dynamic =>
          callback15(input.detail.key),
        callback18: Dynamic = (): Dynamic => {
          value345.current || value13((input?: Dynamic): Dynamic => !input);
        },
        callback19: Dynamic = (event?: Dynamic): Dynamic => {
          event.key.toLowerCase() !== "g" ||
            !event.shiftKey ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.defaultPrevented ||
            event.repeat ||
            (0, runtime.isEditingInputTarget)(event.target) ||
            (0, runtime.hasBlockingEditorOverlay)() ||
            (event.preventDefault(), callback18());
        };
      (window as Dynamic).addEventListener("keydown", callback16);
      (window as Dynamic).addEventListener("keydown", callback19);
      (window as Dynamic).addEventListener("canvas-zoom-chord", callback17);
      (window as Dynamic).addEventListener("canvas-guides-toggle", callback18);
      return (): Dynamic => {
        (window as Dynamic).removeEventListener("keydown", callback16);
        (window as Dynamic).removeEventListener("keydown", callback19);
        (window as Dynamic).removeEventListener(
          "canvas-zoom-chord",
          callback17,
        );
        (window as Dynamic).removeEventListener(
          "canvas-guides-toggle",
          callback18,
        );
      };
    }, [value619, value617, value13, value105]);
    let value623: Dynamic =
        value83.length > 1 && !value283 ? value83.length : 0,
      value624: Dynamic = editing
        ? "Pages: switch, add, rename or delete a page"
        : "Pages: switch pages",
      value625: Dynamic = (0, runtime.useToolbarItemAccessibility)({
        disabled: false,
        name: value283 ? "All files" : value81,
        tip: value624,
      }),
      value626: Dynamic = (
        <span className={"relative"}>
          <runtime.EditorPopover
            open={value280}
            onOpen={(): Dynamic => value281(true)}
            onClose={(): Dynamic => value281(false)}
            trigger={(input?: Dynamic): Dynamic => (
              (value287.current = input.ref),
              (
                <runtime.Tooltip
                  content={value624}
                  side={"bottom"}
                  hoverable={false}
                  open={value280 ? false : undefined}
                >
                  <runtime.Button
                    {...input}
                    ref={value288}
                    variant={"ghost"}
                    icon={value85 ? "Files" : undefined}
                    data-testid={"dc-pages"}
                    aria-label={
                      value283
                        ? "All files, pages"
                        : value81 +
                          ", " +
                          (value623 > 0 ? String(value623) + " pages" : "pages")
                    }
                    className={"shrink-0"}
                    onClick={(input2?: Dynamic): Dynamic => {
                      value280 || value290(input2.detail === 0);
                      input.onClick?.(input2);
                    }}
                    aria-describedby={value625.describedBy}
                  >
                    <runtime.Counter
                      value={value623}
                      variant={"neutral"}
                      size={"xs"}
                      data-testid={"dc-pages-count"}
                    />
                    {value85 ? null : (
                      <span className={"max-w-[10rem] truncate"}>
                        {value283 ? "All files" : value81}
                      </span>
                    )}
                    <runtime.ToolbarCaret />
                  </runtime.Button>
                </runtime.Tooltip>
              )
            )}
            align={"left"}
            className={"w-60 p-1"}
            aria-label={"Pages"}
            focusOnOpen={value289}
            initialFocus={(): Dynamic => {
              let value653: Dynamic = Array.from(
                (document as Dynamic).querySelectorAll(
                  "[data-dc-pages-list] button",
                ),
              );
              return (
                value653.find(
                  (element?: Dynamic): Dynamic =>
                    element.getAttribute("aria-pressed") === "true",
                ) ??
                value653.find((input?: Dynamic): Dynamic => !input.disabled) ??
                null
              );
            }}
            popupAttrs={{
              "data-dc-pages-list": "",
            }}
          >
            {null}
            {(value77.length > 0
              ? value83
              : [
                  {
                    id: "",
                    name: "Page 1",
                  },
                ]
            ).map((input?: Dynamic): Dynamic => {
              let value653: Dynamic = input.id === value79 && !value283,
                length: Dynamic = value67.artboards.filter(
                  (input2?: Dynamic): Dynamic =>
                    (0, runtime.designPageId)(input2, value67.pages) ===
                    input.id,
                ).length;
              return (() => {
                const _Component = "div";
                const _props = {
                  className: "flex items-center gap-0.5",
                  children: [
                    <div className={"min-w-0 flex-1"}>
                      <runtime.EditorMenuItem
                        icon={null}
                        checked={value653}
                        onClick={(): Dynamic => {
                          value281(false);
                          value283 && value301();
                          input.id === value79
                            ? value299()
                            : input.id !== "" &&
                              value275((): Dynamic => value298(input.id));
                        }}
                      >
                        <span className={"relative min-w-0 flex-1 truncate"}>
                          {input.name}
                          <span className={"sr-only"}>
                            {", artboards: "}
                            {length}
                          </span>
                        </span>
                      </runtime.EditorMenuItem>
                    </div>,
                    editing ? (
                      <runtime.MenuMenuAssignValue
                        iconOnly={true}
                        icon={"DotsHorizontal"}
                        variant={"ghost"}
                        align={"end"}
                        disabled={false}
                        disabledReason={undefined}
                        aria-label={
                          "Page \u201C" + input.name + "\u201D actions"
                        }
                        className={"shrink-0"}
                        items={[
                          {
                            label: "Rename",
                            onSelect: (): Dynamic => {
                              value281(false);
                              value306(input.id);
                            },
                          },
                          {
                            label: "Delete",
                            variant: "danger",
                            disabled: value77.length < 2,
                            disabledReason: canvasNeedsPageMessage,
                            onSelect: (): Dynamic => {
                              value281(false);
                              value275((): Dynamic => {
                                value455(input.id);
                              });
                            },
                          },
                        ]}
                      />
                    ) : null,
                  ],
                } as const;
                const _key = input.id || "implicit";
                return <_Component key={_key} {..._props} />;
              })();
            })}
            {null}
            {editing && (
              <runtime.jsx_Gn.Fragment>
                <div
                  aria-hidden={"true"}
                  className={"mx-2 my-1 h-px bg-border-line"}
                />
                <runtime.EditorMenuItem
                  icon={"Add"}
                  disabled={false}
                  title={undefined}
                  onClick={(): Dynamic => {
                    value281(false);
                    value275(value305);
                  }}
                >
                  {"New page"}
                </runtime.EditorMenuItem>
              </runtime.jsx_Gn.Fragment>
            )}
          </runtime.EditorPopover>
          {value625.mirror}
        </span>
      ),
      value627: Dynamic = value347
        ? value86.artboards.find(
            (input?: Dynamic): Dynamic => input.file === value347.file,
          )
        : undefined,
      value628: Dynamic = (0, runtime.useDesignSource)(),
      value629: Dynamic = null,
      value630: Dynamic =
        value266.length > 0 ? (
          <runtime.ArtboardErrorsPopover
            problems={value266}
            canvasTitle={(document as Dynamic).title}
            canEdit={editable}
            hosted={(0, runtime.embedMemoryPrefix)() !== ""}
            open={value263}
            onOpenChange={value264}
          />
        ) : null,
      value631: Dynamic =
        value67.artboards.length === 0 &&
        (value67.annotations ?? []).length === 0,
      value632: Dynamic = (value86.annotations ?? []).length === 0,
      value633: Dynamic = (value631 && value327.length === 0) || value349,
      value634: Dynamic = (0, runtime.reactChromeTheme.useSyncExternalStore)(
        value573,
        (): Dynamic => value349 && value632 && doc.indexSaved?.() === false,
      ),
      value635: Dynamic = value634
        // BaoCut: user-facing copy calls the agent "the agent", not Claude.
        ? "Let the agent add artboards, or use the Artboard tool."
        : (value67.artboards.length === 0 ? "This canvas" : "This page") +
          " has no artboards yet. Add one, or let the agent add some.",
      value636: Dynamic =
        value633 &&
        !value349 &&
        value337 === "select" &&
        value89.cursor.at === "tips";
    (0, runtime.reactChromeTheme.useEffect)((): Dynamic => {
      value621.current = value636;
    });
    let [value637, value638]: Dynamic = (0, runtime.reactChromeTheme.useState)(
        false,
      ),
      value639: Dynamic =
        editing || (readOnly && !value349) ? (
          <runtime.ToolbarPrimitivesComponent
            glyph={
              <runtime.Icon
                name={"SidebarRight"}
                size={"auto"}
                className={"max-[599px]:rotate-90"}
              />
            }
            label={"Properties"}
            iconOnly={true}
            data-testid={"dc-props-toggle"}
            tip={
              value95
                ? "Hide the properties panel"
                : "Show the properties panel"
            }
            shortcut={"cmd+\\"}
            pressed={value95}
            id={runtime.inspectorToggleId}
            onClick={(input?: Dynamic): Dynamic => {
              value14.current = input.detail === 0;
              value96((input2?: Dynamic): Dynamic => !input2);
            }}
          />
        ) : null,
      value640: Dynamic = value347 ? (
        <runtime.jsx_Gn.Fragment>
          {flag ? null : (
            <runtime.ToolbarPrimitivesComponent
              icon={"CaretLeft"}
              label={"Back to canvas"}
              shortcut={value220 ? undefined : "esc"}
              iconOnly={true}
              data-testid={"mega-collapse"}
              data-view-control={""}
              onClick={value389}
            />
          )}
          {flag ? value626 : null}
          {value283 ||
          (flag &&
            (value627?.title ?? value347.file.replace(/\.dc\.html$/, "")) ===
              value81) ? null : (
            <span
              data-testid={"mega-expanded-name"}
              className={
                "tb-yields min-w-0 max-w-[40vw] truncate px-1 text-sm text-fg"
              }
            >
              {value627?.title ?? value347.file.replace(/\.dc\.html$/, "")}
            </span>
          )}
        </runtime.jsx_Gn.Fragment>
      ) : null,
      value641: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic => (0, runtime.groupNavigableArtboards)(value86.artboards),
        [value86.artboards],
      ),
      callback14: Dynamic = (input?: Dynamic): Dynamic =>
        input.map(
          (input2?: Dynamic): Dynamic =>
            (() => {
              const _Component2 = runtime.MenuMenuAssignValue.Item;
              const _props2 = {
                onClick: (): Dynamic => value381(input2.file),
                children: callback2(input2.file),
              } as const;
              const _key2 = input2.file;
              return <_Component2 key={_key2} {..._props2} />;
            })(),
        ),
      value642: Dynamic =
        value347 || flag ? null : (
          <span data-view-control={""} className={"contents"}>
            <runtime.SessionStripPopover
              icon={"Play"}
              label={"Play"}
              iconOnly={true}
              tip={"Play an artboard"}
              disabled={
                value641.prototypes.length + value641.others.length === 0
              }
              disabledTip={pageHasNoArtboardsMessage}
              align={"end"}
              data-testid={"dc-play"}
            >
              {value641.prototypes.length > 0 ? (
                <runtime.MenuMenuAssignValue.Group>
                  <runtime.MenuMenuAssignValue.GroupLabel>
                    {runtime.artboardNavigationGroupLabels.prototypes}
                  </runtime.MenuMenuAssignValue.GroupLabel>
                  {callback14(value641.prototypes)}
                </runtime.MenuMenuAssignValue.Group>
              ) : null}
              {value641.prototypes.length > 0 && value641.others.length > 0 ? (
                <runtime.MenuMenuAssignValue.Separator />
              ) : null}
              {value641.others.length > 0 ? (
                <runtime.MenuMenuAssignValue.Group>
                  <runtime.MenuMenuAssignValue.GroupLabel>
                    {runtime.artboardNavigationGroupLabels.others}
                  </runtime.MenuMenuAssignValue.GroupLabel>
                  {callback14(value641.others)}
                </runtime.MenuMenuAssignValue.Group>
              ) : null}
            </runtime.SessionStripPopover>
          </span>
        ),
      // BaoCut: the standalone page's Export button (see baocutStartToolbarExport). The items are the registered
      // formats; PDF and PNG first ask which artboards (the picker bar) when there is more than one.
      baocutExportButton: Dynamic =
        value347 || flag || !baocutStandalonePage ? null : (
          <span data-view-control={""} className={"contents"}>
            {baocutToolbarExports > 0 || value476 ? (
              <runtime.Button
                iconOnly={true}
                variant={"ghost"}
                icon={"Download"}
                busy={true}
                busyLabel={"Exporting"}
                aria-label={"Exporting"}
                data-testid={"dc-export"}
                className={"shrink-0"}
              />
            ) : (
              <runtime.SessionStripPopover
                icon={"Download"}
                label={"Export"}
                iconOnly={true}
                tip={"Export the design"}
                disabled={baocutExportFormats === null}
                disabledTip={runtime.DownloadsArenTAvailableToYouForMessage}
                align={"end"}
                data-testid={"dc-export"}
              >
                {(0, runtime.renderMenuItems)(
                  (baocutExportFormats ?? []).map(
                    (entry?: Dynamic): Dynamic => ({
                      label: entry.format.toUpperCase(),
                      description:
                        entry.format === "html"
                          ? "Standalone web page"
                          : entry.format === "pdf"
                            ? "Document for printing and sharing"
                            : "Image",
                      disabled: entry.disabled === true,
                      disabledReason:
                        entry.disabled === true
                          ? pageHasNoArtboardsMessage
                          : undefined,
                      onSelect: (): Dynamic => baocutStartToolbarExport(entry),
                    }),
                  ),
                )}
              </runtime.SessionStripPopover>
            )}
          </span>
        ),
      value643: Dynamic = value347 ? (
        <runtime.jsx_Gn.Fragment>
          {null}
          {value283 ? null : (
            <runtime.jsx_Gn.Fragment>
              <runtime.SessionStripPopover
                icon={"Download"}
                label={"Export"}
                iconOnly={true}
                tip={"Export this artboard"}
                disabled={value480}
                disabledTip={runtime.DownloadsArenTAvailableToYouForMessage}
                align={"end"}
                data-testid={"mega-export"}
              >
                {(0, runtime.renderMenuItems)(
                  (0, runtime.artboardExportMenuItems)(
                    value347.file,
                    value86.artboards,
                    {
                      onExportArtboard: (
                        input?: Dynamic,
                        options?: Dynamic,
                      ): Dynamic => {
                        value504(input, options);
                      },
                      onExportArtboardPdf: (input?: Dynamic): Dynamic => {
                        value513(input);
                      },
                      ...(flag
                        ? {}
                        : {
                            onExportArtboardHtmlZip: (
                              input?: Dynamic,
                            ): Dynamic => {
                              value507(input);
                            },
                          }),
                      onExportAllArtboardsPdf: (): Dynamic => {
                        value515();
                      },
                    },
                    undefined,
                    value93,
                  ),
                )}
              </runtime.SessionStripPopover>
              <span
                data-testid={"mega-fit"}
                data-view-control={""}
                className={"inline-flex shrink-0"}
              >
                <runtime.SegmentedControl
                  aria-label={"Artboard size"}
                  tooltipSide={"bottom"}
                  segments={[
                    {
                      value: "fill",
                      label: "Fill",
                      tooltip: "Fill the window",
                    },
                    {
                      value: "fit",
                      label: "Fit",
                      tooltip: "At its own size, scaled down to fit",
                    },
                  ]}
                  value={value347.fit ? "fit" : "fill"}
                  onChange={(input?: Dynamic): Dynamic =>
                    value348(
                      (input2?: Dynamic): Dynamic =>
                        input2 && {
                          ...input2,
                          fit: input === "fit",
                        },
                    )
                  }
                />
              </span>
            </runtime.jsx_Gn.Fragment>
          )}
        </runtime.jsx_Gn.Fragment>
      ) : null,
      value644: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (): Dynamic => value105.get().scale,
        [value105],
      ),
      value645: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (input?: Dynamic): Dynamic =>
          value617(value105.get().scale * (input === 1 ? 1.25 : 1 / 1.25)),
        [value105, value617],
      ),
      value646: Dynamic = (0, runtime.reactChromeTheme.useCallback)(
        (): Dynamic => runtime.viewportScaleLimits,
        [],
      ),
      current3: Dynamic = value447.current,
      [value647, value648]: Dynamic = (0, runtime.reactChromeTheme.useState)(0);
    (0, runtime.reactChromeTheme.useEffect)(
      (): Dynamic =>
        current3?.subscribe(
          (): Dynamic => value648((input?: Dynamic): Dynamic => input + 1),
        ),
      [current3],
    );
    let value649: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic => (editing && current3 ? value616(current3) : undefined),
        [editing, current3, value616, value647, value407, value232],
      ),
      value650: Dynamic = (0, runtime.reactChromeTheme.useMemo)(
        (): Dynamic => [
          {
            label: "Layout guides",
            checked: value12,
            shortcut: "shift+g",
            onToggle: (): Dynamic =>
              value13((input?: Dynamic): Dynamic => !input),
          },
        ],
        [value12, value13],
      ),
      value651: Dynamic = (0, runtime.useLatestCallback)((): Dynamic => {
        saveCanvas();
      }),
      value652: Dynamic = (
        <CanvasSaveStatus
          doc={doc}
          synced={supportsLoadState}
          localDirty={value65}
          onSave={value651}
        />
      );
    return (
      <runtime.ViewportContext.Provider value={value105}>
        <runtime.CanvasWorkingStateContext.Provider value={current}>
          <runtime.InspectorOpenContext.Provider value={value94}>
            <div
              ref={value107}
              className={
                "relative flex h-screen w-screen bg-page text-primary max-[599px]:flex-col"
              }
            >
              <CanvasSaveKeyboardShortcut
                doc={doc}
                synced={supportsLoadState}
                localDirty={value65}
                onSave={value651}
              />
              <div className={"relative flex min-h-0 min-w-0 flex-1 flex-col"}>
                <runtime.EditorToolbar
                  title={(document as Dynamic).title || filePath}
                  saveState={value66}
                  saveMode={doc.saveMode()}
                  syncDot={supportsLoadState}
                  onSave={(): Dynamic => {
                    saveCanvas();
                  }}
                  undo={value447.current ?? undefined}
                  publishControls={false}
                  undoButtons={false}
                  touchTargets={"square"}
                  variant={value390 ? "docked" : "floating"}
                  trailing={
                    value492 ? null : value347 ? (
                      flag ? (
                        <span
                          data-testid={"dc-save"}
                          className={"flex shrink-0 items-center gap-1"}
                        >
                          {null}
                          {value283 ? null : value639}
                          {value652}
                        </span>
                      ) : (
                        value652
                      )
                    ) : (
                      <span
                        data-testid={"dc-save"}
                        className={"flex shrink-0 items-center gap-1"}
                      >
                        {value639}
                        {value639 ? <runtime.ToolbarDivider /> : null}
                        <span data-view-control={""} className={"contents"}>
                          <MemoizedCanvasZoomControl
                            data-testid={"dc-zoom"}
                            readout={true}
                            subscribeScale={value613}
                            getScale={value644}
                            onPickScale={value617}
                            onFit={value619}
                            onStepZoom={value645}
                            getLimits={value646}
                            undo={value649}
                            viewToggles={value650}
                            fitLabel={fitArtboardsLabel}
                            tip={
                              (0, runtime.isApplePlatform)()
                                ? "Zoom: \u23180 fit, \u2318+ / \u2318\u2212 step"
                                : "Zoom: Ctrl+0 fit, Ctrl and + / \u2212 step"
                            }
                          />
                        </span>
                        {value652}
                      </span>
                    )
                  }
                  leading={value347 || value492 ? null : value626}
                  extrasEnd={
                    value492 ? null : (
                      <runtime.jsx_Gn.Fragment>
                        {value630}
                        {value347 ? value643 : value629}
                        {editing && (
                          <div
                            id={runtime.ChatColumnOverlayActionsSlotValue}
                            data-tb-seat={""}
                            className={
                              "flex shrink-0 items-center gap-2 empty:hidden"
                            }
                          />
                        )}
                        {value642}
                        {baocutExportButton}
                      </runtime.jsx_Gn.Fragment>
                    )
                  }
                >
                  {value347 ? (
                    value640
                  ) : (
                    <div
                      id={runtime.editorToolbarId}
                      hidden={value492}
                      data-tb-seat={""}
                      data-testid={"dc-tool-row"}
                      data-tb-cluster={""}
                      className={
                        "flex shrink-0 items-center gap-1 empty:hidden pointer-coarse:gap-1.5"
                      }
                    >
                      {value352 && (
                        <runtime.DesignToolToolbar
                          tool={value337}
                          onTool={value338}
                        />
                      )}
                    </div>
                  )}
                </runtime.EditorToolbar>
                <runtime.DocumentSaveStatus
                  doc={doc}
                  onSave={saveCanvas}
                  docked={value390}
                  belowPickerBar={value492}
                />
                <div className={"relative flex min-h-0 flex-1"}>
                  {null}
                  <runtime.FindBar {...value574.find.bar} />
                  {null}
                  <main
                    aria-label={"Canvas"}
                    inert={value283}
                    className={
                      "relative min-h-0 min-w-0 flex-1 bg-om-bg-canvas"
                    }
                    ref={value119}
                  >
                    {value454 !== null && (
                      <runtime.HostedEditor
                        host={(): Dynamic => ({
                          selected:
                            value169.size === 0
                              ? value86.artboards
                                  .map((input?: Dynamic): Dynamic => input.file)
                                  .filter(
                                    (input?: Dynamic): Dynamic =>
                                      value168.has(input),
                                  )
                              : [],
                          selectedElements:
                            value169.size === 0
                              ? (0, runtime.selectedElementLocations)(
                                  value86.artboards.map(
                                    (input?: Dynamic): Dynamic => input.file,
                                  ),
                                  selection.elements,
                                  value19,
                                )
                              : [],
                          handlesRef: value177,
                          canvasTitle:
                            typeof document === "undefined"
                              ? ""
                              : (document as Dynamic).title,
                          fileText: (input?: Dynamic): Dynamic =>
                            doc.content().files[input],
                          readOnly: !editable,
                          hidden:
                            value283 ||
                            value373 !== null ||
                            value492 ||
                            value269 != null ||
                            value349,
                          tell: value188,
                          say: (input?: Dynamic, options?: Dynamic): Dynamic =>
                            (0, runtime.announce)(input, options),
                          focusCanvas: (): Dynamic => value394.goHome(),
                          saveNow: (): Dynamic => doc.flushNow?.(),
                          canvas: value454,
                        })}
                      />
                    )}
                    <runtime.CanvasInteractionLayer
                      manifest={value86}
                      viewSettled={value99 && !flag ? value311 : undefined}
                      phoneCanvasRunsNothing={value100}
                      guidesVisible={value12}
                      turnBusy={value637}
                      onWorldPointer={callback10}
                      onPagePointer={value372}
                      onPageScroll={value180.set}
                      artboardPicking={value492}
                      artboardOverlay={(
                        input?: Dynamic,
                        options?: Dynamic,
                      ): Dynamic =>
                        options ? (
                          <runtime.jsx_Gn.Fragment>
                            <runtime.ArtboardPeerSelectionRings
                              store={value179}
                              file={input}
                              box={options}
                              scroll={value180}
                            />
                            <runtime.PageCommentSurface
                              file={input}
                              box={options}
                              store={value180}
                            />
                          </runtime.jsx_Gn.Fragment>
                        ) : (
                          <runtime.jsx_Gn.Fragment>
                            <runtime.CanvasPeerSelectionRings
                              store={value179}
                              file={input}
                            />
                            {value492 && callback13(input)}
                          </runtime.jsx_Gn.Fragment>
                        )
                      }
                      worldOverlay={
                        value349 ? null : (
                          <runtime.jsx_Gn.Fragment>
                            <runtime.useCanvasPeerSelections
                              pageId={value79}
                              artboards={value86.artboards}
                              handlesRef={value177}
                              store={value179}
                              fullFile={value373}
                            />
                            {!value347 && (
                              <runtime.ViewportScale>
                                {(input?: Dynamic): Dynamic => (
                                  <runtime.jsx_Gn.Fragment>
                                    <runtime.PeerCursors
                                      surface={value370}
                                      toLocal={(
                                        input2?: Dynamic,
                                        options?: Dynamic,
                                      ): Dynamic => ({
                                        left: input2,
                                        top: options,
                                      })}
                                      glyphScale={1 / input}
                                    />
                                    <runtime.DesignCreationCursor
                                      cursor={value89.cursor}
                                      boards={value89.boxesHere}
                                      artboards={value86.artboards}
                                      scale={input}
                                    />
                                  </runtime.jsx_Gn.Fragment>
                                )}
                              </runtime.ViewportScale>
                            )}
                          </runtime.jsx_Gn.Fragment>
                        )
                      }
                      canvasScaleRef={value181}
                      pastePointRef={value108}
                      artboardLandingRef={value110}
                      pendingBoards={value89.pendingBoards}
                      coverFiles={value89.coverFiles}
                      onManifestChange={(
                        input?: Dynamic,
                        options?: Dynamic,
                        context?: Dynamic,
                      ): Dynamic => {
                        let value653: Dynamic = (0,
                          runtime.replaceDesignPageContents)(
                            value73.current,
                            value80.current,
                            input,
                          ),
                          value654: Dynamic = options
                            ? value72(value653)
                            : value653;
                        if (!options) {
                          value73.current = value654;
                          value68(value654);
                          return;
                        }
                        let {
                            moved: value655,
                            resizedFrom: value656,
                            movedNotes: value657,
                            transformed: value658,
                          }: Dynamic = context ?? {},
                          callback15: Dynamic = (
                            input2?: Dynamic,
                            options2?: Dynamic,
                          ): Dynamic =>
                            Math.round(input2.x) !== Math.round(options2.x) ||
                            Math.round(input2.y) !== Math.round(options2.y),
                          value659: Dynamic = value654.artboards.flatMap(
                            (input2?: Dynamic): Dynamic => {
                              let value679: Dynamic = value655?.get(
                                input2.file,
                              );
                              return value679 && callback15(value679, input2)
                                ? [
                                    {
                                      file: input2.file,
                                      from: {
                                        x: value679.x,
                                        y: value679.y,
                                      },
                                      to: {
                                        x: input2.x,
                                        y: input2.y,
                                      },
                                    },
                                  ]
                                : [];
                            },
                          ),
                          value660: Dynamic = (
                            value654.annotations ?? []
                          ).flatMap((input2?: Dynamic): Dynamic => {
                            let value679: Dynamic = value657?.get(input2.id);
                            return value679 && callback15(value679, input2)
                              ? [
                                  {
                                    id: input2.id,
                                    from: {
                                      x: value679.x,
                                      y: value679.y,
                                    },
                                    to: {
                                      x: input2.x,
                                      y: input2.y,
                                    },
                                  },
                                ]
                              : [];
                          }),
                          value661: Dynamic =
                            value660.length > 1 ||
                            (value660.length > 0 && value659.length > 0) ||
                            (value660.length > 0 &&
                              context?.bound !== undefined)
                              ? value660
                              : [],
                          value662: Dynamic =
                            context?.bound !== undefined
                              ? value143.current.get(context.bound)
                              : undefined;
                        value662
                          ? value662({
                              moves: value659,
                              annMoves: value661,
                            })
                          : (value659.length > 0 || value661.length > 0) &&
                            value413(
                              {
                                kind: "move",
                                moves: value659,
                                ...(value661.length > 0
                                  ? {
                                      anns: value661,
                                    }
                                  : {}),
                              },
                              new Set(),
                              undefined,
                              context?.bound,
                            );
                        let values: Dynamic = new Set(
                          value661.map(
                            (input2?: Dynamic): Dynamic => input2.id,
                          ),
                        );
                        if (value658) {
                          let callback21: Dynamic = (
                              input2?: Dynamic,
                              options2?: Dynamic,
                            ): Dynamic => {
                              let value681: Dynamic = Object.keys(
                                input2,
                              ).filter(
                                (input3?: Dynamic): Dynamic =>
                                  value658.keys.has(input3) &&
                                  input2[input3] !== options2[input3],
                              );
                              return value681.length === 0
                                ? null
                                : {
                                    from: Object.fromEntries(
                                      value681.map(
                                        (input3?: Dynamic): Dynamic => [
                                          input3,
                                          input2[input3],
                                        ],
                                      ),
                                    ),
                                    to: Object.fromEntries(
                                      value681.map(
                                        (input3?: Dynamic): Dynamic => [
                                          input3,
                                          options2[input3],
                                        ],
                                      ),
                                    ),
                                  };
                            },
                            value679: Dynamic = value654.artboards.flatMap(
                              (input2?: Dynamic): Dynamic => {
                                let entry: Dynamic = value658.boards.get(
                                    input2.file,
                                  ),
                                  value681: Dynamic =
                                    entry &&
                                    callback21(
                                      (0, runtime.artboardTransformSnapshot)(
                                        entry,
                                      ),
                                      (0, runtime.artboardTransformSnapshot)(
                                        input2,
                                      ),
                                    );
                                return value681
                                  ? [
                                      {
                                        file: input2.file,
                                        ...value681,
                                      },
                                    ]
                                  : [];
                              },
                            ),
                            value680: Dynamic = (
                              value654.annotations ?? []
                            ).flatMap((input2?: Dynamic): Dynamic => {
                              let entry: Dynamic = value658.notes.get(
                                  input2.id,
                                ),
                                value681: Dynamic =
                                  entry &&
                                  callback21(
                                    (0, runtime.annotationTransformSnapshot)(
                                      entry,
                                    ),
                                    (0, runtime.annotationTransformSnapshot)(
                                      input2,
                                    ),
                                  );
                              return value681
                                ? [
                                    {
                                      id: input2.id,
                                      ...value681,
                                    },
                                  ]
                                : [];
                            });
                          if (value679.length === 0 && value680.length === 0) {
                            value68(value654);
                            return;
                          }
                          value413(
                            {
                              kind: "transform",
                              label: value658.label,
                              boards: value679,
                              anns: value680,
                            },
                            new Set(),
                          );
                          for (let value681 of value658.notes.keys() as Dynamic)
                            values.add(value681);
                        }
                        let value663: Dynamic = value656,
                          value664: Dynamic = value663
                            ? value654.artboards.find(
                                (input2?: Dynamic): Dynamic =>
                                  input2.file === value663.file &&
                                  (Math.round(value663.w) !==
                                    Math.round(input2.w) ||
                                    Math.round(value663.h) !==
                                      Math.round(input2.h)),
                              )
                            : undefined;
                        value663 &&
                          value664 &&
                          value413(
                            {
                              kind: "resize",
                              file: value664.file,
                              from: {
                                x: value663.x,
                                y: value663.y,
                                w: value663.w,
                                h: value663.h,
                              },
                              to: {
                                x: value664.x,
                                y: value664.y,
                                w: value664.w,
                                h: value664.h,
                              },
                            },
                            new Set(),
                          );
                        let value665: Dynamic =
                            (value70.current ?? value67).annotations ?? [],
                          value666: Dynamic = value654.annotations ?? [],
                          callback16: Dynamic = (input2?: Dynamic): Dynamic => {
                            for (let value679 of value666 as Dynamic) {
                              let value680: Dynamic = values.has(value679.id)
                                ? undefined
                                : value665.find(
                                    (input3?: Dynamic): Dynamic =>
                                      input3.id === value679.id,
                                  );
                              if (
                                value680 &&
                                !(0, runtime.isShapeAnnotation)(value680) &&
                                !(0, runtime.isShapeAnnotation)(value679) &&
                                input2(value680, value679)
                              )
                                return [value680, value679];
                            }
                            return null;
                          },
                          callback17: Dynamic = (input2?: Dynamic): Dynamic => {
                            for (let value679 of value666 as Dynamic) {
                              let value680: Dynamic = values.has(value679.id)
                                ? undefined
                                : value665.find(
                                    (input3?: Dynamic): Dynamic =>
                                      input3.id === value679.id,
                                  );
                              if (
                                value680 &&
                                (0, runtime.isShapeAnnotation)(value680) &&
                                (0, runtime.isShapeAnnotation)(value679) &&
                                input2(value680, value679)
                              )
                                return [value680, value679];
                            }
                            return null;
                          },
                          callback18: Dynamic = (
                            input2?: Dynamic,
                          ): Dynamic => ({
                            x: input2.x,
                            y: input2.y,
                            w: input2.w,
                            h: input2.h,
                            d: input2.d,
                          }),
                          value667: Dynamic = callback17(
                            (source?: Dynamic, source2?: Dynamic): Dynamic =>
                              source.kind === "pen" &&
                              source2.kind === "pen" &&
                              source.d !== source2.d,
                          );
                        value667 &&
                          value667[0].kind === "pen" &&
                          value667[1].kind === "pen" &&
                          value413(
                            {
                              kind: "ann-path",
                              id: value667[1].id,
                              from: callback18(value667[0]),
                              to: callback18(value667[1]),
                            },
                            new Set(),
                          );
                        let callback19: Dynamic = (input2?: Dynamic): Dynamic =>
                            JSON.stringify(
                              Object.values(
                                (0, runtime.annotationGeometry)(input2),
                              ).map(Math.round as Dynamic),
                            ),
                          value668: Dynamic = callback17(
                            (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                              callback19(input2) !== callback19(options2) &&
                              options2.id !== value667?.[1].id,
                          ),
                          value669: Dynamic = callback17(
                            (source?: Dynamic, source2?: Dynamic): Dynamic =>
                              source.kind === "image" &&
                              source2.kind === "image" &&
                              JSON.stringify(source.crop ?? null) !==
                                JSON.stringify(source2.crop ?? null),
                          ),
                          value670: Dynamic =
                            value669 !== null &&
                            value668 !== null &&
                            value668[1].id === value669[1].id;
                        value668 &&
                          !value670 &&
                          value413(
                            {
                              kind: "ann-box",
                              id: value668[1].id,
                              from: (0, runtime.annotationGeometry)(
                                value668[0],
                              ),
                              to: (0, runtime.annotationGeometry)(value668[1]),
                            },
                            new Set(),
                          );
                        let callback20: Dynamic = (input2?: Dynamic): Dynamic =>
                            JSON.stringify(input2.css ?? null),
                          value671: Dynamic = callback17(
                            (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                              (input2.color ?? "default") !==
                              (options2.color ?? "default"),
                          ),
                          value672: Dynamic = callback17(
                            (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                              callback20(input2) !== callback20(options2),
                          );
                        if (value669) {
                          let [value679, value680]: Dynamic = value669;
                          value413(
                            {
                              kind: "ann-crop",
                              id: value680.id,
                              from: value679.crop,
                              to: value680.crop,
                              ...(callback20(value679) !== callback20(value680)
                                ? {
                                    cssFrom: value679.css,
                                    cssTo: value680.css,
                                  }
                                : {}),
                              ...(value670
                                ? {
                                    geomFrom: (0, runtime.annotationGeometry)(
                                      value679,
                                    ),
                                    geomTo: (0, runtime.annotationGeometry)(
                                      value680,
                                    ),
                                  }
                                : {}),
                            },
                            new Set(),
                          );
                        } else
                          value671
                            ? value413(
                                {
                                  kind: "ann-color",
                                  id: value671[1].id,
                                  from: value671[0].color ?? "default",
                                  to: value671[1].color ?? "default",
                                  ...(value672
                                    ? {
                                        cssFrom: value671[0].css,
                                        cssTo: value671[1].css,
                                      }
                                    : {}),
                                },
                                new Set(),
                              )
                            : value672 &&
                              value413(
                                {
                                  kind: "ann-css",
                                  id: value672[1].id,
                                  from: value672[0].css,
                                  to: value672[1].css,
                                },
                                new Set(),
                              );
                        let value673: Dynamic = callback16(
                            (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                              Math.round(input2.x) !== Math.round(options2.x) ||
                              Math.round(input2.y) !== Math.round(options2.y),
                          ),
                          value674: Dynamic =
                            (0, runtime.PlatformFileContentHas)(
                              value665,
                              value666,
                              new Set(
                                [...value169].filter(
                                  (input2?: Dynamic): Dynamic =>
                                    !values.has(input2),
                                ),
                              ),
                            ) ??
                            (value673 &&
                            Math.round(value673[0].w) !==
                              Math.round(value673[1].w)
                              ? value673
                              : null);
                        if (value674) {
                          let [value679, value680]: Dynamic = value674,
                            callback21: Dynamic = (input2?: Dynamic): Dynamic =>
                              Object.fromEntries(
                                ["x", "y", "w", "maxW", "maxH"]
                                  .filter(
                                    (input3?: Dynamic): Dynamic =>
                                      value679[input3] !== value680[input3],
                                  )
                                  .map(
                                    (input3?: Dynamic): Dynamic => [
                                      input3,
                                      input2[input3],
                                    ],
                                  ),
                              );
                          value413(
                            {
                              kind: "transform",
                              label: "Resize",
                              boards: [],
                              anns: [
                                {
                                  id: value680.id,
                                  from: callback21(value679),
                                  to: callback21(value680),
                                },
                              ],
                            },
                            new Set(),
                          );
                        } else
                          value673 &&
                            value413(
                              {
                                kind: "ann-move",
                                id: value673[1].id,
                                from: {
                                  x: value673[0].x,
                                  y: value673[0].y,
                                },
                                to: {
                                  x: value673[1].x,
                                  y: value673[1].y,
                                },
                              },
                              new Set(),
                            );
                        let value675: Dynamic = callback16(
                          (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                            Math.round(input2.w) !== Math.round(options2.w),
                        );
                        value675 &&
                          !value674 &&
                          value413(
                            {
                              kind: "ann-resize",
                              id: value675[1].id,
                              from: value675[0].w,
                              to: value675[1].w,
                            },
                            new Set(),
                          );
                        let value676: Dynamic = callback16(
                          (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                            input2.text !== options2.text,
                        );
                        value676 &&
                          value413(
                            {
                              kind: "ann-text",
                              id: value676[1].id,
                              from: value676[0].text,
                              to: value676[1].text,
                            },
                            new Set(),
                          );
                        let value677: Dynamic = callback16(
                          (input2?: Dynamic, options2?: Dynamic): Dynamic => {
                            let [items, items2]: Dynamic = [
                              (0, runtime.annotationTextStyle)(input2),
                              (0, runtime.annotationTextStyle)(options2),
                            ];
                            return Object.keys(items).some(
                              (input3?: Dynamic): Dynamic =>
                                items[input3] !== items2[input3],
                            );
                          },
                        );
                        value677 &&
                          value413(
                            {
                              kind: "ann-style",
                              id: value677[1].id,
                              from: (0, runtime.annotationTextStyle)(
                                value677[0],
                              ),
                              to: (0, runtime.annotationTextStyle)(value677[1]),
                              ...(value677[0].kind !== value677[1].kind &&
                              (value677[0].maxW !== value677[1].maxW ||
                                value677[0].maxH !== value677[1].maxH)
                                ? {
                                    caps: {
                                      from: {
                                        maxW: value677[0].maxW,
                                        maxH: value677[0].maxH,
                                      },
                                      to: {
                                        maxW: value677[1].maxW,
                                        maxH: value677[1].maxH,
                                      },
                                    },
                                  }
                                : {}),
                            },
                            new Set(),
                          );
                        let value678: Dynamic = callback16(
                          (input2?: Dynamic, options2?: Dynamic): Dynamic =>
                            (input2.rotate ?? 0) !== (options2.rotate ?? 0),
                        );
                        value678 &&
                          value413(
                            {
                              kind: "transform",
                              label: "Rotate",
                              boards: [],
                              anns: [
                                {
                                  id: value678[1].id,
                                  from: {
                                    rotate: value678[0].rotate ?? 0,
                                  },
                                  to: {
                                    rotate: value678[1].rotate ?? 0,
                                  },
                                },
                              ],
                            },
                            new Set(),
                          );
                        value98(value654);
                      }}
                      camera={value105}
                      assets={assets}
                      doc={doc}
                      editing={value356}
                      inspect={value358}
                      editable={editable}
                      frameArmed={value607}
                      focusedFile={value351}
                      onFocus={value273}
                      enteredFile={value123}
                      emptyPieces={value128}
                      onEnterPiece={value582}
                      onFaceDoubleClick={value43}
                      onContentHull={value586}
                      onOpenFile={value577}
                      onAddAnnotation={value317}
                      onDeleteAnnotation={value321}
                      onAnnotationCss={value421}
                      onReplaceAnnotationMedia={value426}
                      onOpenPropsPanel={(): Dynamic => value96(true)}
                      selectedArtboards={value168}
                      selectedNotes={value169}
                      onSelectObjects={value492 ? value496 : value314}
                      onClearSelection={value278}
                      routeForwardedKey={value164}
                      onDragEvent={value222}
                      onBoxEvent={value59}
                      dragGhost={value194}
                      onHostDrag={value223}
                      onDropObjectInto={value214}
                      onObjectHover={value212}
                      setMovePieces={true}
                      onHostGesturing={value219}
                      onCommenting={value221}
                      quickProps={
                        value244
                          ? {
                              text: value244.text,
                              shape: value244.shape,
                              box: value244.box,
                              image: value244.image,
                              other: value244.other,
                              line: value244.line,
                              primaryTag: value244.primaryTag,
                              seed: {
                                ...value244.seed,
                                fontSize:
                                  value244.seed.fontSize ??
                                  value255?.fontSize ??
                                  null,
                                faces:
                                  value251 !== null &&
                                  value251.key ===
                                    value244.probeEl?.file +
                                      ":" +
                                      String(value244.probeEl?.tid)
                                    ? value251.faces
                                    : undefined,
                                definedVars: value244.probeEl
                                  ? value257.get(value244.probeEl.file)
                                  : undefined,
                                onFacesOpen: (): Dynamic =>
                                  value254(
                                    (input?: Dynamic): Dynamic => input + 1,
                                  ),
                                rendered: value255
                                  ? {
                                      color: value255.color,
                                      background: value255.background,
                                      stroke: value255.stroke,
                                      fontWeight: value255.fontWeight ?? null,
                                      fontFamily: value255.fontFamily ?? null,
                                      fontStyle: value255.fontStyle ?? null,
                                      textAlign: value255.textAlign ?? null,
                                      textDecoration:
                                        value255.textDecoration ?? null,
                                      fontSizePx: value255.fontSize ?? null,
                                      lineHeight: value255.lineHeight ?? null,
                                      letterSpacing:
                                        value255.letterSpacing ?? null,
                                      box: value255.box,
                                      ground: value255.ground ?? null,
                                    }
                                  : undefined,
                              },
                              onApply: value228,
                              contrastRef: value245,
                              onGesture: value230,
                              onEditText:
                                value244.primaryText &&
                                value244.primaryEditable &&
                                !value137
                                  ? (): Dynamic => {
                                      let primaryText: Dynamic =
                                        value244.primaryText;
                                      primaryText &&
                                        value177.current
                                          .get(primaryText.file)
                                          ?.startTextEdit(
                                            value19(primaryText.file),
                                            primaryText.tid,
                                          );
                                    }
                                  : null,
                              onElementLink:
                                value244.primaryTag === "a" &&
                                value244.primaryText &&
                                !value137
                                  ? (input?: Dynamic): Dynamic => {
                                      let primaryText: Dynamic =
                                        value244.primaryText;
                                      primaryText &&
                                        value18.current?.setElementLink(
                                          primaryText.tid,
                                          input,
                                        );
                                    }
                                  : undefined,
                              onCrop:
                                (value244.probeEl?.kind === "image" ||
                                  value244.primaryTag === "video") &&
                                value244.probeEl != null &&
                                !value137
                                  ? (): Dynamic => {
                                      let probeEl: Dynamic = value244.probeEl;
                                      probeEl &&
                                        value177.current
                                          .get(probeEl.file)
                                          ?.toggleCrop(probeEl.tid);
                                    }
                                  : undefined,
                              cropping:
                                value243.cropping !== null &&
                                value243.cropping === value244.probeEl?.tid,
                              cropReason:
                                value243.target !== null &&
                                "off" in value243.target
                                  ? runtime
                                      .SessionElementStateUnloadedTurnedAutoConfig[
                                      value243.target.off
                                    ]
                                  : value243.target?.tid ===
                                      value244.probeEl?.tid
                                    ? undefined
                                    : runtime.CropIsNotAvailableHereForMessage,
                              onReplaceImage:
                                value244.probeEl?.kind === "image" && !value137
                                  ? (): Dynamic => {
                                      let probeEl: Dynamic = value244.probeEl;
                                      if (!probeEl) return;
                                      if (
                                        /\{\{/.test(
                                          value244.seed.imageSrc ?? "",
                                        )
                                      )
                                        return value188(
                                          "This image comes from the design's script \u2014 change it in Properties.",
                                        );
                                      let value653: Dynamic = value63?.identity,
                                        value654: Dynamic = (
                                          document as Dynamic
                                        ).createElement("input");
                                      value654.type = "file";
                                      value654.accept = "image/*";
                                      value654.hidden = true;
                                      (document as Dynamic).body.appendChild(
                                        value654,
                                      );
                                      value654.addEventListener(
                                        "cancel",
                                        (): Dynamic => value654.remove(),
                                      );
                                      value654.onchange = (): Dynamic => {
                                        let value655: Dynamic =
                                          value654.files?.[0];
                                        value654.remove();
                                        value655 &&
                                          (0, runtime.trackEmbeddedWrite)(
                                            (0, runtime.uploadDesignFile)(
                                              "appifact",
                                              null,
                                              value655,
                                            ).then(
                                              ({
                                                src: src,
                                              }: Dynamic): Dynamic =>
                                                (0, runtime.isEmbedFrozen)() ||
                                                value64.current?.identity !==
                                                  value653
                                                  ? null
                                                  : (value177.current
                                                      .get(probeEl.file)
                                                      ?.replaceImageFor(
                                                        probeEl.tid,
                                                        {
                                                          src: src,
                                                          height: null,
                                                          srcset: null,
                                                        },
                                                      ) ?? false),
                                            ),
                                          )
                                            .then(
                                              (input?: Dynamic): Dynamic => {
                                                input === false &&
                                                  value188(
                                                    "That image could not be placed here.",
                                                  );
                                              },
                                            )
                                            .catch(
                                              (): Dynamic =>
                                                value188(
                                                  "Image upload failed.",
                                                ),
                                            );
                                      };
                                      value654.click();
                                    }
                                  : undefined,
                              findVideo:
                                value244.primaryTag === "video" &&
                                value244.probeEl != null &&
                                !value137
                                  ? (): Dynamic => {
                                      let probeEl: Dynamic = value244.probeEl;
                                      return probeEl
                                        ? (value177.current
                                            .get(probeEl.file)
                                            ?.videoEl(probeEl.tid) ?? null)
                                        : null;
                                    }
                                  : undefined,
                              onReplaceVideo:
                                value244.primaryTag === "video" &&
                                value244.probeEl != null &&
                                !value137
                                  ? (): Dynamic => {
                                      let probeEl: Dynamic = value244.probeEl;
                                      if (!probeEl) return;
                                      let value653: Dynamic =
                                        value177.current
                                          .get(probeEl.file)
                                          ?.videoKey(probeEl.tid) ?? null;
                                      if (value653 === null)
                                        return value188(
                                          "This video can't be replaced: it has no file of its own.",
                                        );
                                      if (value653.src.includes("{{"))
                                        return value188(
                                          "This video's file comes from the design's data, so it can't be replaced here.",
                                        );
                                      let value654: Dynamic = (
                                        document as Dynamic
                                      ).createElement("input");
                                      value654.type = "file";
                                      value654.accept =
                                        runtime.VideoMp4VideoWebmVideoQuicktimeMovValue;
                                      value654.hidden = true;
                                      (document as Dynamic).body.appendChild(
                                        value654,
                                      );
                                      value654.addEventListener(
                                        "cancel",
                                        (): Dynamic => value654.remove(),
                                      );
                                      value654.onchange = (): Dynamic => {
                                        let value655: Dynamic =
                                          value654.files?.[0];
                                        value654.remove();
                                        if (!value655) return;
                                        if (!(0, runtime.isVideoFile)(value655))
                                          return value188(
                                            "Pick a video file to replace a video.",
                                          );
                                        let value656: Dynamic = (0,
                                        runtime.videoUploadRefusal)(value655);
                                        if (value656 !== null)
                                          return value188(
                                            (0,
                                            runtime.CanvasWorkingStateReplace)(
                                              (0,
                                              runtime.videoUploadFailureMessage)(
                                                value656,
                                              ),
                                            ),
                                          );
                                        (0, runtime.announce)(
                                          "Uploading video",
                                        );
                                        (0, runtime.trackEmbeddedWrite)(
                                          (async (): Promise<Dynamic> => {
                                            let value657: Dynamic = await (0,
                                            runtime.probeVideoFile)(
                                              value655,
                                            ).catch(
                                              (): Dynamic => "probe_timeout",
                                            );
                                            if (typeof value657 == "string") {
                                              value188(
                                                (0,
                                                runtime.CanvasWorkingStateReplace)(
                                                  (0,
                                                  runtime.videoUploadFailureMessage)(
                                                    value657,
                                                  ),
                                                ),
                                              );
                                              return false;
                                            }
                                            let value658: Dynamic = await (0,
                                            runtime.uploadDesignVideo)(
                                              value655,
                                              value657,
                                            );
                                            if ((0, runtime.isEmbedFrozen)())
                                              return false;
                                            if ("refused" in value658) {
                                              value188(
                                                (0,
                                                runtime.CanvasWorkingStateReplace)(
                                                  value658.refused,
                                                ),
                                              );
                                              return false;
                                            }
                                            let callback15: Dynamic =
                                                (): Dynamic =>
                                                  probeEl.file ===
                                                  value271.current
                                                    ? undefined
                                                    : value177.current.get(
                                                        probeEl.file,
                                                      ),
                                              value659: Dynamic = callback15();
                                            for (
                                              let index: Dynamic = 0;
                                              !value659 &&
                                              index < 240 &&
                                              !(0, runtime.isEmbedFrozen)();
                                              index++
                                            ) {
                                              await new Promise(
                                                (input?: Dynamic): Dynamic =>
                                                  setTimeout(input, 250),
                                              );
                                              value659 = callback15();
                                            }
                                            if ((0, runtime.isEmbedFrozen)())
                                              return false;
                                            if (!value659) {
                                              value188(
                                                "The video wasn't replaced: its artboard isn't open for editing. Open it and replace the video again.",
                                              );
                                              return false;
                                            }
                                            let value660: Dynamic =
                                              await value659.replaceVideoFor(
                                                value653,
                                                {
                                                  src: value658.src,
                                                  width: value657.width,
                                                  height: value657.height,
                                                },
                                              );
                                            value660 === "ok"
                                              ? (0, runtime.announce)(
                                                  "Video replaced",
                                                )
                                              : value188(
                                                  value660 === "unsure"
                                                    ? "The video wasn't replaced: a copy of it was added or removed meanwhile, so which one you meant can't be told. Select it and replace it again."
                                                    : value660 === "gone"
                                                      ? "The video wasn't replaced: it was changed or removed meanwhile. Select the video and replace it again."
                                                      : "The video wasn't replaced: the new file couldn't be used. Pick another .mp4, .mov or .webm.",
                                                );
                                            return value660 === "ok";
                                          })(),
                                        );
                                      };
                                      value654.click();
                                    }
                                  : undefined,
                            }
                          : null
                      }
                      crossFile={
                        value137
                          ? {
                              elements: [...selection.elements.values()].reduce(
                                (input?: Dynamic, options?: Dynamic): Dynamic =>
                                  input + options.count,
                                0,
                              ),
                              artboards: selection.elements.size,
                              objects:
                                selection.artboards.size + selection.notes.size,
                              onDuplicate: value148,
                              onDelete: (): Dynamic => value51(value146),
                            }
                          : null
                      }
                      onSelectionSeq={recordFrameSelectionSequence}
                      onMarqueeBegin={value492 ? undefined : value57}
                      onElementPress={value38}
                      onCoverPress={value37}
                      onCoverPick={value36}
                      onArmArtboard={(input?: Dynamic): Dynamic => {
                        value34(input);
                      }}
                      onSetMoveCommit={value157}
                      armedEmpty={value237}
                      onSetMoveSay={(input?: Dynamic): Dynamic =>
                        value448.current?.(input)
                      }
                      onPressIntent={abandonSelectionGesture}
                      pressIntentIs={isSelectionEpochCurrent}
                      dragToast={value185}
                      onArtboardReady={value166}
                      onHandle={value184}
                      onPreviewDropNotice={value609}
                      dsVarNames={value256}
                      onDefinedVars={value259}
                      onArtboardProblems={value262}
                      artboardProblems={value268.chipProblems}
                      onShowProblems={value268.restore}
                      artboardNotice={value268.notice}
                      onDuplicateObjects={value343}
                      onPlayArtboard={value384}
                      playingFile={value269}
                      onExpandArtboard={value378}
                      onRenameArtboard={value397}
                      onCanvasMenu={value599}
                      renameRef={value293}
                      onExportArtboard={(
                        input?: Dynamic,
                        options?: Dynamic,
                      ): Dynamic => {
                        value504(input, options);
                      }}
                      exportDisabledReason={
                        value480
                          ? runtime.DownloadsArenTAvailableToYouForMessage
                          : undefined
                      }
                      onExportArtboardPdf={(input?: Dynamic): Dynamic => {
                        value513(input);
                      }}
                      exportRules={value93}
                      onExportAllArtboardsPdf={(): Dynamic => {
                        value515();
                      }}
                      onExportSelectedArtboardsPdf={(): Dynamic => {
                        value515(selectionRef.current.artboards);
                      }}
                      onExportArtboardHtmlZip={(input?: Dynamic): Dynamic => {
                        value507(input);
                      }}
                      onArtboardSettings={value531}
                      onOpenTweaks={value528}
                      onToggleTweaks={value530}
                      tweaksOpenFile={value529}
                      tweakRows={value361}
                      onTweaksRow={value363}
                      onTweaksDirty={registerDirtySession}
                      artboardSettings={value542}
                      canvasObject={value541}
                      outlineArtboards={value606}
                      presentPropsTick={value174}
                      onPresentPropsHandled={value176}
                      onPanZoom={value227}
                      streamDragFile={value199}
                      onRepeatRefused={value457}
                      fullscreenFile={value347?.file ?? null}
                      phone={value99}
                      fullscreenBox={value347?.fit === false ? value359 : null}
                      livePins={value567}
                      inUseFiles={value172}
                      onToolChange={value338}
                      toolResetTick={value340}
                      armedTool={value337}
                      keyboard={value604}
                      onDrawArtboard={value313}
                      onImageDrop={value326}
                      pendingPictures={value331}
                      ghostPage={value79}
                      onPlaceTool={value335}
                      onAddShape={value319}
                      onAddPen={value320}
                      onPlaceBlocked={value336}
                      placeRequest={value307}
                      onPlaceHandled={value309}
                      onTextFormat={value231}
                      onHistoryPush={value442}
                      onModelReparsed={value240}
                      onHistoryApply={value445}
                      onHistoryRevoke={value444}
                      onHistoryDrop={value446}
                      onTweakEdit={value416}
                      sessionEpoch={toolResetTick}
                      actionsRef={value18}
                      elementMenuHidden={value95}
                      elementSelection={
                        value63 && (value137 || value63.file === value121)
                          ? value63
                          : null
                      }
                      selectedTidsByFile={value170}
                      selectedRectsByFile={value171}
                      onSelectionEvent={handleFrameSelection}
                      pageKey={value79 === value78 ? "" : value79}
                      onCommentsController={value615}
                      onRevealComment={(source?: Dynamic): Dynamic => {
                        let current4: Dynamic = value73.current,
                          value653: Dynamic = null,
                          value654: Dynamic = null,
                          value655: Dynamic;
                        if (source.kind === "artboard") {
                          value655 = current4.artboards.find(
                            (input?: Dynamic): Dynamic =>
                              source.match(input.file),
                          );
                          value655 &&
                            ([value653, value654] = [
                              (0, runtime.designPageId)(
                                value655,
                                current4.pages,
                              ),
                              value655.file,
                            ]);
                        } else if (source.kind === "note") {
                          let value657: Dynamic = (
                            current4.annotations ?? []
                          ).find(
                            (input?: Dynamic): Dynamic =>
                              source.match(input.id),
                          );
                          value657 &&
                            (value653 = (0, runtime.designPageId)(
                              value657,
                              current4.pages,
                            ));
                        } else {
                          let items: Dynamic = [
                            current4.pages?.[0]?.id ?? "",
                            ...(current4.pages ?? []).map(
                              (input?: Dynamic): Dynamic => input.id,
                            ),
                          ];
                          value653 =
                            items.find(
                              (input?: Dynamic): Dynamic =>
                                (0, runtime.isCanvasPageMatch)(
                                  source.match,
                                  input,
                                  items[0],
                                ),
                            ) ?? null;
                        }
                        if (value653 == null) return false;
                        if (
                          value99 &&
                          value655 &&
                          source.kind === "artboard" &&
                          !source.boards
                        ) {
                          let value657: Dynamic = value653 !== value80.current;
                          value657 &&
                            (value298(value653, value655.file),
                            (value291.current = false));
                          let value658: Dynamic = value657
                              ? ((0, runtime.recallCanvasView)(value653) ??
                                defaultCanvasCamera)
                              : value105.get(),
                            state: Dynamic = {
                              file: value655.file,
                              fit: artboardIsNotExpandedFill(value655),
                            };
                          state.file !== value346.current &&
                            value348(
                              (input?: Dynamic): Dynamic => ({
                                ...state,
                                prev: input?.prev ?? value658,
                              }),
                            );
                          return true;
                        }
                        value345.current && value297.current();
                        let value656: Dynamic =
                          value654 != null && (editing || readOnly)
                            ? value654
                            : undefined;
                        value653 !== value80.current
                          ? (value298(value653, value656),
                            (value291.current = false))
                          : value656 !== undefined && value273(value656);
                        return true;
                      }}
                      exitGuardRef={value}
                      textEditOpenRef={value2}
                      settleSessionRef={value3}
                      commitOpenTextEditRef={value4}
                      onSessionDirtyChange={value17}
                      onEditInput={value135}
                      onLocalEdit={value134}
                      onUndoStack={value611}
                    />
                    <runtime.CdsIsland
                      density={"compact"}
                      className={"contents"}
                    >
                      <runtime.EditorMenu
                        at={value597}
                        onClose={(): Dynamic => value598(null)}
                        items={value597?.items ?? []}
                        minWidth={180}
                        label={value597?.label}
                        focusFirstItem={value597?.keyboard}
                      />
                    </runtime.CdsIsland>
                    <runtime.usePresenceComposer
                      reporter={(): Dynamic =>
                        value371.current ? value366.current : null
                      }
                      color={value367}
                      canOpen={value374}
                    />
                    <runtime.ExportPickerToolbar
                      picker={value486}
                      artboards={value484}
                      rules={value93}
                    />
                    {value86.artboards.length === 0 &&
                      value89.boxesHere.length === 0 &&
                      (editing ? (
                        (value632 || value633) && (
                          <div
                            className={
                              "pointer-events-none absolute inset-0 z-[35] flex flex-col items-center justify-center gap-3 text-center" +
                              (value636
                                ? " top-[var(--tb-overlay-h,0px)] [container-type:size]"
                                : "")
                            }
                          >
                            {value632 && value89.cursor.at === "tips" ? (
                              <runtime.DesignCreationPrompt
                                tip={value89.tip}
                                card={value636}
                                prompt={value633}
                                tucked={value634}
                                sentence={value635}
                                busy={value637}
                                onAdd={(): Dynamic => value313()}
                              />
                            ) : value632 ? (
                              <runtime.BusyCanvasPrompt
                                prompt={value633}
                                tucked={value634}
                                sentence={value635}
                                busy={value637}
                                onAdd={(): Dynamic => value313()}
                              />
                            ) : (
                              <runtime.EmptyCanvasPrompt
                                sentence={value635}
                                onAdd={(): Dynamic => value313()}
                              />
                            )}
                          </div>
                        )
                      ) : (
                        <div
                          className={
                            "pointer-events-none absolute inset-0 z-[35] flex flex-col items-center justify-center gap-1 text-center"
                          }
                        >
                          <runtime.EmptyCanvasReadOnlyNotice
                            editable={editable}
                            reason={saveState.message}
                            wholeCanvas={value631}
                          />
                        </div>
                      ))}
                    {value89.workingLabel ? (
                      <runtime.CreationWorkingAnnouncement />
                    ) : null}
                  </main>
                  {editable ? (
                    <runtime.useCanvasWorkingState
                      doc={doc}
                      empty={
                        editing && value86.artboards.length === 0 && value632
                      }
                      items={(): Dynamic =>
                        (0, runtime.createWorkingFileMap)(doc.content().files)
                      }
                      words={
                        runtime.AccessibilityAnnouncementsReadyUpdatedChangedConfig
                      }
                      onBusy={value638}
                    />
                  ) : null}
                  {value351 == null && editing && value541 != null && (
                    <runtime.AnchoredDesignProperties
                      settings={value541}
                      readOnly={!editable}
                    />
                  )}
                </div>
              </div>
              <aside
                id={runtime.inspectorPanelId}
                aria-label={"Properties panel"}
                inert={value283}
                className={
                  (value283 ? "hidden" : "flex") +
                  " isolate z-40 h-full shrink-0 max-[599px]:h-auto max-[599px]:w-full max-[599px]:flex-col"
                }
              />
            </div>
          </runtime.InspectorOpenContext.Provider>
        </runtime.CanvasWorkingStateContext.Provider>
      </runtime.ViewportContext.Provider>
    );
  }
  bindRuntimeValue(
    runtime,
    "noopCanvasSubscription",
    () => noopCanvasSubscription,
    (value) => {
      noopCanvasSubscription = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "zeroCanvasRevision",
    () => zeroCanvasRevision,
    (value) => {
      zeroCanvasRevision = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "canvasNeedsPageMessage",
    () => canvasNeedsPageMessage,
    (value) => {
      canvasNeedsPageMessage = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "fitArtboardsLabel",
    () => fitArtboardsLabel,
    (value) => {
      fitArtboardsLabel = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "loosePieceRenameHint",
    () => loosePieceRenameHint,
    (value) => {
      loosePieceRenameHint = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "staleDeleteFailureMessage",
    () => staleDeleteFailureMessage,
    (value) => {
      staleDeleteFailureMessage = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "singleArtboardPngCopyMessage",
    () => singleArtboardPngCopyMessage,
    (value) => {
      singleArtboardPngCopyMessage = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "singleArtboardSvgCopyMessage",
    () => singleArtboardSvgCopyMessage,
    (value) => {
      singleArtboardSvgCopyMessage = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "staticArtboardPlaybackMessage",
    () => staticArtboardPlaybackMessage,
    (value) => {
      staticArtboardPlaybackMessage = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "loosePiecePlaybackMessage",
    () => loosePiecePlaybackMessage,
    (value) => {
      loosePiecePlaybackMessage = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "pageHasNoArtboardsMessage",
    () => pageHasNoArtboardsMessage,
    (value) => {
      pageHasNoArtboardsMessage = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "existingThumbnailMessage",
    () => existingThumbnailMessage,
    (value) => {
      existingThumbnailMessage = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "oversizedThumbnailMessage",
    () => oversizedThumbnailMessage,
    (value) => {
      oversizedThumbnailMessage = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "MemoizedCanvasZoomControl",
    () => MemoizedCanvasZoomControl,
    (value) => {
      MemoizedCanvasZoomControl = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "MemoizedCanvasSaveIndicator",
    () => MemoizedCanvasSaveIndicator,
    (value) => {
      MemoizedCanvasSaveIndicator = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "isCanvasReadonlySaveState",
    () => isCanvasReadonlySaveState,
    (value) => {
      isCanvasReadonlySaveState = value;
    },
  );
  bindRuntimeValue(runtime, "useCanvasSaveState", () => useCanvasSaveState);
  bindRuntimeValue(
    runtime,
    "CanvasSaveStatus",
    () => CanvasSaveStatus,
    (value) => {
      CanvasSaveStatus = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "CanvasSaveKeyboardShortcut",
    () => CanvasSaveKeyboardShortcut,
    (value) => {
      CanvasSaveKeyboardShortcut = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "artboardRevealSettleTimeoutMs",
    () => artboardRevealSettleTimeoutMs,
    (value) => {
      artboardRevealSettleTimeoutMs = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "artboardFrameReadyTimeoutMs",
    () => artboardFrameReadyTimeoutMs,
    (value) => {
      artboardFrameReadyTimeoutMs = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "dragGhostFilename",
    () => dragGhostFilename,
    (value) => {
      dragGhostFilename = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "previewDropNoticeDurationMs",
    () => previewDropNoticeDurationMs,
    (value) => {
      previewDropNoticeDurationMs = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "canvasExportSettleTimeoutMs",
    () => canvasExportSettleTimeoutMs,
    (value) => {
      canvasExportSettleTimeoutMs = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "exportAlreadyRunningMessage",
    () => exportAlreadyRunningMessage,
    (value) => {
      exportAlreadyRunningMessage = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "maxSessionDirtyFlushRetries",
    () => maxSessionDirtyFlushRetries,
    (value) => {
      maxSessionDirtyFlushRetries = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "canvasExitExportWaitTimeoutMs",
    () => canvasExitExportWaitTimeoutMs,
    (value) => {
      canvasExitExportWaitTimeoutMs = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "crossCanvasPasteConfirmFeatureFlag",
    () => crossCanvasPasteConfirmFeatureFlag,
    (value) => {
      crossCanvasPasteConfirmFeatureFlag = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "emptyCanvasFileSet",
    () => emptyCanvasFileSet,
    (value) => {
      emptyCanvasFileSet = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "emptyCanvasSelectionFiles",
    () => emptyCanvasSelectionFiles,
    (value) => {
      emptyCanvasSelectionFiles = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "emptyCanvasOptions",
    () => emptyCanvasOptions,
    (value) => {
      emptyCanvasOptions = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "layerEntriesEqual",
    () => layerEntriesEqual,
    (value) => {
      layerEntriesEqual = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "emptyCanvasNoteSet",
    () => emptyCanvasNoteSet,
    (value) => {
      emptyCanvasNoteSet = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "singleCanvasCaptureSemaphore",
    () => singleCanvasCaptureSemaphore,
    (value) => {
      singleCanvasCaptureSemaphore = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "parallelCanvasCaptureSemaphore",
    () => parallelCanvasCaptureSemaphore,
    (value) => {
      parallelCanvasCaptureSemaphore = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "artboardIsNotExpandedFill",
    () => artboardIsNotExpandedFill,
    (value) => {
      artboardIsNotExpandedFill = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "canvasPastePositionStep",
    () => canvasPastePositionStep,
    (value) => {
      canvasPastePositionStep = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "artboardFullscreenCamera",
    () => artboardFullscreenCamera,
  );
  bindRuntimeValue(
    runtime,
    "defaultCanvasCamera",
    () => defaultCanvasCamera,
    (value) => {
      defaultCanvasCamera = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "nextArtboardPlacementPoint",
    () => nextArtboardPlacementPoint,
  );
  bindRuntimeValue(
    runtime,
    "canvasPanUsageWindowMs",
    () => canvasPanUsageWindowMs,
    (value) => {
      canvasPanUsageWindowMs = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "canvasZoomUsageWindow",
    () => canvasZoomUsageWindow,
    (value) => {
      canvasZoomUsageWindow = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "minimumCanvasZoomUsage",
    () => minimumCanvasZoomUsage,
    (value) => {
      minimumCanvasZoomUsage = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "hasActiveUserGesture",
    () => hasActiveUserGesture,
    (value) => {
      hasActiveUserGesture = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "runWhenConditionReady",
    () => runWhenConditionReady,
  );
  bindRuntimeValue(
    runtime,
    "readCanvasClipboardText",
    () => readCanvasClipboardText,
  );
  bindRuntimeValue(
    runtime,
    "canvasSelectionChromeInsetPixels",
    () => canvasSelectionChromeInsetPixels,
    (value) => {
      canvasSelectionChromeInsetPixels = value;
    },
  );
  bindRuntimeValue(
    runtime,
    "canvasSelectionsEqual",
    () => canvasSelectionsEqual,
  );
  bindRuntimeValue(runtime, "DesignCanvas", () => DesignCanvas);
  return () => {
    noopCanvasSubscription = (): Dynamic => (): Dynamic => {};
    zeroCanvasRevision = (): Dynamic => 0;
    canvasNeedsPageMessage = "A canvas needs at least one page.";
    fitArtboardsLabel = "Fit artboards";
    loosePieceRenameHint =
      "A loose piece shows no title on the canvas. Rename it in Layers.";
    staleDeleteFailureMessage = (input?: Dynamic): Dynamic =>
      "Nothing was deleted: \u201C" + input + "\u201D is now the only page.";
    singleArtboardPngCopyMessage =
      "Select just one artboard to copy it as a PNG.";
    singleArtboardSvgCopyMessage =
      "Select just one artboard to copy it as an SVG.";
    staticArtboardPlaybackMessage =
      "Only prototype artboards (marked interactive) play on the canvas.";
    loosePiecePlaybackMessage =
      "A loose piece doesn\u2019t play on its own; only artboards do.";
    pageHasNoArtboardsMessage = "This page has no artboards to play yet.";
    existingThumbnailMessage = "This artboard is already the thumbnail.";
    oversizedThumbnailMessage =
      "This artboard is too large to use as the thumbnail.";
    MemoizedCanvasZoomControl = (0, runtime.reactChromeTheme.memo)(
      runtime.CanvasZoomControl,
    );
    MemoizedCanvasSaveIndicator = (0, runtime.reactChromeTheme.memo)(
      runtime.ToolbarPublishControls,
    );
    isCanvasReadonlySaveState = (state?: Dynamic): Dynamic =>
      state.status === "readonly" || state.status === "error"
        ? state.status
        : "live";
    CanvasSaveStatus = (0, runtime.reactChromeTheme.memo)(function ({
      doc: doc,
      synced: synced,
      localDirty: localDirty,
      onSave: onSave,
    }: Dynamic): Dynamic {
      let value: Dynamic = useCanvasSaveState(doc, synced, localDirty);
      return (
        <MemoizedCanvasSaveIndicator
          saveState={value}
          saveMode={doc.saveMode()}
          syncDot={synced}
          onSave={onSave}
        />
      );
    });
    CanvasSaveKeyboardShortcut = (0, runtime.reactChromeTheme.memo)(function ({
      doc: doc,
      synced: synced,
      localDirty: localDirty,
      onSave: onSave,
    }: Dynamic): Dynamic {
      let value: Dynamic = useCanvasSaveState(doc, synced, localDirty);
      (0, runtime.useFrameSaveState)(
        synced || value.status === "readonly" ? value.status : null,
        onSave,
      );
      return null;
    });
    artboardRevealSettleTimeoutMs = 2 * runtime.PickerBridgeConstant_2 + 2e3;
    artboardFrameReadyTimeoutMs = 12e3;
    dragGhostFilename = "__drag-ghost.dc.html";
    previewDropNoticeDurationMs = 8e3;
    canvasExportSettleTimeoutMs = 2e4;
    exportAlreadyRunningMessage =
      "Another export is still running. Try again when it finishes.";
    maxSessionDirtyFlushRetries = 3;
    canvasExitExportWaitTimeoutMs = 1e4;
    crossCanvasPasteConfirmFeatureFlag = "design_cross_canvas_paste_confirm";
    emptyCanvasFileSet = new Set();
    emptyCanvasSelectionFiles = emptyCanvasFileSet;
    emptyCanvasOptions = {};
    layerEntriesEqual = (items?: Dynamic, items2?: Dynamic): Dynamic =>
      items.length === items2.length &&
      items.every((source?: Dynamic, options?: Dynamic): Dynamic => {
        let value: Dynamic = items2[options];
        return (
          source.tid === value.tid &&
          source.kind === value.kind &&
          source.label === value.label &&
          source.glyph === value.glyph &&
          source.detail === value.detail &&
          source.hidden === value.hidden &&
          source.grayed === value.grayed &&
          source.component?.ref === value.component?.ref &&
          source.component?.kind === value.component?.kind &&
          source.noHide === value.noHide &&
          source.tag === value.tag &&
          layerEntriesEqual(source.children, value.children)
        );
      });
    emptyCanvasNoteSet = new Set();
    singleCanvasCaptureSemaphore = new runtime.TokenBucket(1, 1);
    parallelCanvasCaptureSemaphore = new runtime.TokenBucket(6, 6);
    artboardIsNotExpandedFill = (input?: Dynamic): Dynamic =>
      input?.expand !== "fill";
    canvasPastePositionStep = 24;
    defaultCanvasCamera = {
      x: -60,
      y: -80,
      scale: 0.5,
    };
    canvasPanUsageWindowMs = 6e4;
    canvasZoomUsageWindow = 12;
    minimumCanvasZoomUsage = 0.02;
    hasActiveUserGesture = (): Dynamic =>
      navigator.userActivation?.isActive === true;
    canvasSelectionChromeInsetPixels = 48;
  };
}
