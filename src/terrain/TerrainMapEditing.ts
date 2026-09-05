import { TERRAIN_SIZE } from './formats/ATTReader';
import type { TerrainMappingData } from './formats/MAPReader';

export type TerrainPaintLayer = 'both' | '1' | '2';

/**
 * Applies one circular texture brush to MAP data.  Keeping this operation
 * independent from the renderer makes layer selection deterministic for both
 * shader and geometry-backed terrain materials.
 */
export function paintTerrainMapping(
    mapping: TerrainMappingData,
    centerX: number,
    centerZ: number,
    layer1: number,
    layer2: number,
    alpha: number,
    brushSize: number,
    paintLayer: TerrainPaintLayer = 'both',
): number {
    const x0 = Math.max(0, Math.min(TERRAIN_SIZE - 1, Math.floor(centerX)));
    const z0 = Math.max(0, Math.min(TERRAIN_SIZE - 1, Math.floor(centerZ)));
    const radius = Math.max(0.5, Math.max(1, Math.round(brushSize)) - 0.5);
    const base = Math.max(0, Math.min(255, Math.round(layer1)));
    const overlay = Math.max(0, Math.min(255, Math.round(layer2)));
    const blend = Math.max(0, Math.min(255, Math.round(alpha)));
    let changed = 0;

    for (let z = Math.max(0, Math.floor(z0 - radius)); z <= Math.min(TERRAIN_SIZE - 1, Math.ceil(z0 + radius)); z++) {
        for (let x = Math.max(0, Math.floor(x0 - radius)); x <= Math.min(TERRAIN_SIZE - 1, Math.ceil(x0 + radius)); x++) {
            if ((x - x0) ** 2 + (z - z0) ** 2 > radius ** 2) continue;
            const index = z * TERRAIN_SIZE + x;
            if (paintLayer !== '2' && mapping.layer1[index] !== base) {
                mapping.layer1[index] = base;
                changed++;
            }
            if (paintLayer !== '1') {
                if (mapping.layer2[index] !== overlay) {
                    mapping.layer2[index] = overlay;
                    changed++;
                }
                if (mapping.alpha[index] !== blend) {
                    mapping.alpha[index] = blend;
                    changed++;
                }
            }
        }
    }
    return changed;
}
