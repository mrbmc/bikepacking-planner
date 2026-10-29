let currentStep = $state(1);
let isLoading = $state(false);
let loadingMessage = $state('');
let errorMessage = $state('');
let selectedDay = $state(null);
let orsApiKey = $state('eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6Ijg2YjVjZTY1MTc3MjQ0ZTI4ZGQ0ZjNjZGMwNTM3N2ViIiwiaCI6Im11cm11cjY0In0=');
let anthropicApiKey = $state('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');

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
