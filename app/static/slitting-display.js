const escapeHtml = value => String(value ?? '—').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const displayParams = new URLSearchParams(location.search);
const displayDepartment = displayParams.get('department') === 'coating' ? 'coating' : 'slitting';

function currentProductionSlot(now = new Date()) {
  const date = new Date(now);
  let shift = 'Day';
  const shiftMinutes = now.getHours() * 60 + now.getMinutes();
  if (shiftMinutes < 7 * 60 + 50) {
    date.setDate(date.getDate() - 1);
    shift = 'Night'
  } else if (shiftMinutes >= 19 * 60 + 50) shift = 'Night';
  const offset = date.getTimezoneOffset() * 60000;
  return {
    date: new Date(date.getTime() - offset).toISOString().slice(0, 10),
    shift
  };
}
const fixedDisplayDate = displayParams.get('date');
const fixedDisplayShift = displayParams.get('shift');
const autoScroll = displayParams.get('autoscroll') === '1';
const tvMode = displayParams.get('tv') === '1';
if (autoScroll) document.body.classList.add('auto-scroll');
if (tvMode) document.body.classList.add('tv-mode');

function fitTvDisplay() {
  if (!tvMode) return;
  document.documentElement.style.zoom = '1';
  document.body.style.width = '100%';
}

function adaptDisplayBlocks() {
  document.querySelectorAll('.display-section:not([hidden])').forEach(section => {
    const itemCount = section.querySelectorAll(
      '.display-table tbody tr,.slitting-machine-card,.slitting-task-overview>article').length;
    const savedWidth = Number(section.dataset.savedWidth || section.style.gridColumn.match(
      /\d+/)?.[0] || 1);
    section.dataset.savedWidth = String(savedWidth);
    section.dataset.density = itemCount >= 8 ? 'high' : itemCount >= 4 ? 'medium' : 'low';
    const adaptiveWidth = itemCount >= 8 ? 5 : itemCount >= 4 ? Math.max(savedWidth, 3) :
      savedWidth;
    section.style.gridColumn = `span ${Math.min(adaptiveWidth,5)}`;
  });
}

function startAutomaticOverflowCycle() {
  if (window.__displayOverflowCycle) return;
  window.__displayOverflowCycle = true;
  const topPauseMilliseconds = 3000,
    bottomPauseMilliseconds = 10000,
    pixelsPerSecond = 34;
  const root = document.documentElement;
  root.style.scrollBehavior = 'auto';
  const jumpToTop = () => window.scrollTo(0, 0);
  const scrollDown = () => {
    const initialLimit = root.scrollHeight - window.innerHeight;
    if (initialLimit <= 16) {
      jumpToTop();
      setTimeout(scrollDown, topPauseMilliseconds);
      return
    }
    const duration = Math.max(2500, initialLimit / pixelsPerSecond * 1000);
    let startedAt = null;
    const frame = timestamp => {
      if (document.hidden) {
        startedAt = null;
        requestAnimationFrame(frame);
        return
      }
      if (startedAt === null) startedAt = timestamp;
      const progress = Math.min((timestamp - startedAt) / duration, 1),
        eased = progress < .5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) /
        2;
      const currentLimit = Math.max(0, root.scrollHeight - window.innerHeight);
      window.scrollTo(0, currentLimit * eased);
      if (progress < 1) requestAnimationFrame(frame);
      else {
        const holdStarted = performance.now();
        window.__displayAtBottom = true;
        const holdAtBottom = holdTimestamp => {
          window.scrollTo(0, Math.max(0, root.scrollHeight - window.innerHeight));
          if (holdTimestamp - holdStarted < bottomPauseMilliseconds) requestAnimationFrame(
            holdAtBottom);
          else {
            window.__displayAtBottom = false;
            jumpToTop();
            setTimeout(scrollDown, topPauseMilliseconds)
          }
        };
        requestAnimationFrame(holdAtBottom);
      }
    };
    requestAnimationFrame(frame);
  };
  jumpToTop();
  setTimeout(scrollDown, topPauseMilliseconds);
}

function statValue(key, value) {
  if (value === null || value === undefined) return '—';
  if (key.endsWith('_rate')) return (Number(value) * 100).toFixed(2) + '%';
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 2
  }) + (key === 'records' ? '' : ' m²');
}

