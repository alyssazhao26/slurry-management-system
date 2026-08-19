const text = value => String(value ?? '—').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const percent = value => value === null || value === undefined ? 'Pending / 待补录' : `${(Number(value) * 100).toFixed(1)}%`;
const dateParam = new URLSearchParams(window.location.search).get('date');
const autoScroll = new URLSearchParams(window.location.search).get('autoscroll') === '1';
const fitScreen = new URLSearchParams(window.location.search).get('fit') === '1' && !autoScroll;
const taskLabels = {production: 'Production / 生产', cleaning: 'Cleaning / 清洁', custom: 'Custom / 自定义'};

if (autoScroll) document.body.classList.add('auto-scroll');

function fitDisplayToViewport() {
  if (!fitScreen) return;
  document.documentElement.style.zoom = '1';
  document.body.classList.add('fit-screen');
  const widthScale = window.innerWidth / document.documentElement.scrollWidth;
  const heightScale = window.innerHeight / document.documentElement.scrollHeight;
  document.documentElement.style.zoom = String(Math.min(widthScale, heightScale, 1));
}

function renderTask(task) {
  const items = task.task_items || [];
  const groups = ['cleaning', 'custom', 'production'].map(type => {
    const groupItems = items.filter(item => item.type === type);
    if (!groupItems.length) return '';
    const rows = groupItems.map((item, index) => {
      const detail = type === 'production' ? `Formula / 配方: ${text(item.formula_code)} · Amount / 所需数量: ${Number(item.amount_needed).toFixed(2)} tanks / 罐 · Machine / 设备: ${text(item.machine_assigned)}` : type === 'cleaning' ? `Process / 工艺: ${item.process_type === 'semi' ? 'Semi / 半自动' : 'Auto / 全自动'}` : text(item.description || '—');
      const heading = type === 'production' ? `Production / 生产 · ${text(item.machine_assigned)}` : text(item.description || taskLabels[type]);
      return `<li><strong>${heading}</strong><span>${detail}</span></li>`;
    }).join('');
    return `<section class="task-group"><h3>${taskLabels[type]}</h3><ul>${rows}</ul></section>`;
  }).join('');
  document.querySelector('#task-details').innerHTML = groups || '<p class="empty">No task saved for today / 今日暂无任务</p>';
}

function renderReminders(task) {
  const reminders = task?.reminders || [];
  document.querySelector('#display-reminders').innerHTML = reminders.length
    ? `<ul>${reminders.map(reminder => `<li>${text(reminder)}</li>`).join('')}</ul>`
    : '<p class="empty">No reminders for today / 今日暂无提醒</p>';
}

async function refreshDisplay() {
  try {
    const response = await fetch(`/api/public-display${dateParam ? `?date=${encodeURIComponent(dateParam)}` : ''}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    document.querySelector('#display-date').textContent = `${data.display_date} / 当日`;
    document.querySelector('#last-updated').textContent = data.last_updated ? `Last update / 最后更新: ${data.last_updated}` : 'No records yet / 暂无记录';
    renderTask(data.daily_task);
    renderReminders(data.daily_task);
    document.querySelector('#achievement-rate').textContent = percent(data.production.achievement_rate);
    document.querySelector('#qualified-rate').textContent = percent(data.production.qualified_rate);
    const productionDate = data.production.record_date || '—';
    const sameDay = `Production date: ${productionDate} / 生产日期`;
    document.querySelector('#achievement-note').textContent = sameDay;
    document.querySelector('#qualified-note').textContent = data.production.qualified_pending ? `${sameDay} · ${data.production.qualified_pending} pending / 待补录` : sameDay;
    document.querySelector('#event-detail-date').textContent = `${data.display_date} / 当日`;
    const trackerRows = data.event_tracker.map(event => `<tr><td>${text(event.machine_code)}</td><td>${text(event.machine_type === 'semi' ? 'Semi / 半自动' : event.machine_type === 'auto' ? 'Auto / 全自动' : '—')}</td><td>${text(event.event_type)}</td><td>${text(event.severity)}</td><td>${text(event.responsible_person)}</td><td class="${event.is_resolved === 'yes' ? 'status-resolved' : 'status-open'}">${event.is_resolved === 'yes' ? 'Resolved / 已解决' : 'Open / 进行中'}</td></tr>`).join('');
    document.querySelector('#event-tracker').innerHTML = trackerRows ? `<table class="display-table"><thead><tr><th>Machine / 设备</th><th>Process / 工艺</th><th>Event type / 事件类型</th><th>Severity / Priority / 严重程度 / 优先级</th><th>Responsible person / 责任人</th><th>Status / 状态</th></tr></thead><tbody>${trackerRows}</tbody></table>` : '<p class="empty">No events for this day / 当日暂无事件</p>';
    const ongoingRows = data.ongoing_events.map(event => `<article class="ongoing-item"><strong>${text(event.machine_code)} · ${text(event.event_type)}</strong><span>Severity / Priority / 严重程度 / 优先级: ${text(event.severity)}</span><span>Responsible person / 责任人: ${text(event.responsible_person)}</span><span>Expected finish / 预计完成: ${text(event.target_finish_date)}</span><span>Event date / 事件日期: ${text(event.event_date)}</span></article>`).join('');
    document.querySelector('#ongoing-events').innerHTML = ongoingRows || '<p class="empty">No ongoing events / 暂无进行中事件</p>';
    requestAnimationFrame(fitDisplayToViewport);
  } catch { document.querySelector('#last-updated').textContent = 'Display connection unavailable / 看板连接不可用'; }
}
refreshDisplay(); setInterval(refreshDisplay, 15000);
if (autoScroll) {
  setInterval(() => {
    const limit = document.documentElement.scrollHeight - window.innerHeight;
    if (limit <= 0) return;
    if (window.scrollY >= limit - 2) window.scrollTo(0, 0);
    else window.scrollBy(0, 1);
  }, 45);
}
if (fitScreen) window.addEventListener('resize', () => requestAnimationFrame(fitDisplayToViewport));
