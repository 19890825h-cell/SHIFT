from __future__ import annotations

import base64
import json
import os
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
APP_PRIVATE_SOURCE = "local-shift-calendar"


class CalendarAuthError(Exception):
    pass


def credentials_path(root: Path) -> Path:
    return Path(os.environ.get("GOOGLE_CREDENTIALS_PATH", root / "credentials.json"))


def token_path(root: Path) -> Path:
    return Path(os.environ.get("GOOGLE_TOKEN_PATH", root / "data" / "token.json"))


def auth_status(root: Path) -> dict[str, Any]:
    has_credentials = _has_client_secret(root)
    token = token_path(root)
    authenticated = False
    if token.exists() or os.environ.get("GOOGLE_TOKEN_JSON"):
        try:
            from google.auth.transport.requests import Request

            credentials = _load_user_credentials(root)
            authenticated = bool(credentials and credentials.valid)
            if credentials and credentials.expired and credentials.refresh_token:
                credentials.refresh(Request())
                _save_user_credentials(root, credentials)
                authenticated = True
        except Exception:
            authenticated = False
    return {
        "has_credentials": has_credentials,
        "authenticated": authenticated,
        "credentials_path": str(credentials_path(root)),
        "token_path": str(token),
    }


def create_auth_flow(root: Path, redirect_uri: str):
    from google_auth_oauthlib.flow import Flow

    if redirect_uri.startswith("http://"):
        os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
    client_config = _client_secret_config()
    if client_config:
        return Flow.from_client_config(client_config, scopes=SCOPES, redirect_uri=redirect_uri)

    path = credentials_path(root)
    if not path.exists():
        raise CalendarAuthError(f"Google OAuth設定が見つかりません: {path}")
    return Flow.from_client_secrets_file(str(path), scopes=SCOPES, redirect_uri=redirect_uri)


def save_callback_token(root: Path, flow, authorization_response: str) -> None:
    if authorization_response.startswith("http://"):
        os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
    flow.fetch_token(authorization_response=authorization_response)
    _save_user_credentials(root, flow.credentials)


def calendar_service(root: Path):
    if not token_path(root).exists() and not os.environ.get("GOOGLE_TOKEN_JSON"):
        raise CalendarAuthError("Google認証がまだ完了していません。")
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    credentials = _load_user_credentials(root)
    if credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())
        _save_user_credentials(root, credentials)
    if not credentials.valid:
        raise CalendarAuthError("Google認証トークンが無効です。再認証してください。")
    return build("calendar", "v3", credentials=credentials)


def _has_client_secret(root: Path) -> bool:
    return bool(_client_secret_config()) or credentials_path(root).exists()


def _client_secret_config() -> dict[str, Any] | None:
    raw_json = os.environ.get("GOOGLE_CLIENT_SECRET_JSON")
    raw_base64 = os.environ.get("GOOGLE_CLIENT_SECRET_BASE64")
    if raw_base64 and not raw_json:
        raw_json = base64.b64decode(raw_base64).decode("utf-8")
    if not raw_json:
        return None
    return json.loads(raw_json)


def _load_user_credentials(root: Path):
    from google.oauth2.credentials import Credentials

    raw_json = os.environ.get("GOOGLE_TOKEN_JSON")
    if raw_json:
        return Credentials.from_authorized_user_info(json.loads(raw_json), SCOPES)
    return Credentials.from_authorized_user_file(str(token_path(root)), SCOPES)


def _save_user_credentials(root: Path, credentials) -> None:
    token = token_path(root)
    token.parent.mkdir(parents=True, exist_ok=True)
    token.write_text(credentials.to_json(), encoding="utf-8")


def build_event_payloads(
    schedule: dict[str, Any],
    *,
    title_template: str,
    timezone: str = "Asia/Tokyo",
) -> list[dict[str, Any]]:
    zone = ZoneInfo(timezone)
    events: list[dict[str, Any]] = []
    for day in schedule.get("days", []):
        if day.get("status") != "ok" or not day.get("start") or not day.get("end"):
            continue
        start_dt, end_dt = _shift_datetimes(day["date"], day["start"], day["end"], zone)
        code = day.get("code") or day.get("raw_code") or ""
        title = title_template.format(
            code=code,
            name=schedule.get("target_name", ""),
            date=day["date"],
            start=day["start"],
            end=day["end"],
        )
        events.append(
            {
                "summary": title,
                "description": (
                    f"勤務表PDF: {schedule.get('source_filename', '')}\n"
                    f"対象者: {schedule.get('matched_name') or schedule.get('target_name', '')}\n"
                    f"シフト: {code} {day['start']}-{day['end']}"
                ),
                "start": {"dateTime": start_dt.isoformat(), "timeZone": timezone},
                "end": {"dateTime": end_dt.isoformat(), "timeZone": timezone},
                "extendedProperties": {
                    "private": {
                        "shiftSource": APP_PRIVATE_SOURCE,
                        "shiftPerson": schedule.get("target_key", ""),
                        "shiftDate": day["date"],
                        "shiftCode": code,
                    }
                },
            }
        )
    return events


