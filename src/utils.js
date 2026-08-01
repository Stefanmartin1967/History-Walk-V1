// utils.js
import { zonesData, zoneCacheGet, zoneCacheSet } from './zones.js';
import { getSubtypes } from './taxonomy.js';

/**
 * Génère un identifiant unique au format HW-ULID
 * Format: HW- (préfixe) + 26 caractères (ULID: Timestamp + Random)
 */
export function generateHWID() {
    const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    function encodeBase32(number, length) {
        let str = "";
        for (let i = length - 1; i >= 0; i--) {
            str = ENCODING.charAt(number % 32) + str;
            number = Math.floor(number / 32);
        }
        return str;
    }

    function randomChar() {
        return ENCODING.charAt(Math.floor(Math.random() * 32));
    }

    // 1. Timestamp (48 bits -> 10 chars)
    // On utilise Date.now() qui est sur 42 bits environ
    const now = Date.now();
    const timestampPart = encodeBase32(now, 10);

    // 2. Random (80 bits -> 16 chars)
    let randomPart = "";
    for (let i = 0; i < 16; i++) {
        randomPart += randomChar();
    }

    return `HW-${timestampPart}${randomPart}`;
}

export function getPoiId(feature) {
    if (!feature || !feature.properties) return null;
    return feature.properties.HW_ID || feature.id;
}

/**
 * Empreinte SHA-256 (hex) du CONTENU d'un fichier/blob.
 * Sert à dédupliquer les photos à l'import : on hashe TOUJOURS le fichier
 * ORIGINAL (jamais le blob compressé/watermarké, sinon on comparerait du
 * compressé à du non-compressé → faux négatifs). Le `srcHash` ainsi obtenu est
 * stocké à côté de chaque photo sauvée (poiPhotos / pendingAdminPhotos) et
 * comparé au hash d'un nouvel import pour bloquer les doublons (cf.
 * reference_photo_import_clustering / dédup 2-local).
 * @param {Blob|File} file
 * @returns {Promise<string|null>} hex minuscule, ou null si indisponible
 */
export async function sha256OfFile(file) {
    try {
        if (!file || typeof file.arrayBuffer !== 'function') return null;
        if (!globalThis.crypto?.subtle) return null; // contexte non sécurisé
        const buf = await file.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', buf);
        return Array.from(new Uint8Array(digest))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    } catch (e) {
        console.warn('[sha256OfFile] échec, dédup ignorée pour ce fichier:', e?.message);
        return null;
    }
}

export function getPoiName(feature) {
    if (!feature || !feature.properties) return "Lieu sans nom";
    const props = feature.properties;
    const userData = props.userData || {};
    // Dernier recours AR : on lit la clé canonique `Nom du site arabe` (écrite par
    // l'éditeur + le Scout) AVANT la variante historique `Nom du site AR` — sinon un
    // POI arabe-seul (FR vide, fréquent depuis le routage P5) afficherait « Lieu
    // inconnu » en mode FR au lieu de son nom arabe.
    return userData.custom_title || userData['Nom du site FR'] || props['Nom du site FR'] || userData['Nom du site arabe'] || props['Nom du site arabe'] || props['Nom du site AR'] || props.name || "Lieu inconnu";
}

/**
 * Ouvre une position (lat/lng) sur Google Maps ou OpenStreetMap. Helper bas
 * niveau réutilisé par openPoiOnMap (par POI) et par l'import photo (par
 * barycentre EXIF d'un groupe orphelin — diagnostic « où l'app a positionné
 * cette photo »).
 * @param {number} lat
 * @param {number} lng
 * @param {'gmaps'|'osm'} [provider]
 * @returns {boolean} false si coords invalides
 */
