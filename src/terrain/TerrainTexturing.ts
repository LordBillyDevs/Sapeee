// src/terrain/TerrainTexturing.ts
import * as THREE from 'three';
import { TERRAIN_SIZE, TWFlags, type TerrainAttributeData } from './formats/ATTReader';
import type { TerrainMappingData } from './formats/MAPReader';

// MU terrain samples use a 64x64 texel footprint per tile, regardless of source texture dimensions.
const MU_TILE_TEXEL_SIZE = 64;

export interface TerrainAtlas {
    texture: THREE.Texture;
    cols: number;
    rows: number;
    count: number;
    cellSize: number;
    /** UV repeat scale per tile = 64 / cellSize. Uniform for all textures after tiling. */
    tileUvScale: number;
}

export type TerrainMaterialMode = 'shader' | 'baked' | 'atlas-geometry';
const TERRAIN_BAKED_TEXTURE_SIZE = 4096;

/**
 * Build a texture atlas where every texture is TILED to fill its entire cell.
 *
 * Reference behavior (C# TerrainRenderer):
 *   - Each texture is bound individually with GL_REPEAT wrapping.
 *   - UV per tile = tilePos * (64 / textureWidth).
 *   - A 256px texture repeats every 4 tiles; a 64px texture repeats every 1 tile.
 *
 * Atlas equivalent:
 *   - Each cell is cellSize x cellSize (= max texture dimension).
 *   - Smaller textures are tiled N×N to fill the cell (e.g. 64px → 4×4 in a 256 cell).
 *   - UV per tile = tilePos * (64 / cellSize), UNIFORM for all textures.
 *   - fract() in the shader provides repeating UV within each cell.
 *   - Tiling guarantees that fract() near 0 or 1 samples valid (repeated) content,
 *     NOT empty/transparent pixels — this eliminates the blurriness from bilinear bleed.
 */
export function buildTextureAtlas(textures: Map<number, THREE.Texture>): TerrainAtlas {
    const maxIndex = Math.max(...textures.keys(), 0);
    const count = maxIndex + 1;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);

    // Cell size = largest texture dimension (typically 256).
    let cellSize = MU_TILE_TEXEL_SIZE;
    for (const [, tex] of textures) {
        const img = tex.image as { width?: number; height?: number } | null;
        if (!img) continue;
        const w = img.width ?? MU_TILE_TEXEL_SIZE;
        const h = img.height ?? MU_TILE_TEXEL_SIZE;
        cellSize = Math.max(cellSize, w, h);
    }

    const canvas = document.createElement('canvas');
    canvas.width = cols * cellSize;
    canvas.height = rows * cellSize;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // MAP indices are positional. If a client omits an optional texture file,
    // leave an opaque fallback in that atlas slot instead of exposing the
    // transparent canvas background as a large white terrain region.
    const fallbackTexture = textures.values().next().value as THREE.Texture | undefined;
    const fallbackImage = fallbackTexture?.image as CanvasImageSource | null | undefined;

    for (let idx = 0; idx < count; idx++) {
        if (textures.has(idx) || !fallbackImage) continue;
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const cx = col * cellSize;
        const cy = row * cellSize;
        const fallbackSize = fallbackTexture?.image as { width?: number; height?: number };
        const w = fallbackSize?.width ?? MU_TILE_TEXEL_SIZE;
        const h = fallbackSize?.height ?? MU_TILE_TEXEL_SIZE;
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx, cy, cellSize, cellSize);
        ctx.clip();
        for (let dy = 0; dy < cellSize; dy += h) {
            for (let dx = 0; dx < cellSize; dx += w) {
                ctx.drawImage(fallbackImage, cx + dx, cy + dy);
            }
        }
        ctx.restore();
    }

    for (const [idx, tex] of textures) {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const img = tex.image as CanvasImageSource | null;
        const size = tex.image as { width?: number; height?: number } | null;
        const w = size?.width ?? MU_TILE_TEXEL_SIZE;
        const h = size?.height ?? MU_TILE_TEXEL_SIZE;
        if (img) {
            const cx = col * cellSize;
            const cy = row * cellSize;

            // Tile the texture to fill the entire cell. This is critical:
            // a 64px texture in a 256-cell becomes 4×4 tiled, so fract()-based
            // UV wrapping always samples real texture data, never empty space.
            ctx.save();
            ctx.beginPath();
            ctx.rect(cx, cy, cellSize, cellSize);
            ctx.clip();
            for (let dy = 0; dy < cellSize; dy += h) {
                for (let dx = 0; dx < cellSize; dx += w) {
                    ctx.drawImage(img, cx + dx, cy + dy);
                }
            }
            ctx.restore();
        }
    }

    const atlasTexture = new THREE.CanvasTexture(canvas);
    atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
    atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
    atlasTexture.magFilter = THREE.LinearFilter;
    atlasTexture.minFilter = THREE.LinearFilter;
    atlasTexture.generateMipmaps = false;
    // flipY=false: The atlas canvas has row 0 at the top. Default flipY=true would reverse
    // the row order, making shader row 0 (low UV.y) map to the LAST canvas row instead of
    // the first — scrambling which texture index maps to which atlas cell.
    atlasTexture.flipY = false;
    // NoColorSpace: the reference (C#/XNA) does texture * vertexColor entirely in sRGB/gamma
    // space without any linearization. SRGBColorSpace would cause the GPU to decode to linear,
    // but ShaderMaterial doesn't re-encode on output → wrong brightness (overexposure/washout).
    atlasTexture.colorSpace = THREE.NoColorSpace;

    // With tiling, the UV repeat scale is uniform for ALL textures: 64 / cellSize.
    const tileUvScale = MU_TILE_TEXEL_SIZE / cellSize;

    return { texture: atlasTexture, cols, rows, count, cellSize, tileUvScale };
}

