export interface TexturePackageEntry {
    name: string;
    type: string;
    data: string;
}

export interface TexturePackage {
    format: 'mu-textures';
    version: 1;
    files: TexturePackageEntry[];
}

function encodeBase64(bytes: Uint8Array): string {
    let result = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) result += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(result);
}

function decodeBase64(value: string): Uint8Array {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export async function createTexturePackage(files: readonly File[]): Promise<Blob> {
    const entries: TexturePackageEntry[] = [];
    for (const file of files) entries.push({ name: file.name, type: file.type, data: encodeBase64(new Uint8Array(await file.arrayBuffer())) });
    return new Blob([JSON.stringify({ format: 'mu-textures', version: 1, files: entries } satisfies TexturePackage)], { type: 'application/json' });
}

export async function readTexturePackage(file: File): Promise<File[]> {
    const value = JSON.parse(await file.text()) as Partial<TexturePackage>;
    if (value.format !== 'mu-textures' || value.version !== 1 || !Array.isArray(value.files)) throw new Error('Invalid texture package');
    return value.files.map(entry => {
        const bytes = decodeBase64(entry.data);
        return new File([bytes.buffer as ArrayBuffer], entry.name, { type: entry.type || 'application/octet-stream' });
    });
}
