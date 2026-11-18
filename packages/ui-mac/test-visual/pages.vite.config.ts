// 页面级视觉 harness(新外壳 · 对话 / 批准 / 安装卡 / 找不到对话 / 首次引导 / 自动化 / 设置):
// 同 vite.config.ts 的桩口径,但设置页要经上游命令层读默认键位,所以带上 app 的 vite 插件(含 `@/` 别名)。
import { fileURLToPath } from "node:url"
import appPlugin from "@opencode-ai/app/vite"
import { defineConfig } from "vite"
import { UPSTREAM_LOGO_ALIAS } from "../scripts/upstream-logo-alias.ts"

const providersStub = fileURLToPath(new URL("./providers-stub.ts", import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [
    {
      name: "codepuppy-visual:providers-stub",
      enforce: "pre",
      resolveId(id, importer) {
        if (id === "./providers" && importer?.includes("/codepuppy-ui/codepuppy-composer")) return providersStub
        if (id === "./providers" && importer?.endsWith("/codepuppy-ui/Banner.tsx")) return providersStub
      },
    },
    appPlugin,
  ],
  resolve: { alias: [UPSTREAM_LOGO_ALIAS] },
  server: { port: 5198, strictPort: true, fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] } },
})
