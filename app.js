(()=>{
  document.documentElement.dataset.platform='ios27';
  document.querySelectorAll('input.ios-switch').forEach(el=>el.setAttribute('switch',''));
  (async()=>{
    try{
      await import('./app-v2.js?v=110');
      await import('./enhancements-v1.js?v=110');
    }catch(err){
      console.error('AlterNative iOS 27 runtime failed',err);
    }
  })();
})();
