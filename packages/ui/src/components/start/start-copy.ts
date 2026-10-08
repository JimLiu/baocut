import { defineMessages } from '@baocut/protocol';
import { zhHans } from './start-copy.zh-Hans.ts';
import { zhHant } from './start-copy.zh-Hant.ts';
import { ja } from './start-copy.ja.ts';
import { ko } from './start-copy.ko.ts';
import { es } from './start-copy.es.ts';
import { fr } from './start-copy.fr.ts';
import { de } from './start-copy.de.ts';
import { nl } from './start-copy.nl.ts';
import { ptBR } from './start-copy.pt-BR.ts';
import { it } from './start-copy.it.ts';
import { ru } from './start-copy.ru.ts';
import { pl } from './start-copy.pl.ts';
import { tr } from './start-copy.tr.ts';
import { vi } from './start-copy.vi.ts';

/** 起始页流程（链接来源、下载工具卡、建视频的跟进、模板库）的文案。英文写在这里，译文在 `start-copy.zh-Hans.ts`。 */
const en = {
  downloader: {
    consentFailed: (message: string) => `Couldn’t record your consent: ${message}`,
    installFailed: (message: string) => `Couldn’t start installing: ${message}`,
    pickTitle: 'Choose yt-dlp',
    pickButton: 'Use this',
    pickFailed: (message: string) => `This file can’t be used: ${message}`,
    manualUpdate: 'BaoCut can’t update this copy of yt-dlp right now. Run the command on the card in a terminal',
    commandChanged: 'The update command has changed. Check the new command before running it',
    updateFailed: (message: string) => `Couldn’t start the update: ${message}`,
    stopFailed: (message: string) => `Couldn’t stop the update: ${message}`,
    dirFailed: (message: string) => `Couldn’t change the download location: ${message}`,
    notInstalled: (message: string) => `The download tool wasn’t installed: ${message}`,
    installFailedFallback: 'Installation failed',
    badge: {
      checking: 'Checking',
      unknown: 'Unavailable',
      installing: 'Preparing',
      updating: 'Updating',
      install: 'Not installed',
      update: 'Update needed',
      broken: 'Can’t run',
      blocked: 'Needs attention',
      consent: 'Waiting for you',
      ready: 'Ready',
    },
    card: 'Video download tool',
    checkFailed: (message: string) => `Couldn’t check the download tool: ${message}`,
    preparing: 'Preparing the download tool',
    recheck: 'Check again',
    pick: 'Choose location…',
    pickUnavailable: 'Choose location (can’t pick files here)',
  },
  update: {
    stop: 'Stop update',
    run: 'Run this command',
    copy: 'Copy command',
    command: 'command',
    updating: 'Updating yt-dlp',
    output: 'Update output',
    hideOutput: 'Hide output',
    showOutput: 'Show output',
    close: 'Close',
    section: 'Update yt-dlp',
  },
  link: {
    field: 'Video link',
    placeholder: 'Paste a video page or direct link, like https://…',
    plan: 'After you start, the link is checked, video info is fetched, and it’s downloaded',
    waiting: 'Waiting to download',
    invalid: 'Enter a full http:// or https:// video address.',
    hint: 'Paste a single public video link or direct media link.',
    downloadTo: (dir: string) => `Download to ${dir}`,
    change: 'Change…',
  },
  flow: {
    /** 原因的标题与正文接成一句。 */
    reason: (parts: readonly string[]) => parts.join(': '),
    undo: 'Undo',
    openVideo: 'Open video',
    viewTask: 'View task',
    createFailed: (message: string) => `Couldn’t create the video: ${message}`,
    importFailed: (message: string) => `The video was created, but the media wasn’t imported: ${message}`,
    waveFailed: (message: string) => `The waveform wasn’t added: ${message}. You can add it again from the Elements panel in the editor.`,
    blankCreated: 'Blank video created',
    a2vCreated: (wave: boolean) => `Video created · ${wave ? 'Background and waveform' : 'Background'} added`,
    created: 'Video created',
    notSubmitted: 'Transcription wasn’t submitted',
    transcribeNotStarted: (why: string) => `Video created, but transcription didn’t start: ${why}`,
    chainQueued: (title: string) => `Video created · “${title}” starts automatically after transcription`,
    a2vTranscribing: (wave: boolean) => `Video created · ${wave ? 'Waveform added · ' : ''}Transcribing subtitles`,
    transcribing: 'Video created · Transcription started in the background',
    noDownload: 'The import finished, but the downloaded file wasn’t found',
    transcribeUnfinished: 'Transcription didn’t finish',
    noSpeech: 'No speech was recognized, so there’s nothing to translate',
    noSpeechToast: (name: string) => `No speech was recognized in “${name}”, so translation didn’t start`,
    video: 'Video',
    translateNotPlaced: (name: string, why: string) =>
      `The translation of “${name}” wasn’t added to the video: ${why}. Open the video and continue in the Subtitles panel.`,
    translateCancelled: 'Translation cancelled',
    translateBusy: 'Another translation is still running',
    translateFailed: (message: string) => `Couldn’t start translating: ${message}`,
    openAndTranslate: 'Open video and translate',
    notOpened: 'The video didn’t open, so translation didn’t start',
    noFile: 'The downloaded file wasn’t found',
    noProject: 'This import doesn’t belong to a project',
    createFailedShort: 'Couldn’t create the video',
  },
  templates: {
    skipped: (dir: string, message: string) => `${dir}: ${message}`,
    issues: (issues: readonly string[]) => ` (${issues.join('; ')})`,
  },
};

export type StartMessages = typeof en;

export const ST = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
