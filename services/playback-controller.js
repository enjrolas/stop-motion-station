class PlaybackController {
  constructor() {
    this.timeoutIdentifier = null;
    this.isPlaying = false;
  }

  playFrames({ frames, framesPerSecond, getFramesPerSecond, onFrameChange, onComplete }) {
    this.stop();

    if (!frames.length) {
      return;
    }

    this.isPlaying = true;

    let currentFrameIndex = 0;

    const getFrameDurationInMilliseconds = () => {
      const resolvedFramesPerSecond = getFramesPerSecond
        ? getFramesPerSecond()
        : framesPerSecond;

      return 1000 / Math.max(1, resolvedFramesPerSecond);
    };

    const continuePlayback = () => {
      if (!this.isPlaying) {
        return;
      }

      onFrameChange(currentFrameIndex);
      currentFrameIndex += 1;

      if (currentFrameIndex >= frames.length) {
        this.isPlaying = false;
        this.timeoutIdentifier = null;
        onComplete();
        return;
      }

      this.timeoutIdentifier = window.setTimeout(
        continuePlayback,
        getFrameDurationInMilliseconds(),
      );
    };

    continuePlayback();
  }

  stop() {
    this.isPlaying = false;

    if (this.timeoutIdentifier !== null) {
      window.clearTimeout(this.timeoutIdentifier);
      this.timeoutIdentifier = null;
    }
  }
}

const playbackController = new PlaybackController();

export default playbackController;
