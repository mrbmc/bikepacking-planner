<script>
  import { getFullRoute, setFullRoute, setDaySegments } from '$lib/state/routeState.svelte.js';
  import { getTripParams } from '$lib/state/tripState.svelte.js';
  import { getOrsApiKey, startLoading, stopLoading, setErrorMessage } from '$lib/state/uiState.svelte.js';
  import {
    getAllDiscoveredPOIs, setAllDiscoveredPOIs,
    getScoredPOIs, setScoredPOIs,
    getRecommendedWaypoints, setRecommendedWaypoints,
    getSelectedWaypoints, setSelectedWaypoints,
    getDiscoveryComplete, setDiscoveryComplete,
    getDiscoveryProgress, setDiscoveryProgress,
    getDiscoveryStatus, setDiscoveryStatus,
    getActiveCategories, toggleCategory,
    toggleWaypoint, getWaypointsApplied, setWaypointsApplied,
  } from '$lib/state/discoveryState.svelte.js';
  import { discoverCorridorPOIs, scorePOIs, selectWaypoints, getCategories, getCategoryColors, projectOntoLine, haversine } from '$lib/services/corridorDiscovery.js';
  import { getRouteWithWaypoints } from '$lib/services/router.js';
  import { findRoutablePoint } from '$lib/services/geocoder.js';
  import { splitRouteIntoDays } from '$lib/utils/segmentCalculator.js';
  import { milesToMeters, kmToMeters, formatDistance } from '$lib/utils/units.js';
  import { setRouteSummary } from '$lib/state/routeState.svelte.js';

  const route = $derived(getFullRoute());
  const params = $derived(getTripParams());
  const discovered = $derived(getAllDiscoveredPOIs());
  const scored = $derived(getScoredPOIs());
  const recommended = $derived(getRecommendedWaypoints());
  const selected = $derived(getSelectedWaypoints());
  const complete = $derived(getDiscoveryComplete());
  const progress = $derived(getDiscoveryProgress());
  const status = $derived(getDiscoveryStatus());
  const activeFilters = $derived(getActiveCategories());
  const applied = $derived(getWaypointsApplied());

  const categories = getCategories();
  const categoryColors = getCategoryColors();

  let discovering = $state(false);
  let applying = $state(false);
  let showAllPOIs = $state(false);
  let droppedInfo = $state(null); // { total, routed, dropped[] }

  // Filtered scored POIs by active categories
  const filteredPOIs = $derived(
    scored.filter(poi => activeFilters.has(poi.category))
  );

  // Count by category
  const categoryCounts = $derived(() => {
    const counts = {};
    for (const poi of scored) {
      counts[poi.category] = (counts[poi.category] || 0) + 1;
    }
    return counts;
  });

  // Check if a POI is in the selected list
  function isSelected(poi) {
    return selected.some(wp => wp.id === poi.id);
  }

  // Check if a POI is in the recommended list
  function isRecommended(poi) {
    return recommended.some(wp => wp.id === poi.id);
  }

  async function handleDiscover() {
    const feature = route?.features?.[0];
    if (!feature) return;

    const coordinates = feature.geometry?.coordinates || [];
    if (coordinates.length === 0) return;

    discovering = true;
    setDiscoveryProgress(0);
    setDiscoveryStatus('Starting corridor search...');

    try {
      // Note: Route notes are already factored into the route itself (geocoded
      // and used as waypoints during initial route generation in Step2RouteSegments).
      // Scenic discovery searches along the already-correct route corridor.

      // 1. Discover POIs along the route corridor
      const pois = await discoverCorridorPOIs(coordinates, {
        corridorRadiusKm: 25,
        sampleIntervalKm: 120,
        onProgress: (current, total) => {
          setDiscoveryProgress(Math.round((current / total) * 100));
          setDiscoveryStatus(`Querying area ${current} of ${total}...`);
        },
      });

      setAllDiscoveredPOIs(pois);
      setDiscoveryStatus('Scoring and ranking...');

      // 2. Score and rank
      const scoredResult = scorePOIs(pois, coordinates);
      setScoredPOIs(scoredResult);

      // 3. Select recommended waypoints
      const recommendedResult = selectWaypoints(scoredResult, params.startCoords, params.endCoords);
      setRecommendedWaypoints(recommendedResult);
      setSelectedWaypoints([...recommendedResult]); // Copy for user modification

      setDiscoveryComplete(true);
      setDiscoveryStatus(`Found ${pois.length} scenic points of interest`);
    } catch (e) {
      setErrorMessage(`Discovery failed: ${e.message}`);
      setDiscoveryStatus('Discovery failed');
    } finally {
      discovering = false;
    }
  }

  async function handleApplyWaypoints() {
    const apiKey = getOrsApiKey();
    if (!apiKey) {
      setErrorMessage('Please set your OpenRouteService API key first.');
      return;
    }

    if (selected.length === 0) {
      setErrorMessage('Select at least one waypoint to apply.');
      return;
    }

    applying = true;
    droppedInfo = null;
    startLoading('Snapping waypoints to roads...');

    try {
      // Snap scenic waypoints to routable points (parks/reserves have centroids
      // in wilderness with no roads within ORS's 350m snap radius)
      const snappedScenic = [];
      for (const wp of selected) {
        try {
          const snapped = await findRoutablePoint(wp.lat, wp.lng, wp.name);
          if (snapped) {
            snappedScenic.push({ ...wp, lat: snapped.lat, lng: snapped.lng });
          } else {
            snappedScenic.push(wp);
          }
          await new Promise(r => setTimeout(r, 1100)); // Nominatim rate limit
        } catch {
          snappedScenic.push(wp); // Keep original if snap fails
        }
      }

      // Merge note waypoints (already snapped in Step 1) with scenic waypoints
      const noteWaypoints = params.noteWaypoints || [];
      const allWaypoints = [...noteWaypoints, ...snappedScenic];

      // Sort all waypoints geographically along start→end axis
      const [sLat, sLng] = params.startCoords;
      const [eLat, eLng] = params.endCoords;
      allWaypoints.sort((a, b) => {
        const projA = projectOntoLine(a.lat, a.lng, sLat, sLng, eLat, eLng);
        const projB = projectOntoLine(b.lat, b.lng, sLat, sLng, eLat, eLng);
        return projA - projB;
      });

      // Set distanceFromRoute for fallback priority
      for (const wp of allWaypoints) {
        if (wp.distanceFromRoute == null) {
          const proj = projectOntoLine(wp.lat, wp.lng, sLat, sLng, eLat, eLng);
          const clampedProj = Math.max(0, Math.min(1, proj));
          const projLat = sLat + clampedProj * (eLat - sLat);
          const projLng = sLng + clampedProj * (eLng - sLng);
          wp.distanceFromRoute = haversine(wp.lat, wp.lng, projLat, projLng);
        }
      }

      startLoading('Re-routing through scenic waypoints...');

      const routeData = await getRouteWithWaypoints(
        params.startCoords,
        params.endCoords,
        allWaypoints,
        apiKey
      );

      // Check for dropped waypoints from progressive fallback
      if (routeData._droppedWaypoints && routeData._droppedWaypoints.length > 0) {
        droppedInfo = {
          total: selected.length,
          routed: selected.length - routeData._droppedWaypoints.length,
          dropped: routeData._droppedWaypoints,
        };
      }

      setFullRoute(routeData);

      // Extract route summary
      const feature = routeData.features?.[0];
      if (feature) {
        const summary = feature.properties?.summary || {};
        const bbox = routeData.bbox || feature.bbox;
        setRouteSummary({
          totalDistance: summary.distance || 0,
          totalAscent: summary.ascent || 0,
          totalDescent: summary.descent || 0,
          bbox: bbox || null,
        });

        // Re-split into day segments
        const coordinates = feature.geometry?.coordinates || [];
        let dailyDistMeters = 0;
        if (params.dailyDistancePref > 0) {
          dailyDistMeters = params.units === 'miles'
            ? milesToMeters(params.dailyDistancePref)
            : kmToMeters(params.dailyDistancePref);
        }

        const daySegs = splitRouteIntoDays(coordinates, params.totalDays, dailyDistMeters);
        setDaySegments(daySegs);
      }

      setWaypointsApplied(true);
    } catch (e) {
      setErrorMessage(`Re-routing failed: ${e.message}`);
    } finally {
      applying = false;
      stopLoading();
    }
  }

  function handleToggle(poi) {
    toggleWaypoint(poi);
  }

  function handleCategoryToggle(cat) {
    toggleCategory(cat);
  }

  function handleModifyWaypoints() {
    setWaypointsApplied(false);
  }

  const displayedPOIs = $derived(showAllPOIs ? filteredPOIs : filteredPOIs.slice(0, 15));
