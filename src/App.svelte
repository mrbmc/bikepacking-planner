<script>
  import WizardShell from '$lib/components/wizard/WizardShell.svelte';
  import MapContainer from '$lib/components/map/MapContainer.svelte';
</script>

<!-- Main Layout -->
<div class="flex flex-col md:flex-row h-screen w-screen overflow-hidden bg-gray-50">
  <!-- Wizard Panel (Left) -->
  <div class="w-full md:w-[420px] lg:w-[480px] flex-shrink-0 h-1/2 md:h-full overflow-y-auto border-r border-gray-200 bg-white">
    <WizardShell />
  </div>

  <!-- Map Panel (Right) — isolate stacking context so Leaflet z-indices don't bleed out -->
  <div class="flex-1 h-1/2 md:h-full relative isolate">
    <MapContainer />
  </div>
</div>
