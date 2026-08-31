const notice = document.querySelector('#notice');
const escapeHtml = value => String(value ?? '—')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');
const say = message => { notice.textContent = message; window.scrollTo({top: 0, behavior: 'smooth'}); };
const formReferenceDate = new Intl.DateTimeFormat('en-CA', {year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
document.querySelectorAll('[data-today-date]').forEach(element => { element.textContent = formReferenceDate; });

const rawFetch = window.fetch.bind(window);
let csrfToken = '';
let csrfRefresh = null;
function refreshCsrfToken() {
  if (csrfRefresh) return csrfRefresh;
  csrfRefresh = rawFetch('/api/csrf', {credentials: 'same-origin', cache: 'no-store'})
    .then(response => response.ok ? response.json() : Promise.reject(new Error('Secure session unavailable.')))
    .then(data => { csrfToken = data.token; return csrfToken; })
    .finally(() => { csrfRefresh = null; });
  return csrfRefresh;
}
const csrfReady = refreshCsrfToken().catch(() => say('Unable to establish a secure session. Refresh the page.'));
window.fetch = async (url, options = {}) => {
  await csrfReady;
  if (!csrfToken) await refreshCsrfToken();
  const request = async () => { const headers = new Headers(options.headers || {}); headers.set('X-CSRF-Token', csrfToken); return rawFetch(url, {...options, headers, credentials: 'same-origin'}); };
  let response = await request();
  if (response.status === 403 && response.headers.get('X-Session-Refresh') === 'required') { await refreshCsrfToken(); response = await request(); }
  return response;
};

let viewHistory = ['home'];
let viewHistoryIndex = 0;
let pendingManagerAction = null;
function openManagerWorkspace(){document.querySelector('#manager-workspace-dialog').showModal()}
function openManagerLogin(action=null){pendingManagerAction=action;const form=document.querySelector('#manager-login-form');form.reset();document.querySelector('#manager-login-status').textContent='';document.querySelector('#manager-login-dialog').showModal();queueMicrotask(()=>form.elements.pin.focus())}
document.querySelector('#manager-sign-in').addEventListener('click',()=>openManagerLogin());
document.querySelector('#close-manager-workspace').addEventListener('click',()=>document.querySelector('#manager-workspace-dialog').close());
document.querySelector('#close-manager-login').addEventListener('click',()=>document.querySelector('#manager-login-dialog').close());
document.querySelector('#manager-login-form').addEventListener('submit',async event=>{
  event.preventDefault();const status=document.querySelector('#manager-login-status');
  const response=await fetch('/api/manager/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:event.currentTarget.elements.pin.value})});const data=await response.json();
  if(!response.ok){status.textContent=data.error||'Manager sign-in failed. / 管理员登录失败。';return}
  if(data.csrf_token)csrfToken=data.csrf_token;status.textContent='Signed in. / 登录成功。';const action=pendingManagerAction;pendingManagerAction=null;setTimeout(()=>{document.querySelector('#manager-login-dialog').close();if(action)action();else openManagerWorkspace()},300);
});
document.querySelector('#workspace-sign-out').addEventListener('click',async()=>{const response=await fetch('/api/manager/logout',{method:'POST'});if(response.ok){await refreshCsrfToken();document.querySelector('#manager-workspace-dialog').close();say('Manager signed out. / 管理员已退出。')}});
document.querySelector('#manager-sign-out').addEventListener('click',async()=>{const response=await fetch('/api/manager/logout',{method:'POST'});if(response.ok){await refreshCsrfToken();document.querySelector('#manager-login-status').textContent='Signed out. / 已退出。'}});
document.querySelector('#create-manager-backup').addEventListener('click',async event=>{
  const button=event.currentTarget;const status=document.querySelector('#manager-backup-status');const originalText=button.textContent;
  button.disabled=true;button.textContent='Creating backup… / 正在备份…';status.textContent='';
  try{const response=await fetch('/api/manager/backup',{method:'POST'});const data=await response.json();status.textContent=response.ok?`${data.message} / 备份已完成并保存到服务器配置的备份文件夹。`:(data.error||'Backup failed. / 备份失败。')}
  catch(error){status.textContent='Backup failed. Check the server connection. / 备份失败，请检查服务器连接。'}
  finally{button.disabled=false;button.textContent=originalText}
});

function show(viewId, recordHistory = true) {
  const currentView = viewHistory[viewHistoryIndex];
  if (recordHistory && viewId !== currentView) {
    viewHistory = viewHistory.slice(0, viewHistoryIndex + 1);
    viewHistory.push(viewId);
    viewHistoryIndex += 1;
  }
  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
  document.querySelector(`#${viewId}`).classList.add('active');
  if (viewId === 'production-records') loadRecords('production', '#production-table');
  if (viewId === 'tracker') loadRecords('tracker', '#tracker-table', true);
  if (viewId === 'ongoing') loadRecords('ongoing', '#ongoing-table');
  if (viewId === 'daily-report') {
    const dateInput = document.querySelector('#report-date');
    if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  }
  if (viewId === 'production' || viewId === 'abnormality') {
    loadFields(viewId);
    applyStandardFieldSettings(viewId);
  }
  if (viewId === 'abnormality') loadEventTypes();
  if (viewId === 'home') { loadHomeTask(); loadHomeOngoing(); }
}

async function loadHomeTask() {
  try {
    const response = await fetch('/api/public-display');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const items = data.daily_task?.task_items || [];
    const labels = {production: 'Production / 生产', cleaning: 'Cleaning / 清洁', custom: 'Custom / 自定义'};
    const groups = ['cleaning', 'custom', 'production'].map(type => {
      const groupItems = items.filter(item => item.type === type);
      if (!groupItems.length) return '';
      const rows = groupItems.map((item, index) => {
        const details = item.type === 'production'
          ? `Formula / 配方: ${escapeHtml(item.formula_code)} · Amount / 数量: ${item.amount_needed ?? '—'} tanks / 罐 · Machine / 设备: ${escapeHtml(item.machine_assigned)}`
          : item.type === 'cleaning' ? `Process / 工艺: ${item.process_type === 'semi' ? 'Semi / 半自动' : 'Auto / 全自动'}` : escapeHtml(item.description || '—');
        const heading = item.type === 'production' ? `Production / 生产 · ${escapeHtml(item.machine_assigned || '—')}` : escapeHtml(item.description || labels[type]);
        return `<li><strong>${heading}</strong><span>${details}</span></li>`;
      }).join('');
      return `<section class="task-group"><h3>${labels[type]}</h3><ul class="task-bullets">${rows}</ul></section>`;
    }).join('');
    document.querySelector('#home-task-details').innerHTML = groups || '<p>No task saved / 暂无任务</p>';
    const branding = data.display_settings?.branding || {};
    document.querySelector('#brand-title').textContent = branding.title || 'GNEM Slurry Production Details / GNEM 制浆生产明细';
    const obsoleteSubtitle = document.querySelector('#brand-subtitle');
    if (obsoleteSubtitle) { obsoleteSubtitle.textContent = ''; obsoleteSubtitle.hidden = true; }
  } catch {
    document.querySelector('#home-task-details').innerHTML = '<p>Task unavailable / 任务不可用</p>';
  }
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => show(button.dataset.view)));

async function loadHomeOngoing() {
  const root = document.querySelector('#home-ongoing-list');
  const pendingRoot = document.querySelector('#home-pending-list');
  if (!root || !pendingRoot) return;
  try {
    const response = await fetch('/api/public-display');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const ongoing = data.ongoing_events || [];
    const pending = data.pending_qualifications || [];
    const formatDate = value => { const parts=String(value||'').split('-'); return parts.length===3?`${parts[1]}/${parts[2]}/${parts[0]}`:escapeHtml(value||'—'); };
    pendingRoot.innerHTML = pending.length
      ? pending.map(record => `<article class="home-pending-item"><strong>${formatDate(record.record_date)} · ${escapeHtml(record.formula_code)}</strong><span>Qualified amount pending / 合格数量待补录</span><small>Machine / 设备: ${escapeHtml(record.machine_code)} · Batch / 批次: ${escapeHtml(record.batch_number)} · Actual / 实际: ${escapeHtml(record.actual_quantity)}</small><form class="qualified-followup-form home-qualified-followup" data-id="${Number(record.id)}"><label>Qualified quantity / 合格数量<input name="qualified_quantity" type="number" min="0" max="${Number(record.actual_quantity)}" step=".01" required placeholder="Enter amount / 输入数量"></label><button class="primary">Save follow-up / 保存补录</button></form></article>`).join('')
      : `<p class="home-followup-empty">No pending records until ${formatDate(data.display_date)} / 截至 ${formatDate(data.display_date)} 无待补录记录</p>`;
    root.innerHTML = ongoing.length
      ? ongoing.map(event => `<article class="home-ongoing-item"><strong>${escapeHtml(event.machine_code || 'NA')} · ${escapeHtml(event.event_type)}</strong><span>Severity / Priority / 严重程度 / 优先级: ${escapeHtml(event.severity)}</span><span>Responsible person / 责任人: ${escapeHtml(event.responsible_person || 'Not set / 未设置')}</span><span>Expected finish / 预计完成: ${escapeHtml(event.target_finish_date || 'Not set / 未设置')}</span><span>Event date / 事件日期: ${escapeHtml(event.event_date)}</span><form class="ongoing-card-update home-event-close" data-id="${Number(event.id)}"><label>Actual finish date / 实际完成日期<input name="actual_finish_date" type="date" required></label><label>Solution provided / 解决方案<textarea name="solution_provided" required placeholder="Describe repair steps, changes, and verified result. / 请说明维修步骤、变更及验证结果。"></textarea></label><button class="primary">Close event / 关闭事件</button></form></article>`).join('')
      : '<p>No ongoing events / 暂无进行中事件</p>';
  } catch {
    root.innerHTML = '<p>Follow-up data unavailable / 跟进数据不可用</p>';
    pendingRoot.innerHTML = '<p>Pending record data unavailable / 待补录记录不可用</p>';
  }
}

function isFormControl(target) {
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"], .table-wrap, .display-table-wrap'));
}

function navigateViewedPage(step) {
  const nextIndex = viewHistoryIndex + step;
  if (nextIndex < 0 || nextIndex >= viewHistory.length) return;
  viewHistoryIndex = nextIndex;
  show(viewHistory[viewHistoryIndex], false);
  window.scrollTo({top: 0, behavior: 'smooth'});
}

let horizontalSwipeStart = null;
let lastHorizontalNavigation = 0;
document.addEventListener('touchstart', event => {
  if (event.touches.length === 1 && !isFormControl(event.target)) horizontalSwipeStart = event.touches[0].clientX;
}, {passive: true});
document.addEventListener('touchend', event => {
  if (horizontalSwipeStart === null || isFormControl(event.target)) return;
  const distance = event.changedTouches[0].clientX - horizontalSwipeStart;
  horizontalSwipeStart = null;
  if (Math.abs(distance) > 90) navigateViewedPage(distance > 0 ? -1 : 1);
}, {passive: true});
document.addEventListener('wheel', event => {
  if (isFormControl(event.target) || Math.abs(event.deltaX) < 90 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
  const now = Date.now();
  if (now - lastHorizontalNavigation < 650) return;
  lastHorizontalNavigation = now;
  navigateViewedPage(event.deltaX > 0 ? 1 : -1);
}, {passive: true});

function eventTimeFromForm(form) {
  const part = name => String(form.elements[name].value || '').replace(/\D/g, '');
  const [startHour, startMinute, endHour, endMinute] = ['start_hour', 'start_minute', 'end_hour', 'end_minute'].map(part);
  if (![startHour, startMinute, endHour, endMinute].every(value => /^\d{2}$/.test(value))) return null;
  if (Number(startHour) > 23 || Number(endHour) > 23 || Number(startMinute) > 59 || Number(endMinute) > 59) return null;
  return {start: `${startHour}:${startMinute}`, end: `${endHour}:${endMinute}`};
}

function calculateDowntime(range) {
  if (!range) return 0;
  const start = range.start;
  const end = range.end;
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (minutes < 0) minutes += 24 * 60;
  return minutes;
}

function renderInput(field) {
  const required = field.is_required ? 'required' : '';
  const key = escapeHtml(field.field_key), label = escapeHtml(field.label);
  let control = `<input name="${key}" ${required}>`;
  if (field.input_type === 'number') control = `<input type="number" step=".01" name="${key}" ${required}>`;
  if (field.input_type === 'date') control = `<input type="date" name="${key}" ${required}>`;
  if (field.input_type === 'textarea') control = `<textarea name="${key}" ${required}></textarea>`;
  if (field.input_type === 'select') {
    const options = Array.isArray(field.options_json) ? field.options_json : JSON.parse(field.options_json || '[]');
    control = `<select name="${key}" ${required}>${options.map(option => `<option>${escapeHtml(option)}</option>`).join('')}</select>`;
  }
  return `<label>${label}${control}</label>`;
}

async function loadCostFailureTypes(manager = false) {
  try {
    const response = await fetch('/api/cost-failure-types');
    const data = await response.json();
    if (!response.ok) { say(data.error || 'Unable to load cost-failure types / 无法加载成本失效类型。'); return; }

    const options = document.querySelector('#cost-failure-options');
    options.innerHTML = data.types.map(type => `
      <label class="checkbox-option">
        <input type="checkbox" name="cost_failure_types" value="${escapeHtml(type.type_code)}">
        <span>${escapeHtml(type.display_name)}</span>
      </label>
    `).join('');

    document.querySelector('#cost-guide-body').innerHTML = data.types.map(type => `
      <tr><td>${escapeHtml(type.display_name)}</td><td>${escapeHtml(type.definition)}</td></tr>
    `).join('');

    if (manager) {
      document.querySelector('#manager-cost-types').innerHTML = `<details class="manager-options-dropdown"><summary>Current cost-failure types / 当前成本失效类型 (${data.types.length})</summary>` + data.types.map(type => `
        <div class="manager-type-row">
          <div><strong>${escapeHtml(type.display_name)}</strong><small>${escapeHtml(type.definition)}</small></div>
          <button class="secondary deactivate-cost-type" data-code="${escapeHtml(type.type_code)}">Deactivate / 停用</button>
        </div>
      `).join('') + '</details>' || '<p class="empty">No active cost types.</p>';
    }
  } catch {
    say('Could not load cost-failure types. Apply pending database migrations. / 无法加载成本失效类型，请应用待处理的数据库迁移。');
  }
}

let managerEventTypes = [];
async function loadEventTypes(manager = false) {
  try {
    const response = await fetch('/api/event-types');
    const data = await response.json();
    if (!response.ok) { say(data.error || 'Unable to load event types.'); return; }
    const select = document.querySelector('#event-type');
    select.innerHTML = data.types.map(type => `<option value="${escapeHtml(type.event_value)}">${escapeHtml(type.display_name)}</option>`).join('');
    if (manager) {
      managerEventTypes = data.types;
      const selector = document.querySelector('#existing-event-type');
      selector.innerHTML = '<option value="">New event type / 新事件类型</option>' + data.types.map(type => `<option value="${escapeHtml(type.event_value)}">${escapeHtml(type.display_name)}</option>`).join('');
      document.querySelector('#manager-event-types').innerHTML = `<details class="manager-options-dropdown"><summary>Current event types / 当前事件类型 (${data.types.length})</summary>${data.types.map(type => `<div class="manager-type-row"><div><strong>${escapeHtml(type.display_name)}</strong><small>${escapeHtml(type.event_value)}</small></div><div><button class="secondary edit-event-type" data-value="${encodeURIComponent(type.event_value)}">Edit / 编辑</button><button class="secondary deactivate-event-type" data-value="${encodeURIComponent(type.event_value)}">Deactivate / 停用</button></div></div>`).join('')}</details>`;
    }
  } catch { say('Could not load event types. Apply pending database migrations.'); }
}

async function loadFields(formName) {
  try {
    const response = await fetch(`/api/forms/${formName}`);
    const data = await response.json();
    if (!response.ok) return;
    document.querySelector(`#${formName}-custom`).innerHTML = data.fields.map(renderInput).join('');
  } catch { say('Could not load configured fields. Check the server connection.'); }
}

function replaceLabelText(labelElement, text) {
  const textNode = [...labelElement.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (textNode) textNode.textContent = `${text} `;
}

function normaliseOptions(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try { return JSON.parse(value); } catch { return []; }
}

function optionMarkup(option) {
  const [value, label] = String(option).split('|', 2);
  return `<option value="${escapeHtml(value)}">${escapeHtml(label || value)}</option>`;
}

async function applyStandardFieldSettings(formKey) {
  try {
    const response = await fetch(`/api/forms/${formKey}/standard-fields`);
    const data = await response.json();
    if (!response.ok) return;
    const form = document.querySelector(`#${formKey}-form`);
    data.fields.forEach(field => {
      const control = form.querySelector(`[name="${field.field_key}"]`);
      if (!control) return;
      const label = control.closest('label');
      if (label) replaceLabelText(label, field.label);
      const options = normaliseOptions(field.options_json);
      if (field.is_configured && control.tagName === 'SELECT' && options.length && field.field_key !== 'event_type') {
        const priorValue = control.value;
        control.innerHTML = options.map(optionMarkup).join('');
        if ([...control.options].some(option => option.value === priorValue)) control.value = priorValue;
      }
      const defaultGuidance = {
        description: 'Use specific facts, and avoid entries such as “machine issue.” / 请填写具体事实，避免仅写“设备问题”。',
        immediate_action: 'Fill this only if unresolved. / 仅在问题未解决时填写此项。',
      };
      const guidance = field.help_text || defaultGuidance[field.field_key] || '';
      if (field.field_key === 'immediate_action') control.placeholder = 'Fill this only if unresolved. List the steps taken, by whom, and the immediate result. / 仅在问题未解决时填写此项。请列出采取的步骤、执行人及即时结果。';
      if (guidance) {
        let help = label?.querySelector('.standard-field-help');
        if (!help && label) { help = label.querySelector('small') || document.createElement('small'); help.className = 'standard-field-help'; if (!help.parentElement) label.append(help); }
        if (help) help.textContent = guidance;
      }
    });
  } catch { /* the normal form labels remain available if settings are unavailable */ }
}

function renderTable(target, rows, fields, tracker = false, pagination = null) {
  const root = document.querySelector(target);
  if (!rows.length) { root.innerHTML = '<p class="empty">No records yet.</p>'; return; }
  const productionFollowup = target === '#production-table';
  const editableType = productionFollowup ? 'production' : tracker ? 'abnormality' : null;
  const headers = fields.map(field => `<th>${escapeHtml(field.label)}</th>`).join('') + (tracker ? '<th>Follow-up / 跟进</th>' : '') + (productionFollowup ? '<th>Qualified follow-up / 合格数量补充</th>' : '') + (editableType ? '<th>Edit / 编辑</th>' : '');
  const body = rows.map(row => {
    const cells = fields.map(field => {
      let value = field.key.endsWith('_rate') && row[field.key] !== null && row[field.key] !== undefined
        ? `${(Number(row[field.key]) * 100).toFixed(1)}%`
        : row[field.key];
      if (field.key === 'qualified_pending') value = Number(value) ? '<span class="pending-badge">Pending / 待补录</span>' : 'Complete / 已完成';
      if (value === null || value === undefined || value === '') value = '—';
      return `<td>${field.key === 'qualified_pending' ? value : escapeHtml(value)}</td>`;
    }).join('');
    const updateButton = tracker
      ? `<td>${row.state === 'open' && row.is_resolved === 'no' ? `<button type="button" class="secondary tracker-edit" data-id="${Number(row.id)}" data-date="${escapeHtml(row.event_date)}" data-start="${escapeHtml(row.start_time || '')}" data-end="${escapeHtml(row.end_time || '')}" data-shift="${escapeHtml(row.shift_name || '')}" data-machine="${escapeHtml(row.machine_code)}" data-process="${escapeHtml(row.machine_type || '')}" data-event="${escapeHtml(row.event_type)}" data-severity="${escapeHtml(row.severity || '')}" data-description="${escapeHtml(row.description || '')}" data-immediate-action="${escapeHtml(row.immediate_action || '')}" data-responsible="${escapeHtml(row.responsible_person || '')}" data-target-date="${escapeHtml(row.target_finish_date || '')}" data-actual-date="${escapeHtml(row.actual_finish_date || '')}">Update / 跟进</button>` : '<span class="resolved-label">Completed / 已完成</span>'}</td>`
      : '';
    const followupButton = productionFollowup
      ? `<td>${Number(row.qualified_pending) ? `<button class="secondary qualified-followup" data-id="${Number(row.id)}" data-date="${escapeHtml(row.record_date)}" data-machine="${escapeHtml(row.machine_code)}">Add qualified result / 补充合格数量</button>` : '—'}</td>`
      : '';
    const editButton = editableType ? `<td><button type="button" class="secondary manager-edit-row" data-record-type="${editableType}" data-record-id="${Number(row.id)}">Edit / 编辑</button></td>` : '';
    return `<tr>${cells}${updateButton}${followupButton}${editButton}</tr>`;
  }).join('');
  let controls = '';
  if (pagination) {
    const first = (pagination.page - 1) * pagination.pageSize + 1;
    const last = Math.min(pagination.page * pagination.pageSize, pagination.total);
    controls = `<div class="pagination"><span>Showing ${first}-${last} of ${pagination.total} records / 显示 ${first}-${last}，共 ${pagination.total} 条</span>
      <div><button class="secondary record-page" data-type="${pagination.type}" data-page="${pagination.page - 1}" ${pagination.page === 1 ? 'disabled' : ''}>Previous / 上一页</button>
      <button class="secondary record-page" data-type="${pagination.type}" data-page="${pagination.page + 1}" ${last >= pagination.total ? 'disabled' : ''}>Next / 下一页</button></div></div>`;
  }
  root.innerHTML = `<div class="table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></div>${controls}`;
}

function renderOngoingCards(rows, pagination) {
  const root = document.querySelector('#ongoing-table');
  if (!rows.length) { root.innerHTML = '<p class="empty">No ongoing events / 没有进行中事件。</p>'; return; }
  const cards = rows.map(row => {
    const time = row.start_time && row.end_time ? `${row.start_time} to ${row.end_time}` : '—';
    const processType = row.machine_type === 'semi' ? 'Semi / 半自动' : row.machine_type === 'auto' ? 'Auto / 全自动' : 'Not recorded / 未记录';
    return `<article class="ongoing-card">
      <div class="ongoing-card-head"><div><span class="event-id">Event #${Number(row.id)}</span><h2>${escapeHtml(row.event_type)}</h2></div><span class="open-badge">Open / 进行中</span></div>
      <div class="ongoing-details"><div><span>Date / 日期</span><strong>${escapeHtml(row.event_date)}</strong></div><div><span>Time / 时间</span><strong>${escapeHtml(time)}</strong></div><div><span>Machine / 设备</span><strong>${escapeHtml(row.machine_code)}</strong></div><div><span>Process type / 工艺类型</span><strong>${escapeHtml(processType)}</strong></div><div><span>Event type / 事件类型</span><strong>${escapeHtml(row.event_type)}</strong></div><div><span>Severity / Priority / 严重程度 / 优先级</span><strong>${escapeHtml(row.severity)}</strong></div><div><span>Responsible person / 责任人</span><strong>${escapeHtml(row.responsible_person)}</strong></div><div><span>Expected finish / 预计完成</span><strong>${escapeHtml(row.target_finish_date)}</strong></div></div>
      <form class="ongoing-card-update" data-id="${Number(row.id)}"><label>Actual finish date / 实际完成日期<input name="actual_finish_date" type="date" value="${escapeHtml(row.actual_finish_date || '')}" required></label><label>Solution provided / 解决方案<textarea name="solution_provided" required placeholder="Describe repair steps, changes, and verified result. / 请说明维修步骤、变更及验证结果。">${escapeHtml(row.solution_provided || '')}</textarea></label><button class="primary">Close event / 关闭事件</button><small>Saving both fields closes this event and removes it from this list. / 同时保存两项后，事件将关闭并从此列表移除。</small></form>
    </article>`;
  }).join('');
  const first = (pagination.page - 1) * pagination.pageSize + 1;
  const last = Math.min(pagination.page * pagination.pageSize, pagination.total);
  root.innerHTML = `${cards}<div class="pagination"><span>Showing ${first}-${last} of ${pagination.total} records / 显示 ${first}-${last}，共 ${pagination.total} 条</span><div><button class="secondary record-page" data-type="ongoing" data-page="${pagination.page - 1}" ${pagination.page === 1 ? 'disabled' : ''}>Previous / 上一页</button><button class="secondary record-page" data-type="ongoing" data-page="${pagination.page + 1}" ${last >= pagination.total ? 'disabled' : ''}>Next / 下一页</button></div></div>`;
}

const recordColumns = {
  production: [
    ['record_date', 'Date'], ['shift_name', 'Shift'], ['machine_code', 'Machine'],
    ['formula_code', 'Formula'], ['batch_number', 'Batch'], ['planned_quantity', 'Plan'],
    ['actual_quantity', 'Actual'], ['qualified_quantity', 'Qualified'], ['qualified_pending', 'Qualification status / 合格状态'],
    ['achievement_rate', 'Achievement rate / 达成率'], ['qualified_rate', 'Qualified rate / 合格率'],
    ['created_at', 'Saved'],
  ],
  tracker: [
    ['id', 'ID'], ['event_date', 'Date / 日期'], ['machine_code', 'Machine / 设备'], ['machine_type', 'Process type / 工艺类型'],
    ['event_type', 'Event type'], ['severity', 'Severity / Priority'], ['responsible_person', 'Responsible person'],
    ['target_finish_date', 'Expected finish'], ['actual_finish_date', 'Actual finish'],
    ['state', 'Status'],
  ],
  analysis: [
    ['source_type', 'Source'], ['source_id', 'Record'], ['severity', 'Severity'],
    ['summary', 'Rule-based analysis'], ['status', 'Status'],
  ],
  ongoing: [
    ['id', 'ID'], ['event_date', 'Date / 日期'], ['start_time', 'Start / 开始'],
    ['end_time', 'End / 结束'], ['machine_code', 'Machine / 设备'], ['machine_type', 'Process type / 工艺类型'],
    ['event_type', 'Event type / 事件类型'], ['severity', 'Severity / Priority / 严重程度 / 优先级'],
    ['is_resolved', 'Resolved? / 已解决？'],
    ['effective_time_cost', 'Time cost? / 时间成本？'], ['effectiveness', 'Effectiveness / 有效性'],
    ['actual_finish_date', 'Actual finish / 实际完成'], ['solution_provided', 'Solution / 解决方案'],
    ['state', 'Status / 状态'],
  ],
  abnormality: [
    ['event_date', 'Date'], ['shift_name', 'Shift'], ['machine_code', 'Machine'],
    ['event_type', 'Event type'], ['severity', 'Severity / Priority'], ['responsible_person', 'Responsible person'], ['duration_minutes', 'Downtime'],
    ['description', 'Description'], ['created_at', 'Saved'],
  ],
};
const recordTargets = {
  production: '#production-table', tracker: '#tracker-table', ongoing: '#ongoing-table',
  abnormality: '#abnormality-table', analysis: '#analysis-table',
};

function recordFilters(type) {
  const root = document.querySelector(`[data-history-filters="${type}"]`);
  if (!root) return {};
  return {
    date: root.querySelector('[name="date"]').value,
    machine: root.querySelector('[name="machine"]').value.trim(),
  };
}

async function loadRecords(type, target = recordTargets[type], tracker = false, page = 1) {
  try {
    const query = new URLSearchParams({page, page_size: 50, ...recordFilters(type)});
    [...query.entries()].forEach(([key, value]) => { if (!value) query.delete(key); });
    const response = await fetch(`/api/records/${type}?${query}`), data = await response.json();
    if (!response.ok) { say(data.error || 'Unable to load records.'); return; }
    const pagination = {
      type, page: data.page, pageSize: data.page_size, total: data.total,
    };
    if (type === 'ongoing') renderOngoingCards(data.records, pagination);
    else renderTable(target, data.records, recordColumns[type].map(([key, label]) => ({key, label})), tracker, pagination);
  } catch { say('Could not reach the factory server.'); }
}

function renderReportTable(target, rows, columns) {
  const root = document.querySelector(target);
  if (!rows.length) {
    root.innerHTML = '<p class="empty">No records for this date / 此日期没有记录。</p>';
    return;
  }
  const headers = columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('');
  const body = rows.map(row => `<tr class="${row.is_resolved === 'no' ? 'unresolved' : ''}">${columns.map(([key]) => {
    const value = key.endsWith('_rate') && row[key] !== null && row[key] !== undefined ? `${(Number(row[key]) * 100).toFixed(1)}%` : row[key];
    return `<td>${escapeHtml(value)}</td>`;
  }).join('')}</tr>`).join('');
  root.innerHTML = `<div class="table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const reportColumnDefinitions = {
  production: [
    ['record_date','Date / 日期'],['shift_name','Shift / 班次'],['machine_code','Machine / 设备'],['formula_code','Formula / 配方'],['batch_number','Batch / 批次'],['planned_quantity','Plan / 计划'],['actual_quantity','Actual / 实际'],['qualified_quantity','Qualified / 合格'],['achievement_rate','Achievement rate / 达成率'],['qualified_rate','Qualified rate / 合格率'],['notes','Notes / 备注'],['created_at','Saved time / 保存时间'],
  ],
  events: [
    ['event_date','Date / 日期'],['event_time','Time / 时间'],['duration_minutes','Duration (minutes) / 持续时间（分钟）'],['shift_name','Shift / 班次'],['machine_code','Machine / 设备'],['machine_type','Process type / 工艺类型'],['event_type','Event type / 事件类型'],['severity','Severity / 严重程度'],['description','What happened / 事件描述'],['immediate_action','Immediate action / 立即措施'],['is_resolved','Resolved? / 已解决？'],['responsible_person','Responsible person / 责任人'],['target_finish_date','Expected finish / 预计完成'],['actual_finish_date','Actual finish / 实际完成'],['solution_provided','Solution / 解决方案'],['effectiveness','Effectiveness / 有效性'],
  ],
};
const defaultReportColumns = {
  production: new Set(['shift_name','machine_code','formula_code','batch_number','planned_quantity','actual_quantity','qualified_quantity','achievement_rate','qualified_rate']),
  events: new Set(['machine_type','event_time','event_type','description','is_resolved','responsible_person','target_finish_date','actual_finish_date']),
};
function initialiseReportColumnPicker() {
  [['production','#production-report-columns'],['events','#event-report-columns']].forEach(([group, selector]) => {
    const root = document.querySelector(selector);
    if (!root) return;
    root.innerHTML = reportColumnDefinitions[group].map(([key,label]) => `<label><input type="checkbox" value="${escapeHtml(key)}" ${defaultReportColumns[group].has(key) ? 'checked' : ''}>${escapeHtml(label)}</label>`).join('');
  });
}
function selectedReportColumns(group) {
  const id = group === 'production' ? 'production-report-columns' : 'event-report-columns';
  const root = document.querySelector(`#${id}`);
  if (!root) return reportColumnDefinitions[group].filter(([key]) => defaultReportColumns[group].has(key));
  const selected = new Set([...root.querySelectorAll('input:checked')].map(input => input.value));
  return reportColumnDefinitions[group].filter(([key]) => selected.has(key));
}
initialiseReportColumnPicker();

async function loadDailyReport() {
  const dateInput = document.querySelector('#report-date');
  if (!dateInput.value) {
    say('Choose a report date / 请选择报告日期。');
    return;
  }
  try {
    const response = await fetch(`/api/daily-report?date=${encodeURIComponent(dateInput.value)}`);
    const data = await response.json();
    if (!response.ok) {
      say(data.error || 'Unable to generate report / 无法生成报告。');
      return;
    }
    document.querySelector('#report-date-label').textContent = `Report date / 报告日期: ${data.report_date}`;
    const productionColumns = selectedReportColumns('production'), eventColumns = selectedReportColumns('events');
    if (!productionColumns.length || !eventColumns.length) { say('Select at least one Production column and one Event column. / 生产数据和事件明细请各选择至少一列。'); return; }
    renderReportTable('#report-production', data.production, productionColumns);
    renderReportTable('#report-events', data.events, eventColumns);
    document.querySelector('#report-sheet').hidden = false;
  } catch {
    say('Could not generate report. Check server setup and pending migrations. / 无法生成报告，请检查服务器设置和待处理迁移。');
  }
}

function formPayload(form) {
  const all = Object.fromEntries(new FormData(form));
  if (form.id === 'production-form') {
    all.formula_code = all.formula_code === 'custom' ? String(all.custom_formula || '').trim().toUpperCase() : all.formula_code;
  }
  if (form.id === 'abnormality-form') {
    const range = eventTimeFromForm(form);
    if (!range) return null;
    all.start_time = range.start;
    all.end_time = range.end;
    all.duration_minutes = calculateDowntime(range);
  }
  const fixed = form.id === 'production-form'
    ? ['record_date','shift_name','machine_code','formula_code','custom_formula','batch_number','planned_quantity','actual_quantity','qualified_quantity','notes']
    : [
      'event_date', 'start_hour', 'start_minute', 'end_hour', 'end_minute', 'start_time', 'end_time', 'shift_name', 'machine_code', 'machine_type', 'event_type',
      'severity', 'duration_minutes', 'is_resolved', 'responsible_person', 'target_finish_date', 'effective_time_cost', 'potential_cost',
      'description', 'immediate_action',
    ];
  const custom_fields = {};
  Object.entries(all).forEach(([key, value]) => { if (!fixed.includes(key)) custom_fields[key] = value; });
  const costFailureTypes = [...form.querySelectorAll('[name="cost_failure_types"]:checked')]
    .map(option => option.value);
  return {...all, cost_failure_types: costFailureTypes, custom_fields};
}
async function submitRecord(form, path) {
  const submitButton = form.querySelector('button[type="submit"], button:not([type])');
  if (submitButton?.disabled) return;
  try {
    const payload = formPayload(form);
    if (!payload) { say('Enter a valid 24-hour event time: HH:MM - HH:MM. / 请输入有效的24小时事件时间。'); return; }
    sessionStorage.setItem(`gnem-draft:${form.id}`, JSON.stringify(payload));
    if (submitButton) { submitButton.disabled = true; submitButton.dataset.originalText = submitButton.textContent; submitButton.textContent = 'Saving… / 正在保存…'; }
    const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
    const data = await response.json();
    if (!response.ok) { say(data.error || 'Record was not saved.'); return; }
    sessionStorage.removeItem(`gnem-draft:${form.id}`); form.reset();
    say(`${data.message} It is now available in the record history.`);
  } catch { say('Cannot reach the factory server. Your draft remains in this tab; submit again when the connection returns.'); }
  finally { if (submitButton) { submitButton.disabled = false; submitButton.textContent = submitButton.dataset.originalText || 'Save'; } }
}
document.querySelector('#production-form').addEventListener('submit', event => {
  event.preventDefault();
  submitRecord(event.currentTarget, '/api/production-records');
});
document.querySelector('#abnormality-form').addEventListener('submit', event => {
  event.preventDefault();
  submitRecord(event.currentTarget, '/api/abnormality-reports');
});
document.querySelector('#formula-code').addEventListener('change', event => {
  const custom = event.currentTarget.value === 'custom';
  const field = document.querySelector('#custom-formula-field');
  field.hidden = !custom;
  field.querySelector('input').required = custom;
  if (!custom) field.querySelector('input').value = '';
});
document.querySelector('[name="custom_formula"]').addEventListener('input', event => {
  event.currentTarget.value = event.currentTarget.value.toUpperCase();
});
document.querySelectorAll('.time-part').forEach((input, index, parts) => input.addEventListener('input', event => {
  event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '').slice(0, 2);
  if (event.currentTarget.value.length === 2 && parts[index + 1]) parts[index + 1].focus();
}));
function updateUnresolvedRequirements() {
  const form = document.querySelector('#abnormality-form');
  const required = form.elements.is_resolved.value === 'no';
  form.elements.responsible_person.required = required;
  form.elements.target_finish_date.required = required;
  form.elements.immediate_action.required = required;
  if (!required) form.elements.target_finish_date.value = formReferenceDate;
}
document.querySelector('#abnormality-form [name="is_resolved"]').addEventListener('change', updateUnresolvedRequirements);
updateUnresolvedRequirements();
document.addEventListener('submit', async event => {
  if (!event.target.classList.contains('ongoing-card-update')) return;
  event.preventDefault();
  const form = new FormData(event.target);
  const reportId = event.target.dataset.id;
  const payload = {actual_finish_date: form.get('actual_finish_date'), solution_provided: form.get('solution_provided')};
  try {
    const response = await fetch(`/api/abnormality-reports/${reportId}/tracker`, {
      method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) { say(data.error || 'Event could not be closed.'); return; }
    say(data.closed ? 'Event closed and removed from ongoing events. / 事件已关闭并从进行中列表移除。' : data.message);
    await loadRecords('ongoing', '#ongoing-table');
    await loadHomeOngoing();
  } catch { say('Could not reach the factory server. The event was not closed.'); }
});

function ensureTrackerUpdateDialog() {
  let dialog = document.querySelector('#tracker-update-dialog');
  if (dialog) return dialog;
  const legacyPanel = document.querySelector('#tracker-update-panel');
  if (legacyPanel) legacyPanel.remove();
  dialog = document.createElement('dialog');
  dialog.id = 'tracker-update-dialog';
  dialog.className = 'tracker-update-dialog';
  dialog.setAttribute('aria-labelledby', 'tracker-update-title');
  const panel = document.createElement('div');
  panel.id = 'tracker-update-panel';
  panel.setAttribute('aria-live', 'polite');
  dialog.append(panel);
  document.body.append(dialog);
  return dialog;
}

document.addEventListener('click', event => {
  const button = event.target.closest('.tracker-edit');
  if (!button) return;
  const dialog = ensureTrackerUpdateDialog();
  const panel = document.querySelector('#tracker-update-panel');
  const process = button.dataset.process === 'semi' ? 'Semi / 半自动' : button.dataset.process === 'auto' ? 'Auto / 全自动' : button.dataset.process || '—';
  const time = button.dataset.start || button.dataset.end ? `${button.dataset.start || '—'} – ${button.dataset.end || '—'}` : '—';
  panel.innerHTML = `<div class="tracker-update-head"><div><span class="event-id">Event #${Number(button.dataset.id)}</span><h2 id="tracker-update-title">Event follow-up / 事件跟进</h2><p>${escapeHtml(button.dataset.machine)} · ${escapeHtml(button.dataset.event)}</p></div><button type="button" class="secondary close-tracker-update">Close / 关闭</button></div><section class="tracker-event-summary" aria-label="Event being updated / 正在跟进的事件"><div><span>Date / 日期</span><strong>${escapeHtml(button.dataset.date)}</strong></div><div><span>Time / 时间</span><strong>${escapeHtml(time)}</strong></div><div><span>Shift / 班次</span><strong>${escapeHtml(button.dataset.shift)}</strong></div><div><span>Machine / 设备</span><strong>${escapeHtml(button.dataset.machine)}</strong></div><div><span>Process / 工艺</span><strong>${escapeHtml(process)}</strong></div><div><span>Event type / 事件类型</span><strong>${escapeHtml(button.dataset.event)}</strong></div><div><span>Severity / 严重程度</span><strong>${escapeHtml(button.dataset.severity)}</strong></div><div class="summary-wide"><span>What happened / 发生了什么</span><strong>${escapeHtml(button.dataset.description)}</strong></div><div class="summary-wide"><span>Immediate action / 立即措施</span><strong>${escapeHtml(button.dataset.immediateAction)}</strong></div></section><form class="form-grid tracker-update-form" data-id="${Number(button.dataset.id)}"><label>Responsible person / 责任人<input name="responsible_person" value="${escapeHtml(button.dataset.responsible)}"></label><label>Expected finish / 预计完成<input name="target_finish_date" type="date" value="${escapeHtml(button.dataset.targetDate)}"></label><label>Actual finish date / 实际完成日期<input name="actual_finish_date" type="date" value="${escapeHtml(button.dataset.actualDate)}" required></label><label class="tracker-solution">Solution provided / 解决方案<textarea name="solution_provided" required placeholder="Describe repair steps, parts or settings changed, and how the result was verified. / 请说明维修步骤、零件或设置变更以及验证结果。"></textarea></label><div class="tracker-update-actions"><button class="primary">Save and close event / 保存并关闭事件</button><small>Actual finish date and solution are required. / 必须填写实际完成日期和解决方案。</small></div></form>`;
  dialog.showModal();
});
document.addEventListener('click', event => {
  if (!event.target.closest('.close-tracker-update')) return;
  const dialog = ensureTrackerUpdateDialog(); dialog.close(); document.querySelector('#tracker-update-panel').innerHTML = '';
});
document.addEventListener('submit', async event => {
  if (!event.target.classList.contains('tracker-update-form')) return;
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"], button:not([type])');
  if (button.disabled) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/abnormality-reports/${event.target.dataset.id}/tracker`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});
    const data = await response.json();
    if (!response.ok) { say(data.error || 'Event follow-up could not be updated.'); return; }
    say('Event follow-up saved and event closed. / 事件跟进已保存并关闭。');
    const dialog = ensureTrackerUpdateDialog(); dialog.close(); document.querySelector('#tracker-update-panel').innerHTML = '';
    await loadRecords('tracker', '#tracker-table', true);
    await loadRecords('ongoing', '#ongoing-table');
    await loadHomeOngoing();
  } catch { say('Could not reach the factory server. The event was not updated.'); }
  finally { button.disabled = false; }
});

document.querySelectorAll('.refresh').forEach(button => {
  button.addEventListener('click', () => {
    loadRecords(button.dataset.type, button.dataset.target, button.dataset.type === 'tracker');
  });
});
document.querySelectorAll('.history-filter').forEach(control => control.addEventListener('change', event => {
  const type = event.currentTarget.closest('[data-history-filters]').dataset.historyFilters;
  loadRecords(type, recordTargets[type], type === 'tracker');
}));
document.addEventListener('click', event => {
  if (!event.target.classList.contains('record-page') || event.target.disabled) return;
  const type = event.target.dataset.type;
  loadRecords(type, recordTargets[type], type === 'tracker', Number(event.target.dataset.page));
});
document.addEventListener('click', event => {
  if (!event.target.classList.contains('qualified-followup')) return;
  const panel = document.querySelector('#production-followup-panel');
  panel.hidden = false;
  panel.innerHTML = `<h2>Qualified quantity follow-up / 合格数量补充</h2><p>Production date: ${escapeHtml(event.target.dataset.date)} · Machine: ${escapeHtml(event.target.dataset.machine)}</p><form class="qualified-followup-form" data-id="${Number(event.target.dataset.id)}"><label>Qualified quantity / 合格数量<input name="qualified_quantity" type="number" min="0" step=".01" required></label><button class="primary">Save qualified result / 保存合格数量</button><button class="secondary cancel-followup" type="button">Cancel / 取消</button></form>`;
  panel.scrollIntoView({behavior: 'smooth', block: 'nearest'});
});
document.addEventListener('click', event => {
  if (!event.target.classList.contains('cancel-followup')) return;
  const panel = document.querySelector('#production-followup-panel');
  panel.hidden = true; panel.innerHTML = '';
});
document.addEventListener('submit', async event => {
  if (!event.target.classList.contains('qualified-followup-form')) return;
  event.preventDefault();
  try {
    const response = await fetch(`/api/production-records/${event.target.dataset.id}/qualification`, {
      method: 'PATCH', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(Object.fromEntries(new FormData(event.target))),
    });
    const data = await response.json();
    if (!response.ok) { say(data.error || 'Qualified quantity could not be updated.'); return; }
    say('Qualified quantity updated. / 合格数量已更新。');
    const panel = document.querySelector('#production-followup-panel');
    panel.hidden = true; panel.innerHTML = '';
    await loadRecords('production', '#production-table');
    await loadHomeOngoing();
  } catch { say('Could not reach the factory server.'); }
});
document.querySelector('#generate-report').addEventListener('click', loadDailyReport);
document.querySelectorAll('.copy').forEach(button => button.addEventListener('click', async () => {
  const table = document.querySelector(`#${button.dataset.copy} table`);
  if (!table) { say('Load records first, then copy the table.'); return; }
  try { await navigator.clipboard.writeText(table.innerText); say('Table copied. You can paste it into Excel or another approved tool.'); }
  catch { say('Clipboard access was blocked by this browser. Select the table and copy it manually.'); }
}));

const taskMachineOptions = ['J1','J2','J3','J4','J5','J6','J7','J8','J9','J10-1','J10-2','J10-3','J10-4','J10-5'];
function homeTaskItemMarkup(item = {type: 'cleaning'}) {
  const standardFormula = ['K1-26', 'B1-1', 'E3'].includes(item.formula_code) ? item.formula_code : (item.formula_code ? 'CUSTOM' : '');
  const machines = taskMachineOptions.map(machine => `<option ${item.machine_assigned === machine ? 'selected' : ''}>${machine}</option>`).join('');
  return `<article class="task-item"><div class="task-item-head"><strong>Task item / 任务项</strong><button type="button" class="secondary remove-task-item">Remove / 删除</button></div>
    <label>Task type / 任务类型<select class="task-item-type"><option value="cleaning" ${item.type === 'cleaning' ? 'selected' : ''}>Cleaning / 清洁</option><option value="custom" ${item.type === 'custom' ? 'selected' : ''}>Custom / 自定义</option><option value="production" ${item.type === 'production' ? 'selected' : ''}>Production / 生产</option></select></label>
    <label class="task-item-description">Task name / 任务名称<input class="task-item-description-input" maxlength="255" value="${escapeHtml(item.description || '')}" placeholder="Describe this task / 填写任务名称"></label>
    <label class="task-cleaning-process" hidden>Cleaning process / 清洁类型<select class="task-item-process"><option value="">Select type / 选择类型</option><option value="semi" ${item.process_type === 'semi' ? 'selected' : ''}>Semi / 半自动</option><option value="auto" ${item.process_type === 'auto' ? 'selected' : ''}>Auto / 全自动</option></select></label>
    <div class="task-production-fields"><label>Formula / 配方<select class="task-item-formula"><option value="">Select formula / 选择配方</option><option ${standardFormula === 'K1-26' ? 'selected' : ''}>K1-26</option><option ${standardFormula === 'B1-1' ? 'selected' : ''}>B1-1</option><option ${standardFormula === 'E3' ? 'selected' : ''}>E3</option><option value="CUSTOM" ${standardFormula === 'CUSTOM' ? 'selected' : ''}>Custom / 自定义</option></select></label><label class="task-item-custom-formula" hidden>Custom formula / 自定义配方<input maxlength="50" value="${standardFormula === 'CUSTOM' ? escapeHtml(item.formula_code) : ''}"></label><label>Amount needed / 所需数量（罐）<input class="task-item-amount" type="number" min="0" step="0.01" value="${item.amount_needed ?? ''}" placeholder="0.00"></label><label>Machine assigned / 分配设备<select class="task-item-machine"><option value="">Select machine / 选择设备</option>${machines}</select></label></div>
  </article>`;
}
function syncHomeTaskItem(item) {
  const type = item.querySelector('.task-item-type').value;
  item.querySelector('.task-production-fields').hidden = type !== 'production';
  item.querySelector('.task-item-description').hidden = type === 'production';
  item.querySelector('.task-cleaning-process').hidden = type !== 'cleaning';
  item.querySelector('.task-item-custom-formula').hidden = type !== 'production' || item.querySelector('.task-item-formula').value !== 'CUSTOM';
}
function refreshHomeTaskItems() { document.querySelectorAll('.task-item').forEach(syncHomeTaskItem); }
async function fillHomeTaskEditor() {
  const response = await fetch('/api/public-display'); const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load today’s task.');
  const items = data.daily_task?.task_items || []; const root = document.querySelector('#home-task-items');
  root.innerHTML = (items.length ? items : [{type: 'cleaning'}]).map(homeTaskItemMarkup).join('');
  document.querySelector('#home-reminders').value = (data.daily_task?.reminders || []).join('\n');
  refreshHomeTaskItems();
}

document.querySelector('#edit-home-task').addEventListener('click', async () => {
  try { await fillHomeTaskEditor(); document.querySelector('#home-task-dialog').showModal(); }
  catch (error) { say(error.message); }
});
document.querySelector('#close-home-task').addEventListener('click', () => document.querySelector('#home-task-dialog').close());
document.querySelector('#add-home-task-item').addEventListener('click', () => { document.querySelector('#home-task-items').insertAdjacentHTML('beforeend', homeTaskItemMarkup()); refreshHomeTaskItems(); });
document.querySelector('#home-task-items').addEventListener('change', refreshHomeTaskItems);
document.querySelector('#home-task-items').addEventListener('click', event => { if (event.target.classList.contains('remove-task-item')) { event.target.closest('.task-item').remove(); } });
document.querySelector('#home-daily-task-form').addEventListener('submit', async event => {
  event.preventDefault();
  const taskItems = [...document.querySelectorAll('.task-item')].map(item => { const formula = item.querySelector('.task-item-formula').value === 'CUSTOM' ? item.querySelector('.task-item-custom-formula input').value : item.querySelector('.task-item-formula').value; return {type: item.querySelector('.task-item-type').value, description: item.querySelector('.task-item-description-input').value, process_type: item.querySelector('.task-item-process').value, formula_code: formula, amount_needed: item.querySelector('.task-item-amount').value, machine_assigned: item.querySelector('.task-item-machine').value}; });
  const reminders = document.querySelector('#home-reminders').value.split('\n').map(value => value.trim()).filter(Boolean);
  const payload = {task_items: taskItems, reminders};
  const response = await fetch('/api/daily-task', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
  const data = await response.json(), status = document.querySelector('#home-daily-task-status');
  status.textContent = response.ok ? `${data.message} / 今日任务已保存。` : data.error;
  if (response.ok) { await loadHomeTask(); setTimeout(() => document.querySelector('#home-task-dialog').close(), 700); }
});

const costGuide = document.querySelector('#cost-guide-dialog');
document.querySelector('#open-cost-guide').addEventListener('click', async () => {
  await loadCostFailureTypes();
  costGuide.showModal();
});
document.querySelector('#close-cost-guide').addEventListener('click', () => costGuide.close());

document.querySelector('#event-type-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const response = await fetch('/api/manager/event-types', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
    });
    const data = await response.json();
    say(response.ok ? `${data.message} / 事件类型已保存。` : data.error);
    if (response.ok) { event.currentTarget.reset(); loadEventTypes(true); }
  } catch { say('Could not save event type.'); }
});