function createMappingTextures(mapping: TerrainMappingData) {
    const S = TERRAIN_SIZE;

    const layer1Tex = new THREE.DataTexture(mapping.layer1, S, S, THREE.RedFormat, THREE.UnsignedByteType);
    layer1Tex.needsUpdate = true;
    layer1Tex.minFilter = THREE.NearestFilter;
    layer1Tex.magFilter = THREE.NearestFilter;
    layer1Tex.wrapS = THREE.ClampToEdgeWrapping;
    layer1Tex.wrapT = THREE.ClampToEdgeWrapping;

    const layer2Tex = new THREE.DataTexture(mapping.layer2, S, S, THREE.RedFormat, THREE.UnsignedByteType);
    layer2Tex.needsUpdate = true;
    layer2Tex.minFilter = THREE.NearestFilter;
    layer2Tex.magFilter = THREE.NearestFilter;
    layer2Tex.wrapS = THREE.ClampToEdgeWrapping;
    layer2Tex.wrapT = THREE.ClampToEdgeWrapping;

    const alphaTex = new THREE.DataTexture(mapping.alpha, S, S, THREE.RedFormat, THREE.UnsignedByteType);
    alphaTex.needsUpdate = true;
    alphaTex.minFilter = THREE.NearestFilter;
    alphaTex.magFilter = THREE.NearestFilter;
    alphaTex.wrapS = THREE.ClampToEdgeWrapping;
    alphaTex.wrapT = THREE.ClampToEdgeWrapping;

    return { layer1Tex, layer2Tex, alphaTex };
}

