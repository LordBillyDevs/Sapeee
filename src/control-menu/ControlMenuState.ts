export const DEFAULT_CONTROL_MENU_SECTIONS = {
  'bmd-import-section': false,
  'bmd-animation-section': false,
  'bmd-viewport-section': false,
  'blending-controls': false,
  'bmd-attachment-section': false,
  'diagnostics-panel': false,
  'export-controls': false,
  'character-data-section': false,
  'character-profile-section': true,
  'character-equipment-section': false,
  'character-effects-section': false,
  'character-presets-section': false,
  'character-animation-section': false,
  'character-viewport-section': false,
  'character-blending-controls': false,
  'character-export-controls': false,
  'terrain-world-data-section': true,
  'terrain-att-editor-section': false,
  'terrain-navigation-section': false,
  'terrain-texture-editor-section': true,
  'terrain-viewport-section': false,
  'terrain-object-section': false,
  'terrain-stats': false,
  'att-load-section': false,
  'att-info-section': false,
  'att-legend-section': false,
  'ozj-load-section': false,
  'ozj-filter-section': false,
  'items-load-section': false,
  'items-filter-section': false,
  'skills-load-section': false,
  'skills-filter-section': false,
  'sound-load-section': false,
  'sound-filter-section': false,
} as const;

export type ControlMenuSectionId = keyof typeof DEFAULT_CONTROL_MENU_SECTIONS;

export interface ControlMenuState {
  sidebarCollapsed: boolean;
  sections: Record<ControlMenuSectionId, boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function createDefaultControlMenuState(): ControlMenuState {
  return {
    sidebarCollapsed: false,
    sections: { ...DEFAULT_CONTROL_MENU_SECTIONS },
  };
}

export function mergeControlMenuState(value: unknown): ControlMenuState {
  const defaults = createDefaultControlMenuState();
  if (!isRecord(value)) {
    return defaults;
  }

  const mergedSections = { ...defaults.sections };
  const rawSections = isRecord(value.sections) ? value.sections : null;
  if (rawSections) {
    (Object.keys(DEFAULT_CONTROL_MENU_SECTIONS) as ControlMenuSectionId[]).forEach(sectionId => {
      if (typeof rawSections[sectionId] === 'boolean') {
        mergedSections[sectionId] = rawSections[sectionId] as boolean;
      }
    });
  }

  return {
    sidebarCollapsed: typeof value.sidebarCollapsed === 'boolean'
      ? value.sidebarCollapsed
      : defaults.sidebarCollapsed,
    sections: mergedSections,
  };
}

export function setControlMenuSectionExpanded(
  state: ControlMenuState,
  sectionId: string,
  expanded: boolean,
): ControlMenuState {
  if (!(sectionId in DEFAULT_CONTROL_MENU_SECTIONS)) {
    return state;
  }

  const typedSectionId = sectionId as ControlMenuSectionId;
  if (state.sections[typedSectionId] === expanded) {
    return state;
  }

  return {
    ...state,
    sections: {
      ...state.sections,
      [typedSectionId]: expanded,
    },
  };
}

export function toggleControlMenuSection(state: ControlMenuState, sectionId: string): ControlMenuState {
  if (!(sectionId in DEFAULT_CONTROL_MENU_SECTIONS)) {
    return state;
  }

  const typedSectionId = sectionId as ControlMenuSectionId;
  return setControlMenuSectionExpanded(state, typedSectionId, !state.sections[typedSectionId]);
}

export function setControlMenuSidebarCollapsed(state: ControlMenuState, collapsed: boolean): ControlMenuState {
  if (state.sidebarCollapsed === collapsed) {
    return state;
  }

  return {
    ...state,
    sidebarCollapsed: collapsed,
  };
}
