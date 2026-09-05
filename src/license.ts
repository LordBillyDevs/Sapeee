const LICENSE_URL = 'https://lordbillytools.com.ar/Licencias/Licencias.txt';
const SAVED_CREDENTIALS_KEY = 'mudevs-license-credentials';

type Credentials = { email: string; password: string };

async function readLicenseFile(): Promise<string> {
    if (window.electronAPI?.isElectron && window.electronAPI.readLicenseFile) {
        return window.electronAPI.readLicenseFile();
    }
    const response = await fetch(LICENSE_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`License file returned HTTP ${response.status}.`);
    return response.text();
}

function parseCredentials(text: string): Credentials[] {
    return text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => {
        const parts = line.includes('|') ? line.split('|') : line.split(/\s+/);
        return { email: (parts[0] || '').trim().toLowerCase(), password: (parts.slice(1).join(line.includes('|') ? '|' : ' ') || '').trim() };
    }).filter(item => item.email && item.password);
}

export function initLicenseGate(): void {
    const gate = document.getElementById('license-gate');
    const form = document.getElementById('license-form') as HTMLFormElement | null;
    const email = document.getElementById('license-email') as HTMLInputElement | null;
    const password = document.getElementById('license-password') as HTMLInputElement | null;
    const remember = document.getElementById('license-remember') as HTMLInputElement | null;
    const status = document.getElementById('license-status');
    const submit = document.getElementById('license-submit') as HTMLButtonElement | null;
    if (!gate || !form || !email || !password || !remember || !status || !submit) return;

    const saved = localStorage.getItem(SAVED_CREDENTIALS_KEY);
    if (saved) {
        try {
            const credentials = JSON.parse(saved) as Credentials;
            email.value = credentials.email;
            password.value = credentials.password;
            remember.checked = true;
        } catch {
            localStorage.removeItem(SAVED_CREDENTIALS_KEY);
        }
    }

    gate.classList.remove('hidden');
    document.body.classList.add('license-locked');
    form.addEventListener('submit', event => {
        event.preventDefault();
        submit.disabled = true;
        status.textContent = 'Verificando credenciales…';
        status.classList.remove('license-error');
        void readLicenseFile().then(text => {
            const valid = parseCredentials(text).some(item => item.email === email.value.trim().toLowerCase() && item.password === password.value);
            if (!valid) throw new Error('Email o contraseña incorrectos.');
            if (remember.checked) localStorage.setItem(SAVED_CREDENTIALS_KEY, JSON.stringify({ email: email.value.trim(), password: password.value }));
            else localStorage.removeItem(SAVED_CREDENTIALS_KEY);
            gate.classList.add('hidden');
            document.body.classList.remove('license-locked');
        }).catch(error => {
            status.textContent = error instanceof Error ? error.message : 'No se pudo verificar la licencia.';
            status.classList.add('license-error');
        }).finally(() => {
            submit.disabled = false;
        });
    });
}
