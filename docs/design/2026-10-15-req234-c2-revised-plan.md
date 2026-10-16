---
title: "#1530 修订方案:全局连接器配置只能由围栏外的主程序写"
kind: design
status: proposed
owners:
  - alpha-code desktop maintainers
last_reviewed: 2026-10-15
review_after: 2027-01-15
---

# `#1530`(REQ-234 C2)修订方案 —— 全局配置只能由围栏外的主程序写

票面 `alpha-code#1530`;父票 `#1521`;原基线 [`2026-10-14-req234-hub-agent-install-baseline.md`](2026-10-14-req234-hub-agent-install-baseline.md)
(下称「基线」)。本文**取代**基线里的 §三 S1 ②(ext 重建时整条重构 `cfg.mcp`)、I1、I10 与 §四 C2 一行;基线其余各节不动。
owner 2026-10-15 批准重做方案,方向原话见票面评论:「全局设置只能由围栏外的主程序写」—— 文件与目录身份一起保护、设置页与 sidecar
投影改走主程序、明确项目来源边界;Codex 只读审最多两轮。

**读法**:坐标按 worktree `feat/1530-config-fence` 基点 `d6da03544`(= `origin/alpha` 的 `5aef6b0c3` + 两次 docs 提交)写作 `文件:行`;
上游引擎文件未被草稿改动,坐标与 `origin/alpha` 相同;`alpha-config-injection.ts` / `server.ts` / `ext/plugin.ts` / `process-fence-profile.ts`
带未提交草稿,这四个文件一律按 **HEAD** 版本给坐标(`git show HEAD:<file>`)。每条事实标「实测」或「推断」。
第一节只有事实,设计从第二节起。

## 〇、与原基线的关系(先说清哪些被推翻)

| 基线条目 | 现状 | 本文处置 |
| --- | --- | --- |
| §1.7 末段「插件 `config` 钩子先于 MCP 服务读配置,被 `bootstrap.ts:36-38` 钉住」 | **证伪**(实测,[stage2-blocker](../verification/2026-10-15-req234-c2-fence-preverify/stage2-blocker.md)):首轮如此;已有 MCP client 后的下一轮 dispose 变成「MCP INIT attacker → EXT REBUILT trusted」 | ext 钩子**不能**当咽喉;S1 ② 整条重构废弃 |
| §三 S1 ②「ext 在每次重建时重构 `cfg.mcp`」 | 依赖上一条 | 删除;围栏成为唯一机制,fork 时注入照旧 |
| §四 C2 第一步「两条 deny 能拒掉这些路径」 | 通过([README](../verification/2026-10-15-req234-c2-fence-preverify/README.md)),但 A-file 被「父目录整体替换」证伪为完整防线([stage2-options §3](../verification/2026-10-15-req234-c2-fence-preverify/stage2-options.md)) | deny 集扩成「文件 + 插件目录 + **目录身份**」三类 |
| I1 ①–⑦ | ②④⑤⑥ 以 ext 重构为前提 | 重写为 I1′–I7′(§3.2) |
| I10「C2 对围栏的改动只有一条针对 `alpha.jsonc` 的 deny」 | 不再成立 | 重写为 I6′:**四条** deny 行、allow 行逐 token 不变 |
| 2.8 I 回退方案(本机 MCP 真源文件) | 不需要 | 仍否决(§2.3) |

**本版(R1 审计后修订)**:Codex gpt-6-astra 只读审 R1 判 REVISE-THEN-PROCEED,7 条全部接受,逐条并入 ——
① wellknown 的本地来源(`data:` URL)把 `auth.json` 也变成配置注入面 → 纳入 C2-F/C2-I(§1.1a);
② 全局 `{tool,tools}/` 六个自动执行目录漏了 → 并入 C2-P(§1.1 末);
③ C2-I 没覆盖**可写祖先**,工作区可选成 `~/.config` → 锁相关祖先目录身份(§1.3、§2.1);
④ 事务恢复回滚把攻击者 staged preImage 写回 `alpha.jsonc` **已实测确认** → C2-T 从可选升为**必须**(§1.4、§3.2 I7′);
⑤ 自定义 provider 对话框先存后 PATCH、候选规则下 500 → 接到 main 保存通路(§4);
⑥ 登记簿证不了 I3′ → 投影函数**固定搬进 main-only 文件**、断言闭包与接线(§3.2 I3′);
⑦ R1 项目 `plugin[]` 升级路径使「唯一通路」不能宣称 → 交付承诺收窄,项目插件去留交 owner(§六)。

**本版(R2 审计后修订)**:R2 判 ①②④⑥⑦ FIXED、③⑤ NOT-FIXED + 4 Major/2 Minor,按规则直接修(不再复审)——
③-a「工作区非唯一可写祖先入口」:`XDG_DATA_HOME=U/xdg` 下 W3 仍可搬走 `U/xdg` → 改为**按实际 W1–W19 可写根派生受保护目标的可写祖先身份并锁住**,不碰 `selectWorkspaceUnion`(§2.1 机制 2,实测 [writable-ancestor-probe.ts](../verification/2026-10-15-req234-c2-fence-preverify/writable-ancestor-probe.ts));
③-b「祖先排除会剔除 `XDG_CONFIG_HOME=<ws>/.config` 下的默认工作区、拒绝 fork」:同一改法**保留工作区写权限、只锁祖先目录身份**(正例已测);
⑤「`providers.add` 非旧契约等价」+「普通 provider 连接也写 auth.json」:C2-a 把**两条** provider 保存入口都接到 alpha main IPC(preset/platform → `providers.setKey`,自定义 → `providers.add`),自定义表单的四个上游字段差异如实登记(§4);
Minor:新增 deny 统一为**四条**;回滚探针改称「该分支的等价参数」并补 [journal-rollback-equiv-probe.ts](../verification/2026-10-15-req234-c2-fence-preverify/journal-rollback-equiv-probe.ts)(带 `probe`+`receiptCommitted` 仍成立)。
owner 2026-10-16 就 §六裁决**不关(默认)**。

## 一、只读勘破补充

[stage2-options](../verification/2026-10-15-req234-c2-fence-preverify/stage2-options.md) 已覆盖:全局 MCP 来源普查(§1)、写者(§2)、A-file 实测
与父目录替换反例(§3)、方案 C 不可行(§4)。下面只写它没覆盖、而本方案需要的事实。

### 1.1 生产拓扑下真正参与合并的全局文件(实测:读源码)

`D = OPENCODE_CONFIG_DIR = <userData>/alpha-engine-config`(HEAD `alpha-config-injection.ts:598,622`),`G = alphaGlobalRoot`,`HO = ~/.opencode`,
`XO = <XDG_CONFIG_HOME>/opencode`,`U = <userData>`。

| 来源 | 文件 | 坐标 | 备注 |
| --- | --- | --- | --- |
| 序 2 `loadGlobal` | `D/config.json`、`D/opencode.json`、`D/opencode.jsonc`、旧 TOML `D/config` | `config.ts:141-150,276-295` | D 已设时 **XO 的 JSON 不在序 2**(`globalConfigDir()` 取 D) |
| 序 3 | `G/alpha.jsonc` | `config.ts:420-423`;`flag.ts:21` 在模块装载时读一次 | main 在 fork 时经 sidecar 设 |
| 序 5 目录循环 | `XO`(只扫 markdown agent/command + `plugin(s)/` 自动发现,**不合并 json**:`:444` 只对名字以 `.opencode` 结尾或 `=== OPENCODE_CONFIG_DIR` 的目录合并)、项目 `.opencode`(受 `OPENCODE_DISABLE_PROJECT_CONFIG` 门控)、`HO`(**无条件**)、`D`:每个合并 `opencode.json` → `opencode.jsonc` | `paths.ts:23-41`;`config.ts:435-485` | 每个目录还跑 `npm install @opencode-ai/plugin`(`:457-476`)与 `ensureGitignore`(`:455`)—— **围栏内对 D/HO/XO 之内的写是合法且必要的** |
| 序 5 插件自动发现 | `{XO,项目 .opencode,HO,D}/{plugin,plugins}/*.{ts,js}` | `config.ts:481-484`;`config/plugin.ts:19-29` | 基线 S16 |
| **工具自动发现(审计 ②)** | `{XO,项目 .opencode,HO,D}/{tool,tools}/*.{js,ts}` | `tool/registry.ts:203-218`:`config.directories()` 每项 `Glob.scanSync` 后 `import()` | 与插件目录**同等**危害:被 import 的模块顶层代码在任何审批前执行,可改 `OPENCODE_CONFIG_CONTENT` / 调 `mcp.add`;`config.directories()` = `[Global.Path.config(=XO 静态), 项目 .opencode, HO, D]`(`paths.ts:26-39`)⇒ 全局三个是 `{HO,XO,D}/{tool,tools}` |
| 序 6 | `OPENCODE_CONFIG_CONTENT` | `config.ts:487-495`:**每次实例加载时动态读 `process.env`** | fork 后只有同进程 JS 能改 |
| 序 8/9 | managed 目录 `/Library/Application Support/opencode/opencode.json(c)`(或 `OPENCODE_TEST_MANAGED_CONFIG_DIR`)、MDM plist | `managed.ts:20-33,53-56` | 系统路径,不在围栏可写集 |
| v2 读端 | `D/opencode.json`、`D/opencode.jsonc`(`names`),不读 `config.json`/TOML/`OPENCODE_CONFIG`/CONTENT | `core/config.ts:142,164-171`;`core/global.ts:64` | 这就是 sidecar 投影存在的理由(模型选择器只读 v2) |

