const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * @typedef {Object} ScenicPOI
 * @property {number} id - OSM node/way/relation ID
 * @property {number} lat
 * @property {number} lng
 * @property {string} name
 * @property {string} category - One of the CATEGORY keys
 * @property {string} osmType - Raw OSM tag like 'tourism=viewpoint'
 * @property {object} tags - All OSM tags
 * @property {number} score - Computed score (set during scoring phase)
 * @property {number} distanceFromRoute - Distance from nearest route point in meters
 */

/**
 * Category definitions with type weights for scoring.
 * Higher weight = more desirable waypoint.
 */
const CATEGORIES = {
  national_park:  { weight: 10, label: 'National/State Park', emoji: '\u{1F3DE}' },
  nature_reserve: { weight: 8,  label: 'Nature Reserve',      emoji: '\u{1F332}' },
  viewpoint:      { weight: 7,  label: 'Scenic Viewpoint',    emoji: '\u{1F304}' },
  peak:           { weight: 6,  label: 'Mountain Peak',       emoji: '\u26F0\uFE0F' },
  waterfall:      { weight: 6,  label: 'Waterfall',           emoji: '\u{1F4A7}' },
  water:          { weight: 5,  label: 'Lake',                emoji: '\u{1F30A}' },
  campsite:       { weight: 5,  label: 'Campground',          emoji: '\u{1F3D5}\uFE0F' },
  historic:       { weight: 4,  label: 'Historic Site',       emoji: '\u{1F3F0}' },
  attraction:     { weight: 4,  label: 'Tourist Attraction',  emoji: '\u2B50' },
  picnic_site:    { weight: 2,  label: 'Picnic Area',         emoji: '\u{1F9FA}' },
};

/**
 * Category-to-color map for map markers.
 */
const CATEGORY_COLORS = {
  national_park:  '#15803d',
  nature_reserve: '#16a34a',
  viewpoint:      '#0ea5e9',
  peak:           '#78716c',
  waterfall:      '#3b82f6',
  water:          '#2563eb',
  campsite:       '#65a30d',
  historic:       '#a16207',
  attraction:     '#e11d48',
  picnic_site:    '#84cc16',
};

export function getCategories() {
  return CATEGORIES;
}

export function getCategoryColors() {
  return CATEGORY_COLORS;
}

/**
 * Haversine distance between two points in meters.
 */
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Build a fast node-only Overpass query for scenic POIs around a point.
 * Ways/relations are queried separately via bbox to avoid timeouts.
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMeters
 * @returns {string}
 */
function buildNodeQuery(lat, lng, radiusMeters) {
  return `
    [out:json][timeout:30];
    (
      node["tourism"="viewpoint"](around:${radiusMeters},${lat},${lng});
      node["natural"="peak"]["name"](around:${radiusMeters},${lat},${lng});
      node["waterway"="waterfall"](around:${radiusMeters},${lat},${lng});
      node["natural"="water"]["name"](around:${radiusMeters},${lat},${lng});
      node["tourism"="camp_site"]["name"](around:${radiusMeters},${lat},${lng});
      node["tourism"="attraction"]["name"](around:${radiusMeters},${lat},${lng});
      node["historic"]["name"](around:${radiusMeters},${lat},${lng});
      node["tourism"="picnic_site"](around:${radiusMeters},${lat},${lng});
    );
    out;
  `;
}

/**
 * Build a single combined Overpass query for scenic POIs around ALL sample points.
 * Instead of N separate queries, this creates one union query with around: clauses
 * for every sample point × tag type combination.
 *
 * @param {Array<{lat: number, lng: number}>} samplePoints
 * @param {number} radiusMeters
 * @returns {string}
 */
function buildCombinedNodeQuery(samplePoints, radiusMeters) {
  const tagFilters = [
    '["tourism"="viewpoint"]',
    '["natural"="peak"]["name"]',
    '["waterway"="waterfall"]',
    '["natural"="water"]["name"]',
    '["tourism"="camp_site"]["name"]',
    '["tourism"="attraction"]["name"]',
    '["historic"]["name"]',
    '["tourism"="picnic_site"]',
  ];

  const clauses = [];
  for (const tag of tagFilters) {
    for (const pt of samplePoints) {
      clauses.push(`  node${tag}(around:${radiusMeters},${pt.lat},${pt.lng});`);
    }
  }

  return `[out:json][timeout:45];\n(\n${clauses.join('\n')}\n);\nout;`;
}

