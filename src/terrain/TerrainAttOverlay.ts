import * as THREE from 'three';
import { TERRAIN_SIZE, TWFlags, type TerrainAttributeData } from './formats/ATTReader';
import { getAttFlagColor } from '../att-inspector/AttInspector';
import { TERRAIN_ATTRIBUTE_FLAG_DEFINITIONS } from './TerrainAttributeSummary';

export const ATT_OVERLAY_HEIGHT_OFFSET = 8;

export function createTerrainAttOverlayGeometry(
    attData: TerrainAttributeData,
    sourceGeometry: THREE.BufferGeometry,
    heightOffset: number = ATT_OVERLAY_HEIGHT_OFFSET,
    includeNormalTiles: boolean = false,
    customColors: ReadonlyMap<number, readonly [number, number, number]> | null = null,
): THREE.BufferGeometry {
    const sourcePositions = sourceGeometry.getAttribute('position');
    if (!sourcePositions) {
        return new THREE.BufferGeometry();
    }

    const activeTileCount = includeNormalTiles
        ? TERRAIN_SIZE * TERRAIN_SIZE
        : countActiveTerrainAttributeTiles(attData);
    if (activeTileCount === 0) {
        return createEmptyOverlayGeometry();
    }

    const positions = new Float32Array(activeTileCount * 4 * 3);
    const colors = new Float32Array(activeTileCount * 4 * 4);
    const indices = new Uint32Array(activeTileCount * 6);
    let vertexOffset = 0;
    let indexOffset = 0;

    for (let ty = 0; ty < TERRAIN_SIZE; ty++) {
        for (let tx = 0; tx < TERRAIN_SIZE; tx++) {
            const tileIndex = ty * TERRAIN_SIZE + tx;
            const flag = attData.terrainWall[tileIndex] as TWFlags;
            if (!includeNormalTiles && flag === TWFlags.None) continue;
            const color = getBlendedAttFlagColor(flag, customColors);
            const sourceVertexIndices = getTerrainTileSourceVertexIndices(tx, ty);

            for (let corner = 0; corner < 4; corner++) {
                const sourceVertexIndex = sourceVertexIndices[corner];
                const dst3 = (vertexOffset + corner) * 3;
                const dst4 = (vertexOffset + corner) * 4;

                positions[dst3] = sourcePositions.getX(sourceVertexIndex);
                positions[dst3 + 1] = sourcePositions.getY(sourceVertexIndex) + heightOffset;
                positions[dst3 + 2] = sourcePositions.getZ(sourceVertexIndex);

                colors[dst4] = color[0] / 255;
                colors[dst4 + 1] = color[1] / 255;
                colors[dst4 + 2] = color[2] / 255;
                colors[dst4 + 3] = 1;
            }

            indices[indexOffset] = vertexOffset;
            indices[indexOffset + 1] = vertexOffset + 1;
            indices[indexOffset + 2] = vertexOffset + 3;
            indices[indexOffset + 3] = vertexOffset + 1;
            indices[indexOffset + 4] = vertexOffset + 2;
            indices[indexOffset + 5] = vertexOffset + 3;

            vertexOffset += 4;
            indexOffset += 6;
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    return geometry;
}

function countActiveTerrainAttributeTiles(attData: TerrainAttributeData): number {
    let count = 0;
    for (const flag of attData.terrainWall) {
        if (flag !== TWFlags.None) count++;
    }
    return count;
}

function createEmptyOverlayGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 4));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
    return geometry;
}

function getBlendedAttFlagColor(
    flag: TWFlags,
    customColors: ReadonlyMap<number, readonly [number, number, number]> | null = null,
): readonly [number, number, number] {
    if (flag === TWFlags.None) {
        return [72, 108, 146];
    }

    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;

    for (const definition of TERRAIN_ATTRIBUTE_FLAG_DEFINITIONS) {
        if ((flag & definition.flag) === 0) continue;
        const color = customColors?.get(definition.flag) || getAttFlagColor(definition.flag);
        r += color[0];
        g += color[1];
        b += color[2];
        count++;
    }

    return count > 0
        ? [Math.round(r / count), Math.round(g / count), Math.round(b / count)]
        : getAttFlagColor(flag);
}

function getTerrainTileSourceVertexIndices(tx: number, ty: number): [number, number, number, number] {
    const vertexGridSize = TERRAIN_SIZE + 1;
    const v0 = ty * vertexGridSize + tx;
    const v1 = ty * vertexGridSize + tx + 1;
    const v2 = (ty + 1) * vertexGridSize + tx + 1;
    const v3 = (ty + 1) * vertexGridSize + tx;
    return [v0, v1, v2, v3];
}

export class TerrainAttOverlay {
    private scene: THREE.Scene;
    private mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
    private visible: boolean = false;
    private customColors = new Map<number, readonly [number, number, number]>();

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.initializeMesh();
    }

    private initializeMesh(): void {
        const geometry = createEmptyOverlayGeometry();

        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.68,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.renderOrder = 2;
        this.mesh.visible = false;
        this.mesh.frustumCulled = false;
    }

    public setData(attData: TerrainAttributeData | null, terrainGeometry: THREE.BufferGeometry | null = null): void {
        if (!this.mesh) {
            return;
        }

        const previousGeometry = this.mesh.geometry;
        if (!attData) {
            this.mesh.geometry = createEmptyOverlayGeometry();
            previousGeometry.dispose();
            return;
        }

        if (!terrainGeometry) {
            this.mesh.geometry = createEmptyOverlayGeometry();
            previousGeometry.dispose();
            return;
        }

        this.mesh.geometry = createTerrainAttOverlayGeometry(attData, terrainGeometry, ATT_OVERLAY_HEIGHT_OFFSET, true, this.customColors);
        this.mesh.visible = this.visible;
        previousGeometry.dispose();
    }

    public setCustomColors(colors: ReadonlyMap<number, readonly [number, number, number]>): void {
        this.customColors = new Map(colors);
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
        if (this.mesh) {
            this.mesh.visible = visible;
        }
    }

    public isVisible(): boolean {
        return this.visible;
    }

    public getWorldMesh(): THREE.Mesh | null {
        return this.mesh;
    }

    public dispose(): void {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            const geometry = this.mesh.geometry as THREE.BufferGeometry;
            geometry?.dispose();
            const material = this.mesh.material as THREE.Material | THREE.Material[];
            if (Array.isArray(material)) {
                material.forEach(m => m.dispose());
            } else {
                material?.dispose();
            }
        }
    }
}
