<script lang="ts">
  // Evernote's group of Settings → Export and Import: its notebooks' .enex files, chosen and read (enex.ts).
  import NotesImport from "../../lib/components/settings/NotesImport.svelte";
  import { t } from "../../lib/i18n/index.svelte";
  import type { ImportFile } from "../../lib/plugins/types";
  import { readEnex } from "./enex";

  // Evernote's files are chosen here: `files` is never given.
  let { onclose }: { files?: ImportFile[]; onclose?: () => void } = $props();
</script>

<NotesImport id="evernote" choices={[{ label: t("import.evernote.choose"), accept: ".enex", multiple: true }]} read={readEnex} {onclose} />
