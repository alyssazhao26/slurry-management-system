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
if (department === 'slurry') {
  const eventColumns = document.querySelector('#display-column-settings');
  if (eventColumns) { eventColumns.hidden = true; if (eventColumns.previousElementSibling) eventColumns.previousElementSibling.hidden = true; }
}

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
  const request = async () => { const headers = new Headers(options.headers || {}); headers.set('X-CSRF-Token', csrfToken); headers.set('X-Department', department); return rawFetch(url, {...options, headers, credentials: 'same-origin'}); };
  let response = await request();
  if (response.status === 403 && response.headers.get('X-Session-Refresh') === 'required') { await refreshCsrfToken(); response = await request(); }
  return response;
};

let viewHistory = ['home'];
let viewHistoryIndex = 0;
let pendingManagerAction = null;
function openManagerWorkspace(){
  document.querySelector('#manager-workspace-dialog').showModal();
  if(department==='slurry')initialiseAttendanceManager();
}
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

let attendanceInitialised=false,attendanceRecordPage=1,attendanceEmployeePage=1,attendanceEmployees=[];
function attendanceTable(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(value=>`<th>${escapeHtml(value)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`}
function attendancePagination(root,page,total,onPage){const first=total?(page-1)*50+1:0,last=Math.min(page*50,total);root.innerHTML=`<span>Showing ${first}-${last} of ${total} / 显示 ${first}-${last}，共 ${total} 条</span><div><button type="button" class="secondary attendance-prev" ${page===1?'disabled':''}>Previous / 上一页</button><button type="button" class="secondary attendance-next" ${last>=total?'disabled':''}>Next / 下一页</button></div>`;root.querySelector('.attendance-prev').onclick=()=>onPage(page-1);root.querySelector('.attendance-next').onclick=()=>onPage(page+1)}
function attendanceRecordQuery(){return new URLSearchParams({page:attendanceRecordPage,...Object.fromEntries(new FormData(document.querySelector('#attendance-filter')))});}
const halfHourValues=(start,end)=>Array.from({length:Math.round((end-start)*2)+1},(_,index)=>(start+index*.5).toFixed(1));
function hourOptions(values,current,{blank=false,custom=false}={}){const value=current===null||current===undefined?'':Number(current).toFixed(1),standard=values.includes(value);return `${blank?'<option value="">None / 无</option>':''}${values.map(item=>`<option value="${item}" ${value===item?'selected':''}>${item}</option>`).join('')}${custom?`<option value="custom" ${value&&!standard?'selected':''}>Custom / 自定义</option>`:''}`}
async function loadManagerAttendanceRecords() {
  const root = document.querySelector('#manager-attendance-records');
  root.innerHTML = '<p>Loading / 加载中…</p>';
  const response = await fetch('/api/manager/attendance?' + attendanceRecordQuery());
  const data = await response.json();
  if (!response.ok) {
    root.innerHTML = `<p class="error">${escapeHtml(data.error)}</p>`;
    return;
  }
  const headers = [
    'Staffing company / 劳务公司',
    'Name / 姓名',
    'Date / 日期',
    'Login timestamp / 登录时间',
    'Paid break hours / 带薪休息',
    'Total hours / 总工时',
    'Overtime hours / 加班工时',
    'Manager note / 管理备注',
    'Save / 保存',
  ];
  const rows = data.records.map((row) => {
    const hasOvertime = row.overtime_hours !== null
      && row.overtime_hours !== undefined
      && row.overtime_hours !== '';
    const overtime = Number(row.overtime_hours);
    const customOvertime = hasOvertime
      && Number.isFinite(overtime)
      && !halfHourValues(.5, 3).includes(overtime.toFixed(1));
    return `<tr data-id="${Number(row.id)}" data-version="${Number(row.row_version)}">
      <td>${escapeHtml(row.staffing_company)}</td>
      <td>${escapeHtml(row.employee_name)}</td>
      <td>${escapeHtml(row.attendance_date)}</td>
      <td>${escapeHtml(row.login_timestamp || 'Manager added / 管理员添加')}</td>
      <td><select name="paid_break_hours">${hourOptions(halfHourValues(0, 2), row.paid_break_hours, {blank: true})}</select></td>
      <td><select name="total_hours">${hourOptions(halfHourValues(3, 12), row.total_hours, {blank: true})}</select></td>
      <td><select name="overtime_hours">${hourOptions(halfHourValues(.5, 3), row.overtime_hours, {blank: true, custom: true})}</select><input name="overtime_hours_custom" class="overtime-custom" type="number" min="0.5" max="24" step="0.5" value="${customOvertime ? overtime.toFixed(1) : ''}" placeholder="0.5" ${customOvertime ? '' : 'hidden'}></td>
      <td><input name="manager_note" maxlength="1000" value="${escapeHtml(row.manager_note || '')}"></td>
      <td><button type="button" class="primary save-attendance-record">Save / 保存</button></td>
    </tr>`;
  });
  root.innerHTML = attendanceTable(headers, rows);
  attendancePagination(
    document.querySelector('#attendance-record-pages'),
    data.page,
    data.total,
    (next) => {
      attendanceRecordPage = next;
      loadManagerAttendanceRecords();
    },
  );
}
function attendanceEmployeeQuery(){return new URLSearchParams({page:attendanceEmployeePage,...Object.fromEntries(new FormData(document.querySelector('#attendance-employee-search')))});}
async function loadManagerAttendanceEmployees() {
  const root = document.querySelector('#manager-attendance-employees');
  root.innerHTML = '<p>Loading / 加载中…</p>';
  const response = await fetch(
    '/api/manager/attendance-employees?' + attendanceEmployeeQuery(),
  );
  const data = await response.json();
  if (!response.ok) {
    root.innerHTML = `<p class="error">${escapeHtml(data.error)}</p>`;
    return;
  }

  attendanceEmployees = data.employees;
  const rows = data.employees.map((row) => {
    const awaitingSetup = Boolean(Number(row.pin_reset_required));
    const pinStatus = awaitingSetup
      ? '<small class="attendance-pin-status">Temporary / 待员工设置</small>'
      : '';
    const editLabel = awaitingSetup
      ? 'Edit · awaiting setup / 编辑 · 待设置'
      : 'Edit employee / 编辑员工';
    return `<tr>
      <td>${escapeHtml(row.staffing_company)}</td>
      <td>${escapeHtml(row.employee_name)}</td>
      <td>${escapeHtml(row.department)}</td>
      <td>${escapeHtml(row.job_title)}</td>
      <td>
        <strong class="attendance-pin">
          ${row.pin_code ? escapeHtml(row.pin_code) : 'Reset required / 需重置'}
        </strong>
        ${pinStatus}
      </td>
      <td>${row.is_active ? 'Active / 启用' : 'Inactive / 停用'}</td>
      <td>
        <button type="button" class="secondary edit-attendance-employee"
                data-id="${Number(row.id)}">${editLabel}</button>
        <button type="button" class="danger delete-attendance-employee"
                data-id="${Number(row.id)}">Delete / 删除</button>
      </td>
    </tr>`;
  });
  root.innerHTML = attendanceTable(
    [
      'Staffing company / 劳务公司',
      'Name / 姓名',
      'Department / 部门',
      'Job title / 职位',
      'PIN / 密码',
      'Status / 状态',
      'Actions / 操作',
    ],
    rows,
  );
  attendancePagination(
    document.querySelector('#attendance-employee-pages'),
    data.page,
    data.total,
    (next) => {
      attendanceEmployeePage = next;
      loadManagerAttendanceEmployees();
    },
  );
}
function openAttendanceEmployee(row=null){const form=document.querySelector('#attendance-employee-form');form.reset();form.elements.is_active.checked=true;form.elements.employee_id.value=row?.id??'';form.elements.staffing_company.value=row?.staffing_company??'';form.elements.employee_name.value=row?.employee_name??'';form.elements.employee_department.value=row?.department??'Slurry';form.elements.job_title.value=row?.job_title??'';document.querySelector('#attendance-employee-title').textContent=row?'Edit employee / 编辑员工':'Add employee / 添加员工';document.querySelector('#attendance-employee-status').textContent='';document.querySelector('#attendance-employee-dialog').showModal()}

async function loadAttendanceEmployeeOptions() {
  const select = document.querySelector('#attendance-record-form [name="employee_id"]');
  if (!select) return;
  const response = await fetch('/api/manager/attendance-employee-options');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load employees.');
  select.innerHTML = '<option value="">Select employee / 选择员工</option>'
    + data.employees.map((employee) => `<option value="${Number(employee.id)}">${escapeHtml(employee.staffing_company)} · ${escapeHtml(employee.employee_name)}</option>`).join('');
}

async function openAttendanceRecord() {
  const form = document.querySelector('#attendance-record-form');
  form.reset();
  form.elements.attendance_date.value = formReferenceDate;
  document.querySelector('#attendance-record-status').textContent = 'Loading employees… / 正在加载员工…';
  document.querySelector('#attendance-record-dialog').showModal();
  try {
    await loadAttendanceEmployeeOptions();
    document.querySelector('#attendance-record-status').textContent = '';
  } catch (error) {
    document.querySelector('#attendance-record-status').textContent = error.message;
  }
}

function initialiseAttendanceRecordCreation() {
  const form = document.querySelector('#attendance-record-form');
  if (!form) return;
  form.elements.paid_break_hours.innerHTML = hourOptions(halfHourValues(0, 2), 0);
  form.elements.total_hours.innerHTML = hourOptions(halfHourValues(3, 12), 8);
  form.elements.overtime_hours.innerHTML = hourOptions(
    halfHourValues(.5, 3),
    null,
    {blank: true, custom: true},
  );
  document.querySelector('#new-attendance-record').onclick = openAttendanceRecord;
  document.querySelector('#close-attendance-record').onclick = () => {
    document.querySelector('#attendance-record-dialog').close();
  };
  form.elements.overtime_hours.onchange = (event) => {
    const custom = form.elements.overtime_hours_custom;
    custom.hidden = event.target.value !== 'custom';
    custom.required = event.target.value === 'custom';
    if (!custom.hidden) custom.focus();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form));
    if (payload.overtime_hours === 'custom') {
      payload.overtime_hours = payload.overtime_hours_custom;
    }
    delete payload.overtime_hours_custom;
    const response = await fetch('/api/manager/attendance', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    document.querySelector('#attendance-record-status').textContent = response.ok
      ? 'Attendance record saved. / 考勤记录已保存。'
      : data.error;
    if (response.ok) {
      attendanceRecordPage = 1;
      await loadManagerAttendanceRecords();
      setTimeout(() => document.querySelector('#attendance-record-dialog').close(), 350);
    }
  };
}

