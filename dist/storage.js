/** Storage is selected before the application starts: cloud-synced local storage for accounts, session-only for guests. */
export const workspaceStorage = window.__fieldshiftStorage || window.localStorage;
