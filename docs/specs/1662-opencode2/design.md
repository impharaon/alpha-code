---
id: DESIGN-1662-opencode2
title: OpenCode 2 换代 技术设计
summary: alpha-code#1662 各实施线需要冻结的技术决定,按决定分段;目前含「MCP OAuth on OpenCode 2」—— 远端 MCP 登录改走引擎 2.x 的集成 OAuth,围栏不开口,回调页沿用 ADR-042 接管
kind: tech-design
status: draft
spec: ""            # #1662 没有 spec 文档;已批准的输入是下面的方案基线与裁决书(同目录 plan.md 同样处理)
spec_version: ""
baseline: docs/design/2026-11-08-1662-opencode2-generation-switch-baseline.md
review:
  rounds: 0
  reviewed_sha: ""
  verdict: ""
owners: [alpha-code desktop maintainers]
last_reviewed: 2026-11-12
---

# DESIGN-1662-opencode2｜OpenCode 2 换代 技术设计

只放决定,按决定分段;每段自带基线、契约、裁决与证据,段与段互不依赖。文件、顺序、测试归各实施线的 `plan.md`。§3、§7 已退役,编号不复用。

## MCP OAuth on OpenCode 2(L5 #1667 / L6 #1668)

### 1. 基线

- 依据(没有 spec 文档,用已批准的换代基线代替):[方案基线](../../design/2026-11-08-1662-opencode2-generation-switch-baseline.md)(`32a0f888a3`)AC1「不留半代次链路」、§5.2 的 0.1.26 回归矩阵;[能力清点表](../../design/2026-11-08-1662-opencode2-capability-inventory.md)(`32a0f888a3`)M5 行;[接缝冻结](../../design/2026-11-09-1662-lane-seams.md)(`11d8d5d4ae`)I8(引擎口令只在 main)与第 4 节「MCP 增删连断、MCP OAuth:L5 和 L6 各自调上游路由」;[ADR-042](../../../.claude/rules/adrs/ADR-042-oauth-callback-brand.md)。
- 覆盖的验收:0.1.26 已发布的「远端 MCP 登录」在 OpenCode 2 上继续可用。入口有两个,界面都保持当前正式版(owner 2026-11-09:「界面当前的 alpha 才是唯一权威吧」):
  - 定制中心 `needs_auth` 行上的「去授权」按钮(`packages/ui-mac/src/renderer/extensions/extension-hub.tsx:978-994` → `use-extensions.ts:802-822`);
  - 冻结 app 状态弹层里 `needs_auth` 那一行,点击后 `toggleMcp` 走 `authenticate`(pin `e11dbd02`:`packages/app/src/context/global-sync/mcp.ts`、`context/server-sync.tsx:714-716`)。
  - 两处发的都是 v1 的 `POST /mcp/:name/auth/authenticate`。
- 裁决来源:#1667 评论 6738814516 第 5 项(原始要求)、6756155047 第 4 项(L5 读码推断,未实测);派发书 `L5-mcp-oauth-design.md`。
- 本段要定的四件事:
  1. 围栏要不要开口;
  2. ADR-042 的回调页怎么继续生效;
  3. 谁驱动登录流程、走哪个接口;
  4. 失败时用户看到什么。

### 2. 地面真相

版本说明:
- 实测用的引擎是 `packages/ui-mac/dist-engine/engine.mjs`(2026-11-09 构建,报 `ENGINE_VERSION=2.2.5`)。
- L5 分支上 `packages/core` 与上游 `33f94fce96` 逐字相同(`git diff --stat 33f94fce96 HEAD -- packages/core/src/mcp packages/core/src/oauth` 为空)。
- 运行时是 Electron 42.3.3 自带的 node 24.15.0。
- 测量记录见 §10。

