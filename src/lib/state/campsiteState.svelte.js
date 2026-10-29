/** @type {object} Plain object: dayIndex (number) → CampsiteCandidate[] */
let campsiteCandidates = $state({});

/** @type {object} Plain object: dayIndex (number) → CampsiteCandidate | null */
let selectedCampsites = $state({});

/** @type {Set<number>} Day indices the user has dismissed */
let dismissedDays = $state(new Set());

/** @type {'idle' | 'loading' | 'done' | 'error'} */
let campsiteStatus = $state('idle');

/** @type {string} */
let campsiteError = $state('');

// ─── Getters ───────────────────────────────────────────────────────────────

export function getCampsiteCandidates() {
  return campsiteCandidates;
}

export function getSelectedCampsites() {
  return selectedCampsites;
}

export function getDismissedDays() {
  return dismissedDays;
}

export function getCampsiteStatus() {
  return campsiteStatus;
}

export function getCampsiteError() {
  return campsiteError;
}

// ─── Setters ───────────────────────────────────────────────────────────────

export function setCampsiteCandidates(candidates) {
  campsiteCandidates = candidates;
  // Auto-select the top-scored candidate for each day
  const autoSelected = {};
  for (const [dayIdx, list] of Object.entries(candidates)) {
    autoSelected[dayIdx] = list.length > 0 ? list[0] : null;
  }
  selectedCampsites = autoSelected;
}

export function setCampsiteStatus(s) {
  campsiteStatus = s;
}

export function setCampsiteError(e) {
  campsiteError = e;
}

// ─── Actions ──────────────────────────────────────────────────────────────

/**
 * Select a specific campsite for a day, or null to deselect.
 * @param {number} dayIndex
 * @param {object|null} campsite
 */
export function selectCampsite(dayIndex, campsite) {
  selectedCampsites = { ...selectedCampsites, [dayIndex]: campsite };
}

/**
 * Dismiss campsite recommendations for a day (user prefers to handle it themselves).
 * @param {number} dayIndex
 */
export function dismissCampsiteDay(dayIndex) {
  const next = new Set(dismissedDays);
  next.add(dayIndex);
  dismissedDays = next;
  // Remove selection for dismissed day
  const updated = { ...selectedCampsites };
  delete updated[dayIndex];
  selectedCampsites = updated;
}

export function resetCampsites() {
  campsiteCandidates = {};
  selectedCampsites = {};
  dismissedDays = new Set();
  campsiteStatus = 'idle';
  campsiteError = '';
}
