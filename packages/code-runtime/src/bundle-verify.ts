import {
  type CodeBundleCheck,
  type CodeBundleCheckId,
  type CodeBundleContract,
  type CodeBundleVerificationReport,
  type VerifiedCapabilities,
} from '@baocut/protocol';
import { CodeBundleError, type InspectedBundle } from './bundle-inspect.ts';
import { CompositionHost, frameTicketAt, intrinsicMismatches, type CompositionSession, type RenderedFrame } from './composition-host.ts';

/**
 * 代码包规范 §6.2 的验证（第一期子集）：在离屏宿主里打开包，按采样时刻取帧，产出 `CodeBundleVerificationReport`。
 *
 * - `manifest` / `files` / `content-hash` / `network-static`：`inspectBundle` 已经检查过（静态扫描在非严格模式下仍可能留有引用）。
 * - `timeline` / `root`：打开会话时合同就绪；尺寸、帧率与清单不一致也记在 `root` 上（`COMPOSITION_INTRINSIC_MISMATCH`）。
 * - `seek`：0、中间帧、末帧与越过末尾一帧；越界的那一帧必须被夹到时长上。
 * - `determinism`：中间帧在乱序取过其他帧之后再取一次，PNG 摘要一致。第一帧与中间帧相同只记说明，不判失败。
 * - `alpha`：声明透明时，全部采样帧都没有透明像素才判失败。
 * - `network-runtime`：会话期间有被拦截的请求即失败。
 * - `duration`：页面时长与清单相差不超过一帧。
 */

export interface VerifyBundleOptions {
  /** 覆盖常规采样时刻（秒）；越过末尾一帧的采样总会追加。 */
  sampleSeconds?: number[];
  /** 声明透明时检查透明像素（默认 true）。 */
  checkAlpha?: boolean;
}

const ORDER: CodeBundleCheckId[] = [
  'manifest',
  'files',
  'content-hash',
  'network-static',
  'timeline',
  'root',
  'duration',
  'seek',
  'determinism',
  'alpha',
  'network-runtime',
];

