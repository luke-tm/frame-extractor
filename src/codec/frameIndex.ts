/**
 * frameIndex.ts
 * Builds and queries a frame→timestamp lookup table.
 * Populated during the initial demux pass.
 */

import type { FrameEntry } from '../types';

export class FrameIndex {
  private entries: FrameEntry[] = [];
  private keyframeIndices: number[] = []; // sorted list of keyframe indices

  addFrame(entry: FrameEntry): void {
    this.entries.push(entry);
    if (entry.isKeyframe) {
      this.keyframeIndices.push(entry.index);
    }
  }

  get frameCount(): number {
    return this.entries.length;
  }

  get(index: number): FrameEntry | undefined {
    return this.entries[index];
  }

  getTimestamp(index: number): number | undefined {
    return this.entries[index]?.timestamp;
  }

  /**
   * Returns the nearest keyframe index at or before `frameIndex`.
   * Used to compute how many delta frames to decode-forward through.
   */
  nearestKeyframeBefore(frameIndex: number): number {
    let result = 0;
    for (const kfi of this.keyframeIndices) {
      if (kfi <= frameIndex) result = kfi;
      else break;
    }
    return result;
  }

  /**
   * How many frames to decode forward from the keyframe to reach `frameIndex`.
   */
  decodeForwardCount(frameIndex: number): number {
    return frameIndex - this.nearestKeyframeBefore(frameIndex);
  }

  /** All entries (used for scrubber thumbnail generation) */
  allEntries(): FrameEntry[] {
    return this.entries;
  }

  /** Build from a sorted array of raw samples (from demuxer) */
  static fromSamples(samples: Array<{ timestamp: number; isKeyframe: boolean; duration: number }>): FrameIndex {
    const idx = new FrameIndex();
    samples.forEach((s, i) => {
      idx.addFrame({
        index: i,
        timestamp: s.timestamp,
        isKeyframe: s.isKeyframe,
        duration: s.duration,
      });
    });
    return idx;
  }
}

/** Format microseconds as MM:SS.ms */
export function formatTimestamp(us: number): string {
  const totalMs = Math.floor(us / 1000);
  const ms = totalMs % 1000;
  const totalS = Math.floor(totalMs / 1000);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0').slice(0, 2)}`;
}
