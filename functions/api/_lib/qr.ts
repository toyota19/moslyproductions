import QRCore from 'qrcode/lib/core/qrcode.js';
import { bytesToBase64 } from './security';

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc, false);
  return chunk;
}

async function zlibDeflate(input: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);
  void writer.write(copy);
  void writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function buildQrAssetsEdge(
  qrToken: string,
): Promise<{ qrDataUrl: string; qrBuffer: Uint8Array }> {
  const qr = QRCore.create(qrToken, { errorCorrectionLevel: 'M' });
  const moduleCount = qr.modules.size;
  const margin = 3;
  const scale = 8;
  const size = (moduleCount + margin * 2) * scale;

  // Grayscale 8-bit PNG: 1 filter byte (0) + `size` pixel bytes per row
  const rowStride = 1 + size;
  const rawPixels = new Uint8Array(rowStride * size);
  rawPixels.fill(255); // White background

  for (let py = 0; py < size; py++) {
    const rowOffset = py * rowStride;
    rawPixels[rowOffset] = 0; // PNG filter type: None

    const modY = Math.floor(py / scale) - margin;
    if (modY < 0 || modY >= moduleCount) continue;

    for (let px = 0; px < size; px++) {
      const modX = Math.floor(px / scale) - margin;
      if (modX < 0 || modX >= moduleCount) continue;

      if (qr.modules.get(modY, modX)) {
        rawPixels[rowOffset + 1 + px] = 9; // Deep charcoal #09090B
      }
    }
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, size, false);
  ihdrView.setUint32(4, size, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const compressedIdat = await zlibDeflate(rawPixels);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makePngChunk('IHDR', ihdr);
  const idatChunk = makePngChunk('IDAT', compressedIdat);
  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  let offset = 0;
  png.set(signature, offset);
  offset += signature.length;
  png.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  png.set(idatChunk, offset);
  offset += idatChunk.length;
  png.set(iendChunk, offset);

  return {
    qrBuffer: png,
    qrDataUrl: `data:image/png;base64,${bytesToBase64(png)}`,
  };
}
