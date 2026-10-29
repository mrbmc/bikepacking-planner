/**
 * Parse a trip description using Claude Haiku for natural language understanding.
 * Falls back gracefully if the LLM response is malformed.
 *
 * @param {string} input - Natural language trip description
 * @param {string} apiKey - Anthropic API key
 * @returns {Promise<{startName: string|null, endName: string|null, totalDays: number|null, dailyDistance: number|null, units: string|null, routeNotes: string|null}>}
 */
export async function parseTripWithLLM(input, apiKey) {
  if (!input || !input.trim()) {
    return { startName: null, endName: null, totalDays: null, dailyDistance: null, units: null, routeNotes: null };
  }

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
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Extract trip details from this bikepacking trip description. Return ONLY valid JSON with these exact fields:
- startName: starting location name (string or null)
- endName: ending/destination location name (string or null)
- totalDays: number of days for the trip (number or null)
- dailyDistance: preferred daily distance (number or null)
- units: "miles" or "km" if a distance preference was stated (string or null)
- routeNotes: any route preferences, waypoints, or scenic directions (string or null). Use official/formal place names that would work in a map search (e.g., "through Adirondack Park" not "through the Adirondacks", "via Blue Ridge Parkway" not "via the Blue Ridge", "along Lake Champlain"). Include the preposition (through/via/along/etc). If there are multiple, join them with " and ".

Trip description: "${input.replace(/"/g, '\\"')}"

JSON:`,
      }],
    }),
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errorBody = await response.json();
      errorDetail = errorBody.error?.message || '';
    } catch {
      // ignore
    }
    throw new Error(`LLM parsing failed (${response.status}): ${errorDetail || response.statusText}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';

  // Extract JSON from response (handle markdown code blocks or raw JSON)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in LLM response');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Normalize and validate the response shape
  return {
    startName: typeof parsed.startName === 'string' ? parsed.startName : null,
    endName: typeof parsed.endName === 'string' ? parsed.endName : null,
    totalDays: typeof parsed.totalDays === 'number' && parsed.totalDays > 0 ? parsed.totalDays : null,
    dailyDistance: typeof parsed.dailyDistance === 'number' && parsed.dailyDistance > 0 ? parsed.dailyDistance : null,
    units: parsed.units === 'miles' || parsed.units === 'km' ? parsed.units : null,
    routeNotes: typeof parsed.routeNotes === 'string' && parsed.routeNotes.trim() ? parsed.routeNotes.trim() : null,
  };
}
