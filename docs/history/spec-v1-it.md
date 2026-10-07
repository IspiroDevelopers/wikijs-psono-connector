<!-- SPDX-License-Identifier: AGPL-3.0-only -->
> **Historical document (Italian), kept for context.** This is the initial
> specification the project started from. It has been **superseded** by the
> decisions in [`docs/adr/`](../adr/README.md): wherever it differs — e.g. the
> backend as a separate sidecar, keys bound to the browser, server pinning — the
> ADRs and the other documentation are authoritative.

# Wiki.js Psono Connector — Specifica tecnica e guida di implementazione

> Documento di handoff per l’implementazione con Claude Code  
> Nome progetto: `wikijs-psono-connector`  
> Licenza: `AGPL-3.0-only`  
> Stato: specifica iniziale / MVP

## 1. Obiettivo

Realizzare un plugin open source per Wiki.js che trasformi automaticamente i link diretti al server Psono configurato in componenti dinamici capaci di mostrare, in base ai permessi della API key Psono del singolo utente:

- titolo o nome della credenziale;
- URL;
- username;
- password;
- OTP/TOTP;
- note.

Il plugin deve:

- modificare il meno possibile Wiki.js;
- evitare patch permanenti ai file core, per resistere ai normali aggiornamenti;
- essere attivabile o disattivabile globalmente da un amministratore;
- consentire all’amministratore di configurare l’endpoint Psono;
- consentire a ogni utente Wiki.js di salvare la propria API key Psono read-only;
- delegare a Psono l’autorizzazione sui secret;
- caricare i secret in modo lazy e asincrono;
- non rallentare il caricamento iniziale della pagina;
- aggiornare l’OTP senza ricaricare la pagina;
- non inserire mai i valori dei secret nell’HTML statico, nel Markdown salvato, negli indici di ricerca o nelle cache di rendering;
- mostrare un avviso comprensibile quando l’utente non ha configurato Psono o non ha accesso alla credenziale.

## 2. Principio architetturale

Il progetto non deve introdurre un middleware o servizio esterno separato.

L’integrazione deve essere installata come estensione di Wiki.js e deve contenere:

1. un modulo di rendering minimale;
2. una piccola estensione backend interna a Wiki.js;
3. un bundle frontend indipendente;
4. tabelle proprie per configurazione e credenziali utente;
5. uno script di installazione, verifica e aggiornamento.

Flusso generale:

```text
Pagina Wiki.js
    |
    | rendering del link Psono come placeholder
    v
Placeholder HTML privo di secret
    |
    | caricamento completato / elemento visibile
    v
Bundle frontend del connettore
    |
    | richiesta autenticata con la sessione Wiki.js
    v
Route interna del plugin
    |
    | recupera e decifra la API key dell'utente
    | interroga direttamente il server Psono configurato
    v
API Psono
    |
    | secret consentito oppure accesso negato
    v
Componente dinamico nella pagina
```

La componente backend interna non è un middleware esterno: è parte del plugin e viene eseguita nello stesso ambiente applicativo di Wiki.js.

## 3. Licenza

Il repository deve essere pubblicato con:

```text
AGPL-3.0-only
```

Aggiungere:

- file `LICENSE` contenente il testo completo della GNU Affero General Public License versione 3;
- identificatore SPDX nei file sorgente, dove opportuno:

```text
SPDX-License-Identifier: AGPL-3.0-only
```

Motivazione:

- Wiki.js è distribuito con licenza AGPL v3;
- il connettore è progettato specificamente per essere caricato e utilizzato all’interno di Wiki.js;
- l’AGPL riduce le ambiguità di compatibilità con il progetto host;
- eventuali modifiche al connettore usato attraverso una rete dovranno rimanere disponibili secondo i termini della licenza.

Inserire nel README un disclaimer:

```text
Wiki.js Psono Connector is an independent community project.
It is not affiliated with, sponsored by, or endorsed by Wiki.js,
Requarks.io, Psono, or esaqa GmbH.
```

## 4. Compatibilità e aggiornamenti di Wiki.js

### 4.1 Obiettivo

Evitare modifiche dirette ai file core di Wiki.js.

Il plugin deve preferire:

- file aggiuntivi separati;
- moduli di rendering supportati;
- route isolate;
- bundle JavaScript e CSS propri;
- tabelle database proprie;
- configurazione propria;
- installazione idempotente;
- punti di aggancio minimi e chiaramente documentati.

### 4.2 Vincolo realistico

Wiki.js 2.x supporta moduli e una pipeline di rendering, ma non offre necessariamente una API generale e stabile per ogni esigenza del connettore, come:

- route backend arbitrarie;
- impostazioni amministrative personalizzate;
- impostazioni per utente;
- migrazioni di plugin;
- caricamento automatico di bundle frontend.

Claude Code deve prima ispezionare la versione target di Wiki.js e identificare i punti di estensione effettivamente disponibili.

Non introdurre patch invasive come prima scelta. Qualora serva un singolo hook non disponibile pubblicamente:

- isolarlo in un adapter per versione;
- documentarlo;
- applicarlo automaticamente tramite installer;
- verificarlo tramite checksum o test;
- non modificare più punti del necessario.

### 4.3 Versioni supportate

Inserire un manifesto:

