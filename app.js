(()=>{
  document.documentElement.dataset.platform='ios27';
  document.querySelectorAll('input.ios-switch').forEach(el=>el.setAttribute('switch',''));
  import('./app-v2.js?v=2701').catch(err=>{
    console.error('AlterNative iOS 27 runtime failed',err);
  });
})();
