import { createIcons, icons } from 'lucide';

export function updateSelectionModeButton(isActive) {
    const btn = document.getElementById('btn-mode-selection');
    if (!btn) return;

    if (isActive) {
        btn.innerHTML = `<i data-lucide="map-pin-plus"></i><span>Créer circuit</span>`;
        btn.title = "Mode création activé";
    } else {
        btn.innerHTML = `<i data-lucide="map-pin-off"></i><span>Explorer</span>`;
        btn.title = "Mode consultation";
    }
    createIcons({ icons });
}
