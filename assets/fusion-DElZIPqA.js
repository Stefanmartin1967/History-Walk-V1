import"./modulepreload-polyfill-B5Qt9EMX.js";import{b as $,f as u,j as D}from"./utils-Uq4FTfbP.js";const r={sourceInput:document.getElementById("source-file"),backupInput:document.getElementById("backup-file"),btnAnalyze:document.getElementById("btn-analyze"),dashboard:document.getElementById("dashboard"),uploadCard:document.getElementById("upload-card"),listNew:document.getElementById("list-new"),listGps:document.getElementById("list-gps"),listContent:document.getElementById("list-content"),btnFusion:document.getElementById("btn-fusion")};let f=null,m=null,l={newPois:[],gpsUpdates:[],contentUpdates:[]};const k={description:"Description",Description_courte:"Desc_wpt",notes:"Notes_internes",price:"Prix d'entrée",timeH:"Temps de visite",verified:"Vérifié",incontournable:"Incontournable",vu:"Visité"};function y(){f&&m?(r.btnAnalyze.disabled=!1,r.btnAnalyze.innerHTML='<i data-lucide="scan-search"></i> Analyser les différences',r.btnAnalyze.classList.add("btn-success"),lucide.createIcons()):r.btnAnalyze.disabled=!0}function w(t,o,i,a){t.addEventListener("change",async e=>{const n=e.target.files[0];if(!n)return;const s=document.getElementById(o),p=document.getElementById(i);s.innerHTML='<span class="fusion-name-loading">Chargement...</span>';try{const c=await n.text(),d=JSON.parse(c);if(a){if(!d.features)throw new Error("Pas de 'features' trouvé.");f=d,s.innerHTML=`<span class="fusion-name-ok">✅ ${u(n.name)} (${d.features.length} POIs)</span>`}else{if(!d.userData)throw new Error("Backup invalide.");m=d;const g=Object.keys(d.userData||{}).length;s.innerHTML=`<span class="fusion-name-ok">✅ ${u(n.name)} (${g} entrées)</span>`}p.classList.add("active","box-ok"),y()}catch(c){console.error(c),s.innerHTML=`<span class="fusion-name-error">❌ Erreur: ${c.message}</span>`,a?f=null:m=null,y()}})}w(r.sourceInput,"source-name","box-source",!0);w(r.backupInput,"backup-name","box-backup",!1);r.btnAnalyze.addEventListener("click",()=>{!f||!m||(r.btnAnalyze.textContent="Analyse en cours...",setTimeout(E,50))});function E(){l={newPois:[],gpsUpdates:[],contentUpdates:[]};const t=f.features||[],o=m.baseGeoJSON&&m.baseGeoJSON.features?m.baseGeoJSON.features:[],i=m.userData||{},a=new Set(t.map(e=>e.properties.HW_ID));o.forEach(e=>{if(!a.has(e.properties.HW_ID)){const n=i[e.properties.HW_ID]||{};l.newPois.push({feature:e,proposedName:n.custom_title||n["Nom du site FR"]||e.properties["Nom du site FR"]||"Nouveau Lieu",proposedDesc:n.notes||"",id:e.properties.HW_ID})}}),t.forEach(e=>{const n=e.properties.HW_ID,s=i[n],p=o.find(c=>c.properties.HW_ID===n);if(!(!s&&!p)){if(p){const c=e.geometry.coordinates,d=p.geometry.coordinates,g=D(c[1],c[0],d[1],d[0]);g>5&&l.gpsUpdates.push({id:n,name:e.properties["Nom du site FR"],oldCoords:c,newCoords:d,distance:Math.round(g)})}if(s){const c=[],d=s.custom_title||s["Nom du site FR"];d&&d!==e.properties["Nom du site FR"]&&c.push({type:"Nom",old:e.properties["Nom du site FR"],new:d}),s.notes&&c.push({type:"Note",old:"(vide)",new:s.notes}),c.length>0&&l.contentUpdates.push({id:n,name:e.properties["Nom du site FR"],changes:c})}}}),C()}function C(){r.uploadCard.style.display="none",r.dashboard.style.display="block",v(r.listNew,"Nouveaux Lieux à Créer","badge-new",l.newPois,(t,o)=>`
        <div class="change-item">
            <div class="checkbox-wrapper"><input type="checkbox" checked id="new-${o}"></div>
            <div class="change-content">
                <div class="poi-name">Nouveau Lieu <span class="badge badge-new">Création</span></div>

                <div class="fusion-poi-grid">
                    <div>
                        <label class="fusion-label">Nom FR</label>
                        <input type="text" class="new-poi-input" id="name-new-${o}" value="${u(t.proposedName)}">
                    </div>
                    <div>
                        <label class="fusion-label">Nom AR (Optionnel)</label>
                        <input type="text" class="new-poi-input fusion-input-rtl" id="name-ar-new-${o}" placeholder="الاسم بالعربية" dir="rtl">
                    </div>
                </div>

                ${t.proposedDesc?`<div class="change-detail"><span class="fusion-name-note">Note mobile : ${u(t.proposedDesc)}</span></div>`:""}
            </div>
        </div>`),v(r.listGps,"Corrections GPS","badge-gps",l.gpsUpdates,(t,o)=>`
        <div class="change-item">
            <div class="checkbox-wrapper"><input type="checkbox" checked id="gps-${o}"></div>
            <div class="change-content">
                <div class="poi-name">${u(t.name)}</div>
                <div class="change-detail">
                    <span class="badge badge-gps">${t.distance}m</span>
                    <span class="old-val">[${t.oldCoords[1].toFixed(5)}, ${t.oldCoords[0].toFixed(5)}]</span>
                    <span class="arrow">➜</span>
                    <span class="new-val">[${t.newCoords[1].toFixed(5)}, ${t.newCoords[0].toFixed(5)}]</span>
                </div>
            </div>
        </div>`),v(r.listContent,"Mises à jour Contenu","badge-content",l.contentUpdates,(t,o)=>{const i=t.changes.map(a=>`
            <div class="change-detail">
                <span class="badge badge-content">${u(a.type)}</span>
                <span class="new-val">${u(a.new)}</span>
            </div>`).join("");return`
            <div class="change-item">
                <div class="checkbox-wrapper"><input type="checkbox" checked id="content-${o}"></div>
                <div class="change-content"><div class="poi-name">${u(t.name)}</div>${i}</div>
            </div>`}),lucide.createIcons()}function v(t,o,i,a,e){if(a.length===0){t.innerHTML="";return}let n=`<div class="group-title">${o} <span class="badge ${i}">${a.length}</span></div>`;n+=a.map((s,p)=>e(s,p)).join(""),t.innerHTML=n}r.btnFusion.addEventListener("click",()=>{const t=JSON.parse(JSON.stringify(f.features));let o={new:0,gps:0,content:0};l.gpsUpdates.forEach((i,a)=>{if(document.getElementById(`gps-${a}`).checked){const e=t.find(n=>n.properties.HW_ID===i.id);e&&(e.geometry.coordinates=i.newCoords,o.gps++)}}),l.contentUpdates.forEach((i,a)=>{if(document.getElementById(`content-${a}`).checked){const e=t.find(n=>n.properties.HW_ID===i.id);e&&(i.changes.forEach(n=>{n.type==="Nom"&&(e.properties["Nom du site FR"]=n.new),n.type==="Note"&&(e.properties.Notes_internes=(e.properties.Notes_internes||"")+`
`+n.new)}),o.content++)}}),l.newPois.forEach((i,a)=>{if(document.getElementById(`new-${a}`).checked){const e=document.getElementById(`name-new-${a}`).value,n=document.getElementById(`name-ar-new-${a}`).value,s=JSON.parse(JSON.stringify(i.feature)),p=s.properties.userData||{},[c,d]=s.geometry.coordinates,g=$(d,c);s.properties={HW_ID:i.id,"Nom du site FR":e,"Nom du site AR":n||"",Catégorie:i.feature.properties.Catégorie||"A définir",Zone:g};for(const[b,h]of Object.entries(k))if(p[b]!==void 0&&p[b]!=="")if(b==="price")s.properties[h]=p.price+" TND";else if(b==="timeH"){const N=p.timeH||0,I=p.timeM||0;s.properties[h]=`${String(N).padStart(2,"0")}:${String(I).padStart(2,"0")}`}else s.properties[h]=p[b];t.push(s),o.new++}}),F({type:"FeatureCollection",features:t},o)});function F(t,o){const i=JSON.stringify(t,null,2),a=new Blob([i],{type:"application/json"}),e=URL.createObjectURL(a),n=new Date().toISOString().slice(0,10),s=document.createElement("a");s.href=e,s.download=`HistoryWalk_Master_V2_${n}.geojson`,s.click(),r.btnFusion.textContent=`Succès ! V2 générée (${o.new} nouveaux, ${o.gps} GPS)`,r.btnFusion.classList.remove("btn-success"),r.btnFusion.style.backgroundColor="#64748B"}
