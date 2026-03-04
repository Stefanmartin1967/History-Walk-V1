# Guide Stratégique : Refonte Architecturale du Rendu CSS

Ce document a été créé suite à l'incident de sécurité (tentative de restriction de la directive CSP `style-src`) détaillé dans `BILAN_SECURITE_V2.md`. Il sert de feuille de route pour les futurs travaux d'assainissement de l'interface graphique de l'application History Walk.

L'objectif de cette refonte **n'est pas** de modifier le design (les couleurs, les tailles, les espacements), mais de modifier la **façon dont le design est appliqué** au code, pour des raisons de sécurité et de performance.

---

## 1. Pourquoi ce chantier est-il inévitable (et risqué aujourd'hui) ?

Le code actuel génère l'interface utilisateur en "dessinant" directement avec du code JavaScript sous forme de chaînes de caractères (ex: dans `mobile.js`, `admin-control-ui.js`).

**Le problème : L'utilisation massive du CSS "En Ligne" (Inline CSS)**
Au lieu d'utiliser des classes (ex: `<div class="circuit-card">`), l'application écrit souvent les styles directement dans les balises HTML qu'elle génère :
`"<div style='background-color: white; border-radius: 8px; padding: 15px; margin-bottom: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);'>"`

*   **Impact Sécurité (Critique) :** Pour que le navigateur accepte d'afficher ces styles intégrés au texte, la Politique de Sécurité (CSP) de l'application **doit** comporter la faille `style-src 'unsafe-inline'`. Sans cela, le navigateur refuse ces styles, et l'application perd 100% de son design (pop-ups cassées, listes illisibles).
*   **Impact Performance (Moyen) :** Générer de grandes quantités de texte contenant des styles lourds demande plus d'efforts au navigateur du téléphone que de simplement appliquer une règle CSS pré-calculée.
*   **Impact Maintenance (Élevé) :** Si l'on souhaite changer l'arrondi (le `border-radius`) de toutes les cartes de l'application, il faut chercher et remplacer cette valeur dans de multiples fichiers JavaScript différents.

---

## 2. La Méthodologie "Chirurgicale" (Comment l'IA procèdera)

L'utilisateur n'aura pas à redéfinir le design. Une IA (ou un développeur) peut extraire ce design en s'inspirant de l'existant. Ce chantier ne doit en aucun cas être abordé comme une "refonte globale", mais plutôt comme une "traduction" progressive.

Voici les 4 étapes strictes à suivre par tout intervenant sur ce chantier :

### Étape A : Extraction des styles (Création de classes) - Fichier par Fichier
1.  **Isoler une cible :** Choisir un seul fichier générateur d'interface à la fois (ex: commencer par un petit composant comme les "Tags" de catégories dans `mobile.js`).
2.  **Traduire :** Repérer un attribut `style="..."` dans le code JavaScript.
3.  **Créer la règle :** Ouvrir `style.css` et créer une classe descriptive reprenant exactement ces valeurs.
    *   *Avant :* `"<span style='background: #eef2ff; color: #4338ca; padding: 2px 6px; border-radius: 4px; font-size: 11px;'>"`
    *   *Nouveau CSS (`style.css`) :*
        ```css
        .badge-category {
            background-color: #eef2ff;
            color: #4338ca;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 11px;
        }
        ```
4.  **Remplacer :** Modifier le JavaScript pour utiliser cette classe : `"<span class='badge-category'>"`
5.  **Valider :** L'interface ne doit avoir subi aucune modification visuelle au pixel près.

### Étape B : Remplacement du HTML texte par la création d'éléments (DOM Natif)
Cette étape est souvent couplée à l'Étape A.
Une fois les classes créées, il faudra remplacer la méthode d'injection de texte massif (`element.innerHTML = "..."`) par la création de vrais éléments de page en mémoire, ce qui est plus sécurisé et performant.
*   *Avant :* `let html = "<div class='badge-category'>Texte</div>"; container.innerHTML = html;`
*   *Après :*
    ```javascript
    const badge = document.createElement('div');
    badge.className = 'badge-category';
    badge.textContent = 'Texte';
    container.appendChild(badge);
    ```

### Étape C : Vérification Visuelle par l'IA (Non-Régression)
Après chaque petit composant traduit (par exemple, juste l'en-tête d'une carte), une capture d'écran "Avant / Après" doit être analysée via un script de test (ex: Playwright). Si le moindre pixel a bougé, la modification doit être annulée et corrigée.

### Étape D : Le "Test de l'Interrupteur" (Validation de Sécurité)
Ce n'est qu'une fois que **100% de l'application** aura été nettoyée de tous ses `style="..."` (ce qui représente un effort s'étalant sur plusieurs sessions de travail distinctes) que la validation finale pourra avoir lieu.
1.  Ouvrir `index.html`, `tools/fusion.html`, `tools/scout.html`.
2.  Dans la balise `<meta http-equiv="Content-Security-Policy">`, retirer `'unsafe-inline'` de la directive `style-src`.
3.  Recharger l'application.
    *   **Succès :** L'interface ne bouge pas, la faille de sécurité CSP est définitivement fermée.
    *   **Échec :** Le design est cassé (fonds blancs, éléments désalignés). Cela signifie qu'il reste du CSS en ligne caché quelque part dans le code JavaScript. Il faut rétablir `'unsafe-inline'` et repartir à la chasse au code (Étape A).

---

## 3. Priorités d'attaque suggérées

Lorsque ce chantier sera lancé, voici l'ordre recommandé pour minimiser les risques :

1.  **Vues annexes (Faible risque) :** Commencer par `tools/fusion.html` (Console Fusion ++) et ses scripts associés (`src/admin-fusion-standalone.js`). C'est un environnement isolé, idéal pour tester la méthode d'extraction CSS.
2.  **Mode Utilisateur (Risque modéré) :** S'attaquer à la vue liste Mobile (`src/mobile.js`) et aux panneaux latéraux d'information (`src/ui-poi-details.js`). Ces composants sont denses et contiennent beaucoup de CSS en ligne, mais leur structure est répétitive.
3.  **Administration (Risque élevé) :** Terminer par le Centre de Contrôle (`src/admin-control-ui.js`, `src/admin-diff-ui.js`). C'est la zone la plus complexe visuellement avec de nombreux états dynamiques (brouillons, conflits, suppressions).
