# Scaffale — la tua libreria PDF

App web installabile (PWA) per leggere i tuoi PDF da tablet o telefono.
I libri restano salvati **solo sul dispositivo** (nel browser), quindi funziona anche offline una volta installata.

## Cosa contiene la cartella
- `index.html`, `styles.css`, `app.js` — l'app
- `manifest.json`, `sw.js` — la rendono installabile e offline
- `vendor/` — la libreria pdf.js inclusa localmente (funziona offline fin dal primo avvio)
- `icons/` — icona dell'app

## Perché serve "pubblicarla" da qualche parte
Per motivi di sicurezza del browser, una PWA non si installa correttamente aprendo il file `index.html` direttamente (doppio click). Va servita da un vero indirizzo web (anche gratuito). Il metodo più semplice, senza bisogno di sapere programmare, è **GitHub Pages**.

## Pubblicarla gratis con GitHub Pages (10 minuti)
1. Crea un account su [github.com](https://github.com) se non lo hai già.
2. Crea un nuovo repository (pulsante verde "New"), dagli un nome tipo `scaffale-app`, lascialo pubblico.
3. Nella pagina del repository, clicca "Add file" → "Upload files" e trascina dentro **tutti i file di questa cartella** (index.html, styles.css, app.js, manifest.json, sw.js, e le cartelle icons e vendor con il loro contenuto). Poi "Commit changes".
4. Vai su **Settings → Pages** (menu a sinistra).
5. In "Source" scegli il branch `main` e cartella `/ (root)`, salva.
6. Dopo un minuto GitHub ti mostrerà un indirizzo tipo `https://tuonome.github.io/scaffale-app/`. Quello è il link della tua app.

*In alternativa: [Netlify Drop](https://app.netlify.com/drop) — trascini la cartella e ottieni subito un link, ancora più veloce, senza nemmeno bisogno di account per una prova rapida.*

## Installarla sul telefono/tablet
- **Android (Chrome)**: apri il link, poi menu ⋮ in alto a destra → "Aggiungi a schermata Home" (o comparirà un banner automatico "Installa app").
- **iPhone/iPad (Safari)**: apri il link, tocca l'icona di condivisione (il quadrato con la freccia) → "Aggiungi a Home".

Dopo l'installazione l'app si apre a schermo intero con la sua icona, come un'app normale.

## Come si usa
- Tocca il **+** per aggiungere i tuoi PDF (puoi selezionarne più di uno insieme). Titolo e autore vengono riconosciuti automaticamente dai metadati del file o dal nome del file.
- Tocca la copertina per **leggere**, tocca titolo/autore per **modificare i dati o eliminare** il libro.
- Nel lettore: icona lente per **cercare nel testo**, icona segnalibro per segnare la pagina, icona righe per la lista di **segnalibri e citazioni**, icona pagine per passare tra scorrimento continuo e pagina singola.
- Seleziona del testo mentre leggi per salvarlo come **citazione**.
- Il nastrino colorato sopra ogni copertina mostra quanto hai letto del libro.

## Nota
Il PDF viene aperto tramite la libreria open-source [pdf.js](https://mozilla.github.io/pdf.js/) di Mozilla, inclusa direttamente nella cartella `vendor/`: non serve alcuna connessione, nemmeno al primo avvio.
