<script>
  import { formatDistance, formatElevation } from '$lib/utils/units.js';

  let {
    segment,
    editable = false,
    selected = false,
    units = 'miles',
    onselect = null,
    onchange = null,
  } = $props();

  let sliderValue = $state(0);

  $effect(() => {
    sliderValue = segment.distance;
  });

  function handleSliderInput(e) {
    sliderValue = parseFloat(e.target.value);
  }

  function handleSliderChange() {
    if (onchange && sliderValue !== segment.distance) {
      onchange(sliderValue);
    }
  }

  function handleClick() {
    if (onselect) onselect();
  }

  const accommodationIcons = {
    camp: { icon: '\u{1F3D5}', label: 'Camp' },
    motel: { icon: '\u{1F3E8}', label: 'Motel' },
  };
</script>

<div
  class="rounded-lg border bg-white shadow-sm transition-all cursor-pointer hover:shadow-md
    {selected ? 'border-blue-500 ring-2 ring-blue-200 shadow-md' : 'border-gray-200'}"
  onclick={handleClick}
  onkeydown={(e) => e.key === 'Enter' && handleClick()}
  role="button"
  tabindex="0"
>
  <div class="p-4">
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <span class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold">
          {segment.day}
        </span>
        <h3 class="font-semibold text-gray-900">Day {segment.day}</h3>
      </div>
      <div class="flex items-center gap-2">
        {#if segment.accommodation}
          <span class="text-lg" title={accommodationIcons[segment.accommodation]?.label || segment.accommodation}>
            {accommodationIcons[segment.accommodation]?.icon || ''}
          </span>
        {/if}
        {#if segment.supplyStops?.length > 0}
          <span class="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
            </svg>
            {segment.supplyStops.length}
          </span>
        {/if}
        {#if segment.isLocked}
          <span class="text-xs text-amber-600" title="Distance manually adjusted">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </span>
        {/if}
      </div>
    </div>

    <div class="grid grid-cols-3 gap-3 text-sm text-gray-600 mb-1">
      <div>
        <span class="text-xs text-gray-400 block">Distance</span>
        <span class="font-medium text-gray-900">{formatDistance(editable ? sliderValue : segment.distance, units)}</span>
      </div>
      <div>
        <span class="text-xs text-gray-400 block">Gain</span>
        <span class="font-medium text-green-700">{formatElevation(segment.elevationGain || 0, units)}</span>
      </div>
      <div>
        <span class="text-xs text-gray-400 block">Loss</span>
        <span class="font-medium text-red-700">{formatElevation(segment.elevationLoss || 0, units)}</span>
      </div>
    </div>

    {#if segment.endName}
      <p class="text-xs text-gray-500 mt-1 truncate" title={segment.endName}>
        To: {segment.endName}
      </p>
    {/if}

    {#if editable}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="mt-3 pt-3 border-t border-gray-100" onclick={(e) => e.stopPropagation()}>
        <input
          type="range"
          min={segment.distance * 0.3}
          max={segment.distance * 2.0}
          step={100}
          value={sliderValue}
          oninput={handleSliderInput}
          onchange={handleSliderChange}
          class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
        />
        <div class="flex justify-between text-xs text-gray-400 mt-1">
          <span>{formatDistance(segment.distance * 0.3, units)}</span>
          <span>{formatDistance(segment.distance * 2.0, units)}</span>
        </div>
      </div>
    {/if}
  </div>
</div>
