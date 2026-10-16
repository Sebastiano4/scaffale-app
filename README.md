# BookNest — la tua libreria PDF

App web installabile (PWA) per leggere i tuoi PDF da tablet o telefono.
I libri restano salvati **solo sul dispositivo** (nel browser), quindi funziona anche offline una volta installata.

## Cosa contiene la cartella
- `index.html`, `styles.css`, `app.js` — l'app
- `js/`, `css/` — i moduli dell'app (libreria, lettore, backup, ricerca…)
- `manifest.json`, `sw.js` — la rendono installabile e offline
- `tests/`, `package.json`, `playwright.config.mjs` — test automatici (servono solo a chi sviluppa)
- `vendor/` — la libreria pdf.js inclusa localmente (funziona offline fin dal primo avvio)
- `icons/` — icona dell'app

## Perché serve "pubblicarla" da qualche parte
Per motivi di sicurezza del browser, una PWA non si installa correttamente aprendo il file `index.html` direttamente (doppio click). Va servita da un vero indirizzo web (anche gratuito). Il metodo più semplice, senza bisogno di sapere programmare, è **GitHub Pages**.

## Pubblicarla gratis con GitHub Pages (10 minuti)
1. Crea un account su [github.com](https://github.com) se non lo hai già.
2. Crea un nuovo repository (pulsante verde "New"), dagli un nome tipo `booknest-app`, lascialo pubblico.
3. Nella pagina del repository, clicca "Add file" → "Upload files" e trascina dentro **tutti i file di questa cartella** (index.html, styles.css, app.js, manifest.json, sw.js, e le cartelle js, css, icons e vendor con il loro contenuto). Poi "Commit changes".
3b. **Importante**: crea anche un file vuoto chiamato `.nojekyll` ("Add file" → "Create new file", scrivi `.nojekyll` come nome, lascia vuoto e committa). Senza questo file GitHub Pages ignora la cartella `vendor` e l'app resta bianca.
4. Vai su **Settings → Pages** (menu a sinistra).
5. In "Source" scegli il branch `main` e cartella `/ (root)`, salva.
6. Dopo un minuto GitHub ti mostrerà un indirizzo tipo `https://tuonome.github.io/booknest-app/`. Quello è il link della tua app.

*In alternativa: [Netlify Drop](https://app.netlify.com/drop) — trascini la cartella e ottieni subito un link, ancora più veloce, senza nemmeno bisogno di account per una prova rapida.*

## Installarla sul telefono/tablet
- **Android (Chrome)**: apri il link, poi menu ⋮ in alto a destra → "Aggiungi a schermata Home" (o comparirà un banner automatico "Installa app").
- **iPhone/iPad (Safari)**: apri il link, tocca l'icona di condivisione (il quadrato con la freccia) → "Aggiungi a Home".

Dopo l'installazione l'app si apre a schermo intero con la sua icona, come un'app normale.

## Come si usa
- Tocca il **+** per aggiungere i tuoi PDF (puoi selezionarne più di uno insieme). Titolo e autore vengono riconosciuti automaticamente dai metadati del file o dal nome del file.
- Se aggiungi un PDF che è già nella libreria, l'app lo riconosce e **non lo duplica**.
- Tocca la copertina per **leggere**, tocca titolo/autore per **modificare i dati** e dare un **voto** da ½ a 5 stelle (metà sinistra di una stella = mezzo voto).
- Per **eliminare** un libro: tocca il pulsante **⋮** sulla copertina → **Delete** (oppure "Delete book" nella scheda del libro). Per qualche secondo compare **Undo** per annullare se hai sbagliato.
- Per eliminarne **più di uno**: tocca l'icona di selezione nella barra della libreria, scegli i libri e premi **Delete** (anche qui puoi annullare).
- Nel lettore: icona lente per **cercare nel testo** (compare l'elenco di tutti i risultati con la frase intorno: toccane uno per andarci), icona segnalibro per segnare la pagina, icona righe per la lista di **segnalibri e citazioni**, icona pagine per passare tra scorrimento continuo e pagina singola.
- Il pulsante **▶** nel lettore **legge ad alta voce** (audiolibro) frase per frase, con pause naturali tra frasi e paragrafi, ed evidenzia la frase che sta leggendo; toccalo di nuovo per fermarlo. Il pulsante accanto (cursori) apre le impostazioni: **voce**, **velocità** e **tono**. Su Android le voci più naturali si installano da Impostazioni › Output sintesi vocale › Google.
- **Selezionare il testo** col dito: **tieni premuta** una parola e, senza staccare, **trascina** il dito fino all'ultima parola che vuoi; avvicinandoti al bordo in basso (o in alto) la pagina **scorre da sola**, così puoi continuare sulla pagina dopo. In alternativa, dopo aver selezionato una parola **tocca** un'altra parola per allungare la selezione fin lì (basta toccarle vicino). **Doppio tocco** su una parola seleziona la **frase intera**; un tocco lontano dal testo annulla. Col mouse si trascina come sempre.
- Con il testo selezionato puoi salvarlo come **citazione** (resta **evidenziato** nel libro), **copiarlo**, **tradurlo** (apre Google Traduttore) o **ascoltarlo**.
- **Dizionario**: seleziona una parola (o un'espressione fino a 3 parole) e tocca **📖 Dictionary**. La parola viene salvata con la frase e la pagina in cui l'hai trovata, e compare subito il **significato** preso da Wiktionary (italiano per i libri in italiano, inglese per gli altri). Per le forme coniugate o i plurali risale alla parola base (es. *andavano → andare*). Se sei offline la parola resta salvata e il significato arriva da solo appena torni online. Puoi sempre **modificare** il significato a mano.
- Tutte le parole stanno nella pagina **Dictionary** della barra laterale (o nel menu ⋮ sul telefono): ricerca, filtro per libro, **export** in Markdown, e toccando "Libro · p. N" si apre il libro su quella pagina. Nel lettore, la scheda **Words** del pannello mostra le parole del libro aperto. Eliminando un libro si eliminano anche le sue parole.
- **Modalità immersiva**: il pulsante ⛶ nel lettore mostra solo le pagine a schermo intero. Per uscire scorri **da sinistra verso destra** oppure usa il gesto/tasto **indietro** di Android.
- Il pulsante rotondo in basso a destra nel lettore (mezzaluna) alterna i filtri **normale / seppia / notte**; sotto ci sono i controlli **zoom**.
- Tocca la **barra di avanzamento** sotto il titolo per saltare a qualsiasi punto del libro; in modalità pagina singola puoi anche toccare i **bordi** dello schermo per voltare pagina.
- Il nastrino colorato sopra ogni copertina mostra quanto hai letto del libro; il badge indica **Letto** o la percentuale.
- I libri finiti stanno nello scaffale **"Read"** sotto gli altri, con la data in cui li hai finiti (toccando l'intestazione lo apri o chiudi). Dal **⋮** sulla copertina puoi **segnare un libro come letto** o di nuovo **da leggere**.
- Nella libreria: chip **Da leggere / In lettura / Letti** per filtrare, menù a tendina per **ordinare**, e il menu ⋮ in alto a destra per **backup/ripristino** della libreria e **statistiche di lettura** (pagine, tempo, giorni di fila).
- **Sincronizzazione PC ↔ tablet (Google Drive)**: nella barra laterale tocca **Connect Google Drive** e scegli il tuo account (su ogni dispositivo, la prima volta). Da lì libri (PDF compresi), pagina a cui sei arrivato, voti, citazioni, segnalibri, dizionario e statistiche passano da un dispositivo all'altro da soli: all'apertura dell'app, qualche secondo dopo ogni modifica e quando chiudi un libro. I dati stanno in una cartella privata dell'app sul tuo Drive (non la vedi tra i file e l'app non vede il resto del Drive). Google concede l'accesso per circa un'ora: se riapri l'app più tardi il pulsante dice **Tap to sync**, basta un tocco. I libri arrivati dall'altro dispositivo mostrano una nuvoletta finché il PDF non è scaricato. Per scollegare: ⚙ › **Disconnect Google Drive** (i libri restano sul dispositivo).
- Il **backup** è un file `.zip` con tutti i libri e i dati (puoi ancora importare i vecchi backup `.json`). Massimo 4 GB per backup.
- Nello stesso menu vedi lo **spazio occupato** e se la libreria è **protetta**: l'app chiede al browser di non cancellare i tuoi libri quando lo spazio scarseggia. Fai comunque un backup ogni tanto, soprattutto su iPhone/iPad.
- Lo stato di un libro si aggiorna da solo mentre leggi, ma puoi cambiarlo a mano toccando titolo/autore.

## Sviluppo
Servono [Node.js](https://nodejs.org) 20 o più recente. Nella cartella:
- `npm install` — installa gli strumenti di test (solo la prima volta)
- `npm test` — esegue i test unitari e i test nel browser (Playwright)

Quando modifichi i file dell'app, aumenta il numero in `CACHE_NAME` dentro `sw.js` e aggiungi ad `APP_SHELL` gli eventuali nuovi file, così chi ha l'app installata riceve l'aggiornamento.

## Nota
Il PDF viene aperto tramite la libreria open-source [pdf.js](https://mozilla.github.io/pdf.js/) di Mozilla, inclusa direttamente nella cartella `vendor/`: non serve alcuna connessione, nemmeno al primo avvio.
