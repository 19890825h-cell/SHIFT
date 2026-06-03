const familyState = {
  schedule: null,
};

const familyContent = document.querySelector("#familyContent");
const emptyFamily = document.querySelector("#emptyFamily");
const familyTitle = document.querySelector("#familyTitle");
const familySource = document.querySelector("#familySource");
const familyUpdated = document.querySelector("#familyUpdated");
const familyWorkCount = document.querySelector("#familyWorkCount");
const familyOffCount = document.querySelector("#familyOffCount");
const familyMonthLabel = document.querySelector("#familyMonthLabel");
const familyDays = document.querySelector("#familyDays");
const todayShift = document.querySelector("#todayShift");
const todayDetail = document.querySelector("#todayDetail");
const nextShift = document.querySelector("#nextShift");
const nextDetail = document.querySelector("#nextDetail");

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
    familyState.schedule = payload.schedule;
    renderFamilySchedule();
  } catch (error) {
    renderEmpty();
  }
}

function renderEmpty() {
  familyContent.hidden = true;
  emptyFamily.hidden = false;
  familyUpdated.textContent = "未登録";
  familyUpdated.className = "badge warn";
}

function renderFamilySchedule() {
  const schedule = familyState.schedule;
  if (!schedule || !Array.isArray(schedule.days)) {
    renderEmpty();
    return;
  }

  emptyFamily.hidden = true;
  familyContent.hidden = false;
  familyTitle.textContent = `${schedule.year}年${schedule.month}月 新里 康平`;
  familySource.textContent = schedule.source_filename || "";
  familyUpdated.textContent = schedule.updated_at ? `更新 ${formatUpdated(schedule.updated_at)}` : "更新済み";
  familyUpdated.className = "badge ok";
  familyWorkCount.textContent = String(schedule.days.filter((day) => day.status === "ok").length);
  familyOffCount.textContent = String(schedule.days.filter((day) => day.status === "off").length);
  familyMonthLabel.textContent = `${schedule.year}.${String(schedule.month).padStart(2, "0")}`;

  renderFocus(schedule.days);
  renderDays(schedule.days);
}

function renderFocus(days) {
  const todayKey = formatDateKey(new Date());
  const today = days.find((day) => day.date === todayKey);
  const next = days.find((day) => day.status === "ok" && day.date >= todayKey);

  setFocus(todayShift, todayDetail, today, "今日の予定なし");
  setFocus(nextShift, nextDetail, next, "今月の勤務なし");
}

function setFocus(titleEl, detailEl, day, emptyText) {
  if (!day) {
    titleEl.textContent = emptyText;
    detailEl.textContent = "";
    return;
  }
  titleEl.textContent = day.status === "ok" ? `${day.code} ${day.start}-${day.end}` : "休み";
  detailEl.textContent = `${day.day}日(${day.weekday})`;
}

function renderDays(days) {
  familyDays.innerHTML = days
    .map((day) => {
      const time = day.status === "ok" ? `${day.start}-${day.end}` : day.label || "休み";
      return `
        <article class="family-day ${escapeHtml(day.status)}">
          <div class="day-date">
            <strong>${escapeHtml(day.day)}</strong>
            <span>${escapeHtml(day.weekday)}</span>
          </div>
          <div class="day-shift">
            <strong>${escapeHtml(day.status === "ok" ? day.code : "休")}</strong>
            <span>${escapeHtml(time)}</span>
          </div>
        </article>
      `;
    })
    .join("");
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
