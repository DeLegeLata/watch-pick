<script lang="ts">
  // Asks this person how a title they've seen was. A "We've seen it" tap on
  // either phone puts the title here on both, since each rates for themselves.
  import { RATINGS, type Unrated } from '../model';

  let { items, onrate }: { items: Unrated[]; onrate: (item: Unrated, rating: number) => void } = $props();

  const item = $derived(items[0]);
</script>

{#if item}
  <section class="card rate" aria-label="Rate what you've seen">
    <p class="slot">How was it?{items.length > 1 ? ` · 1 of ${items.length}` : ''}</p>
    <h3>{item.title}</h3>
    <div class="rate-buttons">
      {#each RATINGS as r (r.value)}
        <button onclick={() => onrate(item, r.value)}>{r.label}</button>
      {/each}
    </div>
    <button class="link" onclick={() => onrate(item, 0)}>I didn't watch it</button>
  </section>
{/if}
