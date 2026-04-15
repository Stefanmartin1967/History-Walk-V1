// welcome.js
// Écran de bienvenue — affiché uniquement au premier lancement.

const WELCOME_KEY = 'hw_welcome_seen';

const slides = [
    {
        svg: `
        <svg viewBox="0 0 220 160" xmlns="http://www.w3.org/2000/svg">
            <circle cx="110" cy="80" r="72" fill="var(--brand)" opacity="0.08"/>
            <!-- Grille carte -->
            <line x1="45" y1="55" x2="175" y2="55" stroke="var(--brand)" stroke-width="1" opacity="0.25"/>
            <line x1="45" y1="80" x2="175" y2="80" stroke="var(--brand)" stroke-width="1" opacity="0.25"/>
            <line x1="45" y1="105" x2="175" y2="105" stroke="var(--brand)" stroke-width="1" opacity="0.25"/>
            <line x1="80" y1="35" x2="80" y2="130" stroke="var(--brand)" stroke-width="1" opacity="0.25"/>
            <line x1="110" y1="35" x2="110" y2="130" stroke="var(--brand)" stroke-width="1" opacity="0.25"/>
            <line x1="140" y1="35" x2="140" y2="130" stroke="var(--brand)" stroke-width="1" opacity="0.25"/>
            <!-- Tracé de circuit -->
            <path d="M 58 118 C 65 90 85 75 110 70 C 130 66 148 75 155 58" stroke="var(--brand)" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            <!-- POI marqueurs -->
            <circle cx="58" cy="118" r="7" fill="var(--brand)" opacity="0.9"/>
            <circle cx="110" cy="70" r="7" fill="var(--brand)" opacity="0.9"/>
            <circle cx="155" cy="58" r="7" fill="var(--brand)" opacity="0.9"/>
            <!-- Petites croix sur la grille pour effet carte -->
            <text x="91" y="68" font-size="9" fill="var(--ink-soft)" opacity="0.4" text-anchor="middle">+</text>
            <text x="125" y="95" font-size="9" fill="var(--ink-soft)" opacity="0.4" text-anchor="middle">+</text>
            <text x="91" y="95" font-size="9" fill="var(--ink-soft)" opacity="0.4" text-anchor="middle">+</text>
        </svg>`,
        title: 'Votre guide de voyage personnel',
        text: 'Préparez, explorez, documentez. History Walk transforme vos voyages en aventures organisées.'
    },
    {
        svg: `
        <svg viewBox="0 0 220 160" xmlns="http://www.w3.org/2000/svg">
            <circle cx="110" cy="80" r="72" fill="var(--brand)" opacity="0.08"/>
            <!-- Livre ouvert -->
            <path d="M 55 50 L 55 120 Q 55 125 60 125 L 108 118 L 108 45 L 62 45 Q 55 45 55 50 Z" fill="var(--surface-muted)" stroke="var(--brand)" stroke-width="1.5"/>
            <path d="M 165 50 L 165 120 Q 165 125 160 125 L 112 118 L 112 45 L 158 45 Q 165 45 165 50 Z" fill="var(--surface-muted)" stroke="var(--brand)" stroke-width="1.5"/>
            <!-- Reliure -->
            <line x1="110" y1="44" x2="110" y2="126" stroke="var(--brand)" stroke-width="2"/>
            <!-- Lignes de texte page gauche -->
            <line x1="65" y1="62" x2="100" y2="62" stroke="var(--ink-soft)" stroke-width="1.5" opacity="0.5"/>
            <line x1="65" y1="72" x2="100" y2="72" stroke="var(--ink-soft)" stroke-width="1.5" opacity="0.5"/>
            <line x1="65" y1="82" x2="95" y2="82" stroke="var(--ink-soft)" stroke-width="1.5" opacity="0.5"/>
            <!-- Photo page droite -->
            <rect x="118" y="58" width="38" height="28" rx="3" fill="var(--brand)" opacity="0.2" stroke="var(--brand)" stroke-width="1"/>
            <path d="M 118 76 L 130 65 L 140 73 L 148 66 L 156 76 L 156 86 L 118 86 Z" fill="var(--brand)" opacity="0.3"/>
            <circle cx="128" cy="67" r="4" fill="var(--brand)" opacity="0.4"/>
            <!-- Lignes de texte page droite -->
            <line x1="118" y1="93" x2="155" y2="93" stroke="var(--ink-soft)" stroke-width="1.5" opacity="0.5"/>
            <line x1="118" y1="102" x2="148" y2="102" stroke="var(--ink-soft)" stroke-width="1.5" opacity="0.5"/>
        </svg>`,
        title: 'Une encyclopédie de poche',
        text: 'Des centaines de lieux documentés — histoire, architecture, gastronomie, nature. Tout ce qu\'un guide papier ne peut pas mettre à jour.'
    },
    {
        svg: `
        <svg viewBox="0 0 220 160" xmlns="http://www.w3.org/2000/svg">
            <circle cx="110" cy="80" r="72" fill="var(--brand)" opacity="0.08"/>
            <!-- Tracé sinueux -->
            <path d="M 45 125 C 60 125 65 95 80 90 C 95 85 100 100 115 95 C 130 90 135 65 155 55 C 165 50 172 52 178 48" stroke="var(--brand)" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="6 3"/>
            <!-- Étapes du circuit -->
            <circle cx="45" cy="125" r="8" fill="var(--brand)" opacity="0.9"/>
            <text x="45" y="129" font-size="8" fill="white" text-anchor="middle" font-weight="bold">1</text>
            <circle cx="115" cy="95" r="8" fill="var(--brand)" opacity="0.7"/>
            <text x="115" y="99" font-size="8" fill="white" text-anchor="middle" font-weight="bold">2</text>
            <circle cx="178" cy="48" r="8" fill="var(--brand)" opacity="0.9"/>
            <text x="178" y="52" font-size="8" fill="white" text-anchor="middle" font-weight="bold">3</text>
            <!-- Téléphone avec appli de marche -->
            <rect x="82" y="105" width="28" height="42" rx="4" fill="var(--surface)" stroke="var(--brand)" stroke-width="1.5"/>
            <rect x="85" y="110" width="22" height="28" rx="2" fill="var(--brand)" opacity="0.15"/>
            <!-- Mini tracé sur l'écran du téléphone -->
            <path d="M 87 130 C 90 125 95 122 100 124 C 104 126 105 118 107 116" stroke="var(--brand)" stroke-width="1.5" fill="none" stroke-linecap="round"/>
            <circle cx="87" cy="130" r="2" fill="var(--brand)"/>
            <circle cx="107" cy="116" r="2" fill="#10B981"/>
        </svg>`,
        title: 'Vos circuits, à votre rythme',
        text: 'Créez vos itinéraires, exportez-les en GPX et suivez-les avec votre application de marche. Marquez vos étapes au fil de vos découvertes.'
    },
    {
        svg: `
        <svg viewBox="0 0 220 160" xmlns="http://www.w3.org/2000/svg">
            <circle cx="110" cy="80" r="72" fill="var(--brand)" opacity="0.08"/>
            <!-- Boussole -->
            <circle cx="110" cy="78" r="45" fill="none" stroke="var(--brand)" stroke-width="2" opacity="0.3"/>
            <circle cx="110" cy="78" r="38" fill="none" stroke="var(--brand)" stroke-width="1" opacity="0.2"/>
            <!-- Points cardinaux -->
            <text x="110" y="36" font-size="11" fill="var(--brand)" text-anchor="middle" font-weight="bold" opacity="0.7">N</text>
            <text x="110" y="128" font-size="11" fill="var(--ink-soft)" text-anchor="middle" opacity="0.5">S</text>
            <text x="64" y="82" font-size="11" fill="var(--ink-soft)" text-anchor="middle" opacity="0.5">O</text>
            <text x="156" y="82" font-size="11" fill="var(--ink-soft)" text-anchor="middle" opacity="0.5">E</text>
            <!-- Aiguille nord (brand) -->
            <polygon points="110,42 106,78 110,72 114,78" fill="var(--brand)" opacity="0.9"/>
            <!-- Aiguille sud (grise) -->
            <polygon points="110,114 106,78 110,84 114,78" fill="var(--ink-soft)" opacity="0.4"/>
            <!-- Centre -->
            <circle cx="110" cy="78" r="5" fill="var(--brand)" opacity="0.8"/>
            <circle cx="110" cy="78" r="2.5" fill="var(--surface)"/>
        </svg>`,
        title: 'Prêt à explorer ?',
        text: 'Le contenu s\'enrichit à chaque voyage. Bonne exploration !'
    }
];

