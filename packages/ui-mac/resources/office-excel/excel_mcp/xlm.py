# Adapted for Code Puppy, 2026-11-26, from excel-mcp-server 2.3.2 (MIT).
"""Excel 4.0 (XLM) macro functions, which the formula gate refuses.

Defined names are evaluated with macro rights: a name such as GET.WORKBOOK(1) or FILES("C:\\*")
reads the file system, other workbooks and the application, and RUN, EXEC and CALL start
other code. The functions of these families are blocked, as exact names and as prefixes:
file system, system and application, external programs and mail, DDE and links, databases,
execution, and reading the structure of the workbook.

The list follows the index of Microsoft's "Excel 4.0 Macro Functions Reference" (527 names),
and the names were checked against Excel on a macro sheet. Functions that only format,
select or edit cells are not blocked, and neither are names that are also worksheet
functions (ROW, COLUMN, INDEX, SORT, FILTER, NOW, CHAR, ...).
"""
_FAMILIES = ('GET.', 'APP.', 'FILE.', 'WORKBOOK.', 'ON.', 'SEND.', 'MAIL.', 'SQL.', 'QUERY.', 'SOLVER.', 'REPORT.', 'VBA.', 'SET.', 'DEFINE.', 'DELETE.', 'OPEN.', 'SAVE.', 'UPDATE.', 'CHANGE.', 'FORMULA.', 'REGISTER.', 'SOUND.', 'ACTIVATE.')
_FUNCTIONS = frozenset({'FILES', 'DIRECTORY', 'DOCUMENTS', 'WINDOWS', 'NAMES', 'LIST.NAMES', 'FOPEN', 'FCLOSE', 'FREAD', 'FREADLN', 'FWRITE', 'FWRITELN', 'FPOS', 'FSIZE', 'OPEN', 'SAVE', 'NEW', 'CLOSE', 'CLOSE.ALL', 'PRINT', 'LINE.PRINT', 'INSERT.PICTURE', 'INSERT.OBJECT', 'EMBED', 'SUMMARY.INFO', 'ADDIN.MANAGER', 'LINKS', 'INITIATE', 'POKE', 'REQUEST', 'TERMINATE', 'PASTE.LINK', 'PASTE.PICTURE.LINK', 'SUBSCRIBE.TO', 'CREATE.PUBLISHER', 'EDITION.OPTIONS', 'ROUTE.DOCUMENT', 'ROUTING.SLIP', 'CLEAR.ROUTING.SLIP', 'EXEC', 'EXECUTE', 'CALL', 'REGISTER', 'UNREGISTER', 'RUN', 'HALT', 'RESTART', 'EVALUATE', 'ALERT', 'ECHO', 'QUIT', 'ACTIVATE', 'HELP', 'SHOW.CLIPBOARD', 'MACRO.OPTIONS', 'SCENARIO.GET', 'VIEW.GET', 'SLIDE.GET', 'OPTIONS.LIST.GET', 'OPTIONS.LISTS.GET', 'FORMULA'})

def is_macro_function(name: str) -> bool:
    """Whether a normalised, upper-case function name is an Excel 4.0 macro function."""
    return name in _FUNCTIONS or name.startswith(_FAMILIES)
