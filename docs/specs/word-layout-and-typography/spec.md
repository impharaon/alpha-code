---
id: SPEC-word-layout-and-typography
title: 生成的 Word 有正确中文字体、标题与纸张设置
summary: 生成的 Word 有正确中文字体、标题与纸张设置，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 生成的 Word 有正确中文字体、标题与纸张设置

生成的 Word 有正确中文字体、标题与纸张设置。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-office](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-office.md)。
- 历史身份：[impharaon/alpha-code#1235](https://github.com/impharaon/alpha-code/issues/1235)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/150)。
- [有效范围或验收依据 2026-09-06](https://github.com/impharaon/alpha-code/issues/1235#issuecomment-5558692128)。
- [有效范围或验收依据 2026-09-07](https://github.com/impharaon/alpha-code/issues/1235#issuecomment-5564036795)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：历史矩阵使用仓内 server.py 1.1.0；当时安装的 0.1.9 不含该实现，不能用该次矩阵代替所有发布包验收。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/ui-mac/resources/office-mcp/server.py](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/resources/office-mcp/server.py)

## 业务规则

- **BR-01** 在当前发布渠道下,四个 office 连接器可经既有安装路径装上并出现在已安装列表;发布渠道切换后已装记录不失效。
- **BR-02** 生成的 docx 指定了中文字体(`eastAsia` 非空)。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 在当前发布渠道下,四个 office 连接器可经既有安装路径装上并出现在已安装列表;发布渠道切换后已装记录不失效。 | [原票](https://github.com/impharaon/alpha-code/issues/1235) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1235#issuecomment-5564036795) |
| AC-02 | 生成的 docx 指定了中文字体(`eastAsia` 非空)。 | [原票](https://github.com/impharaon/alpha-code/issues/1235) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1235#issuecomment-5564036795) |
| AC-03 | 生成的 docx 支持多级标题,请求为标题的段落不再被降级为正文。 | [原票](https://github.com/impharaon/alpha-code/issues/1235) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1235#issuecomment-5564036795) |
| AC-04 | 生成的 docx 页面尺寸可指定,缺省为 A4。 | [原票](https://github.com/impharaon/alpha-code/issues/1235) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1235#issuecomment-5564036795) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/1235#issuecomment-5564036795)，本次不新增验收结论。 |
