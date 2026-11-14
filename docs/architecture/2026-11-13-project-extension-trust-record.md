---
id: ARCH-codepuppy-2026-11-13-project-extension-trust-record
title: 项目扩展的信任记录:放在哪、按什么认项目、谁能写
summary: "项目插件、项目 MCP 与项目 agent 的控制字段只在用户于确认框里同意后加载;记录在 Code Puppy 的状态目录,按规范目录 + inode 认项目,项目目录里的文件不算"
kind: architecture
status: active
owners:
  - Code Puppy desktop maintainers
last_reviewed: 2026-11-13
review_after: 2027-02-13
---

# 项目扩展的信任记录

*2026-11-13 · 票 `#1709` · 实施计划 [specs/project-consent-store/plan.md](../specs/project-consent-store/plan.md)*

## 它把住什么

用户打开一个项目时,项目 `.codepuppy/` 里有三样东西能在本机做事:`plugins/*.js`(在引擎进程里执行)、`codepuppy.jsonc` 的 `mcp`(启动连接器进程)、`agent` 条目的 `permission` / `tools` / `model` / `disable` / `mode`(改写审批规则与模型)。用户在「项目自带扩展加载确认」框里点「允许加载」并勾选知情框之前,这三样一样都不加载。确认框的清单逐条列出这三样(连接器、插件、写了控制字段的 agent 及其字段),只写了 agent 控制字段的项目同样会被问到。说明类字段、command、skills 是文本,不设门。

三样都经 ext 的同一个读函数判断(`packages/ext/src/project-config.ts` 的 `readProjectExtensionsConsent`);main 侧的确认框(`ext-ipc.ts` 的 `ext-trust-check`)与定制中心的项目 MCP 状态读同一份记录。决定的语义(当前告知版本、允许 / 拒绝都算决定)只在 `packages/ui-mac/src/main/codepuppy-ext-trust.ts` 定义一次。

## 记录在哪、长什么样、谁能写

- 位置:`<appData>/codepuppy-state/project-trust/<env>.json`(prod / beta / dev 各一份),与 `env/`、`cas/`、`custom-providers/` 同级。读端是 `packages/ui-mac/src/main/project-trust-truth.ts`,写端是同目录的 `project-trust-truth-write.ts`。
- 形状:`{ "v": 1, "projects": { "<规范项目目录>": { "ino": "<目录 inode,十进制字符串>", "version": <告知版本>, "granted": <布尔>, "decidedAt": "<ISO 时间>" } } }`。读得严:形状不对整份拒;记录文件或 `project-trust/` 目录是符号链接也拒;拒的时候一个项目都不信任,并记一行原因。
- 唯一写入点:`ext-trust-check` 在原生确认框返回之后。renderer 只能让确认框弹出,写入要用户在主进程的模态框里点击。确认框开着期间如果项目目录被换掉,这次决定不落盘。
- 引擎写不到:进程围栏的可写根 W2 是 `env/<env>`,W3 是 `<userData>`,都罩不到 `project-trust/`(macOS,`project-trust-truth-fence.test.ts` 用真 `sandbox-exec` 证明,包括在记录路径或它的目录放符号链接也不许)。引擎里 agent 的写文件工具和已信任项目的插件因此改不了这份记录。
- ext 怎么找到它:main 启动 sidecar 时派生 `CODEPUPPY_GLOBAL_DIR`(`<casBaseRoot>/env/<env>`,canonical,外部预置被拒);sidecar 用 `codepuppy-environment.ts` 里现成的 `resolveCodePuppyStateBase` 从这个值**按字面**推出 `casBaseRoot` 与环境名,原地读文件,不对它做 realpath。原因(实测):`env/<env>` 本身是围栏可写根,围栏内的进程能把这个目录挪走、原地换成指向别处的符号链接;沿 realpath 推出的状态根就会落进伪造的那一份。按字面推出的记录路径不经过 `env/<env>`,路径上的每一级祖先(状态根、`project-trust/`)围栏内都挪不动。自定义节点、远程 MCP、出网授权三份真源走同一个解析,一并按字面推出。路径不经项目目录,也不经项目或引擎工具能设的变量。

