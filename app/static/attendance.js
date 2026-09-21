const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "—")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

let csrf = "";
let signOutTimer = null;
let employeeRecords = [];

async function refreshCsrf() {
  const response = await fetch("/api/csrf", { cache: "no-store" });
  csrf = (await response.json()).token;
}

// All attendance requests are explicitly pinned to the Slurry department.
async function api(url, options = {}) {
  options.headers = {
    ...(options.headers || {}),
    "X-CSRF-Token": csrf,
    "X-Department": "slurry",
  };
  let response = await fetch(url, options);
  if (response.status === 403 && response.headers.get("X-Session-Refresh")) {
    await refreshCsrf();
    options.headers["X-CSRF-Token"] = csrf;
    response = await fetch(url, options);
  }
  return response;
}

function say(message) {
  $("#status").textContent = message;
}

function table(headers, rows) {
  const heading = headers.map((value) => `<th>${esc(value)}</th>`).join("");
  return `<div class="table"><table><thead><tr>${heading}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

const halfHours = (start, end) => Array.from(
  { length: Math.round((end - start) * 2) + 1 },
  (_, index) => (start + index * 0.5).toFixed(1),
);

function fillSelect(select, values, { blank = false, custom = false } = {}) {
  const blankOption = blank ? '<option value="">None / 无</option>' : "";
  const choices = values.map((value) => `<option value="${value}">${value}</option>`).join("");
  const customOption = custom ? '<option value="custom">Custom / 自定义</option>' : "";
  select.innerHTML = `${blankOption}${choices}${customOption}`;
}

fillSelect($("#attendance-form [name='paid_break_hours']"), halfHours(0, 2));
fillSelect($("#attendance-form [name='total_hours']"), halfHours(3, 12));
fillSelect(
  $("#attendance-form [name='overtime_hours']"),
  halfHours(0.5, 3),
  { blank: true, custom: true },
);

function armSignOut(expiresAt) {
  clearTimeout(signOutTimer);
  const delay = Math.max(0, Number(expiresAt) * 1000 - Date.now());
  signOutTimer = setTimeout(async () => {
    await api("/api/attendance/logout", { method: "POST" });
    location.reload();
  }, delay);
}

function showEmployee(data) {
  // Missing reset state is treated as unsafe and forces PIN setup.
  const mustReset = Boolean(Number(data.employee.pin_reset_required));
  $("#employee-login").hidden = true;
  $("#employee-panel").hidden = false;
  $("#employee-name").textContent = `${data.employee.employee_name} (${data.employee.staffing_company})`;
  $("#first-login-pin-form").hidden = !mustReset;
  $("#attendance-entry").hidden = mustReset;

  if (Array.isArray(data.records)) employeeRecords = data.records;
  const rows = employeeRecords.map((row) => `
    <tr>
      <td>${esc(row.attendance_date)}</td>
      <td>${esc(row.login_timestamp || "Manager added / 管理员添加")}</td>
      <td>${esc(row.paid_break_hours)}</td>
      <td>${esc(row.total_hours)}</td>
      <td>${esc(row.overtime_hours)}</td>
    </tr>
  `);
  $("#employee-history").innerHTML = table(
    ["Date / 日期", "Login timestamp / 登录时间", "Paid break / 带薪休息", "Total hours / 总工时", "Overtime / 加班"],
    rows,
  );
  armSignOut(data.expires_at);
}

async function reloadEmployee() {
  const response = await fetch("/api/attendance/me", {
    headers: { "X-Department": "slurry" },
  });
  if (response.ok) showEmployee(await response.json());
}

$("#employee-login-form").onsubmit = async (event) => {
  event.preventDefault();
  const response = await api("/api/attendance/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
  });
  const data = await response.json();
  if (response.ok) showEmployee(data);
  say(data.error || "Signed in / 已登录");
};

$("#attendance-form [name='overtime_hours']").onchange = (event) => {
  const custom = $("#attendance-form [name='overtime_hours_custom']");
  custom.hidden = event.target.value !== "custom";
  custom.required = event.target.value === "custom";
  if (!custom.hidden) custom.focus();
};

$("#attendance-form").onsubmit = async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  if (payload.overtime_hours === "custom") {
    payload.overtime_hours = payload.overtime_hours_custom;
  }
  delete payload.overtime_hours_custom;

  const response = await api("/api/attendance/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  say(data.error || data.message);
  if (response.status === 401) return location.reload();
  if (response.ok) showEmployee(data);
};

$("#first-login-pin-form").onsubmit = async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  if (payload.new_pin !== payload.confirm_pin) {
    say("The new PIN and confirmation do not match. / 两次输入的新密码不一致。");
    return;
  }

  const response = await api("/api/attendance/reset-pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  say(data.error || "New PIN saved. / 新密码已保存。");
  if (response.status === 401) return location.reload();
  if (response.ok) {
    event.currentTarget.reset();
    showEmployee({...data, records: employeeRecords});
  }
};

$("#employee-logout").onclick = async () => {
  await api("/api/attendance/logout", { method: "POST" });
  location.reload();
};

(async () => {
  await Promise.all([refreshCsrf(), reloadEmployee()]);
})().catch(() => {
  say("Unable to reach the attendance server. / 无法连接考勤服务器。");
});
