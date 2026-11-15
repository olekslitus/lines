<script lang="ts">
  // AniList's group of Settings → Library: signing in, keeping your list in step, and importing it.
  import ListAccount from "../../lib/components/settings/ListAccount.svelte";
  import type { ImportFile } from "../../lib/plugins/types";

  const props: { files?: ImportFile[]; onclose?: () => void } = $props();
</script>

<ListAccount id="anilist" {...props} />
