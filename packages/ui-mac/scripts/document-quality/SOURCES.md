# 文档质量实测的任务与评分材料：出处

AC-01..03 实测（[plan 切片八「AC-01..03 实测」](../../../../docs/specs/document-output-quality/plan.md)）用的任务文本、素材和评分脚本，来自 2026-11-26 的 pilot（`~/.cache/alpha-orch/2026-11-26/doc-pilot/harness/`）和 2026-11-25 的 office pilot（`~/.cache/alpha-orch/2026-11-25/office-pilot/`）。下表的 sha256 是入库时原样复制的字节；随后的提交只改评分脚本，改动列在表下。

| 文件 | 来源 | 入库时 sha256 |
| --- | --- | --- |
| `tasks.json` | doc-pilot `harness/tasks.json` | `eaec636d311884106e074c14bd47b74b4eea8a8a2d9d89d98bc6e8d0de287cf5` |
| `score_docx.py` | doc-pilot `harness/score_docx.py` | `3cab3058aefbcd7f5e0a6a36ace2dfa4b5a0ee7a5e62cb93a2d74fcaec98d15e` |
| `score_pptx.py` | doc-pilot `harness/score_pptx.py` | `66911f1d0bed30f081e5568238c6263bffa79a97b353d13f254700fde79a14ca` |
| `check_xlsx.py` | doc-pilot `harness/check_xlsx.py` | `440e2da69b84d1a2b38957f32707bfaff5cb832f164e67c6acdee9daffda32cc` |
| `content.json` | office-pilot `shared/content.json` | `0d8d4e1a02d7106aff333bf1dd7b7aeed44f9e7065e022fabeb929895ab106ba` |
| `chart.png` | office-pilot `shared/chart.png` | `92dc0a8d9c4ef656b10c47a55ee6a3db31d8eac79e165cea464346bcfdc634ff` |
| `img_market.png` | office-pilot `shared/img_market.png` | `882990d996eaf4c657cebd811b3a791cfa277f832fe6149cb9a5550d10e28fe4` |
| `img_ui.png` | office-pilot `shared/img_ui.png` | `8a1415cf0eb3fcb16a85a44e3ee7d71c0a693a51daed287d70d1e2733725fb16` |
| `sales.json` | office-pilot `F-excel/shared/sales.json` | `72e180cafd6b81389953b2cd16dde9f28d5fc35430d79ffc317e6d3e72f6f5d5` |

`tasks.json` 里 `assets` 写的是 pilot 的相对路径（`shared/content.json` 等），实测时按文件名取本目录的同名文件放进每次运行的工作目录。

## 入库后的改动（只改评分脚本，任务文本与素材保持原字节）

- `score_docx.py`：未改。
- `score_pptx.py`：`content.json` 改为读本目录的同名文件；第 10 项「风格统一」由「待目测」改为脚本判定：全部幻灯片出自同一个母版，且整套使用的字体不超过 3 种即通过（实测时另存页图供人工复核，结论记在 plan）；输出补 `_score`。
- `check_xlsx.py`：不再自己起 LibreOffice。参数改为「原样成品、经产品 `OfficeExcel.recalculate` 重算过的副本、重算回执、输出目录」，`sales.json` 读本目录的同名文件。汇总比对改为在汇总表的区域行、月份行里找任一数值单元格与独立结果相符，不再假定列序；新增按任务 12 项要求的逐项结论（`checklist`、`_score`）、重算后的公式错误数（`formula_errors`，取回执的 `errors`）与汇总一致性（`summary_match`）。第 7 项只判会被截断的中文单元格（右侧相邻单元格有值、未合并、未换行），列宽不足显示宽度的 0.9 即不通过。
