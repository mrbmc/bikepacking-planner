const EARTH_RADIUS = 6371000; // meters

/**
 * Haversine distance between two points in meters.
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number}
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find the nearest point on a route polyline to a given lat/lng.
 *
 * Projects the point onto each consecutive line segment using parametric t,
 * then returns the closest vertex index and snapped coordinate.
 *
 * @param {number} lat - Dropped point latitude (Leaflet convention)
 * @param {number} lng - Dropped point longitude (Leaflet convention)
 * @param {Array<Array<number>>} routeCoords - Full route coordinates in ORS [lng, lat, ele] format
 * @returns {{ index: number, coord: [number, number, number], distance: number }}
 *   - index: coordinate array index of the nearest vertex
 *   - coord: the snapped [lng, lat, ele] coordinate on the route
 *   - distance: meters from the drop point to the snapped point
 */
export function snapToNearestRoutePoint(lat, lng, routeCoords) {
  if (!routeCoords || routeCoords.length === 0) {
    return { index: 0, coord: [0, 0, 0], distance: Infinity };
  }

  if (routeCoords.length === 1) {
    const c = routeCoords[0];
    return {
      index: 0,
      coord: c,
      distance: haversineDistance(lat, lng, c[1], c[0]),
    };
  }

  let bestIndex = 0;
  let bestDistance = Infinity;
  let bestCoord = routeCoords[0];

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const ax = routeCoords[i][0];     // lng
    const ay = routeCoords[i][1];     // lat
    const bx = routeCoords[i + 1][0]; // lng
    const by = routeCoords[i + 1][1]; // lat

    // Project point onto segment [a, b] using parametric t
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    let t = 0;
    if (lenSq > 0) {
      t = ((lng - ax) * dx + (lat - ay) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }

    const projLng = ax + t * dx;
    const projLat = ay + t * dy;
    const dist = haversineDistance(lat, lng, projLat, projLng);

    if (dist < bestDistance) {
      bestDistance = dist;
      // Snap to the nearest vertex (not interpolated point)
      const vertexIndex = t <= 0.5 ? i : i + 1;
      bestIndex = vertexIndex;
      bestCoord = routeCoords[vertexIndex];
    }
  }

  return {
    index: bestIndex,
    coord: bestCoord,
    distance: bestDistance,
  };
}
