export type LanguageCode = 'en' | 'es' | 'pt' | 'zh' | 'th' | 'ru' | 'pl' | 'vi';

export const SUPPORTED_LANGUAGES: ReadonlyArray<{ code: LanguageCode; label: string }> = [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Español' },
    { code: 'pt', label: 'Português' },
    { code: 'zh', label: '中文' },
    { code: 'th', label: 'ไทย' },
    { code: 'ru', label: 'Русский' },
    { code: 'pl', label: 'Polski' },
    { code: 'vi', label: 'Tiếng Việt' },
];

/*
 * UI strings are keyed by their English source text.  This deliberately also
 * covers text which is created by a panel after startup; keeping one catalog
 * avoids generated controls silently reverting to English.
 */
const ENGLISH: Record<string, string> = {
    about: 'About', bmd: 'BMD Viewer', character: 'Character', terrain: 'Terrain',
    worldTerrain: 'World / Terrain', att: 'ATT Inspector', textures: 'Textures',
    items: 'Items', skills: 'Skills', gfx: 'GFx', sound: 'Sound', language: 'Language',
    performance: 'Performance mode', modelBrowser: 'Model Browser', levelTerrain: 'Level terrain',
    'Map workspace': 'Map workspace', 'Import Assets': 'Import Assets', 'Animation Settings': 'Animation Settings',
    'Viewport & Render': 'Viewport & Render', 'Game Data': 'Game Data', 'Equipment': 'Equipment',
    'Item Effects': 'Item Effects', Presets: 'Presets', Export: 'Export', 'World Data': 'World Data',
    'ATT Area Editor': 'ATT Area Editor', Navigation: 'Navigation', 'Terrain Textures': 'Terrain Textures',
    Viewport: 'Viewport', 'Selected Object': 'Selected Object', 'Load ATT File': 'Load ATT File',
    'ATT Metadata': 'ATT Metadata', TWFlags: 'TWFlags', 'Load Files': 'Load Files', Filter: 'Filter',
    'Load items.bmd': 'Load items.bmd', 'Load skill.bmd': 'Load skill.bmd', 'OZG Render': 'OZG Render',
    'OZD Gallery': 'OZD Gallery', 'Load Sounds': 'Load Sounds', Transform: 'Transform',
    'Type Materials': 'Type Materials', 'Mesh Blending': 'Mesh Blending', Attachment: 'Attachment',
    'Bone Navigation': 'Bone Navigation', Stats: 'Stats', 'World': 'World', 'Class': 'Class',
    'Background': 'Background', Brightness: 'Brightness', 'Enable Animations': 'Enable Animations',
    'Auto-rotate Model': 'Auto-rotate Model', 'Auto-rotate Character': 'Auto-rotate Character',
    Wireframe: 'Wireframe', 'Wireframe Mode': 'Wireframe Mode', 'Show Skeleton': 'Show Skeleton',
    'Show Objects': 'Show Objects', 'Bounding Box': 'Bounding Box', 'Show Axes': 'Show Axes',
    'Show Normals': 'Show Normals', 'Sun Light': 'Sun Light', 'Terrain grid': 'Terrain grid',
    'Paint ATT on map': 'Paint ATT on map', 'Brush size': 'Brush size', 'Brush hardness': 'Brush hardness',
    'Brush strength': 'Brush strength', 'Edit terrain height': 'Edit terrain height',
    'Smooth height': 'Smooth height', 'Height change': 'Height change', 'Apply Area Flags': 'Apply Area Flags',
    'Show ATT Overlay': 'Show ATT Overlay', 'Hide ATT Overlay': 'Hide ATT Overlay',
    'Export Edited ATT': 'Export Edited ATT', 'Level brush': 'Level brush', Jump: 'Jump',
    'Import textures': 'Import textures', 'Import package': 'Import package', 'Paint selected tile': 'Paint selected tile',
    'Texture brush size': 'Texture brush size', 'Base texture': 'Base texture', 'Overlay texture': 'Overlay texture',
    'Paint layer': 'Paint layer', 'Both layers': 'Both layers', 'Base only': 'Base only',
    'Overlay only': 'Overlay only', 'Blend alpha': 'Blend alpha', 'Export Edited MAP + OBJ': 'Export Edited MAP + OBJ',
    Undo: 'Undo', Redo: 'Redo', 'Paint terrain light': 'Paint terrain light', 'Light power': 'Light power',
    'Manual object selection': 'Manual object selection', 'Import BMD + textures': 'Import BMD + textures',
    'Choose BMD folder': 'Choose BMD folder', 'Add selected object to map': 'Add selected object to map',
    'No object selected.': 'No object selected.', Position: 'Position', Rotation: 'Rotation', Scale: 'Scale',
    Focus: 'Focus', Duplicate: 'Duplicate', 'Remove Object': 'Remove Object', 'Hide Others': 'Hide Others',
    Reset: 'Reset', 'Place a copy': 'Place a copy', 'Duplicate at coordinates': 'Duplicate at coordinates',
    'Add copy at coordinates': 'Add copy at coordinates', 'Save': 'Save', Load: 'Load', Read: 'Read',
    Clear: 'Clear', 'Clear All': 'Clear All', All: 'All', Attack: 'Attack', Buff: 'Buff',
    'De-Buff': 'De-Buff', Friendly: 'Friendly', Weapon: 'Weapon', Armor: 'Armor', Potion: 'Potion',
    Jewel: 'Jewel', 'Load OZG File': 'Load OZG File', 'Load OZG Folder': 'Load OZG Folder',
    'Load OZD File': 'Load OZD File', 'Load OZD Folder': 'Load OZD Folder', 'Browse Folder': 'Browse Folder',
    'Show SWF tag table': 'Show SWF tag table', 'Open from Disk': 'Open from Disk',
    'Renderer Backend': 'Renderer Backend', 'Auto (prefer WebGPU)': 'Auto (prefer WebGPU)',
    'No Data loaded.': 'No Data loaded.', 'No files loaded.': 'No files loaded.', 'No file loaded.': 'No file loaded.',
    'No ATT data. Load a world or drop an ATT file.': 'No ATT data. Load a world or drop an ATT file.',
    'Click the ground to select a tile.': 'Click the ground to select a tile.',
    'Select a tile in the map or enter coordinates.': 'Select a tile in the map or enter coordinates.',
    'Load a world, then add map textures here.': 'Load a world, then add map textures here.',
    'Save camera and selected object as a bookmark.': 'Save camera and selected object as a bookmark.',
    'Bookmark name': 'Bookmark name', 'Close panel': 'Close panel', 'Model Browser': 'Model Browser',
    X: 'X', Z: 'Z', None: 'None', auto: 'auto', 'No animations': 'No animations', 'No worlds loaded yet.': 'No worlds loaded yet.',
    '-- Select World --': '-- Select World --', '-- Select Bone --': '-- Select Bone --', '-- Select object manually --': '-- Select object manually --',
    'No bookmarks saved.': 'No bookmarks saved.', 'No character presets saved.': 'No character presets saved.',
    'No recent models.': 'No recent models.',
    Workspace: 'Workspace', 'Application menu': 'Application menu', 'Load Data folder': 'Load Data folder',
    'Terrain texture palette': 'Terrain texture palette', 'For MuOnline Community': 'For MuOnline Community',
    'Drop': 'Drop', 'here': 'here', 'folder': 'folder', 'with': 'with', 'model here': 'model here',
    'or select': 'or select', 'optional': 'optional', 'files': 'files', 'Auto': 'Auto',
    'Select World': 'Select World', 'Select Bone': 'Select Bone', 'Select object manually': 'Select object manually',
    'Texture': 'Texture', 'Preview unavailable': 'Preview unavailable',
    Model: 'Model', 'ATT Inspector': 'ATT Inspector', 'OZJ Browser': 'OZJ Browser',
    'Item Browser': 'Item Browser', 'Skill Browser': 'Skill Browser', 'GFx Browser': 'GFx Browser',
    'Sound Browser': 'Sound Browser', Start: 'Start', Edit: 'Edit', Core: 'Core', Preview: 'Preview',
    Advanced: 'Advanced', Deliver: 'Deliver',
};

