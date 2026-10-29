<script>
  /**
   * NarratorDayPanel — displays the AI guide briefing for a single day.
   * Rendered inline beneath DayCard when that day is selected.
   *
   * Props:
   *   day - one day object from TripNarration.days
   */
  let { day } = $props();

  const flagBorderColors = {
    warning: 'border-red-300 bg-red-50',
    info: 'border-blue-300 bg-blue-50',
    tip: 'border-amber-300 bg-amber-50',
  };

  const flagTextColors = {
    warning: 'text-red-800',
    info: 'text-blue-800',
    tip: 'text-amber-800',
  };
</script>

{#if day}
  <div class="mx-1 mb-2 rounded-b-lg border border-t-0 border-slate-200 bg-slate-50 px-4 py-3 space-y-3">
    <!-- Headline -->
    <p class="text-sm font-semibold text-slate-700 italic leading-snug">"{day.headline}"</p>

    <!-- Narrative -->
    <p class="text-sm text-slate-600 leading-relaxed">{day.narrative}</p>

    <!-- Camping / lodging note -->
    {#if day.campingNote}
      <div class="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-800 leading-relaxed">
        <span class="font-medium">Tonight:</span> {day.campingNote}
      </div>
    {/if}

    <!-- Flags -->
    {#if day.flags && day.flags.length > 0}
      <div class="flex flex-wrap gap-2">
        {#each day.flags.slice(0, 4) as flag}
          <div class="flex items-center gap-1.5 border rounded-lg px-2.5 py-1 text-xs font-medium leading-tight {flagBorderColors[flag.type] || flagBorderColors.info} {flagTextColors[flag.type] || flagTextColors.info}">
            <span>{flag.icon}</span>
            <span>{flag.text}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
