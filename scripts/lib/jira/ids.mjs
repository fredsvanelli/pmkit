const KEY = /^[A-Za-z][A-Za-z0-9_]+-[1-9][0-9]*$/;

// True when the value looks like a Jira work item key such as ENG-12.
export function isIssueKey(value) {
  return typeof value === 'string' && KEY.test(value);
}

// Upper-cases a key, the form Jira stores.
export function normalizeKey(value) {
  return String(value).toUpperCase();
}

export const API = '/rest/api/3';
export const PAGE_SIZE = 100;

// The path of a work item's resource: `rest` starts with a slash, or is empty for the item itself.
export const issuePath = (key, rest = '') => `${API}/issue/${encodeURIComponent(key)}${rest}`;

// A value as lower-case text, for names Jira compares without case.
export const lower = (value) => String(value ?? '').toLowerCase();
