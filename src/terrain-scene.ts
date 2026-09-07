// src/terrain-scene.ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls, type TransformControlsMode } from 'three/examples/jsm/controls/TransformControls.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ExplorerBookmark, ExplorerVector3, SelectedWorldObjectRef, TerrainSessionState } from './explorer-types';
import { createId } from './explorer-store';
import { TerrainLoader } from './terrain/TerrainLoader';
import { Disposer } from './utils/Disposer';
import { TerrainAttOverlay } from './terrain/TerrainAttOverlay';
import {
    loadTerrainObjects,
    loadTerrainObjectPreview,
    mapObjectAngleToVisualQuaternion,
    type TerrainAnimatedObjectInstance,
    type TerrainObjectLoadResult,
    type TerrainObjectSelectionRecord,
    visualQuaternionToMapObjectAngle,
} from './terrain/TerrainObjects';
import {
    TerrainObjectCullingIndex,
    getTerrainObjectDrawRangeSphere,
} from './terrain/TerrainObjectCulling';
import {
    getTerrainAnimatedInstancingModeForBackend,
    TERRAIN_OBJECT_INSTANCE_CHUNK_WORLD_SIZE,
} from './terrain/TerrainObjectInstancing';
import { collectTerrainObjectWarmupTextures } from './terrain/TerrainObjectWarmup';
import { updateTerrainObjectSelectionBox } from './terrain/TerrainObjectSelectionBounds';
import {
    buildHeightMinimapRaster,
    createWorldObjectId,
    minimapPointToWorld,
    worldToMinimapPoint,
} from './terrain/TerrainExplorerUtils';
import {
    TERRAIN_ATTRIBUTE_FLAG_DEFINITIONS,
    formatTerrainAttributeFlagHex,
    summarizeTerrainAttributeData,
    type TerrainAttributeFlagSummary,
    type TerrainAttributeSummary,
} from './terrain/TerrainAttributeSummary';
import { buildTerrainGeometry, TERRAIN_SCALE, TERRAIN_WORLD_SIZE } from './terrain/TerrainMesh';
import { TERRAIN_SIZE, TWFlags, writeATT, writeServerATT } from './terrain/formats/ATTReader';
import { readOZB } from './terrain/formats/OZBReader';
import { writeOBJ } from './terrain/formats/OBJWriter';
import { writeMAP, type TerrainMappingData } from './terrain/formats/MAPReader';
import { readOBJ, type OBJData, type MapObject } from './terrain/formats/OBJReader';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { convertOzjToDataUrl } from './ozj-loader';
import { BMDLoader } from './bmd-loader';
import { parseItemBmd, type ItemDefinition } from './item-bmd';
import { resolveAttachmentBoneByBmdIndex } from './utils/CharacterAttachmentBones';
import {
    createFileFromElectronData,
    isElectron,
    openDirectoryDialog,
    readFileFromPath,
    readTerrainObjectOverrides,
    readTerrainWorldFiles,
    readTerrainPlayerFiles,
    readDataFileFromRoot,
    searchTextures,
    scanWorldFolders,
    writeFileInDirectory,
    writeTerrainObjectOverrides,
} from './electron-helper';
import {
    createEmptyTerrainObjectOverrides,
    normalizeTerrainObjectOverrides,
    removeTerrainObjectTransformOverride,
    removeTerrainObjectTypeOverride,
    TERRAIN_OBJECT_BLEND_MODE_NAMES,
    type TerrainObjectBlendModeName,
    type TerrainObjectMaterialOverride,
    type TerrainObjectOverridesFile,
    upsertTerrainObjectTransformOverride,
    upsertTerrainObjectTypeOverride,
} from './terrain/TerrainObjectOverrides';
import {
    createPreferredRenderer,
    getActiveRendererBackend,
    isWebGLRenderer,
    type RendererBackendActive as SharedRendererBackendActive,
    type SupportedRenderer,
} from './rendering/RendererBackend';

const TERRAIN_TEXTURE_INDEX_BY_NAME: Record<string, number> = {
    tilegrass01: 0, tilegrass02: 1, tileground01: 2, tileground02: 3, tileground03: 4,
    tilewater01: 5, tilewood01: 6, tilerock01: 7, tilerock02: 8, tilerock03: 9,
    tilerock04: 10, tilerock05: 11, tilerock06: 12, tilerock07: 13,
    tilegrass03: 32, leaf01: 100, leaf02: 101, rain01: 102, rain02: 103, rain03: 104,
};

const TERRAIN_BASE_AMBIENT_INTENSITY = 0.6;
const TERRAIN_BASE_SUN_INTENSITY = 1.0;
const TERRAIN_MAX_PIXEL_RATIO = 1.5;
const TERRAIN_BRIGHTNESS_DEFAULT = 1.5;
const TERRAIN_OBJECT_DRAW_DISTANCE_DEFAULT = 6000;
const TERRAIN_OBJECT_ANIM_DISTANCE_RATIO = 0.55;
const TERRAIN_OBJECT_CULL_INTERVAL_MS = 120;
const TERRAIN_CAMERA_MOVE_SPEED = 7000;
const TERRAIN_CAMERA_SPRINT_MULTIPLIER = 2.2;
const TERRAIN_MAX_DELTA_SECONDS = 0.1;
const CHARACTER_PLAY_ANIMATION_SPEED = 0.5;
type TerrainRendererBackendPreference = TerrainSessionState['rendererBackend'];
type TerrainRendererBackendActive = SharedRendererBackendActive;
type TerrainMaterialBinding = {
    key: string;
    label: string;
    materials: THREE.Material[];
};
type TerrainObjectWarmupRenderer = SupportedRenderer & {
    initTexture?: (texture: THREE.Texture) => void;
    compile?: (scene: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Scene | null) => unknown;
    compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Scene | null) => Promise<unknown>;
};

const TERRAIN_OBJECT_BLEND_MODE_TO_THREE: Record<TerrainObjectBlendModeName, THREE.Blending> = {
    Opaque: THREE.NoBlending,
    Normal: THREE.NormalBlending,
    Additive: THREE.AdditiveBlending,
    Multiply: THREE.MultiplyBlending,
    Subtractive: THREE.SubtractiveBlending,
};
const TERRAIN_THREE_BLEND_TO_OBJECT_MODE = new Map<THREE.Blending, TerrainObjectBlendModeName>(
    Object.entries(TERRAIN_OBJECT_BLEND_MODE_TO_THREE).map(([name, value]) => [
        value,
        name as TerrainObjectBlendModeName,
    ]),
);

type MovementKeyCode = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'ShiftLeft' | 'ShiftRight';
const MOVEMENT_KEYS: readonly MovementKeyCode[] = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'];
type TerrainEditSnapshot = {
    att: Uint16Array | null;
    height: Uint8Array | null;
    light: Uint8Array | null;
    layer1: Uint8Array | null;
    layer2: Uint8Array | null;
    alpha: Uint8Array | null;
};

export class TerrainScene {
    public onObjectSelected?: (selection: SelectedWorldObjectRef | null) => void;
    public onCameraChanged?: (cameraPosition: ExplorerVector3, cameraTarget: ExplorerVector3) => void;
    public onWorldLoaded?: (worldNumber: number, availableWorldNumbers: number[]) => void;
    public onBookmarkCreated?: (bookmark: ExplorerBookmark) => void;
    public onOpenModelRequest?: (selection: SelectedWorldObjectRef, modelFile: File | null) => void;
    public onStateChanged?: (state: TerrainSessionState) => void;
    public onAttDataChanged?: (data: import('./terrain/formats/ATTReader').TerrainAttributeData | null, worldNumber: number | null) => void;

    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: SupportedRenderer;
    private controls!: OrbitControls;
    private transformControls: TransformControls | null = null;
    private transformControlsHelper: THREE.Object3D | null = null;
    private readonly transformProxy = new THREE.Object3D();
    private transformControlMode: TransformControlsMode = 'translate';
    private transformControlPointerActive = false;
    private applyingTransformControlChange = false;
    private timer = new THREE.Timer();
    private isActive = false;
    private animationFrameHandle: number | null = null;
    private rendererBackendPreference: TerrainRendererBackendPreference = 'auto';
    private rendererActiveBackend: TerrainRendererBackendActive = 'webgl';
    private rendererReady = false;
    private rendererSwapToken = 0;
    private worldLoadToken = 0;
    private containerEl: HTMLElement | null = null;
    private ambientLight: THREE.AmbientLight | null = null;
    private sunLight: THREE.DirectionalLight | null = null;
    private objectDrawDistance = TERRAIN_OBJECT_DRAW_DISTANCE_DEFAULT;
    private objectCullLastUpdateMs = 0;
    private readonly objectCullingIndex = new TerrainObjectCullingIndex();
    private readonly tempCullCenter = new THREE.Vector3();
    private readonly tempCullScale = new THREE.Vector3();
    private readonly frustum = new THREE.Frustum();
    private readonly projScreenMatrix = new THREE.Matrix4();
    private readonly tempBoundingSphere = new THREE.Sphere();
    private readonly movementKeys: Record<MovementKeyCode, boolean> = {
        KeyW: false,
        KeyA: false,
        KeyS: false,
        KeyD: false,
        ShiftLeft: false,
        ShiftRight: false,
    };
    private readonly tempMoveForward = new THREE.Vector3();
    private readonly tempMoveRight = new THREE.Vector3();
    private readonly tempMoveDelta = new THREE.Vector3();
    private readonly tempFocusOffset = new THREE.Vector3();
    private readonly raycaster = new THREE.Raycaster();
    private readonly pointer = new THREE.Vector2();

    private terrainMesh: THREE.Mesh | null = null;
    private terrainAttOverlay: TerrainAttOverlay | null = null;
    private objectsGroup: THREE.Group | null = null;
    private terrainLoader = new TerrainLoader();
    private objectRecords: TerrainObjectSelectionRecord[] = [];
    private animatedObjectInstances: TerrainAnimatedObjectInstance[] = [];
    private selectedObjectRecord: TerrainObjectSelectionRecord | null = null;
    private isolatedObjectRecord: TerrainObjectSelectionRecord | null = null;
    private selectionMarker: THREE.Mesh | null = null;
    private selectionBoundingBox = new THREE.Box3();
    private selectionBoundingBoxHelper: THREE.Box3Helper | null = null;
    private minimapCanvas: HTMLCanvasElement | null = null;
    private minimapContext: CanvasRenderingContext2D | null = null;
    private minimapSourceCanvas: HTMLCanvasElement | null = null;
    private minimapNeedsRedraw = true;
    private pointerDown: { x: number; y: number } | null = null;
    private presentationMode = false;
    private pendingRestoreState: TerrainSessionState | null = null;
    private availableWorldNumbers: number[] = [];
    private loadedWorldNumber: number | null = null;
    private loadedAttData: import('./terrain/formats/ATTReader').TerrainAttributeData | null = null;
    private loadedHeightData: import('./terrain/formats/OZBReader').OZBData | null = null;
    private loadedLightData: import('./terrain/formats/OZBReader').OZBData | null = null;
    private loadedObjectsData: OBJData | null = null;
    private loadedMapData: TerrainMappingData | null = null;
    private loadedObjFileName: string | null = null;
    private loadedMapFileName: string | null = null;
    private readonly duplicateObjectData = new Map<string, MapObject>();
    private currentWorldFiles = new Map<string, File>();
    private cameraChangeHandle: number | null = null;
    private animationsEnabled = true;

    /** Persistent store of all files from the Data folder (browser mode). */
    private dataFiles = new Map<string, File>();
    /** Root path to Data folder (Electron mode). */
    private dataRootPath: string | null = null;

    private statusEl: HTMLElement | null = null;
    private worldSelectEl: HTMLSelectElement | null = null;
    private rendererBackendSelectEl: HTMLSelectElement | null = null;
    private rendererBackendStatusEl: HTMLElement | null = null;
    private wireframeEl: HTMLInputElement | null = null;
    private showObjectsEl: HTMLInputElement | null = null;
    private animationsEnabledEl: HTMLInputElement | null = null;
    private sunEnabledEl: HTMLInputElement | null = null;
    private terrainLightColorEl: HTMLInputElement | null = null;
    private terrainLightIntensityEl: HTMLInputElement | null = null;
    private brightnessSliderEl: HTMLInputElement | null = null;
    private brightnessLabelEl: HTMLElement | null = null;
    private objectDistanceSliderEl: HTMLInputElement | null = null;
    private objectDistanceLabelEl: HTMLElement | null = null;
    private jumpXEl: HTMLInputElement | null = null;
    private jumpZEl: HTMLInputElement | null = null;
    private bookmarkNameEl: HTMLInputElement | null = null;
    private bookmarkStatusEl: HTMLElement | null = null;
    private objectDetailsEl: HTMLElement | null = null;
    private objectEmptyEl: HTMLElement | null = null;
    private objectWorldEl: HTMLElement | null = null;
    private objectTypeEl: HTMLElement | null = null;
    private objectModelEl: HTMLElement | null = null;
    private objectPositionEl: HTMLElement | null = null;
    private objectRotationEl: HTMLElement | null = null;
    private objectScaleEl: HTMLElement | null = null;
    private objectCopyXEl: HTMLInputElement | null = null;
    private objectCopyYEl: HTMLInputElement | null = null;
    private objectCopyZEl: HTMLInputElement | null = null;
    private openModelBtn: HTMLButtonElement | null = null;
    private openModelHintEl: HTMLElement | null = null;
    private objectEditorPanelEl: HTMLElement | null = null;
    private objectEditorTitleEl: HTMLElement | null = null;
    private objectEditorMetaEl: HTMLElement | null = null;
    private objectEditorCloseBtn: HTMLButtonElement | null = null;
    private objectEditorPosXEl: HTMLInputElement | null = null;
    private objectEditorPosYEl: HTMLInputElement | null = null;
    private objectEditorPosZEl: HTMLInputElement | null = null;
    private objectEditorScaleEl: HTMLInputElement | null = null;
    private objectEditorApplyTransformBtn: HTMLButtonElement | null = null;
    private objectEditorMaterialsEl: HTMLElement | null = null;
    private objectEditorSaveBtn: HTMLButtonElement | null = null;
    private objectEditorExportBtn: HTMLButtonElement | null = null;
    private objectEditorResetBtn: HTMLButtonElement | null = null;
    private objectEditorStatusEl: HTMLElement | null = null;
    private removeObjectBtn: HTMLButtonElement | null = null;
    private objectPreviewCanvas: HTMLCanvasElement | null = null;
    private objectPreviewRenderer: THREE.WebGLRenderer | null = null;
    private objectPreviewScene: THREE.Scene | null = null;
    private objectPreviewCamera: THREE.PerspectiveCamera | null = null;
    private objectPreviewControls: OrbitControls | null = null;
    private objectPreviewObject: THREE.Object3D | null = null;
    private objectTransformGizmoControlsEl: HTMLElement | null = null;
    private transformModeButtons: HTMLButtonElement[] = [];
    private lastContextEl: HTMLElement | null = null;
    private tileCountEl: HTMLElement | null = null;
    private objectCountEl: HTMLElement | null = null;
    private terrainAttributeStatusEl: HTMLElement | null = null;
    private terrainAttributeVersionEl: HTMLElement | null = null;
    private terrainAttributeIndexEl: HTMLElement | null = null;
    private terrainAttributeDimensionsEl: HTMLElement | null = null;
    private terrainAttributeFormatEl: HTMLElement | null = null;
    private terrainAttributeTilesEl: HTMLElement | null = null;
    private terrainAttributeOccupiedEl: HTMLElement | null = null;
    private terrainAttributeLegendEl: HTMLElement | null = null;
    private attOverlayToggleBtn: HTMLButtonElement | null = null;
    private objectOverrides: TerrainObjectOverridesFile = createEmptyTerrainObjectOverrides();
    private objectOverridesPath: string | null = null;
    private terrainTileXEl: HTMLInputElement | null = null;
    private terrainTileZEl: HTMLInputElement | null = null;
    private terrainLayer1El: HTMLSelectElement | null = null;
    private terrainLayer2El: HTMLSelectElement | null = null;
    private terrainTexturePaletteEl: HTMLElement | null = null;
    private terrainAlphaEl: HTMLInputElement | null = null;
    private terrainTileStatusEl: HTMLElement | null = null;
    private terrainObjectSelectEl: HTMLSelectElement | null = null;
    private terrainObjectImportInputEl: HTMLInputElement | null = null;
    private terrainImportPreviewSelectEl: HTMLSelectElement | null = null;
    private attTileXEl: HTMLInputElement | null = null;
    private attTileZEl: HTMLInputElement | null = null;
    private attFlagEls = new Map<TWFlags, HTMLInputElement>();
    private attEditorStatusEl: HTMLElement | null = null;
    private attBrushEnabledEl: HTMLInputElement | null = null;
    private attBrushSizeEl: HTMLInputElement | null = null;
    private attBrushSizeValueEl: HTMLElement | null = null;
    private terrainHeightEnabledEl: HTMLInputElement | null = null;
    private terrainHeightStrengthEl: HTMLInputElement | null = null;
    private terrainHeightModeEl: HTMLSelectElement | null = null;
    private terrainLightPaintEnabledEl: HTMLInputElement | null = null;
    private terrainTileBrushEnabledEl: HTMLInputElement | null = null;
    private terrainTileBrushSizeEl: HTMLInputElement | null = null;
    private terrainTileBrushSizeValueEl: HTMLElement | null = null;
    private terrainBrushHardnessEl: HTMLInputElement | null = null;
    private terrainBrushStrengthEl: HTMLInputElement | null = null;
    private terrainHeightSmoothEl: HTMLInputElement | null = null;
    private terrainPaintLayerEl: HTMLSelectElement | null = null;
    private terrainGridEl: HTMLInputElement | null = null;
    private terrainGrid: THREE.GridHelper | null = null;
    private brushErase = false;
    private paintingStrokeActive = false;
    private attBrushCursor: THREE.Mesh | null = null;
    private attBrushRadiusTiles = 2;
    private loadedAttFileName: string | null = null;
    private readonly undoHistory: TerrainEditSnapshot[] = [];
    private readonly redoHistory: TerrainEditSnapshot[] = [];
    private readonly objectUndoHistory: OBJData[] = [];
    private readonly objectRedoHistory: OBJData[] = [];
    private pendingImportedFiles: Map<string, File> | null = null;
    private pendingImportedData: OBJData | null = null;
    private pendingImportedResult: TerrainObjectLoadResult | null = null;
    private objectPreviewRequestId = 0;
    private objectLibrarySearch = '';
    private objectScatterEnabled = false;
    private objectScatterCount = 5;
    private objectScatterRadius = 4;
    private readonly zoneLabels = new Map<number, string>();
    private readonly zoneColors = new Map<number, string>();
    private characterPlayGroup: THREE.Group | null = null;
    private characterPlayNameTag: THREE.Sprite | null = null;
    private characterPlayMixer: THREE.AnimationMixer | null = null;
    private characterPlayItemMixers: THREE.AnimationMixer[] = [];
    private characterPlayAction: THREE.AnimationAction | null = null;
    private characterPlayIdleAction: THREE.AnimationAction | null = null;
    private characterPlayMoveAction: THREE.AnimationAction | null = null;
    private characterPlayClickAction: THREE.AnimationAction | null = null;
    private characterPlayRunAction: THREE.AnimationAction | null = null;
    private characterPlaySkeleton: THREE.Skeleton | null = null;
    private characterPlayBmdBones: THREE.Bone[] | null = null;
    private characterPlayBindMatrix: THREE.Matrix4 | null = null;
    private characterPlayBaseQuaternion = new THREE.Quaternion();
    private characterPlayFacingQuaternion = new THREE.Quaternion();
    private characterPlayUpAxis = new THREE.Vector3(0, 1, 0);
    private characterPlayPosition = new THREE.Vector3();
    private characterPlayDestination: THREE.Vector3 | null = null;
    private characterPlayMode = false;
    private characterPlaySpeed = 420;
    private characterPlayCameraOffset = new THREE.Vector3(0, 900, 900);
    private characterPlayStatusEl: HTMLElement | null = null;
    private characterPlayExitBtn: HTMLButtonElement | null = null;
    private characterPlayAnimationSelect: HTMLSelectElement | null = null;
    private characterPlayItemSelects = new Map<number, HTMLSelectElement>();
    private characterPlayItemSelections = new Map<number, string>();
    private characterPlayManualAnimation = false;
    private characterPlayAnimationSpeed = CHARACTER_PLAY_ANIMATION_SPEED;

    constructor() {
        this.initThree();
        this.initUI();
        void this.loadObjectOverrides();
        this.startAnimationLoop();
    }

    setActive(active: boolean) {
        this.isActive = active;
        this.resetMovementKeys();
        if (active) {
            this.timer.reset();
            window.dispatchEvent(new Event('resize'));
            this.scheduleCameraChangedEmit();
            this.minimapNeedsRedraw = true;
            this.startAnimationLoop();
        } else if (this.animationFrameHandle !== null) {
            cancelAnimationFrame(this.animationFrameHandle);
            this.animationFrameHandle = null;
        }
    }

    public applyPresentationMode(enabled: boolean) {
        this.presentationMode = enabled;
        this.updateSelectionMarker();
        this.minimapNeedsRedraw = true;
    }

    public getLoadedAttData(): import('./terrain/formats/ATTReader').TerrainAttributeData | null {
        return this.loadedAttData;
    }

    public getCurrentDataFiles(): Map<string, File> {
        return new Map(this.dataFiles);
    }

