# 节点协议规范

一台机器把本地模型能力共享给局域网内其他机器时，两端之间的 HTTP 合同，以及本机网关上管理它的 `nodes` 方法。机制、信任模型与取舍见[架构设计](../architecture/architecture-design.md) §6.7、§12.7；输出合同见 [Model Worker 协议规范](model-worker-protocol-spec.md) §7。

**目录**

1. [角色与范围](#1-角色与范围)
2. [传输与请求门](#2-传输与请求门)
3. [健康](#3-健康)
4. [配对与令牌](#4-配对与令牌)
5. [任务](#5-任务)
6. [事件流](#6-事件流)
7. [结果与清理](#7-结果与清理)
8. [错误](#8-错误)
9. [发起端的行为](#9-发起端的行为)
10. [本机网关的 nodes 方法](#10-本机网关的-nodes-方法)
11. [持久状态](#11-持久状态)
12. [发现](#12-发现)
13. [待评审事项](#13-待评审事项)

---

## 1. 角色与范围

- **节点**：开启了共享的 Runtime。它运行「节点服务」，接受能力任务，用自己的 Model Worker 执行。
- **发起端**：另一台机器上的 Runtime。它的远端节点 Provider 把一次转写尝试交给节点，取回结果后自己校验、发布、写入视频。

节点只收到媒体字节与参数，不知道视频、素材或会话。本版只有 `transcribe` 一种任务。`nodeProtocolVersion` 为 `1`。

## 2. 传输与请求门

HTTP/1.1，JSON 用 UTF-8。所有路径以 `/v1` 开头。节点服务监听所有 IPv4 接口上的一个端口（默认 `47610`），与本机网关分开。

每个请求依次过三道门，前一道不过就不看后一道：

1. **来源门**：只看套接字的对端地址，不读任何转发头。默认允许回环、私有网段（`10/8`、`172.16/12`、`192.168/16`）、链路本地（`169.254/16`、`fe80::/10`）、唯一本地（`fc00::/7`）；`::ffff:a.b.c.d` 按其中的 IPv4 判断。`allowAnySource` 打开时跳过这道门。不过：`403 SOURCE_NOT_ALLOWED`。
2. **版本门**：请求头 `X-BaoCut-Node-Protocol: <整数>`。缺失或低于节点的最低版本：`426 PROTOCOL_VERSION_UNSUPPORTED`，`details.required` 给出最低版本。`GET /v1/health` 不过这道门。
3. **令牌门**：`Authorization: Bearer <令牌>`。无效或已吊销：`401 UNAUTHORIZED`。`GET /v1/health` 与 `POST /v1/pair` 不过这道门。

请求体上限：JSON 64 KiB；媒体见 §5.2。

## 3. 健康

`GET /v1/health` → `200`：

```ts
interface NodeHealth {
  schema: 'baocut.node-health/v1';
  nodeId: string;                     // 节点第一次开启共享时生成，之后不变
  name: string;                       // 给人看的名字，默认主机名
  nodeProtocolVersion: number;
  minNodeProtocolVersion: number;
  runtimeVersion: string;
  platform: { os: string; arch: string };
  capabilities: {
    transcribe: {
      enabled: boolean;
      bundles: Array<{ bundleId: string; backend: string; device: string; state: string }>;   // state 同 models.list
      running: number;                // 正在执行的任务数（含本机任务）
      queued: number;
    };
  };
}
```

健康不报告模型以外的本机信息：没有路径、用户名、已配对客户端或任务内容。

## 4. 配对与令牌

配对码是 6 位十进制数字，10 分钟有效，一次性：用掉或过期后由节点的用户重新生成。任意来源累计输错 5 次，配对锁定 10 分钟，当前配对码作废。

`POST /v1/pair`，请求 `{ code: string; clientId: string; clientName: string }`。`clientId` 是发起端 Runtime Home 里持久的随机标识；同一个 `clientId` 再次配对会替换它原来的令牌。

响应 `200`：`{ nodeId: string; name: string; token: string }`。

- 令牌形如 `<clientId>.<secret>`，`secret` 是 32 字节随机数的 base64url。
- 节点只保存每个客户端的盐与 `sha256(salt ‖ secret)`，比较用常量时间。
- 配对码错误或过期：`403 PAIRING_CODE_INVALID`；锁定期间：`429 PAIRING_LOCKED`，`details.retryAfterMs`。没有可用的配对码时同样返回 `PAIRING_CODE_INVALID`。

## 5. 任务

### 5.1 创建

`POST /v1/jobs`：

```ts
interface NodeJobRequest {
  clientJobId: string;                // 幂等键：发起端的 jobId 加尝试序号
  kind: 'transcribe';
  bundleId: string;
  input: {
    contentHash: string;              // 'sha256:<hex>'，媒体文件的内容摘要
    byteLength: number;
    mediaType: string;
    track: number;
    range: { start: number; end: number } | null;   // tick，同 Model Worker 协议
  };
  options: TranscribeOptions;         // Model Worker 协议规范 §5 的 options，原样传给 Worker
}
```

响应 `201`：`NodeJob`（见下）。同一个客户端用相同的 `clientJobId` 再次创建，返回 `200` 与已有的任务，不新建；`clientJobId` 相同但请求内容不同：`409 IDEMPOTENCY_CONFLICT`。

准入检查按顺序：能力开关（`403 CAPABILITY_DISABLED`，`details.capability`）、模型包在节点上已安装且可用（`409 MODEL_NOT_READY`，`details.state`）、该客户端未终结的任务数不超过 9 个（1 个运行加 8 个排队，`429 QUEUE_FULL`）、`byteLength` 不超过 16 GiB（`413 INPUT_TOO_LARGE`）、staging 所在磁盘的可用空间不少于 `byteLength` 加 2 GiB（`507 DISK_LOW`）。

```ts
interface NodeJob {
  jobId: string;
  clientJobId: string;
  state: 'awaiting-input' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  phase: string;                      // 同 jobs 主题的 phase
  progress: { done: number; total: number | null; unit: 'seconds' | 'segments' } | null;
  attempt: number;
  error: { code: string; message: string; details?: unknown } | null;
  output: { sha256: string; byteLength: number } | null;    // completed 时给出；sha256 是小写十六进制
  lastSeq: number;
}
```

### 5.2 上传媒体

`PUT /v1/jobs/{jobId}/input`，`Content-Type: application/octet-stream`，`Content-Length` 必须等于 `byteLength`。节点把请求体流式写进该任务的 staging 目录并同时计算 sha256。

- 摘要与长度都相符：`204`，任务进入 `queued`。
- 不相符：`422 INPUT_HASH_MISMATCH`，任务以同一个错误失败，媒体立即删除。
- 没有 `Content-Length` 或用了 `Transfer-Encoding`：`400 INVALID_REQUEST`，任务仍在 `awaiting-input`。
- 任务不在 `awaiting-input`：`409 INVALID_STATE`。
- 创建后 10 分钟内没有完成上传，任务以 `INPUT_EXPIRED` 失败。

节点上的远端任务与本机任务共用同一个模型包队列，按进入 `queued` 的先后执行，一个模型包同时只运行一个任务；因此一个客户端在一个模型包上同时只有一个任务在运行，其余的排队。

### 5.3 读取与取消

- `GET /v1/jobs/{jobId}` → `200 NodeJob`。
- `POST /v1/jobs/{jobId}/cancel` → `200 NodeJob`。幂等：已终结的任务原样返回。运行中的任务在下一个分段边界停下（Model Worker 协议规范 §5），响应在任务终结后才返回，最长等 15 秒；超时返回当前状态，发起端继续看事件流。
- `DELETE /v1/jobs/{jobId}` → `204`。发起端确认已取回结果或不再需要：未终结的任务先取消，然后节点删除它的媒体、结果与记录。

一个客户端只能看到自己的任务；别人的任务一律 `404 JOB_NOT_FOUND`。

## 6. 事件流

`GET /v1/jobs/{jobId}/events?since=<seq>` → `200`，`Content-Type: application/x-ndjson`。每行一个事件；`since` 省略时从头开始，给出时只发 `seq` 大于它的事件。节点为每个任务保留全部事件，直到任务被删除。

```ts
type NodeJobEvent =
  | { seq: number; type: 'job'; job: NodeJob }            // 状态、阶段或进度变化，带完整的 NodeJob
  | { seq: number; type: 'warning'; warning: { code: string; segmentId?: string; detail?: string } }
  | { seq: number; type: 'language'; tag: string; confidence: number | null }
  | { type: 'heartbeat' };                                // 每 15 秒一条，没有 seq
```

任务终结后的那条 `job` 事件是最后一条，节点随后关闭响应。节点上的 Worker 崩溃后自动重试时，事件里不出现中间的 `interrupted`：下一条 `job` 事件是 `running` 且 `attempt` 加一。事件流不携带转写文本：分段内容只在结果文件里。

## 7. 结果与清理

`GET /v1/jobs/{jobId}/result` → `200`，响应体是 `baocut.asr-result/v1` 文件的原始字节，`ETag: "sha256:<hex>"`，支持单段 `Range`。任务没有完成：`409 INVALID_STATE`；结果已删除：`410 RESULT_EXPIRED`。

节点端的清理规则：

| 时机 | 删除什么 |
| --- | --- |
| 任务终结 | 上传的媒体与 staging 目录 |
| 发起端 `DELETE`，或终结后 10 分钟 | 结果文件、事件与任务记录 |
| 客户端被吊销 | 它的全部任务：未终结的取消，然后同上 |
| 共享关闭、Runtime 停止 | 全部远端任务：未终结的取消，结果与媒体删除 |
| Runtime 启动 | 上次留下的远端任务目录 |

节点不把远端任务的结果放进产物库，也不写进任何视频；日志与任务账本里不出现转写文本。远端任务在节点的 `jobs` 主题里可见，`submitter` 为 `{ kind: 'node', id: <clientId> }`，`videoId`、`assetId`、`assetRevision` 与 `result` 为 null；节点重启后未终结的一律标为 `interrupted`。

## 8. 错误

非 2xx 响应体：`{ error: { code: string; message: string; details?: object } }`。

| 状态 | `code` | 含义 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | 请求体或参数不合规；未知的路径（404）与不支持的方法（405）也用这个码 |
| 401 | `UNAUTHORIZED` | 令牌无效或已吊销 |
| 403 | `SOURCE_NOT_ALLOWED` | 来源地址不在允许范围 |
| 403 | `PAIRING_CODE_INVALID` | 配对码错误、过期或不存在 |
| 403 | `CAPABILITY_DISABLED` | 节点没有开放这项能力 |
| 404 | `JOB_NOT_FOUND` | 任务不存在或不属于这个客户端 |
| 409 | `MODEL_NOT_READY` | 模型包在节点上不可用 |
| 409 | `IDEMPOTENCY_CONFLICT` | 幂等键相同但内容不同 |
| 409 | `INVALID_STATE` | 当前状态不能做这个操作 |
| 410 | `RESULT_EXPIRED` | 结果已删除 |
| 413 | `INPUT_TOO_LARGE` | 媒体超过上限 |
| 422 | `INPUT_HASH_MISMATCH` | 上传内容与声明的摘要或长度不符 |
| 426 | `PROTOCOL_VERSION_UNSUPPORTED` | 协议版本过低 |
| 429 | `PAIRING_LOCKED` | 配对被锁定 |
| 429 | `QUEUE_FULL` | 该客户端的任务数已到上限 |
| 507 | `DISK_LOW` | 节点磁盘空间不足 |

任务自身的失败（`NodeJob.error`）沿用命令与协议规范 §11.3 的模型类错误码，另有 `INPUT_HASH_MISMATCH` 与 `INPUT_EXPIRED`。

## 9. 发起端的行为

**路由**。`models.transcribe` 的 `node` 参数给出节点的 `nodeId` 或别名时，任务交给远端节点 Provider，`providerId` 为 `node:<nodeId>`；不给时用本机。没有自动选择，也没有自动故障转移。用远端节点时不检查本机的模型目录。

**一次尝试**。预检（`GET /v1/health`：可达、版本、`nodeId` 仍是配对时的那台、能力开关、模型包状态）→ 创建（`clientJobId` 为 `<jobId>:<尝试序号>`，`mediaType` 取素材记录里的）→ 上传素材的原始文件 → 跟事件流，把阶段、进度、警告与语言转给 `jobs` 主题 → 取回结果并核对 sha256 与长度 → `DELETE`（尽力）。结果交给 JobManager，与本机结果一样校验、发布、应用（架构设计 §7.3）；结果的 `provenance.runGeneration` 是节点上的尝试序号（节点重试过 Worker 崩溃时为 2），按节点报告的 `NodeJob.attempt` 校验。取回的结果与 `NodeJob.output` 不符按输出不合合同处理（`MODEL_OUTPUT_INVALID`）。

上传的连接断开时先 `GET` 任务：还在 `awaiting-input` 就重新上传，已收到就继续。事件流断开（含 45 秒没有任何数据，心跳也算数据）就带 `since=<最后的 seq>` 重连，退避 0.5 秒起、最长 5 秒；已经见过的 `seq` 不再处理，进度不重复、不倒退。创建之后的其他请求（上传、读取、取回结果）遇到连接问题按同样的退避与期限重试。一个发起端同时只向一个节点交一个任务（每个节点一个队列），远端任务不占本机模型包的队列。

**失败的归一化**。两类都不自动重试：

| 情况 | 任务错误 | `details.reason` |
| --- | --- | --- |
| 预检或请求被节点拒绝 | `REMOTE_NODE_REJECTED` | `unpaired`（401；或健康里的 `nodeId` 与配对时不同，这个地址上已经是另一台节点；或节点已不在本机的配对列表里）、`version`、`capability-disabled`、`model-not-ready`、`queue-full`、`disk-low`、`source-not-allowed`、`input-too-large` |
| 预检或创建时连接不上 | `REMOTE_NODE_LOST` | `unreachable` |
| 创建之后连接断开，带 `since` 重连或重试 60 秒仍失败 | `REMOTE_NODE_LOST` | `stream-lost` |
| 节点报告任务 `interrupted`；重连时任务已不存在（`404 JOB_NOT_FOUND`，节点重启清掉了它）；任务不是发起端取消的却以 `cancelled` 终结（节点关闭共享、吊销或 Runtime 停止） | `REMOTE_NODE_LOST` | `node-restarted` |
| 节点上的任务失败；请求被节点以上面之外的错误码拒绝（例如 `400 INVALID_REQUEST`） | 节点给出的错误码与说明原样 | `details` 是节点的详情加上 `node`（节点的 `nodeId`） |

所有 `REMOTE_NODE_*` 的 `details` 都带 `node`；`capability-disabled` 另带 `capability`，说明里给出打开它的办法。两类都在第一次尝试结束：任务的 `attempt` 保持 1；本机的崩溃重试只用于本机 Worker。

节点上的 Worker 崩溃由节点自己按架构设计 §6.5 重试一次；发起端看到的是同一个远端任务的 `attempt` 加一。

**取消**。发起端发 `cancel` 并等节点确认（发起端最多等 20 秒），然后 `DELETE`。`cancel` 返回终态、`DELETE` 成功或任务已不存在（404）都算确认。节点确认后任务为 `cancelled`。节点不可达时本地任务仍然结束为 `cancelled`，并带一条警告 `remote-cancel-unconfirmed`：本地不再等待，但不声称节点已经停下。

**令牌**。发起端的令牌只出现在 `Authorization` 头里，不进日志、任务记录、事件或错误详情。

## 10. 本机网关的 nodes 方法

这些方法走本机网关（回环加网关令牌），节点服务上没有管理端点。

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| `nodes.share.start` | `{ port?: number; name?: string; allowAnySource?: boolean }` | `ShareStatus`；同时生成一个配对码 |
| `nodes.share.stop` | `{}` | `ShareStatus` |
| `nodes.share.status` | `{}` | `ShareStatus` |
| `nodes.share.pairingCode` | `{}` | `ShareStatus`；作废旧配对码并生成新的，同时解除配对锁定 |
| `nodes.share.revoke` | `{ clientId: string }` | `ShareStatus` |
| `nodes.share.setCapability` | `{ capability: string; enabled: boolean }` | `ShareStatus`；`capability` 必须是节点支持共享的模型能力，否则 `invalid-request` |
| `nodes.discover` | `{ timeoutMs?: number }` | `{ nodes: DiscoveredNode[] }` |
| `nodes.pair` | `{ host: string; port: number; code: string; alias?: string }` | `{ node: PairedNode }` |
| `nodes.list` | `{}` | `{ nodes: PairedNode[] }`；每个节点带一次实时的健康探测（2 秒超时） |
| `nodes.remove` | `{ nodeId: string }` | `{}`；只删本机的记录与令牌 |

```ts
interface ShareStatus {
  enabled: boolean;                   // 用户的开关，持久
  listening: boolean;                 // 节点服务此刻是否在监听
  error: string | null;               // 开着却没有监听的原因（例如端口被占用）
  nodeId: string | null;
  name: string;
  port: number;
  addresses: string[];                // 此刻能连上的地址：监听所有接口时为本机非回环的 IPv4 地址，绑定具体地址时只有它，没在监听时为空
  allowAnySource: boolean;
  capabilities: Record<string, { enabled: boolean }>;   // 每种可共享的模型能力一项；持久
  pairing: { code: string; expiresAt: string } | { lockedUntil: string } | null;
  clients: Array<{ clientId: string; name: string; pairedAt: string; lastSeenAt: string | null }>;
  jobs: { running: number; queued: number };
}

interface DiscoveredNode { name: string; host: string; port: number; nodeId: string | null }

interface PairedNode {
  nodeId: string;
  alias: string;                      // 本机唯一；默认取节点的 name，冲突时加序号
  name: string;
  host: string;
  port: number;
  pairedAt: string;
  health: NodeHealth | null;          // 探测不到时为 null
  problem: 'unreachable' | 'version' | 'unpaired' | null;
}
```

`nodes.pair` 的失败用协议错误 `REMOTE_NODE_REJECTED`（`details.reason` 为 `pairing-code-invalid`、`pairing-locked`、`version`、`source-not-allowed`）或 `REMOTE_NODE_LOST`（`details.reason` 为 `unreachable`）。网关的 `RpcError.code` 是 `conflict`，这两个码放在 `details.code`。配对先读 `/v1/health`（连不上、版本不兼容就不用掉配对码），检查指定的别名可用，再 `POST /v1/pair`；`clientName` 是发起端的主机名。同一个 `nodeId` 再次配对替换原来的记录与令牌，别名保留（除非这次指定了新的）。

`nodes.list` 的探测：先 `GET /v1/health`，连不上、超时或来源地址被拒（403）为 `unreachable`，版本不兼容为 `version`，`nodeId` 与配对时不同为 `unpaired`；然后带令牌读一个不存在的任务（`GET /v1/jobs/job_probe`）：401 为 `unpaired`（令牌已吊销），404 表示令牌有效。节点上没有为此新增端点。两步共用 2 秒的期限。

`nodes.discover` 的 `timeoutMs` 默认 2000、最大 10000，到期即返回；结果里不含这台机器自己的节点。`nodes.remove` 的 `nodeId` 只接受 `nodeId`；CLI 先用 `nodes.list` 把别名换成 `nodeId`。

## 11. 持久状态

| 文件 | 内容 | 权限 |
| --- | --- | --- |
| `<home>/store/node-share.json` | 节点端：开关、`nodeId`、名字、端口、`allowAnySource`、各能力的开关、已配对客户端（盐与哈希，没有令牌明文） | 0600 |
| `<home>/store/nodes.json` | 发起端：`{ formatVersion: 1, clientId, nodes: [{ nodeId, alias, name, host, port, pairedAt }] }`。`clientId` 第一次打开时生成（`c_` 加 16 字节随机数的 base64url），之后不变；写入是临时文件加改名 | 0600 |
| 凭据存储的 `node:<nodeId>` | 发起端：这个节点的令牌（架构设计 §6.8）。开发版本在 `<home>/store/model-credentials.json`，正式版本在系统钥匙串 | 随后端 |
| `<home>/staging/node-jobs/<jobId>/` | 节点端：远端任务的媒体与结果 | 随任务删除 |

**令牌**。`nodes.json` 不放令牌。之前版本写在节点记录里的 `token` 在打开时逐个迁进凭据存储，迁成功的从记录里去掉；迁不进去的留在记录里等下次打开，但不拿来用，这个节点照「读不到令牌」处理。读不到令牌时探测报告 `unpaired`，转写能力报告 `not-paired` 并在说明里带原因；`nodes.pair`、`nodes.remove` 在凭据存储不可用时以 `conflict`（`details.code: CREDENTIAL_UNAVAILABLE`）拒绝。配对先写令牌再写记录，移除先删令牌再删记录。

**能力的分项开关**。节点主人可以对每一种可共享的模型能力分别开关（`nodes.share.setCapability`），状态保存在 `node-share.json` 并随重启恢复。新开启共享时，节点已支持的能力默认全部打开；之后新加入的能力默认关闭，由主人打开。没有开启过共享时，`ShareStatus.capabilities` 报告开启时会得到的默认，开关也可以先设，开启时沿用。有分项开关之前写下的 `node-share.json` 没有能力开关这一项，照常读入：开启过共享的节点按当时的能力（只有 `transcribe`）全部打开，没开启过的按新开启处理。开关立即生效：健康端点随即报告新状态，关闭之后新任务以 `403 CAPABILITY_DISABLED` 拒绝，已经接受的任务照常跑完。开关只针对模型能力，没有「下载」「导出」这类非模型任务。

共享的开关随 Runtime 重启恢复：`enabled` 为真时启动即监听，不自动生成配对码。配对码与锁定只在内存里。

## 12. 发现

节点服务监听时在 mDNS 上登记 `_baocut-node._tcp`，实例名为节点的名字，TXT 记录 `id=<nodeId>`、`v=<nodeProtocolVersion>`。TXT 只用于展示，不构成信任：配对时以 `/v1/health` 与配对结果里的 `nodeId` 为准。

macOS 用系统的 `dns-sd`；其他平台本版不登记也不浏览，`nodes.discover` 返回空列表，用户输入地址与端口配对。浏览用 `dns-sd -B _baocut-node._tcp local`，每个实例 `dns-sd -L` 解析出主机、端口与 TXT，再 `dns-sd -G v4` 取主机的 IPv4 地址（私网地址优先，回环与链路本地最后）。`dns-sd` 不会自己结束：期限到时所有子进程一律结束，已经解析出来的实例照常返回。

## 13. 待评审事项

| 事项 | 需要决定什么 | 当前文档的假设 |
| --- | --- | --- |
| 上传什么 | 上传素材的原始文件，还是发起端先抽出音轨再传 | 原始文件：与本机转写逐位相同的输入；大视频走局域网较慢 |
| 令牌存放 | 发起端的令牌放在哪里 | 已定：与 API key 共用凭据存储（键 `node:<nodeId>`），正式版本进操作系统的安全存储，开发版本是 0600 的文件（架构设计 §6.8，§11） |
| 明文传输 | 是否接受 | 已定：接受，威胁模型同局域网打印机（架构设计 §6.7） |
| 共享路径输入 | 节点可读的共享路径代替上传 | 不做 |
| 其他平台的发现 | Windows、Linux 上的 mDNS | 不做，手动输入地址 |
| 远端下载与远端导出 | 是否把「下载视频」「导出视频」做成节点任务 | 不做：节点只共享模型能力；下载要节点主动访问外网，导出要把视频的冻结输入送到节点，都超出当前边界 |
| IPv6 监听 | 节点服务是否同时监听 IPv6 | 只监听 IPv4；来源门已能判断 IPv6 地址 |