function populateEventTypeEditor(eventValue) {
  const option = managerEventTypes.find(item => item.event_value === eventValue);
  if (!option) return;
  const form = document.querySelector('#event-type-form');
  form.elements.event_value.value = option.event_value;
  form.elements.event_value.readOnly = true;
  form.elements.display_name.value = option.display_name;
  document.querySelector('#existing-event-type').value = option.event_value;
}
document.querySelector('#existing-event-type').addEventListener('change', event => {
  if (event.currentTarget.value) populateEventTypeEditor(event.currentTarget.value);
  else {
    document.querySelector('#event-type-form').reset();
    document.querySelector('#event-type-form').elements.event_value.readOnly = false;
  }
});
document.addEventListener('click', event => {
  if (!event.target.classList.contains('edit-event-type')) return;
  populateEventTypeEditor(decodeURIComponent(event.target.dataset.value));
  document.querySelector('#event-type-form').scrollIntoView({behavior: 'smooth', block: 'center'});
});

document.addEventListener('click', async event => {
  if (!event.target.classList.contains('deactivate-cost-type')) return;
  const response = await fetch(`/api/manager/cost-failure-types/${event.target.dataset.code}`, {
    method: 'DELETE',
  });
  const data = await response.json();
  say(response.ok ? `${data.message} / 成本失效类型已停用。` : data.error);
  if (response.ok) loadCostFailureTypes(true);
});