**P-01 围栏的四条网络规则**(`packages/ui-mac/src/main/process-fence-profile.ts:175-178`):
- N1 `(deny network*)`;
- N2 `(allow network-bind (local ip "localhost:*"))`;
- N3 `(allow network-inbound (local ip "localhost:*"))`;
- N4 `(allow network-outbound (remote ip "localhost:<代理端口>"))`。

sidecar 的 `NO_PROXY` 含 `127.0.0.1,localhost,::1`(`sidecar-env.ts:292`)。所以引擎访问回环地址时不经代理直连,撞上 N1。

**P-02 2.x 的远端 MCP OAuth 全在引擎里**(`packages/core/src/mcp/oauth.ts`):
- 引擎自己在 `127.0.0.1` 上起回调监听:端口取 `callback_port ?? redirect_uri 端口 ?? 0`(`:377-421`)。Code Puppy 的注入不写 `oauth` 字段(`codepuppy-config-injection.ts` 的 `#1381` 段),所以每次登录都是一个临时端口,路径 `/callback`。
- 发现、DCR、PKCE、换令牌都由引擎经 `FetchHttpClient.Fetch` 发出(`:46-61,426-498`)。
- 授权地址只被记下、不打开(`:476-479`),放在 Attempt 里交给调用方。
- 回调页的成功与失败都出自 `OauthCallbackPage`(`:25,389,400,512-513`)。
- 另有一条「粘贴回跳地址」的备用路径:`paste: true` 加 `complete({code})`(`:550-566`,`schema/src/integration.ts:95-103`)。
- 每个远端 MCP(`oauth !== false`)登记成集成 `mcp_<sha1(name\0url)[0:16]>`,`metadata.source = "mcp"`、`name` = MCP 名(`mcp/index.ts:238-275`)。

**P-03 集成 OAuth 的生命周期**:
- 接口:`POST /api/integration/:id/connect/oauth` → `Attempt{attemptID,url,mode:"auto",paste:true}`;`GET …/:attemptID` → `pending|complete|failed|expired`;另有 `DELETE`(`protocol/src/groups/integration.ts:104-176`)。
- 时限:attempt 存活 10 分钟,终态保留 1 分钟(`core/src/integration.ts:263-264`)。
- 设置阶段失败时返回 400 `InvalidRequestError{message}`(`server/src/handlers/integration.ts:39-45`)。
- 成功时先写凭证,凭证写入会全局发布 `Credential.Event.Switched`(`credential.ts:218`),然后 attempt 才转 `complete`(`integration.ts:475-493,451-473`)。
- MCP 收到这个事件后异步重连(`mcp/index.ts:688-707`)。重连的上限是 MCP 启动超时,默认 30 秒(`mcp/client.ts:35,295`)。

**P-04 实测(§10 R-1、R-2)**:

| 场景 | 结果 | 由哪条规则决定 |
| --- | --- | --- |
| 引擎回调监听 + 浏览器访问它 | 放行:监听起在 `127.0.0.1:63543`,从围栏外 GET 得到 200 `text/html`,标题「Authorization successful · OpenCode」 | N2 / N3 |
| 引擎经代理连远端 MCP 主机(由用户记录派生) | 放行:登录完成,`complete` 后 253 ms 内 MCP 从 `pending` 变成 `connected` | N4 + 动态半场(`network-egress-derived.ts:139-146`) |
| 授权服务器在另一台主机 | 第一次连那台主机时弹一次出网确认(`network-egress-grants.ts:204`,生产接线 `server.ts:165-168`)。这一次发生在**引擎启动后的匿名连接**里,早于用户点登录。选「允许」:`needs_auth` → 登录完成 → `connected` | N4 + 用户批准的半场 |
| 同上,用户拒绝或 45 秒没答 | MCP 变成 `failed: fetch failed`(不是 `needs_auth`)。点登录得到 400 "fetch failed",引擎日志 `Proxy response (403) !== 200 when HTTP Tunneling`。之后 5 分钟内不再询问(`network-egress-grants.ts:60,64`) | 代理 403 unregistered |
| 引擎直连本机的 OAuth 服务器(测试替身) | 拒绝:`connect EPERM 127.0.0.1:63523`,`connect/oauth` 返回 400,替身一个请求都没收到;不装围栏的对照组完整走通 | N1 |