`Flag.OPENCODE_CONFIG_DIR` 是 getter、每次读 env(`flag.ts:63-64`);`OPENCODE_CONFIG` / `OPENCODE_CONFIG_CONTENT` 在模块装载时读一次(`:21-22`),
但 `config.ts:487` 对 CONTENT 绕过 Flag 直接读 `process.env`。引擎启动时在**模块顶层**对 XDG 四个根 `fs.mkdir(…, {recursive:true})`
(`core/global.ts:35-43`;`Path.config` 是 XDG 路径、不是 D)。

### 1.1a wellknown 的本地来源让 `auth.json` 成为配置注入面(实测,审计 ①)

序 1 的 wellknown 远程配置**不只来自网络**。`config.ts:335` `authSvc.all()` 读 `auth.json`(= `Global.Path.data/auth.json`
= `<XDG_DATA_HOME>/opencode/auth.json`,W4;`auth/index.ts:10`),逐条对 `type:"wellknown"` 的项:取其 `key` 作 URL,拼 `/.well-known/opencode`
后 `fetchRemoteJson`(`config.ts:375-414`),把返回的 `config` 当 global 来源合并(可带 `mcp`)。`key` 是任意字符串 —— 写成
`data:application/json,<url-encoded JSON>#` 时,拼上的 `/.well-known/opencode` 落进 **fragment**,`FetchHttpClient` 对 `data:` URL 直接返回内嵌 JSON、
**不发任何网络请求**(本机实测:`bun -e 'fetch("data:application/json,%7B...%7D#/.well-known/opencode")'` → 200,body 为内嵌 JSON)。
`auth.json` 在 W4 可写集里,围栏内引擎树写得了 ⇒ agent 写一条 `{"data:…": {"type":"wellknown","key":"data:…#","token":"x"}}` → 下一次实例加载即合并出攻击者 MCP,无确认框。
`OPENCODE_AUTH_CONTENT`(会让 `authSvc.all()` 跳过文件,`auth/index.ts:59-63`)在 alpha **未设**(grep 实测;`alpha-byok-keys.ts:4-9` 称 alpha 不读 auth.json,
但引擎的 wellknown 装载器仍读它),所以文件是活的来源。MCP OAuth 用的是**另一份** `mcp-auth.json`(`mcp/auth.ts:37`),不经此装载器、不是注入面。
⇒ `auth.json` 纳入 **C2-F**(文件 literal),其所在目录 `<dataHome>/opencode`(W4,还装引擎 log/db/repos)纳入 **C2-I**(只锁目录身份、放行目录内写)。
`auth.json` 的合法写者见 §1.2 与 §4。

### 1.2 围栏内今天的合法写者(实测:读源码 + 登记簿)

登记簿 `scripts/process-fence-write-sites.tsv`(HEAD)是 sidecar 闭包内写盘点的**唯一权威**;落在本方案要保护的目标上的行:

| tsv 行 | 写入点 | 目标 | 去向 |
| --- | --- | --- | --- |
| 11、18 | `alpha-config-injection.ts:86-90` 缺席时 seed `{$schema}` | `G/alpha.jsonc` | 迁 main(草稿已做) |
| 10、14、17、19 | `materializeV2EngineConfig`(`:593-622`):`mkdir D`、删/写 `D/opencode.json`(alpha.jsonc 去 provider 的拷贝)、写 `D/opencode.jsonc`(provider 投影) | `D` 与其中两文件 | 迁 main(§四) |
| 13、16 | 同函数 `:637-647`:`D/models.json` + `OPENCODE_MODELS_PATH` | `D/models.json` | 随函数一起迁 main(不在 deny 集,但同一函数) |
| 12、24、36、52 | `mkdirSync(userDataPath, {recursive:true})`(`:123`;`alpha-live-allowlist.ts:104`;`catalog-channels.ts:735`;`remote-catalog.ts:386`) | `U` 本身 | 不动:已存在目录的 recursive mkdir 不受身份 deny 影响(§1.3 实测) |
| 15 | `addInstruction`(`:124-128`)写 `U/alpha-identity.md`、`U/alpha-behavior.md` | U 之内 | 不动(不在 deny 集) |

投影的**输入**只有两样(实测):`alpha.jsonc` 文本(`:579-591`)与 `buildAlphaModelConfig(userDataPath)` 的输出 —— `config.model` /
`config.provider` / `config.enabled_providers` 恰在 `:188-193` 由它一次性赋值,`:193` 到 `:475` 之间没有第二处赋值(grep `config.provider =`、
`config.model =`、`enabled_providers` 只命中 `:190-192`);`existing = process.env.OPENCODE_CONFIG_CONTENT` 在正常启动恒缺席
(`sidecar-env.ts:16-18` NEVER_INHERIT)。main 已经在 fork 前调同一个 `buildAlphaModelConfig`(`server.ts:185-190`,`#1379`)。
sidecar 的启动顺序:`installProcessFence` → `prepareSidecarEnv`(= `injectAlphaConfig`)→ import 引擎(`sidecar.ts:136-148`),所以投影今天**在围栏内**写。

**引擎自己的写**(`config.ts`):`:249-253` 给缺 `$schema` 的已读文件回写(失败静默);`:268-274` seed 全局文件**仅当三个 env 路由都缺席**(生产不触发);
`:282-294` 旧 TOML → `config.json` 并 unlink(失败静默 `.catch(() => {})`);`:643-655` `PATCH /config` 写 **`<instance dir>/config.json`**(项目目录,W1);
`:661-685` `PATCH /global/config` 写 `globalConfigFile()` = D 下首个存在的 `opencode.jsonc` / `opencode.json` / `config.json`(生产下 `D/opencode.jsonc`
恒存在 ⇒ 写它),变更后 `handlers/global.ts:80` 全局 dispose。

**`PATCH /global/config` 的消费者与可达性**(实测:grep + ratchet 测试):唯一调用点 `packages/app/src/context/server-sync.tsx:660-671`(导出名
`updateConfig`,`:688`);调用它的五处:`settings-providers.tsx:107`、`settings-v2/providers.tsx:104`(`disabled_providers`)、`settings-general.tsx:341`、
`settings-v2/general-controllers.ts:70`(`shell`)、`dialog-custom-provider.tsx:148`(`provider.<id>` + `disabled_providers`)。前四处只在上游设置对话框内,
而 ui-mac 把**所有**设置入口短路到 Alpha 自有面:`settings-surface-ratchet.test.ts:48-62` 断言 `platform.openSettings` 守卫在 `layout.tsx` 的
`<x.DialogSettings />` 与 `settings-dialog.tsx` 的 `import("@/components/settings-v2")` 之前 ⇒ **在 ui-mac 产品里不可达**。第五处经上游模型选择器
(`dialog-select-model.tsx:150,531` → `DialogConnectProvider` → `CustomProviderForm`;选择器被 `prompt-input(-v2).tsx`、`use-composer-commands.tsx` 引用;
前端补丁 `alpha-frontend.patch` 里 `dialog-select-model` 零命中,唯一触及 `DialogConnectProvider` 的 hunk 在 `usage-exceeded-dialogs.tsx`(`:4140-4163`)且只改 host)⇒ **可达**;但它写进的 `D/opencode.jsonc` 在每次 fork 被投影整文件重写(`:621`),
且配置文件里的 provider 块自 `#1392` 起不参与注入面与出网放行集合(`server.ts:192-198`;`network-egress-derived.test.ts:195` B1 带对照)⇒
今天这条路里真正会**成为可观察故障**的是另一半:该对话框在 `updateConfig` 之前先 `client.auth.set({type:"api",key})`(`dialog-custom-provider.tsx:138-146`),
由引擎 `auth.set` 在**围栏内**写 `auth.json`(控制 handler `control.ts:17`)。C2-F 把 auth.json 与 `D/opencode.jsonc` 都 deny 后,这两个写在围栏内 EPERM、
`PATCH /global/config` 返回 500(stage2-options 实测),而对话框已乐观显示「已连接」。owner 批准评论含「设置页改走主程序」,所以这个入口接到 alpha
**已有**的 main 保存通路:`model-picker-add.tsx` 的 `providers.add`(key → alpha keychain,定义 → main 真源 `custom-providers/<env>.json`,围栏外写,`#1392`)。
`packages/app` 属 `ROUNDTRIP_PACKAGES`(`north-star-guard.sh:108`),改它走 ADR-034 补丁 roundtrip(§4、§五)。

