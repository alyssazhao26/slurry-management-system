let slittingOptions = null;
let slittingCustomFields = [];
let slittingStandardFields = [];
const slittingFields = [
  ['planned_rolls', 'Planned input rolls / 计划卷数', '1'],
  ['input_rolls', 'Input rolls / 投入卷数', '1'],
  ['qualified_rolls', 'Qualified output rolls / 合格产出卷数', '1'],
  ['width_m', 'Slit width (m) / 分切宽度（米）', '0.0001'],
  ['coated_length_m', 'Coated film length (m) / 涂覆膜长度（米）', '0.01'],
  ['coated_width_m', 'Coated film width (m) / 涂覆膜宽度（米）', '0.0001'],
  ['stations', 'Stations / 工位数', '1'],
  ['slitting_length_m', 'Slitting length (m) / 分切长度（米）', '0.01']
];
const slittingColumns = [
  ['record_date', 'Date / 日期'],
  ['shift_name', 'Shift / 班次'],
  ['machine_code', 'Machine / 机台'],
  ['formula_code', 'Model / 型号'],
  ['planned_rolls', 'Planned rolls / 计划卷数'],
  ['input_rolls', 'Input rolls / 投入卷数'],
  ['qualified_rolls', 'Qualified rolls / 合格卷数'],
  ['planned_quantity', 'Planned area m² / 计划面积'],
  ['input_area', 'Input area m² / 投入面积'],
  ['actual_quantity', 'Actual output m² / 实际产出'],
  ['qualified_quantity', 'Qualified output m² / 合格产出'],
  ['achievement_rate', 'Plan attainment / 达成率'],
  ['qualified_rate', 'Qualified rate / 合格率'],
  ['yield_rate', 'Yield / 综收']
];
const slittingRecordColumns = [
  ['record_date', 'Date / 日期'],
  ['shift_name', 'Shift / 班次'],
  ['machine_code', 'Machine / 机台'],
  ['formula_code', 'Model / 型号'],
  ['planned_rolls', 'Planned input rolls / 计划投入卷数'],
  ['input_rolls', 'Input rolls / 投入卷数'],
  ['qualified_rolls', 'Qualified output rolls / 合格产出卷数']
];

function slittingStats(stats) {
  const items = [
    ['planned_quantity', 'Planned area / 计划面积'],
    ['input_area', 'Input area / 投入面积'],
    ['actual_quantity', 'Actual output / 实际产出'],
    ['qualified_quantity', 'Qualified output / 合格产出'],
    ['achievement_rate', 'Plan attainment / 达成率'],
    ['qualified_rate', 'Qualified rate / 合格率'],
    ['yield_rate', 'Yield / 综收'],
    ['records', 'Production runs / 生产批次']
  ];
  return `<div class="slitting-stats">${items.map(([key,label])=>`<article><span>${label}</span><strong>${stats[key] == null ? '—' : key.endsWith('_rate') ? (Number(stats[key])*100).toFixed(2)+'%' : Number(stats[key]).toLocaleString(undefined,{maximumFractionDigits:2})+(key==='records'?'':' m²')}</strong>${key==='qualified_quantity'&&stats.pending?'<small>Partial: '+stats.pending+' pending / 待补录</small>':''}</article>`).join('')}</div>${stats.pending?'<p>Qualification and yield pending / 合格率与综收待补录完成。</p>':''}`;
}

function slittingReport(data, editable = true, columns = slittingRecordColumns) {
  const customColumns = (data.custom_field_definitions || slittingCustomFields).map(field => [field
    .field_key, field.label
  ]);
  if (editable) columns = [...columns, ...customColumns.filter(([key]) => !columns.some(([
    existing]) => existing === key))];
  const calculationSummary = editable ? '' :
    `<h2>Overall production / 生产总览</h2>${slittingStats(data.overall)}${data.legacy_records?`<p class="slitting-summary-note">${data.legacy_records} legacy records have no slitting dimensions and are excluded from area totals. / 旧记录缺少尺寸，未计入面积统计。</p>`:''}`;
  return calculationSummary + data.machines.map(machine =>
    `<section class="slitting-machine"><h2>${escapeHtml(machine.machine_code)}</h2>${editable?'':slittingStats(machine.stats)}<div class="table-wrap"><table><thead><tr>${columns.map(([,label])=>'<th>'+label+'</th>').join('')}${editable?'<th>Actions / 操作</th>':''}</tr></thead><tbody>${machine.records.map(row=>`<tr>${columns.map(([key])=>'<td>'+escapeHtml(row[key]==null?'—':key.endsWith('_rate')?(Number(row[key])*100).toFixed(2)+'%':typeof row[key]==='number'?Number(row[key]).toLocaleString(undefined,{maximumFractionDigits:4}):row[key])+'</td>').join('')}${editable?`<td><button class="secondary manager-edit-row" data-record-type="production" data-record-id="${Number(row.id)}">Edit / 编辑</button>${row.qualified_quantity==null?`<button class="secondary qualified-followup" data-id="${Number(row.id)}" data-date="${escapeHtml(row.record_date)}" data-machine="${escapeHtml(row.machine_code)}">Add qualified rolls / 补录合格卷数</button>`:''}</td>`:''}</tr>`).join('')}</tbody></table></div></section>`
    ).join('') + (!data.machines.length ?
    '<p>No slitting production for this selection / 当前筛选暂无分切生产记录。</p>' : '');
}
async function loadSlittingProduction(target = '#production-table', selectedDate = null) {
  const filters = selectedDate ? {
    date: selectedDate
  } : recordFilters('production');
  const response = await fetch('/api/slitting/summary?' + new URLSearchParams(filters));
  const data = await response.json();
  if (!response.ok) {
    say(data.error || 'Could not load slitting production.');
    return
  }
  document.querySelector(target).innerHTML = slittingReport(data, target === '#production-table',
    target === '#report-production' ? selectedReportColumns('production') :
    slittingRecordColumns);
}