**P-05 本机目的地只在测试里出现**:
- 添加远端 MCP 时拒绝回环地址(`ext-config.ts:301-304` → `classifyBaseUrl`,`network-egress-derived.ts:95-97`);
- owner 2026-09-21 已裁定不支持本机目的地(`network-egress-derived.ts:40-41`);
- 真实的授权服务器在远端。
- 所以 P-04 最后一行只影响测试替身,真实用户碰不到。

**P-06 main 侧 v1 路径的现状**:
- `createPackageMcpOauthCoordinator`(begin/status/cancel + 每次一个回环监听,`package-mcp-oauth.ts:106-305`)**没有生产调用方**:`grep -rln createPackageMcpOauthCoordinator packages/` 只命中它自己和 `package-mcp-oauth.wiring.test.ts`。
- 生产上只接了就绪探针:`ext-ipc.ts:429` 构造 `createPackageMcpOauthEngineV1(awaitServer)`,`package-admission.ts:438-440` 调 `probePackageMcpOauthPrerequisiteV1`(只用 `add`)。
- 这条接缝还 import `@opencode-ai/sdk/v2/client`(`package-mcp-oauth.ts:4`),走 v1 的 `POST /mcp`。
- 2.x 的对应是 `PUT /api/experimental/mcp/:server`:运行期加入,同名替换,立即连接(`protocol/src/groups/mcp.ts:40-56`)。实测:同一个 URL 换个名字 ⇒ `needs_auth`,同名同 URL ⇒ `connected`。2.x 的凭证按「名 + URL」绑定,与 v1 的 `getForUrl` 语义一致。
- 目前没有包声明这种前置:alpha-web `origin/main`(`9bb3c5c`)的 `catalog-src/` 与最新发布 `public/catalog/v1/releases/2026-11-02.3/catalog.json` 里都没有声明 `codepuppy.mcp-oauth.v1` 前置的包。

**P-07 0.1.26 的形状**(`e56ae0c036`):
- 引擎自开浏览器,监听固定在 `127.0.0.1:19876/mcp/oauth/callback`(`packages/opencode/src/mcp/oauth-provider.ts:11-12`);
- DCR 的 `client_name` 是 "OpenCode"(`:46`)。2.x 是 "opencode",并对声明支持 CIMD 的服务器用 `https://opencode.ai/oauth/opencode/client.json`(`oauth.ts:30,192`)。授权页上显示的客户端名两代都是 OpenCode,不算本次退化。
- 2.x 不导入 v1 的 `mcp-auth.json`(`packages/core/src` 里零引用)。owner 本机那份是 2 字节(基线 `:132`)。

**P-08 L6 的 U6 适配**(`lane/1668-l6-frontend` `c261bba302`,`packages/ui-mac/src/engine-adapter/routes.ts:404,570-595`):
- 调用顺序:list → get → connect → `window.api.openLink(url)` → 每秒轮询状态 → 终态后**立刻**读一次 `mcp.list` 返回。
- 按 P-03 与 P-04,`complete` 那一刻读到的是 `pending`。`use-extensions.ts:817` 要 `connected === true` 才算成功,所以登录成功会被报成「授权失败」。这是 §4 契约要堵的那一处。
- 引擎抛出的错误由 `index.ts` 的 `errorResponse` 转成 v1 错误体(404 或 500),调用方据此判失败。

### 4. 接口契约

#### API:v1 路由 `POST /mcp/:name/auth/authenticate`(U6)