const vertexShader = /* glsl */ `
varying vec3 vColor;
varying vec2 vWorldXZ;

void main() {
    vColor = color;
    vWorldXZ = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uAtlas;
uniform sampler2D uLayer1;
uniform sampler2D uLayer2;
uniform sampler2D uAlpha;
uniform float uAtlasCols;
uniform float uAtlasRows;
uniform float uAtlasCount;
uniform float uAtlasInset;
uniform float uTerrainSize;
uniform float uTerrainScale;
uniform float uTileUvScale;
uniform bool uUseLightmap;
uniform int uDebugMode; // 0=normal, 1=layer1 index, 2=layer2 index, 3=alpha, 4=atlas UV

varying vec3 vColor;
varying vec2 vWorldXZ;

float sampleMapIndex(sampler2D tex, vec2 tileCoord) {
    vec2 uv = (tileCoord + 0.5) / uTerrainSize;
    return floor(texture2D(tex, uv).r * 255.0 + 0.5);
}

// Convert an index 0..255 to a distinct color for debug visualization
vec3 indexToColor(float idx) {
    float h = mod(idx * 0.618033988749895, 1.0); // golden ratio for distinct hues
    float s = 0.8;
    float v = 0.9;
    // HSV to RGB
    float c = v * s;
    float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
    float m = v - c;
    vec3 rgb;
    float hh = h * 6.0;
    if (hh < 1.0) rgb = vec3(c, x, 0.0);
    else if (hh < 2.0) rgb = vec3(x, c, 0.0);
    else if (hh < 3.0) rgb = vec3(0.0, c, x);
    else if (hh < 4.0) rgb = vec3(0.0, x, c);
    else if (hh < 5.0) rgb = vec3(x, 0.0, c);
    else rgb = vec3(c, 0.0, x);
    return rgb + m;
}

vec4 sampleAtlasTile(float tileIndex, vec2 tileUv) {
    if (tileIndex < 0.0 || tileIndex >= uAtlasCount) {
        return vec4(1.0, 0.0, 1.0, 1.0); // magenta = missing texture
    }

    float col = mod(tileIndex, uAtlasCols);
    float row = floor(tileIndex / uAtlasCols);

    // All textures are tiled to fill the full cell, so UV scale is uniform.
    // fract() provides repeating; tiled content ensures no bleed into empty space.
    vec2 localUv = fract(tileUv * uTileUvScale);

    // Clamp to prevent bilinear filtering from bleeding into adjacent atlas cells.
    localUv = clamp(localUv, vec2(uAtlasInset), vec2(1.0 - uAtlasInset));

    vec2 atlasUv = (vec2(col, row) + localUv) / vec2(uAtlasCols, uAtlasRows);
    return texture2D(uAtlas, atlasUv);
}

void main() {
    vec2 worldTileRaw = vWorldXZ / uTerrainScale;
    // Match terrain/object axis conversion: world Z is mirrored from MU Y.
    vec2 worldTile = vec2(worldTileRaw.x, uTerrainSize - worldTileRaw.y);

    // Offset by a small epsilon before floor() to prevent wrong tile lookup at exact
    // tile boundaries where shared vertices sit (e.g., position exactly at 600.0).
    vec2 tileCoord = floor(worldTile + 0.0002);
    tileCoord = clamp(tileCoord, vec2(0.0), vec2(uTerrainSize - 1.0));
    vec2 fracTile = worldTile - tileCoord;

    vec2 tileCoordX  = min(tileCoord + vec2(1.0, 0.0), vec2(uTerrainSize - 1.0));
    vec2 tileCoordY  = min(tileCoord + vec2(0.0, 1.0), vec2(uTerrainSize - 1.0));
    vec2 tileCoordXY = min(tileCoord + vec2(1.0, 1.0), vec2(uTerrainSize - 1.0));

    float idx1 = sampleMapIndex(uLayer1, tileCoord);
    float idx2 = sampleMapIndex(uLayer2, tileCoord);

    float a1 = sampleMapIndex(uAlpha, tileCoord) / 255.0;
    float a2 = sampleMapIndex(uAlpha, tileCoordX) / 255.0;
    float a3 = sampleMapIndex(uAlpha, tileCoordXY) / 255.0;
    float a4 = sampleMapIndex(uAlpha, tileCoordY) / 255.0;
    float blendAlpha = mix(mix(a1, a2, fracTile.x), mix(a4, a3, fracTile.x), fracTile.y);

    // ── Debug modes ──
    if (uDebugMode == 1) { gl_FragColor = vec4(indexToColor(idx1), 1.0); return; }
    if (uDebugMode == 2) { gl_FragColor = vec4(indexToColor(idx2), 1.0); return; }
    if (uDebugMode == 3) { gl_FragColor = vec4(vec3(blendAlpha), 1.0); return; }
    if (uDebugMode == 4) {
        // Show atlas UV as red/green — useful to see if sampling lands correctly
        float col = mod(idx1, uAtlasCols);
        float row = floor(idx1 / uAtlasCols);
        vec2 localUv = fract(worldTile * uTileUvScale);
        vec2 atlasUv = (vec2(col, row) + localUv) / vec2(uAtlasCols, uAtlasRows);
        gl_FragColor = vec4(atlasUv, 0.0, 1.0); return;
    }

    vec2 tileUv = worldTile;

    bool layer2Valid = (idx2 < 255.0) && (idx2 < uAtlasCount);
    bool isOpaque = a1 >= (254.5 / 255.0) &&
                    a2 >= (254.5 / 255.0) &&
                    a3 >= (254.5 / 255.0) &&
                    a4 >= (254.5 / 255.0);

    vec3 blended;
    if (isOpaque && layer2Valid) {
        blended = sampleAtlasTile(idx2, tileUv).rgb;
    } else {
        blended = sampleAtlasTile(idx1, tileUv).rgb;
        if (blendAlpha > 0.0 && layer2Valid) {
            vec3 overlay = sampleAtlasTile(idx2, tileUv).rgb;
            blended = mix(blended, overlay, blendAlpha);
        }
    }

    if (uUseLightmap) {
        blended *= vColor;
    }

    gl_FragColor = vec4(blended, 1.0);
}
`;

