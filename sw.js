// CourtSense service worker: PUSH NOTIFICATIONS ONLY.
//
// This file deliberately has NO fetch handler and uses NO Cache Storage. Every page
// on courtsense.app is served straight from the network exactly as it was before
// this worker existed, so the ?v= cache-buster stamps on app.js, kotb-app.js and the
// rest keep working and a deploy is visible on the next reload. A caching service
// worker would pin old copies of those scripts on players' phones; do not add one
// here without a plan for versioning and cleanup.
//
// What it does:
//   install / activate   take over immediately, so a fixed version replaces a broken
//                        one on the next page load instead of waiting for every tab
//                        to close.
//   push                 show the alert the worker sent: JSON {title, body, url, tag}.
//   notificationclick    focus a CourtSense tab already on that page, or open it.
//                        Only same-origin links are followed; anything else opens /.

self.addEventListener('install', function(){
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event){
  var d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch(e){ d = { body: event.data ? event.data.text() : '' }; }
  var title = (d && typeof d.title === 'string' && d.title) ? d.title : 'CourtSense';
  var opts = {
    body: (d && typeof d.body === 'string') ? d.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: (d && typeof d.url === 'string') ? d.url : '/' }
  };
  if(d && typeof d.tag === 'string' && d.tag) opts.tag = d.tag;
  event.waitUntil(self.registration.showNotification(title, opts));
});

function sameOriginUrl(raw){
  try {
    var u = new URL(raw || '/', self.location.origin);
    return u.origin === self.location.origin ? u.href : self.location.origin + '/';
  } catch(e){
    return self.location.origin + '/';
  }
}

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var target = sameOriginUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      for(var i = 0; i < list.length; i++){
        var c = list[i];
        if(c.url === target && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : null;
    })
  );
});
