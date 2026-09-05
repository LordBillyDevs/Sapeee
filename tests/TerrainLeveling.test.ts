import { levelTerrain } from '../src/terrain/TerrainLeveling';

describe('levelTerrain', () => {
    it('levels a clamped rectangle to its average', () => {
        const data = new Uint8Array(4 * 4 * 4);
        data[0] = 10;
        data[4] = 30;
        data[16] = 50;
        data[20] = 70;
        const level = levelTerrain({ width: 4, height: 4, data }, 0, 0, 1, 1);
        expect(level).toBe(40);
        expect([data[0], data[4], data[16], data[20]]).toEqual([40, 40, 40, 40]);
    });

    it('uses an explicit target and clamps it to byte range', () => {
        const data = new Uint8Array(4 * 4 * 4);
        expect(levelTerrain({ width: 4, height: 4, data }, 2, 2, 4, 4, 300)).toBe(255);
        expect(data[(3 * 4 + 3) * 4]).toBe(255);
    });
});
