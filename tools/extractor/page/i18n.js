// Page translations and the locale store.
//
// Dependency-free by necessity: this page ships as static files to GitHub
// Pages and the whole point of the project is that what runs is settled at
// build time, so pulling an i18n library from a CDN at load time would be
// working against it. The shape mirrors the one the other projects in this
// family vendor: strings nested by section rather than flat dotted keys,
// English as the base that every other locale is checked against, values that
// need arguments written as functions returning template literals, and the
// language remembered in localStorage under "locale".
//
// House style for the copy below:
//   - "convert", not "extract". Files someone owns become files this core can
//     read; "extraction" is our word, not theirs.
//   - "WAD", not "asset" or "input file". That is what the file is called
//     everywhere else, including on the user's own disk.
//   - no em dashes anywhere. Break the sentence or use a comma.
//   - translations are written the way someone would actually speak. German in
//     particular should not chain every proper noun into one compound.
//   - no second person anywhere, in any language. Labels name the thing, not
//     what the reader should do to it: German and French use the infinitive,
//     Spanish the infinitive or an impersonal, Polish a verbal noun rather than
//     an imperative, Japanese です・ます or a plain noun, Korean -기 / 합니다.
//   - counts are formatted with the locale's own tag, so a thousands separator
//     is the one that language uses.
//   - plural branches are the language's own. Polish needs three forms and gets
//     plForm below; Japanese and Korean inflect no plural at all, so their
//     strings simply state the number and the noun stays as it is.

// The languages the web builder actually offers, in the order it lists them,
// each labelled with its own native name. SUPPORTED_LOCALES over there declares
// fourteen, but only these seven have strings and only these seven survive its
// isRegistered() filter, so a visitor cannot pick any of the rest. Shipping the
// others empty would put a language in this menu that renders as English.
export const SUPPORTED = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "pl", label: "Polski" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
];

// English is the base. Every other locale below is a translation of exactly
// these keys; a missing key falls back to the English one rather than showing
// a blank or a key name to the user.
const en = {
  app: {
    heading: (title) => `${title} WAD converter`,
    lede: (game, ext) => `Converts ${game} WAD files into the ${ext} files this core reads`,
  },
  lang: {
    label: "Language",
    aria: "Choose the language of this page",
  },
  io: {
    input: "Input",
    output: "Output",
  },
  why: {
    label: "What this does",
    text: "Runs in the browser. Game files are not uploaded anywhere.",
  },
  input: {
    heading: "Game folder",
    // Two ways in, and the folder is the one to reach for: the IWAD sits at the
    // top of a DOS install, in base/ in a re-release and anywhere at all in a
    // folder someone collected WADs into, and the page looks through all of it
    // either way.
    chooseFolder: "Choose folder",
    chooseFiles: "Choose files instead",
    scanning: (n) => `${n} file${n === 1 ? "" : "s"}`,
    reading: (name) => name,
    bytes: (n) => `${n.toLocaleString("en-GB")} bytes`,
    // The label on the closed disclosure. The count above it is what the page
    // actually says about the scan; this only offers the rows behind it.
    detail: (n) => `Per-WAD detail, ${n} WAD${n === 1 ? "" : "s"}`,
    foundCount: (n, ignored, root) =>
      `${n} WAD${n === 1 ? "" : "s"} found${root ? ` in ${root}` : ""}` +
      (ignored ? `, and ${ignored} other file${ignored === 1 ? "" : "s"} ignored.` : "."),
    // The likeliest thing to go wrong, so it says what was looked for and
    // where rather than leaving an empty list that reads like a crash.
    noneFound: (exts, where, n) =>
      `No ${exts} files anywhere in ${where}, out of ${n} file${n === 1 ? "" : "s"}. ` +
      `The folder Doom is installed in holds one, usually beside the game or in base.`,
    theSelection: "the selection",
    // Recognised means "this hashes to a release the project knows". It is not
    // the last word: the module has its own table and says so after the run.
    recognised: "known release",
    unknownYet: "not a known release",
    duplicateStem: (stem, kept) =>
      `another copy of ${stem}; converting ${kept} instead, since both would be ` +
      `written as the same file. A narrower folder picks the other one.`,
    notRecognised: (sha1) => `not a release this version accepts (SHA-1 ${sha1}).`,
    tooLarge: (size, max) => `${size} bytes, larger than the ${max} a WAD can be.`,
    unusableName: (why) => `cannot be named on the card: ${why}.`,
    tooMany: (n, max) =>
      `${n} WADs is more than the ${max} this version converts in one go. ` +
      `A folder holding fewer of them converts in one pass.`,
  },
  run: {
    heading: "Convert",
    button: "Convert",
    converting: (i, n, name) => `${name}, ${i} of ${n}`,
    timedOut: (name) => `${name} took too long and was stopped.`,
    done: (n) => `${n} file${n === 1 ? "" : "s"} ready.`,
    failed: (name, msg) => `${name} could not be converted: ${msg}`,
    tooBig: (name, size, max) =>
      `${name} came out at ${size} bytes, more than the ${max} its manifest allows.`,
  },
  version: {
    label: "Version",
    showPrereleases: "Show pre-releases",
    prerelease: "pre-release",
    abi: (version, minSize) => `firmware ABI ${version}+ (${minSize} bytes)`,
    retained: (n) => `Showing the ${n} most recent releases.`,
    olderReleases: "Older releases",
    pinned: (tag) => `Version ${tag}`,
    noConverter: "This version needs no conversion: install the published files as they are.",
  },
  zip: {
    button: (n, size) =>
      `Download the install zip (${n} file${n === 1 ? "" : "s"}, ${size})`,
    // The layout is the useful fact: the zip already puts each file where it
    // goes, so nothing is left to do but copy the folders onto the card.
    note: (binaries, dir, n) =>
      `One zip, laid out for the card: ${binaries}, and ${n} game` +
      `${n === 1 ? "" : "s"} in ${dir}`,
    building: "Packing the archive",
    ready: (name, bytes) => `${name} saved, ${bytes.toLocaleString("en-GB")} bytes.`,
    failed: (msg) => `Could not build the zip: ${msg}`,
    fetchFailed: (name, status) => `could not fetch ${name} (${status})`,
    sizeMismatch: (name, got, want) =>
      `${name} is ${got} bytes, but its manifest says ${want}`,
    hashMismatch: (name) => `${name} does not match the hash in its manifest`,
  },
  results: {
    heading: "Converted files",
    bytes: (n) => `${n.toLocaleString("en-GB")} bytes`,
    mb: (n) => `${n.toLocaleString("en-GB", { maximumFractionDigits: 1 })} MB`,
    // The table is collapsed by default, so its summary has to say what is
    // inside it and how much of it there is.
    summary: (n) => `Per-file detail, ${n} file${n === 1 ? "" : "s"}`,
    colSource: "WAD",
    colFile: "Output",
    colStatus: "Status",
    colSize: "Size",
    hash: "SHA-256",
    colDownload: "Download",
    save: "Save",
    // Three outcomes, and only one of them is a problem. A WAD the module
    // cannot place against its table of retail releases still converted: a
    // PWAD or a fan megawad is not a known release by construction.
    converted: "Converted",
    known: "Known release",
    unknown: "Not a known release",
    failed: "Failed",
  },
  footer: {
    source: "Source and documentation:",
    repo: "the project repository",
    published: "This page is published from the same CI run that builds and " +
      "verifies the module, so the two always match.",
  },
  fatal: {
    cannotRun: (msg) => `This page cannot run: ${msg}`,
    noManifest: "the converter manifest could not be loaded",
    noVersions: "this site publishes no versions",
    mismatch: "the converter does not match its manifest",
    unsafe: (errs) => `the converter failed its safety checks: ${errs}`,
  },
};

