import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './yt-dlp.zh-Hans.ts';
import { zhHant } from './yt-dlp.zh-Hant.ts';
import { ja } from './yt-dlp.ja.ts';
import { ko } from './yt-dlp.ko.ts';
import { es } from './yt-dlp.es.ts';
import { fr } from './yt-dlp.fr.ts';
import { de } from './yt-dlp.de.ts';
import { nl } from './yt-dlp.nl.ts';
import { ptBR } from './yt-dlp.pt-BR.ts';
import { it } from './yt-dlp.it.ts';
import { ru } from './yt-dlp.ru.ts';
import { pl } from './yt-dlp.pl.ts';
import { tr } from './yt-dlp.tr.ts';
import { vi } from './yt-dlp.vi.ts';

/** `packages/jobs/src/pipelines/yt-dlp.ts` 给人看的文字：错误与补救（`details.remedy`）。 */
const en = {
  toolNotFound: (p: { code: string }) => `Can't find an executable yt-dlp (${p.code})`,
  remedyUnsupported: "The download tool doesn't support this link: use the link to the video page itself (not a playlist, live stream, or search page)",
  remedyLoginRequired: 'Sign in to the site in your browser, then select that browser under “Website sign-in” and download again',
  remedyCookiesUnavailable: "Can't read browser cookies: make sure you're signed in in the browser; if the database is in use, quit the browser completely (including background processes); if keychain access is denied, allow it; Safari needs Full Disk Access; on Windows, yt-dlp can't read cookies that Chrome, Edge, or Brave protect with app-bound encryption, so use Firefox; or try another browser",
  remedyToolUpdateRequired: 'The site failed to parse or the tool is out of date: update yt-dlp, detect it again, and try again',
  remedyUnavailable: 'The video is unavailable (deleted, region-restricted, or no downloadable format)',
  remedyNetworkError: "Can't connect, or the download was interrupted: check the network and try again (downloaded parts resume)",
  remedyDiskFull: 'Not enough disk space for the download folder or Runtime Home: free up space and try again',
  remedyDownloadFailed: 'The download tool reported an error: see details.stderr; you may need to update yt-dlp (baocut external-tools detect)',
  exited: (p: { code: number | null }) => `yt-dlp exited with ${p.code}`,
  cookieLoginRequired: (p: { browser: string }) => `${p.browser}: the site still requires sign-in`,
  cookieUnreadable: (p: { browser: string }) => `${p.browser}: can't read cookies`,
  reasonSeparator: '; ',
  cookieAttemptsFailed: (p: { count: number; reasons: string }) => `Tried cookies from ${p.count} browsers, none worked (${p.reasons})`,
  metadataUnreadable: "Can't read the metadata from the download tool",
  metadataNotObject: "The download tool's metadata isn't an object",
  playlist: 'The link is a playlist; import one video at a time',
  live: "Live streams can't be imported",
};

export type JobsYtDlpMessages = typeof en;

export const JobsYtDlp = defineCatalog('jobsYtDlp', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