export function createTerrainMaterial(
    atlas: TerrainAtlas,
    mapping: TerrainMappingData,
    useLightmap: boolean,
    mode: TerrainMaterialMode = 'shader',
): THREE.Material {
    if (mode === 'baked') {
        return createTerrainBakedMaterial(atlas, mapping, useLightmap);
    }

    const { layer1Tex, layer2Tex, alphaTex } = createMappingTextures(mapping);
    const inset = 0.5 / atlas.cellSize;

    return new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
            uAtlas: { value: atlas.texture },
            uLayer1: { value: layer1Tex },
            uLayer2: { value: layer2Tex },
            uAlpha: { value: alphaTex },
            uAtlasCols: { value: atlas.cols },
            uAtlasRows: { value: atlas.rows },
            uAtlasCount: { value: atlas.count },
            uAtlasInset: { value: inset },
            uTerrainSize: { value: TERRAIN_SIZE },
            uTerrainScale: { value: 100.0 },
            uTileUvScale: { value: atlas.tileUvScale },
            uUseLightmap: { value: useLightmap },
            uDebugMode: { value: 0 },
        },
        vertexColors: true,
        side: THREE.FrontSide,
    });
}

export async function createTerrainAtlasGeometryMesh(
    sourceGeometry: THREE.BufferGeometry,
    attributes: TerrainAttributeData,
    atlas: TerrainAtlas,
    mapping: TerrainMappingData,
    useLightmap: boolean,
): Promise<THREE.Mesh> {
    const baseGeometry = createTerrainAtlasLayerGeometry(sourceGeometry, attributes, atlas, mapping, 'layer1', useLightmap);
    const baseMaterial = await createTerrainAtlasGeometryMaterial(atlas.texture, false);
    const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
    baseMesh.name = 'terrain';
    baseMesh.userData.minimapGeometry = sourceGeometry;
    baseMesh.userData.tileCount = getVisibleTerrainTileCount(attributes);

    const overlayGeometry = createTerrainAtlasLayerGeometry(sourceGeometry, attributes, atlas, mapping, 'layer2', useLightmap);
    const overlayPosition = overlayGeometry.getAttribute('position');
    if (overlayPosition && overlayPosition.count > 0) {
        const overlayMaterial = await createTerrainAtlasGeometryMaterial(atlas.texture, true);
        const overlayMesh = new THREE.Mesh(overlayGeometry, overlayMaterial);
        overlayMesh.name = 'terrain_overlay';
        overlayMesh.renderOrder = 1;
        baseMesh.add(overlayMesh);
    } else {
        overlayGeometry.dispose();
    }

    return baseMesh;
}

