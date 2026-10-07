/* يخزّن ملفات التطبيق للعمل بدون إنترنت. لا يلمس كلمات المستخدم أبدًا لأنها في localStorage وليست في الكاش.
   يجلب النسخة الأحدث أولًا عند وجود إنترنت حتى تظهر التحديثات فورًا. غيّر رقم VERSION عند كل إصدار. */
const VERSION = 'words-v4';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'wb-notify').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});

/* ---------- التذكير اليومي (Periodic Background Sync على أندرويد) ----------
   الصفحة تحفظ بيانات صغيرة في كاش wb-notify، ويقرأها هنا ليبني نص الإشعار وقت إرساله. */
const NOTIFY_URL = () => new URL('__notify.json', self.registration.scope).href;
const DAY_MS = 86400000;
const dayNo = (d) => Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() / DAY_MS);

function buildMessage(d, now) {
  const act = new Set(d.act || []);
  const today = dayNo(now);
  const doneToday = act.has(today);
  let n = 0, cur = doneToday ? today : today - 1;
  while (act.has(cur)) { n++; cur--; }
  const stale = (d.seen || []).filter((t) => now.getTime() - t >= (d.sd || 5) * DAY_MS).length;
  if (n > 0 && !doneToday) return { t: '🔥 لا تخسر تتابعك', b: 'تتابعك ' + n + (n === 1 ? ' يوم' : ' أيام') + '. افتح التطبيق وراجع كلمة اليوم.' };
  if (stale > 0) return { t: '⏳ مفردات تحتاج إعادتها', b: 'لديك ' + stale + (stale === 1 ? ' كلمة' : ' كلمات') + ' لم تراجعها منذ ' + (d.sd || 5) + ' أيام أو أكثر.' };
  return { t: '🌟 كلمة اليوم', b: 'حان وقت مراجعة كلماتك. اكشف كلمة اليوم الآن.' };
}

async function notifyCheck() {
  const c = await caches.open('wb-notify');
  const url = NOTIFY_URL();
  const r = await c.match(url);
  if (!r) return;
  const d = await r.json();
  if (!d.on) return;
  const now = new Date(), todayStr = now.toDateString();
  if (d.last === todayStr) return;
  if (now.getHours() * 60 + now.getMinutes() < (d.h || 0) * 60 + (d.m || 0)) return;
  const m = buildMessage(d, now);
  await self.registration.showNotification(m.t, { body: m.b, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'wb-daily', lang: 'ar', dir: 'rtl', data: { url: self.registration.scope } });
  d.last = todayStr;
  await c.put(url, new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } }));
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'wb-daily') e.waitUntil(notifyCheck().catch(() => {}));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow(self.registration.scope);
    })
  );
});