function compactNumber(value, digits = 1) {
  return value == null ? '—' : Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits
  });
}

function compactPercent(value) {
  return value == null ? 'Pending / 待补录' : `${(Number(value)*100).toFixed(1)}%`;
}

function qualifiedOutput(stats) {
  return stats.pending ? 'Pending / 待补录' : `${compactNumber(stats.qualified_quantity)} m²`;
}

function slittingMachineShareCard(machine) {
  const rows = machine.records.map(row =>
    `<div class="share-production-row"><div class="share-model-cell"><span>${escapeHtml(row.shift_name)}</span><strong>${escapeHtml(row.formula_code).replaceAll('/','/<wbr>')}</strong></div><div class="share-roll-value"><strong>${row.planned_rolls}</strong><span>Planned / 计划</span></div><div class="share-roll-value"><strong>${row.input_rolls}</strong><span>Input / 投入</span></div><div class="share-roll-value"><strong>${row.qualified_rolls ?? 'Pending / 待补录'}</strong><span>Qualified rolls / 合格卷数</span></div><div class="share-output-cell"><strong>${compactNumber(row.actual_quantity)} m²</strong><span>Actual output / 实际产出</span></div><div class="share-output-cell qualified"><strong>${row.qualified_quantity == null ? 'Pending / 待补录' : `${compactNumber(row.qualified_quantity)} m²`}</strong><span>Qualified output / 合格产出</span></div></div>`
    ).join('');
  return `<section class="share-machine-card"><div class="share-machine-title"><h3>${escapeHtml(machine.machine_code)}</h3></div><div class="share-machine-metrics"><article class="metric-output"><span>Actual output / 实际产出</span><strong>${compactNumber(machine.stats.actual_quantity)} m²</strong></article><article class="metric-qualified"><span>Qualified output / 合格产出</span><strong>${qualifiedOutput(machine.stats)}</strong></article><article class="metric-rate"><span>Plan attainment / 达成率</span><strong>${compactPercent(machine.stats.achievement_rate)}</strong></article><article class="metric-rate"><span>Qualified rate / 合格率</span><strong>${compactPercent(machine.stats.qualified_rate)}</strong></article><article class="metric-rate"><span>Yield / 综收</span><strong>${compactPercent(machine.stats.yield_rate)}</strong></article></div>${rows}</section>`;
}

