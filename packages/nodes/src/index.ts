export { NodeService, lanAddresses, type NodeServiceOptions } from './node-service.ts';
export {
  NodeJobs,
  NodeHttpError,
  DEFAULT_NODE_LIMITS,
  isNodeJobTerminal,
  type NodeJobRunner,
  type NodeJobsOptions,
  type NodeLimits,
  type NodeModels,
} from './node-jobs.ts';
export { createNodeRequestHandler, parseRange, type NodeApiDeps } from './node-server.ts';
export {
  Pairing,
  DEFAULT_PAIRING_LIMITS,
  systemClock,
  type Clock,
  type PairedClient,
  type PairingLimits,
  type PairOutcome,
  type PairingState,
} from './pairing.ts';
export { ShareStore, loadShareFile, type ShareFile } from './share-store.ts';
export { sourceAllowed } from './source-gate.ts';
export { DnsSdAdvertiser, defaultAdvertiser, noopAdvertiser, type AdvertiseInfo, type Advertiser } from './advertiser.ts';
export { silentNodeLog, type NodeLogger } from './node-logger.ts';

// ---- 发起端（规范 §9–§12） ----
export { NodeInitiator, type NodeInitiatorOptions } from './client/node-initiator.ts';
export { NodeStore, CLIENT_ID_PATTERN, type PairedNodeRecord } from './client/node-store.ts';
export { NodeProviderSource, type NodeSourceInitiator } from './client/node-source.ts';
export {
  RemoteNodeProvider,
  DEFAULT_REMOTE_TIMING,
  type RemoteTiming,
  type RemoteNodeProviderOptions,
  type PairedNodes,
} from './client/remote-provider.ts';
export {
  NodeClient,
  NodeConnectionError,
  NodeResponseError,
  NodeRequestAborted,
  rejectReason,
  versionCompatible,
} from './client/node-http.ts';
export {
  DnsSdDiscoverer,
  defaultDiscoverer,
  noDiscoverer,
  parseAddressOutput,
  parseBrowseLine,
  parseLookupOutput,
  pickAddress,
  type Discoverer,
} from './client/discovery.ts';