## 按什么认项目

身份 = 规范项目目录(main 与 ext 各自对会话目录做 `realpath` 得到的同一个绝对路径)+ 这个目录的 inode。三项同时对上(路径逐字相等、inode 相等、告知版本是当前版本)才算有决定。

| 情形 | 结果 |
| --- | --- |
| 已信任的项目改名或移动 | 新路径查不到,按未同意,确认框再出现 |
| 经符号链接打开已信任的项目 | realpath 是同一个目录、同一个 inode,仍信任 |
| 复制一份、或在别处再克隆一份 | 新路径、新 inode,未同意 |
| 同一仓库的两个检出(含 git worktree) | 两个目录各自确认 |
| 删掉后在原路径重建或重新克隆 | 在 APFS 上 inode 会变(实测),未同意;见下方限制 |
| 改回原来的名字(同一个目录) | 路径与 inode 都对上,恢复信任 |

为什么带 inode:记录原先住在项目里,目录删了记录跟着消失;只按路径记,「删掉已信任的项目、在同一路径克隆一个陌生仓库」会继承信任。不带设备号:外接卷的设备号随挂载变化,带上只会多弹框。路径大小写写法不同只会让确认框多出现一次,不会误放(inode 也要相等)。

## 升级与生效时机

- 项目 `.codepuppy/prefs.json` 里旧的 `extensionsConsent` 不迁移、不删除,也没有人再读。以前同意或拒绝过的项目,升级后第一次打开时确认框出现一次;用户做了决定后不再出现。没有可执行扩展的项目照旧不弹框。
- 用户同意后,renderer 请 ext 重载,下一条消息起生效。记录里的条目改成拒绝或被删掉,从下一次重载起不再加载。定制中心里项目 MCP 的状态每次查询现读。

## 已知限制

- **Windows 没有进程围栏。** 记录仍在项目目录之外,项目里的文件仍不能冒充它;但「引擎写不进这份记录」只在 macOS 成立。在 Windows 上,引擎里 agent 的写文件工具和已信任项目的插件写得到这个文件。本票不为 Windows 加代码。
- **用户没有撤销入口。** 界面上不能撤销某个项目的信任(已作为意图条目登记);记录层的撤销(条目改成拒绝或删掉)从下一次重载起生效。
- **信任就是允许运行代码。** 已信任项目的插件在引擎进程里拥有完整能力;这份记录挡的是「未经用户同意」,不管同意之后插件做什么。
- **inode 不保证不复用。**「原路径重建就按未同意」只在 APFS 上实测过;FAT / exFAT、网络卷等文件系统可能把同一个 inode 号分给新建的目录,在那些卷上删掉后原路径重建的项目可能继承旧的信任。
- 身份复核与紧随其后的那次读写之间仍有微秒级窗口,与 `withProjectDirectoryIdentity` 相同的威胁模型,不引入 openat。

## 证据

- 真引擎:`packages/ui-mac/src/main/project-consent-store.engine.cases.ts`(宿主 `project-consent-store.engine.test.ts`)。项目自带旧写法的「已同意」时,项目插件不执行、项目 MCP 不启动;记录同意后两样都生效;改成拒绝后都不再出现。改前在 `e54edd9cf8` 上实测:自带记录的项目里 MCP 连上、插件标记出现。
- 生产确认框:`packages/ui-mac/test-component/ext-trust-check.ipc.cases.ts`(宿主 `src/main/ext-trust-check.test.ts`)。
- 三个消费方:`packages/ext/src/plugin-host.test.ts` 的同意用例;身份与冒充:`packages/ext/src/project-config.test.ts` 的 `#1709` 一组;读写端:`packages/ui-mac/src/main/project-trust-truth.test.ts`;围栏:`project-trust-truth-fence.test.ts`。