function slittingEventTimeline(events) {
  if (!events.length) return '<p class="share-empty">No abnormalities recorded / 今日无异常记录</p>';
  return `<div class="abnormality-timeline">${events.map(event=>`<article class="timeline-event ${event.is_resolved==='no'?'timeline-open':''}"><time>${escapeHtml(event.event_time||'—')}</time><div><strong>${escapeHtml(event.machine_code)} · ${escapeHtml(event.event_type)}</strong><span>${escapeHtml(event.subcategory||event.description||'—')}</span>${event.event_notes?`<p>${escapeHtml(event.event_notes)}</p>`:''}</div><aside><strong>${Number(event.duration_minutes)||0} min</strong><span>${event.is_resolved==='yes'?'Closed / 已完成':'Open / 处理中'}</span></aside></article>`).join('')}</div>`;
}
async function loadSlittingDailyReport(events, selectedDate, machine = '') {
  const params = {
    date: selectedDate
  };
  if (machine) params.machine = machine;
  const response = await fetch('/api/slitting/summary?' + new URLSearchParams(params));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load slitting production.');
  const filteredEvents = machine ? events.filter(event => event.machine_code === machine) :
  events;
  window.latestSlittingReport = {
    production: data,
    events: filteredEvents,
    date: selectedDate,
    machine
  };
  const overall = data.overall,
    rolls = (data.records || []).reduce((totals, row) => ({
      planned: totals.planned + Number(row.planned_rolls || 0),
      input: totals.input + Number(row.input_rolls || 0),
      qualified: totals.qualified + Number(row.qualified_rolls || 0)
    }), {
      planned: 0,
      input: 0,
      qualified: 0
    });
  document.querySelector('#report-production').innerHTML =
    `<div class="share-kpis slitting-overview-kpis"><article class="kpi-rolls"><span>Planned rolls / 计划卷数</span><strong>${compactNumber(rolls.planned,0)}</strong></article><article class="kpi-rolls"><span>Input rolls / 投入卷数</span><strong>${compactNumber(rolls.input,0)}</strong></article><article class="kpi-rolls"><span>Qualified rolls / 合格卷数</span><strong>${overall.pending ? 'Pending / 待补录' : compactNumber(rolls.qualified,0)}</strong></article><article class="kpi-output"><span>Actual output / 实际产出</span><strong>${compactNumber(overall.actual_quantity)} m²</strong></article><article class="kpi-qualified"><span>Qualified output / 合格产出</span><strong>${qualifiedOutput(overall)}</strong></article><article class="kpi-rate"><span>Plan attainment / 达成率</span><strong>${compactPercent(overall.achievement_rate)}</strong></article><article class="kpi-rate"><span>Qualified rate / 合格率</span><strong>${compactPercent(overall.qualified_rate)}</strong></article><article class="kpi-rate"><span>Yield / 综收</span><strong>${compactPercent(overall.yield_rate)}</strong></article></div><div class="share-machine-list">${data.machines.map(slittingMachineShareCard).join('')||'<p class="share-empty">No production recorded / 今日无生产记录</p>'}</div>`;
  document.querySelector('#report-events').innerHTML = slittingEventTimeline(filteredEvents);
}

function canvasRoundedRect(context, x, y, width, height, radius, fill, stroke = null) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 1;
    context.stroke();
  }
}

function canvasText(context, text, x, y, {
  size = 20,
  weight = 400,
  color = '#102f46',
  align = 'left',
  maxWidth
} = {}) {
  context.font = `${weight} ${size}px "Microsoft YaHei","Segoe UI",sans-serif`;
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = 'top';
  context.fillText(String(text ?? '—'), x, y, maxWidth);
}

