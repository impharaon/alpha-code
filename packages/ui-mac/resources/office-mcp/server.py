#!/usr/bin/env python3
"""Code Puppy first-party Office MCP server (stdio only).

One bundled server exposes readers and the selected Excel operations for its format. The
host supplies both the format and a canonical workspace directory on argv; tool
callers can only pass absolute paths below that directory.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
from typing import Any, Callable


PROTOCOL_VERSION = "2025-06-18"
SERVER_VERSION = "2.0.0"
FORMATS = {"word", "excel", "powerpoint", "pdf"}
EXTENSIONS = {"word": ".docx", "excel": ".xlsx", "powerpoint": ".pptx", "pdf": ".pdf"}


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[1] not in FORMATS:
        print("usage: server.py <word|excel|powerpoint|pdf> <absolute-workspace>; stdio is the only transport", file=sys.stderr)
        return 2

    workspace_arg = argv[2]
    if not is_absolute_path(workspace_arg) or has_traversal(workspace_arg):
        print("workspace must be an absolute path without '..' segments", file=sys.stderr)
        return 2

    try:
        workspace = Path(workspace_arg).resolve(strict=True)
    except OSError:
        print("workspace must be an existing directory", file=sys.stderr)
        return 2
    if not workspace.is_dir():
        print("workspace must be an existing directory", file=sys.stderr)
        return 2

    for line in sys.stdin:
        if not line.strip():
            continue
        message: Any = None
        try:
            message = json.loads(line)
            response = handle_message(argv[1], workspace, message)
        except Exception as error:
            request_id = message.get("id") if isinstance(message, dict) else None
            response = error_response(request_id, -32603, str(error))
        if response is not None:
            print(json.dumps(response, ensure_ascii=False, default=str), flush=True)
    return 0


def handle_message(format_name: str, workspace: Path, message: Any) -> dict[str, Any] | None:
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return error_response(message.get("id") if isinstance(message, dict) else None, -32600, "invalid JSON-RPC request")

    method = message.get("method")
    request_id = message.get("id")
    if method == "notifications/initialized":
        return None
    if method == "initialize":
        return success_response(
            request_id,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": f"codepuppy-office-{format_name}", "version": SERVER_VERSION},
            },
        )
    if method == "ping":
        return success_response(request_id, {})
    if method == "tools/list":
        return success_response(request_id, {"tools": tools_for(format_name)})
    if method == "tools/call":
        params = message.get("params")
        if not isinstance(params, dict) or not isinstance(params.get("name"), str):
            return error_response(request_id, -32602, "tools/call requires a tool name")
        arguments = params.get("arguments", {})
        if not isinstance(arguments, dict):
            return error_response(request_id, -32602, "tool arguments must be an object")
        try:
            result = call_tool(format_name, workspace, params["name"], arguments)
            return success_response(
                request_id,
                {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, default=str)}]},
            )
        except Exception as error:
            return success_response(
                request_id,
                {"content": [{"type": "text", "text": str(error)}], "isError": True},
            )
    if request_id is None:
        return None
    return error_response(request_id, -32601, f"method not found: {method}")


def tools_for(format_name: str) -> list[dict[str, Any]]:
    path_property = {"path": {"type": "string", "description": "Absolute path inside the granted workspace"}}
    if format_name == "word":
        return [tool("read_docx", "Read paragraphs and tables from a Word document", path_property, ["path"])]
    if format_name == "excel":
        return [tool("read_xlsx", "Read calculated values, formulas and error locations with explicit cache sources and cursors", {**path_property, "sheet": {"type":"string"}, "range":{"type":"string"}, "mode":{"type":"string","enum":["values","formulas","both"]}, "rows":{"type":"integer","minimum":1}, "cursor":{"type":"string"}}, ["path"]), *excel_operation_tools()]
    if format_name == "powerpoint":
        return [tool("read_pptx", "Read text from every slide in a PowerPoint deck", path_property, ["path"])]
    return [tool("read_pdf", "Extract the text layer from every PDF page", path_property, ["path"])]


def excel_operation_tools():
    from codepuppy_office.excel import INSPECT, EDIT, operation_models, workspace
    return [
        {"name":"excel_inspect","description":"Inspect workbook structure, read ranges or find literal text with formula values and source-bound cursors","inputSchema":{"type":"object",**INSPECT.json_schema()}},
        {"name":"excel_edit","description":"Sort a range or replace literal text through the shared preserving save and pivot-refresh path","inputSchema":{"type":"object",**EDIT.json_schema()}},
        tool("excel_objects","Describe or apply a typed pivot, slicer or sparkline operation",{"action":{"type":"string","enum":["describe","apply"]},"operation":{"type":"string","enum":list(operation_models(workspace()))},"path":{"type":"string"},"inputJson":{"type":"string"}},["action","operation"]),
        tool("excel_recalculate","Recalculate a copy with verified LibreOffice, merge caches into the original package and report formula errors",{"path":{"type":"string"}},["path"]),
    ]


def tool(name: str, description: str, properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        },
    }


def call_tool(format_name: str, workspace: Path, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    handlers: dict[str, dict[str, Callable[[Path, dict[str, Any]], dict[str, Any]]]] = {
        "word": {"read_docx": read_docx},
        "excel": {"read_xlsx": read_xlsx},
        "powerpoint": {"read_pptx": read_pptx},
        "pdf": {"read_pdf": read_pdf},
    }
    if format_name == "excel" and name in {"excel_inspect","excel_edit","excel_objects","excel_recalculate"}:
        from codepuppy_office import OfficeExcel
        if name == "excel_objects" and arguments.get("action") == "describe":
            reject_unknown_keys(arguments,{"action","operation"},name)
            return OfficeExcel.object_schema(arguments.get("operation"))
        path = require_workspace_path(workspace,arguments.get("path"),EXTENSIONS[format_name])
        request = {**arguments,"path":str(path)}
        if name == "excel_inspect": return OfficeExcel.inspect(json.dumps(request))
        if name == "excel_edit": return OfficeExcel.apply_edit(json.dumps(request))
        if name == "excel_recalculate":
            reject_unknown_keys(arguments,{"path"},name)
            return OfficeExcel.recalculate(str(path))
        reject_unknown_keys(arguments,{"path","action","operation","inputJson"},name)
        if request.get("action") != "apply" or not isinstance(request.get("inputJson"),str):raise ValueError("invalid-input: excel_objects apply requires inputJson")
        return OfficeExcel.objects(str(path),request.get("operation"),request["inputJson"])
    handler = handlers[format_name].get(name)
    if handler is None:
        raise ValueError(f"unknown {format_name} tool: {name}")
    declared = next(spec for spec in tools_for(format_name) if spec["name"] == name)
    # #1245: every tool schema declares additionalProperties:false; enforce it here so an argument
    # the tool cannot honour is refused instead of accepted-and-dropped (a success that lies).
    reject_unknown_keys(arguments, declared["inputSchema"]["properties"].keys(), name)
    path = require_workspace_path(workspace, arguments.get("path"), EXTENSIONS[format_name])
    return handler(path, arguments)


def require_workspace_path(workspace: Path, raw: Any, extension: str) -> Path:
    if not isinstance(raw, str) or not raw:
        raise ValueError("path must be a non-empty string")
    if not is_absolute_path(raw):
        raise ValueError("path must be absolute")
    if has_traversal(raw):
        raise ValueError("path traversal ('..') is not allowed")
    candidate = Path(raw)
    if candidate.suffix.lower() != extension:
        raise ValueError(f"path must end in {extension}")
    resolved = candidate.resolve(strict=False)
    if os.path.commonpath((str(workspace), str(resolved))) != str(workspace):
        raise ValueError("path is outside the granted workspace")
    return resolved


def is_absolute_path(value: str) -> bool:
    normalized = value.replace("\\", "/")
    return normalized.startswith("/") or (len(normalized) >= 3 and normalized[0].isalpha() and normalized[1:3] == ":/")


def has_traversal(value: str) -> bool:
    return ".." in value.replace("\\", "/").split("/")


def read_docx(path: Path, _: dict[str, Any]) -> dict[str, Any]:
    require_existing(path)
    from docx import Document

    document = Document(path)
    return {
        "path": str(path),
        "paragraphs": [paragraph.text for paragraph in document.paragraphs],
        "tables": [
            [[cell.text for cell in row.cells] for row in table.rows]
            for table in document.tables
        ],
    }


def reject_unknown_keys(arguments: dict[str, Any], allowed: Any, label: str) -> None:
    unknown = sorted(str(key) for key in arguments if key not in allowed)
    if unknown:
        raise ValueError(f"{label} does not accept: {', '.join(unknown)} (accepted: {', '.join(sorted(allowed))})")


def read_xlsx(path: Path, arguments: dict[str, Any]) -> dict[str, Any]:
    require_existing(path)
    from codepuppy_office import OfficeExcel
    if arguments.get('sheet'):
        return OfficeExcel.inspect(json.dumps({**arguments,'path':str(path),'action':'range'}))
    structure=OfficeExcel.inspect(json.dumps({'path':str(path),'action':'workbook'}))
    return {'path':str(path),'sheets':[{'name':sheet['name'],**OfficeExcel.inspect(json.dumps({**arguments,'path':str(path),'sheet':sheet['name'],'action':'range'}))} for sheet in structure['sheets']]}


def read_pptx(path: Path, _: dict[str, Any]) -> dict[str, Any]:
    require_existing(path)
    from pptx import Presentation

    presentation = Presentation(path)
    return {
        "path": str(path),
        "slides": [
            {
                "number": index,
                "text": [shape.text for shape in slide.shapes if hasattr(shape, "text") and shape.text],
            }
            for index, slide in enumerate(presentation.slides, start=1)
        ],
    }


def read_pdf(path: Path, _: dict[str, Any]) -> dict[str, Any]:
    require_existing(path)
    from pypdf import PdfReader

    reader = PdfReader(path)
    return {"path": str(path), "pages": [page.extract_text() or "" for page in reader.pages]}


def require_existing(path: Path) -> None:
    if not path.is_file():
        raise ValueError(f"file does not exist: {path}")


def success_response(request_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def error_response(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