    public async enterCharacterPlayMode(): Promise<void> {
        if (!this.terrainMesh || this.loadedWorldNumber === null) {
            this.setCharacterPlayStatus('Load a World before entering Character Mode.');
            return;
        }

        let playerEntry = [...this.dataFiles.entries()].find(([key]) =>
            /(?:^|\/)player\/player\.bmd$/i.test(key),
        );
        if (!playerEntry && this.dataRootPath && isElectron()) {
            const playerFiles = await readTerrainPlayerFiles(this.dataRootPath);
            for (const entry of playerFiles) {
                this.dataFiles.set(entry.key.toLowerCase(), createFileFromElectronData(entry.name, entry.data));
            }
            playerEntry = [...this.dataFiles.entries()].find(([key]) =>
                /(?:^|\/)player\/player\.bmd$/i.test(key),
            );
        }
        await this.populateCharacterPlayItemSelectors();
        const baseEntry = [...this.dataFiles.entries()].find(([key]) =>
            /(?:^|\/)player\/armorclass01\.bmd$/i.test(key),
        ) ?? [...this.dataFiles.entries()].find(([key]) =>
            /(?:^|\/)player\/armorclass\d+\.bmd$/i.test(key),
        );
        if (!baseEntry) {
            this.setCharacterPlayStatus(
                playerEntry
                    ? 'Player/player.bmd was found, but Player/ArmorClass01.bmd was not found.'
                    : 'Player/player.bmd and the Player/ArmorClass model were not found in the loaded Data folder.',
            );
            return;
        }

        this.disposeCharacterPlayGroup();
        try {
            const group = await loadTerrainObjectPreview(baseEntry[1], this.dataFiles);
            group.name = 'map_player_character';
            group.traverse(object => {
                object.visible = true;
                object.frustumCulled = false;
                object.castShadow = true;
                object.receiveShadow = true;
            });
            this.characterPlayGroup = group;
            this.characterPlayBaseQuaternion.copy(group.quaternion);
            this.characterPlaySkeleton = this.findCharacterSkeleton(group);
            this.characterPlayBmdBones = group.userData.bmdBones as THREE.Bone[] | undefined ?? null;
            this.characterPlayBindMatrix = this.findCharacterBindMatrix(group);
            await this.loadCharacterParts(group);
            await this.loadCharacterPlayLordBillySet(group);
            const playerAnimationEntry = playerEntry;
            if (this.characterPlaySkeleton && playerAnimationEntry) {
                const animationLoader = new BMDLoader();
                const loadedAnimations = animationLoader.loadAnimationsFrom(
                    await playerAnimationEntry[1].arrayBuffer(),
                    this.characterPlaySkeleton,
                    this.characterPlayBmdBones ?? undefined,
                );
                group.animations = loadedAnimations.map(clip =>
                    this.stabilizeCharacterMovementAnimation(clip, this.characterPlayBmdBones),
                );
            }
            this.characterPlayMixer = group.animations.length > 0
                ? new THREE.AnimationMixer(group)
                : null;
            this.populateCharacterPlayAnimationSelect(group.animations);
            const findCharacterAction = (actionId: number): THREE.AnimationAction | null => {
                const clip = group.animations.find(candidate =>
                    (candidate.userData as { actionIndex?: number } | undefined)?.actionIndex === actionId
                    || candidate.name === `action_${actionId}`,
                );
                return this.characterPlayMixer && clip ? this.characterPlayMixer.clipAction(clip) : null;
            };
            this.characterPlayIdleAction = findCharacterAction(1);
            this.characterPlayClickAction = findCharacterAction(82);
            if (!this.characterPlayIdleAction || !this.characterPlayClickAction) {
                console.warn(
                    '[TerrainScene] Required map actions are missing. Expected action_1 and action_82.',
                    group.animations.map(animation => animation.name),
                );
            }
            /* Keep the base pose active until the first movement input. */
            this.characterPlayAction = this.characterPlayIdleAction;
            this.characterPlayAction
                ?.setLoop(THREE.LoopRepeat, Infinity)
                .setEffectiveTimeScale(this.characterPlayAnimationSpeed)
                .play();

            const start = this.controls.target.clone();
            start.x = THREE.MathUtils.clamp(start.x, 0, TERRAIN_WORLD_SIZE);
            start.z = THREE.MathUtils.clamp(start.z, 0, TERRAIN_WORLD_SIZE);
            start.y = this.getTerrainWorldHeight(start.x, start.z);
            this.characterPlayPosition.copy(start);
                this.characterPlayDestination = null;
            group.position.copy(start);
            this.characterPlayNameTag = this.createCharacterPlayNameTag();
            this.scene.add(group);
            this.characterPlayNameTag.position.copy(group.position);
            this.characterPlayNameTag.position.y += 260;
            this.scene.add(this.characterPlayNameTag);
            this.camera.position.copy(start).add(this.characterPlayCameraOffset);
            this.controls.target.set(start.x, start.y + 100, start.z);
            this.characterPlayMode = true;
            this.controls.enabled = false;
            this.characterPlayExitBtn?.classList.remove('hidden');
            this.setCharacterPlayStatus(
                `Character Mode active. Click to move (${group.animations.length} animations loaded).`,
            );
            this.setActive(true);
        } catch (error) {
            this.disposeCharacterPlayGroup();
            this.setCharacterPlayStatus(`Player BMD failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    public exitCharacterPlayMode(): void {
        this.characterPlayMode = false;
        this.characterPlayDestination = null;
        this.controls.enabled = true;
        this.resetMovementKeys();
        this.disposeCharacterPlayGroup();
        this.characterPlayExitBtn?.classList.add('hidden');
        this.setCharacterPlayStatus('Character Mode inactive.');
    }

    private setCharacterPlayStatus(message: string): void {
        if (this.characterPlayStatusEl) this.characterPlayStatusEl.textContent = message;
        if (this.statusEl && message.includes('failed')) this.statusEl.textContent = message;
    }

    private populateCharacterPlayAnimationSelect(animations: THREE.AnimationClip[]): void {
        const select = this.characterPlayAnimationSelect;
        if (!select) return;
        select.replaceChildren();
        animations.forEach((clip, index) => {
            const option = document.createElement('option');
            const actionIndex = (clip.userData as { actionIndex?: number } | undefined)?.actionIndex;
            option.value = String(index);
            option.textContent = actionIndex === undefined
                ? `${clip.name} (${index})`
                : `Action ${actionIndex} - ${clip.name}`;
            select.appendChild(option);
        });
        select.value = '';
        this.characterPlayManualAnimation = false;
    }

    private playCharacterPlayAnimation(index: number): void {
        const clip = this.characterPlayGroup?.animations[index];
        if (!clip || !this.characterPlayMixer) return;
        this.characterPlayMixer.stopAllAction();
        this.characterPlayMixer
            .clipAction(clip)
            .reset()
            .setEffectiveWeight(1)
            .setLoop(THREE.LoopRepeat, Infinity)
            .setEffectiveTimeScale(this.characterPlayAnimationSpeed)
            .play();
        this.characterPlayAction = this.characterPlayMixer.clipAction(clip);
        this.characterPlayManualAnimation = true;
        this.characterPlayDestination = null;
        this.setCharacterPlayStatus(`Playing ${clip.name}.`);
    }

    private async getCharacterPlayItemFile(): Promise<File | null> {
        const existing = [...this.dataFiles.entries()]
            .find(([key]) => /(?:^|\/)local\/(?:eng\/)?item\.bmd$/i.test(key))?.[1];
        if (existing) return existing;
        if (!this.dataRootPath || !isElectron()) return null;
        for (const relativePath of ['Local/Eng/item.bmd', 'Local/item.bmd']) {
            const loaded = await readDataFileFromRoot(this.dataRootPath, relativePath);
            if (loaded) return createFileFromElectronData(loaded.name, loaded.data);
        }
        return null;
    }

    private async populateCharacterPlayItemSelectors(): Promise<void> {
        const itemFile = await this.getCharacterPlayItemFile();
        if (!itemFile) return;
        const items = parseItemBmd(await itemFile.arrayBuffer())
            .filter(item => item.modelPath)
            .filter(item => [7, 8, 9, 10, 11, 12].includes(item.group));
        const groups: Array<[number, string]> = [
            [7, 'terrain-character-helm-select'],
            [8, 'terrain-character-armor-select'],
            [9, 'terrain-character-pants-select'],
            [10, 'terrain-character-gloves-select'],
            [11, 'terrain-character-boots-select'],
            [12, 'terrain-character-wings-select'],
        ];
        for (const [group, elementId] of groups) {
            const select = document.getElementById(elementId) as HTMLSelectElement | null;
            if (!select) continue;
            this.characterPlayItemSelects.set(group, select);
            select.replaceChildren();
            const groupItems = items.filter(item => item.group === group);
            for (const item of groupItems) {
                const option = document.createElement('option');
                option.value = `${item.group}:${item.id}`;
                option.textContent = `${item.itemName || item.modelName} (ID ${item.id})`;
                select.appendChild(option);
            }
            const preferredId = group === 12 ? 4 : 254;
            const preferred = groupItems.find(item => item.id === preferredId);
            if (preferred) select.value = `${group}:${preferred.id}`;
            this.characterPlayItemSelections.set(group, select.value);
            if (select.dataset.characterLoadoutBound !== 'true') {
                select.dataset.characterLoadoutBound = 'true';
                select.addEventListener('change', () => {
                    this.characterPlayItemSelections.set(group, select.value);
                    if (this.characterPlayMode) void this.enterCharacterPlayMode();
                });
            }
        }
    }

    private disposeCharacterPlayGroup(): void {
        if (this.characterPlayGroup) {
            if (this.characterPlayNameTag) {
                const material = this.characterPlayNameTag.material as THREE.SpriteMaterial;
                material.map?.dispose();
                material.dispose();
                this.scene.remove(this.characterPlayNameTag);
            }
            this.scene.remove(this.characterPlayGroup);
            this.disposeTerrainObject(this.characterPlayGroup);
        }
        this.characterPlayGroup = null;
        this.characterPlayNameTag = null;
        this.characterPlayMixer = null;
        this.characterPlayItemMixers.forEach(mixer => {
            mixer.stopAllAction();
        });
        this.characterPlayItemMixers = [];
        this.characterPlayAction = null;
        this.characterPlayIdleAction = null;
        this.characterPlayMoveAction = null;
        this.characterPlayClickAction = null;
        this.characterPlayRunAction = null;
        this.characterPlayManualAnimation = false;
        this.characterPlaySkeleton = null;
        this.characterPlayBmdBones = null;
        this.characterPlayBindMatrix = null;
        this.characterPlayBaseQuaternion.identity();
        this.characterPlayFacingQuaternion.identity();
    }

    private createCharacterPlayNameTag(): THREE.Sprite {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Unable to create the character name tag.');
        }

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#ffffff';
        context.font = 'bold 56px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.shadowColor = 'rgba(0, 0, 0, 0.9)';
        context.shadowBlur = 8;
        context.shadowOffsetX = 2;
        context.shadowOffsetY = 2;
        context.fillText('LordBilly', canvas.width / 2, canvas.height / 2 + 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.name = 'character_name_tag';
        sprite.scale.set(190, 48, 1);
        sprite.renderOrder = 20;
        return sprite;
    }

    private updateCharacterPlayNameTag(): void {
        if (!this.characterPlayGroup || !this.characterPlayNameTag) return;
        this.characterPlayNameTag.position.copy(this.characterPlayGroup.position);
        this.characterPlayNameTag.position.y += 260;
    }

    private setCharacterPlayDestination(clientX: number, clientY: number): void {
        if (!this.characterPlayMode || !this.terrainMesh) return;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.set(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hit = this.raycaster.intersectObject(this.terrainMesh, true)[0];
        if (!hit) {
            this.setCharacterPlayStatus('Click on the terrain to set a destination.');
            return;
        }

        const destination = new THREE.Vector3(
            THREE.MathUtils.clamp(hit.point.x, 0, TERRAIN_WORLD_SIZE),
            hit.point.y,
            THREE.MathUtils.clamp(hit.point.z, 0, TERRAIN_WORLD_SIZE),
        );
        if (this.isCharacterTileBlocked(destination.x, destination.z)) {
            this.setCharacterPlayStatus('The selected ATT area is not walkable.');
            return;
        }
        this.characterPlayDestination = destination;
        this.setCharacterPlayAnimation(true, false);
        if (!this.characterPlayClickAction) {
            this.setCharacterPlayStatus('Click animation action_82 was not found in Player/player.bmd.');
            return;
        }
        this.setCharacterPlayStatus('Moving to selected location...');
    }

    private findCharacterSkeleton(group: THREE.Group): THREE.Skeleton | null {
        let skeleton: THREE.Skeleton | null = null;
        group.traverse(object => {
            if (!skeleton && (object as THREE.SkinnedMesh).isSkinnedMesh) {
                skeleton = (object as THREE.SkinnedMesh).skeleton;
            }
        });
        return skeleton;
    }

    private findCharacterBindMatrix(group: THREE.Group): THREE.Matrix4 | null {
        let bindMatrix: THREE.Matrix4 | null = null;
        group.traverse(object => {
            if (!bindMatrix && (object as THREE.SkinnedMesh).isSkinnedMesh) {
                bindMatrix = (object as THREE.SkinnedMesh).bindMatrix.clone();
            }
        });
        return bindMatrix;
    }

    private setCharacterPlayFacing(direction: THREE.Vector3): void {
        const angle = Math.atan2(direction.x, direction.z);
        this.characterPlayFacingQuaternion.setFromAxisAngle(this.characterPlayUpAxis, angle);
        this.characterPlayGroup?.quaternion
            .copy(this.characterPlayFacingQuaternion)
            .multiply(this.characterPlayBaseQuaternion);
    }

    private async loadCharacterParts(root: THREE.Group): Promise<void> {
        const basePath = [...this.dataFiles.keys()].find(key => /player\/armorclass\d+\.bmd$/i.test(key));
        if (!basePath || !this.characterPlaySkeleton) return;
        const classToken = basePath.match(/armorclass(\d+)\.bmd$/i)?.[1] ?? '01';
        const partNames = ['Helm', 'Pant', 'Glove', 'Boot'];
        for (const partName of partNames) {
            const entry = [...this.dataFiles.entries()].find(([key]) =>
                key === `player/${partName.toLowerCase()}class${classToken}.bmd`
                || key.endsWith(`/player/${partName.toLowerCase()}class${classToken}.bmd`),
            );
            if (!entry) continue;
            const part = await loadTerrainObjectPreview(entry[1], this.dataFiles);
            const meshes: THREE.SkinnedMesh[] = [];
            part.traverse(object => {
                if ((object as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(object as THREE.SkinnedMesh);
            });
            for (const mesh of meshes) {
                mesh.position.set(0, 0, 0);
                mesh.rotation.set(0, 0, 0);
                mesh.scale.set(1, 1, 1);
                root.add(mesh);
                mesh.bind(this.characterPlaySkeleton!, this.characterPlayBindMatrix ?? mesh.bindMatrix);
            }
        }
    }

            private async loadCharacterPlayLordBillySet(root: THREE.Group): Promise<void> {
                if (!this.characterPlaySkeleton) return;
                let itemFile = [...this.dataFiles.entries()]
                    .find(([key]) => /(?:^|\/)local\/(?:eng\/)?item\.bmd$/i.test(key))?.[1] ?? null;
                if (!itemFile && this.dataRootPath && isElectron()) {
                    for (const relativePath of ['Local/Eng/item.bmd', 'Local/item.bmd']) {
                        const itemData = await readDataFileFromRoot(this.dataRootPath, relativePath);
                        if (itemData) {
                            itemFile = createFileFromElectronData(itemData.name, itemData.data);
                            break;
                        }
                    }
                }
                if (!itemFile) return;
                const items = parseItemBmd(await itemFile.arrayBuffer()).filter(item => item.modelPath);
                const findMageLegendary = (group: number): ItemDefinition | undefined =>
                    items
                        .filter(item => item.group === group)
                        .find(item =>
                            item.id === 254
                            && /mage\s+legendary/i.test(item.itemName)
                            && /male121(?:_mage)?\.bmd$/i.test(item.modelName),
                        )
                    ?? items
                        .filter(item => item.group === group)
                        .find(item => /mage\s+legendary/i.test(item.itemName));
                const selectedItems = [7, 8, 9, 10, 11, 12]
                    .map(group => {
                        const selection = this.characterPlayItemSelections.get(group)
                            ?? this.characterPlayItemSelects.get(group)?.value;
                        if (selection) {
                            const [selectedGroup, selectedId] = selection.split(':').map(Number);
                            const selected = items.find(item =>
                                item.group === selectedGroup && item.id === selectedId,
                            );
                            if (selected) return selected;
                        }
                        return group === 12 ? undefined : findMageLegendary(group);
                    });
                const armorItems = selectedItems
                    .slice(0, 5)
                    .filter((item): item is ItemDefinition => item !== undefined);
                const mageWings = items
                    .filter(item => {
                        const name = `${item.itemName} ${item.modelName} ${item.modelFolder}`;
                        return item.group === 12
                            && item.id === 4
                            && /wing05\.bmd$/i.test(item.modelName)
                            && /soul/i.test(name)
                            && !/satan|storm|chaos|illusion|eros|despair|unity|raven|dragon/i.test(name);
                    })
                    .sort((left, right) => {
                        const leftName = `${left.itemName} ${left.modelName}`.toLowerCase();
                        const rightName = `${right.itemName} ${right.modelName}`.toLowerCase();
                        const leftExact = /wings?\s*(?:of\s*)?dimension/.test(leftName) ? 0 : 1;
                        const rightExact = /wings?\s*(?:of\s*)?dimension/.test(rightName) ? 0 : 1;
                        return leftExact - rightExact || right.id - left.id;
                    });
                const wing = selectedItems[5]
                    ?? mageWings[0]
                    ?? items.find(item =>
                        item.group === 12
                        && /soul/i.test(item.itemName)
                        && /wing05\.bmd$/i.test(item.modelName),
                    );
                for (const item of armorItems) {
                    const candidates = [
                        `Data/Item/${item.modelName}`,
                        item.modelPath,
                        `Item/${item.modelName}`,
                    ];
                    const part = await this.loadCharacterPlayItem(candidates);
                    if (!part) continue;
                    const meshes: THREE.SkinnedMesh[] = [];
                    part.traverse(object => {
                        if ((object as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(object as THREE.SkinnedMesh);
                    });
                    for (const mesh of meshes) {
                        mesh.position.set(0, 0, 0);
                        mesh.rotation.set(0, 0, 0);
                        mesh.scale.set(1, 1, 1);
                        root.add(mesh);
                        mesh.bind(this.characterPlaySkeleton, this.characterPlayBindMatrix ?? mesh.bindMatrix);
                    }
                }
                if (wing) {
                    const wingGroup = await this.loadCharacterPlayItem([
                        `Data/Item/${wing.modelName}`,
                        wing.modelPath,
                        `Item/${wing.modelName}`,
                    ]);
                    const bone = resolveAttachmentBoneByBmdIndex(
                        this.characterPlaySkeleton.bones,
                        this.characterPlayBmdBones,
                        47,
                    );
                    if (wingGroup && bone) {
                        wingGroup.position.set(0, 0, 0);
                        wingGroup.rotation.set(0, 0, 0);
                        wingGroup.scale.set(1, 1, 1);
                        bone.add(wingGroup);
                        if (wingGroup.animations.length > 0) {
                            const mixer = new THREE.AnimationMixer(wingGroup);
                            const action = mixer.clipAction(wingGroup.animations[0]);
                            action
                                .setLoop(THREE.LoopRepeat, Infinity)
                                .setEffectiveTimeScale(this.characterPlayAnimationSpeed)
                                .play();
                            this.characterPlayItemMixers.push(mixer);
                        }
                    }
                }
            }

            private async loadCharacterPlayItem(candidates: string[]): Promise<THREE.Group | null> {
                for (const candidate of candidates) {
                    const normalized = candidate.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
                    const file = [...this.dataFiles.entries()].find(([key]) =>
                        key === normalized || key.endsWith(`/${normalized}`),
                    )?.[1];
                    if (!file) {
                        if (!this.dataRootPath || !isElectron()) continue;
                        const loaded = await readDataFileFromRoot(
                            this.dataRootPath,
                            candidate.toLowerCase().endsWith('.bmd') ? candidate : `${candidate}.bmd`,
                        ) ?? await readDataFileFromRoot(
                            this.dataRootPath,
                            candidate.replace(/^item\//i, 'Item/'),
                        );
                        if (!loaded) continue;
                        const modelFile = createFileFromElectronData(loaded.name, loaded.data);
                        const assetFiles = await this.loadCharacterPlayTextures(
                            modelFile,
                            candidate,
                        );
                        const group = await loadTerrainObjectPreview(modelFile, assetFiles);
                        group.traverse(object => {
                            object.visible = true;
                            object.frustumCulled = false;
                        });
                        return group;
                    }
                    const group = await loadTerrainObjectPreview(file, this.dataFiles);
                    group.traverse(object => {
                        object.visible = true;
                        object.frustumCulled = false;
                    });
                    return group;
                }
                return null;
            }

            private async loadCharacterPlayTextures(
                modelFile: File,
                modelPath: string,
            ): Promise<Map<string, File>> {
                const files = new Map(this.dataFiles);
                if (!this.dataRootPath || !isElectron()) return files;

                const { requiredTextures } = await new BMDLoader().load(await modelFile.arrayBuffer());
                const modelDirectory = modelPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
                const textureBases = requiredTextures.map(texture =>
                    (texture.replace(/\\/g, '/').split('/').pop() ?? texture)
                        .replace(/\.[^.]+$/, '')
                        .toLowerCase(),
                );
                const searchedTextures = await searchTextures(this.dataRootPath, textureBases);
                for (const paths of Object.values(searchedTextures)) {
                    const texturePath = paths[0];
                    if (!texturePath) continue;
                    const loaded = await readFileFromPath(texturePath);
                    if (!loaded) continue;
                    const file = createFileFromElectronData(loaded.name, loaded.data);
                    files.set(texturePath.toLowerCase(), file);
                    files.set(loaded.name.toLowerCase(), file);
                }
                for (const texture of requiredTextures) {
                    const textureName = texture.replace(/\\/g, '/').replace(/^\/+/, '');
                    const baseName = textureName.split('/').pop() ?? textureName;
                    const candidates = [
                        textureName,
                        `${modelDirectory}/${textureName}`,
                        `${modelDirectory}/${baseName}`,
                        `Item/${textureName}`,
                        `Item/${baseName}`,
                        `Data/Item/${textureName}`,
                        `Data/Item/${baseName}`,
                        `Player/${textureName}`,
                        `Player/${baseName}`,
                    ];
                    for (const candidate of candidates) {
                        const loaded = await readDataFileFromRoot(this.dataRootPath, candidate);
                        if (!loaded) continue;
                        const file = createFileFromElectronData(loaded.name, loaded.data);
                        files.set(candidate.toLowerCase(), file);
                        files.set(loaded.name.toLowerCase(), file);
                        break;
                    }
                }
                return files;
            }
    private setCharacterPlayAnimation(moving: boolean, sprinting: boolean): void {
        if (this.characterPlayManualAnimation) return;
        const nextAction = moving ? this.characterPlayClickAction : this.characterPlayIdleAction;
        if (!nextAction || nextAction === this.characterPlayAction) return;
        this.characterPlayMixer?.stopAllAction();
        nextAction
            .reset()
            .setEffectiveWeight(1)
            .setLoop(THREE.LoopRepeat, Infinity)
            .setEffectiveTimeScale(this.characterPlayAnimationSpeed)
            .fadeIn(0.15)
            .play();
        this.characterPlayAction = nextAction;
    }

    private stabilizeCharacterMovementAnimation(
        clip: THREE.AnimationClip,
        bmdBones: THREE.Bone[] | null,
    ): THREE.AnimationClip {
        const actionIndex = (clip.userData as { actionIndex?: number } | undefined)?.actionIndex;
        if (actionIndex !== 13 && actionIndex !== 22 && actionIndex !== 82) return clip;

        if (!bmdBones?.length) return clip;
        const bmdBoneSet = new Set(bmdBones);
        const rootPrefixes = bmdBones
            .filter(bone => !bone.parent || !bmdBoneSet.has(bone.parent as THREE.Bone))
            .map(bone => `${bone.name}.`);
        const tracks = clip.tracks.filter(track =>
            !rootPrefixes.some(prefix =>
                track.name.startsWith(`${prefix}quaternion`)
                || track.name.startsWith(`${prefix}position`),
            ),
        );
        const stabilized = new THREE.AnimationClip(clip.name, clip.duration, tracks);
        stabilized.userData = { ...clip.userData };
        return stabilized;
    }

    public setStatusMessage(message: string) {
        if (this.statusEl) {
            this.statusEl.textContent = message;
        }
    }

    private emitStateChanged() {
        this.onStateChanged?.(this.getCurrentState());
    }

    public getCurrentState(): TerrainSessionState {
        return {
            rendererBackend: this.rendererBackendPreference,
            lastWorldNumber: this.loadedWorldNumber,
            availableWorldNumbers: [...this.availableWorldNumbers],
            cameraPosition: this.toExplorerVector3(this.camera.position),
            cameraTarget: this.controls
                ? this.toExplorerVector3(this.controls.target)
                : { x: 0, y: 0, z: 0 },
            selectedObject: this.selectedObjectRecord?.selection || null,
            animationsEnabled: this.animationsEnabled,
            sunEnabled: this.sunEnabledEl?.checked ?? true,
            wireframe: this.wireframeEl?.checked ?? false,
            showObjects: this.showObjectsEl?.checked ?? true,
            brightness: parseFloat(this.brightnessSliderEl?.value || `${TERRAIN_BRIGHTNESS_DEFAULT}`) || TERRAIN_BRIGHTNESS_DEFAULT,
            objectDistance: this.objectDrawDistance,
        };
    }

    public restoreSessionState(state: TerrainSessionState) {
        this.pendingRestoreState = {
            ...state,
            availableWorldNumbers: [...state.availableWorldNumbers],
        };
        this.rendererBackendPreference = state.rendererBackend;
        if (this.rendererBackendSelectEl) {
            this.rendererBackendSelectEl.value = state.rendererBackend;
        }
        void this.setRendererBackend(state.rendererBackend, { persistState: false, announceStatus: false });

        if (this.wireframeEl) {
            this.wireframeEl.checked = state.wireframe;
        }
        if (this.showObjectsEl) {
            this.showObjectsEl.checked = state.showObjects;
        }
        this.animationsEnabled = state.animationsEnabled;
        if (this.animationsEnabledEl) {
            this.animationsEnabledEl.checked = state.animationsEnabled;
        }
        if (this.sunEnabledEl) {
            this.sunEnabledEl.checked = state.sunEnabled;
        }
        if (this.sunLight) {
            this.sunLight.visible = state.sunEnabled;
        }
        if (this.brightnessSliderEl && this.brightnessLabelEl) {
            this.brightnessSliderEl.value = `${state.brightness}`;
            this.brightnessLabelEl.textContent = `Brightness: ${state.brightness.toFixed(2)}×`;
            this.setBrightness(state.brightness);
        }
        if (this.objectDistanceSliderEl && this.objectDistanceLabelEl) {
            this.objectDistanceSliderEl.value = `${Math.round(state.objectDistance)}`;
            this.objectDrawDistance = Math.max(500, state.objectDistance);
            this.objectDistanceLabelEl.textContent = `Object Distance: ${Math.round(this.objectDrawDistance)}`;
        }

        if (!this.loadedWorldNumber && state.lastWorldNumber !== null) {
            this.setLastContextMessage(`Last session: World ${state.lastWorldNumber}. Reload Data folder to restore camera and object selection.`);
        }

        if (this.loadedWorldNumber !== null && state.lastWorldNumber === this.loadedWorldNumber) {
            this.applyPendingRestoreState();
        }
    }

    public async loadWorldByNumber(worldNumber: number): Promise<void> {
        await this.loadWorld(worldNumber);
    }

    public resolveModelFile(modelFileKey: string | null): File | null {
        if (!modelFileKey) return null;
        return this.currentWorldFiles.get(modelFileKey.toLowerCase()) || null;
    }

    public getCurrentTextureFiles(): File[] {
        const result: File[] = [];
        const worldPrefix = this.loadedWorldNumber === null ? '' : `world${this.loadedWorldNumber}/`;
        for (const [key, file] of this.currentWorldFiles) {
            if (worldPrefix && !key.startsWith(worldPrefix)) continue;
            if (/\.(jpg|jpeg|png|bmp|tga|ozj|ozt|ozb)$/i.test(key)) {
                result.push(file);
            }
        }
        return result;
    }

    public createCurrentBookmark(name: string): ExplorerBookmark | null {
        if (this.loadedWorldNumber === null) {
            this.setBookmarkStatus('Load a world before saving a bookmark.');
            return null;
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            this.setBookmarkStatus('Enter a bookmark name.');
            return null;
        }

        return {
            id: createId('bookmark'),
            name: trimmedName,
            worldNumber: this.loadedWorldNumber,
            cameraPosition: this.toExplorerVector3(this.camera.position),
            cameraTarget: this.toExplorerVector3(this.controls.target),
            selectedObject: this.selectedObjectRecord?.selection || null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
    }

    public async jumpToBookmark(bookmark: ExplorerBookmark): Promise<boolean> {
        if (!this.hasLoadedData()) {
            this.setStatusMessage(`Reload Data folder to open bookmark "${bookmark.name}".`);
            return false;
        }

        if (this.loadedWorldNumber !== bookmark.worldNumber) {
            await this.loadWorld(bookmark.worldNumber);
        }

        this.applyCameraState(bookmark.cameraPosition, bookmark.cameraTarget);
        if (bookmark.selectedObject) {
            const matched = this.findRecordForSelection(bookmark.selectedObject);
            if (matched) {
                this.selectObjectRecord(matched);
            }
        }
        this.setBookmarkStatus(`Jumped to "${bookmark.name}".`);
        return true;
    }

    public selectObjectById(objectId: string): boolean {
        const record = this.objectRecords.find(item => item.selection.objectId === objectId);
        if (!record) return false;
        this.selectObjectRecord(record);
        return true;
    }

    private createClassicWebGLRenderer(): THREE.WebGLRenderer {
        const renderer = new THREE.WebGLRenderer({
            antialias: false,
            powerPreference: 'high-performance',
        });
        renderer.debug.checkShaderErrors = false;
        return renderer;
    }

    private createPreferredRenderer(preference: TerrainRendererBackendPreference): Promise<SupportedRenderer> {
        return createPreferredRenderer(preference, () => this.createClassicWebGLRenderer(), {
            antialias: false,
        });
    }

    private configureRenderer(renderer: SupportedRenderer) {
        if (!this.containerEl) return;
        const w = this.containerEl.clientWidth || 1;
        const h = this.containerEl.clientHeight || 1;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, TERRAIN_MAX_PIXEL_RATIO));
        renderer.setSize(w, h);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
    }

    private attachControls(domElement: HTMLCanvasElement) {
        const worldCenter = (TERRAIN_SIZE * TERRAIN_SCALE) / 2;
        const previousTarget = this.controls?.target.clone() ?? new THREE.Vector3(worldCenter, 0, worldCenter);
        this.controls = new OrbitControls(this.camera, domElement);
        this.controls.target.copy(previousTarget);
        this.controls.enableDamping = true;
        this.controls.maxDistance = 50000;
        this.controls.minDistance = 100;
        this.controls.addEventListener('change', () => {
            this.scheduleCameraChangedEmit();
            this.minimapNeedsRedraw = true;
        });
    }

    private attachTransformControls(domElement: HTMLCanvasElement) {
        this.disposeTransformControls();

        const transformControls = new TransformControls(this.camera, domElement);
        transformControls.setMode(this.transformControlMode);
        transformControls.setSpace('world');
        transformControls.setSize(1.15);
        transformControls.addEventListener('dragging-changed', event => {
            const dragging = event.value === true;
            if (this.controls) {
                this.controls.enabled = !dragging;
            }
            this.transformControlPointerActive = dragging;
        });
        transformControls.addEventListener('mouseDown', () => {
            this.transformControlPointerActive = true;
        });
        transformControls.addEventListener('mouseUp', () => {
            window.setTimeout(() => {
                this.transformControlPointerActive = false;
            }, 0);
        });
        transformControls.addEventListener('objectChange', () => this.handleTransformControlObjectChange());

        const helper = transformControls.getHelper();
        helper.visible = false;
        this.scene.add(helper);
        this.transformControls = transformControls;
        this.transformControlsHelper = helper;
        this.updateTransformControlAttachment();
    }

    private disposeTransformControls() {
        if (this.transformControls) {
            this.transformControls.detach();
            this.transformControls.dispose();
            this.transformControls = null;
        }
        if (this.transformControlsHelper) {
            this.scene.remove(this.transformControlsHelper);
            const disposableHelper = this.transformControlsHelper as THREE.Object3D & { dispose?: () => void };
            disposableHelper.dispose?.();
            this.transformControlsHelper = null;
        }
    }

    private attachCanvasPointerEvents(domElement: HTMLCanvasElement) {
        domElement.addEventListener('pointerdown', event => {
            if (this.characterPlayMode && event.button === 0) {
                this.setCharacterPlayDestination(event.clientX, event.clientY);
                this.pointerDown = null;
                this.paintingStrokeActive = false;
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            this.pointerDown = { x: event.clientX, y: event.clientY };
            this.brushErase = event.button === 2;
            if (event.button === 0 && event.ctrlKey && this.selectedObjectRecord && this.transformControlMode === 'translate' && this.transformControlsHelper?.visible && this.isTransformGizmoHitAtClientPoint(event.clientX, event.clientY)) {
                this.duplicateSelectedObject();
                this.pointerDown = null;
                event.preventDefault();
                return;
            }
            if ((event.button === 0 || event.button === 2) && !event.ctrlKey && (
                this.terrainTileBrushEnabledEl?.checked ||
                this.attBrushEnabledEl?.checked ||
                this.isAttFlagPaintConfigured() ||
                this.terrainHeightEnabledEl?.checked ||
                this.terrainLightPaintEnabledEl?.checked
            )) {
                this.beginTerrainEdit();
                this.paintingStrokeActive = true;
                this.paintAtClientPoint(event.clientX, event.clientY);
            }
        }, true);
        domElement.addEventListener('pointermove', event => {
            this.updateAttBrushCursor(event.clientX, event.clientY);
            if (event.buttons !== 0 && (this.attBrushEnabledEl?.checked || this.isAttFlagPaintConfigured() || this.terrainHeightEnabledEl?.checked || this.terrainLightPaintEnabledEl?.checked || this.terrainTileBrushEnabledEl?.checked)) {
                this.paintAtClientPoint(event.clientX, event.clientY);
            }
        }, true);
        domElement.addEventListener('pointerup', event => {
            if (this.transformControlPointerActive || this.transformControls?.dragging) {
                this.pointerDown = null;
                return;
            }
            if (!this.pointerDown || (event.button !== 0 && event.button !== 2)) return;
            const dx = event.clientX - this.pointerDown.x;
            const dy = event.clientY - this.pointerDown.y;
            const wasPainting = this.paintingStrokeActive;
            this.pointerDown = null;
            this.paintingStrokeActive = false;
            if (wasPainting) return;
            if (dx * dx + dy * dy > 25) {
                return;
            }
            if (event.ctrlKey) {
                const record = this.pickObjectRecordAtClientPoint(event.clientX, event.clientY);
                if (record) {
                    this.selectObjectRecord(record);
                    this.duplicateSelectedObject();
                }
                return;
            }
            if (this.characterPlayMode && event.button === 0) {
                this.setCharacterPlayDestination(event.clientX, event.clientY);
                return;
            }
            if (this.terrainTileBrushEnabledEl?.checked) {
                this.paintTerrainTileAtClientPoint(event.clientX, event.clientY);
            } else if (this.attBrushEnabledEl?.checked || this.isAttFlagPaintConfigured()) {
                this.paintAttAtClientPoint(event.clientX, event.clientY, this.brushErase);
            } else if (this.terrainHeightEnabledEl?.checked) {
                this.paintHeightAtClientPoint(event.clientX, event.clientY, this.brushErase ? -1 : 1);
            } else if (this.terrainLightPaintEnabledEl?.checked) {
                this.paintLightAtClientPoint(event.clientX, event.clientY);
            } else if (this.objectScatterEnabled) {
                this.scatterSelectedObjectAtClientPoint(event.clientX, event.clientY);
            } else {
                this.handleCanvasSelection(event);
            }
        }, true);
        domElement.addEventListener('contextmenu', event => {
            event.preventDefault();
            this.handleCanvasObjectEditRequest(event);
        });
    }

    private captureTerrainEdit(): TerrainEditSnapshot {
        return {
            att: this.loadedAttData ? new Uint16Array(this.loadedAttData.terrainWall) : null,
            height: this.loadedHeightData ? new Uint8Array(this.loadedHeightData.data) : null,
            light: this.loadedLightData ? new Uint8Array(this.loadedLightData.data) : null,
            layer1: this.loadedMapData ? new Uint8Array(this.loadedMapData.layer1) : null,
            layer2: this.loadedMapData ? new Uint8Array(this.loadedMapData.layer2) : null,
            alpha: this.loadedMapData ? new Uint8Array(this.loadedMapData.alpha) : null,
        };
    }

    private beginTerrainEdit() {
        if (!this.loadedAttData && !this.loadedMapData && !this.loadedHeightData && !this.loadedLightData) return;
        if (this.paintingStrokeActive) return;
        this.undoHistory.push(this.captureTerrainEdit());
        if (this.undoHistory.length > 50) this.undoHistory.shift();
        this.redoHistory.length = 0;
    }

    private restoreTerrainEdit(snapshot: TerrainEditSnapshot) {
        if (this.loadedAttData && snapshot.att) this.loadedAttData.terrainWall.set(snapshot.att);
        if (this.loadedHeightData && snapshot.height) this.loadedHeightData.data.set(snapshot.height);
        if (this.loadedLightData && snapshot.light) this.loadedLightData.data.set(snapshot.light);
        if (this.loadedMapData && snapshot.layer1 && snapshot.layer2 && snapshot.alpha) {
            this.loadedMapData.layer1.set(snapshot.layer1);
            this.loadedMapData.layer2.set(snapshot.layer2);
            this.loadedMapData.alpha.set(snapshot.alpha);
            this.updateTerrainMaterialMapping();
        }
        if (this.terrainMesh && this.loadedHeightData && this.loadedAttData) {
            const geometry = buildTerrainGeometry(this.loadedHeightData, this.loadedAttData, this.loadedLightData);
            this.terrainMesh.geometry.dispose();
            this.terrainMesh.geometry = geometry;
            this.terrainAttOverlay?.setData(this.loadedAttData, geometry);
        }
        if (this.loadedAttData) {
            this.updateTerrainAttributePanel(summarizeTerrainAttributeData(this.loadedAttData));
            this.onAttDataChanged?.(this.loadedAttData, this.loadedWorldNumber ?? 0);
        }
    }

    private undoTerrainEdit() {
        const snapshot = this.undoHistory.pop();
        if (!snapshot) return;
        this.redoHistory.push(this.captureTerrainEdit());
        this.restoreTerrainEdit(snapshot);
    }

    private redoTerrainEdit() {
        const snapshot = this.redoHistory.pop();
        if (!snapshot) return;
        this.undoHistory.push(this.captureTerrainEdit());
        this.restoreTerrainEdit(snapshot);
    }

    private captureObjectEdit(): void {
        if (!this.loadedObjectsData) return;
        this.objectUndoHistory.push(JSON.parse(JSON.stringify(this.loadedObjectsData)) as OBJData);
        if (this.objectUndoHistory.length > 30) this.objectUndoHistory.shift();
        this.objectRedoHistory.length = 0;
    }

    private async restoreObjectEdit(snapshot: OBJData, targetHistory: OBJData[]): Promise<void> {
        if (!this.objectsGroup || this.loadedWorldNumber === null) return;
        if (this.loadedObjectsData) targetHistory.push(JSON.parse(JSON.stringify(this.loadedObjectsData)) as OBJData);
        const result = await loadTerrainObjects(snapshot, this.currentWorldFiles, this.loadedWorldNumber, undefined, {
            animatedInstancingMode: getTerrainAnimatedInstancingModeForBackend(this.rendererActiveBackend),
            enableInstancing: true,
        });
        this.scene.remove(this.objectsGroup);
        this.disposeTerrainObject(this.objectsGroup);
        this.objectsGroup = result.group;
        this.scene.add(this.objectsGroup);
        this.loadedObjectsData = snapshot;
        this.objectRecords = result.records;
        this.animatedObjectInstances = result.animatedInstances;
        this.clearSelection();
        this.updateTerrainObjectSelect();
        this.rebuildObjectCullingIndex();
        this.updateObjectDistanceCulling(true);
        this.emitStateChanged();
    }

    private undoObjectEdit(): void {
        const snapshot = this.objectUndoHistory.pop();
        if (snapshot) void this.restoreObjectEdit(snapshot, this.objectRedoHistory);
    }

    private redoObjectEdit(): void {
        const snapshot = this.objectRedoHistory.pop();
        if (snapshot) void this.restoreObjectEdit(snapshot, this.objectUndoHistory);
    }

    private isTransformGizmoHitAtClientPoint(clientX: number, clientY: number): boolean {
        const helper = this.transformControlsHelper;
        if (!helper) return false;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        return this.raycaster.intersectObject(helper, true).length > 0;
    }

    private getActiveRendererBackend(renderer: SupportedRenderer): TerrainRendererBackendActive {
        return getActiveRendererBackend(renderer);
    }

    private updateRendererStatus(message?: string) {
        if (!this.rendererBackendStatusEl) {
            return;
        }
        if (message) {
            this.rendererBackendStatusEl.textContent = message;
            return;
        }

        const preferred = this.rendererBackendPreference === 'auto'
            ? 'Auto'
            : this.rendererBackendPreference === 'webgpu'
                ? 'WebGPU'
                : 'WebGL';
        const active = this.rendererActiveBackend === 'webgpu' ? 'WebGPU' : 'WebGL';
        this.rendererBackendStatusEl.textContent = `Renderer: ${active} active (preferred: ${preferred})`;
    }

    private isEditableShortcutTarget(target: EventTarget | null): boolean {
        const element = target as HTMLElement | null;
        if (!element) return false;
        const tagName = element.tagName.toLowerCase();
        return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || element.isContentEditable;
    }

    private setTransformControlMode(mode: TransformControlsMode) {
        if (mode !== 'translate' && mode !== 'rotate') return;
        this.transformControlMode = mode;
        this.transformControls?.setMode(mode);
        for (const button of this.transformModeButtons) {
            button.classList.toggle('active', button.dataset.terrainTransformMode === mode);
        }
    }

    private clearWorldScene() {
        ++this.worldLoadToken;
        if (this.terrainMesh) {
            this.scene.remove(this.terrainMesh);
            this.disposeTerrainObject(this.terrainMesh);
            this.terrainMesh = null;
        }
        if (this.objectsGroup) {
            this.scene.remove(this.objectsGroup);
            this.disposeTerrainObject(this.objectsGroup);
            this.objectsGroup = null;
            this.clearObjectCullingIndex();
        }
        if (this.terrainAttOverlay) {
            this.terrainAttOverlay.setData(null);
        }
        this.objectRecords = [];
        this.animatedObjectInstances = [];
        this.currentWorldFiles.clear();
        this.loadedWorldNumber = null;
        this.loadedAttData = null;
        this.loadedAttFileName = null;
        this.loadedObjectsData = null;
        this.loadedMapData = null;
        this.loadedObjFileName = null;
        this.loadedMapFileName = null;
        this.onAttDataChanged?.(null, null);
        this.selectedObjectRecord = null;
        this.isolatedObjectRecord = null;
        this.updateTransformControlAttachment();
        this.minimapSourceCanvas = null;
        this.minimapNeedsRedraw = true;
        this.updateTerrainAttributePanel(null);
        this.updateObjectInspector();
        this.updateSelectionMarker();
        this.updateStats(0, 0);
    }

    private async setRendererBackend(
        preference: TerrainRendererBackendPreference,
        options: { persistState?: boolean; announceStatus?: boolean } = {},
    ) {
        if (!this.containerEl) return;

        const persistState = options.persistState ?? true;
        const announceStatus = options.announceStatus ?? true;
        const currentRenderer = this.renderer;
        const currentBackend = currentRenderer ? this.getActiveRendererBackend(currentRenderer) : null;
        const isSameExplicitBackend =
            preference !== 'auto' &&
            currentRenderer &&
            currentBackend === preference &&
            this.rendererBackendPreference === preference &&
            this.rendererReady;
        if (isSameExplicitBackend) {
            return;
        }

        const token = ++this.rendererSwapToken;
        const reloadState = this.loadedWorldNumber !== null ? this.getCurrentState() : null;
        const worldToReload = reloadState?.lastWorldNumber ?? null;
        const previousDomElement = currentRenderer?.domElement ?? null;

        this.rendererBackendPreference = preference;
        if (this.rendererBackendSelectEl && this.rendererBackendSelectEl.value !== preference) {
            this.rendererBackendSelectEl.value = preference;
        }
        this.rendererReady = false;
        this.updateRendererStatus(`Renderer: switching to ${preference === 'auto' ? 'Auto' : preference}…`);

        if (worldToReload !== null) {
            this.pendingRestoreState = { ...reloadState!, availableWorldNumbers: [...reloadState!.availableWorldNumbers] };
            this.clearWorldScene();
        }

        let renderer = await this.createPreferredRenderer(preference);
        this.configureRenderer(renderer);
        let fallbackReason: string | null = null;

        if (!isWebGLRenderer(renderer)) {
            try {
                await renderer.init();
            } catch (error) {
                fallbackReason = error instanceof Error ? error.message : 'WebGPU initialization failed';
                renderer.dispose();
                renderer = this.createClassicWebGLRenderer();
                this.configureRenderer(renderer);
            }
        }

        if (token !== this.rendererSwapToken) {
            renderer.dispose();
            return;
        }

        if (this.controls) {
            this.controls.dispose();
        }
        this.disposeTransformControls();
        if (previousDomElement?.parentElement === this.containerEl) {
            previousDomElement.parentElement.removeChild(previousDomElement);
        }

        this.containerEl.appendChild(renderer.domElement);
        this.attachControls(renderer.domElement);
        this.attachTransformControls(renderer.domElement);
        this.attachCanvasPointerEvents(renderer.domElement);

        currentRenderer?.dispose();
        this.renderer = renderer;
        this.rendererActiveBackend = this.getActiveRendererBackend(renderer);
        this.setBrightness(parseFloat(this.brightnessSliderEl?.value || `${TERRAIN_BRIGHTNESS_DEFAULT}`) || TERRAIN_BRIGHTNESS_DEFAULT);

        if (worldToReload !== null) {
            await this.loadWorld(worldToReload);
        }
        if (token !== this.rendererSwapToken) {
            return;
        }

        this.rendererReady = true;

        if (announceStatus) {
            if (fallbackReason) {
                this.setStatusMessage(`World Viewer WebGPU init failed, using WebGL. ${fallbackReason}`);
            } else if (preference !== 'webgl') {
                this.setStatusMessage(`World Viewer renderer: ${this.rendererActiveBackend === 'webgpu' ? 'WebGPU' : 'WebGL fallback'} ready.`);
            }
        }

        this.updateRendererStatus(
            fallbackReason
                ? `Renderer: WebGL fallback active (${fallbackReason})`
                : undefined,
        );

        if (persistState) {
            this.emitStateChanged();
        }
    }

    private initThree() {
        const container = document.getElementById('terrain-canvas-container');
        if (!container) return;
        this.containerEl = container;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.transformProxy.name = 'terrain_object_transform_proxy';
        this.transformProxy.visible = false;
        this.scene.add(this.transformProxy);

        this.terrainAttOverlay = new TerrainAttOverlay(this.scene);
        const overlayMesh = this.terrainAttOverlay.getWorldMesh();
        if (overlayMesh) {
            this.scene.add(overlayMesh);
        }

        const worldCenter = (TERRAIN_SIZE * TERRAIN_SCALE) / 2;

        this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 10, 100000);
        this.camera.position.set(worldCenter, 5000, worldCenter + 5000);
        this.timer.connect(document);
        void this.setRendererBackend(this.rendererBackendPreference, { persistState: false, announceStatus: false });

        this.ambientLight = new THREE.AmbientLight(0xffffff, TERRAIN_BASE_AMBIENT_INTENSITY);
        this.sunLight = new THREE.DirectionalLight(0xfff8e0, TERRAIN_BASE_SUN_INTENSITY);
        const sunAzimuth = worldCenter * 0.65;
        this.sunLight.position.set(
            worldCenter - sunAzimuth,
            worldCenter * 0.65,
            worldCenter + sunAzimuth * 0.45,
        );
        this.sunLight.target.position.set(worldCenter, 0, worldCenter);
        this.scene.add(this.ambientLight, this.sunLight, this.sunLight.target);
        this.terrainGrid = new THREE.GridHelper(TERRAIN_WORLD_SIZE, TERRAIN_SIZE, 0x5b6470, 0x28303a);
        this.terrainGrid.position.set(worldCenter, 2, worldCenter);
        this.terrainGrid.visible = false;
        this.terrainGrid.name = 'terrain_edit_grid';
        this.scene.add(this.terrainGrid);

        this.selectionMarker = new THREE.Mesh(
            new THREE.RingGeometry(0.7, 1, 48),
            new THREE.MeshBasicMaterial({
                color: 0x31d7ff,
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide,
                depthWrite: false,
            }),
        );
        this.selectionMarker.rotation.x = -Math.PI / 2;
        this.selectionMarker.visible = false;
        this.selectionMarker.renderOrder = 12;
        this.scene.add(this.selectionMarker);

        this.selectionBoundingBoxHelper = new THREE.Box3Helper(this.selectionBoundingBox, 0xffff00);
        this.selectionBoundingBoxHelper.name = 'terrain_object_bbox_helper';
        this.selectionBoundingBoxHelper.visible = false;
        this.selectionBoundingBoxHelper.renderOrder = 13;
        this.scene.add(this.selectionBoundingBoxHelper);

        window.addEventListener('resize', () => {
            if (!this.containerEl) return;
            const w = container.clientWidth || 1;
            const h = container.clientHeight || 1;
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            if (this.renderer) {
                this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, TERRAIN_MAX_PIXEL_RATIO));
                this.renderer.setSize(w, h);
            }
            this.minimapNeedsRedraw = true;
        });
    }

    private initUI() {
        const dropZone = document.getElementById('terrain-data-drop-zone');
        const folderInput = document.getElementById('terrain-data-folder-input') as HTMLInputElement | null;
        this.statusEl = document.getElementById('terrain-status');
        this.worldSelectEl = document.getElementById('terrain-world-select') as HTMLSelectElement | null;
        this.rendererBackendSelectEl = document.getElementById('terrain-renderer-backend') as HTMLSelectElement | null;
        this.rendererBackendStatusEl = document.getElementById('terrain-renderer-status');
        this.wireframeEl = document.getElementById('terrain-wireframe') as HTMLInputElement | null;
        this.showObjectsEl = document.getElementById('terrain-show-objects') as HTMLInputElement | null;
        this.animationsEnabledEl = document.getElementById('terrain-animations-enabled') as HTMLInputElement | null;
        this.sunEnabledEl = document.getElementById('terrain-sun-enabled') as HTMLInputElement | null;
        this.terrainLightColorEl = document.getElementById('terrain-light-color') as HTMLInputElement | null;
        this.terrainLightIntensityEl = document.getElementById('terrain-light-intensity') as HTMLInputElement | null;
        this.brightnessSliderEl = document.getElementById('terrain-brightness-slider') as HTMLInputElement | null;
        this.brightnessLabelEl = document.getElementById('terrain-brightness-label');
        this.objectDistanceSliderEl = document.getElementById('terrain-object-distance-slider') as HTMLInputElement | null;
        this.objectDistanceLabelEl = document.getElementById('terrain-object-distance-label');
        this.minimapCanvas = document.getElementById('terrain-minimap-canvas') as HTMLCanvasElement | null;
        this.minimapContext = this.minimapCanvas?.getContext('2d') || null;
        this.jumpXEl = document.getElementById('terrain-jump-x') as HTMLInputElement | null;
        this.jumpZEl = document.getElementById('terrain-jump-z') as HTMLInputElement | null;
        this.bookmarkNameEl = document.getElementById('terrain-bookmark-name') as HTMLInputElement | null;
        this.bookmarkStatusEl = document.getElementById('terrain-bookmark-status');
        this.objectDetailsEl = document.getElementById('terrain-object-details');
        this.objectEmptyEl = document.getElementById('terrain-object-empty');
        this.objectWorldEl = document.getElementById('terrain-selected-world');
        this.objectTypeEl = document.getElementById('terrain-selected-type');
        this.objectModelEl = document.getElementById('terrain-selected-model');
        this.objectPositionEl = document.getElementById('terrain-selected-position');
        this.objectRotationEl = document.getElementById('terrain-selected-rotation');
        this.objectScaleEl = document.getElementById('terrain-selected-scale');
        this.objectCopyXEl = document.getElementById('terrain-object-copy-x') as HTMLInputElement | null;
        this.objectCopyYEl = document.getElementById('terrain-object-copy-y') as HTMLInputElement | null;
        this.objectCopyZEl = document.getElementById('terrain-object-copy-z') as HTMLInputElement | null;
        this.objectTransformGizmoControlsEl = document.getElementById('terrain-transform-gizmo-controls');
        this.transformModeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.terrain-transform-mode-btn'));
        this.openModelBtn = document.getElementById('terrain-open-model-btn') as HTMLButtonElement | null;
        this.openModelHintEl = document.getElementById('terrain-open-model-hint');
        this.objectEditorPanelEl = document.getElementById('terrain-object-editor-panel');
        this.objectEditorTitleEl = document.getElementById('terrain-editor-title');
        this.objectEditorMetaEl = document.getElementById('terrain-editor-meta');
        this.objectEditorCloseBtn = document.getElementById('terrain-editor-close-btn') as HTMLButtonElement | null;
        this.objectEditorPosXEl = document.getElementById('terrain-editor-pos-x') as HTMLInputElement | null;
        this.objectEditorPosYEl = document.getElementById('terrain-editor-pos-y') as HTMLInputElement | null;
        this.objectEditorPosZEl = document.getElementById('terrain-editor-pos-z') as HTMLInputElement | null;
        this.objectEditorScaleEl = document.getElementById('terrain-editor-scale') as HTMLInputElement | null;
        this.objectEditorApplyTransformBtn = document.getElementById('terrain-editor-apply-transform-btn') as HTMLButtonElement | null;
        this.objectEditorMaterialsEl = document.getElementById('terrain-editor-materials');
        this.objectEditorSaveBtn = document.getElementById('terrain-editor-save-btn') as HTMLButtonElement | null;
        this.objectEditorExportBtn = document.getElementById('terrain-export-world-obj-btn') as HTMLButtonElement | null;
        this.objectEditorResetBtn = document.getElementById('terrain-editor-reset-btn') as HTMLButtonElement | null;
        this.objectEditorStatusEl = document.getElementById('terrain-editor-status');
        this.removeObjectBtn = document.getElementById('terrain-remove-object-btn') as HTMLButtonElement | null;
        this.objectPreviewCanvas = document.getElementById('terrain-object-preview-canvas') as HTMLCanvasElement | null;
        this.initializeObjectPreview();
        this.lastContextEl = document.getElementById('terrain-last-context');
        this.tileCountEl = document.getElementById('terrain-tile-count');
        this.objectCountEl = document.getElementById('terrain-object-count');
        this.terrainAttributeStatusEl = document.getElementById('terrain-attribute-status');
        this.terrainAttributeVersionEl = document.getElementById('terrain-attribute-version');
        this.terrainAttributeIndexEl = document.getElementById('terrain-attribute-index');
        this.terrainAttributeDimensionsEl = document.getElementById('terrain-attribute-dimensions');
        this.terrainAttributeFormatEl = document.getElementById('terrain-attribute-format');
        this.terrainAttributeTilesEl = document.getElementById('terrain-attribute-tiles');
        this.terrainAttributeOccupiedEl = document.getElementById('terrain-attribute-occupied');
        this.terrainAttributeLegendEl = document.getElementById('terrain-attribute-legend');
        this.attOverlayToggleBtn = document.getElementById('att-overlay-toggle') as HTMLButtonElement | null;
        this.terrainTileXEl = document.getElementById('terrain-tile-x') as HTMLInputElement | null;
        this.terrainTileZEl = document.getElementById('terrain-tile-z') as HTMLInputElement | null;
        this.terrainLayer1El = document.getElementById('terrain-layer1-select') as HTMLSelectElement | null;
        this.terrainLayer2El = document.getElementById('terrain-layer2-select') as HTMLSelectElement | null;
        this.terrainTexturePaletteEl = document.getElementById('terrain-texture-palette');
        this.terrainAlphaEl = document.getElementById('terrain-alpha-slider') as HTMLInputElement | null;
        this.terrainTileStatusEl = document.getElementById('terrain-tile-status');
        this.terrainObjectSelectEl = document.getElementById('terrain-object-select') as HTMLSelectElement | null;
        this.terrainObjectImportInputEl = document.getElementById('terrain-object-import-input') as HTMLInputElement | null;
        this.terrainImportPreviewSelectEl = document.getElementById('terrain-import-preview-select') as HTMLSelectElement | null;
        this.attTileXEl = document.getElementById('att-editor-x') as HTMLInputElement | null;
        this.attTileZEl = document.getElementById('att-editor-z') as HTMLInputElement | null;
        this.attEditorStatusEl = document.getElementById('att-editor-status');
        this.attBrushEnabledEl = document.getElementById('att-brush-enabled') as HTMLInputElement | null;
        this.attBrushSizeEl = document.getElementById('att-brush-size') as HTMLInputElement | null;
        this.attBrushSizeValueEl = document.getElementById('att-brush-size-value');
        this.terrainHeightEnabledEl = document.getElementById('terrain-height-enabled') as HTMLInputElement | null;
        this.terrainHeightStrengthEl = document.getElementById('terrain-height-strength') as HTMLInputElement | null;
        this.terrainHeightModeEl = document.getElementById('terrain-height-mode') as HTMLSelectElement | null;
        this.terrainLightPaintEnabledEl = document.getElementById('terrain-light-paint-enabled') as HTMLInputElement | null;
        this.terrainTileBrushEnabledEl = document.getElementById('terrain-tile-brush-enabled') as HTMLInputElement | null;
        this.terrainTileBrushSizeEl = document.getElementById('terrain-tile-brush-size') as HTMLInputElement | null;
        this.terrainTileBrushSizeValueEl = document.getElementById('terrain-tile-brush-size-value');
        this.terrainBrushHardnessEl = document.getElementById('terrain-brush-hardness') as HTMLInputElement | null;
        this.terrainBrushStrengthEl = document.getElementById('terrain-brush-strength') as HTMLInputElement | null;
        this.terrainHeightSmoothEl = document.getElementById('terrain-height-smooth') as HTMLInputElement | null;
        this.terrainPaintLayerEl = document.getElementById('terrain-paint-layer') as HTMLSelectElement | null;
        this.terrainGridEl = document.getElementById('terrain-grid-enabled') as HTMLInputElement | null;
        this.characterPlayStatusEl = document.getElementById('terrain-character-test-status');
        this.characterPlayExitBtn = document.getElementById('terrain-character-exit-btn') as HTMLButtonElement | null;
        this.characterPlayAnimationSelect = document.getElementById('terrain-character-animation-select') as HTMLSelectElement | null;
        this.characterPlayAnimationSelect?.addEventListener('change', () => {
            const index = Number(this.characterPlayAnimationSelect?.value);
            if (Number.isInteger(index)) this.playCharacterPlayAnimation(index);
        });
        this.initializeZoneEditor();
        this.bindAdvancedMapTools();
        this.attFlagEls.clear();
        document.querySelectorAll<HTMLInputElement>('[data-att-editor-flag]').forEach(input => {
            const flag = Number(input.dataset.attEditorFlag);
            if (Number.isInteger(flag)) this.attFlagEls.set(flag as TWFlags, input);
        });
        this.attBrushSizeEl?.addEventListener('input', () => {
            this.attBrushRadiusTiles = Number(this.attBrushSizeEl?.value || 2);
            if (this.attBrushSizeValueEl) this.attBrushSizeValueEl.textContent = `${this.attBrushRadiusTiles} tiles`;
            this.updateAttBrushCursor();
        });
        this.attBrushEnabledEl?.addEventListener('change', () => {
            if (this.attBrushCursor) this.attBrushCursor.visible = this.attBrushEnabledEl?.checked === true;
            this.updateAttBrushCursor();
        });
        this.terrainTileBrushEnabledEl?.addEventListener('change', () => this.updateAttBrushCursor());
        this.terrainTileBrushSizeEl?.addEventListener('input', () => {
            this.attBrushRadiusTiles = Number(this.terrainTileBrushSizeEl?.value || 2);
            if (this.terrainTileBrushSizeValueEl) this.terrainTileBrushSizeValueEl.textContent = `${this.attBrushRadiusTiles} tiles`;
            this.updateAttBrushCursor();
        });
        this.terrainHeightEnabledEl?.addEventListener('change', () => this.updateAttBrushCursor());
        this.terrainLightPaintEnabledEl?.addEventListener('change', () => this.updateAttBrushCursor());
        this.terrainGridEl?.addEventListener('change', () => {
            if (this.terrainGrid) this.terrainGrid.visible = this.terrainGridEl?.checked === true;
        });
        document.querySelectorAll<HTMLElement>('.terrain-history-undo').forEach(button => {
            button.addEventListener('click', () => {
                if (button.closest('#terrain-object-section')) this.undoObjectEdit();
                else this.undoTerrainEdit();
            });
        });
        document.querySelectorAll<HTMLElement>('.terrain-history-redo').forEach(button => {
            button.addEventListener('click', () => {
                if (button.closest('#terrain-object-section')) this.redoObjectEdit();
                else this.redoTerrainEdit();
            });
        });
        this.terrainGridEl?.addEventListener('change', () => {
            if (this.terrainGrid) this.terrainGrid.visible = this.terrainGridEl?.checked === true;
        });
        this.populateTerrainTextureOptions();
        void this.renderTerrainTexturePalette();
        for (const select of [this.terrainLayer1El, this.terrainLayer2El]) {
            select?.addEventListener('change', () => {
                if (this.terrainTileBrushEnabledEl) {
                    this.terrainTileBrushEnabledEl.checked = true;
                }
            });
        }
        this.updateTerrainAttributePanel(null);

        if (this.attOverlayToggleBtn) {
            this.attOverlayToggleBtn.addEventListener('click', () => {
                if (this.terrainAttOverlay) {
                    const isCurrentlyVisible = this.terrainAttOverlay.isVisible();
                    this.terrainAttOverlay.setVisible(!isCurrentlyVisible);
                    this.attOverlayToggleBtn!.textContent = isCurrentlyVisible ? 'Show ATT Overlay' : 'Hide ATT Overlay';
                }
            });
        }

        if (dropZone && folderInput) {
            dropZone.addEventListener('click', () => {
                if (isElectron()) {
                    void this.handleDataSelectElectron();
                } else {
                    folderInput.click();
                }
            });

            folderInput.addEventListener('change', () => {
                if (folderInput.files && folderInput.files.length > 0) {
                    this.handleDataFiles(folderInput.files);
                }
            });

            dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-hover'); });
            dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-hover'));
            dropZone.addEventListener('drop', e => {
                e.preventDefault();
                dropZone.classList.remove('drag-hover');
                if (e.dataTransfer?.files) {
                    this.handleDataFiles(e.dataTransfer.files);
                }
            });
        }

        const loadBtn = document.getElementById('terrain-load-world-btn');
        loadBtn?.addEventListener('click', () => {
            const value = this.worldSelectEl?.value;
            if (value) {
                void this.loadWorld(parseInt(value, 10));
            }
        });

        if (this.rendererBackendSelectEl) {
            this.rendererBackendSelectEl.value = this.rendererBackendPreference;
            this.rendererBackendSelectEl.addEventListener('change', () => {
                const value = this.rendererBackendSelectEl?.value === 'webgpu' || this.rendererBackendSelectEl?.value === 'webgl'
                    ? this.rendererBackendSelectEl.value
                    : 'auto';
                void this.setRendererBackend(value, { persistState: true });
            });
        }
        this.updateRendererStatus();

        this.wireframeEl?.addEventListener('change', () => {
            if (this.terrainMesh) {
                this.forEachTerrainMaterial(this.terrainMesh, material => {
                    const terrainMaterial = material as THREE.Material & { wireframe?: boolean };
                    if ('wireframe' in terrainMaterial) {
                        terrainMaterial.wireframe = this.wireframeEl?.checked ?? false;
                        terrainMaterial.needsUpdate = true;
                    }
                });
            }
            this.emitStateChanged();
        });

        window.addEventListener('keydown', (e) => {
            if (!this.terrainMesh || !this.isActive) return;
            if (!this.isEditableShortcutTarget(e.target) && e.ctrlKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                this.undoTerrainEdit();
                return;
            }
            if (!this.isEditableShortcutTarget(e.target) && e.ctrlKey && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                this.redoTerrainEdit();
                return;
            }
            if (this.selectedObjectRecord && !this.isEditableShortcutTarget(e.target)) {
                if (e.key.toLowerCase() === 't') {
                    this.setTransformControlMode('translate');
                    e.preventDefault();
                    return;
                }
                if (e.key.toLowerCase() === 'r') {
                    this.setTransformControlMode('rotate');
                    e.preventDefault();
                    return;
                }
            }
            const key = parseInt(e.key, 10);
            if (key >= 0 && key <= 4) {
                const mat = this.terrainMesh.material;
                if (mat instanceof THREE.ShaderMaterial) {
                    mat.uniforms.uDebugMode.value = key;
                    console.log(`[TERRAIN] Debug mode: ${key} (0=normal, 1=layer1, 2=layer2, 3=alpha, 4=atlasUV)`);
                }
            }
        });

        for (const button of this.transformModeButtons) {
            button.addEventListener('click', () => {
                const mode = button.dataset.terrainTransformMode === 'rotate' ? 'rotate' : 'translate';
                this.setTransformControlMode(mode);
            });
        }

        this.showObjectsEl?.addEventListener('change', () => {
            if (this.objectsGroup) {
                this.objectsGroup.visible = this.showObjectsEl?.checked ?? true;
                if (this.objectsGroup.visible) {
                    this.updateObjectDistanceCulling(true);
                }
            }
            this.emitStateChanged();
        });

        this.animationsEnabledEl?.addEventListener('change', () => {
            this.animationsEnabled = this.animationsEnabledEl?.checked ?? true;
            this.emitStateChanged();
        });

        this.sunEnabledEl?.addEventListener('change', () => {
            if (this.sunLight) {
                this.sunLight.visible = this.sunEnabledEl?.checked ?? true;
            }
            this.emitStateChanged();
        });
        this.terrainLightColorEl?.addEventListener('input', () => {
            this.sunLight?.color.set(this.terrainLightColorEl!.value);
        });
        this.terrainLightIntensityEl?.addEventListener('input', () => {
            if (this.sunLight) this.sunLight.intensity = Number(this.terrainLightIntensityEl!.value);
        });

        if (this.brightnessSliderEl && this.brightnessLabelEl) {
            this.brightnessSliderEl.addEventListener('input', (e) => {
                const value = parseFloat((e.target as HTMLInputElement).value);
                this.brightnessLabelEl!.textContent = `Brightness: ${value.toFixed(2)}×`;
                this.setBrightness(value);
                this.emitStateChanged();
            });
            const initialBrightness = parseFloat(this.brightnessSliderEl.value) || TERRAIN_BRIGHTNESS_DEFAULT;
            this.brightnessLabelEl.textContent = `Brightness: ${initialBrightness.toFixed(2)}×`;
            this.setBrightness(initialBrightness);
        }

        if (this.objectDistanceSliderEl && this.objectDistanceLabelEl) {
            this.objectDistanceSliderEl.addEventListener('input', (e) => {
                const value = parseFloat((e.target as HTMLInputElement).value);
                this.objectDrawDistance = Math.max(500, value);
                this.objectDistanceLabelEl!.textContent = `Object Distance: ${Math.round(this.objectDrawDistance)}`;
                this.updateObjectDistanceCulling(true);
                this.emitStateChanged();
            });
            const initialDistance = parseFloat(this.objectDistanceSliderEl.value) || TERRAIN_OBJECT_DRAW_DISTANCE_DEFAULT;
            this.objectDrawDistance = Math.max(500, initialDistance);
            this.objectDistanceLabelEl.textContent = `Object Distance: ${Math.round(this.objectDrawDistance)}`;
        }

        this.minimapCanvas?.addEventListener('click', event => {
            if (!this.minimapCanvas) return;
            const rect = this.minimapCanvas.getBoundingClientRect();
            const worldPoint = minimapPointToWorld(
                event.clientX - rect.left,
                event.clientY - rect.top,
                rect.width,
                rect.height,
                TERRAIN_WORLD_SIZE,
            );
            this.jumpToCoordinates(worldPoint.x, worldPoint.z);
        });

        document.getElementById('terrain-jump-btn')?.addEventListener('click', () => {
            const x = parseFloat(this.jumpXEl?.value || '0');
            const z = parseFloat(this.jumpZEl?.value || '0');
            this.jumpToCoordinates(x, z);
        });

        document.getElementById('terrain-save-bookmark-btn')?.addEventListener('click', () => {
            const bookmark = this.createCurrentBookmark(this.bookmarkNameEl?.value || '');
            if (!bookmark) return;
            this.onBookmarkCreated?.(bookmark);
            if (this.bookmarkNameEl) {
                this.bookmarkNameEl.value = '';
            }
            this.setBookmarkStatus(`Saved "${bookmark.name}".`);
        });

        document.getElementById('terrain-focus-object-btn')?.addEventListener('click', () => {
            this.focusSelectedObject();
        });
        document.getElementById('terrain-duplicate-object-btn')?.addEventListener('click', () => {
            this.duplicateSelectedObject();
        });
        document.addEventListener('pointerup', event => {
            const target = event.target instanceof Element
                ? event.target.closest<HTMLButtonElement>('#terrain-duplicate-object-at-coords-btn, #terrain-add-object-at-coords-btn')
                : null;
            if (!target) return;

            event.preventDefault();
            event.stopPropagation();
            const action = target.id === 'terrain-add-object-at-coords-btn' ? 'added' : 'duplicated';
            this.setObjectEditorStatus('Processing object copy...');
            this.duplicateSelectedObjectAtEnteredCoordinates(action);
        }, true);
        document.getElementById('terrain-add-object-btn')?.addEventListener('click', () => {
            if (this.pendingImportedResult && this.pendingImportedData && this.pendingImportedFiles) {
                this.commitPendingImportedObjects();
            } else {
                this.addSelectedObjectAtCamera();
            }
        });
        document.getElementById('terrain-isolate-object-btn')?.addEventListener('click', () => {
            this.isolateSelectedObject();
        });
        document.getElementById('terrain-reset-isolate-btn')?.addEventListener('click', () => {
            this.resetObjectIsolation();
        });
        this.openModelBtn?.addEventListener('click', () => {
            if (!this.selectedObjectRecord) return;
            this.onOpenModelRequest?.(this.selectedObjectRecord.selection, this.selectedObjectRecord.modelFile);
        });
        this.objectEditorCloseBtn?.addEventListener('click', () => this.closeObjectEditorPanel());
        this.objectEditorApplyTransformBtn?.addEventListener('click', () => this.applyObjectEditorTransform());
        this.objectEditorSaveBtn?.addEventListener('click', () => { void this.saveSelectedObjectTypeSettings(); });
        this.objectEditorExportBtn?.addEventListener('click', () => { void this.exportCurrentWorldObj(); });
        this.objectEditorResetBtn?.addEventListener('click', () => { void this.resetSelectedObjectTypeSettings(); });
        this.removeObjectBtn?.addEventListener('click', () => this.removeSelectedObject());
        document.getElementById('terrain-apply-tile-btn')?.addEventListener('click', () => this.applyTerrainTile());
        document.getElementById('terrain-export-map-btn')?.addEventListener('click', () => { void this.exportCurrentWorldData(); });
        this.terrainObjectSelectEl?.addEventListener('change', () => {
            const record = this.objectRecords.find(candidate => candidate.selection.objectId === this.terrainObjectSelectEl?.value);
            if (record) this.selectObjectRecord(record);
            else this.clearSelection();
        });
        document.getElementById('terrain-object-import-btn')?.addEventListener('click', () => this.terrainObjectImportInputEl?.click());
        this.terrainObjectImportInputEl?.addEventListener('change', () => {
            if (this.terrainObjectImportInputEl?.files) {
                void this.importTerrainObjects(this.terrainObjectImportInputEl.files);
            }
        });
        this.terrainImportPreviewSelectEl?.addEventListener('change', () => {
            const index = Number(this.terrainImportPreviewSelectEl?.value);
            const record = this.pendingImportedResult?.records[index];
            if (record) this.updateObjectPreview(record);
        });
        document.getElementById('att-editor-select-btn')?.addEventListener('click', () => this.selectAttTileFromInputs());
        document.getElementById('att-editor-apply-btn')?.addEventListener('click', () => this.applyAttTile());
        document.getElementById('att-editor-export-btn')?.addEventListener('click', () => { void this.exportCurrentAtt(); });
        document.getElementById('att-server-export-btn')?.addEventListener('click', () => { void this.exportServerAtt(); });

        window.addEventListener('keydown', (e) => this.handleMovementKey(e, true));
        window.addEventListener('keyup', (e) => this.handleMovementKey(e, false));
        window.addEventListener('blur', () => this.resetMovementKeys());

        this.updateObjectInspector();
        if (this.controls) {
            this.updateCoordinateInputs(this.controls.target.x, this.controls.target.z);
        }
    }

    /** Electron: open native directory dialog and load */
    private async handleDataSelectElectron() {
        const folderPath = await openDirectoryDialog();
        if (folderPath) {
            this.clearWorldScene();
            this.availableWorldNumbers = [];
            this.worldSelectEl?.replaceChildren();
            document.getElementById('terrain-world-selector')?.classList.add('initially-hidden');
            this.dataRootPath = folderPath;
            this.dataFiles.clear();
            if (this.statusEl) this.statusEl.textContent = 'Scanning Data folder...';

            let worldNumbers: number[];
            try {
                worldNumbers = await scanWorldFolders(folderPath);
            } catch (error) {
                console.error('Failed to scan world folders:', error);
                const message = (error as Error)?.message || String(error);
                if (this.statusEl) {
                    if (message.includes("No handler registered for 'fs:scanWorldFolders'")) {
                        this.statusEl.textContent = 'Electron backend is outdated. Restart the desktop app.';
                    } else {
                        this.statusEl.textContent = `Error scanning Data folder: ${message}`;
                    }
                }
                return;
            }

            if (worldNumbers.length === 0) {
                if (this.statusEl) this.statusEl.textContent = `No World folders found in Data: ${folderPath}`;
                return;
            }

            this.availableWorldNumbers = worldNumbers;
            if (this.statusEl) this.statusEl.textContent = `Found ${worldNumbers.length} world(s). Select one to load.`;
            this.populateWorldSelect(worldNumbers);
            await this.loadWorld(this.pickInitialWorldToLoad(worldNumbers));
        }
    }

    /** Browser: handle dropped / selected Data folder files */
    private handleDataFiles(fileList: FileList) {
        if (this.statusEl) this.statusEl.textContent = 'Scanning Data folder...';

        this.clearWorldScene();
        this.availableWorldNumbers = [];
        this.worldSelectEl?.replaceChildren();
        document.getElementById('terrain-world-selector')?.classList.add('initially-hidden');
        this.dataFiles.clear();
        this.dataRootPath = null;

        // Determine root folder name from first file's webkitRelativePath
        const firstPath = ((fileList[0] as any).webkitRelativePath as string) || fileList[0].name;
        const rootName = firstPath.split('/')[0];

        for (let i = 0; i < fileList.length; i++) {
            const f = fileList[i];
            const rel = ((f as any).webkitRelativePath as string) || f.name;
            // Strip the root folder prefix (e.g. "Data/World1/..." → "World1/...")
            const trimmed = rel.startsWith(rootName + '/') ? rel.slice(rootName.length + 1) : rel;
            this.dataFiles.set(trimmed.toLowerCase(), f);
        }

        // Scan for World{N}/ subfolders
        const worldNumbers = this.scanWorldNumbers();

        if (worldNumbers.length === 0) {
            if (this.statusEl) this.statusEl.textContent = 'No World folders found in Data.';
            return;
        }

        this.availableWorldNumbers = worldNumbers;
        if (this.statusEl) this.statusEl.textContent = `Found ${worldNumbers.length} world(s). Select one to load.`;
        this.populateWorldSelect(worldNumbers);

        void this.loadWorld(this.pickInitialWorldToLoad(worldNumbers));
    }

    /** Scan dataFiles keys for world{N}/ prefixes */
    private scanWorldNumbers(): number[] {
        const worlds = new Set<number>();
        for (const key of this.dataFiles.keys()) {
            const match = key.match(/^world(\d+)\//);
            if (match) worlds.add(parseInt(match[1], 10));
        }
        return [...worlds].sort((a, b) => a - b);
    }

    private pickInitialWorldToLoad(worldNumbers: number[]): number {
        const preferred = this.pendingRestoreState?.lastWorldNumber;
        if (preferred !== null && preferred !== undefined && worldNumbers.includes(preferred)) {
            return preferred;
        }
        return worldNumbers[0];
    }

    /** Populate the world dropdown and show it */
    private populateWorldSelect(worldNumbers: number[]) {
        const container = document.getElementById('terrain-world-selector');
        if (!this.worldSelectEl || !container) return;

        this.worldSelectEl.innerHTML = '';
        for (const n of worldNumbers) {
            const opt = document.createElement('option');
            opt.value = n.toString();
            opt.textContent = `World ${n}`;
            this.worldSelectEl.appendChild(opt);
        }

        container.classList.remove('initially-hidden');
    }

    /** Load a specific world by number */
    private async loadWorld(worldNumber: number) {
        const loadToken = ++this.worldLoadToken;
        const isCurrent = () => loadToken === this.worldLoadToken;

        if (this.statusEl) this.statusEl.textContent = `Loading World ${worldNumber}...`;
        this.clearSelection();
        this.resetObjectIsolation();

        if (this.worldSelectEl) {
            this.worldSelectEl.value = worldNumber.toString();
        }

        let files = this.buildWorldFiles(worldNumber);
        if (files.size === 0 && this.dataRootPath && isElectron()) {
            if (this.statusEl) this.statusEl.textContent = `Loading World ${worldNumber} files from disk...`;
            try {
                files = await this.loadWorldFilesFromElectron(worldNumber);
                if (!isCurrent()) return;
            } catch (error) {
                if (!isCurrent()) return;
                console.error('Failed to load world files from Electron:', error);
                const message = (error as Error)?.message || String(error);
                if (this.statusEl) {
                    if (message.includes("No handler registered for 'fs:readTerrainWorldFiles'")) {
                        this.statusEl.textContent = 'Electron backend is outdated. Restart the desktop app.';
                    } else {
                        this.statusEl.textContent = `Error loading World ${worldNumber} files: ${message}`;
                    }
                }
                return;
            }
        }

        if (!isCurrent()) return;
        if (files.size === 0) {
            if (this.statusEl) this.statusEl.textContent = `No files found for World ${worldNumber}.`;
            return;
        }

        const normalizedFiles = new Map<string, File>();
        files.forEach((file, key) => {
            normalizedFiles.set(key.toLowerCase(), file);
        });

        let pendingTerrain: THREE.Mesh | null = null;
        let pendingObjects: THREE.Group | null = null;
        let committed = false;

        try {
            const result = await this.terrainLoader.load(files, {
                materialMode: this.rendererActiveBackend === 'webgpu' ? 'atlas-geometry' : 'shader',
            });
            pendingTerrain = result.mesh;

            if (!isCurrent()) {
                this.disposeTerrainObject(result.mesh);
                pendingTerrain = null;
                return;
            }

            let objectResult: TerrainObjectLoadResult | null = null;
            if (result.objectsData) {
                if (this.statusEl) this.statusEl.textContent = `World ${result.mapNumber} loaded. Loading objects...`;
                objectResult = await loadTerrainObjects(
                    result.objectsData,
                    files,
                    result.mapNumber,
                    (loaded, total) => {
                        if (isCurrent() && this.statusEl) {
                            this.statusEl.textContent = `Loading objects: ${loaded}/${total}...`;
                        }
                    },
                    {
                        animatedInstancingMode: getTerrainAnimatedInstancingModeForBackend(this.rendererActiveBackend),
                        enableInstancing: true,
                    },
                );
                pendingObjects = objectResult.group;
            }

            if (!isCurrent()) {
                this.disposeTerrainObject(result.mesh);
                pendingTerrain = null;
                if (objectResult) {
                    this.disposeTerrainObject(objectResult.group);
                    pendingObjects = null;
                }
                return;
            }

            // Commit the completed world atomically. Old resources stay visible
            // while the replacement is loading and are released only here.
            if (this.terrainMesh) {
                this.scene.remove(this.terrainMesh);
                this.disposeTerrainObject(this.terrainMesh);
            }
            if (this.objectsGroup) {
                this.scene.remove(this.objectsGroup);
                this.disposeTerrainObject(this.objectsGroup);
                this.clearObjectCullingIndex();
            }

            this.currentWorldFiles = normalizedFiles;
            this.terrainMesh = result.mesh;
            pendingTerrain = null;
            this.objectsGroup = objectResult?.group ?? null;
            pendingObjects = null;
            this.objectRecords = objectResult?.records ?? [];
            this.animatedObjectInstances = objectResult?.animatedInstances ?? [];
            this.loadedWorldNumber = result.mapNumber;
            void this.renderTerrainTexturePalette();
            this.loadedAttData = result.terrainAttributeData;
            this.loadedHeightData = result.heightData;
            this.loadedLightData = result.lightData;
            this.loadedAttFileName = this.findCurrentWorldAttFileName(result.mapNumber);
            this.loadedObjectsData = result.objectsData;
            this.loadedMapData = {
                version: result.mappingData.version,
                mapNumber: result.mappingData.mapNumber,
                layer1: new Uint8Array(result.mappingData.layer1),
                layer2: new Uint8Array(result.mappingData.layer2),
                alpha: new Uint8Array(result.mappingData.alpha),
            };
            this.loadedMapFileName = this.findCurrentWorldMapFileName(result.mapNumber);
            this.loadedObjFileName = this.findCurrentWorldObjFileName(result.mapNumber);
            this.duplicateObjectData.clear();
            committed = true;

            this.scene.add(this.terrainMesh);
            if (this.objectsGroup) {
                this.scene.add(this.objectsGroup);
            }

            this.applyTerrainTextureQuality();
            this.updateStats(this.getTerrainTileCount(result.mesh), result.objectsData?.objects.length ?? 0);
            this.updateTerrainObjectSelect();
            this.updateTerrainAttributePanel(summarizeTerrainAttributeData(result.terrainAttributeData));
            this.onAttDataChanged?.(result.terrainAttributeData, result.mapNumber);

            const worldCenter = (TERRAIN_SIZE * TERRAIN_SCALE) / 2;
            this.controls.target.set(worldCenter, 0, worldCenter);
            this.camera.position.set(worldCenter, 5000, worldCenter + 5000);

            if (this.objectsGroup) {
                this.applyPersistedObjectTypeOverridesForWorld(result.mapNumber);
                this.rebuildObjectCullingIndex();
                await this.prewarmTerrainObjectResources(this.objectsGroup);
                if (!isCurrent()) return;
                void this.prewarmTerrainObjectResourcesBackground(this.objectsGroup);

                if (this.showObjectsEl) {
                    this.objectsGroup.visible = this.showObjectsEl.checked;
                    if (this.showObjectsEl.checked) {
                        this.updateObjectDistanceCulling(true);
                    }
                }
            }

            if (!isCurrent()) return;
            this.updateTerrainMaterialState();
            this.buildMinimapSource();
            this.minimapNeedsRedraw = true;
            this.applyPendingRestoreState();
            this.updateSelectionMarker();
            this.scheduleCameraChangedEmit();
            this.onWorldLoaded?.(result.mapNumber, [...this.availableWorldNumbers]);
            this.emitStateChanged();

            if (this.statusEl) {
                const objectCount = result.objectsData?.objects.length ?? 0;
                this.statusEl.textContent = `World ${result.mapNumber} loaded. ${objectCount} objects.`;
            }
        } catch (error) {
            if (pendingTerrain) this.disposeTerrainObject(pendingTerrain);
            if (pendingObjects) this.disposeTerrainObject(pendingObjects);
            if (!isCurrent()) return;

            console.error('Terrain loading error:', error);
            if (this.statusEl) this.statusEl.textContent = `Error: ${(error as Error).message}`;
            if (!committed) {
                this.updateStats(0, 0);
            }
        }
    }

    /** Electron: read all files from Data/World{N} and Data/Object{N}. */
    private async loadWorldFilesFromElectron(worldNumber: number): Promise<Map<string, File>> {
        if (!this.dataRootPath) return new Map();

        const entries = await readTerrainWorldFiles(this.dataRootPath, worldNumber);
        const files = new Map<string, File>();
        for (const entry of entries) {
            files.set(entry.key.toLowerCase(), createFileFromElectronData(entry.name, entry.data));
        }
        return files;
    }

    /**
     * Build a files Map for the given world number.
     * Includes files from world{N}/ and object{N}/ subfolders.
     * Keys are relative paths (e.g. "world1/EncTerrain1.att").
     */
    private buildWorldFiles(worldNumber: number): Map<string, File> {
        const worldPrefix = `world${worldNumber}/`;
        const objectPrefix = `object${worldNumber}/`;
        const files = new Map<string, File>();

        for (const [key, file] of this.dataFiles) {
            if (key.startsWith(worldPrefix) || key.startsWith(objectPrefix)) {
                files.set(key, file);
            }
        }

        return files;
    }

    private async importTerrainObjects(fileList: FileList) {
        const status = document.getElementById('terrain-object-import-status');
        if (!this.objectsGroup || this.loadedWorldNumber === null || !this.loadedObjectsData) {
            if (status) status.textContent = 'Load a world before importing objects.';
            return;
        }

        const importedFiles = new Map<string, File>();
        for (const file of Array.from(fileList)) {
            const key = (file.webkitRelativePath || file.name).replace(/\\/g, '/').toLowerCase();
            importedFiles.set(key, file);
        }
        const bmdFiles = Array.from(importedFiles.values()).filter(file => /\.bmd$/i.test(file.name));
        if (bmdFiles.length === 0) {
            if (status) status.textContent = 'The selected folder does not contain BMD files.';
            return;
        }

        try {
            const files = new Map([...this.currentWorldFiles, ...importedFiles]);
            const startType = this.objectRecords.reduce((max, record) => Math.max(max, record.selection.type), -1) + 1;
            const target = this.controls.target;
            const importedObjects: MapObject[] = [];
            let type = startType;
            for (const bmdFile of bmdFiles) {
                const objectType = type++;
                const aliasKey = `object${this.loadedWorldNumber}/Object${String(objectType + 1).padStart(2, '0')}.bmd`;
                files.set(aliasKey, bmdFile);
                importedObjects.push({
                    type: objectType,
                    position: { x: target.x, y: TERRAIN_WORLD_SIZE - target.z, z: target.y },
                    angle: { x: 0, y: 0, z: 0 },
                    scale: 1,
                });
            }
            const importedData: OBJData = {
                version: this.loadedObjectsData.version,
                mapNumber: this.loadedWorldNumber,
                objects: importedObjects,
            };
            const objectResult = await loadTerrainObjects(
                importedData,
                files,
                this.loadedWorldNumber,
                undefined,
                {
                    animatedInstancingMode: getTerrainAnimatedInstancingModeForBackend(this.rendererActiveBackend),
                    enableInstancing: false,
                },
            );
            if (this.pendingImportedResult) {
                this.disposeTerrainObject(this.pendingImportedResult.group);
            }
            this.pendingImportedFiles = files;
            this.pendingImportedData = importedData;
            this.pendingImportedResult = objectResult;
            if (this.terrainImportPreviewSelectEl) {
                this.terrainImportPreviewSelectEl.innerHTML = '';
                objectResult.records.forEach((record, index) => {
                    const option = document.createElement('option');
                    option.value = String(index);
                    option.textContent = record.selection.displayName;
                    this.terrainImportPreviewSelectEl?.appendChild(option);
                });
                this.terrainImportPreviewSelectEl.value = String(Math.max(0, objectResult.records.length - 1));
                this.terrainImportPreviewSelectEl.classList.toggle('hidden', objectResult.records.length < 2);
            }
            const previewRecord = objectResult.records[objectResult.records.length - 1];
            if (previewRecord) this.updateObjectPreview(previewRecord);
            if (status) status.textContent = `Previewing ${importedData.objects.length} object(s). Rotate and zoom, then click Add preview to map.`;
        } catch (error) {
            if (status) status.textContent = `Object import failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    private commitPendingImportedObjects(): void {
        if (!this.pendingImportedResult || !this.pendingImportedData || !this.pendingImportedFiles || !this.objectsGroup || !this.loadedObjectsData) {
            return;
        }
        this.captureObjectEdit();
        const selectedIndex = Math.max(0, Number(this.terrainImportPreviewSelectEl?.value || 0));
        const selectedRecord = this.pendingImportedResult.records[selectedIndex];
        const selectedObject = this.pendingImportedData.objects[selectedIndex];
        if (!selectedRecord || !selectedObject) return;
        if (selectedRecord.object3D) {
            selectedRecord.object3D.parent?.remove(selectedRecord.object3D);
            this.objectsGroup.add(selectedRecord.object3D);
        }
        this.objectRecords.push(selectedRecord);
        this.loadedObjectsData.objects.push(selectedObject);
        const lastImportedRecord = selectedRecord;
        for (const record of this.pendingImportedResult.records) {
            if (record !== selectedRecord && record.object3D) {
                record.object3D.parent?.remove(record.object3D);
            }
        }
        this.disposeTerrainObject(this.pendingImportedResult.group);
        this.pendingImportedFiles = null;
        this.pendingImportedData = null;
        this.pendingImportedResult = null;
        this.terrainImportPreviewSelectEl?.classList.add('hidden');
        this.updateTerrainObjectSelect();
        if (lastImportedRecord) this.selectObjectRecord(lastImportedRecord);
        this.updateStats(this.getTerrainTileCount(this.terrainMesh!), this.objectRecords.length);
        const status = document.getElementById('terrain-object-import-status');
        if (status) status.textContent = 'Object added to the map.';
        this.emitStateChanged();
    }

    private findCurrentWorldObjFileName(worldNumber: number): string {
        for (const [key, file] of this.currentWorldFiles) {
            if (key.startsWith(`world${worldNumber}/`) && /\.obj$/i.test(key)) {
                return file.name || `EncTerrain${worldNumber}.obj`;
            }
        }
        return `EncTerrain${worldNumber}.obj`;
    }

    private findCurrentWorldMapFileName(worldNumber: number): string {
        for (const [key, file] of this.currentWorldFiles) {
            if (key.startsWith(`world${worldNumber}/`) && /\.map$/i.test(key)) {
                return file.name || `EncTerrain${worldNumber}.map`;
            }
        }
        return `EncTerrain${worldNumber}.map`;
    }

    private findCurrentWorldAttFileName(worldNumber: number): string {
        for (const [key, file] of this.currentWorldFiles) {
            if (key.startsWith(`world${worldNumber}/`) && /\.att$/i.test(key)) {
                return file.name || `EncTerrain${worldNumber}.att`;
            }
        }
        return `EncTerrain${worldNumber}.att`;
    }

    private selectAttTileFromInputs() {
        if (!this.loadedAttData) {
            if (this.attEditorStatusEl) this.attEditorStatusEl.textContent = 'Load a world with an ATT file first.';
            return;
        }
        const x = THREE.MathUtils.clamp(parseInt(this.attTileXEl?.value || '0', 10), 0, TERRAIN_SIZE - 1);
        const z = THREE.MathUtils.clamp(parseInt(this.attTileZEl?.value || '0', 10), 0, TERRAIN_SIZE - 1);
        const value = this.loadedAttData.terrainWall[z * TERRAIN_SIZE + x];
        this.attFlagEls.forEach((input, flag) => { input.checked = (value & flag) !== 0; });
        if (this.attEditorStatusEl) this.attEditorStatusEl.textContent = `Tile ${x}, ${z} selected. Flags: 0x${value.toString(16).padStart(4, '0').toUpperCase()}`;
    }

    private applyAttTile() {
        if (!this.loadedAttData) {
            if (this.attEditorStatusEl) this.attEditorStatusEl.textContent = 'Load a world with an ATT file first.';
            return;
        }
        this.beginTerrainEdit();
        const x = THREE.MathUtils.clamp(parseInt(this.attTileXEl?.value || '0', 10), 0, TERRAIN_SIZE - 1);
        const z = THREE.MathUtils.clamp(parseInt(this.attTileZEl?.value || '0', 10), 0, TERRAIN_SIZE - 1);
        let value = TWFlags.None;
        this.attFlagEls.forEach((input, flag) => {
            if (input.checked) value |= flag;
        });
        this.loadedAttData.terrainWall[z * TERRAIN_SIZE + x] = value;
        this.updateTerrainAttributePanel(summarizeTerrainAttributeData(this.loadedAttData));
        this.onAttDataChanged?.(this.loadedAttData, this.loadedWorldNumber ?? 0);
        if (this.attEditorStatusEl) this.attEditorStatusEl.textContent = `Tile ${x}, ${z} updated. Export ATT to save it.`;
    }

    private getTerrainHitAtClientPoint(clientX: number, clientY: number): THREE.Intersection | null {
        if (!this.terrainMesh) return null;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const terrainHit = this.raycaster.intersectObject(this.terrainMesh, true)[0];
        if (terrainHit) return terrainHit;

        // Keep editing usable when a terrain shader/geometry does not expose a
        // raycastable surface in the active renderer.
        const groundPoint = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
        if (!groundPoint) return null;
        return {
            distance: this.raycaster.ray.origin.distanceTo(groundPoint),
            point: groundPoint,
            object: this.terrainMesh,
        };
    }

    private updateAttBrushCursor(clientX?: number, clientY?: number) {
        if (!this.attBrushCursor) {
            const material = new THREE.MeshBasicMaterial({ color: 0x31d7ff, transparent: true, opacity: 0.85, depthTest: false });
            this.attBrushCursor = new THREE.Mesh(new THREE.RingGeometry(1, 1.08, 48), material);
            this.attBrushCursor.rotation.x = -Math.PI / 2;
            this.attBrushCursor.renderOrder = 20;
            this.attBrushCursor.visible = false;
            this.scene.add(this.attBrushCursor);
        }
        this.attBrushCursor.scale.setScalar(Math.max(0.5, this.attBrushRadiusTiles - 0.5) * TERRAIN_SCALE);
        const brushEnabled = this.attBrushEnabledEl?.checked === true
            || this.terrainTileBrushEnabledEl?.checked === true
            || this.terrainHeightEnabledEl?.checked === true
            || this.terrainLightPaintEnabledEl?.checked === true;
        const hasPaintData = this.loadedAttData !== null
            || this.loadedMapData !== null
            || this.loadedHeightData !== null
            || this.loadedLightData !== null;
        this.attBrushCursor.visible = brushEnabled && hasPaintData;
        if (clientX === undefined || clientY === undefined || !this.attBrushCursor.visible) return;
        const hit = this.getTerrainHitAtClientPoint(clientX, clientY);
        if (!hit) {
            this.attBrushCursor.visible = false;
            return;
        }
        this.attBrushCursor.position.set(hit.point.x, hit.point.y + 10, hit.point.z);
    }

    private paintAtClientPoint(clientX: number, clientY: number) {
        if (this.terrainTileBrushEnabledEl?.checked) this.paintTerrainTileAtClientPoint(clientX, clientY);
        else if (this.attBrushEnabledEl?.checked || this.isAttFlagPaintConfigured()) this.paintAttAtClientPoint(clientX, clientY, this.brushErase);
        else if (this.terrainHeightEnabledEl?.checked) this.paintHeightAtClientPoint(clientX, clientY, this.brushErase ? -1 : 1);
        else if (this.terrainLightPaintEnabledEl?.checked) this.paintLightAtClientPoint(clientX, clientY);
    }

    private isAttFlagPaintConfigured(): boolean {
        return this.loadedAttData !== null && Array.from(this.attFlagEls.values()).some(input => input.checked);
    }

    private getTerrainBrushBounds(centerX: number, centerZ: number) {
        const size = Math.max(1, Math.round(this.attBrushRadiusTiles));
        const startX = centerX - Math.floor((size - 1) / 2);
        const startZ = centerZ - Math.floor((size - 1) / 2);
        return {
            startX: Math.max(0, startX),
            endX: Math.min(TERRAIN_SIZE - 1, startX + size - 1),
            startZ: Math.max(0, startZ),
            endZ: Math.min(TERRAIN_SIZE - 1, startZ + size - 1),
        };
    }

    private paintAttAtClientPoint(clientX: number, clientY: number, erase = false) {
        if (!this.loadedAttData) return;
        const hit = this.getTerrainHitAtClientPoint(clientX, clientY);
        if (!hit) return;
        const centerX = Math.floor(hit.point.x / TERRAIN_SCALE);
        const centerZ = Math.floor((TERRAIN_WORLD_SIZE - hit.point.z) / TERRAIN_SCALE);
        this.updateTerrainTileCoordinates(centerX, centerZ);
        let value = TWFlags.None;
        this.attFlagEls.forEach((input, flag) => { if (input.checked) value |= flag; });
        const bounds = this.getTerrainBrushBounds(centerX, centerZ);
        for (let z = bounds.startZ; z <= bounds.endZ; z++) {
            for (let x = bounds.startX; x <= bounds.endX; x++) {
                const index = z * TERRAIN_SIZE + x;
                this.loadedAttData.terrainWall[index] = erase ? (this.loadedAttData.terrainWall[index] & ~value) : value;
            }
        }
        this.updateTerrainAttributePanel(summarizeTerrainAttributeData(this.loadedAttData));
        if (this.terrainMesh) {
            this.refreshTerrainAttOverlay();
        }
        if (this.attEditorStatusEl) this.attEditorStatusEl.textContent = `Painted ATT at ${centerX}, ${centerZ}. Export ATT to save it.`;
        this.onAttDataChanged?.(this.loadedAttData, this.loadedWorldNumber ?? 0);
    }

    private paintHeightAtClientPoint(clientX: number, clientY: number, direction = 1) {
        if (!this.loadedHeightData || !this.loadedAttData || !this.terrainMesh) return;
        const hit = this.getTerrainHitAtClientPoint(clientX, clientY);
        if (!hit) return;
        const centerX = Math.floor(hit.point.x / TERRAIN_SCALE);
        const centerZ = Math.floor((TERRAIN_WORLD_SIZE - hit.point.z) / TERRAIN_SCALE);
        this.updateTerrainTileCoordinates(centerX, centerZ);
        const mode = this.terrainHeightModeEl?.value || 'raise';
        const delta = Math.abs(Number(this.terrainHeightStrengthEl?.value || 0));
        const hardness = Number(this.terrainBrushHardnessEl?.value || 100) / 100;
        const smooth = mode === 'smooth' || this.terrainHeightSmoothEl?.checked === true;
        const flattenTarget = this.getTerrainHeightSample(
            Math.floor(hit.point.x / TERRAIN_SCALE),
            Math.floor((TERRAIN_WORLD_SIZE - hit.point.z) / TERRAIN_SCALE),
        );
        const bounds = this.getTerrainBrushBounds(centerX, centerZ);
        for (let z = bounds.startZ; z <= bounds.endZ; z++) {
            for (let x = bounds.startX; x <= bounds.endX; x++) {
                    const offset = (z * TERRAIN_SIZE + x) * 4;
                    const current = this.loadedHeightData.data[offset];
                    const neighbors = [
                        x > 0 ? this.loadedHeightData.data[offset - 4] : current,
                        x < TERRAIN_SIZE - 1 ? this.loadedHeightData.data[offset + 4] : current,
                        z > 0 ? this.loadedHeightData.data[offset - TERRAIN_SIZE * 4] : current,
                        z < TERRAIN_SIZE - 1 ? this.loadedHeightData.data[offset + TERRAIN_SIZE * 4] : current,
                    ];
                    const target = mode === 'flatten'
                        ? flattenTarget
                        : smooth
                        ? neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length
                        : current + delta * (mode === 'lower' ? -1 : direction);
                    this.loadedHeightData.data[offset] = THREE.MathUtils.clamp(
                        current + (target - current) * (smooth ? hardness : Number(this.terrainBrushStrengthEl?.value || 100) / 100),
                        0,
                        255,
                    );
            }
        }
        const geometry = buildTerrainGeometry(this.loadedHeightData, this.loadedAttData, this.loadedLightData);
        this.terrainMesh.geometry.dispose();
        this.terrainMesh.geometry = geometry;
        this.refreshTerrainAttOverlay();
        if (this.attEditorStatusEl) this.attEditorStatusEl.textContent = `Height ${mode} applied at ${centerX}, ${centerZ}. Export the world files to save it.`;
    }

    private getTerrainHeightSample(x: number, z: number): number {
        if (!this.loadedHeightData) return 0;
        const sampleX = THREE.MathUtils.clamp(x, 0, TERRAIN_SIZE - 1);
        const sampleZ = THREE.MathUtils.clamp(z, 0, TERRAIN_SIZE - 1);
        return this.loadedHeightData.data[(sampleZ * TERRAIN_SIZE + sampleX) * 4];
    }

    private paintLightAtClientPoint(clientX: number, clientY: number) {
        if (!this.loadedLightData || !this.loadedAttData || !this.terrainMesh) return;
        const hit = this.getTerrainHitAtClientPoint(clientX, clientY);
        if (!hit) return;
        const centerX = Math.floor(hit.point.x / TERRAIN_SCALE);
        const centerZ = Math.floor((TERRAIN_WORLD_SIZE - hit.point.z) / TERRAIN_SCALE);
        this.updateTerrainTileCoordinates(centerX, centerZ);
        const hardness = Number(this.terrainBrushHardnessEl?.value || 100) / 100;
        const strength = Number(this.terrainBrushStrengthEl?.value || 100) / 100;
        const color = this.terrainLightColorEl?.value || '#ffffff';
        const rgb = color.match(/[a-f\d]{2}/gi)?.map(value => parseInt(value, 16)) || [255, 255, 255];
        const bounds = this.getTerrainBrushBounds(centerX, centerZ);
        for (let z = bounds.startZ; z <= bounds.endZ; z++) {
            for (let x = bounds.startX; x <= bounds.endX; x++) {
                const falloff = Math.max(0.05, hardness) * strength;
                const offset = (z * TERRAIN_SIZE + x) * 4;
                for (let channel = 0; channel < 3; channel++) {
                    this.loadedLightData.data[offset + channel] = THREE.MathUtils.clamp(
                        this.loadedLightData.data[offset + channel] + (rgb[channel] - this.loadedLightData.data[offset + channel]) * falloff,
                        0,
                        255,
                    );
                }
            }
        }
        const geometry = buildTerrainGeometry(this.loadedHeightData!, this.loadedAttData, this.loadedLightData);
        this.terrainMesh.geometry.dispose();
        this.terrainMesh.geometry = geometry;
        this.refreshTerrainAttOverlay();
    }

    private paintTerrainTileAtClientPoint(clientX: number, clientY: number) {
        if (!this.loadedMapData) {
            if (this.terrainTileStatusEl) this.terrainTileStatusEl.textContent = 'Load a world with a MAP file first.';
            return;
        }
        const hit = this.getTerrainHitAtClientPoint(clientX, clientY);
        if (!hit) return;
        const centerX = Math.floor(hit.point.x / TERRAIN_SCALE);
        const centerZ = Math.floor((TERRAIN_WORLD_SIZE - hit.point.z) / TERRAIN_SCALE);
        this.updateTerrainTileCoordinates(centerX, centerZ);
        const radius = this.attBrushRadiusTiles - 0.5;
        const paintLayer = this.terrainPaintLayerEl?.value || 'both';
        const layer1 = Number(this.terrainLayer1El?.value || 0);
        const layer2 = Number(this.terrainLayer2El?.value || 0);
        const alpha = Number(this.terrainAlphaEl?.value || 0);
        for (let z = Math.max(0, centerZ - radius); z <= Math.min(TERRAIN_SIZE - 1, centerZ + radius); z++) {
            for (let x = Math.max(0, centerX - radius); x <= Math.min(TERRAIN_SIZE - 1, centerX + radius); x++) {
                if ((x - centerX) ** 2 + (z - centerZ) ** 2 <= radius ** 2) {
                    const index = z * TERRAIN_SIZE + x;
                    if (paintLayer !== '2') this.loadedMapData.layer1[index] = layer1;
                    if (paintLayer !== '1') this.loadedMapData.layer2[index] = layer2;
                    this.loadedMapData.alpha[index] = alpha;
                }
            }
        }
        this.updateTerrainMaterialMapping();
        this.applyTerrainTile();
        if (this.terrainTileStatusEl) this.terrainTileStatusEl.textContent = `Terrain painted at ${centerX}, ${centerZ}. Export MAP to save it.`;
    }

    private async exportCurrentAtt() {
        if (!this.loadedAttData || this.loadedWorldNumber === null) {
            if (this.attEditorStatusEl) this.attEditorStatusEl.textContent = 'Load a world before exporting ATT.';
            return;
        }

        const exportRoot = await openDirectoryDialog();
        if (!exportRoot) return;
        const result = await writeFileInDirectory(
            exportRoot,
            `World${this.loadedWorldNumber}/${this.loadedAttFileName || `EncTerrain${this.loadedWorldNumber}.att`}`,
            writeATT(this.loadedAttData),
        );
        if (this.attEditorStatusEl) {
            this.attEditorStatusEl.textContent = result.error ? `ATT export failed: ${result.error}` : `Exported ATT: ${result.path}`;
        }
    }

    private async exportServerAtt() {
        if (!this.loadedAttData || this.loadedWorldNumber === null) {
            if (this.attEditorStatusEl) this.attEditorStatusEl.textContent = 'Load a world before exporting the server ATT.';
            return;
        }

        const exportRoot = await openDirectoryDialog();
        if (!exportRoot) return;

        try {
            const result = await writeFileInDirectory(
                exportRoot,
                `World${this.loadedWorldNumber}/Terrain${this.loadedWorldNumber}.att`,
                writeServerATT(this.loadedAttData),
            );
            if (this.attEditorStatusEl) {
                this.attEditorStatusEl.textContent = result.error
                    ? `Server ATT export failed: ${result.error}`
                    : `Exported server ATT: ${result.path}`;
            }
        } catch (error) {
            if (this.attEditorStatusEl) {
                this.attEditorStatusEl.textContent = `Server ATT export failed: ${error instanceof Error ? error.message : String(error)}`;
            }
        }
    }

    private async exportMinimapPng() {
            if (!this.minimapCanvas) {
                this.setObjectEditorStatus('Load a world before exporting the minimap.');
                return;
            }
            this.drawMinimap();
            const blob = await new Promise<Blob | null>(resolve => this.minimapCanvas?.toBlob(resolve, 'image/png'));
            if (!blob) return;
            const root = await openDirectoryDialog();
            if (!root) return;
            const result = await writeFileInDirectory(root, `World${this.loadedWorldNumber ?? 0}_minimap.png`, new Uint8Array(await blob.arrayBuffer()));
            this.setObjectEditorStatus(result.error ? `Minimap export failed: ${result.error}` : `Exported minimap: ${result.path}`);
        }

        private async exportNavigationPng() {
            if (!this.loadedAttData) {
                this.setObjectEditorStatus('Load a world with ATT data before exporting navigation.');
                return;
            }
            const canvas = document.createElement('canvas');
            canvas.width = TERRAIN_SIZE;
            canvas.height = TERRAIN_SIZE;
            const context = canvas.getContext('2d');
            if (!context) return;
            const image = context.createImageData(TERRAIN_SIZE, TERRAIN_SIZE);
            const pixels = image.data;
            for (let index = 0; index < TERRAIN_SIZE * TERRAIN_SIZE; index++) {
                const flags = this.loadedAttData.terrainWall[index] || 0;
                const walkable = (flags & (TWFlags.NoMove | TWFlags.NoGround)) === 0;
                const safe = (flags & TWFlags.SafeZone) !== 0;
                const water = (flags & TWFlags.Water) !== 0;
                const offset = index * 4;
                pixels[offset] = safe ? 70 : water ? 40 : walkable ? 70 : 210;
                pixels[offset + 1] = safe ? 190 : water ? 110 : walkable ? 150 : 50;
                pixels[offset + 2] = safe ? 120 : water ? 220 : walkable ? 70 : 50;
                pixels[offset + 3] = 255;
            }
            context.putImageData(image, 0, 0);
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) return;
            const root = await openDirectoryDialog();
            if (!root) return;
            const result = await writeFileInDirectory(root, `World${this.loadedWorldNumber ?? 0}_navigation.png`, new Uint8Array(await blob.arrayBuffer()));
            this.setObjectEditorStatus(result.error ? `Navigation export failed: ${result.error}` : `Exported navigation: ${result.path}`);
        }

        private async exportWorldGltf() {
            if (!this.terrainMesh) {
                this.setObjectEditorStatus('Load a world before exporting GLB.');
                return;
            }
            const root = await openDirectoryDialog();
            if (!root) return;
            const exportScene = new THREE.Scene();
            const terrain = this.terrainMesh.clone(true);
            terrain.traverse(object => {
                const mesh = object as THREE.Mesh;
                if (!mesh.isMesh) return;
                const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
                if (material instanceof THREE.ShaderMaterial) {
                    mesh.material = new THREE.MeshStandardMaterial({ color: 0x78866b, roughness: 1 });
                }
            });
            exportScene.add(terrain);
            if (this.objectsGroup) exportScene.add(this.objectsGroup.clone(true));
            exportScene.add(this.objectsGroup.clone(true));
            const exporter = new GLTFExporter();
            const result = await new Promise<ArrayBuffer>((resolve, reject) => {
                exporter.parse(exportScene, value => {
                    if (value instanceof ArrayBuffer) resolve(value);
                    else reject(new Error('GLTF exporter returned JSON instead of binary GLB.'));
                }, reject, { binary: true });
            });
            const writeResult = await writeFileInDirectory(root, `World${this.loadedWorldNumber ?? 0}.glb`, new Uint8Array(result));
            this.setObjectEditorStatus(writeResult.error ? `GLB export failed: ${writeResult.error}` : `Exported GLB: ${writeResult.path}`);
        }

    private buildMinimapSource() {
        if (!this.terrainMesh) {
            this.minimapSourceCanvas = null;
            return;
        }

        const geometry = (this.terrainMesh.userData.minimapGeometry as THREE.BufferGeometry | undefined)
            ?? (this.terrainMesh.geometry as THREE.BufferGeometry);
        const positions = geometry.getAttribute('position');
        if (!positions) {
            this.minimapSourceCanvas = null;
            return;
        }

        const colorAttribute = geometry.getAttribute('color');
        const vertexGridSize = Math.round(Math.sqrt(positions.count));
        const raster = buildHeightMinimapRaster(
            positions.array as ArrayLike<number>,
            colorAttribute?.array as ArrayLike<number> | null,
            vertexGridSize,
        );

        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = raster.width;
        sourceCanvas.height = raster.height;
        const context = sourceCanvas.getContext('2d');
        if (!context) {
            this.minimapSourceCanvas = null;
            return;
        }

        const imageDataArray = new Uint8ClampedArray(raster.data.length);
        imageDataArray.set(raster.data);
        context.putImageData(new ImageData(imageDataArray, raster.width, raster.height), 0, 0);
        this.minimapSourceCanvas = sourceCanvas;
    }

    private handleCanvasSelection(event: PointerEvent) {
        if (!this.objectsGroup) {
            this.clearSelection();
            return;
        }

        const record = this.pickObjectRecordAtClientPoint(event.clientX, event.clientY);
        if (record) {
            this.selectObjectRecord(record);
        } else {
            this.clearSelection();
            this.selectTerrainTileAtClientPoint(event.clientX, event.clientY);
        }
    }

    private populateTerrainTextureOptions() {
        for (const select of [this.terrainLayer1El, this.terrainLayer2El]) {
            if (!select) continue;
            select.replaceChildren();
            for (let index = 0; index < 256; index++) {
                const option = document.createElement('option');
                option.value = `${index}`;
                option.textContent = `Texture ${index}`;
                select.appendChild(option);
            }
        }
    }

    private async renderTerrainTexturePalette() {
            const palette = this.terrainTexturePaletteEl;
            if (!palette) return;
            palette.replaceChildren();
            const files = this.getCurrentTextureFiles()
                .filter(file => /\.(jpg|jpeg|png|bmp|tga|ozj|ozt|ozb)$/i.test(file.name))
                .map(file => ({ file, index: this.getTerrainTextureIndex(file.name) }))
                .filter((entry): entry is { file: File; index: number } => entry.index !== null)
                .sort((a, b) => a.index - b.index);
            if (files.length === 0) {
                const empty = document.createElement('span');
                empty.className = 'terrain-texture-palette-empty';
                empty.textContent = 'Load a world with texture files to browse them.';
                palette.appendChild(empty);
                return;
            }

            for (const { file, index } of files) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'terrain-texture-swatch';
                button.title = `${index}: ${file.name}`;
                button.addEventListener('click', () => {
                    const value = `${index}`;
                    if (this.terrainLayer1El) this.terrainLayer1El.value = value;
                    if (this.terrainLayer2El) this.terrainLayer2El.value = value;
                    if (this.terrainTileBrushEnabledEl) this.terrainTileBrushEnabledEl.checked = true;
                    this.updateAttBrushCursor();
                    if (this.terrainTileStatusEl) this.terrainTileStatusEl.textContent = `Texture ${index} selected: ${file.name}`;
                });
                const image = document.createElement('img');
                image.alt = file.name;
                image.loading = 'lazy';
                image.src = await this.createTerrainTexturePreviewUrl(file);
                button.appendChild(image);
                const label = document.createElement('span');
                label.textContent = `${index}`;
                button.appendChild(label);
                palette.appendChild(button);
            }
        }

    private getTerrainTextureIndex(fileName: string): number | null {
        const baseName = fileName.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '').toLowerCase() || '';
        const directIndex = TERRAIN_TEXTURE_INDEX_BY_NAME[baseName];
        if (directIndex !== undefined) return directIndex;
        const extTile = baseName.match(/^exttile(0[1-9]|1[0-6])$/);
        if (extTile) return 13 + Number(extTile[1]);
        return null;
    }

