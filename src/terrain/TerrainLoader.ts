// src/terrain/TerrainLoader.ts
import * as THREE from 'three';
import { readATT, type TerrainAttributeData } from './formats/ATTReader';
import { readMAP, type TerrainMappingData } from './formats/MAPReader';
import { readOZB, type OZBData } from './formats/OZBReader';
import { readOBJ, type OBJData } from './formats/OBJReader';
import { buildTerrainGeometry, TERRAIN_SCALE } from './TerrainMesh';
import {
    buildTextureAtlas,
    createTerrainAtlasGeometryMesh,
    createTerrainMaterial,
    type TerrainMaterialMode,
} from './TerrainTexturing';
import { convertOzjToDataUrl } from '../ozj-loader';
import { convertTgaToDataUrl } from '../bmd-loader';
import { logger } from '../utils/Logger';

export interface TerrainResult {
    mesh: THREE.Mesh;
    objectsData: OBJData | null;
    mappingData: TerrainMappingData;
    mapNumber: number;
    terrainAttributeData: TerrainAttributeData;
    heightData: OZBData;
    lightData: OZBData | null;
    textureEntries: TerrainTextureEntry[];
}

export interface TerrainTextureEntry {
    index: number;
    file: File;
}

// Default terrain texture filenames — matches Client.Main TerrainData.GetDefaultTextureMappings().
// Full filenames with extensions so that indices 30-32 correctly load .ozt (alpha) not .ozj.
const DEFAULT_TEXTURE_FILES: Record<number, string> = {
    0: 'TileGrass01.ozj',
    1: 'TileGrass02.ozj',
    2: 'TileGround01.ozj',
    3: 'TileGround02.ozj',
    4: 'TileGround03.ozj',
    5: 'TileWater01.ozj',
    6: 'TileWood01.ozj',
    7: 'TileRock01.ozj',
    8: 'TileRock02.ozj',
    9: 'TileRock03.ozj',
    10: 'TileRock04.ozj',
    11: 'TileRock05.ozj',
    12: 'TileRock06.ozj',
    13: 'TileRock07.ozj',
    30: 'TileGrass01.ozt',
    31: 'TileGrass02.ozt',
    32: 'TileGrass03.ozt',
    100: 'leaf01.ozt',
    101: 'leaf02.ozj',
    102: 'rain01.ozt',
    103: 'rain02.ozt',
    104: 'rain03.ozt',
};

export class TerrainLoader {
    private textureLoader = new THREE.TextureLoader();

    async load(files: Map<string, File>, options?: {
        materialMode?: TerrainMaterialMode;
        textureIndexByFileName?: ReadonlyMap<string, number>;
    }): Promise<TerrainResult> {
        const materialMode = options?.materialMode ?? 'shader';
        // Classify files by type
        const attFile = this.findFile(files, /EncTerrain\d*\.att$/i) ?? this.findFile(files, /\.att$/i);
        const mapFile = this.findFile(files, /EncTerrain\d*\.map$/i) ?? this.findFile(files, /\.map$/i);
        const heightFile = this.findFile(files, /TerrainHeight\.ozb$/i);
        const lightFile = this.findFile(files, /TerrainLight\.ozb$/i);
        const objFile = this.findFile(files, /EncTerrain\d*\.obj$/i) ?? this.findFile(files, /\.obj$/i);

        if (!attFile || !mapFile || !heightFile) {
            throw new Error('Missing required terrain files: .att, .map, and TerrainHeight.OZB');
        }

        // Parse terrain data
        const [attData, mapData, heightData] = await Promise.all([
            attFile.arrayBuffer().then(readATT),
            mapFile.arrayBuffer().then(readMAP),
            heightFile.arrayBuffer().then(readOZB),
        ]);

        // ── DEBUG: MAP data analysis ──
        if (logger.isDebugEnabled()) this.debugMapData(mapData);

        const lightData = lightFile
            ? await lightFile.arrayBuffer().then(readOZB)
            : null;

        const objData = objFile
            ? await objFile.arrayBuffer().then(readOBJ)
            : null;

        // Load terrain textures
        const { textureMap, textureEntries } = await this.loadTerrainTextures(files, mapData, options?.textureIndexByFileName);

        // Build atlas
        const atlas = buildTextureAtlas(textureMap);

        // ── DEBUG: Atlas dump ──
        if (logger.isDebugEnabled()) this.debugAtlas(atlas, textureMap);

        // Build geometry
        const geometry = buildTerrainGeometry(heightData, attData, lightData);

        const mesh = materialMode === 'atlas-geometry'
            ? await createTerrainAtlasGeometryMesh(geometry, attData, atlas, mapData, !!lightData)
            : new THREE.Mesh(geometry, createTerrainMaterial(atlas, mapData, !!lightData, materialMode));

        mesh.name = 'terrain';
        mesh.userData.terrainAtlas = atlas;
        mesh.userData.terrainAtlasOwned = materialMode === 'baked';
        mesh.userData.terrainMaterialMode = materialMode;
        mesh.userData.terrainUseLightmap = !!lightData;
        mesh.userData.terrainSourceGeometry = geometry;

        return {
            mesh,
            objectsData: objData,
            mappingData: mapData,
            mapNumber: mapData.mapNumber,
            terrainAttributeData: attData,
            heightData,
            lightData,
            textureEntries,
        };
    }

