const EARTH_RADIUS = 6371000; // meters

/**
 * Haversine distance between two coordinates in meters.
 * Coordinates can be [lng, lat] or [lng, lat, ele].
 * @param {Array<number>} coord1
 * @param {Array<number>} coord2
 * @returns {number} Distance in meters
 */
function haversineDistance(coord1, coord2) {
  const toRad = (deg) => (deg * Math.PI) / 180;

  const lat1 = toRad(coord1[1]);
  const lat2 = toRad(coord2[1]);
  const dLat = toRad(coord2[1] - coord1[1]);
  const dLng = toRad(coord2[0] - coord1[0]);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate cumulative distances along a coordinate array.
 * @param {Array<Array<number>>} coordinates - Array of [lng, lat, ele?]
 * @returns {Array<number>} Cumulative distances in meters (same length as coordinates)
 */
function getCumulativeDistances(coordinates) {
  const distances = [0];
  for (let i = 1; i < coordinates.length; i++) {
    distances.push(distances[i - 1] + haversineDistance(coordinates[i - 1], coordinates[i]));
  }
  return distances;
}

/**
 * Calculate elevation gain and loss for a slice of coordinates.
 * @param {Array<Array<number>>} coordinates - Array of [lng, lat, ele]
 * @returns {{ gain: number, loss: number }}
 */
function calcElevation(coordinates) {
  let gain = 0;
  let loss = 0;

  for (let i = 1; i < coordinates.length; i++) {
    const ele1 = coordinates[i - 1].length > 2 ? coordinates[i - 1][2] : 0;
    const ele2 = coordinates[i].length > 2 ? coordinates[i][2] : 0;
    const delta = ele2 - ele1;

    if (delta > 0) {
      gain += delta;
    } else {
      loss += Math.abs(delta);
    }
  }

  return { gain, loss };
}

/**
 * Split a route into daily segments.
 * @param {Array<Array<number>>} coordinates - Array of [lng, lat, ele] from ORS
 * @param {number} totalDays - Number of days for the trip
 * @param {number} dailyDistancePref - Preferred daily distance in meters (0 = auto/even split)
 * @returns {Array<object>} Array of segment objects
 */
export function splitRouteIntoDays(coordinates, totalDays, dailyDistancePref = 0) {
  if (!coordinates || coordinates.length < 2 || totalDays < 1) {
    return [];
  }

  const cumDist = getCumulativeDistances(coordinates);
  const totalDistance = cumDist[cumDist.length - 1];

  // Determine target distance per day
  const targetPerDay = dailyDistancePref > 0
    ? dailyDistancePref
    : totalDistance / totalDays;

  const segments = [];
  let segStartIdx = 0;

  for (let day = 1; day <= totalDays; day++) {
    const isLastDay = day === totalDays;

    if (isLastDay) {
      // Last day gets everything remaining
      const slice = coordinates.slice(segStartIdx);
      const { gain, loss } = calcElevation(slice);
      const segDistance = cumDist[coordinates.length - 1] - cumDist[segStartIdx];

      segments.push({
        day,
        startCoord: [coordinates[segStartIdx][1], coordinates[segStartIdx][0]],
        endCoord: [coordinates[coordinates.length - 1][1], coordinates[coordinates.length - 1][0]],
        startName: '',
        endName: '',
        distance: segDistance,
        elevationGain: gain,
        elevationLoss: loss,
        geometry: slice,
        accommodation: null,
        supplyStops: [],
        isLocked: false,
      });
      break;
    }

    // Walk forward until we reach the target distance for this day
    const targetCum = cumDist[segStartIdx] + targetPerDay;
    let segEndIdx = segStartIdx + 1;

    while (segEndIdx < coordinates.length - 1 && cumDist[segEndIdx] < targetCum) {
      segEndIdx++;
    }

    // Make sure we don't exceed the array or leave nothing for remaining days
    const maxIdx = coordinates.length - 1 - (totalDays - day);
    if (segEndIdx > maxIdx) {
      segEndIdx = maxIdx;
    }
    if (segEndIdx <= segStartIdx) {
      segEndIdx = segStartIdx + 1;
    }

    const slice = coordinates.slice(segStartIdx, segEndIdx + 1);
    const { gain, loss } = calcElevation(slice);
    const segDistance = cumDist[segEndIdx] - cumDist[segStartIdx];

    segments.push({
      day,
      startCoord: [coordinates[segStartIdx][1], coordinates[segStartIdx][0]],
      endCoord: [coordinates[segEndIdx][1], coordinates[segEndIdx][0]],
      startName: '',
      endName: '',
      distance: segDistance,
      elevationGain: gain,
      elevationLoss: loss,
      geometry: slice,
      accommodation: null,
      supplyStops: [],
      isLocked: false,
    });

    segStartIdx = segEndIdx;
  }

  return segments;
}

/**
 * Recalculate segments when a user adjusts a day's distance.
 * @param {Array<Array<number>>} coordinates - Full route coordinates
 * @param {Array<object>} daySegments - Current segment array
 * @param {number} changedDayIndex - Index of the day that was changed
 * @param {number} newDistance - New distance in meters for the changed day
 * @returns {Array<object>} Updated segment array
 */
export function recalculateSegments(coordinates, daySegments, changedDayIndex, newDistance) {
  if (!coordinates || coordinates.length < 2 || !daySegments || daySegments.length === 0) {
    return daySegments;
  }

  // Clone and mark the changed day as locked
  const updated = daySegments.map((seg, i) => ({
    ...seg,
    isLocked: seg.isLocked || i === changedDayIndex,
    distance: i === changedDayIndex ? newDistance : seg.distance,
  }));

  // Sum locked distances
  const lockedDistance = updated
    .filter((s) => s.isLocked)
    .reduce((sum, s) => sum + s.distance, 0);

  const cumDist = getCumulativeDistances(coordinates);
  const totalDistance = cumDist[cumDist.length - 1];

  // Calculate remaining distance for unlocked days
  const unlockedDays = updated.filter((s) => !s.isLocked);
  const remainingDistance = totalDistance - lockedDistance;
  const distPerUnlockedDay = unlockedDays.length > 0
    ? Math.max(0, remainingDistance / unlockedDays.length)
    : 0;

  // Assign target distances
  const targets = updated.map((seg) =>
    seg.isLocked ? seg.distance : distPerUnlockedDay
  );

  // Re-walk the coordinates with new targets
  const newSegments = [];
  let segStartIdx = 0;

  for (let day = 0; day < updated.length; day++) {
    const isLastDay = day === updated.length - 1;

    if (isLastDay) {
      const slice = coordinates.slice(segStartIdx);
      const { gain, loss } = calcElevation(slice);
      const segDistance = cumDist[coordinates.length - 1] - cumDist[segStartIdx];

      newSegments.push({
        ...updated[day],
        startCoord: [coordinates[segStartIdx][1], coordinates[segStartIdx][0]],
        endCoord: [coordinates[coordinates.length - 1][1], coordinates[coordinates.length - 1][0]],
        distance: segDistance,
        elevationGain: gain,
        elevationLoss: loss,
        geometry: slice,
      });
      break;
    }

    const targetCum = cumDist[segStartIdx] + targets[day];
    let segEndIdx = segStartIdx + 1;

    while (segEndIdx < coordinates.length - 1 && cumDist[segEndIdx] < targetCum) {
      segEndIdx++;
    }

    // Ensure remaining days have at least one point each
    const maxIdx = coordinates.length - 1 - (updated.length - 1 - day);
    if (segEndIdx > maxIdx) {
      segEndIdx = maxIdx;
    }
    if (segEndIdx <= segStartIdx) {
      segEndIdx = segStartIdx + 1;
    }

    const slice = coordinates.slice(segStartIdx, segEndIdx + 1);
    const { gain, loss } = calcElevation(slice);
    const segDistance = cumDist[segEndIdx] - cumDist[segStartIdx];

    newSegments.push({
      ...updated[day],
      startCoord: [coordinates[segStartIdx][1], coordinates[segStartIdx][0]],
      endCoord: [coordinates[segEndIdx][1], coordinates[segEndIdx][0]],
      distance: segDistance,
      elevationGain: gain,
      elevationLoss: loss,
      geometry: slice,
    });

    segStartIdx = segEndIdx;
  }

  return newSegments;
}

/**
 * Extract coordinate boundary indices from current segments.
 * Each segment's startCoord [lat, lng] is matched to the closest index in the route coordinates.
 *
 * @param {Array<Array<number>>} coordinates - Full route coordinates in [lng, lat, ele] format
 * @param {Array<object>} segments - Current day segments
 * @returns {Array<number>} Array of coordinate indices, one per segment
 */
export function getBoundaryIndices(coordinates, segments) {
  if (!coordinates || !segments || segments.length === 0) return [];

  const indices = [];

  for (const seg of segments) {
    const [sLat, sLng] = seg.startCoord;
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < coordinates.length; i++) {
      const cLat = coordinates[i][1];
      const cLng = coordinates[i][0];
      // Use squared euclidean for fast comparison (exact match expected)
      const d = (cLat - sLat) ** 2 + (cLng - sLng) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
      // Exact match — early exit
      if (d === 0) break;
    }

    indices.push(bestIdx);
  }

  return indices;
}