```json
{
  "name": "wikijs-psono-connector",
  "license": "AGPL-3.0-only",
  "wikijs": {
    "supportedMajor": 2,
    "minimumVersion": null,
    "testedVersions": []
  }
}
```

Le versioni esatte devono essere compilate dopo i test.

Prevedere comandi:

```bash
npx wikijs-psono-connector install /path/to/wiki
npx wikijs-psono-connector doctor /path/to/wiki
npx wikijs-psono-connector uninstall /path/to/wiki
```

Requisiti:

- `install` deve essere idempotente;
- `doctor` deve controllare compatibilità, file, tabelle e configurazione;
- `uninstall` deve rimuovere il codice del plugin senza cancellare dati, salvo opzione esplicita;
- gli aggiornamenti di Wiki.js devono poter essere seguiti dalla riesecuzione di `doctor` e `install`.

## 5. Configurazione amministrativa

Aggiungere una pagina nelle impostazioni amministrative, per esempio:

```text
Administration > Integrations > Psono Connector
```

Se non è possibile aggiungerla senza patch fragili, usare una route amministrativa autonoma protetta:

```text
/admin/psono-connector
```

### 5.1 Campi

La pagina deve contenere:

#### Plugin attivo

```text
Enable Wiki.js Psono Connector: on/off
```

Comportamento:

- se disattivato, nessun link deve essere trasformato;
- nessuna chiamata a Psono deve essere eseguita;
- i link devono restare link normali e cliccabili;
- le API interne del plugin devono rispondere con stato `disabled`.

#### Endpoint Psono

Esempio:

```text
https://psono.example.com
```

Il valore deve rappresentare il dominio/base URL riconosciuto nei link della documentazione.

Valutare se Psono richieda un path API distinto, per esempio:

```text
Public/client base URL: https://psono.example.com
API base URL:           https://psono.example.com/server
```

Per l’MVP si possono prevedere due campi separati:

- `psonoWebBaseUrl`;
- `psonoApiBaseUrl`.

Questo evita assunzioni errate sulle installazioni self-hosted.

#### Test connessione

Pulsante:

```text
Test connection
```

Il test deve:

- verificare sintassi e protocollo dell’URL;
- consentire solo `https://`, salvo opzione esplicita per ambienti di sviluppo;
- verificare che il server sia raggiungibile;
- non richiedere o mostrare API key utente;
- mostrare un messaggio diagnostico privo di dati sensibili.

#### Opzioni consigliate

- caricamento automatico quando il blocco entra nel viewport;
- alternativa “carica soltanto al clic”;
- mostra/nascondi campo note;
- mostra/nascondi campo URL;
- mostra/nascondi campo username;
- consenti visualizzazione password;
- consenti copia password;
- consenti OTP;
- timeout delle richieste;
- intervallo OTP, con default 30 secondi;
- durata massima del secret nel DOM;
- modalità diagnostica senza contenuti sensibili.

### 5.2 Tabella amministrativa

Usare una tabella separata dal core Wiki.js:

```text
psono_connector_settings
------------------------
id
enabled
psono_web_base_url
psono_api_base_url
load_mode
request_timeout_ms
otp_refresh_seconds
dom_secret_ttl_seconds
created_at
updated_at
```

Non memorizzare impostazioni del plugin nelle tabelle core, salvo esistenza di una API ufficiale e stabile per la configurazione dei moduli.

## 6. Configurazione per utente

Ogni utente Wiki.js deve poter inserire la propria API key Psono read-only.

La pagina può essere:

```text
/profile/psono
```

oppure un pannello autonomo:

```text
/psono-connector/settings
```

### 6.1 Materiale della API key

Non assumere che la API key Psono sia sempre una singola stringa bearer.

Claude Code deve verificare il formato richiesto dalla modalità Psono scelta. La configurazione potrebbe comprendere:

- API key ID;
- API key private key;
- API key secret key;
- altri parametri richiesti dal protocollo Psono.

L’interfaccia deve adattarsi al formato effettivamente richiesto.

### 6.2 Regole

- La API key deve essere read-only.
- La API key deve essere limitata ai secret che l’utente può consultare.
- Il plugin non deve ampliare i permessi concessi da Psono.
- Il plugin non deve permettere operazioni di scrittura.
- Il server Psono è stabilito globalmente dall’amministratore.
- L’utente non può indicare un endpoint Psono alternativo.

### 6.3 Archiviazione

Usare una tabella separata:

```text
psono_connector_user_credentials
--------------------------------
id
wiki_user_id
api_key_id
encrypted_private_key
encrypted_secret_key
encryption_key_version
created_at
updated_at
last_validated_at
```

Tutto il materiale segreto deve essere cifrato a livello applicativo.

La master key non deve essere salvata nel database. Deve provenire da una variabile d’ambiente, per esempio:

```text
WIKIJS_PSONO_CONNECTOR_MASTER_KEY
```

Requisiti:

- algoritmo authenticated encryption moderno;
- nonce casuale per ogni valore o record;
- gestione di una versione della chiave;
- predisposizione alla rotazione;
- nessun valore sensibile nei log;
- le API di lettura del profilo non devono restituire la chiave già salvata;
- l’interfaccia deve mostrare soltanto “API key configurata”;
- per cambiare la chiave, l’utente deve reinserirla;
- aggiungere un pulsante per cancellare la configurazione.

## 7. Riconoscimento automatico dei link Psono

### 7.1 Regola principale

