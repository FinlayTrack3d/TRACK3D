// A small ZIP writer for "Download my data". Files are stored, not
// compressed: the JSON is small and photos are already compressed. Names
// are UTF-8. Returns the archive as a Uint8Array.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const encoder = new TextEncoder();
const toBytes = data => {
  if (typeof data === "string") return encoder.encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return encoder.encode(String(data ?? ""));
};

// The time stamped on every file, in the format ZIP uses (local time).
function dosTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const UTF8_NAMES = 0x0800;

// entries: [{ name: "data/habits.json", data: string | Uint8Array | ArrayBuffer }].
export function createZip(entries, when = new Date()) {
  const { time, date } = dosTime(when);
  const files = (entries || []).map(entry => {
    const name = encoder.encode(String(entry.name).replace(/^\/+/, ""));
    const data = toBytes(entry.data);
    return { name, data, crc: crc32(data) };
  });
  const size = files.reduce((total, file) => total + 30 + 46 + file.name.length * 2 + file.data.length, 22);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let offset = 0;
  const starts = [];
  for (const file of files) {
    starts.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, UTF8_NAMES, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, time, true);
    view.setUint16(offset + 12, date, true);
    view.setUint32(offset + 14, file.crc, true);
    view.setUint32(offset + 18, file.data.length, true);
    view.setUint32(offset + 22, file.data.length, true);
    view.setUint16(offset + 26, file.name.length, true);
    view.setUint16(offset + 28, 0, true);
    out.set(file.name, offset + 30);
    out.set(file.data, offset + 30 + file.name.length);
    offset += 30 + file.name.length + file.data.length;
  }
  const directoryStart = offset;
  files.forEach((file, index) => {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, UTF8_NAMES, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, time, true);
    view.setUint16(offset + 14, date, true);
    view.setUint32(offset + 16, file.crc, true);
    view.setUint32(offset + 20, file.data.length, true);
    view.setUint32(offset + 24, file.data.length, true);
    view.setUint16(offset + 28, file.name.length, true);
    // Extra field, comment, disk, internal and external attributes: none.
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, starts[index], true);
    out.set(file.name, offset + 46);
    offset += 46 + file.name.length;
  });
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, files.length, true);
  view.setUint16(offset + 10, files.length, true);
  view.setUint32(offset + 12, offset - directoryStart, true);
  view.setUint32(offset + 16, directoryStart, true);
  view.setUint16(offset + 20, 0, true);
  return out;
}
