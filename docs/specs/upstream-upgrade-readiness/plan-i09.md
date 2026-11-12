---
id: PLAN-upstream-upgrade-readiness-i09
title: 检查登记表自动对账 实施计划
summary: INT-upstream-upgrade-readiness I-09 的两段计划:旧名例外登记表改按内容定位(不再按行号);闸门文件登记簿的写回模式能处理已删文件,并把本分支的两道登记闸带回全绿
kind: plan
status: active
spec: ""
design: ""
owners: [alpha-code desktop maintainers]
last_reviewed: 2026-11-12
---

# PLAN-upstream-upgrade-readiness-i09｜检查登记表自动对账 实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。每个交付段一节;决定只链接、不重述;实施中偏离本段,在同一个提交里改本段。

两段都基于 `lane/1662-i09-registries` @ `18ea8a2b1c`(= `lane/1662-int2a`)。在这个基点上量到的现状:

- `packages/ui-mac/src/main/old-name-scan.test.ts`:5 pass / 2 fail。方向 A 有 459 处未登记,方向 B 有 88 条僵尸。
- `packages/ui-mac/src/main/gate-file-registry.test.ts`:18 pass / 4 fail。17 行登记指向已删文件;`packages/ext/src/plugin-process-singleton.test.ts` 起了嵌套 `bun test` 却没登记;引用绊线有 7 处没分类(提到的都是 `plugin-host.test.ts` 和 `plugin-process-singleton.test.ts`);`REFERENCED_BUT_UNREGISTERED` 里有一条指向已删的 `packages/opencode/test/tool/codepuppy-mcp-websearch-gate.test.ts`。
- 三组 v1 websearch 基线红:`websearch-copies.test.ts` 7 fail、`cloud-web-search.test.ts` 3 fail、`server.test.ts` 的 `#1411` 1 fail。断言对象都是已删的 v1 源文件。

## 段 1 — 旧名登记表按内容定位

- 依据:无 spec、无 design。owner 2026-11-12 批准 I-09(U-04「同意，I-09 检查登记表自动对账也做」),见 alpha-work `docs/intents/INT-upstream-upgrade-readiness.md` I-09;Issue impharaon/alpha-code#1662;派发书 AC1、AC3(旧名半)。
- 核对:<实施轮第一次提交时按 resume brief 的 `Phase:` 行填写>

### 本段的局部选择(派发书留给计划决定)

