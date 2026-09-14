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

function displayDate(value) {
  const parts = String(value || '').split('-');
  return parts.length === 3 ? `${parts[1]}/${parts[2]}/${parts[0]}` : text(value);
}

function adaptDisplayBlocks() {
  document.querySelectorAll('.display-section:not([hidden])').forEach(section => {
    const itemCount = section.querySelectorAll('.display-task-list li,.pending-qualification-item,.ongoing-item,.display-table tbody tr,.slitting-machine-card,.slitting-task-overview>article').length;
    const savedWidth = Number(section.dataset.savedWidth || section.style.gridColumn.match(/\d+/)?.[0] || 1);
    section.dataset.savedWidth = String(savedWidth);
    section.dataset.density = itemCount >= 8 ? 'high' : itemCount >= 4 ? 'medium' : 'low';
    const adaptiveWidth = itemCount >= 8 ? 5 : itemCount >= 4 ? Math.max(savedWidth, 3) : savedWidth;
    section.style.gridColumn = `span ${Math.min(adaptiveWidth, 5)}`;
  });
}

function startAutomaticOverflowCycle() {
  if (fitScreen || window.__displayOverflowCycle) return;
  window.__displayOverflowCycle = true;
  const pauseMilliseconds = 3000;
  const pixelsPerSecond = 34;
  const move = direction => {
    const limit = document.documentElement.scrollHeight - window.innerHeight;
    if (limit <= 16) {
      window.scrollTo(0, 0);
      setTimeout(() => move('down'), pauseMilliseconds);
      return;
    }
    const start = window.scrollY;
    const target = direction === 'down' ? limit : 0;
    const distance = Math.abs(target - start);
    const duration = Math.max(2500, distance / pixelsPerSecond * 1000);
    let startedAt = null;
    const frame = timestamp => {
      if (document.hidden) { startedAt = null; requestAnimationFrame(frame); return; }
      if (startedAt === null) startedAt = timestamp;
      const progress = Math.min((timestamp - startedAt) / duration, 1);
      const eased = progress < .5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      window.scrollTo(0, start + (target - start) * eased);
      if (progress < 1) requestAnimationFrame(frame);
      else setTimeout(() => move(direction === 'down' ? 'up' : 'down'), pauseMilliseconds);
    };
    requestAnimationFrame(frame);
  };
  setTimeout(() => move('down'), pauseMilliseconds);
}

