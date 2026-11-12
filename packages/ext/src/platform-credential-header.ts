// REQ-236 §2.1-4(`#1562`):平台模型请求的凭据在**请求边界现读**,不在引擎装配置时定死。
//
// 为什么在这里:续期每十分钟换一次令牌。以前令牌经平台 provider 的 `options.apiKey = {file:…}` 在引擎装配置时
// 被替换成字面量,再被 provider.ts 的 SDK 缓存按 options 哈希留住 —— 文件改了引擎也不读,只能重启引擎换血
// (owner 机器上四小时 25 次)。现在注入面只给平台 provider 一个固定的非凭据占位 apiKey
// (ui-mac `codepuppy-models.ts` PLATFORM_API_KEY_PLACEHOLDER),真凭据由本钩子每次请求从
// `CODEPUPPY_PLATFORM_AUTH_REF`(main 在 fork 时置成 `{file:<userData>/codepuppy-secrets/CODEPUPPY_API_KEY}`)指向的文件读出,
// 写成即将发出的那个 HTTP 请求的 `authorization`。OpenCode 2 上:路由层在 `session.hook["model.request"]` 之后才按 apiKey 写
// Authorization(`packages/ai/src/route/auth.ts` 的 `Headers.setAll`),那里加的头会被占位值盖掉;`session.hook["http.request"]`
// 拿到的是鉴权之后的请求,在那里写才上线(`#1662` parity B4 实测:改之前网关收到的恰好是占位值)。
//
// 读不到(引用缺席 / 不是 `{file:}` 形状 / 文件缺席或为空)⇒ 抛 `@ai-sdk/provider` 的 `LoadAPIKeyError`:
// 请求不发出,这一轮以这句具名错误失败(嵌入式引擎实测:网关零请求),界面按现有认证错误给出重试 /
// 重新登录。**绝不**回落:SDK 缓存与 provider options 里只有占位值,结构上无旧值可用(I5)。
// 只作用于平台代理节点(与输出上限同一个判据 `isPlatformProvider`);第三方与 BYOK 节点不碰。
// 错误消息不含路径与任何文件内容。

import { readFileSync } from "node:fs"
import { LoadAPIKeyError } from "@ai-sdk/provider"
import { FILE_REF } from "@opencode/plugin/alpha-cloud-authority"
import { isPlatformProvider } from "./platform-output-cap"

export const PLATFORM_AUTH_REF_ENV = "CODEPUPPY_PLATFORM_AUTH_REF"

/** 平台代理节点 ⇒ `Bearer <现读的凭据>`;其它节点 ⇒ undefined(不动请求头)。读不到即抛 `LoadAPIKeyError`。 */
export function platformCredentialHeader(input: {
  providerBaseURL: unknown
  env: Record<string, string | undefined>
  readFile?: (path: string) => string
}): string | undefined {
  if (!isPlatformProvider({ providerBaseURL: input.providerBaseURL, codepuppyBaseURL: input.env.CODEPUPPY_BASE_URL })) return undefined
  const token = readCredential(input.env[PLATFORM_AUTH_REF_ENV], input.readFile ?? ((path) => readFileSync(path, "utf8")))
  if (!token)
    throw new LoadAPIKeyError({
      // 措辞刻意避开引擎重试表的关键词(`opencode/src/session/retry.ts`:非 APIError 的消息含 unavailable / exhausted 等
      // 即判「可重试」,会把这个确定性的认证失败按退避重试约 60 秒才显示给用户)。
      message: "Code Puppy platform credential could not be read — the request was not sent. Retry, or sign in again.",
    })
  return `Bearer ${token}`
}

/**
 * OpenCode 2 的 `http.request` 钩子只给即将发出的请求(路由层已按 apiKey 写过 Authorization,`packages/ai/src/route/auth.ts`):
 * 请求地址在平台节点(`CODEPUPPY_BASE_URL`)之下 ⇒ 按平台节点判,同 `platformCredentialHeader`。
 * 请求地址是 `Request` 规范化过的(主机小写、默认端口去掉),`CODEPUPPY_BASE_URL` 是原样写法,所以两边都解析了再比(`#1662` r6)。
 */
export function platformRequestCredentialHeader(input: {
  requestURL: string
  env: Record<string, string | undefined>
  readFile?: (path: string) => string
}): string | undefined {
  const base = input.env.CODEPUPPY_BASE_URL
  const under = !!base && isUnderBase(input.requestURL, base)
  return platformCredentialHeader({ providerBaseURL: under ? base : undefined, env: input.env, readFile: input.readFile })
}

/** 同源(协议、主机不分大小写且末尾一个点不算、默认端口不算)且路径按段以平台节点的路径开头(`/v1x` 不算 `/v1` 之下)。 */
function isUnderBase(requestURL: string, base: string): boolean {
  const parse = (value: string) => {
    try {
      return new URL(value)
    } catch {
      return undefined
    }
  }
  const request = parse(requestURL)
  const root = parse(base)
  if (!request || !root) return false
  const host = (url: URL) => url.hostname.toLowerCase().replace(/\.$/, "")
  if (request.protocol !== root.protocol || host(request) !== host(root) || request.port !== root.port) return false
  const segments = (url: URL) => url.pathname.split("/").filter(Boolean)
  const want = segments(root)
  const have = segments(request)
  return want.length <= have.length && want.every((segment, index) => segment === have[index])
}

/** 引用必须整串就是一个 `{file:}`(文法取 alpha 唯一的那份 FILE_REF);别的形状(含字面令牌)一律当读不到。 */
function readCredential(ref: string | undefined, readFile: (path: string) => string): string | undefined {
  const match = ref ? FILE_REF.exec(ref) : null
  if (!match || match[0] !== ref) return undefined
  try {
    return readFile(match[1]!).trim()
  } catch {
    return undefined
  }
}