/**
 * Re-split the route into day segments using explicit boundary indices.
 * Called after a user drags a day boundary marker to a new position on the route.
 *
 * @param {Array<Array<number>>} coordinates - Full route [lng, lat, ele] array
 * @param {Array<number>} boundaryIndices - Coordinate index where each day starts (length = totalDays, first is always 0)
 * @param {Array<object>} existingSegments - Current segments (to preserve accommodation, supplyStops, etc.)
 * @returns {Array<object>} New segment array
 */
export function splitRouteAtBoundaries(coordinates, boundaryIndices, existingSegments) {
  if (!coordinates || coordinates.length < 2 || boundaryIndices.length === 0) {
    return [];
  }

  const cumDist = getCumulativeDistances(coordinates);
  const lastIdx = coordinates.length - 1;
  const segments = [];

  for (let i = 0; i < boundaryIndices.length; i++) {
    const startIdx = boundaryIndices[i];
    const endIdx = i < boundaryIndices.length - 1 ? boundaryIndices[i + 1] : lastIdx;

    const slice = coordinates.slice(startIdx, endIdx + 1);
    const { gain, loss } = calcElevation(slice);
    const segDistance = cumDist[endIdx] - cumDist[startIdx];

    // Preserve non-geometric properties from existing segment if available
    const existing = existingSegments[i] || {};

    segments.push({
      day: i + 1,
      startCoord: [coordinates[startIdx][1], coordinates[startIdx][0]],
      endCoord: [coordinates[endIdx][1], coordinates[endIdx][0]],
      startName: existing.startName || '',
      endName: existing.endName || '',
      distance: segDistance,
      elevationGain: gain,
      elevationLoss: loss,
      geometry: slice,
      accommodation: existing.accommodation || null,
      supplyStops: existing.supplyStops || [],
      isLocked: false, // Reset lock since boundary was manually moved
    });
  }

  return segments;
}

