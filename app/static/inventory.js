const inventoryState = {
  productPage: 1,
  transactionPage: 1,
  selectedProducts: new Set()
};
const inventoryDepartmentQuery = `department=${encodeURIComponent(department)}`;

function inventoryTable(rows, columns, productRows = false) {
  if (!rows.length) return '<p class="empty">No records / 暂无记录</p>';
  const head = columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('');
  const body = rows.map(row =>
    `<tr>${productRows ? `<td><input class="product-label-select" type="checkbox" value="${Number(row.id)}" aria-label="Select roll ${escapeHtml(row.roll_number)}" ${inventoryState.selectedProducts.has(Number(row.id)) ? 'checked' : ''}></td>` : ''}${columns.map(([key]) => `<td>${key === 'status' ? `<span class="stock-badge ${escapeHtml(row[key])}">${row[key] === 'in_stock' ? 'IN STOCK / 在库' : 'OUT / 已出库'}</span>` : escapeHtml(row[key])}</td>`).join('')}${productRows ? `<td class="roll-label-actions"><a class="secondary qr-link" href="/inventory/products/${Number(row.id)}/label?${inventoryDepartmentQuery}" target="_blank">Print / PDF</a><a class="secondary qr-link" href="/api/inventory/products/${Number(row.id)}/qr.png?${inventoryDepartmentQuery}" download>QR</a></td>` : ''}</tr>`
    ).join('');
  return `<div class="table-wrap"><table><thead><tr>${productRows ? '<th>Select / 选择</th>' : ''}${head}${productRows ? '<th>Label / 标签</th>' : ''}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function inventoryFilterValues() {
  return {
    ...Object.fromEntries(new FormData(document.querySelector('#product-inventory-filters'))),
    ...Object.fromEntries(new FormData(document.querySelector('#transaction-inventory-filters'))),
  };
}

function renderInventoryPagination(target, pagination, kind) {
  const root = document.querySelector(target),
    first = pagination.total ? (pagination.page - 1) * pagination.page_size + 1 : 0;
  const last = Math.min(pagination.page * pagination.page_size, pagination.total);
  root.innerHTML =
    `<span>Showing ${first}-${last} of ${pagination.total} / 显示 ${first}-${last}，共 ${pagination.total}</span><div><button class="secondary inventory-page" data-kind="${kind}" data-page="${pagination.page - 1}" ${pagination.page <= 1 ? 'disabled' : ''}>Previous / 上一页</button><button class="secondary inventory-page" data-kind="${kind}" data-page="${pagination.page + 1}" ${last >= pagination.total ? 'disabled' : ''}>Next / 下一页</button></div>`;
}

function updateInventorySelection() {
  const count = inventoryState.selectedProducts.size;
  document.querySelector('#selected-product-count').textContent = `${count} selected / 已选 ${count}`;
  document.querySelector('#print-selected-labels').disabled = count === 0;
  const visible = [...document.querySelectorAll('.product-label-select')];
  document.querySelector('#select-visible-products').checked = visible.length > 0 && visible.every(
    input => input.checked);
}

async function loadInventory() {
  const query = new URLSearchParams({
    product_page: inventoryState.productPage,
    transaction_page: inventoryState.transactionPage,
    ...inventoryFilterValues()
  });
  [...query.entries()].forEach(([key, value]) => {
    if (!value) query.delete(key);
  });
  const response = await fetch(`/api/inventory?${query}`);
  const data = await response.json();
  if (!response.ok) {
    say(data.error || 'Unable to load inventory. Apply pending migrations.');
    return;
  }
  document.querySelector('#inventory-summary').innerHTML =
    `<article><span>In stock / 在库</span><strong>${data.summary.in_stock}</strong></article><article><span>Checked out / 已出库</span><strong>${data.summary.checked_out}</strong></article><article><span>Total registered / 登记总数</span><strong>${data.summary.registered}</strong></article>`;
  document.querySelector('#inventory-products').innerHTML = inventoryTable(data.products, [
    ['parent_roll_number', 'MR / MR 卷号'],
    ['roll_number', 'Roll / 卷号'],
    ['slit_width_mm', 'Width mm / 宽度'],
    ['roll_length_m', 'Length m / 卷长'],
    ['status', 'Status / 状态'],
    ['created_at', 'Registered / 登记时间'],
    ['checked_out_at', 'Checkout date / 出库日期']
  ], true);
  document.querySelector('#inventory-transactions').innerHTML = inventoryTable(data.transactions,
    [
      ['occurred_at', 'Time / 时间'],
      ['roll_number', 'Roll / 卷号'],
      ['transaction_type', 'Type / 类型'],
      ['quantity_delta', 'Change / 变化'],
      ['source', 'Source / 来源']
    ]);
  renderInventoryPagination('#product-pagination', data.product_pagination, 'products');
  renderInventoryPagination('#transaction-pagination', data.transaction_pagination,
    'transactions');
  updateInventorySelection();
}
document.querySelector('#refresh-inventory').addEventListener('click', loadInventory);
document.querySelectorAll('.inventory-tab').forEach(button => button.addEventListener('click',
() => {
  document.querySelectorAll('.inventory-tab').forEach(item => item.classList.toggle('active',
    item === button));
  document.querySelectorAll('.inventory-tab-panel').forEach(panel => panel.classList.toggle(
    'active', panel.id === `inventory-${button.dataset.inventoryTab}-panel`));
}));
document.querySelector('#product-inventory-filters').addEventListener('submit', event => {
  event.preventDefault();
  inventoryState.productPage = 1;
  loadInventory();
});
document.querySelector('#transaction-inventory-filters').addEventListener('submit', event => {
  event.preventDefault();
  inventoryState.transactionPage = 1;
  loadInventory();
});
document.querySelectorAll('.clear-inventory-filter').forEach(button => button.addEventListener(
  'click', () => {
    document.querySelector(`#${button.dataset.filterForm}`).reset();
    if (button.dataset.filterForm.startsWith('product')) inventoryState.productPage = 1;
    else inventoryState.transactionPage = 1;
    loadInventory();
  }));
