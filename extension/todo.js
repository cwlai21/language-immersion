/* Trip listening checklist. Items are curated in code; checked state syncs
 * across devices via the Supabase kv_state table (key: trip-checklist). */

const yt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

const SECTIONS = [
  {
    title: '🎧 Pendant tout le voyage',
    blurb: 'Des valeurs sûres à écouter en route — trajets en train Lyon → Genève inclus.',
    items: [
      { id: 'gen-innerfrench', lang: 'fr', kind: '🎙️', title: 'InnerFrench — épisodes culture & société',
        desc: 'Français clair et lent, parfait en déplacement.', url: 'https://innerfrench.com/podcast/' },
      { id: 'gen-panache', lang: 'fr', kind: '🎙️', title: 'French With Panache — conversations réelles',
        desc: 'Déjà dans tes abonnements — pioche les épisodes voyage/cuisine.', url: 'https://podcasts.apple.com/fr/podcast/french-with-panache-interesting-conversations-in-real/id1699597868' },
      { id: 'gen-ovd', lang: 'fr', kind: '🎙️', title: 'On va déguster (France Inter)',
        desc: 'LA référence gastronomie — cherche les épisodes Lyon, Provence, fromages.', url: 'https://podcasts.apple.com/fr/podcast/on-va-d%C3%A9guster/id382262093' },
      { id: 'gen-bouffons', lang: 'fr', kind: '🎙️', title: 'Bouffons (Nouvelles Écoutes)',
        desc: 'La culture culinaire française décortiquée, 30 min par épisode.', url: 'https://podcasts.apple.com/fr/podcast/bouffons/id1324604234' },
      { id: 'gen-duolingo', lang: 'en', kind: '🎙️', title: 'Duolingo French Podcast',
        desc: 'Histoires vraies mi-anglais mi-français — les jours de fatigue.', url: 'https://podcast.duolingo.com/french' },
      { id: 'gen-ricksteves', lang: 'en', kind: '▶️', title: "Rick Steves' Europe — France episodes",
        desc: 'Le classique anglophone: Riviera, Provence, French Alps.', url: yt('rick steves france riviera provence') },
    ],
  },
  {
    title: '🦁 Lyon — capitale de la gastronomie',
    blurb: 'Bouchons, traboules et mères lyonnaises.',
    items: [
      { id: 'lyon-eb', lang: 'fr', kind: '▶️', title: 'Échappées belles — « Week-end gourmand à Lyon »',
        desc: 'Documentaire complet France 5 (officiel, ~1h30).', url: 'https://www.youtube.com/watch?v=uyLbScMzyi8' },
      { id: 'lyon-bouchons', lang: 'fr', kind: '▶️', title: 'Les bouchons lyonnais — reportages',
        desc: 'Quenelles, tablier de sapeur, cervelle de canut… à connaître avant de commander.', url: yt('bouchon lyonnais reportage cuisine') },
      { id: 'lyon-histoire', lang: 'fr', kind: '▶️', title: 'Histoire de Lyon — Vieux Lyon & traboules',
        desc: 'Capitale des Gaules, soieries, passages secrets des canuts.', url: yt('histoire de lyon documentaire traboules') },
      { id: 'lyon-halles', lang: 'fr', kind: '▶️', title: 'Les Halles Paul Bocuse',
        desc: 'Le temple des produits lyonnais — repère les stands avant d’y aller.', url: yt('halles paul bocuse lyon reportage') },
    ],
  },
  {
    title: '⛵ Marseille',
    blurb: 'La plus vieille ville de France — 2 600 ans d’histoire.',
    items: [
      { id: 'mars-eb', lang: 'fr', kind: '▶️', title: 'Échappées belles — « Marseille, la vie en bleu »',
        desc: 'Documentaire complet France 5 (officiel).', url: 'https://www.youtube.com/watch?v=ksw7lp_rI7Y' },
      { id: 'mars-corbusier', lang: 'fr', kind: '▶️', title: 'La Cité Radieuse — Le Corbusier (UNESCO)',
        desc: 'Visite l’Unité d’Habitation avant de voir le béton en vrai.', url: yt('cité radieuse le corbusier marseille visite') },
      { id: 'mars-bouillabaisse', lang: 'fr', kind: '▶️', title: 'La bouillabaisse — histoire & vraie recette',
        desc: 'La charte de la bouillabaisse existe — sache reconnaître la vraie.', url: yt('bouillabaisse marseille reportage recette') },
      { id: 'mars-calanques', lang: 'fr', kind: '▶️', title: 'Les Calanques & le Vieux-Port',
        desc: 'Sormiou, Morgiou, En-Vau — planifie la rando ou la navette.', url: yt('calanques marseille documentaire') },
    ],
  },
  {
    title: '🌊 Nice',
    blurb: 'Comté de Nice: une histoire italienne, une cuisine à part.',
    items: [
      { id: 'nice-eb', lang: 'fr', kind: '▶️', title: 'Échappées belles — « Nice, l’art de la fête »',
        desc: 'Documentaire complet France 5 (officiel).', url: 'https://www.youtube.com/watch?v=c6axar1j8GM' },
      { id: 'nice-cuisine', lang: 'fr', kind: '▶️', title: 'La cuisine niçoise — socca, pissaladière, pan bagnat',
        desc: 'La socca de Chez Pipo vs. le Vieux Nice: repère où manger.', url: yt('cuisine niçoise socca reportage') },
      { id: 'nice-histoire', lang: 'fr', kind: '▶️', title: 'Histoire de Nice — de la Savoie à la France',
        desc: 'Nice n’est française que depuis 1860 — ça explique tout.', url: yt('histoire de nice documentaire') },
    ],
  },
  {
    title: '🏰 Besançon',
    blurb: 'Vauban, l’horlogerie et le pays du Comté.',
    items: [
      { id: 'bes-eb', lang: 'fr', kind: '▶️', title: 'Échappées belles — « Échappée en Franche-Comté »',
        desc: 'Documentaire complet France 5 (officiel).', url: 'https://www.youtube.com/watch?v=jGl5xkg7sD4' },
      { id: 'bes-citadelle', lang: 'fr', kind: '▶️', title: 'La Citadelle de Vauban (UNESCO)',
        desc: 'Le chef-d’œuvre de Vauban au-dessus de la boucle du Doubs.', url: yt('citadelle besançon vauban documentaire') },
      { id: 'bes-comte', lang: 'fr', kind: '▶️', title: 'Le Comté — de la fruitière aux caves d’affinage',
        desc: 'Le fromage roi de la région; les fruitières se visitent.', url: yt('comté fromage fruitière documentaire') },
      { id: 'bes-ronchamp', lang: 'fr', kind: '▶️', title: 'Ronchamp — la chapelle de Le Corbusier',
        desc: 'À 1h de Besançon: l’autre chef-d’œuvre UNESCO de Le Corbusier (fil rouge avec Marseille !).', url: yt('chapelle ronchamp le corbusier visite') },
    ],
  },
  {
    title: '⛲ Genève & le Léman',
    blurb: 'La Suisse romande — même langue, autre pays.',
    items: [
      { id: 'gen2-eb', lang: 'fr', kind: '▶️', title: 'Échappées belles — « Autour du Léman »',
        desc: 'Croisière sur le lac, Genève incluse (officiel).', url: 'https://www.youtube.com/watch?v=tUFin66qb1Q' },
      { id: 'gen2-leman', lang: 'fr', kind: '▶️', title: '« Week-end sur les rives du Léman »',
        desc: 'L’épisode plus récent (2025), côté art de vivre.', url: 'https://www.youtube.com/watch?v=ATxd3GRamx0' },
      { id: 'gen2-cern', lang: 'fr', kind: '▶️', title: 'Le CERN — visite en français',
        desc: 'Réserve la visite gratuite; le vocabulaire scientifique en français est un bon défi.', url: yt('CERN visite guidée français') },
      { id: 'gen2-fondue', lang: 'fr', kind: '▶️', title: 'Fondue & cuisine suisse romande',
        desc: 'Moitié-moitié, longeole, malakoffs — et pourquoi les Suisses râlent sur la fondue française.', url: yt('fondue suisse reportage tradition') },
    ],
  },
];

