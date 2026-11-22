const CACHE='ugr-pwa-shell-v8';
const SHELL=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./ugr-chat-wallpaper.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
 const u=new URL(event.request.url);
 // Never cache Supabase/API/auth traffic: messages and sessions must stay live.
 if(event.request.method!=='GET' || u.hostname.endsWith('supabase.co') || u.hostname.includes('jsdelivr.net')) return;
 if(u.origin===location.origin) event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request)));
});