async function createTerrainAtlasGeometryMaterial(map: THREE.Texture, transparent: boolean): Promise<THREE.MeshBasicMaterial> {
    const material = new THREE.MeshBasicMaterial({
        map,
        side: THREE.FrontSide,
        transparent,
        depthWrite: !transparent,
    });
    material.toneMapped = false;

    // The reference terrain shader multiplies texture and lightmap values in gamma/sRGB space.
    // WebGPU node materials output linear working color, so feed linearized gamma-space output.
    const { sRGBTransferEOTF, texture, uv, vec4, vertexColor } = await import('three/tsl');
    const gammaColor = texture(map, uv()).mul(vertexColor());
    (material as THREE.MeshBasicMaterial & { colorNode?: unknown }).colorNode = vec4(
        sRGBTransferEOTF(gammaColor.rgb),
        gammaColor.a,
    );

    return material;
}

function createTerrainAtlasLayerGeometry(
    sourceGeometry: THREE.BufferGeometry,
    attributes: TerrainAttributeData,
    atlas: TerrainAtlas,
    mapping: TerrainMappingData,
    layer: 'layer1' | 'layer2',
    useLightmap: boolean,
): THREE.BufferGeometry {
    const sourcePositions = sourceGeometry.getAttribute('position');
    const sourceNormals = sourceGeometry.getAttribute('normal');
    const sourceColors = sourceGeometry.getAttribute('color');
    if (!sourcePositions || !sourceNormals || !sourceColors) {
        throw new Error('Terrain atlas geometry requires position, normal, and color attributes.');
    }

    const maxTiles = TERRAIN_SIZE * TERRAIN_SIZE;
    const positions = new Float32Array(maxTiles * 4 * 3);
    const normals = new Float32Array(maxTiles * 4 * 3);
    const uvs = new Float32Array(maxTiles * 4 * 2);
    const colors = new Float32Array(maxTiles * 4 * 4);
    const indices = new Uint32Array(maxTiles * 6);

    const layerData = layer === 'layer1' ? mapping.layer1 : mapping.layer2;
    let vertexOffset = 0;
    let indexOffset = 0;

    for (let ty = 0; ty < TERRAIN_SIZE; ty++) {
        for (let tx = 0; tx < TERRAIN_SIZE; tx++) {
            const tileIndex = ty * TERRAIN_SIZE + tx;
            if (attributes.terrainWall[tileIndex] & TWFlags.NoGround) continue;

            const textureIndex = layerData[tileIndex];
            if (!isTerrainTextureIndexRenderable(textureIndex, atlas, layer)) continue;
            if (layer === 'layer2' && !hasAnyOverlayAlpha(mapping, tx, ty)) continue;

            const sourceVertexIndices = getTerrainTileSourceVertexIndices(tx, ty);
            const alphaValues = layer === 'layer2'
                ? getOverlayAlphaValues(mapping, tx, ty)
                : [1, 1, 1, 1];
            const atlasUvs = getTerrainTileAtlasUvs(atlas, textureIndex, tx, ty);

            for (let corner = 0; corner < 4; corner++) {
                const sourceVertexIndex = sourceVertexIndices[corner];
                const dst3 = (vertexOffset + corner) * 3;
                const dst2 = (vertexOffset + corner) * 2;
                const dst4 = (vertexOffset + corner) * 4;

                positions[dst3] = sourcePositions.getX(sourceVertexIndex);
                positions[dst3 + 1] = sourcePositions.getY(sourceVertexIndex);
                positions[dst3 + 2] = sourcePositions.getZ(sourceVertexIndex);

                normals[dst3] = sourceNormals.getX(sourceVertexIndex);
                normals[dst3 + 1] = sourceNormals.getY(sourceVertexIndex);
                normals[dst3 + 2] = sourceNormals.getZ(sourceVertexIndex);

                uvs[dst2] = atlasUvs[corner * 2];
                uvs[dst2 + 1] = atlasUvs[corner * 2 + 1];

                colors[dst4] = useLightmap ? sourceColors.getX(sourceVertexIndex) : 1;
                colors[dst4 + 1] = useLightmap ? sourceColors.getY(sourceVertexIndex) : 1;
                colors[dst4 + 2] = useLightmap ? sourceColors.getZ(sourceVertexIndex) : 1;
                colors[dst4 + 3] = alphaValues[corner];
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
    geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, vertexOffset * 3), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals.slice(0, vertexOffset * 3), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs.slice(0, vertexOffset * 2), 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors.slice(0, vertexOffset * 4), 4));
    geometry.setIndex(new THREE.BufferAttribute(indices.slice(0, indexOffset), 1));
    return geometry;
}