document.addEventListener('click', async event => {
  if (!event.target.classList.contains('deactivate-event-type')) return;
  try {
    const response = await fetch(`/api/manager/event-types/${event.target.dataset.value}`, {method: 'DELETE'});
    const data = await response.json();
    say(response.ok ? `${data.message} / 事件类型已停用。` : data.error);
    if (response.ok) loadEventTypes(true);
  } catch { say('Could not deactivate event type.'); }
});

let managerStandardFields = [];
async function loadManagerStandardFields(formKey) {
  const response = await fetch(`/api/manager/forms/${formKey}/standard-fields`);
  const data = await response.json();
  if (!response.ok) { say(data.error || 'Could not load standard fields.'); return; }
  managerStandardFields = data.fields;
  const selector = document.querySelector('#standard-field-select');
  selector.innerHTML = data.fields.map(field => `<option value="${escapeHtml(field.field_key)}">${escapeHtml(field.label)} (${escapeHtml(field.input_type)})</option>`).join('');
  populateStandardFieldEditor(selector.value);
}
function populateStandardFieldEditor(fieldKey) {
  const field = managerStandardFields.find(item => item.field_key === fieldKey);
  if (!field) return;
  const form = document.querySelector('#standard-field-form');
  form.elements.label.value = field.label;
  form.elements.help_text.value = field.help_text || '';
  form.elements.options.value = normaliseOptions(field.options_json).join('\n');
  const optionsWrap = document.querySelector('#standard-field-options-wrap');
  optionsWrap.hidden = field.input_type !== 'select' || field.field_key === 'event_type';
  document.querySelector('#event-type-options-panel').hidden = field.field_key !== 'event_type';
  document.querySelector('#standard-field-select').value = field.field_key;
}
document.querySelector('#standard-field-form [name="form_key"]').addEventListener('change', event => loadManagerStandardFields(event.currentTarget.value));
document.querySelector('#standard-field-select').addEventListener('change', event => populateStandardFieldEditor(event.currentTarget.value));
document.querySelector('#standard-field-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget), payload = Object.fromEntries(form);
  payload.options = form.get('options').split('\n').map(value => value.trim()).filter(Boolean);
  const response = await fetch(`/api/manager/forms/${payload.form_key}/standard-fields`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload),
  });
  const data = await response.json();
  say(response.ok ? data.message : data.error);
  if (response.ok) loadManagerStandardFields(payload.form_key);
});
let managerFields = [];
async function loadManagerFields(formKey) {
  const response = await fetch(`/api/manager/forms/${formKey}/fields`);
  const data = await response.json();
  if (!response.ok) { say(data.error || 'Could not load editable fields.'); return; }
  managerFields = data.fields;
  const selector = document.querySelector('#existing-field');
  selector.innerHTML = '<option value="">New field / 新字段</option>' + managerFields.map(field => `<option value="${escapeHtml(field.field_key)}">${escapeHtml(field.label)} (${escapeHtml(field.field_key)})</option>`).join('');
  document.querySelector('#manager-field-list').innerHTML = managerFields.map(field => `<div class="manager-type-row"><div><strong>${escapeHtml(field.label)}</strong><small>${escapeHtml(field.field_key)} · ${escapeHtml(field.input_type)}</small></div><button class="secondary edit-field" data-key="${escapeHtml(field.field_key)}">Edit / 编辑</button></div>`).join('');
}
function populateFieldEditor(fieldKey) {
  const field = managerFields.find(item => item.field_key === fieldKey);
  if (!field) return;
  const form = document.querySelector('#field-form');
  form.elements.field_key.value = field.field_key;
  form.elements.label.value = field.label;
  form.elements.input_type.value = field.input_type;
  const options = Array.isArray(field.options_json) ? field.options_json : JSON.parse(field.options_json || '[]');
  form.elements.options.value = options.join('\n');
  document.querySelector('#existing-field').value = field.field_key;
}
document.querySelector('#field-form [name="form_key"]').addEventListener('change', event => loadManagerFields(event.currentTarget.value));
document.querySelector('#existing-field').addEventListener('change', event => {
  if (event.currentTarget.value) populateFieldEditor(event.currentTarget.value);
  else document.querySelector('#field-form').reset();
});
document.addEventListener('click', event => {
  if (!event.target.classList.contains('edit-field')) return;
  populateFieldEditor(event.target.dataset.key);
});
document.querySelector('#field-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget), payload = Object.fromEntries(form);
  payload.options = form.get('options').split('\n').map(value => value.trim()).filter(Boolean);
  payload.display_order = 200;
  const response = await fetch(`/api/manager/forms/${payload.form_key}/fields`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  say(response.ok ? data.message : data.error);
  if (response.ok) { loadManagerFields(payload.form_key); }
});