document.querySelector('#inventory').addEventListener('click', event => {
  const pageButton = event.target.closest('.inventory-page');
  if (!pageButton || pageButton.disabled) return;
  if (pageButton.dataset.kind === 'products') inventoryState.productPage = Number(pageButton
    .dataset.page);
  else inventoryState.transactionPage = Number(pageButton.dataset.page);
  loadInventory();
});
document.querySelector('#inventory-products').addEventListener('change', event => {
  if (!event.target.classList.contains('product-label-select')) return;
  const id = Number(event.target.value);
  if (event.target.checked) inventoryState.selectedProducts.add(id);
  else inventoryState.selectedProducts.delete(id);
  updateInventorySelection();
});
document.querySelector('#select-visible-products').addEventListener('change', event => {
  document.querySelectorAll('.product-label-select').forEach(input => {
    input.checked = event.target.checked;
    const id = Number(input.value);
    if (input.checked) inventoryState.selectedProducts.add(id);
    else inventoryState.selectedProducts.delete(id);
  });
  updateInventorySelection();
});
document.querySelector('#print-selected-labels').addEventListener('click', () => {
  const ids = [...inventoryState.selectedProducts];
  if (!ids.length) return;
  window.open(`/inventory/products/labels?ids=${ids.join(',')}&${inventoryDepartmentQuery}`,
    '_blank', 'noopener');
});
document.querySelector('#inventory-product-form').elements.production_date.value =
formReferenceDate;

function confirmInventoryRegistration(payload) {
  const mr = payload.mr_number.trim().toUpperCase();
  const count = payload.small_roll_number ? Number(payload.small_roll_number) : 0;
  const rolls = count ? Array.from({
    length: count
  }, (_, index) => `${mr}-${String(index + 1).padStart(5, '0')}`) : [mr];
  const specs =
    `${payload.slit_width_mm || '—'} mm × ${payload.roll_length_m || '—'} m × ${payload.thickness_um || '—'} μm`;
  let dialog = document.querySelector('#inventory-confirm-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'inventory-confirm-dialog';
    dialog.className = 'inventory-confirm-dialog';
    document.body.append(dialog);
  }
  dialog.innerHTML =
    `<form method="dialog"><div class="confirmation-head"><div><span>VALIDATE LABELS / 核对标签</span><h2>Confirm before registration / 登记前确认</h2><p>Nothing has been saved yet. Check every roll number and specification. / 尚未保存，请核对所有卷号和规格。</p></div><button class="secondary" value="cancel" aria-label="Close">×</button></div><div class="confirmation-summary"><strong>${escapeHtml(mr)}</strong><span>${rolls.length} label${rolls.length === 1 ? '' : 's'} / ${rolls.length} 张标签</span><span>${escapeHtml(specs)}</span></div><div class="confirmation-labels">${rolls.map(roll => `<article><span class="confirmation-qr" aria-hidden="true">QR</span><div><strong>${escapeHtml(roll)}</strong><small>${escapeHtml(specs)}</small></div></article>`).join('')}</div><div class="confirmation-actions"><button class="secondary" value="cancel">Go back / 返回修改</button><button class="primary" value="confirm">Confirm & register / 确认并登记</button></div></form>`;
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog
    .returnValue === 'confirm'), {
    once: true
  }));
}
document.querySelector('#inventory-product-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector('#inventory-form-status');
  const payload = Object.fromEntries(new FormData(form));
  if (!(await confirmInventoryRegistration(payload))) {
    status.textContent = 'Registration cancelled. Nothing was saved. / 已取消，未保存。';
    return;
  }
  const submitButton = form.querySelector('button');
  submitButton.disabled = true;
  const response = await fetch('/api/inventory/products', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  submitButton.disabled = false;
  if (!response.ok) {
    status.textContent = data.error || 'Registration failed.';
    return;
  }
  const mr = payload.mr_number.toUpperCase();
  const roll = data.products[0].roll_number;
  const qrUrl = `/api/inventory/products/${data.id}/qr.png?${inventoryDepartmentQuery}`;
  const specs = [payload.slit_width_mm ? `${payload.slit_width_mm} mm` : '', payload
    .roll_length_m ? `${payload.roll_length_m} m` : '', payload.thickness_um ?
    `${payload.thickness_um} μm` : ''
  ].filter(Boolean).join(' × ');
  const printUrl = data.ids.length > 1 ?
    `/inventory/products/labels?ids=${data.ids.join(',')}&${inventoryDepartmentQuery}` :
    `/inventory/products/${data.id}/label?${inventoryDepartmentQuery}`;
  document.querySelector('#inventory-qr-preview').innerHTML =
    `<div class="qr-label"><strong>${escapeHtml(data.ids.length > 1 ? `${mr} · 00001–${String(data.ids.length).padStart(5, '0')}` : roll)}</strong>${specs ? `<span>${escapeHtml(specs)}</span>` : ''}<img src="${qrUrl}" alt="QR code for roll ${escapeHtml(roll)}"><a class="primary" href="${printUrl}" target="_blank">Print ${data.ids.length > 1 ? `all ${data.ids.length}` : ''} / Save as PDF · 打印/另存PDF</a><a class="secondary" href="${qrUrl}" download="${escapeHtml(roll)}-QR.png">Save first QR PNG / 保存首个二维码</a></div>`;
  status.textContent = data.message;
  form.reset();
  form.elements.production_date.value = formReferenceDate;
  await loadInventory();
});