export function openCoordsOnMap(lat, lng, provider = 'gmaps') {
    if (typeof lat !== 'number' || typeof lng !== 'number'
        || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    // Google Maps en VUE SATELLITE zoom 19 : la question posée par tous les
    // appelants (fiche POI, éditeur, marqueur fantôme, position d'une photo) est
    // « qu'y a-t-il physiquement à ces coordonnées ? ». Le plan ne répond pas ;
    // l'imagerie, oui — c'est le geste de vérification d'existence du patrimoine.
    // Contrepartie assumée : `map_action=map` ne pose pas d'épingle (l'API Maps
    // ne combine pas marqueur et fond satellite) → le point est au CENTRE exact
    // de l'écran, ce que le zoom 19 rend sans ambiguïté.
    const url = provider === 'osm'
        ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`
        : `https://www.google.com/maps/@?api=1&map_action=map&center=${lat},${lng}&zoom=19&basemap=satellite`;
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
}

/**
 * Normalise une référence d'objet OSM vers la forme canonique « type/id ».
 * Accepte ce que l'admin colle naturellement : l'URL complète de la page OSM
 * (avec ou sans query/hash) ou déjà « way/123 ». Retourne '' si non
 * reconnaissable — on ne devine JAMAIS un id à partir d'un texte libre.
 * @param {string} value
 * @returns {string} « way/386328373 » ou ''
 */
export function normalizeOsmRef(value) {
    if (typeof value !== 'string') return '';
    const m = value.trim().match(/(node|way|relation)\/(\d+)/i);
    return m ? `${m[1].toLowerCase()}/${m[2]}` : '';
}

/**
 * URL de la page d'un objet OSM à partir de sa référence « type/id ».
 * @param {string} osmRef
 * @returns {string|null} null si la référence est absente/invalide
 */
export function osmObjectUrl(osmRef) {
    const ref = normalizeOsmRef(osmRef);
    return ref ? `https://www.openstreetmap.org/${ref}` : null;
}

/**
 * Valide un lien Google Maps collé par l'admin (`maps_ref`).
 *
 * Contrairement à `osm_ref`, il n'existe pas de forme canonique « type/id »
 * extractible d'une URL Maps : lien court (goo.gl / maps.app.goo.gl), lien
 * complet avec un CID hexadécimal, parfois juste des coordonnées — le format
 * varie trop pour être normalisé sans risquer de casser silencieusement au
 * moindre changement côté Google. On stocke donc l'URL TELLE QUE COLLÉE,
 * comme le champ Facebook : seule garde, http(s) (jamais javascript:/data:).
 * @param {string} value
 * @returns {string|null} l'URL si valide, sinon null
 */
export function mapsPlaceUrl(value) {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return /^https?:\/\//i.test(v) ? v : null;
}

/**
 * Ouvre la position d'un POI sur Google Maps ou OpenStreetMap.
 *
 * Même geste des deux côtés : si le POI porte une référence précise
 * (`osm_ref` pour OSM, `maps_ref` pour Maps), on ouvre CET OBJET — page OSM
 * avec tags/historique/contributeur, ou fiche Maps avec avis/photos/horaires.
 * Sinon, repli sur les coordonnées : le bouton n'est donc jamais cassé.
 * Lecture via getPoiProp car les deux champs sont éditables → l'overlay
 * userData doit primer tant que la modif n'est pas publiée.
 *
 * Le repli reste PAR COORDONNÉES (jamais par nom : si le nom est erroné, une
 * recherche textuelle renverrait du vide ou un mauvais lieu). Réutilisé par la
 * fiche POI (mini-bar) et l'import photo (vérifier le lieu rattaché à un groupe).
 * @param {object} feature feature GeoJSON (geometry.coordinates = [lng, lat])
 * @param {'gmaps'|'osm'} [provider]
 * @returns {boolean} false si coordonnées indisponibles
 */
export function openPoiOnMap(feature, provider = 'gmaps') {
    if (provider === 'osm') {
        const url = osmObjectUrl(getPoiProp(feature, 'osm_ref'));
        if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
            return true;
        }
    }
    if (provider === 'gmaps') {
        const url = mapsPlaceUrl(getPoiProp(feature, 'maps_ref'));
        if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
            return true;
        }
    }
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return false;
    const [lng, lat] = coords;
    return openCoordsOnMap(lat, lng, provider);
}

