# LocLM

A LocLM egy local-first, Electron + React + Vite alapú AI-kezelő alkalmazás. Projektekbe szervezett chateket, helyben futó OpenAI-kompatibilis modelleket, képernyőkivágást, dokumentumfeldolgozást, webes keresést és Gmail-integrációt kínál.

## Fő funkciók

- Létrehozható, átnevezhető és törölhető projektek, külön chatelőzményekkel.
- Kereshető projektmappa képekhez és dokumentumokhoz, megnyitás és mappában megjelenítés műveletekkel.
- LM Studio és más OpenAI-kompatibilis helyi végpontok.
- Streaming modellválasz és generálás megszakítása.
- Összecsukható, élő gondolkodási munkafolyamat; a reasoning-modellek által publikált `reasoning_content` és `<think>` blokkok külön megjelenítése.
- Globális, átállítható képernyőkivágás (`Ctrl+Shift+S`).
- PNG/JPEG/WebP képek és screenshotok továbbítása vision modelleknek.
- PDF, Word, szöveg, Markdown, JSON és CSV beolvasása.
- AI-válasz exportálása Word vagy PDF formátumba.
- API-kulcs nélküli, rejtett Chromium-alapú webes keresés DuckDuckGo/Bing tartalékkal; opcionális Brave Search vagy saját SearXNG.
- Gmail OAuth, keresés, teljes levélszálak, címkék, archiválás és piszkozatok.
- GitHub Releases-alapú automatikus frissítés.
- Világos, sötét és rendszerhez igazodó téma.
- Angol alapértelmezett felület, a Beállításokban választható magyar nyelvvel.
- Egyedi, villámos LocLM arculat és natív hatású, saját Electron címsor.

## Fejlesztői indítás

Követelmények:

- Node.js 24+
- pnpm 11+
- Windows, macOS vagy Linux asztali környezet

```bash
pnpm install
pnpm dev
```

Production build és Electron csomag:

```bash
pnpm build
pnpm dist
```

Automatizált Electron smoke teszt:

```bash
pnpm test:smoke
```

## LM Studio beállítása

1. Indíts el egy modellt az LM Studio Local Server nézetében.
2. A LocLM Beállítások → Helyi AI oldalán add meg a végpontot, például `http://127.0.0.1:1234/v1`.
3. Nyomd meg a Kapcsolat tesztelése gombot.
4. Válaszd ki a listázott modellt.
5. Képfeldolgozáshoz vision-képes modellt használj.

## Gmail OAuth

A Gmail csatlakoztatásához Google Cloud Desktop OAuth kliens szükséges:

1. Hozz létre egy projektet a Google Cloud Console-ban.
2. Engedélyezd a Gmail API-t.
3. Állítsd be az OAuth consent screent.
4. Hozz létre Desktop app típusú OAuth kliensazonosítót.
5. Másold a kliensazonosítót a LocLM Beállítások → Pluginok → Gmail mezőjébe.

A LocLM rendszerböngészőben végzi a belépést, PKCE-t és ideiglenes localhost callbacket használ. A tokenek az Electron `safeStorage` segítségével kerülnek titkosításra. A Google a Gmail scope-ok nyilvános terjesztéséhez OAuth-ellenőrzést kérhet.

## Webes keresés

- Beépített böngésző: ez az alapértelmezett, API-kulcs nélkül működik. A LocLM egy elkülönített, rejtett Electron/Chromium ablakban keres a DuckDuckGo oldalán, szükség esetén Bing tartalékkal, majd csak a megtisztított címeket, URL-eket és kivonatokat adja át a modellnek.
- Brave Search: add meg a Brave Search API-kulcsot a Pluginok alatt.
- SearXNG: válaszd a SearXNG szolgáltatót, majd add meg a saját példány URL-jét.

A beépített böngésző azonnal használható. A beállításokban bármelyik szolgáltatóval futtatható tesztkeresés; sikeres válasznál a LocLM megjeleníti a találatok számát, hibánál pedig közvetlenül kiírja a problémát.

A Web gomb bekapcsolásakor a következő üzenet webes találatai bekerülnek a modell kontextusába, a forrás URL-ekkel együtt.
Az asszisztens válasza mellett egy külön Források panelen minden találat címe, domainje és kivonata megnyitható; ezek a chatelőzménnyel együtt elmentődnek.

## Automatikus frissítés

Az `electron-updater` a GitHub Releases kiadásait használja. A `.github/workflows/release.yml` egy `v*` tag pushakor Windows, macOS és Linux csomagokat épít és publikál.

```bash
pnpm version patch
git push --follow-tags
```

Éles automatikus frissítéshez a Windows- és macOS-csomagokat kódaláírással kell kiadni. A szükséges tanúsítványokat GitHub Actions secretként add meg (`CSC_LINK`, `CSC_KEY_PASSWORD`, valamint az Apple notarizációs változók).

## Biztonsági modell

- A renderer nem kap Node.js-hozzáférést.
- A `contextIsolation` és az Electron sandbox be van kapcsolva.
- A preload csak típusos, engedélyezett IPC műveleteket tesz elérhetővé.
- A helyi modell- és keresőkulcsok, valamint a Gmail tokenek titkosított tárolóba kerülnek.
- Gmail küldéshez külön felhasználói művelet szükséges.
- Külső linkként csak HTTP(S) URL nyitható meg.

## Projektstruktúra

```text
src/main/       Electron main process és szolgáltatások
src/preload/    Típusos, izolált IPC bridge
src/renderer/   React felület
src/shared/     Megosztott TypeScript típusok
scripts/        Automatizált smoke teszt
```
