// ================================================================
//  server.js — Serveur de réception pour MKR_NB1500_v7_push.ino
//  À déployer sur votre instance Oracle Cloud (Always Free)
// ================================================================
//
//  Endpoints attendus par le firmware (voir .ino, section CONFIG) :
//    POST /api/telemetry   <- mesures JSON envoyées toutes les 4s
//    GET  /api/command     -> renvoie la commande en attente (texte brut)
//    POST /api/sdexport    <- export CSV de la carte SD (Mega)
//
//  Endpoints pour le dashboard web (navigateur) :
//    GET  /                 dashboard HTML
//    GET  /api/latest       dernière trame + historique (JSON, pour le graphe)
//    POST /api/queue        pose une commande dans la file (START/STOP/RESET/EXPORT/RECONNECT)
//    GET  /files            liste des CSV exportés
//    GET  /files/:name      téléchargement d'un CSV exporté
//
//  Protection optionnelle : si la variable d'env API_KEY est définie,
//  les 3 routes device (telemetry/command/sdexport) exigent l'en-tête
//  "X-API-Key" avec la même valeur que #define API_KEY côté MKR.
// ================================================================

const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';   // laisser vide = pas d'auth (comme côté .ino par défaut)
const EXPORT_DIR = path.join(__dirname, 'exports');
const HISTORY_MAX = 300; // ~20 min d'historique à 4s/trame

if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '512kb' }));
// Les exports SD arrivent en text/csv : on les lit en texte brut, pas en JSON
app.use('/api/sdexport', express.text({ type: '*/*', limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/files', express.static(EXPORT_DIR));

// ---- état en mémoire ----
let latest = null;
let history = [];
let commandQueue = []; // FIFO simple : une commande à la fois consommée par le MKR

function checkApiKey(req, res, next) {
    if (!API_KEY) return next(); // pas de clé configurée -> pas de contrôle
    if (req.get('X-API-Key') === API_KEY) return next();
    return res.status(401).send('unauthorized');
}

// ---- routes DEVICE (appelées par le MKR) ----

app.post('/api/telemetry', checkApiKey, (req, res) => {
    const t = req.body;
    t.receivedAt = new Date().toISOString();
    latest = t;
    history.push(t);
    if (history.length > HISTORY_MAX) history.shift();
    res.status(200).send('ok');
});

app.get('/api/command', checkApiKey, (req, res) => {
    const cmd = commandQueue.length > 0 ? commandQueue.shift() : 'NONE';
    res.type('text/plain').send(cmd);
});

app.post('/api/sdexport', checkApiKey, (req, res) => {
    const csv = req.body || '';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `export_${stamp}.csv`;
    fs.writeFile(path.join(EXPORT_DIR, filename), csv, (err) => {
        if (err) {
            console.error('Erreur écriture export SD:', err);
            return res.status(500).send('erreur');
        }
        console.log('Export SD reçu :', filename, `(${csv.length} octets)`);
        res.status(200).send('ok');
    });
});

// ---- routes DASHBOARD (appelées par le navigateur) ----

app.get('/api/latest', (req, res) => {
    res.json({ latest, history });
});

app.post('/api/queue', express.json(), (req, res) => {
    const cmd = (req.body && req.body.cmd || '').toUpperCase();
    const valides = ['START', 'STOP', 'RESET', 'EXPORT', 'RECONNECT'];
    if (!valides.includes(cmd)) return res.status(400).send('commande invalide');
    commandQueue.push(cmd);
    console.log('Commande mise en file :', cmd);
    res.status(200).send('ok');
});

app.get('/files', (req, res) => {
    fs.readdir(EXPORT_DIR, (err, files) => {
        if (err) return res.status(500).json([]);
        const list = files
            .filter(f => f.endsWith('.csv'))
            .sort()
            .reverse()
            .map(f => ({ name: f, url: `/files/${f}` }));
        res.json(list);
    });
});

app.listen(PORT, () => {
    console.log(`Serveur MKR en écoute sur le port ${PORT}`);
    console.log(API_KEY ? 'Protection X-API-Key activée' : 'Aucune clé API configurée (ouvert)');
});
