const CACHE_NAME='gnem-departments-v1';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Network-first assets only. Never serve a cached slurry page as a slitting fallback.
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||!new URL(event.request.url).pathname.startsWith('/static/'))return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok)caches.open(CACHE_NAME).then(cache=>cache.put(event.request,response.clone()));return response;}).catch(()=>caches.match(event.request)));
});