Ogni link HTTP o HTTPS il cui host corrisponde esattamente all’endpoint Psono configurato dall’amministratore deve essere trasformato in un placeholder dinamico.

Esempio configurazione:

```text
Psono web base URL:
https://psonoendpoint.com
```

Link presente nella pagina:

```markdown
[Credenziale applicazione](https://psonoendpoint.com/etc)
```

oppure:

```markdown
https://psonoendpoint.com/etc
```

Output statico desiderato:

```html
<div
  class="wikijs-psono-connector"
  data-psono-reference="..."
  data-psono-original-url="https://psonoendpoint.com/etc"
  data-psono-state="idle">
  <noscript>
    <a href="https://psonoendpoint.com/etc" rel="noopener noreferrer">
      Apri in Psono
    </a>
  </noscript>
</div>
```

Il placeholder non deve contenere:

- password;
- username;
- note;
- OTP;
- seed OTP;
- API key;
- secret decifrato.

### 7.2 Matching sicuro

Non usare un semplice controllo `startsWith()` su stringa non normalizzata.

Procedura:

1. interpretare il link con un parser URL;
2. accettare solo `https:` in produzione;
3. normalizzare host e porta;
4. confrontare l’host esatto con quello configurato;
5. applicare eventuale confronto del path base;
6. rifiutare URL con credenziali incorporate;
7. rifiutare host simili o sottodomini non autorizzati.

Esempi da non considerare equivalenti:

```text
https://psonoendpoint.com.attacker.example/etc
https://evil.example/?next=https://psonoendpoint.com/etc
https://username:password@psonoendpoint.com/etc
```

Stabilire esplicitamente il comportamento per i sottodomini. Default consigliato:

```text
solo host esatto
```

### 7.3 Estrazione dell’identificativo

La forma esatta dei link Psono può variare.

Creare un adapter:

```text
parsePsonoReference(url) -> PsonoReference | null
```

Il risultato deve contenere soltanto gli identificatori necessari, per esempio:

```ts
interface PsonoReference {
  originalUrl: string
  secretId?: string
  datastoreId?: string
  shareId?: string
  referenceType: 'secret' | 'share' | 'unknown'
}
```

Non codificare la logica del path direttamente nel renderer. Isolarla in un modulo testabile.

Se un link appartiene al dominio Psono ma non è riconoscibile come secret:

- lasciarlo come link normale;
- oppure mostrare un componente con pulsante “Apri in Psono”;
- non generare errori bloccanti.

### 7.4 Link nell’editor visuale e Markdown

Supportare almeno:

- link Markdown espliciti;
- URL autolink;
- tag `<a>` prodotti dall’editor visuale;
- link già presenti nell’HTML intermedio.

La trasformazione deve essere eseguita nella fase più stabile della pipeline, preferibilmente sull’HTML finale, individuando gli anchor e sostituendo solo quelli compatibili.

Non trasformare URL presenti in:

- blocchi di codice;
- codice inline;
- esempi testuali non cliccabili;
- attributi diversi da `href`;
- contenuti amministrativi.

## 8. Rendering statico e contenuto dinamico

Il renderer deve soltanto trasformare il link in un placeholder.

Non deve:

- contattare Psono;
- leggere la API key dell’utente;
- decifrare secret;
- calcolare OTP;
- includere contenuti sensibili nell’HTML;
- influire sensibilmente sul tempo di rendering della pagina.

Questo protegge:

- cache;
- indicizzazione;
- esportazioni;
- cronologia delle pagine;
- backup;
- rendering condiviso tra utenti;
- crawler;
- anteprime;
- PDF generati dal contenuto statico.

## 9. Caricamento lazy

### 9.1 Requisito

Il caricamento della pagina non deve attendere Psono.

Il bundle frontend viene avviato dopo il caricamento del documento e osserva i placeholder.

Usare:

```text
IntersectionObserver
```

Comportamento consigliato:

1. pagina Wiki.js caricata normalmente;
2. placeholder nello stato `idle`;
3. quando il placeholder si avvicina al viewport, stato `loading`;
4. richiesta asincrona alla route interna;
5. rendering del risultato;
6. nessun reload della pagina.

Configurare un `rootMargin`, per esempio:

```text
200px
```

così il secret può essere pronto poco prima che il componente diventi visibile.

Fallback:

- se `IntersectionObserver` non è disponibile, caricare dopo `DOMContentLoaded`;
- in modalità “manuale”, mostrare un pulsante `Carica credenziale`.

### 9.2 Deduplicazione

Se la stessa credenziale compare più volte nella pagina:

- evitare richieste simultanee duplicate;
- usare una cache solo in memoria, limitata alla pagina corrente;
- non usare localStorage, sessionStorage, IndexedDB o cache persistente;
- associare la cache all’utente e alla sessione correnti;
- cancellare la cache quando cambia pagina o termina la sessione.

### 9.3 Annullamento

Usare `AbortController` per annullare le richieste quando:

- l’utente cambia pagina;
- il componente viene smontato;
- scade il timeout;
- la sessione termina.

## 10. Aggiornamento OTP

### 10.1 Requisito

L’OTP deve aggiornarsi ogni 30 secondi senza:

- ricaricare la pagina;
- ricaricare l’intero secret;
- bloccare il rendering;
- esporre il seed OTP nel browser, salvo decisione esplicita e documentata.

### 10.2 Strategia consigliata

