import { getBoundaryIndices, splitRouteAtBoundaries, splitRouteIntoDays } from '$lib/utils/segmentCalculator.js';
import { getRouteWithWaypoints } from '$lib/services/router.js';
import { getTripParams } from '$lib/state/tripState.svelte.js';
import { getOrsApiKey, startLoading, stopLoading, setErrorMessage } from '$lib/state/uiState.svelte.js';
import { projectOntoLine, haversine } from '$lib/services/corridorDiscovery.js';
import { milesToMeters, kmToMeters } from '$lib/utils/units.js';

let fullRoute = $state(null);

let routeSummary = $state({
  totalDistance: 0,
  totalAscent: 0,
  totalDescent: 0,
  bbox: null,
});

let daySegments = $state([]);

const totalPlannedDistance = $derived(
  daySegments.reduce((sum, seg) => sum + seg.distance, 0)
);

export function getFullRoute() {
  return fullRoute;
}

export function setFullRoute(route) {
  fullRoute = route;
}

export function getRouteSummary() {
  return routeSummary;
}

export function setRouteSummary(summary) {
  routeSummary = { ...routeSummary, ...summary };
}

export function getDaySegments() {
  return daySegments;
}

export function setDaySegments(segs) {
  daySegments = segs;
}

export function getTotalPlannedDistance() {
  return totalPlannedDistance;
}

export function updateDaySegment(dayIndex, updates) {
  daySegments = daySegments.map((seg, i) =>
    i === dayIndex ? { ...seg, ...updates } : seg
  );
}

/**
 * Move a day boundary marker to a new position on the route.
 * Called from MapContainer when a day marker is dropped on-route.
 *
 * @param {number} dayNumber - The day whose start boundary is being moved (2..totalDays)
 * @param {number} newCoordIndex - The coordinate index to use as the new boundary
 */
export function moveDayBoundary(dayNumber, newCoordIndex) {
  const coords = fullRoute?.features?.[0]?.geometry?.coordinates;
  if (!coords || daySegments.length === 0) return;

  const boundaries = getBoundaryIndices(coords, daySegments);
  const segIdx = dayNumber - 1; // 0-based index into boundaries array

  if (segIdx < 1 || segIdx >= boundaries.length) return;

  // Clamp: must stay between previous day's start (+2 points) and next day's start (-2 points)
  const minIdx = boundaries[segIdx - 1] + 2;
  const maxIdx = segIdx < boundaries.length - 1
    ? boundaries[segIdx + 1] - 2
    : coords.length - 3;

  boundaries[segIdx] = Math.max(minIdx, Math.min(maxIdx, newCoordIndex));

  const newSegments = splitRouteAtBoundaries(coords, boundaries, daySegments);
  daySegments = newSegments;
}

/**
 * Re-route through a detour waypoint when a day marker is dragged far off-route.
 * Calls ORS with the new waypoint inserted, then re-splits into day segments.
 *
 * @param {number} lat - Detour point latitude
 * @param {number} lng - Detour point longitude
 * @param {number} dayNumber - The day associated with the drag
 */
export async function rerouteWithDetour(lat, lng, dayNumber) {
  const params = getTripParams();
  const apiKey = getOrsApiKey();
  if (!apiKey || !params.startCoords || !params.endCoords) return;

  startLoading('Re-routing with detour...');
  setErrorMessage('');

  try {
    const [sLat, sLng] = params.startCoords;
    const [eLat, eLng] = params.endCoords;

    // Build waypoint list: existing note waypoints + new detour
    const noteWaypoints = [...(params.noteWaypoints || [])];
    const detourWp = { lat, lng, name: `Detour (Day ${dayNumber})`, distanceFromRoute: 0 };
    const allWaypoints = [...noteWaypoints, detourWp];

    // Sort geographically along route axis
    allWaypoints.sort((a, b) =>
      projectOntoLine(a.lat, a.lng, sLat, sLng, eLat, eLng) -
      projectOntoLine(b.lat, b.lng, sLat, sLng, eLat, eLng)
    );

    // Add distanceFromRoute for progressive fallback
    for (const wp of allWaypoints) {
      const proj = Math.max(0, Math.min(1, projectOntoLine(wp.lat, wp.lng, sLat, sLng, eLat, eLng)));
      const projLat = sLat + proj * (eLat - sLat);
      const projLng = sLng + proj * (eLng - sLng);
      wp.distanceFromRoute = haversine(wp.lat, wp.lng, projLat, projLng);
    }

    const routeData = await getRouteWithWaypoints(
      params.startCoords, params.endCoords, allWaypoints, apiKey, 'cycling-regular'
    );

    fullRoute = routeData;

    const feature = routeData.features?.[0];
    if (feature) {
      const summary = feature.properties?.summary || {};
      routeSummary = {
        totalDistance: summary.distance || 0,
        totalAscent: summary.ascent || 0,
        totalDescent: summary.descent || 0,
        bbox: routeData.bbox || feature.bbox || null,
      };

      const coordinates = feature.geometry?.coordinates || [];
      let dailyDistMeters = 0;
      if (params.dailyDistancePref > 0) {
        dailyDistMeters = params.units === 'miles'
          ? milesToMeters(params.dailyDistancePref)
          : kmToMeters(params.dailyDistancePref);
      }
      daySegments = splitRouteIntoDays(coordinates, params.totalDays, dailyDistMeters);
    }
  } catch (e) {
    setErrorMessage(e.message);
  } finally {
    stopLoading();
  }
}

export function resetRoute() {
  fullRoute = null;
  routeSummary = {
    totalDistance: 0,
    totalAscent: 0,
    totalDescent: 0,
    bbox: null,
  };
  daySegments = [];
}
