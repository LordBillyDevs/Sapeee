export interface MapAttribute {
    mapNumber: number;
    fileName: string;
    name: string;
}

const FALLBACK_MAP_NAMES: Record<number, string> = {
    0: 'Lorencia',
    1: 'Dungeon',
    2: 'Devias',
    3: 'Noria',
    4: 'Lost Tower',
    5: 'Atlans',
    6: 'Tarkan',
    7: 'Icarus',
    8: 'Aida',
    9: 'Crywolf',
    10: 'Kanturu',
    11: 'Kanturu Ruins',
    12: 'Kalima',
};

export function parseMapAttributeXml(xml: string): MapAttribute[] {
    if (typeof DOMParser === 'undefined') {
        const entries: MapAttribute[] = [];
        const pattern = /<(Map|MapAttribute|World)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1\s*>)/gi;
        for (const match of xml.matchAll(pattern)) {
            const attributes = match[2] || '';
            const body = match[3] || '';
            const read = (name: string): string =>
                attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]
                ?? body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1]?.trim()
                ?? '';
            const mapNumber = Number(read('MapNumber'));
            const name = read('Name');
            if (Number.isInteger(mapNumber) && name) entries.push({ mapNumber, fileName: read('FileName'), name });
        }
        return entries;
    }
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    return Array.from(document.getElementsByTagName('*'))
        .map(element => {
            const child = (name: string): string => element.getElementsByTagName(name)[0]?.textContent?.trim() ?? '';
            return {
                mapNumber: Number(element.getAttribute('MapNumber') ?? element.getAttribute('mapNumber') ?? child('MapNumber')),
                fileName: element.getAttribute('FileName') ?? element.getAttribute('fileName') ?? child('FileName'),
                name: element.getAttribute('Name') ?? element.getAttribute('name') ?? child('Name'),
            };
        })
        .filter(entry => Number.isInteger(entry.mapNumber) && entry.mapNumber >= 0 && entry.name.length > 0);
}

export function clientWorldNumber(serverWorldNumber: number): number {
    return Math.max(0, Math.trunc(serverWorldNumber) - 1);
}

export function serverWorldNumber(clientMapNumber: number): number {
    return Math.max(1, Math.trunc(clientMapNumber) + 1);
}

export function getFriendlyMapName(serverWorld: number, attributes: readonly MapAttribute[] = []): string {
    const clientNumber = clientWorldNumber(serverWorld);
    const byNumber = attributes.find(entry => entry.mapNumber === clientNumber);
    if (byNumber?.name) return byNumber.name;
    const byFile = attributes.find(entry => /world/i.test(entry.fileName) && Number(entry.fileName.match(/\d+/)?.[0]) === serverWorld);
    return byFile?.name ?? FALLBACK_MAP_NAMES[clientNumber] ?? `World ${serverWorld}`;
}

export async function loadMapAttributes(url = '/MapAttribute.xml'): Promise<MapAttribute[]> {
    try {
        const response = await fetch(url);
        if (!response.ok) return [];
        return parseMapAttributeXml(await response.text());
    } catch {
        return [];
    }
}