- **一条命中的身份 = 文件 + 这一行里的旧名词元**。词元的取法:正则每次命中后,把命中处向两侧扩展到 `[A-Za-z0-9_.\-@/:]` 的最大连续段(例如 `--v2-alpha-dark-8`、`alpha-code`、`jinjunnn/alpha-code`、`@opencode/plugin/alpha-cloud-authority`)。同一行的词元去重,按出现顺序用空格连接。文件名这一层的命中用固定标记 `文件名`;它是汉字,词元字符类里不可能出现,不会和内容命中撞键。
- **登记行**五列:`<文件> ⇥ <命中词元> ⇥ <处数> ⇥ <类别> ⇥ <理由>`。判官对每个 `(文件, 命中词元)` 把所有登记行的处数加起来,和扫描到的行数比:实测多于登记 ⇒ 方向 A 红,实测少于登记 ⇒ 方向 B 红。`(文件, 命中词元, 类别)` 不许重复。同一个键允许挂不同类别(基点上实测有 2 个这样的键)。
- 为什么不用整行文本或哈希当键:`scripts/gate-files.tsv` 自己也在扫描面里,它的行里同时有旧名和条数列。按整行定位的话,`assert-gate-files.sh --update` 写回一次条数,旧名登记就跟着失效,等于把两张表重新耦在一起。按词元定位,条数怎么变都不影响旧名登记。
- 在基点上的探针结果(临时脚本,没进仓):1121 行旧登记映射到 1000 个不同的键;没有一条命中抽不出词元;词元长于 200 字符的键只有 1 个。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/main/old-name-scan.ts`(新) | 只放两样东西:旧名判据 `OLD_NAME`(连同它的抬头注释,从判官原样搬过来)和 `hitTokens(line)`。判官和换算脚本都从这里取,判据不复制第二份。这个文件自己的旧名字面量按 `retired-guard` 登记。 |
| `packages/ui-mac/src/main/old-name-scan.test.ts` | 从新模块导入判据。登记表解析改成五列。两个方向抽成一个纯函数 `compareHits(hits, rows) → { unregistered, stale }`,真树和下面的反例用的是同一个函数。逐文件扫描抽成 `fileHits(path, text)`,让「前面插 7 行」这个反例走生产扫描路径。新增三条用例:方向 A 反例(真文件内容里多插一行新旧名 ⇒ 点名)、方向 B 反例(登记了一处真树上不存在的命中 ⇒ 点名)、回归反例(给一个登记在册的真文件前面插 7 行 ⇒ 零未登记、零僵尸)。抬头里「行号随增删漂移…」那段改成新规则。 |
| `scripts/old-name-exceptions.tsv` | 换成五列格式,抬头同步。然后补登记、删僵尸(见「顺序」第 3 步)。 |
| `scripts/old-name-exceptions-convert.ts`(一次性) | 读旧表,把每一行解析成键:先看工作树里第 N 行是不是命中;不是,就用 `git blame` 找到写下这一行登记的提交 C,取 `git show C:<文件>` 的第 N 行。哪一行都解析不出来就整体失败并列出来。按 `(文件, 命中词元, 类别, 理由)` 聚合处数后写出新表,同时打印对账报告。在换算提交里入仓(证据可以复现),本段最后一次提交里删掉。 |
| `packages/ui-mac/src/main/naming-migration-wiring.test.ts` | R8 的 `keptOldValueLines` 现在按旧表第 2 列的行号去源文件取行。改成读新表非 `pending` 行的命中词元,判「这个值恰好是某个词元」。原来的对照臂(空登记 ⇒ 点名 `alpha-keychain`)不变。它是这张表格式的另一个消费方,属于同一条调用链,不改就会读错列。 |

`bin/check-light` 和 `scripts/docs-gates.sh` 不在本分支上。本地 `origin/alpha` 版本里两者都没有读这两张表,所以本段预计不需要动它们;整合时如果 alpha 上已经读了,在回执里写明需要改的地方,不在本线编辑。

### 顺序

1. **换算(只改格式,不改覆盖)**:新模块、判官改五列、一次性换算脚本、换算后的表、`naming-migration-wiring.test.ts`,一起提交。跑 `packages/ui-mac` 的 `bun test src/main/old-name-scan.test.ts src/main/naming-migration-wiring.test.ts`。预期:A 和 B 还红,但只剩真实变化;探针给出的数字是 A 377 / B 6。提交信息里写对账报告(见「证明」AC1-等价)。
2. **反例**:三条新用例,加上下面的变异实测。跑同一条命令。
3. **补登记到全绿**:377 处新命中按命名规范 §5 的类别登记。主体是 #1668 恢复到 Code Puppy 路径下的前端包(`codepuppy-ui` / `codepuppy-app` / `codepuppy-session-ui`),约 350 处,主要是上游 OpenCode 的 `--v2-alpha-*` 颜色变量和 stories 里的 `Alpha` 示例值,归 `upstream`;其余大多是 `alpha-code#…` 这类仓库名,归 `external-anchor`。6 条僵尸都是那一行内容改过了(例如 `cloud-websearch-kill.ts` 的 import 路径从 `@opencode-ai/plugin/…` 改成了 `@opencode/plugin/…`)。逐条确认新内容后删旧行,新键按原类别和理由补上。产品代码不改。凡是我判断「这是 Code Puppy 自己的名字、本该改名」的命中(例如 `codepuppy-app` 注释里的 `Alpha typed surface seam`),只有能指到在途接手票时才登 `pending`;指不到就在回执里列出来,不硬塞进 `historical`。删换算脚本。跑同一条命令,目标 7+3 条全绿,`naming-migration-wiring` 全绿。
4. 段 2 会改 `scripts/gate-files.tsv` 里带旧名的行,所以段 2 每次提交前都重跑一次旧名判官,处数随之调整(写在段 2 的顺序里)。