/**
 * Get elevation statistics for a coordinate slice.
 * @param {Array<Array<number>>} coordinates - Array of [lng, lat, ele]
 * @returns {{ gain: number, loss: number, min: number, max: number, profile: Array<{distance: number, elevation: number}> }}
 */
export function getElevationStats(coordinates) {
  if (!coordinates || coordinates.length === 0) {
    return { gain: 0, loss: 0, min: 0, max: 0, profile: [] };
  }

  let gain = 0;
  let loss = 0;
  let min = Infinity;
  let max = -Infinity;
  let cumDist = 0;

  const profile = [];

  for (let i = 0; i < coordinates.length; i++) {
    const ele = coordinates[i].length > 2 ? coordinates[i][2] : 0;

    if (ele < min) min = ele;
    if (ele > max) max = ele;

    if (i > 0) {
      cumDist += haversineDistance(coordinates[i - 1], coordinates[i]);

      const prevEle = coordinates[i - 1].length > 2 ? coordinates[i - 1][2] : 0;
      const delta = ele - prevEle;
      if (delta > 0) {
        gain += delta;
      } else {
        loss += Math.abs(delta);
      }
    }

    profile.push({ distance: cumDist, elevation: ele });
  }

  if (min === Infinity) min = 0;
  if (max === -Infinity) max = 0;

  return { gain, loss, min, max, profile };
}
