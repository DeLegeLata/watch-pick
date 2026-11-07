<script lang="ts">
  // The shared watchlist: anything either of them saved or typed, plus what's
  // on their own Prime and Plex watchlists, wherever it can be watched. Each
  // has their own list in it (Mine, and the other's), and Both is where the
  // two overlap.
  import { inView, listMeta, wantLabel } from '../engine';
  import { OPEN_LABEL, SERVICE_LABEL, type ListItem, type Whose } from '../model';

  let {
    items,
    me,
    other,
    names,
    ready,
    onadd,
    onremove,
    onmetoo
  }: {
    items: ListItem[];
    me: string;
    /** The other person's name, e.g. "Sarah" on Stuart's phone. */
    other: string | undefined;
    names: Record<string, string>;
    ready: boolean;
    onadd: (typed: string) => Promise<boolean>;
    onremove: (item: ListItem) => void;
    onmetoo: (item: ListItem) => void;
  } = $props();

  const remembered = () => {
    try {
      const v = localStorage.getItem('watch-pick:whose');
      return v === 'both' || v === 'mine' || v === 'theirs' ? v : 'all';
    } catch {
      return 'all';
    }
  };

  let typed = $state('');
  let adding = $state(false);
  let whose = $state<Whose>(remembered());
  let onlyNow = $state(false);
  let failed = $state(new Set<string>());

  $effect(() => {
    try {
      localStorage.setItem('watch-pick:whose', whose);
    } catch {
      // Not remembering the view is fine.
    }
  });

  const theirs = $derived(other ? `${other}'s` : 'Theirs');
  const VIEWS = $derived<{ id: Whose; label: string }[]>([
    { id: 'both', label: 'Both' },
    { id: 'mine', label: 'Mine' },
    { id: 'theirs', label: theirs },
    { id: 'all', label: 'All' }
  ]);
  const inWhose = $derived(items.filter((i) => inView(i, me, whose)));
  const watchable = $derived(inWhose.filter((i) => i.service));
  const shown = $derived(onlyNow ? watchable : inWhose);
  const count = (view: Whose) => items.filter((i) => inView(i, me, view)).length;

  const EMPTY = $derived<Record<Whose, string>>({
    both: `Nothing you both want yet. Tap Me too on one of ${theirs} titles, or Save a pick you'd both watch.`,
    mine: 'Nothing on your list yet. Add a title above, or tap Save on a pick.',
    theirs: `Nothing on ${theirs} list yet.`,
    all: 'Nothing on the watchlist yet. Add a title above, or tap Save on a pick.'
  });

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const t = typed.trim();
    if (!t || adding) return;
    adding = true;
    if (await onadd(t)) typed = '';
    adding = false;
  }

  const badge = (i: ListItem) => (i.service ? SERVICE_LABEL[i.service] : i.key ? 'Not on your services' : 'Looking it up…');
  const isMine = (i: ListItem) => i.wants.some((w) => w.user_id === me);
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
    <p class="muted small">It goes on your list. The 4:30 pm refresh finds it and where you can watch it.</p>
  </form>

  <section class="chips whose" aria-label="Whose list">
    {#each VIEWS as v (v.id)}
      <button class:on={whose === v.id} aria-pressed={whose === v.id} onclick={() => (whose = v.id)}>{v.label} {count(v.id)}</button>
    {/each}
  </section>
  <section class="chips" aria-label="Where">
    <button class:on={!onlyNow} aria-pressed={!onlyNow} onclick={() => (onlyNow = false)}>Any service {inWhose.length}</button>
    <button class:on={onlyNow} aria-pressed={onlyNow} onclick={() => (onlyNow = true)}>Can watch now {watchable.length}</button>
  </section>

  {#each shown as item (item.id)}
    {@const meta = listMeta(item)}
    {@const both = item.wants.length > 1}
    <article class="card pick item" class:both>
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
        <p class="added" class:muted={!both}>{wantLabel(item, me, names)}</p>
      </div>
      <div class="actions">
        {#if item.service && item.link}
          <a class="button primary" href={item.link} target="_blank" rel="noopener">{OPEN_LABEL[item.service]}</a>
        {/if}
        {#if isMine(item)}
          <button class="ghost" onclick={() => onremove(item)}>Remove</button>
        {:else}
          <button class="metoo" onclick={() => onmetoo(item)}>Me too</button>
        {/if}
      </div>
    </article>
  {:else}
    <section class="card">
      <p>{onlyNow && inWhose.length ? 'Nothing here is on Prime, Plex or Shudder right now.' : EMPTY[whose]}</p>
    </section>
  {/each}
{/if}
