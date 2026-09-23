/* Trip listening checklist. Items are curated in code; checked state syncs
 * across devices via the Supabase kv_state table (key: trip-checklist).
 *
 * The ticks are also shared with the extension's other lists through
 * watch-sync.js: an item declares what it is — a YouTube `url` to take a video
 * id from, a podcast `show` to match against a session's channel — and ticking
 * it here ticks it on the dashboard and in À regarder, and the other way
 * about. Items with neither (a YouTube *search* link, an article) have nothing
 * to match on and stay hand-ticked, which is fine: most of this list is
 * "go and find something on this", not one identifiable video.
 *
 * `sec` is a real measured length, on the items that link to one specific
 * video or episode. `approx` is the median of a show's last 40 published
 * episodes, for podcast items that name a show rather than an episode — shown
 * as "≈35 min" because that is the honest precision.
 *
 * Items have neither when there is nothing to measure (a search link) or no
 * published durations to read (a feed that omits them, a show not on Apple).
 * Those rows simply show no length, the way À regarder handles a video whose
 * length it doesn't know.
 *
 * Each search row is followed by what that search actually turned up, so a
 * collection is not only a promise to go looking: `-vu` is its most-watched
 * result and `-ch` the result from the biggest channel it found (a single row
 * where one video is both). Those two are ordinary video items — a real id for
 * watch-sync to tick, a measured length — while the search row above them
 * stays, for the day neither pick is what you're in the mood for. */

const yt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