export function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename.replace(/[\\/:"*?<>|]/g, '-');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

// Calcule la distance en mètres entre deux points (Formule de Haversine)
export function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Rayon de la terre en mètres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance en mètres
}

// Distance totale d'un tracé réel (tableau de [lat, lng])
export function getRealDistance(circuitData) {
    if (!circuitData || !circuitData.realTrack) return 0;
    const latLngs = circuitData.realTrack;
    let total = 0;
    for (let i = 0; i < latLngs.length - 1; i++) {
        const p1 = latLngs[i];
        const p2 = latLngs[i + 1];
        if (!Array.isArray(p1) || p1.length < 2 || typeof p1[0] !== 'number' || typeof p1[1] !== 'number' ||
            !Array.isArray(p2) || p2.length < 2 || typeof p2[0] !== 'number' || typeof p2[1] !== 'number') {
            console.warn(`[Utils] Point invalide détecté dans le tracé à l'index ${i}`, p1, p2);
            continue;
        }
        total += calculateDistance(p1[0], p1[1], p2[0], p2[1]);
    }
    return total;
}

// Distance "vol d'oiseau" d'un circuit (features GeoJSON)
export function getOrthodromicDistance(circuit) {
    if (!circuit || circuit.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < circuit.length - 1; i++) {
        const from = circuit[i].geometry.coordinates;
        const to = circuit[i + 1].geometry.coordinates;
        total += calculateDistance(from[1], from[0], to[1], to[0]);
    }
    return total;
}

// --- EXIF EXTRACTION WITH EXIFR ---

export async function getExifLocation(file) {
    try {
        const { default: exifr } = await import('exifr');

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout extraction EXIF")), 10000)
        );

        // On parse GPS + date dans un seul appel pour éviter 2 passes sur le fichier.
        // Note : pas de `pick` — latitude/longitude sont des propriétés *dérivées*
        // calculées par exifr depuis les tags bruts (GPSLatitude, GPSLatitudeRef...).
        // Restreindre via `pick` empêche la dérivation et renvoie un objet sans coords.
        const parsePromise = exifr.parse(file, { gps: true });

        const output = await Promise.race([parsePromise, timeoutPromise]);

        if (!output || typeof output.latitude !== 'number' || typeof output.longitude !== 'number') {
            throw new Error("Pas de données GPS trouvées");
        }

        const date = output.DateTimeOriginal || output.CreateDate || output.ModifyDate || null;
        return {
            lat: output.latitude,
            lng: output.longitude,
            date: date ? new Date(date).getTime() : null
        };
    } catch (e) {
        throw new Error(e.message || "Erreur extraction EXIF");
    }
}

export function resizeImage(file, maxWidth = 1280, quality = 0.9) {
    return new Promise((resolve, reject) => {
        // Timeout de sécurité (15s) pour éviter le blocage infini sur les grosses images
        const timer = setTimeout(() => {
            reject(new Error("Timeout lors du redimensionnement de l'image."));
        }, 15000);

        const reader = new FileReader();
        reader.readAsDataURL(file);

        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;

            img.onload = () => {
                clearTimeout(timer);
                try {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Calcul du ratio pour ne pas déformer l'image
                    if (width > maxWidth) {
                        height = Math.round(height * (maxWidth / width));
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Renvoie l'image en Base64 compressée
                    resolve(canvas.toDataURL('image/jpeg', quality));
                } catch (e) {
                    reject(e);
                }
            };

            img.onerror = (err) => {
                clearTimeout(timer);
                reject(new Error("Impossible de charger l'image (format non supporté ?)"));
            };
        };

        reader.onerror = (err) => {
            clearTimeout(timer);
            reject(new Error("Erreur de lecture du fichier."));
        };
    });
}