    private async createTerrainTexturePreviewUrl(file: File): Promise<string> {
        const extension = file.name.split('.').pop()?.toLowerCase() || '';
        if (extension === 'ozb') {
            try {
                const decoded = readOZB(await file.arrayBuffer());
                const canvas = document.createElement('canvas');
                canvas.width = decoded.width;
                canvas.height = Math.abs(decoded.height);
                const context = canvas.getContext('2d');
                if (!context) return '';
                context.putImageData(new ImageData(new Uint8ClampedArray(decoded.data), decoded.width, canvas.height), 0, 0);
                return canvas.toDataURL('image/png');
            } catch {
                return '';
            }
        }
        if (extension === 'ozj' || extension === 'ozt') {
            try {
                return await convertOzjToDataUrl(await file.arrayBuffer());
            } catch {
                return '';
            }
        }
        return URL.createObjectURL(file);
    }

    private updateTerrainObjectSelect() {
        if (!this.terrainObjectSelectEl) return;
        this.terrainObjectSelectEl.replaceChildren();
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = '-- Select object manually --';
        this.terrainObjectSelectEl.appendChild(empty);
        this.objectRecords.forEach(record => {
            const option = document.createElement('option');
            option.value = record.selection.objectId;
            option.textContent = `${record.selection.displayName} [${record.selection.type}]`;
            this.terrainObjectSelectEl!.appendChild(option);
        });
        this.renderObjectLibrary();
    }

