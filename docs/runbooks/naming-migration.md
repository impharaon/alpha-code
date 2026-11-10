---
id: RUNBOOK-alpha-code-naming-migration
title: 升级到新名字:首次启动的数据迁移与回退
kind: runbook
status: active
summary: "升级到新名字:首次启动的数据迁移与回退"
---
# 升级到新名字:首次启动的数据迁移与回退

> 适用:从 0.1.24 及更早版本升级到第一个使用新名字(`codepuppy`)的版本。实现:#1569
> (`packages/ui-mac/src/main/naming-migration*.ts`、`project-hidden-dir-migration.ts`)。
> 钥匙串条目改名由 #1571 接入同一份迁移日志,本文只写本票的部分。

## 升级前

**先退出所有渠道**(正式版、测试版都要退出),再安装新版。新版启动时如果发现另一个渠道还在运行,
会停下并提示「…的另一个渠道正在运行,请先退出它再打开」,什么都不改。

不需要事先手动检查任何目录。

## 新版第一次启动时发生什么

拿到单实例锁之后、读钥匙串和启动引擎之前,一次性把旧名字下的数据挪到新名字下:

| 对象 | 处置 |
| --- | --- |
| `~/Library/Application Support/alpha-code-state/` | 整体改名为 `codepuppy-state/`;当前渠道的 `env/<渠道>/alpha.jsonc` 改名为 `codepuppy.jsonc`,其中的旧绝对路径与 `mcp.alpha-*`、`agent.alpha-*` 键改为新名 |
| 当前渠道的 `installs.json`、四个 Office 组件的授权记录、`governance.json` | Office 组件名、授权目录与授权记录里的 `key`、agent 名、出厂技能 id、模型供应商前缀改为新名;授权的能力集、摘要、事务号、授权时间原样 |
| userData(`~/Library/Application Support/ai.opencode.desktop[.beta]/`)下的 `alpha-*` 文件与目录、`alpha.env` | 改名为 `codepuppy-*` / `codepuppy.env`;加密文件只改名,不解密、不重新加密 |
| `alpha-live-models.json`、`alpha-byok-catalog.json` | 原字节改名 |
| `remote-catalog.json`、`alpha-applied-catalog.json`、`alpha-discovered-endpoints.json` | 挪进迁移备份目录,下次正常拉取时重建 |
| `opencode.settings` 的三个一次性标记、`opencode.global.dat` / 工作区 / 草稿里的模型选择 | 改为新名 |
| 会话库 `~/.local/share/opencode/opencode.db` | 改写前先备份;只改让旧会话还能接着用的指针:会话的供应商与模式、每个会话最近一条用户消息与最近一条普通用户消息的供应商与模式、工具显示快照的来源名、云端识图标记的键名。其余历史原样 |

打开项目时,项目里的 `.code-puppy/` 改名为 `.codepuppy/`,其下 `alpha.jsonc` 改名为 `codepuppy.jsonc`,
配置与项目 `installs.json` 里指向旧目录的路径随之改写。只在正式版和测试版里做;开发构建只判不写。

任何一步失败,已经做过的步骤按日志逆序撤销,启动停下并弹出「Code Puppy 升级迁移没有完成」和原因。
迁移进行中被强制退出,下次启动会先把上一次完整撤销,再重新迁移。成功之后再启动直接跳过。

Windows 不迁移,也不阻止启动。

## 日志与备份在哪里

`~/Library/Application Support/ai.opencode.desktop[.beta]/codepuppy-naming-migration/`(权限 0700):

| 文件 | 内容 |
| --- | --- |
| `journal.json` | 本次迁移的每一步(`kind`、`payload`、`state` = `pending` / `done` / `undone`)与总状态(`running` / `complete` / `undone`) |
| `journal-<runId>-undone.json` | 已撤销的历次迁移 |
| `backup/<序号>-<文件名>` | 被改写的文件的原值;被删除的缓存 |
| `db/opencode-backup-<时间>.db` | 会话库改写前的备份 |
| `aside-<runId>/` | 迁移时挪开的新全局根(见下) |
| `projects.log` | 每迁完一个项目追加一行:`<时间>\t<项目路径>\t<做了的子步>` |

### `aside-<runId>` 是什么

如果升级前这台机器跑过新名字的开发构建,`codepuppy-state/` 可能已经存在,里面只有开发渠道的东西。
迁移把它整个挪到 `aside-<runId>/`,再把旧目录改名过去 —— 什么都不删。确认不需要后可以手动删除。
如果 `codepuppy-state/` 里已经有正式版或测试版的数据(`env/prod/`、`env/beta/` 下有文件,或任一子目录下有
`prod.json` / `beta.json`),迁移不会合并,停下并点名两个路径,需要人工决定保留哪一份。

## 提示「有未完成的扩展安装」

旧版留下了没做完的扩展安装事务,迁移不会在这种状态下动数据。处理:

1. 从 GitHub Release `v0.1.24`(<https://github.com/impharaon/alpha-code/releases/tag/v0.1.24>)下载旧版安装包
   `code-puppy-mac-arm64.dmg` 或 `code-puppy-mac-x64.dmg`;
2. 装回旧版,打开一次让它完成恢复,然后退出;
3. 再装新版。

## 回退

**回退截止点**:迁移目录还在的时候都能回退。回退会丢掉在新版里新产生的数据(新会话、新设置、新安装的扩展)。

1. 退出所有渠道。
2. 打开 `journal.json`,按 `steps` **从后往前**逐步还原:
   - `rename`:把 `payload.to` 改回 `payload.from`;
   - `rewrite`:用 `payload.backup` 覆盖 `payload.file`;
   - `db`:把会话库(连同 `-wal`、`-shm`)挪到旁边,把 `payload.backupPath` 拷回 `payload.dbPath`。
3. 按 `projects.log` 逐个项目还原:`.codepuppy/` 改回 `.code-puppy/`,其下 `codepuppy.jsonc` 改回 `alpha.jsonc`,
   并把其中的 `.codepuppy/` 路径改回 `.code-puppy/`(项目 `installs.json` 的 `files[]` 同理)。
4. 装回 0.1.24(下载位置同上)。
