export function createProjectBrowserTileList({ projects }) {
  return [
    {
      type: "new-project",
      title: "New Project",
    },
    ...projects.map((projectMetadata) => ({
      type: "project",
      projectId: projectMetadata.id,
      title: projectMetadata.title,
      thumbnailImageSource: projectMetadata.thumbnailImageSource,
      updatedAtMilliseconds: projectMetadata.updatedAtMilliseconds,
    })),
  ];
}

export function moveProjectBrowserSelectionByDirection({
  selectedIndex,
  tileCount,
  columnCount,
  direction,
}) {
  if (tileCount <= 0) {
    return 0;
  }

  const safeColumnCount = Math.max(1, columnCount);
  let nextSelectionIndex = selectedIndex;

  if (direction === "left") {
    nextSelectionIndex -= 1;
  } else if (direction === "right") {
    nextSelectionIndex += 1;
  } else if (direction === "up") {
    nextSelectionIndex -= safeColumnCount;
  } else if (direction === "down") {
    nextSelectionIndex += safeColumnCount;
  }

  return clampSelectionIndex({
    selectedIndex: nextSelectionIndex,
    tileCount,
  });
}

export function clampSelectionIndex({ selectedIndex, tileCount }) {
  if (tileCount <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(tileCount - 1, selectedIndex));
}

export function findBrowserSelectionIndexForProjectId({ projects, projectId }) {
  if (!projectId) {
    return 0;
  }

  const projectIndex = projects.findIndex((projectMetadata) => projectMetadata.id === projectId);

  if (projectIndex < 0) {
    return 0;
  }

  return projectIndex + 1;
}

// Default project title: the local creation timestamp, e.g. "2026-06-25 17:42".
// Used so every project gets a unique, meaningful name without depending on a
// running count (which broke when projects failed to persist — every new one
// became "Project 1").
export function createTimestampProjectTitle(creationDate = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const year = creationDate.getFullYear();
  const month = pad(creationDate.getMonth() + 1);
  const day = pad(creationDate.getDate());
  const hours = pad(creationDate.getHours());
  const minutes = pad(creationDate.getMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
