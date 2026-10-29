<script>
  import { formatDistance, formatElevation } from '$lib/utils/units.js';

  let {
    segments = [],
    selectedDay = null,
    width = null,
    height = 200,
    units = 'miles',
  } = $props();

  let containerEl = $state(null);
  let containerWidth = $state(600);
  let hoverInfo = $state(null);

  const padding = { top: 20, right: 20, bottom: 30, left: 50 };

  $effect(() => {
    if (containerEl) {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          containerWidth = entry.contentRect.width;
        }
      });
      observer.observe(containerEl);
      return () => observer.disconnect();
    }
  });

  const chartWidth = $derived(width || containerWidth);

  const allPoints = $derived.by(() => {
    const pts = [];
    let cumDist = 0;
    for (const seg of segments) {
      if (!seg.geometry) continue;
      const coords = seg.geometry.coordinates || seg.geometry;
      for (let i = 0; i < coords.length; i++) {
        const coord = coords[i];
        const elev = coord[2] || 0;
        if (i > 0) {
          const prev = coords[i - 1];
          const dx = (coord[0] - prev[0]) * 111320 * Math.cos((coord[1] * Math.PI) / 180);
          const dy = (coord[1] - prev[1]) * 110540;
          cumDist += Math.sqrt(dx * dx + dy * dy);
        }
        pts.push({ dist: cumDist, elev, day: seg.day });
      }
    }
    return pts;
  });

  const dayBoundaries = $derived.by(() => {
    const bounds = [];
    let cumDist = 0;
    for (const seg of segments) {
      const start = cumDist;
      if (seg.geometry) {
        const coords = seg.geometry.coordinates || seg.geometry;
        for (let i = 1; i < coords.length; i++) {
          const prev = coords[i - 1];
          const coord = coords[i];
          const dx = (coord[0] - prev[0]) * 111320 * Math.cos((coord[1] * Math.PI) / 180);
          const dy = (coord[1] - prev[1]) * 110540;
          cumDist += Math.sqrt(dx * dx + dy * dy);
        }
      }
      bounds.push({ day: seg.day, start, end: cumDist });
    }
    return bounds;
  });

  const maxDist = $derived(allPoints.length > 0 ? allPoints[allPoints.length - 1].dist : 0);
  const minElev = $derived(allPoints.length > 0 ? Math.min(...allPoints.map((p) => p.elev)) : 0);
  const maxElev = $derived(allPoints.length > 0 ? Math.max(...allPoints.map((p) => p.elev)) : 100);

  const innerW = $derived(chartWidth - padding.left - padding.right);
  const innerH = $derived(height - padding.top - padding.bottom);

  function scaleX(dist) {
    if (maxDist === 0) return padding.left;
    return padding.left + (dist / maxDist) * innerW;
  }

  function scaleY(elev) {
    const range = maxElev - minElev || 1;
    return padding.top + innerH - ((elev - minElev) / range) * innerH;
  }

  const dayColors = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
  ];

  function getAreaPath(pts) {
    if (pts.length < 2) return '';
    let d = `M ${scaleX(pts[0].dist)} ${scaleY(pts[0].elev)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${scaleX(pts[i].dist)} ${scaleY(pts[i].elev)}`;
    }
    d += ` L ${scaleX(pts[pts.length - 1].dist)} ${padding.top + innerH}`;
    d += ` L ${scaleX(pts[0].dist)} ${padding.top + innerH} Z`;
    return d;
  }

  function getLinePath(pts) {
    if (pts.length < 2) return '';
    let d = `M ${scaleX(pts[0].dist)} ${scaleY(pts[0].elev)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${scaleX(pts[i].dist)} ${scaleY(pts[i].elev)}`;
    }
    return d;
  }

  const segmentPaths = $derived.by(() => {
    const paths = [];
    for (const bound of dayBoundaries) {
      const pts = allPoints.filter((p) => p.dist >= bound.start && p.dist <= bound.end);
      if (pts.length > 1) {
        const color = dayColors[(bound.day - 1) % dayColors.length];
        const isSelected = selectedDay === bound.day;
        paths.push({
          day: bound.day,
          area: getAreaPath(pts),
          line: getLinePath(pts),
          color,
          isSelected,
        });
      }
    }
    return paths;
  });

  function handleMouseMove(e) {
    if (allPoints.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const dist = ((x - padding.left) / innerW) * maxDist;
    if (dist < 0 || dist > maxDist) {
      hoverInfo = null;
      return;
    }
    let closest = allPoints[0];
    let minD = Math.abs(allPoints[0].dist - dist);
    for (const pt of allPoints) {
      const d = Math.abs(pt.dist - dist);
      if (d < minD) {
        minD = d;
        closest = pt;
      }
    }
    hoverInfo = { x: scaleX(closest.dist), y: scaleY(closest.elev), dist: closest.dist, elev: closest.elev, day: closest.day };
  }

  function handleMouseLeave() {
    hoverInfo = null;
  }
</script>

<div bind:this={containerEl} class="w-full">
  {#if allPoints.length > 0}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svg
      width={chartWidth}
      {height}
      class="w-full"
      role="img"
      aria-label="Elevation profile chart"
      onmousemove={handleMouseMove}
      onmouseleave={handleMouseLeave}
    >
      <!-- Y axis labels -->
      <text x={padding.left - 5} y={padding.top + 4} text-anchor="end" class="fill-gray-400 text-[10px]">
        {formatElevation(maxElev, units)}
      </text>
      <text x={padding.left - 5} y={padding.top + innerH + 4} text-anchor="end" class="fill-gray-400 text-[10px]">
        {formatElevation(minElev, units)}
      </text>

      <!-- X axis labels -->
      <text x={padding.left} y={height - 5} text-anchor="start" class="fill-gray-400 text-[10px]">
        0
      </text>
      <text x={padding.left + innerW} y={height - 5} text-anchor="end" class="fill-gray-400 text-[10px]">
        {formatDistance(maxDist, units)}
      </text>

      <!-- Grid lines -->
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + innerH} stroke="#e5e7eb" stroke-width="1" />
      <line x1={padding.left} y1={padding.top + innerH} x2={padding.left + innerW} y2={padding.top + innerH} stroke="#e5e7eb" stroke-width="1" />

      <!-- Area fills and lines per segment -->
      {#each segmentPaths as sp}
        <path d={sp.area} fill={sp.color} opacity={sp.isSelected ? 0.35 : 0.15} />
        <path d={sp.line} fill="none" stroke={sp.color} stroke-width={sp.isSelected ? 2.5 : 1.5} opacity={sp.isSelected ? 1 : 0.7} />
      {/each}

      <!-- Hover crosshair -->
      {#if hoverInfo}
        <line x1={hoverInfo.x} y1={padding.top} x2={hoverInfo.x} y2={padding.top + innerH} stroke="#6b7280" stroke-width="1" stroke-dasharray="3 3" />
        <circle cx={hoverInfo.x} cy={hoverInfo.y} r="4" fill="#1d4ed8" stroke="white" stroke-width="2" />
        <rect x={hoverInfo.x + 8} y={hoverInfo.y - 28} width="120" height="32" rx="4" fill="rgba(0,0,0,0.8)" />
        <text x={hoverInfo.x + 14} y={hoverInfo.y - 16} class="fill-white text-[10px]">
          {formatElevation(hoverInfo.elev, units)}
        </text>
        <text x={hoverInfo.x + 14} y={hoverInfo.y - 4} class="fill-gray-300 text-[10px]">
          {formatDistance(hoverInfo.dist, units)} | Day {hoverInfo.day}
        </text>
      {/if}
    </svg>
  {:else}
    <div class="flex items-center justify-center h-32 text-gray-400 text-sm">
      No elevation data available
    </div>
  {/if}
</div>
