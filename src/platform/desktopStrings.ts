import type { Language, Strings } from '../strings';

export type NativeFailure =
  | 'changed'
  | 'missing'
  | 'notAFile'
  | 'notAllowed'
  | 'unsupportedType'
  | 'diskFull'
  | 'readOnlyVolume'
  | 'other'
  | 'noGrant';

/** Why native code couldn't do something, for the "couldn't save" dialog. */
export const NATIVE_FAILURES: Record<Language, Record<NativeFailure, string>> = {
  en: {
    changed: 'The file changed while it was being saved.',
    missing: 'The file no longer exists.',
    notAFile: 'Something other than this file is now at that location.',
    notAllowed: "You don't have permission to change this file. It may be locked or read-only.",
    unsupportedType: 'Only .csv, .md, .markdown and .txt files can be saved.',
    diskFull: 'The disk is full.',
    readOnlyVolume: 'The disk is read-only.',
    other: "The file couldn't be written.",
    noGrant: 'This file was restored from an earlier session, so use Save As to choose where it goes.',
  },
  ca: {
    changed: 'El fitxer ha canviat mentre es desava.',
    missing: 'El fitxer ja no existeix.',
    notAFile: "A aquesta ubicació ara hi ha una altra cosa que no és aquest fitxer.",
    notAllowed: 'No tens permís per canviar aquest fitxer. Pot ser que estigui bloquejat o que sigui només de lectura.',
    unsupportedType: 'Només es poden desar fitxers .csv, .md, .markdown i .txt.',
    diskFull: 'El disc és ple.',
    readOnlyVolume: 'El disc és només de lectura.',
    other: "No s'ha pogut escriure el fitxer.",
    noGrant: "Aquest fitxer s'ha restaurat d'una sessió anterior, així que fes servir Anomena i desa per triar on va.",
  },
};

/** Text that says "browser" or "tab", reworded for an app. Only desktop entry points import this. */
export const DESKTOP_STRINGS: Record<Language, Partial<Strings>> = {
  en: {
    privacyHint: 'Files never leave this computer',
    largeFile: (name) => `"${name}" is over 50 MB and may be slow, or may not fit in memory.`,
    pasteFailed: "Couldn't read the clipboard. Use the paste shortcut instead.",
    storageWarning: "Recovery isn't protecting your open files right now because they couldn't be stored.",
    permissionBody: 'One more confirmation is needed before this file can be overwritten.',
    restoreFailed: (name) => `"${name}" can't be restored because it's already open.`,
    clearAllBody: 'This permanently removes every recoverable file from this computer. Files currently open are not affected.',
  },
  ca: {
    privacyHint: "Els fitxers no surten mai d'aquest ordinador",
    largeFile: (name) => `«${name}» ocupa més de 50 MB i pot anar lent, o pot no cabre a la memòria.`,
    pasteFailed: "No s'ha pogut llegir el porta-retalls. Fes servir la drecera d'enganxar.",
    storageWarning: "La recuperació no protegeix ara mateix els fitxers oberts, perquè no s'han pogut desar.",
    permissionBody: 'Cal una confirmació més per poder sobreescriure aquest fitxer.',
    restoreFailed: (name) => `No es pot restaurar «${name}» perquè ja està obert.`,
    clearAllBody: "Això elimina permanentment tots els fitxers recuperables d'aquest ordinador. Els fitxers oberts no es veuen afectats.",
  },
};