Il backend del plugin calcola o recupera il codice OTP e restituisce:

```json
{
  "code": "123456",
  "validUntil": "2026-07-27T12:34:30.000Z",
  "periodSeconds": 30
}
```

Il frontend:

1. mostra il codice;
2. calcola visivamente il tempo residuo usando `validUntil`;
3. pianifica il refresh al prossimo boundary;
4. chiama un endpoint OTP leggero;
5. aggiorna soltanto la porzione OTP del componente.

Endpoint suggerito:

```http
GET /api/psono-connector/secrets/:reference/otp
```

Non usare un `setInterval(30000)` ingenuo, perché può derivare rispetto ai boundary TOTP.

Calcolare il ritardo:

```text
delay = validUntil - currentTime + piccolo margine
```

Aggiungere un margine di circa 250–500 ms per evitare di richiedere il codice prima del cambio periodo.

### 10.3 Visibilità

Aggiornare l’OTP solo quando:

- la scheda del browser è visibile;
- almeno un componente relativo al secret è visibile o recentemente usato.

Usare:

```text
document.visibilityState
```

e l’observer del componente.

Quando la pagina torna visibile:

- non recuperare tutti i dati;
- richiedere soltanto un OTP aggiornato.

### 10.4 Secret senza OTP

Se la credenziale non contiene OTP:

- non avviare timer;
- non effettuare richieste periodiche;
- non mostrare errori.

## 11. API interne del plugin

Le route sono esempi e devono essere adattate agli hook reali di Wiki.js.

### 11.1 Stato e configurazione utente

```http
GET /api/psono-connector/me/status
```

Risposta:

```json
{
  "pluginEnabled": true,
  "credentialsConfigured": true
}
```

### 11.2 Salvataggio API key

```http
PUT /api/psono-connector/me/credentials
```

Body:

```json
{
  "apiKeyId": "...",
  "privateKey": "...",
  "secretKey": "..."
}
```

La risposta non deve ripetere i valori.

### 11.3 Eliminazione API key

```http
DELETE /api/psono-connector/me/credentials
```

### 11.4 Validazione API key

```http
POST /api/psono-connector/me/credentials/test
```

La validazione deve usare l’endpoint globale configurato dall’amministratore.

### 11.5 Recupero secret

```http
POST /api/psono-connector/secrets/resolve
```

Body consigliato:

```json
{
  "url": "https://psonoendpoint.com/etc"
}
```

Non fidarsi di identificatori arbitrari senza validare nuovamente che l’URL:

- appartenga all’endpoint Psono configurato;
- rappresenti un tipo di riferimento supportato;
- non contenga componenti anomali.

Risposta di successo:

```json
{
  "status": "success",
  "reference": {
    "type": "secret"
  },
  "secret": {
    "title": "Applicazione produzione",
    "url": "https://app.example.com",
    "username": "service-account",
    "password": "example",
    "notes": "Accesso consentito tramite VPN",
    "hasOtp": true
  },
  "otp": {
    "code": "123456",
    "validUntil": "2026-07-27T12:34:30.000Z",
    "periodSeconds": 30
  }
}
```

Valutare una modalità più prudente in cui la password non venga restituita con il caricamento iniziale, ma solo al clic su “Mostra”.

### 11.6 Recupero password on demand

Consigliato:

```http
POST /api/psono-connector/secrets/reveal-password
```

La password viene recuperata solo quando l’utente preme `Mostra`.

Vantaggi:

- riduce l’esposizione;
- evita di inviare password mai consultate;
- facilita audit e rate limiting;
- mantiene più leggero il caricamento lazy.

### 11.7 Recupero OTP

```http
POST /api/psono-connector/secrets/otp
```

Body:

```json
{
  "url": "https://psonoendpoint.com/etc"
}
```

### 11.8 Stati di errore

Usare codici e payload coerenti.

Plugin disattivato:

```json
{
  "status": "disabled",
  "message": "Il connettore Psono è disattivato."
}
```

API key non configurata:

```json
{
  "status": "not_configured",
  "message": "Configura la tua API key Psono."
}
```

Permessi insufficienti:

```json
{
  "status": "forbidden",
  "message": "Non disponi dei permessi Psono per questa credenziale."
}
```

Link non supportato:

```json
{
  "status": "unsupported_reference",
  "message": "Il link Psono non identifica una credenziale supportata."
}
```

Psono non raggiungibile:

```json
{
  "status": "unavailable",
  "message": "Il server Psono non è raggiungibile."
}
```

API key non valida o revocata:

```json
{
  "status": "invalid_credentials",
  "message": "La API key Psono non è valida o è stata revocata."
}
```

Errore interno:

```json
{
  "status": "error",
  "message": "Impossibile caricare la credenziale."
}
```

Non restituire stack trace o dettagli crittografici al browser.

## 12. Autorizzazione

La regola è:

```text
accesso consentito =
  utente autenticato in Wiki.js
  AND utente autorizzato a vedere la pagina Wiki.js
  AND plugin globalmente attivo
  AND API key personale configurata
  AND API key autorizzata da Psono sul secret
```

Il backend deve identificare l’utente esclusivamente tramite la sessione Wiki.js.

Non accettare dal client:

- `wikiUserId`;
- API key;
- endpoint Psono alternativo;
- flag per ignorare i permessi.

Psono rimane la fonte di verità per l’accesso al secret.

