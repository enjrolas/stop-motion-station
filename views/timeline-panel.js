const interItemSpacingInPixels = 8;
const gapSlotWidthInPixels = 18;
const frameSlotWidthInPixels = 100;
const timelinePanelHorizontalPaddingInPixels = 20;
const gapStrideInPixels = gapSlotWidthInPixels + interItemSpacingInPixels;
const frameStrideInPixels = frameSlotWidthInPixels + interItemSpacingInPixels;
const fullPairStrideInPixels = gapStrideInPixels + frameStrideInPixels;

export function computeVisibleTimelineItemCount({ timelinePanelWidth }) {
  const visibleStripWidth = Math.max(
    1,
    timelinePanelWidth - timelinePanelHorizontalPaddingInPixels,
  );

  return Math.max(1, (visibleStripWidth / fullPairStrideInPixels) * 2);
}

export function computeRenderedTimelineRange({
  frameCount,
  timelineScrollOffsetInItemUnits,
  visibleTimelineItemCount,
  overscanItemCount = 6,
}) {
  const maximumTimelinePosition = frameCount * 2;
  const visibleStartPosition = Math.floor(timelineScrollOffsetInItemUnits);
  const visibleEndPosition = Math.ceil(
    timelineScrollOffsetInItemUnits + visibleTimelineItemCount,
  );

  return {
    startPosition: Math.max(0, visibleStartPosition - overscanItemCount),
    endPosition: Math.min(maximumTimelinePosition, visibleEndPosition + overscanItemCount),
  };
}

function renderGapButton(state, emit, gapIndex) {
  const gapIsSelected = state.selectedTimelineItem.type === "gap"
    && state.selectedTimelineItem.index === gapIndex;

  return html`
    <button
      class=${`timeline-gap ${gapIsSelected ? "is-selected" : ""}`}
      disabled=${state.isTimelapseCapturing}
      onclick=${() => emit("timeline:select-gap", gapIndex)}
      aria-label=${`Select insertion point ${gapIndex}`}
      data-timeline-item-type="gap"
    ></button>
  `;
}

function renderFrameButton(state, emit, frame, frameIndex) {
  const frameIsSelected = state.selectedTimelineItem.type === "frame"
    && state.selectedTimelineItem.index === frameIndex;
  const frameIsPlaying = state.isPlaying && state.playbackFrameIndex === frameIndex;

  const frameButtonClassNames = ["timeline-frame"];

  if (frameIsSelected) {
    frameButtonClassNames.push("is-selected");
  }

  if (frameIsPlaying) {
    frameButtonClassNames.push("is-playing");
  }

  return html`
    <button
      class=${frameButtonClassNames.join(" ")}
      disabled=${state.isTimelapseCapturing}
      onclick=${() => emit("timeline:select-frame", frameIndex)}
      aria-label=${`Select frame ${frameIndex + 1}`}
      data-timeline-item-type="frame"
    >
      <img
        src=${frame.timelineImageSource}
        draggable="false"
        alt=${`Frame ${frameIndex + 1}`}
      />
    </button>
  `;
}

export default function timelinePanel(state, emit) {
  const { width, timelineHeight } = state.appSurfaceLayout;

  function calculateOffsetFromTimelineUnits(timelineUnits) {
    const fullPairCount = Math.floor(timelineUnits / 2);
    const remainderUnitCount = timelineUnits - (fullPairCount * 2);

    let offsetInPixels = fullPairCount * fullPairStrideInPixels;

    if (remainderUnitCount <= 1) {
      offsetInPixels += remainderUnitCount * gapStrideInPixels;
    } else {
      offsetInPixels += gapStrideInPixels;
      offsetInPixels += (remainderUnitCount - 1) * frameStrideInPixels;
    }

    return offsetInPixels;
  }

  const timelineOffsetInPixels = calculateOffsetFromTimelineUnits(
    state.timelineScrollOffsetInItemUnits,
  );
  const renderedTimelineRange = computeRenderedTimelineRange({
    frameCount: state.frames.length,
    timelineScrollOffsetInItemUnits: state.timelineScrollOffsetInItemUnits,
    visibleTimelineItemCount: state.visibleTimelineItemCount,
  });
  const firstRenderedGapIndex = Math.max(
    0,
    Math.floor(renderedTimelineRange.startPosition / 2),
  );
  const lastRenderedGapIndex = Math.min(
    state.frames.length,
    Math.ceil(renderedTimelineRange.endPosition / 2),
  );
  const timelineItems = [];

  for (let gapIndex = firstRenderedGapIndex; gapIndex <= lastRenderedGapIndex; gapIndex += 1) {
    const gapTimelinePosition = gapIndex * 2;

    if (
      gapTimelinePosition >= renderedTimelineRange.startPosition
      && gapTimelinePosition <= renderedTimelineRange.endPosition
    ) {
      timelineItems.push(html`
        <div
          class="timeline-item-slot"
          style=${`left: ${calculateOffsetFromTimelineUnits(gapTimelinePosition) - timelineOffsetInPixels}px;`}
        >
          ${renderGapButton(state, emit, gapIndex)}
        </div>
      `);
    }

    if (gapIndex < state.frames.length) {
      const frameTimelinePosition = (gapIndex * 2) + 1;

      if (
        frameTimelinePosition >= renderedTimelineRange.startPosition
        && frameTimelinePosition <= renderedTimelineRange.endPosition
      ) {
        timelineItems.push(html`
          <div
            class="timeline-item-slot"
            style=${`left: ${calculateOffsetFromTimelineUnits(frameTimelinePosition) - timelineOffsetInPixels}px;`}
          >
            ${renderFrameButton(state, emit, state.frames[gapIndex], gapIndex)}
          </div>
        `);
      }
    }
  }

  return html`
    <section class="timeline-panel" style=${`width: ${width}px; height: ${timelineHeight}px;`}>
      <div class="timeline-scroll-strip">
        ${timelineItems}
      </div>
    </section>
  `;
}
