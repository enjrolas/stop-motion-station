import { createProjectBrowserTileList } from "../helpers/project-browser-operations.js";
import { PROJECT_TITLE_KEYBOARD_KEYS } from "../helpers/project-title-keyboard.js";
import { describeSyncStatus } from "./controls-panel.js";

const PROJECT_TILE_MINIMUM_WIDTH_PIXELS = 200;

export function computeProjectBrowserColumnCount({ availableWidth }) {
  const horizontalPaddingPixels = 48;
  const usableWidth = Math.max(1, availableWidth - horizontalPaddingPixels);
  return Math.max(1, Math.floor(usableWidth / PROJECT_TILE_MINIMUM_WIDTH_PIXELS));
}

export default function projectBrowserView(state, emit) {
  const projectBrowserTileList = createProjectBrowserTileList({ projects: state.projects });
  const selectedProjectBrowserIndex = Math.min(
    state.selectedProjectBrowserIndex,
    Math.max(0, projectBrowserTileList.length - 1),
  );
  const modalProjectMetadata = state.projectBrowserModalProjectId
    ? state.projects.find((projectMetadata) => projectMetadata.id === state.projectBrowserModalProjectId) ?? null
    : null;
  const modalButtonViewModels = [
    {
      label: "Play",
      styleClassName: "play-button",
      onActivate: () => emit("project-browser:play-modal-project"),
    },
    {
      label: "Edit",
      styleClassName: "edit-button",
      onActivate: () => emit("project-browser:edit-modal-project"),
    },
    {
      label: "Edit Title",
      styleClassName: "edit-title-button",
      onActivate: () => emit("project-browser:edit-modal-project-title"),
    },
    {
      label: "Record Sound",
      styleClassName: "record-sound-button",
      onActivate: () => emit("project-browser:record-modal-project-sound"),
    },
    {
      label: "Export Video",
      styleClassName: "export-video-button",
      onActivate: () => emit("project-browser:export-modal-project-video"),
    },
    {
      label: "Delete",
      styleClassName: "delete-button",
      onActivate: () => emit("project-browser:delete-modal-project"),
    },
    {
      label: "Back to Browser",
      styleClassName: "back-button",
      onActivate: () => emit("project-browser:close-project-modal"),
    },
  ];
  const selectedModalButtonIndex = Math.min(
    Math.max(0, state.projectBrowserModalSelectedActionIndex ?? 0),
    modalButtonViewModels.length - 1,
  );
  const titleEditorIsActive = Boolean(state.projectBrowserTitleEditor?.isActive);
  const selectedTitleKeyboardKeyIndex = Math.min(
    Math.max(0, state.projectBrowserTitleEditor?.selectedKeyIndex ?? 0),
    PROJECT_TITLE_KEYBOARD_KEYS.length - 1,
  );
  const projectBrowserPlaybackFrameRecord = state.isPlaying && state.playbackFrameIndex !== null
    ? state.projectBrowserPlaybackFrames[state.playbackFrameIndex] ?? null
    : null;
  const projectBrowserPlaybackImageSource = projectBrowserPlaybackFrameRecord
    ? projectBrowserPlaybackFrameRecord.playbackImageSource
      ?? projectBrowserPlaybackFrameRecord.previewImageSource
      ?? projectBrowserPlaybackFrameRecord.timelineImageSource
    : null;

  return html`
    <div id="app" class="application-root project-browser-root">
      <section class="project-browser-surface">
        <header class="project-browser-header">
          <h1 class="project-browser-title">Stop Motion Station</h1>
          <p class="project-browser-subtitle">Choose a project or create a new one</p>
          ${state.syncStatus?.enabled
            ? html`
              <p class=${`project-browser-sync-status ${describeSyncStatus(state.syncStatus).stateClassName}`}>
                ${describeSyncStatus(state.syncStatus).label}
              </p>
            `
            : null}
        </header>

        <div
          class="project-browser-grid"
          style=${`
            --project-browser-column-count: ${state.projectBrowserColumnCount};
          `}
        >
          ${projectBrowserTileList.map((tileViewModel, tileIndex) => {
            const isSelectedTile = tileIndex === selectedProjectBrowserIndex;
            const selectProjectBrowserTile = () => emit("project-browser:select-tile", tileIndex);

            if (tileViewModel.type === "new-project") {
              return html`
                <article
                  class=${`project-browser-tile new-project-tile ${isSelectedTile ? "is-selected" : ""}`}
                  onclick=${() => {
                    selectProjectBrowserTile();
                    emit("project-browser:activate-selected-tile");
                  }}
                >
                  <div class="project-browser-thumbnail-placeholder project-browser-thumbnail-plus">+</div>
                  <h2 class="project-browser-tile-title">${tileViewModel.title}</h2>
                </article>
              `;
            }

            return html`
              <article
                class=${`project-browser-tile ${isSelectedTile ? "is-selected" : ""}`}
                onclick=${() => {
                  emit("project-browser:select-tile", tileIndex);
                  emit("project-browser:activate-selected-tile");
                }}
              >
                ${tileViewModel.thumbnailImageSource
                  ? html`
                    <img
                      class="project-browser-thumbnail-image"
                      src=${tileViewModel.thumbnailImageSource}
                      alt=${`Thumbnail for ${tileViewModel.title}`}
                    />
                  `
                  : html`
                    <div class="project-browser-thumbnail-placeholder">No frames yet</div>
                  `}
                <h2 class="project-browser-tile-title">${tileViewModel.title}</h2>
              </article>
            `;
          })}
        </div>
      </section>

      ${modalProjectMetadata
        ? html`
          <div
            class="project-browser-modal-backdrop"
            onclick=${(clickEvent) => {
              clickEvent.stopPropagation();
            }}
          >
            <section class="project-browser-modal-dialog">
              <h2 class="project-browser-modal-title">
                ${titleEditorIsActive ? "Edit Title" : modalProjectMetadata.title}
              </h2>

              ${titleEditorIsActive
                ? html`
                  <div class="project-browser-title-editor">
                    <div class="project-browser-title-editor-draft">
                      ${state.projectBrowserTitleEditor.draftTitle || "Untitled"}
                    </div>
                    <div class="project-browser-title-keyboard">
                      ${PROJECT_TITLE_KEYBOARD_KEYS.map((keyboardKey, keyboardKeyIndex) => html`
                        <button
                          type="button"
                          class=${`project-browser-title-key ${keyboardKeyIndex === selectedTitleKeyboardKeyIndex ? "is-selected" : ""}`}
                          onclick=${() => emit("project-browser:activate-title-key", keyboardKeyIndex)}
                        >
                          ${keyboardKey.label}
                        </button>
                      `)}
                    </div>
                  </div>
                `
                : html`
                  ${modalProjectMetadata.thumbnailImageSource
                    ? html`
                      <img
                        class="project-browser-modal-thumbnail-image"
                        src=${modalProjectMetadata.thumbnailImageSource}
                        alt=${`Thumbnail for ${modalProjectMetadata.title}`}
                      />
                    `
                    : html`
                      <div class="project-browser-modal-thumbnail-placeholder">No frames yet</div>
                    `}

                  <div class="project-browser-modal-button-row">
                    ${modalButtonViewModels.map((modalButtonViewModel, modalButtonIndex) => html`
                      <button
                        type="button"
                        class=${`project-browser-modal-button ${modalButtonViewModel.styleClassName} ${modalButtonIndex === selectedModalButtonIndex ? "is-selected" : ""}`}
                        onclick=${modalButtonViewModel.onActivate}
                      >
                        ${modalButtonViewModel.label}
                      </button>
                    `)}
                  </div>
                `}

              ${state.projectBrowserModalStatusMessage
                ? html`
                  <div class="project-browser-modal-status-message">
                    ${state.projectBrowserModalStatusMessage}
                  </div>
                `
                : null}
            </section>
          </div>
        `
        : null}

      ${projectBrowserPlaybackImageSource
        ? html`
          <section class="project-browser-playback-overlay">
            <img
              class="project-browser-playback-image"
              src=${projectBrowserPlaybackImageSource}
              draggable="false"
              alt=${`Playback frame ${state.playbackFrameIndex + 1}`}
            />
          </section>
        `
        : null}
    </div>
  `;
}