loadHomeTask();
loadHomeOngoing();

let managerRecordContext = null;
const managerEditableFields = {
  production: [
    ['shift_name', 'Shift / 班次', 'text'], ['machine_code', 'Machine / 设备', 'text'], ['formula_code', 'Formula / 配方', 'text'],
    ['batch_number', 'Batch number / 批次号', 'text'], ['planned_quantity', 'Planned quantity / 计划数量', 'number'],
    ['actual_quantity', 'Actual quantity / 实际数量', 'number'], ['qualified_quantity', 'Qualified quantity / 合格数量', 'number'], ['notes', 'Notes / 备注', 'textarea'],
  ],
  abnormality: [
    ['shift_name', 'Shift / 班次', 'text'], ['machine_code', 'Machine / 设备', 'text'], ['machine_type', 'Process type / 工艺类型', 'select:semi|Semi / 半自动,auto|Auto / 全自动'],
    ['event_type', 'Event type / 事件类型', 'text'], ['severity', 'Severity | Priority / 严重程度 | 优先级', 'select:normal|Normal / 正常,low|Low / 低,medium|Medium / 中,high|High / 高'],
    ['start_time', 'Start time / 开始时间', 'time'], ['end_time', 'End time / 结束时间', 'time'], ['duration_minutes', 'Downtime minutes / 停机分钟', 'number'],
    ['is_resolved', 'Resolved? / 已解决？', 'select:no|No / 否,yes|Yes / 是'], ['effective_time_cost', 'Effective time cost? / 是否为有效时间成本', 'select:|Not set / 未设置,no|No / 否,yes|Yes / 是'],
    ['responsible_person', 'Responsible person / 责任人', 'text'], ['target_finish_date', 'Expected finish / 预计完成', 'date'], ['actual_finish_date', 'Actual finish / 实际完成', 'date'],
    ['description', 'What happened? / 发生了什么？', 'textarea'], ['immediate_action', 'Immediate action / 立即措施', 'textarea'], ['solution_provided', 'Solution provided / 解决方案', 'textarea'],
  ],
};
function managerEditControl(key, label, kind, value) {
  const safeValue = escapeHtml(value ?? '');
  const required = ['shift_name', 'machine_code', 'formula_code', 'batch_number', 'planned_quantity', 'actual_quantity', 'machine_type', 'event_type', 'severity', 'start_time', 'end_time', 'duration_minutes', 'is_resolved'].includes(key) ? 'required' : '';
  if (key === 'event_type') {
    const options = managerEventTypes.map(option => `<option value="${escapeHtml(option.event_value)}" ${String(value) === option.event_value ? 'selected' : ''}>${escapeHtml(option.display_name)}</option>`).join('');
    return `<label>${label}<select name="${key}" required>${options}</select></label>`;
  }
  if (kind === 'textarea') return `<label>${label}<textarea name="${key}" ${required}>${safeValue}</textarea></label>`;
  if (kind.startsWith('select:')) {
    const options = kind.slice(7).split(',').map(option => { const [optionValue, optionLabel] = option.split('|'); return `<option value="${optionValue}" ${String(value) === optionValue ? 'selected' : ''}>${optionLabel}</option>`; }).join('');
    return `<label>${label}<select name="${key}" ${required}>${options}</select></label>`;
  }
  return `<label>${label}<input name="${key}" type="${kind}" value="${safeValue}" ${kind === 'number' ? 'step="0.01" min="0"' : ''} ${required}></label>`;
}