function slittingStats(stats) {
  const items = [
    ['planned_quantity', 'Target / 目标'],
    ['actual_quantity', 'Actual output / 实际产出'],
    ['qualified_quantity', 'Qualified output / 合格产出'],
    ['achievement_rate', 'Progress / 进度'],
    ['qualified_rate', 'Qualified / 合格率'],
    ['yield_rate', 'Yield / 综收'],
    ['records', 'Runs / 批次']
  ];
  return `<div class="slitting-kpi-grid">${items.map(([key,label])=>`<article><span>${label}</span><strong>${key==='qualified_quantity'&&stats.pending?'Pending / 待补录':statValue(key,stats[key])}</strong>${key==='qualified_rate'&&stats.pending?`<small>${stats.pending} pending / 待补录</small>`:''}</article>`).join('')}</div>`;
}

function renderMachines(machines, customFields = []) {
  if (!machines.length) return '<p class="empty">No production recorded / 暂无生产记录</p>';
  return `<div class="slitting-machine-grid">${machines.map(machine=>`<article class="slitting-machine-card"><div class="slitting-machine-head"><h3>${escapeHtml(machine.machine_code)}</h3><strong>${statValue('achievement_rate',machine.stats.achievement_rate)}</strong></div>${slittingStats(machine.stats)}${machine.records.map(record=>`<div class="display-record-detail"><strong>${escapeHtml(record.formula_code)} · ${escapeHtml(record.shift_name)}</strong>${customFields.map(field=>`<span>${escapeHtml(field.label)}: ${escapeHtml(record[field.field_key]||'—')}</span>`).join('')}</div>`).join('')}</article>`).join('')}</div>`;
}
const taskStatusLabels = {
  production_in_progress: 'Production in progress / 生产进行中',
  re_cut: 'Re-cut / 补切',
  label_changing: 'Label changing / 更换标签'
};

function taskActual(productItem, targetUnit, records) {
  const targetWidth = parseFloat(productItem);
  if (!Number.isFinite(targetWidth) || targetUnit === 'custom') return 0;
  return records.filter(record => Math.abs(Number(record.width_m) * 1000 - targetWidth) < 0.06)
    .reduce((total, record) => total + (Number(record.input_rolls) || 0), 0);
}

function renderSlittingTask(task, records, fieldLabels = {}) {
  const items = task?.task_items || [],
    productionItems = items.filter(item => item.type === 'slitting_production'),
    scheduleItems = items.filter(item => item.type === 'slitting_schedule');
  if (!productionItems.length && !scheduleItems.length)
  return '<p class="empty">No production task saved for this date / 当日暂无生产任务</p>';
  const overview = productionItems.length ?
    `<div class="slitting-task-overview">${productionItems.map(item=>{const targetUnit=item.target_unit||'sr',unit=targetUnit==='custom'?(item.custom_unit||'custom'):targetUnit,actual=taskActual(item.product_item,targetUnit,records),target=Number(item.production_target)||0,percent=target?actual/target*100:0,fill=Math.min(Math.max(percent,0),100);return `<article><div><span>Production item / 生产项目</span><strong>${escapeHtml(item.product_item)}</strong></div><div><span>Production status / 生产状态</span><strong>${escapeHtml(taskStatusLabels[item.production_status]||item.production_status)}</strong></div><div><span>Production target / 生产目标</span><strong>${target.toLocaleString()} ${escapeHtml(unit)}</strong></div><div class="slitting-task-progress"><span>Actual input progress / 实际投入进度</span><div class="progress-track ${actual>0?'has-progress':'no-progress'}" data-progress-fill="${fill}"><i></i></div><strong>${actual.toLocaleString()} / ${target.toLocaleString()} ${escapeHtml(unit)} · ${percent.toFixed(1)}%</strong></div></article>`}).join('')}</div>` :
    '';
  const schedule = scheduleItems.length ?
    `<div class="slitting-task-schedule"><h3>Machine production scheduling / 机器生产排程</h3><div class="display-table-wrap"><table class="display-table"><thead><tr><th>${escapeHtml(fieldLabels.machine_code||'Machine / 机台')}</th><th>Product / 项目</th><th>Planned input / 计划排产</th><th>Operator / 操作员</th><th>Shift lead / 班组长</th></tr></thead><tbody>${scheduleItems.map(item=>`<tr><td>${escapeHtml(item.machine)}</td><td>${escapeHtml(item.product_item)}</td><td>${escapeHtml(item.planned_input)}</td><td>${escapeHtml(item.operator)}</td><td>${escapeHtml(item.shift_lead)}</td></tr>`).join('')}</tbody></table></div></div>` :
    '';
  return overview + schedule;
}

