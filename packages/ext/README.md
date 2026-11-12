# @codepuppy/ext

alpha-code 的**后端隔离扩展**:零改 opencode 源码的 server plugin + 自定义 tools(`codepuppy_echo` / `codepuppy_ping` + event hook)。对应 GOALS#G1。

## 为什么必须 bundle(ADR-006)

桌面端的 opencode server 跑在 **Electron 的 Node** 里。Node 能 type-strip `.ts`,但**不会**把源码里的 `./tool.js` 重映射到 `./tool.ts`。而 `@opencode/plugin` 只发 TS 源、且内部用 `.js` 写法 —— 直接交给 Node 加载会 `ERR_MODULE_NOT_FOUND` 崩溃。

所以本包**必须先打包成自包含的 ESM**(把 `@opencode/plugin` 和它带的 effect 内联进一个 `.js`),运行时只交给 Node 一个已解析完的 JS。详见 `.claude/rules/DECISIONS.md` 的 **ADR-006**。

- 源码:`src/plugin.ts`(OpenCode 2 插件 Context 上的钩子与 transform,`@opencode/plugin` 经 `workspace:*` 解析)
- 产物:`dist/server.js`(`bun build --target node --format esm`,见 `scripts/build.ts`)
- `package.json` 的 `exports`:`types` 走源码、`default`(运行时)走 `dist/server.js`

## 构建

```bash
bun run build          # → dist/server.js(自包含)
```

`ui-mac` 的 `predev` / `prebuild` 已自动先跑本包的 `build`,所以 `bun --cwd packages/ui-mac run dev`(或 `package:mac`)时 `dist/` 总是最新的。

## 怎么加载(OpenCode 2,`#1665`)

本包是 OpenCode 2 的 promise 插件(`default` 导出 `{ id, setup }`)。2.x 只按**目录**装配置里的本地插件(给文件路径会被丢掉,
`packages/core/src/config/plugin/source.ts`),目录里的入口按约定名 `server` 解析(`packages/plugin/src/host.ts`)——
所以注入配置的 `plugins` 写的是 bundle 所在**目录**(开发态 `packages/ext/dist`,打包态 `<resources>/codepuppy-ext`),
sidecar 预载的是其中的 `server.js`。2.x 给每个 Location 各求值一次本模块;进程级对象(定制中心桥、重载调度器)挂在
`globalThis[Symbol.for("codepuppy.ext.process")]` 上。

## 纪律

只新增本包文件 + `ui-mac` 自有文件,**零改 opencode 源码**;`dist/` 是构建产物(`.gitignore`)。
