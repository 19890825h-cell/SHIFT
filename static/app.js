const state = {
  schedule: null,
  auth: window.AUTH_STATUS || {},
};

window.shiftCalendarApp = {
  state,
  renderSchedule,
  resolveCode,
};

const offCodes = new Set(["", "H", "V", "V1"]);
const weekdayNames = ["日", "月", "火", "水", "木", "金", "土"];

const parseForm = document.querySelector("#parseForm");
const parseButton = document.querySelector("#parseButton");
const parseStatus = document.querySelector("#parseStatus");
const resultPanel = document.querySelector("#resultPanel");
const daysBody = document.querySelector("#daysBody");
const warningList = document.querySelector("#warningList");
const shiftMap = document.querySelector("#shiftMap");
const shiftMapPreview = document.querySelector("#shiftMapPreview");
const workCount = document.querySelector("#workCount");
const offCount = document.querySelector("#offCount");
const confirmCount = document.querySelector("#confirmCount");
const resultTitle = document.querySelector("#resultTitle");
const sourceLabel = document.querySelector("#sourceLabel");
const authBadge = document.querySelector("#authBadge");
const authLink = document.querySelector("#authLink");
const importStatus = document.querySelector("#importStatus");
let saveTimer = null;

renderAuth();

parseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  parseButton.disabled = true;
  parseStatus.textContent = "読み取り中";
  importStatus.textContent = "";
  const formData = new FormData(parseForm);

  try {
    const response = await fetch("/api/parse", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "読み取りに失敗しました。");
    }
    state.schedule = payload;
    shiftMap.value = payload.shift_map_text || "";
    parseStatus.textContent = "読み取り完了";
    renderSchedule();
    persistSchedule();
  } catch (error) {
    parseStatus.textContent = error.message;
  } finally {
    parseButton.disabled = false;
  }
});

daysBody.addEventListener("input", (event) => {
  if (!event.target.classList.contains("code-input") || !state.schedule) {
    return;
  }
  const index = Number(event.target.dataset.index);
  const day = state.schedule.days[index];
  const resolved = resolveCode(event.target.value);
  Object.assign(day, resolved, {
    raw_code: event.target.value.trim(),
    weekday: day.weekday,
    date: day.date,
    day: day.day,
  });
  renderSchedule();
  queuePersistSchedule();
});

document.querySelector("#icsButton").addEventListener("click", async () => {
  if (!state.schedule) {
    return;
  }
  importStatus.textContent = "ICS作成中";
  const response = await fetch("/api/ics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schedule: state.schedule,
      title_template: document.querySelector("#titleTemplate").value || "勤務 {code}",
    }),
  });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `shift_${state.schedule.year}_${String(state.schedule.month).padStart(2, "0")}.ics`;
  link.click();
  URL.revokeObjectURL(url);
  importStatus.textContent = "ICSを保存しました";
});

document.querySelector("#googleButton").addEventListener("click", async () => {
  if (!state.schedule) {
    return;
  }
  const unresolved = state.schedule.days.filter((day) => day.needs_confirmation);
  if (unresolved.length > 0) {
    importStatus.textContent = "確認が必要な日があります";
    return;
  }
  importStatus.textContent = "Googleカレンダーへ登録中";
  try {
    const response = await fetch("/api/google/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schedule: state.schedule,
        title_template: document.querySelector("#titleTemplate").value || "勤務 {code}",
        calendar_id: document.querySelector("#calendarId").value || "primary",
        replace_existing: document.querySelector("#replaceExisting").checked,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "登録に失敗しました。");
    }
    importStatus.textContent = `登録 ${payload.created}件 / 削除 ${payload.deleted}件`;
    await refreshAuth();
  } catch (error) {
    importStatus.textContent = error.message;
  }
});

async function refreshAuth() {
  const response = await fetch("/api/auth/status");
  state.auth = await response.json();
  renderAuth();
}

function queuePersistSchedule() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persistSchedule, 400);
}

async function persistSchedule() {
  if (!state.schedule) {
    return;
  }
  try {
    await fetch("/api/latest-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schedule: state.schedule }),
    });
  } catch (error) {
    importStatus.textContent = "家族ビューへの保存に失敗しました";
  }
}

function renderAuth() {
  if (state.auth.authenticated) {
    authBadge.textContent = "Google認証済み";
    authBadge.className = "badge ok";
    authLink.hidden = true;
    return;
  }
  if (state.auth.has_credentials) {
    authBadge.textContent = "Google未認証";
    authBadge.className = "badge warn";
    authLink.hidden = false;
    return;
  }
  authBadge.textContent = "credentials.jsonなし";
  authBadge.className = "badge warn";
  authLink.hidden = true;
}

