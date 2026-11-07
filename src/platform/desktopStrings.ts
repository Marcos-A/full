import type { Language, Strings } from '../strings';

/** Text that says "browser" or "tab", reworded for an app. Only desktop entry points import this. */
export const DESKTOP_STRINGS: Record<Language, Partial<Strings>> = {
  en: {
    privacyHint: 'Files stay on this computer and are never uploaded.',
    largeFile: (name) => `"${name}" is over 50 MB and may be slow, or may not fit in memory.`,
    pasteFailed: "Couldn't read the clipboard. Use the paste shortcut instead.",
    storageWarning: "Recovery isn't protecting your open files right now because they couldn't be stored.",
    permissionBody: 'One more confirmation is needed before this file can be overwritten.',
    restoreFailed: (name) => `"${name}" can't be restored because it's already open.`,
    clearAllBody: 'This permanently removes every recoverable file from this computer. Files currently open are not affected.',
  },
  ca: {
    privacyHint: 'Els fitxers es queden en aquest ordinador i no es pugen mai.',
    largeFile: (name) => `«${name}» ocupa més de 50 MB i pot anar lent, o pot no cabre a la memòria.`,
    pasteFailed: "No s'ha pogut llegir el porta-retalls. Fes servir la drecera d'enganxar.",
    storageWarning: "La recuperació no protegeix ara mateix els fitxers oberts, perquè no s'han pogut desar.",
    permissionBody: 'Cal una confirmació més per poder sobreescriure aquest fitxer.',
    restoreFailed: (name) => `No es pot restaurar «${name}» perquè ja està obert.`,
    clearAllBody: "Això elimina permanentment tots els fitxers recuperables d'aquest ordinador. Els fitxers oberts no es veuen afectats.",
  },
};
