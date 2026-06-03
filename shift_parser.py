from __future__ import annotations

import calendar
import contextlib
import io
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

import fitz

fitz.TOOLS.mupdf_display_errors(False)
fitz.TOOLS.mupdf_display_warnings(False)


OFF_CODES = {"", "H", "V", "V1"}
TIME_RANGE_RE = re.compile(
    r"^(?P<code>[A-Z][0-9]?)\s*(?:[.=:\s])+\s*"
    r"(?P<start>\d{1,2}:\d{2})\s*[-~～乣−－ー―]\s*"
    r"(?P<end>\d{1,2}:\d{2})",
    re.IGNORECASE,
)
CODE_RE = re.compile(r"^[A-Z][0-9]?$")


DEFAULT_SHIFT_MAP = """A1=04:15-12:15
A=05:00-13:00
B=05:15-13:15
B1=05:15-13:15
C=08:45-16:45
D=08:45-16:45
D1=09:00-17:00
E=10:30-18:30
U=09:00-17:00
F=11:30-19:30
G=11:50-19:50
J=12:45-20:45
N=13:00-21:00
N1=13:00-21:00
P=13:15-21:15
Q=13:30-21:30
R=16:00-00:00
S=09:00-17:00
S1=05:30-13:30
S2=11:00-19:00
L=10:00-18:00
T1=05:30-13:30
T2=11:00-19:00
T3=13:00-21:00
T=09:00-18:00
M=09:00-17:00
K=研修
V=年休
V1=特別休暇
H=休み
"""


class ShiftParseError(Exception):
    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.details = details or {}


@dataclass(frozen=True)
class ShiftRule:
    code: str
    start: str | None = None
    end: str | None = None
    label: str | None = None
    kind: str = "work"

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "start": self.start,
            "end": self.end,
            "label": self.label,
            "kind": self.kind,
        }


def normalize_name(value: str | None) -> str:
    return re.sub(r"[\s\u3000]+", "", value or "")


def normalize_code(value: str | None) -> str:
    text = (value or "").strip().upper()
    text = text.replace("　", "").replace(" ", "")
    text = text.replace(".", "")
    return text


def parse_year_month(filename: str | None) -> tuple[int | None, int | None]:
    if not filename:
        return None, None
    match = re.search(r"(20\d{2})[._\-\s]?([01]?\d)", filename)
    if not match:
        return None, None
    year = int(match.group(1))
    month = int(match.group(2))
    if 1 <= month <= 12:
        return year, month
    return None, None


def parse_shift_map(text: str) -> dict[str, ShiftRule]:
    rules: dict[str, ShiftRule] = {}
    for raw_line in (text or "").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        line = line.replace("：", ":").replace("〜", "～")
        match = TIME_RANGE_RE.match(line)
        if match:
            code = normalize_code(match.group("code"))
            rules[code] = ShiftRule(
                code=code,
                start=_normalize_time(match.group("start")),
                end=_normalize_time(match.group("end")),
                kind="work",
            )
            continue

        code_match = re.match(r"^(?P<code>[A-Z][0-9]?)\s*(?:[.=:\s])*\s*(?P<label>.+)?$", line, re.IGNORECASE)
        if code_match:
            code = normalize_code(code_match.group("code"))
            label = (code_match.group("label") or "").strip() or None
            kind = "off" if code in OFF_CODES or (label and "休" in label) else "note"
            rules[code] = ShiftRule(code=code, label=label, kind=kind)
    for code in OFF_CODES:
        rules.setdefault(code, ShiftRule(code=code, label="休み", kind="off"))
    return rules


def _normalize_time(value: str) -> str:
    hour, minute = value.split(":", 1)
    return f"{int(hour):02d}:{int(minute):02d}"


