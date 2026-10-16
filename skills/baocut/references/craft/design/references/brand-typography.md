<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/design/references/brand-typography.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# Anthropic 品牌字体排印

来源：设计团队 anthropic-design skill 的 `typography.css`（2025-12-11）。这里有意不附带字体**文件**（见 README.md）；先写上指定的 family，再配上如实的 fallback：没装 Anthropic 字体的地方，渲染的是 fallback stack。

## Font stack（在行内样式里原样使用）

- Sans（UI 文字、label、正文）：
  `'Anthropic Sans', system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`
- Serif（display 标题、editorial 语气）：
  `'Anthropic Serif', Georgia, 'Times New Roman', Times, serif`
- Mono（代码）：
  `'Anthropic Mono', 'JetBrains Mono', 'SF Mono', Monaco, 'Courier New', monospace`

Anthropic Sans 与 Serif 都是可变字重 300–800。

## Type scale（出自品牌字体系统）

| 角色 | Family | 字号 | 字重 | 行高 |
|------|--------|------|--------|-------------|
| Display（hero） | Serif | 38px | 330 | 1.2 |
| Title | Serif | 28px | 500 | 1.3 |
| Heading | Serif | 24px | 500 | 1.3 |
| UI XL | Sans | 20px | 400 | 1.4 |
| Body | Sans | 16px | 400 | 1.5 |
| Small/labels | Sans | 14px | 400 | 1.4 |
| Caption | Sans | 12px | 400 | 1.35 |

letter-spacing 保持 0；品牌观感靠暖色配色、宽松的留白、衬线 display 字配无衬线正文来建立，不靠 tracking 花招。标题用 Serif，字重适中（330–500），绝不用伪粗体。需要品牌观感时，不要把被用滥的 AI 默认 family（Inter、Roboto、Arial、Fraunces）当首选；Arial/Helvetica 只出现在 fallback stack 里。
