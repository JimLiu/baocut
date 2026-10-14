import path from 'node:path';
import type { EmbeddingProvider } from '@baocut/models';
import type { Logger } from '@baocut/harness';
import type { ContentReader } from '../content-index.ts';
import type { HitResolverOptions } from '../search-hit-resolver.ts';
import { SearchService } from '../search-service.ts';
import type { SpaceSearchSource } from '../space-queries.ts';
import { semanticContextFactory, type SemanticContextFactory } from './context.ts';
import { SemanticCoordinator, type SemanticCatalogSource, type SemanticSettings } from './coordinator.ts';
import type { KeyframeSource } from './visual-lane.ts';
import type { PowerState } from './power.ts';
import { EmbeddingScheduler } from './scheduler.ts';
import { SEMANTIC_STORE_DIR, SemanticStore, SemanticStoreTooNew } from './store.ts';
import { InThreadVectorScanner } from './vector-index.ts';

/**
 * Runtime 里的本机语义检索（EmbeddingGemma 2 检索集成方案 v0.1 PR 3–5）：派生库、向量扫描、编码调度、增量构建、检索服务、
 * 结果定位与 SemanticContext，一起建、一起关。Provider 为 null（没装模型）时检索只有字面一路，构建什么都不做。
 */
export interface SemanticServices {
  readonly store: () => SemanticStore | null;
  readonly scheduler: () => EmbeddingScheduler | null;
  readonly coordinator: SemanticCoordinator;
  /** 进程内的向量扫描（`touched` 供测试确认没扫范围外的世代）。 */
  readonly scanner: InThreadVectorScanner;
  readonly search: SearchService;
  readonly resolver: HitResolverOptions;
  /** 按主体取 SemanticContext（写作任务、智能体工具）。 */
  readonly context: SemanticContextFactory;
  close(): Promise<void>;
}

export interface OpenSemanticOptions {
  /** `<home>/cache`：库在 `<cache>/semantic-index/v1/index.db`。 */
  cacheDir: string;
  catalog: SpaceSearchSource & SemanticCatalogSource;
  reader: Pick<ContentReader, 'readContent'> | null;
  provider: EmbeddingProvider | null;
  settings: () => SemanticSettings;
  log: Logger;
  model?: () => { bundleId: string; label: string } | null;
  /** 画面索引取关键帧；不给时不建画面索引。 */
  frames?: KeyframeSource;
  debounceMs?: number;
  /** 查供电与散热（`power.ts`）；不给时不因供电暂停。 */
  power?: () => Promise<PowerState>;
  /**
   * 弱命中阈值（`findRelevantChunks` 低于它的命中标 `weak`）。不给时用 `semantic-thresholds.json` 的 `weakHit`：它是在
   * EmbeddingGemma 2（LiteRT、`model-card-v1`）上量的，别的 Provider（测试的散列向量）分数不在一个刻度上，要自己给。
   */
  weakHit?: number;
}

export function openSemanticServices(options: OpenSemanticOptions): SemanticServices {
  const log = options.log.child('semantic-index');
  let store: SemanticStore | null = null;
  try {
    store = new SemanticStore(path.join(options.cacheDir, SEMANTIC_STORE_DIR));
  } catch (error) {
    // 更新版本写的库不动；打不开时语义检索在这个进程里不可用，字面检索照常。
    log.warn(error instanceof SemanticStoreTooNew ? 'Semantic index was written by a newer version' : "Couldn't open the semantic index", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const scheduler = options.provider ? new EmbeddingScheduler(options.provider) : null;
  const scanner = new InThreadVectorScanner(() => store);
  const coordinator = new SemanticCoordinator({
    store: () => store,
    catalog: options.catalog,
    reader: options.reader,
    scheduler: () => scheduler,
    scanner,
    settings: options.settings,
    log,
    ...(options.frames ? { frames: options.frames } : {}),
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    ...(options.power ? { power: options.power } : {}),
  });
  const search = new SearchService({
    catalog: options.catalog,
    store: () => store,
    scanner,
    scheduler: () => scheduler,
    coordinator,
    settings: options.settings,
    ...(options.model ? { model: options.model } : {}),
  });
  return {
    store: () => store,
    scheduler: () => scheduler,
    coordinator,
    scanner,
    search,
    resolver: { catalog: options.catalog, reader: options.reader },
    context: semanticContextFactory({
      search,
      store: () => store,
      scheduler: () => scheduler,
      reader: options.reader,
      ...(options.weakHit !== undefined ? { weakHit: options.weakHit } : {}),
    }),
    async close() {
      await coordinator.close();
      scanner.invalidate();
      store?.close();
      store = null;
    },
  };
}

/** 没有语义服务时（测试、只读工具）`space.searchV2` 的字面一路仍然可用。 */
export function lexicalOnlySearch(catalog: SpaceSearchSource): SearchService {
  return new SearchService({
    catalog,
    store: () => null,
    scanner: new InThreadVectorScanner(() => null),
    scheduler: () => null,
    coordinator: null,
    settings: () => ({ channels: ['text'], indexedProjects: 'all' }),
  });
}
