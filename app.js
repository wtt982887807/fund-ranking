'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const el = (tag, className, content) => { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = content; return node; };
  const storageKey = 'fund-ranking.products.v1';
  const state = { defaults: [], products: [], snapshot: null, source: 'galaxy', busy: true, ready: false, draft: [], template: null };
  const worker = new Worker('rank-worker.js?v=20261014-notes1');
  const pending = new Map(); let requestId = 0, toastTimer;
  worker.onmessage = event => {
    const message = event.data || {}, waiter = pending.get(message.id);
    if (!waiter) return;
    if (message.progress) { $('#progress-text').textContent = message.progress; return; }
    pending.delete(message.id);
    if (message.ok) waiter.resolve(message); else waiter.reject(new Error(message.error || '排名计算失败'));
  };
  worker.onerror = () => {
    state.ready = false;
    const error = new Error('计算程序加载失败，请刷新网页重试。');
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear(); setBusy(false); toast(error.message, true);
  };
  function request(type, data = {}, transfer = []) {
    return new Promise((resolve, reject) => { const id = ++requestId; pending.set(id, { resolve, reject }); try { worker.postMessage({ id, type, ...data }, transfer); } catch (error) { pending.delete(id); reject(error); } });
  }
  function toast(message, error = false) {
    clearTimeout(toastTimer); const box = $('#toast'); box.textContent = message; box.className = error ? 'toast error' : 'toast'; box.hidden = false;
    toastTimer = setTimeout(() => { box.hidden = true; }, error ? 14000 : 6000);
  }
  function setBusy(busy, text = '') {
    state.busy = busy; $('#upload-progress').hidden = !busy;
    if (text) $('#progress-text').textContent = text;
    $('#report-files').disabled = busy || !state.ready;
    $('#dropzone').classList.toggle('busy', busy || !state.ready);
    $('#edit-products').disabled = busy || !state.ready;
    $('#clear-reports').disabled = busy || !state.snapshot?.report_count;
    $('#export-excel').disabled = busy || !state.snapshot?.report_count || Boolean(state.snapshot?.error_count);
    for (const button of document.querySelectorAll('.remove-report, #save-products, #add-product, #import-products, #reset-products, #export-products, .editor-control')) button.disabled = busy || button.dataset.boundary === 'true';
  }
  function commit(message) {
    state.snapshot = message.snapshot; state.products = message.snapshot.products || state.products;
    render();
  }
  function saveLocalProducts() {
    try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, products: state.products })); }
    catch (_) { toast('清单已应用，但浏览器未允许保存。可导出清单，供下次导入。'); }
  }
  function rankCell(rank, product, title) {
    const td = el('td', 'rank-cell'); const value = rank?.rank || '未上传';
    let className = 'rank-value'; const percent = /^前(\d+)%/.exec(value);
    if (percent) { const p = Number(percent[1]); className += p <= 10 ? ' heat-1' : p <= 30 ? ' heat-2' : p <= 70 ? ' heat-3' : p <= 90 ? ' heat-4' : ' heat-5'; }
    else className += rank?.status === 'error' ? ' rank-error' : ' missing';
    td.append(el('span', className, value));
    if (rank?.note && rank.status !== 'not_uploaded') {
      const button = el('button', 'note-button', 'i'); button.type = 'button'; button.title = '查看排名说明'; button.setAttribute('aria-label', `${product.name} ${title}排名说明`);
      button.addEventListener('click', () => { $('#note-subtitle').textContent = `${product.name}（${product.code}） · ${title} · ${value}`; $('#note-content').textContent = rank.note; $('#note-dialog').showModal(); }); td.append(button);
    }
    return td;
  }
  function renderTable() {
    const table = $('#ranking-table'), head = table.tHead, body = table.tBodies[0]; head.replaceChildren(); body.replaceChildren();
    const galaxy = state.source === 'galaxy'; const headings = galaxy ? ['产品简称', '近一年业绩排名', '近两年业绩排名', '近三年业绩排名', '基金经理', '基金所属分类'] : ['产品简称', '近一年业绩', '近一年超额', '近两年业绩', '近两年超额', '近三年业绩', '近三年超额', '基金经理', '基金所属分类'];
    const header = el('tr'); for (const name of headings) { const th = el('th', '', name); th.scope = 'col'; header.append(th); } head.append(header);
    const query = $('#product-search').value.trim().toLowerCase();
    const all = state.snapshot?.rows || [], visible = all.filter(row => !query || `${row.name} ${row.code} ${row.galaxy.category} ${row.gtht.category}`.toLowerCase().includes(query));
    for (const row of visible) {
      const tr = el('tr'); tr.dataset.code = row.code;
      const name = el('td'); name.append(el('div', 'product-name', row.name), el('span', 'product-code', row.code));
      if (row.error) name.append(el('span', 'row-error', '匹配需检查')); tr.append(name);
      if (galaxy) for (const p of [1, 2, 3]) tr.append(rankCell(row.galaxy.ranks[p], row, `银河近${p}年业绩`));
      else for (const p of [1, 2, 3]) for (const metric of ['performance', 'excess']) tr.append(rankCell(row.gtht[metric][p], row, `国泰海通近${p}年${metric === 'performance' ? '业绩' : '超额收益'}`));
      const source = galaxy ? row.galaxy : row.gtht; tr.append(el('td', 'manager-cell', source.manager || '—'), el('td', 'category-cell', source.category)); body.append(tr);
    }
    $('#no-results').hidden = visible.length !== 0;
    $('#shown-count').textContent = query ? `显示 ${visible.length} / ${all.length} 只产品（导出包含全部产品）` : `共 ${all.length} 只产品`;
  }
  function render() {
    const snap = state.snapshot; if (!snap) return;
    $('#product-total').textContent = state.products.length;
    $('#result-summary').textContent = snap.report_count ? `数据截止 ${snap.as_of} · 已导入 ${snap.report_count} 份报表，已计算 ${snap.counts.ranking_columns} 列排名` : '导入报表后，已上传期间会自动显示排名。';
    const slots = $('#source-slots'); slots.replaceChildren();
    const specs = [{ key: 'galaxy:1', label: '银河 · 近一年' }, { key: 'galaxy:2', label: '银河 · 近两年' }, { key: 'galaxy:3', label: '银河 · 近三年' }, { key: 'performance', label: '国泰海通 · 业绩' }, { key: 'excess', label: '国泰海通 · 超额收益' }];
    for (const spec of specs) {
      const loaded = snap.reports.find(report => report.key === spec.key); const node = el('div', `source-slot${loaded ? ' loaded' : ''}`); node.dataset.key = spec.key;
      node.append(el('strong', '', spec.label), el('small', '', loaded ? `已计算 · ${loaded.periods.map(p => `近${p}年`).join(' / ')}` : '等待导入')); slots.append(node);
    }
    const list = $('#report-list'); list.replaceChildren();
    for (const report of snap.reports) {
      const li = el('li'), info = el('div', 'report-info'); info.append(el('strong', '', report.name), el('small', '', `${report.source}${report.metric === '超额收益' ? ' · 超额收益' : ''} · 数据截止 ${report.dates.join(' / ')}`));
      const remove = el('button', 'remove-report', '移除'); remove.setAttribute('aria-label', `移除 ${report.name}`); remove.addEventListener('click', async () => { if (state.busy) return; setBusy(true, '正在移除报表…'); try { commit(await request('remove', { key: report.key })); } catch (error) { toast(error.message, true); } finally { setBusy(false); } }); li.append(info, remove); list.append(li);
    }
    const box = $('#issues'); box.replaceChildren(); box.hidden = !snap.error_count && !snap.warnings?.length; box.className = snap.error_count ? 'issues' : 'issues warning';
    if (snap.error_count) {
      box.append(el('strong', '', `${snap.error_count} 只产品需要检查，处理后可导出。请核对基金代码、分类和源报表。`));
      const details = el('details'), summary = el('summary', '', '查看具体问题'), ul = el('ul');
      for (const error of snap.errors) ul.append(el('li', '', `${error.name}（${error.code}）：${error.error}`)); details.append(summary, ul); box.append(details);
    }
    if (snap.warnings?.length) { const details = el('details'), summary = el('summary', '', `报表披露说明（${snap.warnings.length}项）`), ul = el('ul'); for (const note of snap.warnings) ul.append(el('li', '', note)); details.append(summary, ul); box.append(details); }
    renderTable(); setBusy(state.busy);
  }
  async function upload(files) {
    if (state.busy || !state.ready || !files.length) return;
    setBusy(true, '正在读取报表…'); let success = 0, lastKind = null;
    for (let i = 0; i < files.length; i++) {
      const file = files[i]; $('#progress-text').textContent = `正在读取 ${i + 1}/${files.length}：${file.name}`;
      try {
        if (!/\.xlsx?$/i.test(file.name)) throw new Error('请选择 .xlsx 或 .xls 报表。');
        const buffer = await file.arrayBuffer(); const result = await request('upload', { name: file.name, buffer, replaceExisting: true }, [buffer]);
        commit(result); success++; lastKind = result.report?.kind; if (result.replaced) toast(`已替换：${file.name}`);
        // Each response is rendered before processing the next file.
        await new Promise(resolve => requestAnimationFrame(resolve));
      } catch (error) { toast(`${file.name}：${error.message}`, true); }
    }
    if (lastKind && success === files.length) setSource(lastKind === 'galaxy' ? 'galaxy' : 'gtht');
    setBusy(false); $('#report-files').value = '';
    if (success === files.length) toast(`已完成 ${success} 份报表，排名已更新。`);
  }
  function setSource(source) {
    state.source = source; for (const tab of document.querySelectorAll('.tab')) { const selected = tab.dataset.source === source; tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; }
    $('#ranking-panel').setAttribute('aria-labelledby', source === 'galaxy' ? 'tab-galaxy' : 'tab-gtht'); renderTable();
  }
  function renderEditor() {
    const body = $('#product-editor tbody'); body.replaceChildren(); $('#editor-count').textContent = `${state.draft.length} 只产品 · 修改仅保存在当前浏览器`;
    for (let index = 0; index < state.draft.length; index++) {
      const product = state.draft[index], tr = el('tr');
      for (const [field, label] of [['name', '产品简称'], ['code', '基金代码'], ['galaxy_category', '银河分类代码'], ['gtht_category', '国泰海通基金所属分类']]) {
        const td = el('td'), input = el('input'); input.value = product[field] || ''; input.dataset.field = field; input.setAttribute('aria-label', `第${index + 1}只产品${label}`);
        if (field === 'code') { input.inputMode = 'numeric'; input.maxLength = 6; }
        input.addEventListener('input', () => { product[field] = input.value; $('#editor-error').hidden = true; }); td.append(input); tr.append(td);
      }
      const controls = el('td');
      for (const [symbol, action, label] of [['↑', 'up', '上移'], ['↓', 'down', '下移'], ['×', 'remove', '删除']]) {
        const button = el('button', `editor-control${action === 'remove' ? ' remove' : ''}`, symbol); button.setAttribute('aria-label', `${label}第${index + 1}只产品`);
        button.disabled = action === 'up' && index === 0 || action === 'down' && index === state.draft.length - 1; button.dataset.boundary = String(button.disabled);
        button.addEventListener('click', () => { if (action === 'remove') state.draft.splice(index, 1); else { const to = index + (action === 'up' ? -1 : 1); [state.draft[index], state.draft[to]] = [state.draft[to], state.draft[index]]; } renderEditor(); }); controls.append(button);
      }
      tr.append(controls); body.append(tr);
    }
  }
  function download(bytes, type, name) {
    const blob = new Blob([bytes], { type }), url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  $('#report-files').addEventListener('change', event => upload([...event.target.files]));
  const dropzone = $('#dropzone');
  dropzone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!state.busy) $('#report-files').click(); } });
  for (const type of ['dragenter', 'dragover']) dropzone.addEventListener(type, event => { event.preventDefault(); if (!state.busy) dropzone.classList.add('dragover'); });
  for (const type of ['dragleave', 'drop']) dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.remove('dragover'); if (type === 'drop') upload([...event.dataTransfer.files]); });
  $('#clear-reports').addEventListener('click', async () => { if (state.busy) return; setBusy(true, '正在清空报表…'); try { commit(await request('clear')); toast('报表已清空，可以导入下个月的数据。'); } catch (error) { toast(error.message, true); } finally { setBusy(false); } });
  for (const tab of document.querySelectorAll('.tab')) { tab.addEventListener('click', () => setSource(tab.dataset.source)); tab.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const other = tab.dataset.source === 'galaxy' ? 'gtht' : 'galaxy'; setSource(other); $(`#tab-${other}`).focus(); } }); }
  $('#product-search').addEventListener('input', renderTable);
  $('#edit-products').addEventListener('click', () => { state.draft = state.products.map(product => ({ ...product })); $('#editor-error').hidden = true; renderEditor(); $('#product-dialog').showModal(); });
  for (const button of document.querySelectorAll('.close-dialog')) button.addEventListener('click', () => { if (!state.busy) $('#product-dialog').close(); });
  for (const button of document.querySelectorAll('.close-note')) button.addEventListener('click', () => $('#note-dialog').close());
  $('#product-dialog').addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
  $('#add-product').addEventListener('click', () => { state.draft.push({ name: '', code: '', galaxy_category: '', gtht_category: '' }); renderEditor(); const input = $('#product-editor tbody tr:last-child input'); input?.focus(); });
  $('#reset-products').addEventListener('click', () => { state.draft = state.defaults.map(product => ({ ...product })); $('#editor-error').hidden = true; renderEditor(); });
  $('#import-products').addEventListener('click', () => $('#product-json-file').click());
  $('#product-json-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try { const data = JSON.parse(await file.text()), products = Array.isArray(data) ? data : data.products; if (!Array.isArray(products) || !products.length) throw new Error('清单中需要有非空的 products 数组。'); state.draft = products.map(product => ({ name: product.name || '', code: String(product.code || ''), galaxy_category: product.galaxy_category || '', gtht_category: product.gtht_category || '' })); renderEditor(); $('#editor-error').hidden = true; }
    catch (error) { $('#editor-error').textContent = `导入失败：${error.message}`; $('#editor-error').hidden = false; }
    finally { event.target.value = ''; }
  });
  $('#export-products').addEventListener('click', () => download(JSON.stringify({ version: 1, products: state.draft }, null, 2), 'application/json;charset=utf-8', '公募基金排名产品清单.json'));
  $('#save-products').addEventListener('click', async () => {
    if (state.busy) return; setBusy(true, '正在按新产品清单计算…');
    try { commit(await request('products', { products: state.draft })); saveLocalProducts(); $('#product-dialog').close(); toast('产品清单已更新，两张排名表同步应用。'); }
    catch (error) { $('#editor-error').textContent = error.message; $('#editor-error').hidden = false; }
    finally { setBusy(false); }
  });
  $('#export-excel').addEventListener('click', async () => {
    if (state.busy || !state.snapshot?.report_count || state.snapshot.error_count) return;
    setBusy(true, '正在生成原格式 Excel 和排名备注…');
    try {
      if (!state.template) { const response = await fetch('template.xlsx'); if (!response.ok) throw new Error('Excel 模板读取失败，请刷新后重试。'); state.template = new Uint8Array(await response.arrayBuffer()); }
      const bytes = await FundRankingExport.exportWorkbook(state.template, state.products, state.snapshot, state.defaults);
      download(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '【国泰海通+银河】公募基金业绩排名整理.xlsx'); toast('Excel 已导出，包含原格式、动态热力图和排名备注。');
    } catch (error) { toast(error.message, true); }
    finally { setBusy(false); }
  });
  (async () => {
    setBusy(true, '正在准备产品清单…');
    try {
      const response = await fetch('default-products.json'); if (!response.ok) throw new Error('默认产品清单读取失败，请刷新后重试。'); state.defaults = await response.json(); let stored;
      try { const value = JSON.parse(localStorage.getItem(storageKey)); stored = value?.products; } catch (_) { /* A corrupt preference must not block opening the tool. */ }
      try { commit(await request('init', { products: stored || state.defaults })); } catch (error) { if (!stored) throw error; commit(await request('init', { products: state.defaults })); toast('已恢复默认清单，原保存清单格式无法读取。', true); }
      state.ready = true; setSource('galaxy');
    } catch (error) { toast(error.message, true); }
    finally { setBusy(false); }
  })();
})();
