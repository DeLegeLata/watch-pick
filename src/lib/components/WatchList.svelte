<script lang="ts">
  // The shared watchlist: anything either of them saved or typed, plus what's
  // on Prime's and Plex's watchlists, wherever it can be watched.
  import { addedLabel, listMeta } from '../engine';
  import { OPEN_LABEL, SERVICE_LABEL, type ListItem } from '../model';

  let {
    items,
    me,
    names,
    ready,
    onadd,
    onremove
  }: {
    items: ListItem[];
    me: string;
    names: Record<string, string>;
    ready: boolean;
    onadd: (typed: string) => Promise<boolean>;
    onremove: (item: ListItem) => void;
  } = $props();

  let typed = $state('');
  let adding = $state(false);
  let onlyNow = $state(false);
  const watchable = $derived(items.filter((i) => i.service));
  const shown = $derived(onlyNow ? watchable : items);
  let failed = $state(new Set<string>());

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const t = typed.trim();
    if (!t || adding) return;
    adding = true;
    if (await onadd(t)) typed = '';
    adding = false;
  }

  const badge = (i: ListItem) => (i.service ? SERVICE_LABEL[i.service] : i.key ? 'Not on your services' : 'Looking it up…');
</script>

{#if !ready}
  <section class="card"><p>The watchlist needs the database update first: run <code>supabase/watch.sql</code> again.</p></section>
{:else}
  <form class="card add" onsubmit={add}>
    <label for="add-title">Add a title</label>
    <div class="add-row">
      <input id="add-title" bind:value={typed} placeholder="A movie or show" autocomplete="off" enterkeyhint="done" />
      <button class="primary" disabled={!typed.trim() || adding}>Add</button>
    </div>
    <p class="muted small">The 4:30 pm refresh finds it and where you can watch it.</p>
  </form>

  <section class="chips" aria-label="Show">
    <button class:on={!onlyNow} aria-pressed={!onlyNow} onclick={() => (onlyNow = false)}>All {items.length}</button>
    <button class:on={onlyNow} aria-pressed={onlyNow} onclick={() => (onlyNow = true)}>Can watch now {watchable.length}</button>
  </section>

  {#each shown as item (item.id)}
    {@const meta = listMeta(item)}
    <article class="card pick item">
      <div class="poster" aria-hidden="true">
        {#if item.poster && !failed.has(item.id)}
          <img src={item.poster} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => (failed = new Set(failed).add(item.id))} />
        {:else}
          <span>{item.title.slice(0, 1).toUpperCase()}</span>
        {/if}
      </div>
      <div class="body">
        <h3>{item.title}{#if item.year}<span class="year">{` ${item.year}`}</span>{/if}</h3>
        {#if meta}<p class="meta">{meta}</p>{/if}
        <p class="badge" data-service={item.service ?? (item.key ? 'none' : 'pending')}>{badge(item)}</p>
        {#if item.note}<p class="note">{item.note}</p>{/if}
        <p class="added muted">{addedLabel(item, me, names)}</p>
      </div>
      <div class="actions">
        {#if item.service && item.link}
          <a class="button primary" href={item.link} target="_blank" rel="noopener">{OPEN_LABEL[item.service]}</a>
        {/if}
        <button class="ghost" onclick={() => onremove(item)}>Remove</button>
      </div>
    </article>
  {:else}
    <section class="card">
      <p>
        {onlyNow
          ? 'Nothing on the list is on Prime, Plex or Shudder right now.'
          : 'Nothing on the watchlist yet. Add a title above, or tap Save on a pick.'}
      </p>
    </section>
  {/each}
{/if}
