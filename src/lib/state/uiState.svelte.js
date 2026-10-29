let currentStep = $state(1);
let isLoading = $state(false);
let loadingMessage = $state('');
let errorMessage = $state('');
let selectedDay = $state(null);
let orsApiKey = $state('');
let anthropicApiKey = $state('');

export function getCurrentStep() {
  return currentStep;
}

export function setCurrentStep(step) {
  currentStep = step;
}

export function getIsLoading() {
  return isLoading;
}

export function setIsLoading(val) {
  isLoading = val;
}

export function getLoadingMessage() {
  return loadingMessage;
}

export function setLoadingMessage(msg) {
  loadingMessage = msg;
}

export function getErrorMessage() {
  return errorMessage;
}

export function setErrorMessage(msg) {
  errorMessage = msg;
}

export function getSelectedDay() {
  return selectedDay;
}

export function setSelectedDay(day) {
  selectedDay = day;
}

export function getOrsApiKey() {
  return orsApiKey;
}

export function setOrsApiKey(key) {
  orsApiKey = key;
}

export function getAnthropicApiKey() {
  return anthropicApiKey;
}

export function setAnthropicApiKey(key) {
  anthropicApiKey = key;
}

export function clearError() {
  errorMessage = '';
}

export function startLoading(msg = 'Loading...') {
  isLoading = true;
  loadingMessage = msg;
  errorMessage = '';
}

export function stopLoading() {
  isLoading = false;
  loadingMessage = '';
}