    // ── Diagnostic helpers ──

    private debugMapData(mapData: TerrainMappingData) {
        const l1 = new Set<number>();
        const l2 = new Set<number>();
        const alphaStats = { zero: 0, full: 0, partial: 0 };
        for (let i = 0; i < mapData.layer1.length; i++) {
            l1.add(mapData.layer1[i]);
            l2.add(mapData.layer2[i]);
            const a = mapData.alpha[i];
            if (a === 0) alphaStats.zero++;
            else if (a === 255) alphaStats.full++;
            else alphaStats.partial++;
        }
        logger.groupDebug('Terrain MAP data');
        logger.debug('version:', mapData.version, 'mapNumber:', mapData.mapNumber);
        logger.debug('layer1 unique indices:', [...l1].sort((a, b) => a - b));
        logger.debug('layer2 unique indices:', [...l2].sort((a, b) => a - b));
        logger.debug('alpha stats:', alphaStats);
        logger.debug('first 20 layer1 values:', Array.from(mapData.layer1.slice(0, 20)));
        logger.debug('first 20 layer2 values:', Array.from(mapData.layer2.slice(0, 20)));
        logger.debug('first 20 alpha values:', Array.from(mapData.alpha.slice(0, 20)));
        logger.groupEnd();
    }

    private debugAtlas(atlas: ReturnType<typeof buildTextureAtlas>, textureMap: Map<number, THREE.Texture>) {
        logger.groupDebug('Terrain atlas');
        logger.debug('atlas grid:', atlas.cols, 'x', atlas.rows, '=', atlas.count, 'cells');
        logger.debug('cellSize:', atlas.cellSize, 'tileUvScale:', atlas.tileUvScale);
        logger.debug('canvas:', (atlas.texture as any).image?.width, 'x', (atlas.texture as any).image?.height);

        const loaded: string[] = [];
        const missing: number[] = [];
        const allIndices = new Set<number>();
        // Collect all referenced indices
        for (const [idx, tex] of textureMap) {
            const img = tex.image as { width?: number; height?: number } | null;
            loaded.push(`  [${idx}] ${img?.width}x${img?.height}`);
            allIndices.add(idx);
        }
        logger.debug('loaded textures (' + textureMap.size + '):\n' + loaded.join('\n'));
        logger.groupEnd();

    }

    private findFile(files: Map<string, File>, pattern: RegExp): File | undefined {
        for (const [name, file] of files) {
            if (pattern.test(name)) return file;
        }
        return undefined;
    }

    private async loadTerrainTextures(
        files: Map<string, File>,
        mapData: TerrainMappingData,
        textureIndexByFileName?: ReadonlyMap<string, number>,
    ): Promise<{ textureMap: Map<number, THREE.Texture>; textureEntries: TerrainTextureEntry[] }> {
        const textureMap = new Map<number, THREE.Texture>();
        const textureEntries = this.resolveTerrainTextureFiles(files, mapData, textureIndexByFileName);

        // Load every terrain texture present in the selected World folder, not
        // only indices currently referenced by MAP. This keeps newly painted
        // tiles usable when the chosen texture was not used before editing.
        const usedIndices = new Set<number>();
        for (let i = 0; i < mapData.layer1.length; i++) {
            usedIndices.add(mapData.layer1[i]);
            usedIndices.add(mapData.layer2[i]);
        }
        textureEntries.forEach(entry => usedIndices.add(entry.index));

        logger.groupDebug('Terrain texture loading');
        const sortedIndices = [...usedIndices].sort((a, b) => a - b);
        logger.debug('Need textures for indices:', sortedIndices);

        // Try to load each texture
        for (const idx of sortedIndices) {
            const entry = textureEntries.find(candidate => candidate.index === idx);
            const tex = entry ? await this.loadTextureFile(entry.file).catch(error => {
                logger.error(`Terrain texture ${idx} failed to decode: ${entry.file.name}`, error);
                return null;
            }) : null;
            if (tex) {
                textureMap.set(idx, tex);
            } else {
                if (entry) logger.warn(`Terrain texture ${idx} was not found or could not be decoded.`);
            }
        }
        logger.groupEnd();

        return {
            textureMap,
            textureEntries: textureEntries.filter(entry => textureMap.has(entry.index)),
        };
    }

