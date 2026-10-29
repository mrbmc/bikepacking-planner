<script>
  import { getTripDescription, setTripDescription, getTripParams, setTripParams, getCanGenerateRoute } from '$lib/state/tripState.svelte.js';
  import { getErrorMessage, setErrorMessage, getAnthropicApiKey } from '$lib/state/uiState.svelte.js';
  import { parseTrip } from '$lib/utils/tripParser.js';
  import { parseTripWithLLM } from '$lib/services/llmParser.js';
  import { geocode, findRoutablePoint } from '$lib/services/geocoder.js';
  import { resolveWildernessWaypoints, isWildernessArea } from '$lib/services/waypointResolver.js';
  import { extractNoteKeywords } from '$lib/services/corridorDiscovery.js';
  import { milesToMeters, kmToMeters, METERS_PER_MILE, METERS_PER_KM } from '$lib/utils/units.js';

  let description = $state(getTripDescription());
  let parsed = $state(false);
  let parsing = $state(false);

  let startName = $state(getTripParams().startName || '');
  let endName = $state(getTripParams().endName || '');
  let totalDays = $state(getTripParams().totalDays || 7);
  let dailyDistance = $state(getTripParams().dailyDistancePref || 50);
  let units = $state(getTripParams().units || 'miles');
  let routeNotes = $state(getTripParams().routeNotes || '');

  let startResults = $state([]);
  let endResults = $state([]);
  let startResolved = $state(getTripParams().startCoords ? getTripParams().startName : '');
  let endResolved = $state(getTripParams().endCoords ? getTripParams().endName : '');
  let startLooking = $state(false);
  let endLooking = $state(false);

  // Note waypoints state
  let notesLooking = $state(false);
  let resolvedNotes = $state(getTripParams().noteWaypoints?.length > 0 ? getTripParams().noteWaypoints : []);
  // Per-keyword results for user selection: [{keyword, results: [...], resolved: bool}]
  let noteKeywordResults = $state([]);

  // If we already have data loaded from state, consider it parsed
  $effect(() => {
    if (getTripParams().startName && getTripParams().endName && getTripParams().totalDays > 0) {
      parsed = true;
      startName = getTripParams().startName;
      endName = getTripParams().endName;
      totalDays = getTripParams().totalDays;
      dailyDistance = getTripParams().dailyDistancePref || 50;
      units = getTripParams().units || 'miles';
      routeNotes = getTripParams().routeNotes || '';
    }
  });

  async function handleParse() {
    if (!description.trim()) return;
    parsing = true;
    setErrorMessage('');
    try {
      let result;
      const anthropicKey = getAnthropicApiKey();

      if (anthropicKey) {
        try {
          console.log('Calling LLM parser with key:', anthropicKey.substring(0, 10) + '...');
          result = await parseTripWithLLM(description, anthropicKey);
          console.log('LLM parser succeeded');
        } catch (llmErr) {
          // Fall back to regex parser if LLM fails
          console.warn('LLM parsing failed, falling back to regex:', llmErr.message);
          result = parseTrip(description);
        }
      } else {
        console.log('No Anthropic key found, using regex parser');
        result = parseTrip(description);
      }

      console.log('LLM parse result:', JSON.stringify(result));
      startName = result.startName || '';
      endName = result.endName || '';
      units = result.units || 'miles';
      routeNotes = result.routeNotes || '';

      // Smart default for daily distance
      dailyDistance = result.dailyDistance || 50;

      // Smart default for days: if not parsed, estimate from a rough 50mi/day average
      totalDays = result.totalDays || 7;

      parsed = true;
      setTripDescription(description);

      // Reset geocoded results
      startResults = [];
      endResults = [];
      startResolved = '';
      endResolved = '';

      // Auto-lookup both locations
      updateParams({ routeNotes });
      await autoLookupBoth(startName, endName);
    } catch (e) {
      setErrorMessage('Could not parse trip description. Please fill in the fields manually.');
      parsed = true;
    } finally {
      parsing = false;
    }
  }

  async function autoLookupBoth(start, end) {
    const promises = [];
    if (start.trim()) promises.push(autoLookup(start, 'start'));
    if (end.trim()) promises.push(autoLookup(end, 'end'));
    await Promise.all(promises);
  }

  async function autoLookup(name, which) {
    if (!name.trim()) return;
    if (which === 'start') startLooking = true;
    else endLooking = true;

    try {
      const results = await geocode(name);
      if (results.length === 0) {
        // Don't show error for auto-lookup, just leave it for manual
      } else if (results.length === 1) {
        if (which === 'start') selectStart(results[0]);
        else selectEnd(results[0]);
      } else {
        // Pick the first result automatically for a smooth flow
        if (which === 'start') selectStart(results[0]);
        else selectEnd(results[0]);
      }
    } catch (e) {
      // Silently fail for auto-lookup
    } finally {
      if (which === 'start') startLooking = false;
      else endLooking = false;
    }
  }

  async function lookUpStart() {
    if (!startName.trim()) return;
    startLooking = true;
    setErrorMessage('');
    try {
      const results = await geocode(startName);
      if (results.length === 0) {
        setErrorMessage(`No results found for "${startName}"`);
      } else if (results.length === 1) {
        selectStart(results[0]);
      } else {
        startResults = results;
      }
    } catch (e) {
      setErrorMessage(`Geocoding failed: ${e.message}`);
    } finally {
      startLooking = false;
    }
  }

  async function lookUpEnd() {
    if (!endName.trim()) return;
    endLooking = true;
    setErrorMessage('');
    try {
      const results = await geocode(endName);
      if (results.length === 0) {
        setErrorMessage(`No results found for "${endName}"`);
      } else if (results.length === 1) {
        selectEnd(results[0]);
      } else {
        endResults = results;
      }
    } catch (e) {
      setErrorMessage(`Geocoding failed: ${e.message}`);
    } finally {
      endLooking = false;
    }
  }

  async function lookUpNotes() {
    if (!routeNotes.trim()) return;
    notesLooking = true;
    setErrorMessage('');
    resolvedNotes = [];
    noteKeywordResults = [];

    const anthropicKey = getAnthropicApiKey();

    try {
      const keywords = extractNoteKeywords(routeNotes);
      console.log('[notes] Extracted keywords:', keywords);

      if (keywords.length === 0) {
        setErrorMessage('No place names found in route notes.');
        return;
      }

      // Compute viewbox from start/end if available, with 2-degree buffer
      const p = getTripParams();
      let viewboxOpts = {};
      if (p.startCoords && p.endCoords) {
        const buffer = 2;
        viewboxOpts = {
          viewbox: [
            Math.min(p.startCoords[1], p.endCoords[1]) - buffer,
            Math.min(p.startCoords[0], p.endCoords[0]) - buffer,
            Math.max(p.startCoords[1], p.endCoords[1]) + buffer,
            Math.max(p.startCoords[0], p.endCoords[0]) + buffer,
          ],
          bounded: false,
        };
      }

      for (const keyword of keywords) {
        try {
          const results = await geocode(keyword, viewboxOpts);
          console.log(`[notes] Geocoded "${keyword}" → ${results.length} results`);

          if (results.length === 1) {
            const r = results[0];

            // If this geocoded result is a large wilderness area (national park, protected area, etc.),
            // use the LLM to find specific routable gateway towns instead of snapping the centroid.
            if (isWildernessArea(r) && anthropicKey) {
              console.log(`[notes] "${keyword}" is a wilderness area — using LLM to find routable access points`);
              const llmResolved = await resolveWildernessWaypoints(
                keyword, startName, endName, anthropicKey
              );
              if (llmResolved.length > 0) {
                resolvedNotes = [...resolvedNotes, ...llmResolved];
                updateParams({ noteWaypoints: resolvedNotes });
              } else {
                // LLM failed — fall back to original findRoutablePoint approach
                let lat = r.lat, lng = r.lng;
                try {
                  await new Promise(resolve => setTimeout(resolve, 1100));
                  const snapped = await findRoutablePoint(lat, lng, keyword);
                  if (snapped) { lat = snapped.lat; lng = snapped.lng; }
                } catch { /* keep original coords */ }
                resolvedNotes = [...resolvedNotes, { lat, lng, name: keyword }];
                updateParams({ noteWaypoints: resolvedNotes });
              }
            } else {
              // Not a wilderness area — use original snap-to-routable-point approach
              let lat = r.lat, lng = r.lng;
              try {
                const snapped = await findRoutablePoint(lat, lng, keyword);
                if (snapped) { lat = snapped.lat; lng = snapped.lng; }
                await new Promise(resolve => setTimeout(resolve, 1100)); // Nominatim rate limit
              } catch { /* keep original coords */ }
              resolvedNotes = [...resolvedNotes, { lat, lng, name: keyword }];
              updateParams({ noteWaypoints: resolvedNotes });
            }
          } else if (results.length > 1) {
            // Show results for user selection
            noteKeywordResults = [...noteKeywordResults, { keyword, results, resolved: false }];
          } else {
            setErrorMessage(`No results found for "${keyword}"`);
          }
          // Nominatim rate limit
          await new Promise(r => setTimeout(r, 1100));
        } catch {
          // Skip keywords that fail
        }
      }
    } catch (e) {
      setErrorMessage(`Route notes lookup failed: ${e.message}`);
    } finally {
      notesLooking = false;
    }
  }

  async function selectNoteResult(keywordIndex, result) {
    const keyword = noteKeywordResults[keywordIndex].keyword;
    // Mark this keyword as resolved immediately so the UI updates
    noteKeywordResults = noteKeywordResults.map((kr, i) =>
      i === keywordIndex ? { ...kr, resolved: true } : kr
    );
    // Snap to a routable point (nearest town/village) before adding
    let lat = result.lat, lng = result.lng;
    try {
      const snapped = await findRoutablePoint(lat, lng, keyword);
      if (snapped) { lat = snapped.lat; lng = snapped.lng; }
    } catch { /* keep original coords */ }
    resolvedNotes = [...resolvedNotes, { lat, lng, name: keyword }];
    updateParams({ noteWaypoints: resolvedNotes });
  }

  function removeNoteWaypoint(index) {
    resolvedNotes = resolvedNotes.filter((_, i) => i !== index);
    updateParams({ noteWaypoints: resolvedNotes });
  }

  function selectStart(result) {
    startResolved = result.name;
    startResults = [];
    updateParams({ startName: result.name, startCoords: [result.lat, result.lng] });
  }

  function selectEnd(result) {
    endResolved = result.name;
    endResults = [];
    updateParams({ endName: result.name, endCoords: [result.lat, result.lng] });
  }

  function updateParams(extra = {}) {
    setTripParams({
      startName: startName,
      endName: endName,
      totalDays: parseInt(totalDays) || 7,
      dailyDistancePref: parseFloat(dailyDistance) || 50,
      units,
      routeNotes,
      ...extra,
    });
  }

  function handleFieldChange() {
    updateParams();
  }

  // Snap daily distance to 5-unit increments
  function snapDailyDistance(val) {
    return Math.round(val / 5) * 5;
  }

  const isValid = $derived(getCanGenerateRoute());
  const errorMsg = $derived(getErrorMessage());

  const dailyDistanceDisplay = $derived(snapDailyDistance(dailyDistance));
