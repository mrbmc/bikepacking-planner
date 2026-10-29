import { haversine } from './corridorDiscovery.js';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Maximum search radius cap (meters)
const MAX_SEARCH_RADIUS = 15000;

/**
 * Query Overpass for campsites near a point.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMeters
 * @returns {Promise<Array<{id, lat, lng, name, tags}>>}
 */
export async function findCampsitesNearPoint(lat, lng, radiusMeters) {
  const query = `
    [out:json][timeout:25];
    node["tourism"="camp_site"](around:${Math.round(radiusMeters)},${lat},${lng});
    out body;
  `;

  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Campsite query failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  return (data.elements || []).map(el => ({
    id: el.id,
    lat: el.lat,
    lng: el.lon,
    name: el.tags?.name || 'Unnamed Campsite',
    tags: el.tags || {},
  }));
}

/**
 * Score a campsite candidate for bikepacking suitability.
 * Returns a numeric score (higher = better).
 *
 * @param {object} campsite - { lat, lng, name, tags }
 * @param {number} targetLat - Ideal day-end latitude
 * @param {number} targetLng - Ideal day-end longitude
 * @returns {number}
 */
export function scoreCampsite(campsite, targetLat, targetLng) {
  let score = 3; // base score

  const { tags = {}, name } = campsite;

  // Named and not a generic placeholder
  if (name && name.toLowerCase() !== 'unnamed campsite' && name.toLowerCase() !== 'camp site') {
    score += 1;
  }

  // Access: reward public/permissive, penalize private
  if (tags.access === 'private' || tags.access === 'no') {
    score -= 5; // effectively excludes private campsites
  } else if (tags.access === 'public' || tags.access === 'permissive' || !tags.access) {
    score += 2;
  }

  // Free camping preferred
  if (tags.fee === 'yes') {
    // no bonus, neutral
  } else if (tags.fee === 'no' || !tags.fee) {
    score += 1;
  }

  // Tent camping explicitly allowed (or not blocked)
  if (tags.tents === 'no') {
    score -= 3;
  } else if (tags.tents === 'yes') {
    score += 1;
  }

  // Backcountry is ideal for bikepacking
  if (tags.backcountry === 'yes') {
    score += 2;
  }

  // Distance penalty from ideal day endpoint
  const distKm = haversine(campsite.lat, campsite.lng, targetLat, targetLng) / 1000;
  score -= distKm * 0.1;

  return score;
}

/**
 * Find the best campsite candidates for a single day segment.
 * Searches within a ±toleranceFraction window around the day's ideal endpoint.
 *
 * @param {object} daySegment - A day segment object with { distance, geometry }
 * @param {Array} fullRouteCoords - Full route coordinates [[lng, lat, ele?], ...]
 * @param {number} dayStartCumDist - Cumulative distance (meters) at start of this day
 * @param {number} toleranceFraction - e.g. 0.15 for ±15%
 * @returns {Promise<Array<object>>} Up to 3 scored campsite candidates, best first
 */
export async function findCampsitesForDay(daySegment, fullRouteCoords, dayStartCumDist, toleranceFraction = 0.15) {
  const targetDistM = daySegment.distance;
  const windowM = targetDistM * toleranceFraction;

  const idealEndDist = dayStartCumDist + targetDistM;
  const searchCenterDist = idealEndDist; // center on the ideal end

  // Build cumulative distances for the full route
  const cumDists = buildCumDists(fullRouteCoords);
  const totalRouteM = cumDists[cumDists.length - 1];

  // Find the route coordinate closest to the ideal endpoint distance
  const centerIdx = findIdxAtDist(cumDists, Math.min(searchCenterDist, totalRouteM));
  const centerCoord = fullRouteCoords[centerIdx];
  const centerLat = centerCoord[1];
  const centerLng = centerCoord[0];

  // Search radius = window, capped
  const radiusMeters = Math.min(windowM, MAX_SEARCH_RADIUS);
  if (radiusMeters < 500) return []; // too small to bother

  const candidates = await findCampsitesNearPoint(centerLat, centerLng, radiusMeters);

  if (candidates.length === 0) return [];

  // Score and sort
  const scored = candidates
    .map(c => ({
      ...c,
      score: scoreCampsite(c, centerLat, centerLng),
      distanceFromIdeal: haversine(c.lat, c.lng, centerLat, centerLng),
    }))
    .filter(c => c.score > 0) // exclude effectively-filtered private sites
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return scored;
}

/**
 * Find campsite candidates for all non-final day segments.
 *
 * @param {Array} daySegments
 * @param {Array} fullRouteCoords - Full route [[lng, lat, ele?], ...]
 * @param {function} [onProgress] - optional callback(dayIndex, total)
 * @returns {Promise<object>} Plain object: { [dayIndex]: CampsiteCandidate[] }
 */
export async function findCampsitesForAllDays(daySegments, fullRouteCoords, onProgress) {
  const results = {};

  // Build cumulative distances once for the full route
  const cumDists = buildCumDists(fullRouteCoords);

  // Compute cumulative start distance for each day
  let dayStartCumDist = 0;

  // We don't need campsites for the final day (no overnight)
  const overnightDays = daySegments.slice(0, -1);

  for (let i = 0; i < overnightDays.length; i++) {
    const seg = overnightDays[i];
    try {
      const candidates = await findCampsitesForDay(seg, fullRouteCoords, dayStartCumDist);
      results[i] = candidates;
    } catch (err) {
      console.warn(`[campsiteFinder] Day ${i + 1} query failed:`, err.message);
      results[i] = [];
    }

    dayStartCumDist += seg.distance;

    if (onProgress) onProgress(i + 1, overnightDays.length);

    // Rate-limit Overpass requests
    if (i < overnightDays.length - 1) {
      await new Promise(r => setTimeout(r, 600));
    }
  }

  return results;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Build cumulative distance array for a coordinate array.
 * @param {Array} coords - [[lng, lat, ele?], ...]
 * @returns {Array<number>} cumulative meters, same length as coords
 */
function buildCumDists(coords) {
  const dists = [0];
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    dists.push(dists[i - 1] + haversine(prev[1], prev[0], curr[1], curr[0]));
  }
  return dists;
}

/**
 * Find the coordinate index closest to a target cumulative distance.
 * @param {Array<number>} cumDists
 * @param {number} targetM
 * @returns {number} index
 */
function findIdxAtDist(cumDists, targetM) {
  let lo = 0;
  let hi = cumDists.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumDists[mid] < targetM) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