function productionTrendChart(rows) {
  const width=720,height=230,left=48,right=18,top=22,bottom=38,plotWidth=width-left-right,plotHeight=height-top-bottom,max=Math.max(1,...rows.flatMap(row=>[Number(row.planned)||0,Number(row.actual)||0])),slot=plotWidth/Math.max(rows.length,1),barWidth=Math.min(42,slot*.5);
  const y=value=>top+plotHeight-(Number(value)||0)/max*plotHeight;
  const grid=[0,.5,1].map(ratio=>`<line x1="${left}" y1="${top+plotHeight*(1-ratio)}" x2="${width-right}" y2="${top+plotHeight*(1-ratio)}" class="chart-grid"/><text x="${left-8}" y="${top+plotHeight*(1-ratio)+4}" text-anchor="end">${Math.round(max*ratio).toLocaleString()}</text>`).join('');
  const bars=rows.map((row,index)=>{const x=left+slot*index+(slot-barWidth)/2,barHeight=plotHeight-(y(row.actual)-top);return `<rect x="${x}" y="${y(row.actual)}" width="${barWidth}" height="${Math.max(barHeight,1)}" rx="3" class="chart-actual"/><text x="${x+barWidth/2}" y="${height-12}" text-anchor="middle">${text(row.date).slice(5)}</text>`}).join('');
  const points=rows.map((row,index)=>`${left+slot*index+slot/2},${y(row.planned)}`).join(' '),dots=rows.map((row,index)=>`<circle cx="${left+slot*index+slot/2}" cy="${y(row.planned)}" r="4" class="chart-planned-dot"/>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Actual production bars and planned production line for seven days">${grid}${bars}<polyline points="${points}" class="chart-planned-line"/>${dots}<g class="chart-legend"><rect x="${width-226}" y="2" width="12" height="12" rx="2" class="chart-actual"/><text x="${width-208}" y="12">Actual / 实际</text><line x1="${width-112}" y1="8" x2="${width-92}" y2="8" class="chart-planned-line"/><text x="${width-84}" y="12">Planned / 计划</text></g></svg>`;
}

function abnormalityTrendChart(rows) {
  const categories = [...new Map(
    rows
      .flatMap((row) => row.categories || [])
      .map((item) => [item.type, { type: item.type, label: item.label || item.type }]),
  ).values()].sort((a, b) => a.label.localeCompare(b.label));
  const palette = [
    '#4cc9a7', '#55a7e0', '#f0b85a', '#ef7b73',
    '#a98ce5', '#74c47d', '#e48ec3', '#8db4c9',
  ];
  const categoryIndex = Object.fromEntries(
    categories.map((item, index) => [item.type, index + 1]),
  );
  const colors = Object.fromEntries(
    categories.map((item, index) => [item.type, palette[index % palette.length]]),
  );
  const width = 720;
  const height = 290;
  const left = 46;
  const right = 16;
  const legendTop = 6;
  const legendRowHeight = 21;
  const legendRows = Math.max(1, Math.ceil(categories.length / 2));
  const top = legendTop + legendRows * legendRowHeight + 18;
  const bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const max = Math.max(1, ...rows.map((row) => Number(row.total_minutes) || 0));
  const slot = plotWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(62, slot * 0.68);

  // A numbered legend keeps long bilingual category names out of narrow bars.
  const legend = categories.map((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = left + column * 330;
    const y = legendTop + row * legendRowHeight;
    return `<g class="chart-category-legend">
      <rect x="${x}" y="${y}" width="14" height="14" rx="3" fill="${colors[item.type]}"/>
      <text x="${x + 20}" y="${y + 12}" class="chart-legend-label">
        ${categoryIndex[item.type]}. ${text(item.label)}
      </text>
    </g>`;
  }).join('');

  const bars = rows.map((row, index) => {
    const x = left + slot * index + (slot - barWidth) / 2;
    let cursor = top + plotHeight;
    const segments = (row.categories || []).map((segment) => {
      const value = Number(segment.minutes) || 0;
      const segmentHeight = value / max * plotHeight;
      const categoryNumber = categoryIndex[segment.type];
      cursor -= segmentHeight;
      const centerX = x + barWidth / 2;
      const centerY = cursor + segmentHeight / 2;
      let label = '';
      if (segmentHeight >= 32) {
        label = `<text x="${centerX}" y="${centerY - 3}" text-anchor="middle" class="chart-segment-label">
          <tspan x="${centerX}">#${categoryNumber}</tspan>
          <tspan x="${centerX}" dy="13">${Math.round(value)} min</tspan>
        </text>`;
      } else if (segmentHeight >= 17) {
        label = `<text x="${centerX}" y="${centerY + 4}" text-anchor="middle" class="chart-segment-label">#${categoryNumber}</text>`;
      }
      return `<rect x="${x}" y="${cursor}" width="${barWidth}" height="${Math.max(segmentHeight, 1)}" fill="${colors[segment.type]}" class="chart-stack-segment">
        <title>${text(segment.label)}: ${value} min</title>
      </rect>${label}`;
    }).join('');
    const total = Number(row.total_minutes) || 0;
    return `${segments}
      <text x="${x + barWidth / 2}" y="${Math.max(cursor - 8, top - 4)}" text-anchor="middle" class="chart-value">${Math.round(total)} min</text>
      <text x="${x + barWidth / 2}" y="${height - 12}" text-anchor="middle">${text(row.date).slice(5)}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Stacked downtime minutes by abnormality category and date">
    ${legend}
    <line x1="${left}" y1="${top + plotHeight}" x2="${width - right}" y2="${top + plotHeight}" class="chart-grid"/>
    ${bars}
  </svg>`;
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
  (settings.blocks || []).forEach(block => { let el=document.querySelector(`[data-display-block="${block.key}"]`); if(!el&&block.type==='static_text'){el=document.createElement('section');el.className='display-section permanent-text-section';el.dataset.displayBlock=block.key;const heading=document.createElement('div');heading.className='section-head';const title=document.createElement(block.heading_level==='h1'?'h1':'h2');title.dataset.blockTitle='';heading.append(title);const content=document.createElement('div');content.className='permanent-text-content';el.append(heading,content);document.querySelector('.display-layout').append(el)} if(!el)return; el.hidden=!block.visible; el.style.order=Number(block.order)||0; const width=Math.max(1,Math.min(Number(block.width)||1,5));el.dataset.savedWidth=String(width);el.style.gridColumn=`span ${width}`; el.style.gridRow='auto'; el.style.setProperty('--block-height',String(Math.max(1,Math.min(Number(block.height)||1,5)))); el.style.setProperty('--block-font-size',`${Math.max(12,Math.min(Number(block.font_size)||16,36))}px`); let title=el.querySelector('[data-block-title]');if(title&&block.type==='static_text'&&title.tagName.toLowerCase()!==(block.heading_level==='h1'?'h1':'h2')){const replacement=document.createElement(block.heading_level==='h1'?'h1':'h2');replacement.dataset.blockTitle='';title.replaceWith(replacement);title=replacement} if(title)title.textContent=block.title;const content=el.querySelector('.permanent-text-content');if(content)renderPermanentText(content,block.content); });
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
    renderPendingQualifications(data.pending_qualifications || [], data.display_date);
    document.querySelector('#achievement-rate').textContent = percent(data.production.achievement_rate);
    document.querySelector('#qualified-rate').textContent = percent(data.production.qualified_rate);
    const productionDate = data.production.record_date || '—';
    const sameDay = `Production date: ${productionDate} / 生产日期`;
    document.querySelector('#achievement-note').textContent = sameDay;
    document.querySelector('#qualified-note').textContent = data.production.qualified_pending ? `${sameDay} · ${data.production.qualified_pending} pending / 待补录` : sameDay;
    const ongoingRows = data.ongoing_events.map(event => `<article class="ongoing-item"><strong>${text(event.machine_code)} · ${text(event.event_type)}</strong><span>Severity / Priority / 严重程度 / 优先级: ${text(event.severity)}</span><span>Responsible person / 责任人: ${text(event.responsible_person)}</span><span>Expected finish / 预计完成: ${text(event.target_finish_date)}</span><span>Event date / 事件日期: ${text(event.event_date)}</span></article>`).join('');
    document.querySelector('#ongoing-events').innerHTML = ongoingRows || '<p class="empty">No ongoing events / 暂无进行中事件</p>';
    document.querySelector('#production-trend-chart').innerHTML=productionTrendChart(data.trends?.production||[]);
    document.querySelector('#abnormality-trend-chart').innerHTML=abnormalityTrendChart(data.trends?.abnormalities||[]);
    requestAnimationFrame(()=>{adaptDisplayBlocks();fitDisplayToViewport();startAutomaticOverflowCycle();});
  } catch { document.querySelector('#last-updated').textContent = 'Display connection unavailable / 看板连接不可用'; }
}
refreshDisplay(); setInterval(refreshDisplay, 15000);
if (fitScreen) window.addEventListener('resize', () => requestAnimationFrame(fitDisplayToViewport));