/**
 * Query Overpass for scenic POIs across all sample points in a single request.
 * @param {Array<{lat: number, lng: number}>} samplePoints
 * @param {number} radiusMeters
 * @returns {Promise<ScenicPOI[]>}
 */
async function queryCombinedScenicPOIs(samplePoints, radiusMeters) {
  const query = buildCombinedNodeQuery(samplePoints, radiusMeters);

  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass combined query failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.remark && data.remark.includes('runtime error')) {
    throw new Error(`Overpass runtime error: ${data.remark}`);
  }

  return parseOverpassElements(data.elements);
}

/**
 * Build a bbox-based Overpass query for parks, reserves, and large areas.
 * Bbox queries are fast for ways/relations (unlike around: which times out).
 * @param {number} south
 * @param {number} west
 * @param {number} north
 * @param {number} east
 * @returns {string}
 */
function buildAreaQuery(south, west, north, east) {
  return `
    [out:json][timeout:30];
    (
      relation["boundary"="national_park"](${south},${west},${north},${east});
      relation["boundary"="protected_area"]["protect_class"~"^[1-4]$"](${south},${west},${north},${east});
      relation["leisure"="nature_reserve"](${south},${west},${north},${east});
      way["natural"="water"]["name"](${south},${west},${north},${east});
      way["tourism"="camp_site"]["name"](${south},${west},${north},${east});
    );
    out center tags;
  `;
}

/**
 * Compute bounding box for a route corridor.
 * @param {Array<[number,number,number?]>} routeCoords - [lng, lat, elev?]
 * @param {number} bufferKm
 * @returns {{south: number, west: number, north: number, east: number}}
 */
function computeCorridorBbox(routeCoords, bufferKm) {
  const bufferDeg = bufferKm / 111; // ~111 km per degree latitude

  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  for (const coord of routeCoords) {
    const lat = coord[1];
    const lng = coord[0];
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  return {
    south: minLat - bufferDeg,
    west: minLng - bufferDeg,
    north: maxLat + bufferDeg,
    east: maxLng + bufferDeg,
  };
}

/**
 * Determine category from OSM tags. Priority order matters.
 */
function categorizeElement(tags) {
  if (!tags) return { category: 'attraction', osmType: 'unknown' };

  if (tags.boundary === 'national_park') {
    return { category: 'national_park', osmType: 'boundary=national_park' };
  }
  if (tags.boundary === 'protected_area') {
    return { category: 'national_park', osmType: 'boundary=protected_area' };
  }
  if (tags.leisure === 'nature_reserve') {
    return { category: 'nature_reserve', osmType: 'leisure=nature_reserve' };
  }
  if (tags.tourism === 'viewpoint') {
    return { category: 'viewpoint', osmType: 'tourism=viewpoint' };
  }
  if (tags.natural === 'peak') {
    return { category: 'peak', osmType: 'natural=peak' };
  }
  if (tags.waterway === 'waterfall') {
    return { category: 'waterfall', osmType: 'waterway=waterfall' };
  }
  if (tags.natural === 'water') {
    return { category: 'water', osmType: 'natural=water' };
  }
  if (tags.tourism === 'camp_site') {
    return { category: 'campsite', osmType: 'tourism=camp_site' };
  }
  if (tags.historic) {
    return { category: 'historic', osmType: `historic=${tags.historic}` };
  }
  if (tags.tourism === 'attraction') {
    return { category: 'attraction', osmType: 'tourism=attraction' };
  }
  if (tags.tourism === 'picnic_site') {
    return { category: 'picnic_site', osmType: 'tourism=picnic_site' };
  }

  return { category: 'attraction', osmType: 'unknown' };
}

/**
 * Query Overpass for scenic POIs at a single point.
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMeters
 * @returns {Promise<ScenicPOI[]>}
 */
async function queryScenicPOIs(lat, lng, radiusMeters = 50000) {
  const query = buildNodeQuery(lat, lng, radiusMeters);

  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass query failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Check for Overpass runtime errors (e.g., timeout)
  if (data.remark && data.remark.includes('runtime error')) {
    throw new Error(`Overpass runtime error: ${data.remark}`);
  }

  return parseOverpassElements(data.elements);
}

/**
 * Query Overpass for parks, reserves, and large areas via bbox.
 * Runs once for the entire route corridor.
 * @param {Array<[number,number,number?]>} routeCoords
 * @param {number} corridorRadiusKm
 * @returns {Promise<ScenicPOI[]>}
 */
async function queryAreaPOIs(routeCoords, corridorRadiusKm) {
  const bbox = computeCorridorBbox(routeCoords, corridorRadiusKm);
  const query = buildAreaQuery(bbox.south, bbox.west, bbox.north, bbox.east);

  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass area query failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.remark && data.remark.includes('runtime error')) {
    throw new Error(`Overpass runtime error: ${data.remark}`);
  }

  return parseOverpassElements(data.elements);
}

