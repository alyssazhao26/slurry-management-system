const escapeHtml=value=>String(value??'—').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const displayParams=new URLSearchParams(location.search);
const selectedDate=displayParams.get('date')||new Intl.DateTimeFormat('en-CA').format(new Date());
const autoScroll=displayParams.get('autoscroll')==='1';
if(autoScroll)document.body.classList.add('auto-scroll');

function adaptDisplayBlocks(){
  document.querySelectorAll('.display-section:not([hidden])').forEach(section=>{
    const itemCount=section.querySelectorAll('.display-table tbody tr,.slitting-machine-card,.slitting-task-overview>article').length;
    const savedWidth=Number(section.dataset.savedWidth||section.style.gridColumn.match(/\d+/)?.[0]||1);section.dataset.savedWidth=String(savedWidth);
    section.dataset.density=itemCount>=8?'high':itemCount>=4?'medium':'low';
    const adaptiveWidth=itemCount>=8?5:itemCount>=4?Math.max(savedWidth,3):savedWidth;
    section.style.gridColumn=`span ${Math.min(adaptiveWidth,5)}`;
  });
}
function startAutomaticOverflowCycle(){
  if(window.__displayOverflowCycle)return;
  window.__displayOverflowCycle=true;
  const pauseMilliseconds=3000,pixelsPerSecond=34;
  const move=direction=>{const limit=document.documentElement.scrollHeight-window.innerHeight;if(limit<=16){window.scrollTo(0,0);setTimeout(()=>move('down'),pauseMilliseconds);return}const start=window.scrollY,target=direction==='down'?limit:0,distance=Math.abs(target-start),duration=Math.max(2500,distance/pixelsPerSecond*1000);let startedAt=null;const frame=timestamp=>{if(document.hidden){startedAt=null;requestAnimationFrame(frame);return}if(startedAt===null)startedAt=timestamp;const progress=Math.min((timestamp-startedAt)/duration,1),eased=progress<.5?2*progress*progress:1-Math.pow(-2*progress+2,2)/2;window.scrollTo(0,start+(target-start)*eased);if(progress<1)requestAnimationFrame(frame);else setTimeout(()=>move(direction==='down'?'up':'down'),pauseMilliseconds)};requestAnimationFrame(frame)};
  setTimeout(()=>move('down'),pauseMilliseconds);
}