</script>

<div class="border border-gray-200 rounded-lg overflow-hidden">
  {#if applied}
    <!-- State 4: Waypoints applied -->
    <div class="bg-green-50 p-4">
      <div class="flex items-center gap-2 text-green-700">
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
        </svg>
        <span class="font-medium">Route updated with {selected.length} scenic waypoint{selected.length !== 1 ? 's' : ''}</span>
      </div>
      {#if droppedInfo}
        <div class="mt-2 bg-yellow-50 border border-yellow-200 rounded px-3 py-2 text-xs text-yellow-800">
          Routed through {droppedInfo.routed} of {droppedInfo.total} waypoints — {droppedInfo.dropped.length} {droppedInfo.dropped.length === 1 ? 'was' : 'were'} in unreachable areas
          <span class="text-yellow-600 ml-1">({droppedInfo.dropped.map(w => w.name).join(', ')})</span>
        </div>
      {/if}
      <button
        onclick={handleModifyWaypoints}
        class="mt-2 text-sm text-blue-600 hover:text-blue-800 underline"
      >
        Modify Waypoints
      </button>
    </div>

  {:else if discovering}
    <!-- State 2: Discovery in progress -->
    <div class="p-4">
      <div class="flex items-center gap-2 mb-3">
        <svg class="animate-spin w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <span class="text-sm font-medium text-gray-700">Searching for scenic points of interest...</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2.5 mb-2">
        <div
          class="bg-green-600 h-2.5 rounded-full transition-all duration-300"
          style="width: {progress}%"
        ></div>
      </div>
      <p class="text-xs text-gray-500">{status}</p>
    </div>

  {:else if complete}
    <!-- State 3: Discovery complete -->
    <div class="p-4 space-y-4">
      <!-- Summary -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-lg">{'\u{1F50D}'}</span>
          <span class="text-sm font-semibold text-gray-700">
            Found {scored.length} scenic points of interest
          </span>
        </div>
        <button
          onclick={handleDiscover}
          class="text-xs text-gray-400 hover:text-blue-600 transition-colors"
          title="Re-discover"
        >
          Re-scan
        </button>
      </div>

      <!-- Category filter chips -->
      <div class="flex flex-wrap gap-1.5">
        {#each Object.entries(categories) as [key, cat]}
          {@const count = categoryCounts()[key] || 0}
          {#if count > 0}
            <button
              onclick={() => handleCategoryToggle(key)}
              class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border transition-colors"
              class:bg-white={!activeFilters.has(key)}
              class:text-gray-400={!activeFilters.has(key)}
              class:border-gray-200={!activeFilters.has(key)}
              class:text-white={activeFilters.has(key)}
              class:border-transparent={activeFilters.has(key)}
              style={activeFilters.has(key) ? `background-color: ${categoryColors[key]}` : ''}
            >
              <span>{cat.emoji}</span>
              <span>{cat.label}</span>
              <span class="opacity-75">({count})</span>
            </button>
          {/if}
        {/each}
      </div>

      <!-- Selected count -->
      <div class="flex items-center justify-between text-sm">
        <span class="text-gray-600">
          <span class="font-semibold text-blue-600">{selected.length}</span> waypoint{selected.length !== 1 ? 's' : ''} selected
        </span>
        {#if selected.length !== recommended.length}
          <button
            onclick={() => setSelectedWaypoints([...recommended])}
            class="text-xs text-blue-500 hover:text-blue-700 underline"
          >
            Reset to recommended
          </button>
        {/if}
      </div>

      <!-- POI List -->
      <div class="max-h-64 overflow-y-auto space-y-1 -mx-1 px-1">
        {#each displayedPOIs as poi}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            onclick={() => handleToggle(poi)}
            class="flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors"
            class:bg-blue-50={isSelected(poi)}
            class:hover:bg-gray-50={!isSelected(poi)}
            class:hover:bg-blue-100={isSelected(poi)}
          >
            <!-- Checkbox -->
            <div class="flex-shrink-0">
              {#if isSelected(poi)}
                <div class="w-5 h-5 rounded bg-blue-600 flex items-center justify-center">
                  <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                  </svg>
                </div>
              {:else}
                <div class="w-5 h-5 rounded border-2 border-gray-300"></div>
              {/if}
            </div>

            <!-- Category dot -->
            <div
              class="w-3 h-3 rounded-full flex-shrink-0"
              style="background-color: {categoryColors[poi.category] || '#6b7280'}"
            ></div>

            <!-- Name and details -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="text-sm font-medium text-gray-900 truncate">{poi.name}</span>
                {#if isRecommended(poi)}
                  <span class="text-yellow-500 flex-shrink-0" title="Recommended">{'\u2B50'}</span>
                {/if}
              </div>
              <div class="text-xs text-gray-500">
                {categories[poi.category]?.label || poi.category}
                <span class="text-gray-300 mx-1">|</span>
                {formatDistance(poi.distanceFromRoute, params.units)} detour
              </div>
            </div>

            <!-- Score badge -->
            <div class="flex-shrink-0 bg-gray-100 text-gray-600 text-xs font-mono px-1.5 py-0.5 rounded">
              {poi.score.toFixed(1)}
            </div>
          </div>
        {/each}
      </div>

      <!-- Show more -->
      {#if filteredPOIs.length > 15}
        <button
          onclick={() => showAllPOIs = !showAllPOIs}
          class="w-full text-xs text-gray-500 hover:text-blue-600 py-1"
        >
          {showAllPOIs ? 'Show less' : `Show all ${filteredPOIs.length} results`}
        </button>
      {/if}

      <!-- Apply button -->
      <button
        onclick={handleApplyWaypoints}
        disabled={applying || selected.length === 0}
        class="w-full bg-green-600 text-white font-semibold py-2.5 px-4 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shadow-sm"
      >
        {#if applying}
          <span class="inline-flex items-center gap-2">
            <svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Re-routing...
          </span>
        {:else}
          Apply {selected.length} Waypoint{selected.length !== 1 ? 's' : ''} & Re-route
        {/if}
      </button>
    </div>

  {:else}
    <!-- State 1: Not yet discovered -->
    <div class="p-4 text-center">
      <div class="mb-3">
        <span class="text-3xl">{'\u{1F52D}'}</span>
      </div>
      <h3 class="text-sm font-semibold text-gray-700 mb-1">Discover Scenic Waypoints</h3>
      <p class="text-xs text-gray-500 mb-4">
        Find viewpoints, national parks, campgrounds, and scenic landmarks along your route corridor
      </p>
      <button
        onclick={handleDiscover}
        disabled={discovering}
        class="bg-green-600 text-white font-semibold py-2.5 px-6 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shadow-sm"
      >
        Discover Scenic Route
      </button>
    </div>
  {/if}
</div>