### 风险

- **一个文件里同一词元的行数变了**,比如新加一行 `--v2-alpha-dark-8`:方向 A 照样红,要把处数加一。这是有意的:新写进来的旧名必须过一次人眼。和按行号相比,插入、删除不相干的行不再触发任何东西。
- **键变粗以后会不会漏**:同一文件、同一词元的两行可以互换位置而不被发现。两行理由相同,这种互换不改变任何一处该不该留,所以接受。词元里包含完整的扩展段,`alpha-dark` 和 `alpha-docs` 是两个不同的键。
- **blame 解析依赖历史上的登记者当时是对的**。换算脚本对每一条 blame 解析都要求那一行在提交 C 上确实命中旧名,不命中就失败,不猜。探针在基点上 88/88 解析成功。
- 换算会把 1121 行改成大约 1000 行,diff 很大。用对账报告加「同一棵树上新旧判官结论之差恰好等于漂移」来证明没丢东西,不靠人逐行读。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC1-等价 | 换算报告(写进第 1 步的提交信息):旧表 1121 行全部解析成功,其中 1033 行在工作树上直接解析、88 行经 blame 解析,0 行失败。在同一棵树上,旧判官 A 459 / B 88,新判官 A 377 / B 6。差值逐条对上:82 处命中原来因为行号漂移被判未登记,现在被覆盖;6 条是内容改过的行,两边都判僵尸。另外断言旧判官判为已登记的每一处命中,新判官也判为已登记(旧覆盖 ⊆ 新覆盖)。 | 换算丢行或错配的话,解析会失败,或者「旧覆盖 ⊆ 新覆盖」不成立,报告会点名具体是哪一行。 |
| AC1-方向 A | `old-name-scan.test.ts` 新用例「方向 A 反例」;变异实测:往 `docs/runbooks/ci.md` 加一行 `alpha-foo`,真判官方向 A 点名这一行,然后 `git restore`。 | 判官如果按 `(文件)` 或词元前缀之类更粗的键匹配,新行会被已有登记吸收,用例变绿,也就失败不了。 |
| AC1-方向 B | 新用例「方向 B 反例」;变异实测:删掉一处登记过的命中(改真文件),真判官方向 B 点名对应的登记行,然后 `git restore`。 | 不比较处数(只看键在不在)的话,同一个键少一处不会被发现。 |
| AC1-回归 | 新用例「前面插 7 行」走 `fileHits` + `compareHits`;变异实测:真的给 `docs/runbooks/ci.md` 前面插 7 行,跑真判官仍然全绿,然后 `git restore`。同一操作在基点 `18ea8a2b1c` 的旧判官下会红(在回执里给出对照输出)。 | 键里只要还含行号,这条用例就会把 7 行之后的每一处都报成「未登记 + 僵尸」。 |
| AC3(旧名) | `bun test src/main/old-name-scan.test.ts` 0 fail,`bun test src/main/naming-migration-wiring.test.ts` 0 fail。 | — |

### 偏离记录

暂无

## 段 2 — 闸门文件登记簿对账

- 依据:同段 1;派发书 AC2、AC3(闸门半)。
- 核对:<同上>

### AC2 选型:(a) 保留精确条数,扩展已有的 `--update`

`scripts/assert-gate-files.sh --update` 已经存在(`#844`)。它从实测写回条数,all-or-nothing。缺的只有两样:遇到已删文件时它在第一条就中止(文件匹配 0 个 ⇒ 测试失败);写回后不打印 diff。本段只补这两样,不新开模式。

各条保证在两个选项下的去留:

