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
   `/permission/:id/reply {reply:"always"}` ⇒ 适配器追加只覆盖所问动作与资源的会话规则 + 回复 `once`。把三次询问计数、
   两次回复的状态码和会话规则打印出来,不写夹具;
4. 同一会话两条待审、另一会话一条,经适配器的 v2 入口 reject 第一条(收据应列同会话两条)、同一命令重放、再直接对引擎
   回一次(404),原始帧与响应写成 `permission-reply.json`;
5. 停掉引擎与假模型。

端口被占时用 `SAMPLER_ENGINE_PORT` / `SAMPLER_MODEL_PORT` 改。重采后跑适配器的测试确认夹具仍能用:

```sh
cd packages/ui-mac
~/.bun-versions/1.4.4/bin/bun test src/engine-adapter/event-projection.test.ts src/engine-adapter/turn-diffs.test.ts \
  src/engine-adapter/staged-attachment.test.ts src/engine-adapter/permission-shape.test.ts src/engine-adapter/tool-display.test.ts \
  src/engine-adapter/permission-reply.test.ts
```