// Vérifie si un point (GPS) se trouve à l'intérieur d'une zone (Polygone)
export function isPointInPolygon(point, vs) {
    // point = [longitude, latitude]
    // vs = tableau de points du polygone
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i][0], yi = vs[i][1];
        const xj = vs[j][0], yj = vs[j][1];

        const intersect = ((yi > y) != (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// --- DÉTECTEUR DE ZONE AUTOMATIQUE ---
// Jeu de zones absent OU VIDE → « A définir ». Le test `.length === 0` est crucial :
// un échec de chargement de {dest}-zones.geojson laisse `features: []` (tableau VIDE
// mais TRUTHY) → sans ce garde, la boucle ne matchait rien et renvoyait « Hors zone »
// pour TOUS les POIs (bug : un réseau coupé = tout « Hors zone »). Désormais on
// renvoie « A définir » (neutre), et getDerivedZone/deriveZoneSafe retombent en plus
// sur la valeur stockée.
export function getZoneFromCoords(lat, lng) {
    if (!zonesData || !zonesData.features || zonesData.features.length === 0) return "A définir";

    const point = [lng, lat];
    
    // On boucle sur tous les quartiers (Houmt Souk, Erriadh...)
    for (const feature of zonesData.features) {
        const geom = feature.geometry;
        if (!geom || !geom.coordinates) continue;

        // Polygon : coordinates[0] = anneau extérieur (tableau de points).
        // MultiPolygon (fréquent pour les limites admin OSM morcelées) :
        // coordinates = [sous-polygones], chaque sous-polygone étant
        // [anneau extérieur, trou1, ...] → on teste coordinates[i][0].
        let hit = false;
        if (geom.type === 'MultiPolygon') {
            for (const poly of geom.coordinates) {
                const outerRing = poly && poly[0];
                if (outerRing && isPointInPolygon(point, outerRing)) { hit = true; break; }
            }
        } else { // Polygon (et défaut historique)
            const outerRing = geom.coordinates[0];
            if (outerRing && isPointInPolygon(point, outerRing)) hit = true;
        }

        // On utilise la fonction isPointInPolygon qui existe déjà dans votre fichier !
        if (hit) {
            return feature.properties.name;
        }
    }
    return "Hors zone";
}

// --- ZONE DÉRIVÉE À LA VOLÉE (dégel de Zone, 17/06/2026) ---
// La `Zone` d'un POI n'est plus une valeur GELÉE à la capture : elle se DÉRIVE de
// la position + du jeu de quartiers courant (zonesData), comme planifieCounter.
// Effet : compléter/pousser le fichier {dest}-zones.geojson re-zone tout le monde
// automatiquement au prochain chargement, sans « Recalculer » ni « Tout publier ».

// Dérive la zone d'une position MAIS retombe sur `storedZone` si le jeu de quartiers
// n'est pas chargé (échec réseau → features:[]). Garde-fou anti « tout Hors zone » :
// on ne fabrique JAMAIS « Hors zone » quand on ne sait pas (zones absentes). Utilisée
// au publish (admin-geojson) pour cuire une Zone fraîche sans risque.
export function deriveZoneSafe(lat, lng, storedZone) {
    if (!zonesData || !zonesData.features || zonesData.features.length === 0) return storedZone;
    return getZoneFromCoords(lat, lng);
}

// Zone EFFECTIVE d'un POI pour l'affichage / le filtre / le comptage. Dérive depuis
// les coordonnées quand les quartiers sont chargés, sinon repli sur la valeur stockée
// (overlay userData prioritaire via getPoiProp). Mémoïsée par id (cache vidé par
// setZonesData au changement de jeu de zones, et par deleteZoneCacheEntry au
// déplacement d'un POI) car le filtre l'appelle par POI à chaque applyFilters.
export function getDerivedZone(feature) {
    if (!feature) return '';
    const id = getPoiId(feature);
    if (id != null) {
        const hit = zoneCacheGet(id);
        if (hit !== undefined) return hit;
    }
    const stored = getPoiProp(feature, 'Zone') || '';
    const c = feature.geometry && feature.geometry.coordinates; // [lng, lat]
    let zone;
    if (!Array.isArray(c) || c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
        zone = stored;
    } else {
        zone = deriveZoneSafe(c[1], c[0], stored);
    }
    // On ne met en cache que les valeurs RÉELLEMENT dérivées (zones chargées) : une
    // valeur de repli (zones absentes) ne doit pas se figer, elle se recalculera dès
    // que setZonesData aura peuplé les quartiers (et vidé le cache).
    if (id != null && zonesData.features && zonesData.features.length > 0) zoneCacheSet(id, zone);
    return zone;
}

export function escapeXml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    // String(unsafe) garantit que .replace existe toujours
    return String(unsafe).replace(/[<>&'"]/g, c => ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        "'": '&apos;',
        '"': '&quot;'
    }[c]));
}

