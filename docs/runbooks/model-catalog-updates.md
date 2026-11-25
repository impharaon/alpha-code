---
id: RUNBOOK-alpha-code-model-catalog-updates
summary: "Model catalog updates (platform proxy & BYOK)"
title: Model catalog updates (platform proxy & BYOK)
kind: runbook
status: active
owners:
  - Code Puppy maintainers
last_reviewed: 2026-11-25
review_after: 2027-02-23
---

# 模型清单更新 runbook(平台代理 + BYOK)

**每次更新模型,平台代理(A)与自带 Key(B)两半一起做。** 两半都是 alpha-platform `packages/gateway` 下的**配置改动**:
不改源码(`test/model-names-single-source.integration.test.ts` 会拦住源码里的模型名)、不发 App
(例外见末尾「仍需要发 App」)。桌面端在启动、登录身份变化、每 30 分钟、手动重试时从网关拉两份清单
(`packages/ui-mac/src/main/catalog-refresher.ts`),所以配置部署后桌面端自己跟上。
方案:`docs/design/req236-catalog-and-model.md` §2.1–2.4、§2.9。

## 每次更新的两半清单

| 半 | 改哪个文件(alpha-platform `packages/gateway`) | 桌面端读的接口 | 部署后验证 |
| --- | --- | --- | --- |
| A 平台代理 | `src/models.config.json`(模型、`routes`、`aliases`、`roles`、`editionModels`、`display`、档位)+ 台账 `route-leg-reachability.json`、`src/price-adjudications.json` + 生成夹具 | `GET /v1/models`(ModelCatalogV3,有登录态带 bearer) | 探针 1–5 |
| B BYOK | `src/byok-catalog.json`(`catalog_version` 加一)+ 生成夹具 | `GET /v1/byok-catalog`(ByokCatalogV1,不带凭据) | 探针 6 |

- [ ] A:新模型、换代的旧 id 进 `aliases`、`roles` / `editionModels` 引用的 id 都已更新
- [ ] A:价格、窗口、输出上限、出处、台账都对过
- [ ] B:同一批模型在 `byok-catalog.json` 里也加 / 改 / 撤,`catalog_version` 加一
- [ ] 两半在同一次部署里上线

## A. 平台代理

前置(缺一不可,否则上架即死路由):

1. 至少一条可路由的 route:平台持有该家原生 key,或 OpenRouter 已上架同名模型。
2. 价格是上游实价,不估。

步骤(命令在 `packages/gateway` 下跑,`bin/…` 在 alpha-platform 仓根):

1. **改 `src/models.config.json`**(模型名只在这里和两份台账里出现):
   - `models.<id>`:`minPlan`(`free` / `member`)、`enabled`、`display`(`name`、`brand`、可选 `reasoning` / `web` / `variants`)、
     `routes[]`(顺序即优先级:原生在前、OpenRouter 兜底)。
   - 每条 route:`provider`、`upstreamModel`、`baseURL`、`wire`、`pricing`(`inUsdPerMtok` / `outUsdPerMtok`,可选
     `cacheReadUsdPerMtok`)、`maxOutputTokens`、`contextWindowTokens`、`capabilityProvenance`(`source`、`asOf`、`reviewAfter`、
     `verifiedBy`、`tupleFingerprint`、`outputCapReading`)、`reasoningWire` 与 `reasoningWireUnverified` 二选一。
     缺一项网关装载即失败(`src/models-config-loader.ts`)。
   - 换代:旧 id 写进 `aliases`;`/v1/models` 只列当代。每家只保留最新一代。
   - `roles`(`pricingBasis`、`pipelineCheap`、`pipelineSmart`、`agentChat`、`cloudCoding`)与 `editionModels`(cn 版可见名单)引用的 id 同批改;
     引用到未启用模型,装载即失败。
