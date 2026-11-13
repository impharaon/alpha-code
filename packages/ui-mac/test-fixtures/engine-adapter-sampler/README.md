# 引擎适配器夹具采样器(`#1668`)

`packages/ui-mac/src/engine-adapter/fixtures/*.json` 是从真 2.x 引擎采来的:每条 `/api/event` 帧,加上帧之后
适配器投影器那一刻会读到的消息页。这里是重采它们的脚本。**不进任何门**:不在 `bun test src` 与 ui-mac
类型检查的范围里,只在要重采夹具时手工跑。

## 重采

在仓根(依赖已用 Bun 1.4.4 装好)执行:

```sh
~/.bun-versions/1.4.4/bin/bun packages/ui-mac/test-fixtures/engine-adapter-sampler/sample.ts
```

脚本会:

1. 在临时目录建隔离的 HOME/XDG 与一个 git 项目,起本仓 `packages/cli` 的 `serve`(默认端口 47911)
   和同目录的假模型 `mock-model.ts`(OpenAI 兼容,默认端口 47920);
2. 跑五个剧本,覆盖写入 `read-tool.json`、`todo.json`、`question.json`、`permission-asked.json`、`turn-diff.json`,
   每个文件的 `_source` 写明采样命令与当时的提交;
3. 经适配器(`createEngineFetch`,口令由包一层的 fetch 补)实测一次会话级「总是允许」:界面的
   `/permission/:id/reply {reply:"always"}` ⇒ 适配器原样发 `always`,接管的权限内核给这个会话记 `save` 的每一项(I-05 契约 A)。
   把三次询问计数、两次回复的状态码和会话规则(应为空)打印出来,不写夹具;
4. 同一会话两条待审、另一会话一条,经适配器的 v2 入口 reject 第一条(收据应列同会话两条)、同一命令重放、再直接对引擎
   回一次(404);再在第三个会话里挂两条读(`a.env`、`ab.env`,`save ["a*"]`)、对第一条回「总是允许」(收据应列两条、
   会话规则不被写、`a.env` 再问直接 allow、`b.env` 再问仍要问、另一会话问 `a.env` 仍要问)。原始帧与响应写成 `permission-reply.json`;
5. R1 修复的四个剧本(`#1668` F1–F4):`tools.json`(前台 / 后台 subagent、edit、shell、patch 各一个会话,patch 先把会话切到
   假模型 `gpt-5-mock` —— 2.x 只给 `gpt-` 模型 patch 工具)、`continue.json`(经适配器发时间线「继续」,带逐回合 diff;对照组是
   同一续写落成 2.x synthetic 后拿它当 diff 的 from)、`files.json`(助手写文件的回合、项目里外部增删、`fs.watch` 过的文件被改时
   各收到哪些 `filesystem.changed`)、`command.json`(配置命令 `hello`:直接对引擎发与经适配器发);
6. `parity.json`(0.1.26 对照):读目录的正文、运行中 shell 按游标读到的输出页、慢的后台子代理让完成通知自己开一个回合后
   各种 from 问到的 diff、`fs.watch` 对目录 / 根目录 / 文件的回应与外部增删时收到的帧;
7. `catalog.json`(`#1697` I-04):项目位置上的原始 `GET /api/agent`、`/api/provider`、`/api/model`、`/api/model/default`,
   以及新建一个会话(还没提问,2.x 不给标题)之后的 `GET /api/session`;`lineage.json`:经适配器带档位发送(2.x 先记一条
   agent-switched)、压缩对话、composer 的 `!` 命令之后的整段消息。两份都给翻译器自有投影与冻结原件的等价核对用
   (`src/engine-adapter/projection-parity.test.ts`)。2.x 的 provider 配置不收模型 status,沙箱里采不到 deprecated 模型,
   核对里的 deprecated 模型由真样本改一个字段派生;
8. `passthrough.json`(`#1697` I-04,设计 §4.10 d):每条直通路由经冻结界面自己的客户端(1.17.13 的 `OpenCode.make`、v1 SDK 的
   `createOpencodeClient`)照冻结发出点的调用形状实调一次,记下适配器交回的状态码与响应体。集成那五条用运行时加的一台远端 MCP
   (`PUT /api/experimental/mcp/oauthprobe`),它的授权服务器是同目录的 `mock-oauth.ts`(本机,不连外网):引擎对它跑真的 MCP SDK
   流程(401 + 资源元数据、授权服务器元数据、动态注册、换 token);授权页不打开,采样器照引擎交回的 redirect_uri 与 state 拼回调
   交给 complete。项目里写一个 `opencode.json` 登记一条本地参考目录,`GET /api/reference` 才有元素可核;
9. 停掉引擎与假模型。

只重采其中几个剧本时把名字写在命令后面:`base`(上面 2–4 的全部)、`permission`(只有 3–4,只重写 `permission-reply.json`)、
`tools`、`continue`、`files`、`command`、`parity`、`catalog`、`lineage`、`passthrough`,例如
`… sample.ts tools continue files command`;不写 = 全部。

端口被占时用 `SAMPLER_ENGINE_PORT` / `SAMPLER_MODEL_PORT` / `SAMPLER_OAUTH_PORT` 改。重采后跑适配器的测试确认夹具仍能用:

```sh
cd packages/ui-mac
~/.bun-versions/1.4.4/bin/bun test src/engine-adapter/event-projection.test.ts src/engine-adapter/turn-diffs.test.ts \
  src/engine-adapter/staged-attachment.test.ts src/engine-adapter/permission-shape.test.ts src/engine-adapter/tool-display.test.ts \
  src/engine-adapter/permission-reply.test.ts src/engine-adapter/tool-shapes.test.ts src/engine-adapter/file-watcher.test.ts \
  src/engine-adapter/command-reply.test.ts
```

## 引擎源码身份(`#1697` I-04)

每个夹具带 `_engine`:采样所跑入口 `packages/cli` 的 workspace 运行时依赖闭包里,各包目录在 HEAD 上的 git tree id
(`engine-identity.ts`)。这些路径有未提交改动时采样器拒绝运行。`src/engine-adapter/fixture-identity.test.ts` 按同一规则从
当前树重算,不等就逐个点名过时的夹具与差在哪个包 —— 引擎包(含 Code Puppy 接管的文件)一改,就在同一个 PR 里全量重采
(2026-11-12 实测约 30 秒),再跑适配器的测试。

## 前后差分(`replay.ts`,`#1697` I-04)

改适配器的结构(搬文件、换投影实现、挪回执账本)时,用它证明翻译器的输出逐个没变(设计 docs/specs/upgrade-ui-contract/design.md §4.10 c、§9)。
它把上面这些夹具回放进适配器:HTTP 一半经生产的 `createEngineFetch` 发冻结界面会发的 v1 请求(假 2.x 上游只用夹具里的数据答),
事件一半逐帧喂投影器;全部输出按键排序写到标准输出。同样不进任何门。

```sh
# 改之前
~/.bun-versions/1.4.4/bin/bun packages/ui-mac/test-fixtures/engine-adapter-sampler/replay.ts > /tmp/replay-before.json
# 改完之后
~/.bun-versions/1.4.4/bin/bun packages/ui-mac/test-fixtures/engine-adapter-sampler/replay.ts > /tmp/replay-after.json
diff /tmp/replay-before.json /tmp/replay-after.json   # 必须为空;只许出现那一片计划里点名的例外
```

两次之间,`replay.ts` 只有开头「怎样建投影器」那几行可以不同(投影器搬了位置或换了参数时,与那次改动同一个提交)。
