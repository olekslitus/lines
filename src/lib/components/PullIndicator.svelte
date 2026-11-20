<script lang="ts">
  import Icon from "../icons/Icon.svelte";

  /*
   * What shows in the room a pull down opens (gestures.ts, which places it and moves it): a
   * magnifying glass that fills with the accent once letting go would search or find, or the
   * spinner iOS refreshes with, its spokes drawn in as it's pulled and turning while it runs.
   * Only to see: the buttons that do the same are what screen readers have.
   */
  let { kind, element = $bindable() }: { kind: "search" | "refresh"; element?: HTMLElement } = $props();

  const SPOKES = 8;
</script>

<div class="pull-indicator pointer-events-none absolute inset-x-0 z-2 flex h-0 justify-center text-muted" aria-hidden="true" bind:this={element}>
  {#if kind === "refresh"}
    <svg class="spinner" viewBox="0 0 28 28" width="28" height="28">
      {#each { length: SPOKES }, i (i)}
        <line x1="14" y1="3" x2="14" y2="8.5" style:--i={i} transform="rotate({i * (360 / SPOKES)} 14 14)" />
      {/each}
    </svg>
  {:else}
    <span class="glass grid size-8 place-items-center rounded-full bg-input transition-colors duration-150">
      <Icon name="search" size={16} strokeWidth={2.25} />
    </span>
  {/if}
</div>

<style>
  /* In the middle of the room the pull opened, growing in as it opens. */
  .pull-indicator > :global(*) {
    flex: none;
    translate: 0 calc(var(--pull) / 2 - 50%);
    scale: calc(0.5 + 0.5 * var(--pulled));
    opacity: var(--pulled);
  }

  .pull-indicator:global([data-busy]) > :global(*) {
    scale: 1;
    opacity: 1;
  }

  .pull-indicator:global([data-armed]) > .glass {
    background: var(--accent);
    color: var(--on-accent);
  }

  .spinner {
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
  }

  /* Each spoke drawn in, clockwise, as the pull gets that far. */
  .spinner line {
    opacity: clamp(0, var(--pulled) * 8 - var(--i), 1);
  }

  /* Turning clockwise, the last spoke brightest and those behind it fading, as iOS's does. */
  .pull-indicator:global([data-busy]) > .spinner {
    animation: turn 0.8s steps(8) infinite;
  }

  .pull-indicator:global([data-busy]) > .spinner line {
    opacity: calc(0.25 + 0.75 * (var(--i) + 1) / 8);
  }

  @keyframes turn {
    to {
      rotate: 1turn;
    }
  }
</style>
