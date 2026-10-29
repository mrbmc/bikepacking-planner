<script>
  import { metersToMiles, metersToKm } from '$lib/utils/units.js';
  import { selectCampsite, dismissCampsiteDay } from '$lib/state/campsiteState.svelte.js';

  /**
   * Props:
   *   dayIndex    - 0-based index of the day
   *   candidates  - Array of scored campsite objects for this day
   *   selected    - Currently selected campsite for this day (or null)
   *   dismissed   - Whether this day has been dismissed
   *   units       - 'miles' | 'km'
   */
  let { dayIndex, candidates = [], selected = null, dismissed = false, units = 'miles' } = $props();

  function formatDetour(meters) {
    if (units === 'miles') {
      return `${metersToMiles(meters).toFixed(1)} mi`;
    }
    return `${metersToKm(meters).toFixed(1)} km`;
  }

  function isSelected(campsite) {
    return selected?.id === campsite.id;
  }

  function getTagPills(tags) {
    const pills = [];
    if (tags.fee === 'yes') pills.push({ label: 'Fee', color: 'bg-yellow-100 text-yellow-800' });
    else if (tags.fee === 'no' || !tags.fee) pills.push({ label: 'Free', color: 'bg-green-100 text-green-800' });
    if (tags.access === 'private') pills.push({ label: 'Private', color: 'bg-red-100 text-red-800' });
    else pills.push({ label: 'Public', color: 'bg-blue-100 text-blue-800' });
    if (tags.backcountry === 'yes') pills.push({ label: 'Backcountry', color: 'bg-emerald-100 text-emerald-800' });
    if (tags.tents === 'yes') pills.push({ label: 'Tents ✓', color: 'bg-slate-100 text-slate-700' });
    return pills;
  }
</script>

{#if !dismissed && candidates.length > 0}
  <div class="mx-1 mb-2 rounded-b-lg border border-t-0 border-emerald-200 bg-emerald-50 px-3 py-3">
    <!-- Header -->
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs font-semibold text-emerald-800 uppercase tracking-wide flex items-center gap-1">
        ⛺ Recommended Campsites
      </span>
      <button
        onclick={() => dismissCampsiteDay(dayIndex)}
        class="text-xs text-emerald-500 hover:text-emerald-700 transition-colors"
        title="Dismiss campsite suggestions for this day"
      >
        Dismiss
      </button>
    </div>

    <!-- Candidate list -->
    <div class="space-y-1.5">
      {#each candidates as campsite}
        {@const pills = getTagPills(campsite.tags)}
        <button
          onclick={() => selectCampsite(dayIndex, isSelected(campsite) ? null : campsite)}
          class="w-full text-left rounded-lg border px-3 py-2 transition-colors {isSelected(campsite)
            ? 'border-emerald-500 bg-white shadow-sm'
            : 'border-emerald-200 bg-white/60 hover:bg-white'}"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <!-- Radio indicator -->
              <span class="shrink-0 mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center {isSelected(campsite) ? 'border-emerald-600' : 'border-gray-300'}">
                {#if isSelected(campsite)}
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                {/if}
              </span>
              <span class="text-sm font-medium text-gray-800 truncate">{campsite.name}</span>
            </div>
            <span class="text-xs text-gray-500 shrink-0">
              {formatDetour(campsite.distanceFromIdeal)} off route
            </span>
          </div>
          <!-- Tag pills -->
          {#if pills.length > 0}
            <div class="flex flex-wrap gap-1 mt-1 ml-5">
              {#each pills as pill}
                <span class="text-xs px-1.5 py-0.5 rounded-full font-medium {pill.color}">{pill.label}</span>
              {/each}
            </div>
          {/if}
        </button>
      {/each}
    </div>
  </div>
{/if}
