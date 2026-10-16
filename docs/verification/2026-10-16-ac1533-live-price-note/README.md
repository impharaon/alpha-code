---
title: AC1533 线上 stable 价格说明查询取证
kind: verification
status: active
owners:
  - alpha-code maintainers
last_reviewed: 2026-10-16
---

# AC1533 线上真实目录查询

[alpha-code#1533](https://github.com/jinjunnn/alpha-code/issues/1533) 的只读取证。
Documentation impact: evidence only；只添加本目录，不修改产品、接口或发布状态。

## 结论与边界

**按题述组件 ID 的严格退出条件未满足。** 线上未安装目录通过查询输出真实包行
`package:cloud-html` / `package:cloud-image`，两行均带与真实载荷 `holdUsd` 一致的 `priceNote`。
但 `cloud:html` / `cloud:image` 只出现在包的组件声明中，不在当前目录 `entries` 中；
空安装账本下，以这两个组件 ID 查询均返回 `No matching entries.`。
没有伪造目录条目、安装账本或安装行为来补出组件行，也没有把包行断言冒充组件行断言。
脚本保留最后的组件行断言，因此本次运行退出码为 **1**。

## 版本与验签

- 观测时间：`2026-10-16T03:36:59.830Z`（UTC；纽约本地仍为 2026-10-15）。
- 代码：`origin/alpha` / `763d37186c96230d219625767be52ea5f82d912d`，桌面版本 `0.1.20`。
- 线上 stable：`2026-10-15.3`，`source=remote`，`via=channel-stable`；无缓存或 bundled 回退，无错误通知。
- 生产 Ed25519 验签链通过：内置公钥 → trust → coherent snapshot / advisories → stable → catalog。
  没有替换信任根、时间、验签函数、包 evaluator 或 decoder。
- 目录正文 SHA-256：`aaf22dbea2308f7cb2937654ab3848923a57837392ab014e6d37f61db1f10dbd`。
- snapshot SHA-256：`742ed3dbc0523d66d13e13269667c47098859e607820f91baa095b5c8118b0be`。
- 两个 cloud@1 载荷均通过生产字节数、SHA-256 和 profile decoder 校验：HTML 690 字节 / `holdUsd=1`；image 695 字节 / `holdUsd=0.3`。

## 查询两行原文

以下为 `hub_search` 按包 ID 查询的完整输出，逐字摘自 [output.json](output.json)：

```json
{"id":"package:cloud-html","scope":"not installed","name":"云端网页生成","type":"package","description":"描述页面内容与样式，云端生成可下载的 HTML 网页。","installed":false,"enabled":false,"state":"not-installed","authorization":"none","priceNote":"预留 US$1.00,按实际用量结算;失败时已产生的费用仍会结算。"}
{"id":"package:cloud-image","scope":"not installed","name":"云端图片生成","type":"package","description":"描述画面内容与风格，云端生成可下载的 PNG 图片。","installed":false,"enabled":false,"state":"not-installed","authorization":"none","priceNote":"预留 US$0.30,按实际用量结算;失败时已产生的费用仍会结算。"}
```

混合查询 `query=cloud` 同时返回这两行和六个无价格说明的真实云条目：
`cloud:code-review`、`cloud:docs`、`cloud:excel`、`cloud:powerpoint`、`cloud:research`、`cloud:word`。
这些行均没有 `priceNote` 字段，输出末尾恰好追加一次：

```text
本目录尚未提供价格说明;费用以服务端为准
```

两次包 ID 单独查询均不追加缺项句。

## 复现与生产路径

在仓库根目录运行（需要现有依赖；不安装依赖）：

```sh
bun docs/verification/2026-10-16-ac1533-live-price-note/verify.ts
```

[verify.ts](verify.ts) 从 `ext-ipc.ts` 提取并用 Bun 去除类型后执行真实的局部
`resolveEffectiveCatalog` 函数体；这样无需启动 Electron，也不复制该函数的目录投影逻辑。
函数实际调用 `remote-catalog.ts` 的 `refreshRemoteCatalog`，内部继续执行生产 channel 验签、
`evaluatePackageForHost` 和 `fetchPackagePayload`。注入的 fetch 只是透传真实公开 GET 并记录字节哈希；
`accepted` 回调只记录生产校验接受后的载荷事实。函数源码 SHA-256 记录在输出中。
同一次刷新结果传给生产 `createHubViewService.viewForAgent`，经生产
`buildHubViewReply` / `parseHubViewReply` 序列化契约，再调用 ext 的 `createHubTools().hub_search.execute`。
桥接仅采用同进程适配，不声称启动了 Electron、真实 parentPort、模型或完整应用 UI。

缓存及安装根为本目录下新建的隔离临时目录，结束即删除；不读取用户安装根或密钥。
所有目录和载荷网络请求均为 `https://codepuppy.cn/catalog/` 下无 Authorization、Cookie 的 GET；
不登录、不安装扩展、不运行云任务，付费请求数为零。
首次导入依赖时，npm Electron 入口自动下载了缺失二进制（2026-10-15 23:33:51–52 -0400），
违反了本次“不安装”的约束；Electron 未启动。脚本现于导入前设置隔离的
`ELECTRON_OVERRIDE_DIST_PATH`，后续取证未再次触发下载。未删除或改写共享依赖。
初轮桥接参数错误及过窄的目录 URL 路径限制已在脚本内修正；最终组件 ID 失败仍如实保留。

## 保存的证据与检查

- [output.json](output.json)：请求 URL / HTTP 状态 / 字节数 / 哈希、两条价格说明、五次完整查询、四项断言。
- [signed-state.json](signed-state.json)：生产缓存保存的公开签名文档与目录原文字节（JSON 字符串），可供独立复核。
- [HTML 载荷原字节](cloud-html.payload.json)、[image 载荷原字节](cloud-image.payload.json)：来源为已签目录中的真实 payloadRef URL；没有自造外部格式 fixture。
- [run.log](run.log)：最终运行 stdout、失败断言与退出码。
- 包行价格逐字匹配 `holdUsd`、带价单独查询不追加缺项句、混合查询对真实缺价云条目追加一次缺项句：**PASS**。
- 要求的 `cloud:html` / `cloud:image` 组件行存在：**FAIL**；需要确认是否可接受上述包行作为退出证据。
- [docs-contract.json](docs-contract.json)：使用共享只读文档 checker 的 `check_repo`，按 Alpha delivery profile 配置仅检查当前 worktree；35 个既有 `layout.role-alias` 错误，均在受保护的 `docs/evidence/2026-10-10-req229-230-visual/`，本目录无新增错误。
- `git diff --check` 与本目录 Markdown 相对链接检查通过。
- 未运行全仓 gate：`bin/check` 转入的 `scripts/alpha-check.sh` 第 9 步会实际 `bun install`，与本次不安装约束冲突；本记录不声称全仓 gate 通过。