Il plugin non deve mantenere una matrice parallela dei permessi dei secret.

## 13. Modalità API Psono

Psono documenta più modalità d’uso delle API key:

- session based;
- sessionless con decifratura locale;
- sessionless con decifratura remota.

La modalità preferita per il progetto deve evitare la decifratura remota, salvo impossibilità tecnica chiaramente documentata.

Direzione consigliata:

```text
sessionless con decifratura locale nel backend del plugin
```

Il backend del plugin:

1. recupera il materiale della API key cifrato;
2. lo decifra in memoria;
3. autentica la richiesta verso Psono;
4. scarica il secret cifrato;
5. lo decifra localmente;
6. estrae solo i campi ammessi;
7. azzera o rilascia i buffer sensibili quando possibile;
8. restituisce al browser solo ciò che deve essere mostrato.

Non implementare il protocollo crittografico “a memoria”.

Claude Code deve:

- studiare il client ufficiale Psono;
- individuare librerie ufficiali o codice riutilizzabile;
- rispettarne la licenza;
- aggiungere test con vettori noti;
- evitare primitive crittografiche personalizzate non necessarie;
- documentare esattamente il formato della API key e il flusso.

## 14. Interfaccia del componente

### 14.1 Stato iniziale

```text
Credenziale Psono
In attesa di caricamento…
```

oppure uno skeleton leggero.

### 14.2 Caricamento

```text
Caricamento credenziale…
```

Non bloccare il resto della pagina.

### 14.3 Successo

Esempio:

```text
Applicazione produzione

URL       https://app.example.com        [Apri] [Copia]
Username  service-account                [Copia]
Password  ••••••••••••••                 [Mostra] [Copia]
OTP       123 456                         [Copia]  18 s
Note      Accesso consentito tramite VPN
```

### 14.4 Permessi insufficienti

```text
Non disponi dei permessi Psono per visualizzare questa credenziale.
Apri in Psono
```

Mantenere disponibile il link originale, se appropriato.

### 14.5 API key non configurata

```text
Configura la tua API key Psono per visualizzare questa credenziale.
Configura Psono
```

### 14.6 Accessibilità

- pulsanti con label accessibili;
- aggiornamenti OTP con `aria-live` non invasivo;
- non annunciare ogni secondo del countdown;
- navigazione da tastiera;
- focus visibile;
- password non inserita in attributi HTML;
- supporto a temi chiaro e scuro;
- rispetto di `prefers-reduced-motion`.

## 15. Gestione della password

Default:

```text
password nascosta
```

La password deve essere mostrata solo dopo azione esplicita.

Preferire il recupero on demand.

Quando viene mostrata:

- non salvarla in storage persistente;
- non inserirla in tooltip o attributi;
- nasconderla automaticamente dopo un timeout;
- rimuovere il testo dal DOM;
- cancellarla quando il componente viene smontato;
- non copiarla automaticamente;
- mostrare conferma temporanea dopo la copia.

La Clipboard API deve essere usata soltanto a seguito di un gesto dell’utente.

## 16. Cache e header HTTP

Tutte le risposte che possono contenere dati sensibili devono includere:

```http
Cache-Control: no-store, private
Pragma: no-cache
Expires: 0
```

Valutare anche:

```http
Vary: Cookie, Authorization
```

Non memorizzare secret in:

- cache applicativa globale;
- Redis condiviso;
- CDN;
- service worker;
- log;
- metriche;
- tracing;
- error reporting;
- localStorage;
- sessionStorage;
- IndexedDB.

È ammessa soltanto una cache volatile per pagina e sessione, con TTL breve, se indispensabile.

## 17. Sicurezza

### 17.1 SSRF

L’endpoint Psono non deve provenire dall’utente o dal link.

Il backend deve chiamare esclusivamente l’API base URL configurata dall’amministratore.

Contromisure:

- protocollo HTTPS obbligatorio in produzione;
- validazione URL;
- blocco redirect verso host diversi;
- limiti sui redirect;
- timeout;
- limiti sulla dimensione della risposta;
- opzionale allowlist di IP o hostname;
- attenzione a DNS rebinding;
- non risolvere URL arbitrary passati dal browser.

### 17.2 CSRF

Le route di modifica devono usare la protezione CSRF di Wiki.js o un meccanismo equivalente.

Le route di lettura dei secret devono:

- richiedere sessione autenticata;
- verificare same-origin;
- non supportare JSONP;
- usare metodi POST quando utile a ridurre leakage di riferimenti nei log e nella cronologia.

### 17.3 XSS

Tutti i dati Psono devono essere renderizzati come testo.

Non usare `innerHTML` con:

- titolo;
- URL;
- username;
- password;
- note;
- messaggi provenienti da Psono.

Sanitizzare e validare gli URL prima di renderli come link.

### 17.4 Logging

Consentito:

```text
timestamp
wiki_user_id o identificatore pseudonimizzato
azione
esito
durata
tipo di riferimento
```

Da evitare:

```text
password
username
note
OTP
seed OTP
API key
materiale crittografico
payload Psono completo
URL con dati sensibili
```

Valutare se registrare il `secretId`; renderlo configurabile o hashato.

### 17.5 Rate limiting

Applicare limiti separati a:

- risoluzione secret;
- reveal password;
- refresh OTP;
- test API key;
- test endpoint amministrativo.

