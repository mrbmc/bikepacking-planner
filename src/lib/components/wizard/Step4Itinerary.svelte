<script>
  import { getTripParams, getTripDescription, resetTrip } from '$lib/state/tripState.svelte.js';
  import { getDaySegments, getFullRoute, resetRoute, updateDaySegment } from '$lib/state/routeState.svelte.js';
  import { setCurrentStep, getSelectedDay, setSelectedDay, startLoading, stopLoading, setErrorMessage, getIsLoading, getErrorMessage, getAnthropicApiKey } from '$lib/state/uiState.svelte.js';
  import { getNarration, getNarrationStatus, getNarrationError, setNarration, setNarrationStatus, setNarrationError, resetNarration } from '$lib/state/narratorState.svelte.js';
  import { resetCampsites } from '$lib/state/campsiteState.svelte.js';
  import { getSelectedWaypoints } from '$lib/state/discoveryState.svelte.js';
  import { findSupplyStopsAlongRoute } from '$lib/services/overpass.js';
  import { generateGPX, downloadGPX, generateTextItinerary } from '$lib/services/gpxExport.js';
  import { buildTripContext, generateTripNarration } from '$lib/services/tripNarrator.js';
  import { formatDistance, formatElevation } from '$lib/utils/units.js';
  import DayCard from '$lib/components/shared/DayCard.svelte';
  import ElevationChart from '$lib/components/shared/ElevationChart.svelte';
  import NarratorBriefing from '$lib/components/shared/NarratorBriefing.svelte';
  import NarratorDayPanel from '$lib/components/shared/NarratorDayPanel.svelte';

  const params = $derived(getTripParams());
  const tripDescription = $derived(getTripDescription());
  const segments = $derived(getDaySegments());
  const route = $derived(getFullRoute());
  const selectedDay = $derived(getSelectedDay());
  const loading = $derived(getIsLoading());
  const errorMsg = $derived(getErrorMessage());
  const narration = $derived(getNarration());
  const narrationStatus = $derived(getNarrationStatus());
  const narrationError = $derived(getNarrationError());

  let supplyStopsLoaded = $state(false);
  let copied = $state(false);

  const tripName = $derived(
    `${params.startName || 'Start'} to ${params.endName || 'End'} - ${params.totalDays} Day Bikepacking Trip`
  );

  const totalDistance = $derived(segments.reduce((sum, s) => sum + (s.distance || 0), 0));
  const totalGain = $derived(segments.reduce((sum, s) => sum + (s.elevationGain || 0), 0));
  const totalLoss = $derived(segments.reduce((sum, s) => sum + (s.elevationLoss || 0), 0));

  async function findSupplyStops() {
    const feature = route?.features?.[0];
    if (!feature) return;
    startLoading('Finding supply stops along route...');
    setErrorMessage('');
    try {
      const coords = feature.geometry?.coordinates || [];
      const stops = await findSupplyStopsAlongRoute(coords, 50);
      // Assign stops to nearest day segment
      // Simple approach: assign each stop to the nearest segment endpoint
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segStops = stops.filter((stop) => {
          if (!seg.endCoord) return false;
          const dist = Math.sqrt(
            Math.pow(stop.lat - seg.endCoord[0], 2) +
            Math.pow(stop.lng - seg.endCoord[1], 2)
          );
          return dist < 0.5; // rough ~50km proximity in degrees
        });
        if (segStops.length > 0) {
          updateDaySegment(i, { supplyStops: segStops });
        }
      }
      supplyStopsLoaded = true;
    } catch (e) {
      setErrorMessage(`Failed to find supply stops: ${e.message}`);
    } finally {
      stopLoading();
    }
  }

  function handleDownloadGPX() {
    const gpx = generateGPX(segments, tripName);
    const filename = tripName.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase() + '.gpx';
    downloadGPX(gpx, filename);
  }

  async function handleCopyItinerary() {
    const text = generateTextItinerary(segments, tripName, params.units);
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    }
  }

  async function handleGenerateBriefing() {
    const apiKey = getAnthropicApiKey();
    if (!apiKey) {
      setNarrationError('Anthropic API key not configured.');
      setNarrationStatus('error');
      return;
    }
    setNarrationStatus('loading');
    setNarrationError('');
    try {
      const selectedWaypoints = getSelectedWaypoints();
      const ctx = buildTripContext(params, tripDescription, segments, selectedWaypoints);
      const result = await generateTripNarration(ctx, apiKey);
      setNarration(result);
      setNarrationStatus('done');
    } catch (e) {
      setNarrationError(e.message || 'Failed to generate guide briefing.');
      setNarrationStatus('error');
    }
  }

  function handleStartOver() {
    resetTrip();
    resetRoute();
    resetNarration();
    resetCampsites();
    setCurrentStep(1);
    setSelectedDay(null);
  }

  function handleDaySelect(dayIndex) {
    setSelectedDay(getSelectedDay() === dayIndex + 1 ? null : dayIndex + 1);
  }
