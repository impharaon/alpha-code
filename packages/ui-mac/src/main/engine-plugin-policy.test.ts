// alpha-code#1708:引擎插件 `plugin.use` 放行名单(engine-plugin-policy.ts)。判定用上游自己的 `ManagedPolicy.decision`
// (含 `packages/core/src/util/wildcard.ts` 的通配);每条判定的目标串是引擎装载前拿去比的那个串(真引擎上的证据在
// engine-plugin-policy.engine.cases.ts)。
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { ManagedPolicy } from "@opencode/core/managed-policy"
import { ConfigDiscovery } from "@opencode/core/config/discovery"
import { PluginSourceDirectory } from "@opencode/core/plugin/source-directory"
import type { ConfigPolicy } from "@opencode/schema/config/policy"
import { CONFIG_FILES, PLUGIN_DIRECTORIES, enginePluginPolicies } from "./engine-plugin-policy"

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cp-1708-policy-")))
  dirs.push(root)
  const write = (file: string, text = "export default {}\n") => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
    return file
  }
  const home = path.join(root, "home")
  const global = path.join(root, "config", "opencode")
  const ext = path.join(root, "app", "codepuppy-ext")
  write(path.join(ext, "server.js"))
  return { root, home, global, ext, write }
}

const decide = (policies: ReturnType<typeof enginePluginPolicies>["policies"], target: string) =>
  ManagedPolicy.decision(policies as ConfigPolicy.Info[], "plugin.use", target)