type Catalog = Record<string, string>;
const TRANSLATIONS: Record<LanguageCode, Catalog> = {
    en: ENGLISH,
    es: {
        ...ENGLISH, about: 'Acerca de', bmd: 'Visor BMD', character: 'Personaje', terrain: 'Terreno',
        worldTerrain: 'Mundo / Terreno', language: 'Idioma', performance: 'Modo rendimiento',
        modelBrowser: 'Explorador de modelos', levelTerrain: 'Nivelar terreno', 'Map workspace': 'Espacio de mapas',
        'Import Assets': 'Importar recursos', 'Animation Settings': 'Configuración de animación',
        'Viewport & Render': 'Vista y renderizado', 'Game Data': 'Datos del juego', Equipment: 'Equipamiento',
        Export: 'Exportar', 'World Data': 'Datos del mundo', 'ATT Area Editor': 'Editor de áreas ATT',
        Navigation: 'Navegación', 'Terrain Textures': 'Texturas del terreno', Viewport: 'Vista',
        'Selected Object': 'Objeto seleccionado', Transform: 'Transformación', Attachment: 'Accesorio',
        Stats: 'Estadísticas', Brightness: 'Brillo', 'Enable Animations': 'Activar animaciones',
        'Auto-rotate Model': 'Rotar modelo automáticamente', 'Auto-rotate Character': 'Rotar personaje automáticamente',
        'Show Objects': 'Mostrar objetos', 'Show Skeleton': 'Mostrar esqueleto', 'Show Axes': 'Mostrar ejes',
        'Show Normals': 'Mostrar normales', 'Sun Light': 'Luz solar', 'Terrain grid': 'Cuadrícula del terreno',
        'Brush size': 'Tamaño del pincel', 'Brush hardness': 'Dureza del pincel', 'Brush strength': 'Fuerza del pincel',
        'Edit terrain height': 'Editar altura del terreno', 'Smooth height': 'Suavizar altura',
        'Height change': 'Cambio de altura', 'Apply Area Flags': 'Aplicar banderas de área',
        'Show ATT Overlay': 'Mostrar superposición ATT', 'Hide ATT Overlay': 'Ocultar superposición ATT',
        'Export Edited ATT': 'Exportar ATT editado', 'Level brush': 'Nivelar pincel', 'Import textures': 'Importar texturas',
        'Import package': 'Importar paquete', 'Paint selected tile': 'Pintar baldosa seleccionada',
        'Texture brush size': 'Tamaño del pincel de textura', 'Base texture': 'Textura base',
        'Overlay texture': 'Textura superpuesta', 'Paint layer': 'Capa de pintura', 'Both layers': 'Ambas capas',
        'Base only': 'Solo base', 'Overlay only': 'Solo superpuesta', 'Blend alpha': 'Alfa de mezcla',
        'Export Edited MAP + OBJ': 'Exportar MAP + OBJ editados', Undo: 'Deshacer', Redo: 'Rehacer',
        'Paint terrain light': 'Pintar luz del terreno', 'Manual object selection': 'Selección manual de objeto',
        'Choose BMD folder': 'Elegir carpeta BMD', 'Add selected object to map': 'Añadir objeto seleccionado al mapa',
        'No object selected.': 'Ningún objeto seleccionado.', Focus: 'Enfocar', Duplicate: 'Duplicar',
        'Remove Object': 'Eliminar objeto', 'Hide Others': 'Ocultar otros', Reset: 'Restablecer',
        'Place a copy': 'Colocar una copia', 'Duplicate at coordinates': 'Duplicar en coordenadas',
        'Add copy at coordinates': 'Añadir copia en coordenadas', Save: 'Guardar', Load: 'Cargar',
        Read: 'Leer', Clear: 'Limpiar', 'Clear All': 'Limpiar todo', Attack: 'Ataque', Buff: 'Mejora',
        'De-Buff': 'Debilitación', Friendly: 'Amistoso', Weapon: 'Arma', Armor: 'Armadura', Potion: 'Poción',
        Jewel: 'Joya', 'Browse Folder': 'Examinar carpeta', 'Renderer Backend': 'Backend de renderizado',
        'Auto (prefer WebGPU)': 'Automático (preferir WebGPU)', 'No Data loaded.': 'No hay datos cargados.',
        'No files loaded.': 'No hay archivos cargados.', 'No file loaded.': 'No hay archivo cargado.',
        'Click the ground to select a tile.': 'Haz clic en el suelo para seleccionar una baldosa.',
        'Bookmark name': 'Nombre del marcador', 'Close panel': 'Cerrar panel',
        'No worlds loaded yet.': 'Aún no hay mundos cargados.', 'No bookmarks saved.': 'No hay marcadores guardados.',
        'No character presets saved.': 'No hay ajustes de personaje guardados.', 'No recent models.': 'No hay modelos recientes.',
        Workspace: 'Espacio de trabajo', 'Application menu': 'Menú de aplicación', 'Load Data folder': 'Cargar carpeta Data',
        'Terrain texture palette': 'Paleta de texturas del terreno', 'For MuOnline Community': 'Para la comunidad MuOnline',
        Drop: 'Suelta', here: 'aquí', folder: 'carpeta', with: 'con', 'model here': 'modelo aquí',
        'or select': 'o selecciona', optional: 'opcional', files: 'archivos', Auto: 'Automático',
        'Select World': 'Seleccionar mundo', 'Select Bone': 'Seleccionar hueso', Texture: 'Textura', auto: 'automático',
        '-- Select World --': '-- Seleccionar mundo --', '-- Select Bone --': '-- Seleccionar hueso --', '-- Select object manually --': '-- Seleccionar objeto manualmente --',
        'Preview unavailable': 'Vista previa no disponible',
        Model: 'Modelo', 'OZJ Browser': 'Explorador OZJ', 'Item Browser': 'Explorador de objetos',
        'Skill Browser': 'Explorador de habilidades', 'GFx Browser': 'Explorador GFx', 'Sound Browser': 'Explorador de sonido',
        Start: 'Inicio', Edit: 'Editar', Core: 'Núcleo', Preview: 'Vista previa', Advanced: 'Avanzado', Deliver: 'Entrega',
    },
    pt: { ...ENGLISH, about: 'Sobre', bmd: 'Visualizador BMD', character: 'Personagem', terrain: 'Terreno', worldTerrain: 'Mundo / Terreno', language: 'Idioma', performance: 'Modo desempenho', modelBrowser: 'Navegador de modelos', levelTerrain: 'Nivelar terreno', 'Map workspace': 'Espaço de mapas', Export: 'Exportar', Save: 'Salvar', Load: 'Carregar', Clear: 'Limpar', Undo: 'Desfazer', Redo: 'Refazer', Navigation: 'Navegação', Viewport: 'Visualização', 'World Data': 'Dados do mundo', 'Terrain Textures': 'Texturas do terreno', 'Base texture': 'Textura base', 'Overlay texture': 'Textura sobreposta', 'Paint layer': 'Camada de pintura', 'Both layers': 'Ambas as camadas', 'Base only': 'Somente base', 'Overlay only': 'Somente sobreposta', 'Blend alpha': 'Alfa de mistura', 'Import textures': 'Importar texturas', 'Import package': 'Importar pacote', 'No Data loaded.': 'Nenhum dado carregado.', 'No files loaded.': 'Nenhum arquivo carregado.', 'No file loaded.': 'Nenhum arquivo carregado.', 'Close panel': 'Fechar painel', 'Bookmark name': 'Nome do marcador', Workspace: 'Área de trabalho', 'Application menu': 'Menu do aplicativo', 'Load Data folder': 'Carregar pasta Data', 'Terrain texture palette': 'Paleta de texturas do terreno', Drop: 'Solte', folder: 'pasta', with: 'com', optional: 'opcional', files: 'arquivos', Auto: 'Automático', 'Select World': 'Selecionar mundo', 'Select Bone': 'Selecionar osso', Texture: 'Textura', 'Preview unavailable': 'Pré-visualização indisponível' },
    zh: { ...ENGLISH, about: '关于', bmd: 'BMD 查看器', character: '角色', terrain: '地形', worldTerrain: '世界 / 地形', language: '语言', performance: '性能模式', modelBrowser: '模型浏览器', levelTerrain: '地形整平', 'Map workspace': '地图工作区', Export: '导出', Save: '保存', Load: '加载', Clear: '清除', Undo: '撤销', Redo: '重做', Navigation: '导航', Viewport: '视口', 'World Data': '世界数据', 'Terrain Textures': '地形纹理', 'Base texture': '基础纹理', 'Overlay texture': '覆盖纹理', 'Paint layer': '绘制图层', 'Both layers': '两个图层', 'Base only': '仅基础层', 'Overlay only': '仅覆盖层', 'Blend alpha': '混合透明度', 'Import textures': '导入纹理', 'Import package': '导入包', 'No Data loaded.': '未加载数据。', 'No files loaded.': '未加载文件。', 'No file loaded.': '未加载文件。', 'Close panel': '关闭面板', 'Bookmark name': '书签名称', Workspace: '工作区', 'Application menu': '应用菜单', 'Load Data folder': '加载 Data 文件夹', 'Terrain texture palette': '地形纹理面板', Drop: '拖放', folder: '文件夹', with: '包含', optional: '可选', files: '文件', Auto: '自动', 'Select World': '选择世界', 'Select Bone': '选择骨骼', Texture: '纹理', 'Preview unavailable': '预览不可用' },
    th: { ...ENGLISH, about: 'เกี่ยวกับ', bmd: 'ตัวดู BMD', character: 'ตัวละคร', terrain: 'ภูมิประเทศ', worldTerrain: 'โลก / ภูมิประเทศ', language: 'ภาษา', performance: 'โหมดประสิทธิภาพ', modelBrowser: 'เบราว์เซอร์โมเดล', levelTerrain: 'ปรับระดับภูมิประเทศ', 'Map workspace': 'พื้นที่ทำงานแผนที่', Export: 'ส่งออก', Save: 'บันทึก', Load: 'โหลด', Clear: 'ล้าง', Undo: 'เลิกทำ', Redo: 'ทำซ้ำ', Navigation: 'การนำทาง', Viewport: 'วิวพอร์ต', 'World Data': 'ข้อมูลโลก', 'Terrain Textures': 'พื้นผิวภูมิประเทศ', 'Base texture': 'พื้นผิวฐาน', 'Overlay texture': 'พื้นผิวซ้อน', 'Paint layer': 'เลเยอร์ระบาย', 'Both layers': 'ทั้งสองเลเยอร์', 'Base only': 'ฐานเท่านั้น', 'Overlay only': 'ซ้อนเท่านั้น', 'Import textures': 'นำเข้าพื้นผิว', 'Import package': 'นำเข้าแพ็กเกจ', 'No Data loaded.': 'ยังไม่ได้โหลดข้อมูล', 'No files loaded.': 'ยังไม่ได้โหลดไฟล์', 'Close panel': 'ปิดแผง', 'Bookmark name': 'ชื่อบุ๊กมาร์ก', Workspace: 'พื้นที่ทำงาน', 'Application menu': 'เมนูแอป', 'Load Data folder': 'โหลดโฟลเดอร์ Data', 'Terrain texture palette': 'จานสีพื้นผิวภูมิประเทศ', Drop: 'วาง', folder: 'โฟลเดอร์', with: 'ที่มี', optional: 'ไม่บังคับ', files: 'ไฟล์', Auto: 'อัตโนมัติ', 'Select World': 'เลือกโลก', 'Select Bone': 'เลือกกระดูก', Texture: 'พื้นผิว', 'Preview unavailable': 'ไม่มีตัวอย่าง' },
    ru: { ...ENGLISH, about: 'О программе', bmd: 'Просмотр BMD', character: 'Персонаж', terrain: 'Ландшафт', worldTerrain: 'Мир / Ландшафт', language: 'Язык', performance: 'Режим производительности', modelBrowser: 'Браузер моделей', levelTerrain: 'Выровнять рельеф', 'Map workspace': 'Рабочая область карты', Export: 'Экспорт', Save: 'Сохранить', Load: 'Загрузить', Clear: 'Очистить', Undo: 'Отменить', Redo: 'Повторить', Navigation: 'Навигация', Viewport: 'Вид', 'World Data': 'Данные мира', 'Terrain Textures': 'Текстуры ландшафта', 'Base texture': 'Базовая текстура', 'Overlay texture': 'Текстура слоя', 'Paint layer': 'Слой рисования', 'Both layers': 'Оба слоя', 'Base only': 'Только база', 'Overlay only': 'Только слой', 'Import textures': 'Импорт текстур', 'Import package': 'Импорт пакета', 'No Data loaded.': 'Данные не загружены', 'No files loaded.': 'Файлы не загружены', 'Close panel': 'Закрыть панель', 'Bookmark name': 'Имя закладки' },
    pl: { ...ENGLISH, about: 'O programie', bmd: 'Przeglądarka BMD', character: 'Postać', terrain: 'Teren', worldTerrain: 'Świat / Teren', language: 'Język', performance: 'Tryb wydajności', modelBrowser: 'Przeglądarka modeli', levelTerrain: 'Wyrównaj teren', 'Map workspace': 'Obszar mapy', Export: 'Eksportuj', Save: 'Zapisz', Load: 'Wczytaj', Clear: 'Wyczyść', Undo: 'Cofnij', Redo: 'Ponów', Navigation: 'Nawigacja', Viewport: 'Widok', 'World Data': 'Dane świata', 'Terrain Textures': 'Tekstury terenu', 'Base texture': 'Tekstura bazowa', 'Overlay texture': 'Tekstura nakładki', 'Paint layer': 'Warstwa malowania', 'Both layers': 'Obie warstwy', 'Base only': 'Tylko baza', 'Overlay only': 'Tylko nakładka', 'Import textures': 'Importuj tekstury', 'Import package': 'Importuj pakiet', 'No Data loaded.': 'Brak załadowanych danych', 'No files loaded.': 'Brak załadowanych plików', 'Close panel': 'Zamknij panel', 'Bookmark name': 'Nazwa zakładki' },
    vi: { ...ENGLISH, about: 'Giới thiệu', bmd: 'Trình xem BMD', character: 'Nhân vật', terrain: 'Địa hình', worldTerrain: 'Thế giới / Địa hình', language: 'Ngôn ngữ', performance: 'Chế độ hiệu năng', modelBrowser: 'Trình duyệt mô hình', levelTerrain: 'San phẳng địa hình', 'Map workspace': 'Không gian bản đồ', Export: 'Xuất', Save: 'Lưu', Load: 'Tải', Clear: 'Xóa', Undo: 'Hoàn tác', Redo: 'Làm lại', Navigation: 'Điều hướng', Viewport: 'Khung nhìn', 'World Data': 'Dữ liệu thế giới', 'Terrain Textures': 'Kết cấu địa hình', 'Base texture': 'Kết cấu nền', 'Overlay texture': 'Kết cấu phủ', 'Paint layer': 'Lớp vẽ', 'Both layers': 'Cả hai lớp', 'Base only': 'Chỉ lớp nền', 'Overlay only': 'Chỉ lớp phủ', 'Import textures': 'Nhập kết cấu', 'Import package': 'Nhập gói', 'No Data loaded.': 'Chưa tải dữ liệu', 'No files loaded.': 'Chưa tải tệp', 'Close panel': 'Đóng bảng', 'Bookmark name': 'Tên dấu trang' },
};

