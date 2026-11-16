import { t } from "../../lib/i18n/index.svelte";
import { notesWork } from "../../lib/imports/notes";
import { notes } from "../../lib/notes/store.svelte";
import type { Plugin } from "../../lib/plugins/types";

/*
 * Moving from Evernote (docs/importing.md#evernote): its notebooks' .enex files, their notes'
 * text, files, checklists, tags and dates, brought in from Settings → Export and Import. Nothing
 * happens until it's asked to.
 */
export const evernote = (): Plugin => ({
  id: "evernote",
  name: "Evernote",
  description: t("plugins.evernote.description"),
  icon: "notebook-text",
  enabledByDefault: true,
  contributes: {
    imports: [
      {
        id: "evernote",
        into: "notes",
        name: t("import.evernote.title"),
        note: t("import.evernote.note"),
        panel: () => import("./EvernoteImport.svelte"),
        work: (input) => notesWork(input, notes.entries),
      },
    ],
  },
});