function isTerrainTextureIndexRenderable(textureIndex: number, atlas: TerrainAtlas, layer: 'layer1' | 'layer2'): boolean {
    if (layer === 'layer2' && textureIndex >= 255) return false;
    return textureIndex >= 0 && textureIndex < atlas.count;
}

function hasAnyOverlayAlpha(mapping: TerrainMappingData, tx: number, ty: number): boolean {
    const alpha = getOverlayAlphaValues(mapping, tx, ty);
    return alpha.some(value => value > 0);
}

function getOverlayAlphaValues(mapping: TerrainMappingData, tx: number, ty: number): [number, number, number, number] {
    return [
        sampleMapIndex(mapping.alpha, tx, ty) / 255,
        sampleMapIndex(mapping.alpha, tx + 1, ty) / 255,
        sampleMapIndex(mapping.alpha, tx + 1, ty + 1) / 255,
        sampleMapIndex(mapping.alpha, tx, ty + 1) / 255,
    ];
}

function getVisibleTerrainTileCount(attributes: TerrainAttributeData): number {
    let tileCount = 0;
    for (let i = 0; i < attributes.terrainWall.length; i++) {
        if (!(attributes.terrainWall[i] & TWFlags.NoGround)) tileCount++;
    }
    return tileCount;
}

function getTerrainTileSourceVertexIndices(tx: number, ty: number): [number, number, number, number] {
    const vertexGridSize = TERRAIN_SIZE + 1;
    const v0 = ty * vertexGridSize + tx;
    const v1 = ty * vertexGridSize + tx + 1;
    const v2 = (ty + 1) * vertexGridSize + tx + 1;
    const v3 = (ty + 1) * vertexGridSize + tx;
    return [v0, v1, v2, v3];
}

function getTerrainTileAtlasUvs(atlas: TerrainAtlas, textureIndex: number, tx: number, ty: number): number[] {
    const col = textureIndex % atlas.cols;
    const row = Math.floor(textureIndex / atlas.cols);
    const inset = 0.5 / atlas.cellSize;
    const x0 = getWrappedTileLocalUv(tx, 0, atlas.tileUvScale, inset);
    const x1 = getWrappedTileLocalUv(tx, 1, atlas.tileUvScale, inset);
    const y0 = getWrappedTileLocalUv(ty, 0, atlas.tileUvScale, inset);
    const y1 = getWrappedTileLocalUv(ty, 1, atlas.tileUvScale, inset);

    return [
        (col + x0) / atlas.cols, (row + y0) / atlas.rows,
        (col + x1) / atlas.cols, (row + y0) / atlas.rows,
        (col + x1) / atlas.cols, (row + y1) / atlas.rows,
        (col + x0) / atlas.cols, (row + y1) / atlas.rows,
    ];
}

function getWrappedTileLocalUv(tileCoord: number, cornerOffset: 0 | 1, tileUvScale: number, inset: number): number {
    const scaled = tileCoord * tileUvScale;
    const tileStart = scaled - Math.floor(scaled);
    const local = cornerOffset === 0 ? tileStart : tileStart + tileUvScale;
    const wrapped = local >= 1 - 1e-6 ? 1 : local;
    return Math.min(1 - inset, Math.max(inset, wrapped));
}

function clampIndex(value: number): number {
    return Math.min(TERRAIN_SIZE - 1, Math.max(0, value));
}

function sampleMapIndex(data: Uint8Array, x: number, y: number): number {
    return data[clampIndex(y) * TERRAIN_SIZE + clampIndex(x)];
}

