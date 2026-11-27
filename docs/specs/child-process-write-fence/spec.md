---
id: SPEC-child-process-write-fence
title: 连接器与语言服务的子进程也受写入范围约束
summary: 连接器与语言服务的子进程也受写入范围约束；用户亲手打开的项目当场可写、不重启引擎（v2）；包管理器安装依赖、批准过的项目外文件夹、全局安装与用户级配置文件在围栏下可用（v4）；命令运行中被拦下、报错写出了被拦位置的写入，事后弹出同一张批准卡（v7）；直接在主目录下新建的那一个文件夹或文件可经同一张卡批准（v8）；保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 8
approved_by: owner
approved_at: 2026-11-27
owners: [owner]
last_reviewed: 2026-11-27
---

# 连接器与语言服务的子进程也受写入范围约束

连接器与语言服务的子进程也受写入范围约束。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-safety/I-06](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-safety.md#意图点)。
- 历史身份：[impharaon/alpha-code#1286](https://github.com/impharaon/alpha-code/issues/1286)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/142)。
- [有效范围或验收依据 2026-09-10](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5612150393)。
- [有效范围或验收依据 2026-09-10](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613792565)。
- [有效范围或验收依据 2026-09-10](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309)。
- v2 增量「用户亲手打开的项目当场可写」的来源是 owner 2026-11-19 的原话（本会话，逐字）：
  - 关于现状（引擎启动后才打开的项目在重启前只读，标题栏「只读」带「重新启动」按钮）：「这个是什么意思啊，这个交互逻辑我觉得有点乱。我希望可以尽量用户无感。不能因为一个文档生成要重启一次引擎吧。」
  - 关于两条路（第一条：空闲时后台换引擎；第二条：用户亲手打开的项目当场可写、完全不重启；两条都只认用户本人的操作，模型自己不能借此扩大可写范围）：「如果第二条可行，就选第二条，这样才是真正的无感，好的，如果这样我觉得可以。」
- v4 增量的来源：impharaon/alpha-work `docs/intents/INT-safety.md` I-45 与 I-23。owner 2026-11-25 原话：「还有一些安装依赖包的命令是否都应该被纳入 全部批准档。」（U-31）；对「全局安装（brew、-g、go install 等）是否在「全部批准」档放开」答「放开」，对包管理器缓存修复、批准过的项目外文件夹可写等四项答「可以，形成规格。」（U-33）；对用户级配置文件答「一并放开，还需要考虑 windows 系统，现在没发 windows 包后续是需要发的。」，对两份规格答「批准。」（U-34）。事实与实测见同仓 `docs/intents/discussions/INT-safety.md`「2026-11-25 续」一节。
- v7 增量的来源：impharaon/alpha-work `docs/intents/INT-safety.md` I-55，owner 2026-11-27（U-44）。owner 先问：「被围栏栏住是否应该弹批准卡，用户批准，是否可以不被拦，当前是否有这样的需求。」随后：「它登记成一条待决条目（INT-safety I-55）登记为批准」。I-55 的做法：被拦后如果应用能确定被拦的是哪个文件夹，就弹出与 BR-08 相同的批准卡，用户批准后该文件夹当场可写、助手重试这条命令；确定不了位置的保留原来那句说明；主目录本身、Code Puppy 数据目录、受保护位置仍不能批准。I-55 写明的代价之一是「需要先确认能从系统沙箱的拒绝记录可靠认出路径」：实测这份记录会静默漏条，还要求管理员账户（同目录 design.md 的 v6 增量 §2），因此「能确定位置」指命令的报错写出了被拦位置的完整路径。
- v8 增量的来源：impharaon/alpha-work `docs/intents/INT-safety.md` I-56，[owner 2026-11-27（U-46）](https://github.com/impharaon/alpha-work/blob/93b7f86ba10b319bf832a8125f2998acfa215e47/docs/intents/originals/INT-safety.chat.md#u-46)。向 owner 提的问题（原文）：「I-56：助手要在你的主目录里直接新建一个文件夹或文件时（比如 ~/newfolder、~/note.txt），现在会被拦下，只显示一句说明、没有批准按钮，因为整个主目录规定不能放行。要不要让批准卡只放行这一个新文件夹或文件？主目录的其他位置仍然写不进去。」owner 选「放行这一个（推荐）」，选项说明原文：「批准卡只放行这一个新文件夹或文件，其他位置照旧不能写。代价是围栏多支持一种「只放行一个新路径」的范围。」

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。v4 不包括：主目录里清单之外的其它位置的写入。v7 只覆盖助手运行的命令；应用内终端里用户自己运行的命令，以及连接器、语言服务子进程被拦下时，仍按 BR-06。v8 只覆盖直接位于主目录下、此刻还不存在的那一个路径；主目录里已经存在的文件或文件夹本身不在内。
- v4 在 Windows 上：Windows 没有写入围栏（AC-04 的平台边界不变），BR-07 至 BR-10 涉及的位置本来就能写。本增量在 Windows 上要求的是权限档的行为一致：「全部批准」档不询问，「请求审批」档先问。Windows 包发布时按此验收。依据 owner 2026-11-25「还需要考虑 windows 系统」。（v7）BR-11 在 Windows 上不适用：没有围栏，就没有运行中被围栏拦下的写入。（v8）BR-08 的 v8 句在 Windows 上同样不适用：没有围栏，主目录下本来就能写。
- 有效范围与证据限制：AC1 逐通路清单形态已由 owner 选定的进程树继承围栏替代；LSP 由创建原语结构等价证明，非真实语言服务器实跑；非 darwin 不宣称已启用围栏。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:github/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/github/index.ts)
  - [alpha-code:packages/app/e2e/utils/visual-stability/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/e2e/utils/visual-stability/index.ts)
  - [alpha-code:packages/app/src/components/session/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/components/session/index.ts)
  - [alpha-code:packages/app/src/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/index.ts)
  - [alpha-code:packages/app/src/pages/session/composer/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/pages/session/composer/index.ts)
  - [alpha-code:packages/app/src/utils/server.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/utils/server.ts)
  - [alpha-code:packages/cli/src/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/cli/src/index.ts)
  - [alpha-code:packages/client/src/generated-effect/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/client/src/generated-effect/index.ts)

## 业务规则

- **BR-01** 「工具/引擎派生的进程真正落盘」的通路被枚举成一份**单一权威**(不是散文清单);每条通路要么经围栏,要么在闸上被显式点名为已知豁免并写明理由。新增一条未登记的派生通路 ⇒ 闸红。
- **BR-02** MCP stdio 派生的进程越界写入失败,而不是静默成功。
- **BR-03**（v2）用户亲手打开的项目当场可写：经「打开项目」选中、或在应用里进入的项目，助手、终端和连接器子进程立即能写入；不重启引擎、不重启应用、不打断其它对话。
- **BR-04**（v2）常规路径上不出现「只读」标记，全应用没有「重新启动 Code Puppy」按钮。
- **BR-05**（v2；v4 修订）只有用户本人的动作能扩大可写范围：打开项目，或在批准卡片上批准「访问项目以外的文件夹」（v4 增加后一种，见 BR-08）；模型、对话里的命令、连接器进程和外部链接都扩大不了。
- **BR-06**（v2）仍然写不进去的情形，各用一句白话说明原因，不带按钮。（v7）助手运行的命令中途被拦、且能确定被拦文件夹的情形改按 BR-11。
- **BR-07**（v4）在用户打开的项目里用包管理器安装依赖不被围栏拦下：bun、pnpm、yarn、npm、pip（虚拟环境）、uv、cargo、go 都能装成功。它们的缓存写在 Code Puppy 自己的数据目录里，不写用户主目录里这些工具原有的缓存 —— INT-safety I-45（U-31、U-33）。（v6）cargo 例外：cargo 用它平常的 `~/.cargo` 缓存与锁，用户的 Cargo 配置、镜像与凭据照常生效（把配置挪到应用目录会改变配置里相对路径的含义，实测 Cargo 1.100）—— impharaon/alpha-work INT-safety U-40（owner 2026-11-27「Cargo 选 1，第二处引擎改动允许，Supabase 报告批准」）。
- **BR-08**（v4）用户在批准卡片上批准「访问项目以外的文件夹」之后，卡片上写明的那个文件夹当场可写，效果与 BR-03 相同。主目录本身、Code Puppy 的数据目录和受保护的配置位置仍然不行 —— INT-safety I-23、I-45（U-33）。（v8）助手要直接在主目录下新建一个文件夹或文件（这个路径此刻还不存在，例如 `~/newfolder`、`~/note.txt`）时，不论是写之前认出的（改文件工具），还是命令运行中被拦下的（BR-11），都弹出同一张「访问项目以外的文件夹」批准卡，卡上写明这个新路径；批准后只有它当场可写：新文件夹连同它里面的一切，或这一个文件，效果与上一句相同。主目录里已经存在的文件或文件夹本身（不是新建的）、主目录的其它位置、Code Puppy 的数据目录和受保护的位置照旧不能批准 —— INT-safety I-56（U-46）。
- **BR-09**（v4）全局安装可用：`brew install`、`npm install -g`、`pnpm add -g`、`yarn global add`、`bun add -g`、`pip install --user`、`go install`、`cargo install` 这一类命令要写的全局安装位置在围栏下可写。「全部批准」档下命令直接执行并成功；「请求审批」档下用户批准这条命令后成功；「只读」档不能运行命令，不变。可写的全局位置是一张随应用发布的固定清单，只含包管理器的安装目录，不含主目录里的其它位置 —— INT-safety I-45（U-33「放开」；「请求审批」档一条 owner U-34「接受」）。（v5）Homebrew 安装时会自己再套一层系统沙箱，在围栏里无法运行；命令允许运行后（「全部批准」档直接运行，「请求审批」档经用户批准后），应用替助手在围栏外运行这条 `brew` 命令 —— impharaon/alpha-work INT-safety U-38（owner 2026-11-26「好的。」）。
- **BR-10**（v4）用户级配置文件可写：shell 的启动脚本和常用开发工具的用户级配置（如 `~/.zshrc`、`~/.bashrc`、`~/.profile`、`~/.gitconfig`、`~/.npmrc`），以一张随应用发布的固定清单为准。「全部批准」档下命令和改文件工具直接写入、不询问；「请求审批」档下用户批准后写入；「只读」档不变。Code Puppy 与引擎自己的配置位置不在清单内，仍按 SPEC-engine-config-fence 保护；该规格 BR-06 的两处 shell 缓存仍不可写 —— INT-safety I-45（U-34「一并放开」）。
- **BR-11**（v7）助手运行的命令到一半才去写某个项目外的文件夹、被围栏拦下时，如果命令的报错写出了被拦位置的完整路径，命令结束后弹出与 BR-08 相同的「访问项目以外的文件夹」批准卡，写明被拦位置所在的文件夹；与 BR-08 一样，「请求审批」与「全部批准」两档都弹，「只读」档不能运行命令。用户批准后该文件夹当场可写，效果与 BR-08 相同；助手随即被告知可以重试，并被提醒命令前面的部分已经运行过一次、只重跑失败的部分；重跑的命令仍按当前档位处理（「全部批准」直接运行，「请求审批」照常先问这条命令）。用户拒绝时与拒绝 BR-08 的卡相同。被拦的位置在主目录本身（v8：直接在主目录下新建的那一个文件夹或文件除外，它按 BR-08 的 v8 句弹卡，卡上写明这个新路径本身）、Code Puppy 的数据目录或受保护的配置位置时不弹卡；报错没有写出被拦位置的完整路径时也不弹卡；这两种情形保持 BR-06 那句说明 —— INT-safety I-55（U-44）。

规则据下表原条款摘录（BR-03 至 BR-06 为 v2 新增，依据见「来源」的 owner 原话；BR-07 至 BR-10 与 BR-05 的修订为 v4 新增；BR-11 与 BR-06 的修订为 v7 新增；BR-08 的 v8 句与 BR-11 的 v8 修订为 v8 新增）；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 「工具/引擎派生的进程真正落盘」的通路被枚举成一份**单一权威**(不是散文清单);每条通路要么经围栏,要么在闸上被显式点名为已知豁免并写明理由。新增一条未登记的派生通路 ⇒ 闸红。<br>*将来拿什么证明*:枚举来源的判据测试 + 一条反向用例(新增未登记通路必须红)。 | [原票](https://github.com/impharaon/alpha-code/issues/1286) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309) |
| AC-02 | MCP stdio 派生的进程越界写入失败,而不是静默成功。<br>*将来拿什么证明*:正反两跑的真 `sandbox-exec` 语料(与 REQ-138 `#1076` 同形态)。 | [原票](https://github.com/impharaon/alpha-code/issues/1286) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309) |
| AC-03 | LSP 派生的进程同 AC2。 | [原票](https://github.com/impharaon/alpha-code/issues/1286) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309) |
| AC-04 | 平台边界如实声明:非 darwin 平台不假装有围栏,该状态在产品面可观察。<br>*将来拿什么证明*:平台分档的判据测试(`shell-sandbox.ts:191` 已有先例)。 | [原票](https://github.com/impharaon/alpha-code/issues/1286) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309) |
| AC-05 | Given 引擎已在运行、围栏在线，某文件夹不在本次引擎启动时的可写范围内；When 用户经「打开项目」选中它，或从项目列表、侧栏进入它或它的对话，然后让助手在里面写一个文件；Then 文件落盘，引擎进程没有换代、页面没有重载，另一个对话里正在进行的回答没有被取消；打开之前就开着的终端和已在运行的连接器子进程也能写进这个文件夹。<br>*将来拿什么证明*：真引擎、真围栏的测试；对照臂不放行时同一次写入失败且 0 落盘。 | owner 2026-11-19 原话（见「来源」）；BR-03 |
| AC-06 | Given AC-05 的路径；Then 界面上不出现「只读」胶囊与项目标签上的只读尾标，全应用没有「重新启动 Code Puppy」按钮。<br>*将来拿什么证明*：界面判据测试（两个只读钩子缺席、按钮不存在）。 | 同上；BR-04 |
| AC-07 | Given 围栏内由模型发起的进程；When 它试图自己扩大可写范围（伪造放行凭证、自己签发放行凭证、发外部链接让应用打开某个文件夹、向主进程发消息）；Then 目标文件夹仍然写不进，0 落盘。<br>*将来拿什么证明*：每种手段一条反向用例；去掉对应防护后该用例必须变红。 | 同上；BR-05 |
| AC-08 | Given 仍然写不进去的三种情形：主目录或 Code Puppy 自己的数据目录（v8：包括改写主目录里已经存在的文件；直接在主目录下新建的那一个文件夹或文件改按 AC-14 出批准卡）；不是用户亲手打开的文件夹（本次运行没有登记、也不在启动时的可写范围内，例如页面恢复出来而目录已被改写的对话）；放行失败；Then 各显示一句说明、没有按钮；第二种在用户用「打开项目」选中该文件夹后当场可写。<br>*将来拿什么证明*：三种情形各一条界面用例；第二种含「选中后可写」的后续步骤。外部链接（`codepuppy://open-project`）在当前界面没有消费者（v3 事实修订），因此不作为第二种的到达路径。 | 同上；BR-06 |
| AC-09 | Given 围栏在线，一个用户打开的项目；When 在助手的命令或应用内终端里分别用 bun、pnpm、yarn、npm、pip（虚拟环境）、uv、cargo、go 安装一个依赖；Then 各自成功，依赖落在项目里，用户主目录里这些工具原有的缓存目录没有新增或改动的文件（v6：cargo 除外，它写 `~/.cargo` 的缓存与锁，并按用户的 Cargo 配置解析相对路径、镜像与凭据）。<br>*将来拿什么证明*：真引擎、真围栏用例，每个工具一条；去掉本条做法的对照臂里 bun、go、cargo 三条失败（2026-11-25 的模拟实测已见）。 | INT-safety I-45；BR-07 |
| AC-10 | Given 「请求审批」或「全部批准」档，助手要写一个项目外的文件夹（不是主目录本身、数据目录或受保护位置）；When 批准卡片出现、用户点批准；Then 这次写入落盘，此后同一文件夹里的写入不再因围栏失败，引擎没有换代。When 用户拒绝；Then 0 落盘。When 批准不是用户本人点的（AC-07 列的各种手段）；Then 仍然写不进。<br>*将来拿什么证明*：真引擎、真围栏用例；不放行的对照臂里同一次写入失败。 | INT-safety I-23、I-45；BR-05、BR-08 |
| AC-11 | Given 围栏在线，「全部批准」档；When 用清单内的包管理器各做一次全局安装；Then 成功，没有批准卡片。Given 「请求审批」档；When 同一条命令；Then 先出现批准卡片，批准后成功，拒绝后 0 落盘。Given 任意档；When 命令要写主目录里不在清单上、也没有经 BR-03 或 BR-08 放行的位置；Then 仍然写不进。<br>*将来拿什么证明*：真引擎、真围栏用例；清单属于可写集合的单一权威（SPEC-tool-write-fence AC-02）；去掉清单的对照臂里全局安装失败。 | INT-safety I-45；BR-09 |
| AC-12 | Given 围栏在线，「全部批准」档；When 助手运行 `git config --global` 改一项设置，或用改文件工具往 shell 启动脚本里加一行；Then 都成功，没有批准卡片。Given 「请求审批」档；When 同样的操作；Then 先出现批准卡片，批准后成功，拒绝后文件不变。Given 任意档；When 写 Code Puppy 或引擎的配置位置；Then 仍被拒绝。<br>*将来拿什么证明*：真引擎、真围栏用例，用测试主目录里的替身文件；去掉清单的对照臂里写入失败。 | INT-safety I-45；BR-10 |
| AC-13 | Given 围栏在线，「请求审批」或「全部批准」档，一个用户打开的项目；When 助手运行一条命令，它先在项目里写一个文件，再往一个项目外的文件夹（不是主目录本身、Code Puppy 的数据目录或受保护位置）写文件而被围栏拦下，报错写出了被拦位置的完整路径；Then 命令结束后出现与 AC-10 相同的批准卡，写明这个文件夹。When 用户点批准；Then 该文件夹当场可写，引擎没有换代，助手被告知只重跑失败的部分并照做（「请求审批」档下重跑的命令照常先出现命令批准卡），这次写入落盘。When 用户拒绝；Then 该文件夹 0 落盘。Given 报错没有写出被拦位置的完整路径，或被拦的位置在主目录本身（v8：指主目录里已经存在的位置；直接在主目录下新建的见 AC-14）、数据目录或受保护位置；Then 没有批准卡，原来的处理不变（输出里有「operation not permitted」时，助手停下并说明哪个写入被拒）。<br>*将来拿什么证明*：真引擎、真围栏用例，至少用系统命令行工具与 Node 两种报错写法各跑一次批准臂；拒绝、未写出路径、主目录、受保护位置各一臂；去掉事后批准接线的对照臂里同一条命令没有批准卡、0 落盘。 | INT-safety I-55（U-44）；BR-11 |
| AC-14 | Given 围栏在线，「请求审批」或「全部批准」档，测试主目录里还没有 `newfolder` 与 `note.txt`，已有一个 `existing.txt`；When 助手运行 `mkdir ~/newfolder` 被围栏拦下；Then 命令结束后出现批准卡，写明 `~/newfolder`；When 用户点批准；Then 助手重跑 `mkdir ~/newfolder` 成功，随后在 `~/newfolder` 里建子文件夹、写文件都成功，引擎没有换代。When 助手运行 `echo hi > ~/note.txt` 被拦下，或用改文件工具写 `~/note.txt`；Then 出现批准卡，写明 `~/note.txt`，不写主目录；批准后这次写入落盘。When 这两个路径获准之后，助手往主目录里另一个新位置 `~/sibling.txt` 写；Then 这次写入仍被围栏拦下，没有落盘（它是另一个新路径，照同一规则另出一张卡）。When 用户在卡上点拒绝；Then 该路径 0 落盘。When 助手改写 `~/existing.txt`；Then 没有批准卡，一句说明（AC-08），文件内容不变。<br>*将来拿什么证明*：真引擎、真围栏用例；测试主目录不放在 `/tmp`、系统临时目录这类本来可写的位置下面。批准臂：`mkdir` 一条、写文件经命令与经改文件工具各一条；另有拒绝臂、兄弟路径臂、已有文件臂；去掉本条做法（直接在主目录下的新路径仍按「不能批准」处理）的对照臂里，同样的步骤没有批准卡、0 落盘。 | INT-safety I-56（U-46）；BR-08、BR-11 |

## 用户会碰到的限制

- 主目录和 Code Puppy 自己的数据目录不能整个作为项目写入（v1 已有的规则，v2 不变）。
- 不是用户亲手打开的文件夹（经页面恢复、通知等到达，而本次运行没有登记、也不在启动时的可写范围内）不会自动变成可写，用「打开项目」选中即可（v2 新增；依据 owner 接受的前提「只认你本人的操作」）。外部链接在当前界面没有消费者，四个仓库里也没有任何产品面产出这种链接（v3 事实修订）。
- （v4）包管理器在应用里用的是另一份缓存：第一次在应用里安装依赖时会重新下载，多占一些磁盘。
- （v6）cargo 例外：对话里运行的 cargo 命令会写 `~/.cargo` 里的缓存与锁，和用户自己运行 cargo 时一样；换来用户的 Cargo 配置、镜像与凭据照常生效（impharaon/alpha-work INT-safety U-40（owner 2026-11-27「Cargo 选 1，第二处引擎改动允许，Supabase 报告批准」））。
- （v4）全局安装放开后，对话里的命令（包括被网页或文件内容诱导出来的命令）可以改动整台电脑共用的工具；「全部批准」档下不会先问。依据 owner 2026-11-25「放开」。
- （v4）shell 启动脚本和全局安装位置可写后，对话里的命令可以留下一段代码，等用户下次在应用外打开终端或运行那个工具时，它在围栏之外运行，围栏的保护（写入范围、应用保存的密钥、联网范围）管不到它。依据 owner 2026-11-25「放开」「一并放开」。
- （v7）命令运行中被拦下时，只有命令的报错写出了被拦位置的完整路径才会弹批准卡；程序自己吞掉报错、只写相对路径或不写路径时（2026-11-27 实测：Python 捕获异常后只打印「failed」、`tempfile` 随机文件名、`cd` 后用相对路径的 `touch`），不弹卡，原来的处理不变。依据 owner 批准的 I-55「确定不了位置的保留原来那句说明」（U-44）。
- （v8）直接放在主目录下、已经存在的文件或文件夹本身（例如改写 `~/已有的笔记.txt`）仍不能经批准卡写入，只有一句说明；只有新建的那一个路径有批准卡。依据 owner 选项原文「批准卡只放行这一个新文件夹或文件，其他位置照旧不能写」（U-46）。
- （v5）对话里的 `brew` 命令由应用在围栏外运行，Homebrew 软件包自带的安装脚本也在围栏外运行，写入范围、应用保存的密钥、联网范围都管不到它们。依据 owner 2026-11-26 对「由应用替助手在围栏外运行 brew；代价是 Homebrew 软件包自带的脚本在围栏外运行」答「好的。」（impharaon/alpha-work INT-safety U-38（owner 2026-11-26「好的。」））。

## 待决

- 无新的待决。v8（BR-08 的 v8 句、BR-11 与 AC-13 的对应修订、AC-08 第一种情形、AC-14 与对应限制）依据 owner 2026-11-27 批准的 I-56（U-46）。v7（BR-11、AC-13、BR-06 的修订与对应限制）依据 owner 2026-11-27 批准的 I-55（U-44）。v5（BR-09 的 Homebrew 做法与对应限制）已由 owner 于 2026-11-26 批准。v4 已由 owner 于 2026-11-25 批准；BR-09 里「请求审批」档批准命令后也成功这一点，owner 答「接受」。规格批准不等于开发已授权。
- 上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 4 | 2026-11-25 | owner | 「批准。」（两份规格）；「接受。」（BR-09 的「请求审批」档）；「一并放开，还需要考虑 windows 系统，现在没发 windows 包后续是需要发的。」（BR-10 与 Windows 一段）——alpha-work INT-safety U-34。形成规格的授权：「放开」「可以，形成规格。」（U-33）。自查：Claude Fable 5.2，BR-07 至 BR-10 与 AC-09 至 AC-12 一一对应，BR-05 的修订与 BR-08 一致；遗留：无。 |
| 3 | 2026-11-19 | owner（措辞修订由编排器作出） | 事实修订，不改变用户可见行为：实现阶段查明当前界面（NewLayout）没有项目深链接的消费者，AC-08 第二种情形改以「不是用户亲手打开的文件夹」表述，到达路径用可达的恢复 / 改写路径；批准依据仍是 v2 的 owner 原话。 |
| 2 | 2026-11-19 | owner | 「如果第二条可行，就选第二条，这样才是真正的无感，好的，如果这样我觉得可以。」（BR-03 至 BR-06、AC-05 至 AC-08；第二条 = 用户亲手打开的项目当场可写、不重启） |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309)，本次不新增验收结论。 |
| 5 | 2026-11-26 | owner | 「…好的。」（impharaon/alpha-work INT-safety U-38（owner 2026-11-26「好的。」）；选 A：应用替助手在围栏外运行 brew）。「请求审批」档经批准后同样由应用运行，与 v4 已批准的 AC-11（批准后成功）一致。 |
| 6 | 2026-11-27 | owner | 「Cargo 选 1，第二处引擎改动允许，Supabase 报告批准」（impharaon/alpha-work INT-safety U-40（owner 2026-11-27「Cargo 选 1，第二处引擎改动允许，Supabase 报告批准」））；BR-07 与 AC-09 增 cargo 例外，限制增一行。Claude Opus 5.5 起草 |
| 7 | 2026-11-27 | owner | 「被围栏栏住是否应该弹批准卡，用户批准，是否可以不被拦，当前是否有这样的需求。」「它登记成一条待决条目（INT-safety I-55）登记为批准」（impharaon/alpha-work INT-safety U-44）：批准 I-55 的做法，含「确定不了位置的保留原来那句说明」与主目录、数据目录、受保护位置不能批准。新增 BR-11、AC-13，BR-06 增一句，限制增一行，Windows 段增一句。「能确定位置」= 报错写出完整路径，来自 I-55 自己要求的系统拒绝记录实测（design v6 增量 §2），在批准做法之内。owner 批准的是 I-55 的做法，本版条文由 Claude Opus 5.5 起草，未另请 owner 逐字过目。自查：BR-11 与 AC-13 一一对应；BR-05（只有用户本人的动作能扩大可写范围）不变，BR-11 用的是同一张卡；遗留：无。 |
| 8 | 2026-11-27 | owner | 选「放行这一个（推荐）」，选项说明原文：「批准卡只放行这一个新文件夹或文件，其他位置照旧不能写。代价是围栏多支持一种「只放行一个新路径」的范围。」（impharaon/alpha-work INT-safety U-46，问题原文见「来源」v8 条）。BR-08 增 v8 句；BR-11 与 AC-13 的「主目录本身」不再含新建的那一个；AC-08 第一种情形相应写明；新增 AC-14；限制增一行；范围与 Windows 段各增一句。「主目录里已经存在的不算」取自选项原文「新建」「其他位置照旧不能写」，未另加规则。owner 批准的是 I-56 的做法，本版条文由 Claude Opus 5.5 起草，未另请 owner 逐字过目。自查：BR-08 的 v8 句与 AC-14 一一对应；BR-05 不变（只有用户点卡才扩大可写范围）；其余 BR/AC 未改；遗留：无。 |
