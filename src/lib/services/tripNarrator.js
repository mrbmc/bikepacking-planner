import { metersToMiles, metersToFeet } from '$lib/utils/units.js';

const METERS_PER_FOOT = 0.3048;

/**
 * Extract elevation profile summary from a day segment's geometry.
 * ORS geometry coordinates are [lng, lat, elevation_meters].
 *
 * @param {Array} geometry - [[lng, lat, ele], ...]
 * @returns {{ startElevFt: number, maxElevFt: number, endElevFt: number }}
 */
function getElevationProfile(geometry) {
  if (!geometry || geometry.length === 0) {
    return { startElevFt: 0, maxElevFt: 0, endElevFt: 0 };
  }

  const hasElevation = geometry[0].length >= 3;
  if (!hasElevation) {
    return { startElevFt: 0, maxElevFt: 0, endElevFt: 0 };
  }

  const startElevFt = Math.round(geometry[0][2] / METERS_PER_FOOT);
  const endElevFt = Math.round(geometry[geometry.length - 1][2] / METERS_PER_FOOT);
  let maxElevM = -Infinity;
  for (const coord of geometry) {
    if (coord[2] > maxElevM) maxElevM = coord[2];
  }
  const maxElevFt = Math.round(maxElevM / METERS_PER_FOOT);

  return { startElevFt, maxElevFt, endElevFt };
}

/**
 * Assign scenic waypoints (from discoveryState.selectedWaypoints) to day segments
 * by finding which day's coordinate range they geographically fall within.
 * Uses a simple bounding-box approach per segment.
 *
 * @param {Array} selectedWaypoints - [{lat, lng, name, category}, ...]
 * @param {Array} daySegments - [{geometry: [[lng,lat,?], ...], ...}, ...]
 * @returns {Array<Array>} - array indexed by day (0-based), each containing waypoints for that day
 */
function assignWaypointsToDays(selectedWaypoints, daySegments) {
  const byDay = daySegments.map(() => []);

  for (const wp of selectedWaypoints) {
    let bestDayIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < daySegments.length; i++) {
      const seg = daySegments[i];
      if (!seg.geometry || seg.geometry.length === 0) continue;

      // Find minimum distance from waypoint to any coordinate in this segment
      for (const coord of seg.geometry) {
        const dLat = wp.lat - coord[1];
        const dLng = wp.lng - coord[0];
        const dist = dLat * dLat + dLng * dLng;
        if (dist < bestDist) {
          bestDist = dist;
          bestDayIdx = i;
        }
      }
    }

    byDay[bestDayIdx].push(wp);
  }

  return byDay;
}

const RELEVANT_SUPPLY_TYPES = new Set(['convenience', 'supermarket', 'fuel', 'drinking_water']);

/**
 * Build a compact trip context object from existing app state.
 * This is what gets sent to the LLM.
 *
 * @param {object} params - from getTripParams()
 * @param {string} tripDescription - from getTripDescription()
 * @param {Array} daySegments - from getDaySegments()
 * @param {Array} selectedWaypoints - from getSelectedWaypoints()
 * @returns {object} TripContext
 */
