const familyMembers = document.querySelector("#familyMembers");
const emptyFamily = document.querySelector("#emptyFamily");
const familyUpdated = document.querySelector("#familyUpdated");
const currentClock = document.querySelector("#currentClock");
const currentDateLabel = document.querySelector("#currentDateLabel");
const weatherUpdated = document.querySelector("#weatherUpdated");
const weatherDays = document.querySelector("#weatherDays");

loadFamilySchedule();
startClock();
loadWeather();
window.setInterval(loadFamilySchedule, 60000);
window.setInterval(loadWeather, 60 * 60 * 1000);

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

function startClock() {
  renderClock();
  window.setInterval(renderClock, 1000);
}

function renderClock() {
  const now = new Date();
  currentClock.textContent = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  currentDateLabel.textContent = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(now);
}

async function loadWeather() {
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: "26.2124",
      longitude: "127.6809",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "Asia/Tokyo",
      forecast_days: "3",
    }).toString();
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("weather unavailable");
    }
    const payload = await response.json();
    renderWeather(payload.daily);
  } catch (error) {
    weatherUpdated.textContent = "取得できません";
    weatherDays.innerHTML = `
      <article class="weather-day unavailable">
        <strong>天気を取得できません</strong>
        <span>ネット接続を確認してください</span>
      </article>
    `;
  }
}

function renderWeather(daily) {
  if (!daily || !Array.isArray(daily.time)) {
    throw new Error("invalid weather");
  }
  weatherUpdated.textContent = `更新 ${formatUpdated(new Date().toISOString())}`;
  weatherDays.innerHTML = daily.time.slice(0, 3).map((dateText, index) => {
    const label = ["今日", "明日", "あさって"][index] || formatWeatherDate(dateText);
    const weather = describeWeather(daily.weather_code?.[index]);
    const maxTemp = daily.temperature_2m_max?.[index];
    const minTemp = daily.temperature_2m_min?.[index];
    const rain = daily.precipitation_probability_max?.[index];
    return `
      <article class="weather-day ${escapeHtml(weather.level)}">
        <div>
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(weather.label)}</strong>
          <small>${escapeHtml(formatWeatherDate(dateText))}</small>
        </div>
        <div class="weather-values">
          <span>${escapeHtml(formatTemperature(minTemp))} / ${escapeHtml(formatTemperature(maxTemp))}</span>
          <span>降水 ${escapeHtml(formatPercent(rain))}</span>
        </div>
      </article>
    `;
  }).join("");
}

function describeWeather(code) {
  if ([0].includes(code)) {
    return { label: "晴れ", level: "clear" };
  }
  if ([1, 2].includes(code)) {
    return { label: "晴れ時々くもり", level: "clear" };
  }
  if ([3, 45, 48].includes(code)) {
    return { label: "くもり", level: "cloudy" };
  }
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return { label: "雨", level: "rain" };
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return { label: "雪", level: "rain" };
  }
  if ([95, 96, 99].includes(code)) {
    return { label: "雷雨", level: "storm" };
  }
  return { label: "確認中", level: "cloudy" };
}

function formatWeatherDate(value) {
  const date = new Date(`${value}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatTemperature(value) {
  return Number.isFinite(value) ? `${Math.round(value)}℃` : "-";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : "-";
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
