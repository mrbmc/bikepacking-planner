let tripDescription = $state('');

let tripParams = $state({
  startName: '',
  endName: '',
  startCoords: null,
  endCoords: null,
  totalDays: 0,
  dailyDistancePref: 0,
  units: 'miles',
  routeNotes: '',
  noteWaypoints: [],
});

const canGenerateRoute = $derived(
  tripParams.startCoords !== null &&
  tripParams.endCoords !== null &&
  tripParams.totalDays > 0
);

export function getTripDescription() {
  return tripDescription;
}

export function setTripDescription(desc) {
  tripDescription = desc;
}

export function getTripParams() {
  return tripParams;
}

export function setTripParams(params) {
  tripParams = { ...tripParams, ...params };
}

export function getCanGenerateRoute() {
  return canGenerateRoute;
}

export function removeNoteWaypoint(index) {
  tripParams = {
    ...tripParams,
    noteWaypoints: tripParams.noteWaypoints.filter((_, i) => i !== index),
  };
}

export function setStartCoords(coords) {
  tripParams = { ...tripParams, startCoords: coords, startName: '' };
}

export function setEndCoords(coords) {
  tripParams = { ...tripParams, endCoords: coords, endName: '' };
}

export function resetTrip() {
  tripDescription = '';
  tripParams = {
    startName: '',
    endName: '',
    startCoords: null,
    endCoords: null,
    totalDays: 0,
    dailyDistancePref: 0,
    units: 'miles',
    routeNotes: '',
    noteWaypoints: [],
  };
}