export async function verifyBundle(
  host: CompositionHost,
  bundle: InspectedBundle,
  options: VerifyBundleOptions = {},
): Promise<CodeBundleVerificationReport> {
  const { manifest } = bundle;
  const checks = new Map<CodeBundleCheckId, CodeBundleCheck>();
  const set = (check: CodeBundleCheck) => checks.set(check.id, check);
  const sampledFrames: Array<{ seconds: number; sha256: string }> = [];

  set({ id: 'manifest', status: 'passed', ...(bundle.synthesized ? { detail: 'synthesized from the entry root attributes' } : {}) });
  set({ id: 'files', status: 'passed', detail: `${bundle.entries.length} files, ${bundle.totalBytes} bytes` });
  set({ id: 'content-hash', status: 'passed' });
  set(
    bundle.networkReferences.length === 0
      ? { id: 'network-static', status: 'passed' }
      : {
          id: 'network-static',
          status: 'failed',
          code: 'BUNDLE_NETWORK_REFERENCE',
          detail: bundle.networkReferences.map((r) => `${r.path}:${r.line} ${r.text}`).join('\n'),
        },
  );

  const fps = manifest.intrinsic.fps;
  const frameSeconds = fps.den / fps.num;
  const durationSeconds = manifest.intrinsic.durationFrames * frameSeconds;
  let capabilities: VerifiedCapabilities | null = null;

  let session: CompositionSession | null = null;
  try {
    session = await host.open(bundle, { strictIntrinsic: false });
  } catch (error) {
    if (!(error instanceof CodeBundleError) || error.code === 'COMPOSITION_HOST_UNAVAILABLE') throw error;
    if (error.code === 'COMPOSITION_ROOT_MISSING') {
      set({ id: 'timeline', status: 'passed' });
      set({ id: 'root', status: 'failed', code: error.code, detail: error.message });
    } else {
      set({ id: 'timeline', status: 'failed', code: error.code, detail: error.message });
    }
  }

  if (session) {
    try {
      set({ id: 'timeline', status: 'passed' });
      const mismatches = intrinsicMismatches(bundle, session.page);
      const sizeMismatch = mismatches.filter((m) => m.field !== 'duration');
      set(
        sizeMismatch.length === 0
          ? { id: 'root', status: 'passed' }
          : { id: 'root', status: 'failed', code: 'COMPOSITION_INTRINSIC_MISMATCH', detail: JSON.stringify(sizeMismatch) },
      );
      const durationMismatch = mismatches.find((m) => m.field === 'duration');
      set(
        durationMismatch
          ? {
              id: 'duration',
              status: 'failed',
              code: 'COMPOSITION_INTRINSIC_MISMATCH',
              detail: `page ${String(durationMismatch.page)} s, manifest ${String(durationMismatch.manifest)} s`,
            }
          : { id: 'duration', status: 'passed' },
      );

      const midFrame = Math.floor(manifest.intrinsic.durationFrames / 2);
      const lastFrame = Math.max(0, manifest.intrinsic.durationFrames - 1);
      const regular = options.sampleSeconds ?? [0, midFrame * frameSeconds, lastFrame * frameSeconds];
      const pastEnd = durationSeconds + frameSeconds;
      const frames: Array<{ seconds: number; frame: RenderedFrame }> = [];
      const render = async (seconds: number) => {
        const frame = await session!.frame(frameTicketAt(bundle, { seconds }, { quality: 'export-exact' }));
        sampledFrames.push({ seconds, sha256: frame.receipt.sha256 });
        frames.push({ seconds, frame });
        return frame;
      };

      // seek：常规采样与越界一帧。
      let seekOk = true;
      try {
        for (const seconds of regular) await render(seconds);
        const beyond = await render(pastEnd);
        if (!beyond.receipt.clampedToDuration) {
          seekOk = false;
          set({
            id: 'seek',
            status: 'failed',
            code: 'COMPOSITION_SEEK_MISMATCH',
            detail: `request at ${pastEnd} s was not clamped to the duration`,
          });
        } else {
          set({ id: 'seek', status: 'passed' });
        }
      } catch (error) {
        if (!(error instanceof CodeBundleError) || error.code === 'COMPOSITION_HOST_UNAVAILABLE') throw error;
        seekOk = false;
        set({ id: 'seek', status: 'failed', code: error.code, detail: error.message });
      }

      // determinism：中间时刻在取过其他帧之后再取一次。
      const midSeconds = regular.length > 1 ? regular[Math.floor(regular.length / 2)]! : (regular[0] ?? 0);
      const first = frames.find((f) => f.seconds === midSeconds);
      if (!seekOk || !first) {
        set({ id: 'determinism', status: 'skipped', detail: 'seek failed' });
      } else {
        try {
          const again = await render(midSeconds);
          const start = frames.find((f) => f.seconds === regular[0]);
          const staticNote =
            start && start.seconds !== midSeconds && start.frame.receipt.sha256 === first.frame.receipt.sha256
              ? `frames at ${start.seconds} s and ${midSeconds} s are identical; the animation may be static`
              : undefined;
          set(
            again.receipt.sha256 === first.frame.receipt.sha256
              ? { id: 'determinism', status: 'passed', ...(staticNote ? { detail: staticNote } : {}) }
              : {
                  id: 'determinism',
                  status: 'failed',
                  code: 'COMPOSITION_NONDETERMINISTIC',
                  detail: `two renders at ${midSeconds} s differ (${first.frame.receipt.sha256} vs ${again.receipt.sha256})`,
                },
          );
        } catch (error) {
          if (!(error instanceof CodeBundleError) || error.code === 'COMPOSITION_HOST_UNAVAILABLE') throw error;
          set({ id: 'determinism', status: 'failed', code: error.code, detail: error.message });
        }
      }

      // alpha：声明透明时，至少一帧有透明像素。
      const measuredAlpha = frames.some((f) => f.frame.transparentPixels > 0 || f.frame.translucentPixels > 0);
      if (!manifest.output.alpha || options.checkAlpha === false) {
        set({ id: 'alpha', status: 'skipped', detail: manifest.output.alpha ? 'disabled' : 'the bundle declares an opaque output' });
      } else if (frames.length === 0) {
        set({ id: 'alpha', status: 'skipped', detail: 'no frame was rendered' });
      } else {
        set(
          measuredAlpha
            ? { id: 'alpha', status: 'passed' }
            : { id: 'alpha', status: 'failed', detail: 'the bundle declares alpha but every sampled frame is fully opaque' },
        );
      }

      const blocked = session.blockedRequests;
      set(
        blocked.length === 0
          ? { id: 'network-runtime', status: 'passed' }
          : { id: 'network-runtime', status: 'failed', code: 'COMPOSITION_NETWORK_BLOCKED', detail: blocked.join('\n') },
      );

      const determinism = checks.get('determinism');
      capabilities = {
        // inspectBundle 已经保证是浏览器引擎与已知合同。
        contract: (manifest.runtime as { contract: string }).contract as CodeBundleContract,
        randomAccess: determinism?.status === 'passed',
        alpha: manifest.output.alpha && measuredAlpha,
        audio: 'none',
        width: manifest.intrinsic.width,
        height: manifest.intrinsic.height,
        fps: manifest.intrinsic.fps,
        durationFrames: manifest.intrinsic.durationFrames,
        host: 'electron-offscreen',
        networkIsolated: true,
      };
    } finally {
      await session.dispose().catch(() => {});
    }
  }

  const ordered = ORDER.map((id) => checks.get(id) ?? { id, status: 'skipped' as const, detail: 'not reached' });
  return {
    format: 'baocut.code-bundle-verification',
    schemaVersion: 1,
    bundleId: manifest.bundleId,
    revision: manifest.revision,
    contentHash: manifest.contentHash,
    verifiedAt: new Date().toISOString(),
    status: ordered.every((c) => c.status !== 'failed') ? 'passed' : 'failed',
    capabilities,
    checks: ordered,
    sampledFrames,
  };
}
