// Backend sync configuration for this kiosk/table.
//
// Copy this file to `sync-config.js` (which is gitignored) and fill in the
// table API key issued for this device. The key is loaded by the browser, so
// only put a per-table key here, never a shared admin credential.
//
//   cp sync-config.example.js sync-config.js
//
// Set `apiKey` to null to disable backend sync entirely.
export default {
  apiKey: "your-table-api-key-here",
  apiBaseUrl: "https://smbs.artiswrong.com/api",
};