- 产出方:L6,`packages/ui-mac/src/engine-adapter/routes.ts`。
- 消费方:`use-extensions.ts:802` 与冻结 app 的 `server-sync.tsx:714`。两者都不改。
- 鉴权:renderer 不持有口令。到引擎源地址的请求由 main 补 Basic(I8,`7622e367b7`)。

```ts
// 请求:路径参数 name(MCP 名);location = 调用方带来的目录(at(context))。无请求体。
// 成功:200,body = 上游 Mcp.Status(packages/schema/src/mcp.ts:77-95,形状不改)
type McpStatus =
  | { status: "connected" } | { status: "pending" } | { status: "disabled" }
  | { status: "failed"; error: string } | { status: "needs_auth"; error: string }
// 失败:非 2xx,body = v1 错误体(engine-adapter/index.ts errorResponse)
type V1Error = { name: string; data: { message: string } }

const POLL_MS = 1_000 // 轮询间隔,固定常量,不做配置项

// 引擎调用全部经上游客户端,带同一个 location。按顺序:
// 1. integration.list → 取 metadata.source === "mcp" && name === :name 的那一项。
//    只读引擎给的列表,不在适配层算 mcp_<sha1> 身份(K2:不写上游决定的替身)。
//    找不到 → 404 V1Error("NotFoundError")。
// 2. integration.get → 取 type === "oauth" 的方法。没有 → 400 V1Error。
// 3. integration.oauth.connect({ integrationID, methodID })
//    → Attempt。引擎拒绝(400 InvalidRequestError,如发现/注册端点不可达或被代理拒)→ 非 2xx V1Error。
//    判失败只看状态码,不解析 message 文本。
// 4. window.api.openLink(attempt.url):由 main 打开系统浏览器(ipc.ts:263-274 只放行 http/https/mailto)。
//    适配层不再做别的 URL 判定,也不走粘贴路径。
// 5. 每 POLL_MS 轮询 integration.oauth.status,直到不是 "pending"。
//    适配层不设截止时间;上限由引擎的 attempt 过期(10 分钟)给出,届时状态为 "expired"。
// 6. 终态 "complete":继续每 POLL_MS 读一次 mcp.list(第一次读至少在 complete 之后 POLL_MS),
//    直到这台 MCP 的状态不是 "pending",再以 200 返回该状态。
//    引擎会用 MCP 启动超时收口,所以一定会停在 connected / failed / needs_auth 之一。
//    终态 "failed" / "expired":直接以 200 返回 mcp.list 里这台 MCP 的当前状态(通常是 needs_auth);
//    列表里没有这台 → 200 { status: "failed", error: <终态名> }。
// 7. 不调 DELETE:现有两个调用方都不传 signal,中途取消在今天的路径上不会发生。
```

#### API:main 的就绪探针接缝

- 产出方:L5,`packages/ui-mac/src/main/package-mcp-oauth.ts`。
- 消费方:`package-admission.ts:438-440`,经 `ext-ipc.ts:429` 注入。

```ts
// createPackageMcpOauthCoordinator 及其三个 outcome 类型、authStart / authCallback、回环监听:删除。
export type PackageMcpOauthEngineV1 = {
  /** PUT /api/experimental/mcp/:server { config },然后 GET /api/mcp,直到这台不是 "pending"。
   *  只写运行期状态,不落盘(与 v1 的 POST /mcp 同义)。 */
  add(
    name: string,
    config: { type: "remote"; url: string },
  ): Promise<{ ok: true; status: PackageMcpOauthEngineStatusV1 } | { ok: false; reason: string }>
}
// 走 engineClient(engine-client.ts,I8),不再 import @opencode-ai/sdk。
// 等待上限 30_000 ms(与引擎 MCP 启动超时同值,mcp/client.ts:35)。
// 超时或引擎报错 → { ok: false, reason },admission 沿用既有的 mcp-oauth-engine-unavailable 处理。
export function createPackageMcpOauthEngineV1(
  awaitServer: () => Promise<EngineConnection>,
  fetchImpl?: typeof fetch,
): PackageMcpOauthEngineV1
```

