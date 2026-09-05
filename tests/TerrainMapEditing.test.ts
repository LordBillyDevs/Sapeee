import { paintTerrainMapping } from '../src/terrain/TerrainMapEditing';
import { TERRAIN_SIZE } from '../src/terrain/formats/ATTReader';
import type { TerrainMappingData } from '../src/terrain/formats/MAPReader';

function mapping(): TerrainMappingData {
    return {
        version: 1,
        mapNumber: 1,
        layer1: new Uint8Array(TERRAIN_SIZE * TERRAIN_SIZE).fill(3),
        layer2: new Uint8Array(TERRAIN_SIZE * TERRAIN_SIZE).fill(4),
        alpha: new Uint8Array(TERRAIN_SIZE * TERRAIN_SIZE).fill(90),
    };
}

describe('terrain MAP painting', () => {
    it('updates only the selected layer and preserves overlay alpha for base-only paint', () => {
        const data = mapping();
        const changed = paintTerrainMapping(data, 10, 10, 7, 8, 255, 1, '1');
        const index = 10 * TERRAIN_SIZE + 10;

        expect(changed).toBe(1);
        expect(data.layer1[index]).toBe(7);
        expect(data.layer2[index]).toBe(4);
        expect(data.alpha[index]).toBe(90);
    });

    it('updates both indices and blend alpha when painting both layers', () => {
        const data = mapping();
        paintTerrainMapping(data, 10, 10, 7, 8, 255, 1, 'both');
        const index = 10 * TERRAIN_SIZE + 10;

        expect(data.layer1[index]).toBe(7);
        expect(data.layer2[index]).toBe(8);
        expect(data.alpha[index]).toBe(255);
    });
});
