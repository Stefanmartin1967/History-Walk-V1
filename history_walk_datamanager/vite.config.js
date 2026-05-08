import { defineConfig } from 'vite';

// Le DM est un sous-projet Vite distinct. Cette config autorise les imports
// relatifs vers le repo parent — utile pour partager `src/modal.js` HW
// (helpers hwConfirm/hwAlert/hwPrompt, PR 3e-1) au lieu de dupliquer le code.
export default defineConfig({
    server: {
        fs: {
            // Autorise l'accès aux fichiers du repo parent (`../`) en plus du
            // root du DM. Sans ça, `import '../../src/modal.js'` échoue avec
            // "Failed to fetch dynamically imported module" en dev.
            allow: ['..'],
        },
    },
});
