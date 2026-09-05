export type ViewerTab = 'bmd' | 'character' | 'terrain' | 'att' | 'ozj' | 'items' | 'skills' | 'gfx' | 'sound';

export interface ExplorerVector3 {
  x: number;
  y: number;
  z: number;
}

export interface SelectedWorldObjectRef {
  objectId: string;
  worldNumber: number;
  type: number;
  modelName: string | null;
  modelFileKey: string | null;
  displayName: string;
  position: ExplorerVector3;
  rotation: ExplorerVector3;
  scale: number;
}

export interface ExplorerBookmark {
  id: string;
  name: string;
  worldNumber: number;
  cameraPosition: ExplorerVector3;
  cameraTarget: ExplorerVector3;
  selectedObject: SelectedWorldObjectRef | null;
  createdAt: number;
  updatedAt: number;
}

export interface RecentWorldEntry {
  worldNumber: number;
  label: string;
  timestamp: number;
}

export interface RecentBookmarkEntry {
  bookmarkId: string;
  label: string;
  timestamp: number;
}

export interface RecentModelEntry {
  label: string;
  timestamp: number;
  modelFileKey: string | null;
  sourceWorldNumber: number | null;
}

export interface CharacterEquipmentState {
  helm: string;
  armor: string;
  pants: string;
  gloves: string;
  boots: string;
  leftWeapon: string;
  rightWeapon: string;
  wing: string;
}

export interface CharacterSessionState {
  classValue: number;
  equipment: CharacterEquipmentState;
  animationIndex: number | null;
  autoRotate: boolean;
  speed: number;
  scale: number;
  itemLevel: number;
  itemExcellent: boolean;
  itemAncient: boolean;
  itemExcellentIntensity: number;
  showSkeleton: boolean;
  wireframe: boolean;
  showBoundingBox: boolean;
  showAxes: boolean;
  showNormals: boolean;
  backgroundColor: string;
  brightness: number;
}

export interface CharacterPreset extends CharacterSessionState {
  id: string;
  name: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TerrainSessionState {
  rendererBackend: 'auto' | 'webgpu' | 'webgl';
  lastWorldNumber: number | null;
  availableWorldNumbers: number[];
  cameraPosition: ExplorerVector3 | null;
  cameraTarget: ExplorerVector3 | null;
  selectedObject: SelectedWorldObjectRef | null;
  animationsEnabled: boolean;
  sunEnabled: boolean;
  wireframe: boolean;
  showObjects: boolean;
  brightness: number;
  objectDistance: number;
}

export interface BmdSessionState {
  rendererBackend: 'auto' | 'webgpu' | 'webgl';
  animationsEnabled: boolean;
  autoRotate: boolean;
  showSkeleton: boolean;
  wireframe: boolean;
  showBoundingBox: boolean;
  showAxes: boolean;
  showNormals: boolean;
  backgroundColor: string;
  brightness: number;
  lastModelName: string | null;
}

export interface ViewerSessionState {
  version: number;
  activeView: ViewerTab;
  presentationMode: boolean;
  bookmarks: ExplorerBookmark[];
  recentWorlds: RecentWorldEntry[];
  recentBookmarks: RecentBookmarkEntry[];
  recentModels: RecentModelEntry[];
  characterPresets: CharacterPreset[];
  terrain: TerrainSessionState;
  character: CharacterSessionState;
  bmd: BmdSessionState;
}
