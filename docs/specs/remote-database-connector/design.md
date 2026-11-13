---
id: DESIGN-remote-database-connector
title: 远程数据库连接器在出网围栏内连接 PostgreSQL / MySQL 技术设计
summary: 用户在连接器窗口填写并确认的「地址:端口」写进只有主进程能写的目标真源,作为动态半场的成员进入策略代理的放行集合;连接器进程里的隧道垫片把数据库驱动的 TCP 连接改走现有 CONNECT 代理,seatbelt 围栏一字不改;只读靠 DBHub 只读配置加只读事务,能约束整棵进程树的只有数据库账号权限;密码沿用官方连接器密钥保管;Windows/Linux 本期不交付
kind: tech-design
status: draft
spec: SPEC-remote-database-connector
spec_version: 1
review:
  rounds: 0
  reviewed_sha: ""
  verdict: ""
owners: [owner]
last_reviewed: 2026-11-12
---

# DESIGN-remote-database-connector｜远程数据库连接器 技术设计

只放决定:契约、落点、失败处理、拆分、回滚、裁决。文件清单、提交顺序与测试归实施方的 `plan.md`。§3、§7 已退役,编号不复用。

坐标约定:`A` = `origin/alpha@c01ea14919`(本设计的基线,OpenCode 2 换代已合入)。DBHub 证据来自本机 npx 缓存 `~/.npm/_npx/62032edc1c017e46/node_modules/`(下称 `N`,内含 `@bytebase/dbhub@1.5.0`、`pg@8.23.1`、`mysql2@3.24.6`;只读,未执行)。「测」= 本设计跑过的命令;「读」= 读码得出;「推」= 推断,未验证。

## 1. 基线

