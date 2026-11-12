---
title: "alpha-code#1668(L6)附件:冻结界面对引擎的全部运行时依赖与 2.x 落点"
kind: design
status: proposed
owners:
  - alpha-code desktop maintainers
last_reviewed: 2026-11-09
review_after: 2027-02-09
---

# alpha-code#1668(L6)附件 —— 冻结界面对引擎的全部运行时依赖

主文:[`2026-11-09-1668-l6-ui-stays-alpha.md`](2026-11-09-1668-l6-ui-stays-alpha.md)。坐标:左侧调用点读自 `origin/alpha` = `e56ae0c036`
(`app/` = `packages/app/`,冻结落点改名后为 `packages/codepuppy-app/`;`renderer/` = `packages/ui-mac/src/renderer/`);
v1 路由读自 `origin/alpha:packages/sdk/js/src/v2/gen/sdk.gen.ts`;2.x 端点读自 `33f94fce96:packages/protocol/src/groups/*.ts`。

## A. 怎么量的(2026-11-09 实跑)

1. `git archive origin/alpha packages/app packages/ui packages/session-ui packages/ui-mac packages/sdk/js | tar -x -C /tmp/l6-recon/alpha`。
2. 在 `packages/app/src`、`packages/session-ui/src`、`packages/ui-mac/src/renderer` 的非测试 `.ts/.tsx`(去掉 `*.test.*`、`*test-runtime*`、
   `*.cases.ts`、`test/`、`e2e/`)里,用正则抽「接收者.域.方法(」与「接收者.域.方法.子方法(」两种调用形状,域取 v1 SDK `OpencodeClient` 与 `V2` 的 getter 名
   (`auth app experimental global event config tool worktree find file instance path vcs command lsp formatter mcp project pty question permission provider session part sync tui v2`)
   加 1.17.13 客户端的域名;接收者末段是 `api` ⇒ 1.17.13 客户端,是 `client`/`legacy`/`sdk`/`c`/`eventSdk` ⇒ v1 SDK,其余丢弃;
   接收者末段本身是域名时并入方法名(`c.v2.agent.list` ⇒ `v2.agent.list`)。
3. 人工复核后的修正:剔除 app 自己的事件总线 `serverSDK.event.on/listen`(10 处,`server-sdk.tsx:357-361` 的 emitter);
   `context/global-sync/bootstrap.ts:238-240` 的 `sdk.provider/model.*` 在 v2 支路(`:232` 的 `if` 之后),归 1.17.13 客户端。
4. v1 方法 → 路由:解析 `sdk.gen.ts` 的类、getter 与每个方法的 `url:`(188 个方法)。
5. 结果:**170 处调用点、45 个文件(app 35、renderer 10);v1 SDK 128 处 / 68 个方法;1.17.13 客户端 42 处 / 31 个方法**。
   session-ui 零处直接打引擎(它只 import 类型)。

判法的已知盲区:正则抽取不是类型分析;经别名变量(如把 client 存进别的名字)的调用会漏。主文 §5 的 `routes-coverage.test.ts` 把这一步落成测试,
并以「冻结界面跑 V1–V12 时适配器收到的全部 501」作第二道核对(主文 §9 Q1)。

## B. 1.17.13 客户端的路径在合并目标里不存在的(L6 实测重推)

**订正(L6 实测,编排器 2026-11-09 要求重推)**:原来这一节的「26 条已删」比对错了来源 —— 至少 `GET /api/project` 与
`POST /api/integration/:p/connect/oauth/:p/complete` 在合并目标 `33f94fce96` 上都在。重推法:解析装着的 1.17.13 客户端
`dist/promise/generated/client.js` 的「方法 + 路径」(107 条),对 `33f94fce96:packages/protocol/src/groups/*.ts` 的
`HttpApiEndpoint.<verb>("<id>", <path>)`(170 条)逐条比,路径参数归一成 `:p`。合并目标上没有的 30 条:

- **挪到 `/api/experimental/…`**:`POST /api/generate`、`POST /api/session/:p/skill`、`POST /api/session/:p/wait`、
  `PUT|DELETE /api/mcp/:p`、`POST /api/mcp/:p/{connect,disconnect}`、`GET|PUT|DELETE /api/session/:p/instructions/entries[/:p]`。
- **真删了**:`GET /api/health`(换成 `/api/info`)、`GET /api/server`、`POST /api/service/stop`、`GET /api/form/request`、
  `GET /api/question/request`、`GET /api/project/current`、`GET /api/project/:p/directories`、`GET /api/session/:p/pending`、
  `GET /api/session/:p/question`、`POST /api/session/:p/question/:p/{reply,reject}`、`POST /api/session/:p/rename`、
  `POST /api/session/:p/revert/clear`(换成 `DELETE /api/session/:p/revert`)、`GET /api/session/:p/form/:p/state`、
  `POST /api/session/:p/form/:p/cancel`(换成 `DELETE …/form/:p`)、`PATCH /api/shell/:p/timeout`、
  `POST|DELETE /experimental/project/:p/copy`、`POST /experimental/project/:p/copy/refresh`。
- **同一条路径换了写法**:`GET /api/fs/read/:p` 对 2.x 的 `GET /api/fs/read/*`。

适配器的实际处置以路由表为准(`packages/ui-mac/src/engine-adapter/routes.ts` 的 ROUTES 与 UNSUPPORTED);
`routes-coverage.test.ts` 从冻结源码里扫出全部调用(v1 SDK 68 个方法、1.17.13 客户端 28 个),逐条要求有路由或写明理由的不支持项。

## C′. L6 实测对下表的订正

| 行 | 下表原写 | 实测与处置 |
| --- | --- | --- |
| `project.list` / `project.update` | N:2.2.6 无 project 端点 | **D**:`GET /api/project`、`PATCH /api/project/:id` 都在;打开目录即登记项目、重启后仍在(U2 选 A,`canonical` → `worktree`) |
| `project.current`(v1 `GET /project/current` 与 1.17.13 `GET /api/project/current`) | N | 由 `GET /api/location` 的 `project.id` 合成(冻结 app 引导时经 `bootstrap.ts:415-418` 调它,v1 模式下 `createCompatibleApi` 改走 v1 路由) |
| `worktree.create` / `worktree.remove` | N | 2.x 有 `POST|DELETE /api/worktree`,但调用点只在上游 LegacyLayout(U4 到不了)⇒ 不支持;`worktree.reset` 2.x 没有 |
| `integration.oauth.complete` | N:2.2.6 无 complete 端点 | 端点在(`POST …/connect/oauth/:attemptID/complete`)⇒ 直通;调用点在上游连接对话框,Code Puppy 界面挂不上 |
| `mcp.auth.authenticate` | N?(待核) | **U6 是**:2.x 把每个远端 MCP 登记成 OAuth 集成(`core/src/mcp/index.ts:238-275`,`metadata.source === "mcp"`);适配器发起 OAuth、交浏览器、轮询终态再回 MCP 状态 |
| `lsp.status` | N | 不支持;请求会由数据层发出,显示它的状态弹层在 Code Puppy 界面挂不上(U4,编排器认可) |
| `session.todo` | N | U1:由会话里最近一次 `todowrite` 的输入合成(事件流同一来源投影 `todo.updated`) |
| `path.get` | D?:字段要逐个核 | `location.get` 只有目录与项目;`home/state/config` 给空串(冻结 app v2 支路同一约定,`bootstrap.ts` loadPathQuery) |
| `config.get` / `global.config.get` | D | 2.x 回配置文档数组、键名也换了;给空对象(冻结 app v2 支路同一约定);`global.config.update` 只被上游设置页调用 ⇒ 不支持 |
| `permission.list` / `permission.asked` | D | 2.x 的工具来源是 `source.id`,冻结归一读 `source.callID` ⇒ 适配器补这一处(真引擎采样钉住);回复一侧等 L4 回执规格 |
| `auth.*`、`provider.auth`、`provider.oauth.*`、`global.dispose` | D / N | U5 到不了(上游设置页与连接对话框)⇒ 不支持 |

## C. 全表

类:**D** 2.x 有对应端点,适配器转形状;**D?** 有候选、字段待核;**E** 由事件派生;**N** 2.x 没有对应(主文 §8);**N?** 待 L6 第一步实测。

| 客户端 | 方法 | v1 路由 | 2.x 端点 | 类 | 说明 | 调用点 |
| --- | --- | --- | --- | --- | --- | --- |
| v1 SDK | `app.agents` | GET `/agent` | `agent.list` GET `/api/agent` | D |  | `app/src/context/global-sync/bootstrap.ts:269`, `renderer/extensions/use-extensions.ts:598` |
| v1 SDK | `auth.remove` | DELETE `/auth/{providerID}` | `credential.remove` DELETE `/api/credential/:credentialID` | D | 上游设置页组件 | `app/src/components/settings-providers.tsx:126`, `app/src/components/settings-providers.tsx:132`, `app/src/components/settings-v2/providers.tsx:123`, `app/src/components/settings-v2/providers.tsx:129` |
| v1 SDK | `auth.set` | PUT `/auth/{providerID}` | `credential.create` POST `/api/credential` | D | 上游自定义 provider 对话框 | `app/src/components/dialog-custom-provider.tsx:139` |
| v1 SDK | `command.list` | GET `/command` | `command.list` GET `/api/command` | D |  | `app/src/context/global-sync/bootstrap.ts:282`, `renderer/codepuppy-ui/composer-autocomplete.tsx:138` |
| v1 SDK | `config.get` | GET `/config` | `config.get` GET `/api/config` | D |  | `app/src/context/global-sync/bootstrap.ts:384` |
| v1 SDK | `experimental.resource.list` | GET `/experimental/resource` | `mcp.resource.catalog` GET `/api/mcp/resource` | D |  | `app/src/context/server-sync.tsx:132` |
| v1 SDK | `experimental.session.list` | GET `/experimental/session` | `session.list` GET `/api/session` | D |  | `app/src/utils/server-compat.ts:145`, `renderer/sidebar/use-projects.ts:219` |
| v1 SDK | `file.list` | GET `/file` | `fs.list` GET `/api/fs/list` | D |  | `app/src/context/file.tsx:84`, `renderer/codepuppy-ui/session-rail/files/session-rail-files.tsx:96` |
| v1 SDK | `file.read` | GET `/file/content` | `fs.read` GET `/api/fs/read/*` | D |  | `app/src/context/file.tsx:184`, `app/src/pages/session/review-tab.tsx:58`, `app/src/pages/session/v2/review-panel-v2.tsx:105` |
| v1 SDK | `find.files` | GET `/find/file` | `fs.find` GET `/api/fs/find` | D |  | `renderer/codepuppy-ui/composer-autocomplete.tsx:206`, `renderer/codepuppy-ui/session-rail/files/session-rail-files.tsx:100` |
| v1 SDK | `global.config.get` | GET `/global/config` | `config.get` GET `/api/config` | D |  | `app/src/context/global-sync/bootstrap.ts:113` |
| v1 SDK | `global.config.update` | PATCH `/global/config` | `config.update` PATCH `/api/experimental/config` | D | 2.x 在 /api/experimental 下 | `app/src/context/server-sync.tsx:661` |
| v1 SDK | `global.dispose` | POST `/global/dispose` | — | N | 2.x 无全局 dispose;最近的是 location.reload | `app/src/components/settings-providers.tsx:134`, `app/src/components/settings-v2/providers.tsx:131` |
| v1 SDK | `global.event` | SSE.GET `/global/event` | `event.subscribe` GET `/api/event` | E | v1 事件由 2.x 事件派生,见 §2.3 | `app/src/context/server-sdk.tsx:278`, `renderer/sidebar/use-projects.ts:609`, `renderer/extensions/use-extensions.ts:1037`, `renderer/codepuppy-ui/cloud-run-watcher.tsx:59` |
| v1 SDK | `instance.dispose` | POST `/instance/dispose` | `location.reload` POST `/api/location/reload` | D | 语义:2.x 重建全部 Location(seams Q5) | `app/src/utils/server-compat.ts:405`, `app/src/utils/server-compat.ts:435`, `app/src/utils/server-compat.ts:444`, `app/src/pages/layout.tsx:1458` |
| v1 SDK | `lsp.status` | GET `/lsp` | — | N | 2.x 只有 lsp.updated 事件,无查询端点 | `app/src/context/server-sync.tsx:150` |
| v1 SDK | `mcp.auth.authenticate` | POST `/mcp/{name}/auth/authenticate` | — | N? | 2.x 无 /mcp/:name/auth;MCP OAuth 是否经 integration.oauth.* 待 L6 第一步实测 | `app/src/context/server-sync.tsx:715`, `renderer/extensions/use-extensions.ts:808` |
| v1 SDK | `mcp.connect` | POST `/mcp/{name}/connect` | `mcp.connect` POST `/api/experimental/mcp/:server/connect` | D | 2.x 在 /api/experimental 下 | `app/src/context/server-sync.tsx:702`, `renderer/extensions/use-extensions.ts:789`, `renderer/extensions/use-extensions.ts:848` |
| v1 SDK | `mcp.disconnect` | POST `/mcp/{name}/disconnect` | `mcp.disconnect` POST `/api/experimental/mcp/:server/disconnect` | D | 2.x 在 /api/experimental 下 | `app/src/context/server-sync.tsx:709`, `renderer/extensions/use-extensions.ts:790`, `renderer/extensions/use-extensions.ts:848`, `renderer/extensions/use-extensions.ts:903`, `renderer/extensions/use-extensions.ts:953` |
| v1 SDK | `mcp.status` | GET `/mcp` | `mcp.list` GET `/api/mcp` | D | 状态五种(seams 第 4 节) | `app/src/context/server-sync.tsx:108`, `renderer/extensions/use-extensions.ts:635` |
| v1 SDK | `path.get` | GET `/path` | `location.get` GET `/api/location` | D? | 字段要逐个核 | `app/src/context/global-sync/bootstrap.ts:309` |
| v1 SDK | `permission.list` | GET `/permission` | `permission.request.list` GET `/api/permission/request` | D |  | `app/src/context/permission-v1-adapter.ts:172`, `app/src/context/permission.tsx:265`, `app/src/context/global-sync/bootstrap.ts:447`, `renderer/extensions/use-extensions.ts:982` |
| v1 SDK | `permission.reply` | POST `/permission/{requestID}/reply` | `session.permission.reply` POST `/api/session/:sessionID/permission/:requestID/reply` | D | 需 sessionID:由适配层按 requestID 查 | `app/src/context/permission-v1-adapter.ts:225`, `renderer/extensions/use-extensions.ts:990` |
| v1 SDK | `project.initGit` | POST `/project/git/init` | `vcs.init` POST `/api/vcs/init` | D |  | `app/src/pages/session.tsx:857`, `app/src/pages/home/home-controller.ts:100` |
| v1 SDK | `project.list` | GET `/project` | — | N | 2.2.6 无 project 端点(1.17.13 的 /api/project 已删) | `app/src/utils/server-compat.ts:304`, `renderer/sidebar/use-projects.ts:262` |
| v1 SDK | `project.update` | PATCH `/project/{projectID}` | — | N |  | `app/src/components/edit-project.ts:76` |
| v1 SDK | `provider.list` | GET `/provider` | `provider.list` GET `/api/provider` | D |  | `app/src/context/global-sync/bootstrap.ts:233` |
| v1 SDK | `pty.connectToken` | POST `/pty/{ptyID}/connect-token` | `pty.connectToken` POST `/api/pty/:ptyID/connect-token` | D |  | `app/src/components/terminal.tsx:576` |
| v1 SDK | `pty.create` | POST `/pty` | `pty.create` POST `/api/pty` | D |  | `app/src/context/terminal.tsx:285`, `app/src/context/terminal.tsx:337` |
| v1 SDK | `pty.get` | GET `/pty/{ptyID}` | `pty.get` GET `/api/pty/:ptyID` | D |  | `app/src/components/terminal.tsx:556` |
| v1 SDK | `pty.remove` | DELETE `/pty/{ptyID}` | `pty.remove` DELETE `/api/pty/:ptyID` | D |  | `app/src/context/terminal.tsx:447` |
| v1 SDK | `pty.shells` | GET `/pty/shells` | `config.shells` GET `/api/config/shell` | D |  | `app/src/components/settings-general.tsx:133`, `app/src/components/settings-v2/general-controllers.ts:58` |
| v1 SDK | `pty.update` | PUT `/pty/{ptyID}` | `pty.update` PUT `/api/pty/:ptyID` | D |  | `app/src/context/terminal.tsx:256`, `app/src/components/terminal.tsx:255` |
| v1 SDK | `question.list` | GET `/question` | `session.form.list` GET `/api/session/:sessionID/form` | D | 提问 → 表单服务,形状要转 | `app/src/context/global-sync/bootstrap.ts:483` |
| v1 SDK | `question.reject` | POST `/question/{requestID}/reject` | `session.form.cancel` DELETE `/api/session/:sessionID/form/:formID` | D |  | `app/src/utils/server-compat.ts:514`, `renderer/codepuppy-ui/session-workspace/session-question-card.tsx:74` |
| v1 SDK | `question.reply` | POST `/question/{requestID}/reply` | `session.form.reply` POST `/api/session/:sessionID/form/:formID/reply` | D |  | `app/src/utils/server-compat.ts:508`, `renderer/codepuppy-ui/session-workspace/session-question-card.tsx:69` |
| v1 SDK | `session.abort` | POST `/session/{sessionID}/abort` | `session.interrupt` POST `/api/session/:sessionID/interrupt` | D |  | `app/src/utils/server-compat.ts:198`, `renderer/codepuppy-ui/codepuppy-composer.tsx:1631`, `renderer/codepuppy-ui/session-workspace/codepuppy-session-workspace.tsx:101` |
| v1 SDK | `session.command` | POST `/session/{sessionID}/command` | `session.command` POST `/api/session/:sessionID/command` | D |  | `app/src/utils/server-compat.ts:242`, `renderer/codepuppy-ui/codepuppy-composer.tsx:1821` |
| v1 SDK | `session.create` | POST `/session` | `session.create` POST `/api/session` | D |  | `renderer/sidebar/use-projects.ts:420`, `renderer/sidebar/use-projects.ts:473` |
| v1 SDK | `session.delete` | DELETE `/session/{sessionID}` | `session.remove` DELETE `/api/session/:sessionID` | D |  | `renderer/sidebar/use-projects.ts:562` |
| v1 SDK | `session.fork` | POST `/session/{sessionID}/fork` | `session.fork` POST `/api/session/:sessionID/fork` | D |  | `app/src/utils/server-compat.ts:193` |
| v1 SDK | `session.get` | GET `/session/{sessionID}` | `session.get` GET `/api/session/:sessionID` | D |  | `app/src/context/server-session.ts:312`, `app/src/utils/session-export.ts:24`, `app/src/utils/server-compat.ts:171`, `renderer/codepuppy-ui/session-workspace/codepuppy-session-workspace.tsx:127` |
| v1 SDK | `session.list` | GET `/session` | `session.list` GET `/api/session` | D |  | `app/src/context/global-sync/session-load.ts:21`, `app/src/context/global-sync/session-load.ts:24`, `renderer/sidebar/use-projects.ts:187` |
| v1 SDK | `session.message` | GET `/session/{sessionID}/message/{messageID}` | `session.message` GET `/api/session/:sessionID/message/:messageID` | D | 2.x 消息 → v1 {info, parts} | `app/src/context/server-session.ts:597` |
| v1 SDK | `session.messages` | GET `/session/{sessionID}/message` | `session.messages` GET `/api/session/:sessionID/message` | D | 同上 | `app/src/context/server-session.ts:568`, `app/src/utils/session-export.ts:25`, `renderer/sidebar/use-projects.ts:573` |
| v1 SDK | `session.promptAsync` | POST `/session/{sessionID}/prompt_async` | `session.prompt` POST `/api/session/:sessionID/prompt` | D | 三个发送入口(S1) | `app/src/utils/server-compat.ts:201`, `renderer/codepuppy-ui/codepuppy-composer.tsx:1868`, `renderer/codepuppy-ui/session-timeline/session-timeline.tsx:276` |
| v1 SDK | `session.revert` | POST `/session/{sessionID}/revert` | `session.revert.stage` POST `/api/session/:sessionID/revert/stage` | D | v1 单步撤回 → stage(+commit),语义待核 | `app/src/utils/server-compat.ts:292`, `renderer/codepuppy-ui/session-workspace/codepuppy-session-workspace.tsx:102` |
| v1 SDK | `session.share` | POST `/session/{sessionID}/share` | — | N | 已裁决拿掉(R6) | `app/src/pages/session/use-session-commands.tsx:199`, `app/src/pages/session/timeline/message-timeline.tsx:662`, `renderer/sidebar/use-projects.ts:552` |
| v1 SDK | `session.shell` | POST `/session/{sessionID}/shell` | `session.shell` POST `/api/session/:sessionID/shell` | D |  | `app/src/utils/server-compat.ts:268` |
| v1 SDK | `session.status` | GET `/session/status` | `session.active` GET `/api/session/active` | D |  | `app/src/context/server-sync.tsx:245`, `app/src/context/global-sync/bootstrap.ts:390`, `app/src/utils/server-compat.ts:176` |
| v1 SDK | `session.summarize` | POST `/session/{sessionID}/summarize` | `session.compact` POST `/api/session/:sessionID/compact` | D |  | `app/src/utils/server-compat.ts:277` |
| v1 SDK | `session.todo` | GET `/session/{sessionID}/todo` | — | N | 2.x 的 todo 工具受实验开关 todo 控制,正式渠道关(§8 U1) | `app/src/context/server-session.ts:1399` |
| v1 SDK | `session.unrevert` | POST `/session/{sessionID}/unrevert` | `session.revert.clear` DELETE `/api/session/:sessionID/revert` | D |  | `app/src/utils/server-compat.ts:296` |
| v1 SDK | `session.unshare` | DELETE `/session/{sessionID}/share` | — | N | 已裁决拿掉(R6) | `app/src/pages/session/use-session-commands.tsx:219`, `app/src/pages/session/timeline/message-timeline.tsx:669` |
| v1 SDK | `session.update` | PATCH `/session/{sessionID}` | `session.update` PATCH `/api/session/:sessionID` | D |  | `app/src/context/directory-sync.ts:138`, `app/src/pages/layout.tsx:873`, `app/src/pages/layout.tsx:1484`, `app/src/pages/home/home-sessions-controller.tsx:217`, `app/src/pages/session/timeline/message-timeline.tsx:845`, `renderer/sidebar/use-projects.ts:541` |
| v1 SDK | `v2.agent.list` | GET `/api/agent` | `agent.list` GET `/api/agent` | D |  | `renderer/codepuppy-ui/composer-autocomplete.tsx:184` |
| v1 SDK | `v2.provider.get` | GET `/api/provider/{providerID}` | `provider.get` GET `/api/provider/:providerID` | D |  | `renderer/codepuppy-ui/model-contract.ts:277` |
| v1 SDK | `v2.reference.list` | GET `/api/reference` | `reference.list` GET `/api/reference` | D |  | `app/src/context/global-sync/bootstrap.ts:324` |
| v1 SDK | `v2.session.get` | GET `/api/session/{sessionID}` | `session.get` GET `/api/session/:sessionID` | D |  | `renderer/codepuppy-ui/model-contract.ts:383` |
| v1 SDK | `v2.session.list` | GET `/api/session` | `session.list` GET `/api/session` | D |  | `app/src/pages/home/home-sessions-controller.tsx:70` |
| v1 SDK | `v2.session.permission.list` | GET `/api/session/{sessionID}/permission` | `session.permission.list` GET `/api/session/:sessionID/permission` | D |  | `app/src/context/permission-v1-adapter.ts:163` |
| v1 SDK | `v2.session.permission.reply` | POST `/api/session/{sessionID}/permission/{requestID}/reply` | `session.permission.reply` POST `/api/session/:sessionID/permission/:requestID/reply` | D |  | `app/src/context/permission-surface.tsx:73` |
| v1 SDK | `v2.session.switchModel` | POST `/api/session/{sessionID}/model` | `session.switchModel` POST `/api/session/:sessionID/model` | D |  | `renderer/codepuppy-ui/model-contract.ts:393` |
| v1 SDK | `vcs.get` | GET `/vcs` | `vcs.get` GET `/api/vcs` | D |  | `app/src/context/global-sync/bootstrap.ts:429` |
| v1 SDK | `vcs.status` | GET `/vcs/status` | `vcs.status` GET `/api/vcs/status` | D |  | `renderer/codepuppy-ui/composer-autocomplete.tsx:224` |
| v1 SDK | `worktree.create` | POST `/experimental/worktree` | — | N |  | `app/src/pages/layout.tsx:1824` |
| v1 SDK | `worktree.remove` | DELETE `/experimental/worktree` | — | N |  | `app/src/pages/layout.tsx:1392` |
| v1 SDK | `worktree.reset` | POST `/experimental/worktree/reset` | — | N |  | `app/src/pages/layout.tsx:1462` |
| 1.17.13 客户端 | `file.find` | (1.17.13 客户端) | `fs.find` GET `/api/fs/find` | D |  | `app/src/context/file.tsx:208` |
| 1.17.13 客户端 | `integration.connect.key` | (1.17.13 客户端) | `integration.connect.key` POST `/api/integration/:integrationID/connect/key` | D |  | `app/src/components/dialog-connect-provider.tsx:824` |
| 1.17.13 客户端 | `integration.get` | (1.17.13 客户端) | `integration.get` GET `/api/integration/:integrationID` | D |  | `app/src/components/dialog-connect-provider.tsx:421` |
| 1.17.13 客户端 | `integration.oauth.complete` | (1.17.13 客户端) | — | N | 2.2.6 无 complete 端点,只有 status/cancel | `app/src/components/dialog-connect-provider.tsx:955` |
| 1.17.13 客户端 | `integration.oauth.connect` | (1.17.13 客户端) | `integration.oauth.connect` POST `/api/integration/:integrationID/connect/oauth` | D |  | `app/src/components/dialog-connect-provider.tsx:555` |
| 1.17.13 客户端 | `integration.oauth.status` | (1.17.13 客户端) | `integration.oauth.status` GET `/api/integration/:integrationID/connect/oauth/:attemptID` | D |  | `app/src/components/dialog-connect-provider.tsx:1054` |
| 1.17.13 客户端 | `mcp.connect` | (1.17.13 客户端) | `mcp.connect` POST `/api/experimental/mcp/:server/connect` | D | 路径改到 /api/experimental | `app/src/context/server-sync.tsx:705` |
| 1.17.13 客户端 | `mcp.disconnect` | (1.17.13 客户端) | `mcp.disconnect` POST `/api/experimental/mcp/:server/disconnect` | D | 路径改到 /api/experimental | `app/src/context/server-sync.tsx:712` |
| 1.17.13 客户端 | `model.default` | (1.17.13 客户端) | `model.default` GET `/api/model/default` | D |  | `app/src/context/global-sync/bootstrap.ts:240` |
| 1.17.13 客户端 | `model.list` | (1.17.13 客户端) | `model.list` GET `/api/model` | D |  | `app/src/context/global-sync/bootstrap.ts:239` |
| 1.17.13 客户端 | `project.current` | (1.17.13 客户端) | — | N | 2.2.6 无 project 端点 | `app/src/context/global-sync/bootstrap.ts:415`, `app/src/pages/layout.tsx:1185`, `app/src/pages/home/home-controller.ts:99`, `app/src/pages/home/home-controller.ts:101` |
| 1.17.13 客户端 | `project.directories` | (1.17.13 客户端) | — | N | 同上 | `app/src/pages/layout.tsx:1188` |
| 1.17.13 客户端 | `provider.list` | (1.17.13 客户端) | `provider.list` GET `/api/provider` | D |  | `app/src/context/global-sync/bootstrap.ts:238` |
| 1.17.13 客户端 | `pty.create` | (1.17.13 客户端) | `pty.create` POST `/api/pty` | D |  | `app/src/context/terminal.tsx:288`, `app/src/context/terminal.tsx:339` |
| 1.17.13 客户端 | `pty.get` | (1.17.13 客户端) | `pty.get` GET `/api/pty/:ptyID` | D |  | `app/src/components/terminal.tsx:564` |
| 1.17.13 客户端 | `pty.remove` | (1.17.13 客户端) | `pty.remove` DELETE `/api/pty/:ptyID` | D |  | `app/src/context/terminal.tsx:448` |
| 1.17.13 客户端 | `pty.update` | (1.17.13 客户端) | `pty.update` PUT `/api/pty/:ptyID` | D |  | `app/src/context/terminal.tsx:262`, `app/src/components/terminal.tsx:264` |
| 1.17.13 客户端 | `question.reject` | (1.17.13 客户端) | `session.form.cancel` DELETE `/api/session/:sessionID/form/:formID` | D | 1.17.13 的 /api/session/:id/question/* 已删 | `app/src/pages/session/composer/session-question-dock.tsx:239` |
| 1.17.13 客户端 | `question.reply` | (1.17.13 客户端) | `session.form.reply` POST `/api/session/:sessionID/form/:formID/reply` | D | 同上 | `app/src/pages/session/composer/session-question-dock.tsx:227` |
| 1.17.13 客户端 | `session.active` | (1.17.13 客户端) | `session.active` GET `/api/session/active` | D |  | `app/src/context/server-sync.tsx:256` |
| 1.17.13 客户端 | `session.command` | (1.17.13 客户端) | `session.command` POST `/api/session/:sessionID/command` | D |  | `app/src/components/prompt-input/submit.ts:527` |
| 1.17.13 客户端 | `session.compact` | (1.17.13 客户端) | `session.compact` POST `/api/session/:sessionID/compact` | D |  | `app/src/pages/session/use-session-commands.tsx:409` |
| 1.17.13 客户端 | `session.create` | (1.17.13 客户端) | `session.create` POST `/api/session` | D |  | `app/src/components/prompt-input/submit.ts:408` |
| 1.17.13 客户端 | `session.fork` | (1.17.13 客户端) | `session.fork` POST `/api/session/:sessionID/fork` | D |  | `app/src/components/dialog-fork.tsx:76` |
| 1.17.13 客户端 | `session.interrupt` | (1.17.13 客户端) | `session.interrupt` POST `/api/session/:sessionID/interrupt` | D |  | `app/src/components/prompt-input/submit.ts:280`, `app/src/pages/session.tsx:1830` |
| 1.17.13 客户端 | `session.list` | (1.17.13 客户端) | `session.list` GET `/api/session` | D |  | `app/src/context/directory-sync.ts:127`, `app/src/components/dialog-command-palette-v2.tsx:82`, `app/src/components/command-palette.ts:149` |
| 1.17.13 客户端 | `session.remove` | (1.17.13 客户端) | `session.remove` DELETE `/api/session/:sessionID` | D |  | `app/src/pages/session/timeline/message-timeline.tsx:874` |
| 1.17.13 客户端 | `session.rename` | (1.17.13 客户端) | `session.update` PATCH `/api/session/:sessionID` | D? | 1.17.13 的 /rename 已删;2.x 用 PATCH 改标题,待核 | `app/src/components/titlebar-tab-strip.tsx:108`, `app/src/pages/session/timeline/message-timeline.tsx:677` |
| 1.17.13 客户端 | `session.shell` | (1.17.13 客户端) | `session.shell` POST `/api/session/:sessionID/shell` | D |  | `app/src/components/prompt-input/submit.ts:501` |
| 1.17.13 客户端 | `vcs.diff` | (1.17.13 客户端) | `vcs.diff` GET `/api/vcs/diff` | D |  | `app/src/pages/session.tsx:700`, `app/src/pages/session.tsx:748` |
| 1.17.13 客户端 | `vcs.status` | (1.17.13 客户端) | `vcs.status` GET `/api/vcs/status` | D |  | `app/src/pages/layout.tsx:1525`, `app/src/pages/layout.tsx:1593` |

## D. 不经 SDK 的依赖

| 依赖 | 坐标 | 处置(主文) |
| --- | --- | --- |
| 建客户端 | `app/src/utils/server.ts:34,48`、`app/src/utils/server-health.ts:88,107`、`renderer/sidebar/use-projects.ts:674`、`renderer/extensions/use-extensions.ts:1068`、`renderer/codepuppy-ui/cloud-run-watcher.tsx:87` | app 四处经 `platform.fetch` 接适配器(§2.4 只改 `server-sdk.tsx:190-200`);renderer 三处传 `fetch: engineFetch`(§2.5) |
| 直连 fetch | `renderer/sidebar/use-projects.ts:695`(`/global/health`) | 经 `engineFetch` |
| WebSocket | `app/src/utils/terminal-websocket-url.ts:15-21` | SOT 补丁改成 2.x 路径 + 票据(§2.4) |
| 事件流 | `app/src/context/server-sdk.tsx:278`、`renderer/sidebar/use-projects.ts:609`、`renderer/extensions/use-extensions.ts:1037`、`renderer/codepuppy-ui/cloud-run-watcher.tsx:59` | `/global/event` handler(§2.3) |
| renderer 拿口令 | `renderer/index.tsx:473,484`、`renderer/sidebar/use-projects.ts:119-121`、`renderer/extensions/use-extensions.ts:463-465`、`renderer/codepuppy-ui/cloud-run-watcher.tsx:18-21`、`renderer/wsl/connections.ts:16` | 删(I8) |
| 已删包的 import | app:`@opencode-ai/sdk` 75、`@opencode-ai/core` 62、`@opencode-ai/session-ui` 41、`@opencode-ai/client` 30、`@opencode-ai/schema` 1;session-ui:`sdk` 14、`core` 13、`client` 5;renderer:`sdk` 26、`app` 20、`ui` 11、`schema` 6、`session-ui` 1 | 冻结包按原名恢复(§2.1);`@opencode-ai/schema` 改指 `@opencode/schema`(§2.4、§2.5) |
