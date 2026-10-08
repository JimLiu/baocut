import type { AgentPolicy } from '@baocut/protocol';
import { revealLabel } from '../../copy.ts';
import type { AgentMessages } from './agent-copy.ts';



export const vi: AgentMessages = {
  /** 页标题（设计稿 page-settings-agent.jsx 的 h1）。 */
  pageTitle: "Nhà cung cấp Agent",
  /** 页标题下三条事实那一列的无障碍名。 */
  factsLabel: "Cách Agent hoạt động",
  /** 隐私页里「Agent 权限」小标题（page-settings.jsx 的 `setpage__perm`）。 */
  permissionsTitle: "Quyền của Agent",
  lede: "Agent là trợ lý AI lập trình được cài trên máy tính của bạn, như Claude Code hoặc Codex. BaoCut gọi trực tiếp, nên một câu có thể hoàn tất chép lời, dịch và chỉnh sửa.",
  /** 三条事实（page-settings-agent.jsx:12-16）。 */
  facts: [
    { key: "cli", title: "Dùng những gì bạn đã có", body: "BaoCut gọi Agent dòng lệnh trên máy tính này thay vì cài Agent riêng." },
    { key: "plan", title: "Dùng gói đăng ký của bạn", body: "Không trả thêm cho BaoCut và không cần điền khóa API." },
    { key: "ask", title: "Hỏi trước khi thay đổi", body: "Agent dừng và chờ bạn đồng ý trước khi ghi vào video; bạn có thể hoàn tác bất cứ lúc nào." },
  ] as readonly { key: "cli" | "plan" | "ask"; title: string; body: string }[],

  providersHeading: "Agent trên máy tính này",
  providersHint:
    "BaoCut tìm những Agent đã cài. Chỉ cần một Agent hoạt động; không cần tất cả. Nếu chưa biết chọn gì, hãy chọn Claude Code hoặc Codex. Agent tích hợp chỉ có thể tắt; Agent bạn thêm có thể xóa.",
  /** 列表底下那一行：几时检查过、内置几家、添加了几家、检测到几家（page-settings-agent.jsx 的 `agset-meta`）。 */
  providersMeta: (checked: string | null, builtin: number, added: number, found: number) =>
    `${checked ? `Đã kiểm tra ${checked} · ` : ""}BaoCut có ${builtin} Agent tích hợp${added ? `, bạn đã thêm ${added}` : ""}; ${found} được phát hiện trên máy tính này`,
  /** 状态区的无障碍名。 */
  statusLabel: "Trạng thái Agent",
  scanDone: (n: number) => (n ? `Kiểm tra xong · ${n} Agent trên máy tính này` : "Kiểm tra xong · Không tìm thấy Agent đã cài"),
  scanFailed: (message: string) => `Không kiểm tra lại được: ${message}`,
  enableFailed: (message: string) => `Không bật được: ${message}`,
  scanning: "Đang kiểm tra…",
  rescan: "Kiểm tra lại",
  emptyDisconnected: "Kết nối với Runtime để kiểm tra Agent trên máy tính này.",
  emptyNoDrivers: "Phiên bản Runtime này không có Agent.",
  emptyNoneFound: "Không phát hiện Agent trên máy tính này; những Agent phổ biến được liệt kê bên dưới.",
  scanProgress: "Đang kiểm tra Agent",
  faqLabel: "Câu hỏi thường gặp",
  goCloudModels: "Đi đến mô hình đám mây",
  goSkills: "Đi đến Skills",

  /** 「更多」折叠段（page-settings-agent.jsx）：没检测到的四家 ACP 智能体收在这里。 */
  moreProviders: {
    title: (count: number) => `Agent khác được hỗ trợ · ${count}`,
    sub: (names: string) => `${names} · Không phát hiện trên máy tính này`,
    expand: "Hiện",
    collapse: "Ẩn",
  },

  /** 「没有逐次询问的通道」的那几家（data.js 的 `FULL_ONLY`）：`capabilities.approvals` 为 false。 */
  fullAccessOnly:
    "Agent không thể hỏi phê duyệt từng bước, nên BaoCut chỉ có thể chạy trong chế độ Toàn quyền: Agent sẽ không hỏi trước khi chạy lệnh hoặc thay đổi tệp.",

  /** `tested` 为 false 的 Agent：能开会话，但没在 BaoCut 里真机跑通过完整会话。 */
  untested: {
    badge: "Chưa được kiểm thử trong BaoCut",
    body: "Agent này chưa hoàn tất một phiên đầy đủ trong BaoCut trên máy thật. Phát hiện, đăng nhập và danh sách mô hình hoạt động như thường; nếu có lỗi trong phiên, hãy xem tài liệu riêng của nó.",
  },

  /** 添加更多 Agent（settings-agent-catalog.jsx，产品设计 §7.6）。 */
  catalog: {
    heading: "Thêm Agent",
    hint: "Có thể thêm Agent dòng lệnh khác hỗ trợ ACP (Agent Client Protocol). BaoCut chưa kiểm chứng từng Agent; khả năng hoạt động phụ thuộc kết quả kiểm tra.",
    custom: "Lệnh tùy chỉnh…",
    search: "Tìm Agent để thêm",
    searchPlaceholder: "Tìm theo tên, mô tả hoặc lệnh",
    count: (total: number) => `${total} trong danh mục`,
    found: (n: number) => `${n} tìm thấy`,
    list: "Agent có thể thêm",
    add: "Thêm",
    addTo: (name: string) => `Thêm ${name}`,
    added: "Đã thêm",
    empty: (query: string) => `Không có mục nào trong danh mục khớp với “${query}”. Với Agent chưa được liệt kê, hãy nhập lệnh khởi chạy để thêm.`,
    landed: (name: string, custom: boolean) => `Đã thêm ${name}${custom ? " (lệnh tùy chỉnh)" : ""} · Có thể dùng trong phiên sau khi phát hiện`,
    addFailed: (message: string) => `Không thêm được: ${message}`,
    webNote:
      "Không thể thêm hoặc xóa Agent trong trình duyệt vì thao tác này quyết định lệnh chạy trên máy tính này. Hãy dùng ứng dụng BaoCut trên máy tính.",
  },

  /** 自定义命令对话框（settings-agent-catalog.jsx 的 `AgentCustomDialog`）。 */
  customDialog: {
    title: "Thêm Agent bằng lệnh tùy chỉnh",
    lede: "Nhập lệnh khởi động Agent ở chế độ ACP trong terminal. BaoCut khởi động trực tiếp chương trình, không qua terminal.",
    name: "Tên",
    namePlaceholder: "ví dụ: Agent của tôi",
    id: "id",
    idPlaceholder: "my-agent",
    idHint: "Nhận diện Agent này trong cài đặt và chẩn đoán: bắt đầu bằng chữ thường và chỉ dùng chữ thường, chữ số và dấu gạch nối.",
    command: "Lệnh",
    commandPlaceholder: "my-agent --acp",
    commandHint: "Tách chương trình và đối số tại dấu cách; đặt đối số chứa dấu cách trong dấu ngoặc kép.",
    commandParts: (exe: string, args: string[]) => `Sẽ khởi động: chương trình ${exe}, đối số ${args.join(" · ")}`,
    env: "Biến môi trường (tùy chọn)",
    envPlaceholder: "MY_AGENT_TOKEN_FILE=~/.config/my-agent/token\nMY_AGENT_LOG=0",
    envHint: "Mỗi dòng một KEY=VALUE, chỉ thêm khi BaoCut khởi động Agent.",
    note: "Sau khi thêm, BaoCut kiểm tra khả năng khởi động, yêu cầu đăng nhập và mô hình có sẵn. Agent xuất hiện trong phiên sau khi được phát hiện.",
    cancel: "Hủy",
    submit: "Thêm",
    exists: (id: string) => `Một Agent đã dùng “${id}”. Hãy chọn id khác.`,
  },

  /** 用户添加的那一家的卡片（settings-agent-provider.jsx 的 `AddedInstallPanel` 与详情）。 */
  added: {
    chip: "Do bạn thêm",
    detect: "Kiểm tra",
    detecting: "Đang kiểm tra…",
    remove: "Xóa",
    subFound: (version: string | null) => ["Đã phát hiện", version ? `v${version}` : null, "Kết nối qua ACP"].filter(Boolean).join(" · "),
    subLauncher: (launcher: string, needs: string) => `Chưa kiểm tra · ${launcher} tải xuống khi khởi chạy; cần ${needs}`,
    subMissing: (command: string) => `Chưa kiểm tra · ${command} không có trên máy tính này`,
    note: (name: string) =>
      `${name} kết nối qua ACP (Agent Client Protocol). BaoCut chưa kiểm chứng: hãy xem tài liệu riêng để biết cách cài đặt và tài khoản cần đăng nhập.`,
    noInstall: "Không cần cài riêng",
    noInstallBody: (launcher: string, spec: string, needs: string) =>
      `Khi BaoCut khởi động Agent, ${launcher} tải xuống ${spec} tự động. Cần ${needs} trên máy tính này.`,
    install: "Cài trên máy tính này theo hướng dẫn chính thức",
    installBody: (command: string) => `Sau khi cài, ${command} phải chạy được trong terminal.`,
    docs: "Mở hướng dẫn chính thức",
    launch: "BaoCut khởi động Agent bằng lệnh này",
    launchCopy: "lệnh khởi chạy",
    envNote: (keys: string[]) => `Thêm biến môi trường ${keys.join(", ")} khi khởi chạy (giá trị không hiển thị ở đây).`,
    login: "Nếu cần đăng nhập, hãy đăng nhập qua Agent",
    loginBody: "Làm theo hướng dẫn trong terminal. Đăng nhập diễn ra trong cửa sổ riêng; BaoCut không xử lý tài khoản hay mật khẩu của bạn.",
    detectStep: "Kiểm tra",
    detectBody: "BaoCut khởi động Agent một lần để xác nhận kết nối, kiểm tra yêu cầu đăng nhập và lấy danh sách mô hình.",
    launchRow: "Lệnh khởi chạy",
    launchRowHint: "BaoCut khởi động Agent bằng lệnh này qua ACP (Agent Client Protocol).",
    versionPinned: (spec: string) => `Lệnh khởi chạy cố định ${spec}. Để đổi phiên bản, hãy xóa rồi thêm lại bằng lệnh tùy chỉnh.`,
    versionOwn: "Để nâng cấp, hãy làm theo hướng dẫn riêng rồi kiểm tra lại tại đây.",
    account: (name: string, signedOut: boolean) =>
      `${signedOut ? "Chưa đăng nhập hoặc đăng nhập đã hết hạn. " : ""}Đăng nhập và thanh toán đều diễn ra trong ${name}; BaoCut không xử lý tài khoản và không thu thêm phí.`,
    removeTitle: (name: string) => `Xóa ${name} không?`,
    removeBody: (name: string) =>
      `${name} sẽ bị xóa khỏi danh sách Agent của BaoCut cùng trạng thái bật và mô hình mặc định. Nếu phiên mới dùng Agent này mặc định, một Agent khả dụng khác sẽ thay thế. Tác vụ đang dùng Agent này sẽ kết thúc. Chương trình cài trên máy tính không bị ảnh hưởng và bạn có thể thêm lại sau.`,
    removed: (name: string) => `Đã xóa ${name}`,
    removeFailed: (message: string) => `Không xóa được: ${message}`,
  },

  /**
   * 「用 Codex 画图」那一行（settings-agent-provider.jsx:103-119）。设计稿说打开后「图片 Tab、工具页与 bcut image 里多一只
   * 「Codex 画图」」；现在出现它的地方是 `bcut image` 与会话里 Agent 的生图工具，菜单里的名字是 Provider 自己的「Codex」，照实写。
   */
  codexImage: {
    title: "Vẽ bằng Codex",
    body: "Không cần khóa; dùng gói đăng ký Codex của bạn. Mỗi lần một ảnh, bỏ qua kích thước và chất lượng, chậm hơn API 5–10 lần. Khi bật, bcut image và Agent trong phiên đều có thể chọn (tên “Codex”). Không được tự chọn cho bạn; để dùng mặc định, đặt làm mặc định trong Mô hình › Tạo hình ảnh › Mô hình đám mây.",
    checking: "Đang kiểm tra Codex trên máy tính này có thể vẽ không…",
    on: "Bật",
    /** 补在 Provider 给的原因后面的句号（原因已经以句号结尾就不补）。 */
    period: ".",
    probeFailed: "Không kiểm tra được khả năng vẽ của Codex · Nhấp “Kiểm tra lại” để thử lại.",
    outdated: "Codex quá cũ · Nâng cấp Codex CLI rồi bật tùy chọn này",
    signedOut: "Codex chưa đăng nhập · Vẽ dùng tài khoản Codex của bạn; hãy đăng nhập trước khi bật.",
    notInstalled: "Không tìm thấy Codex · Cài Codex CLI và đăng nhập trước khi vẽ.",
    unavailable: (detail: string | null) =>
      detail ? `Hiện Codex không thể vẽ · ${detail}` : "Hiện Codex không thể vẽ · Nhấp “Kiểm tra lại” để thử lại.",
    turnedOn: "Đã bật Vẽ bằng Codex · Codex hiện có trong menu mô hình tạo ảnh",
    turnedOff: "Đã tắt Vẽ bằng Codex",
    toggleFailed: (enabled: boolean, message: string) =>
      enabled ? `Không bật Vẽ bằng Codex được: ${message}` : `Không tắt Vẽ bằng Codex được: ${message}`,
  },

  /** 常见问题（page-settings-agent.jsx:142-157）。`link` 是答案下面那颗按钮。 */
  faq: [
    {
      key: "cost",
      title: "Tôi có cần trả phí hoặc đăng ký BaoCut riêng không?",
      body: "Không. Agent dùng gói Claude hoặc ChatGPT bạn đã có; phí và hạn mức được tính ở đó. BaoCut không có mô hình riêng, không thu thập khóa và không chuyển tiếp qua đám mây. Nếu không có gói này, bạn có thể bỏ qua Agent; phần còn lại của BaoCut vẫn hoạt động bình thường.",
    },
    {
      key: "account",
      title: "BaoCut có thấy tài khoản và mật khẩu của tôi không?",
      body: "Không. Đăng nhập diễn ra trong cửa sổ riêng của Agent. BaoCut chỉ khởi động chương trình trên máy tính của bạn và giao video cho nó. Agent hỏi trước khi thay đổi video; quy tắc nằm trong Cài đặt › Quyền riêng tư và quyền.",
    },
    {
      key: "cloud",
      title: "Agent khác mô hình đám mây thế nào?",
      body: "Agent dùng trợ lý lập trình trên máy tính với gói đăng ký riêng và có thể thực hiện tác vụ nhiều bước. Mô hình đám mây chạy trực tiếp từng công cụ bằng khóa API và tính phí theo mức sử dụng. Hai bên được thiết lập riêng.",
      link: "models",
    },
    {
      key: "terminal",
      title: "Muốn điều khiển BaoCut bằng những Agent này từ terminal?",
      body: "Phiên trong BaoCut không cần thiết lập thêm. Để dùng trong terminal hoặc ứng dụng khác, hãy cài Skill BaoCut cho Agent; xem Cài đặt › Skills.",
      link: "skills",
    },
  ] as readonly { key: string; title: string; body: string; link?: "models" | "skills" }[],

  // ---- Agent 权限（设置 › 隐私与权限；page-settings-agent.jsx:166-185） ----
  permissionsHeading: "Bạn quyết định khi nào Agent hỏi trước",
  policyHeading: "Ít hỏi lặp lại hơn",
  policyHint: "Các quy tắc này tự động cho phép hành động phù hợp; chế độ truy cập cũng ảnh hưởng việc hỏi trước.",
  /**
   * 三条放行策略的文案。设计稿页面渲染的是 page-settings-agent.jsx:20-24 的 `policyCopy`（:158 取它），
   * data.js `agent.policy` 里的 label / desc 不上屏，只提供键与默认值。
   */
  policy: {
    read: { label: "Đọc nội dung video", desc: "Cho phép trợ lý xem bản chép lời và cài đặt video mà không hỏi mỗi lần." },
    bcutro: { label: "Tra cứu video và tiến độ", desc: "Cho phép kiểm tra thông tin và tiến độ. Những lệnh này không thay đổi video." },
    loop: { label: "Phản hồi tác vụ AI đang chạy", desc: "Cho phép nhận tác vụ và gửi câu trả lời, giảm gián đoạn khi làm nhiều bước." },
  } as Record<keyof AgentPolicy, { label: string; desc: string }>,
  accessModes: "Chế độ truy cập",
  firstDefault: "Mặc định lần đầu",
  alwaysAllowed: "Lệnh luôn được phép",
  saveFailed: (message: string) => `Không lưu được: ${message}`,
  ruleRemoved: (rule: string) => `Đã xóa quy tắc ${rule}`,
  ruleRemoveFailed: (message: string) => `Không xóa quy tắc được: ${message}`,
  /** 访问模式那一行的说明：首次默认是哪一档、最近选的是哪一档。 */
  modeHint: (firstDefault: string, last: string | null) =>
    `Chọn chế độ truy cập bên dưới ô nhập của từng phiên. Lần đầu mặc định là “${firstDefault}”; sau đó phiên mới giữ lựa chọn gần nhất của bạn${last ? ` (hiện tại “${last}”)` : ""}.`,

  // ---- 高级（page-settings-agent.jsx:167-183） ----
  advancedHeading: "Nâng cao và khắc phục sự cố",
  advancedHint: "Không cần thay đổi gì ở đây khi kết nối hoạt động.",
  modelAutoUpdate: {
    label: "Tự động cập nhật danh sách mô hình",
    desc: "Khi khởi động và trong lúc chạy, định kỳ cập nhật danh sách mô hình riêng của từng Agent đã bật. Khi tắt, bạn vẫn có thể làm mới thủ công trong chi tiết của từng Agent.",
  },
  executableHint:
    "BaoCut tìm trong PATH và các vị trí cài đặt phổ biến (Homebrew, thư mục toàn cục của npm, ~/.local/bin). Chương trình cài bằng trình quản lý phiên bản (nvm, asdf, mise) đôi khi nằm nơi khác; hãy nhập đường dẫn đầy đủ của tệp thực thi tại đây. Để trống để trở lại tìm tự động.",
  techPanel: "Thông tin kỹ thuật và vị trí",
  techTitle: "Thông tin kỹ thuật của Agent",
  techSubtitle: "Phiên bản, đường dẫn và mô hình khả dụng",
  techEmpty: "Chưa có kết quả kiểm tra.",
  techNotInstalled: "· Chưa cài",
  techNoModels: "Không báo danh sách mô hình",
  /** 复制按钮与「已复制」提示里的那个名词。 */
  pathLabel: "path",
  diagnosticsLabel: "chẩn đoán",
  copyDiagnostics: "Sao chép chẩn đoán",
  locateTitle: "Đặt vị trí Agent thủ công",
  locateSubtitle: "Dùng khi phát hiện tự động không tìm thấy",

  /** 命令块、应用内运行与手动指定位置（agent-command-block.tsx）。 */
  command: {
    copied: (label: string) => `Đã sao chép ${label}`,
    copyFailed: "Không sao chép được. Hãy chọn văn bản và tự sao chép.",
    copy: (label: string) => `Sao chép ${label}`,
    stop: "Dừng",
    run: "Chạy lệnh này",
    output: "Đầu ra lệnh",
    running: "Đang chạy",
    runningText: "Đang chạy…",
    done: "Xong",
    stopped: "Đã dừng. Phần đã chạy không được hoàn tác; bạn có thể chạy lại.",
    failed: (reason: string) => `Không thành công (${reason}). Đầu ra bên trên cho biết lý do; nếu cần mật khẩu, hãy chạy trong terminal.`,
    runInTerminal: "Chạy trong terminal",
    exitCode: (code: number) => `mã thoát ${code}`,
    startFailed: (error: string) => `không khởi động được: ${error}`,
    killed: "tiến trình đã bị chấm dứt",
    confirmInstall: (name: string) => `Chạy lệnh cài đặt cho ${name} không?`,
    confirmUpgrade: (name: string) => `Chạy lệnh nâng cấp cho ${name} không?`,
    confirmRun: "Chạy",
    cancel: "Hủy",
    confirmBefore: "BaoCut sẽ chạy lệnh bên dưới trên máy tính này. Đầu ra xuất hiện dưới lệnh và bạn có thể dừng bất cứ lúc nào.",
    confirmAfter: "Lệnh cần mật khẩu sẽ thất bại ở đây; hãy chạy chúng trong terminal.",
    restored: (name: string) => `${name} đã trở lại tìm tự động`,
    switched: (path: string) => `Hiện dùng ${path}`,
    notFoundAt: (path: string, command: string) => `Không có ${command} chạy được tại ${path}`,
    saveFailed: (message: string) => `Không lưu vị trí được: ${message}`,
    locationLabel: (name: string) => `Vị trí của ${name}`,
    locationPlaceholder: (command: string) => `/full/path/${command}`,
    locationSaved: "Đặt thủ công. Xóa và lưu để trở lại tìm tự động.",
    locationAuto: "Trống = tìm tự động",
    save: "Lưu",
    restoreAuto: "Dùng tìm tự động",
  },

  // ---- Skills（产品设计 §6.9；原型 settings-agent-skills.jsx、settings-agent-skill-detail.jsx） ----
  skills: {
    lede: "Skill là thư mục (SKILL.md và tệp tham khảo tùy chọn) hướng dẫn Agent trong BaoCut làm việc theo cách nhất định. Khi bật, Agent tự dùng Skill khi thấy phù hợp với tác vụ; khi tắt, Skill chỉ được dùng khi bạn chọn từ “+” trong ô nhập. Bật, tắt, thêm hoặc xóa Skill có hiệu lực từ phiên Agent mới tiếp theo.",
    search: "Tìm Skill",
    filter: "Lọc theo nguồn",
    tab: (label: string, count: number) => `${label} ${count}`,
    tabLabel: (label: string, count: number) => `${label}, ${count}`,
    add: "Thêm Skill",
    addFolder: "Thêm từ thư mục cục bộ",
    addGithub: "Nhập từ GitHub",
    loading: "Đang tải Skill…",
    loadFailed: (message: string) => `Không tải Skill được: ${message}`,
    retry: "Thử lại",
    disconnected: "Chưa kết nối với BaoCut Runtime. Skill được liệt kê sau khi kết nối.",
    emptyTitle: "Chưa có Skill",
    emptyBody:
      "Chưa có Skill khả dụng ở đây. Thêm thư mục Skill bạn viết hoặc nhập Skill được chia sẻ trên GitHub. Skill bên thứ ba tắt sau khi nhập; hãy xem nội dung trước khi bật.",
    emptyWeb: "Chưa có Skill khả dụng ở đây. Trong trình duyệt, bạn chỉ có thể xem và bật/tắt; hãy thêm và nhập bằng ứng dụng BaoCut trên máy tính.",
    noMatch: (query: string) => `Không tìm thấy Skill cho “${query}”`,
    noMatchHint: "Thử từ khác hoặc chuyển sang “Tất cả”.",
    noneInTab: (label: string) => `Chưa có Skill ${label}`,
    webNote: "Trong trình duyệt, bạn có thể xem và bật/tắt Skill; hãy thêm, nhập và xóa bằng ứng dụng BaoCut trên máy tính.",
    view: (name: string) => `Xem ${name}`,
    enable: (name: string) => `Bật ${name}`,
    toggledOn: (name: string) => `Đã bật “${name}”: từ phiên mới tiếp theo, Agent tự dùng khi phù hợp`,
    toggledOff: (name: string) => `Đã tắt “${name}”: từ giờ chỉ dùng khi bạn chọn từ “+” trong ô nhập`,
    added: (name: string) => `Đã thêm “${name}”`,
    imported: (name: string) => `Đã nhập “${name}”, mặc định tắt`,
    removed: (name: string) => `Đã xóa “${name}”`,
    diagnosticsTitle: (count: number) => `${count} thư mục không tải được`,
    diagnosticsHint: "Những thư mục này không phải Skill dùng được nên đã bị bỏ qua. Hãy sửa rồi quay lại trang này để tải lại.",
    diagnosticCode: { invalid: "Định dạng không hợp lệ", 'duplicate-id': "Trùng tên", 'builtin-conflict': "Trùng tên với Skill tích hợp" } as Record<string, string>,
    /** 没能加载的那一行：文件夹 · 原因：第一条问题。 */
    diagnosticLine: (dir: string, reason: string, issue: string) => `${dir} · ${reason}: ${issue}`,
    externalTitle: "Dùng BaoCut từ Agent trong terminal hoặc ứng dụng khác",
    externalBody:
      "Skill bên trên dành cho Agent trong BaoCut. Để hướng dẫn Claude Code hoặc Codex trong terminal chép lời, dịch, chỉnh sửa và xuất bằng BaoCut, hãy cài Skill BaoCut cho chúng. Cài một lần nhấp vào vị trí toàn cục của những Agent này, xem nơi đã cài và có cần cập nhật không sẽ có trong phiên bản sau.",
  },

  skillDetail: {
    close: "Đóng",
    stateOn: "Bật: Agent tự dùng khi phù hợp.",
    stateOff: "Tắt: chỉ dùng khi bạn chọn từ “+” trong ô nhập.",
    thirdPartyNote:
      "Skill bên thứ ba đến từ kho mã do người khác chia sẻ: hãy xem nội dung trước khi bật. BaoCut không chạy tệp trong Skill, và Skill không thể mở rộng quyền của Agent.",
    source: "Nguồn",
    location: "Vị trí",
    version: "Phiên bản",
    noVersion: "Chưa chỉ định",
    get reveal() {
      return revealLabel();
    },
    body: "SKILL.md",
    emptyBody: "Ngoài tên và mô tả ở đầu, SKILL.md không có nội dung khác.",
    files: (count: number) => `Tệp (${count})`,
    back: "Quay lại",
    notText: "Không phải tệp văn bản; không hiển thị ở đây",
    tooLarge: "Tệp quá lớn; không hiển thị ở đây",
    loading: "Đang tải…",
    loadFailed: (message: string) => `Không tải được: ${message}`,
    remove: "Xóa",
    removeBuiltin: "Không thể xóa Skill tích hợp, nhưng bạn có thể tắt.",
    removeTitle: (name: string) => `Xóa “${name}” không?`,
    removeBody: (path: string) => `Thao tác này xóa thư mục ${path} và mọi tệp bên trong, không thể hoàn tác. Phiên đang chạy không bị ảnh hưởng.`,
    cancel: "Hủy",
  },

  skillGithub: {
    title: "Nhập từ GitHub",
    label: "URL kho mã",
    placeholder: "owner/repo",
    description: "Bạn cũng có thể dán URL đầy đủ, ví dụ https://github.com/owner/repo/tree/main/skills/name",
    note: "Chỉ tải xuống tệp trong thư mục URL này trỏ đến và không chạy tệp nào. Skill nhập vào thuộc “Bên thứ ba” và mặc định tắt: chỉ dùng khi bạn chọn từ “+” trong ô nhập. Hãy xem nội dung trước khi quyết định bật.",
    submit: "Nhập",
    pending: "Đang tải xuống từ GitHub…",
    cancel: "Hủy",
  },
};
