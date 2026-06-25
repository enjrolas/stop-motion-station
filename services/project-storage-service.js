import { parseProjectCreationTimestamp } from "../helpers/project-identifier.js";

const PROJECTS_DIRECTORY_NAME = "projects";
const PROJECT_METADATA_FILE_NAME = "project-metadata-list.json";

class ProjectStorageService {
  constructor() {
    this.originPrivateFileSystemRootDirectoryHandle = null;
    this.projectsDirectoryHandle = null;
    this.hasInitializedStorage = false;
    // All read-modify-write mutations of project-metadata-list.json funnel
    // through this single main-thread queue so concurrent creates/saves/deletes
    // cannot clobber each other (lost-update race). The capture worker no longer
    // writes the metadata list at all — it persists only project content — so
    // this queue is the sole writer.
    this.metadataMutationQueue = Promise.resolve();
  }

  // Serializes a metadata-list read-modify-write so writers never interleave.
  enqueueMetadataListMutation(metadataMutation) {
    const queuedMutation = this.metadataMutationQueue
      .catch(() => {})
      .then(metadataMutation);

    this.metadataMutationQueue = queuedMutation.catch(() => {});
    return queuedMutation;
  }

  async initialize() {
    await this.getProjectsDirectoryHandle();
    await this.ensureProjectMetadataListFileExists();
    this.hasInitializedStorage = true;
  }

  // Re-adds any project whose content file (`<id>.json`) exists in OPFS but is
  // missing from the metadata list — e.g. a project dropped by the historical
  // metadata-list write race. Returns the number of projects recovered. The
  // creation time is read back from the project id so the entry sorts sensibly.
  async recoverOrphanedProjects() {
    await this.initializeIfNeeded();

    const projectsDirectoryHandle = await this.getProjectsDirectoryHandle();
    const contentProjectIds = [];

    for await (const entryName of projectsDirectoryHandle.keys()) {
      if (entryName === PROJECT_METADATA_FILE_NAME || !entryName.endsWith(".json")) {
        continue;
      }

      contentProjectIds.push(entryName.slice(0, -".json".length));
    }

    if (contentProjectIds.length === 0) {
      return 0;
    }

    return this.enqueueMetadataListMutation(async () => {
      const projectMetadataList = await this.readProjectMetadataList();
      const listedProjectIds = new Set(projectMetadataList.map((projectMetadata) => projectMetadata.id));
      let recoveredCount = 0;

      for (const projectId of contentProjectIds) {
        if (listedProjectIds.has(projectId)) {
          continue;
        }

        let projectContentRecord;
        try {
          projectContentRecord = await this.readProjectContentRecord({ projectId });
        } catch {
          continue;
        }

        const frames = Array.isArray(projectContentRecord.frames) ? projectContentRecord.frames : [];
        const projectThumbnailRecord = extractProjectThumbnailRecordFromFrames(frames);
        const creationTimestamp = parseProjectCreationTimestamp(projectId, Date.now());

        projectMetadataList.push({
          id: projectId,
          title: projectContentRecord.title ?? "Recovered Project",
          createdAtMilliseconds: creationTimestamp,
          updatedAtMilliseconds: creationTimestamp,
          thumbnailImageSource: null,
          thumbnailStorageKey: projectThumbnailRecord.thumbnailStorageKey,
        });
        recoveredCount += 1;
      }

      if (recoveredCount > 0) {
        await this.writeProjectMetadataList(projectMetadataList);
      }

      return recoveredCount;
    });
  }

  async getRootDirectoryHandle() {
    if (this.originPrivateFileSystemRootDirectoryHandle) {
      return this.originPrivateFileSystemRootDirectoryHandle;
    }

    if (!navigator.storage || !navigator.storage.getDirectory) {
      throw new Error("Origin Private File System API is unavailable in this browser.");
    }

    this.originPrivateFileSystemRootDirectoryHandle = await navigator.storage.getDirectory();
    return this.originPrivateFileSystemRootDirectoryHandle;
  }

  async getProjectsDirectoryHandle() {
    if (this.projectsDirectoryHandle) {
      return this.projectsDirectoryHandle;
    }

    const rootDirectoryHandle = await this.getRootDirectoryHandle();
    this.projectsDirectoryHandle = await rootDirectoryHandle.getDirectoryHandle(
      PROJECTS_DIRECTORY_NAME,
      { create: true },
    );

    return this.projectsDirectoryHandle;
  }

  async ensureProjectMetadataListFileExists() {
    const projectMetadataList = await this.readProjectMetadataList();

    if (!Array.isArray(projectMetadataList)) {
      await this.writeProjectMetadataList([]);
    }
  }

  async listProjects() {
    const projectMetadataList = await this.readProjectMetadataList();
    return [...projectMetadataList].sort(
      (firstProject, secondProject) => secondProject.updatedAtMilliseconds - firstProject.updatedAtMilliseconds,
    );
  }