def resolve_shift(code: str, rules: dict[str, ShiftRule]) -> dict[str, Any]:
    normalized = normalize_code(code)
    if normalized in OFF_CODES:
        return {
            "code": normalized,
            "status": "off",
            "status_label": "休み",
            "start": None,
            "end": None,
            "label": "休み",
            "needs_confirmation": False,
        }
    rule = rules.get(normalized)
    if rule and rule.kind == "work" and rule.start and rule.end:
        return {
            "code": normalized,
            "status": "ok",
            "status_label": "登録対象",
            "start": rule.start,
            "end": rule.end,
            "label": rule.label,
            "needs_confirmation": False,
        }
    if rule:
        return {
            "code": normalized,
            "status": "note",
            "status_label": "時間なし",
            "start": None,
            "end": None,
            "label": rule.label or "時間帯なし",
            "needs_confirmation": True,
        }
    return {
        "code": normalized,
        "status": "unknown",
        "status_label": "要確認",
        "start": None,
        "end": None,
        "label": "未登録のシフト記号",
        "needs_confirmation": True,
    }


def extract_shift_schedule(
    pdf_path: str | Path,
    *,
    target_name: str,
    year: int,
    month: int,
    shift_map_text: str | None = None,
) -> dict[str, Any]:
    pdf = Path(pdf_path)
    doc = fitz.open(pdf)
    all_candidates: list[str] = []

    for page_index, page in enumerate(doc):
        tables = _find_tables_quiet(page)
        for table_index, table in enumerate(tables):
            data = table.extract()
            if not data:
                continue
            date_columns = _date_columns(data[0])
            if len(date_columns) < 20:
                continue
            extracted_shift_map_text = extract_shift_map_text(data)
            effective_shift_map_text = shift_map_text or extracted_shift_map_text
            shift_map_source = "manual" if shift_map_text else "pdf"
            if not effective_shift_map_text.strip():
                effective_shift_map_text = DEFAULT_SHIFT_MAP
                shift_map_source = "default"
            rules = parse_shift_map(effective_shift_map_text)

            matches, candidates = _find_target_rows(data, date_columns, target_name)
            all_candidates.extend(candidates)
            if not matches:
                continue

            if len(matches) > 1:
                raise ShiftParseError(
                    "対象者の行が複数見つかりました。",
                    {"matches": [m["name"] for m in matches]},
                )

            match = matches[0]
            schedule = _build_schedule(
                row=match["row"],
                date_columns=date_columns,
                rules=rules,
                target_name=target_name,
                matched_name=match["name"],
                year=year,
                month=month,
                source_filename=pdf.name,
                page_index=page_index,
                table_index=table_index,
                shift_map_text=effective_shift_map_text,
                shift_map_source=shift_map_source,
            )
            return schedule

    raise ShiftParseError(
        "対象者の行をPDFから見つけられませんでした。",
        {"target": target_name, "candidates": sorted(set(all_candidates))[:30]},
    )


def _find_tables_quiet(page) -> list[Any]:
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
        return page.find_tables().tables


def extract_shift_map_text(data: list[list[str | None]]) -> str:
    lines: list[str] = []
    for row in data:
        candidates = _shift_map_candidates(row)
        for candidate in candidates:
            parsed = _normalize_shift_map_candidate(candidate)
            if parsed:
                lines.append(parsed)
    return "\n".join(_dedupe_preserve_order(lines))


def _shift_map_candidates(row: list[str | None]) -> list[str]:
    cells = [(cell or "").replace("\n", " ").strip() for cell in row]
    candidates = [cell for cell in cells if cell]
    if len(candidates) >= 2:
        candidates.append(" ".join(candidates[:3]))
    return candidates


def _normalize_shift_map_candidate(value: str) -> str | None:
    text = re.sub(r"\s+", " ", value).strip()
    if not text:
        return None
    time_match = TIME_RANGE_RE.search(text)
    if time_match:
        code = normalize_code(time_match.group("code"))
        return f"{code}={_normalize_time(time_match.group('start'))}-{_normalize_time(time_match.group('end'))}"

    label_match = re.match(r"^(?P<code>[A-Z][0-9]?)\s*(?:[.=:\s])+\s*(?P<label>.+)$", text, re.IGNORECASE)
    if not label_match:
        return None
    code = normalize_code(label_match.group("code"))
    label = re.sub(r"\s+", "", label_match.group("label").strip())
    if code and label and not any(char.isdigit() for char in label):
        return f"{code}={label}"
    return None


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        code = normalize_code(value.split("=", 1)[0])
        if not code or code in seen:
            continue
        seen.add(code)
        result.append(value)
    return result