Il refresh OTP legittimo ogni 30 secondi deve essere compatibile con il limite.

### 17.6 Content Security Policy

Il bundle deve essere servito dalla stessa origine di Wiki.js.

Non richiedere script da CDN esterni.

Non effettuare chiamate dirette dal browser a Psono.

## 18. Privacy e audit

Prevedere eventi di audit privi del contenuto del secret:

```text
PSono connector configured
Psono API key updated
Psono API key removed
Secret metadata loaded
Password revealed
OTP requested
Access denied by Psono
```

La registrazione dell’evento “Password revealed” è consigliata, ma deve essere configurabile e documentata.

Non registrare il valore copiato.

## 19. Struttura proposta del repository

```text
wikijs-psono-connector/
├── LICENSE
├── README.md
├── SECURITY.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── CHANGELOG.md
├── package.json
├── connector.manifest.json
├── docs/
│   ├── architecture.md
│   ├── installation.md
│   ├── configuration.md
│   ├── security-model.md
│   ├── threat-model.md
│   ├── compatibility.md
│   └── psono-api-notes.md
├── src/
│   ├── server/
│   │   ├── adapters/
│   │   │   └── wikijs/
│   │   ├── api/
│   │   ├── auth/
│   │   ├── config/
│   │   ├── crypto/
│   │   ├── db/
│   │   ├── psono/
│   │   ├── services/
│   │   └── validation/
│   ├── renderer/
│   │   ├── index.js
│   │   └── parse-psono-reference.js
│   ├── client/
│   │   ├── components/
│   │   ├── observers/
│   │   ├── api/
│   │   ├── styles/
│   │   └── index.ts
│   ├── admin/
│   └── user-settings/
├── migrations/
├── scripts/
│   ├── install.js
│   ├── uninstall.js
│   └── doctor.js
├── test/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   └── compatibility/
└── dist/
```

## 20. Moduli logici

### 20.1 `PsonoUrlMatcher`

Responsabilità:

- normalizzare configurazione e URL;
- verificare host e path;
- impedire bypass;
- estrarre un riferimento;
- distinguere link supportati e non supportati.

### 20.2 `PsonoClient`

Responsabilità:

- autenticazione API key;
- comunicazione con Psono;
- recupero dati cifrati;
- decifratura locale;
- normalizzazione dei secret;
- mapping degli errori.

Interfaccia suggerita:

```ts
interface PsonoClient {
  testCredentials(credentials: UserPsonoCredentials): Promise<void>
  resolveSecret(
    credentials: UserPsonoCredentials,
    reference: PsonoReference
  ): Promise<ResolvedSecret>
  resolveOtp(
    credentials: UserPsonoCredentials,
    reference: PsonoReference
  ): Promise<ResolvedOtp | null>
}
```

### 20.3 `UserCredentialStore`

Responsabilità:

- cifrare;
- salvare;
- recuperare;
- decifrare in memoria;
- cancellare;
- ruotare la cifratura;
- non esporre mai le chiavi tramite DTO.

### 20.4 `ConnectorSettingsStore`

Responsabilità:

- stato attivo;
- endpoint web;
- endpoint API;
- timeout;
- policy di rendering;
- policy dei campi;
- refresh OTP.

### 20.5 `SecretResolverService`

Responsabilità:

- verificare plugin;
- recuperare utente dalla sessione;
- validare URL;
- caricare credenziali utente;
- interrogare Psono;
- filtrare i campi;
- produrre risposte uniformi;
- emettere audit event.

### 20.6 `PsonoSecretElement`

Componente frontend responsabile di:

- stato UI;
- caricamento lazy;
- reveal;
- copia;
- timer OTP;
- errori;
- cleanup;
- accessibilità.

Valutare un Web Component per ridurre l’accoppiamento al framework frontend interno di Wiki.js:

```html
<wikijs-psono-secret data-reference="..."></wikijs-psono-secret>
```

Un Web Component compilato in bundle autonomo può essere più resistente agli aggiornamenti rispetto a un componente Vue legato alla versione usata da Wiki.js.

## 21. Strategia di installazione

### 21.1 Preferenza

Ordine di preferenza:

1. API plugin/modulo ufficiale;
2. caricamento da directory moduli;
3. hook documentato;
4. singolo adapter minimale per versione;
5. patch automatizzata come ultima risorsa.

### 21.2 Docker

Fornire un esempio:

```dockerfile
FROM requarks/wiki:<pinned-version>

COPY dist /opt/wikijs-psono-connector
RUN node /opt/wikijs-psono-connector/scripts/install.js /wiki
```

Non modificare manualmente container già avviati.

Creare una nuova immagine a ogni aggiornamento.

### 21.3 Persistenza

Assicurarsi che:

- tabelle plugin rimangano nel database;
- configurazione master key sia esterna;
- reinstallazione non sovrascriva dati;
- migrazioni siano versionate;
- downgrade non avvenga automaticamente.

## 22. Piano di implementazione per Claude Code

### Fase 0 — Ricognizione

1. Clonare la versione target di Wiki.js.
2. Identificare versione, runtime Node.js, ORM e sistema di moduli.
3. Studiare:
   - pipeline di rendering;
   - registrazione moduli;
   - sessione utente;
   - route o GraphQL;
   - schermate amministrative;
   - schema database;
   - caricamento asset frontend;
   - meccanismi CSRF e autorizzazione.