/** @public Alias sémantique de escapeXml (échappement HTML), importé par de nombreux modules. */
export const escapeHtml = escapeXml;

/**
 * Une destination est « publiée » (visible par tous) uniquement si son champ
 * `status` vaut explicitement "published". Tout le reste (status "draft",
 * absent, ou valeur inconnue) est traité comme un brouillon : visible admin
 * seulement. Défaut volontairement défensif — un nouveau dump Scout reste
 * invisible tant qu'il n'a pas été explicitement publié.
 */
export function isDestinationPublished(dest) {
    return dest?.status === 'published';
}

/**
 * Lit une propriété d'un POI en respectant la convention `userData` overlay :
 * l'admin éphémère (userData) prime sur le patrimoine (properties).
 *
 * Le merge canonique est `{...properties, ...userData}` (cf. data.js
 * passesUserFilters + mémoire `reference_flow_donnees_dimensions`). Ce helper
 * retourne la même valeur pour une clé donnée sans allouer un objet à chaque
 * appel — utile sur les chemins de rendu fréquents (timeline, marker, fiche).
 *
 * Le `!== undefined` est intentionnel : si l'admin a effacé une valeur via
 * userData (e.g. `userData.vu = false`), cette valeur explicite doit primer
 * sur le patrimoine — un `||` simple repasserait à `properties.X`.
 */
export function getPoiProp(feature, key) {
    const p = feature?.properties;
    if (!p) return undefined;
    const userVal = p.userData?.[key];
    return userVal !== undefined ? userVal : p[key];
}

/**
 * True si le POI est un candidat Scout « à curer » — capturé automatiquement
 * (Overpass) mais pas encore validé par l'admin.
 *
 * SOURCE UNIQUE pour les 5 lecteurs du flag (filtre data.js, badge marqueur
 * map.js, ligne « à curer » du RichEditor, 2 gardes du diff engine). Lit via
 * getPoiProp (overlay userData) : une curation pose `userData.candidate = false`
 * qui PRIME sur le patrimoine `candidate:true`. C'est indispensable pour un
 * candidat issu d'un BROUILLON GitHub, où il est un feature de BASE (re-fetché
 * du geojson à chaque boot, donc `properties.candidate` reste true) : seul
 * l'overlay userData persiste la curation. Sans ce point d'entrée commun, le
 * badge et le diff (qui lisaient `properties.candidate` brut) ré-affichaient le
 * candidat comme « à curer » après reboot.
 */
export function isCandidate(feature) {
    return !!getPoiProp(feature, 'candidate');
}

/**
 * True si le POI est mal catégorisé : aucune Catégorie, ou « A définir », ou
 * catégorie avec sous-types disponibles ET Sous-type vide. Utilisé pour le
 * badge orange du bouton « Catégoriser » de la modale d'import photo (chantier
 * enrichissement 01/06/2026). État/Accès NON considérés (secondaires — leur
 * absence ne signale pas un POI « pas catégorisé »).
 */
export function isPoiMalCategorized(feature) {
    const cat = getPoiProp(feature, 'Catégorie');
    if (!cat || cat === 'A définir') return true;
    const subtypes = getSubtypes(cat);
    if (subtypes.length > 0 && !getPoiProp(feature, 'Sous-type')) return true;
    return false;
}