function renderSlittingTraining(task) {
  const trainingItems = (task?.task_items || []).filter(item => item.type === 'slitting_training');
  if (!trainingItems.length) return '';
  return `<div class="display-table-wrap"><table class="display-table slitting-training-table"><thead><tr><th>Training item / 培训项目</th><th>Training type / 培训类型</th><th>Person/group trained / 受训人员或小组</th><th>Time / 时间</th></tr></thead><tbody>${trainingItems.map(item=>`<tr><td>${escapeHtml(item.training_item)}</td><td>${escapeHtml(item.training_type)}</td><td>${escapeHtml(item.subject)}</td><td>${escapeHtml(item.time)}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderPermanentText(root, value) {
  root.replaceChildren();
  let list = null,
    listType = '';
  String(value || '').split(/\r?\n/).forEach(line => {
    const unordered = line.match(/^\s*[-*•]\s+(.+)$/),
      ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const type = unordered ? 'ul' : 'ol';
      if (!list || listType !== type) {
        list = document.createElement(type);
        listType = type;
        root.append(list)
      }
      const item = document.createElement('li');
      item.textContent = (unordered || ordered)[1];
      list.append(item);
      return
    }
    list = null;
    listType = '';
    if (!line.trim()) {
      root.append(document.createElement('br'));
      return
    }
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    root.append(paragraph)
  });
}

function applyDisplaySettings(settings) {
  document.body.classList.add('configurable-display');
  const branding = settings.branding || {};
  document.querySelector('#display-brand-title').textContent = branding.display_eyebrow || (
    displayDepartment === 'coating' ? 'GNEM COATING PRODUCTION / GNEM 涂布生产' :
    'GNEM SLITTING PRODUCTION / GNEM 分切生产');
  document.querySelector('#display-brand-subtitle').textContent = branding.display_title || (
    displayDepartment === 'coating' ? 'Daily Coating Display / 涂布每日看板' :
    'Daily Slitting Display / 分切每日看板');
  (settings.blocks || []).forEach(block => {
    let element = document.querySelector(`[data-display-block="${block.key}"]`);
    if (!element && block.type === 'static_text') {
      element = document.createElement('section');
      element.className = 'display-section permanent-text-section';
      element.dataset.displayBlock = block.key;
      const head = document.createElement('div');
      head.className = 'section-head';
      const title = document.createElement(block.heading_level === 'h1' ? 'h1' : 'h2');
      title.dataset.blockTitle = '';
      head.append(title);
      const content = document.createElement('div');
      content.className = 'permanent-text-content';
      element.append(head, content);
      document.querySelector('.display-layout').append(element)
    }
    if (!element) return;
    element.hidden = !block.visible;
    element.style.order = Number(block.order) || 0;
    const width = Math.max(1, Math.min(Number(block.width) || 1, 5));
    element.dataset.savedWidth = String(width);
    element.style.gridColumn = `span ${width}`;
    element.style.gridRow = 'auto';
    element.style.setProperty('--block-height', String(Math.max(1, Math.min(Number(block
      .height) || 1, 5))));
    element.style.setProperty('--block-font-size',
      `${Math.max(12,Math.min(Number(block.font_size)||16,36))}px`);
    const title = element.querySelector('[data-block-title]');
    if (title) title.textContent = block.title;
    const content = element.querySelector('.permanent-text-content');
    if (content) renderPermanentText(content, block.content)
  });
}

function eventTable(events, settings) {
  const columns = (settings.event_columns || []).filter(item => item.visible).sort((a, b) => a
    .order - b.order);
  if (!events.length) return '<p class="empty">No abnormalities / 暂无异常记录</p>';
  if (!columns.length) return '<p class="empty">All event columns are hidden / 所有事件列均已隐藏</p>';
  return `<div class="slitting-event-grid">${events.map(row=>`<article class="slitting-event-item"><strong>${escapeHtml(row.machine_code)} · ${escapeHtml(row.event_type)}</strong>${columns.filter(column=>!['machine_code','event_type'].includes(column.key)).map(column=>`<span><b>${escapeHtml(column.label)}:</b> ${escapeHtml(row[column.key])}</span>`).join('')}</article>`).join('')}</div>`;
}

