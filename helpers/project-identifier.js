// Project ids are minted as `project-<creationMilliseconds>-<hex>`. When
// recovering an orphaned project (a content file missing from the metadata
// list), we read the creation time back out of the id so the recovered entry
// keeps a sensible timestamp instead of "now".
export function parseProjectCreationTimestamp(projectId, fallbackMilliseconds = 0) {
  if (typeof projectId !== "string") {
    return fallbackMilliseconds;
  }

  const match = projectId.match(/^project-(\d+)-/);

  if (!match) {
    return fallbackMilliseconds;
  }

  const parsedMilliseconds = Number(match[1]);
  return Number.isFinite(parsedMilliseconds) && parsedMilliseconds > 0
    ? parsedMilliseconds
    : fallbackMilliseconds;
}
