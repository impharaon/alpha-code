// `#968` —— 「读仓内源码文本做断言」这一类的**分类登记簿**(判据在 gate-file-registry 的第 ⑤ 层)。
//
// 这个文件为什么**不是**测试文件:第 ⑤ 层的两张表以「测试文件路径」为键,而 gate-file-registry
// 自己是登记在册的闸门文件 —— 它的第 ③ 层「引用绊线」读的是**未剥注释的原始 body**,凡出现的
// `*.test.ts` 都必须已被分类成 REGISTERED / NOT_GATES / REFERENCED_BUT_UNREGISTERED 三者之一。
// 把这些路径写进那个文件,23 条一个都满足不了三条出口(它们不进 TSV;NOT_GATES 有 GATE_NAME_TOKENS
// 前置断言而这些文件名多数不命中;REFERENCED_BUT_UNREGISTERED 的公开含义是「这条保证今天没有 CI
// 在跑」,而它们每次 `bun test src` 都在跑 —— 塞进去是假话)。表放在**非测试模块**里,路径字面量
// 就不在任何已登记闸门文件的 body 里了,既不用给绊线开第四个出口,也不动它的语义。
//
// ── 这一类是什么 ──────────────────────────────────────────────────────────────────────
// 一个测试读仓内某个 `.ts`/`.tsx` 源码文件的**文本**,然后 `indexOf` 比下标、`toContain` 比字符串。
// 本仓对这类断言的裁决(`#218` / `#966` / `#968`)分两种,取决于**断言的主语**:
//
//   · **减速带(ANCHOR)** —— 主语是**运行期行为**(顺序 / 接线 / 生命周期 / 呈现),而算子是文本。
//     一个语义等价但写法不同的实现骗得过它;一个文本一模一样而行为被掏空的实现**也**骗得过它。
//     这类必须如实降级:测试标题带 `ANCHOR (not a gate): ` 前缀,并在下面登记「守不住什么」。
//
//   · **文本就是产物(KEPT)** —— 主语**就是文本本身**:负全称(「全仓不存在第二处 X」)、唯一性
//     计数、跨文件/跨包逐字一致、声明式配置的字面声明。这类没有更细的粒度,源码文本正是正确的
//     粒度,不降级。**选它不是免费的**:同样要写清为什么,同样要给一个能解析的证据指针。
//
// ── 为什么 `packages/ui-mac/src/main/index.ts` 那一批必须降级(实测,不是推断)────────────
// `index.ts:8` 静态具名 import `node:tls` 的 `setDefaultCACertificates`,而装着的 bun 1.3.14 没有它。
// 三条互相独立的执行路径全部失败:①直接 import ⇒ `SyntaxError: Export named 'setDefaultCACertificates'
// not found in module 'node:tls'`;②在动态 import **之前**注册 `mock.module("node:tls", …)` ⇒ 同一条
// SyntaxError,`0 pass / 1 fail`;③`Bun.plugin` 的 `build.module` ⇒ bun 明文拒绝
// `module() cannot be used to override builtin module "node:tls"`。
// ⇒ **bun 侧不存在把 index.ts 链接起来的办法**;`Effect.runFork(main)`(文件最后一行)只是第二堵墙。
// 也就是说这批锚不是「暂时还没写真判据」,是**结构上写不了**。boot/respawn 悬空 sweep → fork
// 的真闸门已落在 `#982`:`dangling-sweep-latch.ts` + `spawnLocalServer` 消费 credit(可 import,
// bun 可测)。本文件里的 ANCHOR 条目仍只是索引,不是那道闸。
//
// ── 边界(闸门不假装比自己强)────────────────────────────────────────────────────────────
//   · 谓词判的是**一行代码里同时出现读调用与一个 `.ts`/`.tsx` 路径字面量**。两支逃逸,都登记在 `#983`:
//     ①路径经变量/助手间接传入(`const F = "index.ts"; read(F)`);
//     ②**目录遍历** —— `readdirSync` 递归枚举出一批源文件名,再逐个 `readFileSync(join(dir, f))`,
//       行内一个路径字面量都没有。今天树上的活实例:`platform-error-code-gate.test.ts`
//       (它对 `src/main/` 全树的源码文本做负全称/唯一性断言,按本分类法归 KEPT)。
//     不靠放宽正则修:实测放宽会把命中从 39 打到 62/110 并把精度打崩(那就是「手写别人文法的替身」)。
//   · 范围今天锁死在 `packages/ui-mac/src/main/` 与 `packages/ui-mac/test-component/`。往全仓推是 `#981`。
//   · 分类是**按文件**的。一个文件里既有锚又有正当的文本闸时,归 ANCHOR(fail-closed),并由
//     `why` 说清哪几条是哪种。

