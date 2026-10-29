/**
 * Parse a natural language trip description into structured parameters.
 * Separates actual locations from route notes/preferences.
 * @param {string} input - e.g. "Bike from Portland to Burlington, VT going through the Adirondack Park in 7 days"
 * @returns {{ startName: string|null, endName: string|null, totalDays: number|null, dailyDistance: number|null, units: string|null, routeNotes: string|null }}
 */
export function parseTrip(input) {
  if (!input || !input.trim()) {
    return { startName: null, endName: null, totalDays: null, dailyDistance: null, units: null, routeNotes: null };
  }

  const text = input.trim();

  const totalDays = parseDays(text);
  const { dailyDistance, units } = parseDailyDistance(text);
  const { start, end, notes } = parseLocations(text);

  return {
    startName: start,
    endName: end,
    totalDays,
    dailyDistance,
    units,
    routeNotes: notes,
  };
}

/**
 * Extract duration in days from text.
 */
function parseDays(text) {
  const patterns = [
    /\bin\s+(\d+)\s+days?\b/i,
    /(\d+)[- ]day\b/i,
    /\bover\s+(\d+)\s+days?\b/i,
    /\bfor\s+(\d+)\s+days?\b/i,
    /(\d+)\s+days?\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const days = parseInt(match[1], 10);
      if (days > 0 && days < 365) {
        return days;
      }
    }
  }

  return null;
}

/**
 * Extract daily distance preference from text.
 */
function parseDailyDistance(text) {
  const patterns = [
    { regex: /(\d+(?:\.\d+)?)\s*(?:miles?|mi)\s*(?:per|\/|a)\s*day/i, unit: 'miles' },
    { regex: /(\d+(?:\.\d+)?)\s*mpd/i, unit: 'miles' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:km|kilometers?|kilometres?)\s*(?:per|\/|a)\s*day/i, unit: 'km' },
    { regex: /(\d+(?:\.\d+)?)\s*kpd/i, unit: 'km' },
  ];

  for (const { regex, unit } of patterns) {
    const match = text.match(regex);
    if (match) {
      const dist = parseFloat(match[1]);
      if (dist > 0) {
        return { dailyDistance: dist, units: unit };
      }
    }
  }

  return { dailyDistance: null, units: null };
}

/**
 * Route note phrases that should NOT be part of the end location.
 * These introduce route preferences, waypoints, or scenic instructions.
 */
const NOTE_PATTERNS = [
  /\s+(?:going\s+)?(?:through|via|along|past|over|across|around|near|avoiding|following)\s+/i,
  /\s+(?:stopping\s+(?:at|in|by))\s+/i,
  /\s+(?:taking|on)\s+(?:the\s+)?/i,
  /\s+(?:using|prefer(?:ring)?)\s+/i,
  /\s+(?:with\s+a?\s*(?:stop|detour|side\s*trip))\s+/i,
];

/**
 * Extract start and end locations from text, separating route notes.
 */
function parseLocations(text) {
  // Strip leading action verbs
  const verbPattern = /^(?:bike|bikepack|ride|cycle|pedal|go|travel|tour|trek)\s+/i;

  // First strip duration and distance phrases to simplify
  let cleaned = text
    .replace(/\bin\s+\d+\s+days?\b/i, '')
    .replace(/\d+[- ]day\s*(?:trip|ride|tour)?\b/i, '')
    .replace(/\bover\s+\d+\s+days?\b/i, '')
    .replace(/\bfor\s+\d+\s+days?\b/i, '')
    .replace(/\d+(?:\.\d+)?\s*(?:miles?|mi|km|kilometers?)\s*(?:per|\/|a)\s*day/i, '')
    .replace(/\d+(?:\.\d+)?\s*(?:mpd|kpd)/i, '')
    .trim();

  // Try "from X to Y" pattern
  const fromToMatch = cleaned.match(/\bfrom\s+(.+?)\s+to\s+(.+)/i);
  if (fromToMatch) {
    return splitEndAndNotes(cleanLocation(fromToMatch[1]), fromToMatch[2]);
  }

  // Try "X to Y" pattern (after stripping verb prefix)
  const stripped = cleaned.replace(verbPattern, '');
  const toMatch = stripped.match(/^(.+?)\s+to\s+(.+)/i);
  if (toMatch) {
    return splitEndAndNotes(cleanLocation(toMatch[1]), toMatch[2]);
  }

  return { start: null, end: null, notes: null };
}

/**
 * Given the raw "end + possible notes" string, separate the actual end location
 * from route notes like "going through the Adirondack Park".
 */
function splitEndAndNotes(start, rawEnd) {
  const trimmed = rawEnd.trim();

  // Check each note pattern to see if it splits the end from notes
  for (const pattern of NOTE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const idx = trimmed.search(pattern);
      const endPart = trimmed.substring(0, idx);
      const notesPart = trimmed.substring(idx).trim();

      const cleanedEnd = cleanLocation(endPart);
      const cleanedNotes = cleanNotes(notesPart);

      if (cleanedEnd) {
        return { start, end: cleanedEnd, notes: cleanedNotes };
      }
    }
  }

  // No notes found — the whole thing is the end location
  return { start, end: cleanLocation(trimmed), notes: null };
}

/**
 * Clean up route notes text.
 */
function cleanNotes(text) {
  if (!text) return null;
  let cleaned = text.trim();
  cleaned = cleaned.replace(/[.,;:!?]+$/, '');
  cleaned = cleaned.trim();
  return cleaned || null;
}

/**
 * Clean up a parsed location name.
 */
function cleanLocation(name) {
  if (!name) return null;

  let cleaned = name.trim();

  // Remove leading verbs that might have been captured
  cleaned = cleaned.replace(/^(?:bike|bikepack|ride|cycle|pedal|go|travel|tour|trek)\s+/i, '');

  // Remove trailing punctuation
  cleaned = cleaned.replace(/[.,;:!?]+$/, '');

  // Remove trailing dangling prepositions
  cleaned = cleaned.replace(/\s+(?:in|over|for|at|to)\s*$/i, '');

  cleaned = cleaned.trim();

  return cleaned || null;
}
