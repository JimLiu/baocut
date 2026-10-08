import { defineMessages } from '@baocut/protocol';
import { zhHans } from './tasks-copy.zh-Hans.ts';
import { zhHant } from './tasks-copy.zh-Hant.ts';
import { ja } from './tasks-copy.ja.ts';
import { ko } from './tasks-copy.ko.ts';
import { es } from './tasks-copy.es.ts';
import { fr } from './tasks-copy.fr.ts';
import { de } from './tasks-copy.de.ts';
import { nl } from './tasks-copy.nl.ts';
import { ptBR } from './tasks-copy.pt-BR.ts';
import { it } from './tasks-copy.it.ts';
import { ru } from './tasks-copy.ru.ts';
import { pl } from './tasks-copy.pl.ts';
import { tr } from './tasks-copy.tr.ts';
import { vi } from './tasks-copy.vi.ts';

/** 后台任务详情（含从链接导入）的文案。英文写在这里，译文在 `tasks-copy.zh-Hans.ts`。 */
const en = {
  progress: (title: string, label: string) => `“${title}” ${label}`,
  imageRunning: 'Drawing',
  imageLoading: 'Loading image',
  link: {
    stage: {
      pending: 'Not started',
      current: 'Working',
      done: 'Done',
      failed: 'Something went wrong',
      skipped: 'Not needed',
    },
    action: {
      retry: 'Retry download',
      'change-link': 'Use a different link',
      'use-file': 'Use a local file instead',
      tools: 'Check download tools',
      restart: 'Start the import over',
      downloads: 'Change download location…',
    },
    retryFailed: (message: string) => `Couldn’t retry: ${message}`,
    redownload: 'Download again',
    finish: 'Finish the rest',
    retryImport: 'Retry import',
    hideTools: 'Hide tool check',
    copied: 'Copied',
    copyFailed: 'Couldn’t copy. Select the text and copy it',
    copyError: 'Copy error details',
    queued: 'Queued: starts when the tasks ahead of it finish.',
    probing: 'Checking that the link can be read and the download tools are ready…',
    validating: 'Checking file integrity, audio tracks, and playback info…',
    kept: 'Your link and settings are kept.',
    cancelledNote: 'No video was created. The link is kept in this record.',
    keptNoVideo: 'Your link and settings are kept; no video was created.',
    imported: 'The downloaded video file was imported into a video.',
    inDownloads: 'The video file is in the downloads folder. This run didn’t go on to create a video (the app restarted, or the import started elsewhere).',
    followFailed: 'A later step ran into a problem.',
    creating: 'Creating a video from the downloaded file…',
    transcribing: 'The video is open; subtitles will appear in the editor as they’re ready.',
    translating: 'Subtitles are ready; translating now.',
    ready: 'You can now proofread the transcript, adjust the subtitle style, or export the video.',
    untitled: 'Video link',
    audioOnly: 'Audio only',
    cancelFailed: (message: string) => `Couldn’t cancel: ${message}`,
    adoptFailed: (message: string) => `Couldn’t create the video: ${message}`,
    videoFailed: 'Video wasn’t created',
    subsFailed: 'Transcription needs attention',
    translateFailed: 'Translation needs attention',
    stepCreate: 'Creating video',
    stepSubs: 'Generating subtitles',
    stepTranslate: 'Translating',
    downloaded: 'Download complete',
    stopped: 'Stopped',
    unfinished: 'Didn’t finish',
    savedLead: 'The video file is in the video. You can preview it now; subtitles will appear as they’re ready.',
    pendingLead: 'Download the video file first, then create the video once it plays.',
    steps: 'Import steps',
    stepState: (label: string, state: string) => `${label}: ${state}`,
    skippedMark: ' (not needed)',
    saved: 'Video saved',
    notSaved: 'No video yet',
    openVideo: 'Open video',
    adopt: 'Create a video from the downloaded file',
    later: 'Do something else',
    cancel: 'Cancel import',
    reimport: 'Import again',
    noteBusy: 'If you leave this page, the task stays in Background tasks',
    noteIssue: 'Your link and settings are kept; no video was created',
    noteDone: 'The task record is kept',
    downloadTo: (path: string) => `Download to ${path}`,
    downloadToDefault: 'Download to the downloads folder in Settings',
    tool: (name: string, version: string) => `Video download tool: ${name} · ${version}`,
  },
};

export type TasksMessages = typeof en;

export const TK = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