/**
 * Parse Overpass elements into ScenicPOI objects.
 * @param {Array} elements
 * @returns {ScenicPOI[]}
 */
function parseOverpassElements(elements) {
  if (!elements) return [];

  return elements
    .map((el) => {
      // Get coordinates — nodes have lat/lon directly, ways/relations use center
      let elLat, elLng;
      if (el.type === 'node') {
        elLat = el.lat;
        elLng = el.lon;
      } else if (el.center) {
        elLat = el.center.lat;
        elLng = el.center.lon;
      } else {
        return null; // Skip elements without coordinates
      }

      const tags = el.tags || {};
      const { category, osmType } = categorizeElement(tags);

      return {
        id: el.id,
        lat: elLat,
        lng: elLng,
        name: tags.name || tags['name:en'] || category,
        category,
        osmType,
        tags,
        score: 0,
        distanceFromRoute: 0,
      };
    })
    .filter(Boolean);
}

/**
 * Discover scenic POIs along a corridor defined by route coordinates.
 *
 * @param {Array<[number,number,number?]>} routeCoords - [lng, lat, elevation?] from ORS
 * @param {object} options
 * @param {number} options.corridorRadiusKm - Search radius per sample point (default 25)
 * @param {number} options.sampleIntervalKm - Distance between sample points (default 120)
 * @param {function} options.onProgress - Callback(current, total) for progress UI
 * @param {Array<{lat: number, lng: number, name: string}>} options.noteHints - Geocoded route note locations
 * @returns {Promise<ScenicPOI[]>}
 */
export async function discoverCorridorPOIs(routeCoords, options = {}) {
  const {
    corridorRadiusKm = 25,
    sampleIntervalKm = 120,
    onProgress,
    noteHints = [],
  } = options;

  if (!routeCoords || routeCoords.length === 0) {
    return [];
  }

  const radiusMeters = corridorRadiusKm * 1000;
  const intervalMeters = sampleIntervalKm * 1000;

  // Sample points along route at intervals
  const samplePoints = [];
  let accumulated = 0;

  // Always include the start
  samplePoints.push({
    lat: routeCoords[0][1],
    lng: routeCoords[0][0],
  });

  for (let i = 1; i < routeCoords.length; i++) {
    const dist = haversine(
      routeCoords[i - 1][1], routeCoords[i - 1][0],
      routeCoords[i][1], routeCoords[i][0]
    );
    accumulated += dist;

    if (accumulated >= intervalMeters) {
      samplePoints.push({
        lat: routeCoords[i][1],
        lng: routeCoords[i][0],
      });
      accumulated = 0;
    }
  }

  // Always include the end
  const lastCoord = routeCoords[routeCoords.length - 1];
  const lastSample = samplePoints[samplePoints.length - 1];
  if (lastSample.lat !== lastCoord[1] || lastSample.lng !== lastCoord[0]) {
    samplePoints.push({ lat: lastCoord[1], lng: lastCoord[0] });
  }

  // Add noteHints as extra sample points (skip if within 30km of existing sample)
  for (const hint of noteHints) {
    const tooClose = samplePoints.some(sp =>
      haversine(hint.lat, hint.lng, sp.lat, sp.lng) < 30000
    );
    if (!tooClose) {
      samplePoints.push({ lat: hint.lat, lng: hint.lng });
    }
  }

  // Query all sample points in a single combined Overpass request
  const allPOIs = [];
  const seenIds = new Set();

  if (onProgress) {
    onProgress(1, 2); // 50% — querying nodes
  }

  try {
    const pois = await queryCombinedScenicPOIs(samplePoints, radiusMeters);
    for (const poi of pois) {
      if (!seenIds.has(poi.id)) {
        seenIds.add(poi.id);
        allPOIs.push(poi);
      }
    }
  } catch (err) {
    if (err.message.includes('429')) {
      // Rate limited: wait 5 seconds and retry once
      await delay(5000);
      try {
        const pois = await queryCombinedScenicPOIs(samplePoints, radiusMeters);
        for (const poi of pois) {
          if (!seenIds.has(poi.id)) {
            seenIds.add(poi.id);
            allPOIs.push(poi);
          }
        }
      } catch {
        // Skip node query on retry failure
      }
    }
    // For other errors, continue to area query
  }

  // Query parks/reserves/large areas via a single bbox query
  try {
    await delay(1100); // Respect rate limit before area query
    const areaPOIs = await queryAreaPOIs(routeCoords, corridorRadiusKm);
    for (const poi of areaPOIs) {
      if (!seenIds.has(poi.id)) {
        seenIds.add(poi.id);
        allPOIs.push(poi);
      }
    }
  } catch {
    // Area query is supplementary — continue without it if it fails
  }

  if (onProgress) {
    onProgress(2, 2); // 100%
  }

  return allPOIs;
}