- `probePackageMcpOauthPrerequisiteV1` 的签名不变。`shared/package-mcp-oauth.ts` 不改:2.x 不会产出 `needs_client_registration`,这一臂留着不删。

#### 数据

不适用。没有新表或新文件。凭证由引擎写进它自己的 `credential` 表(库路径由 main 传入的 `database.path` 决定)。

#### 事件 / 配置

不新增配置。围栏 profile 不变,注入里也不写 `oauth.callback_port` / `redirect_uri`。

### 5. 数据与失败

- **写入边界**:
  - 只有引擎写:登录成功时追加一条凭证(`integration.ts:475-493`),MCP 取最新一条(`mcp/index.ts:291-296`);
  - main 与 renderer 不写任何 OAuth 状态;
  - attempt 只存在引擎内存里。
- **重复与并发**:
  - 重新登录会追加凭证,新的生效;
  - 同一台 MCP 同时有两个 attempt 时,各用各的端口和 state,后完成的那条成为最新凭证,不需要额外处理;
  - `Switched` 是全局事件,其它 Location 里的同名 MCP 也会重连(读码结论,未实测)。
- **用户可见的失败**(UI 一律保持 0.1.26):
  - 定制中心:成功 toast `mcpAuthDone`,失败 toast `mcpAuthFailed`;
  - 冻结弹层:刷新状态点;
  - 浏览器页:来自引擎的 `page.ts`。

| 可达情形 | 引擎/接口表现 | 用户看到 |
| --- | --- | --- |
| 在服务方页面上拒绝授权,或 state 不符、换令牌失败 | 回调页「Authorization failed」;attempt `failed`;MCP 保持 `needs_auth` | 浏览器显示 Code Puppy 失败页;定制中心「授权失败」;可以再点一次 |
| 打开浏览器后一直没完成 | 10 分钟后 attempt `expired` | 按钮保持「授权中」最多 10 分钟(0.1.26 是 5 分钟),然后「授权失败」 |
| 授权服务器在另一台主机,用户拒绝出网确认或超时 | 启动时 MCP 就是 `failed: fetch failed`;点登录得到 400 | 不出现「去授权」(只给 `needs_auth`);冻结弹层点 `failed` 行会重连,5 分钟拒绝记忆过后会再问一次。这些是 `#1412` 的现行行为,本段不改 |
| 授权成功,但服务器之后连不上 | MCP 变成 `failed` | 「授权失败」(按 0.1.26 的 `connected === true` 判据) |
| 登录过程中 MCP 被删除 | 404 | 「授权失败」 |

- **升级**:0.1.26 存的 MCP 令牌(`mcp-auth.json`)不带过来,以前登录过的远端 MCP 升级后显示一次 `needs_auth`,点一次登录即可。已知承受者 0 人(owner 本机那份 2 字节,基线 `:132`),其它安装未核实。

### 6. 架构落点

仓内没有 `docs/architecture/modules.md`,落点理由逐行写在表里。

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| U6 路由(§4 第一段) | renderer 的 v1→2.x 翻译层 `packages/ui-mac/src/engine-adapter/routes.ts`(L6 已有) | renderer → 上游客户端 → 引擎;renderer → preload `openLink` | 引擎集成 OAuth(`core/src/integration.ts`、`mcp/oauth.ts`);main `open-link`(`ipc.ts:263-274`);I8 补头 |
| 删掉协调器;探针接缝改指 2.x | `packages/ui-mac/src/main/package-mcp-oauth.ts` | main → `engine-client.ts` → 引擎 | `engine-client.ts`;admission 现有的 fail-closed 处理 |
| 回调页 | `packages/core/src/oauth/page.ts`(L4 接管,`lane/1666-l4-takeover` `e71d98f171`) | — | 就是它本身:ADR-042 |
| 围栏 | `process-fence-profile.ts` N1–N4 | 不变 | — |