function renderSchedule() {
  if (!state.schedule) {
    resultPanel.hidden = true;
    return;
  }
  resultPanel.hidden = false;
  sourceLabel.textContent = state.schedule.source_filename || "";
  resultTitle.textContent = `${state.schedule.year}年${state.schedule.month}月 ${state.schedule.matched_name}`;

  daysBody.innerHTML = "";
  state.schedule.days.forEach((day, index) => {
    const row = document.createElement("tr");
    row.className = day.status;
    row.innerHTML = `
      <td>${escapeHtml(day.day)}日</td>
      <td>${escapeHtml(day.weekday)}</td>
      <td><input class="code-input" data-index="${index}" value="${escapeHtml(day.code || "")}" aria-label="${day.day}日のシフト記号"></td>
      <td>${escapeHtml(formatTime(day))}</td>
      <td><span class="state-chip ${day.status}">${escapeHtml(day.status_label)}</span></td>
    `;
    daysBody.appendChild(row);
  });
  renderSummary();
  renderWarnings();
  renderShiftMapPreview();
}

function renderSummary() {
  const days = state.schedule.days;
  workCount.textContent = String(days.filter((day) => day.status === "ok").length);
  offCount.textContent = String(days.filter((day) => day.status === "off").length);
  confirmCount.textContent = String(days.filter((day) => day.needs_confirmation).length);
}

function renderWarnings() {
  const dayWarnings = state.schedule.days
    .filter((day) => day.needs_confirmation)
    .map((day) => `${day.day}日: ${day.raw_code || "空欄"} / ${day.label || day.status_label}`);
  const scheduleWarnings = (state.schedule.warnings || []).map((warning) => warning.message);
  const warnings = [...scheduleWarnings, ...dayWarnings];
  warningList.hidden = warnings.length === 0;
  warningList.innerHTML = warnings
    .map((message) => `<div class="warning-item">${escapeHtml(message)}</div>`)
    .join("");
}

function renderShiftMapPreview() {
  const rules = Object.values(state.schedule.shift_rules || {})
    .filter((rule) => rule.code && rule.kind === "work" && rule.start && rule.end)
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  shiftMapPreview.hidden = rules.length === 0;
  shiftMapPreview.innerHTML = `
    <strong>PDFから読み取ったシフト時間帯</strong>
    <code>${rules.map((rule) => `<span>${escapeHtml(rule.code)} ${escapeHtml(rule.start)}-${escapeHtml(rule.end)}</span>`).join("")}</code>
  `;
}

function resolveCode(value) {
  const rules = parseShiftMap(shiftMap.value);
  const code = normalizeCode(value);
  if (offCodes.has(code)) {
    return {
      code,
      status: "off",
      status_label: "休み",
      start: null,
      end: null,
      label: "休み",
      needs_confirmation: false,
    };
  }
  const rule = rules[code];
  if (rule && rule.kind === "work") {
    return {
      code,
      status: "ok",
      status_label: "登録対象",
      start: rule.start,
      end: rule.end,
      label: rule.label || "",
      needs_confirmation: false,
    };
  }
  if (rule) {
    return {
      code,
      status: "note",
      status_label: "時間なし",
      start: null,
      end: null,
      label: rule.label || "時間帯なし",
      needs_confirmation: true,
    };
  }
  return {
    code,
    status: "unknown",
    status_label: "要確認",
    start: null,
    end: null,
    label: "未登録のシフト記号",
    needs_confirmation: true,
  };
}

function parseShiftMap(text) {
  const rules = {};
  const timeRange = /^([A-Z][0-9]?)\s*(?:[.=:\s])+\s*(\d{1,2}:\d{2})\s*[-~～乣−－ー―]\s*(\d{1,2}:\d{2})/i;
  const fallback = /^([A-Z][0-9]?)\s*(?:[.=:\s])*\s*(.*)$/i;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const timeMatch = line.match(timeRange);
    if (timeMatch) {
      const code = normalizeCode(timeMatch[1]);
      rules[code] = {
        code,
        start: normalizeTime(timeMatch[2]),
        end: normalizeTime(timeMatch[3]),
        kind: "work",
      };
      continue;
    }
    const fallbackMatch = line.match(fallback);
    if (fallbackMatch) {
      const code = normalizeCode(fallbackMatch[1]);
      const label = fallbackMatch[2].trim();
      rules[code] = {
        code,
        label,
        kind: offCodes.has(code) || label.includes("休") ? "off" : "note",
      };
    }
  }
  return rules;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s|　|\./g, "");
}

function normalizeTime(value) {
  const [hour, minute] = value.split(":");
  return `${String(Number(hour)).padStart(2, "0")}:${minute}`;
}

function formatTime(day) {
  if (day.status === "ok") {
    return `${day.start}-${day.end}`;
  }
  return day.label || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