const fr = {
  app: {
    heading: (title) => `Convertisseur de WAD ${title}`,
    lede: (game, ext) =>
      `Convertit les fichiers WAD de ${game} en fichiers ${ext}, ceux que lit ce cœur`,
  },
  lang: {
    label: "Langue",
    aria: "Choisir la langue de cette page",
  },
  io: {
    input: "Entrée",
    output: "Sortie",
  },
  why: {
    label: "Ce que fait cette page",
    text: "Tout se passe dans le navigateur. Aucun fichier de jeu n'est envoyé.",
  },
  input: {
    heading: "Dossier de jeu",
    chooseFolder: "Choisir un dossier",
    chooseFiles: "Choisir des fichiers",
    scanning: (n) => `${n} fichier${n === 1 ? "" : "s"}`,
    reading: (name) => name,
    bytes: (n) => `${n.toLocaleString("fr-FR")} octets`,
    detail: (n) => `Détail par WAD, ${n} WAD`,
    foundCount: (n, ignored, root) =>
      `${n} WAD trouvé${n === 1 ? "" : "s"}${root ? ` dans ${root}` : ""}` +
      (ignored ? `, et ${ignored} autre${ignored === 1 ? "" : "s"} fichier${ignored === 1 ? "" : "s"} ignoré${ignored === 1 ? "" : "s"}.` : "."),
    noneFound: (exts, where, n) =>
      `Aucun fichier ${exts} dans ${where}, sur ${n} fichier${n === 1 ? "" : "s"}. ` +
      `Le dossier où Doom est installé en contient un, près du jeu ou dans base.`,
    theSelection: "la sélection",
    recognised: "version connue",
    unknownYet: "version inconnue",
    duplicateStem: (stem, kept) =>
      `autre copie de ${stem} ; c'est ${kept} qui est converti, les deux portant ` +
      `le même nom une fois écrits. Un dossier plus précis retient l'autre.`,
    notRecognised: (sha1) => `version refusée par ce convertisseur (SHA-1 ${sha1}).`,
    tooLarge: (size, max) => `${size} octets, plus que les ${max} d'un WAD.`,
    unusableName: (why) => `ne peut pas porter ce nom sur la carte : ${why}.`,
    tooMany: (n, max) =>
      `${n} WAD, c'est plus que les ${max} convertis en une fois par cette version. ` +
      `Un dossier qui en contient moins passe en une seule fois.`,
  },
  run: {
    heading: "Convertir",
    button: "Convertir",
    converting: (i, n, name) => `${name}, ${i} sur ${n}`,
    timedOut: (name) => `${name} a pris trop de temps et a été interrompu.`,
    done: (n) => `${n} fichier${n === 1 ? "" : "s"} prêt${n === 1 ? "" : "s"}.`,
    failed: (name, msg) => `${name} n'a pas pu être converti : ${msg}`,
    tooBig: (name, size, max) =>
      `${name} fait ${size} octets, plus que les ${max} autorisés par son manifeste.`,
  },
  version: {
    label: "Version",
    showPrereleases: "Afficher les préversions",
    prerelease: "préversion",
    abi: (version, minSize) => `ABI firmware ${version}+ (${minSize} octets)`,
    retained: (n) => `Les ${n} versions les plus récentes.`,
    olderReleases: "Versions plus anciennes",
    pinned: (tag) => `Version ${tag}`,
    noConverter: "Cette version ne demande aucune conversion : installer les fichiers publiés tels quels.",
  },
  zip: {
    button: (n, size) =>
      `Télécharger l'archive d'installation (${n} fichier${n === 1 ? "" : "s"}, ${size})`,
    note: (binaries, dir, n) =>
      `Une archive, déjà rangée pour la carte : ${binaries}, et ${n} jeu` +
      `${n === 1 ? "" : "x"} dans ${dir}`,
    building: "Création de l'archive",
    ready: (name, bytes) => `${name} enregistré, ${bytes.toLocaleString("fr-FR")} octets.`,
    failed: (msg) => `Impossible de créer l'archive : ${msg}`,
    fetchFailed: (name, status) => `${name} n'a pas pu être récupéré (${status})`,
    sizeMismatch: (name, got, want) =>
      `${name} fait ${got} octets alors que son manifeste en annonce ${want}`,
    hashMismatch: (name) => `${name} ne correspond pas à l'empreinte de son manifeste`,
  },
  results: {
    heading: "Fichiers convertis",
    bytes: (n) => `${n.toLocaleString("fr-FR")} octets`,
    mb: (n) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`,
    summary: (n) => `Détail par fichier, ${n} fichier${n === 1 ? "" : "s"}`,
    colSource: "WAD",
    colFile: "Sortie",
    colStatus: "État",
    colSize: "Taille",
    hash: "SHA-256",
    colDownload: "Téléchargement",
    save: "Enregistrer",
    converted: "Converti",
    known: "Version connue",
    unknown: "Version inconnue",
    failed: "Échec",
  },
  footer: {
    source: "Code source et documentation :",
    repo: "le dépôt du projet",
    published: "Cette page est publiée par la même exécution CI que celle qui " +
      "construit et vérifie le module : les deux vont toujours ensemble.",
  },
  fatal: {
    cannotRun: (msg) => `Cette page ne peut pas fonctionner : ${msg}`,
    noManifest: "le manifeste du convertisseur n'a pas pu être chargé",
    noVersions: "ce site ne publie aucune version",
    mismatch: "le convertisseur ne correspond pas à son manifeste",
    unsafe: (errs) => `le convertisseur a échoué aux contrôles de sécurité : ${errs}`,
  },
};

const de = {
  app: {
    heading: (title) => `${title} WAD-Konverter`,
    lede: (game, ext) =>
      `Wandelt WAD-Dateien von ${game} in die ${ext}-Dateien um, die dieser Core liest`,
  },
  lang: {
    label: "Sprache",
    aria: "Sprache dieser Seite wählen",
  },
  io: {
    input: "Eingabe",
    output: "Ausgabe",
  },
  why: {
    label: "Was hier passiert",
    text: "Läuft im Browser. Es werden keine Spieldateien hochgeladen.",
  },
  input: {
    heading: "Spielordner",
    chooseFolder: "Ordner auswählen",
    chooseFiles: "Dateien auswählen",
    scanning: (n) => `${n} Datei${n === 1 ? "" : "en"}`,
    reading: (name) => name,
    bytes: (n) => `${n.toLocaleString("de-DE")} Bytes`,
    detail: (n) => `Details je WAD, ${n} WAD`,
    foundCount: (n, ignored, root) =>
      `${n} WAD gefunden${root ? `, in ${root}` : ""}` +
      (ignored ? `, und ${ignored} andere Datei${ignored === 1 ? "" : "en"} übergangen.` : "."),
    noneFound: (exts, where, n) =>
      `Keine ${exts}-Dateien in ${where}, bei ${n} Datei${n === 1 ? "" : "en"} insgesamt. ` +
      `Im Ordner, in dem Doom installiert ist, liegt eine, neben dem Spiel oder in base.`,
    theSelection: "der Auswahl",
    recognised: "bekannte Fassung",
    unknownYet: "unbekannte Fassung",
    duplicateStem: (stem, kept) =>
      `noch eine Kopie von ${stem}; umgewandelt wird ${kept}, weil beide unter ` +
      `demselben Namen landen würden. Ein engerer Ordner wählt die andere.`,
    notRecognised: (sha1) => `keine Fassung, die diese Version annimmt (SHA-1 ${sha1}).`,
    tooLarge: (size, max) => `${size} Bytes, mehr als die ${max} einer WAD.`,
    unusableName: (why) => `kann auf der Karte nicht so heißen: ${why}.`,
    tooMany: (n, max) =>
      `${n} WADs sind mehr als die ${max}, die diese Version auf einmal umwandelt. ` +
      `Ein Ordner mit weniger davon geht in einem Durchgang.`,
  },
  run: {
    heading: "Umwandeln",
    button: "Umwandeln",
    converting: (i, n, name) => `${name}, ${i} von ${n}`,
    timedOut: (name) => `${name} hat zu lange gedauert und wurde abgebrochen.`,
    done: (n) => `${n} Datei${n === 1 ? "" : "en"} bereit.`,
    failed: (name, msg) => `${name} konnte nicht umgewandelt werden: ${msg}`,
    tooBig: (name, size, max) =>
      `${name} ist ${size} Bytes groß, mehr als die im Manifest erlaubten ${max}.`,
  },
  version: {
    label: "Version",
    showPrereleases: "Vorabversionen anzeigen",
    prerelease: "Vorabversion",
    abi: (version, minSize) => `Firmware-ABI ${version}+ (${minSize} Bytes)`,
    retained: (n) => `Die ${n} neuesten Versionen.`,
    olderReleases: "Ältere Versionen",
    pinned: (tag) => `Version ${tag}`,
    noConverter: "Diese Version braucht keine Umwandlung: die veröffentlichten Dateien so installieren, wie sie sind.",
  },
  zip: {
    button: (n, size) =>
      `Installations-Archiv herunterladen (${n} Datei${n === 1 ? "" : "en"}, ${size})`,
    note: (binaries, dir, n) =>
      `Ein Archiv, schon passend für die Karte: ${binaries}, und ${n} Spiel${n === 1 ? "" : "e"} in ${dir}`,
    building: "Archiv wird gepackt",
    ready: (name, bytes) => `${name} gespeichert, ${bytes.toLocaleString("de-DE")} Bytes.`,
    failed: (msg) => `Das Archiv konnte nicht erstellt werden: ${msg}`,
    fetchFailed: (name, status) => `${name} konnte nicht geladen werden (${status})`,
    sizeMismatch: (name, got, want) =>
      `${name} hat ${got} Bytes, das Manifest nennt aber ${want}`,
    hashMismatch: (name) => `${name} passt nicht zur Prüfsumme im Manifest`,
  },
  results: {
    heading: "Umgewandelte Dateien",
    bytes: (n) => `${n.toLocaleString("de-DE")} Bytes`,
    mb: (n) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`,
    summary: (n) => `Details je Datei, ${n} Datei${n === 1 ? "" : "en"}`,
    colSource: "WAD",
    colFile: "Ausgabe",
    colStatus: "Status",
    colSize: "Größe",
    hash: "SHA-256",
    colDownload: "Download",
    save: "Speichern",
    converted: "Umgewandelt",
    known: "Bekannte Fassung",
    unknown: "Unbekannte Fassung",
    failed: "Fehlgeschlagen",
  },
  footer: {
    source: "Quellcode und Dokumentation:",
    repo: "das Projekt-Repository",
    published: "Diese Seite wird vom selben CI-Lauf veröffentlicht, der das Modul " +
      "baut und prüft. Beide passen also immer zusammen.",
  },
  fatal: {
    cannotRun: (msg) => `Diese Seite funktioniert nicht: ${msg}`,
    noManifest: "das Manifest des Konverters konnte nicht geladen werden",
    noVersions: "diese Seite veröffentlicht keine Versionen",
    mismatch: "der Konverter passt nicht zu seinem Manifest",
    unsafe: (errs) => `der Konverter hat die Sicherheitsprüfungen nicht bestanden: ${errs}`,
  },
};