**`auth.json` 的合法写者**(实测:`client.auth.set` → `control.ts:17`;`server-compat.ts:400` 集成连接;MCP OAuth 走**另一份** `mcp-auth.json`):桌面产品里
写 `auth.json` 的只有上述自定义/连接 provider 对话框(类型 `api`),而 alpha 的 provider 密钥走自有 keychain+`{file:}`,正常运行 `auth.json` 基本为空。
上条把该对话框接到 main 后,围栏内再无合法 `auth.json` 写者;引擎仍**读**它(读不 deny)。

**引擎 CLI**(`cli/cmd/mcp.ts` `mcp add`、`tui-migrate.ts`)不在桌面启动路径;围栏内由 agent 跑它正是要堵的事,围栏外用户自己跑不受影响。

### 1.3 seatbelt 目录身份 / 硬链 / 原子交换(实测,本次新增)

探针与完整矩阵:[README §第三步](../verification/2026-10-15-req234-c2-fence-preverify/README.md)、
[dir-identity-probe.ts](../verification/2026-10-15-req234-c2-fence-preverify/dir-identity-probe.ts)、
[dir-identity-results.json](../verification/2026-10-15-req234-c2-fence-preverify/dir-identity-results.json)(R1 后扩到 163 场景 × 4 臂 = 656 行,0 违例)。
四臂都从生产 `planProcessFence` 输出派生:head = HEAD profile;cand = head + §2.1 的完整 deny 集(C2-F/P/I/T);cand-ws = cand + 一个工作区根
`<home>/wsroot`(模拟 XDG 选进工作区,审计 ③);draft = 草稿两行(对照)。结论:

1. `(deny file-write* (literal "<dir>"))` 对目录本身生效:`mv <dir> …`、`mv … <dir>`、`ln -s … <dir>`、`mkdir <dir>`、`rmdir`、`renameat`
   全部 EPERM;对**已存在**目录的 `mkdir -p` 仍 OK(内核先回 EEXIST),目录**之内**的普通写不受影响(含 `<dataHome>/opencode` 的 log/db/repos,实测 OK)。
2. **HEAD 允许把 allow 根整个搬进另一个可写根**(`mv U G/stash` 等),literal 规则按**解析后的路径**判 ⇒ 目录身份必须含 **allow 根本身**(`<G>`、`<U>`),
   现在还加了 `<dataHome>/opencode`(审计 ①,auth.json 的目录)。cand 下这些搬移全 EPERM。
3. 文件 literal deny 同时拒绝 `link(2)` 硬链出去、`renamex_np(RENAME_SWAP)`、`openat(dirfd,…)`、经 `..` 的路径;`exchangedata` 在 APFS 本就 ENOTSUP。
   `(deny file-link …)` 一行在上一轮实测零差别,不采用。auth.json、`G/installs.json` 两个新文件 literal 与 11 个旧文件同形(cand 全 EPERM,head OK)。
4. **插件目录与工具目录同治**(审计 ②):`{HO,XO,D}/{plugin,plugins,tool,tools}` 共 12 个 subpath,cand 下建文件 / 软链目录均 EPERM。
5. **可写祖先(审计 ③)**:cand 保护 `<dir>` 身份,但若其**父目录**是可写工作区则可被整体改名携带。实测 cand-ws 臂(wsroot 为 W1)`mv wsroot/xdg wsroot/xdg.old`
   = **OK**(xdg 本身未被 identity 保护,携带受保护子目录 opencode 一起走);cand 臂(wsroot 非工作区)同一操作 = EPERM(默认拒)。⇒ 修法不是再加一层 deny(父目录链到 HOME),
   而是**锁住受保护目标的可写祖先目录身份**(§2.1 机制 2):从实际渲染的 W1–W19 可写根出发,把每个处于「某可写根之内、某受保护目标之上」的中间目录也加进 C2-I 的 identity literal。
   **不改 `selectWorkspaceUnion`** —— R1 曾想「把这类候选从工作区里排除」,R2 证伪:`XDG_CONFIG_HOME=<ws>/.config` 时默认工作区自己就是祖先,排除它会让 `process-fence-plan.ts:111` 拒绝 fork(finding ③-b)。
   锁祖先身份则让工作区照常可写、只有 `.config` / `.config/opencode` 这两层目录改名被拒(实测 [writable-ancestor-probe.ts](../verification/2026-10-15-req234-c2-fence-preverify/writable-ancestor-probe.ts):`XDG_DATA_HOME=U/xdg` 锁 `U/xdg`、`XDG_CONFIG_HOME=<ws>/.config` 锁 `<ws>/.config`,两者工作区/`U` 普通写仍 OK)。子目录自身改名四臂皆 EPERM。
6. C2-T 的 `G/ext-tx`(subpath)与 `G/installs.json`(literal)在 cand 下写/建/改名均 EPERM(审计 ④ 的防线;攻击确认见 §1.4)。
7. 若硬链在围栏**外**已存在,围栏内经链写入会改动受保护内容(四臂皆如此)—— 残余 §3.4 R5;main 从不建硬链。

### 1.4 main 写 `alpha.jsonc` 的输入面(实测:读源码)

owner 方向要求「只能由围栏外的主程序写」——那么 main 写它时**读了什么**就是边界的一部分:

| main 写者 | 输入 | 输入是否在围栏可写集 |
| --- | --- | --- |
| IPC `installCatalog` → 事务(`ext-ipc.ts:1183-1240`,基线 1.1) | 已验签 catalog + renderer grants | 否(缓存读回重验,基线 F10) |
| boot reconcile `engine-config-truth-boot.ts:132-148` → `planConfigMerge`(`engine-config-truth.ts:294-314`,**复制 legacy 的 `mcp`/agent/command/permission/provider**,existing 优先;经 `isAlphaOwnedConfig` 门,`:165`) | `~/.opencode/opencode.jsonc`(`:61-63`)、`<XDG>/opencode/opencode.jsonc`(`:48-54`,main 进程无 `OPENCODE_CONFIG_DIR`) | **今天在**(W16 / W6)——围栏内写 `~/.opencode/opencode.jsonc` 的 MCP 会在下次启动被 main 洗进 `alpha.jsonc`;本方案的 deny 集把这两处关掉 |
| 账本投影 `ext-install-planner.ts:3461-3514`(`computeEnableProjectionEdit`:mcp 只翻 `enabled`;叶缺席 ⇒ 「cannot enable」不写) | `G/installs.json`(`alpha-installs.ts:7,20`) | **在**(W2)——伪造只能把已存在的本地 MCP 叶重新 `enabled:true`,注不进 `command` |
| 事务恢复 `recoverExtensionTransactions(alphaGlobalRoot(), …)`(`ext-ipc.ts:799`;每次写前 `withRecoveredWrite`):journal `G/ext-tx/journal/*.json`、staging `G/ext-tx/staging`(`ext-transaction.ts:422-434`);config 项回滚链 `:2731-2744` → `restoreConfigImage`(`ext-config-tx.ts:129-150`):**当 live digest === nextDigest 时把 staged preImage 写回 target** | `G/ext-tx/**` | **在**(W2)——**已实测确认**(审计 ④,[journal-rollback-probe.ts](../verification/2026-10-15-req234-c2-fence-preverify/journal-rollback-probe.ts)):用真生产事务引擎 crash 出一份合法 journal+staging,再做 attacker 的两个 W2 写(覆盖 `config-0.pre` = 攻击 JSON、把该项 `preDigest` 改成其哈希),在**该回滚分支的等价参数**下跑 `recoverExtensionTransactions` → `alpha.jsonc` 被写成攻击内容(`attackerLanded:true`,state `rolled-back`)。「等价」见 finding 6:journal item_0 翻转、item_1 未翻转 ⇒ `allFlipped=false`(`:2545`)⇒ 永不进入 `allFlipped && probe && commitReceipt` 前向分支(`:2547`),`probe` 改不了结果;无 receipt 项 ⇒ `receiptCommitted` 返回 false(确证未 durable ⇒ 允许回滚)。带真 `probe`+`receiptCommitted` 重跑仍成立([journal-rollback-equiv-probe.ts](../verification/2026-10-15-req234-c2-fence-preverify/journal-rollback-equiv-probe.ts),生产接线 `ext-ipc.ts:725-745`)。`readStagedConfigImage` 只拿 staged 字节比 journal 自带的 `preDigest`,两者都在 W2 ⇒ 校验挡不住。此路**独立于账本**路径。⇒ C2-T 必须 |
| `persistMcp`(`ext-config.ts:542-570`)、策略编辑、`alpha-migrate`(需 `ALPHA_MIGRATE_ENABLE=1`) | IPC / env | 否 |

