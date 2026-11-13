// `#1662`:生产 electron.vite.config.ts 的 main 一段原样构建 —— 与 `electron-vite build`(package.json 的 build)第一步同一份解析过的
// 配置、同一个 vite build 调用(electron-vite 的 build() 就是依次对 main / preload / renderer 调 vite build),只把输出目录换成
// argv[2](electron-vite 落到 <argv[2]>/main),不碰 out/,也不跑 preload / renderer。cwd 必须是 packages/ui-mac(配置里的相对路径按它)。
import { resolveConfig } from "electron-vite"
import { build } from "vite"

process.env.NODE_ENV_ELECTRON_VITE = "production"
const resolved = await resolveConfig({ build: { outDir: process.argv[2] } }, "build", "production")
if (!resolved.config?.main) throw new Error("electron.vite.config.ts resolved without a main config")
await build(resolved.config.main)