function sampleAtlasBilinear(
    atlasPixels: Uint8ClampedArray,
    atlasWidth: number,
    atlasHeight: number,
    atlas: TerrainAtlas,
    tileIndex: number,
    tileUvX: number,
    tileUvY: number,
): [number, number, number] {
    if (tileIndex < 0 || tileIndex >= atlas.count) {
        return [255, 0, 255];
    }

    const col = tileIndex % atlas.cols;
    const row = Math.floor(tileIndex / atlas.cols);
    const inset = 0.5 / atlas.cellSize;
    const localUvX = Math.min(1 - inset, Math.max(inset, tileUvX - Math.floor(tileUvX)));
    const localUvY = Math.min(1 - inset, Math.max(inset, tileUvY - Math.floor(tileUvY)));
    const atlasU = (col + localUvX) / atlas.cols;
    const atlasV = (row + localUvY) / atlas.rows;

    // Bilinear: compute fractional pixel coordinates and sample 4 neighbors
    const px = atlasU * atlasWidth - 0.5;
    const py = atlasV * atlasHeight - 0.5;
    const x0 = Math.max(0, Math.min(atlasWidth - 1, Math.floor(px)));
    const y0 = Math.max(0, Math.min(atlasHeight - 1, Math.floor(py)));
    const x1 = Math.min(atlasWidth - 1, x0 + 1);
    const y1 = Math.min(atlasHeight - 1, y0 + 1);
    const fx = px - Math.floor(px);
    const fy = py - Math.floor(py);

    const o00 = (y0 * atlasWidth + x0) * 4;
    const o10 = (y0 * atlasWidth + x1) * 4;
    const o01 = (y1 * atlasWidth + x0) * 4;
    const o11 = (y1 * atlasWidth + x1) * 4;

    const r = (atlasPixels[o00] * (1 - fx) * (1 - fy) + atlasPixels[o10] * fx * (1 - fy) +
               atlasPixels[o01] * (1 - fx) * fy + atlasPixels[o11] * fx * fy);
    const g = (atlasPixels[o00 + 1] * (1 - fx) * (1 - fy) + atlasPixels[o10 + 1] * fx * (1 - fy) +
               atlasPixels[o01 + 1] * (1 - fx) * fy + atlasPixels[o11 + 1] * fx * fy);
    const b = (atlasPixels[o00 + 2] * (1 - fx) * (1 - fy) + atlasPixels[o10 + 2] * fx * (1 - fy) +
               atlasPixels[o01 + 2] * (1 - fx) * fy + atlasPixels[o11 + 2] * fx * fy);

    return [Math.round(r), Math.round(g), Math.round(b)];
}