### 1.5 其它事实

- 围栏内进程**连不上**引擎的 HTTP 端口:网络行只放行 loopback 上的代理端口 N4(`process-fence-profile.ts:174-178`),其它 loopback 端口 EPERM
  (`network-egress-fence.test.ts:9-11` 实测臂)。能调 `PATCH /global/config` / `mcp.add` 的只有:围栏外的 renderer / main,或 sidecar **进程内** JS
  (`in-process-engine.ts:13-24`:ext、受信项目插件、`plugin[]` 加载的代码)。`MCP.add` 只改 `InstanceState`(`mcp/index.ts:681-686`),dispose 即失。
- sidecar env 是 allowlist(`sidecar-env.ts:30-100`):`OPENCODE_*` 前缀整体放行(`:100`)—— 启动 shell 导出的 `OPENCODE_CONFIG_DIR` / `OPENCODE_TEST_MANAGED_CONFIG_DIR`
  会进 sidecar,但那是用户在围栏外的决定;围栏内改不了 main 的 env。main 可在 fork 前往 `sidecarEnv` 加键(`server.ts:551` 已对代理 env 这样做)。
- `engine-plugin-seal.ts:1-48` 是**写盘侧**咽喉(`ext-config` / `ext-config-tx`),不是加载侧:`~/.opencode/opencode.json` 或项目配置里的 `plugin[]`
  由上游加载器原样消费。本方案把全局那几份文件关掉后,`plugin[]` 只剩项目来源(§3.3)。
- `OPENCODE_EXPERIMENTAL_CODE_MODE`(`runtime-flags.ts:48`,默认关)启用 `@opencode-ai/codemode` 自带解释器(`packages/codemode/src/interpreter/`),
  未勘破其能力边界(§3.4 R9)。
- 上游边界:`UPSTREAM_PATHS=packages`(`north-star-guard.sh:84`),alpha 自有包只有 `ext ui-mac alpha-contracts-consumer`(`:92`)。本方案零上游改动。

## 二、选定方案与被否决的替代

**一句话:让内核(seatbelt)而不是引擎的加载顺序当权威 —— 围栏内对「能定义全局 MCP 的每个位置」既写不了文件、也换不了它所在的目录;
今天在围栏内写这些位置的两个 alpha 写者搬到 main 的 fork 前;ext 不再试图在重建时纠正配置;fork 时注入照旧。**

反问「能否让本系统成为唯一权威、让外部无从覆盖」:**能**。权威 = 一张由我们渲染、内核强制的路径表;它不需要知道引擎什么时候读、读几遍、
谁先谁后 —— 这正是方案 C 的红旗(「我的设计要跟引擎的销毁/初始化顺序逐点同步」= 无底洞,stage2-options §4 已证无咽喉)。与外部唯一的耦合是
**引擎读哪些文件名、哪些目录、从哪些目录 `import()` 代码**,那是上游源码里的有限常量(`config.ts:147,277-281,445`、`paths.ts:26-39`、
`tool/registry.ts:203-205`、`auth/index.ts:10` + `config.ts:375`、`core/config.ts:142`),本方案用对照上游源码文本的 tripwire 测试钉住
(I6′ b),上游 sync 带来新文件名 / 新自动加载目录时当场红,而不是靠人记得。

### 2.1 机制(五件事)

> R2 修订:机制 2 由「workspace 排除」改为「可写祖先身份锁」;机制 3 增补第二条 provider 入口。

**(1) deny 集 = 四类,从一个常量表派生**(`process-fence-profile.ts` 新增 `CONFIG_FENCE_TARGETS`,渲染在 allow 块之后、`(deny network*)` 之前,
与草稿同一插槽 `:173-174`,**四条** `deny` 行;C2-I 那一条还含「可写祖先」literal,见机制 2):

```
(deny file-write* (literal "<G>/alpha.jsonc")
                  (literal "<HO>/opencode.json") (literal "<HO>/opencode.jsonc")
                  (literal "<XO>/config.json") (literal "<XO>/opencode.json") (literal "<XO>/opencode.jsonc") (literal "<XO>/config")
                  (literal "<D>/config.json")  (literal "<D>/opencode.json")  (literal "<D>/opencode.jsonc")  (literal "<D>/config")
                  (literal "<dataHome>/opencode/auth.json")                                     ; 审计①
                  (literal "<G>/installs.json"))                                                 ; 审计④(C2-T 文件半)   ← C2-F
(deny file-write* (subpath "<HO>/plugin") (subpath "<HO>/plugins") (subpath "<XO>/plugin") (subpath "<XO>/plugins")
                  (subpath "<D>/plugin")  (subpath "<D>/plugins")
                  (subpath "<HO>/tool") (subpath "<HO>/tools") (subpath "<XO>/tool") (subpath "<XO>/tools")
                  (subpath "<D>/tool")  (subpath "<D>/tools"))                                   ; 审计② plugin+tool ← C2-P
(deny file-write* (literal "<D>") (literal "<HO>") (literal "<XO>") (literal "<G>") (literal "<U>")
                  (literal "<dataHome>/opencode")
                  <writableAncestorIdentities(allowRoots, targets) 的结果,见机制 2>)                ; 审计①③ ← C2-I 目录身份 + 可写祖先
(deny file-write* (subpath "<G>/ext-tx"))                                                        ; 审计④(C2-T 目录半) ← C2-T
```

`<…>` 由 planner 的 roots 代入,与 `:155-170` 的 allow 行同源。`XO` 的四个文件在 D 已设时不参与合并(§1.1),仍列入:D 缺席(逃生阀)时它们是来源,
且 `mcp-default-deny.ts:18,43` 枚举它们。

**(2) 锁住可写祖先身份(审计 ③,替代 R1 的 workspace 排除)**:新助手 `writableAncestorIdentities(writableRoots, targets)`
(`process-fence-profile.ts`)—— 输入是**实际渲染的 W1–W19 allow 子路径**与 C2-F/P/I/T 的受保护目标;对每个目标,找到包住它的那个 allow 根,
把「在该根之内、在该目标之上」的每一层中间目录都加进 C2-I 的 identity literal。默认拓扑(XDG 在 HOME 下、不可写)它返回空;
`XDG_DATA_HOME=U/xdg`(dataHome 落进 W3=U)返回 `U/xdg`;`XDG_CONFIG_HOME=<ws>/.config`(落进 W1 工作区)返回 `<ws>/.config`。
**`selectWorkspaceUnion` 一行不改** —— R1 的「把这类候选排除」被 R2 证伪(finding ③-b:默认工作区被剔除会让 `process-fence-plan.ts:111` 拒绝 fork)。
身份锁让工作区/`U` 普通写照常 OK、只有那一两层目录改名被拒(实测 [writable-ancestor-probe.ts](../verification/2026-10-15-req234-c2-fence-preverify/writable-ancestor-probe.ts),三拓扑 × head/cand,0 违例)。

**(3) 写者迁移**(§四):`{$schema}` seed 与 `materializeV2EngineConfig`(含 `D/models.json`)**搬进新文件 `engine-config-materialize.ts`(main-only,sidecar 不 import)**,
由 main 的 `spawnLocalServer` 在 `syncSecretFiles` 之后、`planProductionFence` 之前调用(`server.ts:535-561` 之间);`OPENCODE_CONFIG`、`OPENCODE_CONFIG_DIR`、
`OPENCODE_MODELS_PATH` 由 main 放进 `sidecarEnv`;sidecar 的 `injectAlphaConfig` 不再写盘、不再设这三个键。另外(审计 ⑤④)**两条** provider 保存入口
(都是 packages/app roundtrip,都经引擎 `auth.set` 写 `auth.json`/经 `PATCH /global/config` 写 `D`)改走 alpha 已有的 main IPC(`provider-ipc.ts`:`registerProviderIpcHandlers`):
preset/platform 连接(`dialog-connect-provider.tsx:824` 的 `integration.connect.key` → `server-compat.ts:400` 的 `auth.set`)→ `providers.setKey`(key→keychain);
自定义服务(`dialog-custom-provider.tsx`)→ `providers.add`(定义→真源 `custom-providers/<env>.json`)。**字段差异如实登记**(finding ③,§4):
alpha 的 `ProviderInput`/真源没有上游自定义表单的 headers、per-model 显示名、`{env:}` 引用,且 `validateProviderInput`(`ext-config.ts:1198`)要求 key 非空 ——
这是 alpha 既有 `AddProvider`(ADR-016,产品里真正的自定义入口)的行为,不是本票引入的回退;owner 要恢复那四项另开 feature REQ。
投影/seed 失败 ⇒ **拒绝 fork**(`server.ts:502-509,556-561` 同一 fail-closed 路径),比今天的「起来后报 injection-failed」更严,可回滚。

