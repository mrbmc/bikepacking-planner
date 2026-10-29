import { getCategories } from '$lib/services/corridorDiscovery.js';

/** @type {import('$lib/services/corridorDiscovery.js').ScenicPOI[]} All discovered POIs from corridor search */
let allDiscoveredPOIs = $state([]);

/** @type {import('$lib/services/corridorDiscovery.js').ScenicPOI[]} Scored/ranked subset */
let scoredPOIs = $state([]);

/** @type {import('$lib/services/corridorDiscovery.js').ScenicPOI[]} System-recommended waypoints */
let recommendedWaypoints = $state([]);

/** @type {import('$lib/services/corridorDiscovery.js').ScenicPOI[]} User's selected waypoints */
let selectedWaypoints = $state([]);

/** @type {boolean} Whether discovery has been run */
let discoveryComplete = $state(false);

/** @type {boolean} Whether waypoints have been applied to the route */
let waypointsApplied = $state(false);

/** @type {number} Discovery progress (0-100) */
let discoveryProgress = $state(0);

/** @type {string} Discovery status message */
let discoveryStatus = $state('');

/** @type {Set<string>} Active category filters */
let activeCategories = $state(new Set(Object.keys(getCategories())));

// --- Getters ---

export function getAllDiscoveredPOIs() {
  return allDiscoveredPOIs;
}

export function getScoredPOIs() {
  return scoredPOIs;
}

export function getRecommendedWaypoints() {
  return recommendedWaypoints;
}

export function getSelectedWaypoints() {
  return selectedWaypoints;
}

export function getDiscoveryComplete() {
  return discoveryComplete;
}

export function getWaypointsApplied() {
  return waypointsApplied;
}

export function getDiscoveryProgress() {
  return discoveryProgress;
}

export function getDiscoveryStatus() {
  return discoveryStatus;
}

export function getActiveCategories() {
  return activeCategories;
}

// --- Setters ---

export function setAllDiscoveredPOIs(pois) {
  allDiscoveredPOIs = pois;
}

export function setScoredPOIs(pois) {
  scoredPOIs = pois;
}

export function setRecommendedWaypoints(pois) {
  recommendedWaypoints = pois;
}

export function setSelectedWaypoints(pois) {
  selectedWaypoints = pois;
}

export function setDiscoveryComplete(val) {
  discoveryComplete = val;
}

export function setWaypointsApplied(val) {
  waypointsApplied = val;
}

export function setDiscoveryProgress(val) {
  discoveryProgress = val;
}

export function setDiscoveryStatus(msg) {
  discoveryStatus = msg;
}

// --- Actions ---

/**
 * Toggle a POI in the selected waypoints list.
 * If it's already selected (by ID), remove it; otherwise add it.
 */
export function toggleWaypoint(poi) {
  const idx = selectedWaypoints.findIndex(wp => wp.id === poi.id);
  if (idx >= 0) {
    selectedWaypoints = selectedWaypoints.filter((_, i) => i !== idx);
  } else {
    selectedWaypoints = [...selectedWaypoints, poi];
  }
  // Whenever waypoints change, mark as not yet applied
  waypointsApplied = false;
}

/**
 * Toggle a category filter on/off.
 */
export function toggleCategory(category) {
  const next = new Set(activeCategories);
  if (next.has(category)) {
    next.delete(category);
  } else {
    next.add(category);
  }
  activeCategories = next;
}

/**
 * Reset all discovery state.
 */
export function resetDiscovery() {
  allDiscoveredPOIs = [];
  scoredPOIs = [];
  recommendedWaypoints = [];
  selectedWaypoints = [];
  discoveryComplete = false;
  waypointsApplied = false;
  discoveryProgress = 0;
  discoveryStatus = '';
  activeCategories = new Set(Object.keys(getCategories()));
}