// Polish counts in three: one, a "few" (2 to 4, excluding the teens), and the
// rest, which takes the genitive plural. Copying English's one/other shape here
// would misdeclense two thirds of the numbers this page shows.
const plForm = (n, one, few, many) =>
  n === 1 ? one
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few
      : many;

const es = {
  app: {
    heading: (title) => `Conversor de WAD de ${title}`,
    lede: (game, ext) =>
      `Convierte archivos WAD de ${game} en los archivos ${ext} que lee este núcleo`,
  },
  lang: {
    label: "Idioma",
    aria: "Elegir el idioma de esta página",
  },
  io: {
    input: "Entrada",
    output: "Salida",
  },
  why: {
    label: "Qué hace esta página",
    text: "Todo ocurre en el navegador. No se envía ningún archivo del juego.",
  },
  input: {
    heading: "Carpeta del juego",
    chooseFolder: "Elegir carpeta",
    chooseFiles: "Elegir archivos",
    scanning: (n) => `${n} archivo${n === 1 ? "" : "s"}`,
    reading: (name) => name,
    bytes: (n) => `${n.toLocaleString("es-ES")} bytes`,
    detail: (n) => `Detalle por WAD, ${n} WAD`,
    foundCount: (n, ignored, root) =>
      `${n} WAD encontrado${n === 1 ? "" : "s"}${root ? ` en ${root}` : ""}` +
      (ignored ? `, y ${ignored} archivo${ignored === 1 ? "" : "s"} más omitido${ignored === 1 ? "" : "s"}.` : "."),
    noneFound: (exts, where, n) =>
      `Ningún archivo ${exts} en ${where}, de ${n} archivo${n === 1 ? "" : "s"}. ` +
      `La carpeta donde está instalado Doom tiene uno, junto al juego o en base.`,
    theSelection: "la selección",
    recognised: "versión conocida",
    unknownYet: "versión desconocida",
    duplicateStem: (stem, kept) =>
      `otra copia de ${stem}; se convierte ${kept}, ya que ambas se escribirían con ` +
      `el mismo nombre. Una carpeta más concreta se queda con la otra.`,
    notRecognised: (sha1) => `no es una versión que acepte este convertidor (SHA-1 ${sha1}).`,
    tooLarge: (size, max) => `${size} bytes, más de los ${max} que puede ocupar un WAD.`,
    unusableName: (why) => `no puede llamarse así en la tarjeta: ${why}.`,
    tooMany: (n, max) =>
      `${n} WAD son más de los ${max} que esta versión convierte de una vez. ` +
      `Una carpeta con menos se convierte de una sola pasada.`,
  },
  run: {
    heading: "Convertir",
    button: "Convertir",
    converting: (i, n, name) => `${name}, ${i} de ${n}`,
    timedOut: (name) => `${name} ha tardado demasiado y se ha detenido.`,
    done: (n) => `${n} archivo${n === 1 ? "" : "s"} listo${n === 1 ? "" : "s"}.`,
    failed: (name, msg) => `No se ha podido convertir ${name}: ${msg}`,
    tooBig: (name, size, max) =>
      `${name} ha resultado de ${size} bytes, más de los ${max} que permite su manifiesto.`,
  },
  version: {
    label: "Versión",
    showPrereleases: "Mostrar versiones preliminares",
    prerelease: "versión preliminar",
    abi: (version, minSize) => `ABI de firmware ${version}+ (${minSize} bytes)`,
    retained: (n) => `Las ${n} versiones más recientes.`,
    olderReleases: "Versiones anteriores",
    pinned: (tag) => `Versión ${tag}`,
    noConverter: "Esta versión no necesita conversión: instalar los archivos publicados tal cual.",
  },
  zip: {
    button: (n, size) =>
      `Descargar el archivo de instalación (${n} archivo${n === 1 ? "" : "s"}, ${size})`,
    note: (binaries, dir, n) =>
      `Un solo archivo comprimido, ya ordenado para la tarjeta: ${binaries}, y ${n} juego` +
      `${n === 1 ? "" : "s"} en ${dir}`,
    building: "Creando el archivo comprimido",
    ready: (name, bytes) => `${name} guardado, ${bytes.toLocaleString("es-ES")} bytes.`,
    failed: (msg) => `No se ha podido crear el archivo comprimido: ${msg}`,
    fetchFailed: (name, status) => `no se ha podido obtener ${name} (${status})`,
    sizeMismatch: (name, got, want) =>
      `${name} tiene ${got} bytes, pero su manifiesto indica ${want}`,
    hashMismatch: (name) => `${name} no coincide con la huella de su manifiesto`,
  },
  results: {
    heading: "Archivos convertidos",
    bytes: (n) => `${n.toLocaleString("es-ES")} bytes`,
    mb: (n) => `${n.toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB`,
    summary: (n) => `Detalle por archivo, ${n} archivo${n === 1 ? "" : "s"}`,
    colSource: "WAD",
    colFile: "Salida",
    colStatus: "Estado",
    colSize: "Tamaño",
    hash: "SHA-256",
    colDownload: "Descarga",
    save: "Guardar",
    converted: "Convertido",
    known: "Versión conocida",
    unknown: "Versión desconocida",
    failed: "Error",
  },
  footer: {
    source: "Código fuente y documentación:",
    repo: "el repositorio del proyecto",
    published: "Esta página se publica desde la misma ejecución de CI que compila y " +
      "verifica el módulo, así que ambos coinciden siempre.",
  },
  fatal: {
    cannotRun: (msg) => `Esta página no puede funcionar: ${msg}`,
    noManifest: "no se ha podido cargar el manifiesto del convertidor",
    noVersions: "este sitio no publica ninguna versión",
    mismatch: "el convertidor no coincide con su manifiesto",
    unsafe: (errs) => `el convertidor no ha superado las comprobaciones de seguridad: ${errs}`,
  },
};

