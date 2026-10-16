import { describe, expect, it } from 'vitest';
import {
  allowedDownloadHost,
  allowedThumbnailHost,
  archiveSearchUrl,
  classifyLicense,
  commonsSearchUrl,
  parseArchiveFile,
  parseArchiveSearch,
  parseCommonsFile,
  parseCommonsSearch,
  parseYoutubeSearch,
  stripTracking,
  usableLicense,
} from './open-media-sources.ts';

const commonsPage = (title: string, info: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  title,
  index: 1,
  imageinfo: [{ descriptionurl: `https://commons.wikimedia.org/wiki/${title}`, ...info }],
  ...extra,
});

describe('licenses', () => {
  it('classifies the common license names and links', () => {
    const cases: Array<[string | null, string | null, string]> = [
      ['CC0', 'https://creativecommons.org/publicdomain/zero/1.0/', 'cc0'],
      ['Public domain', null, 'public-domain'],
      ['CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0', 'cc-by-sa'],
      ['CC BY 2.0', 'https://creativecommons.org/licenses/by/2.0', 'cc-by'],
      ['CC BY-NC 4.0', null, 'cc-by-nc'],
      ['CC BY-NC-SA 3.0', null, 'cc-by-nc-sa'],
      ['CC BY-ND 4.0', null, 'cc-by-nd'],
      [null, 'https://creativecommons.org/licenses/by-nc-nd/4.0/', 'cc-by-nc-nd'],
      [null, null, 'unknown'],
    ];
    for (const [name, url, cls] of cases) expect(classifyLicense(name, url).class, `${name} ${url}`).toBe(cls);
  });

  it('drops no-derivatives and unknown licenses, and non-commercial ones when commercial', () => {
    expect(usableLicense(classifyLicense('CC BY-ND 4.0', null), false)).toBe(false);
    expect(usableLicense(classifyLicense(null, null), false)).toBe(false);
    expect(usableLicense(classifyLicense('CC BY-NC 4.0', null), false)).toBe(true);
    expect(usableLicense(classifyLicense('CC BY-NC 4.0', null), true)).toBe(false);
    expect(usableLicense(classifyLicense('CC BY-SA 4.0', null), true)).toBe(true);
  });
});

describe('hosts', () => {
  it('downloads only from the media file hosts', () => {
    expect(allowedDownloadHost('upload.wikimedia.org')).toBe(true);
    expect(allowedDownloadHost('ia800204.us.archive.org')).toBe(true);
    expect(allowedDownloadHost('evilarchive.org')).toBe(false);
    expect(allowedDownloadHost('i.ytimg.com')).toBe(false);
    expect(allowedThumbnailHost('i.ytimg.com')).toBe(true);
  });

  it('strips tracking parameters', () => {
    expect(stripTracking('https://upload.wikimedia.org/a.jpg?utm_source=x&w=1')).toBe('https://upload.wikimedia.org/a.jpg?w=1');
  });
});

describe('Wikimedia Commons', () => {
  it('builds a file-namespace search with the kind filter', () => {
    const url = new URL(commonsSearchUrl('Seoul night', 'image', 16));
    expect(url.searchParams.get('gsrnamespace')).toBe('6');
    expect(url.searchParams.get('gsrsearch')).toBe('Seoul night filetype:bitmap|drawing');
    expect(url.searchParams.get('gsrlimit')).toBe('16');
  });

  it('parses candidates with license and attribution', () => {
    const body = {
      query: {
        pages: [
          commonsPage('File:Seoul street.webm', {
            url: 'https://upload.wikimedia.org/seoul.webm',
            mime: 'video/webm',
            mediatype: 'VIDEO',
            width: 1920,
            height: 1080,
            duration: 12.345,
            size: 1000,
            thumburl: 'https://upload.wikimedia.org/thumb/seoul.jpg',
            extmetadata: {
              LicenseShortName: { value: 'CC BY-SA 4.0' },
              LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
              Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Kim">Kim</a>' },
              DateTimeOriginal: { value: '2019-05-01' },
            },
          }),
        ],
      },
    };
    const [candidate] = parseCommonsSearch(body, 'video');
    expect(candidate).toMatchObject({
      source: 'commons',
      id: 'File:Seoul street.webm',
      kind: 'video',
      author: 'Kim',
      durationSeconds: 12.345,
      year: 2019,
      downloadWith: 'assets_download',
      license: { class: 'cc-by-sa', shareAlike: true, attribution: true },
    });
    expect(candidate!.attribution).toBe(
      '"Seoul street" by Kim, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0), via Wikimedia Commons (https://commons.wikimedia.org/wiki/File:Seoul street.webm)',
    );
  });

  it('picks a webm derivative when the original is taller than maxHeight', () => {
    const body = {
      query: {
        pages: [
          commonsPage(
            'File:Big.webm',
            {
              url: 'https://upload.wikimedia.org/big.webm',
              mime: 'video/webm',
              mediatype: 'VIDEO',
              width: 3840,
              height: 2160,
              extmetadata: { LicenseShortName: { value: 'CC0' } },
            },
            {
              videoinfo: [
                {
                  derivatives: [
                    {
                      src: 'https://upload.wikimedia.org/big.720p.vp9.webm',
                      type: 'video/webm; codecs="vp9"',
                      height: 720,
                      width: 1280,
                      transcodekey: '720p.vp9.webm',
                    },
                    {
                      src: 'https://upload.wikimedia.org/big.1080p.vp9.webm',
                      type: 'video/webm; codecs="vp9"',
                      height: 1080,
                      width: 1920,
                      transcodekey: '1080p.vp9.webm',
                    },
                    {
                      src: 'https://upload.wikimedia.org/big.1440p.vp9.webm',
                      type: 'video/webm; codecs="vp9"',
                      height: 1440,
                      width: 2560,
                      transcodekey: '1440p.vp9.webm',
                    },
                  ],
                },
              ],
            },
          ),
        ],
      },
    };
    const file = parseCommonsFile(body, { maxHeight: 1080, maxImageWidth: 3840 });
    expect(file).toMatchObject({ url: 'https://upload.wikimedia.org/big.1080p.vp9.webm', extension: 'webm', variant: '1080p.vp9.webm' });
    expect(file.candidate.height).toBe(1080);
  });

  it('reports a missing file', () => {
    expect(() =>
      parseCommonsFile({ query: { pages: [{ title: 'File:Nope.jpg', missing: true }] } }, { maxHeight: 1080, maxImageWidth: 3840 }),
    ).toThrow(expect.objectContaining({ code: 'OPEN_MEDIA_NOT_FOUND' }));
  });
});