export function buildTripContext(params, tripDescription, daySegments, selectedWaypoints) {
  const totalDistanceM = daySegments.reduce((s, seg) => s + (seg.distance || 0), 0);
  const totalGainM = daySegments.reduce((s, seg) => s + (seg.elevationGain || 0), 0);
  const totalLossM = daySegments.reduce((s, seg) => s + (seg.elevationLoss || 0), 0);

  const waypointsByDay = assignWaypointsToDays(selectedWaypoints || [], daySegments);

  const days = daySegments.map((seg, i) => {
    const elevProfile = getElevationProfile(seg.geometry || []);
    const relevantStops = (seg.supplyStops || [])
      .filter(s => RELEVANT_SUPPLY_TYPES.has(s.type))
      .map(s => ({ name: s.name, type: s.type }));

    const scenicPOIs = (waypointsByDay[i] || [])
      .slice(0, 4)
      .map(wp => ({ name: wp.name, category: wp.category }));

    return {
      day: seg.day || (i + 1),
      distanceMiles: Math.round(metersToMiles(seg.distance || 0) * 10) / 10,
      gainFt: Math.round(metersToFeet(seg.elevationGain || 0)),
      lossFt: Math.round(metersToFeet(seg.elevationLoss || 0)),
      startName: seg.startName || '',
      endName: seg.endName || '',
      accommodation: seg.accommodation || null,
      supplyStops: relevantStops,
      scenicPOIs,
      ...elevProfile,
    };
  });

  return {
    trip: {
      startName: params.startName || '',
      endName: params.endName || '',
      totalDays: params.totalDays || daySegments.length,
      units: params.units || 'miles',
      routeNotes: params.routeNotes || null,
      originalDescription: tripDescription || null,
    },
    totals: {
      distanceMiles: Math.round(metersToMiles(totalDistanceM) * 10) / 10,
      totalGainFt: Math.round(metersToFeet(totalGainM)),
      totalLossFt: Math.round(metersToFeet(totalLossM)),
    },
    days,
    scenicHighlights: (selectedWaypoints || []).slice(0, 6).map(wp => ({
      name: wp.name,
      category: wp.category,
    })),
  };
}

function buildNarrationUserPrompt(ctx) {
  const { trip, totals, days, scenicHighlights } = ctx;

  const userIntent = trip.originalDescription || trip.routeNotes || 'not specified';

  let prompt = `Trip: ${trip.startName} to ${trip.endName}\n`;
  prompt += `Duration: ${trip.totalDays} days | ${totals.distanceMiles} miles total | ${totals.totalGainFt.toLocaleString()}ft total gain\n`;
  prompt += `User's intent: ${userIntent}\n\n`;
  prompt += `DAY-BY-DAY:\n`;

  for (const day of days) {
    prompt += `Day ${day.day}: ${day.startName || 'start'} → ${day.endName || 'end'} | ${day.distanceMiles} mi | ${day.gainFt.toLocaleString()}ft↑ ${day.lossFt.toLocaleString()}ft↓\n`;
    if (day.startElevFt || day.maxElevFt || day.endElevFt) {
      prompt += `  Elevation: starts ${day.startElevFt.toLocaleString()}ft, peaks at ${day.maxElevFt.toLocaleString()}ft, ends ${day.endElevFt.toLocaleString()}ft\n`;
    }
    prompt += `  Overnight: ${day.accommodation || 'unknown'}\n`;

    if (day.supplyStops.length > 0) {
      const stopList = day.supplyStops.map(s => `${s.name} (${s.type})`).join(', ');
      prompt += `  Supply stops: ${stopList}\n`;
    } else {
      prompt += `  Supply stops: none found nearby\n`;
    }

    if (day.scenicPOIs.length > 0) {
      const poiList = day.scenicPOIs.map(p => `${p.name} (${p.category})`).join(', ');
      prompt += `  Scenic highlights: ${poiList}\n`;
    }
    prompt += '\n';
  }

  if (scenicHighlights.length > 0) {
    const highlights = scenicHighlights.map(h => `${h.name} (${h.category})`).join(', ');
    prompt += `Overall scenic highlights along route: ${highlights}\n`;
  }

  return prompt;
}

