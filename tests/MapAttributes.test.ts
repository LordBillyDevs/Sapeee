import {
    clientWorldNumber,
    getFriendlyMapName,
    parseMapAttributeXml,
    serverWorldNumber,
} from '../src/map-attributes';

describe('map attributes', () => {
    it('parses MapNumber, FileName and Name entries', () => {
        expect(parseMapAttributeXml('<Maps><Map MapNumber="0" FileName="World1" Name="Lorencia" /></Maps>')).toEqual([
            { mapNumber: 0, fileName: 'World1', name: 'Lorencia' },
        ]);
    });

    it('converts client map zero to server World1 without changing disk paths', () => {
        expect(clientWorldNumber(1)).toBe(0);
        expect(serverWorldNumber(0)).toBe(1);
        expect(getFriendlyMapName(1, [{ mapNumber: 0, fileName: 'World1', name: 'Lorencia' }])).toBe('Lorencia');
    });

    it('has a useful fallback name when metadata is unavailable', () => {
        expect(getFriendlyMapName(1)).toBe('Lorencia');
        expect(getFriendlyMapName(99)).toBe('World 99');
    });
});