const pl = {
  app: {
    heading: (title) => `Konwerter plików WAD ${title}`,
    lede: (game, ext) =>
      `Konwertuje pliki WAD gry ${game} na pliki ${ext}, które odczytuje ten rdzeń`,
  },
  lang: {
    label: "Język",
    aria: "Wybór języka tej strony",
  },
  io: {
    input: "Wejście",
    output: "Wyjście",
  },
  why: {
    label: "Co robi ta strona",
    text: "Wszystko dzieje się w przeglądarce. Żadne pliki gry nie są nigdzie wysyłane.",
  },
  input: {
    heading: "Folder gry",
    chooseFolder: "Wybór folderu",
    chooseFiles: "Wybór plików",
    scanning: (n) => `${n} ${plForm(n, "plik", "pliki", "plików")}`,
    reading: (name) => name,
    bytes: (n) => `${n.toLocaleString("pl-PL")} ${plForm(n, "bajt", "bajty", "bajtów")}`,
    detail: (n) => `Szczegóły plików WAD, ${n} ${plForm(n, "plik", "pliki", "plików")} WAD`,
    foundCount: (n, ignored, root) =>
      `Znaleziono ${n} ${plForm(n, "plik", "pliki", "plików")} WAD${root ? ` w ${root}` : ""}` +
      (ignored ? `, pominięto ${ignored} ${plForm(ignored, "inny plik", "inne pliki", "innych plików")}.` : "."),
    noneFound: (exts, where, n) =>
      `Brak plików ${exts} w ${where}, spośród ${n} ${plForm(n, "pliku", "plików", "plików")}. ` +
      `W folderze z instalacją gry Doom znajduje się jeden, obok gry albo w base.`,
    theSelection: "wybranych plikach",
    recognised: "znane wydanie",
    unknownYet: "nieznane wydanie",
    duplicateStem: (stem, kept) =>
      `kolejna kopia ${stem}; konwertowany jest ${kept}, ponieważ obie zostałyby zapisane ` +
      `pod tą samą nazwą. Węższy folder zostawia tę drugą.`,
    notRecognised: (sha1) => `wydanie nieprzyjmowane przez tę wersję (SHA-1 ${sha1}).`,
    tooLarge: (size, max) => `${size} bajtów, więcej niż ${max} dopuszczalne dla pliku WAD.`,
    unusableName: (why) => `nie może mieć takiej nazwy na karcie: ${why}.`,
    tooMany: (n, max) =>
      `${n} ${plForm(n, "plik", "pliki", "plików")} WAD to więcej niż ${max}, ` +
      `ile ta wersja konwertuje naraz. Folder z mniejszą ich liczbą przechodzi za jednym razem.`,
  },
  run: {
    heading: "Konwersja",
    button: "Konwersja",
    converting: (i, n, name) => `${name}, ${i} z ${n}`,
    timedOut: (name) => `${name} trwał zbyt długo i został przerwany.`,
    done: (n) => `Gotowe: ${n} ${plForm(n, "plik", "pliki", "plików")}.`,
    failed: (name, msg) => `Nie udało się przekonwertować ${name}: ${msg}`,
    tooBig: (name, size, max) =>
      `${name} ma ${size} bajtów, więcej niż ${max} dozwolone przez manifest.`,
  },
  version: {
    label: "Wersja",
    showPrereleases: "Wersje wstępne",
    prerelease: "wersja wstępna",
    abi: (version, minSize) => `ABI firmware ${version}+ (${minSize} bajtów)`,
    retained: (n) => `${n} ${plForm(n, "najnowsza wersja", "najnowsze wersje", "najnowszych wersji")}.`,
    olderReleases: "Starsze wersje",
    pinned: (tag) => `Wersja ${tag}`,
    noConverter: "Ta wersja nie wymaga konwersji: opublikowane pliki instaluje się bez zmian.",
  },
  zip: {
    button: (n, size) =>
      `Archiwum instalacyjne do pobrania (${n} ${plForm(n, "plik", "pliki", "plików")}, ${size})`,
    note: (binaries, dir, n) =>
      `Jedno archiwum, ułożone pod kartę: ${binaries} oraz ${n} ` +
      `${plForm(n, "gra", "gry", "gier")} w ${dir}`,
    building: "Pakowanie archiwum",
    ready: (name, bytes) =>
      `Zapisano ${name}, ${bytes.toLocaleString("pl-PL")} ${plForm(bytes, "bajt", "bajty", "bajtów")}.`,
    failed: (msg) => `Nie udało się utworzyć archiwum: ${msg}`,
    fetchFailed: (name, status) => `nie udało się pobrać ${name} (${status})`,
    sizeMismatch: (name, got, want) =>
      `${name} ma ${got} bajtów, a manifest podaje ${want}`,
    hashMismatch: (name) => `${name} nie zgadza się z sumą kontrolną z manifestu`,
  },
  results: {
    heading: "Przekonwertowane pliki",
    bytes: (n) => `${n.toLocaleString("pl-PL")} ${plForm(n, "bajt", "bajty", "bajtów")}`,
    mb: (n) => `${n.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} MB`,
    summary: (n) => `Szczegóły plików, ${n} ${plForm(n, "plik", "pliki", "plików")}`,
    colSource: "WAD",
    colFile: "Wyjście",
    colStatus: "Stan",
    colSize: "Rozmiar",
    hash: "SHA-256",
    colDownload: "Pobieranie",
    save: "Zapis",
    converted: "Przekonwertowany",
    known: "Znane wydanie",
    unknown: "Nieznane wydanie",
    failed: "Niepowodzenie",
  },
  footer: {
    source: "Kod źródłowy i dokumentacja:",
    repo: "repozytorium projektu",
    published: "Ta strona jest publikowana przez ten sam przebieg CI, który buduje i " +
      "weryfikuje moduł, więc oba zawsze do siebie pasują.",
  },
  fatal: {
    cannotRun: (msg) => `Ta strona nie może działać: ${msg}`,
    noManifest: "nie udało się wczytać manifestu konwertera",
    noVersions: "ta witryna nie publikuje żadnych wersji",
    mismatch: "konwerter nie zgadza się ze swoim manifestem",
    unsafe: (errs) => `konwerter nie przeszedł kontroli bezpieczeństwa: ${errs}`,
  },
};