</script>

<div class="space-y-6">
  <!-- Trip Description Input -->
  <div>
    <label for="trip-desc" class="block text-sm font-medium text-gray-700 mb-2">
      Describe Your Trip
    </label>
    <textarea
      id="trip-desc"
      bind:value={description}
      placeholder="e.g., Bike Portland to Burlington VT through the Adirondack Park in 10 days"
      rows="3"
      class="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-colors resize-none"
    ></textarea>
    <button
      onclick={handleParse}
      disabled={parsing || !description.trim()}
      class="mt-2 w-full bg-blue-600 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
    >
      {#if parsing}
        <span class="inline-flex items-center gap-2">
          <svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          Parsing &amp; Looking Up...
        </span>
      {:else}
        Plan Trip
      {/if}
    </button>
  </div>

  {#if errorMsg}
    <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
      {errorMsg}
    </div>
  {/if}

  <!-- Parsed Fields -->
  {#if parsed}
    <div class="space-y-4 border-t border-gray-200 pt-4">
      <h3 class="text-sm font-semibold text-gray-600 uppercase tracking-wide">Trip Details</h3>

      <!-- Start Location -->
      <div>
        <label for="start-loc" class="block text-sm font-medium text-gray-700 mb-1">Start Location</label>
        <div class="flex gap-2">
          <input
            id="start-loc"
            type="text"
            bind:value={startName}
            onchange={handleFieldChange}
            placeholder="City or place name"
            class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-colors"
          />
          <button
            onclick={lookUpStart}
            disabled={startLooking || !startName.trim()}
            class="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {startLooking ? '...' : 'Look Up'}
          </button>
        </div>
        {#if startResults.length > 0}
          <div class="mt-2 border border-gray-200 rounded-lg overflow-hidden">
            {#each startResults as result, i}
              <button
                onclick={() => selectStart(result)}
                class="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0 transition-colors"
              >
                <span class="text-gray-900">{result.name}</span>
                <span class="text-xs text-gray-400 ml-1">({result.type})</span>
              </button>
            {/each}
          </div>
        {/if}
        {#if startResolved}
          <p class="mt-1 text-xs text-green-600 flex items-center gap-1">
            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
            {startResolved}
          </p>
        {/if}
      </div>

      <!-- End Location -->
      <div>
        <label for="end-loc" class="block text-sm font-medium text-gray-700 mb-1">End Location</label>
        <div class="flex gap-2">
          <input
            id="end-loc"
            type="text"
            bind:value={endName}
            onchange={handleFieldChange}
            placeholder="City or place name"
            class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-colors"
          />
          <button
            onclick={lookUpEnd}
            disabled={endLooking || !endName.trim()}
            class="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {endLooking ? '...' : 'Look Up'}
          </button>
        </div>
        {#if endResults.length > 0}
          <div class="mt-2 border border-gray-200 rounded-lg overflow-hidden">
            {#each endResults as result, i}
              <button
                onclick={() => selectEnd(result)}
                class="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0 transition-colors"
              >
                <span class="text-gray-900">{result.name}</span>
                <span class="text-xs text-gray-400 ml-1">({result.type})</span>
              </button>
            {/each}
          </div>
        {/if}
        {#if endResolved}
          <p class="mt-1 text-xs text-green-600 flex items-center gap-1">
            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
            {endResolved}
          </p>
        {/if}
      </div>

      <!-- Route Notes -->
      <div>
        <label for="route-notes" class="block text-sm font-medium text-gray-700 mb-1">
          Route Notes <span class="text-gray-400 font-normal">(optional)</span>
        </label>
        <div class="flex gap-2">
          <input
            id="route-notes"
            type="text"
            bind:value={routeNotes}
            onchange={handleFieldChange}
            placeholder="e.g., via the coast, through Adirondack Park"
            class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-colors"
          />
          <button
            onclick={lookUpNotes}
            disabled={notesLooking || !routeNotes.trim()}
            class="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {notesLooking ? '...' : 'Look Up'}
          </button>
        </div>
        <p class="text-xs text-gray-400 mt-1">Place names your route should pass through — shown on the map</p>

        <!-- Keyword results needing user selection -->
        {#each noteKeywordResults as kr, ki}
          {#if !kr.resolved}
            <div class="mt-2">
              <p class="text-xs font-medium text-gray-600 mb-1">Select a match for "{kr.keyword}":</p>
              <div class="border border-gray-200 rounded-lg overflow-hidden">
                {#each kr.results as result}
                  <button
                    onclick={() => selectNoteResult(ki, result)}
                    class="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 border-b border-gray-100 last:border-b-0 transition-colors"
                  >
                    <span class="text-gray-900">{result.name}</span>
                    <span class="text-xs text-gray-400 ml-1">({result.class}/{result.type})</span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        {/each}

        <!-- Resolved waypoints -->
        {#if resolvedNotes.length > 0}
          <div class="mt-2 space-y-1">
            {#each resolvedNotes as wp, i}
              <p class="text-xs text-green-600 flex items-center gap-1">
                <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
                <span class="font-medium">{wp.name}</span>
                <span class="text-gray-400 font-normal">({wp.lat.toFixed(2)}, {wp.lng.toFixed(2)})</span>
              </p>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Number of Days — Slider -->
      <div>
        <label for="days-slider" class="block text-sm font-medium text-gray-700 mb-1">
          Number of Days: <span class="font-bold text-blue-600">{totalDays}</span>
        </label>
        <input
          id="days-slider"
          type="range"
          min="1"
          max="30"
          step="1"
          bind:value={totalDays}
          oninput={handleFieldChange}
          class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
        />
        <div class="flex justify-between text-xs text-gray-400 mt-1">
          <span>1 day</span>
          <span>30 days</span>
        </div>
      </div>

      <!-- Daily Distance — Slider with 5-unit increments -->
      <div>
        <label for="daily-dist-slider" class="block text-sm font-medium text-gray-700 mb-1">
          Daily Distance Target:
          <span class="font-bold text-blue-600">{dailyDistanceDisplay} {units === 'miles' ? 'mi' : 'km'}</span>
        </label>
        <div class="flex gap-2 items-center">
          <input
            id="daily-dist-slider"
            type="range"
            min="15"
            max={units === 'miles' ? 120 : 200}
            step="5"
            bind:value={dailyDistance}
            oninput={handleFieldChange}
            class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
          <select
            bind:value={units}
            onchange={handleFieldChange}
            class="rounded-lg border border-gray-300 px-2 py-1 text-sm bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-colors"
          >
            <option value="miles">mi</option>
            <option value="km">km</option>
          </select>
        </div>
        <div class="flex justify-between text-xs text-gray-400 mt-1">
          <span>15 {units === 'miles' ? 'mi' : 'km'}</span>
          <span>{units === 'miles' ? 120 : 200} {units === 'miles' ? 'mi' : 'km'}</span>
        </div>
      </div>

      <!-- Validation Status -->
      {#if isValid}
        <div class="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
          Ready! Click Next to generate your route.
        </div>
      {:else}
        <div class="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg text-sm">
          Look up both locations and set number of days to continue.
        </div>
      {/if}
    </div>
  {/if}
</div>