  async createProject({ title }) {
    await this.initializeIfNeeded();

    const createdAtMilliseconds = Date.now();
    const projectIdentifier = createProjectIdentifier();

    const projectMetadataRecord = {
      id: projectIdentifier,
      title,
      createdAtMilliseconds,
      updatedAtMilliseconds: createdAtMilliseconds,
      thumbnailImageSource: null,
      thumbnailStorageKey: null,
    };

    const projectContentRecord = {
      id: projectIdentifier,
      title,
      frames: [],
    };

    await this.enqueueMetadataListMutation(async () => {
      const currentProjectMetadataList = await this.readProjectMetadataList();
      currentProjectMetadataList.push(projectMetadataRecord);
      await this.writeProjectMetadataList(currentProjectMetadataList);
    });
    await this.writeProjectContentRecord({
      projectId: projectIdentifier,
      projectContentRecord,
    });

    return {
      projectMetadata: projectMetadataRecord,
      projectContent: projectContentRecord,
    };
  }

  async loadProject({ projectId }) {
    await this.initializeIfNeeded();

    const projectMetadataList = await this.readProjectMetadataList();
    const selectedProjectMetadata = projectMetadataList.find((projectMetadata) => projectMetadata.id === projectId);

    if (!selectedProjectMetadata) {
      throw new Error(`Project not found for id: ${projectId}`);
    }

    const projectContentRecord = await this.readProjectContentRecord({ projectId });

    return {
      id: projectId,
      title: projectContentRecord.title ?? selectedProjectMetadata.title,
      frames: Array.isArray(projectContentRecord.frames) ? projectContentRecord.frames : [],
    };
  }

  // Persists the project content file AND updates its metadata entry. Used on
  // the main thread (no-worker fallback and renames). The capture worker instead
  // calls saveProjectContent + the main thread calls updateProjectMetadataFromFrames
  // so the metadata list has a single writer.
  async saveProject({ projectId, frames, title }) {
    await this.saveProjectContent({ projectId, frames, title });
    return this.updateProjectMetadataFromFrames({ projectId, frames, title });
  }

  // Writes only the per-project content file (frames). Does not touch the shared
  // metadata list, so it is safe to run off the main thread (the capture worker).
  async saveProjectContent({ projectId, frames, title }) {
    await this.initializeIfNeeded();

    await this.writeProjectContentRecord({
      projectId,
      projectContentRecord: {
        id: projectId,
        title,
        frames: frames.map(serializeFrameRecordForStorage),
      },
    });
  }

  // Updates only this project's metadata-list entry (title, updatedAt,
  // thumbnail), serialized through the single-writer queue. Returns the updated
  // metadata, or a minimal record if the project is no longer listed (e.g. it
  // was deleted concurrently) — in which case the list is left untouched.
  async updateProjectMetadataFromFrames({ projectId, frames, title }) {
    await this.initializeIfNeeded();

    return this.enqueueMetadataListMutation(async () => {
      const projectMetadataList = await this.readProjectMetadataList();
      const projectMetadataIndex = projectMetadataList.findIndex(
        (projectMetadata) => projectMetadata.id === projectId,
      );

      if (projectMetadataIndex < 0) {
        return { id: projectId, title };
      }

      const projectThumbnailRecord = extractProjectThumbnailRecordFromFrames(frames);
      const updatedProjectMetadata = {
        ...projectMetadataList[projectMetadataIndex],
        title,
        updatedAtMilliseconds: Date.now(),
        thumbnailImageSource: projectThumbnailRecord.thumbnailImageSource,
        thumbnailStorageKey: projectThumbnailRecord.thumbnailStorageKey,
      };

      projectMetadataList[projectMetadataIndex] = updatedProjectMetadata;
      await this.writeProjectMetadataList(projectMetadataList);
      return updatedProjectMetadata;
    });
  }

  async updateProjectMetadata({ projectId, updates }) {
    await this.initializeIfNeeded();

    return this.enqueueMetadataListMutation(async () => {
      const projectMetadataList = await this.readProjectMetadataList();
      const projectMetadataIndex = projectMetadataList.findIndex(
        (projectMetadata) => projectMetadata.id === projectId,
      );

      if (projectMetadataIndex < 0) {
        throw new Error(`Cannot update metadata because project does not exist: ${projectId}`);
      }

      projectMetadataList[projectMetadataIndex] = {
        ...projectMetadataList[projectMetadataIndex],
        ...updates,
        updatedAtMilliseconds: Date.now(),
      };

      await this.writeProjectMetadataList(projectMetadataList);
      return projectMetadataList[projectMetadataIndex];
    });
  }

