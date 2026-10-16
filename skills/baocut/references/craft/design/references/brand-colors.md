<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/design/references/brand-colors.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# Anthropic 品牌色系统

来源：设计团队 anthropic-design skill 的 `colors.css`（2025-12-11）。在 .dc.html 画板里把这些值用作行内样式的取值。

## 主色（基础：大多数 surface 只用这两种）

| 名称  | Hex       | 用途 |
|-------|-----------|-----|
| Ivory | `#FAF9F5` | 页面／画板背景。整页背景绝不用纯 #FFF。 |
| Slate | `#141413` | 文字、深色 surface。 |

内容 surface（卡片、面板）用 `#FFFFFF`，叠在 Ivory 上。带 tint 的 hover／selected surface：`rgba(115,114,108,0.1)`。边框由低不透明度的 Slate 派生：默认 `0.5px solid rgba(31,30,29,0.15)`，更强一档用 `rgba(31,30,29,0.3)`；绝不用彩色边框来划分结构。

## Claude 色系

| Token | Hex | |
|-------|-----|---|
| Claude primary（Clay，Spark 的颜色） | `#D97757` | accent；Claude surface 上唯一的强调色 |
| Claude background（Ivory） | `#FAF9F5` | |
| Claude text（Slate） | `#141413` | |
| Claude accent（Oat） | `#E3DACC` | 淡色填充、分隔线 |
| Main accent（Blue） | `#2A78D6` | 非 Claude 操作的主 accent |

## 辅助色（多彩：用于插画与构图，不用于 UI chrome）

强：Fig `#C46686` · Sky `#6A9BCC` · Olive `#788C5D` · Clay `#D97757`
柔：Coral `#EBCECE` · Heather `#CBCADB` · Cactus `#BCD1CA` · Oat `#E3DACC`

## 暖灰阶（21 级，黑 → 白）

`#000000` 1000 · `#141413` 950 (Slate) · `#1A1918` 900 · `#1F1E1D` 850 ·
`#262624` 800 · `#30302E` 750 · `#3D3D3A` 700 · `#4D4C48` 650 ·
`#5E5D59` 600 · `#73726C` 550 · `#87867F` 500 · `#9C9A92` 450 ·
`#B0AEA5` 400 · `#C2C0B6` 350 · `#D1CFC5` 300 · `#DEDCD1` 250 ·
`#E8E6DC` 200 · `#F0EEE6` 150 · `#F5F4ED` 100 · `#FAF9F5` 050 (Ivory) ·
`#FFFFFF` 000

这些是**暖**灰：绝不换成冷灰或中性灰的 ramp。

## 第三级 scale（营销／幻灯片／数据可视化，**不**用于产品界面）

橙、黄、绿、青、蓝、紫、品红、红都有九级 scale；各自的锚点 500：橙 `#D97757`、黄 `#C9A82D`、绿 `#558A42`、青 `#2E9191`、蓝 `#6A9BCC`、紫 `#6B4D9E`、品红 `#A64D87`。只在图表和插画的 accent 上才用它们；看起来像产品的 UI 留在主色 + 灰阶体系里。