function statValue(key,value){
  if(value===null||value===undefined)return '—';
  if(key.endsWith('_rate'))return (Number(value)*100).toFixed(2)+'%';
  return Number(value).toLocaleString(undefined,{maximumFractionDigits:2})+(key==='records'?'':' m²');
}
function slittingStats(stats){
  const items=[['planned_quantity','Target / 目标'],['actual_quantity','Output / 产出'],['achievement_rate','Progress / 进度'],['qualified_rate','Qualified / 合格率'],['yield_rate','Yield / 综收'],['records','Runs / 批次']];
  return `<div class="slitting-kpi-grid">${items.map(([key,label])=>`<article><span>${label}</span><strong>${statValue(key,stats[key])}</strong>${key==='qualified_rate'&&stats.pending?`<small>${stats.pending} pending / 待补录</small>`:''}</article>`).join('')}</div>`;
}
function renderMachines(machines,customFields=[]){
  if(!machines.length)return '<p class="empty">No production recorded / 暂无生产记录</p>';
  return `<div class="slitting-machine-grid">${machines.map(machine=>`<article class="slitting-machine-card"><div class="slitting-machine-head"><h3>${escapeHtml(machine.machine_code)}</h3><strong>${statValue('achievement_rate',machine.stats.achievement_rate)}</strong></div>${slittingStats(machine.stats)}${machine.records.map(record=>`<div class="display-record-detail"><strong>${escapeHtml(record.formula_code)} · ${escapeHtml(record.shift_name)}</strong>${customFields.map(field=>`<span>${escapeHtml(field.label)}: ${escapeHtml(record[field.field_key]||'—')}</span>`).join('')}</div>`).join('')}</article>`).join('')}</div>`;
}
const taskStatusLabels={production_in_progress:'Production in progress / 生产进行中',re_cut:'Re-cut / 补切',label_changing:'Label changing / 更换标签'};
function taskActual(productItem,targetUnit,records){
  const targetWidth=parseFloat(productItem);
  if(!Number.isFinite(targetWidth)||targetUnit==='custom')return 0;
  return records.filter(record=>Math.abs(Number(record.width_m)*1000-targetWidth)<0.06).reduce((total,record)=>total+(Number(record.input_rolls)||0),0);
}
function renderSlittingTask(task,records,fieldLabels={}){
  const items=task?.task_items||[],productionItems=items.filter(item=>item.type==='slitting_production'),scheduleItems=items.filter(item=>item.type==='slitting_schedule');
  if(!productionItems.length&&!scheduleItems.length)return '<p class="empty">No production task saved for this date / 当日暂无生产任务</p>';
  const overview=productionItems.length?`<div class="slitting-task-overview">${productionItems.map(item=>{const targetUnit=item.target_unit||'sr',unit=targetUnit==='custom'?(item.custom_unit||'custom'):targetUnit,actual=taskActual(item.product_item,targetUnit,records),target=Number(item.production_target)||0,percent=target?actual/target*100:0,fill=Math.min(Math.max(percent,0),100);return `<article><div><span>Production item / 生产项目</span><strong>${escapeHtml(item.product_item)}</strong></div><div><span>Production status / 生产状态</span><strong>${escapeHtml(taskStatusLabels[item.production_status]||item.production_status)}</strong></div><div><span>Production target / 生产目标</span><strong>${target.toLocaleString()} ${escapeHtml(unit)}</strong></div><div class="slitting-task-progress"><span>Actual input progress / 实际投入进度</span><div class="progress-track ${actual>0?'has-progress':'no-progress'}" data-progress-fill="${fill}"><i></i></div><strong>${actual.toLocaleString()} / ${target.toLocaleString()} ${escapeHtml(unit)} · ${percent.toFixed(1)}%</strong></div></article>`}).join('')}</div>`:'';
  const schedule=scheduleItems.length?`<div class="slitting-task-schedule"><h3>Machine production scheduling / 机器生产排程</h3><div class="display-table-wrap"><table class="display-table"><thead><tr><th>${escapeHtml(fieldLabels.machine_code||'Machine / 机台')}</th><th>Product / 项目</th><th>Planned input / 计划排产</th><th>Operator / 操作员</th><th>Shift lead / 班组长</th></tr></thead><tbody>${scheduleItems.map(item=>`<tr><td>${escapeHtml(item.machine)}</td><td>${escapeHtml(item.product_item)}</td><td>${escapeHtml(item.planned_input)}</td><td>${escapeHtml(item.operator)}</td><td>${escapeHtml(item.shift_lead)}</td></tr>`).join('')}</tbody></table></div></div>`:'';
  return overview+schedule;
}
function renderSlittingTraining(task){
  const trainingItems=(task?.task_items||[]).filter(item=>item.type==='slitting_training');
  if(!trainingItems.length)return '<p class="empty">No training saved for this date / 当日暂无培训</p>';
  return `<div class="display-table-wrap"><table class="display-table slitting-training-table"><thead><tr><th>Training item / 培训项目</th><th>Training type / 培训类型</th><th>Person/group trained / 受训人员或小组</th><th>Time / 时间</th></tr></thead><tbody>${trainingItems.map(item=>`<tr><td>${escapeHtml(item.training_item)}</td><td>${escapeHtml(item.training_type)}</td><td>${escapeHtml(item.subject)}</td><td>${escapeHtml(item.time)}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderPermanentText(root,value){
  root.replaceChildren();let list=null,listType='';
  String(value||'').split(/\r?\n/).forEach(line=>{const unordered=line.match(/^\s*[-*•]\s+(.+)$/),ordered=line.match(/^\s*\d+[.)]\s+(.+)$/);if(unordered||ordered){const type=unordered?'ul':'ol';if(!list||listType!==type){list=document.createElement(type);listType=type;root.append(list)}const item=document.createElement('li');item.textContent=(unordered||ordered)[1];list.append(item);return}list=null;listType='';if(!line.trim()){root.append(document.createElement('br'));return}const paragraph=document.createElement('p');paragraph.textContent=line;root.append(paragraph)});
}
function applyDisplaySettings(settings){
  document.body.classList.add('configurable-display');
  const branding=settings.branding||{};
  document.querySelector('#display-brand-title').textContent=branding.display_eyebrow||'GNEM SLITTING PRODUCTION / GNEM 分切生产';
  document.querySelector('#display-brand-subtitle').textContent=branding.display_title||'Daily Slitting Display / 分切每日看板';
  (settings.blocks||[]).forEach(block=>{let element=document.querySelector(`[data-display-block="${block.key}"]`);if(!element&&block.type==='static_text'){element=document.createElement('section');element.className='display-section permanent-text-section';element.dataset.displayBlock=block.key;const head=document.createElement('div');head.className='section-head';const title=document.createElement(block.heading_level==='h1'?'h1':'h2');title.dataset.blockTitle='';head.append(title);const content=document.createElement('div');content.className='permanent-text-content';element.append(head,content);document.querySelector('.display-layout').append(element)}if(!element)return;element.hidden=!block.visible;element.style.order=Number(block.order)||0;const width=Math.max(1,Math.min(Number(block.width)||1,5));element.dataset.savedWidth=String(width);element.style.gridColumn=`span ${width}`;element.style.gridRow='auto';element.style.setProperty('--block-height',String(Math.max(1,Math.min(Number(block.height)||1,5))));element.style.setProperty('--block-font-size',`${Math.max(12,Math.min(Number(block.font_size)||16,36))}px`);const title=element.querySelector('[data-block-title]');if(title)title.textContent=block.title;const content=element.querySelector('.permanent-text-content');if(content)renderPermanentText(content,block.content)});
}
function eventTable(events,settings){
  const columns=(settings.event_columns||[]).filter(item=>item.visible).sort((a,b)=>a.order-b.order);
  if(!events.length)return '<p class="empty">No abnormalities / 暂无异常记录</p>';
  if(!columns.length)return '<p class="empty">All event columns are hidden / 所有事件列均已隐藏</p>';
  return `<table class="display-table"><thead><tr>${columns.map(column=>`<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${events.map(row=>`<tr>${columns.map(column=>`<td>${escapeHtml(row[column.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
async function refreshSlittingDisplay(){
  try{
    const [productionResponse,eventResponse,openResponse]=await Promise.all([fetch('/api/slitting/summary?department=slitting&date='+encodeURIComponent(selectedDate)),fetch('/api/daily-report?department=slitting&date='+encodeURIComponent(selectedDate)),fetch('/api/public-display?department=slitting')]);
    if(!productionResponse.ok||!eventResponse.ok||!openResponse.ok)throw Error();
    const production=await productionResponse.json(),events=await eventResponse.json(),openData=await openResponse.json(),settings=production.display_settings||{blocks:[],event_columns:[]};
    applyDisplaySettings(settings);
    document.querySelector('#display-date').textContent=selectedDate;
    const fieldLabels=Object.fromEntries((production.standard_fields||[]).map(field=>[field.field_key,field.label]));
    const taskRoot=document.querySelector('#slitting-display-task');taskRoot.innerHTML=renderSlittingTask(production.daily_task,production.records||[],fieldLabels);
    taskRoot.querySelectorAll('[data-progress-fill]').forEach(track=>{track.querySelector('i').style.width=`${Number(track.dataset.progressFill)||0}%`;});
    const ongoingEvents=openData.ongoing_events||[];
    document.querySelector('#slitting-display-events').innerHTML=eventTable(ongoingEvents,settings);
    document.querySelector('#display-status').textContent='Updated / 更新 '+new Date().toLocaleTimeString();
    requestAnimationFrame(()=>{adaptDisplayBlocks();startAutomaticOverflowCycle();});
  }catch{document.querySelector('#display-status').textContent='Refresh failed; displayed data may be stale / 刷新失败，数据可能已过期';}
}
refreshSlittingDisplay();setInterval(refreshSlittingDisplay,30000);