const SHARED_UI_TRANSLATIONS: Partial<Record<LanguageCode, Catalog>> = {
    ru: {
        'Import Assets': 'Импорт ресурсов', 'Animation Settings': 'Настройки анимации', 'Viewport & Render': 'Вид и рендеринг',
        'Game Data': 'Данные игры', Equipment: 'Снаряжение', Export: 'Экспорт', 'World Data': 'Данные мира',
        'ATT Area Editor': 'Редактор областей ATT', Navigation: 'Навигация', 'Terrain Textures': 'Текстуры ландшафта',
        Viewport: 'Вид', 'Selected Object': 'Выбранный объект', Transform: 'Преобразование', Attachment: 'Аксессуар',
        Stats: 'Статистика', Brightness: 'Яркость', 'Enable Animations': 'Включить анимацию',
        'Show Objects': 'Показывать объекты', 'Show Skeleton': 'Показывать скелет', 'Show Axes': 'Показывать оси',
        'Show Normals': 'Показывать нормали', 'Sun Light': 'Солнечный свет', 'Terrain grid': 'Сетка ландшафта',
        'Brush size': 'Размер кисти', 'Brush hardness': 'Жёсткость кисти', 'Brush strength': 'Сила кисти',
        'Edit terrain height': 'Изменить высоту ландшафта', 'Smooth height': 'Сгладить высоту',
        'Height change': 'Изменение высоты', 'Apply Area Flags': 'Применить флаги области',
        'Show ATT Overlay': 'Показать слой ATT', 'Hide ATT Overlay': 'Скрыть слой ATT',
        'Export Edited ATT': 'Экспортировать ATT', 'Level brush': 'Выровнять кистью', 'Import textures': 'Импорт текстур',
        'Import package': 'Импорт пакета', 'Paint selected tile': 'Рисовать выбранную плитку',
        'Texture brush size': 'Размер кисти текстур', 'Blend alpha': 'Альфа смешивания', Undo: 'Отменить', Redo: 'Повторить',
        'Manual object selection': 'Ручной выбор объекта', 'Choose BMD folder': 'Выбрать папку BMD',
        Focus: 'Фокус', Duplicate: 'Дублировать', 'Remove Object': 'Удалить объект', 'Hide Others': 'Скрыть остальные',
        'Place a copy': 'Разместить копию', 'No object selected.': 'Объект не выбран',
    },
    pl: {
        'Import Assets': 'Import zasobów', 'Animation Settings': 'Ustawienia animacji', 'Viewport & Render': 'Widok i renderowanie',
        'Game Data': 'Dane gry', Equipment: 'Wyposażenie', Export: 'Eksport', 'World Data': 'Dane świata',
        'ATT Area Editor': 'Edytor obszaru ATT', Navigation: 'Nawigacja', 'Terrain Textures': 'Tekstury terenu',
        Viewport: 'Widok', 'Selected Object': 'Wybrany obiekt', Transform: 'Transformacja', Attachment: 'Załącznik',
        Stats: 'Statystyki', Brightness: 'Jasność', 'Enable Animations': 'Włącz animacje',
        'Show Objects': 'Pokaż obiekty', 'Show Skeleton': 'Pokaż szkielet', 'Show Axes': 'Pokaż osie',
        'Show Normals': 'Pokaż normalne', 'Sun Light': 'Światło słońca', 'Terrain grid': 'Siatka terenu',
        'Brush size': 'Rozmiar pędzla', 'Brush hardness': 'Twardość pędzla', 'Brush strength': 'Siła pędzla',
        'Edit terrain height': 'Edytuj wysokość terenu', 'Smooth height': 'Wygładź wysokość',
        'Height change': 'Zmiana wysokości', 'Apply Area Flags': 'Zastosuj flagi obszaru',
        'Show ATT Overlay': 'Pokaż nakładkę ATT', 'Hide ATT Overlay': 'Ukryj nakładkę ATT',
        'Export Edited ATT': 'Eksportuj ATT', 'Level brush': 'Wyrównaj pędzlem', 'Import textures': 'Importuj tekstury',
        'Import package': 'Importuj pakiet', 'Paint selected tile': 'Maluj wybrany kafelek',
        'Texture brush size': 'Rozmiar pędzla tekstur', 'Blend alpha': 'Alfa mieszania', Undo: 'Cofnij', Redo: 'Ponów',
        'Manual object selection': 'Ręczny wybór obiektu', 'Choose BMD folder': 'Wybierz folder BMD',
        Focus: 'Skup', Duplicate: 'Duplikuj', 'Remove Object': 'Usuń obiekt', 'Hide Others': 'Ukryj pozostałe',
        'Place a copy': 'Umieść kopię', 'No object selected.': 'Nie wybrano obiektu',
    },
    vi: {
        'Import Assets': 'Nhập tài nguyên', 'Animation Settings': 'Cài đặt hoạt ảnh', 'Viewport & Render': 'Khung nhìn & kết xuất',
        'Game Data': 'Dữ liệu trò chơi', Equipment: 'Trang bị', Export: 'Xuất', 'World Data': 'Dữ liệu thế giới',
        'ATT Area Editor': 'Trình sửa vùng ATT', Navigation: 'Điều hướng', 'Terrain Textures': 'Kết cấu địa hình',
        Viewport: 'Khung nhìn', 'Selected Object': 'Đối tượng đã chọn', Transform: 'Biến đổi', Attachment: 'Đính kèm',
        Stats: 'Thống kê', Brightness: 'Độ sáng', 'Enable Animations': 'Bật hoạt ảnh',
        'Show Objects': 'Hiện đối tượng', 'Show Skeleton': 'Hiện khung xương', 'Show Axes': 'Hiện trục',
        'Show Normals': 'Hiện pháp tuyến', 'Sun Light': 'Ánh sáng mặt trời', 'Terrain grid': 'Lưới địa hình',
        'Brush size': 'Kích thước cọ', 'Brush hardness': 'Độ cứng cọ', 'Brush strength': 'Cường độ cọ',
        'Edit terrain height': 'Sửa độ cao địa hình', 'Smooth height': 'Làm mượt độ cao',
        'Height change': 'Thay đổi độ cao', 'Apply Area Flags': 'Áp dụng cờ khu vực',
        'Show ATT Overlay': 'Hiện lớp phủ ATT', 'Hide ATT Overlay': 'Ẩn lớp phủ ATT',
        'Export Edited ATT': 'Xuất ATT', 'Level brush': 'San bằng bằng cọ', 'Import textures': 'Nhập kết cấu',
        'Import package': 'Nhập gói', 'Paint selected tile': 'Vẽ ô đã chọn',
        'Texture brush size': 'Kích thước cọ kết cấu', 'Blend alpha': 'Alpha hòa trộn', Undo: 'Hoàn tác', Redo: 'Làm lại',
        'Manual object selection': 'Chọn đối tượng thủ công', 'Choose BMD folder': 'Chọn thư mục BMD',
        Focus: 'Tập trung', Duplicate: 'Nhân bản', 'Remove Object': 'Xóa đối tượng', 'Hide Others': 'Ẩn đối tượng khác',
        'Place a copy': 'Đặt bản sao', 'No object selected.': 'Chưa chọn đối tượng',
    },
};
Object.entries(SHARED_UI_TRANSLATIONS).forEach(([language, catalog]) => Object.assign(TRANSLATIONS[language as LanguageCode], catalog));

