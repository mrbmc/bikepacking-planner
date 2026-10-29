<script>
  import { getTripParams } from '$lib/state/tripState.svelte.js';
  import { getFullRoute, setFullRoute, setRouteSummary, getDaySegments, setDaySegments } from '$lib/state/routeState.svelte.js';
  import { getOrsApiKey, getIsLoading, getLoadingMessage, startLoading, stopLoading, setLoadingMessage, setErrorMessage, getErrorMessage, getSelectedDay, setSelectedDay } from '$lib/state/uiState.svelte.js';
  import { getRoute, getRouteWithWaypoints } from '$lib/services/router.js';
  import { projectOntoLine, haversine } from '$lib/services/corridorDiscovery.js';
  import { splitRouteIntoDays, recalculateSegments } from '$lib/utils/segmentCalculator.js';
  import { formatDistance, formatElevation, milesToMeters, kmToMeters } from '$lib/utils/units.js';
  import DayCard from '$lib/components/shared/DayCard.svelte';
  import ElevationChart from '$lib/components/shared/ElevationChart.svelte';
  import ScenicDiscoveryPanel from '$lib/components/wizard/ScenicDiscoveryPanel.svelte';
  import { resetDiscovery } from '$lib/state/discoveryState.svelte.js';
  import { resetNarration } from '$lib/state/narratorState.svelte.js';
  import {
    getCampsiteCandidates, getSelectedCampsites, getDismissedDays,
    getCampsiteStatus, getCampsiteError,
    setCampsiteCandidates, setCampsiteStatus, setCampsiteError, resetCampsites,
  } from '$lib/state/campsiteState.svelte.js';
  import { findCampsitesForAllDays } from '$lib/services/campsiteFinder.js';
  import { findRoutablePoint } from '$lib/services/geocoder.js';
  import CampsitePanel from '$lib/components/shared/CampsitePanel.svelte';

  const params = $derived(getTripParams());
  const route = $derived(getFullRoute());
  const segments = $derived(getDaySegments());
  const loading = $derived(getIsLoading());
  const loadingMsg = $derived(getLoadingMessage());
  const errorMsg = $derived(getErrorMessage());
  const selectedDay = $derived(getSelectedDay());
  const campsiteCandidates = $derived(getCampsiteCandidates());
  const selectedCampsites = $derived(getSelectedCampsites());
  const dismissedDays = $derived(getDismissedDays());
  const campsiteStatus = $derived(getCampsiteStatus());
  const campsiteError = $derived(getCampsiteError());

  // Surface preference → ORS profile mapping
  // 'any' = cycling-regular (mixed surfaces, prefers cycle paths)
  // 'road' = cycling-road (paved roads, faster)
  // 'dirt' = cycling-mountain (unpaved tracks, gravel, forest roads)
  let surfacePref = $state('any');

  const SURFACE_PROFILES = {
    any: 'cycling-regular',
    road: 'cycling-road',
    dirt: 'cycling-mountain',
  };

  // Auto-generate route when this step is shown and there's no route yet
  let hasTriggered = $state(false);

  $effect(() => {
    if (!hasTriggered && segments.length === 0 && !loading && params.startCoords && params.endCoords) {
      hasTriggered = true;
      generateRoute();
    }
  });

  async function generateRoute() {
    const apiKey = getOrsApiKey();
    if (!apiKey) {
      setErrorMessage('Please set your OpenRouteService API key first.');
      return;
    }
    resetNarration(); // Clear stale guide briefing when route is regenerated
    startLoading('Generating cycling route...');
    setErrorMessage('');
    try {
      // Use note waypoints already geocoded in Step 1
      let noteWaypoints = [...(params.noteWaypoints || [])];
      if (noteWaypoints.length > 0) {
        console.log('[route] Using note waypoints from Step 1:', noteWaypoints.map(w => w.name));

        const [sLat, sLng] = params.startCoords;
        const [eLat, eLng] = params.endCoords;

        // Sort waypoints geographically along the start→end axis
        if (noteWaypoints.length > 1) {
          noteWaypoints.sort((a, b) => {
            const projA = projectOntoLine(a.lat, a.lng, sLat, sLng, eLat, eLng);
            const projB = projectOntoLine(b.lat, b.lng, sLat, sLng, eLat, eLng);
            return projA - projB;
          });
          console.log('[route] Waypoints sorted:', noteWaypoints.map(w => w.name));
        }

        // Waypoints are already snapped to routable points in Step 1.
        // Set distanceFromRoute so fallback removal in router.js picks the right one
        for (const wp of noteWaypoints) {
          const proj = projectOntoLine(wp.lat, wp.lng, sLat, sLng, eLat, eLng);
          const clampedProj = Math.max(0, Math.min(1, proj));
          const projLat = sLat + clampedProj * (eLat - sLat);
          const projLng = sLng + clampedProj * (eLng - sLng);
          wp.distanceFromRoute = haversine(wp.lat, wp.lng, projLat, projLng);
        }
      }

      const profile = SURFACE_PROFILES[surfacePref] || 'cycling-regular';
      setLoadingMessage(`Generating ${surfacePref === 'dirt' ? 'off-road' : surfacePref === 'road' ? 'road' : 'cycling'} route...`);

      let routeData;
      if (noteWaypoints.length > 0) {
        // Route through noted places
        routeData = await getRouteWithWaypoints(
          params.startCoords, params.endCoords, noteWaypoints, apiKey, profile
        );
      } else {
        // Direct route (no notes)
        routeData = await getRoute(params.startCoords, params.endCoords, apiKey, profile);
      }

      // Warn if any waypoints were dropped during routing
      if (routeData._droppedWaypoints && routeData._droppedWaypoints.length > 0) {
        const names = routeData._droppedWaypoints.map(w => w.name || 'unnamed').join(', ');
        console.warn('[route] Dropped waypoints:', names);
        setErrorMessage(`Could not route through: ${names}. The route may not pass through all specified waypoints.`);
      }

      setFullRoute(routeData);

      // Extract route summary from GeoJSON
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

        // Convert dailyDistancePref from user units to meters
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
    } catch (e) {
      setErrorMessage(e.message);
    } finally {
      stopLoading();
    }
  }

  function handleDayDistanceChange(dayIndex, newDistance) {
    const route = getFullRoute();
    const feature = route?.features?.[0];
    if (!feature) return;
    const coordinates = feature.geometry?.coordinates || [];
    const currentSegments = getDaySegments();
    const updated = recalculateSegments(coordinates, currentSegments, dayIndex, newDistance);
    setDaySegments(updated);
  }

  function handleDaySelect(dayIndex) {
    setSelectedDay(getSelectedDay() === dayIndex + 1 ? null : dayIndex + 1);
  }

  async function handleFindCampsites() {
    const feature = route?.features?.[0];
    if (!feature || segments.length === 0) return;
    const coords = feature.geometry?.coordinates || [];
    setCampsiteStatus('loading');
    setCampsiteError('');
    try {
      const results = await findCampsitesForAllDays(
        segments, coords,
        (done, total) => setLoadingMessage(`Finding campsites… day ${done} of ${total}`)
      );
      setCampsiteCandidates(results);
      setCampsiteStatus('done');
    } catch (e) {
      setCampsiteError(e.message || 'Failed to find campsites.');
      setCampsiteStatus('error');
    } finally {
      setLoadingMessage('');
    }
  }

  async function handleApplyCampsites() {
    const apiKey = getOrsApiKey();
    if (!apiKey) return;

    // Collect selected campsites (non-null, non-dismissed)
    const campsiteWaypoints = [];
    for (const [dayIdxStr, campsite] of Object.entries(selectedCampsites)) {
      if (campsite && !dismissedDays.has(Number(dayIdxStr))) {
        campsiteWaypoints.push(campsite);
      }
    }
    if (campsiteWaypoints.length === 0) return;

    resetNarration();
    startLoading('Routing through selected campsites...');
    setErrorMessage('');

    try {
      const profile = SURFACE_PROFILES[surfacePref] || 'cycling-regular';

      // Snap campsites to routable road points
      const snapped = [];
      for (const wp of campsiteWaypoints) {
        try {
          const s = await findRoutablePoint(wp.lat, wp.lng, wp.name);
          snapped.push(s ? { ...wp, lat: s.lat, lng: s.lng } : wp);
        } catch {
          snapped.push(wp);
        }
      }

      // Sort geographically along route axis
      const [sLat, sLng] = params.startCoords;
      const [eLat, eLng] = params.endCoords;
      snapped.sort((a, b) =>
        projectOntoLine(a.lat, a.lng, sLat, sLng, eLat, eLng) -
        projectOntoLine(b.lat, b.lng, sLat, sLng, eLat, eLng)
      );

      // Merge with any existing note waypoints
      const noteWaypoints = [...(params.noteWaypoints || [])];
      const allWaypoints = [...noteWaypoints, ...snapped];
      allWaypoints.sort((a, b) =>
        projectOntoLine(a.lat, a.lng, sLat, sLng, eLat, eLng) -
        projectOntoLine(b.lat, b.lng, sLat, sLng, eLat, eLng)
      );

      // Add distanceFromRoute for progressive fallback
      for (const wp of allWaypoints) {
        const proj = Math.max(0, Math.min(1, projectOntoLine(wp.lat, wp.lng, sLat, sLng, eLat, eLng)));
        const projLat = sLat + proj * (eLat - sLat);
        const projLng = sLng + proj * (eLng - sLng);
        wp.distanceFromRoute = haversine(wp.lat, wp.lng, projLat, projLng);
      }

      const routeData = await getRouteWithWaypoints(
        params.startCoords, params.endCoords, allWaypoints, apiKey, profile
      );
      setFullRoute(routeData);

      const feature = routeData.features?.[0];
      if (feature) {
        const summary = feature.properties?.summary || {};
        setRouteSummary({
          totalDistance: summary.distance || 0,
          totalAscent: summary.ascent || 0,
          totalDescent: summary.descent || 0,
          bbox: routeData.bbox || feature.bbox || null,
        });
        const coordinates = feature.geometry?.coordinates || [];
        let dailyDistMeters = 0;
        if (params.dailyDistancePref > 0) {
          dailyDistMeters = params.units === 'miles'
            ? milesToMeters(params.dailyDistancePref)
            : kmToMeters(params.dailyDistancePref);
        }
        setDaySegments(splitRouteIntoDays(coordinates, params.totalDays, dailyDistMeters));
      }

      // Mark as applied so UI reflects the update
      setCampsiteStatus('applied');
    } catch (e) {
      setErrorMessage(e.message);
    } finally {
      stopLoading();
    }
  }

  const totalDistance = $derived(segments.reduce((sum, s) => sum + (s.distance || 0), 0));
  const totalGain = $derived(segments.reduce((sum, s) => sum + (s.elevationGain || 0), 0));
  const hasRoute = $derived(segments.length > 0);