  async deleteProject({ projectId }) {
    await this.initializeIfNeeded();

    await this.enqueueMetadataListMutation(async () => {
      const projectMetadataList = await this.readProjectMetadataList();
      const updatedProjectMetadataList = projectMetadataList.filter(
        (projectMetadata) => projectMetadata.id !== projectId,
      );

      await this.writeProjectMetadataList(updatedProjectMetadataList);
    });

    const projectsDirectoryHandle = await this.getProjectsDirectoryHandle();
    const contentFileName = getProjectContentFileName(projectId);

    try {
      await projectsDirectoryHandle.removeEntry(contentFileName);
    } catch (projectContentRemoveError) {
      if (projectContentRemoveError?.name !== "NotFoundError") {
        throw projectContentRemoveError;
      }
    }
  }

  async initializeIfNeeded() {
    if (this.hasInitializedStorage) {
      return;
    }

    await this.initialize();
  }

  async readProjectMetadataList() {
    const projectsDirectoryHandle = await this.getProjectsDirectoryHandle();

    try {
      const metadataFileHandle = await projectsDirectoryHandle.getFileHandle(PROJECT_METADATA_FILE_NAME);
      const metadataFile = await metadataFileHandle.getFile();
      const metadataText = await metadataFile.text();

      if (!metadataText.trim()) {
        return [];
      }

      const parsedProjectMetadataList = JSON.parse(metadataText);
      return Array.isArray(parsedProjectMetadataList) ? parsedProjectMetadataList : [];
    } catch (readError) {
      if (readError?.name === "NotFoundError") {
        return [];
      }

      throw readError;
    }
  }

  async writeProjectMetadataList(projectMetadataList) {
    const projectsDirectoryHandle = await this.getProjectsDirectoryHandle();
    const metadataFileHandle = await projectsDirectoryHandle.getFileHandle(PROJECT_METADATA_FILE_NAME, {
      create: true,
    });

    const metadataWritableFileStream = await metadataFileHandle.createWritable();

    try {
      await metadataWritableFileStream.write(JSON.stringify(projectMetadataList));
    } finally {
      await metadataWritableFileStream.close();
    }
  }

  async readProjectContentRecord({ projectId }) {
    const projectsDirectoryHandle = await this.getProjectsDirectoryHandle();
    const contentFileName = getProjectContentFileName(projectId);
    const contentFileHandle = await projectsDirectoryHandle.getFileHandle(contentFileName);
    const contentFile = await contentFileHandle.getFile();
    const contentText = await contentFile.text();

    if (!contentText.trim()) {
      return {
        id: projectId,
        title: "Untitled Project",
        frames: [],
      };
    }

    const parsedProjectContentRecord = JSON.parse(contentText);

    return {
      id: projectId,
      title: parsedProjectContentRecord.title,
      frames: Array.isArray(parsedProjectContentRecord.frames)
        ? parsedProjectContentRecord.frames
        : [],
    };
  }

  async writeProjectContentRecord({ projectId, projectContentRecord }) {
    const projectsDirectoryHandle = await this.getProjectsDirectoryHandle();
    const contentFileName = getProjectContentFileName(projectId);
    const contentFileHandle = await projectsDirectoryHandle.getFileHandle(contentFileName, {
      create: true,
    });

    const contentWritableFileStream = await contentFileHandle.createWritable();

    try {
      await contentWritableFileStream.write(JSON.stringify(projectContentRecord));
    } finally {
      await contentWritableFileStream.close();
    }
  }
}

function getProjectContentFileName(projectIdentifier) {
  return `${projectIdentifier}.json`;
}

function createProjectIdentifier() {
  return `project-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function extractProjectThumbnailRecordFromFrames(frames) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return {
      thumbnailImageSource: null,
      thumbnailStorageKey: null,
    };
  }

  const lastFrameRecord = frames[frames.length - 1];

  if (lastFrameRecord?.thumbnailStorageKey) {
    return {
      thumbnailImageSource: null,
      thumbnailStorageKey: lastFrameRecord.thumbnailStorageKey,
    };
  }

  return {
    thumbnailImageSource: lastFrameRecord?.timelineImageSource ?? null,
    thumbnailStorageKey: null,
  };
}

function serializeFrameRecordForStorage(frameRecord) {
  if (!frameRecord || typeof frameRecord !== "object") {
    return frameRecord;
  }

  const serializedFrameRecord = { ...frameRecord };

  if (isTransientImageSource(serializedFrameRecord.timelineImageSource)) {
    delete serializedFrameRecord.timelineImageSource;
  }

  if (isTransientImageSource(serializedFrameRecord.previewImageSource)) {
    delete serializedFrameRecord.previewImageSource;
  }

  if (isTransientImageSource(serializedFrameRecord.playbackImageSource)) {
    delete serializedFrameRecord.playbackImageSource;
  }

  return serializedFrameRecord;
}

function isTransientImageSource(imageSource) {
  return typeof imageSource === "string" && imageSource.startsWith("blob:");
}

const projectStorageService = new ProjectStorageService();

export default projectStorageService;
