import { defineMessages, type ExternalToolStatus, type JobRecord } from '@baocut/protocol';
import { zhHans } from './link-import-copy.zh-Hans.ts';
import { zhHant } from './link-import-copy.zh-Hant.ts';
import { ja } from './link-import-copy.ja.ts';
import { ko } from './link-import-copy.ko.ts';
import { es } from './link-import-copy.es.ts';
import { fr } from './link-import-copy.fr.ts';
import { de } from './link-import-copy.de.ts';
import { nl } from './link-import-copy.nl.ts';
import { ptBR } from './link-import-copy.pt-BR.ts';
import { it } from './link-import-copy.it.ts';
import { ru } from './link-import-copy.ru.ts';
import { pl } from './link-import-copy.pl.ts';
import { tr } from './link-import-copy.tr.ts';
import { vi } from './link-import-copy.vi.ts';

/** 失败的标题与说明（补救按钮是数据，留在 link-import.ts）。 */
export interface LinkIssueText {
  title: string;
  body: string;
}

/** 句末补一个句号（原话已经有结尾标点时不补）。 */
const endSentence = (text: string): string => (/[.!?。！？]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/** 把几句话接成一段（Runtime 的原话与补救说明），每句补齐句号；空的跳过。 */
const joinSentences = (parts: readonly (string | null | undefined)[]): string =>
  parts
    .filter((p): p is string => !!p?.trim())
    .map(endSentence)
    .join(' ');

/**
 * 从链接导入的文案（model/link-import.ts；英文是键与类型的来源，译文在 `link-import-copy.<语言>.ts`）。
 */
const en = {
  title: (name: string | null) => (name ? `Import from link · ${name}` : 'Import from link'),

  phase: {
    starting: 'Preparing',
    probing: 'Reading the link',
    downloading: 'Downloading video',
    validating: 'Checking the file plays',
    publishing: 'Moving to the downloads folder',
    applying: 'Importing video',
    transcribing: 'Starting transcription',
  } as Partial<Record<JobRecord['phase'], string>>,
  phaseFallback: 'Working',
  downloaded: (bytes: string) => `${bytes} downloaded`,

  stageDownload: 'Download video',
  stageVideo: 'Check media and create video',
  stageSubs: 'Generate subtitles',

  issue: {
    TOOL_NOT_INSTALLED: {
      title: 'Set up once, then just paste',
      body: 'BaoCut needs the video download tool yt-dlp to read this site. Install it, then start this import again.',
    },
    TOOL_CONSENT_REQUIRED: {
      title: 'Your consent is needed to use the download tool',
      body: 'The download tool is already on this computer. BaoCut uses it to download videos from websites only after you agree.',
    },
    TOOL_UNAVAILABLE: {
      title: 'The download tool can’t run',
      body: 'The download tool was found, but it doesn’t run. Reinstall it or choose a copy that works.',
    },
    TOOL_OUTDATED: {
      title: 'The download tool needs an update',
      body: 'This version is too old and may not be able to read this site. Update it, then try again.',
    },
    OFFLINE_STRICT: {
      title: 'Can’t download from links in strict offline mode',
      body: 'In strict offline mode BaoCut doesn’t go online. Download the video in your browser first, then choose the local file.',
    },
    LINK_UNSUPPORTED: {
      title: 'This source isn’t supported yet',
      body: 'The download tool doesn’t recognize this site or page. Use the link to the video page itself (not a playlist, live stream or search page), or use a local file.',
    },
    LINK_LOGIN_REQUIRED: {
      title: 'This video requires signing in',
      body: 'Sign in to the site in your browser first, then go back to Download video, check that browser under “Website sign-in” and download again.',
    },
    LINK_COOKIES_UNAVAILABLE: {
      title: 'Couldn’t read browser cookies',
      body: 'Make sure you’re signed in in the browser. If its database is locked, quit the browser completely (including anything running in the background), and check keychain permissions (for Safari, allow BaoCut under Full Disk Access). On Windows, Chrome, Edge and Brave cookies protected by app-bound encryption can’t be read; check Firefox instead. Or check another browser and download again.',
    },
    LINK_TOOL_UPDATE_REQUIRED: {
      title: 'yt-dlp needs an update',
      body: 'The site has changed how it serves videos. Update yt-dlp the way it was installed, check again, then try again.',
    },
    LINK_UNAVAILABLE: {
      title: 'This video isn’t available',
      body: 'The video may have been removed, be region-locked, or have no downloadable format. Try another link or use a local file.',
    },
    LINK_NETWORK_ERROR: {
      title: 'The connection dropped',
      body: 'Check your network and try again; what’s already downloaded will resume.',
    },
    LINK_DISK_FULL: {
      title: 'Not enough disk space',
      body: 'The disk with the downloads folder is full. Free up some space, then try again.',
    },
    LINK_DOWNLOAD_FAILED: {
      title: 'The download tool reported an error',
      body: 'The site may have changed or be limiting downloads for now. Try again first; if it still fails, check whether the download tool needs an update, or use a local file.',
    },
    LINK_DOWNLOAD_UNREADABLE: {
      title: 'The downloaded file can’t be used',
      body: 'The file is incomplete, has no audio track, or can’t be decoded; the site may have served placeholder content. Download it again, or try another link or a local file.',
    },
    LINK_DESTINATION_UNAVAILABLE: {
      title: 'Can’t write to the downloads folder',
      body: 'Check that the downloads folder exists and is writable; choose another folder, then start the import again.',
    },
    MEDIA_TOOL_UNAVAILABLE: {
      title: 'Can’t check the downloaded file',
      body: 'Checking media needs ffprobe (it comes with ffmpeg), which isn’t on this computer. Install ffmpeg, then try again.',
    },
    LINK_SOURCE_EXPIRED: {
      title: 'The original link is gone',
      body: 'After a restart the Runtime keeps only the redacted link, not the full one. Paste the link to start the import again.',
    },
    INTERRUPTED: {
      title: 'The import was interrupted',
      body: 'The Runtime stopped or restarted before it finished. Trying again picks up from the step where it stopped.',
    },
  } as Readonly<Record<string, LinkIssueText>>,
  issueUnknownTitle: 'The import didn’t finish',
  issueUnknownBody: (message: string | null, remedy: string | null) => joinSentences([message, remedy]) || 'Something went wrong.',

  headingStopped: 'Import stopped',
  headingFailed: 'The import didn’t finish',
  headingRunning: 'Turning this link into an editable video',
  headingDownloaded: 'Video downloaded',
  headingVideoFailed: 'File downloaded, but the video wasn’t created',
  headingCreatingVideo: 'File downloaded, creating the video',
  headingTranscribing: 'Video ready, generating subtitles',
  headingTranscribeFailed: 'Video ready, transcription needs attention',
  headingReady: 'Video ready',
  headingSubsReady: 'Subtitles are ready',

  toolSource: {
    system: 'Installed on the system',
    user: 'Chosen by you',
    managed: 'Downloaded by BaoCut',
    env: 'Set by an environment variable',
  } as Record<NonNullable<ExternalToolStatus['source']>, string>,
  factVersion: (version: string, size: string | null) => (size ? `Version ${version} · about ${size}` : `Version ${version}`),
  factFrom: (host: string) => `Downloaded from ${host}`,
  factLicense: (license: string) => `${license} license`,
  factIsolated: 'Kept in BaoCut’s own folder, run only after its checksum is verified; the system isn’t changed',
  factInstalledWith: (method: string) => `Installed with ${method}`,

  cardChecking: 'Checking the download tool…',
  cardCheckingBody: 'Only looks at the version on this computer; nothing goes online.',
  cardUnknown: 'The download tool isn’t registered',
  cardUnknownBody: 'This Runtime doesn’t know yt-dlp, so importing from links isn’t available for now.',
  cardInstalling: 'Preparing the download tool…',
  cardInstallingBody: 'Download → verify → test run. When it’s done this shows “Ready”.',
  cardUpdating: 'Updating the download tool…',
  cardUpdatingBody: 'Output appears below the command; the version is checked again when it’s done.',
  cardBlockedWhy: 'BaoCut can’t download it for you on this computer.',
  cardMissing: 'The download tool isn’t installed',
  cardMissingBody: (why: string) => `${endSentence(why)} You can install yt-dlp yourself, then click “Check again” or choose its location.`,
  cardInstall: 'Set up once, then just paste',
  cardInstallBody: 'BaoCut needs the video download tool yt-dlp to read video sites. Once you agree, it downloads the tool and remembers your consent, so importing from links won’t ask again.',
  cardInstallAction: 'Agree and install',
  cardOutdatedReason: (reason: string | null, version: string | null, minVersion: string | null) =>
    endSentence(reason ?? `Version ${version ?? 'unknown'} is older than the required ${minVersion ?? ''}`),
  cardOutdated: 'The download tool needs an update',
  cardOutdatedBlocked: (reason: string, why: string) => `${reason} ${why}`,
  cardOutdatedRunnable: 'It wasn’t downloaded by BaoCut; you can update it the way it was installed with the command below.',
  cardOutdatedManual: 'It wasn’t downloaded by BaoCut. Update it in Terminal following the instructions below, then click “Check again”.',
  cardOutdatedUpdate: (reason: string) => `${reason} Update it before you start.`,
  cardUpdateAction: 'Agree and update',
  cardBroken: 'The download tool can’t run',
  cardBrokenBody: (reason: string | null, remedy: string | null) => joinSentences([reason, remedy]) || 'Found it, but it doesn’t run.',
  cardReinstallAction: 'Agree and reinstall',
  cardConsentRevoked: 'You withdrew consent for the download tool',
  cardConsent: 'Your consent is needed to use the download tool',
  cardConsentBody: 'BaoCut uses it to download videos from websites only after you agree. Your consent is kept in the Runtime, so importing from links won’t ask again.',
  cardConsentAction: 'Agree and use',
  cardReady: 'The download tool is ready',
  cardReadyBody: 'When you start, BaoCut checks the link and gets the video info first, then downloads.',
};

export type LinkImportMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
