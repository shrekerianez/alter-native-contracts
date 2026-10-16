(() => {
  'use strict';

  const STORAGE_KEY = 'alternative-rentability-v1';
  const APP_VERSION = 1;

  const schedulePresets = {
    shift16: { label: 'Вахта 16/8', shiftHours: 16, employeeDays: 15.25, rotations: 2, ozonFactor24: 1.5 },
    shift12: { label: 'Вахта 12/12', shiftHours: 12, employeeDays: 15.25, rotations: 2, ozonFactor24: 2 },
    shift14: { label: 'Вахта 14/10', shiftHours: 14, employeeDays: 15.25, rotations: 2, ozonFactor24: 1.75 },
    fiveTwo: { label: 'Будни 5/2', shiftHours: 8, employeeDays: 20.67, rotations: 1, ozonFactor24: 1 },
    day13: { label: 'Сутки 1/3', shiftHours: 24, employeeDays: 7.67, rotations: 4, ozonFactor24: 1 },
    day12: { label: 'Сутки 1/2', shiftHours: 24, employeeDays: 10.17, rotations: 3, ozonFactor24: 1 },
    shift2x2: { label: 'Сменный 2/2 по 12 ч', shiftHours: 12, employeeDays: 15.25, rotations: 2, ozonFactor24: 2 },
    custom: { label: 'Свой график', shiftHours: 12, employeeDays: 15.25, rotations: 2, ozonFactor24: null }
  };

  const defaultState = () => ({
    version: APP_VERSION,
    contract: {
      name: 'Новый договор', number: '', months: 12,
      priceMode: 'calculated', manualPrice: 0, manualIncludesVat: true
    },
    settings: {
      ndfl: 13, usn: 6, vatEnabled: true, vat: 5,
      mrot: 27093, salaryGrossBase: 45000, agentPercent: 12,
      insuranceBase: 30, insuranceAbove: 15, accident: 0.2,
      vacationSalaryPart: 0.5, overhead: 5, profitMarkup: 10,
      allocationMethod: 'payroll'
    },
    posts: [createPost({ name: 'Круглосуточный пост', quantity: 1, coverageHours: 24, schedule: 'shift12', hourlyNet: 250 })],
    sharedStaff: [], monthlyExpenses: [], materials: []
  });

  function id() { return (crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`); }
  function num(v, fallback = 0) { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : fallback; }
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function pct(v) { return num(v) / 100; }
  function rub(v, digits = 0) { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: digits }).format(Number.isFinite(v) ? v : 0); }
  function number(v, digits = 2) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(Number.isFinite(v) ? v : 0); }
  function esc(s) { return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

  function createPost(overrides = {}) {
    return {
      id: id(), name: 'Пост', quantity: 1, coverageHours: 24, daysPerMonth: 30.5, simultaneous: 1,
      schedule: 'shift12', shiftHours: 12, employeeDays: 15.25, rotations: 2,
      wageMode: 'hourly', hourlyNet: 0, dailyNet: 0, fixedNet: 0,
      employment: 'partial', customGross: 0, miscPerEmployee: 0, directExpense: 0,
      ...overrides
    };
  }
  function createSharedStaff(overrides = {}) { return { id:id(), name:'Начальник охраны', count:1, netMonthly:0, employment:'partial', customGross:0, miscPerEmployee:0, ...overrides }; }
  function createMonthlyExpense(overrides = {}) { return { id:id(), name:'Расход', amount:0, ...overrides }; }
  function createMaterial(overrides = {}) { return { id:id(), name:'Оборудование', quantity:1, unitPrice:0, amortMonths:12, model:'', ...overrides }; }

  function migrate(data) {
    const d = defaultState();
    if (!data || typeof data !== 'object') return d;
    return {
      ...d, ...data,
      contract: { ...d.contract, ...(data.contract || {}) },
      settings: { ...d.settings, ...(data.settings || {}) },
      posts: Array.isArray(data.posts) ? data.posts.map(p => ({ ...createPost(), ...p, id:p.id || id() })) : d.posts,
      sharedStaff: Array.isArray(data.sharedStaff) ? data.sharedStaff.map(x => ({...createSharedStaff(),...x,id:x.id||id()})) : [],
      monthlyExpenses: Array.isArray(data.monthlyExpenses) ? data.monthlyExpenses.map(x => ({...createMonthlyExpense(),...x,id:x.id||id()})) : [],
      materials: Array.isArray(data.materials) ? data.materials.map(x => ({...createMaterial(),...x,id:x.id||id()})) : []
    };
  }

  let state;
  try { state = migrate(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch { state = defaultState(); }
  let draftPost = null;
  let genericDraft = null;
  let saveTimer = null;

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const label = document.getElementById('saveStateLabel');
    if (label) label.textContent = 'Сохранено';
  }
  function scheduleSave() {
    const label = document.getElementById('saveStateLabel'); if (label) label.textContent = 'Сохранение…';
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 160);
  }

  function calcInsurance(base) {
    const s = state.settings;
    const threshold = num(s.mrot) * 1.5;
    return Math.min(base, threshold) * pct(s.insuranceBase) + Math.max(0, base - threshold) * pct(s.insuranceAbove);
  }

  function wageCost(netMonthly, employment, customGross = 0, miscPerEmployee = 0) {
    const s = state.settings;
    const ndfl = clamp(pct(s.ndfl), 0, .99);
    const employed = employment !== 'none';
    const fullWhite = employment === 'white';
    let salaryGross = 0;
    if (employed) salaryGross = fullWhite ? netMonthly / (1 - ndfl) : (num(customGross) > 0 ? num(customGross) : num(s.salaryGrossBase));
    const toCard = employed ? salaryGross * (1 - ndfl) : 0;
    const envelope = fullWhite ? 0 : (employed ? Math.max(0, netMonthly - toCard) : netMonthly);
    const agentRate = clamp(pct(s.agentPercent), 0, .999);
    const agentOrderTotal = envelope > 0 ? envelope / (1 - agentRate) : 0;
    const agentFee = Math.max(0, agentOrderTotal - envelope);
    const insurance = employed ? calcInsurance(salaryGross) : 0;
    const accident = employed ? salaryGross * pct(s.accident) : 0;
    const vacationGross = employed ? salaryGross * num(s.vacationSalaryPart) / 12 : 0;
    const vacationInsurance = employed ? calcInsurance(vacationGross) : 0;
    const vacationAccident = employed ? vacationGross * pct(s.accident) : 0;
    const vacationReserve = vacationGross + vacationInsurance + vacationAccident;
    const total = salaryGross + envelope + agentFee + insurance + accident + vacationReserve + num(miscPerEmployee);
    return { netMonthly, salaryGross, toCard, envelope, agentOrderTotal, agentFee, insurance, accident, vacationReserve, total };
  }

  function staffingFactor(post) {
    const coverage = Math.max(0, num(post.coverageHours));
    const shift = Math.max(.01, num(post.shiftHours, 12));
    const preset = schedulePresets[post.schedule];
    if (Math.abs(coverage - 24) < .001 && preset?.ozonFactor24) return preset.ozonFactor24;
    return coverage / shift;
  }

  function calcPost(post) {
    const qty = Math.max(0, num(post.quantity));
    const factor = staffingFactor(post);
    const peoplePerDay = qty * Math.max(0, num(post.simultaneous, 1)) * factor;
    const headcount = peoplePerDay * Math.max(0, num(post.rotations, 1));
    let netMonthlyPerEmployee = 0;
    if (post.wageMode === 'fixed') netMonthlyPerEmployee = num(post.fixedNet);
    else if (post.wageMode === 'daily') netMonthlyPerEmployee = num(post.dailyNet) * num(post.employeeDays);
    else netMonthlyPerEmployee = num(post.hourlyNet) * num(post.shiftHours) * num(post.employeeDays);
    const unit = wageCost(netMonthlyPerEmployee, post.employment, post.customGross, post.miscPerEmployee);
    const personnelCost = unit.total * headcount;
    const directCost = personnelCost + num(post.directExpense);
    const hoursMonth = qty * num(post.coverageHours) * num(post.daysPerMonth);
    return { ...post, qty, factor, peoplePerDay, headcount, netMonthlyPerEmployee, unit, personnelCost, directCost, hoursMonth };
  }

  function calcSharedStaff(item) {
    const unit = wageCost(num(item.netMonthly), item.employment, item.customGross, item.miscPerEmployee);
    return { ...item, unit, total: unit.total * Math.max(0, num(item.count)) };
  }

  function calculate() {
    const posts = state.posts.map(calcPost);
    const shared = state.sharedStaff.map(calcSharedStaff);
    const postDirect = posts.reduce((s,p)=>s+p.directCost,0);
    const sharedStaffCost = shared.reduce((s,x)=>s+x.total,0);
    const monthlyExpenseCost = state.monthlyExpenses.reduce((s,x)=>s+num(x.amount),0);
    const materials = state.materials.map(x => ({...x, monthly: num(x.amortMonths) > 0 ? num(x.quantity)*num(x.unitPrice)/num(x.amortMonths) : 0}));
    const materialCost = materials.reduce((s,x)=>s+x.monthly,0);
    const sharedPool = sharedStaffCost + monthlyExpenseCost + materialCost;
    const directTotal = postDirect + sharedPool;
    const overhead = directTotal * pct(state.settings.overhead);
    const costWithOverhead = directTotal + overhead;
    const targetProfit = costWithOverhead * pct(state.settings.profitMarkup);
    const usnRate = clamp(pct(state.settings.usn), 0, .99);
    const vatRate = state.settings.vatEnabled ? Math.max(0, pct(state.settings.vat)) : 0;
    const calcRevenueNoVat = (costWithOverhead + targetProfit) / (1 - usnRate);
    let revenueNoVat = calcRevenueNoVat;
    let priceWithVat = calcRevenueNoVat * (1 + vatRate);
    if (state.contract.priceMode === 'manual' && num(state.contract.manualPrice) > 0) {
      if (state.contract.manualIncludesVat && vatRate > 0) {
        priceWithVat = num(state.contract.manualPrice);
        revenueNoVat = priceWithVat / (1 + vatRate);
      } else {
        revenueNoVat = num(state.contract.manualPrice);
        priceWithVat = revenueNoVat * (1 + vatRate);
      }
    }
    const usn = revenueNoVat * usnRate;
    const profit = revenueNoVat - usn - costWithOverhead;
    const margin = revenueNoVat > 0 ? profit/revenueNoVat : 0;
    const roi = costWithOverhead > 0 ? profit/costWithOverhead : 0;
    const breakEvenNoVat = costWithOverhead / (1 - usnRate);
    const breakEvenWithVat = breakEvenNoVat * (1 + vatRate);
    const vat = priceWithVat - revenueNoVat;

    let weights = posts.map(p => {
      if (state.settings.allocationMethod === 'posts') return p.qty;
      if (state.settings.allocationMethod === 'hours') return p.hoursMonth;
      return p.personnelCost;
    });
    let totalWeight = weights.reduce((s,x)=>s+x,0);
    if (totalWeight <= 0) { weights = posts.map(p=>p.qty || 1); totalWeight = weights.reduce((s,x)=>s+x,0) || 1; }
    const allocatedPosts = posts.map((p,i) => {
      const share = weights[i]/totalWeight;
      const allocatedRevenue = revenueNoVat*share;
      const allocatedShared = sharedPool*share;
      const allocatedOverhead = overhead*share;
      const allocatedUsn = usn*share;
      const allocatedProfit = profit*share;
      const allocatedCost = p.directCost + allocatedShared + allocatedOverhead;
      return { ...p, share, allocatedRevenue, allocatedShared, allocatedOverhead, allocatedUsn, allocatedProfit, allocatedCost, pricePerPost: p.qty>0 ? allocatedRevenue/p.qty : 0, pricePerHour: p.hoursMonth>0 ? allocatedRevenue/p.hoursMonth : 0, pricePerDay: p.qty>0 && num(p.daysPerMonth)>0 ? allocatedRevenue/p.qty/num(p.daysPerMonth) : 0 };
    });
    const headcount = posts.reduce((s,p)=>s+p.headcount,0) + shared.reduce((s,x)=>s+num(x.count),0);
    return { posts:allocatedPosts, shared, materials, postDirect, sharedStaffCost, monthlyExpenseCost, materialCost, sharedPool, directTotal, overhead, costWithOverhead, targetProfit, calcRevenueNoVat, revenueNoVat, priceWithVat, vat, usn, profit, margin, roi, breakEvenNoVat, breakEvenWithVat, headcount };
  }

  function render() {
    const c = calculate();
    renderSummary(c); renderPosts(c); renderCosts(c); renderSettings(); renderContractControls();
  }

  function renderSummary(c) {
    text('heroRevenue', rub(c.revenueNoVat)); text('heroProfit', rub(c.profit)); text('heroBreakEven', rub(c.breakEvenNoVat));
    const pill = document.getElementById('profitPill'); pill.textContent = `${number(c.margin*100,1)}%`; pill.classList.toggle('bad', c.profit < 0);
    text('kpiCost', rub(c.costWithOverhead)); text('kpiUsn', rub(c.usn)); text('kpiWithVat', rub(c.priceWithVat)); text('kpiHeadcount', number(c.headcount,2));
    text('vatHint', state.settings.vatEnabled ? `при ставке ${number(state.settings.vat,2)}%` : 'НДС не применяется');
    const postsBox = document.getElementById('summaryPosts');
    postsBox.innerHTML = c.posts.length ? c.posts.slice(0,3).map(postCardHtml).join('') : emptyHtml('Постов пока нет');
    document.getElementById('priceBreakdown').innerHTML = [
      ['Прямые расходы постов', c.postDirect], ['Общий персонал', c.sharedStaffCost], ['Ежемесячные расходы', c.monthlyExpenseCost], ['Амортизация', c.materialCost], ['Накладные', c.overhead], ['УСН', c.usn], ['Прибыль', c.profit], ['Итого без НДС', c.revenueNoVat, true], ['НДС', c.vat], ['К оплате с НДС', c.priceWithVat, true]
    ].map(([l,v,t])=>`<div class="breakdown-row ${t?'total':''}"><span>${esc(l)}</span><strong class="${v<0?'bad-text':''}">${rub(v)}</strong></div>`).join('');
  }

  function postCardHtml(p) {
    return `<article class="post-card" data-post-id="${p.id}"><div><div class="name">${esc(p.name)}</div><div class="sub">${number(p.qty)} пост. · ${number(p.coverageHours)} ч/сутки · ${esc(schedulePresets[p.schedule]?.label || 'Свой график')}</div></div><div class="money">${rub(p.allocatedRevenue)}<small>${rub(p.pricePerPost)} / пост</small></div><div class="post-stats"><div><span>Персонал</span><strong>${number(p.headcount,2)}</strong></div><div><span>Себестоимость</span><strong>${rub(p.allocatedCost)}</strong></div><div><span>Цена/час</span><strong>${rub(p.pricePerHour,2)}</strong></div></div><div class="card-actions"><button class="mini-button" data-edit-post="${p.id}">Изменить</button><button class="mini-button danger" data-delete-post="${p.id}">Удалить</button></div></article>`;
  }

  function renderPosts(c) {
    const box = document.getElementById('postsList');
    box.innerHTML = c.posts.length ? c.posts.map(postCardHtml).join('') : emptyHtml('Добавьте первый пост. Именно с него начинается расчёт.');
  }

  function renderCosts(c) {
    document.getElementById('sharedStaffList').innerHTML = c.shared.length ? c.shared.map(x => `<article class="list-card"><div class="list-head"><div><div class="list-title">${esc(x.name)}</div><div class="list-sub">${number(x.count)} чел. · ${rub(x.netMonthly)} на руки</div></div><div class="list-value">${rub(x.total)}</div></div><div class="list-actions"><button class="mini-button" data-edit-shared="${x.id}">Изменить</button><button class="mini-button danger" data-delete-shared="${x.id}">Удалить</button></div></article>`).join('') : emptyHtml('Общий персонал не добавлен');
    document.getElementById('monthlyExpenseList').innerHTML = state.monthlyExpenses.length ? state.monthlyExpenses.map(x => `<article class="list-card"><div class="list-head"><div><div class="list-title">${esc(x.name)}</div><div class="list-sub">ежемесячно</div></div><div class="list-value">${rub(num(x.amount))}</div></div><div class="list-actions"><button class="mini-button" data-edit-expense="${x.id}">Изменить</button><button class="mini-button danger" data-delete-expense="${x.id}">Удалить</button></div></article>`).join('') : emptyHtml('Ежемесячных расходов нет');
    document.getElementById('materialsList').innerHTML = c.materials.length ? c.materials.map(x => { const warn = num(x.amortMonths) < num(state.contract.months); return `<article class="list-card"><div class="list-head"><div><div class="list-title">${esc(x.name)}</div><div class="list-sub ${warn?'warning':''}">${number(x.quantity)} × ${rub(num(x.unitPrice))} · амортизация ${number(x.amortMonths)} мес.${warn?' · меньше срока договора':''}</div></div><div class="list-value">${rub(x.monthly)}<div class="list-sub">/ мес.</div></div></div><div class="list-actions"><button class="mini-button" data-edit-material="${x.id}">Изменить</button><button class="mini-button danger" data-delete-material="${x.id}">Удалить</button></div></article>`; }).join('') : emptyHtml('Материальные расходы не добавлены');
  }

  function renderSettings() {
    document.querySelectorAll('[data-setting]').forEach(el => el.value = state.settings[el.dataset.setting] ?? '');
    document.querySelectorAll('[data-setting-check]').forEach(el => el.checked = !!state.settings[el.dataset.settingCheck]);
    document.getElementById('allocationMethod').value = state.settings.allocationMethod;
  }

  function renderContractControls() {
    document.getElementById('contractName').value = state.contract.name || '';
    document.getElementById('contractNumber').value = state.contract.number || '';
    document.getElementById('contractMonths').value = state.contract.months || 12;
    document.getElementById('priceMode').value = state.contract.priceMode;
    document.getElementById('manualPrice').value = state.contract.manualPrice || '';
    document.getElementById('manualIncludesVat').checked = !!state.contract.manualIncludesVat;
    document.querySelectorAll('.manual-price-row').forEach(el => el.classList.toggle('hidden', state.contract.priceMode !== 'manual'));
  }

  function emptyHtml(textValue) { return `<div class="form-card note-card"><p>${esc(textValue)}</p></div>`; }
  function text(id, v) { const el=document.getElementById(id); if(el) el.textContent=v; }

  function navigate(name) {
    document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('active', x.dataset.screen===name));
    document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active', x.dataset.nav===name));
    const titles={summary:'Рентабельность',posts:'Посты',costs:'Расходы',settings:'Параметры'}; text('screenTitle',titles[name]||'Рентабельность');
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function openPostSheet(postId = null) {
    const src = postId ? state.posts.find(x=>x.id===postId) : createPost();
    draftPost = JSON.parse(JSON.stringify(src));
    text('postSheetTitle', postId ? 'Изменить пост' : 'Новый пост');
    const schedule = document.getElementById('postSchedule');
    schedule.innerHTML = Object.entries(schedulePresets).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join('');
    fillPostDraft(); openSheet('postSheet');
  }
  function fillPostDraft() {
    const p=draftPost; if(!p) return;
    const map={postName:'name',postQuantity:'quantity',postCoverageHours:'coverageHours',postDaysPerMonth:'daysPerMonth',postSimultaneous:'simultaneous',postSchedule:'schedule',postShiftHours:'shiftHours',postEmployeeDays:'employeeDays',postRotations:'rotations',postWageMode:'wageMode',postHourlyNet:'hourlyNet',postDailyNet:'dailyNet',postFixedNet:'fixedNet',postEmployment:'employment',postCustomGross:'customGross',postMiscPerEmployee:'miscPerEmployee',postDirectExpense:'directExpense'};
    Object.entries(map).forEach(([id,key])=>{ const el=document.getElementById(id); if(el) el.value=p[key]??''; });
    updateWageRows(); updatePostPreview();
  }
  function readPostDraft() {
    const map={postName:'name',postQuantity:'quantity',postCoverageHours:'coverageHours',postDaysPerMonth:'daysPerMonth',postSimultaneous:'simultaneous',postSchedule:'schedule',postShiftHours:'shiftHours',postEmployeeDays:'employeeDays',postRotations:'rotations',postWageMode:'wageMode',postHourlyNet:'hourlyNet',postDailyNet:'dailyNet',postFixedNet:'fixedNet',postEmployment:'employment',postCustomGross:'customGross',postMiscPerEmployee:'miscPerEmployee',postDirectExpense:'directExpense'};
    Object.entries(map).forEach(([id,key])=>{ const el=document.getElementById(id); if(!el)return; draftPost[key] = ['name','schedule','wageMode','employment'].includes(key) ? el.value : num(el.value); });
  }
  function updatePostPreview(){ readPostDraft(); const c=calcPost(draftPost); const factor=c.factor; document.getElementById('postStaffPreview').innerHTML = `Коэффициент покрытия: <b>${number(factor,3)}</b> · людей в сутки: <b>${number(c.peoplePerDay,2)}</b> · расчётный штат: <b>${number(c.headcount,2)}</b> · на руки одному: <b>${rub(c.netMonthlyPerEmployee)}</b> / мес.`; }
  function updateWageRows(){ const mode=document.getElementById('postWageMode').value; document.querySelectorAll('.field-row.wage').forEach(x=>x.classList.add('hidden')); document.querySelectorAll(`.field-row.wage.${mode}`).forEach(x=>x.classList.remove('hidden')); }
  function applySchedulePreset(){ const key=document.getElementById('postSchedule').value; const p=schedulePresets[key]; if(!p || key==='custom') return; document.getElementById('postShiftHours').value=p.shiftHours; document.getElementById('postEmployeeDays').value=p.employeeDays; document.getElementById('postRotations').value=p.rotations; updatePostPreview(); }

  function openGeneric(type, item = null) {
    genericDraft = { type, data: item ? JSON.parse(JSON.stringify(item)) : (type==='shared'?createSharedStaff():type==='expense'?createMonthlyExpense():createMaterial()) };
    const d=genericDraft.data, body=document.getElementById('genericBody');
    if(type==='shared') { text('genericTitle',item?'Изменить сотрудника':'Общий персонал'); body.innerHTML=`<div class="form-card grouped"><label class="field-row"><span>Роль</span><input data-g="name" value="${esc(d.name)}"></label><label class="field-row"><span>Количество</span><input data-g="count" type="number" step="0.1" value="${num(d.count)}"></label><label class="field-row"><span>На руки / месяц</span><input data-g="netMonthly" type="number" step="1000" value="${num(d.netMonthly)}"></label><label class="field-row"><span>Оформление</span><select data-g="employment"><option value="partial">Официальная часть + доплата</option><option value="white">Полностью белая</option><option value="none">Без официальной части</option></select></label><label class="field-row"><span>Индив. gross</span><input data-g="customGross" type="number" step="1000" value="${num(d.customGross)}"></label><label class="field-row"><span>Прочие / сотрудника</span><input data-g="miscPerEmployee" type="number" step="100" value="${num(d.miscPerEmployee)}"></label></div>`; body.querySelector('[data-g="employment"]').value=d.employment; }
    if(type==='expense') { text('genericTitle',item?'Изменить расход':'Ежемесячный расход'); body.innerHTML=`<div class="form-card grouped"><label class="field-row"><span>Наименование</span><input data-g="name" value="${esc(d.name)}"></label><label class="field-row"><span>Сумма / месяц</span><input data-g="amount" type="number" step="100" value="${num(d.amount)}"></label></div>`; }
    if(type==='material') { text('genericTitle',item?'Изменить материал':'Материальный расход'); body.innerHTML=`<div class="form-card grouped"><label class="field-row"><span>Наименование</span><input data-g="name" value="${esc(d.name)}"></label><label class="field-row"><span>Количество</span><input data-g="quantity" type="number" step="0.1" value="${num(d.quantity)}"></label><label class="field-row"><span>Цена за 1 шт.</span><input data-g="unitPrice" type="number" step="100" value="${num(d.unitPrice)}"></label><label class="field-row"><span>Амортизация, мес.</span><input data-g="amortMonths" type="number" step="1" value="${num(d.amortMonths)}"></label><label class="field-row"><span>Марка / модель</span><input data-g="model" value="${esc(d.model||'')}"></label></div>`; }
    openSheet('genericSheet');
  }
  function saveGeneric() {
    const {type,data}=genericDraft; document.querySelectorAll('#genericBody [data-g]').forEach(el=>{ const key=el.dataset.g; data[key]=['name','employment','model'].includes(key)?el.value:num(el.value); });
    const key=type==='shared'?'sharedStaff':type==='expense'?'monthlyExpenses':'materials'; const arr=state[key]; const i=arr.findIndex(x=>x.id===data.id); if(i>=0)arr[i]=data; else arr.push(data); closeSheets(); scheduleSave(); render();
  }

  function openSheet(idName){ document.getElementById('sheetBackdrop').hidden=false; requestAnimationFrame(()=>{ const el=document.getElementById(idName); el.classList.add('open'); el.setAttribute('aria-hidden','false'); }); document.body.style.overflow='hidden'; }
  function closeSheets(){ document.querySelectorAll('.bottom-sheet').forEach(el=>{el.classList.remove('open');el.setAttribute('aria-hidden','true')}); setTimeout(()=>document.getElementById('sheetBackdrop').hidden=true,250); document.body.style.overflow=''; draftPost=null; genericDraft=null; }

  function removeFrom(key, itemId){ state[key]=state[key].filter(x=>x.id!==itemId); scheduleSave(); render(); }

  function toast(msg){ const el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),1800); }
  function exportJson(){ const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`rentability-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast('Экспорт готов'); }

  document.addEventListener('click', e => {
    const nav=e.target.closest('[data-nav]'); if(nav){navigate(nav.dataset.nav);return;}
    const editPost=e.target.closest('[data-edit-post]'); if(editPost){openPostSheet(editPost.dataset.editPost);return;}
    const delPost=e.target.closest('[data-delete-post]'); if(delPost){removeFrom('posts',delPost.dataset.deletePost);return;}
    const es=e.target.closest('[data-edit-shared]'); if(es){openGeneric('shared',state.sharedStaff.find(x=>x.id===es.dataset.editShared));return;}
    const ds=e.target.closest('[data-delete-shared]'); if(ds){removeFrom('sharedStaff',ds.dataset.deleteShared);return;}
    const ee=e.target.closest('[data-edit-expense]'); if(ee){openGeneric('expense',state.monthlyExpenses.find(x=>x.id===ee.dataset.editExpense));return;}
    const de=e.target.closest('[data-delete-expense]'); if(de){removeFrom('monthlyExpenses',de.dataset.deleteExpense);return;}
    const em=e.target.closest('[data-edit-material]'); if(em){openGeneric('material',state.materials.find(x=>x.id===em.dataset.editMaterial));return;}
    const dm=e.target.closest('[data-delete-material]'); if(dm){removeFrom('materials',dm.dataset.deleteMaterial);return;}
  });

  document.getElementById('btnAddPost').addEventListener('click',()=>openPostSheet());
  document.getElementById('btnCancelPost').addEventListener('click',closeSheets);
  document.getElementById('btnCancelGeneric').addEventListener('click',closeSheets);
  document.getElementById('sheetBackdrop').addEventListener('click',closeSheets);
  document.getElementById('btnSavePost').addEventListener('click',()=>{ readPostDraft(); if(!draftPost.name.trim()) draftPost.name='Пост'; const i=state.posts.findIndex(x=>x.id===draftPost.id); if(i>=0)state.posts[i]=draftPost; else state.posts.push(draftPost); closeSheets(); scheduleSave(); render(); });
  document.getElementById('btnSaveGeneric').addEventListener('click',saveGeneric);
  document.getElementById('btnAddSharedStaff').addEventListener('click',()=>openGeneric('shared'));
  document.getElementById('btnAddMonthlyExpense').addEventListener('click',()=>openGeneric('expense'));
  document.getElementById('btnAddMaterial').addEventListener('click',()=>openGeneric('material'));
  document.getElementById('btnExport').addEventListener('click',exportJson);

  ['postName','postQuantity','postCoverageHours','postDaysPerMonth','postSimultaneous','postShiftHours','postEmployeeDays','postRotations','postHourlyNet','postDailyNet','postFixedNet','postEmployment','postCustomGross','postMiscPerEmployee','postDirectExpense'].forEach(k=>document.getElementById(k).addEventListener('input',updatePostPreview));
  document.getElementById('postWageMode').addEventListener('change',()=>{updateWageRows();updatePostPreview();});
  document.getElementById('postSchedule').addEventListener('change',applySchedulePreset);

  document.getElementById('contractName').addEventListener('input',e=>{state.contract.name=e.target.value;scheduleSave();});
  document.getElementById('contractNumber').addEventListener('input',e=>{state.contract.number=e.target.value;scheduleSave();});
  document.getElementById('contractMonths').addEventListener('input',e=>{state.contract.months=Math.max(1,num(e.target.value,12));scheduleSave();render();});
  document.getElementById('priceMode').addEventListener('change',e=>{state.contract.priceMode=e.target.value;scheduleSave();render();});
  document.getElementById('manualPrice').addEventListener('input',e=>{state.contract.manualPrice=num(e.target.value);scheduleSave();render();});
  document.getElementById('manualIncludesVat').addEventListener('change',e=>{state.contract.manualIncludesVat=e.target.checked;scheduleSave();render();});

  document.querySelectorAll('[data-setting]').forEach(el=>el.addEventListener('input',e=>{state.settings[e.target.dataset.setting]=num(e.target.value);scheduleSave();render();}));
  document.querySelectorAll('[data-setting-check]').forEach(el=>el.addEventListener('change',e=>{state.settings[e.target.dataset.settingCheck]=e.target.checked;scheduleSave();render();}));
  document.getElementById('allocationMethod').addEventListener('change',e=>{state.settings.allocationMethod=e.target.value;scheduleSave();render();});

  document.getElementById('btnImport').addEventListener('click',()=>document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', async e=>{ const f=e.target.files?.[0]; if(!f)return; try{state=migrate(JSON.parse(await f.text()));save();render();toast('Данные импортированы');}catch{toast('Не удалось прочитать JSON');} e.target.value=''; });
  document.getElementById('btnReset').addEventListener('click',()=>{ if(confirm('Сбросить все локальные данные приложения?')){state=defaultState();save();render();toast('Данные сброшены');} });

  function updateNetwork(){ const online=navigator.onLine; document.getElementById('offlineDot').style.background=online?'var(--green)':'var(--orange)'; text('offlineLabel',online?'Локальный расчёт · сеть есть':'Офлайн · расчёт работает'); }
  addEventListener('online',updateNetwork); addEventListener('offline',updateNetwork); updateNetwork();

  if ('serviceWorker' in navigator) addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  render();
})();
