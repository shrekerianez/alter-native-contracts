(()=>{
  'use strict';
  const key='alternative-app-picker-seen-v1';
  const header=document.querySelector('.topbar');
  if(!header||document.getElementById('anPickerCover'))return;
  const trigger=document.createElement('button');
  trigger.type='button';trigger.className='an-picker-trigger';trigger.textContent='Выбор';trigger.setAttribute('aria-label','Выбрать калькулятор');
  header.appendChild(trigger);
  const cover=document.createElement('div');
  cover.className='an-picker-cover';cover.id='anPickerCover';cover.hidden=true;
  cover.innerHTML=`<section class="an-picker-panel" role="dialog" aria-modal="true" aria-labelledby="anPickerTitle">
    <p class="an-picker-kicker">AlterNative Studio</p>
    <h2 class="an-picker-title" id="anPickerTitle">Выбери калькулятор</h2>
    <p class="an-picker-intro">Два независимых варианта расчёта рентабельности договора.</p>
    <button class="an-picker-option" type="button" id="anChooseNative"><span><strong>AlterNative</strong><small>Наша PWA · iOS 27 · рабочая версия</small></span><span class="an-picker-chevron">›</span></button>
    <a class="an-picker-option" id="anChooseGemini" href="./gemini/"><span><strong>Gemini</strong><small>Исходный вариант · ожидает исправления ошибок</small></span><span class="an-picker-chevron">›</span></a>
    <p class="an-picker-disclaimer">Расчёты хранятся отдельно. Исходный код Gemini не изменён.</p>
    <button class="an-picker-cancel" type="button" id="anClosePicker">Закрыть</button>
  </section>`;
  document.body.appendChild(cover);
  const close=()=>{cover.hidden=true;document.body.style.removeProperty('overflow');trigger.focus({preventScroll:true});};
  const open=()=>{cover.hidden=false;document.body.style.overflow='hidden';document.getElementById('anChooseNative')?.focus({preventScroll:true});};
  trigger.addEventListener('click',open);
  document.getElementById('anChooseNative').addEventListener('click',()=>{try{localStorage.setItem(key,'1')}catch{}close()});
  document.getElementById('anChooseGemini').addEventListener('click',()=>{try{localStorage.setItem(key,'1')}catch{}});
  document.getElementById('anClosePicker').addEventListener('click',close);
  cover.addEventListener('click',event=>{if(event.target===cover)close()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!cover.hidden)close()});
  let seen=false;try{seen=!!localStorage.getItem(key)}catch{}
  const force=new URLSearchParams(location.search).has('choose');
  if(force||!seen)open();
})();