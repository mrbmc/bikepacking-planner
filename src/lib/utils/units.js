export const METERS_PER_MILE = 1609.34;
export const METERS_PER_KM = 1000;

export function metersToMiles(m) {
  return m / METERS_PER_MILE;
}

export function milesToMeters(mi) {
  return mi * METERS_PER_MILE;
}

export function metersToKm(m) {
  return m / METERS_PER_KM;
}

export function kmToMeters(km) {
  return km * METERS_PER_KM;
}

export function metersToFeet(m) {
  return m * 3.28084;
}

/**
 * Format a distance in meters to a human-readable string.
 * @param {number} meters
 * @param {string} units - 'miles' or 'km'
 * @returns {string} e.g. "64.2 mi" or "103.4 km"
 */
export function formatDistance(meters, units = 'miles') {
  if (units === 'miles') {
    return `${metersToMiles(meters).toFixed(1)} mi`;
  }
  return `${metersToKm(meters).toFixed(1)} km`;
}

/**
 * Format an elevation in meters to a human-readable string.
 * When units='miles', shows feet; when units='km', shows meters.
 * @param {number} meters
 * @param {string} units - 'miles' or 'km'
 * @returns {string} e.g. "2,450 ft" or "747 m"
 */
export function formatElevation(meters, units = 'miles') {
  if (units === 'miles') {
    return `${Math.round(metersToFeet(meters)).toLocaleString()} ft`;
  }
  return `${Math.round(meters).toLocaleString()} m`;
}