function slittingMachineAttainmentTrend(rows, dates) {
  const palette = ['#4cc9a7','#55a7e0','#f0b85a','#ef7b73','#a98ce5','#74c47d','#d982b5','#7f9bb3'],
    machines = [...new Set(rows.map(row => row.machine_code).filter(Boolean))].sort();
  if (!machines.length) return '';
  const values = Object.fromEntries(machines.map(machine => [machine, Object.fromEntries(dates.map(date => [date, {planned:0, actual:0}]))]));
  rows.forEach(row => {
    if (!values[row.machine_code]?.[row.record_date]) return;
    values[row.machine_code][row.record_date].planned += Number(row.planned_quantity) || 0;
    values[row.machine_code][row.record_date].actual += Number(row.actual_quantity) || 0;
  });
  const width=900,height=270,left=48,right=18,top=24,bottom=42,plotWidth=width-left-right,plotHeight=height-top-bottom,
    x=index=>left+(dates.length<2?plotWidth/2:index*plotWidth/(dates.length-1)), y=rate=>top+plotHeight-Math.min(rate,1.5)/1.5*plotHeight;
  const grid=[0,.5,1,1.5].map(rate=>`<line x1="${left}" y1="${y(rate)}" x2="${width-right}" y2="${y(rate)}" class="chart-grid"/><text x="${left-7}" y="${y(rate)+4}" text-anchor="end">${Math.round(rate*100)}%</text>`).join('');
  const lines=machines.map((machine,index)=>{
    const machinePoints=dates.map((date,dateIndex)=>{const item=values[machine][date],rate=item.planned?item.actual/item.planned:null;return {rate,x:x(dateIndex),y:rate==null?null:y(rate)}}),
      points=machinePoints.filter(point=>point.rate!=null).map(point=>`${point.x},${point.y}`).join(' '),
      pointLabels=machinePoints.filter(point=>point.rate!=null).map(point=>`<circle cx="${point.x}" cy="${point.y}" r="4" fill="${palette[index%palette.length]}"/><text x="${point.x}" y="${Math.max(14,point.y-10-(index%3)*11)}" text-anchor="middle" class="machine-point-label">${Math.round(point.rate*100)}%</text>`).join('');
    return `<polyline points="${points}" fill="none" stroke="${palette[index%palette.length]}" stroke-width="3"><title>${escapeHtml(machine)} plan attainment</title></polyline>${pointLabels}`;
  }).join('');
  const labels=dates.map((date,index)=>`<text x="${x(index)}" y="${height-13}" text-anchor="middle">${escapeHtml(date.slice(5))}</text>`).join('');
  const legend=machines.map((machine,index)=>`<span><i class="machine-color-${index%8}"></i>${escapeHtml(machine)}</span>`).join('');
  return `<section class="machine-trend-panel"><h3>Plan attainment by machine / 各机台计划达成率</h3><div class="machine-chart-legend">${legend}</div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Seven-day plan attainment rate by machine">${grid}${lines}${labels}</svg></section>`;
}