function createTerrainBakedMaterial(
    atlas: TerrainAtlas,
    mapping: TerrainMappingData,
    useLightmap: boolean,
): THREE.Material {
    const atlasCanvas = atlas.texture.image as HTMLCanvasElement | OffscreenCanvas | undefined;
    if (!atlasCanvas || !('getContext' in atlasCanvas)) {
        return new THREE.MeshBasicMaterial({
            color: 0x7c8b5b,
            vertexColors: useLightmap,
            side: THREE.FrontSide,
        });
    }

    const atlasContext = atlasCanvas.getContext('2d', { willReadFrequently: true });
    if (!atlasContext) {
        return new THREE.MeshBasicMaterial({
            color: 0x7c8b5b,
            vertexColors: useLightmap,
            side: THREE.FrontSide,
        });
    }

    const atlasWidth = (atlasCanvas as HTMLCanvasElement).width;
    const atlasHeight = (atlasCanvas as HTMLCanvasElement).height;
    const atlasPixels = atlasContext.getImageData(0, 0, atlasWidth, atlasHeight).data;

    const bakedCanvas = document.createElement('canvas');
    bakedCanvas.width = TERRAIN_BAKED_TEXTURE_SIZE;
    bakedCanvas.height = TERRAIN_BAKED_TEXTURE_SIZE;
    const bakedContext = bakedCanvas.getContext('2d');
    if (!bakedContext) {
        return new THREE.MeshBasicMaterial({
            color: 0x7c8b5b,
            vertexColors: useLightmap,
            side: THREE.FrontSide,
        });
    }

    const bakedImage = bakedContext.createImageData(TERRAIN_BAKED_TEXTURE_SIZE, TERRAIN_BAKED_TEXTURE_SIZE);
    const bakedPixels = bakedImage.data;
    const tileUvScale = atlas.tileUvScale;

    for (let y = 0; y < TERRAIN_BAKED_TEXTURE_SIZE; y++) {
        const worldTileY = ((y + 0.5) / TERRAIN_BAKED_TEXTURE_SIZE) * TERRAIN_SIZE;
        const tileY = clampIndex(Math.floor(worldTileY + 0.0002));
        const fracY = worldTileY - tileY;
        const tileY1 = clampIndex(tileY + 1);

        for (let x = 0; x < TERRAIN_BAKED_TEXTURE_SIZE; x++) {
            const worldTileX = ((x + 0.5) / TERRAIN_BAKED_TEXTURE_SIZE) * TERRAIN_SIZE;
            const tileX = clampIndex(Math.floor(worldTileX + 0.0002));
            const fracX = worldTileX - tileX;
            const tileX1 = clampIndex(tileX + 1);

            const idx1 = sampleMapIndex(mapping.layer1, tileX, tileY);
            const idx2 = sampleMapIndex(mapping.layer2, tileX, tileY);

            const a1 = sampleMapIndex(mapping.alpha, tileX, tileY) / 255;
            const a2 = sampleMapIndex(mapping.alpha, tileX1, tileY) / 255;
            const a3 = sampleMapIndex(mapping.alpha, tileX1, tileY1) / 255;
            const a4 = sampleMapIndex(mapping.alpha, tileX, tileY1) / 255;
            const blendAlpha = THREE.MathUtils.lerp(
                THREE.MathUtils.lerp(a1, a2, fracX),
                THREE.MathUtils.lerp(a4, a3, fracX),
                fracY,
            );

            const tileUvX = worldTileX * tileUvScale;
            const tileUvY = worldTileY * tileUvScale;
            const base = sampleAtlasBilinear(atlasPixels, atlasWidth, atlasHeight, atlas, idx1, tileUvX, tileUvY);
            let r = base[0];
            let g = base[1];
            let b = base[2];

            const layer2Valid = idx2 < 255 && idx2 < atlas.count;
            const isOpaque = a1 >= (254.5 / 255) && a2 >= (254.5 / 255) && a3 >= (254.5 / 255) && a4 >= (254.5 / 255);
            if (isOpaque && layer2Valid) {
                [r, g, b] = sampleAtlasBilinear(atlasPixels, atlasWidth, atlasHeight, atlas, idx2, tileUvX, tileUvY);
            } else if (blendAlpha > 0 && layer2Valid) {
                const overlay = sampleAtlasBilinear(atlasPixels, atlasWidth, atlasHeight, atlas, idx2, tileUvX, tileUvY);
                r = Math.round(THREE.MathUtils.lerp(r, overlay[0], blendAlpha));
                g = Math.round(THREE.MathUtils.lerp(g, overlay[1], blendAlpha));
                b = Math.round(THREE.MathUtils.lerp(b, overlay[2], blendAlpha));
            }

            const offset = (y * TERRAIN_BAKED_TEXTURE_SIZE + x) * 4;
            bakedPixels[offset] = r;
            bakedPixels[offset + 1] = g;
            bakedPixels[offset + 2] = b;
            bakedPixels[offset + 3] = 255;
        }
    }

    bakedContext.putImageData(bakedImage, 0, 0);

    const bakedTexture = new THREE.CanvasTexture(bakedCanvas);
    bakedTexture.colorSpace = THREE.NoColorSpace;
    bakedTexture.wrapS = THREE.ClampToEdgeWrapping;
    bakedTexture.wrapT = THREE.ClampToEdgeWrapping;
    bakedTexture.magFilter = THREE.LinearFilter;
    bakedTexture.minFilter = THREE.LinearFilter;
    bakedTexture.generateMipmaps = false;
    bakedTexture.flipY = false;
    bakedTexture.needsUpdate = true;

    return new THREE.MeshBasicMaterial({
        map: bakedTexture,
        vertexColors: useLightmap,
        side: THREE.FrontSide,
    });
}
