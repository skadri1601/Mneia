import type { Uuid } from '@mneia/core';

export const DEFAULT_SLICE_LOG_CAPACITY = 32;

export interface RecordedSlice {
  readonly sliceId: Uuid;
  readonly projectId: Uuid;
  readonly itemIds: readonly Uuid[];
}

export interface SliceLog {
  readonly capacity: number;
  readonly size: number;
  record(slice: RecordedSlice): void;
  get(sliceId: Uuid): RecordedSlice | null;
}

export function createSliceLog(capacity: number = DEFAULT_SLICE_LOG_CAPACITY): SliceLog {
  const limit = Math.max(1, Math.trunc(capacity));
  const recorded = new Map<Uuid, RecordedSlice>();

  return {
    capacity: limit,

    get size(): number {
      return recorded.size;
    },

    record(slice: RecordedSlice): void {
      recorded.delete(slice.sliceId);
      recorded.set(slice.sliceId, slice);
      while (recorded.size > limit) {
        const oldest = recorded.keys().next();
        if (oldest.done === true) {
          return;
        }
        recorded.delete(oldest.value);
      }
    },

    get(sliceId: Uuid): RecordedSlice | null {
      return recorded.get(sliceId) ?? null;
    },
  };
}
