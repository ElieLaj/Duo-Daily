# Bot Elo

Bot Discord qui poste chaque jour un résumé de la progression en classée de
joueurs League of Legends : LP actuels, **différence de LP depuis la dernière
comparaison**, rang, nombre de parties et bilan victoires/défaites.

```
Résumé du 06-08-2026

[icône] Pseudo #TAG
## Diamant II — 14 LP
🟢 +39 LP
Nombre de games : 4 parties  |  Bilan : 3 V — 1 D  |  Winrate : 75 %
```

La barre latérale de l'encart prend la **couleur du tier** (bleu diamant, vert
émeraude, or…), et le signe du delta est porté par la pastille 🟢 / 🔴 / ⚪.

> Discord ne sait colorer du texte que dans un bloc de code `ansi`, ce qui
> encadre la ligne d'un cadre gris. `LP_STYLE=ansi` active ce rendu si tu
> préfères la couleur réelle au texte propre.

## Installation

Node.js **24 ou plus récent** est requis : SQLite est utilisé via `node:sqlite`,
sans module natif ni dépendance npm supplémentaire.

```bash
npm install
```

Copie `.env.example` vers `.env` et remplis :

| Variable | Où la trouver |
|---|---|
| `DISCORD_TOKEN` | [Developer Portal](https://discord.com/developers/applications) → ton app → **Bot** → *Reset Token* |
| `DISCORD_CHANNEL_ID` | Discord → Paramètres → Avancés → **Mode développeur**, puis clic droit sur le salon → *Copier l'identifiant* |
| `DISCORD_GUILD_ID` | Optionnel. Clic droit sur l'icône du serveur → *Copier l'identifiant*. Rend `/resume` disponible immédiatement au lieu d'attendre ~1 h |
| `RIOT_API_KEY` | [developer.riotgames.com](https://developer.riotgames.com) |

### Réglages de rendu

| Variable | Valeurs | Effet |
|---|---|---|
| `LP_STYLE` | `clean` (défaut) / `ansi` | Pastille 🟢🔴 ou texte réellement coloré dans un bloc de code |
| `EMBLEM_STYLE` | `none` (défaut) / `thumbnail` / `image` | Emblème de rang : absent, en vignette, ou en pleine largeur |

> **Attention aux guillemets** : `PLAYERS="Pseudo#TAG,Autre#TAG"`. Sans eux,
> `dotenv` coupe la valeur au premier `#` et le bot ne voit qu'un pseudo tronqué.

Invitation du bot : scopes `bot` et `applications.commands`, permissions
`View Channel`, `Send Messages`, `Embed Links` et `Use External Emojis`
(soit `permissions=281600` dans l'URL d'invitation).

> Être invité sur le serveur ne suffit pas si le salon porte une **exception de
> permission** : un refus de « Voir le salon » sur `@everyone` s'applique au bot
> tant qu'aucune règle du salon n'autorise explicitement un de ses rôles.
> Ça se règle dans *Modifier le salon → Permissions*, pas dans les rôles du serveur.

### Emojis de rang

Si le serveur porte des emojis nommés `Iron`, `Bronze`, `Silver`, `Gold`,
`Platinum`, `Emerald`, `Diamond`, `Master`, `Grandmaster`, `Challenger`, le bot
les affiche automatiquement à gauche du rang. La correspondance est insensible à
la casse et accepte aussi les noms français (`fer`, `argent`, `or`, `platine`,
`emeraude`, `diamant`, `maitre`). Placés dans un titre `##`, Discord les agrandit.

Aucun emoji correspondant : le rang s'affiche en texte seul, sans erreur. La
table est relue à chaque envoi, donc ajouter un emoji ne demande pas de
redémarrage.

## Utilisation

```bash
npm run dry      # affiche le résumé en console, sans Discord ni écriture (test)
npm run preview  # poste un résumé fabriqué (gain, perte, apex, non classé, erreur)
npm run now      # poste le résumé immédiatement puis quitte
npm start        # démarre le bot : commande /resume + résumé quotidien planifié
```

`npm run preview` sert à juger le rendu sans attendre que les LP bougent :
il n'appelle pas l'API Riot et n'écrit pas dans `data/snapshots.json`. Les cas
testés se modifient dans `scripts/preview.js`.

### Commandes Discord

| Commande | Effet |
|---|---|
| `/resume [date:<JJ-MM-AAAA>]` | Le résumé actuel, ou celui d'une journée archivée pour tous les joueurs suivis |
| `/joueur nom:<joueur> [date:<JJ-MM-AAAA>]` | Le résumé d'un joueur et uniquement ses parties de la journée demandée |

Aucune des deux ne déplace le point de comparaison : le résumé du soir montrera
toujours la journée complète.

`/joueur` utilise l'**autocomplétion** et non une liste fermée : les joueurs de
`PLAYERS` sont suggérés, mais n'importe quel Riot ID `Pseudo#TAG` peut être saisi
librement. Consulter un joueur non suivi ne l'ajoute **pas** à la liste et
n'écrit rien dans `data/snapshots.json` — c'est une lecture pure. Discord
n'autorise pas `choices` et saisie libre sur une même option, d'où
l'autocomplétion.

L'option `date` est facultative et propose par autocomplétion les journées
réellement présentes dans SQLite. Sans date, `/joueur` consulte aujourd'hui en
temps réel et `/resume` conserve sa comparaison habituelle. Avec une date, les
deux commandes utilisent uniquement les parties archivées entre minuit et
minuit dans `TIMEZONE`. Les récaps sont strictement filtrés sur la file classée
configurée — `RANKED_SOLO_5x5` par défaut et dans la configuration actuelle —
donc les parties Flex ne sont jamais mélangées aux Solo/Duo.

Chaque partie du jour est rendue
`icône du champion — nom — K/D/A (ratio) — CS (CS/min) — issue`, avec une 🔥 sur
les victoires à partir de 3 d'affilée.

Les champs de l'encart décrivent **la journée**, cohérents avec la liste juste
en dessous. Le delta de LP, lui, porte sur la fenêtre depuis le dernier résumé
publié — il l'indique explicitement (« sur 1 game mesurée »), les deux périodes
étant différentes.

## Surveillance des parties

Toutes les `LIVE_INTERVAL_MIN` minutes (3 par défaut), le bot relit l'historique
de chaque joueur suivi et annonce les parties terminées depuis le passage
précédent : champion, K/D/A, farm, durée, et la variation de LP.

| Variable | Effet |
|---|---|
| `LIVE_CHECK` | `false` désactive la surveillance |
| `LIVE_INTERVAL_MIN` | Période, en minutes |
| `LIVE_CHANNEL_ID` | Salon des annonces ; vide = celui du résumé |

Coût courant : un appel Match-V5 par joueur et par passage — 5 joueurs toutes
les 3 min représentent 100 appels/heure, contre 3000 autorisés. Quand une partie
est détectée, son détail et le rang sont aussi lus afin de l'annoncer et de
l'archiver.

L'état vit dans `store.live`, **strictement séparé** de `store.players` qui porte
le point de comparaison du résumé quotidien : la surveillance ne décale jamais
le delta que le résumé du soir doit encore afficher. Les deux boucles écrivant
le même fichier, `updateStore()` sérialise les cycles lecture-modification-écriture.

Au premier passage, le bot mémorise la position sans rien annoncer — sinon il
déverserait un historique déjà ancien. Au-delà de 3 parties d'un coup (retour
après une longue coupure), seules les 3 plus récentes sont annoncées, mais toutes
les parties détectées dans la fenêtre de 6 heures sont archivées. La série de
victoires est cumulée dans l'état persisté, donc elle traverse les jours et les
redémarrages.

### Historique SQLite

`data/snapshots.json` reste l'état courant lisible et le point de comparaison du
résumé. En parallèle, `data/history.sqlite` conserve une ligne par joueur et par
partie : champion, K/D/A, CS, durée, résultat, horodatage, rang relevé et
variation de LP lorsqu'elle a pu être mesurée.

La clé `(joueur, match)` empêche les doublons après un redémarrage. La base est
écrite avant que le curseur JSON avance : une coupure entre les deux écritures
rejoue sans perdre la partie. Au premier démarrage, les anciennes variations
`recentLp` encore présentes dans le JSON sont importées une seule fois ; leurs
statistiques de partie restent inconnues, puisque le JSON ne les conservait pas.

`/joueur` relit désormais les variations depuis SQLite, sans plafond de 30
parties stockées. Un delta observé sur un lot de plusieurs parties est conservé
avec la taille du lot, mais n'est pas attribué artificiellement à une partie.
Les parties antérieures à la mise en place de la surveillance ne peuvent pas
être reconstituées a posteriori par Riot.

Pour sauvegarder l'historique, arrête le bot puis copie `data/history.sqlite` en
même temps que `data/snapshots.json`.

### Icônes de champion

Elles utilisent les **emojis d'application** Discord : 2000 emplacements,
utilisables sur tous les serveurs du bot sans consommer les emplacements du
serveur — indispensable pour 233 champions, là où un serveur non boosté n'en
offre que 50. Chaque champion est téléversé au premier affichage (~0,5 s) puis
réutilisé. Un échec (quota, image refusée) est mis en cache pour ne pas
réessayer à chaque fois, et la ligne s'affiche simplement sans icône.

## Lancement au démarrage de Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
```

Enregistre une tâche planifiée `BotElo` déclenchée à l'ouverture de session
(+45 s pour laisser le réseau s'établir). Les logs vont dans `logs\bot.log`.

### Icône dans la zone de notification

Par défaut, la tâche lance `scripts/tray.ps1` : cet hôte masque sa propre
console, démarre Node en processus enfant **sans aucune fenêtre** (rien dans la
barre des tâches) et place une icône dans la barre système, sous la flèche
« Afficher les icônes cachées ». Clic droit dessus :

| Entrée | Effet |
|---|---|
| *État* | En cours (PID) ou arrêté |
| *Ouvrir le journal* | Ouvre `logs\bot.log` (aussi en double-clic sur l'icône) |
| *Poster le résumé maintenant* | Lance une instance `--now` séparée, sans toucher au bot principal |
| *Redémarrer le bot* | Relance le processus Node |
| *Quitter* | Arrête le bot et retire l'icône |

L'hôte surveille le processus toutes les 5 s et le relance s'il s'arrête seul.
L'icône vient de `assets/icon.png`, redimensionnée à la taille exacte de la
barre système (elle suit la mise à l'échelle DPI) ; remplace ce fichier pour en
changer. Sans lui, l'icône de Node est utilisée.

> Le mode **S4U** — qui supprime totalement la fenêtre — est incompatible avec
> une icône de notification : il s'exécute en session 0, qui n'a pas
> d'interface graphique. Utilise `-NoTray` à l'installation si tu préfères
> l'absence totale de fenêtre à l'icône :
>
> ```powershell
> powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -NoTray
> ```

```powershell
Get-Content "logs\bot.log" -Wait        # suivre les logs
Stop-ScheduledTask  -TaskName BotElo    # arrêter
Start-ScheduledTask -TaskName BotElo    # relancer
powershell -ExecutionPolicy Bypass -File scripts\uninstall-autostart.ps1
```

Le journal porte un BOM UTF-8, donc `Get-Content` l'affiche correctement sans
avoir à préciser `-Encoding`. Il tourne automatiquement à 2 Mo (`bot.log.1`).

Si le PC était éteint à l'heure du résumé, `CATCH_UP=true` le poste au
démarrage suivant : aucune journée n'est perdue.

> Relance `install-autostart.ps1` si tu déplaces le dossier du projet : la tâche
> enregistre des chemins absolus.

## Fonctionnement

| Fichier | Rôle |
|---|---|
| `src/riot.js` | Client API Riot : rate limiting, retries, gestion des 429 |
| `src/ratelimit.js` | Limiteur à fenêtres glissantes multiples |
| `src/rank.js` | Conversion rang → position absolue sur l'échelle classée |
| `src/report.js` | Collecte et comparaison avec le relevé précédent |
| `src/embeds.js` | Rendu Discord (encarts + couleurs) et rendu console |
| `src/emojis.js` | Association tier → emoji custom du serveur |
| `src/champemojis.js` | Emojis d'application pour les icônes de champion |
| `src/champions.js` | Catalogue des champions (noms localisés, icônes) |
| `src/links.js` | Construction des liens op.gg |
| `src/logger.js` | Journal `logs/bot.log` (avec BOM UTF-8 et rotation) |
| `src/store.js` | Persistance atomique dans `data/snapshots.json` |
| `src/history.js` | Archive SQLite des parties et migration du JSON historique |
| `src/time.js` | Dates et planification sensibles au fuseau horaire |

### Différence de LP à travers les promotions

Une soustraction naïve des LP est fausse dès qu'un joueur change de division :
Diamant III 93 LP → Diamant II 14 LP donnerait −79 alors que c'est un gain de
**+39**. Chaque rang est donc converti en position absolue sur l'échelle
(`tier × 400 + division × 100 + LP`, Maître/GM/Challenger partageant une échelle
continue), et c'est cette position qui est comparée.

### Point de comparaison

`data/snapshots.json` n'est mis à jour **qu'après une publication réussie**
(`commitReport`). Enregistrer avant l'envoi ferait disparaître du diff toute la
progression accumulée dès qu'un envoi échoue — salon inaccessible, coupure
réseau — sans qu'aucun message ne l'ait jamais montrée. `/resume` ne commite
jamais : c'est un aperçu, le résumé du soir doit garder son delta complet.

### Comptage des parties

Source principale : le delta des compteurs `wins`/`losses` de l'entrée classée
— exact et sans appel API supplémentaire. Si les compteurs reculent (reset de
split) ou s'il n'y a pas encore de relevé, le bot bascule sur l'historique
Match-V5, en ignorant les *remakes*.

### Rate limiting

`RIOT_RATE_LIMITS="20:1,100:120"` reprend le format affiché sur le portail Riot
et applique les deux limites **simultanément** (fenêtres glissantes), avec une
marge `RIOT_RATE_SAFETY=0.9`. Sur un 429, le `Retry-After` renvoyé par Riot
bloque toute la file, pas seulement la requête fautive.

Un cycle nominal coûte **2 appels** (un par joueur) : le PUUID est mis en cache
et le comptage des parties est déduit des compteurs déjà récupérés.

## Dépannage

| Symptôme | Cause |
|---|---|
| `Cle Riot refusee (401/403)` | Clé Development expirée (24 h) → régénère-la et mets `RIOT_API_KEY` à jour |
| `PLAYERS: "..." n'est pas au format Pseudo#TAG` | Guillemets manquants autour de `PLAYERS` dans `.env` |
| `/resume` absente | Sans `DISCORD_GUILD_ID`, compter jusqu'à 1 h de propagation |
| `Permissions insuffisantes sur #salon` | Exception de permission **sur le salon** : ajoute un rôle du bot dans *Modifier le salon → Permissions* et autorise « Voir le salon » |
| Le rang s'affiche sans icône | Aucun emoji du serveur ne porte le nom du tier (voir *Emojis de rang*) |
| Le nom ou l'avatar du bot ne change pas | Modifié dans *General Information* (l'application) au lieu de l'onglet **Bot** (l'utilisateur, celui qui s'affiche en chat) |
