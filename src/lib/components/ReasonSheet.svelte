<script lang="ts">
  // The one thing the phones write: why a pick is wrong. The weekly refresh
  // reads these and learns from them.
  import { REASONS, type Pick, type Reason } from '../model';

  let {
    pick,
    onchoose,
    oncancel
  }: { pick: Pick | null; onchoose: (p: Pick, r: Reason) => void; oncancel: () => void } = $props();

  let dialog: HTMLDialogElement;

  $effect(() => {
    if (pick && !dialog.open) dialog.showModal();
    if (!pick && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} class="sheet" onclose={oncancel} aria-labelledby="sheet-title">
  {#if pick}
    <h3 id="sheet-title">{pick.title}</h3>
    <p class="muted">What's wrong with it?</p>
    <div class="reasons">
      {#each REASONS as r (r.id)}
        <button onclick={() => onchoose(pick, r.id)}>
          <strong>{r.label}</strong>
          <span class="muted">{r.hint}</span>
        </button>
      {/each}
    </div>
    <button class="ghost wide" onclick={oncancel}>Cancel</button>
  {/if}
</dialog>