export function showWelcomeIfNeeded() {
    if (localStorage.getItem(WELCOME_KEY)) return;
    showWelcome();
}

function showWelcome() {
    let current = 0;

    const overlay = document.createElement('div');
    overlay.id = 'welcome-overlay';
    overlay.innerHTML = `
        <div class="welcome-modal">
            <div class="welcome-slides-wrapper">
                <div class="welcome-slides" id="welcome-slides"></div>
            </div>
            <div class="welcome-dots" id="welcome-dots"></div>
            <div class="welcome-actions" id="welcome-actions">
                <button class="welcome-btn-skip" id="welcome-skip">Passer</button>
                <button class="welcome-btn-next" id="welcome-next">Suivant →</button>
            </div>
            <div class="welcome-choices" id="welcome-choices">
                <button class="welcome-btn-choice-primary" id="welcome-all">Tous les circuits →</button>
                <button class="welcome-btn-choice-secondary" id="welcome-space">Choisir dans Mon Espace</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const slidesEl  = document.getElementById('welcome-slides');
    const dotsEl    = document.getElementById('welcome-dots');
    const btnNext   = document.getElementById('welcome-next');
    const btnSkip   = document.getElementById('welcome-skip');
    const actions   = document.getElementById('welcome-actions');
    const choices   = document.getElementById('welcome-choices');

    // Construire les slides
    slides.forEach((s, i) => {
        const slide = document.createElement('div');
        slide.className = 'welcome-slide';
        slide.innerHTML = `
            <div class="welcome-illustration">${s.svg}</div>
            <h2 class="welcome-title">${s.title}</h2>
            <p class="welcome-text">${s.text}</p>
        `;
        slidesEl.appendChild(slide);

        const dot = document.createElement('span');
        dot.className = 'welcome-dot' + (i === 0 ? ' active' : '');
        dot.addEventListener('click', () => goTo(i));
        dotsEl.appendChild(dot);
    });

    function goTo(index) {
        current = index;
        slidesEl.style.transform = `translateX(-${current * 100}%)`;
        document.querySelectorAll('.welcome-dot').forEach((d, i) => {
            d.classList.toggle('active', i === current);
        });
        const isLast = current === slides.length - 1;
        actions.style.display  = isLast ? 'none' : '';
        choices.style.display  = isLast ? 'flex' : 'none';
    }

    btnNext.addEventListener('click', () => {
        if (current < slides.length - 1) goTo(current + 1);
    });

    btnSkip.addEventListener('click', close);

    // Dernier slide — choix circuits
    document.getElementById('welcome-all').addEventListener('click', close);

    document.getElementById('welcome-space').addEventListener('click', () => {
        close();
        setTimeout(() => {
            import('./user-space.js').then(({ openUserSpace }) => openUserSpace());
        }, 400);
    });

    // Swipe mobile
    let touchStartX = 0;
    overlay.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    overlay.addEventListener('touchend', e => {
        const delta = touchStartX - e.changedTouches[0].clientX;
        if (Math.abs(delta) > 50) {
            if (delta > 0 && current < slides.length - 1) goTo(current + 1);
            else if (delta < 0 && current > 0) goTo(current - 1);
        }
    });

    function close() {
        localStorage.setItem(WELCOME_KEY, '1');
        overlay.classList.add('welcome-fadeout');
        setTimeout(() => overlay.remove(), 350);
    }

    requestAnimationFrame(() => overlay.classList.add('welcome-visible'));
}