let activeLanguage: LanguageCode = 'en';
let observer: MutationObserver | null = null;
let applying = false;
const sourceTextByNode = new WeakMap<Text, string>();
const sourceAttributeByElement = new WeakMap<Element, Partial<Record<'placeholder' | 'title' | 'aria-label', string>>>();

export function translate(key: string, language: LanguageCode = activeLanguage): string {
    return TRANSLATIONS[language]?.[key] ?? ENGLISH[key] ?? key;
}

function translateDynamic(source: string, language: LanguageCode): string {
    let match = source.match(/^Texture (\d+) selected\. Paint on the terrain or apply it to the selected tile\.$/);
    if (match) {
        const templates: Record<LanguageCode, string> = {
            en: `Texture ${match[1]} selected. Paint on the terrain or apply it to the selected tile.`,
            es: `Textura ${match[1]} seleccionada. Pinta el terreno o aplícala a la baldosa seleccionada.`,
            pt: `Textura ${match[1]} selecionada. Pinte o terreno ou aplique-a à peça selecionada.`,
            zh: `已选择纹理 ${match[1]}。在地形上绘制或应用到选中的图块。`,
            th: `เลือกพื้นผิว ${match[1]} แล้ว ระบายบนภูมิประเทศหรือใช้กับไทล์ที่เลือก`,
            ru: `Текстура ${match[1]} выбрана. Рисуйте рельеф или примените её к выбранной плитке.`,
            pl: `Wybrano teksturę ${match[1]}. Maluj teren lub zastosuj ją do wybranego kafelka.`,
            vi: `Đã chọn kết cấu ${match[1]}. Vẽ lên địa hình hoặc áp dụng cho ô đã chọn.`,
        };
        return templates[language];
    }
    match = source.match(/^Texture (\d+): (.+)$/);
    if (match) return `${translate('Texture', language)} ${match[1]}: ${match[2]}`;
    match = source.match(/^Terrain painted at (\d+), (\d+)\. Export MAP to save it\.$/);
    if (match) {
        const templates: Record<LanguageCode, string> = {
            en: `Terrain painted at ${match[1]}, ${match[2]}. Export MAP to save it.`,
            es: `Terreno pintado en ${match[1]}, ${match[2]}. Exporta MAP para guardarlo.`,
            pt: `Terreno pintado em ${match[1]}, ${match[2]}. Exporte MAP para salvar.`,
            zh: `已在 ${match[1]}, ${match[2]} 绘制地形。导出 MAP 以保存。`,
            th: `ระบายภูมิประเทศที่ ${match[1]}, ${match[2]} แล้ว ส่งออก MAP เพื่อบันทึก`,
            ru: `Рельеф изменён в ${match[1]}, ${match[2]}. Экспортируйте MAP для сохранения.`,
            pl: `Teren pomalowano w ${match[1]}, ${match[2]}. Eksportuj MAP, aby zapisać.`,
            vi: `Đã vẽ địa hình tại ${match[1]}, ${match[2]}. Xuất MAP để lưu.`,
        };
        return templates[language];
    }
    match = source.match(/^Tile (\d+), (\d+) (selected|updated)\.?(?: Export MAP to save it\.)?$/);
    if (match) {
        const selected = match[3] === 'selected';
        const templates: Record<LanguageCode, [string, string]> = {
            en: ['selected', 'updated'], es: ['seleccionada', 'actualizada'], pt: ['selecionada', 'atualizada'],
            zh: ['已选择', '已更新'], th: ['เลือกแล้ว', 'อัปเดตแล้ว'], ru: ['выбрана', 'обновлена'],
            pl: ['wybrano', 'zaktualizowano'], vi: ['đã chọn', 'đã cập nhật'],
        };
        const words = templates[language];
        return language === 'zh'
            ? `图块 ${match[1]}, ${match[2]}${selected ? words[0] : words[1]}。`
            : language === 'th'
                ? `ไทล์ ${match[1]}, ${match[2]} ${words[selected ? 0 : 1]}`
                : `${language === 'en' ? 'Tile' : language === 'ru' ? 'Плитка' : language === 'pl' ? 'Kafelek' : language === 'vi' ? 'Ô' : 'Baldosa'} ${match[1]}, ${match[2]} ${words[selected ? 0 : 1]}.${selected ? '' : ` ${translate('Export Edited MAP + OBJ', language)}.`}`;
    }
    return translate(source, language);
}

