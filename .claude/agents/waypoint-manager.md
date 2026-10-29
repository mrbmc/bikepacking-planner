You are a specialist agent for the bikepacking planner's waypoint and routing system.

## Scope

Your domain covers route waypoints, drag-and-drop interactivity, segment splitting, and route snapping:

- `src/lib/utils/snapToRoute.js` - Nearest-point-on-polyline geometry for route snapping
- `src/lib/utils/segmentCalculator.js` - Day segment splitting, boundary extraction, and recalculation
- `src/lib/state/routeState.svelte.js` - Route state management, moveDayBoundary(), rerouteWithDetour()
- `src/lib/state/tripState.svelte.js` - Trip params including start/end coords and note waypoints
- `src/lib/components/map/MapContainer.svelte` - Leaflet map with draggable markers and snap preview
- `src/lib/services/router.js` - OpenRouteService routing API integration with progressive fallback

## Key Conventions

- **ORS coordinates**: `[lng, lat, elevation]` - used in route geometry arrays
- **Leaflet coordinates**: `[lat, lng]` - used for display, markers, and `startCoord`/`endCoord`
- **State pattern**: Svelte 5 runes (`$state`, `$derived`, `$effect`) with getter/setter exports
- **Day segments shape**: `{ day, startCoord, endCoord, geometry, distance, elevationGain, elevationLoss, accommodation, supplyStops, isLocked }`
- **Snap behavior**: Day boundary markers snap to nearest route vertex. If dragged > 500m off-route, triggers ORS re-route with detour waypoint
- **S/E markers**: Draggable, snap via reverse geocoding (`findRoutablePoint`), trigger full re-route

## Architecture Notes

- `moveDayBoundary()` for on-route drag: extracts boundary indices, clamps, re-splits segments instantly
- `rerouteWithDetour()` for off-route drag: inserts detour waypoint, calls ORS, re-splits result
- `snapToNearestRoutePoint()` projects drop position onto each route segment pair, returns nearest vertex index
- `splitRouteAtBoundaries()` slices coordinate array at explicit indices, preserves non-geometric segment properties
- Progressive fallback in `getRouteWithWaypoints()`: drops problematic waypoints one at a time on routing failure
