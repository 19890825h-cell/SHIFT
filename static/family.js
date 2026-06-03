const familyMembers = document.querySelector("#familyMembers");
const emptyFamily = document.querySelector("#emptyFamily");
const familyUpdated = document.querySelector("#familyUpdated");

loadFamilySchedule();
window.setInterval(loadFamilySchedule, 60000);

async function loadFamilySchedule() {
  try {
    const response = await fetch("/api/latest-schedule");
    if (!response.ok) {
      renderEmpty();
      return;
    }
    const payload = await response.json();
    const members = (payload.members || []).filter((member) => member.schedule);
    if (members.length === 0) {
      renderEmpty();
      return;
    }
    renderFamilyMembers(members);
  } catch (error) {
    renderEmpty();
  }
}

function renderEmpty() {
  familyMembers.innerHTML = "";
  emptyFamily.hidden = false;
  familyUpdated.textContent = "未登録";
  familyUpdated.className = "badge warn";
}

function renderFamilyMembers(members) {
  emptyFamily.hidden = true;
  const latestUpdated = members
    .map((member) => member.schedule?.updated_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  familyUpdated.textContent = latestUpdated ? `更新 ${formatUpdated(latestUpdated)}` : "更新済み";
  familyUpdated.className = "badge ok";
  familyMembers.innerHTML = members.map(renderMember).join("");
}

function renderMember(member) {
  const schedule = member.schedule;
  const days = schedule.days || [];
  const todayKey = formatDateKey(new Date());
  const today = days.find((day) => day.date === todayKey);
  const next = days.find((day) => day.status === "ok" && day.date >= todayKey);
  const workCount = days.filter((day) => day.status === "ok").length;
  const offCount = days.filter((day) => day.status === "off").length;
  const displayName = schedule.display_name || member.name || schedule.target_name || "名前未設定";

  return `
    <article class="family-member">
      <section class="family-hero">
        <div>
          <p class="eyebrow">${escapeHtml(schedule.source_filename || "")}</p>
          <h2>${escapeHtml(displayName)}</h2>
          <small>${escapeHtml(schedule.year)}年${escapeHtml(schedule.month)}月</small>
        </div>
        <div class="family-summary">
          <span><strong>${escapeHtml(workCount)}</strong>勤務</span>
          <span><strong>${escapeHtml(offCount)}</strong>休み</span>
        </div>
      </section>

      <div class="family-focus">
        ${renderFocusCard("今日", today, "今日の予定なし")}
        ${renderFocusCard("次の勤務", next, "今月の勤務なし")}
      </div>

      <div class="family-month">
        <div class="month-header">
          <h2>予定一覧</h2>
          <span>${escapeHtml(schedule.year)}.${String(schedule.month).padStart(2, "0")}</span>
        </div>
        <div class="family-days">
          ${days.map(renderDay).join("")}
        </div>
      </div>
    </article>
  `;
}

function renderFocusCard(label, day, emptyText) {
  if (!day) {
    return `
      <article class="focus-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(emptyText)}</strong>
        <small></small>
      </article>
    `;
  }
  return `
    <article class="focus-card ${escapeHtml(day.status)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatShift(day))}</strong>
      <small>${escapeHtml(day.day)}日(${escapeHtml(day.weekday)})</small>
    </article>
  `;
}

function renderDay(day) {
  return `
    <article class="family-day ${escapeHtml(day.status)}">
      <div class="day-date">
        <strong>${escapeHtml(day.day)}</strong>
        <span>${escapeHtml(day.weekday)}</span>
      </div>
      <div class="day-shift">
        <strong>${escapeHtml(formatShift(day))}</strong>
      </div>
    </article>
  `;
}

function formatShift(day) {
  if (day.status === "ok") {
    return `${day.start}-${day.end}`;
  }
  if (day.status === "off") {
    return "休み";
  }
  return day.label || "要確認";
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatUpdated(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
