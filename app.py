from __future__ import annotations

import hmac
import json
import os
import uuid
from datetime import datetime
from pathlib import Path

from flask import Flask, Response, jsonify, redirect, render_template, request, session, url_for
from werkzeug.utils import secure_filename

import calendar_client
from shift_parser import (
    DEFAULT_SHIFT_MAP,
    ShiftParseError,
    extract_shift_schedule,
    parse_shift_map,
    parse_year_month,
    resolve_shift,
    validate_year_month,
)


ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = ROOT / "uploads"
LATEST_SCHEDULE_PATH = ROOT / "data" / "latest_schedule.json"

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "local-shift-calendar-dev-key")
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024


@app.before_request
def require_app_password():
    password = os.environ.get("APP_PASSWORD")
    if not password or request.endpoint in {"healthz", "static"}:
        return None
    auth = request.authorization
    expected_user = os.environ.get("APP_USERNAME", "admin")
    if (
        auth
        and hmac.compare_digest(auth.username or "", expected_user)
        and hmac.compare_digest(auth.password or "", password)
    ):
        return None
    return Response(
        "認証が必要です。",
        401,
        headers={"WWW-Authenticate": 'Basic realm="Shift Calendar"'},
    )


@app.get("/healthz")
def healthz():
    return jsonify({"ok": True})


@app.get("/")
def index():
    return render_template(
        "index.html",
        default_shift_map=DEFAULT_SHIFT_MAP,
        auth_status=calendar_client.auth_status(ROOT),
    )


@app.get("/family")
def family():
    return render_template("family.html")


@app.post("/api/parse")
def parse_pdf():
    uploaded = request.files.get("pdf")
    if not uploaded:
        return jsonify({"error": "PDFを選択してください。"}), 400

    original_name = uploaded.filename or "shift.pdf"
    filename = secure_filename(original_name) or f"{uuid.uuid4().hex}.pdf"
    if not filename.lower().endswith(".pdf"):
        filename = f"{filename}.pdf"
    saved_path = UPLOAD_DIR / f"{uuid.uuid4().hex}_{filename}"
    uploaded.save(saved_path)

    target_name = request.form.get("target_name", "新里 康平").strip() or "新里 康平"
    inferred_year, inferred_month = parse_year_month(original_name)
    now = datetime.now()
    year = _int_or_none(request.form.get("year")) or inferred_year or now.year
    month = _int_or_none(request.form.get("month")) or inferred_month or now.month

    shift_map_text = (request.form.get("shift_map") or "").strip() or None
    try:
        validate_year_month(year, month)
        schedule = extract_shift_schedule(
            saved_path,
            target_name=target_name,
            year=year,
            month=month,
            shift_map_text=shift_map_text,
        )
        schedule["source_filename"] = original_name
        if request.form.get("year") or request.form.get("month"):
            schedule["year_month_source"] = "manual"
        elif inferred_year and inferred_month:
            schedule["year_month_source"] = "filename"
        else:
            schedule["year_month_source"] = "current"
            schedule["warnings"].append(
                {
                    "level": "warning",
                    "message": "ファイル名から年月を推定できなかったため、現在の年月で組み立てました。",
                }
            )
        save_latest_schedule(schedule)
    except ShiftParseError as exc:
        return jsonify({"error": str(exc), "details": exc.details}), 422
    except Exception as exc:
        return jsonify({"error": f"PDFの読み取りに失敗しました: {exc}"}), 500
    return jsonify(schedule)


@app.post("/api/resolve")
def resolve_code():
    payload = request.get_json(force=True)
    rules = parse_shift_map(payload.get("shift_map", DEFAULT_SHIFT_MAP))
    return jsonify(resolve_shift(payload.get("code", ""), rules))


@app.get("/api/latest-schedule")
def latest_schedule():
    schedule = load_latest_schedule()
    if not schedule:
        return jsonify({"schedule": None}), 404
    return jsonify({"schedule": schedule})


@app.post("/api/latest-schedule")
def update_latest_schedule():
    payload = request.get_json(force=True)
    schedule = payload.get("schedule")
    if not isinstance(schedule, dict) or not isinstance(schedule.get("days"), list):
        return jsonify({"error": "保存できるスケジュールがありません。"}), 400
    save_latest_schedule(schedule)
    return jsonify({"ok": True, "updated_at": schedule.get("updated_at")})


@app.post("/api/ics")
def download_ics():
    payload = request.get_json(force=True)
    schedule = payload.get("schedule")
    if not schedule:
        return jsonify({"error": "スケジュールがありません。"}), 400
    title_template = payload.get("title_template") or "勤務 {code}"
    ics = calendar_client.generate_ics(schedule, title_template=title_template)
    filename = f"shift_{schedule.get('year')}_{int(schedule.get('month', 0)):02d}.ics"
    return Response(
        ics,
        mimetype="text/calendar",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.get("/api/auth/status")
def api_auth_status():
    return jsonify(calendar_client.auth_status(ROOT))


@app.get("/google/auth")
def google_auth():
    try:
        flow = calendar_client.create_auth_flow(
            ROOT,
            url_for("google_callback", _external=True),
        )
    except calendar_client.CalendarAuthError as exc:
        return jsonify({"error": str(exc)}), 400
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    session["oauth_state"] = state
    return redirect(auth_url)


@app.get("/google/callback")
def google_callback():
    try:
        flow = calendar_client.create_auth_flow(
            ROOT,
            url_for("google_callback", _external=True),
        )
        flow.state = session.get("oauth_state")
        calendar_client.save_callback_token(ROOT, flow, request.url)
    except Exception as exc:
        return f"Google認証に失敗しました: {exc}", 400
    return redirect(url_for("index"))


@app.post("/api/google/import")
def google_import():
    payload = request.get_json(force=True)
    schedule = payload.get("schedule")
    if not schedule:
        return jsonify({"error": "スケジュールがありません。"}), 400
    try:
        result = calendar_client.import_events(
            ROOT,
            schedule,
            calendar_id=payload.get("calendar_id") or "primary",
            title_template=payload.get("title_template") or "勤務 {code}",
            replace_existing=bool(payload.get("replace_existing", True)),
        )
    except calendar_client.CalendarAuthError as exc:
        return jsonify({"error": str(exc)}), 401
    except Exception as exc:
        return jsonify({"error": f"Googleカレンダー登録に失敗しました: {exc}"}), 500
    return jsonify(result)


def _int_or_none(value: str | None) -> int | None:
    try:
        return int(value) if value not in (None, "") else None
    except ValueError:
        return None


def save_latest_schedule(schedule: dict) -> None:
    schedule["updated_at"] = datetime.now().isoformat(timespec="seconds")
    LATEST_SCHEDULE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = LATEST_SCHEDULE_PATH.with_suffix(".tmp")
    temporary_path.write_text(json.dumps(schedule, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary_path.replace(LATEST_SCHEDULE_PATH)


def load_latest_schedule() -> dict | None:
    if not LATEST_SCHEDULE_PATH.exists():
        return None
    return json.loads(LATEST_SCHEDULE_PATH.read_text(encoding="utf-8"))


if __name__ == "__main__":
    UPLOAD_DIR.mkdir(exist_ok=True)
    (ROOT / "data").mkdir(exist_ok=True)
    port = int(os.environ.get("PORT", "5000"))
    host = os.environ.get("HOST", "127.0.0.1")
    app.run(host=host, port=port, debug=False)