async function generateAttendanceQr(){const status=document.querySelector('#attendance-qr-status'),image=document.querySelector('#attendance-qr-image'),urlLabel=document.querySelector('#attendance-qr-url'),base=document.querySelector('#attendance-base-url').value.trim().replace(/\/$/,'');status.textContent='Generating / 正在生成…';image.hidden=true;const response=await fetch('/attendance/qr?'+new URLSearchParams({base_url:base}));if(!response.ok){const data=await response.json();status.textContent=data.error;return}const blob=await response.blob(),url=URL.createObjectURL(blob),attendanceUrl=response.headers.get('X-Attendance-URL')||base+'/attendance';if(image.dataset.objectUrl)URL.revokeObjectURL(image.dataset.objectUrl);image.dataset.objectUrl=url;image.src=url;image.hidden=false;urlLabel.textContent=attendanceUrl;document.querySelector('#open-attendance-link').href=attendanceUrl;status.textContent='Scan with an employee phone, then test the displayed address. / 请用员工手机扫码并测试显示的网址。'}
function initialiseAttendanceManager(){if(attendanceInitialised)return;attendanceInitialised=true;initialiseAttendanceRecordCreation();const base=document.querySelector('#attendance-base-url');base.value=location.origin;document.querySelectorAll('[data-attendance-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-attendance-tab]').forEach(item=>item.classList.toggle('active',item===button));document.querySelectorAll('[data-attendance-panel]').forEach(panel=>{const active=panel.dataset.attendancePanel===button.dataset.attendanceTab;panel.classList.toggle('active',active);panel.hidden=!active});if(button.dataset.attendanceTab==='records')loadManagerAttendanceRecords();if(button.dataset.attendanceTab==='employees')loadManagerAttendanceEmployees()});document.querySelector('#generate-attendance-qr').onclick=generateAttendanceQr;document.querySelector('#attendance-filter').onsubmit=event=>{event.preventDefault();attendanceRecordPage=1;loadManagerAttendanceRecords()};document.querySelector('#attendance-export').onclick=()=>location.assign('/api/manager/attendance-export?'+attendanceRecordQuery());document.querySelector('#attendance-employee-search').onsubmit=event=>{event.preventDefault();attendanceEmployeePage=1;loadManagerAttendanceEmployees()};document.querySelector('#new-attendance-employee').onclick=()=>openAttendanceEmployee();document.querySelector('#close-attendance-employee').onclick=()=>document.querySelector('#attendance-employee-dialog').close();const recordsRoot=document.querySelector('#manager-attendance-records');recordsRoot.onchange=event=>{if(event.target.name==='overtime_hours'){const custom=event.target.closest('td').querySelector('.overtime-custom');custom.hidden=event.target.value!=='custom';custom.required=event.target.value==='custom';if(!custom.hidden)custom.focus()}};recordsRoot.onclick=async event=>{if(!event.target.classList.contains('save-attendance-record'))return;const row=event.target.closest('tr'),payload={row_version:Number(row.dataset.version)};row.querySelectorAll('input,select').forEach(control=>payload[control.name]=control.value);if(payload.overtime_hours==='custom')payload.overtime_hours=payload.overtime_hours_custom;delete payload.overtime_hours_custom;const response=await fetch('/api/manager/attendance/'+row.dataset.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),data=await response.json();say(response.ok?'Attendance record saved. / 考勤记录已保存。':data.error);if(response.ok)loadManagerAttendanceRecords()};document.querySelector('#manager-attendance-employees').onclick=async event=>{const id=Number(event.target.dataset.id),row=attendanceEmployees.find(item=>Number(item.id)===id);if(event.target.classList.contains('edit-attendance-employee'))openAttendanceEmployee(row);if(event.target.classList.contains('delete-attendance-employee')){if(!confirm(`Delete ${row.employee_name}? Employees with attendance history will be deactivated so records remain intact. / 删除该员工？如已有考勤记录，将停用员工并保留记录。`))return;const response=await fetch('/api/manager/attendance-employees/'+id,{method:'DELETE'}),data=await response.json();say(response.ok?`${data.message} / 员工已删除或停用。`:data.error);if(response.ok)loadManagerAttendanceEmployees()}};document.querySelector('#attendance-employee-form').onsubmit=async event=>{event.preventDefault();const payload=Object.fromEntries(new FormData(event.currentTarget)),id=payload.employee_id;delete payload.employee_id;payload.is_active=event.currentTarget.elements.is_active.checked;const response=await fetch(id?'/api/manager/attendance-employees/'+id:'/api/manager/attendance-employees',{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),data=await response.json();document.querySelector('#attendance-employee-status').textContent=response.ok?'Employee saved. / 员工已保存。':data.error;if(response.ok){await loadManagerAttendanceEmployees();await loadAttendanceEmployeeOptions();setTimeout(()=>document.querySelector('#attendance-employee-dialog').close(),350)}}}

