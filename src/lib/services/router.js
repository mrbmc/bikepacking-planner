const ORS_BASE_URL = 'https://api.openrouteservice.org/v2/directions';

/**
 * Get a cycling route between two points using OpenRouteService.
 * @param {[number, number]} startCoords - [lat, lng]
 * @param {[number, number]} endCoords - [lat, lng]
 * @param {string} apiKey - ORS API key
 * @param {string} profile - Routing profile
 * @returns {Promise<object>} GeoJSON response
 */
export async function getRoute(startCoords, endCoords, apiKey, profile = 'cycling-regular') {
  if (!apiKey) {
    throw new Error('OpenRouteService API key is required. Get one at openrouteservice.org');
  }

  if (!startCoords || !endCoords) {
    throw new Error('Both start and end coordinates are required');
  }

  // ORS expects [lng, lat] format
  const coordinates = [
    [startCoords[1], startCoords[0]],
    [endCoords[1], endCoords[0]],
  ];

  const body = {
    coordinates,
    elevation: true,
    instructions: true,
    geometry_simplify: false,
    extra_info: ['surface'],
  };

  const response = await fetch(`${ORS_BASE_URL}/${profile}/geojson`, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid API key. Check your OpenRouteService API key and try again.');
    }
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please wait a moment and try again.');
    }
    if (response.status === 404) {
      throw new Error('No route found between these locations. They may be too far apart or unreachable by bike.');
    }

    let errorDetail = '';
    try {
      const errorBody = await response.json();
      errorDetail = errorBody.error?.message || errorBody.message || '';
    } catch {
      // ignore parse errors
    }
    throw new Error(`Routing failed (${response.status}): ${errorDetail || response.statusText}`);
  }

  const data = await response.json();
  return data;
}

/**
 * Attempt a single ORS routing request.
 * @param {Array<[number,number]>} coordinates - [[lng,lat], ...]
 * @param {string} apiKey
 * @param {string} profile
 * @returns {Promise<{ok: boolean, status: number, data?: object, errorDetail?: string}>}
 */
async function tryRoute(coordinates, apiKey, profile) {
  const body = {
    coordinates,
    elevation: true,
    instructions: true,
    geometry_simplify: false,
    extra_info: ['surface'],
    radiuses: coordinates.map(() => 350), // snap to nearest road within 350m (public API max)
  };

  const response = await fetch(`${ORS_BASE_URL}/${profile}/geojson`, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (response.ok) {
    const data = await response.json();
    return { ok: true, status: response.status, data };
  }

  let errorDetail = '';
  try {
    const errorBody = await response.json();
    errorDetail = errorBody.error?.message || errorBody.message || '';
  } catch {
    // ignore parse errors
  }

  return { ok: false, status: response.status, errorDetail };
}

/**
 * Get a cycling route through multiple waypoints using OpenRouteService.
 * Includes progressive fallback: on routing failure (404), removes the
 * most problematic waypoints one at a time and retries until routing succeeds.
 *
 * @param {[number, number]} startCoords - [lat, lng]
 * @param {[number, number]} endCoords - [lat, lng]
 * @param {Array<{lat: number, lng: number, name?: string, distanceFromRoute?: number}>} waypoints - Intermediate points
 * @param {string} apiKey - ORS API key
 * @param {string} profile - Routing profile
 * @returns {Promise<object>} GeoJSON response with optional _droppedWaypoints array
 */
export async function getRouteWithWaypoints(startCoords, endCoords, waypoints, apiKey, profile = 'cycling-regular') {
  if (!apiKey) {
    throw new Error('OpenRouteService API key is required. Get one at openrouteservice.org');
  }

  if (!startCoords || !endCoords) {
    throw new Error('Both start and end coordinates are required');
  }

  if (!waypoints || waypoints.length === 0) {
    // No waypoints — fall back to direct routing
    return getRoute(startCoords, endCoords, apiKey, profile);
  }

  if (waypoints.length > 48) {
    throw new Error(`Too many waypoints (${waypoints.length}). Maximum is 48 intermediate waypoints.`);
  }

  // Work with a mutable copy sorted by distanceFromRoute (descending) for removal priority
  let remainingWaypoints = [...waypoints];
  const droppedWaypoints = [];

  while (true) {
    // Build coordinates array: start + remaining waypoints + end (ORS [lng, lat] format)
    const coordinates = [
      [startCoords[1], startCoords[0]],
      ...remainingWaypoints.map(wp => [wp.lng, wp.lat]),
      [endCoords[1], endCoords[0]],
    ];

    const result = await tryRoute(coordinates, apiKey, profile);

    if (result.ok) {
      // Success! Attach dropped waypoints info if any were removed
      const data = result.data;
      if (droppedWaypoints.length > 0) {
        data._droppedWaypoints = droppedWaypoints;
      }
      return data;
    }

    // Non-recoverable errors
    if (result.status === 401) {
      throw new Error('Invalid API key. Check your OpenRouteService API key and try again.');
    }
    if (result.status === 429) {
      throw new Error('Rate limit exceeded. Please wait a moment and try again.');
    }

    // For 404 or other routing failures, try removing the worst waypoint
    if (remainingWaypoints.length === 0) {
      // No more waypoints to remove — try direct route as last resort
      const directResult = await tryRoute(
        [[startCoords[1], startCoords[0]], [endCoords[1], endCoords[0]]],
        apiKey,
        profile
      );
      if (directResult.ok) {
        const data = directResult.data;
        data._droppedWaypoints = droppedWaypoints;
        return data;
      }
      throw new Error(`Routing failed (${result.status}): ${result.errorDetail || 'No route found even without waypoints.'}`);
    }

    // Find the waypoint with the highest distanceFromRoute to remove first.
    // Use >= so that when all distances are equal (e.g. all 0), the last
    // waypoint is removed first — a safer default than removing the first.
    let worstIdx = 0;
    let worstDist = -1;
    for (let i = 0; i < remainingWaypoints.length; i++) {
      const d = remainingWaypoints[i].distanceFromRoute || 0;
      if (d >= worstDist) {
        worstDist = d;
        worstIdx = i;
      }
    }

    const dropped = remainingWaypoints[worstIdx];
    console.warn(`[route] Dropping waypoint "${dropped.name || 'unnamed'}" (distanceFromRoute: ${Math.round(worstDist)}m) due to routing failure`);
    droppedWaypoints.push(dropped);
    remainingWaypoints = remainingWaypoints.filter((_, i) => i !== worstIdx);
  }
}
