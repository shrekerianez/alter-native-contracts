(()=>{
  'use strict';

  const STORAGE_KEY='alternative-rentability-v1';
  const APP_VERSION='1.1.0';
  const APP_BUILD='14';
  const SCHEDULES={
    shift16:{label:'Вахта 16/8',h:16,d:15.25,r:2},
    shift12:{label:'Вахта 12/12',h:12,d:15.25,r:2},
    shift14:{label:'Вахта 14/10',h:14,d:15.25,r:2},
    fiveTwo:{label:'Будни 5/2',h:8,d:20.67,r:1},
    day13:{label:'Сутки 1/3',h:24,d:7.67,r:4,f:1},
    day12:{label:'Сутки 1/2',h:24,d:10.17,r:3,f:1},
    shift2x2:{label:'Смены 2/2 по 12 ч',h:12,d:15.25,r:2},
    custom:{label:'Свой график',h:12,d:15.25,r:2}
  };

  const n=(v,d=0)=>{const x=Number(String(v??'').replace(',','.'));return Number.isFinite(x)?x:d};
  const pc=v=>n(v)/100;
  const cl=(v,a,b)=>Math.min(b,Math.max(a,v));
  const rub=(v,d=0)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:d}).format(Number.isFinite(v)?v:0);
  const fmt=(v,d=2)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:d}).format(Number.isFinite(v)?v:0);
  const esc=s=>String(s??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));

  function state(){
    try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')||{}}catch{return {}}
  }

  function settings(S){
    return {
      ndfl:13,usn:6,vatEnabled:true,vat:5,mrot:27093,salaryGrossBase:45000,agentPercent:12,
      insuranceBase:30,insuranceAbove:15,accident:.2,vacationSalaryPart:.5,daysPerMonth:30.5,
      overhead:5,profitMarkup:10,allocationMethod:'payroll',
      ...(S.settings||{})
    };
  }

  function contract(S){return {months:12,daysOverride:null,priceMode:'calculated',manualPrice:0,manualIncludesVat:true,...(S.contract||{})}}
  function calcDays(S){const C=contract(S),s=settings(S);return n(C.daysOverride)>0?n(C.daysOverride):n(s.daysPerMonth,30.5)}
  function insurance(base,s){const t=n(s.mrot)*1.5;return Math.min(base,t)*pc(s.insuranceBase)+Math.max(0,base-t)*pc(s.insuranceAbove)}

  function wage(net,employment,gross,misc,s){
    const tax=cl(pc(s.ndfl),0,.99),em=employment!=='none',white=employment==='white';
    let g=0;
    if(em)g=white?net/(1-tax):(n(gross)>0?n(gross):n(s.salaryGrossBase));
    const card=em?g*(1-tax):0;
    const extra=white?0:(em?Math.max(0,net-card):net);
    const ar=cl(pc(s.agentPercent),0,.999);
    const order=extra>0?extra/(1-ar):0;
    const agent=Math.max(0,order-extra);
    const ins=em?insurance(g,s):0;
    const acc=em?g*pc(s.accident):0;
    const vg=em?g*n(s.vacationSalaryPart)/12:0;
    const vac=vg+(em?insurance(vg,s):0)+(em?vg*pc(s.accident):0);
    const other=n(misc);
    return {net,gross:g,card,extra,agent,ins,acc,vac,misc:other,total:g+extra+agent+ins+acc+vac+other};
  }

  function coverage(p){return p.coverageMode==='round'?24:(p.coverageMode==='day'||p.coverageMode==='night'?12:cl(n(p.coverageHours,12),1,24))}
  function staffHours(p){
    const h=coverage(p);
    if(p.staffingMode!=='split')return h*Math.max(0,n(p.simultaneous,1));
    if(p.coverageMode==='round')return 12*Math.max(0,n(p.dayCount,1))+12*Math.max(0,n(p.nightCount,1));
    if(p.coverageMode==='day')return h*Math.max(0,n(p.dayCount,1));
    if(p.coverageMode==='night')return h*Math.max(0,n(p.nightCount,1));
    return h*Math.max(0,n(p.simultaneous,1));
  }

  function postCalc(p,S){
    const s=settings(S),q=Math.max(0,n(p.quantity,1)),pr=SCHEDULES[p.schedule]||SCHEDULES.custom;
    const sh=p.schedule==='custom'?Math.max(.01,n(p.shiftHours,12)):pr.h;
    const rot=pr.f?pr.r:Math.max(1,n(p.rotations,pr.r||2));
    const ch=coverage(p),sd=staffHours(p),factor=sd/sh,people=q*factor,head=people*rot;
    let net=0;
    if(p.wageMode==='fixed')net=n(p.fixedNet);
    else if(p.wageMode==='daily')net=n(p.dailyNet)*n(p.employeeDays);
    else if(p.wageMode==='shift')net=n(p.shiftNet)*n(p.employeeDays);
    else net=n(p.hourlyNet)*sh*n(p.employeeDays);
    const unit=wage(net,p.employment,p.customGross,p.miscPerEmployee,s);
    const personnel=unit.total*head;
    const direct=personnel+n(p.directExpense);
    const days=calcDays(S);
    const requiredHours=sd*days*q;
    const availableHours=head*sh*n(p.employeeDays);
    return {...p,q,shiftHours:sh,rotations:rot,coverageHours:ch,staffHoursDay:sd,factor,peoplePerDay:people,headcount:head,
      netMonthlyPerEmployee:net,unit,personnelCost:personnel,directCost:direct,hoursMonth:q*ch*days,daysPerMonth:days,
      netPayroll:net*head,requiredHours,availableHours};
  }

  function calculate(S){
    const s=settings(S),C=contract(S);
    let posts=(Array.isArray(S.posts)?S.posts:[]).map(p=>postCalc(p,S));
    const shared=(Array.isArray(S.sharedStaff)?S.sharedStaff:[]).map(x=>{
      const unit=wage(n(x.netMonthly),x.employment,x.customGross,x.miscPerEmployee,s);
      return {...x,unit,total:unit.total*Math.max(0,n(x.count))};
    });
    const postDirect=posts.reduce((a,x)=>a+x.directCost,0);
    const sharedStaffCost=shared.reduce((a,x)=>a+x.total,0);
    const monthlyExpenseCost=(Array.isArray(S.monthlyExpenses)?S.monthlyExpenses:[]).reduce((a,x)=>a+n(x.amount),0);
    const materials=(Array.isArray(S.materials)?S.materials:[]).map(x=>({...x,monthly:n(x.amortMonths)>0?n(x.quantity)*n(x.unitPrice)/n(x.amortMonths):0}));
    const materialCost=materials.reduce((a,x)=>a+x.monthly,0);
    const pool=sharedStaffCost+monthlyExpenseCost+materialCost;
    const direct=postDirect+pool;
    const overhead=direct*pc(s.overhead);
    const cost=direct+overhead;
    const target=cost*pc(s.profitMarkup);
    const ur=cl(pc(s.usn),0,.99),vr=s.vatEnabled?Math.max(0,pc(s.vat)):0;
    const auto=(cost+target)/(1-ur);
    let rev=auto,withVat=auto*(1+vr);
    if(C.priceMode==='manual'&&n(C.manualPrice)>0){
      if(C.manualIncludesVat&&vr>0){withVat=n(C.manualPrice);rev=withVat/(1+vr)}
      else{rev=n(C.manualPrice);withVat=rev*(1+vr)}
    }
    const usn=rev*ur,profit=rev-usn-cost,margin=rev?profit/rev:0,roi=cost?profit/cost:0,breakEven=cost/(1-ur),vat=withVat-rev;
    let weights=posts.map(p=>s.allocationMethod==='posts'?p.q:s.allocationMethod==='hours'?p.hoursMonth:p.personnelCost);
    let totalWeight=weights.reduce((a,x)=>a+x,0);
    if(totalWeight<=0){weights=posts.map(p=>p.q||1);totalWeight=weights.reduce((a,x)=>a+x,0)||1}
    posts=posts.map((p,i)=>{
      const share=weights[i]/totalWeight;
      return {...p,share,
        allocatedShared:pool*share,
        allocatedOverhead:overhead*share,
        allocatedUsn:usn*share,
        allocatedProfit:profit*share,
        allocatedVat:vat*share,
        allocatedRevenue:rev*share,
        allocatedWithVat:withVat*share,
        allocatedCost:p.directCost+pool*share+overhead*share,
        pricePerPost:p.q?rev*share/p.q:0,
        pricePerHour:p.hoursMonth?rev*share/p.hoursMonth:0
      };
    });
    return {S,s,C,posts,materials,pool,overhead,cost,rev,withVat,vat,usn,profit,margin,roi,breakEven};
  }

  function overallWarnings(c){
    const out=[];
    if(!c.posts.length)out.push({level:'info',title:'Нет постов',text:'Добавьте хотя бы один пост, иначе считать пока особенно нечего.'});
    if(c.profit<0)out.push({level:'danger',title:'Убыточный расчёт',text:`При текущей цене убыток составляет ${rub(Math.abs(c.profit))} в месяц.`});
    else if(c.rev>0&&c.rev<c.breakEven)out.push({level:'danger',title:'Цена ниже точки безубыточности',text:`Для нулевой прибыли нужно минимум ${rub(c.breakEven)} без НДС.`});
    c.materials.forEach(m=>{if(n(m.amortMonths)>0&&n(m.amortMonths)<n(c.C.months,12))out.push({level:'warning',title:'Амортизация короче договора',text:`${m.name||'Материал'}: ${fmt(n(m.amortMonths))} мес. при договоре ${fmt(n(c.C.months,12))} мес.`})});
    c.posts.forEach(p=>{
      if(p.netMonthlyPerEmployee<=0)out.push({level:'warning',title:`${p.name||'Пост'}: не задана оплата`,text:'Расчёт себестоимости персонала будет занижен.'});
      if(p.requiredHours>0){
        const diff=Math.abs(p.availableHours-p.requiredHours)/p.requiredHours;
        if(diff>.02)out.push({level:'warning',title:`${p.name||'Пост'}: график не покрывает часы`,text:`Нужно ${fmt(p.requiredHours,1)} чел·ч/мес., график даёт ${fmt(p.availableHours,1)} чел·ч/мес.`});
      }
    });
    return out.slice(0,6);
  }

  function injectStyles(){
    if(document.getElementById('an-enhancement-css'))return;
    const st=document.createElement('style');
    st.id='an-enhancement-css';
    st.textContent=`
      .an-warning-group{margin-top:18px}.an-warning-list{display:flex;flex-direction:column;gap:8px}.an-warning{background:var(--surface-solid);border-radius:14px;padding:12px 14px;display:flex;gap:10px;align-items:flex-start}.an-warning-dot{width:9px;height:9px;border-radius:50%;margin-top:5px;flex:0 0 auto}.an-warning.warning .an-warning-dot{background:var(--orange)}.an-warning.danger .an-warning-dot{background:var(--red)}.an-warning.info .an-warning-dot{background:var(--accent)}.an-warning strong{display:block;font-size:14px;line-height:19px}.an-warning p{margin:2px 0 0;color:var(--secondary);font-size:12px;line-height:17px}.an-kpi-roi{display:none}.kpi-grid .an-kpi-roi{display:block}.an-detail-overlay{position:fixed;inset:0;z-index:120;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.34);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}.an-detail-sheet{width:min(100%,620px);max-height:min(88dvh,900px);background:var(--bg);border-radius:26px 26px 0 0;overflow:hidden;box-shadow:0 -14px 44px rgba(0,0,0,.22);padding-bottom:env(safe-area-inset-bottom)}.an-detail-head{height:56px;display:grid;grid-template-columns:72px 1fr 72px;align-items:center;padding:0 10px;background:var(--nav-material);-webkit-backdrop-filter:saturate(180%) blur(26px);backdrop-filter:saturate(180%) blur(26px);border-bottom:.5px solid var(--separator)}.an-detail-head strong{text-align:center;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.an-detail-close{justify-self:end;border:0;background:transparent;color:var(--accent);font-size:16px;min-width:44px;min-height:44px}.an-detail-body{max-height:calc(min(88dvh,900px) - 56px - env(safe-area-inset-bottom));overflow:auto;-webkit-overflow-scrolling:touch;padding:14px 16px 28px}.an-detail-group{margin-top:18px}.an-detail-group:first-child{margin-top:0}.an-detail-title{font-size:13px;color:var(--secondary);padding:0 12px 7px}.an-detail-card{background:var(--surface-solid);border-radius:14px;overflow:hidden}.an-detail-row{position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:10px 14px;min-height:44px}.an-detail-row:not(:last-child)::after{content:'';position:absolute;left:14px;right:0;bottom:0;height:.5px;background:var(--separator)}.an-detail-row span{color:var(--secondary);font-size:14px;line-height:19px}.an-detail-row strong{text-align:right;font-size:14px;line-height:19px;font-variant-numeric:tabular-nums}.an-detail-row.total span,.an-detail-row.total strong{color:var(--text);font-weight:700}.an-detail-note{margin-top:10px;padding:11px 13px;border-radius:12px;background:rgba(255,149,0,.11);color:var(--secondary);font-size:12px;line-height:17px}.mini-button.calc{color:var(--accent)}@media(prefers-reduced-motion:reduce){.an-detail-overlay,.an-detail-sheet{animation:none!important;transition:none!important}}
    `;
    document.head.appendChild(st);
  }

  function ensureAbout(){
    const settingsScreen=document.querySelector('[data-screen="settings"] .content');
    if(!settingsScreen)return;
    const groups=[...settingsScreen.querySelectorAll('.group')];
    const about=groups.find(g=>g.querySelector('.group-title')?.textContent.trim()==='О приложении');
    if(about){
      const card=about.querySelector('.form-card');
      if(card){
        card.innerHTML=`<div class="field-row"><span>Версия</span><strong>${APP_VERSION}</strong></div><div class="field-row"><span>Сборка</span><strong>${APP_BUILD}</strong></div><div class="field-row"><span>Платформа</span><strong>iOS 27 · WebKit</strong></div>`;
      }
    }
  }

  function ensureROI(){
    const grid=document.querySelector('[data-screen="summary"] .kpi-grid');
    if(!grid||grid.querySelector('#kpiRoi'))return;
    const card=document.createElement('article');
    card.className='kpi-card an-kpi-roi';
    card.innerHTML='<span>Рентабельность затрат</span><strong id="kpiRoi">0%</strong><small>прибыль / себестоимость</small>';
    grid.appendChild(card);
  }

  function ensureWarningsContainer(){
    const content=document.querySelector('[data-screen="summary"] .content');
    if(!content||content.querySelector('#anWarnings'))return;
    const structure=[...content.querySelectorAll('.group')].find(g=>g.querySelector('.group-title')?.textContent.trim()==='Структура цены');
    const section=document.createElement('section');
    section.className='group an-warning-group';
    section.id='anWarnings';
    section.innerHTML='<div class="group-title">Проверка расчёта</div><div class="an-warning-list" id="anWarningList"></div>';
    if(structure)content.insertBefore(section,structure);else content.appendChild(section);
  }

  function decoratePostCards(){
    document.querySelectorAll('.post-card').forEach(card=>{
      const edit=card.querySelector('[data-edit-post]');
      if(!edit)return;
      const id=edit.dataset.editPost;
      const actions=edit.parentElement;
      if(actions&&!actions.querySelector('[data-detail-post]')){
        const b=document.createElement('button');
        b.className='mini-button calc';
        b.textContent='Расчёт';
        b.dataset.detailPost=id;
        actions.prepend(b);
      }
    });
  }

  function renderEnhancements(){
    ensureAbout();ensureROI();ensureWarningsContainer();decoratePostCards();
    const c=calculate(state());
    const roi=document.getElementById('kpiRoi');
    if(roi)roi.textContent=`${fmt(c.roi*100,1)}%`;
    const list=document.getElementById('anWarningList');
    if(list){
      const w=overallWarnings(c);
      list.innerHTML=w.length?w.map(x=>`<div class="an-warning ${x.level}"><span class="an-warning-dot"></span><div><strong>${esc(x.title)}</strong><p>${esc(x.text)}</p></div></div>`).join(''):'<div class="an-warning info"><span class="an-warning-dot"></span><div><strong>Расчёт выглядит согласованно</strong><p>Критических несоответствий по текущим данным не найдено.</p></div></div>';
    }
  }

  function detailRows(rows){return `<div class="an-detail-card">${rows.map(r=>`<div class="an-detail-row ${r.total?'total':''}"><span>${esc(r.label)}</span><strong>${r.value}</strong></div>`).join('')}</div>`}

  function openDetail(id){
    const c=calculate(state());
    const p=c.posts.find(x=>String(x.id)===String(id));
    if(!p)return;
    const coverageDiff=p.requiredHours>0?(p.availableHours-p.requiredHours)/p.requiredHours:0;
    const staffingNote=Math.abs(coverageDiff)>.02?`График даёт ${fmt(p.availableHours,1)} чел·ч в месяц при потребности ${fmt(p.requiredHours,1)} чел·ч. Проверьте график, дни и ротации.`:'';
    const margin=p.allocatedRevenue?p.allocatedProfit/p.allocatedRevenue:0;
    const roi=p.allocatedCost?p.allocatedProfit/p.allocatedCost:0;
    const q=Math.max(1,p.q||1);
    const html=`<div class="an-detail-overlay" id="anDetailOverlay" role="dialog" aria-modal="true" aria-label="Расчёт поста">
      <section class="an-detail-sheet">
        <div class="an-detail-head"><span></span><strong>${esc(p.name||'Пост')}</strong><button class="an-detail-close" id="anDetailClose">Готово</button></div>
        <div class="an-detail-body">
          <div class="an-detail-group"><div class="an-detail-title">Потребность в персонале</div>${detailRows([
            {label:'Количество постов',value:fmt(p.q,0)},
            {label:'Работа поста',value:`${fmt(p.coverageHours,1)} ч/сутки`},
            {label:'Смена',value:`${fmt(p.shiftHours,1)} ч`},
            {label:'Рабочих дней сотрудника',value:fmt(n(p.employeeDays),2)},
            {label:'Ротаций',value:fmt(p.rotations,0)},
            {label:'Потребность',value:`${fmt(p.requiredHours,1)} чел·ч/мес.`},
            {label:'Ресурс графика',value:`${fmt(p.availableHours,1)} чел·ч/мес.`},
            {label:'Расчётный штат',value:`${fmt(p.headcount,2)} чел.`,total:true}
          ])}${staffingNote?`<div class="an-detail-note">${esc(staffingNote)}</div>`:''}</div>

          <div class="an-detail-group"><div class="an-detail-title">Один сотрудник / месяц</div>${detailRows([
            {label:'Целевая сумма на руки',value:rub(p.unit.net)},
            {label:'Официальный gross',value:rub(p.unit.gross)},
            {label:'На карту после НДФЛ',value:rub(p.unit.card)},
            {label:'Доплата',value:rub(p.unit.extra)},
            {label:'Комиссия агента',value:rub(p.unit.agent)},
            {label:'Страховые взносы',value:rub(p.unit.ins)},
            {label:'НС/ПЗ',value:rub(p.unit.acc)},
            {label:'Отпускной резерв',value:rub(p.unit.vac)},
            {label:'Прочие расходы',value:rub(p.unit.misc)},
            {label:'Стоимость сотрудника',value:rub(p.unit.total),total:true}
          ])}</div>

          <div class="an-detail-group"><div class="an-detail-title">Посты / месяц</div>${detailRows([
            {label:'ФОТ на руки',value:rub(p.netPayroll)},
            {label:'Стоимость персонала',value:rub(p.personnelCost)},
            {label:'Прямые расходы поста',value:rub(n(p.directExpense))},
            {label:'Доля общих расходов',value:rub(p.allocatedShared)},
            {label:'Доля накладных',value:rub(p.allocatedOverhead)},
            {label:'Себестоимость',value:rub(p.allocatedCost),total:true},
            {label:'УСН',value:rub(p.allocatedUsn)},
            {label:'Прибыль',value:rub(p.allocatedProfit)},
            {label:'Цена без НДС',value:rub(p.allocatedRevenue),total:true},
            {label:'НДС',value:rub(p.allocatedVat)},
            {label:'К оплате с НДС',value:rub(p.allocatedWithVat),total:true},
            {label:'Цена одного поста без НДС',value:rub(p.allocatedRevenue/q)}
          ])}</div>

          <div class="an-detail-group"><div class="an-detail-title">Показатели</div>${detailRows([
            {label:'Маржа',value:`${fmt(margin*100,1)}%`},
            {label:'Рентабельность затрат',value:`${fmt(roi*100,1)}%`},
            {label:'Цена за час',value:rub(p.pricePerHour,2)},
            {label:'Доля в договоре',value:`${fmt(p.share*100,1)}%`}
          ])}</div>
        </div>
      </section>
    </div>`;
    document.getElementById('anDetailOverlay')?.remove();
    document.body.insertAdjacentHTML('beforeend',html);
    document.body.style.overflow='hidden';
    const close=()=>{document.getElementById('anDetailOverlay')?.remove();document.body.style.overflow=''};
    document.getElementById('anDetailClose').onclick=close;
    document.getElementById('anDetailOverlay').addEventListener('click',e=>{if(e.target.id==='anDetailOverlay')close()});
  }

  let scheduled;
  function scheduleRender(){clearTimeout(scheduled);scheduled=setTimeout(renderEnhancements,190)}

  injectStyles();
  document.addEventListener('click',e=>{const b=e.target.closest('[data-detail-post]');if(b){e.preventDefault();openDetail(b.dataset.detailPost)}});
  document.addEventListener('input',scheduleRender,true);
  document.addEventListener('change',scheduleRender,true);
  const observer=new MutationObserver(scheduleRender);
  observer.observe(document.body,{subtree:true,childList:true});
  setTimeout(renderEnhancements,350);
})();