/**
 * Compute minimum distance from a POI to the route polyline.
 * Uses a simplified route (every Nth point) for performance.
 *
 * @param {ScenicPOI} poi
 * @param {Array<[number,number]>} simplifiedCoords - [lng, lat] sampled route points
 * @returns {number} Distance in meters
 */
function distanceToRoute(poi, simplifiedCoords) {
  let minDist = Infinity;

  for (let i = 0; i < simplifiedCoords.length; i++) {
    const d = haversine(poi.lat, poi.lng, simplifiedCoords[i][1], simplifiedCoords[i][0]);
    if (d < minDist) {
      minDist = d;
    }
  }

  return minDist;
}

/**
 * Simplify route coordinates by taking every Nth point.
 * @param {Array<[number,number,number?]>} coords
 * @param {number} nth
 * @returns {Array<[number,number]>}
 */
function simplifyRoute(coords, nth = 20) {
  const simplified = [];
  for (let i = 0; i < coords.length; i += nth) {
    simplified.push(coords[i]);
  }
  // Always include last point
  const last = coords[coords.length - 1];
  if (simplified[simplified.length - 1] !== last) {
    simplified.push(last);
  }
  return simplified;
}

/**
 * Score and rank discovered POIs.
 *
 * @param {ScenicPOI[]} pois
 * @param {Array<[number,number,number?]>} routeCoords - Full route from ORS [lng, lat, elev?]
 * @param {object} options
 * @param {number} options.maxDetourKm - Maximum detour allowed (default 30)
 * @param {number} options.clusterRadiusKm - Radius for clustering bonus (default 15)
 * @param {Array<{lat: number, lng: number, name: string}>} options.noteHints - Geocoded route note locations
 * @returns {ScenicPOI[]} Sorted by score descending
 */
