<script lang="ts">
  import { Popover } from "bits-ui";
  import { untrack } from "svelte";
  import Button from "../components/ui/Button.svelte";
  import IconButton from "../components/ui/IconButton.svelte";
  import { floating } from "../components/ui/styles";
  import TextField from "../components/ui/TextField.svelte";
  import { t } from "../i18n/index.svelte";
  import { pointAt } from "../popover";

  /*
   * A link's text and address, to change, or to make a link of the selected text (linkEditing.ts):
   * ⌘K, or the bar under a link while Markdown is hidden. ↵ keeps what's typed, Esc leaves the link
   * as it was; either way focus goes back to the note. A picture's text is its description.
   */

  type Props = {
    x: number;
    y: number;
    text: string;
    href: string;
    image: boolean;
    /** Making a link, rather than changing one. */
    adding: boolean;
    onsave: (text: string, href: string) => void;
    /** Takes the link away, leaving its text; none for a picture. */
    onremove?: () => void;
    onopen: (href: string) => void;
    oncopy: (href: string) => void;
    onclose: () => void;
  };
  let { x, y, image, adding, onsave, onremove, onopen, oncopy, onclose, ...given }: Props = $props();

  let open = $state(true);
  let text = $state(untrack(() => given.text));
  let href = $state(untrack(() => given.href));
  let address = $state<HTMLInputElement>();
  const ready = $derived(!!href.trim());
  const title = $derived(t(adding ? "editor.link.add" : image ? "editor.link.editImage" : "editor.link.edit"));

  function save() {
    if (!ready) return;
    onsave(text, href.trim());
    open = false;
  }
</script>

<Popover.Root bind:open onOpenChangeComplete={(opened) => !opened && onclose()}>
  <Popover.Portal>
    <Popover.Content
      customAnchor={pointAt(x, y)}
      side="bottom"
      align="start"
      sideOffset={0}
      collisionPadding={8}
      role="dialog"
      aria-label={title}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        address?.focus();
        address?.select();
      }}
      onCloseAutoFocus={(event) => event.preventDefault()}
      class="{floating} w-[min(340px,calc(100vw-16px))] p-3"
    >
      <form
        class="flex flex-col gap-2"
        onsubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <p class="m-0 text-xs font-semibold text-muted" aria-hidden="true">{title}</p>
        <label class="flex flex-col gap-1 text-xs text-muted">
          {t(image ? "editor.link.description" : "editor.link.text")}
          <TextField bind:value={text} autocomplete="off" spellcheck="false" />
        </label>
        <label class="flex flex-col gap-1 text-xs text-muted">
          {t("editor.link.address")}
          <TextField bind:input={address} bind:value={href} icon="link" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://" />
        </label>
        <div class="mt-1 flex items-center gap-1">
          <IconButton icon="external-link" label={t("editor.link.open")} disabled={!ready} onclick={() => onopen(href.trim())} />
          <IconButton icon="copy" label={t("editor.link.copy")} disabled={!ready} onclick={() => oncopy(href.trim())} />
          {#if onremove}
            <IconButton
              icon="trash"
              label={t("editor.link.remove")}
              onclick={() => {
                onremove();
                open = false;
              }}
            />
          {/if}
          <Button variant="primary" type="submit" class="ml-auto" disabled={!ready}>{t(adding ? "editor.link.addAction" : "editor.link.save")}</Button>
        </div>
      </form>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
