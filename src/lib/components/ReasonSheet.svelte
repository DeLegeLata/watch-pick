<script lang="ts">
  // The one thing the phones write: why a pick is wrong, and for "seen", how
  // it was. The daily refresh reads these and learns from them.
  import { RATINGS, REASONS, type Pick, type Reason } from '../model';

  let {
    pick,
    onchoose,
    oncancel
  }: {
    pick: Pick | null;
    onchoose: (p: Pick, r: Reason, rating: number | null) => void;
    oncancel: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  // "We've seen it" opens a second step that asks how it was.
  let rating = $state(false);

  $effect(() => {
    if (pick && !dialog.open) dialog.showModal();
    if (!pick && dialog.open) dialog.close();
    if (!pick) rating = false;
  });
</script>

<dialog bind:this={dialog} class="sheet" onclose={oncancel} aria-labelledby="sheet-title">
  {#if pick && rating}
    <h3 id="sheet-title">{pick.title}</h3>
    <p class="muted">How was it for you?</p>
    <div class="reasons">
      {#each RATINGS as r (r.value)}
        <button onclick={() => onchoose(pick, 'seen', r.value)}><strong>{r.label}</strong></button>
      {/each}
    </div>
    <button class="ghost wide" onclick={() => onchoose(pick, 'seen', null)}>Rate it later</button>
  {:else if pick}
    <h3 id="sheet-title">{pick.title}</h3>
    <p class="muted">What's wrong with it?</p>
    <div class="reasons">
      {#each REASONS.filter((r) => !r.resume || pick.slot === 'resume') as r (r.id)}
        <button onclick={() => (r.id === 'seen' ? (rating = true) : onchoose(pick, r.id, null))}>
          <strong>{r.label}</strong>
          <span class="muted">{r.hint}</span>
        </button>
      {/each}
    </div>
    <button class="ghost wide" onclick={oncancel}>Cancel</button>
  {/if}
</dialog>
