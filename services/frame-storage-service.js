class FrameStorageService {
  constructor() {
    this.originPrivateFileSystemRootDirectoryHandle = null;
    this.framesDirectoryHandle = null;
  }

  async initialize() {
    await this.getFramesDirectoryHandle();
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

  async getFramesDirectoryHandle() {
    if (this.framesDirectoryHandle) {
      return this.framesDirectoryHandle;
    }

    const rootDirectoryHandle = await this.getRootDirectoryHandle();
    this.framesDirectoryHandle = await rootDirectoryHandle.getDirectoryHandle("frames", {
      create: true,
    });

    return this.framesDirectoryHandle;
  }

  async saveOriginalFrameBlob({ frameId, storageKey = createOriginalFrameStorageKey(frameId), blob }) {
    const framesDirectoryHandle = await this.getFramesDirectoryHandle();
    const frameFileHandle = await framesDirectoryHandle.getFileHandle(storageKey, {
      create: true,
    });

    const fileWritableStream = await frameFileHandle.createWritable();

    try {
      await fileWritableStream.write(blob);
    } finally {
      await fileWritableStream.close();
    }

    return storageKey;
  }

  async saveThumbnailFrameBlob({ frameId, storageKey = createThumbnailFrameStorageKey(frameId), blob }) {
    const framesDirectoryHandle = await this.getFramesDirectoryHandle();
    const frameFileHandle = await framesDirectoryHandle.getFileHandle(storageKey, {
      create: true,
    });

    const fileWritableStream = await frameFileHandle.createWritable();

    try {
      await fileWritableStream.write(blob);
    } finally {
      await fileWritableStream.close();
    }

    return storageKey;
  }

  async deleteOriginalFrame({ storageKey }) {
    await this.deleteFrameStorageEntry({ storageKey });
  }

  async deleteThumbnailFrame({ storageKey }) {
    await this.deleteFrameStorageEntry({ storageKey });
  }

  async deleteFrameStorageEntry({ storageKey }) {
    if (!storageKey) {
      return;
    }

    const framesDirectoryHandle = await this.getFramesDirectoryHandle();

    try {
      await framesDirectoryHandle.removeEntry(storageKey);
    } catch (deleteError) {
      if (deleteError?.name !== "NotFoundError") {
        throw deleteError;
      }
    }
  }

  async readOriginalFrameFile({ storageKey }) {
    const framesDirectoryHandle = await this.getFramesDirectoryHandle();
    const frameFileHandle = await framesDirectoryHandle.getFileHandle(storageKey);
    return frameFileHandle.getFile();
  }

  async readThumbnailFrameFile({ storageKey }) {
    const framesDirectoryHandle = await this.getFramesDirectoryHandle();
    const frameFileHandle = await framesDirectoryHandle.getFileHandle(storageKey);
    return frameFileHandle.getFile();
  }
}

export function createOriginalFrameStorageKey(frameId) {
  return `${frameId}.jpg`;
}

export function createThumbnailFrameStorageKey(frameId) {
  return `${frameId}-timeline.jpg`;
}

const frameStorageService = new FrameStorageService();

export default frameStorageService;
