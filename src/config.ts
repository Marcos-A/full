/** The one place that holds the product name. Changing it changes the UI and page title. */
export const APP_NAME = 'full';
export const MAX_RECOVERY_ENTRIES = 10;
export const WORKER_PARSE_THRESHOLD = 5 * 1024 * 1024;
export const LARGE_FILE_WARNING = 50 * 1024 * 1024;
export const PERSIST_DEBOUNCE_MS = 500;
/** The Mac app's limit on how long steady typing can go without reaching the recovery store. */
export const PERSIST_MAX_WAIT_MS = 3000;
export const RENDER_DEBOUNCE_MS = 150;
/** How often open files are checked for having been deleted, while the window is visible. */
export const FILE_CHECK_MS = 2000;
/** A file found missing is looked for once more after this long, before it's reported. */
export const FILE_RECHECK_MS = 300;
