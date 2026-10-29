<script>
  import { getDaySegments, updateDaySegment } from '$lib/state/routeState.svelte.js';

  const segments = $derived(getDaySegments());

  // Nights = days - 1 (you don't need lodging after the last day)
  const nights = $derived(segments.slice(0, -1));

  const campCount = $derived(segments.filter((s) => s.accommodation === 'camp').length);
  const motelCount = $derived(segments.filter((s) => s.accommodation === 'motel').length);

  function setAccommodation(dayIndex, type) {
    const current = segments[dayIndex]?.accommodation;
    updateDaySegment(dayIndex, { accommodation: current === type ? null : type });
  }

  function setAll(type) {
    for (let i = 0; i < segments.length - 1; i++) {
      updateDaySegment(i, { accommodation: type });
    }
  }
</script>

<div class="space-y-6">
  <div>
    <h3 class="text-lg font-semibold text-gray-900 mb-1">Where will you stay each night?</h3>
    <p class="text-sm text-gray-500">Choose lodging for each night of your trip. This helps plan your daily stops.</p>
  </div>

  <!-- Bulk Actions -->
  <div class="flex gap-2">
    <button
      onclick={() => setAll('camp')}
      class="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-green-200 bg-green-50 text-green-700 text-sm font-medium hover:bg-green-100 transition-colors"
    >
      <span class="text-lg">{'\u{1F3D5}'}</span> Set All to Camp
    </button>
    <button
      onclick={() => setAll('motel')}
      class="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-purple-200 bg-purple-50 text-purple-700 text-sm font-medium hover:bg-purple-100 transition-colors"
    >
      <span class="text-lg">{'\u{1F3E8}'}</span> Set All to Motel
    </button>
  </div>

  <!-- Night-by-night Selection -->
  <div class="space-y-2">
    {#each nights as segment, i}
      <div class="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3">
        <div class="flex items-center gap-3">
          <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 text-gray-600 text-xs font-bold">
            {i + 1}
          </span>
          <div>
            <p class="text-sm font-medium text-gray-900">Night {i + 1}</p>
            <p class="text-xs text-gray-400 truncate max-w-[180px]" title={segment.endName || ''}>
              After Day {segment.day}{segment.endName ? ` - ${segment.endName}` : ''}
            </p>
          </div>
        </div>
        <div class="flex gap-1">
          <button
            onclick={() => setAccommodation(i, 'camp')}
            class="px-3 py-1.5 rounded-md text-sm font-medium transition-all
              {segment.accommodation === 'camp'
                ? 'bg-green-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-500 hover:bg-green-50 hover:text-green-700'}"
            title="Camp"
          >
            {'\u{1F3D5}'} Camp
          </button>
          <button
            onclick={() => setAccommodation(i, 'motel')}
            class="px-3 py-1.5 rounded-md text-sm font-medium transition-all
              {segment.accommodation === 'motel'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-500 hover:bg-purple-50 hover:text-purple-700'}"
            title="Motel"
          >
            {'\u{1F3E8}'} Motel
          </button>
        </div>
      </div>
    {/each}
  </div>

  <!-- Summary -->
  <div class="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-600">
    <div class="flex justify-between">
      <span>{'\u{1F3D5}'} {campCount} night{campCount !== 1 ? 's' : ''} camping</span>
      <span>{'\u{1F3E8}'} {motelCount} night{motelCount !== 1 ? 's' : ''} motel</span>
    </div>
    {#if nights.length - campCount - motelCount > 0}
      <p class="text-xs text-gray-400 mt-1">
        {nights.length - campCount - motelCount} night{nights.length - campCount - motelCount !== 1 ? 's' : ''} unset
      </p>
    {/if}
  </div>
</div>
