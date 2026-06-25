// Optional backend sync overrides.
//
// This file is NOT required and holds NO API key. By default the app identifies
// the table with a UID cookie (default "kaleidoscope") and automatically fetches
// an API key from the backend's /register/ endpoint for that UID, holding it
// only in memory. To change the table's identity, set the `smbs-table-uid`
// cookie to a unique string instead of editing a file.
//
// Copy to `sync-config.js` (gitignored) only if you need to override something:
//   - apiBaseUrl: point at a different backend
//   - disabled:   set true to turn backend sync off entirely
export default {
  apiBaseUrl: "https://smbs.artiswrong.com/api",
  // disabled: true,
};