- Spec:[SPEC-remote-database-connector v1](https://github.com/impharaon/alpha-code/blob/c01ea149199e6697c4cd6bd0cdfdb710404f9ff2/docs/specs/remote-database-connector/spec.md)(owner 2026-11-12 批准;首批 = PostgreSQL 与 MySQL、只读、只做 macOS)。
- 覆盖:AC-01 至 AC-08 全部。
- 引用、不复制:[SPEC-tool-network-egress v1](../tool-network-egress/spec.md) BR-01(代理单一注册表授权、未知 host:port 拒绝)、BR-02(围栏覆盖 sidecar 全部派生进程)、BR-03(代理不在不回退直连);[SPEC-official-readonly-connectors v1](https://github.com/impharaon/alpha-work/blob/f5ad266ef294aa23e448be1e0b7ed6728346e21b/docs/specs/official-readonly-connectors/spec.md) BR-02(现有 SQLite 只读连接器)。
- 背景:INT-safety/I-08;原票 alpha-code#1514 2026-10-13 的五个问题(精确放行还是代理隧道、防模型/项目配置借道、放行生命周期、seatbelt 规则如何生成与测试、Windows/Linux 现状),逐一在 §4、§6、§10 作答。
- 待 owner:O-1(确认文案与真实放行范围,见 §10)。设计在 A、B 两个选项下相同,只差文案。

## 2. 地面真相

每条只记本设计依赖的行为。

- **P-01 seatbelt 的出网规则只认 `*` 或 `localhost` 作主机**(测,macOS 26.3.1):`sandbox-exec -p '(version 1)(allow default)(deny network*)(allow network-outbound (remote ip "203.0.113.5:5432"))' /usr/bin/true` → `host must be * or localhost in network address`;`db.example.com:5432` 同样报错;`*:5432`、`localhost:5432` 编译通过。⇒ 「只放行用户填的那一个地址」在 seatbelt 层写不出来,能写的只有 `*:5432`(对所有主机开 5432)。
- **P-02 围栏现状**(读):`packages/ui-mac/src/main/process-fence-profile.ts:150-180` 渲染 `(allow default)` + `(deny file-write*)` + 写白名单 + N1 `(deny network*)`(连 DNS 的 mDNSResponder 一起拒)+ N2/N3 loopback bind/inbound + N4 `(allow network-outbound (remote ip "localhost:<代理端口>"))`。**读文件不受围栏限制**;系统临时目录 `/private/var/folders` 在写白名单 W12(`:56`、`:167`)。围栏装上后不能加宽、嵌套 seatbelt 只在策略完全相同时放行(`:5`、`:14-17`)⇒ 不能给某一个子进程单独多开一条。
- **P-03 策略代理**(读):`network-egress-proxy.ts` 只做 CONNECT 隧道,不看隧道内容(`:3-5`);DNS 只在 main 的代理里解析,顺序「解析 authority → 查授权 → 才拨号」(`:18-21`、`:263-265`);授权 = `isEgressAuthorizedForSidecar`(`:229`);失败形态 403 unregistered / 400 / 405 / 503·502·504 dial-failed(`:23-31`);在途隧道集合 `live`(`:236-240`),目前不按目的地索引。静默兜底只在客户端字节流以 TLS 记录头 `0x16 0x03` 开头时起计时(`:312-327`);PostgreSQL 先发 8 字节 SSLRequest、MySQL 由服务器先发握手包,两者都不以 `0x16 0x03` 开头(推,协议事实)⇒ 不受影响。
- **P-04 放行集合三个半场**(读):静态表(`network-egress-registry.ts:91-127`)∪ 动态半场(`network-egress-derived.ts`,规则:目的地必须有一个**围栏外的真源**,配置文件在围栏可写集里所以不算数,`:21-35`)∪ 用户当场批准半场(`network-egress-grants.ts`)。动态半场整份替换、每代一次(`:49-53`、`:158-170`),准入只拒 loopback / 畸形 host / 坏端口,不拒私网字面量(`:158-166`)。用户批准半场拒私网 IPv4 字面量(`network-egress-grants.ts:92-127`),批准语义是「交给整棵围栏内进程树」(`:25-30`),撤销要删记录并重启(`server.ts:155-157`)。loopback 绝不进任何放行集合(owner 2026-09-21,`network-egress-registry.ts:68-81`、`:118-126`)。按名字授权、不做 IP↔名字等价,fake-IP 拓扑下按 IP 授权无意义(`network-egress-registry.ts:42-45`)。
- **P-05 sidecar 出网环境**(读):`sidecar-env.ts:292-312` 把 `HTTP(S)_PROXY`/`ALL_PROXY` 整份改写为 `http://127.0.0.1:<端口>`、`NO_PROXY=127.0.0.1,localhost,::1`,另写标记 `CODEPUPPY_EGRESS_PROXY`(`packages/schema/src/codepuppy-net-failure.ts:154`)。引擎起 stdio MCP 用 `extendEnv: true` 再叠加服务器的 `environment`(`packages/core/src/mcp/stdio.ts:30-35`、`:103-108`)⇒ DBHub 进程继承这些变量。
- **P-06 DBHub 1.5.0 连库不支持任何代理**(读 + 测):封闭配方命令固定为 `node npx -y @bytebase/dbhub@1.5.0 --transport stdio --config <toml>`(`official-connector-recipes.ts:81`、`official-connector-resources.ts:168-177`;目录侧解码器同样钉死,`shared/host-extension-package-contract/decoder.ts:1377-1381`)。PostgreSQL 连接器只把 host/port 交给 `pg.Pool`(`N/@bytebase/dbhub/dist/postgres-KCFNDQLG.js:153-160`、`:292`);`pg` 无 `stream` 配置时 `new net.Socket()` 再 `stream.connect(port, host)`(`N/pg/lib/connection.js:19`、`:45`,`N/pg/lib/stream.js:21-23`);`mysql2` 无 `stream` 时 `Net.connect(port, host)`(`N/mysql2/lib/base/connection.js:98-102`)。`grep -iE "proxy|socks|stream:|ssh|tunnel"` 在两个连接器文件里零命中(测)。⇒ 围栏内:主机名死在 DNS(N1),IP 字面量 `connect()` 得 EPERM,与原票 2026-10-13 的现象一致。两个驱动的 TLS `servername` 都取原 host(`N/pg/lib/connection.js:100-124`;`N/mysql2/lib/base/connection.js:431-467`)。npx 按 `^` 范围解析可选依赖,别的机器上驱动小版本可能不同(推)。
- **P-07 DBHub 1.5.0 的只读与输出**(读):`readonly = true` 时先按首关键字白名单拦(postgres `select/with/explain/show`,mysql 另加 `describe/desc`;`N/@bytebase/dbhub/dist/chunk-55X2VY5D.js:6-19`、`:123-170`;拒绝返回 `READONLY_VIOLATION`,`dist/index.js:292-297`),再把每条语句放进只读事务(PostgreSQL `BEGIN READ ONLY`,`postgres-KCFNDQLG.js:707-715`;MySQL `START TRANSACTION READ ONLY`,`chunk-SJ5BRPQA.js:455-466`)。数据源默认**启动即连**,连不上进程退出(`chunk-PDKPK25P.js:1968-1983`、`index.js:1995-1999`)。启动输出里 DSN 经 `obfuscateDSNPassword` 打码(`chunk-PDKPK25P.js:897-899`、`:2047`;`chunk-IXC4NQGC.js:192`),启动表只列 host 与库名(`index.js:1622-1627`)。`SafeURL` 按最后一个 `@` 切分并对用户名、密码做 `decodeURIComponent`(`chunk-IXC4NQGC.js:56-107`)。sslmode:PostgreSQL 只认 `disable|require|verify-ca|verify-full`,没有 `prefer`(`postgres-KCFNDQLG.js:66-67`、`:177-181`);MySQL `disable` = 无 TLS、`require` = TLS 不验证(`mysql-ZXO4TWLG.js:71-77`);不写 sslmode = 不用 TLS。
- **P-08 官方连接器的密钥保管**(读):safeStorage 密文 `<casBaseRoot>/connector-secrets/<env>/<name>/<version>/secret.enc`(`official-connector-resources.ts:85-94`、`:181-203`);运行时把明文 DSN 落成 0600 文件,放在系统临时目录下 0700 的本次运行目录里,引擎配置只放 `{file:…}` 引用,TOML 里是 `${DSN}`(`:153-179`、`:205-239`;契约 [`extension-package-lifecycle.md`](../../contracts/extension-package-lifecycle.md)「Official GitHub and SQLite recipes」)。该目录在 W12 之下,围栏内进程**读得到**(由 P-02 推出)。非 macOS 在输入密钥之前就拒(`official-connector-recipes.ts:21-27`)。DBHub 的密钥目前只收已存在的本机 `sqlite:///` 文件(`official-connector-resources.ts:141-151`)。
- **P-09 生命周期入口**(读):安装/更新与卸载官方连接器都先停 sidecar,完成后 `officialRuntime.refresh()`(`ext-ipc.ts:1247-1297`);启用/停用只请求扩展重载,不 fork(`ext-ipc.ts:1159-1175`)。动态半场只在 fork 前重算(`server.ts:231-251`、`:504-506`)。安装台账 `installs.json` 在 `codepuppyGlobalRoot` 下(`ext-receipt-v2.ts:97`、`:317`),即可写集 W2(`process-fence-profile.ts:48`、`:156`);引擎配置里的连接器条目也在 W2 ⇒ **围栏内进程写得了**台账的 `desiredState` 和条目引用的版本。主进程独占的真源都放在 `casBaseRoot` 下与 `env/` 同级(`egress-grant-truth.ts:1-26`、`:42-45`;`mcp-server-records.ts:5`)。
- **P-10 填写入口**(读):安装窗口 `renderer/extensions/install-confirm.tsx` 对前置条件 `mcp:dbhub-readonly#DSN` 单独出字段(`:383-395`),按前置条件 id 提交 `grants.secrets`(`:184-195`)。准入在用户看过授权预览之前拒收任何密钥值(`main/package-admission.ts:288-293`);助手安装路径 `ext-agent-install.ts` 不携带密钥(`grep -n -iE "secret|grants|official|dbhub|prerequisite"` 只命中无关的类型导入与注释,测)。
- **P-11 连接失败怎么到界面**(读):stdio 服务器意外退出时,引擎报 `MCP server process exited with code N: <stderr 末尾 1000 字>`,stderr 同时进调试日志(`packages/core/src/mcp/stdio.ts:17-19`、`:177-186`、`:211-216`);failed 状态带 `error` 字段(`packages/core/src/mcp/connection.ts:225`)。宿主核验把非 connected 一律压成 `failed` 且丢掉原因(`main/ext-mcp-activation.ts:150-189`)。
- **P-12 已有的失败权威**(读):拨号失败状态码 `EGRESS_DIAL_FAILURE_STATUS = { dns: 503, tcp: 502, timeout: 504 }` 与 `classifyNetFailure`(`packages/schema/src/codepuppy-net-failure.ts:53`、`:73-123`);拒绝正文前缀与解析器 `EGRESS_DENIED_BODY_PREFIX` / `egressPolicyDenialOf`(`shared/egress-denial.ts:25-52`)。
- **P-13 跨仓文字**(读,alpha-web `origin/main@81a5322`):目录包 `catalog-src/packages/package.dbhub-readonly/1.0.0/codepuppy-package.json:4-5` 写「数据库（本机 SQLite，只读）」「只支持本机 SQLite 数据库文件」;`contracts/extension-package/CONTRACT.md:207-219` 写「DBHub supports local SQLite files only」;注册表能力 `codepuppy.official-connectors.v1` 的说明「DBHub SQLite readonly recipes」(本仓 vendored 副本 `packages/codepuppy-contracts-consumer/vendor/alpha-web-extension-package/host-extension-package.registry.v1.json:52`)。

**未核实,有界**(实施方第一步的探针见 §10 D1;每条写明停止条件):

| 编号 | 问题 | 能改变的决定 | 停止证据 |
| --- | --- | --- | --- |
| U-1 | 隧道垫片能否让 `pg` 与 `mysql2` 在真围栏里经代理连通(含 TLS) | §4 C4 机制是否成立 | 两种库各一次真实 `SELECT 1` 成功,且去掉垫片的对照臂失败 |
| U-2 | `NODE_OPTIONS --require "<含空格的绝对路径>"` 经 npx 传到 DBHub 进程 | 垫片的装载方式 | DBHub 进程内垫片生效(对照臂同上) |
| U-3 | 引擎 failed 状态的 `error` 是否保留足以分类的 stderr 末尾(SQLSTATE 28P01/28000、MySQL 1045、拒绝正文) | §4 C8 能否给出「账号不对」 | 错误口令时经 `GET /api/mcp` 读到的 `error` 含该码 |
| U-4 | 运行后项目文件、应用日志、对话记录里没有密码 | AC-07 | 三类位置 `grep -a` 零命中,且同一 grep 对故意写入密码的对照文件命中 |
| U-5 | 含 `@:/?#%` 的密码、含空格的库名经 `composeDatabaseDsn` 后被 DBHub 正确解析 | §4 C5 编码规则 | 两例真实登录成功 |

## 4. 接口契约

### 机制一句话

用户在窗口提交并确认 → 主进程写**数据库目标真源** → 该目标作为**动态半场的数据库成员**进入代理放行集合 → DBHub 进程里的**隧道垫片**把驱动的 TCP 连接改成发往策略代理的 CONNECT → 代理按名字解析、只放行那一个 `host:port`。seatbelt 围栏(N1–N4)不变。

### C1 数据库目标真源(主进程独占,唯一权威)

```ts
// 读端:packages/ui-mac/src/main/database-target-truth.ts(零写盘,读经注入的 fs,electron-free)
// 写端:单独文件,只在 main 的 import 闭包里(同 egress-grant-truth-write.ts 的拆法)
// 路径:<casBaseRoot>/database-targets/<env>.json —— 与 env/、egress-grants/、mcp-servers/ 同级,不在任何可写根之下
export const DATABASE_TARGETS_DIRNAME = "database-targets"
export const DATABASE_TARGET_TRUTH_VERSION = 1

export type DatabaseTargetTruthV1 = {
  v: 1
  connector: "dbhub-readonly"     // 唯一合法值:本期只有这一个连接器能拥有网络目标,也只有一个目标
  version: string                 // 已提交的密钥版本,/^[a-zA-Z0-9][a-zA-Z0-9-]{0,95}$/(同 officialConnectorPaths)
  dialect: "postgres" | "mysql"
  host: string                    // 小写 DNS 名或点分 IPv4;过 isEgressHostShape 且 !isLoopbackHost
  port: number                    // 整数 1..65535
  enabled: boolean                // 跟随用户最近一次启用/停用
  approvedAt: string              // ISO-8601 UTC,用户提交确认的时刻(出处坐标)
}

export type DatabaseTargetTruthRead =
  | { ok: true; absent: true }                                   // 文件不存在:SQLite 或未安装,正常状态,零日志
  | { ok: true; absent: false; target: DatabaseTargetTruthV1 }
  | { ok: false; reason: string }                                // 解析失败/版本未知/多余键/字段不合法:出一行日志,行为同「没有目标」
```

写入(只由主进程,只在下列时刻;整份原子替换,0600,先写临时文件再改名):

| 触发 | 写什么 | 顺序 |
| --- | --- | --- |
| 安装或更新 `package:dbhub-readonly` 提交成功,DSN 是 postgres/mysql | 用本次事务描述里的版本解密密文、`parseDatabaseDsn` 解析,写入 `enabled = 本次期望状态` | 提交之后、sidecar 重新 fork 之前(放行在最后) |
| 同上,DSN 是 `sqlite:///` | 删除文件 | 同上 |
| 启用 | `enabled = true` | 状态提交之后 |
| 停用 | `enabled = false` | 状态变更之前(先撤销) |
| 卸载 | 删除文件 | 卸载动作之前(先撤销) |

版本只取事务描述,不取台账或引擎配置(P-09:两者围栏内可写)。用户改地址 = 现有官方连接器的重新填写/更新路径(新密钥版本,成功后旧版本退役,契约 [`extension-package-lifecycle.md`](../../contracts/extension-package-lifecycle.md)),不新造编辑流程。

物化一致性:每次把 postgres/mysql 的 DSN 物化成运行时文件时(`restoreOfficialConnector` 一类入口),要求真源存在、`enabled`、`version` 等于本次物化的版本、`dialect/host/port` 等于解析出的 DSN;任一不符 ⇒ 现有 `official-connector-needs-reentry`,空运行时引用。这条把「围栏内可写的条目引用」绑回主进程独占的真源。

### C2 动态半场的数据库成员

```ts
// packages/ui-mac/src/main/network-egress-derived.ts
export function deriveDatabaseTargetEgressDestinations(read: DatabaseTargetTruthRead): ConfiguredEgressDestination[]
// read.ok && !read.absent && read.target.enabled ⇒
//   [{ host, port, providerId: "db:dbhub-readonly", baseURL: `${dialect}://${host}:${port}` }]   // 不含任何凭据
// 其余 ⇒ []

export function setDatabaseTargetEgressDestinations(list: readonly ConfiguredEgressDestination[]): ConfiguredEgressDestination[]
// 与 setConfiguredEgressDestinations 同一套准入(非 loopback、isEgressHostShape、端口范围),独立整份替换;
// isConfiguredEgressDestination 同时查两份 ⇒ isEgressAuthorizedForSidecar 的三场并集形状不变
```

刷新时刻:(1) 每次 fork 前,`refreshConfiguredEgressDestinations`(`server.ts:231-251`)读真源并设数据库成员,读失败 ⇒ 设 `[]` 并出错误日志(fail-closed,不影响另两份);(2) C1 每次写入之后立即重读并设置,随后执行 C3。数据库成员单独替换,所以停用/启用不会顺带提前重算 BYOK 与远程 MCP 那两份。日志沿用「configured destination(s) authorized」那一行,出处标签 `db:dbhub-readonly`。

HTTPS-only 那条准入(`network-egress-derived.ts:37-46` 第 2 条)只属于 URL 派生,不适用于这里:数据库协议在连接内部协商 TLS,代理本来就是不看内容的管道(P-03)。

### C3 撤销时切断在途隧道

```ts
// packages/ui-mac/src/main/network-egress-proxy.ts:EgressProxyHandle 增加
closeTunnelsTo(destinations: readonly { host: string; port: number }[]): number
// 关闭目的地在列表里、且此刻 authorize(host, port) 为假的在途隧道:两端 destroy,照常写 egress.tunnel-closed;返回关闭条数
```

只由数据库成员的撤销调用,参数 = 上一份数据库成员减去新一份。列表为空 ⇒ 零动作,所以没有数据库目标时代理行为与改动前逐字相同(AC-08)。同一 `host:port` 若同时被别的半场放行(例如用户在现有出网批准框里批过),不切。

### C4 隧道垫片(连接器进程内的管道,不是安全边界)

```text
位置:<realpath(resourcesRoot())>/db-connector/egress-tunnel.cjs —— 随签名 app 包发出,不在任何可写根之下
装载:只在 dbhub-readonly 的封闭配方、且已提交的 DSN 是 postgres/mysql 时,在服务器 environment 里写
      NODE_OPTIONS = --require "<上面的绝对路径>"     (带双引号:路径含空格;SQLite 时不写,已发布行为不变)
生效条件:进程 env 有 CODEPUPPY_EGRESS_PROXY = http://127.0.0.1:<端口>;没有 ⇒ 不打补丁(此时围栏照样拦)
行为:包装 net.Socket.prototype.connect
  · unix 路径、loopback(127.0.0.0/8、::1、localhost)⇒ 原样直连(含 npm 连代理本身)
  · 其他 TCP 目标 ⇒ 本进程不解析 DNS;连 127.0.0.1:<端口>,发
        CONNECT <host>:<port> HTTP/1.1\r\nHost: <host>:<port>\r\n\r\n      (IPv6 字面量写成 [v6]:port)
  · 收到 200 之前:驱动收不到 'connect',驱动写出的字节扣住、不进代理
  · 200 ⇒ 发 'connect',响应头之后多出的字节作为 'data' 交给驱动;之后是透明双向管道,TLS 由驱动自己在上面握手(servername = 原 host)
  · 非 200 ⇒ 用 Error 销毁 socket,不重试、不直连:
        403                                  ⇒ code "ECODEPUPPY_EGRESS_DENIED",message = 代理正文原文(以 EGRESS_DENIED_BODY_PREFIX 开头)
        EGRESS_DIAL_FAILURE_STATUS.dns  (503) ⇒ code "ENOTFOUND"
        EGRESS_DIAL_FAILURE_STATUS.tcp  (502) ⇒ code "ECONNREFUSED"
        EGRESS_DIAL_FAILURE_STATUS.timeout(504) ⇒ code "ETIMEDOUT"       (以上 message 带 host:port 与代理正文)
        其他状态 / 连不上代理                  ⇒ code "ECODEPUPPY_EGRESS_PROXY",message 带状态行;代理不在 = 响亮失败(egress BR-03)
  · 只读 CODEPUPPY_EGRESS_PROXY 一个变量;不读、不写、不打印 DSN 或其他环境值;它只见得到 host:port
```

垫片被改掉或去掉,结果只是连接器连不上;放不放行只由代理判(I3)。

### C5 共享 DSN 模块(渲染进程与主进程共用的唯一形状)

```ts
// packages/ui-mac/src/shared/database-dsn.ts —— 纯函数,electron-free,渲染进程可引
export const DATABASE_DIALECTS = ["postgres", "mysql"] as const
export type DatabaseDialect = (typeof DATABASE_DIALECTS)[number]
export const DATABASE_DEFAULT_PORT = { postgres: 5432, mysql: 3306 } as const satisfies Record<DatabaseDialect, number>
export type DatabaseTls = "require" | "disable"

export type DatabaseDsnParts = {
  dialect: DatabaseDialect
  host: string        // 小写;不含 scheme/userinfo/path/方括号
  port: number        // 整数 1..65535,DSN 里必须显式写出
  database: string    // 1..128 字符
  user: string        // 1..128 字符
  password: string    // 0..1024 字符(可空:服务器可能不用口令认证);永不进日志
  tls: DatabaseTls    // 来自 C7 探测结果,不是用户字段
}

export function composeDatabaseDsn(p: DatabaseDsnParts): string
// `${dialect}://${enc(user)}:${enc(password)}@${host}:${port}/${enc(database)}?sslmode=${tls}`,enc = encodeURIComponent
// 任一字段含 NUL/CR/LF 或越界 ⇒ 抛错
export function parseDatabaseDsn(dsn: string): DatabaseDsnParts | undefined
// 只认 compose 产出的形状:scheme ∈ DATABASE_DIALECTS、显式端口、恰好一个查询参数 sslmode ∈ {require, disable};否则 undefined
// 不变量:parseDatabaseDsn(composeDatabaseDsn(p)) 深等 p
```

host 的准入(形状、非 loopback)不在本模块:判据住在 `main/network-egress-registry.ts`,渲染进程引不到(模块地图:渲染进程不得依赖 main 私有模块)。主进程在 `parseDatabaseDsn` 之后再判,C7 探测把判定结果交给窗口。

### C6 主进程收密钥时的准入

`assertOfficialConnectorSecret("dbhub-readonly", value)`(`official-connector-resources.ts:141-151`):`sqlite:///` 开头 ⇒ 现有规则原样;否则必须 `parseDatabaseDsn(value)` 成功且 host 过 `isEgressHostShape && !isLoopbackHost`;不过 ⇒ 现有 `officialConnectorFailure()`(错误里不带任何值)。密钥线(前置条件 id `mcp:dbhub-readonly#DSN`、`grants.secrets`、授权预览之后才收)不变,目录载荷与解码器不变(P-06、P-10)。

### C7 提交前的目标探测(只读 IPC,渲染进程 → 主进程)

```ts
// channel "ext-database-target-probe" —— 不写任何状态,不进 ext-write-channels 写通道表
type DatabaseTargetProbeRequest = { dialect: DatabaseDialect; host: string; port: number }
type DatabaseTargetProbeResult =
  | { ok: true; tls: boolean }   // postgres:发 SSLRequest 收到 'S';mysql:握手包 capability 含 CLIENT_SSL(0x0800)
  | { ok: false; reason: "not-allowed"; rejection: "dialect" | "host-shape" | "loopback" | "port" }   // 准入不过,不拨号
  | { ok: false; reason: "unreachable"; layer: "dns" | "tcp" | "timeout" | "protocol" }              // protocol = 连上了但不是该方言
// 拨号在 main:net.connect(与代理 defaultDial 同口径,autoSelectFamily),整体 5 s;不发任何凭据;读到判定所需字节即关闭
// 层用 classifyNetFailure(packages/schema/src/codepuppy-net-failure.ts:73)判,不另写一份
```

窗口用 `tls ? "require" : "disable"` 组 DSN。效果等同 libpq 默认的 `prefer`(服务器给 TLS 就用,不给就不用),用户不需要懂 TLS。

### C8 连接失败原因回到窗口

```ts
// shared:
export type DatabaseConnectFailure = "not-allowed" | "unreachable" | "auth" | "other"
// main/ext-mcp-activation.ts:McpVerification 增加
failure?: DatabaseConnectFailure   // 只对 dbhub-readonly 且 status === "failed" 填;原始 error 文本不过线
```

分类在主进程,输入是引擎 failed 状态的 `error`(P-11),按顺序取第一条命中:`egressPolicyDenialOf` 命中或含 `ECODEPUPPY_EGRESS_DENIED` ⇒ `not-allowed`;含 `ENOTFOUND`/`ECONNREFUSED`/`ETIMEDOUT` ⇒ `unreachable`;含 PostgreSQL SQLSTATE `28P01`/`28000` 或 MySQL errno `1045` ⇒ `auth`;其余 ⇒ `other`。hub-view 这一行在现有 `stateReason` 旁带 `databaseFailure`,只带码。

窗口文案映射(体验约定的三种原因):C7 `not-allowed` 与 C8 `not-allowed` → 未放行;C7 `unreachable` 与 C8 `unreachable` → 地址不通;C8 `auth` → 账号不对;C8 `other` → 现有的通用失败文案。

### C9 窗口(复用 `install-confirm.tsx`,只加字段)

对前置条件 `mcp:dbhub-readonly#DSN`:先选数据库类型(本机 SQLite 文件 / PostgreSQL / MySQL)。SQLite = 现有单字段,行为不变。PostgreSQL/MySQL = 地址、端口(按类型预填 `DATABASE_DEFAULT_PORT`)、数据库名、账号、密码(`type=password`)和放行确认;勾选确认后提交 → 先跑 C7 → 成功才用 `composeDatabaseDsn` 组值、按原前置条件 id 提交。密码只活在本次窗口状态里,不回显、不持久化。类型选择是区分两种数据库所必需的,不是新增限制。确认句文案取决于 O-1。

### 数据

用户数据库零 schema 变更。新增文件只有 C1 的真源;密文、运行时文件、日志格式沿用现有。

### 事件 / 配置

不新增配置键。默认端口、探测超时 5 s 是固定常量,住在各自模块里。

## 5. 数据与失败

**顺序原则:放行在最后,撤销在最前。** 安装/启用先完成连接器状态再写真源;停用/卸载先撤销真源再动连接器。中途失败只会出现「连接器在、目标不在」(连不上,fail-closed),不会出现「连接器没了、目标还放行」。

| 失败窗口 | 结果 | 用户看到 |
| --- | --- | --- |
| 安装提交成功、写真源失败 | 物化一致性不过 ⇒ needs-reentry,连接器停用;目标不在放行集合 | 现有「需要重新填写」;重新提交即可 |
| fork 前读真源失败 | 数据库成员 = `[]`,错误日志;另两份照常 | 查询失败,原因「未放行」 |
| 停用:真源已写 `enabled=false`、状态变更失败 | 连接器仍启用但连不上 | 「未放行」;重试停用 |
| 卸载:真源已删、清理失败 | 现有逻辑保留台账供重试;目标已不放行 | 现有卸载重试 |
| 撤销时有在途隧道 | C3 切断;安装/卸载本来就会停 sidecar(P-09) | 进行中的查询失败 |
| 代理不在 | 垫片报 `ECODEPUPPY_EGRESS_PROXY`,不直连 | 通用失败(egress BR-03) |
| 批准后主机名改指向别的 IP | 按名字放行,连接跟着名字走 | 无感(见 R2) |
| 探测之后服务器改了 TLS 设置 | 连接时 TLS 报错 ⇒ `other` | 重新提交(重新探测) |

幂等:真源每次整份替换;提交后的投影可重复执行,结果相同。没有重试循环:垫片与代理都不自动重试。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| 数据库目标真源读/写(C1) | `packages/ui-mac/`(main) | `codepuppy-environment` 的 `casBaseRoot` | 真源的位置与读写拆法照 `egress-grant-truth.ts:1-45` |
| 动态半场的数据库成员(C2) | `packages/ui-mac/`(main)`network-egress-derived.ts` | 注册表的两个判据 | `isEgressHostShape` / `isLoopbackHost`(`network-egress-registry.ts:66-81`);并集 `isEgressAuthorizedForSidecar`(`network-egress-derived.ts:194-196`) |
| 撤销切隧道(C3) | `packages/ui-mac/`(main)`network-egress-proxy.ts` | 现有 `authorize` | 在途集合 `live`(`:236-240`) |
| 封闭配方、密钥准入、物化一致性(C4 装载、C6、C1 一致性) | `packages/ui-mac/`(main)官方连接器两个文件 | `shared/database-dsn.ts` | 现有密钥保管(`official-connector-resources.ts:141-239`) |
| DSN 形状(C5)、失败码类型(C8) | `packages/ui-mac/src/shared/` | 无 | — |
| 目标探测 IPC(C7) | `packages/ui-mac/`(main)扩展 IPC | `node:net`、schema | `classifyNetFailure`(`packages/schema/src/codepuppy-net-failure.ts:73`) |
| 失败分类(C8) | `packages/ui-mac/`(main)`ext-mcp-activation.ts` / `hub-view.ts` | `shared/egress-denial.ts` | `egressPolicyDenialOf`(`shared/egress-denial.ts:52`) |
| 窗口字段(C9) | `packages/ui-mac/`(renderer)`extensions/install-confirm.tsx` | `shared/database-dsn.ts`、C7 | 现有窗口(`install-confirm.tsx:383-395`) |
| 隧道垫片(C4) | `packages/ui-mac/resources/db-connector/`(随包资源) | 运行时无依赖 | `EGRESS_DIAL_FAILURE_STATUS`(见 K2) |
| seatbelt profile | 不改 | — | `process-fence-profile.ts:175-180` |

- 新目录:`packages/ui-mac/resources/db-connector/`。它是要被装进第三方进程的随包资源,与 `resources/office-mcp/` 同类;仍在 `packages/ui-mac/` 之内,[模块地图](../../architecture/modules.md)不变。
- 受影响的既有契约文档:[`extension-package-lifecycle.md`](../../contracts/extension-package-lifecycle.md)「Official GitHub and SQLite recipes」现在写「only existing local SQLite files are accepted」,实施时同一变更内更新。
- 架构约束([constraints.md](../../architecture/constraints.md)):K2,host 判据复用、不抄;DSN 形状只有 C5 一处;垫片运行在没有本应用模块图的外部进程里,503/502/504 只能抄一份,由一条从 `packages/schema/src/codepuppy-net-failure.ts:53` 派生期望值再比对的闸守住(同 `network-egress-registry.ts:114-115` 的做法),不形成新偏离。K1 不涉及。无需例外。
- 工程标准:不加配置项;密钥没有默认值;错误沿用现有码与 needs-reentry 合同;日志只写 `host:port` 与出处标签,不写 DSN 或密码。
- 被否决的替代(各一句理由):
  1. **在 seatbelt 里精确放行用户填的地址**:写不出来(P-01),只能写 `*:<端口>`,那是对所有主机开放该端口,即放宽围栏;何况围栏内没有 DNS,按 IP 授权在 fake-IP 拓扑下也没有意义(P-04)。
  2. **主进程起一个本机端口转发(127.0.0.1:L → 目标)**:要给 profile 加一行 `localhost:L`,还要把 DSN 的 host 改成 127.0.0.1,使 SNI 路由(Neon 一类)与 verify-full 主机名校验失效(P-06)。保留为 U-1 失败时最窄的退路,需要设计修订。
  3. **让 DBHub 跑在围栏外**:违反 egress BR-02,DBHub 获得不受限的出网。
  4. **只给连接器进程发门票(代理凭据)**:读文件不受围栏限制(P-02),发给连接器的任何凭据整棵树都读得到;loopback 上没有调用方身份(P-04)。要做到得先建读隔离与进程身份框架,规格「不包括」通用出网框架。
  5. **把目标放进用户当场批准半场**:那一半拒私网字面量(公司库常在 10/8、172.16/12),写入口是逐连接的弹框而不是配置窗口,撤销要重启(P-04),做不到 BR-03。
  6. **从台账或引擎配置派生目标**:两者都在围栏可写集里(P-09),围栏内代码能给自己放行(confused deputy)。
  7. **窗口加 TLS 选项**:多一个用户得懂的概念,规格没有这个字段;C7 探测让它不可见。
  8. **写死 `sslmode=require` 或不写**:前者连不上不开 TLS 的自建库,后者连不上强制 TLS 的云库(P-07)。

### 安全面

威胁边界:围栏内进程树(引擎、助手跑的命令、MCP 子进程、插件)不可信;主进程、渲染进程、签名 app 包可信;用户在窗口里的提交是唯一的放行来源。

不变量:

| 编号 | 不变量 | 落在 |
| --- | --- | --- |
| I1 | seatbelt profile 有无此连接器逐字节相同,N1–N4 不变 | C4、被否决 1 |
| I2 | 数据库目标只有一个写者:主进程处理用户的窗口提交、启用/停用、卸载;真源在所有可写根之外 | C1 |
| I3 | 代理只在真源 `enabled` 时放行该目标,精确 `host:port`;派生从不读围栏可写的存储;垫片不参与授权 | C1、C2、C4 |
| I4 | 至多一个数据库目标 | C1 |
| I5 | loopback 永不放行;私网地址放行,因为是用户在主进程窗口里亲手填的(与动态半场同一规则) | C2、C6、C7 |
| I6 | 停用、改地址、卸载先把目标移出放行集合,并切断到它的在途隧道 | C1、C3、§5 |
| I7 | 不回退直连:垫片永不直拨非 loopback 地址;代理不在 = 响亮失败 | C4 |
| I8 | 密码不进:真源、引擎配置、argv、sidecar 全局 env、事务日志、代理与出网日志、IPC 回复、hub-view、垫片错误 | C1–C8 |

原票五个威胁的答复:

- **DNS 重绑定 / 批准后主机名改指 IP**:按名字放行(R2)。
- **同一连接器的第二个进程**:同样只到得了那一个 `host:port`。
- **其他扩展借道**:到得了那一个 `host:port`(R1),别的地址照旧拒。
- **模型在工具调用里给目标**:DBHub 的工具只收 SQL,没有目标参数;助手命令连别的地址经代理被拒(私网字面量直接拒;公网主机名可能弹出现有出网批准框,点不点由用户,行为不变)。
- **项目文档**:写得了围栏内的配置,写不了真源;改条目引用只会让物化一致性失败。

残余风险(照实写):

- **R1 放行对整棵树生效,密码在树内读得到**:批准后,围栏内任何进程都能经代理连到 `host:port`;运行时 DSN 文件在 W12 且读不受限(P-02、P-08)。所以连接器层的只读管不到这些进程,能管到它们的只有数据库账号自身的权限。与现有出网批准(`network-egress-grants.ts:25-30`)、GitHub 令牌运行时文件同一类。→ O-1。
- **R2 按名字放行**:名字的 DNS 控制者能把它指到别的 IP 的同一端口。不钉 IP:fake-IP 拓扑与云库故障切换下钉 IP 会误伤。
- **R3 TLS**:探测时若有中间人去掉 TLS 宣告,会存成 `disable`,与 libpq `prefer` 同样的弱点;不提供 verify-full。
- **R4 连接器层只读的边界**:关键字白名单 + 只读事务拦得住数据写入;从 SELECT 能触达、又不是数据写入的服务器副作用(会话管理函数、开新连接的扩展函数等)由数据库账号权限决定。

## 8. 拆分决定

| 产出方(仓/负责) | 产出与 AC/设计小节 | 消费的契约 | 开工依赖 | 集成/验收依赖 |
| --- | --- | --- | --- | --- |
| alpha-code(本仓) | C1–C9 全部;AC-01 至 AC-08 的实现与证据 | 本设计 §4;封闭配方 `dbhub-readonly-v1` 的载荷不变 | 无 | 实施第一步跑 §10 D1 探针 |
| alpha-web | 目录包 `package:dbhub-readonly` 新版本的名称与说明改成涵盖 PostgreSQL/MySQL(去掉「只支持本机 SQLite」「填写 sqlite:// 地址」);`CONTRACT.md:219` 与注册表能力 `codepuppy.official-connectors.v1` 的说明同步;按现有收录与运行证据门发布 | 配方 id、命令、`DSN` 前置条件都不变(P-06、P-13) | 无(可与本仓并行准备) | **在包含本功能的桌面版发布之后再上线目录文字**,否则已装旧版的机器会看到做不到的承诺;本仓随后重新 vendor 契约固定副本;核心路径「在定制中心找到数据库连接器」的发布验收需要新文字 |

## 9. 回滚

- 用户层:停用或卸载立即撤销(I6),无需重启。
- 代码回滚(撤回版本):旧版不读真源文件;启动物化 postgres/mysql DSN 时旧版的准入只收 `sqlite:///`(`official-connector-resources.ts:145-151`)⇒ needs-reentry、连接器停用、不出网。无迁移。遗留:密文(加密,含密码)留到用户卸载;真源文件惰性无害。
- 目录文字:若桌面版回滚,先把 alpha-web 目录文字退回 SQLite 版。
- 用户数据库:只读,无数据后果。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| **D1 机制 = 经现有策略代理的隧道,不在 seatbelt 开口。** 目标进动态半场;DBHub 进程内的垫片把驱动的 TCP 改成 CONNECT。**实施第一步的探针**(有界):在 macOS 上用生产渲染的 profile 与真策略代理,(1) 用封闭配方命令 + 垫片对真实 PostgreSQL(开 TLS)与真实 MySQL 8 各跑一次 MCP `SELECT 1`;(2) 对照臂:去掉 `NODE_OPTIONS` 必须失败(EPERM/ENOTFOUND),目标不在放行集合必须得到含拒绝正文的错误;(3) 错误口令时引擎 failed 状态 `error` 含 28P01/1045(U-3);(4) U-5 两例。全过 ⇒ 继续。(1) 任一驱动不通 ⇒ `BLOCKED: design — §4 C4 — <驱动与错误>`,最窄退路是被否决 2(加一行 `localhost:<端口>`,不放宽对外出网,但 SNI/verify-full 失效),需设计修订;(3) 不过 ⇒ 回本设计 C8,不回规格 | P-01、P-03、P-05、P-06;`A` + DBHub 1.5.0 / pg 8.23.1 / mysql2 3.24.6(本机缓存)。垫片在 pg/mysql2 上的可行性是推断,待探针 |
| **D2 「用户批准的数据库目标」的权威 = C1 真源**,主进程独占、在可写根之外,只由窗口提交 / 启用停用 / 卸载写;经 C2 只进代理放行集合;版本取事务描述;物化时一致性校验 | P-04、P-09、P-10;`egress-grant-truth.ts` 先例 |
| **D3 生命周期**:放行在最后、撤销在最前;每次写真源立即刷新数据库成员并切断不再放行的在途隧道(C3);fork 前照常重算 | P-09(停用不 fork,所以刷新不能只挂在 fork 上) |
| **D4 只读 = 连接器层(DBHub `readonly = true`:关键字白名单 + 只读事务)**;数据库账号权限是唯一能约束整棵树的一层,不由本产品强制(规格未要求只读账号)。**AC-06 能如实证明的**:用一个有写权限的测试账号(这样证明的是连接器层,不是账号),经连接器工具执行 INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/TRUNCATE 全部返回 `READONLY_VIOLATION`,表的校验和不变。**证明不了的**:任何 SQL 文本都写不了(R4);树内其他进程拿到密码后绕过连接器(R1) | P-07;`N/@bytebase/dbhub@1.5.0` |
| **D5 密码保管 = 沿用官方连接器密钥机制**(safeStorage 密文 + 运行时 0600 文件 + `{file:}` 引用 + 退出删除),只放宽 DSN 的准入(C6)。**绝不能含密码的地方**见 I8。**AC-07 的搜索面**:工作区项目文件、应用日志目录与引擎日志(`<XDG_DATA_HOME>/opencode/log`)、引擎会话库(对话记录);分别在成功查询、错误口令、未放行三种运行之后 `grep -a` 密码字面量,并用故意写入密码的对照文件证明 grep 找得到(U-4)。运行时 DSN 文件与 DBHub 进程 env 按现有机制含密码,不在 AC-07 的搜索面内(R1 已披露) | P-07、P-08、P-11 |
| **D6 TLS 默认 = 提交前探测**(C7),等同 libpq `prefer`,不加用户字段 | P-07;被否决 7、8 |
| **D7 地址准入**:私网地址可以(用户亲手填写,与动态半场同一规则);loopback 拒(owner 2026-09-21);IPv6 字面量因沿用同一 host 形状判据而不收 | P-04 |
| **D8 Windows / Linux 现状**:不交付。官方连接器在这两个平台输入密钥前就拒(`official-connector-recipes.ts:21-27`);那里没有进程围栏也不起策略代理(`server.ts:254-256`、`:507-510`),驱动会直连,BR-01 无从强制。将来要做,得先有那两个平台的强制层 | P-08 |
| **D9 跨仓**:目录文字与契约说明归 alpha-web,在桌面版发布后上线(§8) | P-13 |
| **D10 seatbelt 规则的生成与测试**:规则不变,生成仍是 `renderProcessFenceProfile`;判据是「有无数据库目标时渲染出的 profile 逐字节相同」,加上 D1 探针里的真围栏对照臂 | P-02、I1 |

**待 owner 裁决(未批准,不得当作已批)**

**O-1 放行确认的文案要不要如实说明范围。** 放行一个数据库地址之后,能连到它的不只是数据库连接器:本机助手跑的命令和其他扩展也能连到同一个「地址:端口」(别的地址仍然连不上)。而且本机运行期间,数据库密码存放在一个助手的命令读得到的临时文件里。所以「只读」只对经连接器发出的查询有保证;如果填的是有写权限的账号,助手跑的命令理论上能绕过连接器写库。技术上做不到只给连接器一个人开门:围栏对整棵进程树一视同仁,代理分不清是谁在连,读文件不受围栏限制;要做到得先建通用的进程身份与读隔离框架,规格明确不做。批准的文案「允许这个连接器连接到 <地址>:<端口>。它不能连接其他地址。」第二句成立,第一句比实际窄。

- **A(建议)改成如实的说法**,例如「允许本机助手连接到 <地址>:<端口>（数据库连接器用它查库）。其他地址仍被拦截。建议填只读数据库账号。」后果:用户知道真实范围,会倾向用只读账号;要把规格 v1 的体验约定改成 v2(不加步骤、不加字段)。与现有出网批准框「批准一个目的地 = 交给整棵进程树」的如实披露一致(`network-egress-grants.ts:25-30`),也与 GitHub 连接器「只读由令牌权限决定」同一做法。
- **B 保留批准的文案**。后果:零改动;但文案比实际窄,用户用有写权限的账号时,助手跑的命令可能写库而用户不知情。

依据:R1、P-02、P-04、P-08。技术设计在 A、B 下相同;只有窗口文案等这个答复。

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| (尚未送审) | — | — | — | — |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| inet_aton 短写(如 `2130706433`)过得了 host 形状判据、拨号时解析到 127.0.0.1 | 用户亲手填这种写法时,会让树内进程到达本机该端口;与用户批准半场同一个已知缺口 | owner 2026-09-24 已接受该缺口,修法与落点在 `docs/design/2026-09-23-model-chosen-egress-baseline.md` §5.1 K3′(拨号时在解析结果上判),本功能复用同一判据 | 那条缺口被修时,本成员自动受益 |
| 只给连接器进程开门 | 需要读隔离 + loopback 调用方身份 | 规格不做通用出网框架(被否决 4) | 出现读隔离能力时 |

**对抗审查 R1 留档(2026-11-13,Codex gpt-6.1-sol,只读,审查版本 be7a5cb45f,对照规格 v1)**

未处置:owner 2026-11-13 批准规格 v2(改写为平台能力)并搁置开发。下列意见在重新启动时与「按 v2 重对方案」一并处置,本设计保持 `status: draft`。

- [Blocker] **连接器自身可逃出只读事务**：PostgreSQL 输入 `SELECT E'x\'y'; COMMIT; INSERT INTO audit_marker VALUES(1); -- '`；MySQL 默认转义模式下去掉 `E`。真实解析函数均返回 `allowed=true`、单条语句，因为 `N/chunk-IXC4NQGC.js:335` 不识别反斜线转义；执行路径却把原文交给支持多语句的驱动（`N/postgres-KCFNDQLG.js:717`、`N/mysql-ZXO4TWLG.js:65,254`）。有写权限、默认读写的账号因此可先结束只读事务再写入 — **AC-06** — 修正解析与执行边界，并用该反例证明事务不可逃逸；七类首词测试不足。[PostgreSQL 转义语法](https://www.postgresql.org/docs/current/sql-syntax-lexical.html)、
- [Major] **首次安装与更新会被一致性校验挡住**：现有事务在提交前调用 `prepareOfficialConnector`（`ext-package-tx-builders.ts:419`），它立即调用 `restoreOfficialConnector`（`official-connector-resources.ts:199`）；此时 C1 尚未建立新版本真源，因此必定不匹配 — **AC-01/02，问题 4** — 明确区分可信事务准备与已提交运行时恢复，保留“授权最后发布”。
- [Major] **更新崩溃可恢复旧授权**：已有 A → 提交 B → 写新真源前崩溃或写失败；原子替换会留下有效的旧 A。重启时 C2 仍放行 A，即使 B 的物化因版本不符被停用；§5“目标不在”不成立 — **AC-05、I6** — 更新先持久撤销 A、刷新集合并切断连接，再提交和发布 B。
- [Major] **C8 所需错误信息已被上游删除**：`packages/core/src/mcp/client.ts:60–71,302,611` 明确剥离 stdio stderr，只保留退出描述；`connection.ts:225` 再以安全描述发布 failed 状态。错误口令因此无法按设计从状态中提取 28P01/1045 — **体验约定、问题 4；U-3** — 在脱敏前形成安全分类码并传递，补齐相关契约，勿恢复原始 stderr。
- [Major] **库名编码与实际驱动不兼容**：`sales data` 被编码为 `sales%20data`；SafeURL 不解码 pathname（`N/chunk-IXC4NQGC.js:110`），两个连接器直接使用该值（PostgreSQL `:157`、MySQL `:57`）。纯函数探针确认两者都收到错误库名，退出 0 — **AC-01/02；U-5** — 修正面向 DBHub 的库名传递契约。
- [Major] **独立授权使 AC-05 不成立**：用户先通过现有出网批准框授权 A，再配置数据库 A，随后停用或卸载；其他半场仍授权 A，C3 明确不切旧隧道，新 CONNECT 也继续成功 — **AC-05** — 明确并解决独立授权与“立即不可连”的契约冲突；不能同时声明无条件满足两者。