export function normalizeLanguage(value: string | null | undefined): LanguageCode {
    const code = (value || '').toLowerCase().split('-')[0] as LanguageCode;
    return SUPPORTED_LANGUAGES.some(language => language.code === code) ? code : 'en';
}

function translateTextNode(node: Text, language: LanguageCode): void {
    const source = sourceTextByNode.get(node) ?? node.nodeValue ?? '';
    if (!source.trim()) return;
    sourceTextByNode.set(node, source);
    const trimmed = source.trim();
    const translated = translateDynamic(trimmed, language);
    if (translated !== trimmed) {
        const start = source.indexOf(trimmed);
        node.nodeValue = `${source.slice(0, start)}${translated}${source.slice(start + trimmed.length)}`;
    } else {
        node.nodeValue = source;
    }
}

function translateElement(element: Element, language: LanguageCode): void {
    const html = element as HTMLElement;
    const key = html.dataset.i18n;
    if (key) {
        // A data-i18n key describes the complete label.  Replacing only the
        // first text node would leave rich-text children (for example
        // <strong>.bmd</strong>) in place and duplicate their content.
        // Replace the complete label instead; controls that contain dynamic
        // values intentionally omit data-i18n and are translated leaf-by-leaf.
        html.textContent = translateDynamic(key, language);
    } else {
        Array.from(html.childNodes).filter(node => node.nodeType === Node.TEXT_NODE)
            .forEach(node => translateTextNode(node as Text, language));
    }

    for (const attribute of ['placeholder', 'title', 'aria-label'] as const) {
        const sources = sourceAttributeByElement.get(element) ?? {};
        const source = sources[attribute] ?? html.getAttribute(attribute);
        if (!source) continue;
        sources[attribute] = source;
        sourceAttributeByElement.set(element, sources);
        const translated = translateDynamic(source, language);
        if (translated !== source) html.setAttribute(attribute, translated);
    }
}

