<script>
  import { getCurrentStep, setCurrentStep } from '$lib/state/uiState.svelte.js';
  import { getCanGenerateRoute } from '$lib/state/tripState.svelte.js';
  import { getDaySegments } from '$lib/state/routeState.svelte.js';
  import Step1TripInput from './Step1TripInput.svelte';
  import Step2RouteSegments from './Step2RouteSegments.svelte';
  import Step3Accommodation from './Step3Accommodation.svelte';
  import Step4Itinerary from './Step4Itinerary.svelte';

  const step = $derived(getCurrentStep());
  const segments = $derived(getDaySegments());
  const canRoute = $derived(getCanGenerateRoute());

  const steps = [
    { num: 1, label: 'Trip Details', icon: '1' },
    { num: 2, label: 'Route', icon: '2' },
    { num: 3, label: 'Lodging', icon: '3' },
    { num: 4, label: 'Itinerary', icon: '4' },
  ];

  // Determine if the "Next" button should be enabled
  const canNext = $derived.by(() => {
    if (step === 1) return canRoute;
    if (step === 2) return segments.length > 0;
    if (step === 3) return true; // accommodation is optional
    return false; // no next on step 4
  });

  function goNext() {
    if (step < 4 && canNext) setCurrentStep(step + 1);
  }

  function goBack() {
    if (step > 1) setCurrentStep(step - 1);
  }
</script>

<div class="flex flex-col h-full">
  <!-- Header -->
  <div class="px-6 pt-6 pb-4 border-b border-gray-100">
    <h1 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
      <svg class="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
      </svg>
      Bikepacking Planner
    </h1>

    <!-- Step Indicator -->
    <div class="flex items-center justify-between">
      {#each steps as s, i}
        <div class="flex items-center {i < steps.length - 1 ? 'flex-1' : ''}">
          <!-- Step Circle -->
          <button
            onclick={() => { if (s.num < step) setCurrentStep(s.num); }}
            disabled={s.num > step}
            class="flex flex-col items-center gap-1 group"
          >
            <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all
              {s.num < step
                ? 'bg-green-100 text-green-700 cursor-pointer group-hover:bg-green-200'
                : s.num === step
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-400'
              }"
            >
              {#if s.num < step}
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
              {:else}
                {s.icon}
              {/if}
            </div>
            <span class="text-[10px] font-medium whitespace-nowrap
              {s.num === step ? 'text-blue-600' : s.num < step ? 'text-green-600' : 'text-gray-400'}"
            >
              {s.label}
            </span>
          </button>

          <!-- Connector Line -->
          {#if i < steps.length - 1}
            <div class="flex-1 mx-2 mt-[-12px]">
              <div class="h-0.5 rounded-full {s.num < step ? 'bg-green-300' : 'bg-gray-200'}"></div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <!-- Step Content -->
  <div class="flex-1 overflow-y-auto px-6 py-6">
    {#if step === 1}
      <Step1TripInput />
    {:else if step === 2}
      <Step2RouteSegments />
    {:else if step === 3}
      <Step3Accommodation />
    {:else if step === 4}
      <Step4Itinerary />
    {/if}
  </div>

  <!-- Navigation Buttons -->
  {#if step < 4}
    <div class="px-6 py-4 border-t border-gray-100 flex justify-between">
      {#if step > 1}
        <button
          onclick={goBack}
          class="flex items-center gap-1 text-gray-500 font-medium py-2.5 px-4 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      {:else}
        <div></div>
      {/if}

      <button
        onclick={goNext}
        disabled={!canNext}
        class="flex items-center gap-1 bg-blue-600 text-white font-medium py-2.5 px-6 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shadow-sm"
      >
        Next
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  {/if}
</div>