| 保证(出处) | (a) 精确条数 + `--update` | (b) 条数增加不必改表(例如下界自动抬升或按测试名登记) |
| --- | --- | --- |
| G1 闸门文件消失 ⇒ 红(`assert-gate-files.sh` 抬头、`gate-file-registry.test.ts`「登记簿里的每个文件都真的存在」) | 保留:检查模式不变;`--update` 只在门外由人跑 | 保留 |
| G2 用例被删、清空或 skip ⇒ 少于登记 ⇒ 红(`bun-test-floor.sh` 精确模式) | 保留 | 保留 |
| G3 新增用例没登记 ⇒ 多于登记 ⇒ 红(`#844`:没登记的用例以后可以被静默删掉) | 保留 | **丢**:条数只增不报,新用例重新进入「可被静默删除」的状态,也就是 `#844` 修掉的那一类 |
| G4 路径过滤恰好命中 1 个文件(`bun-test-floor.sh` `#844` R2) | 保留 | 保留 |
| G5 平台条件行在不适用平台自报 0 条(`#1153`) | 保留 | 保留 |
| G6 登记簿完备性:委派闭合、宿主必须登记、引用必须分类(`gate-file-registry.test.ts` ①–⑤) | 保留 | 保留 |

选 (a)。要不丢 G3,条数增加就必须有人确认;(a) 把确认的成本压成一条命令加读一次 diff。改表依然要改,但不用手改。

`--update` 的补充行为:

1. 先扫一遍所有行,找出测试文件已不在盘上的行。对每一行,要求登记簿里有一条注释行同时包含 `退役` 和 `<工作目录>/<路径>`。lanes 已经在用这个格式,例如第 194、204、350 行。有这样一条注释,这一行就在写回时删掉;没有,`--update` 一次性列出所有缺注释的行,给出注释格式,然后中止,一行都不写回。退役的理由由人写、评审读;工具不替人写理由。
2. 写回后,用 `diff -u` 打印新旧登记簿的差异。
3. 其余不变:测试红仍然整体中止,`>=N` 例外行不改写,平台行在不适用平台只验证。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `scripts/assert-gate-files.sh` | 上面「补充行为」第 1、2 条;`usage` 同步说明。检查模式一个字节都不动。 |
| `packages/ui-mac/src/main/gate-file-registry.test.ts` | ① `REFERENCED_BUT_UNREGISTERED` 删掉已删文件那一条,理由写进退役注释。② 新增一组 `--update` 用例:把 `assert-gate-files.sh` 和 `bun-test-floor.sh` 复制进临时目录,配一份 25 行的小登记簿(脚本要求至少 25 行),每行对应一个只有一条用例的小测试文件。三个臂:删一个文件且没写退役注释 ⇒ 退出 1,登记簿不变;写了注释 ⇒ 那一行被删、打印 diff、退出 0;同一状态下检查模式仍然退出 1(G1)。这组用例不起 `process.execPath test` 形状的子进程,第 ④ 层不会误判它为宿主。本文件自己的条数随之写回。 |
| `scripts/gate-files.tsv` | 17 行已删文件改成退役注释,每条写替代测试或记录在案的理由(见「顺序」第 2 步);受托列里指向这些文件的地方改指替代测试,没有替代的改 `-` 并写原因(`websearch-copies`、`stream-read-hygiene`、`reload-scheduler` 三行)。新登记 `packages/ext/src/plugin-process-singleton.test.ts`(嵌套宿主),`packages/ext/src/plugin-host.test.ts` 按 ①–③ 的判据登记或进 `NOT_GATES`。改过的行和 `north-star-guard.test.ts`(36 → 37)的条数用 `bun-test-floor.sh` 逐行实测后写回。抬头说明 `--update` 的退役行为。 |
| `packages/ui-mac/src/main/websearch-copies.test.ts`、`packages/ui-mac/src/main/cloud-web-search.test.ts`、`packages/ui-mac/src/main/server.test.ts`(`#1411` 那一条) | **派发书 AC3 隐含,但不在 Scope 的文件清单里,请核对时确认。** 这 11 条红的断言对象都是已删的 v1 源文件。逐条找 L3 的 2.x 替代(候选:`packages/ext/src/cloud-websearch-kill.test.ts`,`#1665`;以及 `packages/core/test` 里的 websearch 测试)。找到替代或有记录在案的理由,才删这条用例,并在 `gate-files.tsv` 写退役注释;找不到替代的真实行为,原样保留(仍然是红的)并在回执里列出,不删。 |
| `docs/runbooks/ci.md` | 「闸门文件点名」那一节补一句:`--update` 怎样处理已删文件,以及退役注释的格式。 |

