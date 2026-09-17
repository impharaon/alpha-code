// alpha 自有文件(basename `alpha-*`,ADR-043 因子②)。
//
// REQ-131 / #1130 路线 B 探针:证明「引擎 inventory 从**已收编**的 v2 permission 面走出引擎进程」
// 在生产装配(HttpApiApp.routes)上真的通 —— 不 mock 任何 layer,请求穿过真的
// location 中间件 → PermissionHandler → core 标签 → opencode bridge → InstanceStore.provide → list()。
import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { parseToolPolicyInventory } from "@opencode-ai/schema/alpha-tool-inventory"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>

function request(route: string, directory: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return HttpApiApp.webHandler().handler(new Request(`http://localhost${route}`, { ...init, headers }), context)
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("#1130 route B probe: GET /api/permission/tool-inventory", () => {
  test("returns the live inventory for the location's engine instance through the collected permission face", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await request("/api/permission/tool-inventory", tmp.path)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = (await response.json()) as { data: unknown }
    // wire 契约自证:引擎侧 decode 过一次,这里再 decode 一次证明跨 HTTP 后形状仍合契约。
    const inventory = parseToolPolicyInventory(body.data)
    expect(inventory.version).toBe(1)
    expect(inventory.services.length).toBeGreaterThan(0)
    // 已知该在场的锚点:builtin 来源里必须有 `write`(与 alpha-tool-inventory.test.ts 的 ID_BUILTIN_WRITE 同源)。
    const builtin = inventory.services.find((service) => service.source === "builtin")
    expect(builtin).toBeDefined()
    expect(builtin!.tools.map((tool) => tool.canonical)).toContain("builtin::write")
    // 每个工具都带 effective(9 型 reason 之一)—— Settings 徽标的数据源在线上真的有值。
    for (const service of inventory.services) {
      for (const tool of service.tools) {
        expect(["allow", "ask", "deny"]).toContain(tool.effective.action)
      }
    }
  })

  // 控制组:生产路由表末尾有 `/*` 的 UI 兜底(uiRoute),未知路径也回 200 —— 所以上面的 200
  // 不能单靠状态码判;这里证明兜底给的**不是** JSON,而上面那条给的是可 decode 的 inventory。
  test("an unknown sibling path is served by the UI catch-all, not by the inventory handler", async () => {
    await using tmp = await tmpdir({ git: true })
    const response = await request("/api/permission/tool-inventory-does-not-exist", tmp.path)
    expect(response.headers.get("content-type") ?? "").not.toContain("application/json")
  })
})