**(4) ext 不动**:HEAD 的 `config` 钩子(`ext/plugin.ts:154-241`)保持原样;`mcp-default-deny.ts` / `mcp-server-truth.ts` 留在 ui-mac main,
fork 时注入(远程真源、账本禁用、XDG 默认拒)照旧。草稿里迁入 ext、`jsonc-parser` 依赖、重构函数、两种变异臂全部废弃。

**(5) 目录预建**:`<XDG>/opencode` 已由 planner 在 fork 前 `mkdirp`(`process-fence-plan.ts:85-93`);`U`、`G` 由 main 启动即建;`D` 由 (3) 建;
`<dataHome>/opencode` 由引擎模块顶层 `fs.mkdir(recursive)` 建(`core/global.ts:35-43`,recursive 对已存在目录是 no-op,实测不触 C2-I);
`~/.opencode` **不预建**(引擎只发现、不创建;缺席时围栏内外都没人建它,等价于今天)。

### 2.2 为什么这是最简的正确解

- 围栏之后,围栏内**还能写**的配置来源只剩:项目作用域(§3.3)、进程内 JS 改 env / 调 `mcp.add`(§3.4 R2)。全局 MCP 表的每个文件来源都只有 main
  与用户编辑器能写 —— 于是 ext 重构、顺序保证、真源文件三样东西都不再需要;实现面从「ext + main + 事务」缩回「profile 四行(含派生的祖先身份)+ 搬一个函数 + 两条 provider 入口改走 main IPC」。
- 不动上游、不动 IPC、不动消息族、不动确认框。

### 2.3 被否决的替代

| # | 替代 | 否决理由 |
| --- | --- | --- |
| A-file | 只 deny 文件 literal(stage2-options §3 的 11 文件) | 父目录整体替换绕过(实测);allow 根可被搬走再软链顶替(§1.3 第 2 条,实测) |
| B-dir | 把整个 D / HO / XO 设为只读 | 引擎每次重建往这三处 `npm install @opencode-ai/plugin`、写 `.gitignore`、`D/models.json`(§1.1);stage2-options §3 已点名误伤 |
| C | 不改上游、靠 ext/ui-mac 保证「先重构后消费」 | 无咽喉(stage2-options §4 逐条);§1.7 已被真实例证伪 |
| ext 重构作为纵深 | 保留草稿的 `rebuildMcpConfig` 当第二道 | 已知在第二轮重建被绕过的层只提供假安心;审计方会问它守什么;删 |
| I(基线 2.8) | 本机 MCP 真源文件 + 事务新 action | 全套事务/恢复/存量/读取改动换来的不变量,几行 deny 就能得到;且它不管 `~/.opencode` / D 的同名覆盖、也不管 wellknown/journal 两路 |
| 整个 `injectAlphaConfig` 搬 main | 把 CONTENT 计算也搬出去 | 它直接读写 `process.env`(`:91,94,474`),在 main 跑两代 fork 会把上一代 CONTENT 当 `existing` 累积;要改成传 env 对象 = 重写 650 行;投影只依赖两样输入(§1.2),搬投影就够 |
| `selectWorkspaceUnion` 排除受保护目录的祖先候选(R1 做法) | 不让祖先目录进工作区 | **R2 证伪**:`XDG_CONFIG_HOME=<ws>/.config` 时默认工作区自己是祖先 → 被剔除 → 无候选时 `process-fence-plan.ts:111` 拒绝 fork;改为只锁祖先目录身份(机制 2) |
| `OPENCODE_DISABLE_PROJECT_CONFIG=1` | 顺手关掉项目 `opencode.json(c)` 与 `.opencode/`(`config.ts:425`、`paths.ts:27` 同一开关) | 同时关掉用户自己的项目配置,是产品决定;基线 S5 已登记为 out-of-scope;owner 已就此裁决不关(§六),不并入 |
| `OPENCODE_AUTH_CONTENT={}`(让引擎不读 auth.json)杀 wellknown | main 设该 env | 能杀 wellknown 文件来源,但改变引擎读 auth.json 的行为、且不保护 auth.json 作为其它潜在来源;deny 文件与 C2-F 其余条目同形、读仍放行、只收紧写 —— 与 owner「只能主程序写」方向一致,更小更一致。采 deny |
| `(deny file-link …)` | 对文件再加 file-link 规则 | 上一轮实测零差别(文件 literal 已拒 `link(2)`) |
| 让 `PATCH /global/config` 继续可写 | 给围栏开 D 文件的口或让 main 代写该 PATCH | 开口重开洞;而该 API 在 ui-mac 唯一可达消费者(自定义 provider 对话框)已由审计 ⑤ 接到 alpha 的 `providers.add` main 通路(§1.2、§4)⇒ 不需要让 PATCH 可写 |

## 三、安全面

### 3.1 整类绕过与边界

| # | 旁路 / 边界 | 今天 | 本方案后 | 由谁挡 / 处置 |
| --- | --- | --- | --- | --- |
| B1 | 围栏内直接写 13 个全局配置文件(含 auth.json、installs.json;append / 截断 / 新建 / unlink / rename-over / 软链占位) | 除 alpha.jsonc 外全可写 | EPERM | C2-F(实测) |
| B2 | 替换 / 搬走 / 软链顶替 D、HO、XO、G、U、`<dataHome>/opencode`(含 `renameat`、`rmdir`) | 可(实测) | EPERM | C2-I(实测) |
| B3 | 把 allow 根搬进另一可写根再软链回来,写经解析后的路径 | 可(实测) | 搬不动 ⇒ 到不了 | C2-I 含 allow 根本身(实测) |
| B3′ | 把受保护目录的**可写父目录**(`XDG_DATA_HOME=U/xdg` 落进 W3、或 `XDG_CONFIG_HOME=<ws>/.config` 落进 W1)整体改名,携带受保护子目录 | 可(实测 head 臂) | EPERM | 可写祖先身份锁(`writableAncestorIdentities`,实测 cand 臂;审计 ③) |
| B4 | 硬链受保护文件到可写名后经链写 | 可 | `link(2)` EPERM | C2-F(实测);围栏外预存链 = R5 |
| B5 | `renamex_np(RENAME_SWAP)` / `exchangedata` / `openat(dirfd)` / `..` 路径 | 可 | EPERM | C2-F / C2-I(实测) |
| B6 | 往 12 个自动加载目录 `{HO,XO,D}/{plugin,plugins,tool,tools}` 放 `.js`、建/软链目录、硬链进来 | 可 | EPERM | C2-P(实测;tool/tools = 审计 ②) |
| B7 | 全局配置文件里写 `plugin[]` 指向工作区 `.js` | 可(加载侧无闸,§1.5) | 文件写不了 | C2-F;项目来源见 B12 |
| B8 | `PATCH /global/config`(写 D 文件)/ `auth.set`(写 auth.json):自定义 provider 对话框 **与** preset/platform「连接」(`integration.connect.key`→`server-compat.ts:400`) | 围栏外 renderer 可;围栏内连不上 HTTP,进程内 JS 可 | 写 ⇒ EPERM(500) | C2-F;**两条**可达消费者都接 alpha main IPC(审计 ⑤④:`providers.add` / `providers.setKey`,§1.2、§4) |
| B8′ | 围栏内写 `auth.json` 的 `type:"wellknown"` 条目(`key` = `data:` 本地 URL)让引擎合并攻击配置 | 可(实测:data: fetch 本地 200) | 文件写不了 | C2-F(auth.json 文件)+ C2-I(`<dataHome>/opencode` 目录);审计 ① |
| B9 | `PATCH /config`(写 `<instance dir>/config.json`) | 项目目录 W1,可写 | 不变 | 项目作用域(§3.3) |
| B10 | 运行时 `mcp.add` | 进程内 JS 可;不持久 | 不变 | R2(S6/S12 类) |
| B11 | 改 `OPENCODE_CONFIG_CONTENT` / `OPENCODE_CONFIG*` 来源 | 只有进程内 JS 能改 sidecar env;main env 围栏内改不了 | 不变 | R2 |
| B12 | 项目 `opencode.json(c)` / `.opencode/opencode.json(c)` / `.opencode/{plugin,tool}(s)` 的 mcp / plugin[] / tool / agent | 上游原生加载,无确认框 | 不变 | §3.3;R1;§六 owner 裁决 |
| B13 | `.code-puppy/alpha.jsonc` 的 mcp、`.code-puppy/plugins/*.js`、`alpha_register type=mcp` | 整项目一次性信任门(`ext/plugin.ts:421-442`) | 不变 | 基线 S6 |
| B14 | 伪造账本 `G/installs.json` 重新启用用户停用的本地 MCP | 可写(W2);只翻 `enabled`,注不进 `command` | EPERM | C2-F(installs.json literal);审计 ④ |
| B15 | 植入事务 journal / staging `G/ext-tx/**`,恢复回滚把 attacker staged preImage 写回 `alpha.jsonc` | **可写且实测到得了**(§1.4,journal-rollback-probe) | EPERM | C2-T(`G/ext-tx` subpath);审计 ④ 必须 |
| B16 | 围栏内写 `~/.opencode/opencode.jsonc` 让 boot reconcile 洗进 `alpha.jsonc` | 可(§1.4) | 文件写不了 | C2-F |
| B17 | well-known **远程** URL / 组织远程配置 / managed 目录 / MDM | 网络或系统级来源 | 不变 | R6(本地 `data:` 已由 B8′ 堵) |
| B18 | 伪造密钥在场文件 `U/alpha-mcp-secrets/ALPHA_MCP_TOKEN` ⇒ `platformPays` | 可 | 不变 | R8(云 MCP 定义来自 env,不是本机连接器) |
| B19 | 写 `U/alpha-identity.md`、`G/instructions/*.md`、`G/ext-store` 技能 | 可 | 不变 | 提示注入面,非可执行安装面(基线 S15) |
| B20 | 引擎 CLI `mcp add` 在围栏内 | 写 XDG 文件 | EPERM | C2-F |
| B21 | 逃生阀(`ALPHA_JSONC_TRUTH_DISABLE` 等,启动 shell 导出) | 用户在围栏外的决定 | deny 行照渲染,不随逃生阀变 | 不承诺逃生阀形态下的唯一通路 |