    private renderObjectLibrary() {
        const container = document.getElementById('terrain-object-library');
        if (!container) return;
        container.replaceChildren();
        const query = this.objectLibrarySearch.trim().toLowerCase();
        const records = this.objectRecords
            .filter(record => !query || `${record.selection.displayName} ${record.selection.type}`.toLowerCase().includes(query))
            .slice(0, 200);
        if (records.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'control-note';
            empty.textContent = 'No objects match the search.';
            container.appendChild(empty);
            return;
        }
        for (const record of records) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'terrain-library-item';
            button.textContent = `${record.selection.displayName} · ${record.selection.type}`;
            button.addEventListener('click', () => this.selectObjectRecord(record));
            container.appendChild(button);
        }
    }

    private scatterSelectedObjectAtClientPoint(clientX: number, clientY: number) {
        if (!this.selectedObjectRecord) {
            this.setObjectEditorStatus('Select an object before using the distribution brush.');
            return;
        }
        const hit = this.getTerrainHitAtClientPoint(clientX, clientY);
        if (!hit) return;
        const count = THREE.MathUtils.clamp(Math.trunc(this.objectScatterCount), 1, 32);
        const radius = THREE.MathUtils.clamp(this.objectScatterRadius, 1, 32) * TERRAIN_SCALE;
        for (let index = 0; index < count; index++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.sqrt(Math.random()) * radius;
            this.duplicateSelectedObject({
                x: THREE.MathUtils.clamp(hit.point.x + Math.cos(angle) * distance, 0, TERRAIN_WORLD_SIZE),
                y: hit.point.y,
                z: THREE.MathUtils.clamp(hit.point.z + Math.sin(angle) * distance, 0, TERRAIN_WORLD_SIZE),
            });
        }
        this.setObjectEditorStatus(`Distributed ${count} object copies.`);
    }

    private initializeZoneEditor() {
        const container = document.getElementById('terrain-zone-editor');
        if (!container) return;
        const stored = localStorage.getItem('mudevs-zone-definitions');
        if (stored) {
            try {
                const parsed = JSON.parse(stored) as Record<string, { name?: string; color?: string }>;
                Object.entries(parsed).forEach(([key, value]) => {
                    const flag = Number(key);
                    if (value.name) this.zoneLabels.set(flag, value.name);
                    if (value.color) this.zoneColors.set(flag, value.color);
                });
            } catch {
                localStorage.removeItem('mudevs-zone-definitions');
            }
        }
        this.applyZoneColorsToOverlay();
        for (const definition of TERRAIN_ATTRIBUTE_FLAG_DEFINITIONS) {
            const row = document.createElement('div');
            row.className = 'terrain-zone-row';
            const name = document.createElement('input');
            name.className = 'frame-input';
            name.value = this.zoneLabels.get(definition.flag) || definition.name;
            name.title = `Name for ${definition.name}`;
            const color = document.createElement('input');
            color.type = 'color';
            color.value = this.zoneColors.get(definition.flag) || '#7c3aed';
            color.title = `Color for ${definition.name}`;
            name.addEventListener('change', () => {
                this.zoneLabels.set(definition.flag, name.value.trim() || definition.name);
                this.saveZoneDefinitions();
            });
            color.addEventListener('input', () => {
                this.zoneColors.set(definition.flag, color.value);
                this.applyZoneColorsToOverlay();
                this.saveZoneDefinitions();
            });
            row.append(name, color);
            container.appendChild(row);
        }
    }

    private saveZoneDefinitions() {
        const value: Record<string, { name: string; color: string }> = {};
        TERRAIN_ATTRIBUTE_FLAG_DEFINITIONS.forEach(definition => {
            value[String(definition.flag)] = {
                name: this.zoneLabels.get(definition.flag) || definition.name,
                color: this.zoneColors.get(definition.flag) || '#7c3aed',
            };
        });
        localStorage.setItem('mudevs-zone-definitions', JSON.stringify(value));
    }

    private applyZoneColorsToOverlay() {
        const colors = new Map<number, readonly [number, number, number]>();
        this.zoneColors.forEach((hex, flag) => {
            const value = Number.parseInt(hex.replace('#', ''), 16);
            if (Number.isFinite(value)) {
                colors.set(flag, [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
            }
        });
        this.terrainAttOverlay?.setCustomColors(colors);
        if (this.loadedAttData && this.terrainMesh) this.terrainAttOverlay?.setData(this.loadedAttData, this.terrainMesh.geometry);
    }

    private bindAdvancedMapTools() {
        document.getElementById('terrain-object-library-search')?.addEventListener('input', event => {
            this.objectLibrarySearch = (event.target as HTMLInputElement).value;
            this.renderObjectLibrary();
        });
        document.getElementById('terrain-object-scatter-enabled')?.addEventListener('change', event => {
            this.objectScatterEnabled = (event.target as HTMLInputElement).checked;
        });
        document.getElementById('terrain-object-scatter-count')?.addEventListener('input', event => {
            this.objectScatterCount = Number((event.target as HTMLInputElement).value) || 5;
        });
        document.getElementById('terrain-object-scatter-radius')?.addEventListener('input', event => {
            this.objectScatterRadius = Number((event.target as HTMLInputElement).value) || 4;
        });
        document.getElementById('terrain-export-minimap-btn')?.addEventListener('click', () => this.exportMinimapPng());
        document.getElementById('terrain-export-navigation-btn')?.addEventListener('click', () => this.exportNavigationPng());
        document.getElementById('terrain-export-gltf-btn')?.addEventListener('click', () => { void this.exportWorldGltf(); });
    }

    private selectTerrainTileAtClientPoint(clientX: number, clientY: number) {
        if (!this.terrainMesh || !this.loadedMapData) return;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hit = this.raycaster.intersectObject(this.terrainMesh, true)[0];
        if (!hit) {
            const groundPoint = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
            if (!groundPoint) return;
            this.selectTerrainTileFromPoint(groundPoint);
            return;
        }
        this.selectTerrainTileFromPoint(hit.point);
    }

    private selectTerrainTileFromPoint(point: THREE.Vector3) {
        if (!this.loadedMapData) return;
        const x = Math.max(0, Math.min(TERRAIN_SIZE - 1, Math.floor(point.x / TERRAIN_SCALE)));
        const z = Math.max(0, Math.min(TERRAIN_SIZE - 1, Math.floor((TERRAIN_WORLD_SIZE - point.z) / TERRAIN_SCALE)));
        const index = z * TERRAIN_SIZE + x;
        this.updateTerrainTileCoordinates(x, z);
        if (this.terrainLayer1El) this.terrainLayer1El.value = `${this.loadedMapData.layer1[index]}`;
        if (this.terrainLayer2El) this.terrainLayer2El.value = `${this.loadedMapData.layer2[index]}`;
        if (this.terrainAlphaEl) this.terrainAlphaEl.value = `${this.loadedMapData.alpha[index]}`;
        this.selectAttTileFromInputs();
        if (this.terrainTileStatusEl) this.terrainTileStatusEl.textContent = `Tile ${x}, ${z} selected.`;
    }

    private updateTerrainTileCoordinates(x: number, z: number) {
        if (this.terrainTileXEl) this.terrainTileXEl.value = `${x}`;
        if (this.terrainTileZEl) this.terrainTileZEl.value = `${z}`;
        if (this.attTileXEl) this.attTileXEl.value = `${x}`;
        if (this.attTileZEl) this.attTileZEl.value = `${z}`;
    }

    private applyTerrainTile() {
        if (!this.loadedMapData) return;
        this.beginTerrainEdit();
        const x = Math.max(0, Math.min(TERRAIN_SIZE - 1, parseInt(this.terrainTileXEl?.value || '0', 10)));
        const z = Math.max(0, Math.min(TERRAIN_SIZE - 1, parseInt(this.terrainTileZEl?.value || '0', 10)));
        const index = z * TERRAIN_SIZE + x;
        this.loadedMapData.layer1[index] = parseInt(this.terrainLayer1El?.value || '0', 10);
        this.loadedMapData.layer2[index] = parseInt(this.terrainLayer2El?.value || '0', 10);
        this.loadedMapData.alpha[index] = parseInt(this.terrainAlphaEl?.value || '0', 10);
        this.updateTerrainMaterialMapping();
        if (this.terrainTileStatusEl) this.terrainTileStatusEl.textContent = `Tile ${x}, ${z} updated. Export MAP to save it.`;
    }

    private updateTerrainMaterialMapping() {
        if (!this.terrainMesh || !this.loadedMapData) return;
        this.forEachTerrainMaterial(this.terrainMesh, material => {
            if (!(material instanceof THREE.ShaderMaterial)) return;
            for (const [name, values] of [
                ['uLayer1', this.loadedMapData!.layer1],
                ['uLayer2', this.loadedMapData!.layer2],
                ['uAlpha', this.loadedMapData!.alpha],
            ] as const) {
                const texture = material.uniforms[name]?.value as THREE.DataTexture | undefined;
                if (texture) {
                    texture.image.data = values;
                    texture.needsUpdate = true;
                }
            }
        });
    }

    private handleCanvasObjectEditRequest(event: MouseEvent) {
        if (!this.objectsGroup) {
            return;
        }

        const record = this.pickObjectRecordAtClientPoint(event.clientX, event.clientY);
        if (!record) {
            return;
        }

        if (this.selectedObjectRecord?.selection.objectId !== record.selection.objectId) {
            this.selectObjectRecord(record);
        }
        this.openObjectEditorPanel();
    }

    private pickObjectRecordAtClientPoint(clientX: number, clientY: number): TerrainObjectSelectionRecord | null {
        if (!this.objectsGroup || !this.objectsGroup.visible) {
            return null;
        }

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersections = this.raycaster.intersectObject(this.objectsGroup, true);
        return this.resolveSelectionRecord(intersections);
    }

    private resolveSelectionRecord(intersections: THREE.Intersection<THREE.Object3D<THREE.Object3DEventMap>>[]): TerrainObjectSelectionRecord | null {
        for (const intersection of intersections) {
            const directRecord = intersection.object.userData.terrainObjectRecord as TerrainObjectSelectionRecord | undefined;
            if (directRecord) {
                return directRecord;
            }

            const instancedRecords = intersection.object.userData.terrainObjectRecords as TerrainObjectSelectionRecord[] | undefined;
            if (typeof intersection.instanceId === 'number' && instancedRecords?.[intersection.instanceId]) {
                return instancedRecords[intersection.instanceId];
            }
        }

        return null;
    }

    private selectObjectRecord(record: TerrainObjectSelectionRecord) {
        this.selectedObjectRecord = record;
        this.updateObjectPreview(record);
        this.resizeObjectPreview();
        if (this.terrainObjectSelectEl) {
            this.terrainObjectSelectEl.value = record.selection.objectId;
        }
        this.updateObjectInspector();
        this.updateSelectionMarker();
        this.updateTransformControlAttachment();
        if (this.objectEditorPanelEl && !this.objectEditorPanelEl.classList.contains('hidden')) {
            this.populateObjectEditorPanel();
        }
        this.onObjectSelected?.(record.selection);
        this.minimapNeedsRedraw = true;
    }

    private clearSelection() {
        this.selectedObjectRecord = null;
        if (this.terrainObjectSelectEl) {
            this.terrainObjectSelectEl.value = '';
        }
        this.updateObjectInspector();
        this.updateSelectionMarker();
        this.updateTransformControlAttachment();
        this.closeObjectEditorPanel();
        this.onObjectSelected?.(null);
        this.minimapNeedsRedraw = true;
    }

    private removeSelectedObject() {
        const record = this.selectedObjectRecord;
        if (!record) {
            this.setObjectEditorStatus('Select an object before removing it.');
            return;
        }
        this.captureObjectEdit();

        const objectId = record.selection.objectId;
        if (record.object3D) {
            record.object3D.parent?.remove(record.object3D);
        }

        const duplicate = this.duplicateObjectData.get(objectId);
        if (duplicate && this.loadedObjectsData) {
            const duplicateIndex = this.loadedObjectsData.objects.indexOf(duplicate);
            if (duplicateIndex >= 0) this.loadedObjectsData.objects.splice(duplicateIndex, 1);
        } else if (this.loadedObjectsData) {
            const objectIndex = this.loadedObjectsData.objects.findIndex(object => {
                const candidateId = createWorldObjectId(this.loadedObjectsData!.mapNumber, object.type, {
                    x: object.position.x,
                    z: TERRAIN_WORLD_SIZE - object.position.y,
                });
                return candidateId === objectId;
            });
            if (objectIndex >= 0) this.loadedObjectsData.objects.splice(objectIndex, 1);
        }

        this.duplicateObjectData.delete(objectId);
        this.objectRecords = this.objectRecords.filter(candidate => candidate !== record);
        this.animatedObjectInstances = this.animatedObjectInstances.filter(instance => instance.object3D !== record.object3D);
        this.clearSelection();
        this.updateTerrainObjectSelect();
        this.rebuildObjectCullingIndex();
        this.updateObjectDistanceCulling(true);
        if (this.terrainMesh) {
            this.updateStats(this.getTerrainTileCount(this.terrainMesh), this.objectRecords.length);
        }
        this.setObjectEditorStatus(`Removed ${record.selection.displayName} from the map.`);
        this.emitStateChanged();
    }

    private updateTransformControlAttachment() {
        const controls = this.transformControls;
        const helper = this.transformControlsHelper;
        const record = this.selectedObjectRecord;

        if (!controls || !helper || !record) {
            controls?.detach();
            if (helper) helper.visible = false;
            this.transformProxy.visible = false;
            return;
        }

        this.applyingTransformControlChange = true;
        this.transformProxy.position.set(
            record.selection.position.x,
            record.selection.position.y,
            record.selection.position.z,
        );
        this.transformProxy.quaternion.copy(this.getRecordVisualQuaternion(record));
        this.transformProxy.scale.setScalar(Math.max(0.01, record.selection.scale));
        this.transformProxy.visible = true;
        this.transformProxy.updateMatrix();
        this.transformProxy.updateMatrixWorld(true);
        controls.attach(this.transformProxy);
        controls.setMode(this.transformControlMode);
        helper.visible = true;
        this.applyingTransformControlChange = false;
    }

    private getRecordVisualQuaternion(record: TerrainObjectSelectionRecord): THREE.Quaternion {
        if (record.object3D) {
            return record.object3D.quaternion.clone();
        }

        if (record.instancedMesh && typeof record.instanceId === 'number') {
            const matrix = new THREE.Matrix4();
            const position = new THREE.Vector3();
            const quaternion = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            record.instancedMesh.getMatrixAt(record.instanceId, matrix);
            matrix.decompose(position, quaternion, scale);
            return quaternion;
        }

        return this.selectionRotationToVisualQuaternion(record);
    }

    private selectionRotationToVisualQuaternion(record: TerrainObjectSelectionRecord): THREE.Quaternion {
        return mapObjectAngleToVisualQuaternion(record.selection.rotation, record.baseOrientation);
    }

    private visualQuaternionToSelectionRotation(
        quaternion: THREE.Quaternion,
        record: TerrainObjectSelectionRecord,
    ): ExplorerVector3 {
        return visualQuaternionToMapObjectAngle(quaternion, record.baseOrientation);
    }

    private handleTransformControlObjectChange() {
        if (this.applyingTransformControlChange) return;

        const record = this.selectedObjectRecord;
        if (!record) return;

        const objectId = record.selection.objectId;
        const matchingRecords = this.objectRecords.filter(candidate => candidate.selection.objectId === objectId);
        const nextPosition = this.toExplorerVector3(this.transformProxy.position);
        const nextScale = Math.max(0.01, this.transformProxy.scale.x || record.selection.scale);
        const nextQuaternion = this.transformProxy.quaternion.clone();
        const nextRotation = this.visualQuaternionToSelectionRotation(nextQuaternion, record);

        this.applyTransformToObjectRecords(matchingRecords, nextPosition, nextScale, nextRotation, nextQuaternion);
        this.updateObjectInspector();
        this.updateSelectionMarker();
        if (this.objectEditorPanelEl && !this.objectEditorPanelEl.classList.contains('hidden')) {
            this.populateObjectEditorPanel();
        }
        this.minimapNeedsRedraw = true;
        this.emitStateChanged();
    }

    private updateObjectInspector() {
        const record = this.selectedObjectRecord;
        if (!record) {
            this.objectDetailsEl?.classList.add('hidden');
            this.objectEmptyEl?.classList.remove('hidden');
            this.objectTransformGizmoControlsEl?.classList.add('hidden');
            if (this.openModelHintEl) {
                this.openModelHintEl.textContent = 'Select an object to inspect it.';
            }
            if (this.openModelBtn) {
                this.openModelBtn.disabled = true;
            }
            return;
        }

        this.objectDetailsEl?.classList.remove('hidden');
        this.objectEmptyEl?.classList.add('hidden');
        this.objectTransformGizmoControlsEl?.classList.remove('hidden');
        if (this.objectWorldEl) this.objectWorldEl.textContent = `${record.selection.worldNumber}`;
        if (this.objectTypeEl) this.objectTypeEl.textContent = `${record.selection.type}`;
        if (this.objectModelEl) this.objectModelEl.textContent = record.selection.modelName || 'Unresolved';
        if (this.objectPositionEl) this.objectPositionEl.textContent = this.formatMapPosition(record.selection.position);
        if (this.objectRotationEl) this.objectRotationEl.textContent = this.formatVector(record.selection.rotation);
        if (this.objectScaleEl) this.objectScaleEl.textContent = record.selection.scale.toFixed(2);
        if (this.objectCopyXEl) this.objectCopyXEl.value = (record.selection.position.x / TERRAIN_SCALE).toFixed(2);
        if (this.objectCopyYEl) this.objectCopyYEl.value = (record.selection.position.y / TERRAIN_SCALE).toFixed(2);
        if (this.objectCopyZEl) this.objectCopyZEl.value = (record.selection.position.z / TERRAIN_SCALE).toFixed(2);
        if (this.openModelBtn) this.openModelBtn.disabled = !record.modelFile;
        if (this.openModelHintEl) {
            this.openModelHintEl.textContent = record.modelFile
                ? 'Model file resolved from current world data.'
                : 'Model file is not available in the currently loaded world files.';
        }
    }

    private async loadObjectOverrides() {
        try {
            const result = await readTerrainObjectOverrides();
            this.objectOverridesPath = result.path;
            let rawData = result.data;
            if (typeof rawData === 'string') {
                try {
                    rawData = JSON.parse(rawData);
                } catch {
                    rawData = null;
                }
            }
            this.objectOverrides = normalizeTerrainObjectOverrides(rawData);
            if (this.loadedWorldNumber !== null) {
                this.applyPersistedObjectTypeOverridesForWorld(this.loadedWorldNumber);
            }
        } catch (error) {
            console.warn('Failed to load terrain object overrides:', error);
            this.objectOverrides = createEmptyTerrainObjectOverrides();
        }
    }

    private async writeObjectOverrides(statusPrefix: string) {
        const result = await writeTerrainObjectOverrides(this.objectOverrides);
        this.objectOverridesPath = result.path;
        if (result.error) {
            this.setObjectEditorStatus(`${statusPrefix} failed: ${result.error}`);
            return;
        }

        this.setObjectEditorStatus(this.objectOverridesPath
            ? `${statusPrefix}: ${this.objectOverridesPath}`
            : statusPrefix);
    }

    private openObjectEditorPanel() {
        if (!this.selectedObjectRecord || !this.objectEditorPanelEl) {
            return;
        }

        this.populateObjectEditorPanel();
        this.objectEditorPanelEl.classList.remove('hidden');
        this.resizeObjectPreview();
        this.objectPreviewRenderer?.render(this.objectPreviewScene!, this.objectPreviewCamera!);
    }

    private closeObjectEditorPanel() {
        this.objectEditorPanelEl?.classList.add('hidden');
    }

    private populateObjectEditorPanel() {
        const record = this.selectedObjectRecord;
        if (!record) return;

        const selection = record.selection;
        this.updateObjectPreview(record);
        if (this.objectEditorTitleEl) {
            this.objectEditorTitleEl.textContent = selection.displayName;
        }

        if (this.objectEditorMetaEl) {
            this.objectEditorMetaEl.textContent = `World ${selection.worldNumber} / Type ${selection.type}`;
        }
        if (this.objectEditorPosXEl) this.objectEditorPosXEl.value = selection.position.x.toFixed(0);
        if (this.objectEditorPosYEl) this.objectEditorPosYEl.value = selection.position.y.toFixed(0);
        if (this.objectEditorPosZEl) this.objectEditorPosZEl.value = selection.position.z.toFixed(0);
        if (this.objectEditorScaleEl) this.objectEditorScaleEl.value = selection.scale.toFixed(2);

        this.renderObjectEditorMaterialRows(selection.worldNumber, selection.type);
        this.setObjectEditorStatus(this.objectOverridesPath
            ? `Settings file: ${this.objectOverridesPath}`
            : 'Settings file will be created on save.');
    }

    private initializeObjectPreview() {
        if (!this.objectPreviewCanvas) return;
        this.objectPreviewScene = new THREE.Scene();
        this.objectPreviewScene.background = new THREE.Color(0x101923);
        this.objectPreviewScene.add(new THREE.GridHelper(4, 8, 0x8b5cf6, 0x27364a));
        this.objectPreviewScene.add(new THREE.AxesHelper(1.2));
        this.objectPreviewCamera = new THREE.PerspectiveCamera(35, 1, 0.01, 10000);
        this.objectPreviewCamera.position.set(2, 1.5, 3);
        this.objectPreviewRenderer = new THREE.WebGLRenderer({
            canvas: this.objectPreviewCanvas,
            antialias: true,
            alpha: true,
        });
        this.objectPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.objectPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace;
        this.objectPreviewRenderer.setClearColor(0x101923, 1);
        this.objectPreviewScene.add(new THREE.HemisphereLight(0xddeeff, 0x223344, 2));
        const key = new THREE.DirectionalLight(0xffffff, 2.5);
        key.position.set(3, 5, 4);
        this.objectPreviewScene.add(key);
        this.objectPreviewControls = new OrbitControls(this.objectPreviewCamera, this.objectPreviewCanvas);
        this.objectPreviewControls.enablePan = false;
        this.objectPreviewControls.enableDamping = true;
        this.objectPreviewControls.target.set(0, 0.5, 0);
        this.objectPreviewControls.addEventListener('change', () => {
            if (this.objectPreviewScene && this.objectPreviewCamera) {
                this.objectPreviewRenderer?.render(this.objectPreviewScene, this.objectPreviewCamera);
            }
        });
        this.resizeObjectPreview();
        window.addEventListener('resize', () => this.resizeObjectPreview());
    }

    private resizeObjectPreview() {
        if (!this.objectPreviewCanvas || !this.objectPreviewRenderer || !this.objectPreviewCamera) return;
        const width = Math.max(1, this.objectPreviewCanvas.clientWidth);
        const height = Math.max(1, this.objectPreviewCanvas.clientHeight);
        this.objectPreviewRenderer.setSize(width, height, false);
        this.objectPreviewCamera.aspect = width / height;
        this.objectPreviewCamera.updateProjectionMatrix();
    }

    private updateObjectPreview(record: TerrainObjectSelectionRecord) {
        if (!this.objectPreviewScene || !this.objectPreviewCamera || !this.objectPreviewControls) return;
        if (this.objectPreviewObject) {
            this.objectPreviewScene.remove(this.objectPreviewObject);
            this.objectPreviewObject = null;
        }
        const requestId = ++this.objectPreviewRequestId;
        const files = this.pendingImportedFiles ?? this.currentWorldFiles;
        if (record.modelFile) {
            void loadTerrainObjectPreview(record.modelFile, files).then(group => {
                if (requestId !== this.objectPreviewRequestId) {
                    this.disposeTerrainObject(group);
                    return;
                }
                group.traverse(object => {
                    object.visible = true;
                    object.frustumCulled = false;
                    object.matrixAutoUpdate = true;
                });
                this.objectPreviewObject && this.objectPreviewScene?.remove(this.objectPreviewObject);
                this.objectPreviewObject = group;
                this.fitObjectPreview(group);
            }).catch(error => {
                if (requestId === this.objectPreviewRequestId) {
                    this.setObjectEditorStatus(`Preview failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            });
            return;
        }
        const previewData: OBJData = {
            version: this.loadedObjectsData?.version ?? 0,
            mapNumber: record.selection.worldNumber,
            objects: [{
                type: record.selection.type,
                position: {
                    x: record.selection.position.x,
                    y: TERRAIN_WORLD_SIZE - record.selection.position.z,
                    z: record.selection.position.y,
                },
                angle: {
                    x: record.selection.rotation.x,
                    y: record.selection.rotation.y,
                    z: record.selection.rotation.z,
                },
                scale: record.selection.scale,
            }],
        };
        void loadTerrainObjects(
            previewData,
            files,
            record.selection.worldNumber,
            undefined,
            {
                animatedInstancingMode: getTerrainAnimatedInstancingModeForBackend(this.rendererActiveBackend),
                enableInstancing: false,
            },
        ).then(result => {
            if (requestId !== this.objectPreviewRequestId) {
                this.disposeTerrainObject(result.group);
                return;
            }
            if (result.records.length === 0 || result.group.children.length === 0) {
                this.setObjectEditorStatus('The selected object could not be resolved to a visible BMD.');
                this.disposeTerrainObject(result.group);
                return;
            }
            this.objectPreviewObject && this.objectPreviewScene?.remove(this.objectPreviewObject);
            this.objectPreviewObject = result.group;
            this.fitObjectPreview(result.group);
        }).catch(error => {
            if (requestId === this.objectPreviewRequestId) {
                this.setObjectEditorStatus(`Preview failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }

    private async updateInstancedObjectPreview(record: TerrainObjectSelectionRecord): Promise<void> {
        if (!record.modelFile || !this.objectPreviewScene) return;
        try {
            const group = await loadTerrainObjectPreview(record.modelFile, this.currentWorldFiles);
            group.traverse(object => {
                object.visible = true;
                object.frustumCulled = false;
                object.matrixAutoUpdate = true;
            });
            this.objectPreviewObject && this.objectPreviewScene.remove(this.objectPreviewObject);
            this.objectPreviewObject = group;
            this.fitObjectPreview(group);
        } catch (error) {
            this.setObjectEditorStatus(`Preview failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private fitObjectPreview(object: THREE.Object3D): void {
        if (!this.objectPreviewScene || !this.objectPreviewCamera || !this.objectPreviewControls) return;
        object.position.set(0, 0, 0);
        object.rotation.set(0, 0, 0);
        object.scale.setScalar(1);
        object.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxSize = Math.max(size.x, size.y, size.z, 0.001);
        object.position.sub(center);
        object.scale.setScalar(2.2 / maxSize);
        this.objectPreviewScene.add(object);
        this.objectPreviewControls.target.set(0, Math.max(0.1, size.y * 0.5 * 2.2 / maxSize), 0);
        this.objectPreviewCamera.position.set(2.2, 1.3, 2.8);
        this.objectPreviewCamera.lookAt(this.objectPreviewControls.target);
        this.objectPreviewControls.update();
        this.resizeObjectPreview();
        this.objectPreviewRenderer?.render(this.objectPreviewScene, this.objectPreviewCamera);
    }

    private formatMapPosition(position: ExplorerVector3): string {
        const tileX = THREE.MathUtils.clamp(position.x / TERRAIN_SCALE, 0, TERRAIN_SIZE - 1);
        const tileY = THREE.MathUtils.clamp(position.y / TERRAIN_SCALE, 0, TERRAIN_SIZE - 1);
        const tileZ = THREE.MathUtils.clamp(position.z / TERRAIN_SCALE, 0, TERRAIN_SIZE - 1);
        return `${tileX.toFixed(2)}, ${tileY.toFixed(2)}, ${tileZ.toFixed(2)} (tiles 0-${TERRAIN_SIZE - 1})`;
    }

    private renderObjectEditorMaterialRows(worldNumber: number, objectType: number) {
        if (!this.objectEditorMaterialsEl) return;

        this.objectEditorMaterialsEl.innerHTML = '';
        const bindings = this.collectMaterialBindingsForType(worldNumber, objectType);
        if (bindings.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'control-note';
            empty.textContent = 'No editable mesh materials found.';
            this.objectEditorMaterialsEl.appendChild(empty);
            return;
        }

        for (const binding of bindings) {
            const current = this.getMaterialOverrideFromMaterial(binding.materials[0]);
            const row = document.createElement('div');
            row.className = 'terrain-editor-material-row';
            row.dataset.materialKey = binding.key;

            const label = document.createElement('span');
            label.className = 'blend-label';
            label.textContent = binding.label;

            const select = document.createElement('select');
            select.className = 'animation-dropdown blend-select full-width';
            for (const name of TERRAIN_OBJECT_BLEND_MODE_NAMES) {
                const option = document.createElement('option');
                option.value = name;
                option.text = name;
                select.appendChild(option);
            }
            select.value = current.blending;

            const alphaRow = document.createElement('div');
            alphaRow.className = 'terrain-alpha-row';

            const alphaLabel = document.createElement('span');
            alphaLabel.textContent = 'Black Key';

            const alphaSlider = document.createElement('input');
            alphaSlider.type = 'range';
            alphaSlider.min = '0';
            alphaSlider.max = '0.5';
            alphaSlider.step = '0.01';
            alphaSlider.className = 'modern-slider';
            alphaSlider.value = current.alphaTest.toFixed(2);

            const alphaValue = document.createElement('span');
            alphaValue.className = 'blend-threshold-value';
            alphaValue.textContent = alphaSlider.value;

            const applyCurrentRow = () => {
                const alphaTest = Math.max(0, Math.min(0.5, parseFloat(alphaSlider.value) || 0));
                alphaValue.textContent = alphaTest.toFixed(2);
                this.applyMaterialOverrideToType(worldNumber, objectType, binding.key, {
                    blending: select.value as TerrainObjectBlendModeName,
                    alphaTest,
                });
            };

            select.addEventListener('change', applyCurrentRow);
            alphaSlider.addEventListener('input', applyCurrentRow);

            alphaRow.append(alphaLabel, alphaSlider, alphaValue);
            row.append(label, select, alphaRow);
            this.objectEditorMaterialsEl.appendChild(row);
        }
    }

    private applyObjectEditorTransform() {
        const record = this.selectedObjectRecord;
        if (!record) return;
        this.captureObjectEdit();

        const nextPosition = {
            x: parseFloat(this.objectEditorPosXEl?.value || `${record.selection.position.x}`),
            y: parseFloat(this.objectEditorPosYEl?.value || `${record.selection.position.y}`),
            z: parseFloat(this.objectEditorPosZEl?.value || `${record.selection.position.z}`),
        };
        const nextScale = Math.max(0.01, parseFloat(this.objectEditorScaleEl?.value || `${record.selection.scale}`) || record.selection.scale);
        const objectId = record.selection.objectId;

        const matchingRecords = this.objectRecords.filter(candidate => candidate.selection.objectId === objectId);
        this.applyTransformToObjectRecords(matchingRecords, nextPosition, nextScale);

        this.updateObjectInspector();
        this.updateSelectionMarker();
        this.updateTransformControlAttachment();
        this.minimapNeedsRedraw = true;
        this.emitStateChanged();
        this.setObjectEditorStatus('Transform applied to selected object.');
    }

    private duplicateSelectedObject(destination?: ExplorerVector3) {
        const source = this.selectedObjectRecord;
        if (!source || !this.objectsGroup) {
            this.setObjectEditorStatus('Select an object before duplicating it.');
            return;
        }
        this.captureObjectEdit();

        const nextPosition = destination ?? {
            ...source.selection.position,
            x: source.selection.position.x + TERRAIN_SCALE,
        };
        let clone: THREE.Object3D;
        if (source.object3D) {
            const circularMetadata: Array<{
                object: THREE.Object3D;
                terrainObjectRecord?: unknown;
                terrainObjectRecords?: unknown;
            }> = [];
            source.object3D.traverse(object => {
                circularMetadata.push({
                    object,
                    terrainObjectRecord: object.userData.terrainObjectRecord,
                    terrainObjectRecords: object.userData.terrainObjectRecords,
                });
                delete object.userData.terrainObjectRecord;
                delete object.userData.terrainObjectRecords;
            });
            try {
                clone = SkeletonUtils.clone(source.object3D);
            } finally {
                for (const entry of circularMetadata) {
                    if (entry.terrainObjectRecord !== undefined) {
                        entry.object.userData.terrainObjectRecord = entry.terrainObjectRecord;
                    }
                    if (entry.terrainObjectRecords !== undefined) {
                        entry.object.userData.terrainObjectRecords = entry.terrainObjectRecords;
                    }
                }
            }
        } else if (source.instancedMesh && source.instanceId !== null) {
            clone = new THREE.Mesh(source.instancedMesh.geometry, source.instancedMesh.material);
            clone.position.set(
                source.selection.position.x + TERRAIN_SCALE,
                source.selection.position.y,
                source.selection.position.z,
            );
            clone.quaternion.copy(this.getRecordVisualQuaternion(source));
            clone.scale.setScalar(source.selection.scale);
        } else {
            this.setObjectEditorStatus('The selected object cannot be duplicated.');
            return;
        }

        if (destination) {
            clone.position.set(destination.x, destination.y, destination.z);
        } else if (source.object3D) {
            clone.position.x += TERRAIN_SCALE;
        }
        // BMD roots are loaded with matrixAutoUpdate disabled. Reapply the
        // logical editor transform so the clone is rendered at its new map
        // position instead of retaining the source matrix.
        clone.matrixAutoUpdate = true;
        clone.position.set(
            nextPosition.x,
            nextPosition.y,
            nextPosition.z,
        );
        clone.quaternion.copy(this.getRecordVisualQuaternion(source));
        clone.scale.setScalar(source.selection.scale);
        clone.visible = true;
        clone.traverse(object => {
            object.visible = true;
            if ((object as THREE.Mesh).isMesh) {
                // The parent object is distance-culled by the editor. Disable
                // per-mesh frustum culling on a new clone until its world
                // bounds have been fully evaluated by the renderer.
                object.frustumCulled = false;
            }
        });
        clone.updateMatrix();
        clone.updateMatrixWorld(true);
        this.refreshObjectCullingSphere(clone);
        this.objectsGroup.add(clone);
        this.objectsGroup.updateMatrixWorld(true);
        const selection = {
            ...source.selection,
            objectId: `${source.selection.objectId}-copy-${Date.now()}`,
            displayName: `${source.selection.displayName} Copy`,
            position: nextPosition,
        };
        const duplicate: TerrainObjectSelectionRecord = {
            ...source,
            selection,
            object3D: clone,
            instancedMesh: null,
            instanceId: null,
        };
        this.objectRecords.push(duplicate);
        this.rebuildObjectCullingIndex();
        this.updateObjectDistanceCulling(true);
        const exportedDuplicate: MapObject = {
            type: selection.type,
            position: {
                x: selection.position.x,
                y: TERRAIN_WORLD_SIZE - selection.position.z,
                z: selection.position.y,
            },
            angle: { ...selection.rotation },
            scale: selection.scale,
        };
        this.duplicateObjectData.set(selection.objectId, exportedDuplicate);
        if (this.loadedObjectsData) {
            const sourceObject = this.loadedObjectsData.objects.find(object =>
                object.type === source.selection.type &&
                Math.abs(object.position.x - source.selection.position.x) < 1 &&
                Math.abs(object.position.y - (TERRAIN_WORLD_SIZE - source.selection.position.z)) < 1 &&
                Math.abs(object.position.z - source.selection.position.y) < 1,
            );
            if (sourceObject?.extra) {
                exportedDuplicate.extra = new Uint8Array(sourceObject.extra);
            }
            this.loadedObjectsData.objects.push(exportedDuplicate);
        }
        clone.traverse(object => {
            object.userData.terrainObjectRecord = duplicate;
        });
        this.updateTerrainObjectSelect();
        this.selectObjectRecord(duplicate);
        this.focusSelectedObject();
        this.updateObjectDistanceCulling(true);
        if (this.terrainMesh) {
            this.updateStats(this.getTerrainTileCount(this.terrainMesh), this.objectRecords.length);
        }
        this.emitStateChanged();
        this.setObjectEditorStatus('Object duplicated one tile to the east.');
    }

    private duplicateSelectedObjectAtEnteredCoordinates(action: 'duplicated' | 'added') {
        if (!this.selectedObjectRecord) {
            this.setObjectEditorStatus('Select an object before placing a copy.');
            return;
        }

        const x = this.parseFiniteObjectCoordinate(this.objectCopyXEl?.value);
        const y = this.parseFiniteObjectCoordinate(this.objectCopyYEl?.value);
        const z = this.parseFiniteObjectCoordinate(this.objectCopyZEl?.value);
        if (x === null || y === null || z === null) {
            this.setObjectEditorStatus('Enter valid X, Y and Z coordinates.');
            return;
        }

        try {
            const mapX = THREE.MathUtils.clamp(x, 0, TERRAIN_SIZE - 1) * TERRAIN_SCALE;
            const mapY = THREE.MathUtils.clamp(y, 0, TERRAIN_SIZE - 1) * TERRAIN_SCALE;
            const mapZ = THREE.MathUtils.clamp(z, 0, TERRAIN_SIZE - 1) * TERRAIN_SCALE;
            this.duplicateSelectedObject({ x: mapX, y: mapY, z: mapZ });
            this.setObjectEditorStatus(`Object ${action} at map tiles (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}).`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setObjectEditorStatus(`Object copy failed: ${message}`);
            console.error('[TERRAIN] Object copy failed:', error);
        }
    }

    private parseFiniteObjectCoordinate(value: string | undefined) {
        if (value === undefined || value.trim() === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    private addSelectedObjectAtCamera() {
        const source = this.selectedObjectRecord;
        if (!source || !this.objectsGroup) {
            this.setObjectEditorStatus('Select an object before adding it.');
            return;
        }
        const target = this.controls.target;
        this.duplicateSelectedObject({ x: target.x, y: target.y, z: target.z });
    }

    private applyTransformToObjectRecords(
        matchingRecords: TerrainObjectSelectionRecord[],
        nextPosition: ExplorerVector3,
        nextScale: number,
        nextRotation?: ExplorerVector3,
        nextQuaternion?: THREE.Quaternion,
    ) {
        if (matchingRecords.length === 0) return;

        const oldPosition = { ...matchingRecords[0].selection.position };
        const oldScale = Math.max(0.01, matchingRecords[0].selection.scale);
        const scaleRatio = nextScale / oldScale;
        const resolvedNextQuaternion = nextQuaternion ?? (nextRotation
            ? mapObjectAngleToVisualQuaternion(nextRotation, matchingRecords[0].baseOrientation)
            : undefined);
        const positionDelta = new THREE.Vector3(
            nextPosition.x - oldPosition.x,
            nextPosition.y - oldPosition.y,
            nextPosition.z - oldPosition.z,
        );
        const updatedInstancedMeshes = new Set<THREE.InstancedMesh>();
        for (const candidate of matchingRecords) {
            this.ensureObjectRecordDefaultTransform(candidate);
            candidate.selection.position = { ...nextPosition };
            if (nextRotation) {
                candidate.selection.rotation = { ...nextRotation };
            }
            candidate.selection.scale = nextScale;
            candidate.approximateRadius *= scaleRatio;

            if (candidate.object3D) {
                candidate.object3D.position.set(nextPosition.x, nextPosition.y, nextPosition.z);
                if (resolvedNextQuaternion) {
                    candidate.object3D.quaternion.copy(resolvedNextQuaternion);
                }
                candidate.object3D.scale.setScalar(nextScale);
                candidate.object3D.updateMatrix();
                candidate.object3D.updateMatrixWorld(true);
                this.refreshObjectCullingSphere(candidate.object3D);
            } else if (candidate.instancedMesh && typeof candidate.instanceId === 'number') {
                this.updateInstancedObjectTransform(candidate, positionDelta, scaleRatio, resolvedNextQuaternion);
                updatedInstancedMeshes.add(candidate.instancedMesh);
            }
        }

        for (const instancedMesh of updatedInstancedMeshes) {
            instancedMesh.instanceMatrix.needsUpdate = true;
            instancedMesh.computeBoundingBox();
            instancedMesh.computeBoundingSphere();
        }
        this.rebuildObjectCullingIndex();
        this.updateObjectDistanceCulling(true);
    }

    private refreshObjectCullingSphere(object: THREE.Object3D) {
        const bounds = new THREE.Box3().setFromObject(object);
        const sphere = new THREE.Sphere();
        bounds.getBoundingSphere(sphere);
        object.userData.cullBoundingSphere = sphere;
    }

    private ensureObjectRecordDefaultTransform(record: TerrainObjectSelectionRecord) {
        const selectionWithDefault = record.selection as SelectedWorldObjectRef & {
            userDataDefaultTransform?: {
                position: ExplorerVector3;
                rotation: ExplorerVector3;
                scale: number;
                approximateRadius: number;
            };
        };
        if (selectionWithDefault.userDataDefaultTransform) {
            return;
        }

        selectionWithDefault.userDataDefaultTransform = {
            position: { ...record.selection.position },
            rotation: { ...record.selection.rotation },
            scale: record.selection.scale,
            approximateRadius: record.approximateRadius,
        };
    }

    private restoreObjectDefaultTransformForRecords(records: TerrainObjectSelectionRecord[]) {
        if (records.length === 0) return;
        const defaultTransform = (records[0].selection as SelectedWorldObjectRef & {
            userDataDefaultTransform?: {
                position: ExplorerVector3;
                rotation?: ExplorerVector3;
                scale: number;
            };
        }).userDataDefaultTransform;
        if (!defaultTransform) return;

        this.applyTransformToObjectRecords(records, defaultTransform.position, defaultTransform.scale, defaultTransform.rotation);
    }

    private updateInstancedObjectTransform(
        record: TerrainObjectSelectionRecord,
        positionDelta: THREE.Vector3,
        scaleRatio: number,
        nextQuaternion?: THREE.Quaternion,
    ) {
        if (!record.instancedMesh || typeof record.instanceId !== 'number') return;

        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        record.instancedMesh.getMatrixAt(record.instanceId, matrix);
        matrix.decompose(position, rotation, scale);
        position.add(positionDelta);
        if (nextQuaternion) {
            rotation.copy(nextQuaternion);
        }
        scale.multiplyScalar(scaleRatio);
        matrix.compose(position, rotation, scale);
        record.instancedMesh.setMatrixAt(record.instanceId, matrix);
    }

    private async exportCurrentWorldObj() {
        if (!this.loadedObjectsData || this.loadedWorldNumber === null) {
            this.setObjectEditorStatus('Load a world with OBJ data before export.');
            return;
        }

        const exportRoot = await openDirectoryDialog();
        if (!exportRoot) {
            this.setObjectEditorStatus('Export cancelled.');
            return;
        }

        if (this.objectEditorExportBtn) this.objectEditorExportBtn.disabled = true;
        try {
            const exportData = this.buildCurrentWorldObjData();
            const bytes = writeOBJ(exportData);
            const fileName = this.loadedObjFileName || `EncTerrain${this.loadedWorldNumber}.obj`;
            const relativePath = `World${this.loadedWorldNumber}/${fileName}`;
            const result = await writeFileInDirectory(exportRoot, relativePath, bytes);
            if (result.error || !result.path) {
                this.setObjectEditorStatus(`Export failed: ${result.error || 'unknown error'}`);
                return;
            }

            this.setObjectEditorStatus(`Exported OBJ: ${result.path}`);
        } catch (error) {
            console.error('World OBJ export failed:', error);
            this.setObjectEditorStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (this.objectEditorExportBtn) this.objectEditorExportBtn.disabled = false;
        }
    }

    private async exportCurrentWorldData() {
        if (!this.loadedMapData || this.loadedWorldNumber === null) {
            this.setObjectEditorStatus('Load a world before exporting map data.');
            return;
        }
        const exportRoot = await openDirectoryDialog();
        if (!exportRoot) return;
        try {
            const mapResult = await writeFileInDirectory(
                exportRoot,
                `World${this.loadedWorldNumber}/${this.loadedMapFileName || `EncTerrain${this.loadedWorldNumber}.map`}`,
                writeMAP(this.loadedMapData),
            );
            if (mapResult.error || !mapResult.path) {
                this.setObjectEditorStatus(`MAP export failed: ${mapResult.error || 'unknown error'}`);
                return;
            }
            if (this.loadedObjectsData) {
                const objResult = await writeFileInDirectory(
                    exportRoot,
                    `World${this.loadedWorldNumber}/${this.loadedObjFileName || `EncTerrain${this.loadedWorldNumber}.obj`}`,
                    writeOBJ(this.buildCurrentWorldObjData()),
                );
                if (objResult.error || !objResult.path) {
                    this.setObjectEditorStatus(`MAP exported, OBJ export failed: ${objResult.error || 'unknown error'}`);
                    return;
                }
            }
            this.setObjectEditorStatus(`Exported edited MAP${this.loadedObjectsData ? ' and OBJ' : ''}.`);
        } catch (error) {
            this.setObjectEditorStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private buildCurrentWorldObjData(): OBJData {
        if (!this.loadedObjectsData) {
            throw new Error('No OBJ data loaded.');
        }

        const recordsByObjectId = new Map<string, TerrainObjectSelectionRecord>();
        for (const record of this.objectRecords) {
            recordsByObjectId.set(record.selection.objectId, record);
        }

        const objects = this.loadedObjectsData.objects.map(object => {
            const objectId = createWorldObjectId(this.loadedObjectsData!.mapNumber, object.type, {
                x: object.position.x,
                z: TERRAIN_WORLD_SIZE - object.position.y,
            });
            const record = recordsByObjectId.get(objectId);
            return record ? this.mapRecordToObjObject(record, object) : object;
        });
        for (const record of this.objectRecords) {
            const duplicate = this.duplicateObjectData.get(record.selection.objectId);
            if (!duplicate) continue;
            const existingIndex = objects.indexOf(duplicate);
            if (existingIndex >= 0) {
                objects[existingIndex] = this.mapRecordToObjObject(record, duplicate);
            }
        }

        return {
            version: this.loadedObjectsData.version,
            mapNumber: this.loadedObjectsData.mapNumber,
            objects,
        };
    }

    private mapRecordToObjObject(record: TerrainObjectSelectionRecord, original: MapObject): MapObject {
        return {
            ...original,
            type: record.selection.type,
            position: {
                x: record.selection.position.x,
                y: TERRAIN_WORLD_SIZE - record.selection.position.z,
                z: record.selection.position.y,
            },
            angle: { ...record.selection.rotation },
            scale: record.selection.scale,
        };
    }

    private async saveSelectedObjectTypeSettings() {
        const record = this.selectedObjectRecord;
        if (!record) return;

        const materials: Record<string, TerrainObjectMaterialOverride> = {};
        for (const binding of this.collectMaterialBindingsForType(record.selection.worldNumber, record.selection.type)) {
            materials[binding.key] = this.getMaterialOverrideFromMaterial(binding.materials[0]);
        }

        this.objectOverrides = upsertTerrainObjectTypeOverride(
            this.objectOverrides,
            record.selection.worldNumber,
            record.selection.type,
            { materials },
        );
        this.objectOverrides = upsertTerrainObjectTransformOverride(
            this.objectOverrides,
            record.selection.worldNumber,
            record.selection.objectId,
            {
                position: { ...record.selection.position },
                rotation: { ...record.selection.rotation },
                scale: record.selection.scale,
            },
        );
        await this.writeObjectOverrides('Saved object settings');
    }

    private async resetSelectedObjectTypeSettings() {
        const record = this.selectedObjectRecord;
        if (!record) return;

        this.objectOverrides = removeTerrainObjectTypeOverride(
            this.objectOverrides,
            record.selection.worldNumber,
            record.selection.type,
        );
        this.objectOverrides = removeTerrainObjectTransformOverride(
            this.objectOverrides,
            record.selection.worldNumber,
            record.selection.objectId,
        );
        const matchingRecords = this.objectRecords.filter(candidate => candidate.selection.objectId === record.selection.objectId);
        this.restoreObjectDefaultTransformForRecords(matchingRecords);
        this.restoreMaterialDefaultsForType(record.selection.worldNumber, record.selection.type);
        this.updateObjectInspector();
        this.updateSelectionMarker();
        this.updateTransformControlAttachment();
        this.populateObjectEditorPanel();
        await this.writeObjectOverrides('Reset object settings');
    }

    private applyPersistedObjectTypeOverridesForWorld(worldNumber: number) {
        const worldOverrides = this.objectOverrides.worlds[String(worldNumber)];
        if (!worldOverrides) return;

        for (const [objectId, transformOverride] of Object.entries(worldOverrides.objects)) {
            const matchingRecords = this.objectRecords.filter(candidate => candidate.selection.objectId === objectId);
            this.applyTransformToObjectRecords(
                matchingRecords,
                transformOverride.position,
                transformOverride.scale,
                transformOverride.rotation,
            );
        }

        for (const [typeKey, typeOverride] of Object.entries(worldOverrides.objectTypes)) {
            const objectType = parseInt(typeKey, 10);
            if (Number.isNaN(objectType)) continue;
            for (const [materialKey, materialOverride] of Object.entries(typeOverride.materials)) {
                this.applyMaterialOverrideToType(worldNumber, objectType, materialKey, materialOverride);
            }
        }
    }

    private applyMaterialOverrideToType(
        worldNumber: number,
        objectType: number,
        materialKey: string,
        materialOverride: TerrainObjectMaterialOverride,
    ) {
        for (const binding of this.collectMaterialBindingsForType(worldNumber, objectType)) {
            if (binding.key !== materialKey) continue;
            binding.materials.forEach(material => this.applyMaterialOverrideToMaterial(material, materialOverride));
        }
    }

    private restoreMaterialDefaultsForType(worldNumber: number, objectType: number) {
        for (const binding of this.collectMaterialBindingsForType(worldNumber, objectType)) {
            binding.materials.forEach(material => this.restoreMaterialDefault(material));
        }
    }

    private collectMaterialBindingsForType(worldNumber: number, objectType: number): TerrainMaterialBinding[] {
        if (!this.objectsGroup) return [];

        const bindingMap = new Map<string, { key: string; label: string; materialSet: Set<THREE.Material> }>();
        this.objectsGroup.traverse(obj => {
            const mesh = obj as THREE.Mesh;
            if (!mesh.isMesh) return;

            const directRecord = mesh.userData.terrainObjectRecord as TerrainObjectSelectionRecord | undefined;
            const instancedRecords = mesh.userData.terrainObjectRecords as TerrainObjectSelectionRecord[] | undefined;
            const record = directRecord ?? instancedRecords?.[0];
            if (!record || record.selection.worldNumber !== worldNumber || record.selection.type !== objectType) {
                return;
            }

            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((material, index) => {
                if (!material) return;
                this.ensureMaterialDefault(material);
                const key = `${this.getStableMeshMaterialKey(mesh.name)}:${index}`;
                const existing = bindingMap.get(key);
                if (existing) {
                    existing.materialSet.add(material);
                } else {
                    bindingMap.set(key, {
                        key,
                        label: `${this.getStableMeshMaterialKey(mesh.name)} material ${index + 1}`,
                        materialSet: new Set([material]),
                    });
                }
            });
        });

        return [...bindingMap.values()]
            .sort((a, b) => a.key.localeCompare(b.key))
            .map(binding => ({
                key: binding.key,
                label: binding.label,
                materials: [...binding.materialSet],
            }));
    }

    private getStableMeshMaterialKey(meshName: string): string {
        const base = meshName || 'mesh';
        return base.replace(/_(all|-?\d+:-?\d+)$/, '');
    }

    private getMaterialOverrideFromMaterial(material: THREE.Material): TerrainObjectMaterialOverride {
        return {
            blending: TERRAIN_THREE_BLEND_TO_OBJECT_MODE.get(material.blending) ?? 'Normal',
            alphaTest: this.getMaterialBlackKeyThreshold(material),
        };
    }

    private applyMaterialOverrideToMaterial(material: THREE.Material, materialOverride: TerrainObjectMaterialOverride) {
        this.ensureMaterialDefault(material);
        const defaults = this.getMaterialDefault(material);
        const blending = TERRAIN_OBJECT_BLEND_MODE_TO_THREE[materialOverride.blending];
        material.blending = blending;
        material.transparent = blending !== THREE.NoBlending;
        material.depthWrite = blending === THREE.NoBlending;
        if ('alphaTest' in material) {
            (material as THREE.MeshPhongMaterial).alphaTest = defaults.alphaTest;
        }
        this.rememberTerrainObjectBlackKeyBase(material);
        material.userData.terrainObjectBlackKeyThreshold = Math.max(0, Math.min(0.5, materialOverride.alphaTest));
        this.applyTerrainObjectBlackKeyThresholdToMaterial(material);
    }

    private ensureMaterialDefault(material: THREE.Material) {
        if (material.userData.terrainObjectDefaultMaterial) {
            return;
        }

        material.userData.terrainObjectDefaultMaterial = {
            blending: material.blending,
            transparent: material.transparent,
            depthWrite: material.depthWrite,
            alphaTest: 'alphaTest' in material ? (material as THREE.MeshPhongMaterial).alphaTest : 0,
        };
    }

    private getMaterialDefault(material: THREE.Material): {
        blending: THREE.Blending;
        transparent: boolean;
        depthWrite: boolean;
        alphaTest: number;
    } {
        this.ensureMaterialDefault(material);
        return material.userData.terrainObjectDefaultMaterial as {
            blending: THREE.Blending;
            transparent: boolean;
            depthWrite: boolean;
            alphaTest: number;
        };
    }

    private restoreMaterialDefault(material: THREE.Material) {
        const defaults = material.userData.terrainObjectDefaultMaterial as {
            blending: THREE.Blending;
            transparent: boolean;
            depthWrite: boolean;
            alphaTest: number;
        } | undefined;
        if (!defaults) return;

        material.blending = defaults.blending;
        material.transparent = defaults.transparent;
        material.depthWrite = defaults.depthWrite;
        if ((material as THREE.MeshPhongMaterial).map) {
            this.disposeTerrainObjectDerivedAlphaTexture((material as THREE.MeshPhongMaterial).map!);
        }
        if ('alphaMap' in material) {
            (material as THREE.MeshPhongMaterial).alphaMap = null;
        }
        if ('alphaTest' in material) {
            (material as THREE.MeshPhongMaterial).alphaTest = defaults.alphaTest;
        }
        delete material.userData.terrainObjectBlackKeyThreshold;
        delete material.userData.terrainObjectBlackKeyBase;
        material.needsUpdate = true;
    }

    private rememberTerrainObjectBlackKeyBase(material: THREE.Material) {
        material.userData.terrainObjectBlackKeyBase = {
            alphaTest: 'alphaTest' in material ? (material as THREE.MeshPhongMaterial).alphaTest : 0,
            transparent: material.transparent,
            depthWrite: material.depthWrite,
            blending: material.blending,
        };
    }

    private getMaterialBlackKeyThreshold(material: THREE.Material): number {
        const stored = material.userData.terrainObjectBlackKeyThreshold;
        return typeof stored === 'number' ? Math.max(0, Math.min(0.5, stored)) : 0;
    }

    private applyTerrainObjectBlackKeyThresholdToMaterial(material: THREE.Material) {
        if (!(material instanceof THREE.MeshPhongMaterial)) {
            material.needsUpdate = true;
            return;
        }

        const base = material.userData.terrainObjectBlackKeyBase as {
            alphaTest: number;
            transparent: boolean;
            depthWrite: boolean;
            blending: THREE.Blending;
        } | undefined;
        const threshold = this.getMaterialBlackKeyThreshold(material);

        if (!base) {
            this.rememberTerrainObjectBlackKeyBase(material);
            this.applyTerrainObjectBlackKeyThresholdToMaterial(material);
            return;
        }

        if (!material.map || threshold <= 0) {
            material.alphaMap = null;
            material.alphaTest = base.alphaTest;
            material.transparent = base.transparent;
            material.depthWrite = base.depthWrite;
            material.blending = base.blending;
            material.needsUpdate = true;
            return;
        }

        const alphaMap = this.ensureTerrainObjectBlackKeyAlphaMap(material.map);
        if (!alphaMap) {
            material.alphaMap = null;
            material.alphaTest = base.alphaTest;
            material.transparent = base.transparent;
            material.depthWrite = base.depthWrite;
            material.blending = base.blending;
            material.needsUpdate = true;
            return;
        }

        material.alphaMap = alphaMap;
        material.alphaTest = Math.max(base.alphaTest, threshold);
        material.transparent = base.transparent;
        material.depthWrite = base.depthWrite;
        material.blending = base.blending;
        material.needsUpdate = true;
    }

    private ensureTerrainObjectBlackKeyAlphaMap(texture: THREE.Texture): THREE.Texture | null {
        const cached = texture.userData?.terrainObjectBlackKeyAlphaMap as THREE.Texture | undefined;
        if (cached) {
            return cached;
        }

        const sourceImage = texture.image;
        if (!this.isDrawableTextureImage(sourceImage)) {
            return null;
        }

        const canvas = document.createElement('canvas');
        canvas.width = sourceImage.width;
        canvas.height = sourceImage.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
            return null;
        }

        context.drawImage(sourceImage, 0, 0);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;
        for (let index = 0; index < pixels.length; index += 4) {
            const mask = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]);
            const originalAlpha = pixels[index + 3] / 255;
            const value = Math.round(mask * originalAlpha);
            pixels[index] = value;
            pixels[index + 1] = value;
            pixels[index + 2] = value;
            pixels[index + 3] = 255;
        }
        context.putImageData(imageData, 0, 0);

        const alphaMap = new THREE.CanvasTexture(canvas);
        alphaMap.colorSpace = THREE.NoColorSpace;
        alphaMap.wrapS = texture.wrapS;
        alphaMap.wrapT = texture.wrapT;
        alphaMap.flipY = texture.flipY;
        alphaMap.name = `${texture.name || 'texture'}__terrain_black_key_alpha`;
        alphaMap.needsUpdate = true;
        texture.userData.terrainObjectBlackKeyAlphaMap = alphaMap;
        return alphaMap;
    }

    private disposeTerrainObjectDerivedAlphaTexture(texture: THREE.Texture) {
        const derived = texture.userData?.terrainObjectBlackKeyAlphaMap as THREE.Texture | undefined;
        if (derived) {
            derived.dispose();
            delete texture.userData.terrainObjectBlackKeyAlphaMap;
        }
    }

    private isDrawableTextureImage(
        source: unknown,
    ): source is CanvasImageSource & { width: number; height: number } {
        if (!source) return false;
        if (typeof source !== 'object' && typeof source !== 'function') return false;

        const candidate = source as { width?: unknown; height?: unknown };
        return typeof candidate.width === 'number' && typeof candidate.height === 'number';
    }

    private setObjectEditorStatus(message: string) {
        if (this.objectEditorStatusEl) {
            this.objectEditorStatusEl.textContent = message;
        }
        const visibleStatus = document.getElementById('terrain-object-import-status');
        if (visibleStatus) {
            visibleStatus.textContent = message;
        }
    }

    private updateSelectionMarker() {
        if (!this.selectionMarker) return;
        if (!this.selectedObjectRecord || this.presentationMode) {
            this.selectionMarker.visible = false;
            this.updateSelectionBoundingBoxHelper();
            return;
        }

        const position = this.selectedObjectRecord.selection.position;
        this.selectionMarker.visible = true;
        this.selectionMarker.position.set(position.x, position.y + 8, position.z);
        const scale = Math.max(90, this.selectedObjectRecord.approximateRadius * 1.35);
        this.selectionMarker.scale.set(scale, scale, scale);
        this.updateSelectionBoundingBoxHelper();
    }

    private updateSelectionBoundingBoxHelper() {
        if (!this.selectionBoundingBoxHelper) return;
        const record = this.selectedObjectRecord;
        if (!record || this.presentationMode) {
            this.selectionBoundingBoxHelper.visible = false;
            return;
        }

        this.selectionBoundingBox.makeEmpty();
        const hasBox = updateTerrainObjectSelectionBox(record, this.selectionBoundingBox);
        this.selectionBoundingBoxHelper.visible = hasBox;
        if (hasBox) {
            this.selectionBoundingBoxHelper.updateMatrixWorld(true);
        }
    }

    private focusSelectedObject() {
        const record = this.selectedObjectRecord;
        if (!record) return;

        const target = new THREE.Vector3(
            record.selection.position.x,
            record.selection.position.y + record.approximateRadius * 0.25,
            record.selection.position.z,
        );

        this.tempFocusOffset.copy(this.camera.position).sub(this.controls.target);
        const offsetLength = Math.max(this.tempFocusOffset.length(), record.approximateRadius * 6);
        if (this.tempFocusOffset.lengthSq() < 1e-8) {
            this.tempFocusOffset.set(record.approximateRadius * 3, record.approximateRadius * 2.4, record.approximateRadius * 3);
        } else {
            this.tempFocusOffset.normalize().multiplyScalar(offsetLength);
            if (this.tempFocusOffset.y < record.approximateRadius * 1.6) {
                this.tempFocusOffset.y = record.approximateRadius * 1.6;
            }
        }

        this.controls.target.copy(target);
        this.camera.position.copy(target).add(this.tempFocusOffset);
        this.controls.update();
        this.scheduleCameraChangedEmit();
        this.minimapNeedsRedraw = true;
    }

    private isolateSelectedObject() {
        if (!this.selectedObjectRecord || !this.objectsGroup) return;
        this.isolatedObjectRecord = this.selectedObjectRecord;
        this.updateObjectDistanceCulling(true);
    }

    private resetObjectIsolation() {
        this.isolatedObjectRecord = null;
        this.updateObjectDistanceCulling(true);
    }

    private applyPendingRestoreState() {
        if (!this.pendingRestoreState || this.loadedWorldNumber === null) return;
        if (this.pendingRestoreState.lastWorldNumber !== null && this.pendingRestoreState.lastWorldNumber !== this.loadedWorldNumber) {
            return;
        }

        if (this.pendingRestoreState.cameraPosition && this.pendingRestoreState.cameraTarget) {
            this.applyCameraState(this.pendingRestoreState.cameraPosition, this.pendingRestoreState.cameraTarget);
        }
        if (this.pendingRestoreState.selectedObject) {
            const record = this.findRecordForSelection(this.pendingRestoreState.selectedObject);
            if (record) {
                this.selectObjectRecord(record);
            }
        }
        this.pendingRestoreState = null;
    }

    private findRecordForSelection(selection: SelectedWorldObjectRef): TerrainObjectSelectionRecord | null {
        const byId = this.objectRecords.find(record => record.selection.objectId === selection.objectId);
        if (byId) {
            return byId;
        }

        return this.objectRecords.find(record =>
            record.selection.type === selection.type &&
            Math.abs(record.selection.position.x - selection.position.x) < 1 &&
            Math.abs(record.selection.position.z - selection.position.z) < 1,
        ) || null;
    }

    private applyCameraState(cameraPosition: ExplorerVector3, cameraTarget: ExplorerVector3) {
        this.camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
        this.controls.target.set(cameraTarget.x, cameraTarget.y, cameraTarget.z);
        this.controls.update();
        this.updateCoordinateInputs(cameraTarget.x, cameraTarget.z);
        this.minimapNeedsRedraw = true;
    }

    private jumpToCoordinates(worldX: number, worldZ: number) {
        const targetX = THREE.MathUtils.clamp(worldX, 0, TERRAIN_WORLD_SIZE);
        const targetZ = THREE.MathUtils.clamp(worldZ, 0, TERRAIN_WORLD_SIZE);
        this.tempFocusOffset.copy(this.camera.position).sub(this.controls.target);
        this.controls.target.set(targetX, this.controls.target.y, targetZ);
        this.camera.position.copy(this.controls.target).add(this.tempFocusOffset);
        this.controls.update();
        this.updateCoordinateInputs(targetX, targetZ);
        this.scheduleCameraChangedEmit();
        this.minimapNeedsRedraw = true;
    }

    private getTerrainTileCount(mesh: THREE.Mesh): number {
        const geometry = mesh.geometry as THREE.BufferGeometry;
        const tileCount = mesh.userData.tileCount;
        if (typeof tileCount === 'number') {
            return tileCount;
        }
        const indexCount = geometry.getIndex()?.count ?? 0;
        if (indexCount > 0) {
            return Math.floor(indexCount / 6);
        }
        const positionCount = geometry.getAttribute('position')?.count ?? 0;
        return Math.floor(positionCount / 4);
    }

    private forEachTerrainMaterial(root: THREE.Object3D, callback: (material: THREE.Material) => void) {
        root.traverse(object => {
            const material = (object as THREE.Mesh).material;
            if (Array.isArray(material)) {
                material.forEach(callback);
            } else if (material instanceof THREE.Material) {
                callback(material);
            }
        });
    }

    private disposeTerrainObject(root: THREE.Object3D) {
        Disposer.disposeObject3D(root, false);
    }

    private updateStats(tileCount: number, objectCount: number) {
        if (this.tileCountEl) this.tileCountEl.textContent = Math.max(0, tileCount).toLocaleString();
        if (this.objectCountEl) this.objectCountEl.textContent = Math.max(0, objectCount).toLocaleString();
    }

    private updateTerrainAttributePanel(summary: TerrainAttributeSummary | null) {
        if (this.terrainAttributeStatusEl) {
            this.terrainAttributeStatusEl.textContent = summary
                ? `ATT loaded for World ${this.loadedWorldNumber ?? '-'}`
                : 'Load a world to inspect ATT metadata.';
        }
        if (this.terrainAttributeVersionEl) {
            this.terrainAttributeVersionEl.textContent = summary ? `${summary.version}` : '-';
        }
        if (this.terrainAttributeIndexEl) {
            this.terrainAttributeIndexEl.textContent = summary ? `${summary.index}` : '-';
        }
        if (this.terrainAttributeDimensionsEl) {
            this.terrainAttributeDimensionsEl.textContent = summary
                ? `${summary.width} × ${summary.height}`
                : '-';
        }
        if (this.terrainAttributeFormatEl) {
            this.terrainAttributeFormatEl.textContent = summary ? summary.formatLabel : '-';
        }
        if (this.terrainAttributeTilesEl) {
            this.terrainAttributeTilesEl.textContent = summary
                ? summary.tileCount.toLocaleString()
                : '-';
        }
        if (this.terrainAttributeOccupiedEl) {
            this.terrainAttributeOccupiedEl.textContent = summary
                ? summary.occupiedTileCount.toLocaleString()
                : '-';
        }
        this.renderTerrainAttributeLegend(summary?.flags ?? null);
        if (this.terrainAttOverlay) {
            const wasVisible = this.terrainAttOverlay.isVisible();
            this.terrainAttOverlay.setData(this.loadedAttData, this.getTerrainOverlaySourceGeometry());
            this.terrainAttOverlay.setVisible(wasVisible);
            if (this.attOverlayToggleBtn) {
                this.attOverlayToggleBtn.textContent = wasVisible ? 'Hide ATT Overlay' : 'Show ATT Overlay';
            }
        }
    }

    private refreshTerrainAttOverlay() {
        if (!this.terrainAttOverlay) return;
        const wasVisible = this.terrainAttOverlay.isVisible();
        this.terrainAttOverlay.setData(this.loadedAttData, this.getTerrainOverlaySourceGeometry());
        this.terrainAttOverlay.setVisible(wasVisible);
        if (this.attOverlayToggleBtn) {
            this.attOverlayToggleBtn.textContent = wasVisible ? 'Hide ATT Overlay' : 'Show ATT Overlay';
        }
    }

    private getTerrainOverlaySourceGeometry(): THREE.BufferGeometry | null {
        if (!this.terrainMesh) {
            return null;
        }

        const minimapGeometry = this.terrainMesh.userData.minimapGeometry;
        if (minimapGeometry instanceof THREE.BufferGeometry) {
            return minimapGeometry;
        }

        return this.terrainMesh.geometry ?? null;
    }

    private renderTerrainAttributeLegend(flags: TerrainAttributeFlagSummary[] | null) {
        if (!this.terrainAttributeLegendEl) {
            return;
        }

        const entries = flags ?? TERRAIN_ATTRIBUTE_FLAG_DEFINITIONS.map(definition => ({
            ...definition,
            count: 0,
            active: false,
        }));

        this.terrainAttributeLegendEl.replaceChildren(
            ...entries.map(entry => {
                const chip = document.createElement('div');
                chip.className = 'terrain-attribute-flag';
                if (!entry.active) {
                    chip.classList.add('terrain-attribute-flag--inactive');
                }

                const topRow = document.createElement('div');
                topRow.className = 'terrain-attribute-flag-top';

                const name = document.createElement('span');
                name.className = 'terrain-attribute-flag-name';
                name.textContent = entry.name;

                const count = document.createElement('span');
                count.className = 'terrain-attribute-flag-count';
                count.textContent = `${entry.count.toLocaleString()} tiles`;

                topRow.append(name, count);

                const code = document.createElement('span');
                code.className = 'terrain-attribute-flag-code';
                code.textContent = formatTerrainAttributeFlagHex(entry.flag);

                chip.append(topRow, code);
                return chip;
            }),
        );
    }

    private async prewarmTerrainObjectResources(root: THREE.Object3D) {
        if (!this.renderer || !this.camera || !this.scene) return;

        const renderer = this.renderer as TerrainObjectWarmupRenderer;

        for (const texture of collectTerrainObjectWarmupTextures(root)) {
            renderer.initTexture?.(texture);
        }

        if (!renderer.compileAsync) {
            try {
                renderer.compile?.(root, this.camera, this.scene);
            } catch (error) {
                console.warn('Terrain object resource pre-warm failed:', error);
            }
            return;
        }

        // Phase 1: compile what is currently in the camera frustum. This is the
        // pre-fix behavior — fast, and ensures the renderer is initialized so
        // phase 2's sync-trick is safe to rely on.
        try {
            await renderer.compileAsync(root, this.camera, this.scene);
        } catch (error) {
            console.warn('Terrain object resource pre-warm (visible pass) failed:', error);
        }
    }

    private async prewarmTerrainObjectResourcesBackground(root: THREE.Object3D) {
        if (!this.renderer || !this.camera || !this.scene) return;

        const renderer = this.renderer as TerrainObjectWarmupRenderer;
        if (!renderer.compileAsync) return;

        // Phase 2: background compile of objects outside the camera frustum.
        // WebGPU's compileAsync respects frustumCulled inside _projectObject, so
        // anything off-screen at load time would otherwise compile on demand
        // when the distance culler first reveals it — a visible hitch.
        //
        // We walk the object group one child at a time and rely on the fact
        // that compileAsync is synchronous up to its final `await
        // Promise.all(compilationPromises)` (see three/src/renderers/common/
        // Renderer.js). That lets us force visible=true / frustumCulled=false
        // only for the window where compileAsync builds the render list, then
        // restore the flags before any await yields control. Render ticks that
        // run between children therefore never observe forced-visible objects,
        // so nothing flashes on screen.
        //
        // Between children we budget a few ms of work and then yield on rAF so
        // the main thread stays responsive through the whole background pass.
        const children = [...root.children];
        const frameBudgetMs = 4;
        let budgetStart =
            typeof performance !== 'undefined' ? performance.now() : Date.now();

        for (const child of children) {
            if (root !== this.objectsGroup) return; // world changed, cancel

            const meshOverrides: THREE.Object3D[] = [];
            const savedVisible = child.visible;
            child.visible = true;
            child.traverse(object => {
                if (!(object as THREE.Mesh).isMesh) return;
                if (!object.frustumCulled) return;
                object.frustumCulled = false;
                meshOverrides.push(object);
            });

            let compilePromise: Promise<unknown> | undefined;
            try {
                compilePromise = renderer.compileAsync(child, this.camera, this.scene);
            } catch (error) {
                console.warn('Terrain object resource pre-warm (background) failed:', error);
            }

            child.visible = savedVisible;
            for (const mesh of meshOverrides) {
                mesh.frustumCulled = true;
            }

            if (compilePromise) {
                try {
                    await compilePromise;
                } catch (error) {
                    console.warn('Terrain object resource pre-warm (background) compile rejected:', error);
                }
            }

            const nowMs =
                typeof performance !== 'undefined' ? performance.now() : Date.now();
            if (nowMs - budgetStart > frameBudgetMs) {
                await new Promise<void>(resolve => {
                    if (typeof requestAnimationFrame === 'function') {
                        requestAnimationFrame(() => resolve());
                    } else {
                        setTimeout(resolve, 0);
                    }
                });
                budgetStart =
                    typeof performance !== 'undefined' ? performance.now() : Date.now();
            }
        }
    }

    private clearObjectCullingIndex() {
        this.objectCullingIndex.clear();
    }

    private rebuildObjectCullingIndex() {
        this.clearObjectCullingIndex();
        if (!this.objectsGroup) return;
        this.objectCullingIndex.rebuild(this.objectsGroup.children);
    }

    private collectObjectCullingCandidates(cameraPos: THREE.Vector3): Set<THREE.Object3D> {
        return this.objectCullingIndex.collectCandidates(
            cameraPos,
            this.objectDrawDistance,
            TERRAIN_OBJECT_INSTANCE_CHUNK_WORLD_SIZE,
        );
    }

    private updateObjectDistanceCulling(force = false) {
        if (!this.objectsGroup || !this.objectsGroup.visible) return;

        const now = performance.now();
        if (!force && now - this.objectCullLastUpdateMs < TERRAIN_OBJECT_CULL_INTERVAL_MS) {
            return;
        }

        if (this.isolatedObjectRecord) {
            this.objectCullingIndex.clearVisible();
            for (const child of this.objectsGroup.children) {
                child.visible = this.isChildVisibleForIsolatedRecord(child, this.isolatedObjectRecord);
                if (child.visible) {
                    this.objectCullingIndex.addVisible(child);
                }
            }
            this.objectCullLastUpdateMs = now;
            return;
        }

        // Build camera frustum once per cull pass for group-level culling.
        this.projScreenMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

        const maxDistance = this.objectDrawDistance;
        const cameraPos = this.camera.position;
        const candidates = this.collectObjectCullingCandidates(cameraPos);
        const nextVisible = new Set<THREE.Object3D>();

        for (const child of candidates) {
            const visible = this.isWithinDrawRange(child, cameraPos, maxDistance);
            child.visible = visible;
            if (visible) {
                nextVisible.add(child);
            }
        }

        this.objectCullingIndex.forEachVisible(child => {
            if (!nextVisible.has(child)) {
                child.visible = false;
            }
        });

        this.objectCullingIndex.replaceVisible(nextVisible);
        this.objectCullLastUpdateMs = now;
    }

    private updateAnimatedObjects(deltaSeconds: number) {
        if (!this.animationsEnabled || !this.objectsGroup?.visible || this.animatedObjectInstances.length === 0) {
            return;
        }

        // Skip mixer.update() for objects beyond animation distance — they
        // stay visible in their current pose but the animation freezes, saving
        // significant per-frame overhead for distant objects.
        const animDistSq = (this.objectDrawDistance * TERRAIN_OBJECT_ANIM_DISTANCE_RATIO) ** 2;
        const cameraPos = this.camera.position;

        for (const animatedInstance of this.animatedObjectInstances) {
            const visible = animatedInstance.isVisible
                ? animatedInstance.isVisible()
                : animatedInstance.object3D.visible;
            if (!visible) continue;
            if (!animatedInstance.ignoreDistanceCulling && animatedInstance.worldPosition.distanceToSquared(cameraPos) > animDistSq) continue;

            if (animatedInstance.update) {
                animatedInstance.update(deltaSeconds);
            } else {
                animatedInstance.mixer?.update(deltaSeconds);
            }
        }
    }

    private isChildVisibleForIsolatedRecord(child: THREE.Object3D, record: TerrainObjectSelectionRecord): boolean {
        if (record.instancedMesh) {
            return child === record.instancedMesh;
        }
        return child === record.object3D;
    }

    private isWithinDrawRange(object: THREE.Object3D, cameraPos: THREE.Vector3, maxDistance: number): boolean {
        const { center, radius } = getTerrainObjectDrawRangeSphere(object, this.tempCullCenter, this.tempCullScale);

        // Distance check.
        const maxRange = maxDistance + radius;
        if (center.distanceToSquared(cameraPos) > maxRange * maxRange) return false;

        // Frustum check — prevents Three.js from traversing into off-screen Groups.
        this.tempBoundingSphere.center.copy(center);
        this.tempBoundingSphere.radius = radius;
        return this.frustum.intersectsSphere(this.tempBoundingSphere);
    }

    private setBrightness(value: number) {
        const safeValue = Math.max(0.1, value);
        if (this.renderer) {
            this.renderer.toneMappingExposure = safeValue;
        }
        if (this.ambientLight) this.ambientLight.intensity = TERRAIN_BASE_AMBIENT_INTENSITY * safeValue;
        if (this.sunLight) this.sunLight.intensity = TERRAIN_BASE_SUN_INTENSITY * safeValue;
    }

    private getRendererMaxAnisotropy(): number {
        if (!this.renderer) {
            return 1;
        }
        if (isWebGLRenderer(this.renderer)) {
            return this.renderer.capabilities.getMaxAnisotropy();
        }

        const value = this.renderer.backend.getMaxAnisotropy?.();
        // WebGPU spec guarantees 16x anisotropy support; fallback if backend doesn't expose the method.
        return typeof value === 'number' && Number.isFinite(value) ? value : 16;
    }

    private applyTerrainTextureQuality() {
        if (!this.terrainMesh) return;

        const anisotropy = Math.max(1, Math.min(16, this.getRendererMaxAnisotropy()));
        this.forEachTerrainMaterial(this.terrainMesh, material => {
            const map = (material as THREE.Material & { map?: THREE.Texture | null }).map;
            if (!(map instanceof THREE.Texture)) {
                return;
            }

            map.anisotropy = anisotropy;
            map.needsUpdate = true;
        });
    }

    private updateTerrainMaterialState() {
        if (this.terrainMesh && this.wireframeEl) {
            this.forEachTerrainMaterial(this.terrainMesh, material => {
                const terrainMaterial = material as THREE.Material & { wireframe?: boolean };
                if ('wireframe' in terrainMaterial) {
                    terrainMaterial.wireframe = this.wireframeEl!.checked;
                    terrainMaterial.needsUpdate = true;
                }
            });
        }
        if (this.objectsGroup && this.showObjectsEl) {
            this.objectsGroup.visible = this.showObjectsEl.checked;
        }
    }

    private handleMovementKey(event: KeyboardEvent, isDown: boolean) {
        if (!this.isActive) return;
        if (this.characterPlayMode) {
            return;
        }
        if (isDown && event.code === 'Escape') {
            this.clearSelection();
            event.preventDefault();
            return;
        }
        const code = event.code as MovementKeyCode;
        if (!MOVEMENT_KEYS.includes(code)) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        if (isDown && this.isTypingIntoUI(event.target)) {
            return;
        }

        this.movementKeys[code] = isDown;
        event.preventDefault();
    }

    private isTypingIntoUI(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLElement)) return false;
        const tagName = target.tagName.toLowerCase();
        return (
            tagName === 'input' ||
            tagName === 'textarea' ||
            tagName === 'select' ||
            target.isContentEditable
        );
    }

    private resetMovementKeys() {
        this.movementKeys.KeyW = false;
        this.movementKeys.KeyA = false;
        this.movementKeys.KeyS = false;
        this.movementKeys.KeyD = false;
        this.movementKeys.ShiftLeft = false;
        this.movementKeys.ShiftRight = false;
    }

    private updateKeyboardMovement(deltaSeconds: number) {
        if (this.characterPlayMode) {
            this.updateCharacterClickMovement(deltaSeconds);
            return;
        }
        const forwardInput = (this.movementKeys.KeyW ? 1 : 0) + (this.movementKeys.KeyS ? -1 : 0);
        const rightInput = (this.movementKeys.KeyA ? 1 : 0) + (this.movementKeys.KeyD ? -1 : 0);
        const moving = forwardInput !== 0 || rightInput !== 0;
        const sprinting = this.movementKeys.ShiftLeft || this.movementKeys.ShiftRight;
        if (this.characterPlayMode) this.setCharacterPlayAnimation(moving, sprinting);
        if (!moving) return;

        this.camera.getWorldDirection(this.tempMoveForward);
        this.tempMoveForward.y = 0;
        if (this.tempMoveForward.lengthSq() < 1e-8) return;
        this.tempMoveForward.normalize();

        this.tempMoveRight.set(this.tempMoveForward.z, 0, -this.tempMoveForward.x).normalize();
        this.tempMoveDelta.set(0, 0, 0);
        this.tempMoveDelta.addScaledVector(this.tempMoveForward, forwardInput);
        this.tempMoveDelta.addScaledVector(this.tempMoveRight, rightInput);
        if (this.tempMoveDelta.lengthSq() < 1e-8) return;
        this.tempMoveDelta.normalize();

        const speed = TERRAIN_CAMERA_MOVE_SPEED * (sprinting ? TERRAIN_CAMERA_SPRINT_MULTIPLIER : 1);
        this.tempMoveDelta.multiplyScalar(speed * deltaSeconds);

        this.camera.position.add(this.tempMoveDelta);
        this.controls.target.add(this.tempMoveDelta);
        this.updateCoordinateInputs(this.controls.target.x, this.controls.target.z);
        this.scheduleCameraChangedEmit();
        this.minimapNeedsRedraw = true;
    }

    private updateCharacterClickMovement(deltaSeconds: number): void {
            if (!this.characterPlayGroup || !this.characterPlayDestination) {
                this.setCharacterPlayAnimation(false, false);
                return;
            }

            this.tempMoveDelta.copy(this.characterPlayDestination).sub(this.characterPlayPosition);
            this.tempMoveDelta.y = 0;
            const distance = this.tempMoveDelta.length();
            if (distance < 20) {
                this.characterPlayPosition.copy(this.characterPlayDestination);
                this.characterPlayPosition.y = this.getTerrainWorldHeight(
                    this.characterPlayPosition.x,
                    this.characterPlayPosition.z,
                );
                this.characterPlayGroup.position.copy(this.characterPlayPosition);
                this.characterPlayDestination = null;
                this.setCharacterPlayAnimation(false, false);
                return;
            }

            this.tempMoveDelta.normalize();
            this.setCharacterPlayAnimation(true, false);
            const step = Math.min(distance, this.characterPlaySpeed * deltaSeconds);
            const nextPosition = this.characterPlayPosition.clone().addScaledVector(this.tempMoveDelta, step);
            nextPosition.x = THREE.MathUtils.clamp(nextPosition.x, 0, TERRAIN_WORLD_SIZE);
            nextPosition.z = THREE.MathUtils.clamp(nextPosition.z, 0, TERRAIN_WORLD_SIZE);
            if (this.isCharacterTileBlocked(nextPosition.x, nextPosition.z)) {
                this.characterPlayDestination = null;
                this.setCharacterPlayAnimation(false, false);
                this.setCharacterPlayStatus('Movement stopped by an ATT blocked area.');
                return;
            }
            nextPosition.y = this.getTerrainWorldHeight(nextPosition.x, nextPosition.z);
            this.characterPlayPosition.copy(nextPosition);
            this.characterPlayGroup.position.copy(nextPosition);
            this.setCharacterPlayFacing(this.tempMoveDelta);
            this.camera.position.copy(nextPosition).add(this.characterPlayCameraOffset);
            this.controls.target.set(nextPosition.x, nextPosition.y + 100, nextPosition.z);
            this.scheduleCameraChangedEmit();
            this.minimapNeedsRedraw = true;
    }

    private isCharacterTileBlocked(worldX: number, worldZ: number): boolean {
        if (!this.loadedAttData) return false;
        const tileX = THREE.MathUtils.clamp(Math.floor(worldX / TERRAIN_SCALE), 0, TERRAIN_SIZE - 1);
        const tileZ = THREE.MathUtils.clamp(Math.floor((TERRAIN_WORLD_SIZE - worldZ) / TERRAIN_SCALE), 0, TERRAIN_SIZE - 1);
        const flags = this.loadedAttData.terrainWall[tileZ * TERRAIN_SIZE + tileX] || 0;
        return (flags & (TWFlags.NoMove | TWFlags.NoGround)) !== 0;
    }

    private getTerrainWorldHeight(worldX: number, worldZ: number): number {
        if (!this.terrainMesh) return 0;
        this.raycaster.set(
            new THREE.Vector3(worldX, 10000, worldZ),
            new THREE.Vector3(0, -1, 0),
        );
        const hit = this.raycaster.intersectObject(this.terrainMesh, true)[0];
        return hit ? hit.point.y : 0;
    }

    private drawMinimap() {
        if (!this.minimapCanvas || !this.minimapContext || !this.minimapNeedsRedraw) return;

        const width = this.minimapCanvas.width;
        const height = this.minimapCanvas.height;
        const ctx = this.minimapContext;

        ctx.clearRect(0, 0, width, height);
        if (this.minimapSourceCanvas) {
            ctx.drawImage(this.minimapSourceCanvas, 0, 0, width, height);
        } else {
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(0, 0, width, height);
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

        if (this.selectedObjectRecord) {
            const selectedPoint = worldToMinimapPoint(
                this.selectedObjectRecord.selection.position.x,
                this.selectedObjectRecord.selection.position.z,
                TERRAIN_WORLD_SIZE,
                width,
                height,
            );
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath();
            ctx.arc(selectedPoint.x, selectedPoint.y, 4.5, 0, Math.PI * 2);
            ctx.fill();
        }

        const targetPoint = worldToMinimapPoint(
            this.controls.target.x,
            this.controls.target.z,
            TERRAIN_WORLD_SIZE,
            width,
            height,
        );
        const cameraPoint = worldToMinimapPoint(
            this.camera.position.x,
            this.camera.position.z,
            TERRAIN_WORLD_SIZE,
            width,
            height,
        );
        ctx.strokeStyle = '#31d7ff';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(cameraPoint.x, cameraPoint.y);
        ctx.lineTo(targetPoint.x, targetPoint.y);
        ctx.stroke();
        ctx.fillStyle = '#31d7ff';
        ctx.beginPath();
        ctx.arc(cameraPoint.x, cameraPoint.y, 3.5, 0, Math.PI * 2);
        ctx.fill();

        this.minimapNeedsRedraw = false;
    }

    private scheduleCameraChangedEmit() {
        if (this.cameraChangeHandle !== null) {
            cancelAnimationFrame(this.cameraChangeHandle);
        }
        this.cameraChangeHandle = requestAnimationFrame(() => {
            this.cameraChangeHandle = null;
            if (!this.controls) return;
            this.updateCoordinateInputs(this.controls.target.x, this.controls.target.z);
            this.onCameraChanged?.(
                this.toExplorerVector3(this.camera.position),
                this.toExplorerVector3(this.controls.target),
            );
        });
    }

    private updateCoordinateInputs(x: number, z: number) {
        if (this.jumpXEl) {
            this.jumpXEl.value = x.toFixed(0);
        }
        if (this.jumpZEl) {
            this.jumpZEl.value = z.toFixed(0);
        }
    }

    private setBookmarkStatus(message: string) {
        if (this.bookmarkStatusEl) {
            this.bookmarkStatusEl.textContent = message;
        }
    }

    private setLastContextMessage(message: string) {
        if (this.lastContextEl) {
            this.lastContextEl.textContent = message;
        }
    }

    private formatVector(vector: { x: number; y: number; z: number }): string {
        return `${vector.x.toFixed(0)}, ${vector.y.toFixed(0)}, ${vector.z.toFixed(0)}`;
    }

    private toExplorerVector3(vector: THREE.Vector3): ExplorerVector3 {
        return {
            x: vector.x,
            y: vector.y,
            z: vector.z,
        };
    }

    private hasLoadedData(): boolean {
        return this.dataFiles.size > 0 || this.dataRootPath !== null;
    }

    private startAnimationLoop(): void {
        if (!this.isActive || this.animationFrameHandle !== null) return;
        this.animationFrameHandle = requestAnimationFrame(this.animate);
    }

    private animate = (timestamp?: DOMHighResTimeStamp) => {
        this.animationFrameHandle = null;
        if (!this.isActive) return;
        this.startAnimationLoop();
        if (!this.rendererReady) return;

        this.timer.update(timestamp);
        const delta = Math.min(this.timer.getDelta(), TERRAIN_MAX_DELTA_SECONDS);
        this.updateKeyboardMovement(delta);
        this.characterPlayMixer?.update(delta);
        this.characterPlayItemMixers.forEach(mixer => mixer.update(delta));
        this.updateCharacterPlayNameTag();
        this.controls.update();
        this.updateObjectDistanceCulling();
        this.updateAnimatedObjects(delta);
        this.updateSelectionMarker();
        this.drawMinimap();
        this.renderer.render(this.scene, this.camera);
        if (this.objectPreviewRenderer && this.objectPreviewScene && this.objectPreviewCamera && this.objectPreviewObject) {
            this.objectPreviewControls?.update();
            this.objectPreviewRenderer.render(this.objectPreviewScene, this.objectPreviewCamera);
        }
    };
}
