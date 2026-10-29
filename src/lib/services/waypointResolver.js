import { geocode } from './geocoder.js';

/**
 * Returns true if a Nominatim geocode result is a large wilderness area
 * that cannot be directly used as an ORS cycling waypoint (no roads within 350m).
 *
 * @param {{ class: string, type: string }} geocodeResult
 * @returns {boolean}
 */
export function isWildernessArea(geocodeResult) {
  const cls = geocodeResult.class;
  const typ = geocodeResult.type;

  if (cls === 'boundary') {
    return ['national_park', 'protected_area', 'national_forest',
            'forest', 'wilderness'].includes(typ);
  }
  if (cls === 'leisure') {
    return typ === 'nature_reserve';
  }
  if (cls === 'natural') {
    return ['wood', 'grassland', 'wetland', 'heath'].includes(typ);
  }
  return false;
}

const WILDERNESS_WAYPOINT_SYSTEM_PROMPT = `You are a bikepacking route expert with deep knowledge of North American cycling corridors, gateway towns, mountain passes, and road access points.

Your task: given a wilderness region and a trip's start and end cities, suggest 1–3 specific, real, named places that a bikepacker would realistically pass through in order to traverse that wilderness region by bicycle. These must be places that exist on real roads or infrastructure — towns, named road passes, trailheads on a paved road, or gateway villages.

CRITICAL CONSTRAINTS:
- Return ONLY real, existing place names that can be found on OpenStreetMap or Google Maps.
- Every suggestion must be reachable by a cyclist on public roads (no off-road-only trailheads).
- Prefer named highway passes, gateway towns just inside or on the edge of the wilderness, or small communities on main cycling corridors.
- Return 1–3 suggestions. Do not return more. Do not return the wilderness region itself.
- If the wilderness is traversed by a known bikepacking route, prioritize its gateway communities.

KNOWLEDGE BASE — Major corridors and their realistic waypoints:
- Adirondack Park (NY): Lake Placid NY, Keene Valley NY, Saranac Lake NY, Old Forge NY, Tupper Lake NY
- Catskill Mountains (NY): Woodstock NY, Phoenicia NY, Margaretville NY
- White Mountains (NH): Lincoln NH, North Conway NH, Gorham NH, Franconia NH
- Green Mountains (VT): Middlebury VT, Warren VT, Rochester VT, Brandon VT
- Appalachian regions (general): Harpers Ferry WV, Damascus VA, Hot Springs NC
- Great Smoky Mountains: Bryson City NC, Cherokee NC, Gatlinburg TN, Townsend TN
- Blue Ridge Parkway corridor: Boone NC, Galax VA, Waynesboro VA, Roanoke VA
- Shenandoah Valley: Luray VA, Staunton VA, Harrisonburg VA
- Ozark National Forest: Mountain View AR, Jasper AR, Eureka Springs AR
- Ouachita Mountains: Mena AR, Hot Springs AR, Talihina OK
- Superior National Forest / BWCAW: Ely MN, Grand Marais MN, Two Harbors MN
- Black Hills (SD): Custer SD, Hill City SD, Lead SD, Deadwood SD
- Bighorn Mountains (WY): Buffalo WY, Sheridan WY, Tensleep WY, Lovell WY
- Wind River Range (WY): Pinedale WY, Lander WY, Dubois WY
- Yellowstone region: West Yellowstone MT, Gardiner MT, Cody WY, Jackson WY
- Grand Teton / Snake River corridor: Jackson WY, Driggs ID, Victor ID
- Glacier National Park: West Glacier MT, East Glacier MT, Browning MT, Columbia Falls MT
- Going-to-the-Sun Road (Glacier): West Glacier MT, St Mary MT
- Bob Marshall Wilderness (MT): Choteau MT, Augusta MT, Lincoln MT
- Flathead Valley (MT): Whitefish MT, Columbia Falls MT, Bigfork MT
- Sawtooth Mountains (ID): Stanley ID, Ketchum ID, Challis ID
- Frank Church Wilderness (ID): Salmon ID, Challis ID, Stanley ID
- Continental Divide (CO): Steamboat Springs CO, Silverthorne CO, Breckenridge CO, Fairplay CO, Salida CO, Gunnison CO, Creede CO
- Rocky Mountain National Park (CO): Estes Park CO, Grand Lake CO
- San Juan Mountains (CO): Ouray CO, Silverton CO, Telluride CO, Lake City CO, Durango CO
- Great Divide Mountain Bike Route (CO): Steamboat Springs CO, Rawlins WY, Pinedale WY, Lima MT
- Monarch Pass (CO): Salida CO, Gunnison CO
- Independence Pass (CO): Aspen CO, Twin Lakes CO
- Wolf Creek Pass (CO): South Fork CO, Pagosa Springs CO
- Sierra Nevada (CA) — north: Truckee CA, South Lake Tahoe CA, Markleeville CA
- Sierra Nevada (CA) — central: Mammoth Lakes CA, Bishop CA, Lee Vining CA, Lone Pine CA
- Yosemite region: Mariposa CA, El Portal CA, Groveland CA, Lee Vining CA
- Tuolumne Meadows (Yosemite): Lee Vining CA, Crane Flat CA
- Kings Canyon / Sequoia: Three Rivers CA, Visalia CA, Fresno CA
- Pacific Coast (CA/OR/WA): Florence OR, Tillamook OR, Astoria OR, Nehalem OR
- Cascade Range (OR): McKenzie Bridge OR, Sisters OR, Detroit OR, Oakridge OR
- Cascade Range (WA): Winthrop WA, Mazama WA, Twisp WA, Leavenworth WA
- North Cascades: Newhalem WA, Winthrop WA, Marblemount WA
- Olympic Peninsula: Sequim WA, Forks WA, Port Angeles WA, Quilcene WA
- Great Basin (NV/UT): Ely NV, Austin NV, Eureka NV, Baker NV
- Escalante / Grand Staircase (UT): Escalante UT, Boulder UT, Kanab UT, Tropic UT
- Canyonlands / Moab region: Moab UT, Monticello UT, Blanding UT, Green River UT
- Zion National Park: Springdale UT, Hurricane UT, Mt Carmel Junction UT
- Bryce Canyon region: Tropic UT, Panguitch UT, Hatch UT
- Great Sand Dunes (CO): Alamosa CO, Blanca CO, Moffat CO
- TransAmerica Trail (east): Yorktown VA, Charlottesville VA, Lexington VA, Lewisburg WV
- TransAmerica Trail (central): Pueblo CO, Wichita KS, Carbondale IL
- TransAmerica Trail (west): Missoula MT, Libby MT, Astoria OR

When the region is not in this list, apply general bikepacking principles: suggest the nearest towns that sit on state highways or US routes at the edge of the wilderness, or any named passes/gaps that bikepackers are known to cross.`;

