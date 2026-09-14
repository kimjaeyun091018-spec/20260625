// ============================================================
// PokeAPI helper — fetch + localStorage cache
// Pokémon Champions uses mainline battle mechanics (types,
// abilities, moves, natures), so we pull live species/move data
// from PokeAPI instead of hand-maintaining a dataset.
// ============================================================

const API_BASE = "https://pokeapi.co/api/v2";
const CACHE_PREFIX = "pc_cache:";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 2 weeks

async function cachedFetch(url) {
  const key = CACHE_PREFIX + url;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const { t, data } = JSON.parse(raw);
      if (Date.now() - t < CACHE_TTL_MS) return data;
    }
  } catch (e) { /* ignore corrupt cache entries */ }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`요청 실패 (${res.status}): ${url}`);
  const data = await res.json();
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), data }));
  } catch (e) { /* storage full — safe to skip caching */ }
  return data;
}

// ---- 25 vanilla natures with their stat modifiers ----
const NATURES = {
  hardy: {}, lonely: { up: "atk", down: "def" }, brave: { up: "atk", down: "spe" },
  adamant: { up: "atk", down: "spa" }, naughty: { up: "atk", down: "spd" },
  bold: { up: "def", down: "atk" }, docile: {}, relaxed: { up: "def", down: "spe" },
  impish: { up: "def", down: "spa" }, lax: { up: "def", down: "spd" },
  timid: { up: "spe", down: "atk" }, hasty: { up: "spe", down: "def" }, serious: {},
  jolly: { up: "spe", down: "spa" }, naive: { up: "spe", down: "spd" },
  modest: { up: "spa", down: "atk" }, mild: { up: "spa", down: "def" },
  quiet: { up: "spa", down: "spe" }, bashful: {}, rash: { up: "spa", down: "spd" },
  calm: { up: "spd", down: "atk" }, gentle: { up: "spd", down: "def" },
  sassy: { up: "spd", down: "spe" }, careful: { up: "spd", down: "spa" }, quirky: {},
};

const STAT_LABEL = { hp: "HP", atk: "공격", def: "방어", spa: "특공", spd: "특방", spe: "스피드" };

// Curated competitive-relevant held items (PokeAPI's full item list is
// ~2000 entries, mostly irrelevant to battling, so we hand-pick the set
// that's actually useful in a team builder).
const HELD_ITEMS = [
  "leftovers", "focus-sash", "choice-band", "choice-specs", "choice-scarf",
  "life-orb", "assault-vest", "rocky-helmet", "heavy-duty-boots",
  "sitrus-berry", "lum-berry", "figy-berry", "mental-herb", "safety-goggles",
  "eviolite", "weakness-policy", "expert-belt", "light-clay", "black-sludge",
  "toxic-orb", "flame-orb", "air-balloon", "wide-lens", "scope-lens",
  "shell-bell", "loaded-dice", "throat-spray", "covert-cloak", "clear-amulet",
  "booster-energy", "protective-pads", "mirror-herb", "room-service",
];

function nameToDisplay(slug) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function searchSpecies(query, limit = 12) {
  const list = await getAllSpeciesNames();
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return list.filter((n) => n.includes(q)).slice(0, limit);
}

let _allSpeciesCache = null;
async function getAllSpeciesNames() {
  if (_allSpeciesCache) return _allSpeciesCache;
  const data = await cachedFetch(`${API_BASE}/pokemon?limit=2000`);
  _allSpeciesCache = data.results.map((r) => r.name);
  return _allSpeciesCache;
}

async function getPokemon(name) {
  return cachedFetch(`${API_BASE}/pokemon/${name}`);
}

function spriteUrl(pokemonData) {
  return (
    pokemonData?.sprites?.other?.["official-artwork"]?.front_default ||
    pokemonData?.sprites?.front_default ||
    ""
  );
}

async function getAbilitiesFor(pokemonData) {
  return pokemonData.abilities.map((a) => a.ability.name);
}

async function getMovesFor(pokemonData) {
  return pokemonData.moves.map((m) => m.move.name).sort();
}

window.PC = {
  NATURES,
  STAT_LABEL,
  HELD_ITEMS,
  nameToDisplay,
  searchSpecies,
  getPokemon,
  spriteUrl,
  getAbilitiesFor,
  getMovesFor,
  cachedFetch,
  API_BASE,
};