export function scorePOIs(pois, routeCoords, options = {}) {
  const { maxDetourKm = 30, clusterRadiusKm = 15, noteHints = [] } = options;
  const maxDetourMeters = maxDetourKm * 1000;
  const clusterRadiusMeters = clusterRadiusKm * 1000;

  // Simplify route for distance calculations
  const simplified = simplifyRoute(routeCoords, 20);

  // Compute distance from route for each POI
  const poisWithDist = pois.map(poi => ({
    ...poi,
    distanceFromRoute: distanceToRoute(poi, simplified),
  }));

  // Filter out POIs beyond max detour
  const withinRange = poisWithDist.filter(poi => poi.distanceFromRoute <= maxDetourMeters);

  // Score each POI
  const scored = withinRange.map(poi => {
    const catDef = CATEGORIES[poi.category] || { weight: 1 };

    // 1. Base weight
    let score = catDef.weight;

    // 2. Notability bonus
    if (poi.tags.name) score += 2;
    if (poi.tags.wikipedia) score += 3;
    if (poi.tags.wikidata) score += 2;
    if (poi.tags.description) score += 1;

    // 3. Detour penalty: -0.1 per km off-route
    const detourKm = poi.distanceFromRoute / 1000;
    score -= detourKm * 0.1;

    // 4. Clustering bonus: count neighbors within clusterRadiusKm
    let neighborCount = 0;
    for (const other of withinRange) {
      if (other.id === poi.id) continue;
      const dist = haversine(poi.lat, poi.lng, other.lat, other.lng);
      if (dist <= clusterRadiusMeters) {
        neighborCount++;
      }
    }
    score += Math.min(neighborCount * 0.5, 3.0);

    // 5. Note proximity bonus: boost POIs near user-mentioned places
    if (noteHints.length > 0) {
      let minNoteDist = Infinity;
      for (const hint of noteHints) {
        const d = haversine(poi.lat, poi.lng, hint.lat, hint.lng);
        if (d < minNoteDist) minNoteDist = d;
      }
      if (minNoteDist <= 25000) {
        score += 8; // Strong bonus within 25km of a note hint
      } else if (minNoteDist <= 50000) {
        score += 5; // Moderate bonus within 50km
      }
    }

    return { ...poi, score };
  });

  // Filter out non-positive scores and sort descending
  return scored
    .filter(poi => poi.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Project a point onto the start->end line to determine geographic order.
 * Returns a scalar (0..1) representing position from start to end.
 */
export function projectOntoLine(lat, lng, startLat, startLng, endLat, endLng) {
  const dx = endLng - startLng;
  const dy = endLat - startLat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;

  const px = lng - startLng;
  const py = lat - startLat;

  return (px * dx + py * dy) / lenSq;
}

/**
 * Select the best N waypoints from scored POIs that form a good route.
 * Uses greedy selection with minimum spacing and geographic ordering.
 *
 * @param {ScenicPOI[]} scoredPOIs - Scored & sorted POIs (descending by score)
 * @param {[number,number]} startCoords - [lat, lng] of trip start
 * @param {[number,number]} endCoords - [lat, lng] of trip end
 * @param {object} options
 * @param {number} options.maxWaypoints - Maximum waypoints to select (default 8)
 * @param {number} options.minSpacingKm - Minimum distance between selected waypoints (default 30)
 * @returns {ScenicPOI[]} Selected waypoints, ordered geographically along the route
 */
export function selectWaypoints(scoredPOIs, startCoords, endCoords, options = {}) {
  const { maxWaypoints = 8, minSpacingKm = 30 } = options;
  const minSpacingMeters = minSpacingKm * 1000;

  const selected = [];

  for (const poi of scoredPOIs) {
    if (selected.length >= maxWaypoints) break;

    // Check minimum spacing from all already-selected POIs
    let tooClose = false;
    for (const sel of selected) {
      const dist = haversine(poi.lat, poi.lng, sel.lat, sel.lng);
      if (dist < minSpacingMeters) {
        tooClose = true;
        break;
      }
    }

    // Also check not too close to start or end (within 10km)
    if (!tooClose) {
      const distToStart = haversine(poi.lat, poi.lng, startCoords[0], startCoords[1]);
      const distToEnd = haversine(poi.lat, poi.lng, endCoords[0], endCoords[1]);
      if (distToStart < 10000 || distToEnd < 10000) {
        tooClose = true;
      }
    }

    if (!tooClose) {
      selected.push(poi);
    }
  }

  // Sort by geographic projection along start->end axis
  const [startLat, startLng] = startCoords;
  const [endLat, endLng] = endCoords;

  return selected.sort((a, b) => {
    const projA = projectOntoLine(a.lat, a.lng, startLat, startLng, endLat, endLng);
    const projB = projectOntoLine(b.lat, b.lng, startLat, startLng, endLat, endLng);
    return projA - projB;
  });
}

/**
 * Extract place-name keywords from route notes text.
 * Strips leading prepositions and splits on connectors.
 *
 * @param {string} routeNotes - e.g. "going through the Adirondacks and along Lake Champlain"
 * @returns {string[]} Clean place name strings, e.g. ["Adirondacks", "Lake Champlain"]
 */
export function extractNoteKeywords(routeNotes) {
  if (!routeNotes || !routeNotes.trim()) return [];

  // Split on connectors
  const parts = routeNotes.split(/\s+(?:and|&|then)\s+|,\s*/i);

  return parts
    .map(part => {
      // Strip leading prepositions/phrases
      return part
        .trim()
        .replace(/^(?:going\s+)?(?:through|via|along|past|over|across|around|near|following|avoiding|stopping\s+(?:at|in|by)|taking|on|using|preferring)\s+(?:the\s+)?/i, '')
        .replace(/^(?:with\s+a?\s*(?:stop|detour|side\s*trip)\s+(?:at|in|by|near)\s+)/i, '')
        .trim()
        .replace(/[.,;:!?]+$/, '')
        .trim();
    })
    .filter(part => part.length > 0);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