describe('Internet Archive', () => {
  it('restricts the search to the curated collections', () => {
    const q = new URL(archiveSearchUrl('rocket', 'video', 8)).searchParams.get('q');
    expect(q).toBe('(rocket) AND mediatype:(movies) AND collection:(prelinger OR nasa OR fedflix)');
  });

  it('treats items without a license URL as public domain', () => {
    const [candidate] = parseArchiveSearch(
      { response: { docs: [{ identifier: 'Duck_and_Cover_1951', title: 'Duck and Cover', year: '1951' }] } },
      'video',
    );
    expect(candidate).toMatchObject({ id: 'Duck_and_Cover_1951', license: { class: 'public-domain' }, year: 1951 });
    expect(candidate!.attribution).toBe(
      '"Duck and Cover", public domain, via Internet Archive (https://archive.org/details/Duck_and_Cover_1951)',
    );
  });

  it('refuses items outside the curated collections', () => {
    const body = {
      metadata: { identifier: 'some-upload', collection: ['opensource_movies'] },
      files: [{ name: 'a.mp4', format: 'h.264' }],
    };
    expect(() => parseArchiveFile(body, 'video', undefined, { maxHeight: 1080 })).toThrow(
      expect.objectContaining({ code: 'OPEN_MEDIA_LICENSE_UNVERIFIED' }),
    );
  });

  it('prefers the H.264 derivative within maxHeight', () => {
    const body = {
      metadata: { identifier: 'film', title: 'Film', collection: ['prelinger'] },
      files: [
        { name: 'film.mpeg', format: 'MPEG2', size: '900' },
        { name: 'film_512kb.mp4', format: '512Kb MPEG4', size: '100', height: '240' },
        { name: 'film.mp4', format: 'h.264', size: '300', height: '480' },
      ],
    };
    const file = parseArchiveFile(body, 'video', undefined, { maxHeight: 1080 });
    expect(file).toMatchObject({ url: 'https://archive.org/download/film/film.mp4', byteLength: 300 });
  });
});

describe('YouTube', () => {
  const body = {
    entries: [
      {
        id: 'ySy2MkAjC6c',
        title: 'Seoul Street at Night',
        duration: 7,
        channel: 'Free Stock Footage',
        thumbnails: [
          { url: 'https://i.ytimg.com/vi/ySy2MkAjC6c/hq720.jpg?a=2', width: 720 },
          { url: 'https://i.ytimg.com/vi/ySy2MkAjC6c/hq720.jpg?a=1', width: 360 },
        ],
      },
      { id: 'live0000001', title: 'Live now', live_status: 'is_live' },
      { title: 'no id' },
    ],
  };

  it('lists results with an unstated license and the download tool', () => {
    const candidates = parseYoutubeSearch(body, false);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      source: 'youtube',
      id: 'ySy2MkAjC6c',
      kind: 'video',
      durationSeconds: 7,
      author: 'Free Stock Footage',
      pageUrl: 'https://www.youtube.com/watch?v=ySy2MkAjC6c',
      thumbnailUrl: 'https://i.ytimg.com/vi/ySy2MkAjC6c/hq720.jpg?a=1',
      downloadWith: 'download',
      license: { class: 'unknown' },
    });
    expect(candidates[0]!.attribution).toBe(
      '"Seoul Street at Night" by Free Stock Footage, via YouTube (https://www.youtube.com/watch?v=ySy2MkAjC6c)',
    );
  });

  it('marks Creative Commons results as CC BY 3.0', () => {
    expect(parseYoutubeSearch(body, true)[0]!.license).toMatchObject({ name: 'CC BY 3.0', class: 'cc-by', attribution: true });
  });
});