/**
 * Point d'accès au tracé d'un POI : champ public OPTIONNEL `accessPoint` =
 * [lon, lat], posé par l'admin sur la voie la plus proche pour les POI « hors
 * voie » (bâtiment isolé). Renvoie le couple [lon, lat] s'il est défini et
 * valide (tableau de 2 nombres finis), sinon null. Lu via getPoiProp (overlay).
 * Source unique partagée : gpx.js (ancre de tracé) + access-point-editor.js
 * (pré-remplissage du drapeau). NE déplace JAMAIS le POI : le marqueur reste sur
 * geometry.coordinates ; seul le <trkpt> du « vol d'oiseau » utilise ce point.
 */
export function getAccessPoint(feature) {
    const ap = getPoiProp(feature, 'accessPoint');
    if (Array.isArray(ap) && ap.length === 2 && Number.isFinite(ap[0]) && Number.isFinite(ap[1])) {
        return ap; // [lon, lat]
    }
    return null;
}

/**
 * Nettoie une chaîne HTML pour prévenir les failles XSS avant l'utilisation de .innerHTML.
 * Ne conserve que les balises et attributs considérés comme sûrs.
 * Cette version basique utilise DOMParser pour supprimer les scripts et les attributs d'événements.
 */
export function sanitizeHTML(html) {
    if (!html) return '';

    // Si c'est juste du texte sans chevron, pas besoin de parser (optimisation)
    if (typeof html === 'string' && html.indexOf('<') === -1) {
        return html;
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Supprimer toutes les balises <script>
    doc.querySelectorAll('script').forEach(script => script.remove());

    // Défense en profondeur (en complément de la CSP stricte, sans 'unsafe-inline') :
    // retirer tout gestionnaire d'événement inline (on*) sur n'importe quel élément
    // et neutraliser les href javascript:.
    doc.body.querySelectorAll('*').forEach(el => {
        [...el.attributes].forEach(attr => {
            if (attr.name.toLowerCase().startsWith('on')) {
                el.removeAttribute(attr.name);
            }
        });
        const href = el.getAttribute('href');
        if (href && href.trim().toLowerCase().startsWith('javascript:')) {
            el.removeAttribute('href');
        }
    });

    return doc.body.innerHTML;
}

// --- CLUSTERING PHOTOS GPS ---

export function calculateBarycenter(coordsList) {
    if (!coordsList || coordsList.length === 0) return null;
    const avgLat = coordsList.reduce((sum, c) => sum + c.lat, 0) / coordsList.length;
    const avgLng = coordsList.reduce((sum, c) => sum + c.lng, 0) / coordsList.length;
    return { lat: avgLat, lng: avgLng };
}

export function clusterByLocation(items, distanceThreshold = 50) {
    // items doit être un tableau d'objets contenant { coords: { lat, lng }, ... }
    const validItems = items.filter(i => i.coords && i.coords.lat && i.coords.lng);
    const clusters = [];
    const visited = new Set(); // Stocke les index des items traités

    for (let i = 0; i < validItems.length; i++) {
        if (visited.has(i)) continue;

        const cluster = [];
        const queue = [i];
        visited.add(i);

        while (queue.length > 0) {
            const currentIndex = queue.shift();
            const currentItem = validItems[currentIndex];
            cluster.push(currentItem);

            // On cherche tous les voisins proches de cet élément (Transitive clustering)
            for (let j = 0; j < validItems.length; j++) {
                if (visited.has(j)) continue;

                const otherItem = validItems[j];
                const dist = calculateDistance(
                    currentItem.coords.lat, currentItem.coords.lng,
                    otherItem.coords.lat, otherItem.coords.lng
                );

                if (dist <= distanceThreshold) {
                    visited.add(j);
                    queue.push(j);
                }
            }
        }
        clusters.push(cluster);
    }
    return clusters;
}

/**
 * Calcule le nouveau temps pour un POI (Heures/Minutes)
 */
export function calculateAdjustedTime(currentH, currentM, minutesToAdd) {
    let totalMinutes = (parseInt(currentH) || 0) * 60 + (parseInt(currentM) || 0) + minutesToAdd;
    if (totalMinutes < 0) totalMinutes = 0;

    return {
        h: Math.floor(totalMinutes / 60),
        m: totalMinutes % 60
    };
}
