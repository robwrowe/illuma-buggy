const SHEETS_ENDPOINT_STORAGE = 'wandlab-sheets-endpoint';

export function getSheetsEndpoint() {
  return localStorage.getItem(SHEETS_ENDPOINT_STORAGE) || '';
}

export function setSheetsEndpoint(url) {
  localStorage.setItem(SHEETS_ENDPOINT_STORAGE, url);
}

export { SHEETS_ENDPOINT_STORAGE };