4. Studiare il client ufficiale Psono e il flusso API key.
5. Documentare i punti di aggancio scelti in `docs/architecture.md`.
6. Non scrivere ancora patch invasive.

Output della fase:

```text
docs/research-wikijs.md
docs/research-psono.md
docs/architecture-decision-records/
```

### Fase 1 — Skeleton repository

1. Inizializzare repository.
2. Aggiungere `LICENSE` AGPL-3.0-only.
3. Aggiungere TypeScript, lint, format e test.
4. Creare manifesto e struttura.
5. Configurare CI.
6. Creare immagini o ambiente di test con Wiki.js e Psono.

### Fase 2 — URL matcher e renderer

1. Implementare normalizzazione endpoint.
2. Implementare `PsonoUrlMatcher`.
3. Aggiungere test di sicurezza URL.
4. Implementare trasformazione degli anchor in placeholder.
5. Assicurarsi che plugin disattivato lasci invariato il link.
6. Verificare blocchi di codice e autolink.
7. Non effettuare chiamate Psono in rendering.

Criterio di completamento:

```text
Un link valido al dominio configurato produce un placeholder.
Tutti gli altri link restano invariati.
Nessun dato segreto è presente nell’HTML.
```

### Fase 3 — Configurazione amministrativa

1. Creare tabella settings.
2. Implementare repository e validazione.
3. Implementare pagina admin.
4. Implementare enable/disable.
5. Implementare endpoint web e API.
6. Implementare test connessione.
7. Proteggere la pagina con ruolo amministratore.

### Fase 4 — Credenziali utente

1. Creare tabella separata.
2. Implementare cifratura authenticated.
3. Leggere master key da environment.
4. Implementare pagina utente.
5. Implementare save/test/delete.
6. Non restituire le chiavi salvate.
7. Aggiungere audit.

### Fase 5 — Client Psono

1. Implementare autenticazione con API key.
2. Implementare decifratura locale.
3. Recuperare una credenziale read-only.
4. Normalizzare campi.
5. Gestire OTP.
6. Mappare 401/403/404/timeouts.
7. Testare contro un’istanza Psono reale di sviluppo.
8. Aggiungere mock e fixture prive di secret reali.

### Fase 6 — API dinamiche

1. Implementare resolve metadata.
2. Implementare reveal password on demand.
3. Implementare OTP endpoint.
4. Aggiungere no-store.
5. Aggiungere CSRF e same-origin.
6. Aggiungere rate limit.
7. Aggiungere timeout e cancellation.
8. Evitare dati sensibili nei log.

### Fase 7 — Frontend lazy

1. Creare Web Component o bundle autonomo.
2. Individuare placeholder.
3. Usare IntersectionObserver.
4. Implementare stati UI.
5. Implementare reveal password.
6. Implementare copia.
7. Implementare refresh OTP al boundary.
8. Sospendere timer in background.
9. Cleanup su navigazione.
10. Test accessibilità.

### Fase 8 — Installer e compatibilità

1. Implementare `install`.
2. Implementare `doctor`.
3. Implementare `uninstall`.
4. Testare reinstallazione.
5. Testare aggiornamento Wiki.js.
6. Generare matrice versioni supportate.
7. Aggiungere CI contro immagini Wiki.js selezionate.

### Fase 9 — Hardening

1. Threat model.
2. Test SSRF.
3. Test XSS.
4. Test CSRF.
5. Test privilege escalation.
6. Test cache.
7. Test log leakage.
8. Test API key revocata.
9. Test sessione scaduta.
10. Test più utenti e stessa pagina.

## 23. Test richiesti

### Unit test

- URL esatto;
- host simile malevolo;
- path supportato;
- path sconosciuto;
- query string;
- fragment;
- URL encoded;
- porta;
- protocollo HTTP;
- credenziali nell’URL;
- link in code block;
- plugin disattivato;
- normalizzazione slash finali;
- OTP boundary.

### Integration test

- amministratore abilita plugin;
- amministratore imposta endpoint;
- utente salva API key;
- utente autorizzato vede metadata;
- utente non autorizzato vede avviso;
- API key assente;
- API key revocata;
- Psono offline;
- password caricata solo al clic;
- OTP aggiornato senza reload;
- pagina caricata senza attendere Psono;
- stessa credenziale ripetuta;
- navigazione SPA;
- logout durante timer.

### Security test

- SSRF verso localhost;
- redirect verso host diverso;
- DNS rebinding, ove testabile;
- XSS nelle note;
- URL `javascript:`;
- API key nei log;
- secret nei log;
- risposta cacheabile;
- accesso route senza sessione;
- sostituzione user ID;
- accesso admin da utente normale;
- CSRF configurazione;
- rate limiting reveal;
- session fixation.

### Compatibility test

Per ogni versione Wiki.js supportata:

- installazione pulita;
- avvio;
- rendering;
- login;
- configurazione admin;
- configurazione utente;
- caricamento secret;
- aggiornamento da versione precedente;
- disinstallazione;
- normale funzionalità Wiki.js non alterata.

## 24. Criteri di accettazione MVP

L’MVP è completato quando:

