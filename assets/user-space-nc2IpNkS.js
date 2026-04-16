import{s as y,c as u,a as l,b as r,d as g,e as C,r as b,f as E,g as S,h as I,i as L,j as $}from"./main-BJQSZooW.js";import"./leaflet-src-Bex68Vyq.js";function B(e){y("",`
        <div class="ue-container">
            <div class="ue-header">
                <div class="ue-header-top">
                    <div class="ue-header-brand">
                        <span class="ue-brand-icon">🧳</span>
                        Mon Espace
                        <span class="ue-brand-subtitle">/ Mon voyage</span>
                    </div>
                    <button class="ue-close-icon-btn" id="btn-ue-close" title="Fermer">
                        <i data-lucide="x"></i>
                    </button>
                </div>
                <div class="ue-tabs">
                    <div class="ue-tab active" data-tab="circuits">
                        <i data-lucide="map"></i> Mes Circuits
                    </div>
                    <div class="ue-tab" data-tab="data">
                        <i data-lucide="hard-drive"></i> Mes Données
                    </div>
                    <div class="ue-tab" data-tab="trash">
                        <i data-lucide="trash-2"></i> Corbeille
                    </div>
                </div>
            </div>

            <div class="ue-scroll-area">
                <div id="ue-content"></div>
            </div>

            <div class="ue-footer">
                <button class="custom-modal-btn secondary" id="btn-ue-footer-close">Fermer</button>
            </div>
        </div>
    `,null,"user-space-mode");const t=document.getElementById("custom-modal-title");t&&(t.style.display="none");const a=document.getElementById("custom-modal-actions");a&&(a.style.display="none");const n=document.getElementById("custom-modal-overlay"),d=new MutationObserver(()=>{n.classList.contains("active")||(document.querySelector(".custom-modal-box")?.classList.remove("user-space-mode"),t&&(t.style.display="block"),a&&(a.style.display="flex"),d.disconnect())});d.observe(n,{attributes:!0});const p=()=>n.classList.remove("active");document.getElementById("btn-ue-close")?.addEventListener("click",p),document.getElementById("btn-ue-footer-close")?.addEventListener("click",p);const s=document.querySelectorAll(".ue-tab");s.forEach(c=>{c.onclick=()=>{s.forEach(o=>o.classList.remove("active")),c.classList.add("active"),h(c.dataset.tab,e)}}),u({icons:l,root:document.querySelector(".ue-header")}),h("circuits",e)}function h(e,i){const t=document.getElementById("ue-content");t&&(e==="circuits"?f(t,i):e==="data"?k(t,i):e==="trash"&&w(t,i),u({icons:l,root:t}))}function f(e,i){const t=r.officialCircuits||[];if(t.length===0){e.innerHTML=`
            <div class="ue-empty-state">
                <div class="ue-empty-icon"><i data-lucide="wifi-off"></i></div>
                <p class="ue-empty-title">Aucun circuit disponible</p>
                <p class="ue-empty-sub">Les circuits officiels apparaîtront ici une fois chargés.</p>
            </div>`,u({icons:l,root:e});return}const a=r.selectedOfficialCircuitIds,n=a===null?new Set(t.map(s=>String(s.id))):new Set((a||[]).map(String)),d=n.size;e.innerHTML=`
        <div class="ue-section-header">
            <div class="ue-section-title">
                Circuits officiels
                <span class="ue-badge ue-badge-amber" id="ue-circuits-count">${d} / ${t.length}</span>
            </div>
            <div class="ue-section-actions">
                <button class="ue-pill-btn" id="btn-ue-none">Aucun</button>
                <button class="ue-pill-btn" id="btn-ue-all">Tous</button>
            </div>
        </div>

        <div class="ue-hint-banner">
            <i data-lucide="info"></i>
            <span>Les circuits masqués n'apparaissent plus dans la liste, mais leurs POIs restent toujours visibles sur la carte.</span>
        </div>

        <div class="ue-circuits-list">
            ${t.map(s=>{const c=n.has(String(s.id)),o=(s.poiIds||[]).length,v=[`${o} POI${o>1?"s":""}`,s.zone||null,s.distance||null].filter(Boolean).join(" · ");return`
                <label class="ue-circuit-item ${c?"is-checked":""}">
                    <div class="ue-circuit-icon-box">
                        <i data-lucide="route"></i>
                    </div>
                    <div class="ue-circuit-info">
                        <span class="ue-circuit-name">${s.name||"Circuit sans nom"}</span>
                        <span class="ue-circuit-meta">${v}</span>
                    </div>
                    <div class="ue-toggle-wrap">
                        <input type="checkbox" class="ue-circuit-check" data-circuit-id="${s.id}" ${c?"checked":""}>
                        <span class="ue-toggle-slider"></span>
                    </div>
                </label>`}).join("")}
        </div>
    `;const p=()=>{const s=e.querySelectorAll(".ue-circuit-check:checked").length,c=document.getElementById("ue-circuits-count");c&&(c.textContent=`${s} / ${t.length}`)};document.getElementById("btn-ue-none")?.addEventListener("click",()=>{i.setSelection&&i.setSelection([]),f(e,i)}),document.getElementById("btn-ue-all")?.addEventListener("click",()=>{i.setSelection&&i.setSelection(t.map(s=>String(s.id))),f(e,i)}),e.querySelectorAll(".ue-circuit-check").forEach(s=>{s.addEventListener("change",()=>{const c=r.selectedOfficialCircuitIds===null?t.map(m=>String(m.id)):[...r.selectedOfficialCircuitIds||[]],o=String(s.dataset.circuitId),v=s.checked?[...new Set([...c,o])]:c.filter(m=>m!==o);i.setSelection&&i.setSelection(v),s.closest(".ue-circuit-item")?.classList.toggle("is-checked",s.checked),p()})})}function k(e,i){e.innerHTML=`
        <div class="ue-section-header">
            <div class="ue-section-title">Gestion des données</div>
        </div>

        <div class="ue-data-grid">
            <div class="ue-data-card">
                <div class="ue-data-card-icon">
                    <i data-lucide="download"></i>
                </div>
                <div class="ue-data-card-title">Sauvegarder</div>
                <p class="ue-data-card-desc">
                    Exportez vos notes, lieux visités, circuits et préférences dans un fichier portable.
                </p>
                <label class="ue-photo-label">
                    <input type="checkbox" id="ue-include-photos">
                    <span>Inclure les photos</span>
                </label>
                <button id="btn-ue-backup" class="ue-action-btn primary">
                    <i data-lucide="download"></i> Télécharger
                </button>
            </div>

            <div class="ue-data-card">
                <div class="ue-data-card-icon secondary">
                    <i data-lucide="upload"></i>
                </div>
                <div class="ue-data-card-title">Restaurer</div>
                <p class="ue-data-card-desc">
                    Rechargez un fichier de sauvegarde pour retrouver votre progression sur cet appareil.
                </p>
                <button id="btn-ue-restore" class="ue-action-btn secondary" style="margin-top:auto;">
                    <i data-lucide="folder-open"></i> Choisir un fichier…
                </button>
                <input type="file" id="ue-restore-loader" accept=".json,.txt" style="display:none;">
            </div>
        </div>

        <div class="ue-hint-banner" style="margin-top: 16px;">
            <i data-lucide="shield-check"></i>
            <span>Vos données restent sur votre appareil. Aucune information n'est envoyée à nos serveurs.</span>
        </div>
    `,document.getElementById("btn-ue-backup")?.addEventListener("click",()=>{const t=document.getElementById("ue-include-photos")?.checked||!1;i.exportData&&i.exportData(t)}),document.getElementById("btn-ue-restore")?.addEventListener("click",()=>{document.getElementById("ue-restore-loader")?.click()}),document.getElementById("ue-restore-loader")?.addEventListener("change",t=>{i.restoreData&&i.restoreData(t)})}function w(e,i){const t=(r.myCircuits||[]).filter(a=>a.isDeleted);if(t.length===0){e.innerHTML=`
            <div class="ue-empty-state">
                <div class="ue-empty-icon green"><i data-lucide="package-check"></i></div>
                <p class="ue-empty-title">Corbeille vide</p>
                <p class="ue-empty-sub">Les circuits supprimés apparaîtront ici et pourront être restaurés.</p>
            </div>`,u({icons:l,root:e});return}e.innerHTML=`
        <div class="ue-section-header">
            <div class="ue-section-title">
                Circuits supprimés
                <span class="ue-badge ue-badge-red">${t.length}</span>
            </div>
        </div>

        <div class="ue-hint-banner">
            <i data-lucide="info"></i>
            <span>Ces circuits ont été supprimés mais peuvent être restaurés à tout moment.</span>
        </div>

        <div class="ue-circuits-list">
            ${t.map(a=>`
                <div class="ue-trash-item" id="ue-trash-${a.id}">
                    <div class="ue-circuit-icon-box muted">
                        <i data-lucide="route"></i>
                    </div>
                    <div class="ue-circuit-info">
                        <span class="ue-circuit-name">${a.name||"Circuit sans nom"}</span>
                        <span class="ue-circuit-meta">${(a.poiIds||[]).length} POI${(a.poiIds||[]).length>1?"s":""} · Supprimé</span>
                    </div>
                    <button class="ue-restore-btn" data-action="restore-circuit" data-id="${a.id}">
                        <i data-lucide="rotate-ccw"></i> Restaurer
                    </button>
                </div>
            `).join("")}
        </div>
    `,e.querySelectorAll('[data-action="restore-circuit"]').forEach(a=>{a.addEventListener("click",()=>{const n=a.dataset.id;i.restoreCircuit&&i.restoreCircuit(n);const d=document.getElementById(`ue-trash-${n}`);d&&(d.style.opacity="0.5",d.style.pointerEvents="none",a.innerHTML='<i data-lucide="check"></i> Restauré',u({icons:l,root:d}))})})}function q(){B({setSelection:x,exportData:T,restoreData:D,restoreCircuit:M})}async function x(e){g(e),await C("selectedOfficialCircuits",e),b()}async function T(e){e?await E():await S()}function D(e){I(e)}async function M(e){const i=(r.myCircuits||[]).find(t=>String(t.id)===String(e));await L(e),i&&(i.isDeleted=!1,$(`Circuit "${i.name||"Sans nom"}" restauré.`,"success"),b())}export{q as openUserSpace};
