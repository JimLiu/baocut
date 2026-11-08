import { defineMessages } from '@baocut/protocol';
import { zhHans } from './semantic-copy.zh-Hans.ts';
import { zhHant } from './semantic-copy.zh-Hant.ts';
import { ja } from './semantic-copy.ja.ts';
import { ko } from './semantic-copy.ko.ts';
import { es } from './semantic-copy.es.ts';
import { fr } from './semantic-copy.fr.ts';
import { de } from './semantic-copy.de.ts';
import { nl } from './semantic-copy.nl.ts';
import { ptBR } from './semantic-copy.pt-BR.ts';
import { it } from './semantic-copy.it.ts';
import { ru } from './semantic-copy.ru.ts';
import { pl } from './semantic-copy.pl.ts';
import { tr } from './semantic-copy.tr.ts';
import { vi } from './semantic-copy.vi.ts';

/**
 * 本机语义索引的文案（semantic-status.ts、设置 › 语义索引、各入口的那一句）。英文是键与类型的来源，译文在
 * `semantic-copy.<语言>.ts`。
 */
const en = {
  /** 原因码（`SemanticReason`，以及翻译记忆的 `DISABLED`、`MEMORY_UNAVAILABLE`）给人看的一句。 */
  reason: {
    MODEL_NOT_INSTALLED: 'The text search model isn’t installed',
    MODEL_UNAVAILABLE: 'The text search model couldn’t run',
    PROFILE_INCOMPATIBLE: 'The index was built with a different model and has to be rebuilt',
    INPUT_TOO_LONG: 'The text is too long for the model',
    SOURCE_MISSING: 'The source is gone',
    INDEX_NOT_READY: 'The semantic index isn’t ready yet',
    INDEX_PARTIAL: 'The semantic index covers only part of this scope',
    STALE_REVISION: 'The video changed after it was indexed',
    CURSOR_STALE: 'The results changed',
    SEARCH_CANCELLED: 'Canceled',
    RESOURCE_EXHAUSTED: 'Not enough memory to run the model right now',
    APPEARANCE_UNAVAILABLE: 'Searching how the finished video looks isn’t available yet',
    CHANNEL_UNAVAILABLE: 'Visuals and sounds aren’t indexed in this version',
    DISABLED: 'Turned off in Settings › Semantic index',
    MEMORY_UNAVAILABLE: 'Earlier translations couldn’t be read',
  },
  unknownReason: (code: string) => `Semantic features are unavailable (${code})`,
  /** 每个入口：没装模型时那一句；退回的那条路叫什么。 */
  entry: {
    search: { not: 'No local semantic model, so only exact text was matched', fallback: 'exact text' },
    topic: { not: 'Needs the local semantic model', fallback: 'the whole text or one chapter' },
    terms: { not: 'Exact matches only: looked for the misheard spellings saved in your glossary', fallback: 'exact matches' },
    tm: { not: 'Only sentences with identical source text reuse earlier translations', fallback: 'exact matches' },
    retakes: { not: 'Only retakes with identical text were found', fallback: 'identical text' },
    shorts: { not: 'Needs the local semantic model; without a topic the whole video is analyzed', fallback: 'whole-video analysis' },
    related: { not: 'No local semantic model, so videos with similar names are listed', fallback: 'similar names' },
  },
  note: {
    degraded: (fallback: string, why: string) => `Used ${fallback} only. ${why}`,
    stale: 'The index is updating; results may not include recent changes',
    paused: 'The index is paused; results may not include recent changes',
    battery: 'On battery power, so indexing is paused; it continues when you plug in',
    thermal: 'The computer is slowing down to cool off, so indexing is paused; it continues when it cools down',
    openSettings: 'Settings…',
  },
  coverage: {
    none: 'No text index',
    empty: 'No videos',
    noTranscripts: 'No transcripts yet, so there’s no text index',
    notIncluded: 'No videos in this scope are in the semantic index, so only exact text is matched',
    ready: 'Text is ready',
    readyWith: (detail: string) => `Text is ready (${detail})`,
    partial: (done: number, total: number, detail: string) => `Text: ${done}/${total} videos${detail ? ` (${detail})` : ''}`,
    queued: (n: number) => `${n} queued`,
    failed: (n: number) => `${n} failed`,
    outdated: (n: number) => `${n} out of date`,
    missing: (n: number) => `${n} without a transcript`,
    excluded: (n: number) => `${n} not in the semantic index`,
    separator: ', ',
    /** 文字与画面两路之间。 */
    channelSeparator: '; ',
    visualReady: 'Visuals are ready',
    visualPartial: (done: number, total: number, detail: string) => `Visuals: ${done}/${total} videos${detail ? ` (${detail})` : ''}`,
  },
  settings: {
    lead: 'Finds what was said by meaning. Space search, picking material by topic, glossary candidates, translation memory and retake candidates use it. The model and the index stay on this computer and are never uploaded.',
    modelGroup: 'Model',
    packageName: 'Semantic search',
    packageDesc:
      'Finds what was said and what’s on screen by meaning: Space search, picking material by topic, matching visuals, glossary candidates, translation memory and retake candidates. Sounds come in a later version.',
    partText: 'Text model',
    partMultimodal: 'Multimodal model',
    installing: 'Installing',
    packageNote: (cost: string | null) =>
      cost
        ? `Installs the text model and the multimodal model together. Then videos in the index scope are indexed by what was said, then by what’s on screen: ${cost}. Indexing pauses on battery, and you can turn visuals off below.`
        : 'Installs the text model and the multimodal model together. Then videos in the index scope are indexed by what was said, then by what’s on screen. Indexing pauses on battery, and you can turn visuals off below.',
    installed: 'Installed',
    notInstalled: 'Not installed',
    unsupported: 'Platform not supported in this version',
    install: (size: string | null) => (size ? `Install · ${size}` : 'Install'),
    resume: 'Resume download',
    remove: 'Remove',
    removeBody:
      'Removes the model files. Space search falls back to exact text and picking material by topic is unavailable. The semantic index stays until you clear it; after you reinstall, it’s reused or rebuilt from your transcripts.',
    unsupportedTitle: 'Local semantic models are not supported on this platform in this version',
    unsupportedBody: 'This version has no semantic model runtime for the operating system and architecture of the computer running BaoCut Runtime. Exact text search, the whole-text and chapter scopes for writing, and exact glossary matching work as usual.',
    indexGroup: 'Index',
    status: 'Status',
    state: { unavailable: 'Unavailable', paused: 'Paused', updating: 'Updating', ready: 'Up to date' },
    readyDesc: 'Every existing transcript has a text index.',
    pausedDesc: 'Nothing new is indexed while paused. Search still uses what’s indexed, so results may not include recent changes.',
    pause: 'Pause',
    resumeIndex: 'Resume',
    paused: 'Indexing paused',
    resumed: 'Indexing resumed',
    pauseOnBattery: 'Pause on battery',
    pauseOnBatteryDesc: 'Indexing waits while a laptop runs on battery and continues when it’s plugged in. It always pauses while the computer is slowing down to cool off.',
    eta: {
      measured: (n: number, time: string) => `Left to index: ${n} · ${time}, based on this computer’s speed`,
      reference: (n: number, time: string) => `Left to index: ${n} · ${time}, a rough estimate`,
      noRate: (n: number) => `Left to index: ${n} · the time shows after the first one`,
      withUnknown: (line: string, n: number) => `${line} (${n} with unknown length not counted)`,
      lessThanMinute: 'under a minute',
      minutes: (n: number) => `about ${n} min`,
      hours: (h: string) => `about ${h} hr`,
    },
    /**
     * 「状态」下面那根合并的进度条（检索规格 §13.2）：按路写计数，画面排在讲话内容后面；下面一句是两路合起来还要多久，
     * 停着时写原因。计数传进来的是已按语言分好位的数字。
     */
    progress: {
      label: 'Indexing progress',
      text: (done: string, total: string) => `Speech: ${done}/${total} videos`,
      textDone: 'Speech is ready',
      /** 讲话内容正在建的那一部的句群编到百分之几（整数）。 */
      textCurrent: (line: string, pct: number) => `${line} (current video ${pct}%)`,
      visual: (done: string, total: string) => `Visuals: ${done}/${total} frames`,
      visualDone: 'Visuals are ready',
      /** 画面在等讲话内容建完：一帧还没建时「开始」，建过一部分时「接着建」。 */
      startsAfter: (line: string) => `${line} (starts after speech)`,
      continuesAfter: (line: string) => `${line} (continues after speech)`,
      separator: ' · ',
      /** 还要多久按什么速度算：都量过、都没量过（参考速度）、一路量过一路没有。 */
      basis: { measured: 'based on this computer’s speed', reference: 'a rough estimate', mixed: 'partly a rough estimate' },
      unknown: (n: number) => `${n} with unknown length not counted`,
      eta: (time: string, basis: string, unknown: string | null) => `Time left: ${time}, ${basis}${unknown ? ` (${unknown})` : ''}`,
      noRate: 'The time left shows after the first video is indexed',
      paused: { user: 'Paused', battery: 'Paused on battery', thermal: 'Paused while the computer cools down' },
    },
    visualIndex: {
      label: 'Visuals',
      desc: 'Finds shots by what’s on screen and matches visuals to sentences.',
      needsPackage: 'Finds shots by what’s on screen. Needs the multimodal model: complete Semantic search above.',
      scopeOnDesc: 'Videos in the index scope are indexed by what’s on screen. Turning it off stops indexing new visuals.',
      scopeConfirmBody: (cost: string) =>
        `Indexes the videos in the index scope by what’s on screen: ${cost}. It runs in the background on the CPU, and you can pause it anytime.`,
      scopeConfirmBodyNoCost: 'Indexes the videos in the index scope by what’s on screen. It runs in the background on the CPU, and you can pause it anytime.',
      unavailable: 'Finds shots by what’s on screen. Not available right now.',
      offCost: (cost: string) => `Finds shots by what’s on screen and matches visuals to sentences. Turning it on indexes ${cost}.`,
      confirmTitle: 'Turn on the visual index?',
      turnOn: 'Turn on',
      turnedOn: 'Visual index turned on. Building in the background.',
      turnedOff: 'Visual index turned off. No new visuals are indexed.',
    },
    /** 打开画面之前那一句的各段（检索规格 §13.2，`estimates` 里 `ifEnabled` 的画面一项）。 */
    cost: {
      head: (videos: number, length: string, frames: number) => `${videos} videos, ${length} → about ${frames} frames`,
      unknown: (n: number) => `${n} with unknown length not counted`,
      firstRun: (time: string, measured: boolean) => `first run ${time} (${measured ? 'based on this computer’s speed' : 'CPU reference speed'})`,
      /** `null`：不到 1 MB。 */
      vectors: (size: string | null) => (size ? `vectors ${size}` : 'vectors under 1 MB'),
      noLength: (videos: number) => `${videos} videos of unknown length, so the time can’t be estimated`,
      separator: ', ',
      cacheNote: (line: string) => `${line}; the keyframe cache isn’t counted and can be cleared`,
    },
    cache: 'Cache',
    cacheDesc: 'Vectors and the index, kept in the app’s data, not in your project folders.',
    clear: 'Clear',
    clearTitle: 'Clear the semantic index?',
    clearBody: (size: string) =>
      `Deletes ${size} of index and cache. The model stays. The index is rebuilt in the background from existing transcripts; until then, features that use it say the index is updating.`,
    cleared: 'Cleared. Rebuilding in the background.',
    controlFailed: (text: string) => `Couldn’t change the index: ${text}`,
    runsOn: 'Runs on',
    runsOnDesc:
      'Uses the multimodal model when it’s installed, otherwise the text model. Search runs on the GPU when it can, otherwise the CPU.',
    notLoaded: 'Not loaded yet',
    featuresGroup: 'Features that use it',
    tm: 'Translation memory',
    tmDesc:
      'When translating, sentences whose source text matches one in your other videos reuse that translation and are marked “Reused” in subtitles; similar earlier translations go along as references.',
    tmDescLexical: 'Without the model, only sentences with identical source text reuse earlier translations.',
    terms: 'Glossary candidates',
    termsDesc: 'While polishing, near-identical spellings across your transcripts are listed as glossary candidates for you to choose from.',
    termsDescLexical: 'Without the model, only the misheard spellings saved in your glossary are matched.',
    loading: 'Reading the index status…',
    loadFailed: (text: string) => `Couldn’t read the index status: ${text}`,
  },
  /** Space 条目上的索引标志、查看框里那一行与条目菜单的三项（model/space-index.ts）。 */
  spaceIndex: {
    state: {
      failed: 'Index failed',
      stale: 'Index outdated',
      indexing: 'Indexing',
      queued: 'Queued',
      indexed: 'Indexed',
      empty: 'Nothing to index',
      notNeeded: 'No index needed',
      excluded: 'Not indexed',
    },
    channel: { text: 'Speech', visual: 'Visuals' },
    channelState: {
      indexed: 'indexed',
      stale: 'outdated',
      queued: 'queued',
      indexing: 'indexing',
      failed: 'failed',
      missingInput: 'no transcript',
      excluded: 'not indexed',
      off: 'visual index is off',
    },
    line: (channel: string, state: string) => `${channel}: ${state}`,
    lineSeparator: '; ',
    withPct: (label: string, pct: number) => `${label} ${pct}%`,
    title: (label: string, tail: string | null) => (tail ? `Semantic index: ${label} · ${tail}` : `Semantic index: ${label}`),
    whyExport: (name: string | null) =>
      name ? `Exported from “${name}”, which is already indexed. Searching finds it there.` : 'Exported from a video that is already indexed. Searching finds it there.',
    whyProject: (name: string | null) =>
      name
        ? `The project “${name}” is excluded, so only exact text matches. Restore it in Settings › Semantic index.`
        : 'Its project is excluded, so only exact text matches. Restore it in Settings › Semantic index.',
    whyVideo: 'Set not to index: its index was removed, so only exact text matches.',
    whyNoTranscript: 'No transcript and no visuals to index.',
    whyNoTranscriptVisualOff: 'No transcript, and the visual index is off.',
    fact: 'Semantic index',
    reindex: 'Re-index',
    reindexDesc: 'Drop its index and rebuild it first',
    retryDesc: 'Try again, first in line',
    noIndex: 'Don’t index',
    noIndexDesc: 'Remove its index and stop indexing it; only exact text matches',
    include: 'Index again',
    includeDesc: 'Back in the queue, indexed by speech and visuals',
    reindexed: (name: string) => `“${name}” is first in line to be re-indexed.`,
    reindexedPaused: (name: string) => `“${name}” is first in line. Indexing is paused and starts with it when resumed.`,
    excludedToast: (name: string) => `“${name}” won’t be indexed. Its index will be removed.`,
    includedToast: (name: string) => `“${name}” is back in the index queue.`,
    undo: 'Undo',
    actionFailed: (text: string) => `Couldn’t change indexing: ${text}`,
  },
  /** 设置页「索引范围」一组（检索规格 §11.3）。 */
  scope: {
    group: 'Index scope',
    lead: 'Videos in every BaoCut project are indexed by what was said and what’s on screen; sounds come in a later version. You can exclude projects you don’t want indexed. Exported videos aren’t indexed separately: searching finds the video they were exported from.',
    all: 'All BaoCut projects',
    allLine: (projects: number, excluded: number) =>
      `${projects === 1 ? '1 project' : `${projects} projects`}${excluded ? `, ${excluded} excluded` : ''} · new projects are added automatically`,
    outside: 'Videos outside projects are indexed too.',
    excludedGroup: 'Excluded projects',
    exclude: 'Exclude projects…',
    none: 'None. Excluding a project removes its index.',
    onlyExact: 'Only exact text matches',
    restore: 'Restore',
    videosHead: 'Set not to index in Space:',
    dialogTitle: 'Exclude projects',
    dialogBody: 'Checked projects aren’t indexed: their index is removed, and Space and writing find them only by exact text. Unchecking one puts it back in the queue.',
    dialogPick: 'Projects to exclude',
    dialogAdded: (n: number) =>
      n === 1 ? 'Excluding 1 more project. Its index is removed when you’re done.' : `Excluding ${n} more projects. Their index is removed when you’re done.`,
    noProjects: 'No projects yet.',
    done: 'Done',
    cancel: 'Cancel',
    toastExcluded: (n: number) => (n === 1 ? 'Excluded 1 project. Its index will be removed.' : `Excluded ${n} projects. Their index will be removed.`),
    toastRestored: (n: number) => (n === 1 ? '1 project is back in the index queue.' : `${n} projects are back in the index queue.`),
    toastSeparator: ' ',
  },
  /** 设置页「索引」里的「位置」一行与更改对话框（检索规格 §8.1；只在桌面端）。 */
  location: {
    label: 'Location',
    defaultDesc: 'In the app data. You can move it to a disk with more room; the index grows as more videos are indexed.',
    customDesc: 'In a folder you chose.',
    missingDesc:
      'This folder can’t be found (an external drive may be disconnected). Space search falls back to exact text until it’s back.',
    moving: (size: string, to: string) =>
      `Moving ${size} to ${to}. Indexing is paused and Space search falls back to exact text until it’s done.`,
    movingLabel: 'Moving the semantic index',
    change: 'Change…',
    restore: 'Restore default',
    changeTitle: 'Change index location',
    restoreTitle: 'Move the index back to the default location',
    same: 'The index is already here.',
    howTo: 'What to do with the current index',
    moveOption: 'Move the current index there',
    moveDesc: (size: string) =>
      `Moves ${size}. While it moves, indexing is paused and Space search falls back to exact text. Nothing is kept in the old location.`,
    rebuildOption: 'Rebuild it there',
    rebuildDesc:
      'Deletes the current index and rebuilds it there in the background from existing transcripts and frames. Search by meaning is incomplete until it finishes.',
    keyframesNote:
      'The keyframe cache isn’t moved: it stays in the app cache, can be cleared and is fetched again when needed. If the disk with the index isn’t connected, Space search falls back to exact text and picks up again once it is.',
    confirmMove: 'Move and change',
    confirmRebuild: 'Change and rebuild',
    confirmChange: 'Change location',
    movingToast: (to: string) => `Moving the index to ${to}`,
    movedToast: (to: string) => `Moved the index to ${to}`,
    rebuiltToast: (to: string) => `Index location changed to ${to}. Rebuilding in the background.`,
    changedToast: (to: string) => `Index location changed to ${to}`,
    pickFailed: (message: string) => `Couldn't choose the folder: ${message}`,
  },
  /** 设置页「索引范围」里的索引文件夹（检索规格 §9.1；添加、重新索引、移除只在桌面端）。 */
  folders: {
    head: 'Index folders outside your projects:',
    add: 'Add folder…',
    actions: (name: string) => `Actions for index folder “${name}”`,
    reindex: 'Re-index',
    reindexDesc: 'Scan it again and rebuild its index',
    remove: 'Remove',
    removeDesc: 'Delete its index; the files stay',
    videos: (n: number) => (n === 1 ? '1 BaoCut video' : `${n} BaoCut videos`),
    videoFiles: (n: number) => (n === 1 ? '1 video file' : `${n} video files`),
    images: (n: number) => (n === 1 ? '1 image' : `${n} images`),
    nothing: 'No videos or images found yet',
    exportsSkipped: (n: number) => (n === 1 ? '1 export skipped' : `${n} exports skipped`),
    duplicates: (n: number) => (n === 1 ? '1 already in a project' : `${n} already in projects`),
    legacy: (n: number) => (n === 1 ? '1 older BaoCut video not read' : `${n} older BaoCut videos not read`),
    listSeparator: ', ',
    separator: ' · ',
    missing: 'Can’t find this folder',
    missingNote: 'An external drive may be disconnected. Its index is kept and Space hides these files until the folder is back.',
    truncatedNote: (limit: number) => `Too many files: only the first ${limit} were scanned. Add a subfolder instead.`,
    truncatedNoteNoLimit: 'Too many files: only the first ones were scanned. Add a subfolder instead.',
    unreadableNote: 'Can’t read this folder. Check its permissions.',
    legacyNote:
      'Older BaoCut videos have to be upgraded before they can be read, and upgrading changes them, so they aren’t read here. Move one into a project and open it in BaoCut once to upgrade it.',
    visualReady: 'Visuals ready',
    visualProgress: (done: number, total: number) => `Visuals: ${done} of ${total} done`,
    textOnly: 'Its BaoCut videos are indexed by speech',
    visualOff: 'Visual index is off, so video files and images aren’t indexed yet',
    addTitle: 'Add index folder',
    addBody:
      'Videos outside your projects can also be found by meaning. BaoCut only reads this folder: it doesn’t change, move or delete anything in it. Its videos and images appear in Space with this folder as the source.',
    addWhat: (visual: boolean): string =>
      visual
        ? 'BaoCut videos are indexed by speech and visuals; other video files and images by visuals. Exports BaoCut recorded are skipped, and videos that are also in a project use the project’s copy.'
        : 'BaoCut videos are indexed by speech; other video files and images need the visual index. Exports BaoCut recorded are skipped, and videos that are also in a project use the project’s copy.',
    visualOffTitle: 'Video files and images are indexed by visuals',
    visualOffBody:
      'They have no transcript, so they can only be found by what’s on screen. They’re indexed once the visual index is on; until then only the BaoCut videos in this folder are indexed.',
    confirmAdd: 'Add',
    addedToast: (name: string) => `Added “${name}”. Scanning and indexing in the background.`,
    reindexedToast: (name: string) => `Rescanning “${name}” and rebuilding its index`,
    removeTitle: (name: string) => `Remove index folder “${name}”?`,
    removeBody:
      'Deletes this folder’s index; the files stay. Space stops listing them and they can’t be found by meaning. You can add the folder again later.',
    removedToast: (name: string) => `Removed the index for “${name}”`,
    failed: (message: string) => `That didn’t work: ${message}`,
  },
};

export type SemanticMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
