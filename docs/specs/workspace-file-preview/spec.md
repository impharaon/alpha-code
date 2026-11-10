---
id: SPEC-workspace-file-preview
title: 用户在会话右栏安全查看工作区文件
summary: 用户在会话右栏安全查看工作区文件，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 用户在会话右栏安全查看工作区文件

用户在会话右栏安全查看工作区文件。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-preview/N-01](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-preview.md#需求点)。
- 历史身份：[impharaon/alpha-code#244](https://github.com/impharaon/alpha-code/issues/244)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/146)。
- [有效范围或验收依据 2026-08-29](https://github.com/impharaon/alpha-code/issues/244#issuecomment-5461301649)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。

## 业务规则

- **BR-01** 当前 Session 的本地 write/edit 文件卡与 ordinary workspace 文件树可将支持文件打开到唯一右栏 preview surface。
- **BR-02** Markdown 默认显示安全 Preview 并可切 Source；其它常用格式严格复用 #207 的 renderer/fallback 决策。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 当前 Session 的本地 write/edit 文件卡与 ordinary workspace 文件树可将支持文件打开到唯一右栏 preview surface。 | [原票](https://github.com/impharaon/alpha-code/issues/244) · [最后裁决](https://github.com/impharaon/alpha-code/issues/244#issuecomment-5461301649) |
| AC-02 | Markdown 默认显示安全 Preview 并可切 Source；其它常用格式严格复用 #207 的 renderer/fallback 决策。 | [原票](https://github.com/impharaon/alpha-code/issues/244) · [最后裁决](https://github.com/impharaon/alpha-code/issues/244#issuecomment-5461301649) |
| AC-03 | HTML 只通过 #208 静态隔离 host 显示，placement 变化不削弱零网络、零 bridge 与短生命周期策略。 | [原票](https://github.com/impharaon/alpha-code/issues/244) · [最后裁决](https://github.com/impharaon/alpha-code/issues/244#issuecomment-5461301649) |
| AC-04 | local descriptor 仅覆盖当前 workspace 内真实文件；越根、symlink、替换竞态、超限和目录输入 fail closed。 | [原票](https://github.com/impharaon/alpha-code/issues/244) · [最后裁决](https://github.com/impharaon/alpha-code/issues/244#issuecomment-5461301649) |
| AC-05 | 大文件使用有界 range/stream 且可取消；切换文件/session 或关闭右栏后读取及时停止。 | [原票](https://github.com/impharaon/alpha-code/issues/244) · [最后裁决](https://github.com/impharaon/alpha-code/issues/244#issuecomment-5461301649) |
| AC-06 | unsupported、损坏或超限格式无白屏/静默失败，并提供诚实且最小权限的后续动作。 | [原票](https://github.com/impharaon/alpha-code/issues/244) · [最后裁决](https://github.com/impharaon/alpha-code/issues/244#issuecomment-5461301649) |
| AC-07 | 预览切换/关闭保持 Session timeline 滚动与正确焦点，不复制 #206 Workbench state。 | [原票](https://github.com/impharaon/alpha-code/issues/244) · [最后裁决](https://github.com/impharaon/alpha-code/issues/244#issuecomment-5461301649) |
| AC-08 | 云 artifact、Office 与新 renderer 不作为本需求完成条件；#247 不阻塞 REQ-108。 | [原票](https://github.com/impharaon/alpha-code/issues/244) · [最后裁决](https://github.com/impharaon/alpha-code/issues/244#issuecomment-5461301649) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/244#issuecomment-5461301649)，本次不新增验收结论。 |
