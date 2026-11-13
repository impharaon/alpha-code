---
id: PLAN-project-consent-store
title: 项目扩展信任记录移出项目目录 实施计划
summary: "#1709 一段:项目扩展的信任只认用户在确认框里的决定,记录存在 Code Puppy 自己的状态目录,项目目录里的任何文件都不再算数"
kind: plan
status: active
spec: ""
design: ""
owners: [alpha-code desktop maintainers]
last_reviewed: 2026-11-13
---

# PLAN-project-consent-store｜项目扩展信任记录移出项目目录 实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。实施中偏离本段,在同一个提交里改本段。
代码坐标取 `origin/alpha` @ `e54edd9cf8`;路径相对仓库根。

## 段一:信任只来自确认框(alpha-code#1709)

- 依据:Issue [alpha-code#1709](https://github.com/impharaon/alpha-code/issues/1709) 正文 2026-11-13T04:16:22Z 版(「处置」与「回归验证」四条;已定勿重开:不放项目目录、旧记录不迁移且重新确认一次、确认框外观不变);意图 INT-safety I-11。无 spec、无 design.md:Issue 把存放位置、身份绑定与读取通道交给本计划写明。并行票 alpha-code#1708(分支 `fix/project-engine-plugin-consent`)。
- 核对:`1cba887070` · 编排器(Claude Fable 5.2)· 通过。裁决:第三个消费方(项目 agent 的控制字段)在范围内,与插件、项目 MCP 同样把门、单独证明;U1 只删括号,不加新位置的说明;U2 本票不加撤销界面,只在记录层证明撤销,「用户没法撤销项目信任」由编排器记为意图条目;U3 原地读算现有通道,另须证明围栏内在记录路径或其父目录建的符号链接不会被跟随成「已同意」;U4 接受(规范目录 + inode),写进仓库的架构文档,Windows 无围栏作为已知限制写在同一处;旧 `extensionsConsent` 三处读方全部停读,不删用户文件,main 不再写。

### 1 现状:谁读、谁写、谁被它把门

读写方:

| 角色 | 位置 | 今天做什么 |
| --- | --- | --- |
| 唯一写方 | `packages/ui-mac/src/main/ext-ipc.ts:609` | `ext-trust-check` 在原生确认框返回后,经 `writeProjectPrefs`(`codepuppy-workdir.ts:234-245`)把 `extensionsConsent {version, granted, decidedAt}`(`codepuppy-ext-trust.ts:14-32`)写进项目 `.codepuppy/prefs.json` |
| main 读方 ① | `ext-ipc.ts:579-580` | 同一 handler:已有当前版本的决定 ⇒ 不弹框,直接回 granted |
| main 读方 ② | `ext-ipc.ts:120-126` | `projectMcpState`:定制中心项目 MCP 行的 awaiting-consent / consent-denied;另经 `ext-ipc.ts:1468` → `hub-view.ts:281` 进 agent 的定制中心视图 |
| ext 读方 | `packages/ext/src/project-config.ts:228-240` `readProjectExtensionsConsent` | 只看 `granted === true`,不看版本、不看来源。本会话在临时目录对 e54edd9cf8 复跑:自带 `{"extensionsConsent":{"granted":true}}` 的项目返回 `true` |
| renderer | `renderer/codepuppy-ui/ext-trust-watcher.tsx:46-56` → preload `trustCheck`(`preload/index.ts:269`) | 进项目会话路由时调 `ext-trust-check`;`prompted && granted` ⇒ 请求 ext 重载 |
| 测试里的造法 | `packages/ext/src/plugin-host.test.ts:698,713,735,795,865,890`、`plugin-setup-order.cases.ts:55`、`project-config.test.ts:277`、`ui-mac/src/main/codepuppy-ext-trust.test.ts:10-41`、锚 `ext-project-adopt.test.ts:156-169`(找字面量 `hasExtensionsDecision(prefs)`) | 都按「项目 prefs.json」造同意 |

受这条记录把门的消费方(ext 侧全部经 `readProjectExtensionsConsent`):

| 消费方 | 位置 | 同意后放开什么 |
| --- | --- | --- |
| 项目插件扇出 | `packages/ext/src/plugin.ts:375-391` → `plugin-fanout.ts:163-170` | `.codepuppy/plugins/*.js` 在引擎进程里 `import()` 并 `setup` |
| MCP 命名空间保护 | `plugin.ts:378` | 随扇出,只在同意时追踪 |
| 项目 MCP | `plugin.ts:256-261` → `project-config.ts:145-151` | `codepuppy.jsonc` 的 `mcp` 进引擎并启动 |
| **项目 agent 的控制字段**(Issue 未列) | `plugin.ts:256-261` → `project-config.ts:153-157,187` | agent 的 `permission` / `tools` / `model` / `disable` / `mode` 进引擎。自带同意的项目因此能改写内置 agent 的审批规则(`plugin-host.test.ts:858` 起的 `exploreEditEffect` 用例证明同意后这条路通) |
| `codepuppy_register` 的提示语 | `codepuppy-tools.ts:89,104-107` | 只决定回给模型的一句提示,不把门 |

结论:ext 只有这一个读函数,签名 `(project: ProjectRoot) => boolean | null` 保持不变,`plugin.ts` 不改;main 侧两个读点与唯一写点都在 `ext-ipc.ts`。

项目 `.codepuppy/` 里其它「像信任」的东西(只列,本票不改):

- `prefs.json` 的 `externalImport`(`ecosystem-import.ts:185-194`,`ext-ipc.ts:653-655`):项目自带一份只会让导入确认框不出现;导入只在框里点「导入」时发生(`ext-ipc.ts:675-692`),生态继承仍默认拒(ADR-024)。只会收窄,不放宽。
- `codepuppy.jsonc` 的文本类域(agent 说明字段、command、`skills.paths`,`project-config.ts:153-179`;注入侧 `codepuppy-config-injection.ts:99`):按 REQ-060 §3 不设门;`skills.paths` 可以写绝对路径,内容仍是文本。
- 上传 / 云同意:早已不落项目(`codepuppy-cloud-consent.ts:1-2`),本票是同一方向。
- 项目 `.opencode/`、`opencode.json` 的引擎插件:alpha-code#1708 的范围。

### 2 新记录放在哪、长什么样、怎么绑项目身份

- 位置:`<casBaseRoot>/project-trust/<env>.json`。`casBaseRoot` = `<appData>/codepuppy-state`(`codepuppy-environment.ts:55-63`),与 `env/`、`cas/`、`fence-workspaces/`、`custom-providers/`、`mcp-servers/` 同级;按环境分文件(prod / beta / dev 各一份,同 `process-fence-workspaces.ts:10-14`)。
- 为什么不放 `CODEPUPPY_GLOBAL_DIR`(`env/<env>`)或 `<userData>`:这两处是引擎进程围栏的可写根 W2 / W3(`process-fence-profile.ts:46-48,155-157`),引擎里 agent 的写文件工具和已信任项目的插件都写得到。`casBaseRoot` 下的其余目录不在任何可写根之下,与状态根相关的工作区候选一律排除(同文件规则 5b,`:199-204`)。「只有 main 写、引擎只读」本仓已有三份先例:`fence-workspaces`、`custom-providers`、`mcp-servers`。
- 形状(严格读,任何一处不对就整份拒,不猜不修):

  ```json
  { "v": 1, "projects": { "<规范项目目录绝对路径>": { "ino": "<目录 inode,十进制字符串>", "version": 1, "granted": true, "decidedAt": "<ISO 时间>" } } }
  ```

  `v` 是文件格式版本;`version` 沿用 `EXTENSIONS_CONSENT_VERSION`(`codepuppy-ext-trust.ts:9,14`:告知内容实质变化时加一,旧决定失效)。granted 与 denied 都记,沿用「拒绝也不再弹」(`codepuppy-ext-trust.ts:8`)。ext 也按 `version` 判(今天 ext 不看版本,与 main 不一致;决定语义改为一处定义、两边共用)。
- 身份:键 = main 与 ext 已经各自算出的同一个规范目录(main `resolveProjectCodePuppyRoot` 的 `projectDir`,`codepuppy-workdir.ts:126,163`;ext `projectDirectoryIdentity` 的 `directory`,`project-config.ts:33,69`;两边都是 `normalize(realpathSync(dir))`),外加目录本身的 inode(`statSync(dir, { bigint: true }).ino`,存字符串,不丢精度)。查找要求键逐字相等、inode 相等、`version` 为当前版本,三者同时成立。读写都包在现有的身份夹逼里(main `withProjectIpcEntryIdentity`,ext `withProjectDirectoryIdentity`)。
- 为什么加 inode:今天记录住在项目里,目录删了记录跟着没了;只按路径记,「删掉已信任的项目、在同一路径克隆一个陌生仓库」会继承信任,比今天更宽。临时目录实测(APFS):同路径删后重建 inode 变;`mv` 保留 inode;复制得到新 inode;经符号链接 realpath 落到同一目录。不用 `dev`:外接卷的设备号随挂载变化,带上它只会多弹框,换不来安全。

| 情形 | 结果 |
| --- | --- |
| 已信任项目改名 / 移动 | 新路径查不到,按未同意,框再出现 |
| 经符号链接打开已信任项目 | realpath 是同一目录、同一 inode,仍信任(本来就是同一个目录) |
| 复制 / 再克隆一份到别处 | 新路径、新 inode,未同意 |
| 同一仓库的两个检出(含 git worktree) | 两个目录各自确认 |
| 删掉后在原路径重建或重新克隆 | inode 变,未同意 |
| 改回原名(同一目录) | 路径与 inode 都对上,恢复信任 |

### 3 ext 怎么读到它、什么时候生效

- 通道:启动配置通道。main 启动时派生 `CODEPUPPY_GLOBAL_DIR`(`codepuppy-environment.ts:176`;外部预置被拒,`:126`),经 `sidecar-env.ts:92` 白名单进 sidecar;ext 的 setup 先校验它是 canonical 实目录(`plugin.ts:120` → `project-config.ts:85-111`)。sidecar 用现成的逆映射 `resolveCodePuppyStateBase`(`codepuppy-environment.ts:84-101`)从它得到 `casBaseRoot` 与环境名,原地读 main 写的文件。远程 MCP 真源和自定义节点真源就是这样读的(`mcp-server-records.ts:20-25`、`custom-provider-records.ts:31-36`)。不新增环境变量,不新增 parentPort 消息类型。
- 不选 parentPort 问答(`hub-bridge.ts`):要在 `codepuppy-sidecar-messages.ts` 的合同里加类型;配置合成在 transform 回调里同步调用(`plugin.ts:248-280`),异步问答得先在 setup 预取;没有 parentPort 的宿主答不出。不选「fork 时把名单塞进注入」:同意之后要重启引擎才生效,比今天(重载即生效)慢,时机变了。
- 读的路径项目改不了:绝对路径,由 main 派生的环境根算出;不经项目目录,不经项目能设的变量,不跟相对路径。项目树里一个字节都不读。
- 生效时机与今天相同:ext 在每次 setup / transform 重跑时现读,不缓存。确认框点同意后,renderer 已有的重载请求(`ext-trust-watcher.tsx:52-56`)让 ext 重载,下一条消息起项目插件与项目 MCP 生效。记录改成拒绝或被删掉,从下一次重载起不再加载;已装上的插件钩子在那次重载的清理里撤掉。定制中心的项目 MCP 状态每次查询现读,立即反映。

### 4 项目还能做什么

- 项目树里的任何文件:ext 与 main 都不再从项目读信任。自带 `prefs.json`(新旧两种写法)、在项目里放一份同名 `project-trust/<env>.json`、放一份以自己路径和 inode 为键的「合法」记录,都不会被读到。
- 指向状态目录的符号链接:`.codepuppy` 本身是链接时,两边都不认这个项目(`codepuppy-workdir.ts:153-158`、`project-config.ts:57-62`)。`.codepuppy/prefs.json` 链到记录文件时,ext 不读 prefs 判信任;main 往项目 prefs 写的唯一剩余调用方(`ext-external-check` 的 `externalImport`,`ext-ipc.ts:693-696`)经 `safeResolveInCodePuppy` 的 realpath 包含检查,链出 `.codepuppy` 即拒写(`codepuppy-workdir.ts:191-212,234-245`)。
- 像而不是的名字:键逐字比较且要求 inode 相等,另一个目录不可能同时满足。
- 让 main 写记录:唯一写入点在 `ext-trust-check` 里,原生确认框返回「允许加载」且勾了知情框之后(今天 `ext-ipc.ts:602-609` 的同一位置)。调用方只有应用自己的 renderer(preload `trustCheck`,由 `ExtTrustWatcher` 调);窗口 `sandbox`、`contextIsolation`、禁 webview、导航与弹窗锁在自家源(`windows.ts:196-204,214-233`)。项目里的 HTML / PDF 在没有 preload 的 WebContentsView 里预览(`rail-preview-host.ts:6,509-515`),其余产物只以文本节点呈现(`artifact-workbench/renderers/renderer-views.tsx:3`),都碰不到 IPC。就算有内容调到了这条 IPC,也只是让确认框弹出;写入要用户在主进程的模态框里点击。
- 让引擎写记录:记录目录不在围栏可写集里(macOS),引擎里 agent 的写文件工具与已信任项目的插件都写不进。由新增的围栏实测证明(见证明表)。

### 5 升级后的第一次

- 以前同意过的项目:新记录里没有它,`ext-trust-check` 当作未决,有可执行扩展就弹框一次;用户点了(允许或拒绝)就落新记录,之后不再弹。项目里的旧 `extensionsConsent` 不迁移、不删除(不往用户项目里多写一次),从此没人读它。以前拒绝过的项目同样再问一次。
- 没有可执行扩展的项目:`ext-ipc.ts:578` 的早退在查记录之前,照旧不弹框。
- renderer 去重、弹框时机、按钮与默认项不变;文案见待核对 U1。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/main/project-trust-truth.ts`(新) | 记录的唯一读端,electron-free、只读,sidecar 与 main 共用:路径公式、严格解析、按「规范目录 + inode + 当前版本」查找、取项目目录 inode、经 `resolveCodePuppyStateBase` 定位并读取(位置未知或文件坏了返回空并出一行原因;文件不存在返回空、不出声) |
| `packages/ui-mac/src/main/project-trust-truth-write.ts`(新) | main 专用写端:读出现有记录(坏了记一行后从空开始)、改这一条、临时文件加 rename 原子写;位置未知或写失败返回 `{ ok: false, reason }`。不进 sidecar 的 import 闭包 |
| `packages/ui-mac/src/main/codepuppy-ext-trust.ts` | 决定语义(是否已有当前版本的决定、是否允许)改为作用在记录条目上,删掉写 prefs 的 `withExtensionsConsent`;抬头注释改成新位置。`listProjectExecutables` 不动 |
| `packages/ext/src/project-config.ts` | `readProjectExtensionsConsent` 改从新记录读,签名不变,身份漂移仍回 `null`;删掉读 `prefs.json` 的代码与注释 |
| `packages/ui-mac/src/main/ext-ipc.ts` | `projectMcpState` 与 `ext-trust-check` 改查新记录;弹框前取身份,写入前复核身份未变(变了就不落盘,走现有 `persistError`);写入改调新写端,不再写项目 `prefs.json`;抬头注释改位置。弹框文案见待核对 U1 |
| `packages/ui-mac/src/renderer/codepuppy-ui/ext-trust-watcher.tsx` | 只改第 5 行注释里的存放位置 |
| `packages/ext/src/project-config.test.ts` | 新增 `#1709` 一组(见证明表) |
| `packages/ext/src/plugin-host.test.ts` | `env()` 的全局根改成 `<scratch>/codepuppy-state/env/dev`,每条用例起头清掉记录;同意用例改造(见证明表,条数不变);其余 6 处 `prefs.json` 改为经新写端登记同意 |
| `packages/ext/src/plugin-setup-order.cases.ts` | 全局根改成 `…/env/dev`,同意经新写端登记 |
| `packages/ui-mac/src/main/codepuppy-ext-trust.test.ts` | prefs 决定语义那组改成条目语义(旧组编码的正是被替换的行为) |
| `packages/ui-mac/src/main/ext-project-adopt.test.ts` | 锚字面量 `hasExtensionsDecision(prefs)` 换成新代码里的对应调用;`source-text-anchors.ts:162` 那条的 `lines: 1` 不变 |
| `packages/ui-mac/src/main/project-trust-truth.test.ts`(新) | 读写端单测:严格解析的正反样本、查找的三项条件、写端保留其它条目、坏文件被覆盖并出声、位置未知拒写;以及见证明表 R3 |
| `packages/ui-mac/src/main/project-consent-store.engine.cases.ts` 与 `.engine.test.ts`(新) | 真引擎用例:嵌入式 OpenCode 2 + 生产注入 + 真 ext(`test-component/codepuppy-engine.ts`,不改这个宿主;嵌套的项目文件在 `start()` 之前自己写);宿主起独立 `bun test` 子进程 |
| `packages/ui-mac/test-component/ext-trust-check.ipc.cases.ts` 与 `packages/ui-mac/src/main/ext-trust-check.test.ts`(新) | 跑生产 `registerExtIpcHandlers` 注册的 `ext-trust-check`,electron 的 `dialog.showMessageBox` 换成记账替身(接法照 `test-component/local-package-channel.cases.ts`) |
| `packages/ui-mac/src/main/project-trust-truth-fence.test.ts`(新) | 生产围栏 profile 交给真 `sandbox-exec`,记录写不进(照 `custom-provider-truth-fence.test.ts`,darwin) |
| `scripts/gate-files.tsv` | 登记三个新闸门文件(两个子进程宿主、一个围栏实测)的精确条数;`plugin-host.test.ts` 那行条数不变 |
| `docs/architecture/2026-11-13-project-extension-trust-record.md`(新)、`docs/README.md` 文档索引 | 架构说明:记录位置与形状、身份规则(规范目录 + inode)、谁能写、升级与生效时机、已知限制(Windows 无围栏、无撤销入口);索引由 `docs_index.py --write` 重生成 |

### 顺序

1. 复现(不提交红):先写 `project-consent-store.engine.cases.ts` 的「自带旧记录」一条,在未改的代码上跑,记下标记文件出现、项目 MCP 启动日志有 `+`;输出摘要写进第 3 步的提交信息。
2. 记录读写端、`project-trust-truth.test.ts`、`codepuppy-ext-trust.ts` 的语义改造及其测试。跑 `project-trust-truth.test.ts`、`codepuppy-ext-trust.test.ts`。
3. ext 读端切换、ext 侧测试改造、真引擎用例补齐三条。跑 `packages/ext` 的 `project-config.test.ts`、`plugin-host.test.ts`(整份,全局根改了)、`plugin-setup-order.test.ts`、`plugin-fanout.test.ts`;ui-mac 的 `project-consent-store.engine.test.ts`(跑两遍);第 1 步那条转绿。
4. main 切换(`ext-ipc.ts` 与注释)、IPC 用例、锚。跑 `ext-trust-check.test.ts`、`ext-project-adopt.test.ts`、`codepuppy-workdir.test.ts`、`old-name-scan.test.ts`、`gate-file-registry.test.ts`。
5. 围栏实测与 `gate-files.tsv`。跑 `project-trust-truth-fence.test.ts`、`gate-file-registry.test.ts`;两包 typecheck(`packages/ext` 的 `tsgo --noEmit`,`packages/ui-mac` 的 `tsgo -b`)。

### 风险

- 键的写法:Electron 里的 Node `realpathSync`(JS 实现)不改大小写;main 与 ext 拿到的是同一个路由目录字符串,键一致。万一不一致,只会多弹一次框,不会误放(还要 inode 相等)。
- Windows 没有进程围栏:「引擎写不进记录」只在 macOS 成立;记录仍在项目之外,满足 Issue 的要求。Windows 上引擎的写入面不在本票。
- 旧名扫描:新代码和改动的行不写旧品牌名;`plugin.ts:258,376` 两行带旧名的日志不动,所以 `scripts/old-name-exceptions.tsv`(1708 也在改)不用动。
- `plugin-host.test.ts` 改全局根会波及整份 29 条,所以整份跑;每条用例起头清记录,防止同一目录串味。
- 真引擎:项目 MCP 何时启动(Location 激活时还是首个请求时)以正臂实测为准,反臂等同样时限;正臂同时证明反臂的「不出现」不是空转。
- 坏记录:main 在下一次决定时覆盖(记一行日志),期间 ext 一律按未同意。围栏写不进,这不是攻击可达的状态。
- 记录只增不减:每个决定过的目录一条,不做回收。
- 与 alpha-code#1708 共用的文件只有 `scripts/gate-files.tsv`(两边都加行,合并时按行合)。我不改 `test-component/codepuppy-engine.ts`;1708 AC-02 的对照臂(项目自带 prefs 同意)在本票之后仍成立。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| R1 真引擎:项目自带旧记录 ⇒ 插件不执行、项目 MCP 不启动 | `project-consent-store.engine.cases.ts`「自带旧记录」:项目有 `.codepuppy/plugins/marker.js`(setup 时往沙箱写标记)、`codepuppy.jsonc` 的 `mcp.proj`(真 stdio 夹具 `MCP_FIXTURE`,`CODEPUPPY_MCP_STARTUP_LOG` 启动即写 `+`)、旧写法 `prefs.json`;起引擎,等到正臂同样的时限 ⇒ 无标记、启动日志不存在、`GET /api/mcp` 无 `proj`。另:`plugin-host.test.ts:678` 同意用例第一段改成「自带旧记录」⇒ 项目 MCP 不进引擎、探针插件 0 次、agent 的 `mode` 被剥、项目写给 explore 的 `permission.edit: allow` 不生效(explore 对 edit 仍 deny) | 已知的坏:读端恢复读项目 `prefs.json`,或直接在 e54edd9cf8 上跑(第 1 步),标记出现、日志有 `+`,用例红 |
| R2 同意后两样照常生效;撤销后不再生效;身份变化按未同意 | 同一 cases 文件「用户同意」:经生产写端为该项目(规范目录 + inode)登记 granted、重启 ⇒ 标记出现、日志 `+`、`proj` 已连接;「撤销」:写端改成 denied、清掉标记与日志、重启 ⇒ 都不出现。`plugin-host.test.ts:678` 第二、三段:重新 activate(与重载同一条路)⇒ 同意后项目 MCP 进引擎、探针 1 次、explore 的 edit 变 allow;撤销后新的 recordingMcp 里没有 `proj`、探针仍 1 次。`project-config.test.ts`「#1709 身份」:同意后改名、在原路径删后重建、复制 ⇒ false;经符号链接打开 ⇒ true;`ext-trust-check.ipc.cases.ts`「重建后再弹」 | 不读新记录 ⇒ 永远未同意,同意臂红;只看条目在不在、不看 granted ⇒ 撤销臂红;不比 inode ⇒ 重建那条返回 true;按词法路径不走 realpath ⇒ 符号链接那条 false |
| R3 项目里的任何文件(含指向用户数据目录的符号链接、同名文件)都不能写入或冒充记录 | `project-config.test.ts`「#1709 冒充」:自带 prefs(`{granted:true}` 与 `{version:1,granted:true}` 两种)、项目内同名 `project-trust/dev.json`(以自己路径 + inode 为键的合法记录)、`.codepuppy/prefs.json` 链到真记录文件(记录里只有别的项目)⇒ 全 false;该项目条目是旧 version ⇒ false;`CODEPUPPY_GLOBAL_DIR` 不是 `<base>/env/<env>` ⇒ false。`project-trust-truth.test.ts`:项目 `prefs.json` 链到记录文件时 `writeProjectPrefs` 拒写、记录字节不变。`project-trust-truth-fence.test.ts`:围栏内写记录文件、在记录目录建文件、建记录目录、先在 W2 造好再 mv 进来 ⇒ 全部 Operation not permitted、零落盘;控制臂同一 profile 下 W2 / W3 落盘;bare 臂经生产写端落盘并读回 | 读端仍读项目 ⇒ 前三条 true(第一条就是 Issue 的复现);记录路径挪进 `env/<env>`(W2)⇒ 围栏那条落盘,红;去掉 realpath 包含检查 ⇒ 记录被改写 |
| R4 升级后第一次打开已同意过的项目弹框一次,同意后不再出现 | `ext-trust-check.ipc.cases.ts`「升级」:带插件 + 旧写法 prefs ⇒ 第一次调用弹框一次(传给 `showMessageBox` 的 title / message / buttons / defaultId / cancelId / checkboxLabel 与现值逐字相等)、替身答「允许 + 勾选」⇒ `{prompted:true, granted:true}`,记录里有该目录与 inode,项目 `prefs.json` 字节不变;第二次调用不弹 ⇒ `{prompted:false, granted:true}`。同文件附带:无可执行扩展 ⇒ 不弹;「允许」未勾 ⇒ 不落盘、下次再弹;拒绝 ⇒ 落 denied、下次不弹 | 仍查项目 prefs ⇒ 第一次 0 次弹框、直接 granted;仍写项目 prefs ⇒ 项目文件字节变了 |

### 待核对

- U1 弹框文案与「文案不变」冲突。`ext-ipc.ts:595` 写着「本决定按项目记录一次(存于本项目 `.codepuppy/prefs.json`),之后不再重复询问。」改完后括号里的话是错的,而 Issue 正文与派发书都要求文案不变。选项:(a) 一字不改,用户被告知记录在项目里,去改那个文件不起作用;(b) 只删括号,成为「本决定按项目记录一次,之后不再重复询问。」;(c) 括号换成「存于 Code Puppy 本机,不在项目里」。建议 (b):改动最小、说的是真话、不加新概念,外观、按钮、时机都不变。实施会话不自己选,等核对。
- U2 「撤销后不再生效」没有用户入口。今天没有撤销界面:preload 只暴露 `trustCheck`(`preload/index.ts:269`),定制中心只显示 consent-denied(`renderer/extensions/use-extensions.ts:193-207`)。今天用户还能手改项目 prefs,改完后连这条路也没了。本计划只在记录层证明撤销生效(写端改成 denied 或删条目,下次重载起不加载),不加界面(Issue「界面影响:复用」)。如果要让用户能撤销,建议作为意图条目回 INT-safety。
- U3 通道认定。本计划把「main 派生的环境根 + 原地读 main 写的真源文件」当作启动配置通道(先例 `mcp-server-records.ts:20-25`)。如果核对认为只有「注入内容」或「parentPort 消息」才算,备选是 fork 时注入名单,代价是同意后要重启引擎才生效(时机变了),需要另行裁决。
- U4 身份比现有的「规范路径」多一项 inode(理由见第 2 节)。这是本计划的选择,请核对。

### 偏离记录

- 2026-11-13 · 顺序:原第 2 步里 `codepuppy-ext-trust.ts` 的语义改造挪进第 3 步,原第 3、4 步(ext 切换与 main 切换)合成一个提交 · 语义函数的入参从 prefs 换成记录条目,ext 与 main 两个调用方必须在同一个提交里跟上,否则中间提交编译不过 · 第 2 步提交(本提交只含记录读写端与其单测)。
- 2026-11-13 · U3 裁决的补充:读端遇到记录文件或记录目录是符号链接即拒(一个项目都不信任),写端拒往符号链接目录里写;单测各有一臂(伪造记录本身合法、换成链接就不认),围栏实测在第 5 步加「围栏内在记录路径与记录目录建符号链接 ⇒ 不许」一臂 · 本提交落读写端与单测。
- 2026-11-13 · 改动表外两个文件:`packages/ui-mac/src/main/codepuppy-environment.ts` 与 `packages/ui-mac/src/preload/types.ts`,`CodePuppyEnvironmentInfo` 的定义从 preload/types 挪进 codepuppy-environment(preload/types 原样转出,无行为变化)· ext 经 project-trust-truth.ts 引用现有的状态根解析,codepuppy-environment 原来那条指向 preload/types 的 type import 把整张 IPC 类型图(含依赖 Electron 专有类型的 main 模块)拖进 ext 的 `tsgo --noEmit`,报 3 处与本票无关的错;挪定义是同一调用链上最小的修法,不复制拓扑文法 · 第 3 步提交。
- 2026-11-13 · `scripts/gate-files.tsv` 里两个子进程宿主(`ext-trust-check.test.ts`、`project-consent-store.engine.test.ts`)的登记提前到第 3 步提交,围栏实测那行仍在第 5 步 · `gate-file-registry.test.ts` 要求起嵌套 `bun test` 的宿主与它同一个提交登记 · 第 3 步提交。
- 2026-11-13 · 新增架构说明 `docs/architecture/2026-11-13-project-extension-trust-record.md` 与文档索引重生成(原计划不改文档)· U4 裁决要求把身份规则写进仓库的架构文档、Windows 无围栏作为已知限制写在同一处;索引重生成时顺带写回一行基线上已过期的 `SPEC-remote-database-connector` 摘要(生成器输出,未手改);计划摘要去掉旧仓库名,免得索引行在旧名扫描里多一处命中 · 第 5 步提交。
