import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path'; // 1. Ajout de l'import pour gérer les chemins

export default defineConfig({
  // Le nom exact de votre dépôt GitHub
  base: '/',

  plugins: [
    // En dev seulement : Vite HMR injecte des styles inline qui frappent la CSP stricte.
    // On autorise 'unsafe-inline' uniquement pour `vite serve`. En build, la CSP reste strict.
    {
      name: 'csp-dev-relax',
      transformIndexHtml(html, ctx) {
        if (ctx.server) {
          return html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'");
        }
        return html;
      }
    },
    VitePWA({
      registerType: 'prompt',
      base: '/',
      scope: '/',

      manifest: false, // On utilise public/manifest.json manuellement
      workbox: {
        // Les fichiers .geojson sont exclus du precache (CacheFirst trop agressif)
        // et gérés en NetworkFirst via runtimeCaching ci-dessous.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,webp}'],
        // og-image.png (720 KB) : utilisée par les scrapers sociaux, inutile hors-ligne.
        // screenshots/ : fiche d'installation PWA uniquement, inutile hors-ligne.
        //
        // destinations.json + circuits/*.json + poi-categories.json : EXCLUS du
        // précache. Étant des .json, ils étaient happés par globPatterns →
        // précachés (CacheFirst figé à la build), et le précache GAGNE sur le
        // NetworkFirst ci-dessous → la config restait PÉRIMÉE jusqu'à activation
        // d'un nouveau SW (bug observé : nouvelle vue d'ouverture/devise non vues
        // après déploiement — poi-categories.json avait le même piège, sans même
        // ce filet, cf. renommage Marabout→Mausolée du 15/08/2026). En les
        // ignorant, ils tombent sur le NetworkFirst 'app-data' (même traitement
        // que .geojson) → frais à chaque boot online, fallback cache hors-ligne.
        globIgnores: ['**/og-image.png', '**/screenshots/**', '**/destinations.json', '**/circuits/*.json', '**/poi-categories.json'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Les .gpx (partage/téléchargement de circuit) ne doivent PAS être happés
        // par le navigateFallback → sinon scanner le QR d'un circuit (qui pointe
        // vers …/circuits/x.gpx) sert l'app (index.html) au lieu du fichier, et HW
        // s'ouvre sur « Mes Circuits » vide. Ils passent par leur propre route
        // (`circuit-traces`, runtimeCaching plus bas) : le fichier, pas l'app.
        // Idem pour /lieux/ : pages SEO statiques générées post-build (hook
        // npm postbuild → scripts/generate-poi-pages.mjs), servies par le
        // réseau — sinon un utilisateur avec l'app installée qui clique un
        // lien Google recevrait index.html au lieu de la page du lieu.
        navigateFallbackDenylist: [/\.gpx(\?.*)?$/i, /^\/lieux\//],
        // Script chargé par le service worker avant Workbox : supprime, à
        // l'activation, les caches que plus aucune route n'utilise (ex. l'ancien
        // `map-tiles`, cf. tuiles plus bas). Fichier de public/ → copié à la
        // racine de dist/, à côté de sw.js. ⚠ S'il manquait au déploiement, le
        // nouveau SW échouerait à s'installer et plus aucune mise à jour
        // n'arriverait : tests/sw_cleanup.test.js le garde.
        importScripts: ['sw-cleanup.js'],
        // Durée de conservation (20/10/2026) : AUCUNE route n'a d'âge maximal
        // (option maxAgeSeconds de Workbox). Workbox 7.4 s'en sert de deux façons,
        // mesurées hors-ligne avec des copies vieillies de 31 jours (v3.7.442) :
        //  - une copie dont l'en-tête `Date` dépasse l'âge (lisible pour nos
        //    fichiers, même origine) est refusée puis supprimée, réseau ou pas :
        //    plus aucun circuit officiel listé, photo de fiche absente ;
        //  - les entrées pas utilisées depuis cet âge sont supprimées dès qu'une
        //    autre est lue : 10 tuiles sur 28, préparées pour un autre circuit,
        //    effacées au premier affichage de la carte.
        // Or ces caches sont le secours hors-ligne du « pack terrain » passif,
        // préparé parfois des mois avant le terrain. Un âge maximal n'y rafraîchit
        // rien : en ligne, les routes NetworkFirst redemandent toujours le
        // serveur, les tuiles sont redemandées en arrière-plan, et une photo
        // publiée ne change jamais sous le même nom. Seul maxEntries borne chaque
        // cache : au-delà, l'entrée utilisée il y a le plus longtemps sort.
        // tests/cache_retention.test.js le garde.
        runtimeCaching: [
          {
            // GeoJSON : NetworkFirst — données éditoriales qui évoluent
            urlPattern: /\.geojson(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'geojson-data',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 10,
              },
            },
          },
          {
            // Circuits officiels, config destinations et taxonomie POI : NetworkFirst
            // Remplace le double-fetch manuel avec ?t=Date.now() dans app-startup.js
            urlPattern: /\/(circuits\/[^?]+\.json|destinations\.json|poi-categories\.json)(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-data',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 20,
              },
            },
          },
          {
            // Tracés des circuits officiels (circuits/<map>/<nom>.gpx), chargés à
            // l'ouverture d'un circuit (loadCircuitById, circuit.js) et gardés en
            // mémoire seulement. Sans cette route (jusqu'à v3.7.441), aucun cache ne
            // les gardait : hors-ligne, un circuit ouvert en wifi s'affichait en vol
            // d'oiseau (pointillés rouges), constaté en suivi mobile le 19/10/2026.
            // C'est l'autre moitié du « pack terrain » passif, avec les tuiles.
            //
            // NetworkFirst, comme l'index circuits/<map>.json qui donne le nom et les
            // étapes : en ligne, le tracé vient toujours du serveur, donc un circuit
            // republié sous le même nom arrive dès l'ouverture suivante, et tracé et
            // étapes restent du même âge. Hors-ligne, la copie gardée. 8 s : sur un
            // réseau qui ne répond plus, la copie sort avant l'abandon à 12 s de
            // fetchWithTimeout (net.js).
            //
            // Pas d'âge maximal (cf. « Durée de conservation » plus haut) : un
            // circuit préparé longtemps avant le terrain retomberait en vol
            // d'oiseau. maxEntries borne la taille : 28 GPX publiés au 19/10/2026,
            // 37 Ko au plus chacun.
            //
            // Prend aussi l'ouverture directe d'un .gpx (QR de partage) chez qui a
            // Heripia installée : en ligne le fichier du serveur, hors-ligne la copie.
            // Le navigateFallbackDenylist plus haut reste nécessaire : sans lui, ce
            // serait index.html. Le bouton « Télécharger GPX » de la fiche mobile
            // (<a download>), lui, ne passe pas par le service worker (mesuré dans
            // Chrome le 19/10/2026) : hors-ligne, il échoue toujours.
            urlPattern: /\/circuits\/[^?]+\.gpx(\?.*)?$/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'circuit-traces',
              networkTimeoutSeconds: 8,
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxEntries: 60,
              },
            },
          },
          {
            // Tuiles de carte (CARTO « Voyager » par défaut, OSM « Plan », OSM
            // France « Plan (FR) », Google « Satellite ») : StaleWhileRevalidate —
            // la tuile en cache s'affiche tout de suite, et le service worker la
            // redemande en arrière-plan pour l'affichage suivant. Une tuile vue une
            // fois reste dispo hors ligne : c'est ce qui permet le « pack terrain »
            // PASSIF. On prépare un circuit chez soi (les tuiles de la zone se
            // chargent) → sur le terrain elles sont déjà là, carte lisible même
            // sans réseau (la redemande échoue sans conséquence). Cf. map.js. Sur
            // mobile, seul Voyager s'affiche (contrôles Leaflet masqués en suivi).
            //
            // Jusqu'à v3.7.440, CacheFirst : une tuile vue au moins une fois tous
            // les 30 jours n'était JAMAIS redemandée. L'expiration de Workbox remet
            // l'horodatage d'une tuile à zéro à chaque affichage, et tient pour
            // fraîche une réponse sans en-tête `Date`, illisible en CORS. Données
            // OSM, style, tuile tamponnée : tout restait figé.
            //
            // La redemande passe par le cache HTTP du navigateur, qui suit les
            // en-têtes de chaque serveur (relevés le 19/10/2026 : CARTO 30 jours,
            // Google 1 h, OSM et OSM France de quelques minutes à un jour). Tant
            // qu'une tuile y est fraîche, rien ne part sur le réseau ; ensuite,
            // requête conditionnelle (ETag), réponse 304 sans image si la tuile n'a
            // pas changé. La charge des serveurs est donc celle d'un navigateur sans
            // service worker, ce que demande la politique d'usage des tuiles OSM.
            // Une redemande en erreur (404, panne) ne remplace pas la tuile en
            // cache ; une tuile 200 fautive (ex. tamponnée par CARTO) la
            // remplacerait, et serait corrigée de la même façon ensuite.
            //
            // Tuiles chargées en CORS (`crossOrigin: true` dans map.js) depuis le
            // 18/10/2026 → réponses 200 lisibles, comptées par Chrome à leur poids
            // réel (quelques Ko par tuile, mesuré). Avant, Leaflet les chargeait SANS
            // crossorigin → réponses OPAQUES (status 0, d'où l'ancien
            // `statuses: [0, 200]`), que Chrome compte ~7,8 Mo chacune dans le
            // quota : 2,2 Go affichés pour heripia.com. `statuses: [200]` : une
            // tuile en erreur (404, panne) n'est plus gardée, son vrai code étant
            // maintenant visible (une réponse opaque le masquait).
            //
            // Nom changé (`map-tiles` → `map-tiles-cors`) : une tuile opaque déjà
            // en cache, resservie à une <img crossorigin>, ne s'affiche PAS (mesuré
            // sur les 4 serveurs). L'ancien cache est supprimé à l'activation du SW
            // par public/sw-cleanup.js (cf. importScripts plus haut).
            //
            // Pas d'âge maximal (cf. « Durée de conservation » plus haut) : jusqu'à
            // v3.7.442, une tuile restée 30 jours sans être affichée était
            // supprimée, donc un pack préparé en octobre aurait disparu en mars.
            // maxEntries 1000 (256 jusqu'à v3.7.442) : un circuit préparé, c'est
            // environ 28 tuiles (suivi mobile, mesuré le 20/10/2026), soit ~600
            // pour les 21 circuits de Djerba. 1000 tuiles Voyager ≈ 5 Mo ; au pire
            // ~30 Mo sur PC en Satellite (31 Ko la tuile). purgeOnQuotaError : ce
            // cache, le plus facile à reconstituer, part en premier si le quota
            // sature.
            urlPattern: /^https:\/\/(?:[a-c]\.tile\.openstreetmap\.org|[a-c]\.tile\.openstreetmap\.fr|[a-d]\.basemaps\.cartocdn\.com|mt[0-3]\.google\.com)\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'map-tiles-cors',
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxEntries: 1000,
                purgeOnQuotaError: true,
              },
            },
          },
          {
            // Photos de POI (same-origin /photos/*.jpg, servies par GitHub Pages) :
            // CacheFirst. Réponses 200 classiques (pas opaques) → pas de padding
            // quota. Une photo affichée une fois reste dispo hors ligne. Pas d'âge
            // maximal (cf. « Durée de conservation » plus haut) : chaque photo a un
            // nom unique (lieu + horodatage) et une photo publiée est définitive,
            // il n'y a donc rien à rafraîchir.
            urlPattern: /\/photos\/[^?]+\.jpg(\?.*)?$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'poi-photos',
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 200,
                purgeOnQuotaError: true,
              },
            },
          },
        ],
      }
    })
  ],

  // Réunification (12/06/2026) : le Scout et le Data Manager autonomes ont été
  // supprimés (remplacés par le Scout in-app et le Mode Données). Plus qu'une
  // seule entrée — l'app principale.
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
