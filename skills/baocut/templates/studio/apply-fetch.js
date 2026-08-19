// BaoCut Subtitle Studio — 写事务的传输层重试（纯函数，无 DOM）。
//
// 与 Mac / GPUI 客户端同款语义：serve 被同根异构建接管、或刚被拉起的瞬间，
// `fetch` 会直接抛 TypeError（连接被拒/重置）——这不是对这笔写的裁决，立刻报
// 「保存失败，改动已回退」会让用户平白丢一步。只重试「fetch 抛异常」：服务端
// 给了任何状态码（含 409 stale / 413 too large）都是最终答复，不在这里重发。
// 重发是安全的：apply 都带 baseRev CAS，若首发其实已落地，重发只会得到 409，
// 不会写两次。
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_APPLY_FETCH = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  // 两次：0.3s、0.9s。
  const RETRY_DELAYS_MS = Object.freeze([300, 900]);

  /**
   * `fetch(url, init)`，网络层抛错时按 `delays` 重试；耗尽后抛出最后一个错误。
   * `deps` 供测试注入：`{ fetch, sleep }`。
   */
  async function fetchApply(url, init, deps) {
    const doFetch = (deps && deps.fetch) || ((u, i) => fetch(u, i));
    const sleep = (deps && deps.sleep) || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const delays = (deps && deps.delays) || RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt++) {
      try {
        return await doFetch(url, init);
      } catch (error) {
        if (attempt >= delays.length) throw error;
        await sleep(delays[attempt]);
      }
    }
  }

  return { RETRY_DELAYS_MS, fetchApply };
});
