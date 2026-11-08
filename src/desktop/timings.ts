import { invoke } from '@tauri-apps/api/core';
import type { FileBinding, PickedFile, Revision } from '../platform/host';
import { desktopHost } from './host';

/**
 * Developer measurements against the budgets in the audit. They only run when the app was started
 * with FULL_TIMINGS set. Results go to the app's own stderr, and nothing is sent anywhere.
 */

const report = (text: string) => invoke<boolean>('report_timing', { report: text });

let measuring = false;

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

/** The second frame after a change, so that the first has been painted. */
async function painted(): Promise<void> {
  await nextFrame();
  await nextFrame();
}

/** Waits until the file's editor is on screen and can be typed into. */
async function editorShown(kind: 'csv' | 'markdown' | 'text'): Promise<void> {
  const selector = kind === 'csv' ? '.grid-scroll, .cm-content' : kind === 'markdown' ? '.cm-content, .md-rendered .ProseMirror' : '.cm-content';
  for (let tries = 0; tries < 600 && !document.querySelector(selector); tries++) await nextFrame();
  await painted();
}

const kindOf = (name: string): 'csv' | 'markdown' | 'text' => (/\.csv$/i.test(name) ? 'csv' : /\.(md|markdown)$/i.test(name) ? 'markdown' : 'text');

export function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

export function summary(name: string, values: number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const part = (label: string, value: number) => `${name}-${label}=${value.toFixed(1)}`;
  return [part('p50', percentile(sorted, 0.5)), part('p95', percentile(sorted, 0.95)), part('max', sorted[sorted.length - 1] ?? 0)].join(' ');
}

let readStartedAt: number | null = null;

export function timedRead(read: (grant: string) => Promise<ArrayBuffer>): (grant: string) => Promise<ArrayBuffer> {
  return (grant) => {
    if (measuring) readStartedAt ??= performance.now();
    return read(grant);
  };
}

export function timedOpen(open: (files: PickedFile[]) => Promise<void>): (files: PickedFile[]) => Promise<void> {
  return async (files) => {
    if (!measuring) return open(files);
    readStartedAt = null;
    await open(files);
    const name = files.length === 1 ? files[0].file.name : '';
    const started = readStartedAt;
    if (name && started !== null) {
      await editorShown(kindOf(name));
      void report(`open kind=${kindOf(name)} bytes=${files[0].file.size} ms=${(performance.now() - started).toFixed(1)}`);
    }
    readStartedAt = null;
  };
}

function measureSaves(): void {
  const { write } = desktopHost;
  desktopHost.write = async (binding: FileBinding, bytes: Uint8Array, expected?: Revision) => {
    const started = performance.now();
    const result = await write(binding, bytes, expected);
    void report(`save bytes=${bytes.byteLength} ms=${(performance.now() - started).toFixed(1)}`);
    return result;
  };
}

const QUIET_MS = 2000;
const FEWEST_KEYS = 20;
const LONG_FRAME_MS = 50;

/** Time from each key press to the frame that shows it, and how steady the frames are while typing. */
function measureTyping(): void {
  let latencies: number[] = [];
  let gaps: number[] = [];
  let lastKeyAt = -Infinity;
  let lastFrameAt: number | null = null;
  let running = false;

  const finish = () => {
    if (latencies.length >= FEWEST_KEYS) {
      const over = gaps.filter((gap) => gap > LONG_FRAME_MS).length;
      void report(`typing keys=${latencies.length} ${summary('latency', latencies)} ${summary('frame', gaps)} frames-over-50ms=${over}`);
    }
    latencies = [];
    gaps = [];
  };

  const frame = (now: number) => {
    if (lastFrameAt !== null) gaps.push(now - lastFrameAt);
    lastFrameAt = now;
    if (performance.now() - lastKeyAt < QUIET_MS) {
      requestAnimationFrame(frame);
    } else {
      running = false;
      lastFrameAt = null;
      finish();
    }
  };

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key.length !== 1 || event.metaKey || event.ctrlKey) return;
      lastKeyAt = performance.now();
      const pressedAt = event.timeStamp;
      void painted().then(() => latencies.push(performance.now() - pressedAt));
      if (!running) {
        running = true;
        requestAnimationFrame(frame);
      }
    },
    true,
  );
}

/** Runs only if native code says timings are on. Waits for the app to be usable before saying so. */
export async function startTimings(started: Promise<unknown>): Promise<void> {
  try {
    measuring = await report('check');
  } catch {
    return;
  }
  if (!measuring) return;
  measureSaves();
  measureTyping();
  try {
    await started;
    await painted();
    await report('ready');
  } catch {
    await report('start-failed').catch(() => undefined);
  }
}
