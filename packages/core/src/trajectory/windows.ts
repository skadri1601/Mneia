import { open, readFile, stat } from 'node:fs/promises';

export const TRANSCRIPT_WINDOW_BYTES = 262_144;

export interface TranscriptWindows {
  readonly head: string;
  readonly tail: string;
  readonly bytes: number;
  readonly modified: Date;
  readonly windowed: boolean;
}

const afterFirstLine = (text: string): string => {
  const boundary = text.indexOf('\n');
  return boundary === -1 ? '' : text.slice(boundary + 1);
};

const beforeLastLine = (text: string): string => {
  const boundary = text.lastIndexOf('\n');
  return boundary === -1 ? text : text.slice(0, boundary);
};

export async function readTranscriptWindows(
  path: string,
  windowBytes: number = TRANSCRIPT_WINDOW_BYTES,
): Promise<TranscriptWindows> {
  const stats = await stat(path);
  const bytes = stats.size;

  if (bytes <= windowBytes * 2) {
    return {
      head: await readFile(path, 'utf8'),
      tail: '',
      bytes,
      modified: stats.mtime,
      windowed: false,
    };
  }

  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(windowBytes);
    const tail = Buffer.alloc(windowBytes);
    const headRead = await handle.read(head, 0, windowBytes, 0);
    const tailRead = await handle.read(tail, 0, windowBytes, bytes - windowBytes);
    return {
      head: beforeLastLine(head.subarray(0, headRead.bytesRead).toString('utf8')),
      tail: afterFirstLine(tail.subarray(0, tailRead.bytesRead).toString('utf8')),
      bytes,
      modified: stats.mtime,
      windowed: true,
    };
  } finally {
    await handle.close();
  }
}
