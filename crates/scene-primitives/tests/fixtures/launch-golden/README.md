# launch-golden：BCF 编译/解析 golden

BaoCut 发布短片（`launch`）的 BCF 编写层源文件与参考产物。本目录是 golden
测试的唯一输入，全新 checkout 上必然存在，测试一律硬读、不再跳过。

| 文件 | 作用 |
| --- | --- |
| `launch.bcut.tsx` | 编写层源文件（编译输入）。 |
| `bcf.tsx` | `launch.bcut.tsx` 的相对导入目标，**冻结副本**。 |
| `launch.bcut.json` | 参考产物（golden），`bcut compile` 必须与之深度相等。 |

## 来源

来自已归档的 `prototype/` 表面，归档基线提交 `a8c049a3`：

- `launch.bcut.tsx` ← `prototype/react-authoring/src/launch.bcut.tsx`
- `bcf.tsx` ← `prototype/react-authoring/src/bcf.tsx`
- `launch.bcut.json` ← `prototype/out/launch.bcut.json`（React/esbuild 工具链产物，
  原先被 gitignore，本次提升为跟踪的 fixture）

取回原始表面：

```bash
git show a8c049a3:prototype/react-authoring/src/launch.bcut.tsx
git checkout a8c049a3 -- prototype/
```

## 纪律

- `bcf.tsx` 是**冻结**副本，只为让历史 golden 可重现；它**不参与**
  `core/runtime/dsl/bcf.tsx` 与动画模板 `preview/vendor/dsl.tsx` 的同步纪律，
  不要为了跟上 DSL 演进去改它。当前 `core/runtime/dsl/bcf.tsx` 是它的严格超集。
- `launch.bcut.json` 只在编译语义有意变化时更新，更新方式：
  `bcut compile core/fixtures/launch-golden/launch.bcut.tsx -o core/fixtures/launch-golden/launch.bcut.json`
- 原型的 `launch.mp4` 与关键帧 PNG **未入库**（体积原因，且原本就被 gitignore，
  无法从 git 取回）。SSIM 对比只能在本机另行生成参考视频后按需开启，
  见 `core/verify.sh` 第 4/5 步的 `BCUT_LAUNCH_REF_MP4` 开关。