const KV_KEY = 'trip-checklist';
let checked = {};

async function loadChecked() {
  try {
    const rows = await sbRequest(`kv_state?key=eq.${KV_KEY}&select=value`);
    if (rows.length) checked = JSON.parse(rows[0].value);
  } catch {
    try { checked = JSON.parse(localStorage.getItem(KV_KEY)) || {}; } catch { checked = {}; }
  }
}

async function saveChecked() {
  localStorage.setItem(KV_KEY, JSON.stringify(checked));
  try {
    await sbRequest('kv_state?on_conflict=key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: { key: KV_KEY, value: JSON.stringify(checked), updated_at: new Date().toISOString() },
    });
  } catch { /* offline — localStorage keeps it until next save */ }
}

function updateProgress() {
  const total = SECTIONS.reduce((n, s) => n + s.items.length, 0);
  const done = SECTIONS.reduce((n, s) => n + s.items.filter((i) => checked[i.id]).length, 0);
  document.getElementById('progress').textContent = `${done} / ${total} ✓`;
}

function render() {
  const root = document.getElementById('sections');
  root.innerHTML = '';
  for (const section of SECTIONS) {
    const div = document.createElement('div');
    div.className = 'trip-section';
    div.innerHTML = `<h2>${section.title}</h2><p class="blurb">${section.blurb}</p>`;
    for (const item of section.items) {
      const row = document.createElement('div');
      row.className = 'trip-item' + (checked[item.id] ? ' done' : '');

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!checked[item.id];
      box.onchange = () => {
        checked[item.id] = box.checked;
        if (!box.checked) delete checked[item.id];
        row.classList.toggle('done', box.checked);
        updateProgress();
        saveChecked();
      };

      const info = document.createElement('div');
      info.style.flex = '1';
      info.innerHTML =
        `<div class="trip-title"><a href="${item.url}" target="_blank" rel="noopener">${item.title} ↗</a></div>` +
        `<div class="trip-desc">${item.desc}</div>`;

      const tags = document.createElement('span');
      tags.className = 'trip-tags';
      tags.textContent = `${item.lang === 'fr' ? '🇫🇷' : '🇬🇧'} ${item.kind}`;

      row.append(box, info, tags);
      div.appendChild(row);
    }
    root.appendChild(div);
  }
  updateProgress();
}

(async function init() {
  await loadChecked();
  render();
})();