function show(viewId, recordHistory = true) {
  const currentView = viewHistory[viewHistoryIndex];
  if (recordHistory && viewId !== currentView) {
    viewHistory = viewHistory.slice(0, viewHistoryIndex + 1);
    viewHistory.push(viewId);
    viewHistoryIndex += 1;
  }
  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
  document.querySelector(`#${viewId}`).classList.add('active');
  if (viewId === 'inventory') loadInventory();
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
    if (isSlitting) {
      const statusLabels = {production_in_progress: 'Production in progress / 生产进行中', re_cut: 'Re-cut / 补切', label_changing: 'Label changing / 更换标签'};
      const production = items.filter(item => item.type === 'slitting_production').map(item => `<li><strong>${escapeHtml(item.product_item)}</strong><span>${escapeHtml(statusLabels[item.production_status] || item.production_status)} · Target / 目标: ${escapeHtml(item.production_target)} ${escapeHtml(item.target_unit==='custom'?item.custom_unit:(item.target_unit||'sr'))}</span></li>`).join('');
      const schedule = items.filter(item => item.type === 'slitting_schedule').map(item => `<li><strong>${escapeHtml(item.machine)} · ${escapeHtml(item.product_item)}</strong><span>Planned input / 计划排产: ${escapeHtml(item.planned_input)} · Operator / 操作员: ${escapeHtml(item.operator)} · Shift lead / 班组长: ${escapeHtml(item.shift_lead)}</span></li>`).join('');
      const training = items.filter(item => item.type === 'slitting_training').map(item => `<li><strong>${escapeHtml(item.training_item)}</strong><span>Training type / 培训类型: ${escapeHtml(item.training_type)} · Person/group / 受训人员或小组: ${escapeHtml(item.subject)} · Time / 时间: ${escapeHtml(item.time)}</span></li>`).join('');
      const slot = `<p class="task-slot-label">${escapeHtml(data.daily_task.record_date)} · ${escapeHtml(data.daily_task.shift_label)}</p>`;
      const groups = `${production ? `<section class="task-group"><h3>Production overview / 生产概览</h3><ul class="task-bullets">${production}</ul></section>` : ''}${schedule ? `<section class="task-group"><h3>Schedule / 生产排程</h3><ul class="task-bullets">${schedule}</ul></section>` : ''}${training ? `<section class="task-group"><h3>Training / 培训</h3><ul class="task-bullets">${training}</ul></section>` : ''}`;
      document.querySelector('#home-task-details').innerHTML = slot + (groups || '<p>No task saved / 暂无任务</p>');
      document.querySelector('#brand-title').textContent = 'GNEM Slitting Production / GNEM 分切生产';
      return;
    }
    const labels = {production: 'Production / 生产', cleaning: 'Cleaning / 清洁', custom: 'Custom / 自定义'};
    const groups = ['cleaning', 'custom', 'production'].map(type => {
      const groupItems = items.filter(item => item.type === type);
      if (!groupItems.length) return '';
      const rows = groupItems.map((item, index) => {
        const details = item.type === 'production'
          ? `${isSlitting?'Model / 型号':'Formula / 配方'}: ${escapeHtml(item.formula_code)} · Tank amount / 罐数: ${item.amount_needed ?? '—'} tanks / 罐${!isSlitting?` · Weight / 重量: ${item.weight_needed ?? 0} kg / 公斤`:''} · Machine / 设备: ${escapeHtml(item.machine_assigned)}`
          : item.type === 'cleaning' ? `Process / 工艺: ${item.process_type === 'semi' ? 'Semi / 半自动' : 'Auto / 全自动'}` : escapeHtml(item.description || '—');
        const heading = item.type === 'production' ? `Production / 生产 · ${escapeHtml(item.machine_assigned || '—')}` : escapeHtml(item.description || labels[type]);
        return `<li><strong>${heading}</strong><span>${details}</span></li>`;
      }).join('');
      return `<section class="task-group"><h3>${labels[type]}</h3><ul class="task-bullets">${rows}</ul></section>`;
    }).join('');
    const slot = `<p class="task-slot-label">${escapeHtml(data.daily_task.record_date)} · ${escapeHtml(data.daily_task.shift_label)}</p>`;
    document.querySelector('#home-task-details').innerHTML = slot + (groups || '<p>No task saved / 暂无任务</p>');
    const branding = data.display_settings?.branding || {};
    document.querySelector('#brand-title').textContent = isSlitting ? 'GNEM Slitting Production / GNEM 分切生产' : branding.title || 'GNEM Slurry Production Details / GNEM 制浆生产明细';
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
      ? pending.map(record => `<article class="home-pending-item"><strong>${formatDate(record.record_date)} · ${escapeHtml(record.shift_name || 'Day')} · ${escapeHtml(record.formula_code)}</strong><span>Qualified amount pending / 合格数量待补录</span><small>Shift / 班次: ${escapeHtml(record.shift_name || 'Day')} · Machine / 设备: ${escapeHtml(record.machine_code)}${isSlitting?` · Actual input rolls / 实际投入卷数: ${escapeHtml(record.input_rolls)}`:` · Batch / 批次: ${escapeHtml(record.batch_number)} · Actual / 实际: ${escapeHtml(record.actual_quantity)}`}</small><form class="qualified-followup-form home-qualified-followup" data-id="${Number(record.id)}"><label>Qualified quantity / 合格数量<input name="qualified_quantity" type="number" min="0" max="${Number(record.actual_quantity)}" step=".01" required placeholder="Enter amount / 输入数量"></label><button class="primary">Save follow-up / 保存补录</button></form></article>`).join('')
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
  if (isSlitting) {
    const response=await fetch('/api/event-types');const data=await response.json();
    if(response.ok)managerEventTypes=data.types;
    return;
  }
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
    ['id', 'ID'], ['event_date', 'Date / 日期'], ['shift_name', 'Shift / 班次'], ['machine_code', 'Machine / 设备'], ['machine_type', 'Process type / 工艺类型'],
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
    formula: root.querySelector('[name="formula"]')?.value.trim() || '',
    width: root.querySelector('[name="width"]')?.value.trim() || '',
  };
}