const NARRATION_SYSTEM_PROMPT = `You are an experienced bikepacking guide who has ridden hundreds of routes across North America, Europe, and beyond. You speak like a trusted friend who has done a similar trip — direct, practical, enthusiastic where warranted, and honest about the hard parts.

You know:

TERRAIN AND PACING:
- A "big day" in bikepacking is anything over 65 miles or 5,000ft of gain — warn clearly
- Days with significant passes require early starts; camp timing matters on technical terrain
- Sustained climbing (3,000ft+ over 30 miles) is very different from rolling hills with the same total gain
- When elevation loss equals or exceeds gain, watch for brake fatigue and knee strain on descents
- Surface transitions from pavement to gravel/dirt add 20-30% to effective difficulty
- Loaded touring bikes carry 20-40% more weight than unloaded — this significantly slows climbing

WATER AND CAMPING:
- On camping nights, water sourcing is the #1 tactical concern
- Alpine environments (above 8,000ft): streams are frequent above treeline; treat all water
- Desert / arid terrain: water carries of 20+ miles are normal; springs may be seasonal; mention carry distance when no water supply stops exist on camping days with >30mi gaps
- Forest/woodland: creeks common but may be seasonal in late summer; treat all water
- Camp timing rule: arrive at camp with 1 hour of daylight left as minimum
- Fire restrictions: common above 8,000ft in Western US from June-October

BEAR CANISTER REQUIREMENTS:
- Flag bear canisters when place names or route notes mention: Sierra Nevada, Yosemite, Kings Canyon, John Muir Trail, Rocky Mountain wilderness areas, Glacier, Grand Teton, Bob Marshall Wilderness

WEATHER PATTERNS:
- High alpine routes (above 10,000ft): afternoon thunderstorms are near-daily in summer; plan to be off exposed terrain by 1pm
- Pacific Northwest: maritime weather changes fast; prepare for rain even in summer
- Desert Southwest: extreme heat in summer; pre-dawn starts recommended above 95°F forecast
- Plains / Midwest routes: wind is the dominant factor, not elevation

RECOVERY AND PACING:
- A "recovery day" (under 40 miles, low elevation) is valuable after 2-3 hard days in a row
- If the previous day was a big day (>65mi or >5,000ft gain) and today is easy (<45mi, <2,000ft), call it out as a welcome recovery day

NARRATIVE VOICE:
- Write in second person ("you'll climb," "expect to see")
- Lead each day with a single evocative sentence that captures the character of the riding
- Include at least one specific, practical tip per day
- For camping nights: one sentence on where/how to camp, water situation, any notable hazards
- For motel/hotel nights: one sentence on what the town likely offers, opportunity to resupply or rest
- Risk callouts use plain language: "This is a hard day," "Water is scarce here," "Watch the weather"
- Do not use motivational clichés like "embrace the challenge" or "push your limits"
- Length per day: 3-5 sentences. Do not write essays.
- Use your knowledge of specific places, ranges, and regions when place names are recognizable

OUTPUT FORMAT:
Return a single JSON object with this exact structure. No markdown, no preamble, no explanation:
{
  "routeCharacter": {
    "headline": "one punchy sentence describing what kind of trip this is",
    "summary": "2-3 sentences on the overall character: terrain type, dominant challenge, what makes it special",
    "bestFor": "one phrase describing ideal rider — e.g. 'Experienced bikepackers comfortable with long water carries'",
    "difficulty": "moderate or hard or very_hard"
  },
  "days": [
    {
      "day": 1,
      "headline": "one evocative sentence capturing the day's character",
      "narrative": "2-4 sentences of guide briefing for this day",
      "campingNote": "camping/water/lodging note for the overnight, or null if last day",
      "flags": [
        {
          "type": "warning or info or tip",
          "icon": "one of: ⚠️ 💧 🌲 ⛺ 🌤️ 🏪",
          "text": "concise flag text, max 12 words"
        }
      ]
    }
  ]
}`;

/**
 * Generate a trip narration using Claude.
 * Single batched call for the entire trip.
 *
 * @param {object} tripContext - from buildTripContext()
 * @param {string} apiKey - Anthropic API key
 * @returns {Promise<object>} TripNarration
 */
export async function generateTripNarration(tripContext, apiKey) {
  const userPrompt = buildNarrationUserPrompt(tripContext);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      system: NARRATION_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: userPrompt,
      }],
    }),
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errorBody = await response.json();
      errorDetail = errorBody.error?.message || '';
    } catch { /* ignore */ }
    throw new Error(`Guide briefing failed (${response.status}): ${errorDetail || response.statusText}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in guide briefing response');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Validate basic shape
  if (!parsed.routeCharacter || !Array.isArray(parsed.days)) {
    throw new Error('Guide briefing response missing required fields');
  }

  return parsed;
}
