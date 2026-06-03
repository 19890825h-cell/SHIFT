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
}

function renderFamilyMembers(members) {
  emptyFamily.hidden = true;
  const latestUpdated = members
    .map((member) => member.schedule?.updated_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  familyUpdated.textContent = latestUpdated ? `更新 ${formatUpdated(latestUpdated)}` : "更新済み";
  familyMembers.innerHTML = members.map(renderMember).join("");
}

function renderMember(member) {
  const schedule = member.schedule;
  const days = schedule.days || [];
  const todayKey = formatDateKey(new Date());
  const upcomingDays = getUpcomingDays(days, todayKey);
  const nextOff = days.find((day) => day.status === "off" && day.date >= todayKey);
  const displayName = schedule.display_name || member.name || schedule.target_name || "名前未設定";

  return `
    <article class="family-member">
      <section class="member-head">
        <div>
          <h2>${escapeHtml(displayName)}</h2>
          <small>${escapeHtml(schedule.year)}年${escapeHtml(schedule.month)}月</small>
        </div>
      </section>

      <section class="rest-card">
        <span>次の休み</span>
        ${renderNextOff(nextOff, todayKey)}
      </section>

      <section class="next-shifts">
        <h3>3日分のシフト</h3>
        <div class="next-shift-list">
          ${upcomingDays.map(renderUpcomingDay).join("")}
        </div>
      </section>
    </article>
  `;
}

function getUpcomingDays(days, todayKey) {
  const upcoming = days.filter((day) => day.date >= todayKey).slice(0, 3);
  if (upcoming.length > 0) {
    return upcoming;
  }
  return days.slice(0, 3);
}

function renderNextOff(day, todayKey) {
  if (!day) {
    return `
      <strong>今月の休みなし</strong>
      <small></small>
    `;
  }
  const distance = daysBetween(todayKey, day.date);
  const relative = distance === 0 ? "今日" : distance === 1 ? "明日" : `あと${distance}日`;
  return `
    <strong>${escapeHtml(day.day)}日(${escapeHtml(day.weekday)})</strong>
    <small>${escapeHtml(relative)}</small>
  `;
}

function renderUpcomingDay(day) {
  return `
    <article class="upcoming-day ${escapeHtml(day.status)}">
      <div>
        <strong>${escapeHtml(day.day)}</strong>
        <span>${escapeHtml(day.weekday)}</span>
      </div>
      <p>${escapeHtml(formatShift(day))}</p>
    </article>
  `;
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00+09:00`);
  const end = new Date(`${endDate}T00:00:00+09:00`);
  return Math.max(0, Math.round((end - start) / 86400000));
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