const ja = {
  app: {
    heading: (title) => `${title} WAD コンバーター`,
    lede: (game, ext) =>
      `${game} の WAD ファイルを、このコアが読み込む ${ext} ファイルに変換します`,
  },
  lang: {
    label: "言語",
    aria: "このページの言語を選択",
  },
  io: {
    input: "入力",
    output: "出力",
  },
  why: {
    label: "このページの動作",
    text: "処理はブラウザー内で完結します。ゲームファイルはどこにも送信されません。",
  },
  input: {
    heading: "ゲームフォルダー",
    chooseFolder: "フォルダーを選択",
    chooseFiles: "ファイルを選択",
    scanning: (n) => `${n} 個のファイル`,
    reading: (name) => name,
    bytes: (n) => `${n.toLocaleString("ja-JP")} バイト`,
    detail: (n) => `WAD ごとの詳細（${n} 件）`,
    foundCount: (n, ignored, root) =>
      `${root ? `${root} で ` : ""}${n} 個の WAD を検出` +
      (ignored ? `、他の ${ignored} 個のファイルは対象外です。` : "しました。"),
    noneFound: (exts, where, n) =>
      `${where} の ${n} 個のファイルの中に ${exts} ファイルはありません。` +
      `Doom をインストールしたフォルダーに 1 つあります。ゲーム本体の隣か、base の中です。`,
    theSelection: "選択範囲",
    recognised: "既知のリリース",
    unknownYet: "未知のリリース",
    duplicateStem: (stem, kept) =>
      `${stem} の別のコピーです。どちらも同じ名前で書き出されるため、${kept} を変換します。` +
      `より狭いフォルダーを選ぶと、もう一方が残ります。`,
    notRecognised: (sha1) => `このバージョンが受け付けるリリースではありません（SHA-1 ${sha1}）。`,
    tooLarge: (size, max) => `${size} バイトで、WAD 1 つの上限 ${max} を超えています。`,
    unusableName: (why) => `カード上でこの名前は使えません: ${why}。`,
    tooMany: (n, max) =>
      `${n} 個の WAD は、このバージョンが一度に変換できる ${max} 個を超えています。` +
      `より少ないフォルダーなら一度で変換できます。`,
  },
  run: {
    heading: "変換",
    button: "変換",
    converting: (i, n, name) => `${name}（${n} 件中 ${i} 件目）`,
    timedOut: (name) => `${name} は時間がかかりすぎたため中止しました。`,
    done: (n) => `${n} 個のファイルが完成しました。`,
    failed: (name, msg) => `${name} を変換できませんでした: ${msg}`,
    tooBig: (name, size, max) =>
      `${name} は ${size} バイトで、マニフェストが許可する ${max} を超えています。`,
  },
  version: {
    label: "バージョン",
    showPrereleases: "プレリリースを表示",
    prerelease: "プレリリース",
    abi: (version, minSize) => `ファームウェア ABI ${version} 以降（${minSize} バイト）`,
    retained: (n) => `最新の ${n} 件のリリースを表示しています。`,
    olderReleases: "以前のリリース",
    pinned: (tag) => `バージョン ${tag}`,
    noConverter: "このバージョンに変換は不要です。公開されたファイルをそのままインストールしてください。",
  },
  zip: {
    button: (n, size) => `インストール用 zip をダウンロード（${n} 個のファイル、${size}）`,
    note: (binaries, dir, n) =>
      `カード用に配置済みの zip が 1 つ: ${binaries}、および ${dir} 内の ${n} 本のゲーム`,
    building: "アーカイブを作成中",
    ready: (name, bytes) =>
      `${name} を保存しました（${bytes.toLocaleString("ja-JP")} バイト）。`,
    failed: (msg) => `zip を作成できませんでした: ${msg}`,
    fetchFailed: (name, status) => `${name} を取得できませんでした（${status}）`,
    sizeMismatch: (name, got, want) =>
      `${name} は ${got} バイトですが、マニフェストには ${want} とあります`,
    hashMismatch: (name) => `${name} はマニフェストのハッシュと一致しません`,
  },
  results: {
    heading: "変換済みファイル",
    bytes: (n) => `${n.toLocaleString("ja-JP")} バイト`,
    mb: (n) => `${n.toLocaleString("ja-JP", { maximumFractionDigits: 1 })} MB`,
    summary: (n) => `ファイルごとの詳細（${n} 件）`,
    colSource: "WAD",
    colFile: "出力",
    colStatus: "状態",
    colSize: "サイズ",
    hash: "SHA-256",
    colDownload: "ダウンロード",
    save: "保存",
    converted: "変換済み",
    known: "既知のリリース",
    unknown: "未知のリリース",
    failed: "失敗",
  },
  footer: {
    source: "ソースコードとドキュメント:",
    repo: "プロジェクトのリポジトリ",
    published: "このページは、モジュールをビルドして検証するのと同じ CI 実行から公開されるため、" +
      "両者は常に一致します。",
  },
  fatal: {
    cannotRun: (msg) => `このページは動作できません: ${msg}`,
    noManifest: "コンバーターのマニフェストを読み込めませんでした",
    noVersions: "このサイトはバージョンを公開していません",
    mismatch: "コンバーターがマニフェストと一致しません",
    unsafe: (errs) => `コンバーターが安全性チェックに合格しませんでした: ${errs}`,
  },
};

