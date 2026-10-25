    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('gesturechange', function (e) { e.preventDefault(); });
    const APP_VERSION='1.5';
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', async function () {
        try {
          const registration=await navigator.serviceWorker.register('sw.js',{updateViaCache:'none'});
          const notice=$('update-notice');
          const showUpdate=()=>{ $('update-version').textContent=`v${APP_VERSION}`; notice.hidden=false; };
          registration.addEventListener('updatefound',()=>{
            const installing=registration.installing;
            if(!installing)return;
            installing.addEventListener('statechange',()=>{
              if(installing.state==='installed'&&navigator.serviceWorker.controller)showUpdate();
            });
          });
          if(registration.waiting&&navigator.serviceWorker.controller)showUpdate();
          $('update-apply').addEventListener('click',()=>{
            if(registration.waiting)registration.waiting.postMessage({type:'SKIP_WAITING'});
            else registration.update().catch(()=>{});
          });
          $('update-later').addEventListener('click',()=>{notice.hidden=true;});
          let refreshing=false;
          navigator.serviceWorker.addEventListener('controllerchange',()=>{
            if(refreshing)return;
            refreshing=true;
            window.location.reload();
          });
          registration.update().catch(()=>{});
        } catch (_) {}
      });
    }