</script>

<div class="space-y-6">
  {#if loading}
    <!-- Loading State -->
    <div class="text-center py-12">
      <div class="mb-4">
        <svg class="animate-spin w-10 h-10 mx-auto text-blue-600" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
      </div>
      <p class="text-gray-600 font-medium">{loadingMsg || 'Generating cycling route...'}</p>
      <p class="text-gray-400 text-sm mt-1">{params.startName || 'Start'} &rarr; {params.endName || 'End'}</p>
    </div>
  {:else if !hasRoute}
    <!-- Fallback: Generate Route Button (in case auto-trigger didn't fire) -->
    <div class="text-center py-6 space-y-4">
      <div>
        <p class="text-gray-600 text-sm mb-1">
          {params.startName || 'Start'} &rarr; {params.endName || 'End'}
        </p>
        <p class="text-gray-400 text-xs">{params.totalDays} days</p>
      </div>
      <div class="flex items-center justify-center gap-3">
        <span class="text-xs font-medium text-gray-500 uppercase tracking-wide">Surface</span>
        <div class="flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium">
          {#each [['any', 'Any'], ['road', 'Road'], ['dirt', 'Dirt']] as [val, label]}
            <button
              onclick={() => { surfacePref = val; }}
              class="px-3 py-1.5 transition-colors {surfacePref === val
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'}"
            >
              {label}
            </button>
          {/each}
        </div>
      </div>
      <button
        onclick={generateRoute}
        class="bg-blue-600 text-white font-semibold py-3 px-8 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
      >
        Generate Route
      </button>
    </div>
  {:else}
    <!-- Route Summary -->
    <div class="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg p-4 border border-blue-100">
      <h3 class="text-sm font-semibold text-gray-700 mb-2">Route Summary</h3>
      <div class="grid grid-cols-3 gap-4 text-center">
        <div>
          <p class="text-lg font-bold text-blue-700">{formatDistance(totalDistance, params.units)}</p>
          <p class="text-xs text-gray-500">Total Distance</p>
        </div>
        <div>
          <p class="text-lg font-bold text-green-700">{formatElevation(totalGain, params.units)}</p>
          <p class="text-xs text-gray-500">Total Climbing</p>
        </div>
        <div>
          <p class="text-lg font-bold text-gray-700">{segments.length}</p>
          <p class="text-xs text-gray-500">Days</p>
        </div>
      </div>
      {#if params.routeNotes}
        <p class="text-xs text-gray-500 mt-2 italic">Notes: {params.routeNotes}</p>
      {/if}
    </div>

    <!-- Scenic Discovery Panel -->
    <ScenicDiscoveryPanel />

    <!-- Day Segments -->
    <div>
      <h3 class="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Daily Breakdown</h3>
      <p class="text-xs text-gray-400 mb-3">Drag the slider on any day to adjust its distance. Other days will re-balance automatically.</p>
      <div class="space-y-2">
        {#each segments as segment, i}
          <DayCard
            {segment}
            editable={true}
            selected={selectedDay === segment.day}
            units={params.units}
            onselect={() => handleDaySelect(i)}
            onchange={(newDist) => handleDayDistanceChange(i, newDist)}
          />
          {#if campsiteStatus === 'done' || campsiteStatus === 'applied'}
            {#if campsiteCandidates[i]?.length > 0 && !dismissedDays.has(i) && i < segments.length - 1}
              <CampsitePanel
                dayIndex={i}
                candidates={campsiteCandidates[i]}
                selected={selectedCampsites[i]}
                dismissed={dismissedDays.has(i)}
                units={params.units}
              />
            {/if}
          {/if}
        {/each}
      </div>
    </div>

    <!-- Elevation Chart -->
    <div>
      <h3 class="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Elevation Profile</h3>
      <div class="bg-white border border-gray-200 rounded-lg p-3">
        <ElevationChart
          {segments}
          {selectedDay}
          height={180}
          units={params.units}
        />
      </div>
    </div>

    <!-- Surface Preference + Regenerate -->
    <div class="border-t border-gray-100 pt-4 space-y-3">
      <div class="flex items-center gap-3">
        <span class="text-xs font-medium text-gray-500 uppercase tracking-wide shrink-0">Surface</span>
        <div class="flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium">
          {#each [['any', 'Any'], ['road', 'Road'], ['dirt', 'Dirt']] as [val, label]}
            <button
              onclick={() => { surfacePref = val; }}
              class="px-3 py-1.5 transition-colors {surfacePref === val
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'}"
            >
              {label}
            </button>
          {/each}
        </div>
        <span class="text-xs text-gray-400">
          {surfacePref === 'dirt' ? 'Gravel, tracks & forest roads' : surfacePref === 'road' ? 'Paved roads only' : 'Mixed — prefers cycle paths'}
        </span>
      </div>

      <!-- Find Campsites -->
      {#if campsiteStatus === 'idle' || campsiteStatus === 'error'}
        <button
          onclick={handleFindCampsites}
          disabled={loading}
          class="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white text-sm font-semibold py-2.5 px-4 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          ⛺ Find Campsites Along Route
        </button>
        {#if campsiteStatus === 'error'}
          <p class="text-xs text-red-500 text-center">{campsiteError}</p>
        {/if}
      {:else if campsiteStatus === 'loading'}
        <div class="flex items-center justify-center gap-2 py-2 text-sm text-emerald-700">
          <svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <span>{loadingMsg || 'Finding campsites…'}</span>
        </div>
      {:else if campsiteStatus === 'done' || campsiteStatus === 'applied'}
        <!-- Apply Selected Campsites -->
        {@const anySelected = Object.entries(selectedCampsites).some(
          ([idx, c]) => c !== null && !dismissedDays.has(Number(idx))
        )}
        {#if anySelected && campsiteStatus === 'done'}
          <button
            onclick={handleApplyCampsites}
            disabled={loading}
            class="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white text-sm font-semibold py-2.5 px-4 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            ✓ Apply Selected Campsites &rarr;
          </button>
        {:else if campsiteStatus === 'applied'}
          <div class="flex items-center justify-center gap-2 py-2 text-sm text-emerald-700 font-medium">
            ✓ Route updated through selected campsites
          </div>
        {/if}
        <button
          onclick={() => { resetCampsites(); }}
          class="w-full text-xs text-emerald-500 hover:text-emerald-700 transition-colors py-1"
        >
          Clear campsite suggestions
        </button>
      {/if}

      <button
        onclick={() => { hasTriggered = false; resetDiscovery(); resetCampsites(); generateRoute(); }}
        disabled={loading}
        class="w-full text-gray-500 text-sm py-2 hover:text-blue-600 transition-colors"
      >
        Regenerate Route
      </button>
    </div>
  {/if}

  {#if errorMsg && !loading}
    <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
      {errorMsg}
    </div>
  {/if}
</div>
