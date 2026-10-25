    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('gesturechange', function (e) { e.preventDefault(); });
    const APP_VERSION='1.9';
    $('app-version').textContent=APP_VERSION;
    const installButton=$('pwa-install-button'),installStatus=$('pwa-install-status'),installHelp=$('pwa-install-help'),installInstructions=$('pwa-install-instructions');
    let deferredInstallPrompt=null,swRegistration=null;
    const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
    const isAppleMobile=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    function updateInstallState(){
      if(isStandalone()){installStatus.textContent='已安装，可从主屏幕或应用列表打开。';installButton.hidden=true;installHelp.hidden=true;return}
      installButton.hidden=false;installHelp.hidden=false;
      if(!window.isSecureContext||location.protocol==='file:'){
        installStatus.textContent='请通过 HTTPS 网站访问后再安装；直接打开本地文件不支持离线应用功能。';installButton.disabled=true;
        installInstructions.textContent='将应用部署到 HTTPS 网站后，在浏览器菜单中选择“安装应用”或“添加到主屏幕”。';return;
      }
      installButton.disabled=false;
      if(deferredInstallPrompt){installStatus.textContent='可以将冰箱小管家安装到设备，之后可从主屏幕或应用列表快速打开。';installButton.textContent='安装到设备';}
      else if(isAppleMobile()){
        installStatus.textContent='iPhone 或 iPad 请使用 Safari 添加到主屏幕。';installButton.textContent='查看安装方法';
        installInstructions.textContent='在 Safari 中点“分享”按钮，再选择“添加到主屏幕”，最后点“添加”。';
      }else{
        installStatus.textContent='支持安装的浏览器会提供一键安装；也可使用浏览器菜单手动添加。';installButton.textContent='查看安装方法';
        installInstructions.textContent='在浏览器菜单中选择“安装冰箱小管家”“安装应用”或“添加到主屏幕”。如果没有此选项，请先通过 HTTPS 网站打开，并使用最新版 Chrome、Edge 或 Safari。';
      }
    }
    window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;updateInstallState()});
    window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;updateInstallState();installStatus.textContent='安装完成，可从主屏幕或应用列表打开。'});
    installButton.addEventListener('click',async()=>{
      if(deferredInstallPrompt){const prompt=deferredInstallPrompt;deferredInstallPrompt=null;await prompt.prompt();await prompt.userChoice;updateInstallState();return}
      installHelp.open=true;
    });
    updateInstallState();
    const offlineBanner=$('pwa-offline-banner');
    const updateOfflineState=()=>{offlineBanner.hidden=navigator.onLine};
    window.addEventListener('online',updateOfflineState);window.addEventListener('offline',updateOfflineState);updateOfflineState();
    const launchView=new URLSearchParams(location.search).get('view');
    if(launchView==='add-food')showView('add-food');
    if('serviceWorker' in navigator){
      window.addEventListener('load',async()=>{
        try{
          let hadController=!!navigator.serviceWorker.controller,refreshing=false;
          swRegistration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
          const notice=$('update-notice'),updateButton=$('update-apply');
          const showUpdate=()=>{$('update-version').textContent=`v${APP_VERSION}`;notice.hidden=false};
          const watchInstall=worker=>{
            if(!worker)return;
            worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdate()});
          };
          swRegistration.addEventListener('updatefound',()=>watchInstall(swRegistration.installing));
          if(swRegistration.waiting&&navigator.serviceWorker.controller)showUpdate();
          updateButton.addEventListener('click',async()=>{
            updateButton.disabled=true;updateButton.textContent='正在检查…';
            try{
              if(swRegistration.waiting){updateButton.textContent='正在更新…';swRegistration.waiting.postMessage({type:'SKIP_WAITING'});return}
              await swRegistration.update();
              if(swRegistration.waiting){updateButton.textContent='正在更新…';swRegistration.waiting.postMessage({type:'SKIP_WAITING'})}
              else{updateButton.disabled=false;updateButton.textContent='立即更新';}
            }catch{updateButton.disabled=false;updateButton.textContent='立即更新'}
          });
          $('update-later').addEventListener('click',()=>{notice.hidden=true});
          navigator.serviceWorker.addEventListener('controllerchange',()=>{
            if(!hadController){hadController=true;return}
            if(refreshing)return;refreshing=true;window.location.reload();
          });
          const checkForUpdate=()=>{if(swRegistration&&navigator.onLine)swRegistration.update().catch(()=>{})};
          window.addEventListener('online',checkForUpdate);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkForUpdate()});
          checkForUpdate();
        }catch{
          if(!window.isSecureContext||location.protocol==='file:')installStatus.textContent='安装和离线功能需要通过 HTTPS 网站访问。';
          else installStatus.textContent='离线资源准备失败，请保持网络连接并刷新页面重试。';
        }
      });
    }else{
      installStatus.textContent='此浏览器不支持离线应用；仍可将网页加入书签。';installButton.hidden=true;
    }
