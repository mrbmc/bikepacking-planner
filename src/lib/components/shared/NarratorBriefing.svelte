<script>
  /**
   * NarratorBriefing — displays the AI-generated tour guide output.
   *
   * Props:
   *   narration  - full TripNarration object from tripNarrator.js
   *   selectedDay - currently selected day number (1-based), or null
   *   units       - 'miles' | 'km'
   */
  let { narration, selectedDay = null } = $props();

  const difficultyColors = {
    moderate: 'bg-green-100 text-green-800',
    hard: 'bg-orange-100 text-orange-800',
    very_hard: 'bg-red-100 text-red-800',
  };

  const difficultyLabels = {
    moderate: 'Moderate',
    hard: 'Hard',
    very_hard: 'Very Hard',
  };

  const flagColors = {
    warning: 'bg-red-50 border-red-200 text-red-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    tip: 'bg-amber-50 border-amber-200 text-amber-800',
  };
</script>

{#if narration}
  <!-- Route Character Card -->
  <div class="bg-gradient-to-br from-slate-800 to-slate-700 text-white rounded-xl p-4 shadow-md">
    <div class="flex items-start justify-between gap-3 mb-2">
      <p class="text-base font-semibold leading-snug flex-1">{narration.routeCharacter.headline}</p>
      <span class="shrink-0 text-xs font-medium px-2 py-1 rounded-full {difficultyColors[narration.routeCharacter.difficulty] || difficultyColors.moderate}">
        {difficultyLabels[narration.routeCharacter.difficulty] || narration.routeCharacter.difficulty}
      </span>
    </div>
    <p class="text-sm text-slate-300 leading-relaxed mb-2">{narration.routeCharacter.summary}</p>
    <p class="text-xs text-slate-400">
      <span class="font-medium text-slate-300">Best for:</span> {narration.routeCharacter.bestFor}
    </p>
  </div>

  <!-- Per-day panels — shown inline when the day is selected (rendered by parent) -->
  <!-- This component exposes a named slot-like pattern via the dayPanel snippet below -->
{/if}

<!-- Day panel — used as a standalone snippet in Step4Itinerary -->
<!-- Exported as a separate component for per-day use -->
