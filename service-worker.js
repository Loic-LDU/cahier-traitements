// Service Worker — Ordo Vitis
// Version du cache : incrémenter à chaque mise à jour majeure de l'app
const CACHE_VERSION = 'ordo-vitis-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

// Fichiers essentiels à mettre en cache au démarrage
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/pwa-icons/icon-192.png',
  '/pwa-icons/icon-512.png',
  // CDN externes (Supabase, Leaflet, Google Fonts)
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// ============== INSTALLATION ==============
// Au premier chargement : mettre en cache les ressources essentielles
self.addEventListener('install', (event) => {
  console.log('[SW] Installation en cours…');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Mise en cache des ressources statiques');
      // On utilise addAll mais avec gestion d'erreur pour les ressources optionnelles
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err =>
            console.warn(`[SW] Impossible de cacher ${url}:`, err.message)
          )
        )
      );
    })
    // NB : pas de skipWaiting() automatique ici. La nouvelle version reste en
    // attente et l'app propose à l'utilisateur de mettre à jour (bannière),
    // ce qui évite tout rechargement intempestif pendant une saisie.
  );
});

// ============== ACTIVATION ==============
// Quand le SW devient actif : nettoyer les vieux caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation…');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('ordo-vitis-') && name !== STATIC_CACHE)
          .map((name) => {
            console.log('[SW] Suppression ancien cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim()) // Prend le contrôle immédiat
  );
});

// ============== INTERCEPTION DES REQUÊTES ==============
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ne PAS mettre en cache les requêtes Supabase (API, auth) — elles doivent toujours aller au serveur
  if (url.hostname.includes('supabase.co')) {
    return; // Laisser la requête passer normalement
  }

  // Ne PAS mettre en cache les requêtes POST, PUT, DELETE
  if (event.request.method !== 'GET') {
    return;
  }

  // Stratégie "Network First" pour le HTML principal (toujours la dernière version).
  // IMPORTANT : on force { cache: 'no-store' } pour court-circuiter le cache HTTP du
  // navigateur, sinon le fetch peut renvoyer une ancienne page sans aller au serveur.
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          // Mettre en cache la nouvelle version (pour le mode hors-ligne uniquement)
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put('/index.html', clone));
          }
          return response;
        })
        .catch(() => {
          // Si offline, retourner la version cachée
          return caches.match(event.request).then((cached) => cached || caches.match('/index.html') || caches.match('/'));
        })
    );
    return;
  }

  // Stratégie "Cache First" pour les autres ressources (CSS, JS, images, librairies CDN versionnées)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // En arrière-plan, mettre à jour le cache
        fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, response));
          }
        }).catch(() => {/* offline, on ignore */});
        return cached;
      }
      // Pas en cache : aller chercher en ligne
      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// ============== MISE À JOUR DEPUIS L'APP ==============
// Permet à l'app de demander l'activation immédiate de la nouvelle version
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