2. **台账**:`route-leg-reachability.json` 每条 route 一条带日期的观测记录,加 route 加记录、摘 route 摘记录。
3. **指纹与签核**:`tupleFingerprint` 钉住 provider、upstreamModel、wire、beta 集、窗口、输出上限和四个价,改任一项旧签作废。
   - OpenRouter 腿:`bin/verify-openrouter-capability`(核窗口、输出上限,并把直连价与 OpenRouter 现价并排比;有未裁决分歧退出 1)。
   - 直连腿:`verifiedBy` 含「待 owner 复签」时整份配置拒绝装载;owner 过目后跑 `bin/countersign-capabilities --by "<签核人>"`。仓库代码不得代签。
   - 直连价与 OpenRouter 价不一致:要 owner 的原话,记进 `src/price-adjudications.json`(按 模型 / provider / 字段 / keep 逐条);**没有原话就不写**。
4. **重新生成夹具**:`npm run contracts:generate`(写 `contracts/v3/fixtures/producer/model-catalog.json`);
   价格的第二道锚 `test/fixtures/live-config-expectations.json` 手改成新的单价 / 窗口 / 输出上限。
5. **跑检查**:`npm run verify:output-caps`(`maxOutputTokens` 必须等于 `outputCapReading.value`)、`npm run verify:route-legs`、
   `bin/verify-openrouter-capability`。相关用例:
   `npx vitest run test/models-config.integration.test.ts test/registry.fast.test.ts test/model-catalog-v3.fast.test.ts test/model-names-single-source.integration.test.ts`
   (网关仓用 vitest,不是 `bun test`)。
6. **部署前核对**(三件都要写进给 owner 的汇报):
   - **预留下限**:任何请求都按「模型整个上下文窗口 × 输入价」预留。新模型的预留下限与各套餐额度对一遍,告诉 owner 没有钱包余额的订阅用户会遇到什么。
     预留规则正在 alpha-platform#606 里改;只描述现状,不描述未来设计。
   - **复核日期**:`jq -r '.models[].routes[].capabilityProvenance.reviewAfter' src/models.config.json | sort -u`。过了日期的 route 请求期回 503;
     60 天内到期的,同一次更新里一起续(按第 3 步的同一套核验)。
   - **价格漂移**:部署闸会拿 OpenRouter 实时目录交叉核验。测价到部署之间价格会动:漂的 OpenRouter 行按第 3 步重新核;直连腿的分歧要 owner 原话。
7. **推送**:只改 `.gate-light` 圈定的文件(上面的配置、两份台账、生成夹具、`docs/verification/**`、`*.md`)时 `gate` 跑 `bin/check-light`,
   不跑全量门;它对配置改动会跑全量门的每一步外加「零未裁决分歧」。
8. **部署**:顺序与命令按 alpha-platform `docs/runbooks/deploy.md`(账户服务先,再网关,再其他 Worker),
   用 `npm run deploy:worker -- --config <wrangler 配置> --message "git:$sha"`,**不要**直接 `wrangler deploy`(前置闸不会跑)。
   `roles` 会被打进非网关 Worker,所以角色变了就要把这些 Worker 都按序重部署。
9. **探针**(每个都要;测试租户见 alpha-platform `docs/runbooks/production-test-account.md`,要另行授权):
   1. 不带凭据 `GET /v1/models`:列表是新当代,旧 id 不在列。
   2. 每个新 / 改动的模型各发一条最小消息:上游与台账那行一致,预留快照里的单价与配置一致。
   3. 一次流式调用。
   4. 旧 id 经 `aliases` 由新 id 接住。
   5. 至少一个**只走 OpenRouter 的模型**:所有 OpenRouter 腿都经网关的告警中继发出(内联调用被上游拒收),无需配置,但探针必须覆盖;
      国际版专属 id 要用**国际版租户**验证(新建的生产测试租户落在大陆版,看不到它们),并核对大陆版租户请求它被拒。
   6. 见 B 节。

## B. BYOK 预置目录

在**已有 provider**(`byok-adapters.ts` 适配器表里有的)上增删模型、改名称 / 徽标 / 档位 / 能不能看图,全在 `src/byok-catalog.json`:

