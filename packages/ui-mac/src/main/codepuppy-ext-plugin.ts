// B6(=G1):@codepuppy/ext 装载路径解析(electron-free 纯逻辑,单测覆盖;electron 参数由调用方注入)。
//
// ext 是自包含 ESM bundle(ADR-006:桌面 Electron-Node 不重写 .js→.ts,必须预 bundle;
// prebuild/predev 已构建 packages/ext/dist/plugin.js)。装载链:
//   main(spawnLocalServer)解析出 bundle 绝对路径 → 经 StartCommand 传给 sidecar(不走 env,
//   免动 A6 白名单)→ injectCodePuppyConfig 合并进 OPENCODE_CONFIG_CONTENT 的 V1 `plugin`(单数)数组
//   → opencode 引擎按原生 plugin 机制加载 → codepuppy_ping/codepuppy_echo 进工具表,零改上游(ADR-002/005)。
//
// 逃生:CODEPUPPY_EXT_DISABLE=1 跳过装载。缺文件 → 返回 reason,调用方 loud warn(anti-B11:
// 否则表现为「工具静默不在」)。

import { join } from "node:path"

export type ExtPluginResolveInput = {
  /** app.isPackaged */
  packaged: boolean
  /** process.resourcesPath(打包后 extraResources 落点 <resources>/codepuppy-ext/server.js) */
  resourcesPath: string
  /** 调用方模块目录(dev 下 = packages/ui-mac/out/main,与 windows.ts 的 root 同法) */
  moduleDir: string
  /** process.env.CODEPUPPY_EXT_DISABLE === "1" */
  disabled: boolean
  exists: (p: string) => boolean
}

export type ExtPluginResolveResult = { path?: string; reason?: string }

/** 2.x 插件目录的服务端入口文件名(上游按 `server` → `index` 解析目录入口)。 */
export const EXT_PLUGIN_ENTRY = "server.js"

/**
 * `#1667`(#1662 L5,接口文档 I2 改形 2026-11-09):OpenCode 2 **只装目录形式的本地插件**(配置里写文件路径会被丢弃,只留一条
 * WARN,`packages/core/src/config/plugin/source.ts`)。所以这里返回的 `path` 是 ext 所在**目录**;在场判据是目录里有入口文件。
 */
export function resolveExtPluginPath(input: ExtPluginResolveInput): ExtPluginResolveResult {
  if (input.disabled) return { reason: "CODEPUPPY_EXT_DISABLE=1" }
  const path = input.packaged
    ? join(input.resourcesPath, "codepuppy-ext")
    : // dev:out/main → ui-mac → packages → ext/dist(镜像 windows.ts iconsDir 的相对法)
      join(input.moduleDir, "..", "..", "..", "ext", "dist")
  if (!input.exists(join(path, EXT_PLUGIN_ENTRY))) {
    return { reason: `ext plugin entry missing at ${join(path, EXT_PLUGIN_ENTRY)}(预期 prebuild/predev 已构建;打包态 = extraResources codepuppy-ext/)` }
  }
  return { path }
}
