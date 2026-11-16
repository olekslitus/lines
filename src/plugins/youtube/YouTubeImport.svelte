<script lang="ts">
  // YouTube's group of Settings → Library: a playlist's link, read a page at a time, or a playlist
  // from Google Takeout (Watch Later's only way out), each of its videos the Library hasn't looked
  // up (import.ts); then what importing it would do, the import, and Undo (ImportStep.svelte).
  // Files come from here, or from Export and Import (`files`); a link from a link's menu (asked).
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import { speak } from "../../lib/a11y";
  import ImportStep from "../../lib/components/settings/ImportStep.svelte";
  import Button from "../../lib/components/ui/Button.svelte";
  import Callout from "../../lib/components/ui/Callout.svelte";
  import FieldRow from "../../lib/components/ui/FieldRow.svelte";
  import TextField from "../../lib/components/ui/TextField.svelte";
  import { locale, t } from "../../lib/i18n/index.svelte";
  import { imports } from "../../lib/imports/imports.svelte";
  import { webLink } from "../../lib/editor/sitePlayer";
  import type { ImportFile } from "../../lib/plugins/types";
  import { asked } from "./asked.svelte";
  import { libraryNoteOf } from "../../lib/library/same";
  import { lookUpTakeout, type PlaylistInput, type PlaylistPlan, planPlaylist, readPlaylist, type Reading } from "./import";
  import { channelLink } from "./index";
  import { playlistIn } from "./playlist";
  import { readTakeout } from "./takeout";

  const ID = "youtube";
  /** The Library's note of a video, as it tells what's the same. */
  const noteOf = (link: string) => libraryNoteOf({ type: "video", link });

  let { files, onclose }: { files?: ImportFile[]; onclose?: () => void } = $props();
  const id = $props.id();
  let link = $state("");
  let field = $state<HTMLInputElement>();
  let picker = $state<HTMLInputElement>();
  let reading = $state<Reading | null>(null);
  let error = $state<string | null>(null);
  /** What was read (to import), and what importing it would do. Large: not made deeply reactive. */
  let found = $state.raw<{ input: PlaylistInput; plan: PlaylistPlan } | null>(null);
  let controller: AbortController | undefined;

  onDestroy(() => controller?.abort());

  const count = (n: number) => n.toLocaleString(locale);
  /** What importing would do, a line each: what was found, then what's new, what's added to, what's there, what's gone. */
  const lines = $derived.by(() => {
    if (!found) return [];
    const { input, plan } = found;
    return [
      t("plugins.youtube.found", { count: input.videos.length + input.gone, playlist: input.playlist }),
      ...(plan.adding ? [t("plugins.youtube.adding", { count: plan.adding })] : []),
      ...(plan.joining ? [t("plugins.youtube.joining", { count: plan.joining, playlist: input.playlist })] : []),
      ...(plan.there ? [t("plugins.youtube.there", { count: plan.there })] : []),
      ...(input.gone ? [t("plugins.youtube.gone", { count: input.gone })] : []),
    ];
  });
  const writes = $derived(found ? found.plan.adding + found.plan.joining : 0);
  const progress = $derived(reading && (reading.of ? t("plugins.youtube.lookingUp", { done: count(reading.read), count: count(reading.of) }) : t("plugins.youtube.reading", { count: reading.read })));

  /** Reads a playlist or a file with `read`, which hears how it's going, and works out what importing it would do. */
  async function find(read: (signal: AbortSignal, progress: (reading: Reading) => void) => Promise<PlaylistInput>) {
    if (reading) return;
    const current = (controller = new AbortController());
    error = null;
    found = null;
    imports.clear(ID);
    reading = { read: 0 };
    try {
      const input = await read(current.signal, (now) => (reading = now));
      found = { input, plan: planPlaylist(input, noteOf) };
      speak(lines.join(" "));
    } catch (problem) {
      if (current.signal.aborted) return;
      console.warn("lines: couldn't read the playlist", problem);
      error = t("plugins.youtube.unreadable");
    } finally {
      if (controller === current) reading = null;
    }
  }

  function findPlaylist() {
    const url = webLink(link.trim());
    const list = url && playlistIn(url);
    if (!list) {
      error = t("plugins.youtube.notPlaylist");
      return;
    }
    void find((signal, progress) => readPlaylist(list, signal, progress));
  }

  function findTakeout({ name, text }: ImportFile) {
    void find(async (signal, progress) => {
      const takeout = readTakeout(text, name);
      return lookUpTakeout(takeout, takeout.title ?? t("plugins.youtube.watchLater"), noteOf, channelLink, signal, progress);
    });
  }

  async function fileChosen() {
    const file = picker?.files?.[0];
    if (picker) picker.value = "";
    if (file) findTakeout({ name: file.name, text: await file.text() });
  }

  onMount(() => {
    const given = untrack(() => files)?.[0];
    if (given) findTakeout(given);
    else if (asked.playlist) {
      link = asked.playlist;
      asked.playlist = null;
      findPlaylist();
    }
  });

  async function stopReading() {
    controller?.abort();
    reading = null;
    await tick();
    field?.focus();
  }

  function close() {
    found = null;
    imports.clear(ID);
    if (onclose) onclose();
    else field?.focus();
  }

  const focus = (element: HTMLElement) => element.focus();
</script>

{#if !files}
  <FieldRow label={t("plugins.youtube.playlist")} note={t("plugins.youtube.playlistNote")} for="{id}-link">
    <TextField
      id="{id}-link"
      type="url"
      spellcheck={false}
      placeholder="https://www.youtube.com/playlist?list=…"
      class="w-56"
      bind:value={link}
      bind:input={field}
      disabled={!!reading}
      aria-describedby="{id}-link-note"
      onkeydown={(event) => {
        if (event.key === "Enter") findPlaylist();
      }}
    />
    <Button onclick={findPlaylist} disabled={!link.trim() || !!reading}>{t("plugins.youtube.find")}</Button>
  </FieldRow>
  <FieldRow label={t("plugins.youtube.watchLater")} note={t("plugins.youtube.watchLaterNote")}>
    <Button icon="import" disabled={!!reading} onclick={() => picker?.click()}>{t("plugins.youtube.chooseTakeout")}</Button>
    <input bind:this={picker} type="file" accept=".csv,text/csv" class="hidden" onchange={fileChosen} />
  </FieldRow>
{/if}
{#if reading}
  <FieldRow label={t("plugins.youtube.readingTitle")}>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <p class="m-0 flex-1 text-sm leading-normal text-muted" role="status">{progress}</p>
      <Button variant="quiet" onclick={stopReading} {@attach focus}>{t("settings.cancel")}</Button>
    </div>
  </FieldRow>
{:else if error}
  <FieldRow label={t("plugins.youtube.readingTitle")}>
    <Callout tone="danger" class="w-full">{error}</Callout>
  </FieldRow>
{/if}
{#if found || (!files && imports.state?.id === ID)}
  {#key found}
    <ImportStep
      id={ID}
      {lines}
      action={writes ? t("plugins.youtube.import") : undefined}
      onimport={() => found && imports.start(ID, found.input)}
      oncancel={close}
      result={(done) => [t("plugins.youtube.added", { count: done.added }), ...(done.appended ? [t("plugins.youtube.joined", { count: done.appended })] : [])].join(" ")}
      undone={(undone) => [t("plugins.youtube.undone", { count: undone.trashed }), ...(undone.restored ? [t("plugins.youtube.restored", { count: undone.restored })] : [])].join(" ")}
    />
  {/key}
{/if}