const ko = {
  app: {
    heading: (title) => `${title} WAD 변환기`,
    lede: (game, ext) => `${game}의 WAD 파일을 이 코어가 읽는 ${ext} 파일로 변환합니다`,
  },
  lang: {
    label: "언어",
    aria: "이 페이지의 언어 선택",
  },
  io: {
    input: "입력",
    output: "출력",
  },
  why: {
    label: "이 페이지가 하는 일",
    text: "브라우저 안에서 처리됩니다. 게임 파일은 어디에도 업로드되지 않습니다.",
  },
  input: {
    heading: "게임 폴더",
    chooseFolder: "폴더 선택",
    chooseFiles: "파일 선택",
    scanning: (n) => `파일 ${n}개`,
    reading: (name) => name,
    bytes: (n) => `${n.toLocaleString("ko-KR")}바이트`,
    detail: (n) => `WAD별 세부 정보, ${n}개`,
    foundCount: (n, ignored, root) =>
      `${root ? `${root}에서 ` : ""}WAD ${n}개 발견` +
      (ignored ? `, 다른 파일 ${ignored}개는 제외했습니다.` : "했습니다."),
    noneFound: (exts, where, n) =>
      `${where}의 파일 ${n}개 중에 ${exts} 파일이 없습니다. ` +
      `Doom이 설치된 폴더에 하나 있습니다. 게임 옆이나 base 안입니다.`,
    theSelection: "선택 항목",
    recognised: "알려진 릴리스",
    unknownYet: "알려지지 않은 릴리스",
    duplicateStem: (stem, kept) =>
      `${stem}의 또 다른 사본입니다. 둘 다 같은 이름으로 기록되므로 ${kept}을 변환합니다. ` +
      `더 좁은 폴더를 고르면 다른 쪽이 남습니다.`,
    notRecognised: (sha1) => `이 버전이 받아들이는 릴리스가 아닙니다(SHA-1 ${sha1}).`,
    tooLarge: (size, max) => `${size}바이트로, WAD 하나의 상한 ${max}을 넘습니다.`,
    unusableName: (why) => `카드에서 이 이름은 쓸 수 없습니다: ${why}.`,
    tooMany: (n, max) =>
      `WAD ${n}개는 이 버전이 한 번에 변환하는 ${max}개보다 많습니다. ` +
      `더 적게 담긴 폴더는 한 번에 변환됩니다.`,
  },
  run: {
    heading: "변환",
    button: "변환",
    converting: (i, n, name) => `${name}, ${n}개 중 ${i}번째`,
    timedOut: (name) => `${name}이 너무 오래 걸려 중단되었습니다.`,
    done: (n) => `파일 ${n}개가 준비되었습니다.`,
    failed: (name, msg) => `${name}을 변환하지 못했습니다: ${msg}`,
    tooBig: (name, size, max) =>
      `${name}이 ${size}바이트로, 매니페스트가 허용하는 ${max}을 넘습니다.`,
  },
  version: {
    label: "버전",
    showPrereleases: "시험판 표시",
    prerelease: "시험판",
    abi: (version, minSize) => `펌웨어 ABI ${version} 이상(${minSize}바이트)`,
    retained: (n) => `최근 릴리스 ${n}개를 표시합니다.`,
    olderReleases: "이전 릴리스",
    pinned: (tag) => `버전 ${tag}`,
    noConverter: "이 버전은 변환이 필요 없습니다. 공개된 파일을 그대로 설치하십시오.",
  },
  zip: {
    button: (n, size) => `설치용 zip 내려받기(파일 ${n}개, ${size})`,
    note: (binaries, dir, n) =>
      `카드에 맞게 정리된 zip 하나: ${binaries}, 그리고 ${dir} 안의 게임 ${n}개`,
    building: "아카이브 압축 중",
    ready: (name, bytes) => `${name} 저장됨, ${bytes.toLocaleString("ko-KR")}바이트.`,
    failed: (msg) => `zip을 만들지 못했습니다: ${msg}`,
    fetchFailed: (name, status) => `${name}을 가져오지 못했습니다(${status})`,
    sizeMismatch: (name, got, want) =>
      `${name}은 ${got}바이트이지만 매니페스트에는 ${want}로 적혀 있습니다`,
    hashMismatch: (name) => `${name}이 매니페스트의 해시와 일치하지 않습니다`,
  },
  results: {
    heading: "변환된 파일",
    bytes: (n) => `${n.toLocaleString("ko-KR")}바이트`,
    mb: (n) => `${n.toLocaleString("ko-KR", { maximumFractionDigits: 1 })} MB`,
    summary: (n) => `파일별 세부 정보, ${n}개`,
    colSource: "WAD",
    colFile: "출력",
    colStatus: "상태",
    colSize: "크기",
    hash: "SHA-256",
    colDownload: "내려받기",
    save: "저장",
    converted: "변환됨",
    known: "알려진 릴리스",
    unknown: "알려지지 않은 릴리스",
    failed: "실패",
  },
  footer: {
    source: "소스 코드와 문서:",
    repo: "프로젝트 저장소",
    published: "이 페이지는 모듈을 빌드하고 검증하는 것과 같은 CI 실행에서 게시되므로 " +
      "둘은 항상 일치합니다.",
  },
  fatal: {
    cannotRun: (msg) => `이 페이지를 실행할 수 없습니다: ${msg}`,
    noManifest: "변환기의 매니페스트를 불러오지 못했습니다",
    noVersions: "이 사이트는 게시된 버전이 없습니다",
    mismatch: "변환기가 매니페스트와 일치하지 않습니다",
    unsafe: (errs) => `변환기가 안전성 검사를 통과하지 못했습니다: ${errs}`,
  },
};

