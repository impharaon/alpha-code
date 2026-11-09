// `#1667`(#1662 L5,接口文档 I8,基线 S8):renderer 不拿引擎口令。
//   ① `await-initialization` 给 renderer 的值只有 `url` 一个键(index.ts 经 rendererEngineView 投影;反向臂:把口令放回去 ⇒ 红);
//   ② main 在 renderer 会话的 onBeforeSendHeaders 里只给发往**引擎源**的请求补 `Authorization`,别的源不补(上游桌面版同款)。
// 真 index.ts / windows.ts 在 bun 里链接不起来(index.ts 见 source-text-anchors.ts 抬头;windows.ts 顶层 import electron),
// 所以投影与补头都住在可 import 的 engine-authorization.ts,这里真执行它们;末两条锚只保证生产真的接在上面。
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { engineAuthorization, rendererEngineView, withEngineRequestAuthorization, type EngineConnection } from "./engine-authorization"

const connection: EngineConnection = { url: "http://127.0.0.1:4096", username: "opencode", password: "engine-secret" }

describe("I8 renderer 只拿 { url },口令由 main 补在请求上", () => {
  test("await-initialization 的返回值只有 url 一个键,序列化后找不到口令", () => {
    const view = rendererEngineView(connection)
    expect(Object.keys(view)).toEqual(["url"])
    expect(view).toEqual({ url: "http://127.0.0.1:4096" })
    expect(JSON.stringify(view)).not.toContain("engine-secret")
  })

  test("发往引擎源的请求补 Authorization(覆盖 renderer 自带的那个),路径与查询串不影响判定", () => {
    const headers = withEngineRequestAuthorization("http://127.0.0.1:4096/api/session?x=1", { authorization: "Basic forged", Accept: "*/*" }, connection)
    expect(headers).toEqual({ Accept: "*/*", Authorization: engineAuthorization("engine-secret") })
    expect(engineAuthorization("engine-secret")).toBe(`Basic ${Buffer.from("opencode:engine-secret").toString("base64")}`)
  })

  test("别的源一律不补:第三方站点、同主机不同端口、换协议、引擎尚未就绪", () => {
    for (const url of ["https://api.example.com/v1/chat", "http://127.0.0.1:4097/api/info", "https://127.0.0.1:4096/api/info", "oc://renderer/index.html"])
      expect([url, withEngineRequestAuthorization(url, { Accept: "*/*" }, connection)]).toEqual([url, { Accept: "*/*" }])
    expect(withEngineRequestAuthorization("http://127.0.0.1:4096/api/info", { Accept: "*/*" }, undefined)).toEqual({ Accept: "*/*" })
  })

  // 分类与「这处锚守不住什么」登记在 ./source-text-anchors.ts。
  test("ANCHOR (not a gate): index.ts 的 awaitInitialization 返回 rendererEngineView(res),windows.ts 的 onBeforeSendHeaders 经 withEngineRequestAuthorization 补头", () => {
    const index = readFileSync(join(import.meta.dir, "index.ts"), "utf8")
    expect(index).toContain("return rendererEngineView(res)")
    expect(index).toContain("setEngineConnection(connection)")
    const windows = readFileSync(join(import.meta.dir, "windows.ts"), "utf8")
    expect(windows).toContain("withEngineRequestAuthorization(details.url, details.requestHeaders, engineConnection)")
  })
})
