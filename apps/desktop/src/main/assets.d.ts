// electron-vite 在打包时把 `?asset` 导入换成资源文件的路径（托盘图标用）。只声明这一种导入：整份 `electron-vite/node`
// 还会改 `NodeJS.ProcessEnv`，让别处把 `process.env` 当作窄类型传参时类型检查不过。
declare module '*?asset' {
  const src: string;
  export default src;
}