### 3.2 实现必须守住的不变量(咽喉形态,每条可判)

- **I1′ 围栏内写不到任何全局 MCP 定义位置**:到达 C2-F / C2-P / C2-I / C2-T 集合的任一路径的 `file-write*`(含 create / append / truncate / unlink /
  rename-in / rename-out / symlink / hardlink / `renamex_np` / `openat` / `..` / mkdir / rmdir)⇒ EPERM;同一探针在 head profile 下 ⇒ OK(对照);
  **而目录之内的普通写(`<dataHome>/opencode` 的 log/db、D 的 npm 产物)⇒ OK**(实测,不误伤)。判据:`dir-identity-probe.ts` 的 cand/head 两臂固化为
  `process-fence-config.test.ts`(真 `sandbox-exec`,生产 planner 渲染,隔离 HOME 在 `/Users` 下),**矩阵由 `CONFIG_FENCE_TARGETS` 同一张表驱动** —— 表里加一项,测试自动多一组。
- **I2′ 端到端(同一引擎进程、真 ext、真 MCP SDK)**:① 按 stage2-blocker 步骤在围栏内写 `~/.opencode/opencode.jsonc` 同名覆盖 ⇒ 写 rc≠0,第二次 dispose
  后 `GET /mcp` connected 且 MCP 服务实际 argv 仍为 `trusted`;② 父目录整体替换(`mkdir U/replacement` → `mv D` → `mv replacement D`)⇒ `mv` EPERM,
  同上;③ 围栏外 Electron main 经生产 `persistMcp` / 配置事务安装、重装 ⇒ connected,`{file:}` 已展开。判据:草稿 `mcp-config-rebuild.test.ts` 去掉两种
  变异臂与 I1④⑤⑥ 的 ext 期望后保留;变异 = 把 C2-I 那一行删掉 ⇒ ② 红。
- **I3′ 写者由构造离开围栏,不靠路径匹配证明**(审计 ⑥,**C2-a 判据,不依赖 C2-b 的 `CONFIG_FENCE_TARGETS`**):登记簿 `process-fence-write-sites.ts` 的归一化
  只折叠空白(`normalize`,`:54`),`firstArg` 是 `truth` / `userCopy` / `dir` 这类**变量名**、不是解析后的路径,所以「tsv 里没有命中保护路径的行」证不了不变量;而保留的
  `mkdirSync(userDataPath)` 必然以 U 为目标(U 在 C2-I)。因此判据改为**三条构造性断言**:(a) seed 与 `materializeV2EngineConfig` 固定搬进新文件
  `engine-config-materialize.ts`,`relativeImportClosure(sidecar.ts)`(`process-fence-write-sites.ts:121`)**不含**它(断言该文件只被 `server.ts`/`index.ts` 引用);
  (b) 重生后的 tsv **删掉** `alpha-config-injection.ts` 的 seed / 投影 / `models.json` 四行(逐签名断言它们消失);(c) 接线断言 `server.ts` 在 fork 前调 `materializeEngineConfig`
  并设三个 env 键。**明确允许**已存在目录的 recursive `mkdirSync`(保留的 `mkdirSync(userDataPath,{recursive})` 对已存在 U 是 no-op,实测不触 C2-I,不列为违规)。
  判据:`process-fence-write-sites.test.ts` + `alpha-config-injection.test.ts` 的接线用例;变异 = 把 seed 搬回 `alpha-config-injection.ts` ⇒ 闭包断言红。
- **I4′ 投影字节不变**:同一夹具(同一 `alpha.jsonc` 文本 + 同一 `buildAlphaModelConfig` 输出)下,main 产出的 `D/opencode.json`、`D/opencode.jsonc`、
  `D/models.json` 与 HEAD 的 sidecar 产物**逐字节相同**,`OPENCODE_CONFIG` / `OPENCODE_CONFIG_DIR` / `OPENCODE_MODELS_PATH` 三键相同;
  判据:`materializeV2EngineConfig` 保持同一函数、只换调用方;测试用 HEAD 的调用形态与新调用形态各跑一次比对(`alpha-config-injection.test.ts`)。
- **I5′ 真引擎在候选 profile 下启动**:fresh 隔离 HOME(无 `~/.config/opencode`、无 `~/.opencode`)+ 生产 planner + 候选 profile + 真 ext ⇒ 引擎起来、
  `GET /config` 200、`GET /mcp` 200、D 下 `npm install` 结果与 head 臂相同、`D/models.json` 在场;判据:`process-fence-engine.test.ts` 加一臂。
- **I6′ 可写集只收紧,外部耦合有 tripwire**:(a) 渲染出的 allow 行与 N1–N4 与 HEAD 逐 token 相同,新增**恰好四行** deny(`process-fence-profile.test.ts`
  逐行断言);(b) 上游「读配置文件 / 从目录 `import()` 代码」的常量 ⊆ `CONFIG_FENCE_TARGETS` —— **两条独立 tripwire**(表驱动矩阵发现不了漏表项,审计 ②):
  ① 配置文件名与目录(`config.ts:147`、`:277-281`、`:445`;`paths.ts:26-39`;`core/config.ts:142`);② **自动执行目录**:`tool/registry.ts:203-205` 的
  `{tool,tools}` glob 与 `config/plugin.ts:19-29` 的 `{plugin,plugins}` glob、`config.directories()` 的根集,以及 `auth/index.ts:10` 的 auth.json 路径 + `config.ts:375` 的 wellknown 装载。
  测试读源码文本比对(与 `settings-surface-ratchet.test.ts` 同形制),上游加一个全局文件名 / 新 glob 目录 ⇒ 红。
- **I7′ main 写 `alpha.jsonc` 的文件输入不在围栏可写集**(审计 ④,**必须**):`G/ext-tx`(C2-T subpath)与 `G/installs.json`(C2-F literal)在 deny 集,§1.4 表里每条输入
  要么在 deny 集、要么在 appState 根外、要么来自 IPC;判据同 I1′ 的表驱动矩阵(含 extTx 建 journal/staging、installs.json 写 ⇒ EPERM,实测)。恢复/账本路径本身跑在 **main**(围栏外),不受影响。
- **I8′ 受保护目标的可写祖先被锁、而工作区照常可写**(审计 ③,替代 R1 的 workspace 排除):`writableAncestorIdentities(renderedAllowRoots, targets)` 的每个结果都进 C2-I;
  判据(`writable-ancestor-probe` 固化,三拓扑 × head/cand):① `XDG_DATA_HOME=U/xdg` ⇒ 结果含 `U/xdg`,cand 下 `mv U/xdg …` EPERM、head 下 OK(反例);
  ② `XDG_CONFIG_HOME=<ws>/.config` ⇒ 结果含 `<ws>/.config`,cand 下 `mv <ws>/.config …` EPERM;**正例**:两拓扑下默认工作区仍被 `selectWorkspaceUnion` 选中(profile 含其 W1 subpath、planner 不拒 fork)、工作区与 `U` 的普通文件写 OK;
  变异 = 从 C2-I 去掉祖先结果 ⇒ ① 的 `mv U/xdg` 变 OK ⇒ 红。`selectWorkspaceUnion` 不在本不变量的改动面内(保持原样)。