async function loadRecords(type, target = recordTargets[type], tracker = false, page = 1) {
  if (isSlitting && type === "production") return loadSlittingProduction();
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
const reportColumnStorageKey = `gnem.report-columns.${department}`;
function savedReportColumnKeys(group) {
  try {
    const saved = JSON.parse(localStorage.getItem(reportColumnStorageKey) || '{}');
    return Array.isArray(saved[group]) ? new Set(saved[group]) : null;
  } catch { return null; }
}
function saveReportColumnPreferences() {
  const preferences = {};
  for (const group of ['production','events']) {
    const id = group === 'production' ? 'production-report-columns' : 'event-report-columns';
    preferences[group] = [...document.querySelectorAll(`#${id} input:checked`)].map(input => input.value);
  }
  try { localStorage.setItem(reportColumnStorageKey, JSON.stringify(preferences)); }
  catch { say('This browser could not save report column preferences. / 浏览器无法保存报告列设置。'); }
}
function initialiseReportColumnPicker() {
  [['production','#production-report-columns'],['events','#event-report-columns']].forEach(([group, selector]) => {
    const root = document.querySelector(selector);
    if (!root) return;
    const saved = savedReportColumnKeys(group), selected = saved || defaultReportColumns[group];
    root.innerHTML = reportColumnDefinitions[group].map(([key,label]) => `<label><input type="checkbox" value="${escapeHtml(key)}" ${selected.has(key) ? 'checked' : ''}>${escapeHtml(label)}</label>`).join('');
    if (!root.dataset.preferenceListener) {
      root.dataset.preferenceListener = '1';
      root.addEventListener('change', saveReportColumnPreferences);
    }
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
    const machine = isSlitting ? document.querySelector('#slitting-report-machine')?.value || '' : '';
    document.querySelector('#report-date-label').textContent = `Report date / 报告日期: ${data.report_date}${machine ? ` · Machine / 机台: ${machine}` : ''}`;
    const productionColumns = selectedReportColumns('production'), eventColumns = selectedReportColumns('events');
    if (!productionColumns.length || !eventColumns.length) { say('Select at least one Production column and one Event column. / 生产数据和事件明细请各选择至少一列。'); return; }
    if (isSlitting) await loadSlittingDailyReport(data.events, dateInput.value, machine);
    else {
      renderReportTable('#report-production', data.production, productionColumns);
      renderReportTable('#report-events', data.events, eventColumns);
      window.latestSlurryReport = {date: dateInput.value, production: data.production, events: data.events, productionColumns, eventColumns};
    }
    document.querySelector('#report-sheet').hidden = false;
    document.querySelector('#save-report-image').hidden = false;
  } catch {
    say('Could not generate report. Check server setup and pending migrations. / 无法生成报告，请检查服务器设置和待处理迁移。');
  }
}

function canvasCellText(context, value, x, y, maxWidth, weight = 400) {
  context.font = `${weight} 14px "Microsoft YaHei","Segoe UI",sans-serif`;
  context.fillStyle = '#102f46';
  context.textBaseline = 'middle';
  let label = String(value ?? '—');
  while (label.length > 1 && context.measureText(label).width > maxWidth) label = label.slice(0, -1);
  if (String(value ?? '—') !== label) label = `${label.slice(0, -1)}…`;
  context.fillText(label, x, y, maxWidth);
}
function drawCanvasTable(context, title, rows, columns, y, width, margin) {
  context.font = '800 22px "Microsoft YaHei","Segoe UI",sans-serif';
  context.fillStyle = '#063b5c'; context.fillText(title, margin, y + 24); y += 42;
  if (!rows.length) { canvasCellText(context, 'No records / 无记录', margin + 14, y + 24, width - margin * 2); return y + 54; }
  const tableWidth = width - margin * 2, cellWidth = tableWidth / columns.length, rowHeight = 38;
  context.fillStyle = '#dceaf1'; context.fillRect(margin, y, tableWidth, rowHeight);
  columns.forEach(([,label], index) => canvasCellText(context, label, margin + index * cellWidth + 7, y + rowHeight / 2, cellWidth - 12, 700));
  y += rowHeight;
  rows.forEach((row, rowIndex) => {
    context.fillStyle = rowIndex % 2 ? '#f2f7fa' : '#ffffff'; context.fillRect(margin, y, tableWidth, rowHeight);
    columns.forEach(([key], index) => { const raw = key.endsWith('_rate') && row[key] != null ? `${(Number(row[key]) * 100).toFixed(1)}%` : row[key]; canvasCellText(context, raw, margin + index * cellWidth + 7, y + rowHeight / 2, cellWidth - 12); });
    y += rowHeight;
  });
  return y + 18;
}
async function saveSlurryReportImage() {
  const report = window.latestSlurryReport;
  if (!report) throw new Error('Generate the report first.');
  await document.fonts.ready;
  const width = 1800, margin = 42;
  const estimatedHeight = 130 + (report.production.length + report.events.length + 4) * 56;
  if (estimatedHeight > 30000) throw new Error('Report is too long for one image.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = estimatedHeight;
  const context = canvas.getContext('2d'); context.fillStyle = '#f7fafc'; context.fillRect(0, 0, width, canvas.height);
  context.font = '800 32px "Microsoft YaHei","Segoe UI",sans-serif'; context.fillStyle = '#063b5c'; context.fillText('GNEM Slurry Production Details / GNEM 制浆生产明细', margin, 52);
  context.font = '600 18px "Microsoft YaHei","Segoe UI",sans-serif'; context.fillStyle = '#536b7c'; context.fillText(`Report date / 报告日期: ${report.date}`, margin, 82);
  let y = 105;
  y = drawCanvasTable(context, 'Production data / 生产数据', report.production, report.productionColumns, y, width, margin);
  y = drawCanvasTable(context, 'Daily event details / 每日事件明细', report.events, report.eventColumns, y, width, margin);
  const output = document.createElement('canvas'); output.width = width; output.height = Math.min(canvas.height, y + 24); output.getContext('2d').drawImage(canvas, 0, 0);
  const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Image conversion failed.');
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `GNEM-slurry-${report.date}-daily-report.png`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveReportImage() {
  const report = document.querySelector('#report-sheet');
  if (report.hidden) { say('Generate the report first. / 请先生成报告。'); return; }
  const button = document.querySelector('#save-report-image');
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = 'Preparing image… / 正在生成图片…';
  report.classList.add('capturing-report');
  try {
    if (isSlitting && typeof saveSlittingReportImage === 'function') {
      await saveSlittingReportImage();
      say('Full report image saved. / 完整报告图片已保存。');
      return;
    }
    if (!isSlitting) {
      await saveSlurryReportImage();
      say('Full report image saved. / 完整报告图片已保存。');
      return;
    }
    await document.fonts.ready;
    const width = 1440;
    const height = Math.ceil(report.scrollHeight * (width / report.scrollWidth));
    if (height > 30000) throw new Error('Report is too long for one image.');
    const clone = report.cloneNode(true);
    clone.removeAttribute('hidden');
    clone.style.width = `${report.scrollWidth}px`;
    clone.style.margin = '0';
    const css = [...document.styleSheets].map(sheet => {
      try { return [...sheet.cssRules].map(rule => rule.cssText).join('\n'); }
      catch { return ''; }
    }).join('\n');
    const html = `<div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style>${clone.outerHTML}</div>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${report.scrollWidth}" height="${report.scrollHeight}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
    const source = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml;charset=utf-8'}));
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = source; });
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    URL.revokeObjectURL(source);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Image conversion failed.');
    const download = document.createElement('a');
    download.href = URL.createObjectURL(blob);
    download.download = `GNEM-${department}-${document.querySelector('#report-date').value}-daily-report.png`;
    download.click();
    setTimeout(() => URL.revokeObjectURL(download.href), 1000);
    say('Full report image saved. / 完整报告图片已保存。');
  } catch (error) {
    say(`${error.message || 'Could not save the report image.'} / 无法保存报告图片。`);
  } finally {
    report.classList.remove('capturing-report');
    button.disabled = false;
    button.textContent = previousText;
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
  return {...all, department, cost_failure_types: costFailureTypes, custom_fields};
}
async function submitRecord(form, path) {
  const submitButton = form.querySelector('button[type="submit"], button:not([type])');
  if (submitButton?.disabled) return;
  try {
    const payload = formPayload(form);
    if (!payload) { say('Enter a valid 24-hour event time: HH:MM - HH:MM. / 请输入有效的24小时事件时间。'); return; }
    sessionStorage.setItem(`gnem-draft:${department}:${form.id}`, JSON.stringify(payload));
    if (submitButton) { submitButton.disabled = true; submitButton.dataset.originalText = submitButton.textContent; submitButton.textContent = 'Saving… / 正在保存…'; }
    const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
    const data = await response.json();
    if (!response.ok) { say(data.error || 'Record was not saved.'); return; }
    sessionStorage.removeItem(`gnem-draft:${department}:${form.id}`); form.reset();
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
document.querySelector('#save-report-image').addEventListener('click', saveReportImage);
document.querySelectorAll('.copy').forEach(button => button.addEventListener('click', async () => {
  const table = document.querySelector(`#${button.dataset.copy} table`);
  if (!table) { say('Load records first, then copy the table.'); return; }
  try { await navigator.clipboard.writeText((isSlitting ? document.querySelector(`#${button.dataset.copy}`).innerText : table.innerText)); say('Table copied. You can paste it into Excel or another approved tool.'); }
  catch { say('Clipboard access was blocked by this browser. Select the table and copy it manually.'); }
}));

const taskMachineOptions = isSlitting ? ['FJ2','FJ3','FJ4','FJ5','FJ6','FX1','FX2','FX3','FX4','FX5','FX6','FX7','FX8'] : ['J1','J2','J3','J4','J5','J6','J7','J8','J9','J10-1','J10-2','J10-3','J10-4','J10-5'];
const slittingProductOptions = ['513MM','514.9MM','515.6MM','547MM','242MM','515.4MM','270.6MM','270MM','88.8MM','67.1MM','73.8MM','96MM','264.5MM','269.8MM','61MM','73.7MM','196MM','557.20MM','62.3MM','61.1MM','61.6MM','93.7MM','73.5MM',['CUSTOM','Custom / 自定义']];
const slittingStatusOptions = [['production_in_progress','Production in progress / 生产进行中'],['re_cut','Re-cut / 补切'],['label_changing','Label changing / 更换标签'],['CUSTOM','Custom / 自定义']];
const selectedOptionMarkup = (options, selected, placeholder) => `<option value="">${placeholder}</option>${options.map(option => { const value=Array.isArray(option)?option[0]:option,label=Array.isArray(option)?option[1]:option; return `<option value="${escapeHtml(value)}" ${selected===value?'selected':''}>${escapeHtml(label)}</option>`; }).join('')}`;
function homeTaskItemMarkup(item = {type: 'cleaning'}) {
  if (isSlitting) {
    if (item.type === 'slitting_training') return `<article class="task-item slitting-training-item"><div class="task-item-head"><strong>Training / 培训</strong><button type="button" class="secondary remove-task-item">Remove / 删除</button></div><label>Training item / 培训项目<input class="slitting-training-item-name" maxlength="120" required value="${escapeHtml(item.training_item||'')}"></label><label>Training type / 培训类型<input class="slitting-training-type" maxlength="120" required value="${escapeHtml(item.training_type||'')}"></label><label>Person or group being trained / 受训人员或小组<input class="slitting-training-subject" maxlength="120" required value="${escapeHtml(item.subject||'')}"></label><label>Time / 时间<input class="slitting-training-time" maxlength="120" required value="${escapeHtml(item.time||'')}" placeholder="e.g. 9:00 AM–10:00 AM"></label></article>`;
    const knownProduct=slittingProductOptions.slice(0,-1).includes(String(item.product_item||'').replaceAll(' ','').toUpperCase()),selectedProduct=knownProduct?String(item.product_item||'').replaceAll(' ','').toUpperCase():(item.product_item?'CUSTOM':''),customProduct=selectedProduct==='CUSTOM'?(item.custom_product_item||item.product_item||''):'',targetUnit=item.target_unit||'sr';
    if (item.type === 'slitting_schedule') return `<article class="task-item slitting-schedule-item"><div class="task-item-head"><strong>Schedule row / 排程行</strong><button type="button" class="secondary remove-task-item">Remove / 删除</button></div><label>Machine / 机台<select class="slitting-schedule-machine" required>${selectedOptionMarkup(taskMachineOptions,item.machine,'Select machine / 选择机台')}</select></label><label>Product / 项目<select class="slitting-schedule-product" required>${selectedOptionMarkup(slittingProductOptions,selectedProduct,'Select product / 选择项目')}</select></label><label class="slitting-schedule-custom-product" ${selectedProduct==='CUSTOM'?'':'hidden'}>Custom product / 自定义项目<input maxlength="120" value="${escapeHtml(customProduct)}"></label><label>Planned input / 计划排产<input class="slitting-planned-input" maxlength="120" required value="${escapeHtml(item.planned_input||'')}"></label><label>Operator / 操作员<input class="slitting-operator" maxlength="120" required value="${escapeHtml(item.operator||'')}"></label><label>Shift lead / 班组长<input class="slitting-shift-lead" maxlength="120" required value="${escapeHtml(item.shift_lead||'')}"></label></article>`;
    const customStatus=!slittingStatusOptions.slice(0,-1).some(option=>option[0]===item.production_status)&&item.production_status?item.production_status:(item.custom_status||'');
    const selectedStatus=customStatus?'CUSTOM':item.production_status;
    return `<article class="task-item slitting-production-item"><div class="task-item-head"><strong>Production item / 生产项目</strong><button type="button" class="secondary remove-task-item">Remove / 删除</button></div><label>Production item / 生产项目<select class="slitting-product-item" required>${selectedOptionMarkup(slittingProductOptions,selectedProduct,'Select product / 选择项目')}</select></label><label class="slitting-custom-product" ${selectedProduct==='CUSTOM'?'':'hidden'}>Custom product or task / 自定义产品或任务<input maxlength="120" value="${escapeHtml(customProduct)}" placeholder="Cleaning or another custom item / 清洁或其他项目"></label><label>Production status / 生产状态<select class="slitting-production-status" required>${selectedOptionMarkup(slittingStatusOptions,selectedStatus,'Select status / 选择状态')}</select></label><label class="slitting-custom-status" ${selectedStatus==='CUSTOM'?'':'hidden'}>Custom status / 自定义状态<input maxlength="120" value="${escapeHtml(customStatus)}"></label><label>Production target / 生产目标<input class="slitting-production-target" type="number" min="0" max="1000000" step="0.01" required value="${item.production_target??''}"><small>Zero is allowed for testing or setup. / 测试或调试可填 0。</small></label><label>Target unit / 目标单位<select class="slitting-target-unit" required>${selectedOptionMarkup([['sr','sr'],['MR','MR'],['custom','Custom / 自定义']],targetUnit,'Select unit / 选择单位')}</select></label><label class="slitting-custom-unit" ${targetUnit==='custom'?'':'hidden'}>Custom unit / 自定义单位<input maxlength="30" value="${escapeHtml(item.custom_unit||'')}"></label></article>`;
  }
  const standardFormula = ['K1-26', 'B1-1', 'E3'].includes(item.formula_code) ? item.formula_code : (item.formula_code ? 'CUSTOM' : '');
  const machines = taskMachineOptions.map(machine => `<option ${item.machine_assigned === machine ? 'selected' : ''}>${machine}</option>`).join('');
  return `<article class="task-item"><div class="task-item-head"><strong>Task item / 任务项</strong><button type="button" class="secondary remove-task-item">Remove / 删除</button></div>
    <label>Task type / 任务类型<select class="task-item-type"><option value="cleaning" ${item.type === 'cleaning' ? 'selected' : ''}>Cleaning / 清洁</option><option value="custom" ${item.type === 'custom' ? 'selected' : ''}>Custom / 自定义</option><option value="production" ${item.type === 'production' ? 'selected' : ''}>Production / 生产</option></select></label>
    <label class="task-item-description">Task name / 任务名称<input class="task-item-description-input" maxlength="255" value="${escapeHtml(item.description || '')}" placeholder="Describe this task / 填写任务名称"></label>
    <label class="task-cleaning-process" hidden>Cleaning process / 清洁类型<select class="task-item-process"><option value="">Select type / 选择类型</option><option value="semi" ${item.process_type === 'semi' ? 'selected' : ''}>Semi / 半自动</option><option value="auto" ${item.process_type === 'auto' ? 'selected' : ''}>Auto / 全自动</option></select></label>
    <div class="task-production-fields"><label>Formula / 配方<select class="task-item-formula"><option value="">Select formula / 选择配方</option><option ${standardFormula === 'K1-26' ? 'selected' : ''}>K1-26</option><option ${standardFormula === 'B1-1' ? 'selected' : ''}>B1-1</option><option ${standardFormula === 'E3' ? 'selected' : ''}>E3</option><option value="CUSTOM" ${standardFormula === 'CUSTOM' ? 'selected' : ''}>Custom / 自定义</option></select></label><label class="task-item-custom-formula" hidden>Custom formula / 自定义配方<input maxlength="50" value="${standardFormula === 'CUSTOM' ? escapeHtml(item.formula_code) : ''}"></label><label>Tank amount needed / 所需罐数<input class="task-item-amount" type="number" min="0" step="0.01" value="${item.amount_needed ?? ''}" placeholder="0.00"></label><label>Weight needed (kg) / 所需重量（公斤）<input class="task-item-weight" type="number" min="0" step="0.01" value="${item.weight_needed ?? ''}" placeholder="0.00"></label><label>Machine assigned / 分配设备<select class="task-item-machine"><option value="">Select machine / 选择设备</option>${machines}</select></label></div>
  </article>`;
}
function syncHomeTaskItem(item) {
  if (isSlitting) return;
  const type = item.querySelector('.task-item-type').value;
  item.querySelector('.task-production-fields').hidden = type !== 'production';
  item.querySelector('.task-item-description').hidden = type === 'production';
  item.querySelector('.task-cleaning-process').hidden = type !== 'cleaning';
  item.querySelector('.task-item-custom-formula').hidden = type !== 'production' || item.querySelector('.task-item-formula').value !== 'CUSTOM';
}
function taskItemOrder(item) {
  if (isSlitting) {
    if (item.classList.contains('slitting-production-item')) return 10;
    if (item.classList.contains('slitting-schedule-item')) return 20;
    if (item.classList.contains('slitting-training-item')) return 30;
    return 99;
  }
  return {production: 10, cleaning: 20, custom: 30}[item.querySelector('.task-item-type')?.value] || 99;
}
function groupHomeTaskItems() {
  const root = document.querySelector('#home-task-items');
  [...root.querySelectorAll('.task-item')]
    .sort((left, right) => taskItemOrder(left) - taskItemOrder(right))
    .forEach(item => root.append(item));
}
function refreshHomeTaskItems() { document.querySelectorAll('.task-item').forEach(item=>{syncHomeTaskItem(item);const unit=item.querySelector('.slitting-target-unit');if(unit){const custom=item.querySelector('.slitting-custom-unit');custom.hidden=unit.value!=='custom';custom.querySelector('input').required=unit.value==='custom';}[['.slitting-product-item','.slitting-custom-product'],['.slitting-schedule-product','.slitting-schedule-custom-product'],['.slitting-production-status','.slitting-custom-status']].forEach(([selectKey,fieldKey])=>{const select=item.querySelector(selectKey),field=item.querySelector(fieldKey);if(select&&field){field.hidden=select.value!=='CUSTOM';field.querySelector('input').required=select.value==='CUSTOM';}});});groupHomeTaskItems(); }
function localDateValue(value) {
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}
function currentTaskSlot(now = new Date()) {
  const target = new Date(now);
  if (!isSlitting) {
    return {date: localDateValue(target), shift: target.getDay() === 6 ? 'Day 08-17' : 'Day 08-20'};
  }
  let shift = 'Day';
  if (now.getHours() < 8) { target.setDate(target.getDate() - 1); shift = 'Night'; }
  else if (now.getHours() >= 20) shift = 'Night';
  return {date: localDateValue(target), shift};
}
async function fillHomeTaskEditor() {
  const date = document.querySelector('#home-task-date').value;
  const shift = document.querySelector('#home-task-shift').value;
  const response = await fetch('/api/daily-task?' + new URLSearchParams({date, shift})); const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load today’s task.');
  const items = data.task?.task_items || []; const root = document.querySelector('#home-task-items');
  const typeOrder = isSlitting
    ? {slitting_production: 10, slitting_schedule: 20, slitting_training: 30}
    : {production: 10, cleaning: 20, custom: 30};
  const groupedItems = [...(items.length ? items : (isSlitting ? [{type:'slitting_production'},{type:'slitting_schedule'}] : [{type: 'cleaning'}]))]
    .sort((left, right) => (typeOrder[left.type] || 99) - (typeOrder[right.type] || 99));
  root.innerHTML = groupedItems.map(homeTaskItemMarkup).join('');
  document.querySelector('#home-task-editor-help').textContent = isSlitting ? 'Set today’s production items and targets, then add the machine schedule below. Actual progress is calculated from qualified Slitting production records. / 设置今日生产项目及目标，并在下方添加机台排程；实际进度按合格分切记录计算。' : 'Add one item per task. Each production item has its own formula, tanks, and assigned machine. / 每项任务单独添加；每个生产任务可设置独立配方、罐数和设备。';
  document.querySelector('#home-reminders').value = (data.task?.reminders || []).join('\n');
  refreshHomeTaskItems();
}

document.querySelector('#edit-home-task').addEventListener('click', async () => {
  try { const slot=currentTaskSlot();document.querySelector('#home-task-date').value=slot.date;document.querySelector('#home-task-shift').value=slot.shift;if(isSlitting&&window.refreshSlittingOptions)await window.refreshSlittingOptions();else if(isSlitting&&window.slittingOptionsReady)await window.slittingOptionsReady;await fillHomeTaskEditor(); document.querySelector('#home-task-dialog').showModal(); }
  catch (error) { say(error.message); }
});
document.querySelector('#close-home-task').addEventListener('click', () => document.querySelector('#home-task-dialog').close());
document.querySelector('#load-home-task-slot').addEventListener('click', async () => { try { await fillHomeTaskEditor(); } catch(error) { say(error.message); } });
document.querySelector('#add-home-task-item').addEventListener('click', () => { document.querySelector('#home-task-items').insertAdjacentHTML('beforeend', homeTaskItemMarkup(isSlitting?{type:'slitting_production'}:undefined)); refreshHomeTaskItems(); });
document.querySelector('#add-home-schedule-item').addEventListener('click', () => { document.querySelector('#home-task-items').insertAdjacentHTML('beforeend', homeTaskItemMarkup({type:'slitting_schedule'})); refreshHomeTaskItems(); });
document.querySelector('#add-home-training-item')?.addEventListener('click', () => { document.querySelector('#home-task-items').insertAdjacentHTML('beforeend', homeTaskItemMarkup({type:'slitting_training'})); refreshHomeTaskItems(); });
document.querySelector('#home-task-items').addEventListener('change', refreshHomeTaskItems);
document.querySelector('#home-task-items').addEventListener('click', event => { if (event.target.classList.contains('remove-task-item')) { event.target.closest('.task-item').remove(); } });
document.querySelector('#home-daily-task-form').addEventListener('submit', async event => {
  event.preventDefault();
  const taskItems = [...document.querySelectorAll('.task-item')].map(item => { if(isSlitting){if(item.classList.contains('slitting-training-item'))return {type:'slitting_training',training_item:item.querySelector('.slitting-training-item-name').value,training_type:item.querySelector('.slitting-training-type').value,subject:item.querySelector('.slitting-training-subject').value,time:item.querySelector('.slitting-training-time').value};if(item.classList.contains('slitting-schedule-item'))return {type:'slitting_schedule',machine:item.querySelector('.slitting-schedule-machine').value,product_item:item.querySelector('.slitting-schedule-product').value,custom_product_item:item.querySelector('.slitting-schedule-custom-product input').value,planned_input:item.querySelector('.slitting-planned-input').value,operator:item.querySelector('.slitting-operator').value,shift_lead:item.querySelector('.slitting-shift-lead').value};const status=item.querySelector('.slitting-production-status').value;return {type:'slitting_production',product_item:item.querySelector('.slitting-product-item').value,custom_product_item:item.querySelector('.slitting-custom-product input').value,production_status:status,custom_status:status==='CUSTOM'?item.querySelector('.slitting-custom-status input').value:'',production_target:item.querySelector('.slitting-production-target').value,target_unit:item.querySelector('.slitting-target-unit').value,custom_unit:item.querySelector('.slitting-custom-unit input').value};} const formula = item.querySelector('.task-item-formula').value === 'CUSTOM' ? item.querySelector('.task-item-custom-formula input').value : item.querySelector('.task-item-formula').value; return {type: item.querySelector('.task-item-type').value, description: item.querySelector('.task-item-description-input').value, process_type: item.querySelector('.task-item-process').value, formula_code: formula, amount_needed: item.querySelector('.task-item-amount').value, weight_needed: item.querySelector('.task-item-weight').value, machine_assigned: item.querySelector('.task-item-machine').value}; });
  const reminders = document.querySelector('#home-reminders').value.split('\n').map(value => value.trim()).filter(Boolean);
  const payload = {record_date:document.querySelector('#home-task-date').value,shift_name:document.querySelector('#home-task-shift').value,task_items: taskItems, reminders};
  const response = await fetch('/api/daily-task', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
  const data = await response.json(), status = document.querySelector('#home-daily-task-status');
  status.textContent = response.ok ? `${data.message} / 班次任务已保存。` : data.error;
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
  if (response.ok) {
    loadManagerStandardFields(payload.form_key);
    if (isSlitting) setTimeout(() => location.reload(), 450);
  }
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

window.addEventListener("DOMContentLoaded", () => { loadHomeTask(); loadHomeOngoing(); });

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
  if (isSlitting) return openSlittingEditor(type, record);
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
  const editPath = type === 'abnormality'
    ? `/api/abnormality-reports/${id}`
    : `/api/manager/records/${type}/${id}`;
  const response = await fetch(editPath), data = await response.json();
  if (!response.ok) { say(data.error || 'Could not load record.'); return; }
  openManagerRecordDialog(type, data.record);
});
document.querySelector('#close-manager-record-dialog').addEventListener('click', () => document.querySelector('#manager-record-dialog').close());
document.querySelector('#manager-record-edit').addEventListener('submit', async event => {
  event.preventDefault();
  if (!managerRecordContext) return;
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  if (typeof payload.custom_fields === 'string') {
    try { payload.custom_fields = JSON.parse(payload.custom_fields); } catch { payload.custom_fields = {}; }
  }
  const editing = Boolean(managerRecordContext.id);
  const path = editing
    ? managerRecordContext.type === 'abnormality'
      ? `/api/abnormality-reports/${managerRecordContext.id}`
      : `/api/manager/records/${managerRecordContext.type}/${managerRecordContext.id}`
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
function displaySettingMarkup(item,kind){const label=kind==='blocks'?'Title / 标题':'Column title / 列标题';const width=kind==='blocks'?`<input data-setting-width type="hidden" value="${Number(item.width)||1}"><input data-setting-height type="hidden" value="${Number(item.height)||1}"><input data-setting-font-size type="hidden" value="${Math.max(12,Math.min(Number(item.font_size)||16,36))}">`:'<span></span>';const custom=item.type==='static_text'?`<input data-setting-heading-level type="hidden" value="${item.heading_level==='h1'?'h1':'h2'}"><textarea data-setting-content maxlength="4000">${escapeHtml(item.content||'')}</textarea>`:'';return `<div class="display-setting-row" data-setting-key="${escapeHtml(item.key)}" data-setting-type="${escapeHtml(item.type||'built_in')}"><input data-setting-label value="${escapeHtml(item.title||item.label)}" maxlength="160" required><input data-setting-order type="number" min="0" max="999" value="${Number(item.order)}" required>${width}<input data-setting-visible type="checkbox" ${item.visible?'checked':''}>${custom}</div>`}
async function openDisplaySettings(){const response=await fetch('/api/manager/display-settings');const data=await response.json();if(!response.ok){say(data.error||'Unlock manager access before editing the display.');return}const branding=data.settings.branding||{};document.querySelector('#display-brand-title').value=branding.title||'';document.querySelector('#display-brand-eyebrow').value=branding.display_eyebrow||branding.title||'';document.querySelector('#display-brand-display-title').value=branding.display_title||'Daily Factory Display / 每日工厂看板';document.querySelector('#display-block-settings').innerHTML=data.settings.blocks.sort((a,b)=>a.order-b.order).map(x=>displaySettingMarkup(x,'blocks')).join('');document.querySelector('#display-column-settings').innerHTML=data.settings.event_columns.map(x=>displaySettingMarkup(x,'event_columns')).join('');renderDisplayLayoutPreview();document.querySelector('#display-settings-dialog').showModal()}
function renderDisplayLayoutPreview(){const root=document.querySelector('#display-layout-preview');const rows=[...document.querySelectorAll('#display-block-settings .display-setting-row')];root.innerHTML=rows.map(row=>{const title=row.querySelector('[data-setting-label]').value;const width=Number(row.querySelector('[data-setting-width]').value)||1;const height=Number(row.querySelector('[data-setting-height]').value)||1;const fontSize=Number(row.querySelector('[data-setting-font-size]').value)||16;const visible=row.querySelector('[data-setting-visible]').checked;const content=row.querySelector('[data-setting-content]')?.value||'';const removable=row.dataset.settingType==='static_text';const headingLevel=row.querySelector('[data-setting-heading-level]')?.value||'h2';return `<article class="display-preview-block preview-width-${width} preview-height-${height} ${visible?'':'is-hidden'}" style="--preview-font-size:${fontSize}px" data-setting-key="${escapeHtml(row.dataset.settingKey)}"><div class="display-preview-toolbar"><button class="display-move-handle" type="button" draggable="true" title="Drag to move / 拖动移动">⠿ Move / 移动</button><label class="preview-font-label">Font / 字号 <select class="preview-font-size" aria-label="Block font size">${[12,14,16,18,20,24,28,32,36].map(size=>`<option value="${size}" ${size===fontSize?'selected':''}>${size}px</option>`).join('')}</select></label>${removable?`<label>Header / 标题 <select class="preview-heading-level"><option value="h1" ${headingLevel==='h1'?'selected':''}>Heading 1</option><option value="h2" ${headingLevel==='h2'?'selected':''}>Heading 2</option></select></label>`:''}<label><input class="preview-visible" type="checkbox" ${visible?'checked':''}> Show / 显示</label>${removable?'<button class="remove-display-block" type="button">Remove / 删除</button>':''}</div><input class="preview-title preview-${headingLevel}" value="${escapeHtml(title)}" maxlength="160" aria-label="Block title">${removable?`<textarea class="preview-content" maxlength="4000" aria-label="Permanent text" placeholder="One item per line. Use - for bullets or 1. for numbered lists. / 每行一项；使用 - 创建项目符号，使用 1. 创建编号列表。">${escapeHtml(content)}</textarea>`:''}<small class="preview-size">${width} × ${height}</small><button class="display-resize-handle" type="button" aria-label="Resize block / 调整区块大小" title="Drag to resize / 拖动调整大小">↘</button></article>`}).join('')}
function settingRowForCard(card){return document.querySelector(`#display-block-settings [data-setting-key="${CSS.escape(card.dataset.settingKey)}"]`)}
function syncBlockOrderFromPreview(){const settings=document.querySelector('#display-block-settings');[...document.querySelectorAll('#display-layout-preview .display-preview-block')].forEach((card,index)=>{const row=settingRowForCard(card);settings.append(row);row.querySelector('[data-setting-order]').value=(index+1)*10})}
function syncCanvasCard(card){const row=settingRowForCard(card);row.querySelector('[data-setting-label]').value=card.querySelector('.preview-title').value;row.querySelector('[data-setting-visible]').checked=card.querySelector('.preview-visible').checked;const fontSize=Number(card.querySelector('.preview-font-size').value)||16;row.querySelector('[data-setting-font-size]').value=fontSize;card.style.setProperty('--preview-font-size',`${fontSize}px`);const heading=row.querySelector('[data-setting-heading-level]');if(heading){heading.value=card.querySelector('.preview-heading-level').value;card.querySelector('.preview-title').className=`preview-title preview-${heading.value}`}const content=row.querySelector('[data-setting-content]');if(content)content.value=card.querySelector('.preview-content').value}
let draggedDisplayBlock=null;
document.querySelector('#display-layout-preview').addEventListener('dragstart',event=>{if(!event.target.classList.contains('display-move-handle')){event.preventDefault();return}draggedDisplayBlock=event.target.closest('.display-preview-block');draggedDisplayBlock.classList.add('dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',draggedDisplayBlock.dataset.settingKey)});
document.querySelector('#display-layout-preview').addEventListener('dragover',event=>{event.preventDefault();if(!draggedDisplayBlock)return;const target=event.target.closest('.display-preview-block');if(!target||target===draggedDisplayBlock)return;const box=target.getBoundingClientRect();const after=event.clientY>box.top+box.height/2||(Math.abs(event.clientY-(box.top+box.height/2))<box.height/3&&event.clientX>box.left+box.width/2);target.parentElement.insertBefore(draggedDisplayBlock,after?target.nextSibling:target)});
document.querySelector('#display-layout-preview').addEventListener('drop',event=>{event.preventDefault();syncBlockOrderFromPreview()});
document.querySelector('#display-layout-preview').addEventListener('dragend',()=>{if(draggedDisplayBlock)draggedDisplayBlock.classList.remove('dragging');draggedDisplayBlock=null});
let resizeState=null;
document.querySelector('#display-layout-preview').addEventListener('pointerdown',event=>{if(!event.target.classList.contains('display-resize-handle'))return;event.preventDefault();const card=event.target.closest('.display-preview-block');const row=settingRowForCard(card);resizeState={card,row,startX:event.clientX,startY:event.clientY,startWidth:card.getBoundingClientRect().width,startHeight:card.getBoundingClientRect().height};event.target.setPointerCapture?.(event.pointerId)});
document.querySelector('#display-layout-preview').addEventListener('pointermove',event=>{if(!resizeState)return;const canvas=document.querySelector('#display-layout-preview');const gap=12,col=(canvas.clientWidth-28-gap*4)/5;const width=Math.max(1,Math.min(5,Math.round((resizeState.startWidth+event.clientX-resizeState.startX+gap)/(col+gap))));const height=Math.max(1,Math.min(5,Math.round((resizeState.startHeight+event.clientY-resizeState.startY+gap)/(140+gap))));for(let size=1;size<=5;size++){resizeState.card.classList.toggle(`preview-width-${size}`,size===width);resizeState.card.classList.toggle(`preview-height-${size}`,size===height)}resizeState.row.querySelector('[data-setting-width]').value=width;resizeState.row.querySelector('[data-setting-height]').value=height;resizeState.card.querySelector('.preview-size').textContent=`${width} × ${height}`});
document.querySelector('#display-layout-preview').addEventListener('pointerup',()=>{resizeState=null});
document.querySelector('#display-layout-preview').addEventListener('input',event=>{const card=event.target.closest('.display-preview-block');if(card)syncCanvasCard(card)});
document.querySelector('#display-layout-preview').addEventListener('change',event=>{const card=event.target.closest('.display-preview-block');if(card){syncCanvasCard(card);card.classList.toggle('is-hidden',!card.querySelector('.preview-visible').checked)}});
function collectDisplaySettings(root,kind){return [...root.querySelectorAll('.display-setting-row')].map(row=>({key:row.dataset.settingKey,[kind==='blocks'?'title':'label']:row.querySelector('[data-setting-label]').value,order:Number(row.querySelector('[data-setting-order]').value),visible:row.querySelector('[data-setting-visible]').checked,...(kind==='blocks'?{width:Number(row.querySelector('[data-setting-width]').value),height:Number(row.querySelector('[data-setting-height]').value),font_size:Number(row.querySelector('[data-setting-font-size]').value),type:row.dataset.settingType,content:row.querySelector('[data-setting-content]')?.value||'',heading_level:row.querySelector('[data-setting-heading-level]')?.value||'h2'}:{})}))}
document.querySelector('#add-permanent-text-block').addEventListener('click',()=>{const key=`text_${crypto.randomUUID()}`;const root=document.querySelector('#display-block-settings');root.insertAdjacentHTML('beforeend',displaySettingMarkup({key,type:'static_text',title:'Permanent tasks / 永久任务',content:'',heading_level:'h2',visible:true,order:(root.children.length+1)*10,width:5,height:1,font_size:16},'blocks'));renderDisplayLayoutPreview();document.querySelector('#display-layout-preview .display-preview-block:last-child')?.scrollIntoView({behavior:'smooth',block:'center'})});
document.querySelector('#display-layout-preview').addEventListener('click',event=>{if(!event.target.classList.contains('remove-display-block'))return;const card=event.target.closest('.display-preview-block');settingRowForCard(card).remove();card.remove();syncBlockOrderFromPreview()});
document.querySelector('#open-display-settings').addEventListener('click',openDisplaySettings);document.querySelector('#close-display-settings').addEventListener('click',()=>document.querySelector('#display-settings-dialog').close());document.querySelector('#display-settings-form').addEventListener('submit',async event=>{event.preventDefault();const payload={branding:{title:document.querySelector('#display-brand-title').value,subtitle:'',display_eyebrow:document.querySelector('#display-brand-eyebrow').value,display_title:document.querySelector('#display-brand-display-title').value},blocks:collectDisplaySettings(document.querySelector('#display-block-settings'),'blocks'),event_columns:collectDisplaySettings(document.querySelector('#display-column-settings'),'event_columns')};const response=await fetch('/api/manager/display-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await response.json();document.querySelector('#display-settings-status').textContent=response.ok?'Display settings saved. / 看板设置已保存。':(data.error||'Could not save display settings.');if(response.ok)document.querySelector('#brand-title').textContent=data.settings.branding.title});
document.querySelector('#select-all-event-columns')?.addEventListener('click',()=>{document.querySelectorAll('#display-column-settings [data-setting-visible]').forEach(input=>{input.checked=true});document.querySelector('#display-settings-status').textContent='All Slitting event columns selected. Save the display to apply. / 已全选分切事件列，请保存看板。'});
