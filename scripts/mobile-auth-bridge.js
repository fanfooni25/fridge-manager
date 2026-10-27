import { App } from '@capacitor/app';

let lastUrl = '';
const emitUrl = (url) => {
  if (!url || url === lastUrl) return;
  lastUrl = url;
  window.dispatchEvent(new CustomEvent('fridge-native-auth-url', { detail: url }));
};

App.addListener('appUrlOpen', ({ url }) => emitUrl(url));
window.fridgeNativeLaunchUrlPromise = App.getLaunchUrl()
  .then((launch) => launch?.url || null)
  .catch(() => null);
