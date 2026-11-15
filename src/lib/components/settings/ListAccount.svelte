<script lang="ts">
  // A list's site in Settings → Library (AniList, MyAnimeList: a plugin's `lists`): signing in, with a
  // token pasted from the site's page or in the browser; once signed in, how keeping the list in step
  // is going, and importing the list as notes (ImportStep.svelte, lib/imports/imports.svelte.ts), at
  // once and when asked. The account is kept and used in the main window (lib/library/lists.svelte.ts).
  import { onDestroy, tick } from "svelte";
  import { speak } from "../../a11y";
  import { locale, t } from "../../i18n/index.svelte";
  import Icon from "../../icons/Icon.svelte";
  import { imports } from "../../imports/imports.svelte";
  import { ListError } from "../../library/lists";
  import { lists } from "../../library/lists.svelte";
  import { openExternal } from "../../platform";
  import type { ImportFile, ListEntry } from "../../plugins/types";
  import Button from "../ui/Button.svelte";
  import Callout from "../ui/Callout.svelte";
  import FieldRow from "../ui/FieldRow.svelte";
  import TextField from "../ui/TextField.svelte";
  import CardBlock from "./CardBlock.svelte";
  import ImportStep from "./ImportStep.svelte";

  // A list is asked for, not files: an import's `files` and `onclose` are never given.
  let { id }: { id: string; files?: ImportFile[]; onclose?: () => void } = $props();

  const field = $props.id();
  const site = $derived(lists.site(id));
  const kept = $derived(lists.state[id]);
  /** Signed in, and the site still takes it. */
  const signedIn = $derived(!!kept && kept.problem?.reason !== "token");

  let token = $state("");
  let connecting = $state(false);
  let error = $state<string | null>(null);
  /** What's on the list, to import, and how much of it the Library has already. Large: not made deeply reactive. */
  let found = $state.raw<{ entries: ListEntry[]; there: number } | null>(null);
  let finding = $state(false);
  let controller: AbortController | undefined;
  onDestroy(() => controller?.abort());

  const time = (at: number) => new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(at);

  /** Why the site couldn't be asked, as people read it. */
  function messageOf(problem: unknown) {
    const name = site?.name ?? "";
    if (!(problem instanceof ListError)) return t("library.list.unreachable", { name });
    if (problem.reason === "token") return t("library.list.badToken", { name });
    if (problem.reason === "wait") return t("library.list.wait", { name, time: time(problem.until ?? Date.now()) });
    return t("library.list.answered", { name, said: problem.message });
  }

  /** How keeping the list in step is going, said under who's signed in. */
  const status = $derived.by(() => {
    if (!kept || !site) return "";
    const name = site.name;
    if (kept.busy) return t("library.list.syncing", { name });
    const problem = kept.problem;
    if (problem?.reason === "wait") return t("library.list.wait", { name, time: time(problem.until ?? Date.now()) });
    if (problem) return problem.reason === "offline" ? t("library.list.offline", { name }) : t("library.list.failed", { name });
    return kept.synced ? t("library.list.synced", { time: time(kept.synced) }) : t("library.list.notYet");
  });

  async function signIn() {
    if (!site || connecting) return;
    const current = (controller = new AbortController());
    connecting = true;
    error = null;
    try {
      const account = await site.connect("page" in site.signIn ? token.trim() : null, current.signal);
      token = "";
      await lists.signIn(id, account);
      speak(t("library.list.signedInAs", { name: site.name, user: account.name }));
      // Signing in, the list's offered to import at once.
      await find();
    } catch (problem) {
      if (current.signal.aborted) return;
      console.warn(`lines: couldn't sign in to ${site.name}`, problem instanceof Error ? problem.message : "");
      error = messageOf(problem);
    } finally {
      if (controller === current) connecting = false;
    }
  }

  function stopSigningIn() {
    controller?.abort();
    connecting = false;
  }

  async function signOut() {
    found = null;
    imports.clear(id);
    await lists.signOut(id);
    speak(t("library.list.signedOut", { name: site?.name ?? "" }));
  }

  /** Asks the site for the whole list, to say what importing it would do. */
  async function find() {
    if (!site || finding) return;
    const current = (controller = new AbortController());
    finding = true;
    error = null;
    imports.clear(id);
    try {
      // Asked in the main window, with the account kept there, which a refreshed token stays with.
      const entries = await lists.entries(id);
      if (current.signal.aborted) return;
      found = { entries, there: lists.there(id, entries) };
      speak(lines.join(" "));
    } catch (problem) {
      if (!current.signal.aborted) error = messageOf(problem);
    } finally {
      if (controller === current) finding = false;
    }
  }

  const lines = $derived(
    found
      ? [
          t("library.list.found", { count: found.entries.length, name: site?.name ?? "" }),
          ...(found.there ? [t("library.list.there", { count: found.there })] : []),
        ]
      : [],
  );

  async function close() {
    found = null;
    imports.clear(id);
    await tick();
    document.getElementById(`${field}-import`)?.focus();
  }