/** 降级标签。测试**标题**里必须出现这一串(只写在注释里不算 —— 注释拆得掉,CI 输出里读不到)。 */
export const ANCHOR_TEST_LABEL = 'test("ANCHOR (not a gate)'

/** 第 ⑤ 层的辖区。往外推 = `#981`,不是在这里加前缀。 */
export const SOURCE_TEXT_SCOPE_PREFIXES = [
  "packages/ui-mac/src/main/",
  "packages/ui-mac/test-component/",
] as const

/** 读调用的形状。刻意**不**去排除写(没有任何 `writeFileSync` 特判)—— 过度命中由 KEPT 表吸收。 */
const READ_CALL = /\b(?:Bun\.file|read[A-Za-z]*)\s*\(/

/** 仓内源码路径字面量(单/双/反引号三种)。 */
const SOURCE_PATH_LITERAL = /(['"`])([^'"`\n]*?\.tsx?)\1/g

/** 测试/用例文件的路径字面量不算 —— 那是第 ③ 层的辖区,而且它不是生产源码。 */
const TEST_PATH_LITERAL = /\.(test|spec|cases)\.tsx?$/

/**
 * 命中的**代码行**(整行注释不算:静态判据约束的是代码,注释里允许举例说明 —— 与第 ③ 层
 * `codeLines` 同款理由。少了这一步,一句解释性的抬头就能把自己算进来)。
 */
export function sourceTextReadLines(source: string): string[] {
  const hits: string[] = []
  for (const line of source.split("\n")) {
    if (/^\s*(\/\/|\/?\*)/.test(line)) continue
    if (!READ_CALL.test(line)) continue
    SOURCE_PATH_LITERAL.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = SOURCE_PATH_LITERAL.exec(line))) {
      if (TEST_PATH_LITERAL.test(match[2]!)) continue
      hits.push(line.trim())
      break
    }
  }
  return hits
}

export type SourceTextEntry = {
  /** 这个文件的源码文本断言守不住什么(ANCHOR 必须点名 ≥2 个不会让它变红的变异)。 */
  why: string
  /** 可解析的证据指针:`#<数字>`,或一个盘上真实存在的 `docs/…` 路径。 */
  evidence: string
  /** 今天命中的**行数**。同一文件里新增一处同形态断言 ⇒ 数字对不上 ⇒ 当场红。 */
  lines: number
}

/**
 * **减速带**:文件里至少有一条源码文本断言的主语是运行期行为。
 * 每个条目对应的文件必须真的带上 `ANCHOR (not a gate): ` 标题前缀(第 ⑤ 层机械校验)。
 */
export const DOWNGRADED_ANCHORS: Record<string, SourceTextEntry> = {
  "packages/ui-mac/src/main/keychain-boot-order.test.ts": {
    why: "`#1571` 用 TypeScript AST 判 index.ts 的两组启动顺序。①AC3 末句 / 第 0b 步⑥:失锁分支恰为 ready 前 `app.exit(0); return`,失锁判断之前执行到的代码(模块顶层可执行语句 + main 里排在它前面的语句)不引用 safeStorage / session / net / BrowserWindow / cookies / initAuthEnv / initByokKeys。②迁移接线:钥匙串改名步在锁 / setName / preferAppEnv / 会话库步之后、第一个 yield* 之前,之前不碰上述标识符与 getStore;两个解密自检与 settleNamingMigration 在 whenReady 之后、initAuthEnv 之前,R21-3 收尾之前不引用 session / BrowserWindow / net / cookies / createMainWindow,失败分支只 app.exit(1) + return,index.ts 不直接写完成标记。③点名标识符在任何 import 里都不许 `as` 起别名。同文件 9 组变异副本证明判据会红。主语是运行期顺序、算子是源码结构,所以是锚。两个不会让它变红的变异:①ready 之前调用的某个函数(如 useEnvProxy 或 initCodePuppyEnvironment)在函数体里去碰 session —— 判据不追调用链;②点名清单之外的某个 Electron API(或被 import 的模块在顶层)提前打开了 Cookie 库。运行面证据是完整包在隔离钥匙串里的启动实测。",
    evidence: "#1571",
    lines: 1,
  },
}

/**
 * **文本就是被守的产物**,或者「是锚但降级归别的票」。后者必须点名归谁 —— 写「以后再说」等于没写。
 * 选这张表不是零成本:`why` 与 `evidence` 的机械要求与上表完全相同,**而且**以 `.test.ts` 结尾的键
 * 必须登记进 `scripts/gate-files.tsv`(第 ⑤ 层机械校验)—— 这张表说它是真闸门,真闸门不许「删掉不红」。
 * `.cases.ts` 键豁免:它们不进整包计数,由第 ④ 层反向那半(每个 cases 文件必须被一个已登记宿主跑到)兜住。
 */
export const KEPT_SOURCE_TEXT_READS: Record<string, SourceTextEntry> = {
  "packages/ui-mac/src/main/codepuppy-root-retirement.test.ts": {
    why: "主语是负全称:运营源码树与写引导资源里不得重新出现已退休的全局根 sentinel / alias 与迁移、回退入口 —— 全树扫描的文本就是被守的产物。守不住:经变量拼出来的路径字面量、扫描目录之外新加的写者。原先第 3 处 index.ts 下标锚已随 ADR-0014 删除。",
    evidence: "#428",
    lines: 2,
  },
  "packages/ui-mac/src/main/recovery-wiring.test.ts": {
    why: "Recovery 窗口的安全开关是声明式配置的字面声明(独立 preload、contextIsolation / sandbox 开、nodeIntegration / webviewTag 关),加上负全称与唯一性(启动 DbSafety 分支里没有原生弹窗、渲染层 Recovery 恰好一个挂载点)。守不住:运行时再改写 webPreferences、经别名调用 dialog。原先三条 index.ts 顺序锚已随 ADR-0014 删除。",
    evidence: "#445",
    lines: 3,
  },
  "packages/ui-mac/src/main/config-injection-throat.test.ts": {
    why: "REQ-157 #1305 ui-mac 整份 config 咽喉的 drift 锁(#1299 的 agent 咽喉并入后同一份):判官把 agents.<name>.mode / agents.<name>.permissions[i].effect / 顶层 permissions[i].effect / policies[i].effect 槽里的值按引擎的声明式字面量(`#1667` 起读 OpenCode 2:packages/schema/src/permission.ts 的 Literals([\"allow\", \"deny\", \"ask\"])、packages/schema/src/config/agent.ts 的 Literals([\"subagent\", \"primary\", \"all\"])、packages/schema/src/config/policy.ts 的 Literals([\"allow\", \"deny\"]))判成动词,其余当成字点名。主语就是那三段字面量文本本身 —— 引擎哪天加一个动词而这里没跟,生产写出的合法新动词会被判官当成未登记的字(fail-closed,红而不是假绿),这三行读取让「没跟上」在引擎源码改动的同一次 diff 里就红。路径字面量必须与读调用同一行(#1304 踩过:放进 const 让本层谓词零命中)。守不住:引擎在别处又定义一套同义动词而这三处字面量不动 —— 那时判官仍按旧集合判,新动词照样被点名,仍是红。",
    evidence: "#1305",
    lines: 3,
  },
  "packages/ui-mac/src/main/boot-dangling-onboarding-wiring.test.ts": {
    why: "主语是负全称加唯一性:index.ts 每个 `if (!TEST_ONBOARDING)` 块不得包含 boot dangling sweep;REQ-059/065/104 与 ecosystem gate 必须仍在该守卫内;runBootDanglingSweep 恰好一次且排在首个 spawnLocalServer 之前。index.ts 结构上进不了 bun,这份布局就是接线契约。删掉 sweep 调用会由 boot-dangling-sweep.test.ts 的可执行闸变红,本条守的是「调用点不在 skip 里」。第 2 处(#1036,REQ-053 A2)锚 bootEnforcementGap 分支里 TEST_ONBOARDING 早退(app.exit(1))先于 dialog.showErrorBox 的下标先后 —— 按本分类法它是位置锚:把早退包进恒假条件、或把 app.exit(1) 换成只写日志,被比的文本仍在,断言照绿;A2 的行为真相在打包 VERIFY(#1034)。文件主判据仍是上面的负全称+唯一性文本闸,照 websearch-copies 先例如实登记混合、不整体降级(整体降级会把 #1031 那道真文本闸一并逐出 gate-files.tsv 的删除保护)。",
    evidence: "#1031",
    lines: 2,
  },
  "packages/ui-mac/src/main/codepuppy-environment.test.ts": {
    why: "两处在同一条 grep 守卫里:main 侧 handler 必须零参数、preload 侧 invoke 必须不带参数,且两侧都**不得**出现任何环境写面通道名。主语是负全称(「不存在第二个写面」)—— 没有比源码文本更细的粒度能表达「全仓没有」。",
    evidence: "#239",
    lines: 2,
  },
  "packages/ui-mac/src/main/brand-guard.test.ts": {
    why: "ac#1160 REQ-139 品牌守卫,两半主语都是文本本身:①AC5 身份面五组字面量(APP_IDS/APP_NAMES+setName/bundle id/更新 feed/URL schemes+CLIENT_ID)的**逐字冻结** —— 被守的正是「声明文本一个字符都没变」(变了 = 钥匙串项名/userData 目录/OAuth wire 标识换名,存量破坏),值断言表达不了「连写法都不许动」;index.ts/electron-builder.config.ts 在 bun 侧也结构上 import 不了。②AC1/AC3 展示面有限坐标清单的声明式字面量(productName/i18n 品牌键/窗口标题/提示词 to 串),以及 REQ-148 的安装器协议描述、钥匙串清理指引、生态迁移对话框与扩展工具说明,逐点断言只展示 Code Puppy —— 显示串就是声明,文本即产物。守不住:文本在而消费链断掉(如 wordmark 键没人读)不红,那一半由 L2 packaged 视觉取证(REQ-139 VERIFY 票)兜。第 25 处([ac#1198])是同型展示面文本闸:zht.ts updater 两句的值断言(REQ-139 zht 漏网,与 zh/en 同句同型);REQ-148 新增四处同型文本读取,精确计数随之升至 29。第 30 处([ac#1211])是安装器展示名文本闸:install-local.ts 的 PRODUCT_NAMES 声明与 Cmd+Space 提示逐字断言,配同形态负断言堵旧名 —— 该脚本只在本机装机路径上跑,不进发布件,值断言够不着它(没有可 import 的运行时导出),而装出来的 bundle 名一旦回退旧名,Finder/Spotlight 里就又叫 alpha-code。守不住:脚本文本对而 electron-builder 的 productName 另行漂移不红,那一半由本文件既有的 AC5 身份面冻结兜。第 31 处([ac#1299])是 AC3 自动化执行器 prompt 那条的坐标搬家:三个 alpha agent 的 prompt/description 从 codepuppy-config-injection.ts 抽进零依赖的 codepuppy-agents.ts(登记簿 import 它),原来的 2 处计数改读新文件,并加一条同形态负断言钉住生产文件里 0 处 —— 主语仍是「品牌串住在哪份文本里」,与既有 AC3 各条同型。[ac#1321] 减 1 处(31 → 30):REQ-138 的 shell-sandbox.ts 连同它 deny stub 里那句 `Code Puppy: shell sandbox unavailable` 一起拆掉了(围栏上移到引擎进程,装不上是引擎不起而不是一条 shell 提示),那一处品牌串读取随文件消失,不是漏掉。",
    evidence: "#1160",
    lines: 30,
  },
  "packages/ui-mac/src/main/catalog-channels.test.ts": {
    why: "ac#1132 AC2 域名棘轮:主语是声明本身与负全称 —— catalog-channels.ts 的 CHANNEL_BASE_URL 声明必须逐字是新域字面量,且不得存在旧域声明。值断言(toBe)骗得过「常量对、声明被第二处覆盖」这类漂移,声明文本正是正确粒度。同测试对两个 sync 脚本的负全称(.mjs 读取,不在本谓词命中集内)属同一条棘轮。守不住:base 若改由运行时拼装绕开该常量,文本闸不红 —— 那一半由同文件的值断言与 remote-catalog.test.ts 的独立字面量兜住。",
    evidence: "#1132",
    lines: 1,
  },
  "packages/ui-mac/src/main/cloud-mcp-auth-sweep.test.ts": {
    why: "#1196(REQ-144 T3)退役 ratchet,主语是**负全称**:ui-mac main 对 inflight 闸零引用、引擎 authenticate 路径对 inflight 标记零引用、CIMD 常量零复活 —— 票面退出条件逐字就是「cloud 路径上零引用」,源码文本正是正确粒度;每个被扫文件带一条已知在场符号的正样本自证手段没失灵(读错文件/空串时正样本先红)。守不住:同语义换名复活(换个符号名重写 inflight 闸)不红 —— 那是新代码新审,不是残留回流。",
    evidence: "#1196",
    lines: 3,
  },
  "packages/ui-mac/src/main/ext-cas-gc-scheduler.test.ts": {
    why: "断言的是 electron.vite.config.ts 自己的**声明**(worker 第三入口)。配置文件的文本就是产物,不是行为的替身;bun 侧跑不了 electron-vite。残余:声明在而打包产物仍缺入口时本条不红 —— 那是打包级事实,本仓没有那道门。",
    evidence: "#367",
    lines: 1,
  },
  "packages/ui-mac/src/main/ext-security-boundaries.test.ts": {
    why: "五处全部是负全称 / 唯一性:preload 的 import 说明符集合、exposeInMainWorld 恰好一次、窗口硬化三个开关、隔离预览 host 零 bridge、只读通道名在全 main 树里恰好出现在一个文件。「全仓没有第二处」结构上只能对文本断言。",
    evidence: "#494",
    lines: 5,
  },
  "packages/ui-mac/src/main/sidecar-env.test.ts": {
    why: "三处都从 sidecar-env.ts 的源码里**解析出 ALLOW / DENY 清单**,再拿这份清单去驱动真的 createSidecarEnv(或断言成员形状:没有凭据名、全小写)。被守的是那份源码声明的清单本身,文本就是产物;而行为半场是真执行,不是文本比较。",
    evidence: "#639",
    lines: 3,
  },
  "packages/ui-mac/src/main/websearch-copies.test.ts": {
    why: "10 处里 6 处是普查 / 负全称 / 跨包逐字一致(文本即产物);另 4 条是位置锚(闸是出网出口的第一句等)。这 4 条按本票分类法是减速带,但目标模块都是**可 import 的**,换真判据做得到 —— 而这份文件的 describe 自称 #223 R4 主判据,降不降级是那份已批基线的题目,不是本票的边界。如实登记为已知减速带,裁决在 #985。`#1662` I-09:v1 两条传输与普查网随 OpenCode 2 换代退役,剩 9 处(跨包逐字一致与 ext 钩子 / transform 的位置锚)。`#1698` G2:信道名随启动文档退役,「跨包逐字一致」改判两条腿读同一个 killSwitch 与唯一核验源,「DEF / ARM 分支」一条换成行为判据退役,剩 6 处。",
    evidence: "#985",
    lines: 6,
  },
  "packages/ui-mac/src/main/naming-migration-wiring.test.ts": {
    why: "主语是 index.ts 里升级迁移两段的**调用顺序**:A 段在 requestSingleInstanceLock 之后、preferAppEnv 之前,会话库一步在 preferAppEnv 之后、首个 yield* 之前,完成标记之前不出现 initEndpoints / getStore / safeStorage;失败分支只许 dialog.showErrorBox + app.exit(1)。index.ts 结构上进不了 bun,用 TypeScript AST 按源码位置判先后 —— 迁移本身的行为由 naming-migration 的行为测试真跑。守不住:把调用包进恒假条件、或把返回值丢掉,位置不变,断言照绿。",
    evidence: "#1569",
    lines: 1,
  },
}
