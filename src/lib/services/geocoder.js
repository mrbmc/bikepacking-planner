const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

/**
 * Geocode a place name using Nominatim.
 * @param {string} placeName - The place to search for
 * @param {object} [options] - Optional geocoding options
 * @param {[number,number,number,number]} [options.viewbox] - Preferred area [west, south, east, north]
 * @param {boolean} [options.bounded] - If true, restrict results to viewbox only
 * @returns {Promise<Array<{name: string, lat: number, lng: number, type: string, class: string, importance: number}>>}
 */
export async function geocode(placeName, options = {}) {
  if (!placeName || !placeName.trim()) {
    return [];
  }

  const params = new URLSearchParams({
    q: placeName.trim(),
    format: 'json',
    limit: '5',
    addressdetails: '1',
  });

  // Viewbox biasing: prefer results within a geographic area
  if (options.viewbox) {
    const [west, south, east, north] = options.viewbox;
    params.set('viewbox', `${west},${north},${east},${south}`);
    params.set('bounded', options.bounded ? '1' : '0');
  }

  const response = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: {
      'User-Agent': 'BikepackingPlanner/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Geocoding failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  return data.map((item) => ({
    name: item.display_name,
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    type: item.type || 'unknown',
    class: item.class || 'unknown',
    importance: item.importance || 0,
  }));
}

/**
 * Find a routable point (town/village) near the given coordinates.
 * Useful for large regions like parks where the centroid may be far from any road.
 * Searches for the nearest village/town within ~0.5 degrees of the point.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string} [name] - Name of the original waypoint (for logging)
 * @returns {Promise<{lat: number, lng: number, name: string} | null>}
 */
export async function findRoutablePoint(lat, lng, name = '') {
  // Search for a village or town near the coordinates
  const buffer = 0.5; // ~55km
  const viewbox = [lng - buffer, lat - buffer, lng + buffer, lat + buffer];

  const params = new URLSearchParams({
    q: 'village',
    format: 'json',
    limit: '5',
    viewbox: `${viewbox[0]},${viewbox[3]},${viewbox[2]},${viewbox[1]}`,
    bounded: '1',
  });

  const response = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { 'User-Agent': 'BikepackingPlanner/1.0' },
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.length === 0) return null;

  // Pick the closest result to the original point
  let closest = null;
  let closestDist = Infinity;
  for (const item of data) {
    const dLat = parseFloat(item.lat) - lat;
    const dLng = parseFloat(item.lon) - lng;
    const dist = dLat * dLat + dLng * dLng;
    if (dist < closestDist) {
      closestDist = dist;
      closest = item;
    }
  }

  if (!closest) return null;

  const townName = closest.name || closest.display_name?.split(',')[0] || 'nearby town';
  console.log(`[route] Snapped "${name}" to routable point: ${townName} (${closest.lat}, ${closest.lon})`);

  return {
    lat: parseFloat(closest.lat),
    lng: parseFloat(closest.lon),
    name: name,
  };
}
