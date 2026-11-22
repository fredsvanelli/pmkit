const KEY = /^[A-Za-z][A-Za-z0-9_]+-[1-9][0-9]*$/;

// True when the value looks like a Jira work item key such as ENG-12.
export function isIssueKey(value) {
  return typeof value === 'string' && KEY.test(value);
}

// Upper-cases a key, the form Jira stores.
export function normalizeKey(value) {
  return String(value).toUpperCase();
}
