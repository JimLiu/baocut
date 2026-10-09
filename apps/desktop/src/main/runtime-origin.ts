import type { OnBeforeSendHeadersListenerDetails } from 'electron';

/**
 * A reused Runtime may have been started without Vite's origin. Only the desktop
 * application's own frame may use the opaque origin already accepted by Runtime.
 */
export function isDesktopRuntimeRequest(
  details: Pick<OnBeforeSendHeadersListenerDetails, 'url' | 'webContentsId' | 'frame'>,
  endpoint: string | null,
  appOrigin: string,
  appContents: ReadonlySet<number>,
): boolean {
  if (!endpoint || details.webContentsId === undefined || !appContents.has(details.webContentsId) || !details.frame) return false;
  try {
    const target = new URL(details.url);
    const runtime = new URL(endpoint);
    return new URL(details.frame.url).origin === appOrigin &&
      runtime.protocol === 'ws:' && runtime.hostname === '127.0.0.1' &&
      (target.protocol === 'ws:' || target.protocol === 'http:') &&
      target.host === runtime.host && !target.username && !target.password;
  } catch {
    return false;
  }
}

export function desktopRuntimeHeaders(headers: Record<string, string>): Record<string, string> {
  const result = { ...headers };
  for (const key of Object.keys(result)) if (key.toLowerCase() === 'origin') result[key] = 'null';
  return result;
}

export function desktopRuntimeResponseHeaders(headers: Record<string, string[]>, appOrigin: string): Record<string, string[]> {
  const result = { ...headers };
  for (const key of Object.keys(result)) {
    if (key.toLowerCase() === 'access-control-allow-origin' && result[key]?.includes('null')) result[key] = [appOrigin];
  }
  return result;
}