const STRINGS = { en, de, fr, es, pl, ja, ko };

// Fall back key by key rather than whole-locale, so a partial translation
// degrades to English only where it is actually missing.
function withFallback(locale) {
  const base = STRINGS.en;
  const over = STRINGS[locale] ?? {};
  const out = {};
  for (const section of Object.keys(base)) {
    out[section] = { ...base[section], ...(over[section] ?? {}) };
  }
  return out;
}

// A visitor whose browser is set to a language we speak should get it without
// touching anything. Region is ignored: de-AT and de-DE both get German.
function matchBrowser() {
  for (const tag of navigator.languages ?? [navigator.language ?? "en"]) {
    const want = tag.toLowerCase().split("-")[0];
    if (SUPPORTED.some((l) => l.code === want)) return want;
  }
  return "en";
}

function initial() {
  let stored = null;
  try {
    stored = localStorage.getItem("locale");
  } catch { /* storage blocked: fall back to the browser's language */ }
  // An explicit choice outranks the browser's setting, but only once made.
  return SUPPORTED.some((l) => l.code === stored) ? stored : matchBrowser();
}

let current = initial();
let strings = withFallback(current);
const listeners = new Set();

export const locale = () => current;
export const t = () => strings;

export function setLocale(code) {
  if (!SUPPORTED.some((l) => l.code === code)) return;
  current = code;
  strings = withFallback(code);
  try {
    localStorage.setItem("locale", code);
  } catch { /* not persisting is survivable; the page still switches */ }
  document.documentElement.lang = code;
  for (const fn of listeners) fn();
}

