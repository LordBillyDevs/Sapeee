// src/terrain/formats/ATTReader.ts
import { decryptFileCryptor, encryptFileCryptor, xorBuxMask } from '../../crypto/file-cryptor';
import { decryptModulusCryptor } from '../../crypto/modulus-cryptor';

export const TERRAIN_SIZE = 256;

export enum TWFlags {
    None        = 0x0000,
    SafeZone    = 0x0001,
    Character   = 0x0002,
    NoMove      = 0x0004,
    NoGround    = 0x0008,
    Water       = 0x0010,
    Action      = 0x0020,
    Height      = 0x0040,
    CameraUp    = 0x0080,
    NoAttackZone = 0x0100,
    Att1        = 0x0200,
    Att2        = 0x0400,
    Att3        = 0x0800,
    Att4        = 0x1000,
    Att5        = 0x2000,
    Att6        = 0x4000,
    Att7        = 0x8000,
}

export interface TerrainAttributeData {
    version: number;
    index: number;
    width: number;
    height: number;
    isExtended: boolean;
    terrainWall: Uint16Array;
}

export function readATT(buffer: ArrayBuffer): TerrainAttributeData {
    let u8: Uint8Array = new Uint8Array(buffer);

    // Detect encryption type
    if (u8.length > 4 && u8[0] === 0x41 && u8[1] === 0x54 && u8[2] === 0x54 && u8[3] === 1) {
        // "ATT\x01" -> ModulusCryptor (skip 4-byte header)
        u8 = decryptModulusCryptor(u8.slice(4));
    } else {
        u8 = decryptFileCryptor(u8);
    }

    // Post-decrypt XOR with BUX mask
    u8 = xorBuxMask(u8);

    const expectedStd = TERRAIN_SIZE * TERRAIN_SIZE + 4;
    const expectedExt = TERRAIN_SIZE * TERRAIN_SIZE * 2 + 4;

    if (u8.length !== expectedStd && u8.length !== expectedExt) {
        throw new Error(`ATT: unexpected size ${u8.length} (expected ${expectedStd} or ${expectedExt})`);
    }

    const isExtended = u8.length === expectedExt;
    const version = u8[0];
    const index = u8[1];
    const width = u8[2];
    const height = u8[3];

    if (version !== 0) {
        throw new Error(`ATT: unsupported version ${version}`);
    }
    if (width !== 255 || height !== 255) {
        throw new Error(`ATT: invalid dimensions ${width}x${height}; expected 255x255`);
    }

    const terrainWall = new Uint16Array(TERRAIN_SIZE * TERRAIN_SIZE);
    let offset = 4;

    for (let i = 0; i < TERRAIN_SIZE * TERRAIN_SIZE; i++) {
        if (isExtended) {
            terrainWall[i] = u8[offset] | (u8[offset + 1] << 8);
            offset += 2;
        } else {
            terrainWall[i] = u8[offset];
            offset += 1;
        }
    }

    return { version, index, width, height, isExtended, terrainWall };
}

export function writeATT(data: TerrainAttributeData): Uint8Array {
    const tileCount = TERRAIN_SIZE * TERRAIN_SIZE;
    if (data.terrainWall.length !== tileCount) {
        throw new Error('ATT: invalid terrain size');
    }
    if (!data.isExtended && data.terrainWall.some(value => value > 0xff)) {
        throw new Error('ATT: standard format cannot store 16-bit flags');
    }

    const bytesPerTile = data.isExtended ? 2 : 1;
    const plain = new Uint8Array(4 + tileCount * bytesPerTile);
    plain[0] = data.version & 0xff;
    plain[1] = data.index & 0xff;
    plain[2] = data.width & 0xff;
    plain[3] = data.height & 0xff;
    let offset = 4;
    for (const value of data.terrainWall) {
        if (data.isExtended) {
            plain[offset] = value & 0xff;
            plain[offset + 1] = (value >>> 8) & 0xff;
            offset += 2;
        } else {
            plain[offset++] = value & 0xff;
        }
    }
    return encryptFileCryptor(xorBuxMask(plain));
}

/**
 * Writes the unencrypted 3-byte-header format used by server TerrainN.att files.
 */
export function writeServerATT(data: TerrainAttributeData): Uint8Array {
    const tileCount = TERRAIN_SIZE * TERRAIN_SIZE;
    if (data.terrainWall.length !== tileCount) {
        throw new Error('ATT: invalid terrain size');
    }
    if (data.terrainWall.some(value => value > 0xff)) {
        throw new Error('ATT server format cannot store 16-bit flags');
    }

    const plain = new Uint8Array(3 + tileCount);
    plain[0] = data.version & 0xff;
    plain[1] = data.width & 0xff;
    plain[2] = data.height & 0xff;
    data.terrainWall.forEach((value, index) => {
        plain[3 + index] = value;
    });
    return plain;
}