function slittingProductionTrend(rows, dailyRows) {
  const dates = (dailyRows || []).map(row => row.date),
    widthGroups = new Map();
  rows.forEach(row => {
    const suffix = String(row.formula_code || '').split('/').pop().trim(),
      match = suffix.match(/^([0-9]+(?:\.[0-9]+)?)/),
      fallback = Number(row.width_m || 0) * 1000,
      widthLabel = match ?
      `${Number(match[1]).toLocaleString(undefined,{maximumFractionDigits:3})}mm` : (fallback ?
        `${fallback.toLocaleString(undefined,{maximumFractionDigits:3})}mm` :
        'Unknown width / 幅宽未知');
    if (!widthGroups.has(widthLabel)) widthGroups.set(widthLabel, {
      machines: new Set(),
      daily: Object.fromEntries(dates.map(date => [date, {
        planned: 0,
        qualified: 0,
        defect: 0,
        pending: 0
      }]))
    });
    const group = widthGroups.get(widthLabel);
    group.machines.add(row.machine_code);
    if (!group.daily[row.record_date]) group.daily[row.record_date] = {
      planned: 0,
      qualified: 0,
      defect: 0,
      pending: 0
    };
    const item = group.daily[row.record_date],
      planned = Number(row.planned_quantity) || 0,
      actual = Number(row.actual_quantity) || 0,
      hasQualified = row.qualified_quantity !== null && row.qualified_quantity !== undefined,
      qualified = hasQualified ? Number(row.qualified_quantity) || 0 : 0;
    item.planned += planned;
    item.qualified += qualified;
    if (hasQualified) item.defect += Math.max(actual - qualified, 0);
    else item.pending += actual;
  });
  if (!rows.length) return '<p class="empty">No production in this 7-day period / 近7日无生产记录</p>';
  const legend =
    '<div class="yield-chart-legend"><span><i class="qualified"></i>Qualified / 合格</span><span><i class="defect"></i>Scrap/defect / 报废与不良</span><span><i class="pending"></i>Pending / 待补录</span><span><i class="planned"></i>Planned / 计划</span></div>';
  const panels = [...widthGroups.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).map(
    ([widthLabel, group]) => {
      const width = 520,
        height = 220,
        left = 44,
        right = 10,
        top = 20,
        bottom = 38,
        plotWidth = width - left - right,
        plotHeight = height - top - bottom,
        max = Math.max(1, ...Object.values(group.daily).flatMap(item => [item.planned, item
          .qualified + item.defect + item.pending
        ])),
        slot = plotWidth / Math.max(dates.length, 1),
        barWidth = Math.min(38, slot * .58),
        y = value => top + plotHeight - (Number(value) || 0) / max * plotHeight,
        x = index => left + slot * index + slot / 2,
        grid = [0, .5, 1].map(ratio =>
          `<line x1="${left}" y1="${top+plotHeight*(1-ratio)}" x2="${width-right}" y2="${top+plotHeight*(1-ratio)}" class="chart-grid chart-reference"/><text x="${left-6}" y="${top+plotHeight*(1-ratio)+4}" text-anchor="end">${Math.round(max*ratio).toLocaleString()}</text>`
          ).join('');
      const columns = dates.map((date, index) => {
          const item = group.daily[date],
            center = x(index),
            barX = center - barWidth / 2,
            qualifiedHeight = item.qualified / max * plotHeight,
            defectHeight = item.defect / max * plotHeight,
            pendingHeight = item.pending / max * plotHeight,
            total = item.qualified + item.defect + item.pending,
            base = top + plotHeight,
            qualifiedLabel = item.qualified ?
            `<text x="${center}" y="${qualifiedHeight>=18?base-qualifiedHeight/2+4:base-qualifiedHeight-5}" text-anchor="middle" class="chart-qualified-value">Q ${Math.round(item.qualified).toLocaleString()}</text>` :
            '';
          return `<rect x="${barX}" y="${base-qualifiedHeight}" width="${barWidth}" height="${Math.max(qualifiedHeight,0)}" fill="#4cc9a7"/><rect x="${barX}" y="${base-qualifiedHeight-defectHeight}" width="${barWidth}" height="${Math.max(defectHeight,0)}" fill="#ef7b73"/><rect x="${barX}" y="${base-qualifiedHeight-defectHeight-pendingHeight}" width="${barWidth}" height="${Math.max(pendingHeight,0)}" fill="#899aa8"/>${qualifiedLabel}${total?`<text x="${center}" y="${Math.max(y(total)-6,14)}" text-anchor="middle" class="chart-value">${Math.round(total).toLocaleString()}</text>`:''}<text x="${center}" y="${height-11}" text-anchor="middle">${escapeHtml(date).slice(5)}</text>`
        }).join(''),
        plannedPoints = dates.map((date, index) => `${x(index)},${y(group.daily[date].planned)}`)
        .join(' '),
        plannedDots = dates.map((date, index) =>
          `<circle cx="${x(index)}" cy="${y(group.daily[date].planned)}" r="3" fill="#f0b85a"><title>${date} · Planned / 计划: ${group.daily[date].planned.toLocaleString()}</title></circle>`
          ).join('');
      return `<article class="width-yield-panel"><h3>${escapeHtml(widthLabel)} <small>Machine / 机台: ${escapeHtml([...group.machines].sort().join(', '))}</small></h3><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(widthLabel)} seven-day production statistics">${grid}${columns}<polyline points="${plannedPoints}" fill="none" stroke="#f0b85a" stroke-width="3" stroke-dasharray="7 5" stroke-linejoin="round"/>${plannedDots}</svg></article>`
    }).join('');
  return `${slittingMachineAttainmentTrend(rows, dates)}${legend}<div class="width-yield-grid">${panels}</div>`;
}

function renderSlittingPending(records) {
  if (!records.length) return '';
  return records.map(record =>
    `<article class="pending-qualification-item"><strong>${escapeHtml(record.record_date)} · ${escapeHtml(record.shift_name||'Day')} · ${escapeHtml(record.formula_code)}</strong><span>Qualified rolls pending / 合格卷数待补录</span><small>Machine / 机台: ${escapeHtml(record.machine_code)} · Input rolls / 投入卷数: ${escapeHtml(record.input_rolls)}</small></article>`
    ).join('');
}