def import_events(
    root: Path,
    schedule: dict[str, Any],
    *,
    calendar_id: str = "primary",
    title_template: str = "勤務 {code}",
    timezone: str = "Asia/Tokyo",
    replace_existing: bool = True,
) -> dict[str, Any]:
    service = calendar_service(root)
    events = build_event_payloads(schedule, title_template=title_template, timezone=timezone)
    deleted = 0
    if replace_existing:
        deleted = delete_existing_events(service, schedule, calendar_id=calendar_id, timezone=timezone)

    created = []
    for event in events:
        created.append(
            service.events()
            .insert(calendarId=calendar_id, body=event)
            .execute()
        )
    return {
        "created": len(created),
        "deleted": deleted,
        "links": [event.get("htmlLink") for event in created if event.get("htmlLink")],
    }


def delete_existing_events(service, schedule: dict[str, Any], *, calendar_id: str, timezone: str) -> int:
    zone = ZoneInfo(timezone)
    first = date(int(schedule["year"]), int(schedule["month"]), 1)
    if first.month == 12:
        next_month = date(first.year + 1, 1, 1)
    else:
        next_month = date(first.year, first.month + 1, 1)
    time_min = datetime.combine(first, time.min, zone).isoformat()
    time_max = datetime.combine(next_month, time.min, zone).isoformat()
    person = schedule.get("target_key", "")
    deleted = 0
    page_token = None

    while True:
        response = (
            service.events()
            .list(
                calendarId=calendar_id,
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                privateExtendedProperty=f"shiftSource={APP_PRIVATE_SOURCE}",
                pageToken=page_token,
            )
            .execute()
        )
        for event in response.get("items", []):
            private = event.get("extendedProperties", {}).get("private", {})
            if private.get("shiftPerson") != person:
                continue
            service.events().delete(calendarId=calendar_id, eventId=event["id"]).execute()
            deleted += 1
        page_token = response.get("nextPageToken")
        if not page_token:
            break
    return deleted


def generate_ics(schedule: dict[str, Any], *, title_template: str, timezone: str = "Asia/Tokyo") -> str:
    events = build_event_payloads(schedule, title_template=title_template, timezone=timezone)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Local Shift Calendar//JP",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    now = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    for event in events:
        start = datetime.fromisoformat(event["start"]["dateTime"]).strftime("%Y%m%dT%H%M%S")
        end = datetime.fromisoformat(event["end"]["dateTime"]).strftime("%Y%m%dT%H%M%S")
        private = event["extendedProperties"]["private"]
        uid = f"{private['shiftPerson']}-{private['shiftDate']}-{private['shiftCode']}@local-shift-calendar"
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{_ics_escape(uid)}",
                f"DTSTAMP:{now}",
                f"DTSTART;TZID={timezone}:{start}",
                f"DTEND;TZID={timezone}:{end}",
                f"SUMMARY:{_ics_escape(event['summary'])}",
                f"DESCRIPTION:{_ics_escape(event.get('description', ''))}",
                "END:VEVENT",
            ]
        )
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def _shift_datetimes(date_text: str, start_text: str, end_text: str, zone: ZoneInfo) -> tuple[datetime, datetime]:
    base = date.fromisoformat(date_text)
    start_hour, start_minute = [int(part) for part in start_text.split(":")]
    end_hour, end_minute = [int(part) for part in end_text.split(":")]
    start_dt = datetime.combine(base, time(start_hour, start_minute), zone)
    end_dt = datetime.combine(base, time(end_hour, end_minute), zone)
    if end_dt <= start_dt:
        end_dt += timedelta(days=1)
    return start_dt, end_dt


def _ics_escape(value: str) -> str:
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace("\n", "\\n")
        .replace(",", "\\,")
        .replace(";", "\\;")
    )