function buildUserPrompt(regionName, startName, endName) {
  const context = (startName && endName)
    ? `The bikepacker is traveling from "${startName}" to "${endName}".`
    : startName
      ? `The bikepacker is starting from "${startName}".`
      : endName
        ? `The bikepacker is ending in "${endName}".`
        : 'No specific start or end city is known.';

  return `${context}

They want to pass through: "${regionName}"

What 1–3 specific, real, geocodable place names (towns, named passes, or gateway communities) would a bikepacker realistically travel through to traverse this wilderness region by bicycle? These must be on public roads.

Return ONLY a JSON array of strings. No explanation. No markdown. Examples of valid output:
["Lake Placid, NY", "Saranac Lake, NY"]
["Monarch Pass, CO", "Salida, CO"]
["Lee Vining, CA"]

JSON array:`;
}

/**
 * Resolve a wilderness region name into 1–3 specific, routable waypoints
 * using Claude Haiku. Falls back to empty array if LLM or geocoding fails.
 *
 * @param {string} regionName - The wilderness area name (e.g. "Adirondack Park")
 * @param {string|null} startName - Trip start city name
 * @param {string|null} endName - Trip end city name
 * @param {string} apiKey - Anthropic API key
 * @returns {Promise<Array<{lat: number, lng: number, name: string}>>}
 */
export async function resolveWildernessWaypoints(regionName, startName, endName, apiKey) {
  let placeNames = [];

  try {
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
        max_tokens: 128,
        system: WILDERNESS_WAYPOINT_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: buildUserPrompt(regionName, startName, endName),
        }],
      }),
    });

    if (!response.ok) {
      console.warn(`[waypointResolver] LLM request failed (${response.status}) for "${regionName}"`);
      return [];
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      console.warn(`[waypointResolver] No JSON array in LLM response for "${regionName}":`, text);
      return [];
    }

    const parsed = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) {
      console.warn(`[waypointResolver] Parsed value is not an array for "${regionName}"`);
      return [];
    }

    placeNames = parsed
      .filter(s => typeof s === 'string' && s.trim().length > 0)
      .slice(0, 3);

    console.log(`[waypointResolver] LLM suggested for "${regionName}":`, placeNames);
  } catch (err) {
    console.warn(`[waypointResolver] LLM error for "${regionName}":`, err.message);
    return [];
  }

  if (placeNames.length === 0) return [];

  const resolved = [];

  for (const placeName of placeNames) {
    try {
      if (resolved.length > 0) {
        await new Promise(r => setTimeout(r, 1100));
      }

      const results = await geocode(placeName);

      if (results.length === 0) {
        console.warn(`[waypointResolver] Geocoding found nothing for "${placeName}"`);
        continue;
      }

      const best = results[0];

      if (isWildernessArea(best)) {
        console.warn(`[waypointResolver] "${placeName}" geocoded to another wilderness area, skipping`);
        continue;
      }

      resolved.push({
        lat: best.lat,
        lng: best.lng,
        name: regionName,
      });

      console.log(`[waypointResolver] Resolved "${regionName}" via "${placeName}" → (${best.lat}, ${best.lng})`);
    } catch (err) {
      console.warn(`[waypointResolver] Geocoding error for "${placeName}":`, err.message);
    }
  }

  return resolved;
}