function downloadCanvas(canvas, filename) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob) {
      reject(new Error('Image conversion failed.'));
      return;
    }
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    resolve();
  }, 'image/png'));
}
async function saveSlittingReportImage() {
  const report = window.latestSlittingReport;
  if (!report) throw new Error('Generate the report first.');
  await document.fonts.ready;
  const width = 1440,
    margin = 48,
    gap = 16,
    cardWidth = (width - margin * 2 - gap) / 2;
  const machineHeights = report.production.machines.map(machine => 80 + Math.max(1, machine
    .records.length) * 48);
  const machinesHeight = machineHeights.reduce((total, height, index) => total + (index % 2 ===
    0 ? Math.max(height, machineHeights[index + 1] || 0) + gap : 0), 0);
  const eventsHeight = Math.max(70, report.events.length * 76);
  const height = 48 + 54 + 116 + machinesHeight + 62 + eventsHeight + 48;
  if (height > 30000) throw new Error('Report is too long for one image.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f5f9fb';
  context.fillRect(0, 0, width, height);
  canvasText(context,
    `GNEM Slitting Daily Report / GNEM 分切日报${report.machine?' · '+report.machine:''}`, margin,
    34, {
      size: 30,
      weight: 800,
      color: '#063b5c'
    });
  canvasText(context, report.date, width - margin, 42, {
    size: 20,
    weight: 600,
    color: '#4c6575',
    align: 'right'
  });
  context.fillStyle = '#063b5c';
  context.fillRect(margin, 84, width - margin * 2, 3);
  const overall = report.production.overall;
  const kpis = [
    ['Actual output / 实际产出', `${compactNumber(overall.actual_quantity)} m²`],
    ['Qualified output / 合格产出', qualifiedOutput(overall)],
    ['Plan attainment / 达成率', compactPercent(overall.achievement_rate)],
    ['Qualified rate / 合格率', compactPercent(overall.qualified_rate)],
    ['Yield / 综收', compactPercent(overall.yield_rate)]
  ];
  const kpiWidth = (width - margin * 2 - gap * 4) / 5;
  kpis.forEach(([label, value], index) => {
    const x = margin + index * (kpiWidth + gap);
    canvasRoundedRect(context, x, 105, kpiWidth, 82, 10, '#e3f1f5');
    context.fillStyle = '#117b77';
    context.fillRect(x, 105, kpiWidth, 4);
    canvasText(context, label, x + 15, 122, {
      size: 15,
      color: '#496473'
    });
    canvasText(context, value, x + 15, 148, {
      size: 24,
      weight: 800,
      color: '#082a4a'
    });
  });
  let y = 207;
  report.production.machines.forEach((machine, index) => {
    const column = index % 2,
      rowY = y;
    if (column === 0 && index > 0) y += Math.max(machineHeights[index - 2], machineHeights[
      index - 1]) + gap;
    const actualY = column === 0 ? y : y;
    const x = margin + column * (cardWidth + gap),
      boxHeight = machineHeights[index];
    canvasRoundedRect(context, x, actualY, cardWidth, boxHeight, 10, '#ffffff', '#b9ced8');
    context.fillStyle = '#e9f5f5';
    context.fillRect(x + 1, actualY + 1, cardWidth - 2, 62);
    canvasText(context, machine.machine_code, x + 16, actualY + 17, {
      size: 23,
      weight: 800,
      color: '#08736f'
    });
    const metrics = [
      [`${compactNumber(machine.stats.actual_quantity)} m²`, 'Actual / 实际'],
      [qualifiedOutput(machine.stats), 'Qualified output / 合格产出'],
      [compactPercent(machine.stats.achievement_rate), 'Plan / 达成'],
      [compactPercent(machine.stats.qualified_rate), 'Qualified / 合格'],
      [compactPercent(machine.stats.yield_rate), 'Yield / 综收']
    ];
    metrics.forEach(([value, label], metricIndex) => {
      const metricX = x + 92 + metricIndex * 108;
      canvasText(context, value, metricX, actualY + 12, {
        size: 14,
        weight: 800,
        maxWidth: 104
      });
      canvasText(context, label, metricX, actualY + 36, {
        size: 10,
        color: '#526977',
        maxWidth: 104
      });
    });
    (machine.records.length ? machine.records : [{}]).forEach((record, rowIndex) => {
      const rowTop = actualY + 68 + rowIndex * 48;
      if (record.machine_code) {
        canvasText(context, `${record.shift_name} · ${record.formula_code}`, x + 15,
          rowTop, {
            size: 13,
            weight: 700,
            maxWidth: 340
          });
        canvasText(context,
          `${record.input_rolls} in · ${record.qualified_rolls??'—'} qualified`, x +
          370, rowTop, {
            size: 13,
            maxWidth: 165
          });
        canvasText(context, `${compactNumber(record.actual_quantity)} m²`, x + cardWidth -
          15, rowTop, {
            size: 13,
            weight: 700,
            align: 'right'
          });
        canvasText(context, record.notes || '', x + 15, rowTop + 22, {
          size: 11,
          color: '#657985',
          maxWidth: cardWidth - 30
        });
      } else canvasText(context, 'No production / 无生产记录', x + 15, rowTop, {
        size: 13,
        color: '#657985'
      });
    });
  });
  if (report.production.machines.length) y += Math.max(...machineHeights.slice(-2)) + gap;
  canvasText(context, 'Abnormality timeline / 异常时间线', margin, y + 4, {
    size: 22,
    weight: 800,
    color: '#063b5c'
  });
  y += 44;
  if (!report.events.length) {
    canvasRoundedRect(context, margin, y, width - margin * 2, 54, 8, '#ffffff', '#b9ced8');
    canvasText(context, 'No abnormalities recorded / 今日无异常记录', margin + 18, y + 17, {
      size: 15,
      color: '#526977'
    });
    y += 70;
  }
  report.events.forEach(event => {
    const open = event.is_resolved === 'no';
    canvasRoundedRect(context, margin, y, width - margin * 2, 64, 8, open ? '#fff6dc' :
      '#ffffff', '#b9ced8');
    context.fillStyle = open ? '#d18a00' : '#168a85';
    context.fillRect(margin, y, 5, 64);
    canvasText(context, event.event_time || '—', margin + 18, y + 18, {
      size: 15,
      weight: 800,
      maxWidth: 135
    });
    canvasText(context, `${event.machine_code} · ${event.event_type}`, margin + 170, y + 10, {
      size: 15,
      weight: 800,
      maxWidth: 430
    });
    canvasText(context, event.subcategory || event.description || '—', margin + 170, y + 34, {
      size: 13,
      color: '#526977',
      maxWidth: 520
    });
    canvasText(context, event.event_notes || '', margin + 720, y + 20, {
      size: 13,
      color: '#334d5c',
      maxWidth: 440
    });
    canvasText(context, `${Number(event.duration_minutes)||0} min`, width - margin - 120, y +
      12, {
        size: 16,
        weight: 800,
        align: 'right'
      });
    canvasText(context, open ? 'Open / 处理中' : 'Closed / 已完成', width - margin - 18, y + 37, {
      size: 12,
      color: open ? '#8a5b00' : '#23715e',
      align: 'right'
    });
    y += 76;
  });
  canvasText(context, 'Generated by GNEM / GNEM 系统生成', width - margin, height - 28, {
    size: 11,
    color: '#748792',
    align: 'right'
  });
  await downloadCanvas(canvas,
    `GNEM-slitting-${report.machine||'all-machines'}-${report.date}-daily-report.png`);
}

function populateSubcategories(form, selected = '') {
  const select = form.elements.subcategory;
  if (!select || !slittingOptions) return;
  const options = slittingOptions.categories[form.elements.event_type.value] || [];
  select.innerHTML = '<option value="">Select subcategory / 选择子类别</option>' + options.map(value =>
    `<option value="${escapeHtml(value)}" ${value===selected?'selected':''}>${escapeHtml(value)}</option>`
    ).join('');
}

function categoryControls(form, record = null) {
  const category = form.elements.event_type;
  category.innerHTML = '<option value="">Select main category / 选择主类别</option>' + Object.keys(
    slittingOptions.categories).map(value =>
    `<option value="${escapeHtml(value)}" ${value===record?.event_type?'selected':''}>${escapeHtml(value)}</option>`
    ).join('');
  replaceLabelText(category.closest('label'), 'Main category / 主类别');
  const description = form.elements.description?.closest('label');
  if (description) description.outerHTML =
    `<label>Subcategory / 子类别<select name="subcategory" required></select></label><label class="wide">Notes / 备注<textarea name="event_notes" maxlength="4000" placeholder="Additional details / 补充说明">${escapeHtml(record?.event_notes||'')}</textarea></label>`;
  category.closest('label').after(form.elements.subcategory.closest('label'));
  category.addEventListener('change', () => populateSubcategories(form));
  if (!form.dataset.categoryReset) {
    form.dataset.categoryReset = '1';
    form.addEventListener('reset', () => queueMicrotask(() => {
      populateSubcategories(form);
      if (form.id === 'abnormality-form') updateUnresolvedRequirements();
    }));
  }
  populateSubcategories(form, record?.subcategory || '');
}

function slittingInputMarkup(row = {}) {
  return slittingFields.slice(0, 3).map(([key, label, step]) =>
    `<label>${label}<input name="${key}" type="number" min="0" step="${step}" ${key==='qualified_rolls'?'':'required'} value="${escapeHtml(row[key]??'')}">${key==='qualified_rolls'?'<small>Finished small rolls; blank means pending / 合格小卷数，待确认可留空</small>':''}</label>`
    ).join('');
}

function slittingSubcategoryRowMarkup(main, subcategory) {
  return `<div class="manager-type-row">
    <span>${escapeHtml(subcategory)}</span>
    <button type="button" class="secondary deactivate-slitting-sub"
      data-main="${encodeURIComponent(main)}" data-sub="${encodeURIComponent(subcategory)}">
      Deactivate / 停用
    </button>
  </div>`;
}

function slittingCategoryGroupMarkup([main, subcategories]) {
  return `<details class="manager-options-dropdown">
    <summary>
      <span>${escapeHtml(main)} (${subcategories.length})</span>
      <button type="button" class="secondary deactivate-slitting-main"
        data-main="${encodeURIComponent(main)}">Deactivate main / 停用主类别</button>
    </summary>
    ${subcategories.map(subcategory => slittingSubcategoryRowMarkup(main, subcategory)).join('')}
  </details>`;
}

function renderSlittingCategoryEditor() {
  const panel = document.querySelector('#slitting-category-options-panel');
  if (!panel || !slittingOptions) return;
  const select = panel.querySelector('[name="existing_main_category"]'),
    current = select.value;
  select.innerHTML = '<option value="">New main category / 新主类别</option>' + Object.keys(
    slittingOptions.categories).map(main =>
    `<option value="${escapeHtml(main)}">${escapeHtml(main)}</option>`).join('');
  if ([...select.options].some(option => option.value === current)) select.value = current;
  panel.querySelector('#slitting-category-list').innerHTML = Object.entries(
    slittingOptions.categories).map(slittingCategoryGroupMarkup).join('');
}
async function refreshSlittingOptions() {
  const response = await fetch('/api/slitting/options');
  if (!response.ok) throw Error();
  slittingOptions = await response.json();
  renderSlittingCategoryEditor();
  return slittingOptions;
}

function modelSelectMarkup(selected = '', name = 'formula_code') {
  return `<label>Model / 型号<select name="${name}" required><option value="">Select model / 选择型号</option>${(slittingOptions?.models||[]).map(model=>`<option value="${escapeHtml(model)}" ${model===selected?'selected':''}>${escapeHtml(model)}</option>`).join('')}</select></label>`;
}

function configuredSelectKind(choices) {
  return 'select:' + choices.map(choice => `${choice.value}|${choice.label}`).join(',')
}

function openSlittingEditor(type, record = null) {
  if (!slittingOptions) {
    say('Slitting options are still loading.');
    return;
  }
  managerRecordContext = {
    type,
    id: record?.id || null
  };
  document.querySelector('#manager-record-dialog-title').textContent = (record ? 'Edit / 编辑' :
    'Add / 添加') + ' · Slitting / 分切';
  const root = document.querySelector('#manager-record-edit-fields');
  if (type === 'production') {
    const labels = Object.fromEntries(slittingStandardFields.map(field => [field.field_key, field
      .label
    ]));
    root.innerHTML = [
      ['shift_name', labels.shift_name || 'Shift / 班次', configuredSelectKind(slittingOptions
        .production_shift_options)],
      ['machine_code', labels.machine_code || 'Machine / 机台', configuredSelectKind(slittingOptions
        .machine_options)]
    ].map(([k, l, t]) => managerEditControl(k, l, t, record?.[k])).join('') + modelSelectMarkup(
      record?.formula_code) + slittingInputMarkup(record || {}) + slittingCustomFields.map(
      field => renderInput({
        ...field,
        value: record?.[field.field_key]
      })).join('');
  } else {
    root.innerHTML = managerEditableFields.abnormality.map(([k, l, t]) => managerEditControl(k, l,
      k === 'machine_code' ? configuredSelectKind(slittingOptions.abnormality_machine_options) :
      k === 'shift_name' ? configuredSelectKind(slittingOptions.abnormality_shift_options) : t,
      record?.[k])).join('');
    categoryControls(document.querySelector('#manager-record-edit'), record);
  }
  updateRecordDowntime(document.querySelector('#manager-record-edit'));
  document.querySelector('#manager-record-edit-status').textContent = '';
  document.querySelector('#manager-record-dialog').showModal();
}
let slittingModelRows = [];
async function loadSlittingModelEditor() {
  const response = await fetch('/api/manager/slitting-models'),
    data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Manager access is required.');
  slittingModelRows = data.models || [];
  const select = document.querySelector('#slitting-model-form [name="existing_model"]');
  select.innerHTML = '<option value="">Add new model / 添加新型号</option>' + slittingModelRows.map(
    row => `<option value="${Number(row.id)}">${escapeHtml(row.model_code)}</option>`).join('');
}

function fillSlittingModelForm(row = null) {
  const form = document.querySelector('#slitting-model-form');
  for (const key of ['model_code', 'width_m', 'coated_length_m', 'coated_width_m', 'stations',
      'slitting_length_m'
    ]) form.elements[key].value = row?.[key] ?? '';
  form.elements.is_active.checked = row ? Boolean(row.is_active) : true;
  form.elements.model_code.readOnly = Boolean(row);
}
document.querySelector('#department-form').addEventListener('submit', async event => {
  event.preventDefault();
  const response = await fetch('/api/manager/department', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      department: event.currentTarget.elements.department.value
    })
  });
  const data = await response.json();
  if (!response.ok) {
    say(data.error);
    return
  }
  location.assign(data.url);
});
if (isSlitting) {
  document.querySelectorAll('[data-slitting-only]').forEach(node => node.hidden = false);
  document.title = 'GNEM Slitting Production';
  document.querySelectorAll('a[href="/display"]').forEach(link => link.href =
    '/display?department=' + encodeURIComponent(department));
  const form = document.querySelector('#production-form');
  ['formula_code', 'custom_formula', 'batch_number', 'planned_quantity', 'actual_quantity',
    'qualified_quantity', 'notes'
  ].forEach(key => {
    const input = form.elements[key];
    input.disabled = true;
    input.required = false;
    input.closest('label').hidden = true;
  });
  form.querySelector('[name="notes"]').closest('label').insertAdjacentHTML('beforebegin',
    modelSelectMarkup('', 'slitting_model') + slittingInputMarkup());
  const originalPayload = formPayload;
  formPayload = function(form) {
    const payload = originalPayload(form);
    if (payload && form.id === 'production-form') {
      payload.formula_code = form.elements.slitting_model.value;
      payload.batch_number = '';
    }
    return payload;
  };
  document.querySelector('[data-history-filters="production"] [name="machine"]').placeholder =
  'FX5';
  // Keep the existing follow-up form, but label its input in qualified rolls.
  const watcher = new MutationObserver(() => document.querySelectorAll(
    '.qualified-followup-form [name="qualified_quantity"]').forEach(input => {
    if (!input.dataset.slittingRolls) {
      input.dataset.slittingRolls = '1';
      replaceLabelText(input.closest('label'), 'Qualified output rolls / 合格产出卷数');
      input.step = '1';
      input.removeAttribute('max');
    }
  }));
  watcher.observe(document.querySelector('main'), {
    childList: true,
    subtree: true
  });
  const abnormalityForm = document.querySelector('#abnormality-form');
  const processInput = abnormalityForm.elements.machine_type;
  processInput.disabled = true;
  processInput.required = false;
  processInput.closest('label').hidden = true;
  for (const group of [recordColumns.tracker, recordColumns.ongoing]) group.splice(0, group.length,
    ...group.filter(([key]) => key !== 'machine_type'));
  managerEditableFields.abnormality.splice(0, managerEditableFields.abnormality.length, ...
    managerEditableFields.abnormality.filter(([key]) => key !== 'machine_type'));
  recordColumns.tracker.splice(5, 0, ['subcategory', 'Subcategory / 子类别'], ['event_notes',
    'Notes / 备注'
  ]);
  reportColumnDefinitions.production = [...slittingColumns, ...slittingFields.filter(([key]) => !
    slittingColumns.some(([column]) => column === key)).map(([key, label]) => [key, label])];
  defaultReportColumns.production = new Set(slittingColumns.map(([key]) => key));
  reportColumnDefinitions.events.splice(0, reportColumnDefinitions.events.length, ...
    reportColumnDefinitions.events.filter(([key]) => key !== 'machine_type'));
  defaultReportColumns.events.delete('machine_type');
  reportColumnDefinitions.events.push(['subcategory', 'Subcategory / 子类别'], ['event_notes',
    'Notes / 备注'
  ]);
  defaultReportColumns.events.add('subcategory');
  defaultReportColumns.events.add('event_notes');
  initialiseReportColumnPicker();
  // Loading options gates submission instead of briefly showing slurry defaults.
  form.querySelector('button:not([type])').disabled = true;
  abnormalityForm.querySelector('button:not([type])').disabled = true;
  async function refreshSlittingOptions() {
    const responses = await Promise.all([fetch('/api/slitting/options', {
      cache: 'no-store'
    }), fetch('/api/forms/production', {
      cache: 'no-store'
    }), fetch('/api/forms/production/standard-fields', {
      cache: 'no-store'
    })]);
    if (responses.some(response => !response.ok)) throw Error();
    slittingOptions = await responses[0].json();
    slittingCustomFields = (await responses[1].json()).fields || [];
    slittingStandardFields = (await responses[2].json()).fields || [];
    renderSlittingCategoryEditor();
    taskMachineOptions.splice(0, taskMachineOptions.length, ...slittingOptions.machine_options
      .map(choice => choice.value));
    const reportMachine = document.querySelector('#slitting-report-machine');
    if (reportMachine) reportMachine.innerHTML = '<option value="">All machines / 所有机台</option>' +
      slittingOptions.machine_options.map(choice =>
        `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`).join(
        '');
    for (const f of [form, abnormalityForm]) {
      const machineChoices = f === abnormalityForm ? slittingOptions.abnormality_machine_options :
        slittingOptions.machine_options,
        shiftChoices = f === abnormalityForm ? slittingOptions.abnormality_shift_options :
        slittingOptions.production_shift_options;
      f.elements.machine_code.innerHTML = '<option value="">Select machine / 选择机台</option>' +
        machineChoices.map(choice =>
          `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`)
        .join('');
      f.elements.shift_name.innerHTML = shiftChoices.map(choice =>
          `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`)
        .join('');
    }
    form.elements.slitting_model.innerHTML = '<option value="">Select model / 选择型号</option>' +
      slittingOptions.models.map(model =>
        `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('');
    const labels = Object.fromEntries(slittingStandardFields.map(field => [field.field_key,
      field]));
    slittingStandardFields.forEach(setting => {
      const recordKey = setting.field_key === 'slitting_model' ? 'formula_code' : setting
        .field_key;
      for (const group of [slittingFields, slittingColumns, slittingRecordColumns]) {
        const field = group.find(([key]) => key === recordKey);
        if (field) field[1] = setting.label;
      }
    });
    [
      ['shift_name', form.elements.shift_name],
      ['machine_code', form.elements.machine_code],
      ['slitting_model', form.elements.slitting_model],
      ['planned_rolls', form.elements.planned_rolls],
      ['input_rolls', form.elements.input_rolls],
      ['qualified_rolls', form.elements.qualified_rolls]
    ].forEach(([key, control]) => {
      const setting = labels[key];
      if (setting && control) {
        replaceLabelText(control.closest('label'), setting.label);
        if (setting.help_text) {
          let help = control.closest('label').querySelector('small');
          if (!help) {
            help = document.createElement('small');
            control.closest('label').append(help);
          }
          help.textContent = setting.help_text;
        }
      }
    });
    const customReportColumns = slittingCustomFields.map(field => [field.field_key, field.label]);
    reportColumnDefinitions.production.push(...customReportColumns.filter(([key]) => !
      reportColumnDefinitions.production.some(([existing]) => existing === key)));
    customReportColumns.forEach(([key]) => defaultReportColumns.production.add(key));
    initialiseReportColumnPicker();
    categoryControls(abnormalityForm);
    form.querySelector('button:not([type])').disabled = false;
    abnormalityForm.querySelector('button:not([type])').disabled = false;
    return slittingOptions;
  }
  window.refreshSlittingOptions = refreshSlittingOptions;
  window.slittingOptionsReady = refreshSlittingOptions().catch(() => {
    say('Slitting options unavailable. Refresh before submitting. / 分切选项加载失败，请刷新。');
    throw Error('Slitting options unavailable.');
  });
  const categoryEditor = document.querySelector('#slitting-category-form');
  categoryEditor.elements.existing_main_category.addEventListener('change', event => {
    categoryEditor.elements.new_main_category.disabled = Boolean(event.target.value);
    if (event.target.value) categoryEditor.elements.new_main_category.value = '';
  });
  categoryEditor.addEventListener('submit', async event => {
    event.preventDefault();
    const existing = categoryEditor.elements.existing_main_category.value,
      newMain = categoryEditor.elements.new_main_category.value.trim(),
      subcategory = categoryEditor.elements.subcategory.value.trim(),
      status = document.querySelector('#slitting-category-status');
    const main = existing || newMain;
    if (!main) {
      status.textContent = 'Choose or enter a main category. / 请选择或输入主类别。';
      return;
    }
    const response = await fetch('/api/manager/slitting-event-categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          main_category: main,
          subcategory
        })
      }),
      data = await response.json();
    status.textContent = response.ok ? `${data.message} / 类别组合已保存。` : data.error;
    if (response.ok) {
      categoryEditor.reset();
      categoryEditor.elements.new_main_category.disabled = false;
      await refreshSlittingOptions();
    }
  });
  document.querySelector('#slitting-category-list').addEventListener('click', async event => {
    const mainButton = event.target.closest('.deactivate-slitting-main'),
      subButton = event.target.closest('.deactivate-slitting-sub'),
      button = mainButton || subButton;
    if (!button) return;
    const main = decodeURIComponent(button.dataset.main),
      subcategory = subButton ? decodeURIComponent(button.dataset.sub) : '',
      warning = mainButton ?
      `Deactivate ${main} and all of its subcategories? / 停用该主类别及其全部子类别？` :
      `Deactivate ${subcategory}? The main category will remain active. / 停用该子类别？主类别将保持启用。`;
    if (!window.confirm(warning)) return;
    button.disabled = true;
    const response = await fetch('/api/manager/slitting-event-categories/deactivate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({main_category: main, subcategory})
      }),
      data = await response.json(),
      status = document.querySelector('#slitting-category-status');
    status.textContent = response.ok ? data.message : (data.error || 'Could not deactivate category.');
    if (response.ok) await refreshSlittingOptions();
    else button.disabled = false;
  });
  const modelDialog = document.querySelector('#slitting-model-dialog'),
    modelForm = document.querySelector('#slitting-model-form');
  document.querySelector('#open-slitting-models').addEventListener('click', async () => {
    try {
      await loadSlittingModelEditor();
      fillSlittingModelForm();
      modelDialog.showModal();
    } catch (error) {
      say(error.message);
    }
  });
  document.querySelector('#close-slitting-models').addEventListener('click', () => modelDialog
    .close());
  modelForm.elements.existing_model.addEventListener('change', event => fillSlittingModelForm(
    slittingModelRows.find(row => Number(row.id) === Number(event.target.value)) || null));
  modelForm.addEventListener('submit', async event => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(modelForm));
    payload.is_active = modelForm.elements.is_active.checked;
    const response = await fetch('/api/manager/slitting-models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }),
      data = await response.json();
    document.querySelector('#slitting-model-status').textContent = response.ok ?
      `${data.message} / 型号参数已保存。` : data.error;
    if (response.ok) {
      const selected = form.elements.slitting_model.value,
        optionsResponse = await fetch('/api/slitting/options');
      slittingOptions = await optionsResponse.json();
      form.elements.slitting_model.innerHTML =
        '<option value="">Select model / 选择型号</option>' + slittingOptions.models.map(model =>
          `<option value="${escapeHtml(model)}" ${model===selected?'selected':''}>${escapeHtml(model)}</option>`
          ).join('');
      await loadSlittingModelEditor();
    }
  });
}

// Manager edits use the same custom-field storage contract as operator forms.
document.querySelector('#manager-record-edit').addEventListener('formdata', event => {
  if (!isSlitting || managerRecordContext?.type !== 'production') return;
  const values = Object.fromEntries(event.formData);
  const custom = {};
  slittingCustomFields.forEach(field => {
    if (Object.hasOwn(values, field.field_key)) custom[field.field_key] = values[field
      .field_key];
  });
  event.formData.set('custom_fields', JSON.stringify(custom));
});
