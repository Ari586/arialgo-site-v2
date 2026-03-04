# AriAlgo Site V2 - Quick Start

Ce repository contient plusieurs projets. Le site AriAlgo principal est compose de:

- `xauusd-analyzer-v2` (frontend React/Vite)
- `xauusd-analyzer` (backend Express + API + WebSocket)

## 1. Prerequis

- Node.js 20+
- npm 10+
- (Optionnel) Redis local pour synchro chat multi-instance

## 2. Cloner le repository

```bash
git clone https://github.com/Ari586/arialgo-site-v2.git
cd arialgo-site-v2
```

## 3. Configurer les variables d'environnement

Backend:

```bash
cp xauusd-analyzer/.env.example xauusd-analyzer/.env
```

Frontend:

```bash
cp xauusd-analyzer-v2/.env.example xauusd-analyzer-v2/.env
```

Par defaut, configurez au minimum:

- `SITE_ACCESS_USER`
- `SITE_ACCESS_CODE`

## 4. Installer les dependances

```bash
cd xauusd-analyzer-v2 && npm install
cd ../xauusd-analyzer && npm install
cd ..
```

## 5. Build frontend et injection dans le backend

```bash
cd xauusd-analyzer-v2
npm run build
cd ..
rm -rf xauusd-analyzer/dist/*
cp -R xauusd-analyzer-v2/dist/* xauusd-analyzer/dist/
```

## 6. Lancer le site

```bash
cd xauusd-analyzer
npm start
```

Ouvrir:

- `http://localhost:8080`

Se connecter avec:

- login = `SITE_ACCESS_USER`
- password = `SITE_ACCESS_CODE`

## 7. Verification rapide des endpoints

```bash
cd xauusd-analyzer
npm run test:local:endpoints
```

## 8. Ce qui est optionnel (avance)

Le site fonctionne en mode standard sans ces integrations:

- Primary Exchange feeds/licences (NASDAQ/NYSE/CME/CBOE/Euronext)
- Bridge Rithmic
- MT5 executor externe
- TradingAgents bridge

Pour activer ces modules, renseigner les variables correspondantes dans `xauusd-analyzer/.env`.

## 9. Docker (backend)

Un `Dockerfile` est present dans `xauusd-analyzer`.
Construire l'image:

```bash
cd xauusd-analyzer
docker build -t arialgo-site .
docker run --rm -p 8080:8080 --env-file .env arialgo-site
```

## 10. Notes importantes

- Les secrets ne doivent jamais etre commit (`.env` est ignore).
- Le repo inclut aussi d'autres dossiers non lies au site principal.
- Si l'UI semble ancienne apres pull, refaire l'etape build + sync `dist`.

