<script>
  import { onMount } from 'svelte';
  import { getFullRoute, getDaySegments, moveDayBoundary, rerouteWithDetour } from '$lib/state/routeState.svelte.js';
  import { getSelectedDay, setSelectedDay } from '$lib/state/uiState.svelte.js';
  import { getTripParams, removeNoteWaypoint, setStartCoords, setEndCoords } from '$lib/state/tripState.svelte.js';
  import {
    getAllDiscoveredPOIs,
    getScoredPOIs,
    getSelectedWaypoints,
    getDiscoveryComplete,
    getActiveCategories,
    toggleWaypoint,
  } from '$lib/state/discoveryState.svelte.js';
  import { getCategoryColors, getCategories } from '$lib/services/corridorDiscovery.js';
  import { snapToNearestRoutePoint } from '$lib/utils/snapToRoute.js';
  import { findRoutablePoint } from '$lib/services/geocoder.js';

  let mapEl;
  let map = null;
  let L = null;

  // Layer groups
  let routeLayer = null;
  let segmentHighlightLayer = null;
  let dayMarkersLayer = null;
  let supplyMarkersLayer = null;
  let startEndMarkersLayer = null;
  let scenicPOILayer = null;
  let selectedWaypointLayer = null;
  let noteWaypointLayer = null;
  let snapPreviewLayer = null;

  // Off-route distance threshold (meters) — beyond this, triggers ORS re-route
  const OFF_ROUTE_THRESHOLD = 500;

  const DAY_COLORS = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
    '#e11d48', '#84cc16', '#0ea5e9', '#d946ef', '#78716c',
  ];

  onMount(async () => {
    L = (await import('leaflet')).default;

    map = L.map(mapEl, {
      center: [44.0, -122.0],
      zoom: 6,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    // Initialize layer groups
    routeLayer = L.layerGroup().addTo(map);
    segmentHighlightLayer = L.layerGroup().addTo(map);
    dayMarkersLayer = L.layerGroup().addTo(map);
    supplyMarkersLayer = L.layerGroup().addTo(map);
    startEndMarkersLayer = L.layerGroup().addTo(map);
    scenicPOILayer = L.layerGroup().addTo(map);
    selectedWaypointLayer = L.layerGroup().addTo(map);
    noteWaypointLayer = L.layerGroup().addTo(map);
    snapPreviewLayer = L.layerGroup().addTo(map);

    // Force map to recalculate size
    setTimeout(() => map.invalidateSize(), 100);

    // Watch for container resizes
    const observer = new ResizeObserver(() => {
      if (map) map.invalidateSize();
    });
    observer.observe(mapEl);

    return () => {
      observer.disconnect();
      if (map) map.remove();
    };
  });

  // React to start/end coordinate changes (before route) — draggable S/E markers
  $effect(() => {
    const params = getTripParams();
    if (!map || !L || !startEndMarkersLayer) return;

    startEndMarkersLayer.clearLayers();

    if (params.startCoords) {
      const sMarker = L.marker(params.startCoords, {
        draggable: true,
        icon: L.divIcon({
          className: '',
          html: `<div style="background:#22c55e;color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:grab;">S</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      }).addTo(startEndMarkersLayer);

      sMarker.on('dragend', async (e) => {
        const latlng = e.target.getLatLng();
        // Snap to nearest routable point
        try {
          const snapped = await findRoutablePoint(latlng.lat, latlng.lng);
          const coords = snapped ? [snapped.lat, snapped.lng] : [latlng.lat, latlng.lng];
          setStartCoords(coords);
        } catch {
          setStartCoords([latlng.lat, latlng.lng]);
        }
      });
    }

    if (params.endCoords) {
      const eMarker = L.marker(params.endCoords, {
        draggable: true,
        icon: L.divIcon({
          className: '',
          html: `<div style="background:#ef4444;color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:grab;">E</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      }).addTo(startEndMarkersLayer);

      eMarker.on('dragend', async (e) => {
        const latlng = e.target.getLatLng();
        try {
          const snapped = await findRoutablePoint(latlng.lat, latlng.lng);
          const coords = snapped ? [snapped.lat, snapped.lng] : [latlng.lat, latlng.lng];
          setEndCoords(coords);
        } catch {
          setEndCoords([latlng.lat, latlng.lng]);
        }
      });
    }

    if (params.startCoords && params.endCoords) {
      const bounds = L.latLngBounds([params.startCoords, params.endCoords]);
      map.fitBounds(bounds, { padding: [50, 50] });
    } else if (params.startCoords) {
      map.setView(params.startCoords, 10);
    } else if (params.endCoords) {
      map.setView(params.endCoords, 10);
    }
  });

  // React to note waypoints from route notes (shown in Step 1 before routing)
  $effect(() => {
    const params = getTripParams();
    const waypoints = params.noteWaypoints || [];
    if (!map || !L || !noteWaypointLayer) return;

    noteWaypointLayer.clearLayers();

    if (waypoints.length === 0) return;

    waypoints.forEach((wp, i) => {
      const marker = L.marker([wp.lat, wp.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:#8b5cf6;color:white;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);cursor:pointer;">${i + 1}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
        zIndexOffset: 1000,
      });

      // Interactive popup with Remove button
      const popupDiv = document.createElement('div');
      popupDiv.style.cssText = 'min-width:140px;';
      popupDiv.innerHTML =
        `<b style="font-size:13px;">${wp.name}</b><br>` +
        `<span style="font-size:11px;color:#6b7280;">${wp.lat.toFixed(3)}, ${wp.lng.toFixed(3)}</span>` +
        `<hr style="margin:6px 0;border-color:#e5e7eb;">`;

      const btn = document.createElement('button');
      btn.textContent = 'Remove Waypoint';
      btn.style.cssText = 'width:100%;padding:5px 0;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background-color:#fee2e2;color:#dc2626;transition:background-color 0.2s;';
      btn.addEventListener('click', () => {
        removeNoteWaypoint(i);
        marker.closePopup();
      });

      popupDiv.appendChild(btn);
      marker.bindPopup(popupDiv);
      marker.addTo(noteWaypointLayer);
    });

    // Fit bounds to include start, end, and note waypoints
    const allPoints = waypoints.map(wp => [wp.lat, wp.lng]);
    if (params.startCoords) allPoints.push(params.startCoords);
    if (params.endCoords) allPoints.push(params.endCoords);
    if (allPoints.length > 1) {
      map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50] });
    }
  });

  // React to full route changes
  $effect(() => {
    const route = getFullRoute();
    if (!map || !L || !routeLayer) return;

    routeLayer.clearLayers();
    startEndMarkersLayer.clearLayers();

    if (!route?.features?.[0]) return;

    const feature = route.features[0];
    const coords = feature.geometry?.coordinates || [];

    // Draw full route as semi-transparent polyline
    const latLngs = coords.map(c => [c[1], c[0]]);
    L.polyline(latLngs, {
      color: '#94a3b8',
      weight: 4,
      opacity: 0.5,
    }).addTo(routeLayer);

    // Fit bounds
    if (latLngs.length > 0) {
      const bounds = L.latLngBounds(latLngs);
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  });

  // React to day segments changes — draw colored segments and draggable markers
  $effect(() => {
    const segments = getDaySegments();
    if (!map || !L || !dayMarkersLayer) return;

    dayMarkersLayer.clearLayers();
    routeLayer.clearLayers();
    if (snapPreviewLayer) snapPreviewLayer.clearLayers();

    if (segments.length === 0) return;

    // Get route coords for snap calculations
    const route = getFullRoute();
    const routeCoords = route?.features?.[0]?.geometry?.coordinates;

    // Draw each day's segment as a colored polyline
    segments.forEach((seg, i) => {
      if (!seg.geometry || seg.geometry.length === 0) return;

      const latLngs = seg.geometry.map(c => [c[1], c[0]]);
      const color = DAY_COLORS[i % DAY_COLORS.length];

      L.polyline(latLngs, {
        color,
        weight: 4,
        opacity: 0.7,
      }).addTo(routeLayer);

      // Day start marker — draggable for days > 1
      const startLatLng = seg.startCoord || [seg.geometry[0][1], seg.geometry[0][0]];
      const isDraggable = seg.day > 1;
      let wasDragged = false;

      const marker = L.marker(startLatLng, {
        draggable: isDraggable,
        icon: L.divIcon({
          className: '',
          html: `<div style="background:${color};color:white;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:${isDraggable ? 'grab' : 'pointer'};">${seg.day}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
      }).addTo(dayMarkersLayer);

      if (isDraggable && routeCoords) {
        marker.on('dragstart', () => {
          wasDragged = true;
          const el = marker.getElement();
          if (el) el.style.opacity = '0.7';
        });

        marker.on('drag', (e) => {
          if (!snapPreviewLayer || !routeCoords) return;
          snapPreviewLayer.clearLayers();

          const latlng = e.target.getLatLng();
          const snapped = snapToNearestRoutePoint(latlng.lat, latlng.lng, routeCoords);

          // Show snap indicator on route
          const previewColor = snapped.distance > OFF_ROUTE_THRESHOLD ? '#ef4444' : color;
          L.circleMarker([snapped.coord[1], snapped.coord[0]], {
            radius: 8,
            fillColor: previewColor,
            fillOpacity: 0.5,
            stroke: true,
            color: 'white',
            weight: 2,
          }).addTo(snapPreviewLayer);

          // Show dashed line from drag position to snap point
          L.polyline(
            [[latlng.lat, latlng.lng], [snapped.coord[1], snapped.coord[0]]],
            { color: previewColor, weight: 2, dashArray: '4 6', opacity: 0.6 }
          ).addTo(snapPreviewLayer);
        });

        marker.on('dragend', async (e) => {
          if (snapPreviewLayer) snapPreviewLayer.clearLayers();
          const el = marker.getElement();
          if (el) el.style.opacity = '1';

          const latlng = e.target.getLatLng();
          if (!routeCoords) return;

          const snapped = snapToNearestRoutePoint(latlng.lat, latlng.lng, routeCoords);

          if (snapped.distance > OFF_ROUTE_THRESHOLD) {
            // Off-route: trigger ORS re-route with detour waypoint
            await rerouteWithDetour(latlng.lat, latlng.lng, seg.day);
          } else {
            // On-route: instant re-split at snapped index
            moveDayBoundary(seg.day, snapped.index);
          }
        });
      }

      marker.on('click', () => {
        if (wasDragged) { wasDragged = false; return; }
        setSelectedDay(getSelectedDay() === seg.day ? null : seg.day);
      });

      const accomIcon = seg.accommodation === 'camp' ? '\u{1F3D5}' : seg.accommodation === 'motel' ? '\u{1F3E8}' : '';
      marker.bindPopup(
        `<b>Day ${seg.day}</b><br>` +
        `${seg.endName || 'Segment endpoint'}<br>` +
        `${(seg.distance / 1609.34).toFixed(1)} mi` +
        (accomIcon ? ` ${accomIcon}` : '') +
        (isDraggable ? `<br><span style="font-size:10px;color:#9ca3af;">Drag to adjust day boundary</span>` : ''),
        { className: 'text-sm' }
      );
    });

    // Final endpoint marker
    const lastSeg = segments[segments.length - 1];
    if (lastSeg?.endCoord) {
      L.marker(lastSeg.endCoord, {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:#ef4444;color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);">E</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      }).addTo(dayMarkersLayer);
    }
  });

  // React to selected day changes — highlight segment
  $effect(() => {
    const selected = getSelectedDay();
    const segments = getDaySegments();
    if (!map || !L || !segmentHighlightLayer) return;

    segmentHighlightLayer.clearLayers();

    if (selected === null || segments.length === 0) return;

    const seg = segments.find(s => s.day === selected);
    if (!seg?.geometry || seg.geometry.length === 0) return;

    const latLngs = seg.geometry.map(c => [c[1], c[0]]);
    const color = DAY_COLORS[(selected - 1) % DAY_COLORS.length];

    // Bold highlight polyline
    L.polyline(latLngs, {
      color,
      weight: 7,
      opacity: 1,
    }).addTo(segmentHighlightLayer);

    // White outline for visibility
    L.polyline(latLngs, {
      color: 'white',
      weight: 10,
      opacity: 0.4,
    }).addTo(segmentHighlightLayer);

    // Pan to fit the selected segment
    const bounds = L.latLngBounds(latLngs);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
  });

  // React to supply stops
  $effect(() => {
    const segments = getDaySegments();
    if (!map || !L || !supplyMarkersLayer) return;

    supplyMarkersLayer.clearLayers();

    segments.forEach(seg => {
      if (!seg.supplyStops?.length) return;

      seg.supplyStops.forEach(stop => {
        const iconMap = {
          fuel: '\u26FD',
          convenience: '\u{1F6D2}',
          supermarket: '\u{1F6D2}',
          drinking_water: '\u{1F4A7}',
          camp_site: '\u{1F3D5}',
          motel: '\u{1F3E8}',
          hotel: '\u{1F3E8}',
        };
        const emoji = iconMap[stop.type] || '\u{1F4CD}';

        L.marker([stop.lat, stop.lng], {
          icon: L.divIcon({
            className: '',
            html: `<div style="font-size:16px;text-shadow:0 1px 2px rgba(0,0,0,0.3);cursor:pointer;">${emoji}</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          }),
        })
          .bindPopup(`<b>${stop.name || stop.type}</b><br><span class="text-xs text-gray-500">${stop.type}</span>`)
          .addTo(supplyMarkersLayer);
      });
    });
  });

  // React to discovered scenic POIs — show as circle markers with interactive popups
  $effect(() => {
    const scored = getScoredPOIs();
    const complete = getDiscoveryComplete();
    const activeFilters = getActiveCategories();
    const selectedWPs = getSelectedWaypoints();
    if (!map || !L || !scenicPOILayer) return;

    scenicPOILayer.clearLayers();
    if (!complete || scored.length === 0) return;

    const colorMap = getCategoryColors();
    const cats = getCategories();
    const selectedIds = new Set(selectedWPs.map(wp => wp.id));

    for (const poi of scored) {
      if (!activeFilters.has(poi.category)) continue;

      const color = colorMap[poi.category] || '#6b7280';
      const catDef = cats[poi.category];
      const isSelected = selectedIds.has(poi.id);

      const marker = L.circleMarker([poi.lat, poi.lng], {
        radius: isSelected ? 8 : 6,
        fillColor: color,
        fillOpacity: isSelected ? 0.9 : 0.6,
        stroke: true,
        color: isSelected ? '#f59e0b' : '#fff',
        weight: isSelected ? 2.5 : 1,
      });

      // Create popup with DOM node for interactive button
      const popupDiv = document.createElement('div');
      popupDiv.style.cssText = 'min-width:160px;';
      popupDiv.innerHTML =
        `<b style="font-size:13px;">${poi.name}</b><br>` +
        `<span style="color:${color};font-size:12px;">${catDef?.label || poi.category}</span><br>` +
        `<span style="font-size:11px;color:#6b7280;">Score: ${poi.score?.toFixed(1)} · ${(poi.distanceFromRoute / 1000).toFixed(1)} km detour</span>` +
        `<hr style="margin:6px 0;border-color:#e5e7eb;">`;

      const btn = document.createElement('button');
      btn.style.cssText = 'width:100%;padding:5px 0;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:background-color 0.2s;';

      function updateBtn(sel) {
        if (sel) {
          btn.textContent = 'Remove Waypoint';
          btn.style.backgroundColor = '#fee2e2';
          btn.style.color = '#dc2626';
        } else {
          btn.textContent = 'Add Waypoint';
          btn.style.backgroundColor = '#dcfce7';
          btn.style.color = '#16a34a';
        }
      }

      updateBtn(isSelected);

      btn.addEventListener('click', () => {
        toggleWaypoint(poi);
        // Toggle the visual state
        const nowSelected = !getSelectedWaypoints().every(wp => wp.id !== poi.id);
        updateBtn(nowSelected);
      });

      popupDiv.appendChild(btn);
      marker.bindPopup(popupDiv, { className: 'scenic-popup' });
      marker.addTo(scenicPOILayer);
    }
  });

  // React to selected waypoints — highlight with larger numbered markers
  $effect(() => {
    const selected = getSelectedWaypoints();
    if (!map || !L || !selectedWaypointLayer) return;

    selectedWaypointLayer.clearLayers();
    if (selected.length === 0) return;

    selected.forEach((wp, i) => {
      const marker = L.marker([wp.lat, wp.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:#f59e0b;color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:10px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;">W${i + 1}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        zIndexOffset: 500,
      });

      // Interactive popup with Remove button
      const popupDiv = document.createElement('div');
      popupDiv.style.cssText = 'min-width:140px;';
      popupDiv.innerHTML =
        `<b style="font-size:13px;">W${i + 1}: ${wp.name}</b><br>` +
        `<span style="font-size:11px;color:#6b7280;">${wp.category}</span>` +
        `<hr style="margin:6px 0;border-color:#e5e7eb;">`;

      const btn = document.createElement('button');
      btn.textContent = 'Remove Waypoint';
      btn.style.cssText = 'width:100%;padding:5px 0;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background-color:#fee2e2;color:#dc2626;transition:background-color 0.2s;';
      btn.addEventListener('click', () => {
        toggleWaypoint(wp);
        marker.closePopup();
      });

      popupDiv.appendChild(btn);
      marker.bindPopup(popupDiv);
      marker.addTo(selectedWaypointLayer);
    });
  });
</script>

<div bind:this={mapEl} class="w-full h-full">
  {#if !map}
    <div class="w-full h-full flex items-center justify-center bg-gray-100">
      <div class="text-center text-gray-400">
        <svg class="w-12 h-12 mx-auto mb-2 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        <p class="text-sm">Loading map...</p>
      </div>
    </div>
  {/if}
</div>
