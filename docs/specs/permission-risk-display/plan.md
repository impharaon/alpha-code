---
id: PLAN-permission-risk-display
title: 用户在授权时能看出动作的风险档位 实施计划
summary: alpha-code#1314 的实施计划:风险标签组件进组件库,批准面板与能力授权框共用;只做呈现,分类器不动
kind: plan
status: active
spec: SPEC-permission-risk-display
design: ""
owners: [alpha-code desktop maintainers]
last_reviewed: 2026-11-13
---

# PLAN-permission-risk-display｜用户在授权时能看出动作的风险档位 实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。每个交付段一节;旧段留作证据。决定只链接、不重述;实施中偏离本段,在同一个提交里改本段。

## 风险标签组件与两处接入(alpha-code#1314)

- 依据:[SPEC-permission-risk-display v1](spec.md) @ `57f4cbbf1c`,AC-01、AC-02 与「体验约定」;无单独技术方案(分类引擎与 `metadata.codepuppyRisk` 已存在,本段只做呈现)。界面稿 @ `a559317fc6`:现行稿 [`current/conversation-timeline/design.html#permission-risk`](../../design/current/conversation-timeline/design.html)、[`current/capability-authorize/design.html`](../../design/current/capability-authorize/design.html),组件稿 [`2026-11-13-1314-risk-tag/frame.html`](../../design/2026-11-13-1314-risk-tag/frame.html),组件库待定行 `docs/design/system/components.md`「Pending」与 `tokens.md`。意图 INT-desktop I-15(组件进组件库、两处共用、不做页面私有副本)。Issue [impharaon/alpha-code#1314](https://github.com/impharaon/alpha-code/issues/1314)。
- 核对:`e02eca55e2` · 编排器(Claude Fable 5.2) · 通过(裁决:渲染进程引 `packages/ext` 的读取函数仅在不违反已记载的依赖方向时允许,并引用所依据的规则;极高风险那句按稿作为新文案走 `description`;`ExtGrantedCapRow` 换组件在范围内;不改 `permission-shape.test.ts`,在 plan 里保留该观察,并更新 `lane-seams.md` I7a)。

**AC 原文(逐字,来自 spec v1)**

- AC-01 授权框呈现分类结果,且**不同档位在视觉上可区分**;用户不必读工程术语就能看出「这次比平常危险」。*将来拿什么证明*:UI 类 AC ⇒ 与已批设计稿对比(按 `design-loop`,先出增量帧再实现)。
- AC-02 分类**缺失时**的呈现是明确的(不是假装安全,也不是吓人):`#1313` 的兜底是未命中任何规则 ⇒ `critical/unknown`,呈现要与之一致。*将来拿什么证明*:一条呈现层判据,断言 `unknown` 档不被渲染成低危。

**体验约定(逐字,来自 spec v1)**

- 用户路径:工具请求授权时,批准面板标题后出现一个风险标签;定制中心的能力授权框里,高风险的能力行在技术名之后出现同一个标签。
- 交互与状态:标签是一个胶囊加文字,没有图标,只有一种尺寸,不能点、不能聚焦;所在行变淡时跟着变淡。五档:低风险(绿)、中风险(灰)、高风险(琥珀)、极高风险(红)、风险未知(只描边、不填色,不渲染成低危)。批准面板五档都会出现并保留「极高风险」那句说明;能力授权框只用「高风险」一档,新增行与已授权行都标,将收回的不标。第三方远程工具常显示「高风险」是分类规则的现状,本规格不改分类。
- 文案:只有档位名五个词;不解释原因。

### 已核事实(带出处,实施不再重查)

1. **`codepuppyRisk` 怎么到渲染进程,取值有哪些。**
   - 产生:`packages/ext/src/policy/index.ts:167-181`(`permission.hook.evaluate` 在 `effect === "ask"` 时写 `metadata.codepuppyRisk`)与 `packages/ext/src/policy/gate.ts:155-160`(身份轴请求经 `withRiskClassification`);都覆盖入参同名键(`risk.ts:744-749`)。形状 `RiskClassification{version:1, level, kind, rules, facts}`,`level ∈ low|medium|high|critical`,`kind` 共 14 类(`risk.ts:40-62`,契约见 `docs/contracts/permission-risk-classification.md`「形状」)。
   - 兜底:没有规则命中 ⇒ `{level:"critical", kind:"unknown", rules:["fallback:unknown"]}`(`risk.ts:701`、`722-724`),分类器抛异常 ⇒ `fallback:classifier-threw`,同一档(`risk.ts:738-740`)。真引擎上的兜底形状有判据:`packages/ext/src/policy/risk.test.ts:312`。**`kind:"unknown"` 时 `level` 恒为 `critical`**。
   - 读取函数:`readRiskClassification(metadata)`(`risk.ts:751-760`):`version === 1`、`level`/`kind` 在词表内、`rules` 是数组,否则 `undefined`。
   - 到达:引擎 `Permission.Request.metadata` → `toV1PermissionRequest` 原样 → v1 `permission.asked` 事件与 `GET /permission`(`packages/ui-mac/src/engine-adapter/v1-shapes.ts:437-440`)→ `adaptPermissionV1Request` 把 `metadata` 原样带到审批面形状(`packages/codepuppy-app/src/context/permission-v1-adapter.ts:109`,事件路径 `:196-200`,列表路径 `:178`);引擎自己的 `permission.v2.asked` 直接带 `metadata`(`:185-189`)。类型 `PermissionV2Request.metadata?: Record<string, unknown>`(`packages/codepuppy-sdk-v1/src/v2/gen/types.gen.ts:5066-5080`)。审批面 `PermissionDialog` 的入参 `props.request` 就是这个形状(`PermissionDialog.tsx:49-50`、`:59`)。
   - 现状:渲染进程**不读**它(`docs/design/2026-11-09-1662-lane-seams.md:334` 已记,`grep codepuppyRisk packages/ui-mac/src/renderer` 无非测试命中)。注意 `packages/ui-mac/src/engine-adapter/permission-shape.test.ts:15` 的夹具把它写成字符串 `"low"`,不是真形状;读取函数对它返回 `undefined`,本段不改该夹具。
   - **映射到五档**(组件稿「每种状态读哪个字段」):`readRiskClassification` 为 `undefined`(缺失、非对象、`version≠1`、词表外)⇒ `unknown`;`kind === "unknown"`(此时 `level` 恒为 `critical`)⇒ `unknown`;其余按 `level` 直接对应 `low/medium/high/critical`。`unknown` 永远不会走到 `low`,也不画成红。`level === "critical"` 且 `kind === "exfiltration"` 时,说明位多一句「可能把密钥或私人数据发到外部」(组件稿给出;**代码里今天没有这句**,是新文案,见改动表)。
2. **能力授权框。**「高风险」今天由 `packages/ui-mac/src/renderer/extensions/ext-authz.tsx:35` 的 `HIGH_RISK = {engine:plugin, process:spawn}` 判(`authzHasHighRisk` `:44-48`、顶部风险行 `:223-225` 同源)。`CapRow`(`:123-156`)已经「新增与已授权都标、将收回不标」(`:147` `kind !== "removed" && HIGH_RISK.has(cap)`),标签现在是 `<span class="codepuppy-ext-authz-chip" data-kind="risk">`(`:148-150`),与变化标签 `data-kind={kind}`(`:152-154`)同一个类。`ExtGrantedCapRow`(`:162-184`,详情页「已授权能力」被动行,`extension-detail.tsx:1019`、`:1634` 使用)有同一个标签(`:178-182`)。样式在 `extension-hub.css:1474-1494`:`.codepuppy-ext-authz-chip` 一个类、`[data-kind="new"], [data-kind="risk"]` 共用琥珀(文字色 `--a-warning`),`removed` 用 `--a-success`。**收成一个**:两处 `data-kind="risk"` 改用组件,`[data-kind="risk"]` 选择器删除,`new`/`removed` 的文字色换 `--a-warning-on-subtle`/`--a-success-on-subtle`(稿的「顺带」)。`ext-pack-facts.ts:46-47` 另有一份同内容的 `HIGH_RISK_CAPS`,只管排序,与本段无关,不动。
3. **同一个形状的两个标签**:`.codepuppy-ext-authz-chip[data-kind="risk"]` 与稿中批准面板的 `.a-permission-tier`(只在稿里,未进代码)都由组件取代。

### 做法(本段的本地选择)

- **组件**:`packages/ui-mac/src/renderer/codepuppy-ui/RiskTag.tsx` + `risk-tag.css`(与 `Banner.tsx` + `banner.css` 同形:组件自己 `import "./risk-tag.css"`)。API 只有 `RiskTag(props: { level: RiskTagLevel; id?: string })`,`RiskTagLevel = "low" | "medium" | "high" | "critical" | "unknown"`;渲染 `<span class="a-risk-tag" data-level={level}>{t(label)}</span>`,文字由组件按档位取(五个词,`codepuppy.riskTag.*`),不接收自由文本、没有 `class`/尺寸/点击入参(组件稿「没有」一栏)。`id` 只为面板的可读名称引用。CSS 照稿原样搬(`.a-risk-tag` 五档规则),不加 hover/focus 规则。
- **令牌**:`--a-warning-on-subtle`(浅 `#92400e` / 深 `#fbbf24`)、`--a-success-on-subtle`(浅 `#166534` / 深 `#4ade80`)加进 `codepuppy-ui/tokens.css` 的**三个主题块**(`:root`、`:root[data-color-scheme="dark"]`、`prefers-color-scheme` 的 os-dark 块;os-dark 不覆盖 `-subtle`,漏写会继承浅色值,见 `tokens.css` 该块里 `--a-error-on-subtle` 的注释)。
- **读取**:新文件 `codepuppy-ui/permission-risk.ts`,`permissionRiskOf(request)` 返回 `{ level: RiskTagLevel; reason?: I18nKey }`,实现上就是上面的映射。**直接 import** `packages/ext/src/policy/risk.ts` 的 `readRiskClassification`(相对路径,与 `PermissionDialog.tsx:12` 引 `packages/codepuppy-app` 同一做法;`ui-mac` 的 `engine-adapter` 已有同类引用 `v1-shapes.ts:26`),不另抄一份判据。该模块零运行时 import(只有一个 `import type`),已在临时目录用 vite 打一个只引 `readRiskClassification` 的入口:产物 2.5 KB、分类规则被摇掉。
- **面板**:`PermissionPanel` 增加可选 `risk?: RiskTagLevel`;标题 `div` 之后渲染 `<RiskTag id=…>`(稿的位置:标题行内,不进会滚动的正文);`aria-labelledby` 写 `"<titleId> <riskId>"`,读屏念「允许这次操作吗? 高风险」(稿「用法·读屏」)。极高风险且 `exfiltration` 时用面板已有、今天无人传的 `description` 入参(`PermissionDialog.tsx:355`、`:430`、`:454-456`)放那一句。`PermissionDialog` 每次都传 `permissionRiskOf(props.request)`,所以缺失时也有标签。
- **文案**:`i18n/zh.ts`、`i18n/en.ts`(`codepuppy.*` 只在这两个词典里维护,别的语言走回退,`hub-copy.test.ts:48` 的依据同)新增 `codepuppy.riskTag.{low,medium,high,critical,unknown}`(低风险/中风险/高风险/极高风险/风险未知;Low risk/Medium risk/High risk/Critical risk/Risk unknown)与 `codepuppy.permission.riskExfiltration`(可能把密钥或私人数据发到外部 / May send keys or private data outside)。删掉不再有人用的 `codepuppy.ext.authz.riskHigh`(两个词典)。新键名避开 `PermissionDialog.test.ts:933-935` 那条按前缀数 19 条的正则(`allow*/remember*/…`)。
- **不改**:分类器与它的规则、`HIGH_RISK` 的成员、面板与授权框稿里没画的任何东西(按钮、记住框、顶部风险行 `codepuppy-ext-confirm-risk`、各句提示)。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/renderer/codepuppy-ui/RiskTag.tsx`(新) | 共享组件,API 见上;唯一一份风险标签的结构 |
| `packages/ui-mac/src/renderer/codepuppy-ui/risk-tag.css`(新) | `.a-risk-tag` 外形 + 五档颜色,照组件稿 |
| `packages/ui-mac/src/renderer/codepuppy-ui/tokens.css` | 两个新令牌 × 三个主题块 |
| `packages/ui-mac/src/renderer/codepuppy-ui/contrast-ratchet.test.ts` | `TINTED_TEXT` 增三行:`--a-warning-on-subtle`/`--a-warning-subtle`、`--a-success-on-subtle`/`--a-success-subtle`、`--a-error-on-subtle`/`--a-error-subtle`,底都取 `--a-surface-raised`(批准面板与对话框的实际底;现有那行取 `--a-surface` 保留)。表里加行不增加 `test()` 条数,`gate-files.tsv` 的精确条数不动;抬头「今天只有一行」的说明同步改 |
| `packages/ui-mac/src/renderer/codepuppy-ui/permission-risk.ts`(新) | `permissionRiskOf`:`metadata.codepuppyRisk` → 五档 + 可选说明句;AC-02 的呈现层判据住在这里 |
| `packages/ui-mac/src/renderer/codepuppy-ui/PermissionDialog.tsx` | `PermissionPanel` 加 `risk`,标题行渲染标签并并入 `aria-labelledby`;`PermissionDialog` 传 `risk` 与 `description` |
| `packages/ui-mac/src/renderer/codepuppy-ui/permission-dialog.css` | 只在需要时(标题行里标签与标题的对齐/不收缩)加规则;以浏览器测试量到的结果为准,量不出问题就不加 |
| `packages/ui-mac/src/renderer/extensions/ext-authz.tsx` | `CapRow`、`ExtGrantedCapRow` 的 `data-kind="risk"` 换成 `<RiskTag level="high" />`;`HIGH_RISK` 与行的显示条件不动 |
| `packages/ui-mac/src/renderer/extensions/extension-hub.css` | 删 `[data-kind="risk"]` 选择器;`new`/`removed` 文字色换 on-subtle 令牌 |
| `packages/ui-mac/src/renderer/i18n/zh.ts`、`en.ts` | 见「文案」 |
| `packages/ui-mac/src/renderer/codepuppy-ui/RiskTag.test.ts`、`risk-tag-test-runtime.ts`(新) | 组件逐档、授权框两个消费方的渲染测试;runtime 文件导出 `createComponent`/`render`/`RiskTag`/`ExtAuthzView`/`ExtGrantedCapRow`,构建方式同 `Dialog.test.ts` + `dialog-test-runtime.ts` |
| `packages/ui-mac/src/renderer/codepuppy-ui/permission-risk.test.ts`(新) | 纯函数判据,不需要渲染 |
| `packages/ui-mac/src/renderer/codepuppy-ui/PermissionDialog.test.ts` | 新增 describe「#1314 风险标签」,用文件里现成的挂载与请求构造 |
| `packages/ui-mac/src/renderer/codepuppy-ui/risk-tag.browser.test.ts`(新) | 真 Chrome 里量几何与对比度,并与已批 `frame.html` 的计算样式逐项相等;形制照 `tooltip.browser.test.ts`(`playwright-core` + `test-visual` 的 vite,`CHROMIUM_PATH` 或 macOS Chrome) |
| `packages/ui-mac/test-visual/main.tsx` | `scene=approval` 增 `risk` 查询参数(写 `metadata.codepuppyRisk`);新增 `scene=authz`(渲染 `ExtAuthzView` 与 `ExtGrantedCapRow`,引 `extension-hub.css`)。只加场景,不改既有场景 |
| `docs/design/system/components.md` | 把「Pending」里的 RiskTag 行移进 Primitives 表(Source:`RiskTag.tsx` + `risk-tag.css`),删空的 Pending 小节 |
| `docs/design/system/gallery.html` | 按这份镜像的做法补一格:顶部目录链接、`risk-tag.css` 原样、两个新令牌(及镜像里缺的 `--a-error-on-subtle`)补进三个主题块、一节五档浅/深 |
| `docs/design/system/tokens.md`、`color.md` | 「待定」改成已加入 `tokens.css` 的现状 |
| `docs/design/current/conversation-timeline/components.md`(第 68 行)、`docs/design/PAGE-MAP.md`(权限确认、能力授权两行) | 「待实现」改成已落地并写代码入口 |
| `docs/contracts/permission-risk-classification.md` | 「不重画授权框:今天的 `PermissionDialog` 不读 `metadata`,呈现层改动另立票」一格改成现状 |
| `docs/README.md` | 加 `PLAN-permission-risk-display` 一行 |

登记簿:预计 `scripts/gate-files.tsv`(`contrast-ratchet.test.ts` 条数不变)与 `scripts/old-name-exceptions.tsv`(新增文字不含旧名)**都不用改**;每个提交后跑 `bun test src/main/gate-file-registry.test.ts src/main/old-name-scan.test.ts`(`packages/ui-mac`),哪一个红就按它点名的行改。新测试文件名避开登记簿的命名触发词(ratchet/lock/anchors/contract/copies/snapshot/drift/hygiene/rebrand/seam/coexistence/census)。

### 顺序

每个提交各自过下面的相关测试,在 `packages/ui-mac` 下用 `PATH=$HOME/.bun-versions/1.4.4/bin:$PATH` 跑;基线(本计划阶段已实跑):`PermissionDialog.test.ts`、`contrast-ratchet.test.ts`、`ext-authz-wiring.test.ts` 79 条全绿,两个登记簿测试 33 条全绿。

1. **令牌 + 组件。** `tokens.css`、`risk-tag.css`、`RiskTag.tsx`、两个词典、`risk-tag-test-runtime.ts` 与 `RiskTag.test.ts` 的组件部分、`contrast-ratchet.test.ts` 三行。跑:`bun test src/renderer/codepuppy-ui/RiskTag.test.ts src/renderer/codepuppy-ui/contrast-ratchet.test.ts src/renderer/i18n/locale-regression.test.ts` + 登记簿两个。
2. **批准面板接入。** `permission-risk.ts`(+ 测试)、`PermissionDialog.tsx`、(需要时)`permission-dialog.css`、`PermissionDialog.test.ts` 新增部分。跑:`bun test src/renderer/codepuppy-ui/permission-risk.test.ts src/renderer/codepuppy-ui/PermissionDialog.test.ts` + 同目录 `permission-*.test.ts`(`permission-mount-ratchet`、`permission-auto-approve-switch`、`perm-tier-color`)+ 登记簿两个。
3. **能力授权框接入。** `ext-authz.tsx`、`extension-hub.css`、词典删 `riskHigh`、`RiskTag.test.ts` 的消费方部分。跑:`bun test src/renderer/codepuppy-ui/RiskTag.test.ts src/renderer/extensions/ext-authz-wiring.test.ts src/renderer/codepuppy-ui/Dialog.test.ts src/renderer/extensions/hub-copy.test.ts` + 登记簿两个。
4. **真浏览器证据。** `test-visual/main.tsx` 两个场景、`risk-tag.browser.test.ts`。跑:`bun test src/renderer/codepuppy-ui/risk-tag.browser.test.ts`;`tsgo`/类型检查按本包既有命令(`bun run --cwd packages/ui-mac typecheck`,若无则 `tsc --noEmit -p packages/ui-mac`)只在这一步与第 2 步各跑一次。
5. **文档与登记。** 上表 `docs/` 各行。跑:`bash scripts/docs-link-check.sh` 与登记簿两个(只读检查,不是全量门)。

### 风险

- **渲染进程第一次 import `packages/ext` 的源文件。** 已知:`readRiskClassification` 所在模块零运行时依赖,打包实测 2.5 KB;`ui-mac` 已有相对路径引别包的先例(`PermissionDialog.tsx:12`、`engine-adapter/v1-shapes.ts:26`),`.oxlintrc.json` 没有限制这个方向。若实施中被某道守卫拦下,退路是在 `permission-risk.ts` 里抄那 8 行判据并加一条与 `risk.ts` 的同输入逐值比对测试;改了就写进偏离记录。
- **形状没有被冻结。** `lane-seams.md` I7a 明说渲染进程不读 `codepuppyRisk`、故不冻结;现在读了。保护是方向性的:任何不认识的形状都落到「风险未知」,不会落到低风险。#1710(现已撤下)重新放回时,要确认审批请求的 `metadata` 仍原样透传(`permission-shape.test.ts` 里的夹具是字符串 `"low"`,不是真形状,建议那时改成真对象)。
- **标题行变高。** 标签行高取 `--a-leading-snug`、比标题矮,稿里加标签前后标题行都是 31.75。几何测试量真组件的同一个数,并与稿逐项相等;宽 440 是最窄情形。
- **面板名称。** `aria-labelledby` 改成两个 id;现有测试没有断言它等于标题 id(已 grep:`Dialog.test.ts` 的同名断言只管 `Dialog`)。
- **已授权行变淡。** 行 `opacity: 0.62`(`extension-hub.css:1420`)带着标签一起变淡,是稿与规格要的;对比度判据量的是不变淡的标签,变淡后的值不在 ≥ 4.5 的承诺里。
- **详情页「已授权能力」行也会换成组件。** 它今天就用同一个 `data-kind="risk"` 标签;选择器删掉后不换会失去样式。外观与今天只差文字深浅,不算新界面;若要它不标,是产品决定,不在本段。
- **新增文案。** 稿里那句「可能把密钥或私人数据发到外部」今天代码里没有(派发书说「保留现有」,实际是稿定义、本段新增),按稿的中英文写进词典。
- **浏览器测试依赖本机 Chrome**(与 `tooltip.browser.test.ts` 同一约定)。几何/对比度判据不依赖字体渲染细节以外的东西;若 440 宽的面板在 harness 里被输入框限制到别的宽度,先断言面板宽度本身 = 440 再量,量不到就返回而不是放宽。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 档位文字与可区分 | `RiskTag.test.ts`「五档逐一:文字、`data-level`、静态」:每档渲染后文字 = 稿的五个词,`data-level` 各不同,元素是不可聚焦的 `span`(无 `tabindex`/`role`/`title`/按钮) | 少一档、文字写错、做成可点击都红 |
| AC-01 批准面板 | `PermissionDialog.test.ts`「#1314」:对 `low/medium/high/critical(非外发)/critical+exfiltration` 五个请求,面板里恰有一个 `.a-risk-tag`,在 `.a-permission-panel-header` 里、在标题之后、`data-level` 与文字对应;只有 `critical+exfiltration` 出现说明句;`aria-labelledby` 同时含标题 id 与标签 id | 去掉接线 ⇒ 没有标签;标签放进正文 ⇒ 不在 header 内;漏并 `aria-labelledby` ⇒ 读屏名称缺档位 |
| AC-01 能力授权框 | `RiskTag.test.ts`「授权框」:`ExtAuthzView` 渲染含新增 `process:spawn`、已授权 `engine:plugin`、将收回 `engine:plugin`、低/中档能力的 diff:前两行各有一个 `.a-risk-tag[data-level="high"]`,将收回行与低/中档行没有;`ExtGrantedCapRow` 高风险有、低风险无;页面里不再有 `.codepuppy-ext-authz-chip[data-kind="risk"]` | 回到旧类 ⇒ 最后一条红;把已授权行漏标或把将收回行也标 ⇒ 对应行红 |
| AC-01 与已批稿一致 | `risk-tag.browser.test.ts`「与 frame.html 逐项相等」:同一个 Chrome 里分别打开已批 `docs/design/2026-11-13-1314-risk-tag/frame.html` 与 harness 的真组件,浅/深两色、五档,逐档比较 `padding`、`border-radius`、`font-size`、`font-weight`、`letter-spacing`、`line-height`、`color`、`background-color`、`box-shadow` 的计算值,并比较批准面板标题行高度(稿里加标签前后 = 31.75)与能力授权框的「高风险」标签 | 组件 CSS 与稿有任何一项不同、令牌缺一个主题块(深色/浅色值错)都红 |
| AC-01 几何 | 同文件「几何」:① 标题行高度**有标签 = 把标签 `display:none` 后**(差 < 0.01);② 宽 440(视口 488 使输入框 = 440,先断言面板宽 = 440)下标签的矩形落在标题行内、在标题右侧、不换行(高度 ≈ 单行)、竖直方向与标题居中(±1);③ 长命令把正文滚到底后标签矩形不动;④ 授权框一行的高度有标签 = 无标签;⑤ 对话框的可读名称(Playwright `getByRole('dialog',{name})`)= 「允许这次操作吗? 高风险」 | 标签行高大于标题 ⇒ ①红;标签放进正文或可收缩 ⇒ ②③红;读屏名称不含标签 ⇒ ⑤红 |
| AC-01 对比度 | 同文件「对比度」:浅/深 × 五档,按稿的算法(背景沿祖先逐层合成)量每档文字对比度 ≥ 4.5,并写进证据输出;`contrast-ratchet.test.ts` 的新三行在三个主题块各判一次 | 把 `--a-warning-on-subtle` 改回 `--a-warning`(浅色 2.80)或删掉 os-dark 块里的覆盖 ⇒ 两处都红(实施时做这两个变异并把输出写进提交说明) |
| AC-02 呈现层判据 | `permission-risk.test.ts`:`permissionRiskOf` 对 缺 `metadata`、`{}`、`codepuppyRisk` 为字符串/`null`/数组、`version: 2`、词表外 `level`、`kind: "unknown"` + `level: "critical"` 都返回 `unknown`,逐个断言 `level !== "low"` 且 `!== "critical"`;输入用**真分类器输出**——`classifyPermissionRequest` 对一个无规则可命中的请求(得 `critical/unknown`)、对工作区内改文件(得 `low`)、对外发+凭据(得 `critical/exfiltration`)——证明读的是真形状 | 把缺失/兜底映射成 `low` 或 `critical` ⇒ 对应行红 |
| AC-02 渲染出来也不是低危 | `PermissionDialog.test.ts`「#1314」:请求不带 `metadata`、带兜底 `critical/unknown`、带字符串 `"low"` 三种,渲染出的标签文字 = 「风险未知」、`data-level="unknown"`,页面里没有 `data-level="low"` 也没有 `data-level="critical"`,且没有说明句;真浏览器测试里 `unknown` 标签的计算背景透明、文字色 ≠ 绿/红令牌,对比度 ≥ 4.5 | 在 `PermissionDialog` 里把缺失当 `low` 画 ⇒ 红(实施时做这个变异,输出写进提交说明) |

不在本段证明、留给打包版回归:真引擎弹出的真实请求在整条链(引擎 → 适配器 → 审批面)上带着 `codepuppyRisk` 的端到端画面;用户在打包版里看到 `rm -rf`、读 `.env`、第三方远程工具各自的档位(分类结果本身是 #1285 / #1313 的范围);浅色/深色在真实窗口与系统主题跟随下的观感;定制中心里真实的授权确认流程。这些需要打包版与真引擎,规格里「实机验证」仍是未做状态。

### 偏离记录

暂无。
