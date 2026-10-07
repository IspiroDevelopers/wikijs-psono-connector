// SPDX-License-Identifier: AGPL-3.0-only

const en = {
  credential: 'Psono credential',
  waiting: 'Waiting to load…',
  load: 'Load credential',
  loading: 'Loading credential…',
  url: 'URL',
  username: 'Username',
  password: 'Password',
  otp: 'One-time code',
  notes: 'Notes',
  show: 'Show',
  hide: 'Hide',
  copy: 'Copy',
  copied: 'Copied',
  open: 'Open',
  openInPsono: 'Open in Psono',
  secondsLeft: (s: number) => `${s} s`,
  notConfigured: 'Configure your Psono API key in this browser to view this credential.',
  configure: 'Configure Psono',
  reconfigure: 'Reconfigure',
  forbidden: 'This credential is not available with your Psono API key. Ask for access in Psono and add the secret to your API key.',
  invalidCredentials: 'Your Psono API key secret key is not valid. Reconfigure it.',
  unavailable: 'The Psono server cannot be reached right now.',
  unauthenticated: 'Sign in to Wiki.js to view this credential.',
  rateLimited: 'Too many requests. Try again in a minute.',
  serverChanged:
    '⚠ SECURITY WARNING: the identity of the Psono server has changed. For your safety the connector stopped contacting it and your API key was NOT sent. Do not enter keys. Contact your administrator.',
  error: 'The credential could not be loaded.',
  unsupportedType: 'This type of entry can only be opened in Psono.',
  retry: 'Retry',
  // settings
  settingsTitle: 'Psono API key',
  settingsIntro:
    'The wiki shows Psono credentials using your own read-only Psono API key. Psono decides which entries you can see.',
  howTo:
    'In Psono, go to Other → API Keys and create a key with: Read on, Write off, Allow insecure access off, Restrict to secrets on. Add to the key every entry you want to see in the wiki. Then copy the API key ID and the API key secret key (not the private key).',
  apiKeyId: 'API key ID',
  apiKeySecretKey: 'API key secret key',
  save: 'Save',
  cancel: 'Cancel',
  deleteHere: 'Remove from this browser',
  deleteAll: 'Remove from all my browsers',
  saved: 'Saved.',
  deleted: 'Removed from this browser.',
  deletedAll: 'Removed from all your browsers.',
  stateConfiguredUntil: (date: string) => `An API key is configured in this browser until ${date}. Enter a new one to replace it.`,
  stateNotConfigured: 'No API key configured in this browser.',
  perBrowser:
    'For security the key works only in this browser and expires after 30 days at most; then enter it again. On another browser or device, enter it there too.',
  httpsAlertTitle: '⚠ Insecure connection (no HTTPS). ',
  httpsAlertBody:
    'This page is not served over HTTPS: your API key, passwords and one-time codes travel in clear text and can be intercepted. Do not enter a real key here. Ask your administrator to enable HTTPS.',
  invalidFormat: 'Check the values: the ID is a UUID, the secret key is 64 hexadecimal characters.',
  disabled: 'The Psono connector is disabled by the administrator.',
  testLink: 'Optional: paste a Psono entry link to test the key',
  test: 'Test',
  testOk: 'The key works for this entry.',
  manageKey: 'API key',
  confirmDelete: 'Confirm removal',
  writeOnly: 'For security, a saved key can never be displayed again — not even to you. To change it, enter a new one.',
}

const it: typeof en = {
  credential: 'Credenziale Psono',
  waiting: 'In attesa di caricamento…',
  load: 'Carica credenziale',
  loading: 'Caricamento credenziale…',
  url: 'URL',
  username: 'Username',
  password: 'Password',
  otp: 'Codice OTP',
  notes: 'Note',
  show: 'Mostra',
  hide: 'Nascondi',
  copy: 'Copia',
  copied: 'Copiato',
  open: 'Apri',
  openInPsono: 'Apri in Psono',
  secondsLeft: (s: number) => `${s} s`,
  notConfigured: 'Configura la tua API key Psono su questo browser per visualizzare questa credenziale.',
  configure: 'Configura Psono',
  reconfigure: 'Riconfigura',
  forbidden:
    'Questa credenziale non è disponibile con la tua API key Psono. Chiedi l’accesso in Psono e aggiungi la voce alla tua API key.',
  invalidCredentials: 'La secret key della tua API key Psono non è valida. Riconfigurala.',
  unavailable: 'Il server Psono non è raggiungibile in questo momento.',
  unauthenticated: 'Accedi a Wiki.js per visualizzare questa credenziale.',
  rateLimited: 'Troppe richieste. Riprova tra un minuto.',
  serverChanged:
    '⚠ AVVISO DI SICUREZZA: l’identità del server Psono è cambiata. Per sicurezza il connettore ha smesso di contattarlo e la tua API key NON è stata inviata. Non inserire chiavi. Contatta l’amministratore.',
  error: 'Impossibile caricare la credenziale.',
  unsupportedType: 'Questo tipo di voce si può aprire solo in Psono.',
  retry: 'Riprova',
  settingsTitle: 'API key Psono',
  settingsIntro:
    'Il wiki mostra le credenziali Psono usando la tua API key Psono personale in sola lettura. È Psono a decidere quali voci puoi vedere.',
  howTo:
    'In Psono vai su Altro → API Keys e crea una chiave con: Read sì, Write no, Allow insecure access no, Restrict to secrets sì. Aggiungi alla chiave ogni voce che vuoi vedere nel wiki. Poi copia l’API key ID e l’API key secret key (non la private key).',
  apiKeyId: 'API key ID',
  apiKeySecretKey: 'API key secret key',
  save: 'Salva',
  cancel: 'Annulla',
  deleteHere: 'Rimuovi da questo browser',
  deleteAll: 'Rimuovi da tutti i miei browser',
  saved: 'Salvata.',
  deleted: 'Rimossa da questo browser.',
  deletedAll: 'Rimossa da tutti i tuoi browser.',
  stateConfiguredUntil: (date: string) => `Su questo browser è configurata una API key valida fino al ${date}. Inseriscine una nuova per sostituirla.`,
  stateNotConfigured: 'Nessuna API key configurata su questo browser.',
  perBrowser:
    'Per sicurezza la chiave vale solo su questo browser e scade al massimo dopo 30 giorni: poi va reinserita. Su un altro browser o dispositivo va inserita di nuovo.',
  httpsAlertTitle: '⚠ Connessione non sicura (niente HTTPS). ',
  httpsAlertBody:
    'Questa pagina non usa HTTPS: API key, password e codici OTP viaggiano in chiaro e possono essere intercettati. Non inserire qui una chiave reale. Chiedi all’amministratore di attivare HTTPS.',
  invalidFormat: 'Controlla i valori: l’ID è un UUID, la secret key è di 64 caratteri esadecimali.',
  disabled: 'Il connettore Psono è disattivato dall’amministratore.',
  testLink: 'Facoltativo: incolla il link di una voce Psono per provare la chiave',
  test: 'Prova',
  testOk: 'La chiave funziona per questa voce.',
  manageKey: 'API key',
  confirmDelete: 'Conferma rimozione',
  writeOnly: 'Per sicurezza una chiave salvata non può più essere visualizzata, nemmeno da te. Per cambiarla inseriscine una nuova.',
}

export type Strings = typeof en

export function strings(): Strings {
  const lang = (document.documentElement.lang || navigator.language || 'en').toLowerCase()
  return lang.startsWith('it') ? it : en
}
