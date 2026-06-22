const PROJECTS_DIRECTORY_NAME = "projects";
const PROJECT_METADATA_FILE_NAME = "project-metadata-list.json";

class ProjectStorageService {
  constructor() {
    this.originPrivateFileSystemRootDirectoryHandle = null;
    this.projectsDirectoryHandle = null;
    this.hasInitializedStorage = false;
  }

  async initialize() {
    await this.getProjectsDirectoryHandle();
    await this.ensureProjectMetadataListFileExists();
    this.hasInitializedStorage = true;
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

    const currentProjectMetadataList = await this.readProjectMetadataList();
    currentProjectMetadataList.push(projectMetadataRecord);
    await this.writeProjectMetadataList(currentProjectMetadataList);
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

  async saveProject({ projectId, frames, title }) {
    await this.initializeIfNeeded();

    const projectMetadataList = await this.readProjectMetadataList();
    const projectMetadataIndex = projectMetadataList.findIndex((projectMetadata) => projectMetadata.id === projectId);

    if (projectMetadataIndex < 0) {
      throw new Error(`Cannot save project because it does not exist: ${projectId}`);
    }

    const existingProjectMetadata = projectMetadataList[projectMetadataIndex];
    const updatedAtMilliseconds = Date.now();
    const projectThumbnailRecord = extractProjectThumbnailRecordFromFrames(frames);

    const updatedProjectMetadata = {
      ...existingProjectMetadata,
      title,
      updatedAtMilliseconds,
      thumbnailImageSource: projectThumbnailRecord.thumbnailImageSource,
      thumbnailStorageKey: projectThumbnailRecord.thumbnailStorageKey,
    };

    projectMetadataList[projectMetadataIndex] = updatedProjectMetadata;

    await this.writeProjectMetadataList(projectMetadataList);
    await this.writeProjectContentRecord({
      projectId,
      projectContentRecord: {
        id: projectId,
        title,
        frames: frames.map(serializeFrameRecordForStorage),
      },
    });

    return updatedProjectMetadata;
  }

  async updateProjectMetadata({ projectId, updates }) {
    await this.initializeIfNeeded();

    const projectMetadataList = await this.readProjectMetadataList();
    const projectMetadataIndex = projectMetadataList.findIndex((projectMetadata) => projectMetadata.id === projectId);

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
  }

  async deleteProject({ projectId }) {
    await this.initializeIfNeeded();

    const projectMetadataList = await this.readProjectMetadataList();
    const updatedProjectMetadataList = projectMetadataList.filter(
      (projectMetadata) => projectMetadata.id !== projectId,
    );

    await this.writeProjectMetadataList(updatedProjectMetadataList);

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