- 新目录 / 新模块:无。
- 收敛:
  - `docs/architecture/package-mcp-oauth-boundary.md` 的归属表(attempt 归 main、三个动词、「监听先起」)随删除失效,在实施提交里改写;
  - `package-mcp-oauth.wiring.test.ts` 里协调器的那部分随删除退役。
- 架构约束:K2 变好。登录 attempt 只剩引擎这一个权威,main 不再持有第二套 attempt 和监听;适配层读引擎给的集成列表,不复刻上游的身份哈希。围栏没有例外,也没有新偏离。
- 工程标准:
  - 第 5 条:适配层判失败看状态码,不依赖错误文案;
  - 第 1 条:`POLL_MS`、30 秒上限都是固定常量,不做配置项。
- 被否决的替代:
  - **为本机回环出网开口**:只有测试替身需要(P-05)。开了会让整棵围栏内的进程树都能连本机任意服务,违背 owner 2026-09-21 的裁定。
  - **main 继续当 attempt 的主人**(把 `redirect_uri` 指到 main 的监听):2.x 的 `authorize` 总会自己在 `callback_port ?? redirect 端口` 上起监听(`oauth.ts:415-418`),不像 v1 那样会让路。端口被 main 占着时,它的 `listen` 会失败(读码推断)。而且 2.x 没有 `auth.start` / `auth.callback` 这两条路由。
  - **在界面上加粘贴回跳地址**:多一步用户操作。回调监听实测可达,用不上。
  - **把授权服务器主机自动放行**:这个值是引擎在围栏内从远端读到的,不是围栏外的真源(`network-egress-derived.ts:21-33`、`network-egress-grants.ts:21-23`)。
  - **退役 admission 探针**:会悄悄去掉 `#703` 已经拿回的 fail-closed 权威(ADR-048)。改指 2.x 只要几行。
- 安全面(风险项:围栏与鉴权):
  - 威胁边界是 seatbelt 内的引擎进程树。下面这些不变式必须成立:
  - ① N1–N4 一字不改。
  - ② PKCE verifier、state、授权码、令牌、client secret 只在引擎里。main 连 v1 时转发的授权码也不再经手;renderer 只拿到授权地址。
  - ③ 引擎口令只在 main(I8)。
  - ④ 浏览器只经 main 的 `open-link` 打开。
  - ⑤ 回调监听只绑 `127.0.0.1`,校验 state,同一个回调只收一次(`oauth.ts:397-411,418`)。这些是上游行为,直接消费,不重写。
  - ⑥ 远端目的地只来自 main 写的记录或用户的批准。

### 8. 拆分决定

同一个仓,按归属拆给三条实施线;各线内部的步骤写进各自的 plan.md。

| 产出方(仓/负责) | 产出与 AC/设计小节 | 消费的契约 | 开工依赖 | 集成/验收依赖 |
| --- | --- | --- | --- | --- |
| alpha-code / L6 #1668 | U6 路由按 §4 第一段收口(`complete` 之后等 MCP 离开 `pending`) | 上游集成 OAuth 与 `Mcp.Status`;I8 | 无 | 用 L4 的 `page.ts` 核对回调页品牌;L7 打包版回归矩阵 |
| alpha-code / L5 #1667 | 删掉协调器;探针接缝按 §4 第二段改指 2.x;改写 `package-mcp-oauth-boundary.md` | `engine-client.ts`、`PUT /api/experimental/mcp/:server`、`GET /api/mcp` | 无 | 无 |
| alpha-code / L4 #1666 | `page.ts` 接管(已在 `e71d98f171`) | ADR-042 | — | 合入整合分支后,回调页标题显示 Code Puppy |

### 9. 回滚

本段不单独回滚,跟随换代整体撤回(基线 §6)。数据上的后果:2.x 下登录得到的凭证在 2.x 库里,v1 读的是原样未动的 `mcp-auth.json`;退回 v1 后,在 2.x 下登录过的 MCP 要重新登录一次。