1. **改清单**(ByokCatalogV1):
   - `providers[].models` 加 `{ id, name, reasoning?, variants?, image_input }`;`id` 用上游真实 model id。每个模型自带完整元数据,
     不从平台同名条目借(同一模型经直连与经 OpenRouter 形状不同)。
   - provider 级可改 `name`、`brand`、`preset`(是否出现在「添加节点」快捷卡)与顺序。
   - **`catalog_version` 加一**(单调递增整数)。桌面端只采纳更高版本;撤一次坏发布 = 再发更高的版本,不回退版本号。
   - 不写 `baseURL` / `keyEnv` / `compat` / `npm`:schema 不允许,网关装载失败;发出去桌面端也整份拒绝。
2. **`image_input`(每个模型必填 `true` / `false`)**:抄 models.dev 同名模型 `modalities.input` 是否含 `image`,查与该 provider
   适配器 `baseURL` 同端点的 models.dev provider(`api.moonshot.cn` ⇒ `moonshotai-cn`、`dashscope.aliyuncs.com` ⇒ `alibaba-cn`、
   `api.minimaxi.com` ⇒ `minimax-cn`、`api.deepseek.com` ⇒ `deepseek`、`open.bigmodel.cn` ⇒ `zhipuai`):
   `curl -s https://models.dev/api.json | jq '."<provider>".models."<id>".modalities.input'`。
   查不到写 `false`,不按名字猜。厂商官方页写明能看图而 models.dev 尚未收录时以官方页为准,并在提交说明里写出处。
   MiniMax 的 models.dev 端点与适配器端点不是同一个(2026-11-20),没有同端点出处,有 Key 时实打一次。
3. **档位**(`variants`)按 `@ai-sdk/openai-compatible` 的 wire 形状写。
   显式关闭档写 `{ "thinking": { "type": "disabled" } }`,值逐字 `disabled`:写错(如 `bogus`)上游**静默忽略并继续思考,HTTP 仍 200**,
   所以 200 不是受理证据,看 `reasoning_content` 有没有(见 [`model-variant-reachability`](../architecture/2026-09-06-model-variant-reachability.md) §5)。
   给「关」档之前先实打:`glm-5.3` / `glm-5.3-flash` 始终思考,`disabled` 回 400(2026-11-20 实打),它们的档位是 `reasoningEffort` 的 low / high / max,「低」排第一(辅助调用取第一档)。
4. **上游认不认这个 id**:有该家 key 时 `bun packages/ui-mac/scripts/verify-byok-catalog.ts`(本仓;查的是安装包首启引导与适配器表端点,
   要验刚加的 id,临时加进本机 `codepuppy-models.json` 的 `byokCatalog` 再跑,不提交)。没 key 的供应商列进「本次未验证」,不假装绿;
   它读桌面端落在本机的 Key 文件或同名环境变量。
5. **重新生成夹具并跑检查**(`packages/gateway`):`npm run contracts:generate`(重写 `contracts/v1/fixtures/producer/byok-catalog.json`,测试要求它与清单逐字相等),
   `npx vitest run test/byok-catalog.integration.test.ts test/producer-fixtures-v1.fast.test.ts`。
6. **推送与部署**:只改清单与夹具走 `bin/check-light`(约 3 秒);部署与 A 同一次(清单只由 gateway 这一个 Worker 提供)。
7. **探针 6**:不带凭据 `curl -sS https://<gateway>/v1/byok-catalog` 返回新 `catalog_version` → 等一个刷新点(或重启 App)→ 引擎下次启动后,
   已配该家 key 的 BYOK 组出现新模型 → 选中发一条消息。BYOK 不经网关、不产生平台计费;能不能用取决于用户自己的 key 权限(preview 类可能要上游侧开通)。
   带图探针的图片要**至少 64×64**。

下次发 App 时,可把安装包首启引导(`codepuppy-models.json` 的 `byokCatalog`)更新成当时线上那份(同内容、同版本);
版本高于本机已采纳的远程版本时首启引导胜出。

## 生效时机

刷新点 = 启动、登录身份变化(只拉平台那份)、每 30 分钟、手动重试。**已下载 ≠ 已应用**:新清单下载好后,要等引擎下一次启动(任何原因的换代,含重启 App)
选择器和引擎才同时用上;这段时间选择器底部写「模型清单已更新,将在引擎下次启动后生效」。

