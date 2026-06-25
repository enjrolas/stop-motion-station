import previewPanel from "./preview-panel.js";
import controlsPanel from "./controls-panel.js";
import timelinePanel from "./timeline-panel.js";
import projectBrowserView from "./project-browser.js";
import syncIndicator from "./sync-indicator.js";
import frameRestoreIndicator from "./frame-restore-indicator.js";

export default function mainView(state, emit) {
  if (state.appMode === "project-browser") {
    return projectBrowserView(state, emit);
  }

  const applicationSurfaceLayout = state.appSurfaceLayout;

  return html`
    <div id="app" class="application-root">
      ${syncIndicator(state)}
      ${frameRestoreIndicator(state)}
      <section
        class="application-surface"
        style=${`
          width: ${applicationSurfaceLayout.width}px;
          height: ${applicationSurfaceLayout.height}px;
        `}
      >
        <div class="application-top-row">
          ${previewPanel(state, emit)}
          ${controlsPanel(state)}
        </div>

        ${timelinePanel(state, emit)}
      </section>
    </div>
  `;
}