function openManagerRecordDialog(type, record = null) {
  managerRecordContext = {type, id: record?.id || null};
  const isNew = !record;
  document.querySelector('#manager-record-dialog-title').textContent = `${isNew ? 'Add' : 'Edit'} ${type === 'production' ? 'production' : 'event'} record / ${isNew ? '添加' : '编辑'}${type === 'production' ? '生产' : '事件'}记录`;
  document.querySelector('#manager-record-edit-fields').innerHTML = managerEditableFields[type].map(([key, label, kind]) => managerEditControl(key, label, kind, record?.[key])).join('');
  document.querySelector('#manager-record-edit-status').textContent = '';
  document.querySelector('#manager-record-dialog').showModal();
}

document.addEventListener('click', async event => {
  if (event.target.classList.contains('manager-add-record')) {
    if (event.target.dataset.recordType === 'abnormality') await loadEventTypes(true);
    openManagerRecordDialog(event.target.dataset.recordType);
    return;
  }
  if (!event.target.classList.contains('manager-edit-row')) return;
  const type = event.target.dataset.recordType, id = event.target.dataset.recordId;
  if (type === 'abnormality') await loadEventTypes(true);
  const response = await fetch(`/api/manager/records/${type}/${id}`), data = await response.json();
  if (!response.ok) { say(data.error || 'Could not load record.'); return; }
  openManagerRecordDialog(type, data.record);
});
document.querySelector('#close-manager-record-dialog').addEventListener('click', () => document.querySelector('#manager-record-dialog').close());
document.querySelector('#manager-record-edit').addEventListener('submit', async event => {
  event.preventDefault();
  if (!managerRecordContext) return;
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  const editing = Boolean(managerRecordContext.id);
  const path = editing
    ? `/api/manager/records/${managerRecordContext.type}/${managerRecordContext.id}`
    : managerRecordContext.type === 'production' ? '/api/production-records' : '/api/abnormality-reports';
  const response = await fetch(path, {method: editing ? 'PATCH' : 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
  const data = await response.json();
  document.querySelector('#manager-record-edit-status').textContent = response.ok ? 'Record saved / 记录已保存。' : data.error;
  if (response.ok) {
    if (managerRecordContext.type === 'production') await loadRecords('production', '#production-table');
    else await loadRecords('tracker', '#tracker-table', true);
    setTimeout(() => document.querySelector('#manager-record-dialog').close(), 500);
  }
});

document.querySelector('#open-manager-fields').addEventListener('click', async () => {
  await Promise.all([loadEventTypes(true), loadManagerStandardFields('production'), loadManagerFields('production')]);
  document.querySelector('#manager-fields-dialog').showModal();
});
document.querySelector('#close-manager-fields').addEventListener('click', () => document.querySelector('#manager-fields-dialog').close());
function displaySettingMarkup(item,kind){const label=kind==='blocks'?'Title / 标题':'Column title / 列标题';const width=kind==='blocks'?`<input data-setting-width type="hidden" value="${Number(item.width)||1}"><input data-setting-height type="hidden" value="${Number(item.height)||1}"><input data-setting-font-size type="hidden" value="${Math.max(12,Math.min(Number(item.font_size)||16,36))}">`:'<span></span>';const custom=item.type==='static_text'?`<textarea data-setting-content maxlength="4000">${escapeHtml(item.content||'')}</textarea>`:'';return `<div class="display-setting-row" data-setting-key="${escapeHtml(item.key)}" data-setting-type="${escapeHtml(item.type||'built_in')}"><input data-setting-label value="${escapeHtml(item.title||item.label)}" maxlength="160" required><input data-setting-order type="number" min="0" max="999" value="${Number(item.order)}" required>${width}<input data-setting-visible type="checkbox" ${item.visible?'checked':''}>${custom}</div>`}
async function openDisplaySettings(){const response=await fetch('/api/manager/display-settings');const data=await response.json();if(!response.ok){say(data.error||'Unlock manager access before editing the display.');return}const branding=data.settings.branding||{};document.querySelector('#display-brand-title').value=branding.title||'';document.querySelector('#display-brand-eyebrow').value=branding.display_eyebrow||branding.title||'';document.querySelector('#display-brand-display-title').value=branding.display_title||'Daily Factory Display / 每日工厂看板';document.querySelector('#display-block-settings').innerHTML=data.settings.blocks.sort((a,b)=>a.order-b.order).map(x=>displaySettingMarkup(x,'blocks')).join('');document.querySelector('#display-column-settings').innerHTML=data.settings.event_columns.map(x=>displaySettingMarkup(x,'event_columns')).join('');renderDisplayLayoutPreview();document.querySelector('#display-settings-dialog').showModal()}
function renderDisplayLayoutPreview(){const root=document.querySelector('#display-layout-preview');const rows=[...document.querySelectorAll('#display-block-settings .display-setting-row')];root.innerHTML=rows.map(row=>{const title=row.querySelector('[data-setting-label]').value;const width=Number(row.querySelector('[data-setting-width]').value)||1;const height=Number(row.querySelector('[data-setting-height]').value)||1;const fontSize=Number(row.querySelector('[data-setting-font-size]').value)||16;const visible=row.querySelector('[data-setting-visible]').checked;const content=row.querySelector('[data-setting-content]')?.value||'';const removable=row.dataset.settingType==='static_text';return `<article class="display-preview-block preview-width-${width} preview-height-${height} ${visible?'':'is-hidden'}" style="--preview-font-size:${fontSize}px" data-setting-key="${escapeHtml(row.dataset.settingKey)}"><div class="display-preview-toolbar"><button class="display-move-handle" type="button" draggable="true" title="Drag to move / 拖动移动">⠿ Move / 移动</button><label class="preview-font-label">Font / 字号 <select class="preview-font-size" aria-label="Block font size">${[12,14,16,18,20,24,28,32,36].map(size=>`<option value="${size}" ${size===fontSize?'selected':''}>${size}px</option>`).join('')}</select></label><label><input class="preview-visible" type="checkbox" ${visible?'checked':''}> Show / 显示</label>${removable?'<button class="remove-display-block" type="button">Remove / 删除</button>':''}</div><input class="preview-title" value="${escapeHtml(title)}" maxlength="160" aria-label="Block title">${removable?`<textarea class="preview-content" maxlength="4000" aria-label="Permanent text" placeholder="One item per line. Use - for bullets or 1. for numbered lists. / 每行一项；使用 - 创建项目符号，使用 1. 创建编号列表。">${escapeHtml(content)}</textarea>`:''}<small class="preview-size">${width} × ${height}</small><button class="display-resize-handle" type="button" aria-label="Resize block / 调整区块大小" title="Drag to resize / 拖动调整大小">↘</button></article>`}).join('')}
function settingRowForCard(card){return document.querySelector(`#display-block-settings [data-setting-key="${CSS.escape(card.dataset.settingKey)}"]`)}
function syncBlockOrderFromPreview(){const settings=document.querySelector('#display-block-settings');[...document.querySelectorAll('#display-layout-preview .display-preview-block')].forEach((card,index)=>{const row=settingRowForCard(card);settings.append(row);row.querySelector('[data-setting-order]').value=(index+1)*10})}
function syncCanvasCard(card){const row=settingRowForCard(card);row.querySelector('[data-setting-label]').value=card.querySelector('.preview-title').value;row.querySelector('[data-setting-visible]').checked=card.querySelector('.preview-visible').checked;const fontSize=Number(card.querySelector('.preview-font-size').value)||16;row.querySelector('[data-setting-font-size]').value=fontSize;card.style.setProperty('--preview-font-size',`${fontSize}px`);const content=row.querySelector('[data-setting-content]');if(content)content.value=card.querySelector('.preview-content').value}
let draggedDisplayBlock=null;
document.querySelector('#display-layout-preview').addEventListener('dragstart',event=>{if(!event.target.classList.contains('display-move-handle')){event.preventDefault();return}draggedDisplayBlock=event.target.closest('.display-preview-block');draggedDisplayBlock.classList.add('dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',draggedDisplayBlock.dataset.settingKey)});
document.querySelector('#display-layout-preview').addEventListener('dragover',event=>{event.preventDefault();if(!draggedDisplayBlock)return;const target=event.target.closest('.display-preview-block');if(!target||target===draggedDisplayBlock)return;const box=target.getBoundingClientRect();const after=event.clientY>box.top+box.height/2||(Math.abs(event.clientY-(box.top+box.height/2))<box.height/3&&event.clientX>box.left+box.width/2);target.parentElement.insertBefore(draggedDisplayBlock,after?target.nextSibling:target)});
document.querySelector('#display-layout-preview').addEventListener('drop',event=>{event.preventDefault();syncBlockOrderFromPreview()});
document.querySelector('#display-layout-preview').addEventListener('dragend',()=>{if(draggedDisplayBlock)draggedDisplayBlock.classList.remove('dragging');draggedDisplayBlock=null});
let resizeState=null;
document.querySelector('#display-layout-preview').addEventListener('pointerdown',event=>{if(!event.target.classList.contains('display-resize-handle'))return;event.preventDefault();const card=event.target.closest('.display-preview-block');const row=settingRowForCard(card);resizeState={card,row,startX:event.clientX,startY:event.clientY,startWidth:card.getBoundingClientRect().width,startHeight:card.getBoundingClientRect().height};event.target.setPointerCapture?.(event.pointerId)});
document.querySelector('#display-layout-preview').addEventListener('pointermove',event=>{if(!resizeState)return;const canvas=document.querySelector('#display-layout-preview');const gap=12,col=(canvas.clientWidth-28-gap*2)/3;const width=Math.max(1,Math.min(3,Math.round((resizeState.startWidth+event.clientX-resizeState.startX+gap)/(col+gap))));const height=Math.max(1,Math.min(3,Math.round((resizeState.startHeight+event.clientY-resizeState.startY+gap)/(140+gap))));for(let size=1;size<=3;size++){resizeState.card.classList.toggle(`preview-width-${size}`,size===width);resizeState.card.classList.toggle(`preview-height-${size}`,size===height)}resizeState.row.querySelector('[data-setting-width]').value=width;resizeState.row.querySelector('[data-setting-height]').value=height;resizeState.card.querySelector('.preview-size').textContent=`${width} × ${height}`});
document.querySelector('#display-layout-preview').addEventListener('pointerup',()=>{resizeState=null});
document.querySelector('#display-layout-preview').addEventListener('input',event=>{const card=event.target.closest('.display-preview-block');if(card)syncCanvasCard(card)});
document.querySelector('#display-layout-preview').addEventListener('change',event=>{const card=event.target.closest('.display-preview-block');if(card){syncCanvasCard(card);card.classList.toggle('is-hidden',!card.querySelector('.preview-visible').checked)}});
function collectDisplaySettings(root,kind){return [...root.querySelectorAll('.display-setting-row')].map(row=>({key:row.dataset.settingKey,[kind==='blocks'?'title':'label']:row.querySelector('[data-setting-label]').value,order:Number(row.querySelector('[data-setting-order]').value),visible:row.querySelector('[data-setting-visible]').checked,...(kind==='blocks'?{width:Number(row.querySelector('[data-setting-width]').value),height:Number(row.querySelector('[data-setting-height]').value),font_size:Number(row.querySelector('[data-setting-font-size]').value),type:row.dataset.settingType,content:row.querySelector('[data-setting-content]')?.value||''}:{})}))}
document.querySelector('#add-permanent-text-block').addEventListener('click',()=>{const key=`text_${crypto.randomUUID()}`;const root=document.querySelector('#display-block-settings');root.insertAdjacentHTML('beforeend',displaySettingMarkup({key,type:'static_text',title:'Permanent tasks / 永久任务',content:'',visible:true,order:(root.children.length+1)*10,width:3,height:1,font_size:16},'blocks'));renderDisplayLayoutPreview();document.querySelector('#display-layout-preview .display-preview-block:last-child')?.scrollIntoView({behavior:'smooth',block:'center'})});
document.querySelector('#display-layout-preview').addEventListener('click',event=>{if(!event.target.classList.contains('remove-display-block'))return;const card=event.target.closest('.display-preview-block');settingRowForCard(card).remove();card.remove();syncBlockOrderFromPreview()});
document.querySelector('#open-display-settings').addEventListener('click',openDisplaySettings);document.querySelector('#close-display-settings').addEventListener('click',()=>document.querySelector('#display-settings-dialog').close());document.querySelector('#display-settings-form').addEventListener('submit',async event=>{event.preventDefault();const payload={branding:{title:document.querySelector('#display-brand-title').value,subtitle:'',display_eyebrow:document.querySelector('#display-brand-eyebrow').value,display_title:document.querySelector('#display-brand-display-title').value},blocks:collectDisplaySettings(document.querySelector('#display-block-settings'),'blocks'),event_columns:collectDisplaySettings(document.querySelector('#display-column-settings'),'event_columns')};const response=await fetch('/api/manager/display-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await response.json();document.querySelector('#display-settings-status').textContent=response.ok?'Display settings saved. / 看板设置已保存。':(data.error||'Could not save display settings.');if(response.ok)document.querySelector('#brand-title').textContent=data.settings.branding.title});