</script>

{#if !site}
  <!-- Its plugin's off: its group isn't shown. -->
{:else if site.unavailable}
  <CardBlock><Callout>{site.unavailable}</Callout></CardBlock>
{:else if !signedIn}
  <FieldRow
    label={t("library.list.signIn")}
    note={"page" in site.signIn ? t("library.list.tokenNote", { name: site.name }) : t("library.list.browserNote", { name: site.name })}
    for={"page" in site.signIn ? `${field}-token` : undefined}
  >
    {#if "page" in site.signIn}
      <TextField
        id="{field}-token"
        type="password"
        autocomplete="off"
        spellcheck={false}
        class="w-56"
        bind:value={token}
        disabled={connecting}
        aria-describedby="{field}-token-note"
        onkeydown={(event) => event.key === "Enter" && void signIn()}
      />
      <Button onclick={signIn} disabled={!token.trim() || connecting} busy={connecting}>{t("library.list.signInButton")}</Button>
    {:else}
      <Button onclick={signIn} disabled={connecting} busy={connecting}>{t("library.list.signInBrowser")}</Button>
    {/if}
    {#snippet below()}
      {#if connecting && !("page" in site.signIn)}
        <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p class="m-0 flex-1 text-sm leading-normal text-muted" role="status">{t("library.list.waitingForBrowser", { name: site.name })}</p>
          <Button variant="quiet" onclick={stopSigningIn}>{t("settings.cancel")}</Button>
        </div>
      {:else if error || kept?.problem?.reason === "token"}
        <Callout tone="danger" class="mt-3 w-full">{error ?? t("library.list.badToken", { name: site.name })}</Callout>
      {/if}
      {#if "page" in site.signIn}
        {@const page = site.signIn.page}
        <Button variant="quiet" icon="external-link" class="-ml-2.5 mt-2" onclick={() => openExternal(page)}>{t("library.list.getToken", { name: site.name })}</Button>
      {/if}
    {/snippet}
  </FieldRow>
{:else}
  <FieldRow label={t("library.list.signedIn", { user: kept.name })} note={status}>
    <Button variant="quiet" icon="refresh" onclick={() => void lists.syncNow()} disabled={kept.busy}>{t("library.list.syncNow")}</Button>
    <Button variant="quiet" onclick={signOut}>{t("library.list.signOut")}</Button>
    {#snippet below()}
      {#if kept.problem && kept.problem.reason !== "wait"}
        <p class="m-0 mt-2 flex items-center gap-2 text-xs leading-normal text-muted"><Icon name="circle-alert" size={14} class="shrink-0" />{t("library.list.kept")}</p>
      {/if}
    {/snippet}
  </FieldRow>
  {#if found || imports.state?.id === id}
    {#key found}
      <ImportStep
        {id}
        {lines}
        action={found && found.entries.length > found.there ? t("library.list.import", { count: found.entries.length - found.there }) : undefined}
        onimport={() => found && imports.start(id, { site: id, entries: found.entries })}
        oncancel={close}
        result={(done) => t("library.list.imported", { count: done.added })}
        undone={(undone) => t("import.undone", { count: undone.trashed })}
      />
    {/key}
  {:else}
    <FieldRow label={t("library.list.importLabel")} note={t("library.list.importNote", { name: site.name })}>
      <Button id="{field}-import" icon="import" onclick={find} disabled={finding} busy={finding}>{t("library.list.findList")}</Button>
      {#snippet below()}
        {#if error}<Callout tone="danger" class="mt-3 w-full">{error}</Callout>{/if}
      {/snippet}
    </FieldRow>
  {/if}
{/if}