### 顺序

1. **`--update` 补充行为 + 它的用例**:`assert-gate-files.sh`、`gate-file-registry.test.ts` 里的新用例和 `REFERENCED_BUT_UNREGISTERED` 那一条、`ci.md`,一起提交。跑 `packages/ui-mac` 的 `bun test src/main/gate-file-registry.test.ts`。新用例要全绿;原来的 4 条红此时还在。反向臂:去掉「必须有退役注释」的判断,「没写注释」那一臂必须变红,然后 `git restore`。
2. **登记簿清账**:17 条退役注释。替代测试按出处在 lanes 的记录里找:L3 `#1665` 的 ext 测试;L4 `#1666`(`packages/ext/src/policy/*.test.ts`、`packages/core/test/codepuppy-*.test.ts`,已有退役注释的格式照抄);L5 `#1667`(第 100–104 行一带,例如 `naming-before-v1-conversion.test.ts`、`sidecar-env-otel.test.ts`)。另外是受托列、嵌套宿主、引用分类、`north-star-guard` 条数。跑 `bun test src/main/gate-file-registry.test.ts`,目标 0 fail;改过条数的行逐行 `bash scripts/bun-test-floor.sh =<N> <工作目录> <路径>`;再跑一次 `bun test src/main/old-name-scan.test.ts`,因为 `gate-files.tsv` 的旧名行变了,要调整处数后再提交。
3. **三组 websearch**:逐条处置(替代 + 退役 / 保留 + 列出),相关行的条数逐行实测后写回。跑三个测试文件、`gate-file-registry.test.ts` 和 `old-name-scan.test.ts`。

不跑完整的 `assert-gate-files.sh`(无论带不带 `--update`):它会逐个跑 380 多个闸门文件,等于一次门。其它行有没有条数漂移,由 ship 的整门暴露;修法是那时跑一次 `--update`。到那时已删文件都已退役,`--update` 能跑通;唯一的前提是第 3 步里保留下来的红已经由编排器处置。

### 风险

- **找不到替代**:已删文件那 17 行,如果既找不到替代也给不出记录在案的理由,`gate-file-registry` 就到不了 0 fail。这种情况下那几行保持不动,回 `PARTIAL: AC3` 并列出缺什么。三组 websearch 里保留的红不影响 `gate-file-registry`,但会让 ship 的整门在那三行红。这一点在回执第一行写明。
- **临时目录里的用例**:跑 25 次 `bun test` 会增加本文件的运行时间,预计每个小文件 0.1–0.3 秒,合计 10 秒以内,实施时实测。如果明显更慢,把这组用例缩到最少的臂,不加任何开关。
- **段间耦合**:`gate-files.tsv` 在旧名扫描面里。第 2、3 步每次提交前都重跑旧名判官(已写进顺序)。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC2 | 上面的选型表(每个选项保留哪些保证);`gate-file-registry.test.ts` 新增的 `--update` 三臂。 | 去掉退役注释的判断,「没写注释」臂会看到行被删、退出 0,断言失败;检查模式如果被改成跳过已删文件,G1 臂会失败。 |
| AC3(闸门) | `bun test src/main/gate-file-registry.test.ts` 0 fail;每一行改过条数的 `bun-test-floor.sh =N` 输出;17 条退役注释和 websearch 处置清单(替代测试的路径加用例名,或理由)。 | — |

### 偏离记录

暂无