### 3.3 项目作用域来源的边界(本票 out-of-scope,但要说清)

项目来源 = `<project>/opencode.json(c)`(`config.ts:425-429`,从 worktree 根到当前目录)、`<project>/.opencode/{opencode.json(c), plugin(s)/, agent/, command/}`
(`paths.ts:27-33`,从当前目录向上)、`.code-puppy/alpha.jsonc` 与 `.code-puppy/plugins`(ext 信任门)。它们**为什么不是「绕过确认框装全局连接器」的通路**:

- 合并发生在**该 directory 的实例**里(`config.ts:425` 的 `ctx.directory`),不写 `alpha.jsonc`、不进账本、不出现在定制中心;其它目录的实例与无项目的
  全局实例不受影响。它装的是「这个项目打开时才有的东西」,与 ADR-040 后果 4 登记的边界一致。
- 但有一条**升级路径**(R1):项目配置的 `plugin[]` 指向工作区任意 `.js`(W1 可写)⇒ 上游加载器以引擎同等权限在进程内执行(§1.5 无加载侧闸)⇒
  可改 `process.env.OPENCODE_CONFIG_CONTENT`(`config.ts:487` 动态读)或调 `mcp.add` ⇒ 下一次全局 dispose 后**所有**实例拿到攻击者 MCP。
  前提是用户打开了该项目(目录在 W1)。这与基线 S6「项目插件经一次性信任门后以引擎权限运行」同类,区别是上游 `plugin[]` **没有**信任门。
- 一键关法存在且只有一个开关:`OPENCODE_DISABLE_PROJECT_CONFIG=1` 同时关掉 `config.ts:425` 与 `paths.ts:27`(项目 `opencode.json(c)` 与 `.opencode/`,含其 `plugin(s)`/`tool(s)`),
  `.code-puppy` 路径不受影响(ext 自己合并)。代价是用户自己的项目 `opencode.json` 失效。这是产品决定 ⇒ **owner 已裁决不关(§六)**,不在本票;本方案的所有 AC 不依赖它。
- **因此本票不宣称「确认框是唯一安装通路」**(审计 ⑦;owner 2026-10-16 裁决不关):R1 是方案自己承认的全局影响路径。交付承诺收窄为「**受保护的全局文件与目录在围栏内写不进、换不掉**」(§五、§六)。

### 3.4 残余风险(如实登记)

| # | 残余 | 说明 |
| --- | --- | --- |
| R1 | 项目 `plugin[]` / `tool(s)` ⇒ 进程内代码 ⇒ 全局升级 | §3.3;本票**收窄交付承诺**(§六);owner 2026-10-16 裁决**不关**(信任项目即信任其插件代码) |
| R2 | sidecar 进程内 JS(ext、受信项目插件、R1 的代码、codemode)可改 env / 调 `mcp.add` / 调进程内 `app.fetch` | 信任门后等同引擎权限(基线 S6 / S12),不承诺 |
| R5 | 围栏外预先存在的硬链 | main 从不建;用户自建不承诺 |
| R6 | well-known **远程 URL** / 组织 / managed / MDM 来源 | 系统或网络级,非本票(本地 `data:` wellknown 已由 C2-F 堵 auth.json) |
| R7 | 提示注入面(instructions / identity md / 技能) | 非可执行安装 |
| R8 | 伪造密钥在场文件 ⇒ 云 MCP 以假 token 注册并失败 | 非本机连接器 |
| R9 | codemode 解释器能力边界未勘破 | 默认关 |
| R10 | 基线 §6 第 6 / 9 条功能缺陷(远程 MCP dispose 后消失直至 re-fork;陈旧拷贝让「重新启用」失效) | 不由本票修;**OPTIONAL** 另票 |
| R11 | 逃生阀形态(`ALPHA_JSONC_TRUTH_DISABLE` 等)下的来源布局 | 不承诺 |

(R1 审计前的 R3「账本/journal 推断」与 R4「PATCH 500」已分别升为不变量 I7′ 与迁移项 §4,不再是残余。)

## 四、合法写者迁移

| 写者 | 迁到哪 | 用户可观察行为 | 怎么证明不变 |
| --- | --- | --- | --- |
| `{$schema}` seed(`alpha-config-injection.ts:85-92`)+ v2 投影 `materializeV2EngineConfig`(`:593-647`,含 `D/models.json`) | **搬进新文件 `engine-config-materialize.ts`(main-only)**,main `spawnLocalServer` 在 `syncSecretFiles` 之后调用;输入 = `alphaJsoncWithoutProviders()` + main 已有的 `buildAlphaModelConfig(userDataPath)`;`OPENCODE_CONFIG`/`OPENCODE_CONFIG_DIR`/`OPENCODE_MODELS_PATH` 进 `sidecarEnv`;sidecar `injectAlphaConfig` 删写盘与三处 `process.env` 赋值 | 不变:同一字面量/同一「缺席才写」;三文件字节相同、三键相同、仍 fork 时一次性 | I3′(闭包不含该文件 + tsv 删四行 + 接线)、I4′(字节比对)、I5′;`models-catalog-v2.wiring.cases.ts`(自己设 `OPENCODE_CONFIG_DIR`,`:168`)照跑 |
| 投影/seed 失败 | 拒绝 fork(fail-closed) | 从「引擎起来 + injection-failed 终态」变「这一代被拒」;症状同类(模型全灰) | 单测:注入失败 ⇒ `spawnLocalServer` 抛且不 fork(与 secrets sync 用例同形) |
| 自定义 provider 对话框保存(审计 ⑤:`dialog-custom-provider.tsx:138-152` 的 `auth.set`+`updateConfig`) | 改走 `providers.add` main 通路(key→keychain,定义→`custom-providers/<env>.json` 真源,围栏外);`packages/app` roundtrip(ADR-034) | **有限行为变化**(见下) | 组件用例;提交 → 真源文件、不再触 auth.json / `PATCH /global/config` |
| preset/platform provider「连接」(审计 ④:`dialog-connect-provider.tsx:824` 的 `integration.connect.key` → `server-compat.ts:400` 的 `auth.set`) | 改走 `providers.setKey(id,key)` main 通路(key→keychain);`packages/app` roundtrip | 不变:连接成功=已保存密钥;不再写引擎 `auth.json`(围栏内会 EPERM) | 组件用例:连接提交只调 `providers.setKey`、不触 `auth.set` |
| **自定义表单字段差异**(审计 ③) | 用 alpha `ProviderInput`/真源的字段集(id/name/compat/baseURL/apiKey/models[]/imageInput) | **变化**:上游自定义表单的 `headers`、per-model 显示名、`{env:VAR}` 引用、空 key 四项不被 `providers.add` 支持(`ext-config.ts:1198` 要 key 非空)——但这是 alpha 产品**既有** `AddProvider`(ADR-016)的字段集,非本票回退 | 如实登记;恢复这四项 = 另开 feature REQ(扩 `ProviderInput`+真源 schema+`validateProviderInput`),不在本票 |
| `auth.json`(引擎 `auth.set`,`control.ts:17`) | 不单独迁:上条把唯一可达写者接到 main 后,围栏内无合法 auth.json 写者;引擎仍读它(读放行) | 不变(alpha 密钥本走 keychain+`{file:}`,auth.json 正常为空) | C2-F(写 EPERM);§1.2 |
| 引擎自写(`$schema` 回写、TOML 迁移) | 不迁 | 本就静默 catch;TOML 迁移在 D 下永远不会完成(D 由 main 写,不会有 `config`) | 无 |
| `mkdirSync(userDataPath)` 四处、`alpha-identity.md`、`<dataHome>/opencode` 的 log/db | 不迁 | 不变(目录内写放行,§1.3 第 1 条) | I1′ 目录内写臂;I5′ |

## 五、子票切分与规模

两步、两张 CODE 票、两个 PR,**先迁写者再加围栏**(围栏先上会让今天的投影在围栏内 EPERM —— stage2-options §3 已实测 `result.ok=false`)。
`#1530` 保留为第二步;第一步新开子票,`#1530` 依赖它。规模:C2-a **M**;**C2-b 按审计建议估 L**(安全变更,围栏面 + 事务/wellknown 多来源 + 工作区选择联动,全量审计更稳妥),
不改上游。各自一轮审计预算之内(owner 已批方案审计 ≤2 轮)。C2-a 的判据**不依赖** C2-b 的 `CONFIG_FENCE_TARGETS`(先票先合)。

### C2-a `[CODE]` 引擎配置投影与 seed 改由主程序在 fork 前写(新票,M)