export function applyTranslations(language: LanguageCode): void {
    activeLanguage = language;
    applying = true;
    try {
        document.documentElement.lang = language;
        document.querySelectorAll<HTMLElement>('*').forEach(element => translateElement(element, language));
    } finally {
        applying = false;
    }
}

export function initLanguageSelector(): LanguageCode {
    const select = document.getElementById('language-selector') as HTMLSelectElement | null;
    let stored = '';
    try {
        stored = localStorage.getItem('mu-world-editor-language') || '';
    } catch {
        stored = '';
    }
    const current = normalizeLanguage(stored || navigator.language);
    if (!select) return current;
    select.replaceChildren();
    SUPPORTED_LANGUAGES.forEach(language => {
        const option = document.createElement('option');
        option.value = language.code;
        option.textContent = language.label;
        select.appendChild(option);
    });
    select.value = current;
    applyTranslations(current);
    observer?.disconnect();
    if (typeof MutationObserver === 'undefined') return current;
    observer = new MutationObserver(records => {
        if (applying) return;
        applying = true;
        try {
            records.forEach(record => {
                if (record.type === 'characterData') translateTextNode(record.target as Text, activeLanguage);
                record.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const element = node as HTMLElement;
                        translateElement(element, activeLanguage);
                        element.querySelectorAll<HTMLElement>('*').forEach(child => translateElement(child, activeLanguage));
                    }
                });
            });
        } finally {
            applying = false;
        }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    select.addEventListener('change', () => {
        const next = normalizeLanguage(select.value);
        try {
            localStorage.setItem('mu-world-editor-language', next);
        } catch {
            // Preferences remain session-only when storage is unavailable.
        }
        applyTranslations(next);
    });
    return current;
}