### 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| **(1) 围栏不开口。** 引擎自己的回调监听(N2)、浏览器访问它(N3)、引擎经代理连远端 MCP 与授权服务器(N4 + 派生 / 用户批准),在现行 profile 下都已放行。唯一被拒的是引擎直连本机 OAuth 服务器(N1,`EPERM`),只有测试替身会这样 | 实测(R-1 / R-2);P-01、P-04、P-05 |
| **(2) ADR-042 由 L4 接管的 `packages/core/src/oauth/page.ts` 直接生效。** 2.x 的回调由引擎监听,成功页和失败页都出自 `OauthCallbackPage`。main 不再有自己的页面,v1 协调器的纯文本页随删除消失 | `oauth.ts:25,389,400,512-513`;R-2 回调标题来自 page.ts(L5 树还没接管,所以显示 OpenCode;L4 `e71d98f171` 显示 Code Puppy) |
| **(3) 登录由 renderer 的 U6 适配层驱动**,走引擎 2.x 的 `/api/integration/:id/connect/oauth`,引擎持有监听与全部秘密,main 只负责打开浏览器与补口令。main 的 `package-mcp-oauth.ts` 协调器删除(没有生产调用方);就绪探针保留,改走 2.x 的 `PUT /api/experimental/mcp/:server` | P-02、P-03、P-06、P-08;R-2 的 readiness 两行 |
| **(4) 失败时界面保持 0.1.26**(定制中心 toast、冻结弹层状态点、Code Puppy 回调页),不新增步骤或文案。U6 必须等 MCP 离开 `pending` 再返回,否则成功会被报成失败 | §5 表;P-08;R-2「`complete` 后读到 pending,253 ms 后 connected」 |

**测量记录**

探针放在仓外临时目录 `~/.l5-mcp-oauth-probe.JtsOUd/`,没有提交。`probe.ts` 由 bun 1.4.4 运行,`driver.mjs` 跑在 Electron 自带的 node 里。

真件:
- `dist-engine/engine.mjs`,按 `sidecar.ts:143-171` 的顺序启动:先装围栏,再设证书和环境代理,最后 import 并 `startEngine`;
- 生产的 `renderProcessFenceProfile` + `trialCompileProfile` + `buildFenceAddon`;
- 生产的 `startEgressPolicyProxy`(授权和询问都用生产函数,远端 MCP 由 `deriveMcpEgressDestinations` 派生);
- 生产的 `sidecarEgressProxyEnv` 与 `buildEngineServerOptions`;
- 经 L5 的 `engineClient` 调引擎。

替身:
- 本机的 OAuth 服务器加远端 MCP:回环 HTTP 一个;TLS 一个,同时服务 `mcp-same` / `mcp-split` / `auth-split` / `mcp-deny` / `auth-deny.l5probe.test`,用自签 CA,只经 `NODE_EXTRA_CA_CERTS` 交给子进程;
- 代理的拨号:把 `*.l5probe.test` 映到本机 TLS 替身。授权仍然按名字判;
- 出网确认对话框:对 `auth-split` 答「本次允许」,对 `auth-deny` 答「拒绝」;
- 浏览器:由探针进程跟随 302,它和真浏览器一样在围栏外。

全程用隔离的 HOME / XDG / TMPDIR,没有碰 owner 的 `~/.local/share/opencode`、浏览器或钥匙串。

```
~/.bun-versions/1.4.4/bin/bun ~/.l5-mcp-oauth-probe.JtsOUd/probe.ts ~/.l5-mcp-oauth-probe.JtsOUd bare     # R-1
~/.bun-versions/1.4.4/bin/bun ~/.l5-mcp-oauth-probe.JtsOUd/probe.ts ~/.l5-mcp-oauth-probe.JtsOUd fenced   # R-2
```

