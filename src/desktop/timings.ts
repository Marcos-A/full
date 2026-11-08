import { invoke } from '@tauri-apps/api/core';
import { ws } from '../doc/workspace';
import { RenderedPane } from '../doc/RenderedPane';
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

/** Waits until the file's editor is on screen and can be typed into. React shows it within the first frames. */
async function editorShown(kind: 'csv' | 'markdown' | 'text'): Promise<void> {
  await painted();
  const selector = kind === 'csv' ? '.grid-scroll, .cm-content' : '.cm-content';
  for (let tries = 0; tries < 600 && !document.querySelector(selector); tries++) await nextFrame();
  await painted();
}

const SLOWEST_RENDER_MS = 20000;

/** Work that might explain a slow frame, kept only for as long as a frame could need it. */
interface Span {
  name: string;
  start: number;
  end: number;
}
let spans: Span[] = [];

function note(name: string, start: number): void {
  const end = performance.now();
  spans.push({ name, start, end });
  if (spans.length > 200) spans = spans.slice(-100);
}

/** Times a piece of work when measuring, and otherwise just runs it. */
export function timedSpan<T>(name: string, run: () => T): T {
  if (!measuring) return run();
  const start = performance.now();
  try {
    return run();
  } finally {
    note(name, start);
  }
}

type Method = (...args: never[]) => unknown;

/** Records how long a method takes, whether or not it returns a promise. */
function watch(owner: object, key: string, name: string, after?: () => void): void {
  const holder = owner as unknown as Record<string, Method>;
  const original = holder[key];
  holder[key] = function (this: unknown, ...args: never[]) {
    const start = performance.now();
    const result = original.apply(this, args);
    if (result instanceof Promise) void result.finally(() => note(name, start));
    else {
      note(name, start);
      after?.();
    }
    return result;
  } as Method;
}

let renderedOpen: (() => void) | null = null;

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
      const kind = kindOf(name);
      const rendered =
        kind === 'markdown' && ws.active?.viewMode !== 'source'
          ? new Promise<void>((resolve) => {
              renderedOpen = resolve;
              setTimeout(resolve, SLOWEST_RENDER_MS);
            })
          : null;
      await editorShown(kind);
      const editable = performance.now() - started;
      let renderedMs = '';
      if (rendered) {
        await rendered;
        await painted();
        renderedMs = ` rendered-ms=${(performance.now() - started).toFixed(1)}`;
        renderedOpen = null;
      }
      void report(`open kind=${kind} bytes=${files[0].file.size} editable-ms=${editable.toFixed(1)}${renderedMs}`);
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

export function blameFrames(gaps: { start: number; end: number }[], work: Span[]): Record<string, number> {
  const blame: Record<string, number> = {};
  for (const gap of gaps) {
    const names = new Set(work.filter((span) => span.start < gap.end && span.end > gap.start).map((span) => span.name));
    if (names.size === 0) names.add('other');
    for (const name of names) blame[name] = (blame[name] ?? 0) + 1;
  }
  return blame;
}

/** Time from each key press to the frame that shows it, and how steady the frames are while typing. */
function measureTyping(): void {
  let latencies: number[] = [];
  let gaps: number[] = [];
  let slow: { start: number; end: number }[] = [];
  let lastKeyAt = -Infinity;
  let lastFrameAt: number | null = null;
  let running = false;

  const finish = () => {
    if (latencies.length >= FEWEST_KEYS) {
      const over = gaps.filter((gap) => gap > LONG_FRAME_MS).length;
      void report(`typing keys=${latencies.length} ${summary('latency', latencies)} ${summary('frame', gaps)} frames-over-50ms=${over}`);
      const blame = Object.entries(blameFrames(slow, spans)).map(([name, count]) => `${name}=${count}`);
      if (blame.length > 0) void report(`slow-frames ${blame.join(' ')}`);
    }
    latencies = [];
    gaps = [];
    slow = [];
  };

  const frame = (now: number) => {
    if (lastFrameAt !== null) {
      gaps.push(now - lastFrameAt);
      if (now - lastFrameAt > LONG_FRAME_MS) slow.push({ start: lastFrameAt, end: now });
    }
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
      // Handling the key has finished by the next frame, which then paints what it did.
      requestAnimationFrame(() => latencies.push(performance.now() - pressedAt));
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
  watch(ws, 'refreshRecovery', 'recovery');
  watch(ws, 'persistNow', 'persist');
  watch(RenderedPane.prototype, 'parseSections', 'parse');
  watch(RenderedPane.prototype, 'applyLoaded', 'render', () => renderedOpen?.());
  try {
    await started;
    await painted();
    await report('ready');
  } catch {
    await report('start-failed').catch(() => undefined);
  }
}