/** Runs `fn` now and again on every language change. */
export function onLocaleChange(fn) {
  listeners.add(fn);
  fn();
}

/**
 * Reads a localised string out of the manifest, which stores them as
 * `{en, de, fr, ...}` objects, keyed by the same codes SUPPORTED lists. Plain strings are passed through so a manifest that
 * has not been localised still renders.
 */
export function localeText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value[current] ?? value.en ?? "";
}

/**
 * Applies translations to any element carrying `data-i18n="section.key"`, plus
 * `data-i18n-title` and `data-i18n-aria-label` for the attribute forms. Keeps
 * the static markup readable and means adding a string to the page is one
 * attribute rather than a line of JS.
 */
export function applyStatic(root = document) {
  const lookup = (path) => {
    const [section, key] = path.split(".");
    const v = strings[section]?.[key];
    return typeof v === "function" ? v() : v;
  };
  for (const el of root.querySelectorAll("[data-i18n]")) {
    const v = lookup(el.dataset.i18n);
    if (v != null) el.textContent = v;
  }
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    const v = lookup(el.dataset.i18nTitle);
    if (v != null) el.title = v;
  }
  for (const el of root.querySelectorAll("[data-i18n-aria-label]")) {
    const v = lookup(el.dataset.i18nAriaLabel);
    if (v != null) el.setAttribute("aria-label", v);
  }
}