describe("plugin.use 放行名单", () => {
  test("先拒绝全部,再只放行 ext 与用户全局范围里现有的、能精确写出的路径(名单逐条精确)", () => {
    const { root, home, global, ext, write } = fixture()
    // 全局配置目录里引擎会发现的条目:.js / .ts 文件、目录、指向文件的软链;README 与断链不是插件
    write(path.join(global, "plugins", "g.js"))
    write(path.join(global, "plugin", "g2.ts"))
    write(path.join(global, "plugins", "README.md"))
    fs.mkdirSync(path.join(global, "plugins", "pkgdir"), { recursive: true })
    fs.symlinkSync(write(path.join(root, "elsewhere", "real.js")), path.join(global, "plugins", "link.js"))
    fs.symlinkSync(path.join(root, "missing.js"), path.join(global, "plugins", "dangling.js"))
    write(path.join(global, "plugins", "wild?.js"))
    write(
      path.join(global, "opencode.json"),
      JSON.stringify({
        plugin: [path.join(root, "v1-string"), [path.join(root, "v1-tuple"), { a: 1 }]],
        plugins: [
          "./gdir",
          "../outside-g",
          pathToFileURL(path.join(root, "via-url")).href,
          path.join(root, "abs-dir"),
          `-${path.join(root, "removed")}`,
          "cp-global-pkg@1.0.0",
          "@scope/pkg",
          { package: path.join(root, "entry-form"), options: { x: 1 } },
          "/srv/*/plug",
        ],
      }),
    )
    write(path.join(global, "opencode.jsonc"), `{\n  // comment\n  "plugins": ["./from-jsonc",],\n}`)
    // HOME 一级:~/.opencode/ 与 ~/opencode.json
    write(path.join(home, ".opencode", "plugins", "h.js"))
    write(path.join(home, ".opencode", "opencode.json"), JSON.stringify({ plugins: ["./home-dot-rel"] }))
    write(path.join(home, "opencode.json"), JSON.stringify({ plugins: ["./home-rel"] }))
    const explicitDir = path.join(root, "userdata", "codepuppy-engine-config")

    const { policies, refused } = enginePluginPolicies({
      extPluginPath: ext,
      globalDirectory: global,
      home,
      userConfig: { text: `{ "plugins": ["./user-rel"] }`, directory: explicitDir },
    })

    expect(policies[0]).toEqual({ action: "plugin.use", resource: "*", effect: "deny" })
    expect(policies.slice(1).every((policy) => policy.action === "plugin.use" && policy.effect === "allow")).toBe(true)
    expect(policies.slice(1).map((policy) => policy.resource)).toEqual(
      [
        ext,
        path.join(global, "plugin", "g2.ts"),
        path.join(global, "plugins", "g.js"),
        path.join(global, "plugins", "link.js"),
        path.join(global, "plugins", "pkgdir"),
        path.join(global, "gdir"),
        path.join(root, "config", "outside-g"),
        path.join(root, "via-url"),
        path.join(root, "abs-dir"),
        path.join(root, "entry-form"),
        path.join(root, "v1-string"),
        path.join(root, "v1-tuple"),
        path.join(global, "from-jsonc"),
        path.join(home, ".opencode", "plugins", "h.js"),
        path.join(home, ".opencode", "home-dot-rel"),
        path.join(home, "home-rel"),
        path.join(explicitDir, "user-rel"),
      ].sort(),
    )
    // 包名与含通配字符的路径写不成精确语句:不放行,单独报出来
    expect(refused).toEqual(["/srv/*/plug", path.join(global, "plugins", "wild?.js"), "@scope/pkg", "cp-global-pkg@1.0.0"].sort())
  })

  test("项目范围的每种写法与仿冒都落在拒绝上:同名文件、同名目录、同名包借道、落进通配的路径、上级目录", () => {
    const { root, home, global, ext, write } = fixture()
    write(path.join(global, "plugins", "g.js"))
    write(path.join(global, "opencode.json"), JSON.stringify({ plugins: ["cp-global-pkg@1.0.0", "/srv/*/plug"] }))
    const { policies } = enginePluginPolicies({ extPluginPath: ext, globalDirectory: global, home })
    const project = path.join(home, "work", "p1")

    for (const allowed of [ext, path.join(global, "plugins", "g.js")]) expect([allowed, decide(policies, allowed)]).toEqual([allowed, "allow"])
    for (const target of [
      path.join(project, ".opencode", "plugins", "x.js"),
      path.join(project, ".opencode", "plugin", "y.ts"),
      path.join(project, "rel"), // opencode.json 的 ./rel
      path.join(root, "outside-abs"), // opencode.json 的绝对路径
      "cp-project-pkg", // opencode.json 的 cp-project-pkg@1.0.0,引擎比的是去掉版本的名字
      "cp-global-pkg", // 项目写 cp-global-pkg@file:<项目里的目录>:与用户全局的包同名,引擎比的同样是这个名字
      path.join(project, ".opencode", "plugins", "g.js"), // 与全局插件同名的项目文件
      path.join(project, ".opencode", "plugins", path.basename(ext)), // 与 ext 同名的项目目录
      `${ext}-lookalike`,
      path.join(ext, "nested"),
      "/srv/p1/plug", // 若照抄全局里的 "/srv/*/plug",这条项目路径会落进去
      path.join(home, "work", ".opencode", "plugins", "a.js"), // 项目与 HOME 之间的上级目录
      path.join(path.dirname(home), ".opencode", "plugins", "above.js"), // HOME 之上
    ])
      expect([target, decide(policies, target)]).toEqual([target, "deny"])
  })

  test("用户自己的 plugin.use 拒绝照旧说了算:codepuppy.jsonc 与 HOME 一级文档(含通配与旧写法 integration.use plugin:)里 deny 的来源不写 allow", () => {
    const { home, global, ext, write } = fixture()
    for (const name of ["g.js", "g2.ts", "keep.js"]) write(path.join(global, "plugins", name))
    write(path.join(home, ".opencode", "plugins", "h.js"))
    write(path.join(home, "opencode.json"), JSON.stringify({ policies: [{ action: "plugin.use", resource: "*/h.js", effect: "deny" }] }))
    write(
      path.join(home, ".opencode", "opencode.json"),
      JSON.stringify({ policies: [{ action: "integration.use", resource: `plugin:${path.join(global, "plugins", "g2.ts")}`, effect: "deny" }] }),
    )
    const userConfig = { text: JSON.stringify({ policies: [{ action: "plugin.use", resource: path.join(global, "plugins", "g.js"), effect: "deny" }] }), directory: global }
    const { policies } = enginePluginPolicies({ extPluginPath: ext, globalDirectory: global, home, userConfig })
    expect(policies.slice(1).map((policy) => policy.resource)).toEqual([ext, path.join(global, "plugins", "keep.js")].sort())
    for (const target of [path.join(global, "plugins", "g.js"), path.join(global, "plugins", "g2.ts"), path.join(home, ".opencode", "plugins", "h.js")])
      expect([target, decide(policies, target)]).toEqual([target, "deny"])
    // 先加载的那份说了算:codepuppy.jsonc(显式文件)里的 allow 胜过 HOME 一级文档里的 deny
    const allowFirst = { text: JSON.stringify({ policies: [{ action: "plugin.use", resource: path.join(home, ".opencode", "plugins", "h.js"), effect: "allow" }] }), directory: global }
    expect(enginePluginPolicies({ extPluginPath: ext, globalDirectory: global, home, userConfig: allowFirst }).policies.map((policy) => policy.resource)).toContain(
      path.join(home, ".opencode", "plugins", "h.js"),
    )
  })

  test("什么都没有 ⇒ 只剩拒绝全部 + ext;没有 ext ⇒ 只剩拒绝全部;用户文件坏了 ⇒ 它的条目一条不放", () => {
    const { home, global, ext, root } = fixture()
    expect(enginePluginPolicies({ extPluginPath: ext, globalDirectory: global, home }).policies).toEqual([
      { action: "plugin.use", resource: "*", effect: "deny" },
      { action: "plugin.use", resource: ext, effect: "allow" },
    ])
    expect(enginePluginPolicies({ globalDirectory: global, home }).policies).toEqual([{ action: "plugin.use", resource: "*", effect: "deny" }])
    expect(
      enginePluginPolicies({ globalDirectory: global, home, userConfig: { text: `{ "plugins": ["./user-rel"]`, directory: root } }).policies,
    ).toEqual([{ action: "plugin.use", resource: "*", effect: "deny" }])
  })

  test("我们抄的发现规则与上游同值(配置文件名、插件目录名)", () => {
    expect(CONFIG_FILES).toEqual([...ConfigDiscovery.names])
    expect(PLUGIN_DIRECTORIES).toEqual([...PluginSourceDirectory.names])
  })
})
