const CACHE='ugr-pwa-shell-v13-push';
const SHELL=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/favicon.png','./icons/icon-192-maskable.png','./icons/icon-512-maskable.png','./ugr-chat-wallpaper.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
 const u=new URL(event.request.url);
 // Never cache Supabase/API/auth traffic: messages and sessions must stay live.
 if(event.request.method!=='GET' || u.hostname.endsWith('supabase.co') || u.hostname.includes('jsdelivr.net')) return;
 if(u.origin===location.origin) event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request)));
});

self.addEventListener('push',event=>{
 let data={};try{data=event.data?event.data.json():{}}catch(_){}
 const title=data.title||'UGR MESSENGER';
 const options={body:data.body||'Вам пришло сообщение! Откройте UGR, чтобы посмотреть.',icon:'./icons/icon-192.png',badge:'./icons/icon-192.png',tag:'ugr-new-message',renotify:false,data:{url:data.url||'/ugr-messenger/'},vibrate:[120,60,120]};
 event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const rawTarget=event.notification.data?.url||'/ugr-messenger/';
 const target=new URL(rawTarget==='.'||rawTarget==='./'?'/ugr-messenger/':rawTarget,self.location.origin).href;
 event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
  for(const client of list){if(new URL(client.url).origin===self.location.origin){client.focus();return client.navigate(target)}}
  return clients.openWindow(target);
 }));
});