const SECTIONS = [
  {
    title: '🎧 Pendant tout le voyage',
    blurb: 'Des valeurs sûres à écouter en route — trajets en train Lyon → Genève inclus.',
    items: [
      { id: 'gen-innerfrench', lang: 'fr', kind: '🎙️', approx: 2040, show: 'InnerFrench', title: 'InnerFrench — épisodes culture & société',
        desc: 'Français clair et lent, parfait en déplacement.', url: 'https://innerfrench.com/podcast/' },
      { id: 'gen-panache', lang: 'fr', kind: '🎙️', approx: 2160, show: 'French With Panache', title: 'French With Panache — conversations réelles',
        desc: 'Déjà dans tes abonnements — pioche les épisodes voyage/cuisine.', url: 'https://podcasts.apple.com/fr/podcast/french-with-panache-interesting-conversations-in-real/id1699597868' },
      { id: 'gen-ovd', lang: 'fr', kind: '🎙️', show: 'On va déguster', title: 'On va déguster (France Inter)',
        desc: 'LA référence gastronomie — cherche les épisodes Lyon, Provence, fromages.', url: 'https://podcasts.apple.com/fr/podcast/on-va-d%C3%A9guster/id382262093' },
      { id: 'gen-bouffons', lang: 'fr', kind: '🎙️', approx: 1740, show: 'Bouffons', title: 'Bouffons (Nouvelles Écoutes)',
        desc: 'La culture culinaire française décortiquée, 30 min par épisode.', url: 'https://podcasts.apple.com/fr/podcast/bouffons/id1324604234' },
      { id: 'gen-duolingo', lang: 'en', kind: '🎙️', approx: 1440, show: 'Duolingo French Podcast', title: 'Duolingo French Podcast',
        desc: 'Histoires vraies mi-anglais mi-français — les jours de fatigue.', url: 'https://podcast.duolingo.com/french' },
      { id: 'gen-easyfrench', lang: 'fr', kind: '▶️', title: 'Easy French — sous-titres FR+EN incrustés',
        desc: 'Micro-trottoirs avec double sous-titrage sur chaque vidéo — cherchez « Paris ou Marseille ? » avec InnerFrench.', url: yt('easy french marseille paris') },
      { id: 'gen-easyfrench-vu', from: 'gen-easyfrench', lang: 'fr', kind: '▶️', sec: 244, title: 'Easy French 1 - à Paris!',
        desc: 'La plus vue sur « easy french marseille paris » (3,3 M de vues), et sur la plus grosse chaîne du lot : Easy Languages, 1,54 M d’abonnés.', url: 'https://www.youtube.com/watch?v=bb4zvZdrMz4' },
      { id: 'gen-ricksteves', lang: 'en', kind: '▶️', title: "Rick Steves' Europe — France episodes",
        desc: 'Le classique anglophone: Riviera, Provence, French Alps.', url: yt('rick steves france riviera provence') },
      { id: 'gen-ricksteves-vu', from: 'gen-ricksteves', lang: 'en', kind: '▶️', sec: 1569, title: 'French Riviera: Uniquely Chic',
        desc: 'La plus vue sur « rick steves france riviera provence » (4,2 M de vues), et sur la plus grosse chaîne du lot : Rick Steves’ Europe, 2,09 M d’abonnés.', url: 'https://www.youtube.com/watch?v=er2tS8vWXHs' },
    ],
  },
  {
    title: '🦁 Lyon — capitale de la gastronomie',
    blurb: 'Bouchons, traboules et mères lyonnaises.',
    items: [
      { id: 'lyon-eb', lang: 'fr', kind: '▶️', sec: 5495, title: 'Échappées belles — « Week-end gourmand à Lyon »',
        desc: 'Documentaire complet France 5 (officiel, ~1h30).', url: 'https://www.youtube.com/watch?v=uyLbScMzyi8' },
      { id: 'lyon-bouchons', lang: 'fr', kind: '▶️', title: 'Les bouchons lyonnais — reportages',
        desc: 'Quenelles, tablier de sapeur, cervelle de canut… à connaître avant de commander.', url: yt('bouchon lyonnais reportage cuisine') },
      { id: 'lyon-bouchons-vu', from: 'lyon-bouchons', lang: 'fr', kind: '▶️', sec: 296, title: 'Un bouchon traditionnel comme on les aime',
        desc: 'La plus vue sur « bouchon lyonnais reportage cuisine » : 515 k vues sur la chaîne C’est meilleur quand c’est bon.', url: 'https://www.youtube.com/watch?v=vljc9bippnQ' },
      { id: 'lyon-bouchons-ch', from: 'lyon-bouchons', lang: 'fr', kind: '▶️', sec: 2384, title: 'Enquête sur la capitale de la Bonne bouffe',
        desc: 'La plus grosse chaîne sortie par cette recherche : SPICA LIFE, 1,1 M d’abonnés — 418 k vues.', url: 'https://www.youtube.com/watch?v=1Tlb5Vh1puc' },
      { id: 'lyon-histoire', lang: 'fr', kind: '▶️', title: 'Histoire de Lyon — Vieux Lyon & traboules',
        desc: 'Capitale des Gaules, soieries, passages secrets des canuts.', url: yt('histoire de lyon documentaire traboules') },
      { id: 'lyon-histoire-vu', from: 'lyon-histoire', lang: 'fr', kind: '▶️', sec: 1665, title: 'Lyon, ville lumière',
        desc: 'La plus vue sur « histoire de lyon documentaire traboules » : 518 k vues sur la chaîne Des Racines et des Ailes - France Télévisions.', url: 'https://www.youtube.com/watch?v=8PFnr4HCR2o' },
      { id: 'lyon-histoire-ch', from: 'lyon-histoire', lang: 'fr', kind: '▶️', sec: 3116, title: 'Fourvière, Fort de Bron… découvrez les secrets des monuments de Lyon ! | Documentaire complet',
        desc: 'La plus grosse chaîne sortie par cette recherche : RMC DECOUVERTE, 339 k abonnés — 79 k vues.', url: 'https://www.youtube.com/watch?v=E1FZr354wfE' },
      { id: 'lyon-halles', lang: 'fr', kind: '▶️', title: 'Les Halles Paul Bocuse',
        desc: 'Le temple des produits lyonnais — repère les stands avant d’y aller.', url: yt('halles paul bocuse lyon reportage') },
      { id: 'lyon-halles-vu', from: 'lyon-halles', lang: 'fr', kind: '▶️', sec: 1531, title: 'La cuisine lyonnaise avec Paul Bocuse et Petitrenaud 👨‍🍳 | INA Les recettes vintage',
        desc: 'La plus vue sur « halles paul bocuse lyon reportage » : 1,2 M de vues sur la chaîne Ina Les Recettes Vintage.', url: 'https://www.youtube.com/watch?v=j11C5gsvzLM' },
      { id: 'lyon-halles-ch', from: 'lyon-halles', lang: 'fr', kind: '▶️', sec: 2384, title: 'Halles de Lyon, au paradis des gourmands',
        desc: 'La plus grosse chaîne sortie par cette recherche : Food Story, 462 k abonnés — 424 k vues.', url: 'https://www.youtube.com/watch?v=Cr-Ttml9JvY' },
    ],
  },
  {
    title: '⛵ Marseille',
    blurb: 'La plus vieille ville de France — 2 600 ans d’histoire.',
    items: [
      { id: 'mars-eb', lang: 'fr', kind: '▶️', sec: 5328, title: 'Échappées belles — « Marseille, la vie en bleu »',
        desc: 'Documentaire complet France 5 (officiel).', url: 'https://www.youtube.com/watch?v=Ccg9V__4mWg' },
      { id: 'mars-corbusier', lang: 'fr', kind: '▶️', title: 'La Cité Radieuse — Le Corbusier (UNESCO)',
        desc: 'Visite l’Unité d’Habitation avant de voir le béton en vrai.', url: yt('cité radieuse le corbusier marseille visite') },
      { id: 'mars-corbusier-vu', from: 'mars-corbusier', lang: 'fr', kind: '▶️', sec: 536, title: 'Le Corbusier - Unité d’Habitation Marseille pt 1',
        desc: 'La plus vue sur « cité radieuse le corbusier marseille visite » : 194 k vues sur la chaîne Channelbeta.', url: 'https://www.youtube.com/watch?v=KZMw-yM14RQ' },
      { id: 'mars-corbusier-ch', from: 'mars-corbusier', lang: 'fr', kind: '▶️', sec: 2948, title: 'La Cité Légendaire du Corbusier',
        desc: 'La plus grosse chaîne sortie par cette recherche : Documentaire Société, 1,91 M d’abonnés — 15 k vues.', url: 'https://www.youtube.com/watch?v=9sOlj6-DUaY' },
      { id: 'mars-bouillabaisse', lang: 'fr', kind: '▶️', title: 'La bouillabaisse — histoire & vraie recette',
        desc: 'La charte de la bouillabaisse existe — sache reconnaître la vraie.', url: yt('bouillabaisse marseille reportage recette') },
      { id: 'mars-bouillabaisse-vu', from: 'mars-bouillabaisse', lang: 'fr', kind: '▶️', sec: 1053, title: 'La Bouillabaisse au Rayol Canadel avec le Chef André Del Monte',
        desc: 'La plus vue sur « bouillabaisse marseille reportage recette » : 167 k vues sur la chaîne Golfe de Saint-Tropez Destination.', url: 'https://www.youtube.com/watch?v=VkURZaG-_jQ' },
      { id: 'mars-bouillabaisse-ch', from: 'mars-bouillabaisse', lang: 'fr', kind: '▶️', sec: 1502, title: 'Terre de Gout :  La Bouillabaisse à Marseille',
        desc: 'La plus grosse chaîne sortie par cette recherche : Food Story, 462 k abonnés — 14 k vues.', url: 'https://www.youtube.com/watch?v=z7AbFRxMfZw' },
      { id: 'mars-calanques', lang: 'fr', kind: '▶️', title: 'Les Calanques & le Vieux-Port',
        desc: 'Sormiou, Morgiou, En-Vau — planifie la rando ou la navette.', url: yt('calanques marseille documentaire') },
      { id: 'mars-calanques-vu', from: 'mars-calanques', lang: 'fr', kind: '▶️', sec: 1517, title: 'Marseille : Les sentinelles des Calanques | Feuilleton France 2',
        desc: 'La plus vue sur « calanques marseille documentaire » : 112 k vues sur la chaîne France 2 Marseille.', url: 'https://www.youtube.com/watch?v=7hOUpAJ89TE' },
      { id: 'mars-calanques-ch', from: 'mars-calanques', lang: 'fr', kind: '▶️', sec: 3112, title: 'A la découverte des Calanques, joyau préservé des Marseillais',
        desc: 'La plus grosse chaîne sortie par cette recherche : Passe-moi les jumelles, 341 k abonnés — 66 k vues.', url: 'https://www.youtube.com/watch?v=yUCn0zRTWqc' },
    ],
  },
  {
    title: '🌊 Nice',
    blurb: 'Comté de Nice: une histoire italienne, une cuisine à part.',
    items: [
      { id: 'nice-eb', lang: 'fr', kind: '▶️', sec: 5091, title: 'Échappées belles — « Nice, l’art de la fête »',
        desc: 'Documentaire complet France 5 (officiel).', url: 'https://www.youtube.com/watch?v=c6axar1j8GM' },
      { id: 'nice-cuisine', lang: 'fr', kind: '▶️', title: 'La cuisine niçoise — socca, pissaladière, pan bagnat',
        desc: 'La socca de Chez Pipo vs. le Vieux Nice: repère où manger.', url: yt('cuisine niçoise socca reportage') },
      { id: 'nice-cuisine-vu', from: 'nice-cuisine', lang: 'fr', kind: '▶️', sec: 216, title: 'Socca : de Nice bien sûr ! - La Quotidienne la suite',
        desc: 'La plus vue sur « cuisine niçoise socca reportage » (48 k vues), et sur la plus grosse chaîne du lot : La Quotidienne, 507 k abonnés.', url: 'https://www.youtube.com/watch?v=yiEkc6G02Ds' },
      { id: 'nice-histoire', lang: 'fr', kind: '▶️', title: 'Histoire de Nice — de la Savoie à la France',
        desc: 'Nice n’est française que depuis 1860 — ça explique tout.', url: yt('histoire de nice documentaire') },
      { id: 'nice-histoire-vu', from: 'nice-histoire', lang: 'fr', kind: '▶️', sec: 375, title: 'L’histoire de NICE... A toute Berzingue !',
        desc: 'La plus vue sur « histoire de nice documentaire » : 132 k vues sur la chaîne A Toute Berzingue ! Lorant Deutsch.', url: 'https://www.youtube.com/watch?v=WKCH3NT-CbQ' },
      { id: 'nice-histoire-ch', from: 'nice-histoire', lang: 'fr', kind: '▶️', sec: 532, title: 'Week-end à Nice : le ciel bleu et la douceur de vivre',
        desc: 'La plus grosse chaîne sortie par cette recherche : TF1 INFO, 1,72 M d’abonnés — 75 k vues.', url: 'https://www.youtube.com/watch?v=o5ZHXHEJPrE' },
    ],
  },
  {
    title: '⚓ Antibes Juan-les-Pins',
    blurb: 'Entre Nice et Cannes: remparts grecs, port Vauban et musée Picasso.',
    items: [
      { id: 'ant-podcast', lang: 'fr', kind: '🎙️', approx: 1080, show: 'Le podcast d’Antibes Juan-les-Pins', title: 'Le podcast d’Antibes Juan-les-Pins — officiel',
        desc: 'La ville se raconte: histoire, culture, interviews d’Antibois — sur Spotify/Apple, donc compté dans ton tracker.', url: 'https://open.spotify.com/show/11ntTLqnzqs5P9WQuSTKWi' },
      { id: 'ant-ici', lang: 'fr', kind: '🎙️', show: '1000 raisons d’aimer la Côte d’Azur', title: '« Antibes : 2 500 ans d’histoire face à la mer » (Radio France)',
        desc: 'Épisode de « 1000 raisons d’aimer la Côte d’Azur »: fondation grecque, fortifications, essor touristique.', url: 'https://www.ici.fr/emissions/1000-raisons-d-aimer-la-cote-d-azur/antibes-2-500-ans-d-histoire-face-a-la-mer-2506120' },
      { id: 'ant-berzingue', lang: 'fr', kind: '▶️', sec: 387, title: 'L’histoire d’Antibes Juan-les-Pins… À toute berzingue !',
        desc: 'Toute l’histoire en 5 min, débit rapide — bon défi de compréhension avant d’arriver.', url: 'https://www.youtube.com/watch?v=uviSD7iB1M4' },
      { id: 'ant-adresses', lang: 'fr', kind: '▶️', sec: 629, title: 'Antibes, bienvenue sur la Côte d’Azur | Mes bonnes adresses',
        desc: 'Une résidente partage ses bonnes adresses — à voir juste avant de partir pour noter des lieux.', url: 'https://www.youtube.com/watch?v=eeFycGv7kRk' },
      { id: 'ant-paroles', lang: 'fr', kind: '🎙️', show: 'Paroles d’Antibois', title: 'Paroles d’Antibois — témoignages d’habitants',
        desc: 'Français authentique non scripté: des Antibois racontent leur ville et son histoire.', url: 'https://www.antibes-juanlespins.com/sorties-loisirs/antibes-ville-de-culture/la-culture-au-numerique/paroles-dantibois/1939-1945-la-seconde-guerre-mondiale/podcast' },
    ],
  },
  {
    title: '🏰 Besançon',
    blurb: 'Vauban, l’horlogerie et le pays du Comté.',
    items: [
      { id: 'bes-eb', lang: 'fr', kind: '▶️', sec: 5363, title: 'Échappées belles — « Échappée en Franche-Comté »',
        desc: 'Documentaire complet France 5 (officiel).', url: 'https://www.youtube.com/watch?v=jGl5xkg7sD4' },
      { id: 'bes-citadelle', lang: 'fr', kind: '▶️', title: 'La Citadelle de Vauban (UNESCO)',
        desc: 'Le chef-d’œuvre de Vauban au-dessus de la boucle du Doubs.', url: yt('citadelle besançon vauban documentaire') },
      { id: 'bes-citadelle-vu', from: 'bes-citadelle', lang: 'fr', kind: '▶️', sec: 6148, title: 'Vauban, le roi et les forteresses - Secrets d’histoire',
        desc: 'La plus vue sur « citadelle besançon vauban documentaire » (286 k vues), et sur la plus grosse chaîne du lot : Secrets d’Histoire - France Télévisions, 787 k abonnés.', url: 'https://www.youtube.com/watch?v=HT7D4XhyO7U' },
      { id: 'bes-comte', lang: 'fr', kind: '▶️', title: 'Le Comté — de la fruitière aux caves d’affinage',
        desc: 'Le fromage roi de la région; les fruitières se visitent.', url: yt('comté fromage fruitière documentaire') },
      { id: 'bes-comte-vu', from: 'bes-comte', lang: 'fr', kind: '▶️', sec: 365, title: 'Le dernier producteur de comté à l’ancienne - Météo à la carte',
        desc: 'La plus vue sur « comté fromage fruitière documentaire » : 500 k vues sur la chaîne Météo à la carte - France Télévisions.', url: 'https://www.youtube.com/watch?v=U0D_a_o9wcQ' },
      { id: 'bes-comte-ch', from: 'bes-comte', lang: 'fr', kind: '▶️', sec: 1809, title: 'Les fromages AOP dans la tourmente | ARTE Regards',
        desc: 'La plus grosse chaîne sortie par cette recherche : ARTE, 5,05 M d’abonnés — 90 k vues.', url: 'https://www.youtube.com/watch?v=1GS9FYSRje8' },
      { id: 'bes-ronchamp', lang: 'fr', kind: '▶️', title: 'Ronchamp — la chapelle de Le Corbusier',
        desc: 'À 1h de Besançon: l’autre chef-d’œuvre UNESCO de Le Corbusier (fil rouge avec Marseille !).', url: yt('chapelle ronchamp le corbusier visite') },
      { id: 'bes-ronchamp-vu', from: 'bes-ronchamp', lang: 'fr', kind: '▶️', sec: 647, title: 'RONCHAMP I LE CORBUSIER I A WALK THROUGH IN 4K',
        desc: 'La plus vue sur « chapelle ronchamp le corbusier visite » : 137 k vues sur la chaîne Fourth Wall.', url: 'https://www.youtube.com/watch?v=hEkQvR-el3M' },
      { id: 'bes-ronchamp-ch', from: 'bes-ronchamp', lang: 'fr', kind: '▶️', sec: 132, title: 'Chapelle de Ronchamp : visite inédite de la coque dessinée par Le Corbusier',
        desc: 'La plus grosse chaîne sortie par cette recherche : France 3 Bourgogne-Franche-Comté, 207 k abonnés — 4 k vues.', url: 'https://www.youtube.com/watch?v=eQ8a8FxWyvI' },
    ],
  },
  {
    title: '🚗 Sur la route',
    blurb: 'Vous conduisez — de quoi remplir les trajets et éviter les pièges au volant.',
    items: [
      { id: 'route-conduire-fr', lang: 'fr', kind: '▶️', title: 'Conduire en France — péages, radars, priorité à droite',
        desc: 'Le télépéage, les 80 km/h, la fameuse priorité à droite en ville.', url: yt('conduire en france conseils autoroute péage priorité à droite') },
      { id: 'route-conduire-fr-vu', from: 'route-conduire-fr', lang: 'fr', kind: '▶️', sec: 196, title: '20. LA PRIORITÉ DE DROITE',
        desc: 'La plus vue sur « conduire en france conseils autoroute péage priorité à droite » : 1,2 M de vues sur la chaîne PERMIS DE CONDUIRE.', url: 'https://www.youtube.com/watch?v=TQmjsFMC7E8' },
      { id: 'route-conduire-fr-ch', from: 'route-conduire-fr', lang: 'fr', kind: '▶️', sec: 343, title: 'INSERTION SUR AUTOROUTE - ASTUCE PERMIS #3',
        desc: 'La plus grosse chaîne sortie par cette recherche : CONDUITE ONLINE, 753 k abonnés — 601 k vues.', url: 'https://www.youtube.com/watch?v=cAU4kP7P_TY' },
      { id: 'route-vignette', lang: 'fr', kind: '▶️', title: 'Conduire en Suisse — la vignette autoroutière',
        desc: 'Vignette obligatoire (~40 CHF), limites différentes, radars impitoyables — à voir AVANT de passer la frontière.', url: yt('conduire en suisse vignette autoroute règles') },
      { id: 'route-vignette-vu', from: 'route-vignette', lang: 'fr', kind: '▶️', sec: 178, title: 'La vignette électronique pour les autoroutes suisses en bref',
        desc: 'La plus vue sur « conduire en suisse vignette autoroute règles » : 355 k vues sur la chaîne Bundesamt für Zoll und Grenzsicherheit.', url: 'https://www.youtube.com/watch?v=Qv4uwd4kbYE' },
      { id: 'route-vignette-ch', from: 'route-vignette', lang: 'en', kind: '▶️', sec: 758, title: 'HOW TO DRIVE IN SWITZERLAND: Must-know rules and tips for driving in Switzerland!',
        desc: 'La plus grosse chaîne sortie par cette recherche : The Traveling Swiss – Louis & Alexis, 81,1 k abonnés — 141 k vues.', url: 'https://www.youtube.com/watch?v=rpIq-s2bUps' },
      { id: 'route-baladeurs', lang: 'fr', kind: '🎙️', approx: 2940, show: 'Les Baladeurs', title: 'Les Baladeurs (Les Others)',
        desc: 'Récits d’aventure immersifs — le podcast parfait pour les longues routes.', url: 'https://podcasts.apple.com/fr/podcast/les-baladeurs/id1388330691' },
    ],
  },
  {
    title: '⚽ Football',
    blurb: 'Trois villes de Ligue 1 sur votre route: OL, OM, OGC Nice — et le Servette à Genève.',
    items: [
      { id: 'foot-afterfoot', lang: 'fr', kind: '🎙️', show: 'L’After Foot', title: 'L’After Foot (RMC)',
        desc: 'L’émission foot de référence — quotidienne, parfaite en voiture.', url: 'https://podcasts.apple.com/fr/podcast/lafter-foot/id140644703' },
      { id: 'foot-om', lang: 'fr', kind: '▶️', title: 'L’OM & le Vélodrome — la ferveur marseillaise',
        desc: 'Le stade se visite; comprendre l’OM, c’est comprendre Marseille.', url: yt('OM supporters vélodrome documentaire') },
      { id: 'foot-om-vu', from: 'foot-om', lang: 'fr', kind: '▶️', sec: 1598, title: 'OM - Leipzig | L’histoire d’un quart de finale 🔥',
        desc: 'La plus vue sur « OM supporters vélodrome documentaire » : 4,2 M de vues sur la chaîne OM.', url: 'https://www.youtube.com/watch?v=heoZ1u-2pD4' },
      { id: 'foot-om-ch', from: 'foot-om', lang: 'fr', kind: '▶️', sec: 4544, title: 'Olympique de Marseille : quand le milieu faisait la loi',
        desc: 'La plus grosse chaîne sortie par cette recherche : Investigation, 5,29 M d’abonnés — 630 k vues.', url: 'https://www.youtube.com/watch?v=Lj0RpgkMkl4' },
      { id: 'foot-ol', lang: 'fr', kind: '▶️', title: 'L’Olympique Lyonnais & le Groupama Stadium',
        desc: 'L’histoire de l’OL, ses sept titres d’affilée — visite du stade possible.', url: yt('olympique lyonnais histoire documentaire') },
      { id: 'foot-ol-vu', from: 'foot-ol', lang: 'fr', kind: '▶️', sec: 1026, title: 'L’ÉPOPÉE DE LYON EN EUROPA LEAGUE 2016/2017',
        desc: 'La plus vue sur « olympique lyonnais histoire documentaire » : 1,0 M de vues sur la chaîne Remontada.', url: 'https://www.youtube.com/watch?v=cMSo4j48bKc' },
      { id: 'foot-ol-ch', from: 'foot-ol', lang: 'fr', kind: '▶️', sec: 597, title: 'De condamné à la Coupe d’Europe : Retour sur le miracle lyonnais | 2023-24 | Ligue 1 Uber Eats',
        desc: 'La plus grosse chaîne sortie par cette recherche : Ligue 1 McDonald’s, 3,4 M d’abonnés — 149 k vues.', url: 'https://www.youtube.com/watch?v=sd7TKnVwP84' },
      { id: 'foot-nice-servette', lang: 'fr', kind: '▶️', title: 'OGC Nice & Servette Genève',
        desc: 'Les deux autres clubs de votre itinéraire — match à caler si les dates tombent bien ?', url: yt('OGC Nice Servette Genève histoire club') },
      { id: 'foot-nice-servette-vu', from: 'foot-nice-servette', lang: 'fr', kind: '▶️', sec: 1335, title: 'VISITE D’UN DES MEILLEURS CLUB DE HOCKEY D’EUROPE (ils m’ont impressionnés)',
        desc: 'La plus vue sur « OGC Nice Servette Genève histoire club » : 27 k vues sur la chaîne Parlons Peu Parlons Sport – Mathieu.', url: 'https://www.youtube.com/watch?v=LfWMVtT6sr0' },
      { id: 'foot-nice-servette-ch', from: 'foot-nice-servette', lang: 'fr', kind: '▶️', sec: 200, title: 'L’histoire de l’OGC Nice en Coupe de France I FFF 2022',
        desc: 'La plus grosse chaîne sortie par cette recherche : Fédération Française de Football, 4,02 M d’abonnés — 3 k vues.', url: 'https://www.youtube.com/watch?v=0FDzkLNqKnk' },
    ],
  },
  {
    title: '⌚ Horlogerie de luxe',
    blurb: 'Besançon = capitale horlogère française (musée du Temps), Genève = capitale du luxe (Patek, Rolex, Vacheron).',
    items: [
      { id: 'montre-suisse', lang: 'fr', kind: '▶️', title: 'Dans les manufactures suisses — Patek, Rolex, Audemars',
        desc: 'Documentaires sur la haute horlogerie; le musée Patek Philippe à Genève vaut la visite.', url: yt('manufacture horlogerie suisse documentaire patek philippe rolex') },
      { id: 'montre-suisse-vu', from: 'montre-suisse', lang: 'en', kind: '▶️', sec: 789, title: 'Why Swiss watches made by Richard Mille, Patek Philippe are so expensive | 60 Minutes',
        desc: 'La plus vue sur « manufacture horlogerie suisse documentaire patek philippe rolex » (3,9 M de vues), et sur la plus grosse chaîne du lot : 60 Minutes, 4,2 M d’abonnés.', url: 'https://www.youtube.com/watch?v=FWX0V9BQe_A' },
      { id: 'montre-lip', lang: 'fr', kind: '▶️', title: 'LIP — la saga horlogère de Besançon',
        desc: 'L’usine autogérée des années 70, une histoire ouvrière mythique — et des LIP au musée du Temps.', url: yt('LIP besançon horlogerie documentaire autogestion') },
      { id: 'montre-lip-vu', from: 'montre-lip', lang: 'fr', kind: '▶️', sec: 849, title: 'Les montres Lip - Reportage - Visites privées',
        desc: 'La plus vue sur « LIP besançon horlogerie documentaire autogestion » : 107 k vues sur la chaîne Visites privées.', url: 'https://www.youtube.com/watch?v=u6YJERyydXo' },
      { id: 'montre-lip-ch', from: 'montre-lip', lang: 'fr', kind: '▶️', sec: 289, title: 'Le point sur Lip',
        desc: 'La plus grosse chaîne sortie par cette recherche : INA Politique, 437 k abonnés — 2 k vues.', url: 'https://www.youtube.com/watch?v=2GkG72Vphqs' },
      { id: 'montre-besancon', lang: 'fr', kind: '▶️', title: 'Besançon, capitale française de l’horlogerie',
        desc: 'L’observatoire chronométrique, le musée du Temps, la renaissance des ateliers.', url: yt('besançon horlogerie musée du temps documentaire') },
      { id: 'montre-besancon-vu', from: 'montre-besancon', lang: 'fr', kind: '▶️', sec: 254, title: 'Les gardiens du temps, à Besançon',
        desc: 'La plus vue sur « besançon horlogerie musée du temps documentaire » (8 k vues), et sur la plus grosse chaîne du lot : Des Racines et des Ailes - France Télévisions, 224 k abonnés.', url: 'https://www.youtube.com/watch?v=ZGMS8uZkE10' },
      { id: 'montre-vallee', lang: 'fr', kind: '▶️', title: 'La Vallée de Joux — berceau de la haute horlogerie',
        desc: 'À 1h de Genève: Audemars Piguet, Jaeger-LeCoultre, et l’Espace Horloger.', url: yt('vallée de joux horlogerie documentaire') },
      { id: 'montre-vallee-vu', from: 'montre-vallee', lang: 'en', kind: '▶️', sec: 1641, title: 'Visiting Jaeger-LeCoultre’s Manufacture In Switzerland (Behind The Scenes Private Tour)',
        desc: 'La plus vue sur « vallée de joux horlogerie documentaire » : 1,2 M de vues sur la chaîne Teddy Baldassarre.', url: 'https://www.youtube.com/watch?v=4hZGCguYUj8' },
      { id: 'montre-vallee-ch', from: 'montre-vallee', lang: 'fr', kind: '▶️', sec: 3038, title: 'La fabuleuse histoire de la montre',
        desc: 'La plus grosse chaîne sortie par cette recherche : imineo Documentaires, 3,58 M d’abonnés — 119 k vues.', url: 'https://www.youtube.com/watch?v=IWxgWjiKU5E' },
      { id: 'montre-quartz', lang: 'fr', kind: '▶️', title: 'La crise du quartz — quand l’horlogerie suisse a failli mourir',
        desc: 'Années 70-80: le Japon attaque, la Suisse s’effondre, Swatch la sauve. LA grande histoire du secteur.', url: yt('crise du quartz horlogerie suisse swatch histoire') },
      { id: 'montre-quartz-vu', from: 'montre-quartz', lang: 'fr', kind: '▶️', sec: 300, title: '"Suisse?" – Pourquoi les gens achètent des montres suisses super chères?',
        desc: 'La plus vue sur « crise du quartz horlogerie suisse swatch histoire » (6,0 M de vues), et sur la plus grosse chaîne du lot : 52 minutes RTS, 316 k abonnés.', url: 'https://www.youtube.com/watch?v=vYM85fjjV9M' },
      { id: 'montre-rolex', lang: 'fr', kind: '▶️', title: 'Rolex & Patek Philippe — histoire des maisons',
        desc: 'Hans Wilsdorf, la Genève des cabinotiers, et pourquoi Patek reste familiale depuis 1839.', url: yt('histoire rolex patek philippe documentaire français') },
      { id: 'montre-rolex-vu', from: 'montre-rolex', lang: 'fr', kind: '▶️', sec: 1636, title: 'Rolex, la saga du roi de l’horlogerie',
        desc: 'La plus vue sur « histoire rolex patek philippe documentaire français » (1,2 M de vues), et sur la plus grosse chaîne du lot : imineo Documentaires, 3,58 M d’abonnés.', url: 'https://www.youtube.com/watch?v=SxPGecLThUI' },
      { id: 'montre-chaux', lang: 'fr', kind: '▶️', title: 'La Chaux-de-Fonds & Le Locle (UNESCO)',
        desc: 'Les villes-manufactures suisses, pile entre Besançon et Genève — Musée international d’horlogerie, détour possible !', url: yt('la chaux-de-fonds horlogerie unesco musée documentaire') },
      { id: 'montre-chaux-vu', from: 'montre-chaux', lang: 'fr', kind: '▶️', sec: 173, title: 'La Chaux-de-Fonds',
        desc: 'La plus vue sur « la chaux-de-fonds horlogerie unesco musée documentaire » (37 k vues), et sur la plus grosse chaîne du lot : Des Racines et des Ailes - France Télévisions, 224 k abonnés.', url: 'https://www.youtube.com/watch?v=qS6gfVxwG_I' },
    ],
  },
  {
    title: '🏞️ Escapades autour des villes',
    blurb: 'Les alentours pittoresques — villages et paysages à moins d’1h30 de vos étapes, faisables en voiture.',
    items: [
      { id: 'esc-perouges', lang: 'fr', kind: '▶️', title: 'Pérouges & le Beaujolais (près de Lyon)',
        desc: 'Cité médiévale à 35 min de Lyon + les villages dorés du Beaujolais.', url: yt('pérouges cité médiévale beaujolais documentaire') },
      { id: 'esc-perouges-vu', from: 'esc-perouges', lang: 'fr', kind: '▶️', sec: 349, title: 'Pérouges, village, médiéval . Plus beau village de France',
        desc: 'La plus vue sur « pérouges cité médiévale beaujolais documentaire » : 35 k vues sur la chaîne Passion Villages de France.', url: 'https://www.youtube.com/watch?v=URMevcTZ4qM' },
      { id: 'esc-perouges-ch', from: 'esc-perouges', lang: 'fr', kind: '▶️', sec: 211, title: 'Pérouges n°1 : historique',
        desc: 'La plus grosse chaîne sortie par cette recherche : INA Histoire, 340 k abonnés — 868 vues.', url: 'https://www.youtube.com/watch?v=QSAgNxWCjPc' },
      { id: 'esc-provence', lang: 'fr', kind: '▶️', title: 'Cassis, Aix & les villages du Luberon (près de Marseille)',
        desc: 'Cassis et ses calanques, Aix-en-Provence, Gordes, Roussillon — la Provence carte postale.', url: yt('cassis aix en provence luberon gordes villages documentaire') },
      { id: 'esc-provence-vu', from: 'esc-provence', lang: 'fr', kind: '▶️', sec: 5394, title: 'Luberon de villages en villages - Échappées belles',
        desc: 'La plus vue sur « cassis aix en provence luberon gordes villages documentaire » : 198 k vues sur la chaîne Echappées belles.', url: 'https://www.youtube.com/watch?v=7Cj26RIaW8w' },
      { id: 'esc-provence-ch', from: 'esc-provence', lang: 'fr', kind: '▶️', sec: 2460, title: 'Lubéron et Alpilles, les pépites de la Provence',
        desc: 'La plus grosse chaîne sortie par cette recherche : Documentaire Société, 1,91 M d’abonnés — 15 k vues.', url: 'https://www.youtube.com/watch?v=pSLSek1WrUk' },
      { id: 'esc-azur', lang: 'fr', kind: '▶️', title: 'Èze, Saint-Paul-de-Vence & les villages perchés (près de Nice)',
        desc: 'Les nids d’aigle de la Côte d’Azur — Èze à 20 min de Nice, vue inoubliable.', url: yt('villages perchés côte azur èze saint-paul-de-vence documentaire') },
      { id: 'esc-azur-vu', from: 'esc-azur', lang: 'fr', kind: '▶️', sec: 5446, title: 'La Côte d’Azur, de village en village',
        desc: 'La plus vue sur « villages perchés côte azur èze saint-paul-de-vence documentaire » (160 k vues), et sur la plus grosse chaîne du lot : Echappées belles, 610 k abonnés.', url: 'https://www.youtube.com/watch?v=EdMfA6QKywg' },
      { id: 'esc-doubs', lang: 'fr', kind: '▶️', title: 'La vallée de la Loue & Baume-les-Messieurs (près de Besançon)',
        desc: 'Ornans (pays de Courbet), les reculées du Jura, Arbois et son vin jaune.', url: yt('vallée de la loue ornans baume-les-messieurs jura documentaire') },
      { id: 'esc-doubs-vu', from: 'esc-doubs', lang: 'fr', kind: '▶️', sec: 65, title: 'BAUME-LES-MESSIEURS, UN CONCENTRE DE MERVEILLES !',
        desc: 'La plus vue sur « vallée de la loue ornans baume-les-messieurs jura documentaire » : 65 k vues sur la chaîne Jura Tourisme & Attractivité.', url: 'https://www.youtube.com/watch?v=FSBH7aqeEu0' },
      { id: 'esc-doubs-ch', from: 'esc-doubs', lang: 'fr', kind: '▶️', sec: 6570, title: 'Que découvrir entre les monts du Jura et la Saône ? - Des racines et des ailes - Documentaire',
        desc: 'La plus grosse chaîne sortie par cette recherche : Des Racines et des Ailes - France Télévisions, 224 k abonnés — 19 k vues.', url: 'https://www.youtube.com/watch?v=IgMyvXCXsN4' },
      { id: 'esc-leman', lang: 'fr', kind: '▶️', title: 'Annecy, Yvoire & les vignobles de Lavaux (autour du Léman)',
        desc: 'Annecy « Venise des Alpes » sur votre route Lyon→Genève, le village médiéval d’Yvoire, et Lavaux (UNESCO) côté suisse.', url: yt('annecy yvoire lavaux léman documentaire') },
      { id: 'esc-leman-vu', from: 'esc-leman', lang: 'fr', kind: '▶️', sec: 2326, title: 'Les milliardaires du Lac Léman',
        desc: 'La plus vue sur « annecy yvoire lavaux léman documentaire » : 3,6 M de vues sur la chaîne BLING !.', url: 'https://www.youtube.com/watch?v=RJX5PEt-XXs' },
      { id: 'esc-leman-ch', from: 'esc-leman', lang: 'fr', kind: '▶️', sec: 3510, title: 'La magie du Lac Léman',
        desc: 'La plus grosse chaîne sortie par cette recherche : imineo Documentaires, 3,58 M d’abonnés — 49 k vues.', url: 'https://www.youtube.com/watch?v=xWjYQcSN7lU' },
      { id: 'esc-bern', lang: 'fr', kind: '▶️', title: 'Le Village préféré des Français (Stéphane Bern)',
        desc: 'L’émission culte — cherchez les éditions Provence, Jura et Savoie.', url: yt('le village préféré des français stéphane bern provence jura') },
      { id: 'esc-bern-vu', from: 'esc-bern', lang: 'fr', kind: '▶️', sec: 8064, title: 'Le plus beau village de 2026 est... - Le village préféré des Français 2026',
        desc: 'La plus vue sur « le village préféré des français stéphane bern provence jura » : 76 k vues sur la chaîne Le village préféré des Français - France TV.', url: 'https://www.youtube.com/watch?v=iq4tE-Fk6bM' },
      { id: 'esc-bern-ch', from: 'esc-bern', lang: 'fr', kind: '▶️', sec: 554, title: 'Gordes - Région PACA - Stéphane Bern - Le village préféré des Français 2016',
        desc: 'La plus grosse chaîne sortie par cette recherche : Le Pays préféré des Français, 122 k abonnés — 66 k vues.', url: 'https://www.youtube.com/watch?v=zR13IcCRqqI' },
    ],
  },
  {
    title: '💎 Maisons de luxe — l’histoire',
    blurb: 'Hermès, Chanel, LVMH… Les maisons racontent elles-mêmes leur histoire — et Lyon (la soie !) en fait partie.',
    items: [
      { id: 'luxe-loudana', lang: 'fr', kind: '🎙️', approx: 3420, show: 'Podcast du Luxe', title: 'Podcast du Luxe (Lou Dana)',
        desc: 'Décryptage des grandes maisons, épisode par épisode.', url: 'https://podcasts.apple.com/fr/podcast/podcast-du-luxe-par-lou-dana/id1763830244' },
      { id: 'luxe-hermes', lang: 'fr', kind: '🎙️', show: 'Le Monde d’Hermès', title: 'Le Monde d’Hermès — podcast officiel',
        desc: 'La maison raconte ses artisans et son histoire, production superbe.', url: 'https://open.spotify.com/search/le%20monde%20d%27herm%C3%A8s' },
      { id: 'luxe-chanel', lang: 'fr', kind: '🎙️', show: '3.55', title: 'Chanel « 3.55 » — podcast officiel',
        desc: 'Création, ateliers, histoire de Gabrielle Chanel.', url: 'https://open.spotify.com/search/chanel%203.55' },
      { id: 'luxe-prigent', lang: 'fr', kind: '▶️', title: 'Loïc Prigent — coulisses des défilés & ateliers',
        desc: 'LE documentariste de la mode, drôle et sous-titré — Dior, Chanel, Vuitton de l’intérieur.', url: yt('loïc prigent atelier dior chanel coulisses') },
      { id: 'luxe-prigent-vu', from: 'luxe-prigent', lang: 'fr', kind: '▶️', sec: 3418, title: 'WOW! CHANEL: JOURNAL OF A COLLECTION! By Loic Prigent',
        desc: 'La plus vue sur « loïc prigent atelier dior chanel coulisses » : 1,5 M de vues sur la chaîne Loic Prigent.', url: 'https://www.youtube.com/watch?v=_waWz5gVa4s' },
      { id: 'luxe-prigent-ch', from: 'luxe-prigent', lang: 'fr', kind: '▶️', sec: 177, title: 'In the Métiers d’art Ateliers With Loïc Prigent. Métiers d’art 2020/21 — CHANEL',
        desc: 'La plus grosse chaîne sortie par cette recherche : CHANEL, 2,92 M d’abonnés — 179 k vues.', url: 'https://www.youtube.com/watch?v=_44dg3v2ZKg' },
      { id: 'luxe-arnault', lang: 'fr', kind: '▶️', title: 'HugoDécrypte × Bernard Arnault',
        desc: 'Le patron de LVMH interviewé par la chaîne que vous suivez déjà.', url: yt('hugodécrypte bernard arnault interview') },
      { id: 'luxe-arnault-vu', from: 'luxe-arnault', lang: 'fr', kind: '▶️', sec: 6105, title: 'BERNARD ARNAULT : CONFESSIONS INÉDITES DU PATRON DU LUXE MONDIAL (empire, drames, rumeurs…)',
        desc: 'La plus vue sur « hugodécrypte bernard arnault interview » (1,9 M de vues), et sur la plus grosse chaîne du lot : LEGEND, 3,76 M d’abonnés.', url: 'https://www.youtube.com/watch?v=npvbkg9EI3U' },
      { id: 'luxe-acquired', lang: 'en', kind: '🎙️', sec: 12300, show: 'Acquired', title: 'Acquired — « LVMH »',
        desc: 'Toute la saga LVMH en anglais — le récit business de référence, transcript complet sur le site.', url: 'https://www.acquired.fm/episodes/lvmh' },
      { id: 'luxe-soie', lang: 'fr', kind: '▶️', title: 'La soie lyonnaise — des canuts aux carrés Hermès',
        desc: 'À voir avant Lyon: la Croix-Rousse, la Maison des Canuts, et pourquoi le luxe français est né là.', url: yt('soie lyonnaise canuts histoire documentaire') },
      { id: 'luxe-soie-vu', from: 'luxe-soie', lang: 'fr', kind: '▶️', sec: 7123, title: 'Les révoltes des canuts (documentaire complet)',
        desc: 'La plus vue sur « soie lyonnaise canuts histoire documentaire » : 37 k vues sur la chaîne Oui d’accord.', url: 'https://www.youtube.com/watch?v=RBHb4M7Nuhs' },
      { id: 'luxe-soie-ch', from: 'luxe-soie', lang: 'fr', kind: '▶️', sec: 371, title: 'Lyon, au fil de la soie',
        desc: 'La plus grosse chaîne sortie par cette recherche : FRANCE 24, 8,7 M d’abonnés — 31 k vues.', url: 'https://www.youtube.com/watch?v=uxetfzGT1xA' },
    ],
  },
  {
    title: '⛲ Genève & le Léman',
    blurb: 'La Suisse romande — même langue, autre pays.',
    items: [
      { id: 'gen2-eb', lang: 'fr', kind: '▶️', sec: 3575, title: 'Échappées belles — « Autour du Léman »',
        desc: 'Croisière sur le lac, Genève incluse (officiel).', url: 'https://www.youtube.com/watch?v=tUFin66qb1Q' },
      { id: 'gen2-leman', lang: 'fr', kind: '▶️', sec: 5426, title: '« Week-end sur les rives du Léman »',
        desc: 'L’épisode plus récent (2025), côté art de vivre.', url: 'https://www.youtube.com/watch?v=ATxd3GRamx0' },
      { id: 'gen2-cern', lang: 'fr', kind: '▶️', title: 'Le CERN — visite en français',
        desc: 'Réserve la visite gratuite; le vocabulaire scientifique en français est un bon défi.', url: yt('CERN visite guidée français') },
      { id: 'gen2-cern-vu', from: 'gen2-cern', lang: 'fr', kind: '▶️', sec: 2134, title: 'Le LHC 💥🧲🔬 : J’ai visité le plus grand accélérateur de particules du monde !',
        desc: 'La plus vue sur « CERN visite guidée français » (1,0 M de vues), et sur la plus grosse chaîne du lot : ScienceEtonnante, 1,51 M d’abonnés.', url: 'https://www.youtube.com/watch?v=mFilSnstW8U' },
      { id: 'gen2-fondue', lang: 'fr', kind: '▶️', title: 'Fondue & cuisine suisse romande',
        desc: 'Moitié-moitié, longeole, malakoffs — et pourquoi les Suisses râlent sur la fondue française.', url: yt('fondue suisse reportage tradition') },
      { id: 'gen2-fondue-vu', from: 'gen2-fondue', lang: 'fr', kind: '▶️', sec: 602, title: 'Raclette : Française ou Suisse ?',
        desc: 'La plus vue sur « fondue suisse reportage tradition » (381 k vues), et sur la plus grosse chaîne du lot : Jamy - Epicurieux, 2,41 M d’abonnés.', url: 'https://www.youtube.com/watch?v=VhCnuKRSDOQ' },
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

const ALL_ITEMS = SECTIONS.flatMap((s) => s.items);

// This page as a surface for watch-sync: keyed by the item's own id, and only
// items that name something a session could have recorded ever match.
registerSurface({
  name: 'trip',
  kv: KV_KEY,
  keys(link) {
    const videoIds = new Set(link.videoIds);
    const shows = new Set(link.shows);
    return ALL_ITEMS.filter((item) => {
      const l = contentLinks(item);
      return l.videoIds.some((v) => videoIds.has(v)) || l.shows.some((sh) => shows.has(sh));
    }).map((item) => item.id);
  },
  patch(state, keys, done) {
    const next = { ...state };
    let changed = false;
    for (const k of keys) {
      if (!!next[k] !== done) { next[k] = done; changed = true; }
    }
    return changed ? next : null;
  },
});

// Catch up on ticks made elsewhere while this page wasn't open. Only items we
// have no answer for are filled in — an item the user deliberately cleared is
// stored as false, not missing, so it stays cleared.
async function reconcile() {
  const done = await doneElsewhere(ALL_ITEMS);
  const missing = [...done].filter((id) => checked[id] === undefined);
  if (!missing.length) return;
  for (const id of missing) checked[id] = true;
  render();
  await saveChecked();
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
      // A pick (`from`) is drawn as a child of the search row it came out of —
      // side by side they read as unrelated entries, which is what the flat
      // list looked like the first time round.
      row.className = 'trip-item' + (item.from ? ' trip-sub' : '') + (checked[item.id] ? ' done' : '');

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!checked[item.id];
      box.onchange = () => {
        // Unticking records false rather than dropping the key: reconcile()
        // fills in only the items it has no answer for, and "I cleared this on
        // purpose" is an answer.
        checked[item.id] = box.checked;
        row.classList.toggle('done', box.checked);
        updateProgress();
        saveChecked();
        // Tick it on the dashboard and in À regarder too, where this item is
        // something they know about. Not awaited: the tick above is already
        // saved, and the mirror is best-effort.
        mirrorTick('trip', contentLinks(item), box.checked);
      };

      const info = document.createElement('div');
      info.style.flex = '1';
      info.innerHTML =
        `<div class="trip-title"><a href="${item.url}" target="_blank" rel="noopener">${item.title} ↗</a></div>` +
        `<div class="trip-desc">${item.desc}</div>`;

      const tags = document.createElement('span');
      tags.className = 'trip-tags';
      // formatDuration comes from youtube-todo-rules.js, the same one À
      // regarder uses, so a length reads identically on both pages. Items
      // without a measured length just show the flag and kind.
      // A measured length where there is one thing to time; otherwise a
      // typical episode length, marked "≈" so the two are never confused.
      const dur = formatDuration(item.sec) || approxLength(item.approx);
      tags.textContent = [`${item.lang === 'fr' ? '🇫🇷' : '🇬🇧'} ${item.kind}`, dur]
        .filter(Boolean).join(' · ');

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
  reconcile(); // network round-trip — let the list paint first
})();