1. l’amministratore può attivare/disattivare il plugin;
2. l’amministratore può configurare endpoint web e API Psono;
3. l’utente può salvare e cancellare la propria API key cifrata;
4. un link al dominio configurato viene trasformato automaticamente;
5. il rendering statico contiene solo un placeholder;
6. il secret viene caricato dopo la pagina e solo in lazy loading;
7. l’utente autorizzato vede URL, username, password, OTP e note;
8. la password è nascosta e preferibilmente caricata solo al clic;
9. l’utente non autorizzato vede “permessi insufficienti”;
10. l’utente senza API key vede un invito alla configurazione;
11. l’OTP si aggiorna ogni periodo senza reload della pagina;
12. il plugin disattivato non trasforma i link;
13. nessuna API key o secret appare nei log;
14. le risposte sensibili sono `no-store`;
15. il plugin può essere reinstallato dopo un aggiornamento Wiki.js;
16. il repository è pubblicato come `AGPL-3.0-only`.

## 25. Cose da non fare

- Non salvare API key in chiaro.
- Non inviare API key al browser.
- Non chiamare Psono direttamente dal browser.
- Non caricare secret durante il rendering server-side della pagina.
- Non salvare secret nel contenuto Wiki.js.
- Non indicizzare secret.
- Non memorizzare secret in cache persistenti.
- Non ricaricare la pagina per aggiornare l’OTP.
- Non ricaricare tutto il secret ogni secondo.
- Non fidarsi del dominio contenuto nel link.
- Non consentire endpoint Psono scelti dall’utente.
- Non implementare scrittura di secret nell’MVP.
- Non modificare direttamente tabelle utenti Wiki.js.
- Non accoppiare il frontend a componenti interni Wiki.js senza necessità.
- Non applicare patch multiple ai file core.
- Non usare decifratura remota Psono come scelta predefinita.
- Non includere segreti nei test o nelle fixture.
- Non dichiarare compatibilità con versioni non testate.

## 26. Decisioni già approvate

```text
Nome repository:
wikijs-psono-connector

Licenza:
AGPL-3.0-only

Server Psono:
configurato globalmente dall’amministratore

Abilitazione:
interruttore globale amministrativo

Credenziali:
API key Psono personale e read-only per ogni utente Wiki.js

Autorizzazione:
delegata ai permessi della API key Psono

Riconoscimento:
automatico per ogni link al dominio Psono configurato

Rendering:
placeholder statico e contenuto dinamico

Caricamento:
lazy, asincrono e non bloccante

OTP:
aggiornamento dinamico ogni 30 secondi o secondo il periodo restituito,
senza ricaricare la pagina

Middleware esterno:
nessuno

Modifiche a Wiki.js:
minime, isolate e resistenti agli aggiornamenti
```

## 27. Questioni da verificare durante la ricognizione

Claude Code deve dare una risposta documentata a queste domande prima dell’implementazione definitiva:

1. Qual è la versione Wiki.js target iniziale?
2. Qual è il miglior hook per trasformare gli anchor nell’HTML finale?
3. È possibile registrare route senza patchare file core?
4. È possibile registrare una pagina amministrativa senza patchare il frontend core?
5. Come vengono autenticati e autorizzati i resolver/route interni?
6. Quale ORM e sistema di migrazioni usa la versione target?
7. Come vengono caricati bundle e CSS aggiuntivi?
8. Come gestisce Wiki.js la navigazione client-side e lo smontaggio pagina?
9. Qual è il formato reale dei link Psono da trasformare?
10. Quale identificativo del secret è presente nel link?
11. Quale modalità API key consente accesso read-only al singolo secret?
12. Quale codice ufficiale Psono può essere riutilizzato per la decifratura?
13. Come viene rappresentato il TOTP nei dati Psono?
14. Come distinguere permesso negato, secret inesistente e link non valido?
15. Quali obblighi di attribuzione derivano dal codice Psono eventualmente riutilizzato?

## 28. Riferimenti tecnici iniziali

- Wiki.js — sito ufficiale e licenza AGPL v3: `https://js.wiki/`
- Wiki.js — documentazione sviluppatori: `https://docs.requarks.io/`
- Wiki.js — rendering pipeline: `https://docs.requarks.io/rendering`
- Wiki.js — repository: `https://github.com/requarks/wiki`
- Psono — API key overview: `https://doc.psono.com/user/api-key/overview.html`
- Psono — API generale: `https://doc.psono.com/api.html`
- Psono — organizzazione GitHub: `https://github.com/psono`

Verificare sempre le implementazioni e le versioni correnti prima di copiare codice o assumere la stabilità di una API.

## 29. Prompt operativo suggerito per Claude Code

```text
Implementa il progetto descritto in questo documento procedendo per fasi.

Prima di modificare codice:
1. ispeziona la versione target di Wiki.js;
2. produci la ricognizione tecnica richiesta;
3. proponi gli hook meno invasivi;
4. evidenzia ogni punto che richiederebbe una patch core;
5. preferisci moduli, adapter e file aggiuntivi;
6. non implementare crittografia personalizzata se esiste codice ufficiale Psono riutilizzabile;
7. non usare secret reali;
8. mantieni AGPL-3.0-only;
9. aggiungi test prima di considerare completata ogni fase;
10. aggiorna la documentazione delle decisioni architetturali.

Non contattare Psono durante il rendering statico.
Non inviare API key al browser.
Non inserire secret in log, cache o HTML salvato.
Il caricamento deve essere lazy.
L’OTP deve aggiornarsi senza reload della pagina.
```
