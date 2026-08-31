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
function displayDate(value) {
  const parts = String(value || '').split('-');
  return parts.length === 3 ? `${parts[1]}/${parts[2]}/${parts[0]}` : text(value);
}
function renderPendingQualifications(records, currentDate) {
  const root = document.querySelector('#pending-qualifications');
  if (!records.length) {
    root.innerHTML = `<p class="empty pending-current">No pending records until ${displayDate(currentDate)} / 截至 ${displayDate(currentDate)} 无待补录记录</p>`;
    return;
  }
  root.innerHTML = records.map(record => `<article class="pending-qualification-item"><strong>${displayDate(record.record_date)} · ${text(record.formula_code)}</strong><span>Qualified amount pending / 合格数量待补录</span><small>Machine / 设备: ${text(record.machine_code)} · Batch / 批次: ${text(record.batch_number)}</small></article>`).join('');
}
function renderPermanentText(root, value) {
  root.replaceChildren();
  const lines = String(value || '').split(/\r?\n/);
  let list = null, listType = '';
  const closeList = () => { list = null; listType = ''; };
  lines.forEach(line => {
    const unordered = line.match(/^\s*[-*•]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const nextType = unordered ? 'ul' : 'ol';
      if (!list || listType !== nextType) {
        list = document.createElement(nextType);
        listType = nextType;
        root.append(list);
      }
      const item = document.createElement('li');
      item.textContent = (unordered || ordered)[1];
      list.append(item);
      return;
    }
    closeList();
    if (!line.trim()) { root.append(document.createElement('br')); return; }
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    root.append(paragraph);
  });
}
function applyDisplaySettings(settings) {
  document.body.classList.add('configurable-display');
  (settings.blocks || []).forEach(block => { let el=document.querySelector(`[data-display-block="${block.key}"]`); if(!el&&block.type==='static_text'){el=document.createElement('section');el.className='display-section permanent-text-section';el.dataset.displayBlock=block.key;const heading=document.createElement('div');heading.className='section-head';const title=document.createElement('h2');title.dataset.blockTitle='';heading.append(title);const content=document.createElement('div');content.className='permanent-text-content';el.append(heading,content);document.querySelector('.display-layout').append(el)} if(!el)return; el.hidden=!block.visible; el.style.order=Number(block.order)||0; el.style.gridColumn=`span ${Math.max(1,Math.min(Number(block.width)||1,3))}`; el.style.gridRow=`span ${Math.max(1,Math.min(Number(block.height)||1,3))}`; el.style.setProperty('--block-font-size',`${Math.max(12,Math.min(Number(block.font_size)||16,36))}px`); const title=el.querySelector('[data-block-title]'); if(title)title.textContent=block.title;const content=el.querySelector('.permanent-text-content');if(content)renderPermanentText(content,block.content); });
}
function eventColumnValue(event,key) { if(key==='machine_type') return event.machine_type==='semi'?'Semi / 半自动':event.machine_type==='auto'?'Auto / 全自动':'—'; if(key==='is_resolved') return event.is_resolved==='yes'?'Yes / 是':'No / 否'; if(key==='effective_time_cost') return event.effective_time_cost==='yes'?'Yes / 是':event.effective_time_cost==='no'?'No / 否':'—'; if(key==='cost_failure_types'){try{const value=Array.isArray(event[key])?event[key]:JSON.parse(event[key]||'[]');return value.join(', ')||'—'}catch{return event[key]}} return event[key]; }
function renderEventTable(events,settings) {
  const columns=(settings.event_columns||[]).filter(x=>x.visible).sort((a,b)=>a.order-b.order);
  if(!events.length)return '<p class="empty">No events for this day / 当日暂无事件</p>'; if(!columns.length)return '<p class="empty">All Daily Event columns are hidden. / 每日事件列均已隐藏。</p>';
  const headers=columns.map(x=>`<th>${text(x.label)}</th>`).join(''); const rows=events.map(event=>`<tr>${columns.map(column=>`<td class="${column.key==='is_resolved'?(event.is_resolved==='yes'?'status-resolved':'status-open'):''}">${text(eventColumnValue(event,column.key))}</td>`).join('')}</tr>`).join('');
  return `<table class="display-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

async function refreshDisplay() {
  try {
    const response = await fetch(`/api/public-display${dateParam ? `?date=${encodeURIComponent(dateParam)}` : ''}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    applyDisplaySettings(data.display_settings || {blocks:[],event_columns:[]});
    const branding=data.display_settings?.branding||{};
    const brandTitle=document.querySelector('#display-brand-title');
    const brandSubtitle=document.querySelector('#display-brand-subtitle');
    if(brandTitle)brandTitle.textContent=branding.display_eyebrow||'GNEM SLURRY PRODUCTION DETAILS / GNEM 制浆生产明细';
    if(brandSubtitle)brandSubtitle.textContent=branding.display_title||'Daily Factory Display / 每日工厂看板';
    document.querySelector('#display-date').textContent = `${data.display_date} / 当日`;
    document.querySelector('#last-updated').textContent = data.last_updated ? `Last update / 最后更新: ${data.last_updated}` : 'No records yet / 暂无记录';
    renderTask(data.daily_task);
    renderReminders(data.daily_task);
    renderPendingQualifications(data.pending_qualifications || [], data.display_date);
    document.querySelector('#achievement-rate').textContent = percent(data.production.achievement_rate);
    document.querySelector('#qualified-rate').textContent = percent(data.production.qualified_rate);
    const productionDate = data.production.record_date || '—';
    const sameDay = `Production date: ${productionDate} / 生产日期`;
    document.querySelector('#achievement-note').textContent = sameDay;
    document.querySelector('#qualified-note').textContent = data.production.qualified_pending ? `${sameDay} · ${data.production.qualified_pending} pending / 待补录` : sameDay;
    document.querySelector('#event-detail-date').textContent = `${data.display_date} / 当日`;
    document.querySelector('#event-tracker').innerHTML = renderEventTable(data.event_tracker, data.display_settings);
    const ongoingRows = data.ongoing_events.map(event => `<article class="ongoing-item"><strong>${text(event.machine_code)} · ${text(event.event_type)}</strong><span>Severity / Priority / 严重程度 / 优先级: ${text(event.severity)}</span><span>Responsible person / 责任人: ${text(event.responsible_person)}</span><span>Expected finish / 预计完成: ${text(event.target_finish_date)}</span><span>Event date / 事件日期: ${text(event.event_date)}</span></article>`).join('');
    document.querySelector('#ongoing-events').innerHTML = ongoingRows || '<p class="empty">No ongoing events / 暂无进行中事件</p>';
    requestAnimationFrame(fitDisplayToViewport);
  } catch { document.querySelector('#last-updated').textContent = 'Display connection unavailable / 看板连接不可用'; }
}
refreshDisplay(); setInterval(refreshDisplay, 15000);
if (autoScroll) {
  const pixelsPerSecond = 22;
  let scrollPosition = window.scrollY;
  let previousFrame = null;
  const advanceAutoScroll = timestamp => {
    if (previousFrame === null || document.hidden) previousFrame = timestamp;
    const elapsed = Math.min(timestamp - previousFrame, 100);
    previousFrame = timestamp;
    const limit = document.documentElement.scrollHeight - window.innerHeight;
    if (limit > 0) {
      scrollPosition += pixelsPerSecond * elapsed / 1000;
      if (scrollPosition >= limit) scrollPosition = 0;
      window.scrollTo(0, scrollPosition);
    } else {
      scrollPosition = 0;
    }
    requestAnimationFrame(advanceAutoScroll);
  };
  requestAnimationFrame(advanceAutoScroll);
}
if (fitScreen) window.addEventListener('resize', () => requestAnimationFrame(fitDisplayToViewport));