## 仍需要发 App(`ship:mac`)的情形

只有这些(方案 §2.9),其余都走 A / B:

1. 新 BYOK 供应商(新端点 / Key 名 / 协议适配器):加进 `packages/ui-mac/src/main/byok-adapters.ts`(`{ id, compat, baseURL, keyEnv, pico }`),
   同时在 B 发布它的模型。只发目录不发 App,旧 App 会跳过这个 provider。
2. 新的推理选项键或新的请求协议(超出 `reasoningEffort | reasoning | thinking`、`openai | anthropic` 适配器)。
3. 新品牌要显示专属图标(数据可先发,图标回落为通用图形)。
4. 目录 schema 主版本变化(V3→V4、byok v1→v2)。
5. 平台模型需要客户端新能力(例如看图要开平台聊天入口的图片通道)。
6. 换 picker 的**平台默认模型**:`packages/ui-mac/src/main/codepuppy-models.json` 顶层 `defaultPlatformModel`(现为 `deepseek-v4-flash`,裸 model id)。
   桌面端拿它去**已发布的目录**里找:id 不在目录中,就不自动默认任何平台模型(不会替你挑一个便宜的)。
   所以已发出的 App 用作默认的那个 id,**不要从 A 的目录里改名或下架**;要换默认模型就发 App。

发版本身:`bun test src` → `ship:mac` 重建安装。

## 常见坑

- **桌面端不配任何价格**:计价倍数随 `GET /v1/models` 的 `pricing_multiplier` 下发(ADR-039);`src/shared/platform-pricing-authority-ratchet.test.ts` 拦着本地价格字段。
- **`roles.cloudCoding` 必须是沙箱里钉住的客户端能受理的模型**,换这个角色前先在沙箱实打。
- **模型 id 用当代真实 id**;换代走 `aliases`,不要留旧 id 在清单里。
- **价格不准 = ledger 记错账**,上架前对上游价目页。
- **查厂商文档走国际站**(本机网络下阿里、Moonshot、MiniMax 国内文档站连不上,2026-11-20):
  `www.alibabacloud.com/help/en/model-studio/models`、`platform.moonshot.ai/docs/pricing/chat`、`platform.minimax.io/docs/guides/models-intro`。
  国际站写的是国际端点,id 通常相同但不保证,以带 Key 的 `/models` 为准。
- **平台代理模型的看图**:网关聊天入口拒收图片,平台模型一律看不了图;BYOK 的 `image_input` 不适用于它。自定义节点只认用户在真源记录里显式声明的 `imageInput`(`custom-provider-truth.ts`)。
- **实测覆盖记录**:`deepseek-flash`(直连)2026-10-31 带 32×32 PNG ⇒ 200 回答 "Red",目录改为能看图(alpha-platform#565,`catalog_version` 2);
  智谱直连 2026-11-20:`glm-5.3-flash` 带图 ⇒ 200,`glm-5.3` 带图 ⇒ 400(`catalog_version` 3);OpenRouter 上的 `deepseek/deepseek-v4-flash` 仍只收文字(2026-09-24),两者不是同一个入口。
- 引擎侧 v1/v2 双配置通道由 sidecar 自动双投影(见 [engine-config-channels](../contracts/engine-config-channels.md)),本 runbook 的改动不需要碰引擎配置。
- preview / 实验模型在展示名里带 "Preview",避免用户当正式版依赖。
- **同步失败有出口**:`GET /v1/models` 或 `GET /v1/byok-catalog` 拉不下来或校验不过时,窗口顶部出现 warning 横幅,说明是哪一份并带分类码
  (`rate_limited` / `unauthorized` / `http-503` / `contract-incompatible` …),排障先看它;一份成功只收掉它自己那条。
- **改了没生效?** 先分清已下载还是已应用(见「生效时机」)。平台段写「平台模型清单尚未获取」= 这台机器还没拿到过有效的平台清单(网络 / 登录 / 网关未部署 V3)。