function arrangeSlittingContentRows(taskSection, trainingSection, remindersSection, eventsSection,
  pendingSection) {
  const companions = [trainingSection, remindersSection].filter(section => !section.hidden),
    taskWidth = companions.length === 0 ? 4 : companions.length === 1 ? 3 : 2;
  taskSection.dataset.fullRow = String(companions.length === 0);
  taskSection.style.order = 10;
  taskSection.style.gridRow = '1';
  taskSection.style.gridColumn = `1 / span ${taskWidth}`;
  let column = taskWidth + 1;
  companions.forEach((section, index) => {
    section.style.order = 11 + index;
    section.style.gridRow = '1';
    section.style.gridColumn = `${column} / span 1`;
    column += 1
  });
  if (!pendingSection.hidden) {
    pendingSection.style.order = 20;
    pendingSection.style.gridRow = '2';
    pendingSection.dataset.savedWidth = '4';
    pendingSection.style.gridColumn = '1 / -1';
  }
  if (!eventsSection.hidden) {
    eventsSection.style.order = 30;
    eventsSection.style.gridRow = '3';
    eventsSection.dataset.savedWidth = '4';
    eventsSection.style.gridColumn = '1 / -1';
  }
  const visualRow = !eventsSection.hidden ? '4' : !pendingSection.hidden ? '3' : '2';
  const visuals = [document.querySelector('[data-display-block="slitting_production_trend"]'),
    document.querySelector('[data-display-block="slitting_abnormality_trend"]')
  ].filter(section => section && !section.hidden);
  const visualWidths = visuals.length === 2 ? [2, 2] : [4];
  visuals.forEach((section, index) => {
    section.style.order = 40 + index;
    section.style.gridRow = visualRow;
    section.dataset.savedWidth = String(visualWidths[index]);
    section.style.gridColumn = `span ${visualWidths[index]}`;
  });
}

