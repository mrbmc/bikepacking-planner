const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * Find supply stops near a point using Overpass API.
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMeters
 * @returns {Promise<Array<{id: number, lat: number, lng: number, name: string, type: string, tags: object}>>}
 */
export async function findSupplyStops(lat, lng, radiusMeters = 3000) {
  const query = `
    [out:json][timeout:25];
    (
      node["shop"="convenience"](around:${radiusMeters},${lat},${lng});
      node["shop"="supermarket"](around:${radiusMeters},${lat},${lng});
      node["amenity"="fuel"](around:${radiusMeters},${lat},${lng});
      node["amenity"="drinking_water"](around:${radiusMeters},${lat},${lng});
      node["tourism"="camp_site"](around:${radiusMeters},${lat},${lng});
      node["tourism"="motel"](around:${radiusMeters},${lat},${lng});
      node["tourism"="hotel"](around:${radiusMeters},${lat},${lng});
    );
    out body;
  `;

  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass query failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  return data.elements.map((el) => {
    let type = 'unknown';
    if (el.tags?.shop) type = el.tags.shop;
    else if (el.tags?.amenity) type = el.tags.amenity;
    else if (el.tags?.tourism) type = el.tags.tourism;

    return {
      id: el.id,
      lat: el.lat,
      lng: el.lon,
      name: el.tags?.name || type,
      type,
      tags: el.tags || {},
    };
  });
}

/**
 * Haversine distance between two points in meters.
 */
function haversine(lat1, lng1, lat2, lng2) {
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
 * Find supply stops at regular intervals along a route.
 * @param {Array<[number, number]>} routeCoords - Array of [lng, lat] coordinates
 * @param {number} intervalKm - Distance between sample points in km
 * @returns {Promise<Array<{id: number, lat: number, lng: number, name: string, type: string, tags: object}>>}
 */
export async function findSupplyStopsAlongRoute(routeCoords, intervalKm = 50) {
  if (!routeCoords || routeCoords.length === 0) {
    return [];
  }

  const intervalMeters = intervalKm * 1000;
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

  // Always include the end if it wasn't just added
  const lastCoord = routeCoords[routeCoords.length - 1];
  const lastSample = samplePoints[samplePoints.length - 1];
  if (lastSample.lat !== lastCoord[1] || lastSample.lng !== lastCoord[0]) {
    samplePoints.push({ lat: lastCoord[1], lng: lastCoord[0] });
  }

  // Query each sample point, with a small delay between requests to be polite
  const allStops = [];
  const seenIds = new Set();

  for (const point of samplePoints) {
    try {
      const stops = await findSupplyStops(point.lat, point.lng);
      for (const stop of stops) {
        if (!seenIds.has(stop.id)) {
          seenIds.add(stop.id);
          allStops.push(stop);
        }
      }
    } catch {
      // Skip failed queries but continue with remaining points
    }

    // Small delay to avoid overwhelming the Overpass API
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return allStops;
}
