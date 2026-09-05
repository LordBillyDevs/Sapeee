export interface HeightPlane {
    width: number;
    height: number;
    data: Uint8Array;
}

/** Flatten the red channel of an OZB height plane inside a tile rectangle. */
export function levelTerrain(
    height: HeightPlane,
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    target?: number,
): number {
    const minX = Math.max(0, Math.min(startX, endX));
    const maxX = Math.min(height.width - 1, Math.max(startX, endX));
    const minZ = Math.max(0, Math.min(startZ, endZ));
    const maxZ = Math.min(height.height - 1, Math.max(startZ, endZ));
    let total = 0;
    let count = 0;
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
        total += height.data[(z * height.width + x) * 4];
        count++;
    }
    const level = Math.max(0, Math.min(255, Math.round(target ?? (total / Math.max(1, count)))));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) height.data[(z * height.width + x) * 4] = level;
    return level;
}