function slittingAbnormalityTrend(rows) {
  if (!rows.length) return '<p class="empty">No abnormality records / 无异常记录</p>';
  const categories = [...new Map(rows.flatMap(row => row.categories || []).map(item => [item.type, {
      type: item.type,
      label: item.label || item.type
    }])).values()].sort((a, b) => a.label.localeCompare(b.label)),
    palette = ['#4cc9a7', '#55a7e0', '#f0b85a', '#ef7b73', '#a98ce5', '#74c47d'],
    numbers = Object.fromEntries(categories.map((item, index) => [item.type, index + 1])),
    colors = Object.fromEntries(categories.map((item, index) => [item.type, palette[index % palette
      .length]]));
  const width = 720,
    height = 290,
    left = 48,
    right = 12,
    legendTop = 5,
    legendRow = 20,
    top = legendTop + Math.max(1, Math.ceil(categories.length / 2)) * legendRow + 18,
    bottom = 38,
    plot = height - top - bottom,
    max = Math.max(1, ...rows.map(row => Number(row.total_minutes) || 0)),
    slot = (width - left - right) / rows.length,
    bar = Math.min(58, slot * .62),
    grid = [0, .5, 1].map(ratio =>
      `<line x1="${left}" y1="${top+plot*(1-ratio)}" x2="${width-right}" y2="${top+plot*(1-ratio)}" class="chart-grid chart-reference"/><text x="${left-7}" y="${top+plot*(1-ratio)+4}" text-anchor="end">${Math.round(max*ratio)}m</text>`
      ).join('');
  const legend = categories.map((item, index) => {
    const x = left + (index % 2) * 330,
      y = legendTop + Math.floor(index / 2) * legendRow;
    return `<g class="chart-category-legend"><rect x="${x}" y="${y}" width="13" height="13" rx="3" fill="${colors[item.type]}"/><text x="${x+19}" y="${y+11}" class="chart-legend-label">${numbers[item.type]}. ${escapeHtml(item.label)}</text></g>`
  }).join('');
  const bars = rows.map((row, index) => {
    const x = left + slot * index + (slot - bar) / 2,
      total = Number(row.total_minutes) || 0;
    let cursor = top + plot;
    const segments = (row.categories || []).map(segment => {
      const value = Number(segment.minutes) || 0,
        height = value / max * plot;
      cursor -= height;
      const number = numbers[segment.type],
        center = x + bar / 2,
        label = height >= 31 ?
        `<text x="${center}" y="${cursor+height/2-3}" text-anchor="middle" class="chart-segment-label"><tspan x="${center}">#${number}</tspan><tspan x="${center}" dy="13">${Math.round(value)} min</tspan></text>` :
        height >= 16 ?
        `<text x="${center}" y="${cursor+height/2+4}" text-anchor="middle" class="chart-segment-label">#${number}</text>` :
        '';
      return `<rect x="${x}" y="${cursor}" width="${bar}" height="${Math.max(height,1)}" fill="${colors[segment.type]}" class="chart-stack-segment"><title>${escapeHtml(segment.label)}: ${value} min</title></rect>${label}`
    }).join('');
    return `${segments}<text x="${x+bar/2}" y="${Math.max(cursor-7,top-4)}" text-anchor="middle" class="chart-value">${Math.round(total)} min</text><text x="${x+bar/2}" y="${height-12}" text-anchor="middle">${escapeHtml(row.date).slice(5)}</text>`
  }).join('');
  const machineTotals = {};
  rows.forEach(row => (row.categories || []).forEach(item => {
    const machine = item.machine || 'Unknown';
    if (!machineTotals[machine]) machineTotals[machine] = {total:0, categories:{}};
    machineTotals[machine].total += Number(item.minutes) || 0;
    machineTotals[machine].categories[item.type] = (machineTotals[machine].categories[item.type] || 0) + (Number(item.minutes) || 0);
  }));
  const maxMachine = Math.max(1, ...Object.values(machineTotals).map(item => item.total));
  const machineComparison = Object.entries(machineTotals).sort((a,b)=>b[1].total-a[1].total).map(([machine,item]) => {
    const machineBarWidth = 440;
    let cursor = 0;
    const segments = categories.map(category => {
      const minutes = item.categories[category.type] || 0,
        segmentWidth = minutes / maxMachine * machineBarWidth,
        segmentCenter = cursor + segmentWidth / 2,
        segment = `<rect x="${cursor.toFixed(2)}" width="${segmentWidth.toFixed(2)}" height="24" fill="${colors[category.type]}" class="chart-stack-segment"><title>${escapeHtml(machine)} · ${escapeHtml(category.label)}: ${Math.round(minutes)} min</title></rect><text x="${segmentCenter.toFixed(2)}" y="12.5" text-anchor="middle" dominant-baseline="middle" class="machine-segment-label">${Math.round(minutes)}m</text>`;
      cursor += segmentWidth;
      return minutes > 0 ? segment : '';
    }).join('');
    return `<article><strong>${escapeHtml(machine)}</strong><svg class="machine-stacked-bar" viewBox="0 0 ${machineBarWidth} 24" role="img" aria-label="${escapeHtml(machine)} cumulative downtime ${Math.round(item.total)} minutes"><rect width="${machineBarWidth}" height="24" fill="#e8eff2"/>${segments}</svg><span>${Math.round(item.total)} min</span></article>`;
  }).join('');
  const machineLegend = categories.map(category => {
    const total = Object.values(machineTotals).reduce((sum, item) => sum + (item.categories[category.type] || 0), 0);
    return `<li><svg viewBox="0 0 12 12" aria-hidden="true"><rect width="12" height="12" rx="3" fill="${colors[category.type]}"/></svg><span>${escapeHtml(category.label)}</span><strong>${Math.round(total)} min</strong></li>`;
  }).join('');
  return `<section class="machine-downtime-panel"><h3>Cumulative downtime by machine / 各机台累计停机时间</h3><div class="machine-downtime-body"><div class="machine-downtime-list">${machineComparison}</div><aside class="machine-downtime-legend" aria-label="Downtime category legend"><strong><span>Downtime categories</span><span>停机类别</span></strong><ul>${machineLegend}</ul></aside></div></section><section class="date-downtime-panel"><h3>Daily downtime by category / 每日各类别停机时间</h3><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Stacked abnormal downtime by category and date">${legend}${grid}${bars}</svg></section>`;
}
async function refreshSlittingDisplay() {
  try {
    const currentSlot = currentProductionSlot();
    const selectedDate = fixedDisplayDate || currentSlot.date;
    const selectedShift = fixedDisplayShift || currentSlot.shift;
    const slotQuery = new URLSearchParams({
      department: displayDepartment,
      date: selectedDate,
      shift: selectedShift
    });
    const [productionResponse, eventResponse, openResponse] = await Promise.all([fetch(
        '/api/slitting/summary?' + slotQuery), fetch('/api/daily-report?department=' +
        encodeURIComponent(displayDepartment) + '&date=' + encodeURIComponent(selectedDate)),
      fetch('/api/public-display?' + slotQuery)
    ]);
    if (!productionResponse.ok || !eventResponse.ok || !openResponse.ok) throw Error();
    const production = await productionResponse.json(),
      events = await eventResponse.json(),
      openData = await openResponse.json(),
      settings = production.display_settings || {
        blocks: [],
        event_columns: []
      };
    applyDisplaySettings(settings);
    document.querySelector('[data-display-block="slitting_production_trend"] [data-block-title]')
      .textContent = 'Production overview / 生产概览';
    document.querySelector('[data-display-block="slitting_abnormality_trend"] [data-block-title]')
      .textContent = 'Abnormality downtime / 异常停机';
    document.querySelector('#display-date').textContent =
      `${selectedDate} · ${selectedShift} / ${selectedShift==='Day'?'白班':'夜班'}`;
    const fieldLabels = Object.fromEntries((production.standard_fields || []).map(field => [field
      .field_key, field.label
    ]));
    const taskRoot = document.querySelector('#slitting-display-task');
    taskRoot.innerHTML = renderSlittingTask(production.daily_task, production.records || [],
      fieldLabels);
    taskRoot.querySelectorAll('[data-progress-fill]').forEach(track => {
      track.querySelector('i').style.width = `${Number(track.dataset.progressFill)||0}%`;
    });
    const trainingItems = (production.daily_task?.task_items || []).filter(item => item.type ===
      'slitting_training');
    const taskSection = document.querySelector('[data-display-block="slitting_task"]');
    const trainingSection = document.querySelector('[data-display-block="slitting_training"]');
    const configuredTask = (settings.blocks || []).find(block => block.key === 'slitting_task');
    const configuredTraining = (settings.blocks || []).find(block => block.key ===
      'slitting_training');
    const trainingVisible = trainingItems.length > 0 && configuredTraining?.visible !== false;
    const taskWidth = trainingVisible ? Math.max(1, Math.min(Number(configuredTask?.width) || 3,
      5)) : 5;
    trainingSection.hidden = !trainingVisible;
    taskSection.dataset.fullRow = String(!trainingVisible);
    taskSection.dataset.savedWidth = String(taskWidth);
    taskSection.style.gridRow = '1';
    taskSection.style.gridColumn = `1 / span ${taskWidth}`;
    if (trainingVisible) {
      trainingSection.style.gridRow = '1';
      trainingSection.style.gridColumn = `${taskWidth+1} / span ${Math.max(1,5-taskWidth)}`;
    }
    document.querySelector('#slitting-display-training').innerHTML = renderSlittingTraining(
      production.daily_task);
    const reminders = production.daily_task?.reminders || [];
    const remindersSection = document.querySelector('[data-display-block="slitting_reminders"]');
    const configuredReminders = (settings.blocks || []).find(block => block.key ===
      'slitting_reminders');
    remindersSection.hidden = !reminders.length || configuredReminders?.visible === false;
    renderPermanentText(document.querySelector('#slitting-display-reminders'), reminders.map(
      item => `- ${item}`).join('\n'));
    const ongoingEvents = openData.ongoing_events || [];
    const eventsSection = document.querySelector('[data-display-block="slitting_events"]');
    const configuredEvents = (settings.blocks || []).find(block => block.key ===
      'slitting_events');
    eventsSection.hidden = configuredEvents?.visible === false;
    document.querySelector('#slitting-display-events').innerHTML = ongoingEvents.length ?
      eventTable(ongoingEvents, settings) :
      `<p class="empty">No unresolved events until ${escapeHtml(selectedDate)} / 截至 ${escapeHtml(selectedDate)} 无未解决事件</p>`;
    const pending = openData.pending_qualifications || [],
      pendingSection = document.querySelector(
        '[data-display-block="slitting_pending_qualification"]'),
      configuredPending = (settings.blocks || []).find(block => block.key ===
        'slitting_pending_qualification');
    pendingSection.hidden = configuredPending?.visible === false;
    document.querySelector('#slitting-pending-qualifications').innerHTML = pending.length ?
      renderSlittingPending(pending) :
      `<p class="empty">No pending records until ${escapeHtml(selectedDate)} / 截至 ${escapeHtml(selectedDate)} 无待补录记录</p>`;
    arrangeSlittingContentRows(taskSection, trainingSection, remindersSection, eventsSection,
      pendingSection);
    document.querySelector('#slitting-production-trend-chart').innerHTML =
      slittingProductionTrend(openData.trends?.production_details || [], openData.trends
        ?.production || []);
    document.querySelector('#slitting-abnormality-trend-chart').innerHTML =
      slittingAbnormalityTrend(openData.trends?.abnormalities || []);
    document.querySelector('#display-status').textContent = 'Updated / 更新 ' + new Date()
      .toLocaleTimeString();
    requestAnimationFrame(() => {
      adaptDisplayBlocks();
      arrangeSlittingContentRows(taskSection, trainingSection, remindersSection,
        eventsSection, pendingSection);
      fitTvDisplay();
      startAutomaticOverflowCycle();
    });
  } catch {
    document.querySelector('#display-status').textContent =
      'Refresh failed; displayed data may be stale / 刷新失败，数据可能已过期';
  }
}
refreshSlittingDisplay();
setInterval(refreshSlittingDisplay, 30000);
if (tvMode) window.addEventListener('resize', () => requestAnimationFrame(fitTvDisplay));
