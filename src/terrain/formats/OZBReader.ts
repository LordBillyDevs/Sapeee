export interface OZBData {
    width: number;
    height: number;
    data: Uint8Array; // RGBA flat array (width * height * 4)
}

export function readOZB(buffer: ArrayBuffer): OZBData {
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);

    const fileType = String.fromCharCode(u8[0], u8[1], u8[2]);
    const version = u8[3];

    let offset = 4;

    // BMP header (14 bytes)
    const bmpType = view.getInt16(offset, true); offset += 2;
    const bmpSize = view.getInt32(offset, true); offset += 4;
    const res1 = view.getInt16(offset, true); offset += 2;
    const res2 = view.getInt16(offset, true); offset += 2;
    const offBits = view.getInt32(offset, true); offset += 4;

    // BMP info header (40 bytes)
    const biSize = view.getInt32(offset, true); offset += 4;
    const width = view.getInt32(offset, true); offset += 4;
    const height = view.getInt32(offset, true); offset += 4;
    const planes = view.getInt16(offset, true); offset += 2;
    const bitCount = view.getInt16(offset, true); offset += 2;
    // Skip: compression, sizeImage, xpelsPerMeter, ypelsPerMeter, clrUsed, clrImportant (6 * 4 bytes)
    offset += 24;

    if (fileType === 'BM8' || fileType === 'BM\x18') {
        offset = 4 + 14 + 40 + 1026;

        const pixelCount = width * height;
        const data = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
            const v = u8[offset++];
            data[i * 4]     = v;
            data[i * 4 + 1] = 0;
            data[i * 4 + 2] = 0;
            data[i * 4 + 3] = 255;
        }

        return { width, height, data };
    } else if (fileType === 'BM6') {
        const pixelCount = width * height;
        const data = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
            const b = u8[offset++];
            const g = u8[offset++];
            const r = u8[offset++];
            data[i * 4]     = r;
            data[i * 4 + 1] = g;
            data[i * 4 + 2] = b;
            data[i * 4 + 3] = 255;
        }
        return { width, height, data };
    } else {
        throw new Error(`Unknown OZB file type: "${fileType}"`);
    }
}

/** Write a compatible uncompressed OZB height/light bitmap. */
export function writeOZB(data: OZBData, type: 'BM8' | 'BM6' = 'BM8'): Uint8Array {
    if (data.width <= 0 || data.height <= 0 || data.data.length < data.width * data.height * 4) {
        throw new Error('OZB: invalid image data');
    }
    const bytesPerPixel = type === 'BM8' ? 1 : 3;
    const pixelOffset = 4 + 14 + 40 + (type === 'BM8' ? 1026 : 0);
    const output = new Uint8Array(pixelOffset + data.width * data.height * bytesPerPixel);
    const view = new DataView(output.buffer);
    output.set([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), 1], 0);
    view.setUint16(4, 0x4d42, true);
    view.setUint32(6, output.length, true);
    view.setUint32(14, pixelOffset, true);
    view.setUint32(18, 40, true);
    view.setInt32(22, data.width, true);
    view.setInt32(26, data.height, true);
    view.setUint16(30, 1, true);
    view.setUint16(32, type === 'BM8' ? 8 : 24, true);
    if (type === 'BM8') {
        for (let i = 0; i < data.width * data.height; i++) output[pixelOffset + i] = data.data[i * 4];
    } else {
        for (let i = 0; i < data.width * data.height; i++) {
            const source = i * 4;
            const target = pixelOffset + i * 3;
            output[target] = data.data[source + 2];
            output[target + 1] = data.data[source + 1];
            output[target + 2] = data.data[source];
        }
    }
    return output;
}