R-1(对照组,不装围栏,`run-bare-1794461806539`):本机替身能完整走通,证明下面 R-2 里的本机拒绝来自围栏,而不是替身本身有问题。

```
loop connect/oauth OK in 10ms {"mode":"auto","paste":true,...}
loop browser -> engine callback 127.0.0.1:63484/callback {"status":200,"contentType":"text/html","title":"Authorization successful · OpenCode"}
loop attempt terminal {"status":"complete"}   loop mcp status 253ms after attempt terminal {"status":"connected"}
```

R-2(装围栏,`run-fenced-1794461868847`):

```
driver {"event":"fence","rc":0,"buildId":"l5-probe-1794461868862"}   runtime node 24.15.0 / electron 42.3.3   engine 2.2.5
profile network: (deny network*) | (allow network-bind (local ip "localhost:*")) | (allow network-inbound (local ip "localhost:*")) | (allow network-outbound (remote ip "localhost:63525"))
loop  connect/oauth REFUSED after 4ms {"message":"fetch failed"}
      engine.log: mcp oauth authorization setup failed … connect EPERM 127.0.0.1:63523 … POST /api/integration/mcp_28aedf78ea8630a0/connect/oauth 400
      fake saw: 0 requests on 127.0.0.1
same  connect/oauth OK in 9ms; browser -> authorization endpoint 302 -> http://127.0.0.1:63543/callback?code=…&state=…
      browser -> engine callback 200 text/html "Authorization successful · OpenCode"; attempt complete
      mcp status right after attempt terminal {"status":"pending"}; 253ms after {"status":"connected"}
split approver asked at 3161ms (engine's startup connect; sign-in began at 3433ms) -> granted
      status before sign-in needs_auth; connect/oauth OK; callback 200; complete; 254ms after {"status":"connected"}
deny  approver asked at 3161ms -> refused; status before {"status":"failed","error":"fetch failed"}
      proxy auth-deny.l5probe.test:443 deny unregistered 403; connect/oauth REFUSED {"message":"fetch failed"}
      engine.log: Proxy response (403) !== 200 when HTTP Tunneling
readiness add same-other-name {"status":"needs_auth"}; add same {"status":"connected"}
```

测量的边界(推断,未实测):
- 打包版(utilityProcess + 包内 engine.mjs)没跑,归 L7;
- 真浏览器访问回环监听没跑。seatbelt 只约束引擎那一侧;
- 探针里没装 `@codepuppy/ext`。ext 不碰集成 OAuth,只把 `oauth` 字段原样透传(`lane/1665-l3-ext` `abfbaac7a9` `packages/ext/src/engine-transforms.ts:45-46`);
- 真实授权服务器的行为没测(见留档)。

**审查**

尚未送审(`rounds: 0`)。

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| 2.x 每次登录用临时端口,重新登录时复用已注册的 DCR 客户端 | RFC 8252 §7.3 要求回环地址不限端口,但严格按 `redirect_uri` 全等匹配的服务器会拒绝重新登录;0.1.26 端口固定在 19876,没有这个问题。未核实 | 上游行为,验收只要求能登录;Code Puppy 若固定端口,并发登录会撞端口 | 有用户报重新登录时 redirect_uri 不匹配 |
| 授权服务器在另一台主机时,出网确认在引擎启动时弹出,而不是点登录时 | 实测见 P-04。0.1.26 的 v1 匿名连接同样会做发现(按 SDK 行为推断,没在 0.1.26 上跑) | `#1412` 的现行行为,本段不改 | 有用户报启动时出现不明来由的出网确认 |
| 2.x 对支持 CIMD 的服务器用 opencode.ai 的客户端元数据 | 授权页显示 OpenCode,与 0.1.26 的 DCR 名一致;云 MCP 是 `oauth:false`,不会走到这里 | 不在验收里,也不是回调页(ADR-042 只管回调页) | owner 要求授权页也换品牌 |