    private resolveTerrainTextureFiles(
        files: Map<string, File>,
        mapData: TerrainMappingData,
        textureIndexByFileName?: ReadonlyMap<string, number>,
    ): TerrainTextureEntry[] {
        const entries = new Map<number, File>();
        for (const [index, filename] of Object.entries(DEFAULT_TEXTURE_FILES)) {
            const file = this.findTextureFile(files, filename);
            if (file) entries.set(Number(index), file);
        }
        for (let index = 14; index <= 29; index++) {
            const extIndex = (index - 13).toString().padStart(2, '0');
            const file = this.findTextureFile(files, `ExtTile${extIndex}.ozj`);
            if (file) entries.set(index, file);
        }
        const usedByMap = new Set<number>([...mapData.layer1, ...mapData.layer2]);
        const reserved = new Set<number>([...entries.keys(), ...usedByMap]);
        const arbitraryFiles = [...files.entries()]
            .filter(([key, file]) => this.isTerrainTextureFile(key, file))
            .map(([, file]) => file)
            .filter(file => ![...entries.values()].includes(file))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        let nextIndex = 0;
        for (const file of arbitraryFiles) {
            const preferredIndex = textureIndexByFileName?.get(file.name.toLowerCase());
            if (
                preferredIndex !== undefined &&
                preferredIndex >= 0 &&
                preferredIndex < 255 &&
                !entries.has(preferredIndex)
            ) {
                entries.set(preferredIndex, file);
                reserved.add(preferredIndex);
                continue;
            }
            while (reserved.has(nextIndex) || nextIndex === 255) nextIndex++;
            if (nextIndex > 254) break;
            entries.set(nextIndex, file);
            reserved.add(nextIndex);
            nextIndex++;
        }

        return [...entries.entries()]
            .map(([index, file]) => ({ index, file }))
            .sort((a, b) => a.index - b.index);
    }

    private isTerrainTextureFile(key: string, file: File): boolean {
        if (!/\.(jpg|jpeg|png|tga|ozj|ozt)$/i.test(file.name)) return false;
        const normalized = key.replace(/\\/g, '/').toLowerCase();
        if (normalized.startsWith('object')) return false;
        return normalized.includes('/textures/') || normalized.split('/').length <= 2;
    }

    private findFileByName(files: Map<string, File>, name: string): File | undefined {
        const lower = name.toLowerCase();
        for (const [key, file] of files) {
            if (key.toLowerCase() === lower || key.toLowerCase().endsWith('/' + lower)) {
                return file;
            }
        }
        return undefined;
    }

    private findTextureFile(files: Map<string, File>, name: string): File | undefined {
        const baseName = name.replace(/\.[^.]+$/, '');
        const extensions = [name.split('.').pop() || '', 'ozj', 'ozt', 'jpg', 'jpeg', 'png', 'tga'];
        for (const extension of extensions) {
            if (!extension) continue;
            const file = this.findFileByName(files, `${baseName}.${extension}`);
            if (file) return file;
        }
        return undefined;
    }

    private async loadTextureFile(file: File): Promise<THREE.Texture> {
        const ext = file.name.split('.').pop()!.toLowerCase();
        let dataUrl: string;

        if (ext === 'ozj' || ext === 'ozt') {
            dataUrl = await convertOzjToDataUrl(await file.arrayBuffer(), ext as 'ozj' | 'ozt');
        } else if (ext === 'tga') {
            dataUrl = await convertTgaToDataUrl(await file.arrayBuffer());
        } else if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') {
            dataUrl = URL.createObjectURL(file);
        } else {
            throw new Error(`Unsupported texture format: ${ext}`);
        }

        try {
            const tex = await this.textureLoader.loadAsync(dataUrl);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            return tex;
        } finally {
            if (dataUrl.startsWith('blob:')) {
                URL.revokeObjectURL(dataUrl);
            }
        }
    }
}