</script>

<div class="space-y-6">
  <!-- Trip Header -->
  <div class="text-center">
    <h2 class="text-xl font-bold text-gray-900">{tripName}</h2>
    <div class="flex justify-center gap-6 mt-2 text-sm text-gray-500">
      <span>{formatDistance(totalDistance, params.units)}</span>
      <span>{'\u2191'} {formatElevation(totalGain, params.units)}</span>
      <span>{'\u2193'} {formatElevation(totalLoss, params.units)}</span>
    </div>
  </div>

  <!-- Elevation Profile -->
  <div class="bg-white border border-gray-200 rounded-lg p-3">
    <ElevationChart
      {segments}
      {selectedDay}
      height={160}
      units={params.units}
    />
  </div>

  <!-- Route Character Card (shown when narration is ready) -->
  {#if narrationStatus === 'done' && narration}
    <NarratorBriefing {narration} />
  {/if}

  <!-- Day-by-Day Breakdown -->
  <div>
    <h3 class="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Day-by-Day Itinerary</h3>
    <div class="space-y-2">
      {#each segments as segment, i}
        <DayCard
          {segment}
          editable={false}
          selected={selectedDay === segment.day}
          units={params.units}
          onselect={() => handleDaySelect(i)}
        />
        {#if narrationStatus === 'done' && narration?.days?.[i] && selectedDay === segment.day}
          <NarratorDayPanel day={narration.days[i]} />
        {/if}
      {/each}
    </div>
  </div>

  <!-- Supply Stops -->
  <div>
    {#if !supplyStopsLoaded}
      <button
        onclick={findSupplyStops}
        disabled={loading}
        class="w-full bg-green-600 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        {#if loading}
          <span class="inline-flex items-center gap-2">
            <svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Finding Supply Stops...
          </span>
        {:else}
          Find Supply Stops Along Route
        {/if}
      </button>
    {:else}
      <p class="text-sm text-green-600 flex items-center gap-1">
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
        Supply stops loaded - shown on day cards and map
      </p>
    {/if}
  </div>

  {#if errorMsg}
    <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
      {errorMsg}
    </div>
  {/if}

  <!-- Guide Briefing -->
  <div>
    {#if narrationStatus === 'idle'}
      <button
        onclick={handleGenerateBriefing}
        disabled={loading}
        class="w-full bg-slate-700 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-slate-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        Generate Guide Briefing
      </button>
    {:else if narrationStatus === 'loading'}
      <div class="flex items-center justify-center gap-3 py-4 text-slate-600 text-sm">
        <svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        Consulting your trail guide...
      </div>
    {:else if narrationStatus === 'done'}
      <p class="text-xs text-slate-400 text-center">
        Guide briefing generated — click a day to see its briefing
      </p>
    {:else if narrationStatus === 'error'}
      <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between gap-3">
        <span>{narrationError || 'Failed to generate guide briefing.'}</span>
        <button
          onclick={() => { setNarrationStatus('idle'); setNarrationError(''); }}
          class="text-red-500 hover:text-red-700 text-xs underline shrink-0"
        >Retry</button>
      </div>
    {/if}
  </div>

  <!-- Export Section -->
  <div class="border-t border-gray-200 pt-4 space-y-3">
    <h3 class="text-sm font-semibold text-gray-600 uppercase tracking-wide">Export</h3>
    <div class="flex gap-2">
      <button
        onclick={handleDownloadGPX}
        class="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-blue-700 transition-colors"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Download GPX
      </button>
      <button
        onclick={handleCopyItinerary}
        class="flex-1 flex items-center justify-center gap-2 bg-gray-100 text-gray-700 font-medium py-2.5 px-4 rounded-lg border border-gray-300 hover:bg-gray-200 transition-colors"
      >
        {#if copied}
          <svg class="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
          Copied!
        {:else}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy Itinerary
        {/if}
      </button>
    </div>
  </div>

  <!-- Start Over -->
  <div class="border-t border-gray-200 pt-4">
    <button
      onclick={handleStartOver}
      class="w-full text-red-500 text-sm py-2 hover:text-red-700 transition-colors"
    >
      Start Over
    </button>
  </div>
</div>
