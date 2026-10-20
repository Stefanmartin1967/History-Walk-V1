// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================================
// Une mise à jour ne recharge Heripia qu'une fois : celui du service worker
// (registerSW, main.js). Jusqu'à v3.7.447, un contrôle de version au démarrage
// (clé `hw_app_version`) interrompait le démarrage de la nouvelle version et
// rechargeait une seconde fois 100 ms plus tard, sans rien apporter. Retiré en
// v3.7.448 (dock absent après mise à jour sur le S25 de Stefan, 20/10/2026).
// ============================================================================

describe('main.js — un seul rechargement par mise à jour', () => {
    it('ne recharge plus la page quand la version change', () => {
        // Code seul : les commentaires citent la clé pour expliquer son retrait.
        const code = readFileSync(resolve(__dirname, '..', 'src', 'main.js'), 'utf8')
            .replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toMatch(/hw_app_version/);
    });
});
