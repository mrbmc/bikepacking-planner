/** @type {'idle' | 'loading' | 'done' | 'error'} */
let narrationStatus = $state('idle');

/** @type {object | null} TripNarration object from LLM */
let narration = $state(null);

/** @type {string} Error message if narration failed */
let narrationError = $state('');

export function getNarration() {
  return narration;
}

export function setNarration(n) {
  narration = n;
}

export function getNarrationStatus() {
  return narrationStatus;
}

export function setNarrationStatus(s) {
  narrationStatus = s;
}

export function getNarrationError() {
  return narrationError;
}

export function setNarrationError(e) {
  narrationError = e;
}

export function resetNarration() {
  narration = null;
  narrationStatus = 'idle';
  narrationError = '';
}