- **边界(文件)**:新 `packages/ui-mac/src/main/engine-config-materialize.ts`(main-only:seed + `materializeV2EngineConfig`,从 `alpha-config-injection.ts` 搬出)、
  `server.ts`(`spawnLocalServer` 调它 + 设三个 env 键 + 失败拒 fork)、`alpha-config-injection.ts`(删 `:85-92` 写盘、`:475` 调用、三处 `process.env` 赋值)、
  `alpha-config-injection.test.ts`、`scripts/process-fence-write-sites.tsv`(重生)、`process-fence-write-sites.test.ts`(I3′ 的三条构造性断言)、`server.test.ts`(拒 fork + 接线用例)、
  **两条 provider 保存入口(packages/app roundtrip,审计 ⑤④):`dialog-custom-provider.tsx` → `providers.add`、`dialog-connect-provider.tsx`(`:824` 连接提交)→ `providers.setKey`;`patch-upstream.ts` 同步**。provider main IPC(`provider-ipc.ts`)已存在,不新增。
- **AC**:AC1 I3′(写者由构造离开围栏:闭包不含新文件 + tsv 删四行 + 接线断言,**明确允许已存在目录 recursive mkdir**);AC2 I4′(三文件三键与 HEAD 逐字节/逐值相同);
  AC3 投影失败 ⇒ 拒 fork 且日志点名;AC4 **两条** provider 入口都只经 alpha main IPC(`providers.add` / `providers.setKey`)、不触 `auth.set` / `PATCH /global/config`(组件用例),自定义表单字段差异按 §4 登记。
- **不做**:围栏规则、ext、`CONFIG_FENCE_TARGETS`(归 C2-b)、恢复上游自定义表单的四项字段(feature REQ)。
- **退出条件**:AC1–AC4 绿;`bun test src`、typecheck、north-star、frontend roundtrip 绿;真机 dev 启动后模型选择器 + 两条 provider 保存与改前一致(owner 一眼)。
- **证据**:L0 门 + 上述用例。

### C2-b `[CODE]` 围栏收紧出全局配置位置的文件、目录身份、自动执行目录与恢复/账本真源(`#1530`,L)

- **第零步已完成(写进票面)**:审计 ④ 的 journal 回滚攻击**已实测确认**(§1.4,[journal-rollback-probe.ts](../verification/2026-10-15-req234-c2-fence-preverify/journal-rollback-probe.ts)),
  所以 C2-T(`G/ext-tx` + `G/installs.json`)是**必须**项,不是条件项。
- **边界(文件)**:`process-fence-profile.ts`(`CONFIG_FENCE_TARGETS` 常量表 + 四行渲染 + 新助手 `writableAncestorIdentities`,审计 ③;**`selectWorkspaceUnion` 不改**)、
  `process-fence-profile.test.ts`(I6′ a 两条 tripwire + I8′ 可写祖先身份锁 + 工作区仍可写的正例)、新 `process-fence-config.test.ts`(I1′/I7′ 表驱动矩阵,复用 `dir-identity-probe.ts` 的场景与
  `fs-probe2.mjs` / `syscall-probe.py` 形制)、`mcp-config-rebuild.test.ts` + `test-fixtures/process-fence/mcp-config-{main,observe}.ts`(I2′,从草稿精简)、
  `process-fence-engine.test.ts`(I5′ 一臂)、`process-fence-plan.ts`(把实际 allow 根与受保护目标集传给 `writableAncestorIdentities`,渲染进 profile)、
  `docs/architecture/2026-09-09-req159-process-fence.md`(可写集文档加「其中只读的位置」一节)、`scripts/gate-files.tsv`(登记 darwin-only 测试)。
- **AC**:AC5 I1′(C2-F/P/I/T 全路径 EPERM、目录内写 OK);AC6 I2′(端到端同名覆盖反例);AC7 I5′(真引擎在候选 profile 下起);AC8 I6′(四行 + 两条 tripwire);
  AC9 I7′(ext-tx/installs 写 EPERM);AC10 I8′(可写祖先身份锁 + XDG-under-U/under-ws 反例 + 默认工作区正常启动与可写正例)。
- **不做**:ext 改动、项目作用域、`OPENCODE_DISABLE_PROJECT_CONFIG`、`packages/app`、上游。
- **退出条件**:AC 全绿;真机:围栏内 `echo >> alpha.jsonc`、`mv alpha-engine-config x`、建 `~/.opencode/tool/x.js`、建 `G/ext-tx/journal/x.json` 均 EPERM;
  定制中心重装一次本地 MCP 后行为与改前一致;**交付承诺收窄为「受保护的全局文件与目录在围栏内写不进、换不掉」**(§六,不宣称「唯一通路」)。
- **证据**:L0 门 + 四组 darwin 测试;打包 RC 的 L3 smoke 归基线 V1。

### 草稿处置(worktree 未提交物)

保留并改造:`server.ts` 的 seed 搬迁(改成调用新 `engine-config-materialize.ts`)、`alpha-config-injection.ts` 删写盘、`mcp-config-rebuild.test.ts` 与两个 fixture(去变异臂)、
`process-fence-config.test.ts`(改为表驱动)、`process-fence-profile.ts` 的插槽位置(两行 → 四行)。**废弃**:`mcp-default-deny.ts` / `mcp-server-truth.ts` 迁入 ext 的 rename、
`packages/ext/package.json` 与 `bun.lock` 的 `jsonc-parser` 声明、`ext/plugin.ts` 的 `rebuildMcpConfig`、`mcp-server-truth.test.ts` 改动。

## 六、项目插件的全局升级路径:owner 已裁决不关(2026-10-16)

**这是什么**:用户信任一个项目后,该项目里的 `.opencode/plugin(s)`(上游,无信任门)或 `.code-puppy/plugins`(ext,有信任门)里的 `.js` 会被引擎以同等权限
在进程内执行;它可以改进程内的 `OPENCODE_CONFIG_CONTENT` 或调 `mcp.add`,在下一次全局 dispose 后影响**所有**目录的实例(R1)。前提是用户打开并信任了该项目。

**owner 裁决(2026-10-16,原话)**:「- 不关（默认）」。

**含义**:信任项目即信任其插件代码,维持现状,不动项目配置加载、不给上游项目目录补信任门、**不开新票**。因此本票对外**只承诺**「**受保护的全局配置文件与目录在围栏内写不进、换不掉**」,**不宣称**「安装只能经确认框 / 确认框是唯一安装通路」。这条不挡 C2-a/C2-b 的合并与部署。

(当初列出的备选 B「`OPENCODE_DISABLE_PROJECT_CONFIG=1` 关上游项目配置」、C「给上游项目目录补信任门(`UPSTREAM_PATHS` 改动)」均已被此裁决否掉,不实施。)

## 七、仍是推断、没跑过的断言

1. ~~R3 的 journal 植入在真实恢复路径上到得了~~ —— **已实测确认**,带 `probe`+`receiptCommitted` 的等价参数也成立(§1.4,`journal-rollback-equiv-probe.ts`),从本节移除。
2. ~~可写祖先搬移~~ —— 已实测(`writable-ancestor-probe.ts` 三拓扑):XDG 落进 W3/W1 时祖先身份锁住改名、工作区仍可写、默认工作区仍启动;`writableAncestorIdentities` 从实际 allow 根派生,C2-b 固化为判据。
3. 真引擎在 C2-I 下 `npm install` 到 D / HO / XO 不会对目录本身做 `chmod` / `utimes`(I5′ 实跑即证;红了就是 I5′ 该红)。探针已证目录内普通写与 recursive mkdir 不受影响。
4. main 在 fork 前算的 `buildAlphaModelConfig` 与 sidecar 当时算的逐字节相同 —— `server.ts:188-189` 已断言「同一函数、同一 userDataPath、密钥文件刚落定」,
   I4′ 用同一进程两种调用形态比对,不覆盖「两个进程 env 不同」这一维;两个进程的 `ALPHA_*` 输入由 allowlist 保证同值(`sidecar-env.ts:58-66`)。
5. 投影失败改为拒 fork 不会在真机上误伤:今天能让投影失败的只有 `alpha.jsonc` 读不出(`:579-591` 已容错为清掉拷贝)与 `mkdir D` 失败;
   后者在 main 侧与 `ensureEngineScratchCwd` 同类。
6. `G/ext-tx`、`G/installs.json`、`auth.json` 在 sidecar 闭包内零合法写入点:tsv 登记的 `alpha-installs.ts` / `ext-receipt-v2.ts`(W2)/ `auth.set`(引擎,走对话框)都由 main 或已迁走的对话框承载,
   基线 F1 称恢复/账本「只由 main 执行」—— I3′/I7′ 的断言把这句从散文变成判据(C2-b 实现时验;恢复/账本确在 main 跑,`ext-ipc.ts`/`index.ts` 均 main 进程)。
7. `auth.json` 的 wellknown `data:` 本地来源:`bun` fetch 实测 200;C2-b 的 I2′ 可加一臂用真引擎 `authSvc.all()` 路径复核(审计用 Electron 内存探针已确认无网络)。
