/**
 * A minimal ZIP writer: local headers, central directory and end record, no ZIP64 (the XLSX row
 * limit keeps every part far below 4 GB). Each entry is fed in chunks, so a large sheet never has
 * to exist as one string or one buffer before it's compressed.
 */

export interface ZipEntry {
  name: string;
  /** The entry's uncompressed bytes, in order. */
  chunks: Iterable<Uint8Array>;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, previous = 0): number {
  let crc = previous ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date, in local time, as ZIP readers show them. */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

interface Packed {
  name: Uint8Array;
  method: 0 | 8;
  crc: number;
  size: number;
  data: Uint8Array[];
  compressedSize: number;
}

const canDeflate = (): boolean => {
  try {
    new CompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
};

async function pack(entry: ZipEntry, deflate: boolean): Promise<Packed> {
  const name = new TextEncoder().encode(entry.name);
  let crc = 0;
  let size = 0;
  const data: Uint8Array[] = [];
  let compressedSize = 0;
  if (!deflate) {
    for (const chunk of entry.chunks) {
      crc = crc32(chunk, crc);
      size += chunk.length;
      data.push(chunk);
    }
    return { name, method: 0, crc, size, data, compressedSize: size };
  }
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const reading = (async () => {
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      data.push(value);
      compressedSize += value.length;
    }
  })();
  for (const chunk of entry.chunks) {
    crc = crc32(chunk, crc);
    size += chunk.length;
    await writer.write(chunk as Uint8Array<ArrayBuffer>);
  }
  await writer.close();
  await reading;
  return { name, method: 8, crc, size, data, compressedSize };
}

/** The ZIP file's bytes. Compresses where CompressionStream exists, and stores otherwise. */
export async function zip(entries: ZipEntry[], when = new Date()): Promise<Uint8Array> {
  const deflate = canDeflate();
  const { time, date } = dosDateTime(when);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const packed = await pack(entry, deflate);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, packed.method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, packed.crc, true);
    local.setUint32(18, packed.compressedSize, true);
    local.setUint32(22, packed.size, true);
    local.setUint16(26, packed.name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), packed.name, ...packed.data);

    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(8, 0x0800, true);
    record.setUint16(10, packed.method, true);
    record.setUint16(12, time, true);
    record.setUint16(14, date, true);
    record.setUint32(16, packed.crc, true);
    record.setUint32(20, packed.compressedSize, true);
    record.setUint32(24, packed.size, true);
    record.setUint16(28, packed.name.length, true);
    record.setUint32(42, offset, true);
    central.push(new Uint8Array(record.buffer), packed.name);

    offset += 30 + packed.name.length + packed.compressedSize;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  parts.push(...central, new Uint8Array(end.buffer));

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