def _date_columns(header_row: list[str | None]) -> dict[int, int]:
    columns: dict[int, int] = {}
    for index, cell in enumerate(header_row):
        text = (cell or "").strip()
        match = re.match(r"^(\d{1,2})(?:\D|$)", text)
        if match:
            day = int(match.group(1))
            if 1 <= day <= 31:
                columns[day] = index
    return columns


def _find_target_rows(
    data: list[list[str | None]],
    date_columns: dict[int, int],
    target_name: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    first_date_col = min(date_columns.values())
    target_norm = normalize_name(target_name)
    matches: list[dict[str, Any]] = []
    candidates: list[str] = []

    for row in data[1:]:
        name_text = " ".join(cell for cell in row[:first_date_col] if cell)
        name_norm = normalize_name(name_text)
        if not name_norm:
            continue
        if CODE_RE.match(name_norm[:2]):
            continue
        if _looks_like_person_name(name_text):
            candidates.append(name_text)
        if name_norm == target_norm:
            matches.append({"name": name_text, "row": row})
    return matches, candidates


def _looks_like_person_name(value: str) -> bool:
    text = normalize_name(value)
    if len(text) < 2 or len(text) > 8:
        return False
    if any(char.isdigit() for char in text):
        return False
    if ":" in value or "～" in value or "乣" in value:
        return False
    return True


def _build_schedule(
    *,
    row: list[str | None],
    date_columns: dict[int, int],
    rules: dict[str, ShiftRule],
    target_name: str,
    matched_name: str,
    year: int,
    month: int,
    source_filename: str,
    page_index: int,
    table_index: int,
    shift_map_text: str,
    shift_map_source: str,
) -> dict[str, Any]:
    _, month_days = calendar.monthrange(year, month)
    warnings: list[dict[str, str]] = []
    days: list[dict[str, Any]] = []

    for day in range(1, month_days + 1):
        cell_index = date_columns.get(day)
        if cell_index is None:
            days.append(_missing_day(year, month, day))
            warnings.append({"level": "error", "message": f"{day}日の列が見つかりません。"})
            continue
        raw_code = row[cell_index] if cell_index < len(row) else ""
        raw_code = (raw_code or "").replace("\n", "").strip()
        resolved = resolve_shift(raw_code, rules)
        day_date = date(year, month, day)
        item = {
            "date": day_date.isoformat(),
            "day": day,
            "weekday": "月火水木金土日"[day_date.weekday()],
            "raw_code": raw_code,
            **resolved,
        }
        if resolved["status"] in {"unknown", "note"}:
            warnings.append(
                {
                    "level": "warning",
                    "message": f"{day}日の「{raw_code or '空欄'}」は確認が必要です。",
                }
            )
        days.append(item)

    return {
        "target_name": target_name,
        "matched_name": matched_name,
        "target_key": normalize_name(target_name),
        "year": year,
        "month": month,
        "source_filename": source_filename,
        "page_index": page_index,
        "table_index": table_index,
        "days": days,
        "warnings": warnings,
        "shift_map_text": shift_map_text,
        "shift_map_source": shift_map_source,
        "shift_rules": {code: rule.to_dict() for code, rule in rules.items() if code},
        "summary": _summary(days),
    }


def _missing_day(year: int, month: int, day: int) -> dict[str, Any]:
    day_date = date(year, month, day)
    return {
        "date": day_date.isoformat(),
        "day": day,
        "weekday": "月火水木金土日"[day_date.weekday()],
        "raw_code": "",
        "code": "",
        "status": "unknown",
        "status_label": "列なし",
        "start": None,
        "end": None,
        "label": "列を検出できません",
        "needs_confirmation": True,
    }


def _summary(days: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "work": sum(1 for day in days if day["status"] == "ok"),
        "off": sum(1 for day in days if day["status"] == "off"),
        "needs_confirmation": sum(1 for day in days if day.get("needs_confirmation")),
    }


def validate_year_month(year: int, month: int) -> None:
    current_year = datetime.now().year
    if not (current_year - 5 <= year <= current_year + 5):
        raise ShiftParseError("年の指定が不自然です。")
    if not (1 <= month <= 12):
        raise ShiftParseError("月は1から12で指定してください。")
