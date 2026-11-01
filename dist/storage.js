/** The normal FieldShift workspace is stored on this device with no account gate. */
export const workspaceStorage = window.__fieldshiftStorage || window.localStorage;
window.__fieldshiftStorage = workspaceStorage;
